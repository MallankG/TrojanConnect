"""Event pipeline API: the 7-step event walkthrough (venue → food → permit → funding →
EngageSC → accessibility → publicity).

Backend owns state. Nothing here talks to a USC system: venue bookings and the event permit are
handled by the booking agent workflow (app/workflows/booking, /api/v1/bookings), where a human
reviewer decides and only the backend can confirm. The progress keys that workflow owns (venue
submitted/confirmed and reservation #, permit submitted/approved and code) can't be set here.
"""

from __future__ import annotations

import os
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from app.agents import event_agent, rso_agent, rules_agent
from app.agents.model import ModelError
from app.integrations.gemini import provider as gemini
from app.security.auth import require_club_rep
from app.security.client import require_client_header
from app.tools import event_plan as agent_tools
from app.workflows.booking import service as booking

from . import plan, store, views

router = APIRouter(prefix="/api/v1/pipeline", tags=["event-pipeline"], dependencies=[Depends(require_client_header), Depends(require_club_rep)])

STEP_IDS = {"venue", "food", "permit", "funding", "engage", "access", "publicity"}


class ProgressUpdate(BaseModel):
    step: str
    check: str | None = None
    value: bool | None = None
    dataKey: str | None = None
    dataValue: str | None = None


@router.get("/state")
def get_state() -> dict[str, Any]:
    """Raw saved event: `{profile, progress, log}`. Most UIs want /status instead."""
    return store.load()


# ---- Read models for building a UI (no rule needs re-implementing client-side) --------------
@router.get("/schema")
def get_schema() -> dict[str, Any]:
    """Static definitions: profile fields (label, type, options, group), venue kinds, forms, steps, caterers."""
    return views.schema_view()


@router.get("/status")
def get_status() -> dict[str, Any]:
    """The dashboard: event header, progress, what to do now, and each step with deadline, checklist and forms."""
    return views.status_view(store.load())


@router.get("/profile")
def get_profile() -> dict[str, Any]:
    """The saved profile and, per field, whether it applies, what is wrong with it, and which forms use it."""
    return views.profile_view(store.load())


@router.get("/forms")
def list_forms() -> list[dict[str, Any]]:
    """Every form, email and manual task with live readiness for the saved event."""
    state = store.load()
    return [views.form_view(fid, state) for fid in plan.FORMS]


@router.get("/forms/{form_id}")
def get_form(form_id: str) -> dict[str, Any]:
    form = views.form_view(form_id, store.load())
    if not form:
        raise HTTPException(404, f"Unknown form. Valid ids: {', '.join(plan.FORMS)}")
    return form


@router.get("/emails/{form_id}")
def get_email(form_id: str) -> dict[str, Any]:
    """Draft for an email task: `{to, subject, body, mailto, ready, missing_fields}`. Nothing is sent."""
    email = views.email_view(form_id, store.load())
    if not email:
        raise HTTPException(404, "No email draft for that id. Valid ids: " + ", ".join(k for k, f in plan.FORMS.items() if f["auto"] == "email"))
    return email


@router.get("/caterers")
def get_caterers(q: str = Query(default="", max_length=100)) -> dict[str, Any]:
    """Caterers the Event Permit accepts. With `q`, a case-insensitive name search."""
    return views.caterers_view(q)


@router.get("/activity")
def get_activity(limit: int = Query(default=50, ge=1, le=200)) -> list[dict[str, str]]:
    """Newest-first log of changes: `[{at, msg}]`. Entries made by the assistant start with "assistant:"."""
    return (store.load().get("log") or [])[:limit]


@router.put("/profile")
def put_profile(patch: dict[str, Any]) -> dict[str, Any]:
    return store.update(lambda s: s["profile"].update(patch))


@router.put("/progress")
def put_progress(u: ProgressUpdate) -> dict[str, Any]:
    if u.step not in STEP_IDS:
        raise HTTPException(400, f"Unknown step '{u.step}'")
    owned = booking.WORKFLOW_OWNED.get(u.step, {})
    if (u.check and u.check in owned.get("checks", ())) or (u.dataKey and u.dataKey in owned.get("data", ())):
        raise HTTPException(409, "Set by the booking workflow once a reviewer decides. Use the booking card on this step.")

    def apply(s: dict[str, Any]) -> None:
        p = s["progress"].setdefault(u.step, {"checks": {}, "data": {}})
        if u.check:
            p["checks"][u.check] = bool(u.value)
            store.add_log(s, f"{u.step}: {'✓' if u.value else '✗'} {u.check}")
        if u.dataKey:
            p["data"][u.dataKey] = (u.dataValue or "").strip()
            store.add_log(s, f"{u.step}: {u.dataKey} = {u.dataValue}")

    return store.update(apply)


@router.post("/reset")
def reset() -> dict[str, Any]:
    """Clear the event. Open booking requests are withdrawn; held or confirmed ones go to the reviewer as cancellation requests."""
    if event_id := store.load().get("event_id"):
        booking.cancel_event(event_id)
    return store.reset()


# ---- Event agent ----------------------------------------------------------------------------
class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=60)


def use_rules() -> bool:
    """ASSISTANT_MODE=rules (or no Gemini key): answer with the built-in rule-based Club Agent, no model calls."""
    return os.environ.get("ASSISTANT_MODE", "").lower() == "rules" or not gemini.configured()


def get_model_provider() -> gemini.GeminiProvider | None:
    if use_rules():
        return None
    try:
        return gemini.GeminiProvider()
    except ModelError:
        return None


@router.get("/agent")
def agent_info() -> dict[str, Any]:
    """Which assistant answers (Gemini or the built-in rule-based agent) and what it can do."""
    rules = use_rules()
    return {"configured": True, "mode": "rules" if rules else "gemini", "model": rules_agent.LABEL if rules else gemini.model_id(),
            "tools": [{"name": t.name, "description": t.description.split(". ")[0].rstrip(".") + "."} for t in agent_tools.TOOLS]}


@router.post("/agent/chat")
def agent_chat(req: ChatRequest, provider: gemini.GeminiProvider | None = Depends(get_model_provider)) -> dict[str, Any]:
    """One chat turn. Gemini when configured; otherwise, or if Gemini fails, the rule-based agent. Both act only through validated tools."""
    history = [m.model_dump() for m in req.history]
    if rso_agent.handles(req.message):  # RSO recognition goes to the RSO agent in either assistant mode
        return {**rso_agent.run_turn(req.message, history), "state": store.load()}
    if provider is None:
        return rules_agent.run_turn(req.message, history)
    try:
        return event_agent.run_turn(provider, req.message, history)
    except ModelError as e:
        return rules_agent.run_turn(req.message, history, note=f"Gemini unavailable: {e} Answered by the built-in assistant")
