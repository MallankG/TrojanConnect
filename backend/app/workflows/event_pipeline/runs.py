"""Form pre-fill runs: launch the Node/Playwright filler in a visible browser and keep its log.

The fillers stop on the final page and never press Submit; a human reviews and submits.
"""

from __future__ import annotations

import re
import subprocess
import threading
from typing import Any

from . import store
from .availability import USC_FORMS_DIR, PipelineError, node_path

# formId -> {"running": bool, "lines": [str]}
_runs: dict[str, dict[str, Any]] = {}
_runs_lock = threading.Lock()


def start(form_id: str, started_by: str = "") -> None:
    """Open a browser and pre-fill `form_id` from the saved event. Raises PipelineError if it can't start."""
    node = node_path()
    state = store.load()
    # Deterministic guard: the permit cannot be started without a confirmed venue.
    if form_id == "permit":
        res = state.get("progress", {}).get("venue", {}).get("data", {}).get("reservationNumber", "")
        if not re.fullmatch(r"\d{6}", res or ""):
            raise PipelineError(409, "Record the 6-digit venue reservation number on the Venue step first.")

    with _runs_lock:
        if _runs.get(form_id, {}).get("running"):
            raise PipelineError(409, "That pre-fill is already running.")
        run = _runs[form_id] = {"running": True, "lines": []}

    store.BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [node, "run.mjs", form_id, str(store.STATE_PATH), str(store.BROWSER_PROFILE_DIR)],
        cwd=USC_FORMS_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    store.update(lambda s: store.add_log(s, f"{started_by}pre-fill {form_id} started"))

    def pump() -> None:
        assert proc.stdout
        for line in proc.stdout:
            run["lines"].append(line.rstrip())
        code = proc.wait()
        try:
            store.update(lambda s: store.add_log(s, f"pre-fill {form_id} finished ({'ok' if code == 0 else f'exit {code}'})"))
        finally:
            run["running"] = False  # last, so "not running" means the run has finished writing state

    threading.Thread(target=pump, daemon=True).start()


def status(form_id: str) -> dict[str, Any]:
    return _runs.get(form_id, {"running": False, "lines": []})
