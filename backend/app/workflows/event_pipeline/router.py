"""Event pipeline API: the 7-step event walkthrough (venue → food → permit → funding →
EngageSC → accessibility → publicity).

Backend owns state. Form pre-fill runs launch the Node/Playwright scripts in
app/integrations/usc_forms, which open a visible browser and STOP before Submit; a human
always reviews and submits. Nothing here confirms or submits a real USC reservation.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
from typing import Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import store

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

USC_FORMS_DIR = store.BACKEND_ROOT / "app" / "integrations" / "usc_forms"

STEP_IDS = {"venue", "food", "permit", "funding", "engage", "access", "publicity"}
RunnableForm = Literal["tcc", "outdoor", "classroom", "eeRoom", "permit"]

# formId -> {"running": bool, "lines": [str]}
_runs: dict[str, dict[str, Any]] = {}
_runs_lock = threading.Lock()


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

def _node() -> str:
    node = shutil.which("node")
    if not node:
        raise HTTPException(503, "Node.js is required for form pre-fill (install Node 20+).")
    if not (USC_FORMS_DIR / "node_modules" / "playwright").exists():
        raise HTTPException(503, "Run `npm run setup` in backend/app/integrations/usc_forms first.")
    return node


@router.get("/state")
def get_state() -> dict[str, Any]:
    return store.load()


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
    node = _node()
    state = store.load()
    # Deterministic guard: the permit cannot be started without a confirmed venue.
    if form_id == "permit":
        res = state.get("progress", {}).get("venue", {}).get("data", {}).get("reservationNumber", "")
        if not re.fullmatch(r"\d{6}", res or ""):
            raise HTTPException(409, "Record the 6-digit venue reservation number on the Venue step first.")

    with _runs_lock:
        if _runs.get(form_id, {}).get("running"):
            raise HTTPException(409, "That pre-fill is already running.")
        run = _runs[form_id] = {"running": True, "lines": []}

    store.BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [node, "run.mjs", form_id, str(store.STATE_PATH), str(store.BROWSER_PROFILE_DIR)],
        cwd=USC_FORMS_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    store.update(lambda s: store.add_log(s, f"pre-fill {form_id} started"))

    def pump() -> None:
        assert proc.stdout
        for line in proc.stdout:
            run["lines"].append(line.rstrip())
        code = proc.wait()
        run["running"] = False
        store.update(lambda s: store.add_log(s, f"pre-fill {form_id} finished ({'ok' if code == 0 else f'exit {code}'})"))

    threading.Thread(target=pump, daemon=True).start()
    return {"ok": True}


@router.get("/run/{form_id}")
def get_run(form_id: RunnableForm) -> dict[str, Any]:
    return _runs.get(form_id, {"running": False, "lines": []})


@router.get("/ee-availability")
def ee_availability() -> list[dict[str, Any]]:
    """Read the public ECE (EEB/PHE) room calendars for the saved event date/time."""
    node = _node()
    p = store.load()["profile"]
    if not p.get("date"):
        raise HTTPException(400, "Set the event date first.")
    args = [node, "ee-availability.mjs", p["date"], p.get("startTime") or "", p.get("endTime") or ""]
    try:
        out = subprocess.run(args, cwd=USC_FORMS_DIR, capture_output=True, text=True, timeout=120, check=True)
    except subprocess.CalledProcessError as e:
        raise HTTPException(502, f"Could not read ECE calendars: {e.stderr.strip()[:300]}") from e
    except subprocess.TimeoutExpired as e:
        raise HTTPException(504, "ECE calendars took too long to respond.") from e
    return json.loads(out.stdout)
