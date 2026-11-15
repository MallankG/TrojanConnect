"""Tools the event agent (the Club Agent) may call: one per feature in docs/event-pipeline.md.

What holds no matter what the model asks for:
- Nothing reaches a USC system. Venue bookings and the event permit go through the booking workflow
  (app/workflows/booking): the agent can prepare a draft and ask the Venue Scheduling Agent for
  alternatives, but submitting, accepting a proposal and cancelling are buttons the user presses, and
  only an authorized human reviewer can approve. `draft_email` opens a draft, never sends.
- Clearing the event is a button the user presses, not something the model can do.
- The USC ID never passes through the model, in either direction.

Each tool returns the standard result `{ok, data, error}`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable

from app.workflows.booking import inventory, negotiation, policy
from app.workflows.booking import service as booking
from app.workflows.booking import store as booking_store
from app.workflows.event_pipeline import plan, store, views

PRIVATE_FIELDS = views.PRIVATE_FIELDS  # never sent to or accepted from the model
CLUB_AGENT = ("club_agent:assistant", "club_agent")
KINDS = list(booking.KIND_LABEL)


@dataclass
class ToolContext:
    """Per-turn scratchpad: UI cards the tools asked for, and a trace of what ran."""
    actions: list[dict[str, Any]] = field(default_factory=list)
    trace: list[dict[str, Any]] = field(default_factory=list)
    today: date | None = None

    def add_action(self, action: dict[str, Any]) -> None:
        if action not in self.actions:
            self.actions.append(action)


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., dict[str, Any]]


def ok(data: Any) -> dict[str, Any]:
    return {"ok": True, "data": data, "error": None}


def fail(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"ok": False, "data": extra or None, "error": {"code": code, "message": message}}


def _form_action(ctx: ToolContext, form_id: str, profile: plan.Profile) -> None:
    ctx.add_action({"type": "form", "formId": form_id, "step": views.step_of_form(form_id, profile)})


def _booking_action(ctx: ToolContext, kind: str) -> None:
    ctx.add_action({"type": "booking", "kind": kind})


def booking_brief(v: dict[str, Any] | None) -> dict[str, Any] | None:
    """What the model may know about a booking request: no IDs it could misuse, no USC ID (payloads never hold one)."""
    if not v:
        return None
    active = v["active_proposal"]
    return {
        "kind": v["kind"], "state": v["state"], "state_label": v["state_label"], "next_action": v["next_action"],
        "missing_keys": [m["key"] for m in v["missing_fields"]],
        "authority": (v["authority"] or {}).get("name"),
        "summary_for_user": v["summary"], "missing_fields": [m["label"] for m in v["missing_fields"]], "blockers": v["blockers"],
        "policy_warnings": [w["message"] for w in v["warnings"]],
        "active_proposal": None if not active else {
            "venue": active["venue_name"], "start": active["time"]["start"], "end": active["time"]["end"], "capacity": active["capacity"],
            "differences_from_request": active["differences"] or ["exactly as requested"], "expires_at": active["expires_at"]},
        "rounds_used": f'{v["rounds"]}/{v["max_rounds"]}',
        "review_status": (v["review"] or {}).get("status"),
        "confirmation_reference": (v["confirmation"] or {}).get("reference"),
        "escalation": (v["escalation"] or {}).get("reason"),
        "recent_agent_messages": [f'{m["type"]} {m["from"].split(":")[0]}: {m["note"]}' for m in v["messages"][-6:]],
        "availability_source": v["source_label"],
    }


def safe_profile(profile: plan.Profile) -> dict[str, Any]:
    """The saved profile as the model may see it: known fields only, private ones masked."""
    out: dict[str, Any] = {}
    for f in plan.FIELDS:
        k = f["key"]
        if not plan.is_filled(profile, k):
            continue
        out[k] = "<set; hidden>" if k in PRIVATE_FIELDS else profile[k]
    return out


def status_summary(state: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    d = plan.derive_state(state, today)
    profile = state.get("profile") or {}
    steps = []
    for s in d["steps"]:
        steps.append({
            "id": s["id"], "n": s["n"], "title": s["title"], "status": s["status"],
            "deadline": s["due"].isoformat() if s["due"] else None,
            "deadline_kind": "official lead time" if s["official"] else "suggested",
            "days_left": s["daysLeft"], "late": s["late"],
            "blocked_by": s["blockedBy"],
            "forms": s["forms"],
            "missing_fields": [m for fid in s["forms"] for m in plan.missing_for(fid, profile)],
            "checklist": [{"key": k, "label": label, "done": bool(s["checks"].get(k))} for k, label in s["substeps"]],
            "recorded": {k: s["data"].get(k) or None for k, _ in s["needsData"]},
        })
    return {
        "today": (today or date.today()).isoformat(),
        "event_date": d["eventDate"].isoformat() if d["eventDate"] else None,
        "days_to_event": d["daysToEvent"],
        "steps_done": f'{d["complete"]}/{d["total"]}',
        "do_now": [s["id"] for s in d["steps"] if s["status"] in ("ready", "active")],
        "waiting_on_reply": [s["id"] for s in d["steps"] if s["status"] == "waiting"],
        "late": [s["id"] for s in d["steps"] if s["late"]],
        "steps": steps,
        "profile": safe_profile(profile),
        "bookings": {k: booking_brief(booking.latest_view(k)) for k in KINDS},
        "recent_activity": [f'{e["at"][:16]} {e["msg"]}' for e in (state.get("log") or [])[:10]],
    }


# ---- handlers -------------------------------------------------------------------------------
def get_event_plan_status(ctx: ToolContext) -> dict[str, Any]:
    return ok(status_summary(store.load(), ctx.today))


def update_event_profile(ctx: ToolContext, fields: dict[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(fields, dict) or not fields:
        return fail("invalid_arguments", "Pass `fields` as an object of profile field → value.")
    accepted: dict[str, Any] = {}
    rejected: dict[str, str] = {}
    for key, value in fields.items():
        if key in PRIVATE_FIELDS:
            rejected[key] = "Not handled in chat. Ask the user to type it in the Event profile tab."
            ctx.add_action({"type": "field", "key": key})
            continue
        coerced, err = plan.coerce_field(key, value)
        if err:
            rejected[key] = err
        else:
            accepted[key] = coerced
    if accepted:
        def apply(s: dict[str, Any]) -> None:
            s["profile"].update(accepted)
            store.add_log(s, f"assistant: profile updated ({', '.join(accepted)})")
        state = store.update(apply)
    else:
        state = store.load()
    d = plan.derive_state(state, ctx.today)
    still_missing = {s["id"]: [plan.short_label(k) for k in s["missing"]] for s in d["steps"]
                     if s["status"] in ("ready", "active") and s["missing"]}
    result = {"saved": accepted, "rejected": rejected, "still_missing_for_current_steps": still_missing}
    return ok(result) if accepted or not rejected else fail("validation_failed", "No field was saved.", **result)


def get_form_details(ctx: ToolContext, form_id: str = "") -> dict[str, Any]:
    form = plan.FORMS.get(form_id)
    if not form:
        return fail("unknown_form", f"Unknown form. Valid ids: {', '.join(plan.FORMS)}")
    profile = store.load().get("profile") or {}
    data = {
        "id": form_id, "name": form["name"], "url": form.get("url"),
        "how": {"agent": "handled by the booking agent workflow (prepare_booking_request); the user confirms and a human reviewer decides",
                "email": "email draft the human sends", "manual": "manual (needs a USC login)"}[form["auto"]],
        "rules": form["rules"],
        "required_fields": [{"key": k, "label": plan.short_label(k)} for k in form["requires"] if plan.field_applies(profile, k)],
        "missing_fields": plan.missing_for(form_id, profile),
        "step": views.step_of_form(form_id, profile),
    }
    if form_id == "vendorList":
        data["caterers_accepted_by_permit_lookup"] = plan.PERMIT_APPROVED_CATERERS
        data["caterer_types"] = plan.CATERER_TYPES
    return ok(data)


def check_caterer(ctx: ToolContext, name: str = "") -> dict[str, Any]:
    q = name.strip().lower()
    if len(q) < 3:
        return fail("invalid_arguments", "Give at least 3 characters of the caterer's name.")
    matches = [c for c in plan.PERMIT_APPROVED_CATERERS if q in c.lower()]
    return ok({
        "query": name, "matches": matches, "accepted_by_permit_lookup": bool(matches),
        "source": "USC Event Permit 'Select Caterer Name' lookup, read Nov 2026. The full approved-vendor sheet needs a USC login.",
        "if_not_listed": "Contact USC Hospitality for a one-time approval (health permit + insurance), due 2 weeks before the event.",
    })


def find_venue_options(profile: plan.Profile, kinds: list[str] | None = None, limit: int = 8) -> dict[str, Any]:
    """Read-only search of every venue office's simulated inventory for the profile's date, time and attendance.

    Rooms are listed by venue type. Exact-time options come first; shifted ones (within timeFlexMinutes) only
    when a venue type has nothing at the exact time. Venue types whose rules rule the date out are reported, not offered.
    """
    kinds = kinds or list(plan.VENUE_KINDS)
    options: list[dict[str, Any]] = []
    excluded: list[str] = []
    now = booking.utcnow()
    for kind in kinds:
        trial = {**profile, "venueKind": kind, "venueChoice1": "", "venueChoice2": "", "acceptAlternate": True}
        payload, _missing, blockers = booking.build_payload("venue_booking", trial, booking_store.load(), "")
        if blockers or not payload["requested_time"]["start"] or not payload["event"]["expected_attendance"]:
            return {"ok": False, "reasons": blockers or ["Need the date, start and end time, and attendance."]}
        rule = inventory.route(kind)
        start = negotiation.parse_requested(payload)["start"]
        issues = policy.request_issues(kind, start.date(), start.time(), now)
        if issues:
            excluded.append(f"{plan.VENUE_KINDS[kind].split(' (')[0]}: {' '.join(i.message for i in issues)}")
            continue
        club = negotiation.ClubNegotiator(payload, rule["authority_id"])
        held = booking.holds(booking_store.load())
        found = []
        for flex in (0, club.flex):
            for v in sorted(club.acceptable_venues(), key=lambda v: v.capacity):
                for sh in negotiation.shifts(flex):
                    o = negotiation.make_option(payload, v, sh)
                    if o.key not in {f["key"] for f in found} and not negotiation.option_problems(payload, o, held):
                        found.append({"key": o.key, "venue": v.name, "venue_id": v.id, "venue_kind": kind,
                                      "authority": inventory.AUTHORITIES[rule["authority_id"]]["name"], "capacity": v.capacity,
                                      "features": list(v.features), "start": o.start.strftime("%H:%M"), "end": o.end.strftime("%H:%M"),
                                      "start_label": negotiation.fmt_time(o.start), "end_label": negotiation.fmt_time(o.end),
                                      "time": negotiation.describe_shift(sh), "shift": sh})
            if found:
                break
        options += found[:3]  # the best-fitting few per venue type
    options.sort(key=lambda o: (abs(o["shift"]), o["capacity"]))
    for o in options:
        o.pop("key")
    return {"ok": True, "options": options[:limit], "options_total": len(options), "excluded": excluded,
            "source": inventory.SOURCE_LABEL, "checked_at": now.isoformat(timespec="seconds")}


def check_venue_availability(ctx: ToolContext) -> dict[str, Any]:
    """Read-only look at what the Venue Scheduling Agent could offer. Creates nothing and holds nothing."""
    profile = store.load().get("profile") or {}
    payload, missing, blockers = booking.build_payload("venue_booking", profile, booking_store.load(), "")
    needed = {"venueKind", "date", "startTime", "endTime", "attendance"}
    gaps = [m["label"] for m in missing if m["key"] in needed]
    if gaps or blockers:
        return fail("not_ready", "Availability needs the venue type, date, times and attendance.", reasons=gaps + blockers)
    rule = inventory.route(payload["requested_space"]["venue_kind"])
    if not rule:
        return fail("routing_unresolved", "No configured venue authority for this venue type.")
    club = negotiation.ClubNegotiator(payload, rule["authority_id"])
    agent = negotiation.VenueSchedulingAgent(rule["authority_id"], payload, booking.holds(booking_store.load()), club)
    options = []
    for v in club.acceptable_venues():
        for sh in negotiation.shifts(club.flex):
            o = negotiation.make_option(payload, v, sh)
            if not negotiation.option_problems(payload, o, agent.holds):
                options.append({"venue": v.name, "capacity": v.capacity, "start": negotiation.fmt_time(o.start), "end": negotiation.fmt_time(o.end),
                                "time": negotiation.describe_shift(sh), "club_preference_rank": club.rank(o)})
    options.sort(key=lambda x: x["club_preference_rank"])
    start = negotiation.parse_requested(payload)["start"]
    return ok({
        "source": inventory.SOURCE_LABEL, "inventory_version": inventory.INVENTORY_VERSION, "checked_at": booking.utcnow().isoformat(timespec="seconds"),
        "authority": inventory.AUTHORITIES[rule["authority_id"]]["name"],
        "first_choice_in_inventory": club.choice1.name if club.choice1 else None,
        "options": options[:6], "options_total": len(options),
        "policy_issues": [i.message for i in policy.request_issues(payload["requested_space"]["venue_kind"], start.date(), start.time(), booking.utcnow())],
        "note": "Nothing is reserved. To book, call prepare_booking_request; the user confirms and the venue agent negotiates.",
    })


def record_step_progress(ctx: ToolContext, step: str = "", check: str | None = None, done: bool | None = None,
                         data_key: str | None = None, data_value: str | None = None) -> dict[str, Any]:
    state = store.load()
    s = next((x for x in plan.build_steps(state.get("profile") or {}) if x["id"] == step), None)
    if not s:
        return fail("unknown_step", f"Unknown step. Valid ids: {', '.join(plan.STEP_IDS)}")
    if not check and not data_key:
        return fail("invalid_arguments", "Pass `check` + `done`, or `data_key` + `data_value`.")
    if check:
        if check not in {k for k, _ in s["substeps"]}:
            return fail("unknown_check", f"Valid checks for {step}: {', '.join(k for k, _ in s['substeps'])}")
        if not isinstance(done, bool):
            return fail("invalid_arguments", "`done` must be true or false.")
    owned = booking.WORKFLOW_OWNED.get(step, {})
    if (check and check in owned.get("checks", ())) or (data_key and data_key in owned.get("data", ())):
        return fail("workflow_owned", "Set by the booking workflow when a reviewer decides; it can't be recorded from chat. Call get_booking_status.")
    if data_key:
        if data_key not in {k for k, _ in s["needsData"]}:
            return fail("unknown_data_key", f"Valid data keys for {step}: {', '.join(k for k, _ in s['needsData']) or 'none'}")
        data_value = (data_value or "").strip()
        rule = plan.STEP_DATA_RULES.get((step, data_key))
        if rule and (err := rule(data_value)):
            return fail("validation_failed", err)

    def apply(st: dict[str, Any]) -> None:
        p = st["progress"].setdefault(step, {"checks": {}, "data": {}})
        if check:
            p["checks"][check] = bool(done)
            store.add_log(st, f"assistant: {step}: {'✓' if done else '✗'} {check}")
        if data_key:
            p["data"][data_key] = data_value
            store.add_log(st, f"assistant: {step}: {data_key} = {data_value}")

    d = plan.derive_state(store.update(apply), ctx.today)
    return ok({"step": step, "status": d["byId"][step]["status"],
               "now_unblocked": [x["id"] for x in d["steps"] if x["status"] == "ready"]})


def prepare_booking_request(ctx: ToolContext, kind: str = "") -> dict[str, Any]:
    if kind not in KINDS:
        return fail("invalid_arguments", f"kind is one of: {', '.join(KINDS)}")
    try:
        v = booking.view(booking.prepare(kind, actor=CLUB_AGENT))
    except booking.BookingError as e:
        _booking_action(ctx, kind)
        return fail(e.code.lower(), e.message, current=booking_brief(booking.latest_view(kind)))
    _booking_action(ctx, kind)
    brief = booking_brief(v)
    if v and v["state"] == "READY_FOR_SUBMISSION":
        return ok({**(brief or {}), "next": "A card with this summary and a 'Confirm & send' button is shown. Nothing is submitted until the user "
                                            "presses it. Read the summary to the user and point out any policy warnings."})
    return fail("needs_information", "The request can't be sent yet.", **(brief or {}))


def get_booking_status(ctx: ToolContext, kind: str = "") -> dict[str, Any]:
    if kind not in KINDS:
        return fail("invalid_arguments", f"kind is one of: {', '.join(KINDS)}")
    v = booking.latest_view(kind)
    if not v:
        return ok({"kind": kind, "state": None, "next": "No request yet. Call prepare_booking_request when the user wants to start."})
    _booking_action(ctx, kind)
    return ok(booking_brief(v))


def request_alternatives(ctx: ToolContext, kind: str = "venue_booking", reason: str = "") -> dict[str, Any]:
    if kind != "venue_booking":
        return fail("invalid_arguments", "Only venue bookings have alternatives.")
    v = booking.latest_view(kind)
    if not v:
        return fail("no_request", "There is no venue booking request yet.")
    try:
        nv = booking.view(booking.request_alternatives(v["id"], str(reason)[:500], f"assistant:{uuid.uuid4()}", actor=CLUB_AGENT))
    except booking.BookingError as e:
        return fail(e.code.lower(), e.message)
    _booking_action(ctx, kind)
    return ok({**(booking_brief(nv) or {}), "next": "The new proposal (if any) is on the card. Only the user can accept it."})


def offer_reset(ctx: ToolContext) -> dict[str, Any]:
    ctx.add_action({"type": "reset"})
    return ok({"next": "A 'Clear this event' button is now shown. Nothing has been cleared. If the user presses it and confirms, "
                       "the profile, progress and activity log are erased and a new event can be planned."})


def draft_email(ctx: ToolContext, form_id: str = "") -> dict[str, Any]:
    form = plan.FORMS.get(form_id)
    if not form or form["auto"] != "email":
        return fail("not_an_email", "Email drafts exist for: " + ", ".join(k for k, f in plan.FORMS.items() if f["auto"] == "email"))
    state = store.load()
    profile = state.get("profile") or {}
    _form_action(ctx, form_id, profile)
    missing = plan.missing_for(form_id, profile)
    if missing:
        return fail("not_ready", "The draft needs more profile fields.", reasons=[f'{m["label"]} ({m["problem"]})' for m in missing])
    return ok({
        "email": form["name"], "to": form.get("to") or profile.get(form.get("to_field", "")),
        "next": "A card with an 'Open email draft' button is now shown to the user. The draft opens in their mail app; nothing has been sent.",
    })


_NO_ARGS: dict[str, Any] = {"type": "object", "properties": {}}
_FORM_ID = {"type": "string", "enum": list(plan.FORMS)}

TOOLS: list[Tool] = [
    Tool("get_event_plan_status",
         "Read the event plan: every step's status, deadline, blockers, checklist, missing profile fields, and the saved profile. "
         "Call this before answering any question about progress, deadlines or what to do next.",
         _NO_ARGS, get_event_plan_status),
    Tool("update_event_profile",
         "Save facts the user stated about the event into the shared event profile (each USC form is filled from it). "
         "Only pass values the user actually gave. Dates are YYYY-MM-DD, times 24-hour HH:MM on the hour or half hour, booleans true/false. "
         "The USC ID cannot be saved here. Field keys: " + ", ".join(f["key"] for f in plan.FIELDS if f["key"] not in PRIVATE_FIELDS)
         + ". venueKind is one of: " + "; ".join(f"{k} = {v}" for k, v in plan.VENUE_KINDS.items()) + ".",
         {"type": "object", "properties": {"fields": {"type": "object", "description": "Profile field key → value"}}, "required": ["fields"]},
         update_event_profile),
    Tool("get_form_details",
         "Rules, lead time notes, required fields and currently missing fields for one form, email or manual step. "
         "For vendorList it also lists the caterers the permit accepts.",
         {"type": "object", "properties": {"form_id": _FORM_ID}, "required": ["form_id"]}, get_form_details),
    Tool("check_caterer",
         "Check whether a caterer is in the Event Permit's approved-caterer lookup.",
         {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}, check_caterer),
    Tool("check_venue_availability",
         "Read-only: which rooms and times the Venue Scheduling Agent could offer for the saved event, from the SIMULATED demo inventory, "
         "plus any lead-time problems. Reserves nothing. Report the source and checked_at, and say a free slot is not a reservation.",
         _NO_ARGS, check_venue_availability),
    Tool("record_step_progress",
         "Record something the user says has happened: tick or untick a checklist item (`check` + `done`), or store a reply detail "
         "(`data_key` + `data_value`, e.g. venue reservationNumber, permit permitCode). Only record what the user told you.",
         {"type": "object", "properties": {
             "step": {"type": "string", "enum": list(plan.STEP_IDS)}, "check": {"type": "string"}, "done": {"type": "boolean"},
             "data_key": {"type": "string"}, "data_value": {"type": "string"}}, "required": ["step"]},
         record_step_progress),
    Tool("prepare_booking_request",
         "Build the venue booking (kind=venue_booking) or event permit (kind=event_permit) request from the profile and show the user a "
         "card with the summary and a 'Confirm & send' button. It does NOT submit: only the user's click does, after which the Venue "
         "Scheduling Agent routes it, checks simulated availability and negotiates. Fails with the missing fields or blockers "
         "(the permit needs a confirmed venue booking).",
         {"type": "object", "properties": {"kind": {"type": "string", "enum": KINDS}}, "required": ["kind"]}, prepare_booking_request),
    Tool("get_booking_status",
         "Current state of the venue booking or permit request: the active proposal and how it differs from the request, the review status, "
         "the confirmation reference, or why it needs a human. Shows the booking card.",
         {"type": "object", "properties": {"kind": {"type": "string", "enum": KINDS}}, "required": ["kind"]}, get_booking_status),
    Tool("request_alternatives",
         "Ask the Venue Scheduling Agent for a different option than the active proposal. Every constraint the user confirmed still applies. "
         "Call only when the user asks for another option.",
         {"type": "object", "properties": {"kind": {"type": "string", "enum": ["venue_booking"]}, "reason": {"type": "string"}},
          "required": ["kind"]}, request_alternatives),
    Tool("offer_reset",
         "Show the user a button that clears the whole event so a new one can be planned. Use only when they ask to start over.",
         _NO_ARGS, offer_reset),
    Tool("draft_email",
         "Check that an email draft is ready and show the user a card that opens it in their mail app. It does not send anything.",
         {"type": "object", "properties": {"form_id": {"type": "string", "enum": [k for k, f in plan.FORMS.items() if f["auto"] == "email"]}},
          "required": ["form_id"]}, draft_email),
]
TOOL_BY_NAME = {t.name: t for t in TOOLS}


def execute(ctx: ToolContext, name: str, args: dict[str, Any]) -> dict[str, Any]:
    tool = TOOL_BY_NAME.get(name)
    if not tool:
        result = fail("unknown_tool", f"No tool named {name}.")
    else:
        try:
            result = tool.handler(ctx, **args)
        except TypeError as e:  # the model passed an argument the tool doesn't take
            result = fail("invalid_arguments", str(e).split(") ", 1)[-1])
    ctx.trace.append({"tool": name, "ok": result["ok"], "error": (result["error"] or {}).get("code")})
    return result
