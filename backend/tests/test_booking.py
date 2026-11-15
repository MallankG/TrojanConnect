"""Booking workflow: Club Agent <-> Venue Scheduling Agent negotiation, human review, confirmation.

Covers the PRD §16 unit, integration and security cases that apply: state transitions and who may
make them, routing, capacity/time/lead-time policy, proposal expiry and staleness, double-booking,
reviewer authority (incl. a USG rep trying to approve), idempotency, and model-confirmation attempts.
No network: the seeded calendar is replaced per test and state lives in a temp directory.
"""

from __future__ import annotations

import uuid
from datetime import datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import main
from app.tools import event_plan as tools
from app.workflows.booking import inventory, negotiation, schemas, service, states
from app.workflows.event_pipeline import plan, store

NOW = datetime.fromisoformat("2026-11-14T10:00:00-08:00")
HEADERS = {"X-TrojanConnect-Client": "web"}

PROFILE = {
    "attendance": "30", "audience": ["Students"], "food": True, "amplifiedSound": False, "filmed": False, "acceptAlternate": True,
    "vendorServes": True, "paymentType": "PO", "orgName": "TEST DO NOT PROCESS", "firstName": "Test", "lastName": "Only",
    "email": "test@usc.edu", "phone": "2135550100", "uscId": "1234567890", "initials": "TT", "eboardPosition": "President",
    "onsiteName": "Test Onsite", "onsitePhone": "2135550101", "eventName": "TEST DO NOT PROCESS", "description": "Dry run",
    "eventType": "Meeting", "date": "2027-03-04", "setupTime": "17:30", "startTime": "18:00", "endTime": "20:00", "teardownTime": "20:30",
    "venueKind": "tcc", "venueChoice1": "TCC 350", "catererType": "Outside Caterer", "catererName": "City Tacos", "menu": "Tacos",
    "foodValue": "300", "timeFlexMinutes": "60",
}
FOOD_DONE = {"food": {"checks": {"picked": True, "quote": True}, "data": {}}}


@pytest.fixture(autouse=True)
def temp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    monkeypatch.setattr(store, "STATE_PATH", tmp_path / "event_pipeline.json")
    monkeypatch.setenv("BOOKING_STORE", "json")  # never touch a real Supabase project from tests
    store.reset()


@pytest.fixture
def busy(monkeypatch):
    """Control the seeded calendar: busy[venue_id] = [(start, end), ...] on every day."""
    blocks: dict[str, list[tuple[time, time]]] = {}
    monkeypatch.setattr(inventory, "seeded_busy", lambda vid, day: blocks.get(vid, []))
    return blocks


def key() -> str:
    return f"test-{uuid.uuid4()}"


def seed(progress=None, **overrides):
    with store._lock:
        store.save({"profile": {**PROFILE, **overrides}, "progress": progress or {}, "log": []})


def submitted(**overrides):
    seed(**overrides)
    r = service.prepare("venue_booking", now=NOW)
    assert r["state"] == "READY_FOR_SUBMISSION", r["missing"] + r["blockers"]
    return service.view(service.submit(r["id"], r["summary_hash"], key(), now=NOW), NOW)


def accepted(**overrides):
    v = submitted(**overrides)
    p = v["active_proposal"]
    return service.view(service.accept_proposal(v["id"], p["proposal_id"], p["proposal_version"], key(), now=NOW), NOW, for_reviewer=True)


def venue_progress():
    return store.load()["progress"].get("venue", {})


# ---- negotiation ---------------------------------------------------------------------------------
def test_exact_match_goes_to_review_then_confirms_only_after_approval_and_reference(busy):
    v = submitted()
    assert v["state"] == "NEGOTIATING" and v["authority"]["id"] == "tes"
    assert v["active_proposal"]["venue_name"] == "TCC 350" and v["active_proposal"]["differences"] == []
    assert [m["type"] for m in v["messages"]] == ["BOOKING_REQUEST", "AVAILABILITY_QUERY", "AVAILABILITY_RESULT", "OFFER", "BOOKING_STATUS"]
    assert v["availability"]["inventory_version"] == inventory.INVENTORY_VERSION and v["availability"]["checked_at"]
    assert venue_progress()["checks"] == {"submitted": True, "confirmed": False}
    assert plan.derive_state(store.load(), NOW.date())["byId"]["venue"]["status"] == "waiting"

    p = v["active_proposal"]
    r = service.view(service.accept_proposal(v["id"], p["proposal_id"], p["proposal_version"], "accept-1", now=NOW), NOW, for_reviewer=True)
    assert r["state"] == "PENDING_HUMAN_REVIEW" and r["review"]["status"] == "pending"
    assert r["review"]["packet"]["checks"]["availability"] and "Food will be served by City Tacos." in r["review"]["packet"]["attention"]

    r = service.view(service.decide(r["review"]["task_id"], "rev-tes", "APPROVE", "", None, "decide-1", now=NOW), NOW)
    assert r["state"] == "APPROVED" and not venue_progress()["checks"]["confirmed"]  # approved is not confirmed

    r = service.view(service.confirm(r["review"]["task_id"], "rev-tes", "482913", "confirm-1", now=NOW), NOW)
    assert r["state"] == "CONFIRMED" and r["confirmation"]["reference"] == "482913"
    assert venue_progress() == {"checks": {"submitted": True, "confirmed": True},
                                "data": {"reservationNumber": "482913", "venueContactName": "TES reviewer (demo)",
                                         "venueContactEmail": "rev-tes@reviewers.demo.invalid"}}
    assert plan.derive_state(store.load(), NOW.date())["byId"]["venue"]["status"] == "done"
    for entry in r["timeline"]:
        assert entry["at"] and entry["actor"] and entry["role"] and entry["correlation_id"] == r["timeline"][0]["correlation_id"]
    roles = {e["to_state"]: e["role"] for e in r["timeline"] if e["action"] == "state_change"}
    assert roles["SUBMITTED"] == "club_rep" and roles["PROPOSAL_ACCEPTED"] == "club_rep"
    assert roles["APPROVED"] == "reviewer" and roles["CONFIRMED"] == "backend"


def test_venue_suggests_best_fit_then_club_counters_for_its_first_choice(busy):
    busy["tcc-350"] = [(time(16), time(18))]  # first choice taken at 5:30 PM setup, free from 6:00 PM
    v = submitted()
    assert [m["type"] for m in v["messages"]][3:] == ["DECLINE_PROPOSAL", "OFFER", "COUNTEROFFER", "OFFER", "BOOKING_STATUS"]
    assert [(p["venue_name"], p["status"]) for p in v["proposals"]] == [("TCC 351", "superseded"), ("TCC 350", "active")]
    assert v["active_proposal"]["differences"] == ["Time: 6:30 PM–8:30 PM, 30 min later"]
    assert v["rounds"] == 2

    v = service.view(service.request_alternatives(v["id"], "later is hard for us", "alt-1", now=NOW), NOW)
    offered = [(p["venue_name"], p["shift"], p["status"]) for p in v["proposals"]]
    assert offered[1] == ("TCC 350", 30, "declined")
    assert v["active_proposal"]["venue_name"] == "TCC 350" and v["active_proposal"]["shift"] == 60
    assert len({(p["venue_id"], p["shift"]) for p in v["proposals"]}) == len(v["proposals"])  # never the same offer twice
    assert v["rounds"] <= negotiation.MAX_ROUNDS


def test_round_limit_stops_alternatives(busy):
    v = submitted()
    for i in range(negotiation.MAX_ROUNDS):
        try:
            v = service.view(service.request_alternatives(v["id"], "", f"alt-{i}", now=NOW), NOW)
        except service.BookingError as e:
            assert e.code == "ROUND_LIMIT"
            break
    assert v["rounds"] == negotiation.MAX_ROUNDS and not v["can"]["alternatives"]
    with pytest.raises(service.BookingError) as e:
        service.request_alternatives(v["id"], "", "alt-final", now=NOW)
    assert e.value.code == "ROUND_LIMIT"


def test_constraints_never_relaxed(busy):
    # No alternates allowed, no flexibility, first choice busy: nothing to offer -> escalate, don't guess.
    busy["tcc-350"] = [(time(17), time(21))]
    v = submitted(acceptAlternate=False, timeFlexMinutes="0")
    assert v["state"] == "FAILED_REQUIRES_HUMAN" and v["escalation"]["code"] == "NO_FEASIBLE_OPTIONS"
    assert venue_progress()["checks"]["submitted"] is False
    # Capacity and equipment: a 40-person event needing a stage is only offered rooms that fit both.
    store.reset()
    v = submitted(attendance="40", equipment=["Stage"], venueChoice1="TCC 227")
    assert v["active_proposal"]["capacity"] >= 40 and "Stage" in v["active_proposal"]["included_features"]
    assert all(p["capacity"] >= 40 for p in v["proposals"])


@pytest.mark.parametrize("overrides,code", [
    ({"venueKind": "outdoor", "venueChoice1": "McCarthy Quad", "eventType": "Meeting", "date": "2026-12-01"}, "POLICY_CONFLICT"),
    ({"venueKind": "eeb_phe", "venueChoice1": "EEB 248"}, "POLICY_CONFLICT"),  # more than 1 month out
    ({"venueChoice1": "TCC 999", "acceptAlternate": False}, "VENUE_NOT_IN_INVENTORY"),
])
def test_policy_and_inventory_problems_escalate(busy, overrides, code):
    v = submitted(**overrides)
    assert v["state"] == "FAILED_REQUIRES_HUMAN" and v["escalation"]["code"] == code
    assert v["messages"][-1]["type"] == "ERROR" and v["can"]["prepare"]


def test_classroom_weekday_start_rule_shifts_or_escalates(busy):
    # Thursday 5:00 PM start breaks "Mon–Thu start at 6:00 PM or later"; 60 min flexibility lets the agent move it.
    v = submitted(venueKind="classroom", venueChoice1="THH 102", startTime="17:00", endTime="19:00", setupTime="17:00", teardownTime="19:00")
    assert v["active_proposal"]["time"]["start"].startswith("2027-03-04T18:00")
    store.reset()
    v = submitted(venueKind="classroom", venueChoice1="THH 102", startTime="16:00", endTime="18:00", setupTime="16:00", teardownTime="18:00")
    assert v["state"] == "FAILED_REQUIRES_HUMAN" and v["escalation"]["code"] == "NO_FEASIBLE_OPTIONS"


# ---- club-rep actions ----------------------------------------------------------------------------
def test_summary_must_match_what_the_rep_saw(busy):
    seed()
    r = service.prepare("venue_booking", now=NOW)
    store.update(lambda s: s["profile"].update(attendance="45"))
    with pytest.raises(service.BookingError) as e:
        service.submit(r["id"], r["summary_hash"], "submit-x", now=NOW)
    assert e.value.code == "SUMMARY_CHANGED"
    with pytest.raises(service.BookingError) as e:
        service.submit(r["id"], "0000000000000000", "submit-y", now=NOW)
    assert e.value.code == "SUMMARY_CHANGED"


def test_missing_fields_keep_it_a_draft(busy):
    seed(phone="12")
    r = service.prepare("venue_booking", now=NOW)
    assert r["state"] == "NEEDS_INFORMATION" and [m["key"] for m in r["missing"]] == ["phone"]
    with pytest.raises(service.BookingError) as e:
        service.submit(r["id"], r["summary_hash"], "submit-z", now=NOW)
    assert e.value.code == "NOT_READY"


def test_idempotent_submit_and_key_reuse(busy):
    seed()
    r = service.prepare("venue_booking", now=NOW)
    a = service.submit(r["id"], r["summary_hash"], "same-key-1", now=NOW)
    b = service.submit(r["id"], r["summary_hash"], "same-key-1", now=NOW)
    assert a["id"] == b["id"] and len(b["messages"]) == len(a["messages"])
    v = service.view(b, NOW)
    with pytest.raises(service.BookingError) as e:
        service.accept_proposal(v["id"], v["active_proposal"]["proposal_id"], 1, "same-key-1", now=NOW)
    assert e.value.code == "IDEMPOTENCY_KEY_REUSED"


def test_expired_and_stale_proposals_cannot_be_accepted(busy):
    v = submitted()
    p = v["active_proposal"]
    with pytest.raises(service.BookingError) as e:
        service.accept_proposal(v["id"], p["proposal_id"], p["proposal_version"], "acc-late", now=NOW + service.PROPOSAL_TTL + timedelta(seconds=1))
    assert e.value.code == "PROPOSAL_EXPIRED"
    assert service.get(v["id"])["proposals"][0]["status"] == "expired"

    store.reset()
    v = submitted()
    p = v["active_proposal"]
    busy["tcc-350"] = [(time(18), time(19))]  # someone else booked it in the meantime
    with pytest.raises(service.BookingError) as e:
        service.accept_proposal(v["id"], p["proposal_id"], p["proposal_version"], "acc-stale", now=NOW)
    assert e.value.code == "PROPOSAL_STALE" and service.get(v["id"])["state"] == "NEGOTIATING"
    with pytest.raises(service.BookingError) as e:
        service.accept_proposal(v["id"], p["proposal_id"], 99, "acc-ver", now=NOW)
    assert e.value.code in ("STALE_VERSION", "PROPOSAL_NOT_ACTIVE")


def test_held_slot_is_never_offered_to_another_request(busy):
    accepted()  # TCC 350 6:00 PM held, pending review
    store.update(lambda s: s.pop("event_id"))  # a different event, same slot
    seed()
    v = submitted()
    assert v["active_proposal"]["venue_name"] != "TCC 350" or v["active_proposal"]["shift"] != 0


def test_cancel_paths(busy):
    v = submitted()
    v = service.view(service.cancel(v["id"], "", "cancel-1", now=NOW), NOW)
    assert v["state"] == "CANCELLED" and v["proposals"][0]["status"] == "withdrawn"

    r = accepted()
    r = service.view(service.decide(r["review"]["task_id"], "rev-tes", "APPROVE", "", "123456", "dec-c", now=NOW), NOW, for_reviewer=True)
    assert r["state"] == "CONFIRMED"
    r = service.view(service.cancel(r["id"], "date moved", "cancel-2", now=NOW), NOW, for_reviewer=True)
    assert r["state"] == "CANCEL_REQUESTED" and not venue_progress()["checks"]["confirmed"]
    r = service.view(service.decide(r["review"]["task_id"], "rev-tes", "CONFIRM_CANCELLATION", "", None, "dec-c2", now=NOW), NOW)
    assert r["state"] == "CANCELLED" and venue_progress()["checks"]["submitted"] is False


def test_clearing_the_event_withdraws_open_requests(busy):
    r = accepted()
    client = TestClient(main.app)
    assert client.post("/api/v1/pipeline/reset", headers=HEADERS).status_code == 200
    assert service.get(r["id"])["state"] == "CANCEL_REQUESTED"  # held: the reviewer releases it
    assert service.list_for_event() == []  # the new event starts clean


# ---- human review --------------------------------------------------------------------------------
def test_only_an_assigned_reviewer_can_decide(busy):
    r = accepted()
    task = r["review"]["task_id"]
    for who in ("rep-usg", "rev-classroom"):
        with pytest.raises(service.BookingError) as e:
            service.decide(task, who, "APPROVE", "", "482913", f"dec-{who}", now=NOW)
        assert e.value.code == "PERMISSION_DENIED"
    with pytest.raises(service.BookingError) as e:
        service.decide(task, None, "APPROVE", "", None, "dec-anon", now=NOW)
    assert e.value.code == "UNAUTHENTICATED"
    with pytest.raises(service.BookingError) as e:
        service.decide(task, "rev-tes", "REJECT", "  ", None, "dec-noreason", now=NOW)
    assert e.value.code == "REASON_REQUIRED"
    with pytest.raises(service.BookingError) as e:
        service.decide(task, "rev-tes", "APPROVE", "", "12", "dec-badref", now=NOW)
    assert e.value.code == "INVALID_REFERENCE" and service.get(r["id"])["state"] == "PENDING_HUMAN_REVIEW"
    denied = [e for e in service.get(r["id"])["timeline"] if e["action"] == "decision_denied"]
    assert {d["actor"] for d in denied} == {"reviewer:rep-usg", "reviewer:rev-classroom"}
    assert service.review_queue("rep-usg") == [] and service.review_queue("rev-classroom") == []
    assert [q["id"] for q in service.review_queue("rev-tes")] == [r["id"]]


def test_changes_requested_then_resubmitted(busy):
    r = accepted()
    r = service.view(service.decide(r["review"]["task_id"], "rev-tes", "REQUEST_CHANGES", "Need 40 seats", None, "dec-ch", now=NOW), NOW)
    assert r["state"] == "CHANGES_REQUESTED" and "Need 40 seats" in r["next_action"]
    store.update(lambda s: s["profile"].update(attendance="40"))
    d = service.prepare("venue_booking", now=NOW)
    assert d["id"] == r["id"] and d["state"] == "READY_FOR_SUBMISSION"
    v = service.view(service.submit(d["id"], d["summary_hash"], "resubmit-1", now=NOW), NOW)
    assert v["state"] == "NEGOTIATING" and v["accepted_proposal"] is None


def test_state_machine_refuses_model_and_wrong_roles():
    req = {"kind": "venue_booking", "state": "APPROVED", "version": 1, "timeline": [], "correlation_id": "c"}
    for role in ("club_agent", "club_rep", "reviewer"):
        with pytest.raises(states.TransitionError) as e:
            states.transition(req, "CONFIRMED", actor="x", role=role, reason="", now=NOW)
        assert e.value.code == "PERMISSION_DENIED"
    req["state"] = "READY_FOR_SUBMISSION"
    with pytest.raises(states.TransitionError):
        states.transition(req, "SUBMITTED", actor="club_agent:assistant", role="club_agent", reason="", now=NOW)
    with pytest.raises(states.TransitionError) as e:
        states.transition(req, "CONFIRMED", actor="backend", role="backend", reason="", now=NOW)
    assert e.value.code == "INVALID_TRANSITION"
    req.update(kind="event_permit", state="ROUTING")
    with pytest.raises(states.TransitionError):
        states.transition(req, "NEGOTIATING", actor="backend", role="backend", reason="", now=NOW)


def test_agent_tools_cannot_submit_accept_approve_or_confirm(busy):
    names = {t.name for t in tools.TOOLS}
    assert not names & {"submit_booking", "accept_proposal", "record_human_decision", "confirm_booking", "start_prefill"}
    seed()
    ctx = tools.ToolContext()
    r = tools.execute(ctx, "prepare_booking_request", {"kind": "venue_booking"})
    assert r["ok"] and r["data"]["state"] == "READY_FOR_SUBMISSION" and ctx.actions == [{"type": "booking", "kind": "venue_booking"}]
    assert service.latest_view("venue_booking")["timeline"][-1]["role"] == "club_agent"
    assert tools.execute(ctx, "record_step_progress", {"step": "venue", "check": "confirmed", "done": True})["error"]["code"] == "workflow_owned"
    assert tools.execute(ctx, "record_step_progress", {"step": "permit", "data_key": "permitCode", "data_value": "X"})["error"]["code"] == "workflow_owned"
    avail = tools.execute(ctx, "check_venue_availability", {})
    assert avail["ok"] and "Simulated" in avail["data"]["source"] and avail["data"]["options"][0]["venue"] == "TCC 350"
    assert service.latest_view("venue_booking")["state"] == "READY_FOR_SUBMISSION"  # still not submitted


def test_agent_can_ask_for_alternatives_within_constraints(busy):
    v = submitted()
    ctx = tools.ToolContext()
    r = tools.execute(ctx, "request_alternatives", {"kind": "venue_booking", "reason": "a bigger room"})
    # The club prefers its first-choice room at a shifted time over a different room at the same time.
    assert r["ok"] and r["data"]["active_proposal"]["differences_from_request"] == ["Time: 6:30 PM–8:30 PM, 30 min later"]
    st = tools.execute(ctx, "get_booking_status", {"kind": "venue_booking"})
    assert st["data"]["state"] == "NEGOTIATING" and st["data"]["active_proposal"]["differences_from_request"]
    assert v["id"] == service.latest_view("venue_booking")["id"]


# ---- event permit --------------------------------------------------------------------------------
def test_permit_waits_for_the_venue_then_goes_to_the_permits_reviewer(busy):
    seed(FOOD_DONE)
    d = service.prepare("event_permit", now=NOW)
    assert d["state"] == "NEEDS_INFORMATION" and d["blockers"] == ["The venue booking must be confirmed by the venue reviewer first."]

    r = accepted()
    service.decide(r["review"]["task_id"], "rev-tes", "APPROVE", "", "482913", "dec-v", now=NOW)
    store.update(lambda s: (s["profile"].update(catererName="Joe's Pizza"), s["progress"].update(FOOD_DONE)))
    d = service.prepare("event_permit", now=NOW)
    assert d["state"] == "READY_FOR_SUBMISSION" and d["payload"]["venue_booking"]["confirmation_reference"] == "482913"
    assert "1234567890" not in str(d) and d["payload"]["requester"]["usc_id_on_file"] is True
    p = service.view(service.submit(d["id"], d["summary_hash"], "permit-1", now=NOW), NOW, for_reviewer=True)
    assert p["state"] == "PENDING_HUMAN_REVIEW" and p["authority"]["id"] == "event_permits"
    assert any("not in the permit's approved-caterer lookup" in a for a in p["review"]["packet"]["attention"])
    with pytest.raises(service.BookingError):
        service.decide(p["review"]["task_id"], "rev-tes", "APPROVE", "", "EP-1", "permit-dec-wrong", now=NOW)
    service.decide(p["review"]["task_id"], "rev-permits", "APPROVE", "ok", "EP-2027-0042", "permit-dec", now=NOW)
    prog = store.load()["progress"]["permit"]
    assert prog["checks"]["approved"] and prog["data"]["permitCode"] == "EP-2027-0042"
    assert plan.derive_state(store.load(), NOW.date())["byId"]["permit"]["status"] == "done"


def test_permit_waits_for_the_food_step(busy):
    r = accepted()
    service.decide(r["review"]["task_id"], "rev-tes", "APPROVE", "", "482913", "dec-v2", now=NOW)
    d = service.prepare("event_permit", now=NOW)
    assert d["blockers"] == ["Finish first: Pick an approved food vendor"]


# ---- contract ------------------------------------------------------------------------------------
def test_envelope_rejects_unknown_types_and_fields():
    base = {
        "message_id": "m", "conversation_id": "c", "correlation_id": "c", "causation_id": None, "workflow_type": "venue_booking",
        "workflow_id": "w", "sender": {"agent_id": "club_agent:x", "agent_type": "club", "owner_id": "x"},
        "recipient": {"agent_id": "venue_agent:tes", "agent_type": "venue", "owner_id": "tes"}, "created_at": NOW.isoformat(),
        "expires_at": None, "idempotency_key": "k", "payload": {"note": "hi"}, "trace": {}}
    schemas.AgentMessage(**base, message_type="AVAILABILITY_QUERY")
    with pytest.raises(ValidationError):
        schemas.AgentMessage(**base, message_type="APPROVE_BOOKING")
    with pytest.raises(ValidationError):
        schemas.AgentMessage(**base, message_type="AVAILABILITY_RESULT")  # time-sensitive: needs expires_at
    with pytest.raises(ValidationError):
        schemas.AgentMessage(**base, message_type="OFFER")  # an offer must carry a proposal
    with pytest.raises(ValidationError):
        schemas.AgentMessage(**{**base, "extra": 1}, message_type="AVAILABILITY_QUERY")


# ---- HTTP ----------------------------------------------------------------------------------------
def test_http_flow_and_error_shape(busy):
    seed()
    c = TestClient(main.app)
    assert c.get("/api/v1/bookings").status_code == 403
    d = c.post("/api/v1/bookings/drafts", json={"kind": "venue_booking"}, headers=HEADERS).json()
    assert d["state"] == "READY_FOR_SUBMISSION" and d["simulated"] and d["can"]["submit"]
    r = c.post(f"/api/v1/bookings/{d['id']}/submit", json={"summary_hash": d["summary_hash"], "idempotency_key": "http-key-1"}, headers=HEADERS)
    assert r.status_code == 422  # user_confirmed_summary is required
    v = c.post(f"/api/v1/bookings/{d['id']}/submit", json={"summary_hash": d["summary_hash"], "user_confirmed_summary": True,
                                                           "idempotency_key": "http-key-1"}, headers=HEADERS).json()
    p = v["active_proposal"]
    a = c.post(f"/api/v1/bookings/{v['id']}/proposals/{p['proposal_id']}/accept",
               json={"proposal_version": p["proposal_version"], "user_confirmed": True, "idempotency_key": "http-key-2"}, headers=HEADERS).json()
    assert a["state"] == "PENDING_HUMAN_REVIEW" and a["review"] and "packet" not in a["review"]  # packet is reviewer-only

    q = c.get("/api/v1/venue-review/queue", headers={**HEADERS, "X-TrojanConnect-Reviewer": "rev-tes"}).json()
    assert [x["id"] for x in q] == [v["id"]] and q[0]["review"]["packet"]
    task = q[0]["review"]["task_id"]
    denied = c.post(f"/api/v1/reviews/{task}/decision", json={"decision": "APPROVE", "idempotency_key": "http-key-3"},
                    headers={**HEADERS, "X-TrojanConnect-Reviewer": "rep-usg"})
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "PERMISSION_DENIED"
    ok_ = c.post(f"/api/v1/reviews/{task}/decision", json={"decision": "APPROVE", "external_confirmation_reference": "482913",
                                                          "idempotency_key": "http-key-4"}, headers={**HEADERS, "X-TrojanConnect-Reviewer": "rev-tes"})
    assert ok_.json()["state"] == "CONFIRMED"
    assert c.put("/api/v1/pipeline/progress", json={"step": "venue", "check": "confirmed", "value": False}, headers=HEADERS).status_code == 409
    assert c.put("/api/v1/pipeline/progress", json={"step": "permit", "check": "followups", "value": True}, headers=HEADERS).status_code == 200
    status = c.get("/api/v1/pipeline/status", headers=HEADERS).json()
    venue = next(s for s in status["steps"] if s["id"] == "venue")
    assert venue["status"] == "done" and venue["forms"][0]["agent"] and venue["forms"][0]["booking"]["state"] == "CONFIRMED"
    assert len(c.get("/api/v1/venue-review/reviewers", headers=HEADERS).json()) == len(inventory.REVIEWERS)


# ---- storage and venue adapter -------------------------------------------------------------------
class FakeSupabase:
    """Just enough of the supabase-py query builder for booking/store.py."""

    def __init__(self):
        self.tables: dict[str, dict[str, dict]] = {"booking_requests": {}, "booking_idempotency": {}}
        self.upserts = 0

    def table(self, name):
        fake, key = self, ("key" if name == "booking_idempotency" else "id")

        class Q:
            def __init__(self):
                self._rows = None

            def select(self, *_a, **_k):
                self._rows = list(fake.tables[name].values())
                return self

            def limit(self, _n):
                return self

            def upsert(self, rows):
                fake.upserts += 1
                for r in rows:
                    fake.tables[name][r[key]] = r
                return self

            def execute(self):
                return type("R", (), {"data": self._rows or []})()
        return Q()


def test_bookings_persist_to_supabase_when_configured(busy, monkeypatch):
    from app.workflows.booking import store as db_store
    fake = FakeSupabase()
    monkeypatch.setenv("BOOKING_STORE", "supabase")
    monkeypatch.setattr(db_store, "_configured", lambda: True)
    monkeypatch.setattr(db_store, "_supabase_client", lambda: fake)
    v = submitted()
    row = fake.tables["booking_requests"][v["id"]]
    assert row["state"] == "NEGOTIATING" and row["authority_id"] == "tes" and row["doc"]["proposals"]
    assert any(k["request_id"] == v["id"] for k in fake.tables["booking_idempotency"].values())
    before = fake.upserts
    service.list_for_event()  # reads don't write
    assert fake.upserts == before
    assert service.get(v["id"])["state"] == "NEGOTIATING"  # read back from the "database"
    assert db_store.status()["store"] == "supabase"


def test_missing_supabase_table_falls_back_to_json(monkeypatch):
    from app.workflows.booking import store as db_store

    class Broken:
        def table(self, _n):
            raise RuntimeError("Could not find the table 'public.booking_requests'")
    monkeypatch.setenv("BOOKING_STORE", "auto")
    monkeypatch.setattr(db_store, "_configured", lambda: True)
    monkeypatch.setattr(db_store, "_supabase_client", lambda: Broken())
    db_store.reset_backend_cache()
    try:
        st = db_store.status()
        assert st["store"] == "json" and "0004_venue_booking.sql" in st["detail"]
    finally:
        db_store.reset_backend_cache()


def test_venue_adapter_places_the_booking_or_leaves_it_approved(busy, monkeypatch):
    from app.workflows.booking import adapters

    class Pending(adapters.SimulatedVenueAdapter):
        name, integration_mode = "admin_agent_test", "live"

        def place_booking(self, request, reference):
            return {"status": "pending", "note": "Form filled; waiting for a person to press Submit"}
    adapters.register("admin_agent_test", Pending)
    monkeypatch.setenv("BOOKING_ADAPTER", "admin_agent_test")
    r = accepted()
    r = service.view(service.decide(r["review"]["task_id"], "rev-tes", "APPROVE", "", "482913", key(), now=NOW), NOW)
    assert r["state"] == "APPROVED" and r["external_booking"]["status"] == "pending"  # not confirmed until placed
    assert r["timeline"][-1]["action"] == "external_booking_pending"

    monkeypatch.setenv("BOOKING_ADAPTER", "simulated")
    r = service.view(service.confirm(r["review"]["task_id"], "rev-tes", "482913", key(), now=NOW), NOW)
    assert r["state"] == "CONFIRMED" and r["external_booking"]["status"] == "placed"
    assert r["confirmation"]["integration_mode"] == "simulated"
