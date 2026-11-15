"""JSON views of the event plan for a UI: everything a client needs to render and drive the
pipeline without re-implementing any rule. Built from plan.py (rules) + store (saved event) + the
booking workflow (venue and permit requests).
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any
from urllib.parse import quote

from app.workflows.booking import service as booking

from . import plan

STATUS_LABELS = {"done": "Done", "ready": "Ready to start", "active": "In progress", "waiting": "Waiting on reply",
                 "blocked": "Blocked", "skipped": "Not needed"}
MODE_LABELS = {"agent": "venue agent", "email": "email draft", "manual": "manual"}
FORM_KIND = {fid: ("event_permit" if fid == "permit" else "venue_booking") for fid in plan.AGENT_FORMS}
# Entered by the user in the profile form only; never sent to or accepted from the assistant.
PRIVATE_FIELDS = {"uscId"}


def step_of_form(form_id: str, profile: plan.Profile) -> str | None:
    if form_id == "hospitality":
        return "food"
    return next((s["id"] for s in plan.build_steps(profile) if form_id in s["forms"]), None)


def readiness(form_id: str, state: dict[str, Any], today: date | None = None) -> tuple[dict[str, Any] | None, list[str]]:
    """The derived step a form belongs to, and the reasons it can't be started yet (empty = ready)."""
    profile = state.get("profile") or {}
    d = plan.derive_state(state, today)
    step_id = step_of_form(form_id, profile)
    step = d["byId"].get(step_id) if step_id else None
    reasons: list[str] = []
    if not step:
        reasons.append("This form doesn't apply to the venue type in the profile.")
    elif step["status"] == "blocked":
        reasons.append("Finish first: " + ", ".join(d["byId"][b]["title"] for b in step["blockedBy"]))
    missing = plan.missing_for(form_id, profile)
    if missing:
        reasons.append("Missing or invalid profile fields: " + ", ".join(f'{m["label"]} ({m["problem"]})' for m in missing))
    if form_id == "permit" and not re.fullmatch(r"\d{6}", d["byId"]["venue"]["data"].get("reservationNumber") or ""):
        reasons.append("The venue booking must be confirmed by the venue reviewer first.")
    return step, reasons


def form_view(form_id: str, state: dict[str, Any], today: date | None = None) -> dict[str, Any] | None:
    """One form / email / manual task with live readiness for the saved event."""
    form = plan.FORMS.get(form_id)
    if not form:
        return None
    profile = state.get("profile") or {}
    step, reasons = readiness(form_id, state, today)
    out: dict[str, Any] = {
        "id": form_id, "name": form["name"], "mode": form["auto"], "mode_label": MODE_LABELS[form["auto"]], "url": form.get("url"),
        "step": step["id"] if step else None,
        "rules": form["rules"],
        "required_fields": [{"key": k, "label": plan.short_label(k)} for k in form["requires"] if plan.field_applies(profile, k)],
        "missing_fields": plan.missing_for(form_id, profile),
        "ready": not reasons, "not_ready_reasons": reasons,
        "agent": form_id in plan.AGENT_FORMS,
    }
    if out["agent"]:
        b = booking.latest_view(FORM_KIND[form_id])
        out["booking_kind"] = FORM_KIND[form_id]
        out["booking"] = None if not b else {"id": b["id"], "state": b["state"], "state_label": b["state_label"], "next_action": b["next_action"]}
    return out


def email_view(form_id: str, state: dict[str, Any]) -> dict[str, Any] | None:
    """The draft a human sends. `mailto` opens it in their mail app; the app never sends email."""
    profile = state.get("profile") or {}
    draft = plan.email_draft(form_id, profile)
    if not draft:
        return None
    missing = plan.missing_for(form_id, profile)
    return {
        "id": form_id, "name": plan.FORMS[form_id]["name"], **draft,
        "mailto": f'mailto:{quote(draft["to"])}?subject={quote(draft["subject"])}&body={quote(draft["body"])}',
        "ready": not missing, "missing_fields": missing,
    }


def status_view(state: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    """The whole dashboard: event header, progress, what to do now, and every step with its forms."""
    today = today or date.today()
    d = plan.derive_state(state, today)
    profile = state.get("profile") or {}
    steps = []
    for s in d["steps"]:
        steps.append({
            "id": s["id"], "n": s["n"], "title": s["title"], "owner": s["owner"], "blurb": s["blurb"],
            "status": s["status"], "status_label": STATUS_LABELS[s["status"]], "done": s["done"], "skipped": s["skip"],
            "blocked_by": [{"id": b, "title": d["byId"][b]["title"]} for b in s["blockedBy"]],
            "deadline": s["due"].isoformat() if s["due"] else None, "deadline_official": s["official"],
            "lead_days": s["lead"], "days_left": s["daysLeft"], "late": s["late"],
            "checklist": [{"key": k, "label": label, "done": bool(s["checks"].get(k))} for k, label in s["substeps"]],
            "checklist_done": s["nDone"], "checklist_total": len(s["substeps"]),
            "data_fields": [{"key": k, "label": label, "value": s["data"].get(k, "")} for k, label in s["needsData"]],
            "missing_fields": [{"key": k, "label": plan.short_label(k)} for k in s["missing"]],
            "forms": [form_view(fid, state, today) for fid in s["forms"]],
        })
    by_status = lambda *wanted: [s["id"] for s in steps if s["status"] in wanted]  # noqa: E731
    start, end = plan.to12h(profile.get("startTime")), plan.to12h(profile.get("endTime"))
    return {
        "today": today.isoformat(),
        "event": {
            "name": profile.get("eventName") or None, "organization": profile.get("orgName") or None,
            "date": d["eventDate"].isoformat() if d["eventDate"] else None,
            "start": start or None, "end": end or None,
            "venue": profile.get("venueChoice1") or None,
            "venue_kind": profile.get("venueKind") or None,
            "venue_kind_label": plan.VENUE_KINDS.get(profile.get("venueKind") or ""),
            "attendance": profile.get("attendance") or None,
            "serving_food": profile.get("food"),
        },
        "days_to_event": d["daysToEvent"],
        "steps_done": d["complete"], "steps_total": d["total"], "percent_done": round(100 * d["complete"] / d["total"]),
        "do_now": by_status("ready", "active"), "waiting_on_reply": by_status("waiting"),
        "late": [s["id"] for s in steps if s["late"]],
        "rso": _rso_summary(),
        "missing_field_count": len({m["key"] for s in steps if not s["done"] and not s["skipped"] for m in s["missing_fields"]}),
        "steps": steps,
    }


def _rso_summary() -> dict[str, Any] | None:
    try:
        from app.workflows.rso.service import summary_for_pipeline
        return summary_for_pipeline()
    except Exception:  # the RSO tracker is optional for the event plan
        return None


def profile_view(state: dict[str, Any]) -> dict[str, Any]:
    """The saved profile plus, per field, whether it currently applies and what is wrong with it."""
    profile = state.get("profile") or {}
    used_by: dict[str, list[str]] = {}
    for fid, form in plan.FORMS.items():
        for k in form["requires"]:
            used_by.setdefault(k, []).append(fid)
    fields = []
    for f in plan.FIELDS:
        k = f["key"]
        applies = plan.field_applies(profile, k)
        problem = plan.field_problem(profile, k) if applies else None
        fields.append({"key": k, "value": profile.get(k), "applies": applies,
                       "problem": None if (f["optional"] and problem == "missing") else problem, "used_by_forms": used_by.get(k, [])})
    return {"profile": profile, "fields": fields}


def schema_view() -> dict[str, Any]:
    """Static definitions: nothing here depends on the saved event. Safe to cache per page load."""
    return {
        "fields": [{
            "key": f["key"], "label": f["label"], "short_label": plan.short_label(f["key"]), "group": f["group"], "type": f["type"],
            "options": f["options"], "option_labels": plan.VENUE_KINDS if f["key"] == "venueKind" else None,
            "optional": f["optional"], "only_when_serving_food": f["when"] is not None, "private": f["key"] in PRIVATE_FIELDS,
        } for f in plan.FIELDS],
        "field_groups": list(dict.fromkeys(f["group"] for f in plan.FIELDS)),
        "venue_kinds": [{"id": k, "label": label, "form": plan.VENUE_FORM[k], "lead_days": plan.VENUE_LEAD_DAYS[k]}
                        for k, label in plan.VENUE_KINDS.items()],
        "forms": [{"id": fid, "name": f["name"], "mode": f["auto"], "mode_label": MODE_LABELS[f["auto"]], "url": f.get("url"),
                   "requires": f["requires"], "rules": f["rules"], "agent": fid in plan.AGENT_FORMS}
                  for fid, f in plan.FORMS.items()],
        "steps": [{"id": s["id"], "n": s["n"], "title": s["title"], "owner": s["owner"],
                   "checklist": [{"key": k, "label": label} for k, label in s["substeps"]],
                   "data_fields": [{"key": k, "label": label} for k, label in s["needsData"]]} for s in plan.build_steps({})],
        "statuses": [{"id": k, "label": v} for k, v in STATUS_LABELS.items()],
        "approved_caterers": plan.PERMIT_APPROVED_CATERERS,
        "caterer_types": plan.CATERER_TYPES,
    }


def caterers_view(query: str = "") -> dict[str, Any]:
    q = query.strip().lower()
    matches = [c for c in plan.PERMIT_APPROVED_CATERERS if q in c.lower()] if q else plan.PERMIT_APPROVED_CATERERS
    return {
        "query": query, "matches": matches, "accepted_by_permit_lookup": bool(matches) if q else None,
        "source": "USC Event Permit 'Select Caterer Name' lookup, read Nov 2026. The full approved-vendor sheet needs a USC login.",
        "if_not_listed": "Contact USC Hospitality for a one-time approval (health permit + insurance), due 2 weeks before the event.",
    }
