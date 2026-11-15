"""Booking workflow service: the only code that writes booking requests.

It replaces the old browser pre-fillers that opened real USC portals. A request now goes:

    club rep confirms summary -> route by config -> venue policy + simulated availability
    -> Club Agent <-> Venue Scheduling Agent negotiation -> one active proposal
    -> club rep accepts -> human review packet -> authorized reviewer decides
    -> backend confirms only with an approval event and a confirmation reference

Event permits use the same path, minus availability and negotiation.

Guarantees (PRD §7.3): no model can submit, accept, approve or confirm; availability comes from the
inventory adapter with a version and timestamp; every state change goes through states.transition()
and is audited; writes take an idempotency key; nothing is sent to a USC system.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable

from app.workflows.event_pipeline import plan
from app.workflows.event_pipeline import store as pipeline_store

from . import inventory, negotiation, policy, states
from . import store as db_store
from .schemas import AgentMessage, AgentRef, MessageType, NotePayload, ProposalPayload, TimeWindow

PROPOSAL_TTL = timedelta(hours=2)
BACKEND = ("backend:booking_workflow", "backend")
CLUB_REP = ("club_rep:web", "club_rep")  # stand-in until Supabase Auth supplies the signed-in rep
KIND_STEP = {"venue_booking": "venue", "event_permit": "permit"}
KIND_LABEL = {"venue_booking": "Venue booking", "event_permit": "Event permit"}
REFERENCE_RULES = {
    "venue_booking": (re.compile(r"\d{6}"), "The venue reservation number is exactly 6 digits."),
    "event_permit": (re.compile(r"[A-Za-z0-9-]{3,40}"), "The permit code is 3–40 letters, digits or dashes."),
}


class BookingError(Exception):
    def __init__(self, status: int, code: str, message: str, retryable: bool = False, **data: Any) -> None:
        super().__init__(message)
        self.status, self.code, self.message, self.retryable, self.data = status, code, message, retryable, data

    def as_error(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "retryable": self.retryable, **({"data": self.data} if self.data else {})}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---- helpers ------------------------------------------------------------------------------------
def current_event_id() -> str:
    state = pipeline_store.load()
    if state.get("event_id"):
        return state["event_id"]
    return pipeline_store.update(lambda s: s.setdefault("event_id", str(uuid.uuid4())))["event_id"]


def _slug(s: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s or "").lower()).strip("-")[:60] or "unnamed-club"


def _iso(d: Any, t: Any) -> str | None:
    try:
        return datetime.combine(date.fromisoformat(str(d)), time.fromisoformat(str(t)), inventory.TZ).isoformat()
    except ValueError:
        return None


def _hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def _form_id(kind: str, profile: plan.Profile) -> str | None:
    return "permit" if kind == "event_permit" else plan.VENUE_FORM.get(profile.get("venueKind") or "")


def requests_for(db: dict[str, Any], event_id: str, kind: str | None = None) -> list[dict[str, Any]]:
    rs = [r for r in db["requests"].values() if r["event_id"] == event_id and (kind is None or r["kind"] == kind)]
    return sorted(rs, key=lambda r: r["created_at"], reverse=True)


def latest(db: dict[str, Any], event_id: str, kind: str) -> dict[str, Any] | None:
    rs = requests_for(db, event_id, kind)
    return rs[0] if rs else None


def _get(db: dict[str, Any], request_id: str) -> dict[str, Any]:
    req = db["requests"].get(request_id)
    if not req:
        raise BookingError(404, "NOT_FOUND", "No booking request with that id.")
    return req


def holds(db: dict[str, Any], exclude_request: str | None = None) -> list[negotiation.Hold]:
    """Slots held by accepted proposals of every request (any event), so no slot is offered twice."""
    out = []
    for r in db["requests"].values():
        if r["kind"] != "venue_booking" or r["state"] not in states.HOLDING or r["id"] == exclude_request:
            continue
        p = _proposal(r, r.get("accepted_proposal_id"))
        if p:
            out.append((p["venue_id"], datetime.fromisoformat(p["hold"]["start"]), datetime.fromisoformat(p["hold"]["end"]), r["id"]))
    return out


def _proposal(req: dict[str, Any], pid: str | None) -> dict[str, Any] | None:
    return next((p for p in req["proposals"] if p["proposal_id"] == pid), None) if pid else None


def _t(req: dict[str, Any], to: str, actor: tuple[str, str], reason: str, now: datetime) -> None:
    try:
        states.transition(req, to, actor=actor[0], role=actor[1], reason=reason, now=now)
    except states.TransitionError as e:
        raise BookingError(403 if e.code == "PERMISSION_DENIED" else 409, e.code, e.message) from e


def _idempotent(db: dict[str, Any], key: str, op: str, fn: Callable[[], str]) -> str:
    """Run `fn` once per key. A retry with the same key returns the same request without repeating side effects."""
    seen = db["idempotency"].get(key)
    if seen:
        if seen["op"] != op:
            raise BookingError(409, "IDEMPOTENCY_KEY_REUSED", "That idempotency key was already used for a different action.")
        return seen["request_id"]
    request_id = fn()
    db["idempotency"][key] = {"op": op, "request_id": request_id, "at": utcnow().isoformat()}
    return request_id


# ---- agent messages (PRD §6.2) -----------------------------------------------------------------
def _agent(req: dict[str, Any], who: str) -> AgentRef:
    if who == "club":
        org = req["organization_id"]
        return AgentRef(agent_id=f"club_agent:{org}", agent_type="club", owner_id=org)
    authority = req.get("authority_id") or "unrouted"
    if who == "venue":
        return AgentRef(agent_id=f"venue_agent:{authority}", agent_type="venue", owner_id=authority)
    if who == "review":
        return AgentRef(agent_id=f"review_queue:{authority}", agent_type="review_queue", owner_id=authority)
    return AgentRef(agent_id="workflow:booking", agent_type="workflow", owner_id="trojanconnect")


def _send(req: dict[str, Any], mtype: str, sender: str, recipient: str, note: str, now: datetime, *,
          proposal: ProposalPayload | None = None, data: dict[str, Any] | None = None, expires: datetime | None = None) -> dict[str, Any]:
    n = len(req["messages"]) + 1
    msg = AgentMessage(
        message_id=str(uuid.uuid4()), conversation_id=req["conversation_id"], correlation_id=req["correlation_id"],
        causation_id=req["messages"][-1]["message_id"] if req["messages"] else None,
        workflow_type=req["kind"], workflow_id=req["id"], sender=_agent(req, sender), recipient=_agent(req, recipient),
        message_type=MessageType(mtype), created_at=now, expires_at=expires or (proposal.expires_at if proposal else None),
        idempotency_key=f"{req['id']}:{mtype.lower()}:{n}", payload=proposal or NotePayload(note=note, data=data or {}),
        note=note, trace={"initiated_by": req["created_by"], "channel": "web"},
    )
    out = msg.model_dump(mode="json")
    req["messages"].append(out)
    return out


def _window(start: datetime, end: datetime) -> TimeWindow:
    return TimeWindow(start=start, end=end, timezone=inventory.TZ_NAME)


def _proposal_payload(req: dict[str, Any], opt: negotiation.Option | None, ask: negotiation.Ask | None, now: datetime) -> ProposalPayload:
    version = len([m for m in req["messages"] if m["message_type"] in ("OFFER", "COUNTEROFFER")]) + 1
    based_on = next((m["payload"]["proposal_id"] for m in reversed(req["messages"]) if m["message_type"] in ("OFFER", "COUNTEROFFER")), None)
    if opt:
        return ProposalPayload(
            proposal_id=str(uuid.uuid4()), proposal_version=version, based_on_proposal_id=based_on,
            venue_id=opt.venue.id, venue_name=opt.venue.name, venue_authority_id=req["authority_id"],
            time=_window(opt.start, opt.end), hold=_window(opt.hold_start, opt.hold_end),
            capacity=opt.venue.capacity, included_features=list(opt.venue.features),
            conditions=["Subject to authorized human review", "Simulated availability"],
            expires_at=now + PROPOSAL_TTL, source_availability_version=inventory.INVENTORY_VERSION)
    assert ask is not None
    r = negotiation.parse_requested(req["payload"])
    venue = inventory.VENUE_BY_ID.get(ask.venue_id or "")
    return ProposalPayload(
        proposal_id=str(uuid.uuid4()), proposal_version=version, based_on_proposal_id=based_on,
        venue_id=venue.id if venue else None, venue_name=venue.name if venue else None, venue_authority_id=req["authority_id"],
        time=_window(r["start"], r["end"]), hold=_window(r["hold_start"], r["hold_end"]),
        conditions=[f"Time may move by up to {ask.max_shift} min" if ask.max_shift else "Requested time"],
        expires_at=now + PROPOSAL_TTL, source_availability_version=inventory.INVENTORY_VERSION)


# ---- payload: the summary the club rep confirms (PRD §6.4) --------------------------------------
def build_payload(kind: str, profile: plan.Profile, db: dict[str, Any], event_id: str) -> tuple[dict[str, Any], list[dict[str, str]], list[str]]:
    """(payload, missing fields, blockers). The USC ID never goes into a payload."""
    form_id = _form_id(kind, profile)
    missing = plan.missing_for(form_id, profile) if form_id else [{"key": "venueKind", "label": plan.short_label("venueKind"), "problem": "missing"}]
    blockers: list[str] = []
    P = profile
    start, end = _iso(P.get("date"), P.get("startTime")), _iso(P.get("date"), P.get("endTime"))
    setup, teardown = _iso(P.get("date"), P.get("setupTime")), _iso(P.get("date"), P.get("teardownTime"))
    if start and end and not start < end:
        blockers.append("The event must end after it starts.")
    if setup and start and setup > start:
        blockers.append("Setup must start before the event.")
    if teardown and end and teardown < end:
        blockers.append("Tear-down must finish after the event ends.")
    try:
        attendance = int(float(P.get("attendance") or 0))
    except ValueError:
        attendance = 0
    try:
        flex = int(P.get("timeFlexMinutes") or 0)
    except ValueError:
        flex = 0
    audience = P.get("audience") or []
    payload: dict[str, Any] = {
        "organization_id": _slug(P.get("orgName")),
        "organization_name": P.get("orgName") or None,
        "organization_verified": False,  # no membership verification yet (PRD §14); shown to reviewers
        "event": {"title": P.get("eventName") or None, "description": P.get("description") or None, "event_type": P.get("eventType") or None,
                  "expected_attendance": attendance, "is_public": "General Public" in audience, "audience": audience},
        "requested_time": {"start": start, "end": end, "setup_start": setup, "teardown_end": teardown,
                           "timezone": inventory.TZ_NAME, "flexibility_minutes": flex},
        "flags": {"food": bool(P.get("food")), "amplified_sound": bool(P.get("amplifiedSound")), "filmed": bool(P.get("filmed"))},
        "requester": {"name": f'{P.get("firstName") or ""} {P.get("lastName") or ""}'.strip() or None, "email": P.get("email") or None,
                      "eboard_position": P.get("eboardPosition") or None},
    }
    if kind == "venue_booking":
        payload["requested_space"] = {
            "venue_kind": P.get("venueKind") or None, "building_preference": [x for x in (P.get("venueChoice1"), P.get("venueChoice2")) if x],
            "capacity_required": attendance, "features_required": [f for f in (P.get("equipment") or []) if f in inventory.EQUIPMENT],
            "accept_alternate": bool(P.get("acceptAlternate")),
        }
        payload["food_vendor"] = (P.get("catererName") or None) if P.get("food") else None
    else:
        venue = latest(db, event_id, "venue_booking")
        if not venue or venue["state"] != "CONFIRMED":
            blockers.append("The venue booking must be confirmed by the venue reviewer first.")
        else:
            p = _proposal(venue, venue.get("accepted_proposal_id")) or {}
            payload["venue_booking"] = {"request_id": venue["id"], "venue_name": p.get("venue_name"), "time": p.get("time"),
                                        "confirmation_reference": venue["confirmation"]["reference"]}
        food = bool(P.get("food"))
        caterer = str(P.get("catererName") or "")
        payload["food"] = {"serving": food} if not food else {
            "serving": True, "caterer_type": P.get("catererType"), "caterer_name": caterer, "menu": P.get("menu"),
            "food_value_usd": P.get("foodValue"), "payment_type": P.get("paymentType"), "vendor_serves": bool(P.get("vendorServes")),
            "caterer_in_permit_lookup": any(caterer.strip().lower() == c.lower() for c in plan.PERMIT_APPROVED_CATERERS),
        }
        payload["onsite_contact"] = {"name": P.get("onsiteName") or None, "phone": P.get("onsitePhone") or None}
        payload["requester"]["usc_id_on_file"] = plan.is_filled(P, "uscId")
    return payload, missing, blockers


def summary_lines(kind: str, payload: dict[str, Any]) -> list[str]:
    ev, t = payload["event"], payload["requested_time"]
    lines = ["Event: " + " · ".join(x for x in (ev["title"] or "untitled", ev["event_type"], f'{ev["expected_attendance"] or "?"} people') if x)]
    if t["start"] and t["end"]:
        s, e = datetime.fromisoformat(t["start"]), datetime.fromisoformat(t["end"])
        extra = []
        if t["setup_start"]:
            extra.append(f'setup {negotiation.fmt_time(datetime.fromisoformat(t["setup_start"]))}')
        if t["teardown_end"]:
            extra.append(f'out by {negotiation.fmt_time(datetime.fromisoformat(t["teardown_end"]))}')
        lines.append(f"When: {s:%a %b %-d %Y}, {negotiation.fmt_time(s)}–{negotiation.fmt_time(e)}" + (f" ({', '.join(extra)})" if extra else ""))
    if kind == "venue_booking":
        sp = payload["requested_space"]
        rule = inventory.route(sp["venue_kind"])
        prefs = sp["building_preference"]
        lines.append("Rooms: " + (" then ".join(prefs) if prefs else "none named") + ("; other rooms OK" if sp["accept_alternate"] else "; no other rooms"))
        lines.append(f'Time flexibility: up to {t["flexibility_minutes"]} min earlier or later' if t["flexibility_minutes"] else "Time flexibility: none (exact time only)")
        if sp["features_required"]:
            lines.append("Equipment: " + ", ".join(sp["features_required"]))
        lines.append("Routed to: " + (inventory.AUTHORITIES[rule["authority_id"]]["name"] if rule else "no configured authority (a human will route it)"))
    else:
        vb = payload.get("venue_booking")
        if vb:
            lines.append(f'Venue: {vb["venue_name"]} (reservation #{vb["confirmation_reference"]})')
        f = payload["food"]
        lines.append(f'Food: {f["caterer_name"]} ({f["caterer_type"]}), ${f["food_value_usd"]}' if f["serving"] else "Food: none")
        lines.append("Routed to: " + inventory.AUTHORITIES[inventory.PERMIT_AUTHORITY]["name"])
    flags = [label for key, label in (("food", "food served"), ("amplified_sound", "amplified sound"), ("filmed", "filmed/photographed")) if payload["flags"][key]]
    if flags:
        lines.append("Reviewer will be told: " + ", ".join(flags))
    return lines


def _warnings(kind: str, payload: dict[str, Any], now: datetime) -> list[dict[str, str]]:
    t = payload["requested_time"]
    if not t["start"]:
        return []
    start = datetime.fromisoformat(t["start"])
    if kind == "venue_booking":
        vk = payload["requested_space"]["venue_kind"]
        return policy.issues_as_dicts(policy.request_issues(vk, start.date(), start.time(), now)) if vk else []
    days = (start.date() - now.astimezone(inventory.TZ).date()).days
    return [{"code": "LEAD_TIME", "message": f"Permits are due 14 days ahead; the event is {days} days away.", "source": "walkthrough"}] if days < 14 else []


# ---- operations ---------------------------------------------------------------------------------
def _draft(kind: str, db: dict[str, Any], event_id: str, now: datetime) -> tuple[dict[str, Any], list[dict[str, str]], list[str]]:
    """build_payload plus the pipeline's step order (e.g. the permit waits for the food vendor)."""
    state = pipeline_store.load()
    payload, missing, blockers = build_payload(kind, state.get("profile") or {}, db, event_id)
    d = plan.derive_state(state, now.astimezone(inventory.TZ).date())
    waiting_on = [b for b in d["byId"][KIND_STEP[kind]]["blockedBy"] if b != "venue"]  # the venue blocker has its own message
    if waiting_on:
        blockers.append("Finish first: " + ", ".join(d["byId"][b]["title"] for b in waiting_on))
    return payload, missing, blockers


def prepare(kind: str, *, actor: tuple[str, str] = CLUB_REP, now: datetime | None = None) -> dict[str, Any]:
    """Create or refresh the draft for `kind` from the event profile. Never submits."""
    now = now or utcnow()
    event_id = current_event_id()
    with db_store.lock:
        db = db_store.load()
        req = latest(db, event_id, kind)
        if req and req["state"] not in states.DRAFTING and req["state"] not in states.CLOSED:
            raise BookingError(409, "ALREADY_SUBMITTED", f"This {KIND_LABEL[kind].lower()} request is already {states.STATE_LABELS[req['state']].lower()}. "
                                                          "Cancel it first to start again.")
        if not req or req["state"] in states.CLOSED:
            req = _new_request(db, kind, event_id, actor, now)
        payload, missing, blockers = _draft(kind, db, event_id, now)
        req.update(payload=payload, missing=missing, blockers=blockers, summary_hash=_hash(payload), user_confirmed_summary=False,
                   warnings=_warnings(kind, payload, now))
        target = "NEEDS_INFORMATION" if missing or blockers else "READY_FOR_SUBMISSION"
        if req["state"] != target:
            gaps = [m["label"] for m in missing] + blockers
            _t(req, target, actor, ("missing: " + "; ".join(gaps)) if gaps else "all required fields present", now)
        else:
            states.audit(req, action="draft_refreshed", actor=actor[0], role=actor[1], reason="draft rebuilt from the event profile", now=now)
        db_store.save(db)
    _sync_pipeline(req, now)
    return req


def _new_request(db: dict[str, Any], kind: str, event_id: str, actor: tuple[str, str], now: datetime) -> dict[str, Any]:
    rid = str(uuid.uuid4())
    req = {
        "id": rid, "kind": kind, "event_id": event_id, "state": "DRAFT", "version": 1,
        "created_at": now.isoformat(), "updated_at": now.isoformat(), "created_by": actor[0],
        "conversation_id": str(uuid.uuid4()), "correlation_id": str(uuid.uuid4()),
        "organization_id": "", "payload": {}, "summary_hash": "", "missing": [], "blockers": [], "warnings": [],
        "authority_id": None, "routing": None, "availability": None, "rounds": 0,
        "proposals": [], "active_proposal_id": None, "accepted_proposal_id": None,
        "messages": [], "review": None, "approval_event": None, "confirmation": None, "escalation": None, "timeline": [],
    }
    states.audit(req, action="created", actor=actor[0], role=actor[1], reason="draft created from the event profile", now=now, to_state="DRAFT")
    db["requests"][rid] = req
    return req


def submit(request_id: str, summary_hash: str, idempotency_key: str, *, now: datetime | None = None) -> dict[str, Any]:
    """The club rep confirmed the summary they saw. Only a club rep can do this (never the Club Agent)."""
    now = now or utcnow()
    event_id = current_event_id()
    with db_store.lock:
        db = db_store.load()

        def run() -> str:
            req = _get(db, request_id)
            if req["event_id"] != event_id:
                raise BookingError(409, "OTHER_EVENT", "That request belongs to an event that was cleared.")
            if req["state"] != "READY_FOR_SUBMISSION":
                raise BookingError(409, "NOT_READY", f"Only a request that is ready can be submitted; this one is {states.STATE_LABELS[req['state']].lower()}.")
            payload, missing, blockers = _draft(req["kind"], db, event_id, now)
            if missing or blockers or _hash(payload) != req["summary_hash"] or summary_hash != req["summary_hash"]:
                raise BookingError(409, "SUMMARY_CHANGED", "The event details changed since you reviewed them. Review the new summary and confirm again.")
            req.update(user_confirmed_summary=True, user_confirmed_at=now.isoformat(), organization_id=payload["organization_id"])
            _t(req, "SUBMITTED", CLUB_REP, "club rep confirmed the summary", now)
            (_process_venue if req["kind"] == "venue_booking" else _process_permit)(db, req, now)
            return req["id"]

        rid = _idempotent(db, idempotency_key, f"submit:{request_id}", run)
        db_store.save(db)
        req = db["requests"][rid]
    _sync_pipeline(req, now)
    return req


def _escalate(req: dict[str, Any], code: str, reason: str, now: datetime, details: list[Any] | None = None) -> None:
    req["escalation"] = {"code": code, "reason": reason, "details": details or [], "at": now.isoformat()}
    _send(req, "ERROR", "venue", "club", reason, now, data={"code": code, "details": details or []})
    _t(req, "FAILED_REQUIRES_HUMAN", BACKEND, f"{code}: {reason}", now)


def _route(req: dict[str, Any], venue_kind: str | None, now: datetime) -> bool:
    _t(req, "ROUTING", BACKEND, "routing from configuration", now)
    rule = inventory.route(venue_kind) if req["kind"] == "venue_booking" else \
        {"id": "route-permit", "authority_id": inventory.PERMIT_AUTHORITY, "version": inventory.ROUTING_VERSION}
    if not rule:
        req["routing"] = {"venue_authority_id": None, "routing_reason": f"No routing rule for venue type '{venue_kind}'",
                          "routing_source_version": inventory.ROUTING_VERSION, "requires_human_check": True}
        _escalate(req, "ROUTING_UNRESOLVED", "No configured venue authority for this venue type. A human must route it.", now)
        return False
    req["authority_id"] = rule["authority_id"]
    req["routing"] = {"venue_authority_id": rule["authority_id"], "routing_reason": f"Configured authority for rule {rule['id']}",
                      "routing_source_version": rule["version"], "requires_human_check": False}
    _send(req, "BOOKING_REQUEST", "club", "venue", "Booking request: " + "; ".join(summary_lines(req["kind"], req["payload"])), now,
          data={"summary_hash": req["summary_hash"]})
    return True


def _process_venue(db: dict[str, Any], req: dict[str, Any], now: datetime) -> None:
    payload = req["payload"]
    if not _route(req, payload["requested_space"]["venue_kind"], now):
        return
    _t(req, "AVAILABILITY_CHECK", BACKEND, "venue agent checking policy and inventory", now)
    start = datetime.fromisoformat(payload["requested_time"]["start"])
    issues = policy.request_issues(payload["requested_space"]["venue_kind"], start.date(), start.time(), now)
    if issues:
        _escalate(req, "POLICY_CONFLICT", " ".join(i.message for i in issues), now, policy.issues_as_dicts(issues))
        return
    club = negotiation.ClubNegotiator(payload, req["authority_id"])
    if not club.acceptable_venues():
        _escalate(req, "VENUE_NOT_IN_INVENTORY", "None of the named rooms is in this authority's inventory and other rooms were not allowed.", now)
        return
    req.update(proposals=[], active_proposal_id=None, accepted_proposal_id=None, rounds=0)
    _negotiate(db, req, club, set(), now, opening=True)


def _negotiate(db: dict[str, Any], req: dict[str, Any], club: negotiation.ClubNegotiator, offered: set[tuple[str, int]],
               now: datetime, *, opening: bool) -> negotiation.Option | None:
    payload = req["payload"]
    venue = negotiation.VenueSchedulingAgent(req["authority_id"], payload, holds(db, exclude_request=req["id"]), club)
    _send(req, "AVAILABILITY_QUERY", "club", "venue", "Which rooms fit these constraints?" if opening else "Is there another option?", now,
          data={"min_capacity": club.capacity, "required_features": payload["requested_space"]["features_required"],
                "flexibility_minutes": club.flex})
    count = venue.feasible_count()
    req["availability"] = {"inventory_version": inventory.INVENTORY_VERSION, "checked_at": now.isoformat(), "source": inventory.SOURCE_LABEL,
                           "feasible_options": count}
    _send(req, "AVAILABILITY_RESULT", "venue", "club", f"{count} option(s) meet the club's constraints in the {inventory.INVENTORY_VERSION} inventory.",
          now, data=dict(req["availability"]), expires=now + PROPOSAL_TTL)
    if opening:
        if not count:
            _escalate(req, "NO_FEASIBLE_OPTIONS", "No room meets the club's constraints at that time. Change the time, rooms or flexibility, "
                                                  "or contact the venue office.", now)
            return None
        _t(req, "NEGOTIATING", BACKEND, f"{count} feasible option(s)", now)
    option_by_pid: dict[str, negotiation.Option] = {}

    def emit(mtype: str, sender: str, note: str, option: negotiation.Option | None = None, ask: negotiation.Ask | None = None) -> None:
        recipient = "venue" if sender == "club" else "club"
        proposal = _proposal_payload(req, option, ask, now) if mtype in ("OFFER", "COUNTEROFFER") else None
        _send(req, mtype, sender, recipient, note, now, proposal=proposal)
        if mtype == "OFFER" and option and proposal:
            rec = proposal.model_dump(mode="json")
            rec.update(status="offered", shift=option.shift, offered_at=now.isoformat())
            req["proposals"].append(rec)
            option_by_pid[rec["proposal_id"]] = option
        if mtype == "DECLINE_PROPOSAL" and sender == "club":
            req["proposals"][-1]["status"] = "declined_by_club_agent"

    best, req["rounds"] = negotiation.negotiate(venue, club, emit, rounds_used=req["rounds"], offered=offered)
    if best is None:
        return None
    new_pid = next(pid for pid, o in option_by_pid.items() if o == best)
    for p in req["proposals"]:
        if p["status"] == "offered":
            p["status"] = "active" if p["proposal_id"] == new_pid else "superseded"
    req["active_proposal_id"] = new_pid
    p = _proposal(req, new_pid)
    assert p is not None
    diffs = proposal_differences(req, p)
    _send(req, "BOOKING_STATUS", "club", "venue", f"Taking {p['venue_name']} to the club rep for a decision" + (f" ({'; '.join(diffs)})." if diffs else
                                                                                                                 " (exactly as requested)."), now)
    return best


def _option_from(req: dict[str, Any], p: dict[str, Any]) -> negotiation.Option:
    return negotiation.make_option(req["payload"], inventory.VENUE_BY_ID[p["venue_id"]], int(p["shift"]))


def request_alternatives(request_id: str, reason: str, idempotency_key: str, *, actor: tuple[str, str] = CLUB_REP,
                         now: datetime | None = None) -> dict[str, Any]:
    """Ask the venue agent for a different option. Every confirmed constraint still applies (PRD §9.2)."""
    now = now or utcnow()
    with db_store.lock:
        db = db_store.load()

        def run() -> str:
            req = _get(db, request_id)
            if req["state"] != "NEGOTIATING":
                raise BookingError(409, "NOT_NEGOTIATING", "Alternatives can only be requested while a proposal is open.")
            if req["rounds"] >= negotiation.MAX_ROUNDS:
                raise BookingError(409, "ROUND_LIMIT", f"The {negotiation.MAX_ROUNDS}-round limit is reached. Accept the current proposal, "
                                                       "or cancel and contact the venue office.")
            club = negotiation.ClubNegotiator(req["payload"], req["authority_id"])
            offered = {(p["venue_id"], int(p["shift"])) for p in req["proposals"]}
            active = _proposal(req, req["active_proposal_id"])
            states.audit(req, action="alternatives_requested", actor=actor[0], role=actor[1], reason=reason or "club asked for another option", now=now)
            _send(req, "DECLINE_PROPOSAL", "club", "venue", "The club would like another option" + (f": {reason}" if reason else "."), now)
            found = _negotiate(db, req, club, offered, now, opening=False)
            if found and active:
                active["status"] = "declined"
            elif not found:
                _send(req, "BOOKING_STATUS", "venue", "club", "No other option meets the club's constraints; the current proposal still stands." if active
                      else "No option meets the club's constraints.", now)
                if not active:
                    _escalate(req, "NO_FEASIBLE_OPTIONS", "No option left inside the club's constraints.", now)
            return req["id"]

        rid = _idempotent(db, idempotency_key, f"alternatives:{request_id}", run)
        db_store.save(db)
        req = db["requests"][rid]
    _sync_pipeline(req, now)
    return req


def accept_proposal(request_id: str, proposal_id: str, proposal_version: int, idempotency_key: str, *,
                    now: datetime | None = None) -> dict[str, Any]:
    """Club rep accepts the active proposal. Rechecks everything, then sends it to human review. Never confirms."""
    now = now or utcnow()
    with db_store.lock:
        db = db_store.load()
        stale: BookingError | None = None

        def run() -> str:
            nonlocal stale
            req = _get(db, request_id)
            if req["state"] != "NEGOTIATING":
                raise BookingError(409, "NOT_NEGOTIATING", "There is no open proposal to accept.")
            p = _proposal(req, proposal_id)
            if not p or req["active_proposal_id"] != proposal_id:
                raise BookingError(409, "PROPOSAL_NOT_ACTIVE", "That proposal is no longer the active one.")
            if p["proposal_version"] != proposal_version:
                raise BookingError(409, "STALE_VERSION", "That proposal changed. Reload it and try again.")
            if now >= datetime.fromisoformat(p["expires_at"]):
                p["status"] = "expired"
                stale = BookingError(409, "PROPOSAL_EXPIRED", "That proposal expired. Ask for another option to get a fresh one.")
                return req["id"]
            opt = _option_from(req, p)
            start = datetime.fromisoformat(req["payload"]["requested_time"]["start"])
            problems = negotiation.option_problems(req["payload"], opt, holds(db, exclude_request=req["id"])) + \
                policy.issues_as_dicts(policy.request_issues(req["payload"]["requested_space"]["venue_kind"], start.date(), start.time(), now))
            if problems:
                p["status"] = "stale"
                stale = BookingError(409, "PROPOSAL_STALE", "That option is no longer valid: " + " ".join(x["message"] for x in problems), problems=problems)
                return req["id"]
            _t(req, "PROPOSAL_ACCEPTED", CLUB_REP, f"club rep accepted proposal v{proposal_version} ({p['venue_name']})", now)
            p["status"], req["accepted_proposal_id"] = "accepted", proposal_id
            _send(req, "ACCEPT_PROPOSAL", "club", "venue", f"The club rep accepts {p['venue_name']}, subject to review.", now,
                  data={"proposal_id": proposal_id, "proposal_version": proposal_version})
            _open_review(req, now)
            if auto_review_enabled():
                _auto_review(db, req, now)
            return req["id"]

        rid = _idempotent(db, idempotency_key, f"accept:{request_id}:{proposal_id}", run)
        if stale:
            db["idempotency"].pop(idempotency_key, None)  # a failed accept may be retried with the same key
        db_store.save(db)
        req = db["requests"][rid]
    if stale:
        raise stale
    _sync_pipeline(req, now)
    return req


def _attention(req: dict[str, Any]) -> list[str]:
    payload, out = req["payload"], []
    f = payload["flags"]
    if f["food"]:
        food = payload.get("food") or {}
        vendor = food.get("caterer_name") or payload.get("food_vendor")
        out.append(f"Food will be served{(' by ' + vendor) if vendor else ''}.")
        if food.get("serving") and not food.get("caterer_in_permit_lookup"):
            out.append("Caterer is not in the permit's approved-caterer lookup: one-time approval (health permit + insurance) needed 2 weeks ahead.")
    if f["amplified_sound"]:
        out.append("Amplified sound requested.")
    if f["filmed"]:
        out.append("Event will be filmed or photographed.")
    if payload["event"]["is_public"]:
        out.append("Open to the general public.")
    if not payload.get("organization_verified"):
        out.append("Club membership is not verified in TrojanConnect yet (demo).")
    if req["kind"] == "venue_booking":
        out += policy.reviewer_notes(payload["requested_space"]["venue_kind"])
    out += [w["message"] for w in req.get("warnings") or []]
    return out


def _open_review(req: dict[str, Any], now: datetime) -> None:
    packet: dict[str, Any] = {"summary": summary_lines(req["kind"], req["payload"]), "attention": _attention(req),
                              "event": req["payload"]["event"], "requester": req["payload"]["requester"]}
    if req["kind"] == "venue_booking":
        p = _proposal(req, req["accepted_proposal_id"])
        assert p is not None
        packet.update(proposal=p, differences=proposal_differences(req, p),
                      checks={"capacity": True, "features": True, "time_window": True, "venue_authority": True, "availability": True, "lead_time": True},
                      availability_source=req["availability"],
                      negotiation_summary=f"{len([x for x in req['proposals']])} offer(s) in {req['rounds']} round(s); club rep accepted {p['venue_name']}.")
    else:
        packet.update(venue_booking=req["payload"].get("venue_booking"), food=req["payload"].get("food"),
                      onsite_contact=req["payload"].get("onsite_contact"),
                      not_auto_answered="Trash/waste, security, alcohol, insurance and similar questions are NOT answered by TrojanConnect; "
                                        "check them with the club before approving.")
    req["review"] = {"task_id": str(uuid.uuid4()), "authority_id": req["authority_id"], "status": "pending", "created_at": now.isoformat(),
                     "packet": packet, "decisions": []}
    _send(req, "HUMAN_REVIEW_REQUIRED", "venue", "review", "Review packet sent to the " + inventory.AUTHORITIES[req["authority_id"]]["name"] + " queue.", now,
          data={"review_task_id": req["review"]["task_id"]})
    _t(req, "PENDING_HUMAN_REVIEW", BACKEND, "review packet created", now)


def auto_review_enabled() -> bool:
    return os.environ.get("DEMO_AUTO_REVIEW", "").lower() in ("1", "true", "yes")


def _auto_review(db: dict[str, Any], req: dict[str, Any], now: datetime) -> None:
    """DEMO_AUTO_REVIEW: a simulated office approves through the same checks a human reviewer passes.

    Off by default. The decision, the reviewer name and the reference are all labelled simulated.
    """
    rev = inventory.SIMULATED_REVIEWERS[f"sim-{req['authority_id']}"]
    actor = _authorize(req, rev, now)
    digits = str(int(hashlib.sha256(req["id"].encode()).hexdigest(), 16))[-6:]
    reference = digits if req["kind"] == "venue_booking" else f"SIM-{digits}"
    reason = "Simulated office (demo): auto-approved. Not a real USC decision."
    _t(req, "APPROVED", actor, reason, now)
    req["review"]["status"] = "approved"
    req["approval_event"] = {"id": str(uuid.uuid4()), "review_task_id": req["review"]["task_id"], "reviewer_id": rev["id"],
                             "decision": "APPROVE", "reason": reason, "created_at": now.isoformat(), "simulated": True}
    req["review"]["decisions"].append({"decision": "APPROVE", "reason": reason, "reviewer_id": rev["id"], "reviewer_name": rev["name"],
                                       "at": now.isoformat(), "simulated": True})
    _send(req, "REVIEW_DECISION", "review", "club", f"{rev['name']}: approved (simulated).", now, data={"decision": "APPROVE", "simulated": True})
    _confirm(db, req, rev, reference, now)


def _process_permit(db: dict[str, Any], req: dict[str, Any], now: datetime) -> None:
    if not _route(req, None, now):
        return
    _open_review(req, now)
    if auto_review_enabled():
        _auto_review(db, req, now)


def cancel(request_id: str, reason: str, idempotency_key: str, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or utcnow()
    with db_store.lock:
        db = db_store.load()

        def run() -> str:
            req = _get(db, request_id)
            _cancel_one(req, reason or "withdrawn by the club rep", now)
            return req["id"]

        rid = _idempotent(db, idempotency_key, f"cancel:{request_id}", run)
        db_store.save(db)
        req = db["requests"][rid]
    _sync_pipeline(req, now)
    return req


def _cancel_one(req: dict[str, Any], reason: str, now: datetime) -> None:
    st = req["state"]
    if st in ("PENDING_HUMAN_REVIEW", "APPROVED", "CONFIRMED"):
        _t(req, "CANCEL_REQUESTED", CLUB_REP, reason, now)
        req["review"]["status"] = "cancellation_requested"
        _send(req, "CANCEL_REQUEST", "club", "venue", f"The club asks to cancel: {reason}", now)
    elif st in states.DRAFTING or st in ("NEGOTIATING", "FAILED_REQUIRES_HUMAN"):
        if st not in states.DRAFTING:
            _send(req, "CANCEL_REQUEST", "club", "venue", f"The club withdraws the request: {reason}", now)
        states.audit(req, action="cancel_requested", actor=CLUB_REP[0], role=CLUB_REP[1], reason=reason, now=now)
        _t(req, "CANCELLED", BACKEND, "nothing held yet; cancelled on the club rep's request", now)
        if req.get("active_proposal_id"):
            (_proposal(req, req["active_proposal_id"]) or {})["status"] = "withdrawn"
    else:
        raise BookingError(409, "CANNOT_CANCEL", f"A request that is {states.STATE_LABELS[st].lower()} can't be cancelled.")


def cancel_event(event_id: str, now: datetime | None = None) -> None:
    """The club rep cleared the event: withdraw what can be withdrawn, ask reviewers to release the rest."""
    now = now or utcnow()
    with db_store.lock:
        db = db_store.load()
        for req in requests_for(db, event_id):
            if req["state"] not in states.CLOSED and req["state"] not in ("CANCEL_REQUESTED", "PROPOSAL_ACCEPTED"):
                _cancel_one(req, "event cleared by the club rep", now)
        db_store.save(db)


# ---- human review (not reachable from any agent tool) ------------------------------------------
def reviewer(reviewer_id: str | None) -> dict[str, Any]:
    r = inventory.REVIEWERS.get(reviewer_id or "")
    if not r or not r["active"]:
        raise BookingError(401, "UNAUTHENTICATED", "Sign in as a reviewer.")
    return r


def review_queue(reviewer_id: str | None) -> list[dict[str, Any]]:
    r = reviewer(reviewer_id)
    if r["role"] != "venue_reviewer":
        return []
    db = db_store.load()
    rs = [x for x in db["requests"].values() if x.get("review") and x["authority_id"] in r["authorities"]]
    return sorted(rs, key=lambda x: (x["state"] not in ("PENDING_HUMAN_REVIEW", "CANCEL_REQUESTED", "APPROVED"), x["review"]["created_at"]))


def _by_task(db: dict[str, Any], task_id: str) -> dict[str, Any]:
    req = next((r for r in db["requests"].values() if (r.get("review") or {}).get("task_id") == task_id), None)
    if not req:
        raise BookingError(404, "NOT_FOUND", "No review task with that id.")
    return req


def _authorize(req: dict[str, Any], rev: dict[str, Any], now: datetime) -> tuple[str, str]:
    if rev["role"] != "venue_reviewer" or req["authority_id"] not in rev["authorities"]:
        states.audit(req, action="decision_denied", actor=f"reviewer:{rev['id']}", role=rev["role"],
                     reason=f"not assigned to {req['authority_id']}", now=now)
        raise BookingError(403, "PERMISSION_DENIED", f"{rev['name']} is not a reviewer for {inventory.AUTHORITIES[req['authority_id']]['name']}.")
    return (f"reviewer:{rev['id']}", "reviewer")


def decide(task_id: str, reviewer_id: str | None, decision: str, reason: str, reference: str | None, idempotency_key: str, *,
           now: datetime | None = None) -> dict[str, Any]:
    now = now or utcnow()
    rev = reviewer(reviewer_id)
    with db_store.lock:
        db = db_store.load()
        denied: BookingError | None = None

        def run() -> str:
            nonlocal denied
            req = _by_task(db, task_id)
            try:
                actor = _authorize(req, rev, now)
            except BookingError as e:
                denied = e
                return req["id"]
            review = req["review"]
            if decision in ("REJECT", "REQUEST_CHANGES") and not reason.strip():
                raise BookingError(400, "REASON_REQUIRED", "Give a reason when rejecting or requesting changes.")
            if decision == "CONFIRM_CANCELLATION":
                if req["state"] != "CANCEL_REQUESTED":
                    raise BookingError(409, "NOT_CANCEL_REQUESTED", "The club has not asked to cancel this request.")
                _t(req, "CANCELLED", actor, reason or "cancellation confirmed by reviewer", now)
                review["status"] = "cancelled"
            else:
                if req["state"] != "PENDING_HUMAN_REVIEW":
                    raise BookingError(409, "NOT_PENDING", f"This request is {states.STATE_LABELS[req['state']].lower()}, not pending review.")
                to = {"APPROVE": "APPROVED", "REJECT": "REJECTED", "REQUEST_CHANGES": "CHANGES_REQUESTED"}[decision]
                if decision == "APPROVE" and reference:
                    _check_reference(req, reference)  # validate before any state change
                _t(req, to, actor, reason or "approved", now)
                review["status"] = to.lower()
                if decision == "APPROVE":
                    req["approval_event"] = {"id": str(uuid.uuid4()), "review_task_id": task_id, "reviewer_id": rev["id"], "decision": "APPROVE",
                                             "reason": reason, "created_at": now.isoformat()}
            event = {"decision": decision, "reason": reason, "reviewer_id": rev["id"], "reviewer_name": rev["name"], "at": now.isoformat()}
            review["decisions"].append(event)
            _send(req, "REVIEW_DECISION", "review", "club", f"{rev['name']}: {decision.replace('_', ' ').lower()}" + (f" ({reason})" if reason else "."), now,
                  data={"decision": decision, "reviewer_id": rev["id"]})
            if decision == "APPROVE" and reference:
                _confirm(db, req, rev, reference, now)
            return req["id"]

        rid = _idempotent(db, idempotency_key, f"decide:{task_id}:{decision}", run)
        if denied:
            db["idempotency"].pop(idempotency_key, None)
        db_store.save(db)
        req = db["requests"][rid]
    if denied:
        raise denied
    _sync_pipeline(req, now)
    return req


def confirm(task_id: str, reviewer_id: str | None, reference: str, idempotency_key: str, *, now: datetime | None = None) -> dict[str, Any]:
    """Record the confirmation reference for an approved request; the backend then marks it CONFIRMED."""
    now = now or utcnow()
    rev = reviewer(reviewer_id)
    with db_store.lock:
        db = db_store.load()
        denied: BookingError | None = None

        def run() -> str:
            nonlocal denied
            req = _by_task(db, task_id)
            try:
                _authorize(req, rev, now)
            except BookingError as e:
                denied = e
                return req["id"]
            _confirm(db, req, rev, reference, now)
            return req["id"]

        rid = _idempotent(db, idempotency_key, f"confirm:{task_id}", run)
        if denied:
            db["idempotency"].pop(idempotency_key, None)
        db_store.save(db)
        req = db["requests"][rid]
    if denied:
        raise denied
    _sync_pipeline(req, now)
    return req


def _check_reference(req: dict[str, Any], reference: str) -> str:
    rx, msg = REFERENCE_RULES[req["kind"]]
    ref = (reference or "").strip()
    if not rx.fullmatch(ref):
        raise BookingError(400, "INVALID_REFERENCE", msg)
    return ref


def _confirm(db: dict[str, Any], req: dict[str, Any], rev: dict[str, Any], reference: str, now: datetime) -> None:
    """PRD §9.3 confirm_booking: backend-only. Needs APPROVED, a valid approval event from this authority, and a reference."""
    if req["state"] != "APPROVED":
        raise BookingError(409, "NOT_APPROVED", "Only an approved request can be confirmed.")
    ev = req.get("approval_event") or {}
    approver = inventory.reviewer_record(ev.get("reviewer_id", ""))
    if ev.get("decision") != "APPROVE" or not approver or req["authority_id"] not in approver["authorities"]:
        raise BookingError(409, "NO_VALID_APPROVAL", "No valid approval from this venue authority is on record.")
    ref = _check_reference(req, reference)
    if req["kind"] == "venue_booking":
        p = _proposal(req, req["accepted_proposal_id"])
        assert p is not None
        if negotiation.option_problems(req["payload"], _option_from(req, p), holds(db, exclude_request=req["id"])):
            raise BookingError(409, "AVAILABILITY_CHANGED", "The slot is no longer free in the inventory. Request changes instead.")
    req["confirmation"] = {"reference": ref, "confirmed_at": now.isoformat(), "approval_event_id": ev["id"], "recorded_by": rev["id"],
                           "contact_name": rev["name"], "contact_email": rev["email"]}
    _t(req, "CONFIRMED", BACKEND, f"approval {ev['id'][:8]} verified; reference {ref} recorded", now)
    req["review"]["status"] = "confirmed"
    _send(req, "BOOKING_STATUS", "workflow", "club", f"Confirmed. Reference {ref}.", now, data={"reference": ref})


# ---- pipeline sync: the venue and permit steps read their status from here ---------------------
WORKFLOW_OWNED = {
    "venue": {"checks": {"submitted", "confirmed"}, "data": {"reservationNumber", "venueContactName", "venueContactEmail"}},
    "permit": {"checks": {"submitted", "approved"}, "data": {"permitCode"}},
}
_NOT_SUBMITTED = states.DRAFTING | states.CLOSED


def _sync_pipeline(req: dict[str, Any], now: datetime) -> None:
    step = KIND_STEP[req["kind"]]
    st = req["state"]
    confirmed = st == "CONFIRMED"
    conf = req.get("confirmation") or {}

    def apply(s: dict[str, Any]) -> None:
        if s.get("event_id") != req["event_id"]:
            return
        p = s["progress"].setdefault(step, {"checks": {}, "data": {}})
        p.setdefault("checks", {})
        p.setdefault("data", {})
        p["checks"]["submitted"] = st not in _NOT_SUBMITTED
        if step == "venue":
            p["checks"]["confirmed"] = confirmed
            p["data"]["reservationNumber"] = conf.get("reference", "") if confirmed else ""
            p["data"]["venueContactName"] = conf.get("contact_name", "") if confirmed else ""
            p["data"]["venueContactEmail"] = conf.get("contact_email", "") if confirmed else ""
            if confirmed:
                _apply_confirmed_slot(s, req)
        else:
            p["checks"]["approved"] = confirmed
            p["data"]["permitCode"] = conf.get("reference", "") if confirmed else ""
        last = s.get("booking_state", {}).get(req["kind"])
        if last != (req["id"], st):
            s.setdefault("booking_state", {})[req["kind"]] = [req["id"], st]
            pipeline_store.add_log(s, f"{KIND_LABEL[req['kind']].lower()}: {states.STATE_LABELS[st]}")

    pipeline_store.update(apply)


def _apply_confirmed_slot(s: dict[str, Any], req: dict[str, Any]) -> None:
    """The rep explicitly accepted the confirmed room and time, so the profile (used by later forms) follows it."""
    p = _proposal(req, req.get("accepted_proposal_id"))
    if not p:
        return
    prof = s["profile"]
    hhmm = lambda iso: datetime.fromisoformat(iso).strftime("%H:%M")  # noqa: E731
    new = {"venueChoice1": p["venue_name"], "startTime": hhmm(p["time"]["start"]), "endTime": hhmm(p["time"]["end"])}
    if prof.get("setupTime") and p.get("hold"):
        new["setupTime"] = hhmm(p["hold"]["start"])
    if prof.get("teardownTime") and p.get("hold"):
        new["teardownTime"] = hhmm(p["hold"]["end"])
    changed = {k: v for k, v in new.items() if prof.get(k) != v}
    if changed:
        prof.update(changed)
        pipeline_store.add_log(s, "profile updated from the confirmed booking: " + ", ".join(f"{k} = {v}" for k, v in changed.items()))


# ---- read models --------------------------------------------------------------------------------
def proposal_differences(req: dict[str, Any], p: dict[str, Any]) -> list[str]:
    """Exactly how a proposal differs from what the rep asked for (PRD §8.2)."""
    out = []
    prefs = req["payload"]["requested_space"]["building_preference"]
    if prefs and inventory.find_venue(prefs[0], req["authority_id"]) != inventory.VENUE_BY_ID.get(p["venue_id"]):
        out.append(f"Room: {p['venue_name']} instead of {prefs[0]}" + (" (your second choice)" if len(prefs) > 1 and
                   inventory.find_venue(prefs[1], req["authority_id"]) == inventory.VENUE_BY_ID.get(p["venue_id"]) else ""))
    shift = int(p.get("shift") or 0)
    if shift:
        s, e = datetime.fromisoformat(p["time"]["start"]), datetime.fromisoformat(p["time"]["end"])
        out.append(f"Time: {negotiation.fmt_time(s)}–{negotiation.fmt_time(e)}, {negotiation.describe_shift(shift)}")
    return out


NEXT_ACTION = {
    "DRAFT": "Prepare the request.",
    "NEEDS_INFORMATION": "Fill in the missing details in the Event profile, then prepare the request again.",
    "READY_FOR_SUBMISSION": "Check the summary, then press Confirm & send.",
    "NEGOTIATING": "Accept the proposal to send it for review, or ask for another option.",
    "PENDING_HUMAN_REVIEW": "Waiting for a human reviewer. Not confirmed yet.",
    "APPROVED": "Approved by the reviewer. Waiting for the confirmation reference; not confirmed yet.",
    "CONFIRMED": "Confirmed.",
    "CHANGES_REQUESTED": "The reviewer asked for changes. Update the Event profile, then prepare the request again.",
    "REJECTED": "Rejected. You can change the event and start a new request.",
    "CANCEL_REQUESTED": "Waiting for the reviewer to confirm the cancellation.",
    "CANCELLED": "Cancelled. You can start a new request.",
    "EXPIRED": "Expired. Start a new request.",
    "FAILED_REQUIRES_HUMAN": "A human needs to step in. Contact the venue office, or change the event and start a new request.",
}
STAGES = ["Draft", "Submitted", "Negotiating", "Human review", "Approved", "Confirmed"]
_STAGE_OF = {"DRAFT": 0, "NEEDS_INFORMATION": 0, "READY_FOR_SUBMISSION": 0, "SUBMITTED": 1, "ROUTING": 1, "AVAILABILITY_CHECK": 1,
             "NEGOTIATING": 2, "PROPOSAL_ACCEPTED": 2, "PENDING_HUMAN_REVIEW": 3, "APPROVED": 4, "CONFIRMED": 5, "CANCEL_REQUESTED": 5}


def view(req: dict[str, Any] | None, now: datetime | None = None, *, for_reviewer: bool = False) -> dict[str, Any] | None:
    if not req:
        return None
    now = now or utcnow()
    st = req["state"]
    authority = inventory.AUTHORITIES.get(req["authority_id"] or "")
    proposals = []
    for p in req["proposals"]:
        expired = p["status"] == "active" and now >= datetime.fromisoformat(p["expires_at"])
        proposals.append({**p, "status": "expired" if expired else p["status"], "differences": proposal_differences(req, p)})
    active = next((p for p in proposals if p["proposal_id"] == req["active_proposal_id"] and p["status"] == "active"), None)
    last_decision = ((req.get("review") or {}).get("decisions") or [None])[-1]
    next_action = NEXT_ACTION[st]
    if st == "CONFIRMED":
        next_action = f"Confirmed. {'Reservation #' if req['kind'] == 'venue_booking' else 'Permit code '}{req['confirmation']['reference']}."
    elif st in ("CHANGES_REQUESTED", "REJECTED") and last_decision:
        next_action += f" Reviewer: {last_decision['reason']}"
    elif st == "FAILED_REQUIRES_HUMAN" and req.get("escalation"):
        next_action = f"{req['escalation']['reason']} " + next_action
    elif st == "PENDING_HUMAN_REVIEW" and authority:
        next_action = f"Waiting for {authority['name']} to review. Not confirmed yet."
    out = {
        "id": req["id"], "kind": req["kind"], "kind_label": KIND_LABEL[req["kind"]], "state": st, "state_label": states.STATE_LABELS[st],
        "stage": _STAGE_OF.get(st), "stages": STAGES, "version": req["version"],
        "created_at": req["created_at"], "updated_at": req["updated_at"],
        "authority": authority, "routing": req["routing"],
        "summary": summary_lines(req["kind"], req["payload"]) if req["payload"] else [], "summary_hash": req["summary_hash"],
        "missing_fields": req["missing"], "blockers": req["blockers"], "warnings": req.get("warnings") or [],
        "availability": req["availability"], "simulated": True, "source_label": inventory.SOURCE_LABEL,
        "rounds": req["rounds"], "max_rounds": negotiation.MAX_ROUNDS,
        "proposals": proposals, "active_proposal": active,
        "accepted_proposal": next((p for p in proposals if p["proposal_id"] == req.get("accepted_proposal_id")), None),
        "messages": [{"id": m["message_id"], "type": m["message_type"], "from": m["sender"]["agent_id"], "from_type": m["sender"]["agent_type"],
                      "to": m["recipient"]["agent_id"], "note": m["note"], "at": m["created_at"],
                      "proposal_id": m["payload"].get("proposal_id")} for m in req["messages"]],
        "review": None if not req.get("review") else {k: v for k, v in req["review"].items() if for_reviewer or k != "packet"},
        "confirmation": req.get("confirmation"), "escalation": req.get("escalation"),
        "timeline": req["timeline"], "next_action": next_action,
        "can": {
            "prepare": st in states.DRAFTING or st in states.CLOSED,
            "submit": st == "READY_FOR_SUBMISSION",
            "accept": active is not None,
            "alternatives": st == "NEGOTIATING" and req["rounds"] < negotiation.MAX_ROUNDS,
            "cancel": st not in states.CLOSED and st not in ("CANCEL_REQUESTED", "PROPOSAL_ACCEPTED"),
        },
    }
    if for_reviewer:
        out["payload"] = req["payload"]
        out["approval_event"] = req.get("approval_event")
    return out


def list_for_event(kind: str | None = None) -> list[dict[str, Any]]:
    now = utcnow()
    db = db_store.load()
    return [v for r in requests_for(db, current_event_id(), kind) if (v := view(r, now))]


def get(request_id: str) -> dict[str, Any]:
    return view(_get(db_store.load(), request_id)) or {}


def latest_view(kind: str) -> dict[str, Any] | None:
    return view(latest(db_store.load(), current_event_id(), kind))
