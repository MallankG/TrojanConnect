"""Tools the event agent may call: one per feature in docs/event-pipeline.md.

What holds no matter what the model asks for:
- Nothing is submitted automatically. `start_prefill` opens a visible browser and the filler stops
  on the final page; a human reviews and presses Submit. `draft_email` opens a draft, never sends.
- Clearing the event is a button the user presses, not something the model can do.
- The USC ID never passes through the model, in either direction.

Each tool returns the standard result `{ok, data, error}`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable

from app.workflows.event_pipeline import plan, runs, store, views
from app.workflows.event_pipeline.availability import PipelineError, read_ee_availability

PRIVATE_FIELDS = views.PRIVATE_FIELDS  # never sent to or accepted from the model


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


def _form_action(ctx: ToolContext, form_id: str, profile: plan.Profile, running: bool = False) -> None:
    ctx.actions[:] = [a for a in ctx.actions if not (a["type"] == "form" and a["formId"] == form_id)]
    ctx.actions.append({"type": "form", "formId": form_id, "step": views.step_of_form(form_id, profile), "running": running})


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
        "how": {"prefill": "auto pre-fill in a visible browser; the human reviews and submits",
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


def check_room_availability(ctx: ToolContext) -> dict[str, Any]:
    profile = store.load().get("profile") or {}
    if profile.get("venueKind") != "eeb_phe":
        return fail("not_available", "Availability can only be read for EEB / PHE conference rooms (venue type eeb_phe). "
                                     "Other venues have no public calendar; the venue office answers after the request.")
    try:
        return ok(read_ee_availability(profile))
    except PipelineError as e:
        return fail("availability_unavailable", e.message)


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


def start_prefill(ctx: ToolContext, form_id: str = "") -> dict[str, Any]:
    if form_id not in plan.RUNNABLE_FORMS:
        return fail("not_prefillable", f"Only these forms can be pre-filled: {', '.join(plan.RUNNABLE_FORMS)}")
    state = store.load()
    profile = state.get("profile") or {}
    step, reasons = views.readiness(form_id, state, ctx.today)
    if step:
        _form_action(ctx, form_id, profile)
    if reasons:
        return fail("not_ready", "The pre-fill can't start yet.", reasons=reasons)
    try:
        runs.start(form_id, started_by="assistant: ")
    except PipelineError as e:
        return fail("could_not_start", e.message)
    _form_action(ctx, form_id, profile, running=True)
    return ok({
        "form": plan.FORMS[form_id]["name"], "started": True,
        "next": "A visible browser window is opening on the user's computer and filling the form; its log shows on the card in the chat. "
                "It stops on the final page and has NOT been submitted. The user reviews every answer, ticks the attestations and presses Submit.",
    })


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
    Tool("check_room_availability",
         "Read the public EEB / PHE room calendars for the saved event date and time. Only works when venueKind is eeb_phe. "
         "Unofficial and read-only: report the source and checked_at with the answer.",
         _NO_ARGS, check_room_availability),
    Tool("record_step_progress",
         "Record something the user says has happened: tick or untick a checklist item (`check` + `done`), or store a reply detail "
         "(`data_key` + `data_value`, e.g. venue reservationNumber, permit permitCode). Only record what the user told you.",
         {"type": "object", "properties": {
             "step": {"type": "string", "enum": list(plan.STEP_IDS)}, "check": {"type": "string"}, "done": {"type": "boolean"},
             "data_key": {"type": "string"}, "data_value": {"type": "string"}}, "required": ["step"]},
         record_step_progress),
    Tool("start_prefill",
         "Kick off a venue booking request or the event permit: opens a visible browser on the user's computer and pre-fills the USC "
         "form from the profile. It stops before Submit; the user reviews and submits. Fails with reasons if fields are missing, "
         "the step is blocked, or (permit) no 6-digit reservation number is recorded. Call it only when the user asks to start the form.",
         {"type": "object", "properties": {"form_id": {"type": "string", "enum": list(plan.RUNNABLE_FORMS)}}, "required": ["form_id"]},
         start_prefill),
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
