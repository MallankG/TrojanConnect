"""Persistence for booking requests.

Hackathon storage: one JSON document at backend/data/bookings.json holding every request (with its
proposals, agent messages, review task and audit timeline) and the idempotency keys already used. Maps
onto the PRD §13 tables booking_requests, booking_proposals, agent_messages, review_tasks,
approval_events, bookings and audit_logs. Swap this module when Supabase lands.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from app.workflows.event_pipeline import store as pipeline_store

lock = threading.RLock()  # held for the whole of each write operation, so writes are serialised


def path() -> Path:
    return pipeline_store.DATA_DIR / "bookings.json"  # resolved per call so tests can redirect DATA_DIR


def load() -> dict[str, Any]:
    try:
        db = json.loads(path().read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        db = {}
    db.setdefault("requests", {})
    db.setdefault("idempotency", {})
    return db


def save(db: dict[str, Any]) -> None:
    p = path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(db, indent=2))
    tmp.replace(p)
