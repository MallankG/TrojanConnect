"""Read-only lookup of the public ECE (EEB/PHE) room calendars. Unofficial: nothing is booked."""

from __future__ import annotations

import json
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Any

from . import store

USC_FORMS_DIR = store.BACKEND_ROOT / "app" / "integrations" / "usc_forms"
SOURCE_LABEL = "Live public ECE room calendars (unofficial; a free slot is not a reservation)"


class PipelineError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status, self.message = status, message


def node_path() -> str:
    node = shutil.which("node")
    if not node:
        raise PipelineError(503, "Node.js is required for form pre-fill (install Node 20+).")
    if not (USC_FORMS_DIR / "node_modules" / "playwright").exists():
        raise PipelineError(503, "Run `npm run setup` in backend/app/integrations/usc_forms first.")
    return node


def read_ee_availability(profile: dict[str, Any]) -> dict[str, Any]:
    """Rooms with their bookings on the event date, and whether each is free at the event time."""
    node = node_path()
    if not profile.get("date"):
        raise PipelineError(400, "Set the event date first.")
    args = [node, "ee-availability.mjs", profile["date"], profile.get("startTime") or "", profile.get("endTime") or ""]
    try:
        out = subprocess.run(args, cwd=USC_FORMS_DIR, capture_output=True, text=True, timeout=120, check=True)
    except subprocess.CalledProcessError as e:
        raise PipelineError(502, f"Could not read ECE calendars: {e.stderr.strip()[:300]}") from e
    except subprocess.TimeoutExpired as e:
        raise PipelineError(504, "ECE calendars took too long to respond.") from e
    return {"source": SOURCE_LABEL, "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rooms": json.loads(out.stdout)}
