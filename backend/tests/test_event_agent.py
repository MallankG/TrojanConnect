"""Event agent: plan logic, tool guardrails, the agent loop and the chat endpoint.

No network and no real model: a scripted provider stands in for Gemini, state is written to a
temp directory, and the seeded venue calendar is emptied.
"""

from __future__ import annotations

import importlib
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient

import main
from app.agents import event_agent
from app.agents.model import ModelTurn, ToolCall
from app.tools import event_plan as tools
from app.workflows.booking import inventory
from app.workflows.event_pipeline import plan, store

router = importlib.import_module("app.workflows.event_pipeline.router")  # the package re-exports the APIRouter under this name

TODAY = date(2026, 11, 14)
HEADERS = {"X-TrojanConnect-Client": "web"}

PROFILE = {
    "attendance": "30", "audience": ["Students"], "food": True, "amplifiedSound": False, "filmed": False, "acceptAlternate": True,
    "vendorServes": True, "paymentType": "PO", "orgName": "TEST DO NOT PROCESS", "firstName": "Test", "lastName": "Only",
    "email": "test@usc.edu", "phone": "2135550100", "uscId": "1234567890", "initials": "TT", "eboardPosition": "President",
    "onsiteName": "Test Onsite", "onsitePhone": "2135550101", "eventName": "TEST DO NOT PROCESS", "description": "Dry run",
    "eventType": "Meeting", "date": "2027-03-04", "setupTime": "17:30", "startTime": "18:00", "endTime": "20:00", "teardownTime": "20:30",
    "venueKind": "tcc", "venueChoice1": "TCC 350", "catererType": "Outside Caterer", "catererName": "City Tacos", "menu": "Tacos",
    "foodValue": "300", "budgetTotal": "400", "budgetLink": "https://example.com/budget", "vpFinanceEmail": "f@example.com",
    "vpCommsEmail": "c@example.com", "advisorName": "Test Advisor", "advisorEmail": "a@example.com",
}


@pytest.fixture(autouse=True)
def temp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    monkeypatch.setattr(store, "STATE_PATH", tmp_path / "event_pipeline.json")
    monkeypatch.setattr(inventory, "seeded_busy", lambda vid, day: [])
    store.reset()


def seed(progress: dict[str, Any] | None = None, **profile_overrides: Any) -> None:
    with store._lock:
        store.save({"profile": {**PROFILE, **profile_overrides}, "progress": progress or {}, "log": []})


VENUE_AND_FOOD_DONE = {
    "venue": {"checks": {"submitted": True, "confirmed": True}, "data": {"reservationNumber": "123456"}},
    "food": {"checks": {"picked": True, "quote": True}, "data": {}},
}


class ScriptedProvider:
    """Plays back a fixed list of model turns and records what the agent sent it."""
    label = "scripted"

    def __init__(self, turns: list[ModelTurn]) -> None:
        self.turns, self.sent, self.system = list(turns), [], ""

    def start(self, system, tools_, history):
        self.system, self.history = system, history
        return self

    def send(self, *, user_text=None, tool_results=None):
        self.sent.append({"user_text": user_text, "tool_results": tool_results})
        return self.turns.pop(0)


# ---- plan logic (must match the dashboard) ---------------------------------------------------
def test_status_matches_dashboard_after_venue_and_food():
    seed(VENUE_AND_FOOD_DONE)
    d = plan.derive_state(store.load(), TODAY)
    assert {s["id"]: s["status"] for s in d["steps"]} == {
        "venue": "done", "food": "done", "permit": "ready", "funding": "ready", "engage": "blocked", "access": "ready", "publicity": "blocked"}
    assert (d["complete"], d["total"], d["daysToEvent"]) == (2, 7, 110)
    assert d["byId"]["permit"]["due"] == date(2027, 2, 18) and d["byId"]["permit"]["daysLeft"] == 96
    assert d["byId"]["engage"]["blockedBy"] == ["permit"]
    assert d["byId"]["publicity"]["blockedBy"] == ["engage", "access"]
    assert d["byId"]["permit"]["missing"] == []


def test_empty_event_lists_missing_fields_and_no_food_skips_the_step():
    d = plan.derive_state(store.load(), TODAY)
    assert d["byId"]["venue"]["forms"] == [] and d["daysToEvent"] is None
    seed(food=False)
    d = plan.derive_state(store.load(), TODAY)
    assert d["byId"]["food"]["status"] == "skipped" and d["byId"]["permit"]["after"] == ["venue"]
    assert "catererName" not in d["byId"]["permit"]["missing"]


# ---- tools -----------------------------------------------------------------------------------
def test_update_profile_validates_and_never_takes_the_usc_id():
    ctx = tools.ToolContext(today=TODAY)
    r = tools.execute(ctx, "update_event_profile", {"fields": {
        "eventName": "Fall Mixer", "date": "2027-03-04", "startTime": "18:15", "attendance": "200", "venueKind": "ballroom",
        "phone": "(213) 555-0100", "food": "no", "uscId": "1234567890", "madeUp": "x"}})
    assert r["ok"] and r["data"]["saved"] == {"eventName": "Fall Mixer", "date": "2027-03-04", "phone": "2135550100", "food": False}
    assert set(r["data"]["rejected"]) == {"startTime", "attendance", "venueKind", "uscId", "madeUp"}
    saved = store.load()["profile"]
    assert "uscId" not in saved and "madeUp" not in saved and saved["eventName"] == "Fall Mixer"
    assert {"type": "field", "key": "uscId"} in ctx.actions


def test_status_hides_the_usc_id_from_the_model():
    seed()
    summary = tools.status_summary(store.load(), TODAY)
    assert summary["profile"]["uscId"] == "<set; hidden>"
    assert "1234567890" not in str(summary)


def test_records_what_the_user_reports_and_validates_it():
    seed()
    ctx = tools.ToolContext(today=TODAY)
    assert tools.execute(ctx, "record_step_progress", {"step": "food", "check": "picked", "done": True})["ok"]
    r = tools.execute(ctx, "record_step_progress", {"step": "food", "check": "quote", "done": True})
    assert r["ok"] and r["data"]["status"] == "done"
    assert store.load()["progress"]["food"]["checks"] == {"picked": True, "quote": True}
    assert store.load()["log"][0]["msg"].startswith("assistant: ")
    # Venue and permit outcomes come only from the booking workflow.
    for args in ({"step": "venue", "check": "confirmed", "done": True}, {"step": "venue", "data_key": "reservationNumber", "data_value": "482913"}):
        assert tools.execute(ctx, "record_step_progress", args)["error"]["code"] == "workflow_owned"
    assert "venue" not in store.load()["progress"]
    assert tools.execute(ctx, "record_step_progress", {"step": "food", "check": "nope", "done": True})["error"]["code"] == "unknown_check"
    assert tools.execute(ctx, "record_step_progress", {"step": "x", "check": "submitted", "done": True})["error"]["code"] == "unknown_step"


def test_booking_tools_prepare_but_never_submit():
    seed()
    ctx = tools.ToolContext(today=TODAY)
    permit = tools.execute(ctx, "prepare_booking_request", {"kind": "event_permit"})
    assert not permit["ok"] and "venue booking must be confirmed" in permit["data"]["blockers"][0]
    seed(phone="123")
    venue = tools.execute(ctx, "prepare_booking_request", {"kind": "venue_booking"})
    assert not venue["ok"] and venue["data"]["missing_fields"] == ["Cell phone"]

    seed()
    venue = tools.execute(ctx, "prepare_booking_request", {"kind": "venue_booking"})
    assert venue["ok"] and venue["data"]["state"] == "READY_FOR_SUBMISSION" and "Confirm & send" in venue["data"]["next"]
    assert "Routed to: Trojan Event Services (TES)" in venue["data"]["summary_for_user"]
    assert {"type": "booking", "kind": "venue_booking"} in ctx.actions
    assert tools.execute(ctx, "prepare_booking_request", {"kind": "nope"})["error"]["code"] == "invalid_arguments"
    assert tools.status_summary(store.load(), TODAY)["bookings"]["venue_booking"]["state"] == "READY_FOR_SUBMISSION"


def test_reset_is_only_offered_never_done():
    seed()
    ctx = tools.ToolContext(today=TODAY)
    assert tools.execute(ctx, "offer_reset", {})["ok"] and ctx.actions == [{"type": "reset"}]
    assert store.load()["profile"]["eventName"] == "TEST DO NOT PROCESS"


def test_emails_caterers_and_availability_guards():
    seed(vpFinanceEmail="")
    ctx = tools.ToolContext(today=TODAY)
    assert tools.execute(ctx, "draft_email", {"form_id": "budgetEmail"})["error"]["code"] == "not_ready"
    ok_ = tools.execute(ctx, "draft_email", {"form_id": "accessEmail"})
    assert ok_["ok"] and ok_["data"]["to"] == "c@example.com"
    assert not tools.execute(ctx, "draft_email", {"form_id": "permit"})["ok"]

    assert tools.execute(ctx, "check_caterer", {"name": "city tacos"})["data"]["accepted_by_permit_lookup"]
    assert not tools.execute(ctx, "check_caterer", {"name": "Joe's Pizza"})["data"]["accepted_by_permit_lookup"]
    seed(date="")
    assert tools.execute(ctx, "check_venue_availability", {})["error"]["code"] == "not_ready"
    seed()
    assert tools.execute(ctx, "check_venue_availability", {})["data"]["options_total"] > 0
    assert len(tools.execute(ctx, "get_form_details", {"form_id": "vendorList"})["data"]["caterers_accepted_by_permit_lookup"]) == 20
    assert tools.execute(ctx, "nope", {})["error"]["code"] == "unknown_tool"
    assert tools.execute(ctx, "check_caterer", {"bogus": 1})["error"]["code"] == "invalid_arguments"


# ---- agent loop ------------------------------------------------------------------------------
def test_agent_runs_tools_and_returns_cards():
    seed()
    provider = ScriptedProvider([
        ModelTurn(tool_calls=[ToolCall("update_event_profile", {"fields": {"attendance": "40"}}),
                              ToolCall("prepare_booking_request", {"kind": "venue_booking"})]),
        ModelTurn(text="Saved 40 people. Check the summary below and press Confirm & send."),
    ])
    out = event_agent.run_turn(provider, "Make it 40 people and start the room request", [{"role": "user", "text": "hi"}], today=TODAY)
    assert out["reply"].startswith("Saved 40")
    assert out["actions"] == [{"type": "booking", "kind": "venue_booking"}]
    assert [t["tool"] for t in out["tools"]] == ["update_event_profile", "prepare_booking_request"] and all(t["ok"] for t in out["tools"])
    assert out["state"]["profile"]["attendance"] == "40"
    results = provider.sent[1]["tool_results"]
    assert results[0][1]["data"]["saved"] == {"attendance": "40"}
    assert "1234567890" not in provider.system and '"do_now"' in provider.system and "Parking requests" in provider.system


def test_agent_stops_after_the_tool_round_limit():
    looping = [ModelTurn(tool_calls=[ToolCall("get_event_plan_status", {})]) for _ in range(event_agent.MAX_TOOL_ROUNDS + 1)]
    out = event_agent.run_turn(ScriptedProvider(looping), "loop", today=TODAY)
    assert len(out["tools"]) == event_agent.MAX_TOOL_ROUNDS and "couldn't finish" in out["reply"]


# ---- endpoint --------------------------------------------------------------------------------
def test_chat_endpoint(monkeypatch):
    client = TestClient(main.app)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert client.post("/api/v1/pipeline/agent/chat", json={"message": "hi"}).status_code == 403
    assert client.get("/api/v1/pipeline/agent", headers=HEADERS).json()["mode"] == "rules"
    r = client.post("/api/v1/pipeline/agent/chat", json={"message": "hi"}, headers=HEADERS)
    assert r.status_code == 200 and r.json()["model"] == "rules" and "Book a 35 person event" in r.json()["reply"]

    main.app.dependency_overrides[router.get_model_provider] = lambda: ScriptedProvider([ModelTurn(text="Hello.")])
    try:
        r = client.post("/api/v1/pipeline/agent/chat", json={"message": "hi", "history": [{"role": "assistant", "text": "x"}]}, headers=HEADERS)
        assert r.status_code == 200 and r.json()["reply"] == "Hello." and r.json()["actions"] == []
        assert client.post("/api/v1/pipeline/agent/chat", json={"message": "hi", "extra": 1}, headers=HEADERS).status_code == 422
    finally:
        main.app.dependency_overrides.clear()


# ---- UI read endpoints -----------------------------------------------------------------------
def test_ui_endpoints_expose_everything_a_client_needs():
    seed(VENUE_AND_FOOD_DONE)
    client = TestClient(main.app)
    get = lambda path: client.get(f"/api/v1/pipeline{path}", headers=HEADERS)  # noqa: E731
    assert client.get("/api/v1/pipeline/status").status_code == 403

    schema = get("/schema").json()
    assert len(schema["fields"]) == len(plan.FIELDS) and schema["field_groups"][0] == "Organization"
    usc_id = next(f for f in schema["fields"] if f["key"] == "uscId")
    assert usc_id["private"] and usc_id["group"] == "You (requester)"
    assert [v["id"] for v in schema["venue_kinds"]] == list(plan.VENUE_KINDS) and len(schema["approved_caterers"]) == 20
    assert [s["id"] for s in schema["steps"]] == list(plan.STEP_IDS)

    status = get("/status").json()
    assert (status["steps_done"], status["steps_total"], status["percent_done"]) == (2, 7, 29)
    assert status["do_now"] == ["permit", "funding", "access"] and status["event"]["start"] == "6:00 PM"
    permit = next(s for s in status["steps"] if s["id"] == "permit")
    assert permit["status_label"] == "Ready to start" and permit["deadline"] == "2027-02-18" and permit["deadline_official"]
    assert permit["forms"][0]["ready"] and permit["forms"][0]["agent"] and permit["forms"][0]["booking"] is None
    engage = next(s for s in status["steps"] if s["id"] == "engage")
    assert engage["blocked_by"] == [{"id": "permit", "title": "Event permit application"}]
    assert not engage["forms"][0]["ready"] and "Finish first" in engage["forms"][0]["not_ready_reasons"][0]

    assert len(get("/forms").json()) == len(plan.FORMS)
    outdoor = get("/forms/outdoor").json()
    assert not outdoor["ready"] and outdoor["step"] is None
    assert get("/forms/nope").status_code == 404

    email = get("/emails/budgetEmail").json()
    assert email["ready"] and email["to"] == "f@example.com" and email["mailto"].startswith("mailto:f%40example.com?subject=Funding")
    assert "Total requested: $400" in email["body"] and "6:00 PM–8:00 PM at TCC 350" in email["body"]
    assert get("/emails/permit").status_code == 404

    profile = get("/profile").json()
    by_key = {f["key"]: f for f in profile["fields"]}
    assert by_key["phone"]["problem"] is None and "permit" in by_key["uscId"]["used_by_forms"]
    assert by_key["venueChoice2"]["problem"] is None  # optional and empty is fine
    assert get("/caterers?q=tacos").json()["matches"] == ["City Tacos"] and len(get("/caterers").json()["matches"]) == 20
    assert get("/activity?limit=1").json() == [] and get("/activity?limit=0").status_code == 422
    assert [t["name"] for t in get("/agent").json()["tools"]][0] == "get_event_plan_status"
    assert "/api/v1/pipeline/status" in client.get("/openapi.json").json()["paths"]


# ---- rule-based Club Agent (no model) ---------------------------------------------------------
class FailingProvider:
    label = "failing"

    def start(self, *a, **k):
        return self

    def send(self, **k):
        from app.agents.model import ModelError
        raise ModelError("Gemini's rate limit for this API key was reached.")


def test_rules_agent_follows_the_booking_workflow(monkeypatch):
    from app.agents import rules_agent
    from app.workflows.booking import service
    seed()
    out = rules_agent.run_turn("Book my venue", today=TODAY)
    assert "Confirm & send" in out["reply"] and out["actions"] == [{"type": "booking", "kind": "venue_booking"}]
    v = service.latest_view("venue_booking")
    assert v["state"] == "READY_FOR_SUBMISSION"  # prepared, not submitted
    service.submit(v["id"], v["summary_hash"], "rules-submit-1")
    out = rules_agent.run_turn("where is my booking?", today=TODAY)
    assert "Proposal ready for you" in out["reply"] and "TCC 350" in out["reply"]
    out = rules_agent.run_turn("can I get another option?", today=TODAY)
    assert "another option" in out["reply"] and out["tools"][0]["tool"] == "request_alternatives"
    assert "Which rooms" not in rules_agent.run_turn("which rooms are free?", today=TODAY)["reply"]
    out = rules_agent.run_turn("apply for the permit", today=TODAY)
    assert "venue booking must be confirmed" in out["reply"]
    assert "Do now" in rules_agent.run_turn("what should I do next?", today=TODAY)["reply"]


def test_chat_falls_back_to_rules_when_gemini_fails(monkeypatch):
    seed()
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    monkeypatch.delenv("ASSISTANT_MODE", raising=False)
    main.app.dependency_overrides[router.get_model_provider] = lambda: FailingProvider()
    try:
        r = TestClient(main.app).post("/api/v1/pipeline/agent/chat", json={"message": "book my venue"}, headers=HEADERS)
        assert r.status_code == 200 and r.json()["model"] == "rules" and "Gemini unavailable" in r.json()["reply"]
        assert r.json()["actions"] == [{"type": "booking", "kind": "venue_booking"}]
    finally:
        main.app.dependency_overrides.clear()


def test_rules_agent_books_from_one_sentence_and_walks_the_waterfall(monkeypatch):
    from app.agents import rules_agent
    from app.workflows.booking import service
    monkeypatch.setenv("DEMO_AUTO_REVIEW", "true")
    blank = {k: v for k, v in PROFILE.items() if k not in ("date", "startTime", "endTime", "attendance", "venueKind", "venueChoice1",
                                                          "setupTime", "teardownTime", "menu", "foodValue", "catererName")}
    with store._lock:
        store.save({"profile": blank, "progress": {}, "log": []})

    out = rules_agent.run_turn("Book a 35 person event for decemeber 20th 2026 from 7pm - 8pm", today=TODAY)
    p = store.load()["profile"]
    assert (p["attendance"], p["date"], p["startTime"], p["endTime"]) == ("35", "2026-12-20", "19:00", "20:00")
    options = next(a for a in out["actions"] if a["type"] == "options")["options"]
    assert options and all("7:00 PM–8:00 PM" in o["label"] for o in options)
    assert "42 days' notice" in out["reply"]  # outdoor is ruled out, not offered
    tcc = next(o for o in options if o["label"].startswith("TCC 350"))

    out = rules_agent.run_turn(tcc["message"], today=TODAY)
    assert store.load()["profile"]["venueChoice1"] == "TCC 350" and store.load()["profile"]["venueKind"] == "tcc"
    assert "Confirm & send" in out["reply"] and {"type": "booking", "kind": "venue_booking"} in out["actions"]
    v = service.latest_view("venue_booking")
    assert v["state"] == "READY_FOR_SUBMISSION"  # the agent never submits
    v = service.view(service.submit(v["id"], v["summary_hash"], "rules-sentence-1"))
    pr = v["active_proposal"]
    r = service.view(service.accept_proposal(v["id"], pr["proposal_id"], pr["proposal_version"], "rules-sentence-2"))
    assert r["state"] == "CONFIRMED" and r["review"]["decisions"][0]["reviewer_id"] == "sim-tes"  # simulated office, labelled
    assert len(r["confirmation"]["reference"]) == 6

    out = rules_agent.run_turn("where is my booking?", today=TODAY)
    assert "Confirmed" in out["reply"] and any(a["type"] == "suggestions" for a in out["actions"])
    out = rules_agent.run_turn("Use caterer City Tacos", today=TODAY)
    assert store.load()["progress"]["food"]["checks"]["picked"]
    fields = next(a for a in out["actions"] if a["type"] == "fields")
    assert set(fields["keys"]) == {"menu", "foodValue"} and fields["then"] == "I have the quote"
    store.update(lambda s: s["profile"].update(menu="Tacos", foodValue="300"))
    assert "Food step done" in rules_agent.run_turn("I have the quote", today=TODAY)["reply"]
    out = rules_agent.run_turn("Apply for the permit", today=TODAY)
    assert "Confirm & send" in out["reply"]  # uscId etc. are in PROFILE
