"""Persistence for the event pipeline.

Hackathon storage: a single JSON document at backend/data/event_pipeline.json. The shape
({event_id, profile, progress, log}) maps directly onto future Supabase tables (event_profiles,
event_step_progress, audit_log) — swap this module when the database lands. Booking requests live
in app/workflows/booking/store.py.
"""

from __future__ import annotations

import copy
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[3]
# DATA_DIR env: hosts with a read-only app directory (Vercel) point this at /tmp.
DATA_DIR = Path(os.environ.get("DATA_DIR") or BACKEND_ROOT / "data")
STATE_PATH = DATA_DIR / "event_pipeline.json"

EMPTY_STATE: dict[str, Any] = {
    "profile": {
        "attendance": "",
        "audience": ["Students"],
        "food": True,
        "amplifiedSound": False,
        "filmed": False,
        "acceptAlternate": True,
        "timeFlexMinutes": "60",
        "vendorServes": False,
        "paymentType": "PO",
    },
    "progress": {},
    "log": [],
}

_lock = threading.Lock()


def load() -> dict[str, Any]:
    try:
        return json.loads(STATE_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return copy.deepcopy(EMPTY_STATE)


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
        save(state)
        return state
