"""Event pipeline API: the 7-step event walkthrough (venue → food → permit → funding →
EngageSC → accessibility → publicity).

Backend owns state. Form pre-fill runs launch the Node/Playwright scripts in
app/integrations/usc_forms, which open a visible browser and STOP before Submit; a human
always reviews and submits. Nothing here confirms or submits a real USC reservation.
"""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.agents import event_agent
from app.agents.model import ModelError
from app.integrations.gemini import provider as gemini
from app.tools import event_plan as agent_tools

from . import plan, runs, store, views
from .availability import PipelineError, read_ee_availability

CLIENT_HEADER = "X-TrojanConnect-Client"


def require_client_header(x_trojanconnect_client: str | None = Header(default=None)) -> None:
    """CSRF guard for every pipeline endpoint (any method).

    A custom header turns every cross-origin request into a CORS-preflighted one, and CORS only
    allows the TrojanConnect frontend origin. This stops a random website from silently resetting
    the event, launching pre-fill browser windows, or triggering the headless calendar scrape
    (GET /ee-availability). CORS preflights (OPTIONS) are answered by the middleware before this
    runs. Not a substitute for real auth (PRD: Supabase Auth + server-side session verification);
    add that dependency here when it lands.
    """
    if x_trojanconnect_client != "web":
        raise HTTPException(403, f"Missing {CLIENT_HEADER} header.")


router = APIRouter(prefix="/api/v1/pipeline", tags=["event-pipeline"], dependencies=[Depends(require_client_header)])

STEP_IDS = {"venue", "food", "permit", "funding", "engage", "access", "publicity"}
RunnableForm = Literal["tcc", "outdoor", "classroom", "eeRoom", "permit"]


class ProgressUpdate(BaseModel):
    step: str
    check: str | None = None
    value: bool | None = None
    dataKey: str | None = None
    dataValue: str | None = None


class RecognitionProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    check: str
    value: bool


RECOGNITION_CHECKS = {
    "group-details",
    "roster-entered",
    "position-instructions-sent",
    "constitution",
    "accountability",
    "organization-details",
    "submitter-designated",
    "officer-guide-shared",
    "advisor-eligibility",
    "advisor-position",
    "advisor-training",
    "advisor-commitment",
    "clery-training",
    "follow-up",
}

RecognitionPathway = Literal[
    "undecided",
    "new",
    "reestablishing",
    "fall_application",
    "religious_spiritual",
    "fraternity_sorority",
]
ApplicationStatus = Literal[
    "not_started",
    "draft",
    "pending_approval",
    "requires_modifications",
    "denied",
    "recognized",
]
OfficerRole = Literal["president", "vicePresident", "secretary", "treasurer", "programmingChair"]
OfficerRequirement = Literal["commitment", "hazingTraining", "learningPath"]


class RecognitionSetupUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pathway: RecognitionPathway | None = None
    engageGroupUrl: str | None = Field(default=None, max_length=500)
    additionalMemberCount: int | None = Field(default=None, ge=0, le=1000)
    acceptedPositionCount: int | None = Field(default=None, ge=0, le=1006)

    @field_validator("engageGroupUrl")
    @classmethod
    def validate_engage_group_url(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return value
        parsed = urlsplit(value)
        if parsed.scheme != "https" or parsed.netloc.lower() != "engage.usc.edu":
            raise ValueError("Group page must be an HTTPS URL on engage.usc.edu.")
        return value


class RecognitionStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ApplicationStatus


class OfficerProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: OfficerRole
    requirement: OfficerRequirement
    value: bool


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

    def apply(s: dict[str, Any]) -> None:
        p = s["progress"].setdefault(u.step, {"checks": {}, "data": {}})
        if u.check:
            p["checks"][u.check] = bool(u.value)
            store.add_log(s, f"{u.step}: {'✓' if u.value else '✗'} {u.check}")
        if u.dataKey:
            p["data"][u.dataKey] = (u.dataValue or "").strip()
            store.add_log(s, f"{u.step}: {u.dataKey} = {u.dataValue}")

    return store.update(apply)


@router.put("/recognition/progress")
def put_recognition_progress(u: RecognitionProgressUpdate) -> dict[str, Any]:
    if u.check not in RECOGNITION_CHECKS:
        raise HTTPException(400, f"Unknown recognition check '{u.check}'")

    def apply(s: dict[str, Any]) -> None:
        recognition = s.setdefault("recognition", store.empty_recognition())
        recognition.setdefault("checks", {})[u.check] = u.value
        store.add_log(s, f"recognition: {'✓' if u.value else '✗'} {u.check}")

    return store.update(apply)


@router.put("/recognition/setup")
def put_recognition_setup(u: RecognitionSetupUpdate) -> dict[str, Any]:
    def apply(s: dict[str, Any]) -> None:
        recognition = s.setdefault("recognition", store.empty_recognition())
        changes = u.model_dump(exclude_unset=True, exclude_none=True)
        recognition.update(changes)
        for key, value in changes.items():
            store.add_log(s, f"recognition setup: {key} = {value}")

    return store.update(apply)


@router.put("/recognition/officer-progress")
def put_officer_progress(u: OfficerProgressUpdate) -> dict[str, Any]:
    def apply(s: dict[str, Any]) -> None:
        officers = s.setdefault("recognition", store.empty_recognition())["officers"]
        officers[u.role][u.requirement] = u.value
        store.add_log(s, f"recognition: {u.role} {u.requirement} {'✓' if u.value else '✗'}")

    return store.update(apply)


@router.put("/recognition/status")
def put_recognition_status(u: RecognitionStatusUpdate) -> dict[str, Any]:
    def apply(s: dict[str, Any]) -> None:
        s.setdefault("recognition", store.empty_recognition())["applicationStatus"] = u.status
        store.add_log(s, f"recognition application status: {u.status}")

    return store.update(apply)


@router.post("/reset")
def reset() -> dict[str, Any]:
    return store.reset()


@router.post("/run/{form_id}")
def start_run(form_id: RunnableForm) -> dict[str, bool]:
    try:
        runs.start(form_id)
    except PipelineError as e:
        raise HTTPException(e.status, e.message) from e
    return {"ok": True}


@router.get("/run/{form_id}")
def get_run(form_id: RunnableForm) -> dict[str, Any]:
    return runs.status(form_id)


@router.get("/ee-availability")
def ee_availability() -> list[dict[str, Any]]:
    """Read the public ECE (EEB/PHE) room calendars for the saved event date/time."""
    try:
        return read_ee_availability(store.load()["profile"])["rooms"]
    except PipelineError as e:
        raise HTTPException(e.status, e.message) from e


# ---- Event agent ----------------------------------------------------------------------------
class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=60)


def get_model_provider() -> gemini.GeminiProvider:
    if not gemini.configured():
        raise HTTPException(503, "The assistant needs a Gemini API key. Set GEMINI_API_KEY in backend/.env and restart the backend.")
    try:
        return gemini.GeminiProvider()
    except ModelError as e:
        raise HTTPException(503, str(e)) from e


@router.get("/agent")
def agent_info() -> dict[str, Any]:
    """Whether the assistant can be used, which model it runs on, and what it can do."""
    return {"configured": gemini.configured(), "model": gemini.model_id(),
            "tools": [{"name": t.name, "description": t.description.split(". ")[0].rstrip(".") + "."} for t in agent_tools.TOOLS]}


@router.post("/agent/chat")
def agent_chat(req: ChatRequest, provider: gemini.GeminiProvider = Depends(get_model_provider)) -> dict[str, Any]:
    """One chat turn with the event agent. It reads and updates the plan through validated tools only."""
    try:
        return event_agent.run_turn(provider, req.message, [m.model_dump() for m in req.history])
    except ModelError as e:
        raise HTTPException(502, str(e)) from e
