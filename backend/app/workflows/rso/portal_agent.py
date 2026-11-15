"""RSO portal agent: drives a browser through the (simulated) EngageSC portal like a person would.

Submit: sign in → Directory → "+Register a new Recognized Student Organization" (new), or search → group page →
"Begin re-registration" (renewal) → fill the form from the RSO tracker → upload the documents → submit → read the
application ID. Status: sign in → My Activity → read the application's status, and update the tracker.

Only the simulated portal (mock_portal.py) is supported. Pointing this at the real EngageSC would need USC's
authorization (PRD §7.3 #8–9); the adapter seam (`PortalAdapter`) is where an authorized connection would go.

Runs in a background thread with a live log (GET /api/v1/rso/portal). Started only by the club rep's click
(POST /api/v1/rso/portal/submit); the RSO agent can show the button but can't press it.

Settings: RSO_PORTAL (mock | off), RSO_PORTAL_BASE_URL (default http://localhost:8000/mock-engagesc),
RSO_PORTAL_SHOW_BROWSER (true opens a visible Chrome window; default headless).
"""

from __future__ import annotations

import re

import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Protocol

from app.workflows.event_pipeline import store as pipeline_store

from . import mock_portal
from . import process as P
from . import service as rso

STATUS_MAP = {"Pending Approval": "pending_approval", "Requires Modifications": "requires_modifications",
              "Denied": "denied", "Approved": "recognized"}
ACTOR = "portal:simulated-engagesc"

Log = Callable[[str], None]


class PortalError(Exception):
    pass


class PortalAdapter(Protocol):
    name: str
    integration_mode: str  # "simulated" | "live"

    def submit(self, view: dict[str, Any], log: Log) -> dict[str, Any]: ...

    def fetch_status(self, application_id: str, log: Log) -> dict[str, Any]: ...


def base_url() -> str:
    return os.environ.get("RSO_PORTAL_BASE_URL", "http://localhost:8000/mock-engagesc").rstrip("/")


def _documents(view: dict[str, Any]) -> dict[str, Any]:
    """Placeholder PDFs standing in for the real documents (demo data)."""
    folder = pipeline_store.DATA_DIR / "rso_documents"
    folder.mkdir(parents=True, exist_ok=True)

    def pdf(name: str, title: str) -> str:
        p = folder / name
        text = f"DEMO PLACEHOLDER - {title} - not a real document"
        p.write_bytes(b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj "
                      b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj "
                      + f"4 0 obj<</Length {len(text) + 30}>>stream\nBT /F1 12 Tf 72 720 Td ({text}) Tj ET\nendstream endobj ".encode()
                      + b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")
        return str(p)

    officer = [pdf(f"{o['role']}-{d['id']}.pdf", f"{o['label']} {d['label']}") for o in view["officers"] for d in o["docs"]]
    return {"constitution": pdf("constitution-2026-27.pdf", "Constitution"), "accountability": pdf("accountability-2026.pdf", "Accountability Document"),
            "officer_docs": officer}


class SimulatedEngageBrowser:
    """Playwright + the installed Google Chrome, against the simulated portal."""
    name = "simulated-engagesc"
    integration_mode = "simulated"

    def _browser(self, p: Any) -> Any:
        show = os.environ.get("RSO_PORTAL_SHOW_BROWSER", "").lower() in ("1", "true", "yes")
        opts = {"headless": not show, "slow_mo": 250 if show else 0}
        try:
            return p.chromium.launch(channel="chrome", **opts)
        except Exception:  # no Google Chrome: a system Chromium (Replit's Nix package), else Playwright's download
            system = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("chromium-browser")
            return p.chromium.launch(executable_path=system, **opts) if system else p.chromium.launch(**opts)

    def _sign_in(self, page: Any, log: Log) -> None:
        log(f"Opening the simulated EngageSC portal ({base_url()})")
        page.goto(f"{base_url()}/login")
        log("Signing in (demo credentials; the real portal uses USC single sign-on)")
        page.fill("#username", "demo.officer")
        page.fill("#password", "demo")
        page.click("#sign-in")
        page.wait_for_url("**/directory**")

    def submit(self, view: dict[str, Any], log: Log) -> dict[str, Any]:
        from playwright.sync_api import sync_playwright

        f = view["fields"]
        name = str(f.get("organizationName") or "").strip()
        flow = P.PATHWAYS[view["pathway"]]["flow"]
        docs = _documents(view)
        with sync_playwright() as p:
            browser = self._browser(p)
            page = browser.new_page()
            try:
                self._sign_in(page, log)
                log(f"Searching the Directory for \"{name}\"")
                page.fill("#q", name)
                page.click("#search")
                if not name:
                    raise PortalError("The organization name is empty.")
                hits = page.locator("a.group-link").filter(has_text=re.compile(rf"^\s*{re.escape(name)}\s*$", re.I))  # exact name, not a substring
                if flow == "new":
                    if hits.count():
                        raise PortalError(f"\"{name}\" already exists in the Directory. Renew it instead of registering a new RSO.")
                    button = "#register-orsl" if view["pathway"] == "religious" else "#register-new"
                    log("Not in the Directory. Clicking \"+Register a new " + ("Office of Religious and Spiritual Life" if view["pathway"] == "religious"
                                                                              else "Recognized Student Organization") + "\"")
                    page.click(button)
                else:
                    if not hits.count():
                        raise PortalError(f"\"{name}\" isn't in the Directory, so it can't be renewed. Check the name, or register it as a new RSO.")
                    log("Opening the group page and clicking \"Begin re-registration\"")
                    hits.first.click()
                    page.click("#begin-reregistration")
                page.wait_for_selector("#org_name")
                log("Filling group details")
                page.fill("#org_name", name)
                page.fill("#purpose", str(f.get("orgPurpose") or f"{name} brings students together around a shared interest (demo text)."))
                page.select_option("#submitter_role", str(f.get("submitterRole") or "president"))
                page.fill("#submitter_name", str(f.get("submitterName") or ""))
                log("Filling the roster: 5 officers, the advisor and the member count")
                for o in view["officers"]:
                    page.fill(f"#{o['role']}_name", o["name"])
                    page.fill(f"#{o['role']}_email", o["email"])
                page.fill("#advisor_name", view["advisor"]["name"])
                page.fill("#advisor_email", view["advisor"]["email"])
                page.fill("#member_count", str(view["members"]))
                log(f"Uploading the constitution, the Accountability Document and {len(docs['officer_docs'])} officer documents (placeholders)")
                page.set_input_files("#constitution", docs["constitution"])
                page.set_input_files("#accountability", docs["accountability"])
                page.set_input_files("#officer_docs", docs["officer_docs"])
                log("Answering the application questions (demo answers)")
                for i, q in enumerate(P.APPLICATION_QUESTIONS):
                    page.fill(f"#q{i}", f"Demo answer: {q.lower()} — to be confirmed by the submitting officer.")
                page.check("#certify")
                log("Submitting the application")
                page.click("#submit-application")
                if page.locator("#errors").count():
                    raise PortalError("The portal rejected the application: " + page.inner_text("#errors"))
                app_id = page.inner_text("#application-id").strip()
                status = page.inner_text("#application-status").strip()
                log(f"Submitted. Application {app_id}: {status}")
                return {"application_id": app_id, "portal_status": status}
            finally:
                browser.close()

    def fetch_status(self, application_id: str, log: Log) -> dict[str, Any]:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = self._browser(p)
            page = browser.new_page()
            try:
                self._sign_in(page, log)
                log("Opening My Activity")
                page.goto(f"{base_url()}/my-activity")
                row = page.locator(f"#row-{application_id}")
                if not row.count():
                    raise PortalError(f"Application {application_id} isn't in My Activity.")
                status = row.locator("td.status").inner_text().strip()
                note = row.locator("td").nth(4).inner_text().strip()
                log(f"Application {application_id}: {status}" + (f" — note: {note}" if note else ""))
                return {"application_id": application_id, "portal_status": status, "note": note}
            finally:
                browser.close()


def get_adapter() -> PortalAdapter | None:
    return SimulatedEngageBrowser() if mock_portal.enabled() else None


# ---- runs (one at a time) ----------------------------------------------------------------------------
_run: dict[str, Any] = {"running": False, "kind": None, "lines": [], "error": None}
_run_lock = threading.Lock()


def run_status() -> dict[str, Any]:
    state = rso.load()
    a = get_adapter()
    return {"enabled": a is not None, "mode": a.integration_mode if a else None, "base_url": base_url(), "admin_url": f"{base_url()}/admin",
            **{k: _run[k] for k in ("running", "kind", "error")}, "lines": list(_run["lines"]), "application": state.get("portal")}


def _start(kind: str, work: Callable[[Log], None]) -> dict[str, Any]:
    with _run_lock:
        if _run["running"]:
            raise rso.RsoError(409, "PORTAL_BUSY", "The portal agent is already running.")
        _run.update(running=True, kind=kind, lines=[], error=None)

    def log(msg: str) -> None:
        _run["lines"].append(f"{datetime.now().strftime('%H:%M:%S')}  {msg}")

    def go() -> None:
        try:
            work(log)
        except Exception as e:  # shown in the card; the tracker is left unchanged
            _run["error"] = str(e)[:400]
            log(f"Stopped: {_run['error']}")
        finally:
            _run["running"] = False

    threading.Thread(target=go, daemon=True).start()
    return run_status()


def start_submit() -> dict[str, Any]:
    """The club rep pressed "Submit through the portal". Checks readiness first, then runs in the background."""
    adapter = get_adapter()
    if not adapter:
        raise rso.RsoError(409, "PORTAL_OFF", "The simulated portal is turned off (RSO_PORTAL=off). Submit on EngageSC yourself.")
    view = rso.view()
    portal = rso.load().get("portal") or {}
    if (portal.get("application_id") or view["status"] in ("pending_approval", "denied", "recognized")) and view["status"] != "requires_modifications":
        raise rso.RsoError(409, "ALREADY_SUBMITTED", f"Already submitted ({portal.get('application_id') or view['status_label']}). Check its status instead.")
    if not view["ready_to_submit"]:
        raise rso.RsoError(409, "NOT_READY", "Not ready to submit: " + "; ".join(view["submit_blockers"] or ["the application window is closed"]))

    def work(log: Log) -> None:
        result = adapter.submit(view, log)
        _record(result, log, submitted=True)

    return _start("submit", work)


def start_sync() -> dict[str, Any]:
    adapter = get_adapter()
    portal = rso.load().get("portal") or {}
    if not adapter or not portal.get("application_id"):
        raise rso.RsoError(409, "NOTHING_TO_CHECK", "Nothing has been submitted through the portal yet.")

    def work(log: Log) -> None:
        _record(adapter.fetch_status(portal["application_id"], log), log)

    return _start("sync", work)


def _record(result: dict[str, Any], log: Log, submitted: bool = False) -> None:
    status = STATUS_MAP.get(result["portal_status"])
    if not status:
        raise PortalError(f"Unknown portal status \"{result['portal_status']}\"")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    def keep(s: dict[str, Any]) -> None:
        p = s.get("portal") or {}
        p.update(application_id=result["application_id"], portal_status=result["portal_status"], note=result.get("note", ""),
                 last_checked=now, mode="simulated", base_url=base_url())
        if submitted:
            p["submitted_at"] = now
        s["portal"] = p
    rso.update(keep, actor=ACTOR)
    if rso.load()["status"] != status:
        rso.record_status(status, result.get("note", ""), actor=ACTOR)
        log(f"Trojan Connect status updated: {P.STATUSES[status]}")
    else:
        log("Trojan Connect status unchanged")


def documents_folder() -> Path:
    return pipeline_store.DATA_DIR / "rso_documents"
