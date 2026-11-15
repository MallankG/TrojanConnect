"""RSO recognition tracker: what the club has done, what's next, and whether it's ready to submit.

Deterministic: every status here is computed from what the club rep recorded and the rules in process.py.
The application itself is submitted on EngageSC by the submitting officer (USC login); the rep records the
outcome they see there (Pending Approval, Requires Modifications, Denied, Recognized). Nothing here claims an
application was submitted or approved unless the rep recorded it.

Storage: backend/data/rso.json (git-ignored), one organization at a time, like the event pipeline.
"""

from __future__ import annotations

import copy
import json
import re
import threading
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from app.workflows.event_pipeline import store as pipeline_store

from . import process as P

_lock = threading.Lock()

EMPTY: dict[str, Any] = {"pathway": None, "listed_officer": None, "fields": {}, "checks": {}, "status": "not_started", "status_note": "", "log": []}

# Fields the rep fills in (inline `fields` cards with scope "rso", and the RSO tab).
FIELDS: list[dict[str, Any]] = [
    {"key": "organizationName", "label": "Organization name (as it will appear on EngageSC)", "type": "text", "group": "Organization"},
    {"key": "orgPurpose", "label": "Purpose or mission (one or two sentences)", "type": "textarea", "group": "Organization", "optional": True},
    {"key": "submitterRole", "label": "Submitting officer's position", "type": "select", "options": [r for r, _ in P.OFFICER_ROLES],
     "option_labels": dict(P.OFFICER_ROLES), "group": "Submitting officer"},
    {"key": "submitterName", "label": "Submitting officer's name", "type": "text", "group": "Submitting officer"},
    *[f for role, label in P.OFFICER_ROLES for f in (
        {"key": f"{role}Name", "label": f"{label}: name", "type": "text", "group": "Officers"},
        {"key": f"{role}Email", "label": f"{label}: USC email", "type": "email", "group": "Officers"},
    )],
    {"key": "facultyAdvisorName", "label": "Advisor's name", "type": "text", "group": "Advisor"},
    {"key": "facultyAdvisorEmail", "label": "Advisor's USC email", "type": "email", "group": "Advisor"},
    {"key": "facultyAdvisorFullTime", "label": "Advisor is full-time USC faculty or staff, not on sabbatical or leave?", "type": "bool", "group": "Advisor"},
    {"key": "memberCount", "label": f"Additional student members on the roster (besides the officers; at least {P.MIN_ADDITIONAL_MEMBERS})",
     "type": "number", "group": "Roster"},
    {"key": "engageGroupUrl", "label": "Your group's EngageSC page link (renewals)", "type": "text", "group": "Organization", "optional": True},
]
FIELD_BY_KEY = {f["key"]: f for f in FIELDS}

# Checklist items the rep ticks: step checks, per-officer items, advisor items.
CHECK_KEYS: set[str] = (
    {f"step.{s}" for s in ("check_directory", "officer_access", "start_application", "group_details", "constitution", "accountability", "questions")}
    | {f"{role}.{doc}" for role, _ in P.OFFICER_ROLES for doc in ("accepted", *[d for d, _, _ in P.OFFICER_DOCS])}
    | {f"advisor.{i}" for i, _, _ in P.ADVISOR_ITEMS}
)


# ---- storage ----------------------------------------------------------------------------------------
def _path():
    return pipeline_store.DATA_DIR / "rso.json"


def load() -> dict[str, Any]:
    try:
        return {**copy.deepcopy(EMPTY), **json.loads(_path().read_text())}
    except (FileNotFoundError, json.JSONDecodeError):
        return copy.deepcopy(EMPTY)


def _save(state: dict[str, Any]) -> None:
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(p)


def _log(state: dict[str, Any], msg: str, actor: str = "club_rep") -> None:
    state["log"] = [{"at": datetime.now(timezone.utc).isoformat(), "actor": actor, "msg": msg}, *state.get("log", [])][:200]


def update(mutator, actor: str = "club_rep") -> dict[str, Any]:
    with _lock:
        state = load()
        mutator(state)
        _save(state)
        return state


def reset() -> dict[str, Any]:
    with _lock:
        state = copy.deepcopy(EMPTY)
        _save(state)
        return state


class RsoError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ---- writes (validated) -----------------------------------------------------------------------------
def coerce(key: str, value: Any) -> tuple[Any, str | None]:
    f = FIELD_BY_KEY.get(key)
    if not f:
        return None, "Unknown field"
    t = f["type"]
    if t == "bool":
        if isinstance(value, bool):
            return value, None
        v = str(value).strip().lower()
        return (True, None) if v in ("yes", "true", "y") else (False, None) if v in ("no", "false", "n") else (None, "Must be yes or no")
    s = str(value).strip()
    if t == "select" and s and s not in f["options"]:
        return None, f"Allowed values: {', '.join(f['options'])}"
    if t == "number" and s and not re.fullmatch(r"\d{1,4}", s):
        return None, "Must be a whole number"
    if t == "email" and s and not re.fullmatch(r"[^@\s]+@usc\.edu", s, re.I):
        return None, "Use a @usc.edu address (EngageSC adds people by USC email)"
    if len(s) > 500:
        return None, "Too long"
    return s, None


def set_fields(fields: dict[str, Any], actor: str = "club_rep") -> tuple[dict[str, Any], dict[str, str]]:
    saved, rejected = {}, {}
    for k, v in (fields or {}).items():
        val, err = coerce(k, v)
        (rejected.__setitem__(k, err) if err else saved.__setitem__(k, val))
    if saved:
        update(lambda s: (s["fields"].update(saved), _log(s, f"{actor}: updated {', '.join(saved)}", actor)), actor)
    return saved, rejected


def set_pathway(pathway: str, listed_officer: bool | None = None, actor: str = "club_rep") -> dict[str, Any]:
    if pathway not in P.PATHWAYS:
        raise RsoError(400, "UNKNOWN_PATHWAY", f"Pathway is one of: {', '.join(P.PATHWAYS)}")

    def apply(s: dict[str, Any]) -> None:
        s["pathway"] = pathway
        if listed_officer is not None:
            s["listed_officer"] = listed_officer
        if s["status"] == "not_started" and P.PATHWAYS[pathway]["flow"]:
            s["status"] = "in_progress"
        _log(s, f"{actor}: pathway = {pathway}" + ("" if listed_officer is None else f", listed officer = {listed_officer}"), actor)
    return update(apply, actor)


def set_check(key: str, done: bool, actor: str = "club_rep") -> dict[str, Any]:
    if key not in CHECK_KEYS:
        raise RsoError(400, "UNKNOWN_CHECK", "Unknown checklist item.")
    return update(lambda s: (s["checks"].__setitem__(key, bool(done)), _log(s, f"{actor}: {'✓' if done else '✗'} {key}", actor)), actor)


def record_status(status: str, note: str = "", actor: str = "club_rep") -> dict[str, Any]:
    """Record what EngageSC shows: reported by the club rep, or read from the portal itself by the portal agent
    (actor "portal:…"). The RSO chat agent can never record a submission or a decision."""
    if status not in P.RECORDABLE:
        raise RsoError(400, "UNKNOWN_STATUS", f"Record one of: {', '.join(P.RECORDABLE)}")
    if actor != "club_rep" and not actor.startswith("portal:"):
        raise RsoError(403, "PERMISSION_DENIED", "Only the club rep, or a status read from the portal, can record the EngageSC status.")
    return update(lambda s: (s.update(status=status, status_note=note[:500]), _log(s, f"EngageSC status recorded: {P.STATUSES[status]}", actor)), actor)


# ---- derived view -----------------------------------------------------------------------------------
def _filled(state: dict[str, Any], key: str) -> bool:
    v = state["fields"].get(key)
    return v is True or v is False if FIELD_BY_KEY[key]["type"] == "bool" else v not in (None, "")


def _members(state: dict[str, Any]) -> int:
    try:
        return int(state["fields"].get("memberCount") or 0)
    except ValueError:
        return 0


def roster_gaps(state: dict[str, Any]) -> list[str]:
    gaps = [f"{label} name and USC email" for role, label in P.OFFICER_ROLES
            if not (_filled(state, f"{role}Name") and _filled(state, f"{role}Email"))]
    if not (_filled(state, "facultyAdvisorName") and _filled(state, "facultyAdvisorEmail")):
        gaps.append("Advisor name and USC email")
    if state["fields"].get("facultyAdvisorFullTime") is not True:
        gaps.append("Confirm the advisor is full-time faculty or staff (not on sabbatical or leave)")
    if _members(state) < P.MIN_ADDITIONAL_MEMBERS:
        gaps.append(f"At least {P.MIN_ADDITIONAL_MEMBERS} additional student members (now {_members(state)})")
    return gaps


def officer_missing(state: dict[str, Any], role: str) -> list[dict[str, str]]:
    return [{"id": d, "label": label, **P.link(lk)} for d, label, lk in P.OFFICER_DOCS if not state["checks"].get(f"{role}.{d}")]


def _step_done(state: dict[str, Any], sid: str) -> bool:
    c, st = state["checks"], state["status"]
    if sid == "officer_access":
        return bool(state.get("listed_officer")) or bool(c.get("step.officer_access"))
    if sid == "submitter":
        return _filled(state, "submitterRole") and _filled(state, "submitterName")
    if sid == "roster":
        return not roster_gaps(state)
    if sid == "acceptances":
        return all(c.get(f"{r}.accepted") for r, _ in P.OFFICER_ROLES) and bool(c.get("advisor.accepted"))
    if sid == "officer_docs":
        return all(not officer_missing(state, r) for r, _ in P.OFFICER_ROLES)
    if sid == "submit":
        return st in ("pending_approval", "requires_modifications", "denied", "recognized")
    if sid == "advisor":
        return all(c.get(f"advisor.{i}") for i, _, _ in P.ADVISOR_ITEMS if i != "accepted")
    if sid == "review":
        return st == "recognized"
    return bool(c.get(f"step.{sid}"))


# Steps that must be done before the submit step (acceptances and advisor requirements don't block submitting).
_BEFORE_SUBMIT_OPTIONAL = {"acceptances", "advisor", "review", "submit"}


def view(state: dict[str, Any] | None = None, now: datetime | None = None) -> dict[str, Any]:
    state = state or load()
    now = now or datetime.now(timezone.utc)
    pathway = state.get("pathway")
    pw = P.PATHWAYS.get(pathway or "")
    steps = P.steps_for(pathway, listed_officer=state.get("listed_officer"))
    for s in steps:
        s["done"] = _step_done(state, s["id"])
    blockers = [s["title"] for s in steps if not s["done"] and s["id"] not in _BEFORE_SUBMIT_OPTIONAL]
    if steps and not _filled(state, "organizationName"):
        blockers.insert(0, "Organization name")
    if state["status"] in ("pending_approval", "denied", "recognized"):
        blockers.insert(0, f"Already {P.STATUSES[state['status']].split(' (')[0].lower()} on EngageSC")
    deadline = P.DATE_BY_ID["application_deadline"]["at"]
    closed = now > deadline
    nxt = next((s for s in steps if not s["done"] and s["id"] not in ("review",)), None)
    if state["status"] == "requires_modifications":
        nxt = next((s for s in steps if s["id"] == "review"), nxt)
    dates = [{**{k: v for k, v in d.items() if k != "at"}, "at": d["at"].isoformat(),
              "days_left": (d["at"].date() - now.astimezone(P.TZ).date()).days} for d in P.DATES]
    officers = [{"role": r, "label": label, "name": state["fields"].get(f"{r}Name") or "", "email": state["fields"].get(f"{r}Email") or "",
                 "accepted": bool(state["checks"].get(f"{r}.accepted")),
                 "docs": [{"id": d, "label": dl, "done": bool(state["checks"].get(f"{r}.{d}")), **P.link(lk)} for d, dl, lk in P.OFFICER_DOCS]}
                for r, label in P.OFFICER_ROLES]
    advisor = {"name": state["fields"].get("facultyAdvisorName") or "", "email": state["fields"].get("facultyAdvisorEmail") or "",
               "full_time": state["fields"].get("facultyAdvisorFullTime"),
               "items": [{"id": i, "label": label, "done": bool(state["checks"].get(f"advisor.{i}")), **(P.link(lk) if lk else {})}
                         for i, label, lk in P.ADVISOR_ITEMS]}
    handoff = None
    if pw and pw["flow"]:
        group_url = state["fields"].get("engageGroupUrl") or ""
        if pw["flow"] == "new":
            button = "+Register a new Office of Religious and Spiritual Life" if pathway == "religious" else "+Register a new Recognized Student Organization"
            handoff = {"title": "Continue on EngageSC", "url": P.L["engage_directory"]["url"], "label": "Open the EngageSC Directory",
                       "steps": [f"Click \"{button}\"", "Use a laptop or desktop", "The submitting officer completes and submits the form"]}
        else:
            handoff = {"title": "Continue on EngageSC", "url": group_url or P.L["engage_home"]["url"],
                       "label": "Open your group's EngageSC page" if group_url else "Open EngageSC",
                       "steps": ["Find your group (Groups search) if the link isn't saved", "Review the blue box and scroll down to begin",
                                 "Use a laptop or desktop"]}
    return {
        "cycle": P.CYCLE, "source": {**P.link("process"), "checked": P.SOURCE_CHECKED},
        "pathway": pathway, "pathway_label": pw["label"] if pw else None, "pathway_detail": pw["detail"] if pw else None,
        "listed_officer": state.get("listed_officer"),
        "status": state["status"], "status_label": P.STATUSES[state["status"]], "status_note": state.get("status_note") or "",
        "fields": state["fields"], "steps": steps,
        "steps_done": sum(1 for s in steps if s["done"]), "steps_total": len(steps),
        "next_step": nxt, "ready_to_submit": bool(steps) and not blockers and not closed, "submit_blockers": blockers,
        "application_closed": closed, "dates": dates, "officers": officers, "advisor": advisor, "roster_gaps": roster_gaps(state),
        "members": _members(state), "min_members": P.MIN_ADDITIONAL_MEMBERS, "handoff": handoff, "portal": state.get("portal"),
        "log": state.get("log", [])[:30],
    }


def schema() -> dict[str, Any]:
    return {
        "cycle": P.CYCLE, "source_checked": P.SOURCE_CHECKED,
        "fields": FIELDS, "field_groups": list(dict.fromkeys(f["group"] for f in FIELDS)),
        "pathways": [{"id": k, **v} for k, v in P.PATHWAYS.items()],
        "steps": {"new": P.steps_for("new"), "renew": P.steps_for("renew", listed_officer=False)},
        "officer_roles": [{"id": r, "label": l} for r, l in P.OFFICER_ROLES],
        "officer_docs": [{"id": d, "label": l, **P.link(k)} for d, l, k in P.OFFICER_DOCS],
        "advisor_items": [{"id": i, "label": l, **(P.link(k) if k else {})} for i, l, k in P.ADVISOR_ITEMS],
        "dates": [{**{k: v for k, v in d.items() if k != "at"}, "at": d["at"].isoformat()} for d in P.DATES],
        "sessions": P.SESSIONS, "contact": P.CONTACT, "denial_reasons": P.DENIAL_REASONS,
        "open_membership_rules": P.OPEN_MEMBERSHIP_RULES, "application_questions": P.APPLICATION_QUESTIONS,
        "discrepancies": P.DISCREPANCIES, "statuses": P.STATUSES, "links": [{"key": k, **v} for k, v in P.L.items()],
    }


# ---- email drafts (the rep sends them; nothing is sent by the app) ---------------------------------
def email(target: str, state: dict[str, Any] | None = None) -> dict[str, Any]:
    state = state or load()
    org = state["fields"].get("organizationName") or "our RSO"
    me = state["fields"].get("submitterName") or "[your name]"
    deadline = P.DEADLINE
    if target == "advisor":
        to = state["fields"].get("facultyAdvisorEmail") or ""
        items = [i for i in view(state)["advisor"]["items"] if not i["done"] and i["id"] != "accepted"]
        body = (f"Hello,\n\nThank you for advising {org}. For our {P.CYCLE}, USC asks advisors to complete these by {P.ADVISOR_DUE}:\n\n"
                "- Accept the advisor position from the EngageSC email (mailer@campusgroups.com), on a laptop or desktop.\n"
                + "".join(f"- {i['label']}: {i.get('url', '')}\n" for i in items)
                + f"\nUSC doesn't accept these by email; they go through the advisor form. Details: {P.L['process']['url']}\n\nThank you,\n{me}\n{org}")
        subject = f"{org}: advisor requirements for RSO recognition (due {P.ADVISOR_DUE})"
    elif target in P.ROLE_LABEL:
        to = state["fields"].get(f"{target}Email") or ""
        name = state["fields"].get(f"{target}Name") or ""
        missing = officer_missing(state, target)
        body = (f"Hi{(' ' + name) if name else ''},\n\nFor {org}'s {P.CYCLE} application, I still need these from you as "
                f"{P.ROLE_LABEL[target].lower()}:\n\n" + "".join(f"- {m['label']}: {m['url']}\n" for m in missing)
                + f"\nComplete the trainings {P.TRAINING_WINDOW} (sign in with USC SSO; read the \"Using This Course\" module first). "
                "Sign the Commitment to Community with your full name, the RSO name and your position.\n"
                "Please also accept your officer position from the EngageSC email (mailer@campusgroups.com) on a laptop or desktop.\n\n"
                f"Send the certificates and the signed form to me. The application closes {deadline}; late applications aren't accepted.\n\nThanks,\n{me}")
        subject = f"{org}: your RSO officer documents (due before {P.when('application_deadline')})"
    else:
        raise RsoError(404, "UNKNOWN_EMAIL", "Email drafts exist for: advisor, " + ", ".join(P.ROLE_LABEL))
    return {"target": target, "to": to, "subject": subject, "body": body,
            "mailto": f"mailto:{quote(to)}?subject={quote(subject)}&body={quote(body)}", "ready": bool(to)}


def summary_for_pipeline() -> dict[str, Any]:
    """Shown on the event pipeline's EngageSC step: an RSO must be recognized to create EngageSC events."""
    v = view()
    return {"status": v["status"], "status_label": v["status_label"], "recognized": v["status"] == "recognized",
            "organization": v["fields"].get("organizationName") or None}
