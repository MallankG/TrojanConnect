"""Persistence for booking requests: Supabase when configured, a local JSON file otherwise.

The service works on one in-memory document per operation (`load()` → mutate → `save(db)`), holding
`lock` for the whole operation. Both backends keep that contract:

- Supabase (supabase/migrations/0004_venue_booking.sql): one `booking_requests` row per request, whose
  `doc` column holds the full request; `booking_idempotency` holds used idempotency keys. `save()`
  upserts only the requests and keys that changed since `load()`.
- JSON: backend/data/bookings.json (git-ignored), the original hackathon store.

BOOKING_STORE picks the backend: `supabase`, `json`, or `auto` (default: Supabase when SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY are set and the table exists; otherwise JSON, with the reason in `status()`).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

from app.workflows.event_pipeline import store as pipeline_store

log = logging.getLogger("trojanconnect.bookings")
lock = threading.RLock()  # held for the whole of each write operation, so writes in this process are serialised

_LOADED = "_loaded"  # private key in the loaded document: {request_id: content hash} as read, for change detection
_client: Any = None
_supabase_problem: str | None = None


# ---- backend selection -------------------------------------------------------------------------
def _supabase_client() -> Any:
    global _client
    if _client is None:
        from supabase import create_client  # lazy: the module imports without keys

        from app.config import get_settings
        s = get_settings()
        _client = create_client(s.supabase_url, s.supabase_service_role_key)
    return _client


def _configured() -> bool:
    try:
        from app.config import get_settings
        return get_settings().use_supabase
    except Exception:  # settings unavailable: behave as unconfigured
        return False


def backend() -> str:
    """"supabase" or "json" for this call. BOOKING_STORE is re-read each time so tests and env changes take effect."""
    mode = os.environ.get("BOOKING_STORE", "auto").lower()
    if mode == "json":
        return "json"
    if not _configured():
        if mode == "supabase":
            raise RuntimeError("BOOKING_STORE=supabase but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.")
        return "json"
    if mode == "supabase":
        return "supabase"
    if _supabase_problem is None:
        _probe()
    return "json" if _supabase_problem else "supabase"


def _probe() -> bool:
    """Check once that the booking table exists, so a missing migration falls back instead of breaking bookings."""
    global _supabase_problem
    try:
        _supabase_client().table("booking_requests").select("id").limit(1).execute()
        _supabase_problem = ""
        return True
    except Exception as e:  # missing table, bad key, network
        _supabase_problem = f"Supabase booking tables unavailable ({str(e)[:160]}). Run supabase/migrations/0004_venue_booking.sql."
        log.warning("Bookings use the local JSON file: %s", _supabase_problem)
        return False


def status() -> dict[str, Any]:
    b = backend()
    if b == "supabase":
        detail = "booking_requests table in Supabase"
    elif os.environ.get("BOOKING_STORE", "auto").lower() == "json":
        detail = "BOOKING_STORE=json"
    elif not _configured():
        detail = "Supabase is not configured"
    else:
        detail = _supabase_problem or "Supabase unavailable"
    return {"store": b, "detail": detail + ("" if b == "supabase" else "; using backend/data/bookings.json")}


def reset_backend_cache() -> None:
    """Forget the probe result (tests, or after applying the migration without restarting)."""
    global _supabase_problem, _client
    _supabase_problem, _client = None, None


# ---- load / save ---------------------------------------------------------------------------------
def _hash(doc: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(doc, sort_keys=True, default=str).encode()).hexdigest()


def path() -> Path:
    return pipeline_store.DATA_DIR / "bookings.json"  # resolved per call so tests can redirect DATA_DIR


def load() -> dict[str, Any]:
    if backend() == "supabase":
        c = _supabase_client()
        rows = c.table("booking_requests").select("id, doc").execute().data or []
        keys = c.table("booking_idempotency").select("key, op, request_id, created_at").execute().data or []
        db = {"requests": {r["id"]: r["doc"] for r in rows},
              "idempotency": {k["key"]: {"op": k["op"], "request_id": k["request_id"], "at": k.get("created_at")} for k in keys}}
    else:
        try:
            db = json.loads(path().read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            db = {}
        db.setdefault("requests", {})
        db.setdefault("idempotency", {})
    db[_LOADED] = {"requests": {rid: _hash(r) for rid, r in db["requests"].items()}, "keys": set(db["idempotency"])}
    return db


def save(db: dict[str, Any]) -> None:
    loaded = db.get(_LOADED) or {"requests": {}, "keys": set()}
    if backend() == "supabase":
        c = _supabase_client()
        changed = [r for rid, r in db["requests"].items() if loaded["requests"].get(rid) != _hash(r)]
        if changed:
            c.table("booking_requests").upsert([{
                "id": r["id"], "kind": r["kind"], "event_id": r["event_id"], "state": r["state"], "version": r["version"],
                "authority_id": r.get("authority_id"), "review_task_id": (r.get("review") or {}).get("task_id"),
                "doc": r, "created_at": r["created_at"], "updated_at": r["updated_at"],
            } for r in changed]).execute()
        new_keys = [k for k in db["idempotency"] if k not in loaded["keys"]]
        if new_keys:
            c.table("booking_idempotency").upsert([{"key": k, "op": db["idempotency"][k]["op"], "request_id": db["idempotency"][k]["request_id"]}
                                                   for k in new_keys]).execute()
        # A key popped by the service (failed accept / denied decision) was never written, so nothing to delete.
    else:
        p = path()
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps({k: v for k, v in db.items() if k != _LOADED}, indent=2))
        tmp.replace(p)
    db[_LOADED] = {"requests": {rid: _hash(r) for rid, r in db["requests"].items()}, "keys": set(db["idempotency"])}
