"""Persistence for the event pipeline.

Hackathon storage: a single JSON document at backend/data/event_pipeline.json. The shape
({profile, progress, recognition, log}) maps directly onto future Supabase tables
(event_profiles, event_step_progress, recognition_progress, audit_log) — swap this module when
the database lands.
"""

from __future__ import annotations

import copy
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = BACKEND_ROOT / "data"
STATE_PATH = DATA_DIR / "event_pipeline.json"
BROWSER_PROFILE_DIR = DATA_DIR / "browser-profile"

OFFICER_ROLES = ("president", "vicePresident", "secretary", "treasurer", "programmingChair")
OFFICER_REQUIREMENTS = ("commitment", "hazingTraining", "learningPath")


def empty_recognition() -> dict[str, Any]:
    return {
        "cycle": "2026-27",
        "pathway": "undecided",
        "engageGroupUrl": "",
        "additionalMemberCount": 0,
        "acceptedPositionCount": 0,
        "applicationStatus": "not_started",
        "checks": {},
        "officers": {
            role: {requirement: False for requirement in OFFICER_REQUIREMENTS}
            for role in OFFICER_ROLES
        },
    }


EMPTY_STATE: dict[str, Any] = {
    "profile": {
        "attendance": "",
        "audience": ["Students"],
        "food": True,
        "amplifiedSound": False,
        "filmed": False,
        "acceptAlternate": True,
        "vendorServes": False,
        "paymentType": "PO",
    },
    "progress": {},
    "recognition": empty_recognition(),
    "log": [],
}

_lock = threading.Lock()


def load() -> dict[str, Any]:
    try:
        state = json.loads(STATE_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return copy.deepcopy(EMPTY_STATE)
    recognition = state.setdefault("recognition", empty_recognition())
    defaults = empty_recognition()
    for key, value in defaults.items():
        recognition.setdefault(key, copy.deepcopy(value))
    for role, requirements in defaults["officers"].items():
        officer = recognition["officers"].setdefault(role, {})
        for requirement, value in requirements.items():
            officer.setdefault(requirement, value)
    return state


def save(state: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_PATH)


def add_log(state: dict[str, Any], msg: str) -> None:
    entry = {"at": datetime.now(timezone.utc).isoformat(), "msg": msg}
    state["log"] = [entry, *state.get("log", [])][:200]


def update(mutator) -> dict[str, Any]:
    """Load, apply `mutator(state)`, save, and return the new state atomically."""
    with _lock:
        state = load()
        mutator(state)
        save(state)
        return state


def reset() -> dict[str, Any]:
    with _lock:
        state = copy.deepcopy(EMPTY_STATE)
        state["recognition"] = load().get("recognition", empty_recognition())
        save(state)
        return state
