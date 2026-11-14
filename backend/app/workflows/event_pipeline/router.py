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

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import store

router = APIRouter(prefix="/api/v1/pipeline", tags=["event-pipeline"])

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
