"""Records for student government and club outreach: feedback, questions, announcements, club posts,
government sources added by representatives.

One generic table, `campus_records` (supabase/migrations/0005_campus.sql), with a JSON fallback at
backend/data/campus.json when Supabase is not configured or the table is missing. Same selection rule
as the booking store: CAMPUS_STORE = auto | supabase | json.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.workflows.event_pipeline import store as pipeline_store

log = logging.getLogger("trojanconnect.campus")
lock = threading.RLock()
_client: Any = None
_problem: Optional[str] = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _supabase() -> Any:
    global _client
    if _client is None:
        from supabase import create_client

        from app.config import get_settings
        s = get_settings()
        _client = create_client(s.supabase_url, s.supabase_service_role_key)
    return _client


def backend() -> str:
    global _problem
    mode = os.environ.get("CAMPUS_STORE", "auto").lower()
    if mode == "json":
        return "json"
    try:
        from app.config import get_settings
        configured = get_settings().use_supabase
    except Exception:
        configured = False
    if not configured:
        return "json"
    if mode == "supabase":
        return "supabase"
    if _problem is None:
        try:
            _supabase().table("campus_records").select("id").limit(1).execute()
            _problem = ""
        except Exception as e:  # missing table, bad key, network
            _problem = f"campus_records unavailable ({str(e)[:120]}); run supabase/migrations/0005_campus.sql"
            log.warning("Campus records use the local JSON file: %s", _problem)
    return "json" if _problem else "supabase"


def reset_backend_cache() -> None:
    global _problem, _client
    _problem, _client = None, None


def _path():
    return pipeline_store.DATA_DIR / "campus.json"


def _read_json() -> list[dict[str, Any]]:
    try:
        return json.loads(_path().read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _write_json(rows: list[dict[str, Any]]) -> None:
    _path().parent.mkdir(parents=True, exist_ok=True)
    _path().write_text(json.dumps(rows, indent=1, default=str))


def add(kind: str, scope: str, doc: dict[str, Any]) -> dict[str, Any]:
    row = {"id": doc.get("id") or str(uuid.uuid4()), "kind": kind, "scope": scope, "created_at": _now()}
    row["doc"] = {**doc, "id": row["id"], "created_at": row["created_at"]}
    with lock:
        if backend() == "supabase":
            _supabase().table("campus_records").insert(row).execute()
        else:
            rows = _read_json()
            rows.append(row)
            _write_json(rows)
    return row["doc"]


def update(record_id: str, patch: dict[str, Any]) -> Optional[dict[str, Any]]:
    with lock:
        if backend() == "supabase":
            found = _supabase().table("campus_records").select("doc").eq("id", record_id).limit(1).execute().data
            if not found:
                return None
            doc = {**found[0]["doc"], **patch}
            _supabase().table("campus_records").update({"doc": doc}).eq("id", record_id).execute()
            return doc
        rows = _read_json()
        for r in rows:
            if r["id"] == record_id:
                r["doc"] = {**r["doc"], **patch}
                _write_json(rows)
                return r["doc"]
        return None


def list_records(kind: str, scopes: Optional[list[str]] = None, limit: int = 200) -> list[dict[str, Any]]:
    """Newest first."""
    if backend() == "supabase":
        q = _supabase().table("campus_records").select("doc, scope").eq("kind", kind)
        if scopes is not None:
            if not scopes:
                return []
            q = q.in_("scope", scopes)
        return [r["doc"] for r in (q.order("created_at", desc=True).limit(limit).execute().data or [])]
    rows = [r for r in _read_json() if r["kind"] == kind and (scopes is None or r["scope"] in scopes)]
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    return [r["doc"] for r in rows[:limit]]
