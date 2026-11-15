"""Simulated EngageSC portal for demos (/mock-engagesc). NOT a USC system and not a copy of EngageSC.

It reproduces only the flow the RSO process page describes, so the RSO portal agent can be shown end to end
with dummy data, without creating fake records on the real EngageSC:

    sign in → Directory → "+Register a new Recognized Student Organization"   (new RSO)
                        → group page → "Begin re-registration"                (renewal)
    → application form (roster, advisor, documents, questions) → submit → My Activity status
    → simulated Campus Activities review page sets Approved / Requires Modifications / Denied

Server-rendered HTML with stable element ids, so the browser agent (portal_agent.py) can drive it like a person.
State lives in backend/data/mock_engagesc.json. Enabled unless RSO_PORTAL=off.
"""

from __future__ import annotations

import html
import json
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Cookie, Form, HTTPException, Request
from starlette.datastructures import UploadFile  # request.form() yields Starlette's class, not FastAPI's subclass
from fastapi.responses import HTMLResponse, RedirectResponse

from app.workflows.event_pipeline import store as pipeline_store

from . import process as P

router = APIRouter(prefix="/mock-engagesc", tags=["simulated-engagesc"], include_in_schema=True)
_lock = threading.Lock()
SEED_GROUPS = ["Demo Chess Collective", "Demo Film Society", "Demo Debate Union"]  # existing groups, for the renewal demo
STATUSES = ["Pending Approval", "Requires Modifications", "Denied", "Approved"]


def enabled() -> bool:
    return os.environ.get("RSO_PORTAL", "mock").lower() != "off"


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _path():
    return pipeline_store.DATA_DIR / "mock_engagesc.json"


def load() -> dict[str, Any]:
    try:
        db = json.loads(_path().read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        db = {}
    db.setdefault("sessions", {})
    db.setdefault("applications", {})
    db.setdefault("groups", {_slug(n): {"name": n, "slug": _slug(n), "recognized_until": "2026-06-30 (lapsed)"} for n in SEED_GROUPS})
    return db


def save(db: dict[str, Any]) -> None:
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(db, indent=2))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---- page shell ------------------------------------------------------------------------------------
CSS = """
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f5f5;color:#111}
.banner{background:#111;color:#fff;padding:8px 16px;font-size:13px}
.banner b{color:#ffcc00}
header{background:#fff;border-bottom:1px solid #e2e2e2;padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header strong{font-size:18px} header a{color:#333}
main{max-width:860px;margin:24px auto;padding:0 16px}
.card{background:#fff;border:1px solid #e2e2e2;border-radius:14px;padding:18px;margin-bottom:16px}
.blue{background:#e8f0fe;border:1px solid #9bb7f0;border-radius:12px;padding:14px;margin-bottom:16px}
label{display:block;font-size:13px;color:#444;margin:10px 0 4px}
input[type=text],input[type=email],input[type=number],input[type=password],select,textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid #ccc;border-radius:8px;font:inherit}
textarea{min-height:60px}
button,.btn{background:#990000;color:#fff;border:0;border-radius:999px;padding:9px 16px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
.btn.secondary{background:#fff;color:#111;border:1px solid #ccc}
table{width:100%;border-collapse:collapse;font-size:14px} td,th{border-bottom:1px solid #eee;padding:8px;text-align:left}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px} @media(max-width:600px){.grid{grid-template-columns:1fr}}
.status{font-weight:600} .err{color:#b42318}
"""


def page(title: str, body: str, user: str | None = None) -> HTMLResponse:
    nav = ('<a href="/mock-engagesc/directory">Directory</a> <a href="/mock-engagesc/my-activity">My Activity</a> '
           f'<span style="color:#767676">Signed in as {html.escape(user)}</span>') if user else ""
    return HTMLResponse(f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} · Simulated EngageSC</title><style>{CSS}</style></head><body>
<div class="banner" role="note"><b>Simulated EngageSC (demo)</b>: not a USC system. Trojan Connect uses this to demonstrate the RSO portal
agent with dummy data. Nothing here reaches USC. The real portal is engage.usc.edu.</div>
<header><strong>Simulated EngageSC</strong>{nav}</header><main>{body}</main></body></html>""")


def _user(session: str | None) -> str | None:
    return load()["sessions"].get(session or "")


def _to_login() -> RedirectResponse:
    return RedirectResponse("/mock-engagesc/login", 303)


# ---- sign in -----------------------------------------------------------------------------------------
@router.get("", response_class=HTMLResponse)
@router.get("/", response_class=HTMLResponse)
def home(mock_session: str | None = Cookie(default=None)):
    return RedirectResponse("/mock-engagesc/directory" if _user(mock_session) else "/mock-engagesc/login", 303)


@router.get("/login", response_class=HTMLResponse)
def login_page():
    return page("Sign in", """<div class="card"><h1>Sign in</h1><p>Demo only: any username and password work (e.g. <code>demo.officer</code> / <code>demo</code>).
The real EngageSC uses USC single sign-on.</p><form method="post" action="/mock-engagesc/login">
<label for="username">Username</label><input id="username" name="username" type="text" required>
<label for="password">Password</label><input id="password" name="password" type="password" required>
<p><button id="sign-in" type="submit">Sign in</button></p></form></div>""")


@router.post("/login")
def login(username: str = Form(...), password: str = Form(...)):
    token = secrets.token_hex(16)
    with _lock:
        db = load()
        db["sessions"][token] = username.strip()[:60] or "demo.officer"
        save(db)
    r = RedirectResponse("/mock-engagesc/directory", 303)
    r.set_cookie("mock_session", token, httponly=True, samesite="lax", path="/mock-engagesc")
    return r


# ---- directory and group pages ----------------------------------------------------------------------
@router.get("/directory", response_class=HTMLResponse)
def directory(q: str = "", mock_session: str | None = Cookie(default=None)):
    user = _user(mock_session)
    if not user:
        return _to_login()
    groups = load()["groups"].values()
    hits = [g for g in groups if q.strip().lower() in g["name"].lower()] if q else list(groups)
    rows = "".join(f'<tr><td><a class="group-link" href="/mock-engagesc/groups/{g["slug"]}">{html.escape(g["name"])}</a></td>'
                   f'<td>{html.escape(g.get("recognized_until", ""))}</td></tr>' for g in hits) or '<tr><td colspan="2" id="no-results">No groups found.</td></tr>'
    return page("Directory", f"""<div class="card"><h1>Directory</h1>
<form method="get" action="/mock-engagesc/directory"><label for="q">Search groups</label><input id="q" name="q" type="text" value="{html.escape(q)}">
<p><button id="search" type="submit" class="btn secondary">Search</button></p></form>
<table><thead><tr><th>Group</th><th>Recognized until</th></tr></thead><tbody id="results">{rows}</tbody></table></div>
<div class="blue"><a id="register-new" class="btn" href="/mock-engagesc/register">+Register a new Recognized Student Organization</a>
<a id="register-orsl" class="btn secondary" href="/mock-engagesc/register?religious=1">+Register a new Office of Religious and Spiritual Life</a></div>""", user)


@router.get("/groups/{slug}", response_class=HTMLResponse)
def group(slug: str, mock_session: str | None = Cookie(default=None)):
    user = _user(mock_session)
    if not user:
        return _to_login()
    g = load()["groups"].get(slug)
    if not g:
        raise HTTPException(404, "No such group")
    return page(g["name"], f"""<div class="blue"><h1>{html.escape(g["name"])}</h1>
<p>Recognition for all previously recognized RSOs ended June 30, 2026. Officers re-register below.</p>
<a id="begin-reregistration" class="btn" href="/mock-engagesc/register?group={slug}">Begin re-registration</a></div>""", user)


# ---- the application ---------------------------------------------------------------------------------
@router.get("/register", response_class=HTMLResponse)
def register_form(group: str = "", religious: str = "", mock_session: str | None = Cookie(default=None)):
    user = _user(mock_session)
    if not user:
        return _to_login()
    g = load()["groups"].get(group) if group else None
    officers = "".join(f"""<label for="{r}_name">{l}: name</label><input id="{r}_name" name="{r}_name" type="text" required>
<label for="{r}_email">{l}: USC email</label><input id="{r}_email" name="{r}_email" type="email" required>""" for r, l in P.OFFICER_ROLES)
    roles = "".join(f'<option value="{r}">{l}</option>' for r, l in P.OFFICER_ROLES)
    questions = "".join(f'<label for="q{i}">{html.escape(q)}</label><textarea id="q{i}" name="q{i}" required></textarea>'
                        for i, q in enumerate(P.APPLICATION_QUESTIONS))
    kind = "Re-registration" if g else ("New ORSL registration" if religious else "New RSO registration")
    return page(kind, f"""<form class="card" method="post" action="/mock-engagesc/register" enctype="multipart/form-data">
<h1>{kind}{(": " + html.escape(g["name"])) if g else ""}</h1><input type="hidden" name="group" value="{html.escape(group)}">
<h2>Group details</h2><label for="org_name">Organization name</label><input id="org_name" name="org_name" type="text" value="{html.escape(g["name"]) if g else ""}" required>
<label for="purpose">Mission and goals</label><textarea id="purpose" name="purpose" required></textarea>
<h2>Submitting officer</h2><div class="grid"><div><label for="submitter_role">Position</label><select id="submitter_role" name="submitter_role">{roles}</select></div>
<div><label for="submitter_name">Name</label><input id="submitter_name" name="submitter_name" type="text" required></div></div>
<h2>Roster</h2><div class="grid">{officers}</div>
<div class="grid"><div><label for="advisor_name">Advisor: name</label><input id="advisor_name" name="advisor_name" type="text" required></div>
<div><label for="advisor_email">Advisor: USC email</label><input id="advisor_email" name="advisor_email" type="email" required></div></div>
<label for="member_count">Additional student members</label><input id="member_count" name="member_count" type="number" min="5" required>
<h2>Documents</h2><label for="constitution">Constitution (2026–27 template)</label><input id="constitution" name="constitution" type="file" required>
<label for="accountability">Accountability Document</label><input id="accountability" name="accountability" type="file" required>
<label for="officer_docs">Officer documents (15 files: Hazing Prevention 101, Learning Path, Commitment to Community for each officer)</label>
<input id="officer_docs" name="officer_docs" type="file" multiple required>
<h2>Application questions</h2>{questions}
<label><input id="certify" name="certify" type="checkbox" value="yes" required> I certify this information is accurate.</label>
<p><button id="submit-application" type="submit">Submit</button></p></form>""", user)


@router.post("/register", response_class=HTMLResponse)
async def register(request: Request, mock_session: str | None = Cookie(default=None)):
    user = _user(mock_session)
    if not user:
        return _to_login()
    form = await request.form()
    officer_files = [f for f in form.getlist("officer_docs") if isinstance(f, UploadFile) and f.filename]
    errors = []
    if len(officer_files) < 15:
        errors.append(f"Upload all 15 officer documents ({len(officer_files)} received).")
    for k in ("constitution", "accountability"):
        if not (isinstance(form.get(k), UploadFile) and form.get(k).filename):
            errors.append(f"The {k} document is missing.")
    count = str(form.get("member_count") or "0").strip()
    if not count.isdigit() or int(count) < P.MIN_ADDITIONAL_MEMBERS:
        errors.append(f"At least {P.MIN_ADDITIONAL_MEMBERS} additional members are required.")
    if errors:
        return page("Fix your application", '<div class="card err" id="errors"><h1>Fix your application</h1><ul>'
                    + "".join(f"<li>{html.escape(e)}</li>" for e in errors) + '</ul><a href="javascript:history.back()">Back</a></div>', user)
    app_id = f"APP-{secrets.randbelow(900000) + 100000}"
    record = {
        "id": app_id, "org_name": str(form.get("org_name")), "group": str(form.get("group") or ""), "submitted_by": user,
        "kind": "renewal" if form.get("group") else "new", "submitted_at": _now(), "status": "Pending Approval",
        "fields": {k: str(v) for k, v in form.items() if not isinstance(v, UploadFile)},
        "files": [f.filename for f in officer_files] + [form.get("constitution").filename, form.get("accountability").filename],
        "history": [{"at": _now(), "status": "Pending Approval", "by": user}],
    }
    with _lock:
        db = load()
        db["applications"][app_id] = record
        save(db)
    return page("Submitted", f"""<div class="card"><h1>Application submitted</h1>
<p>Application ID: <strong id="application-id">{app_id}</strong></p><p>Status: <span class="status" id="application-status">Pending Approval</span></p>
<p>A Campus Activities staff member will review it in the order received. Track it under <a href="/mock-engagesc/my-activity">My Activity</a>.</p></div>""", user)


@router.get("/my-activity", response_class=HTMLResponse)
def my_activity(mock_session: str | None = Cookie(default=None)):
    user = _user(mock_session)
    if not user:
        return _to_login()
    apps = sorted(load()["applications"].values(), key=lambda a: a["submitted_at"], reverse=True)
    rows = "".join(f'<tr id="row-{a["id"]}"><td>{a["id"]}</td><td>{html.escape(a["org_name"])}</td><td>{a["kind"]}</td>'
                   f'<td class="status" data-status="{a["status"]}">{a["status"]}</td><td>{html.escape(a.get("note", ""))}</td></tr>' for a in apps) \
        or '<tr><td colspan="5">No forms submitted yet.</td></tr>'
    return page("My Activity", f"""<div class="card"><h1>My Activity: Surveys/Forms</h1>
<table><thead><tr><th>ID</th><th>Organization</th><th>Type</th><th>Status</th><th>Note from staff</th></tr></thead><tbody>{rows}</tbody></table></div>""", user)


# ---- simulated Campus Activities review ----------------------------------------------------------
@router.get("/admin", response_class=HTMLResponse)
def admin():
    apps = sorted(load()["applications"].values(), key=lambda a: a["submitted_at"], reverse=True)
    rows = "".join(f"""<tr><td>{a["id"]}</td><td>{html.escape(a["org_name"])}</td><td>{a["kind"]}</td><td class="status">{a["status"]}</td>
<td><form method="post" action="/mock-engagesc/admin/{a["id"]}" style="display:flex;gap:6px;flex-wrap:wrap">
<input type="text" name="note" placeholder="Note to the officer" style="width:180px">
{''.join(f'<button name="status" value="{s}" class="btn{" secondary" if s != "Approved" else ""}">{s}</button>' for s in STATUSES[1:])}</form></td></tr>"""
                   for a in apps) or '<tr><td colspan="5">No applications yet.</td></tr>'
    return page("Campus Activities review", f"""<div class="card"><h1>Simulated Campus Activities review</h1>
<p>Stands in for the staff member who reviews applications. Choose a decision for an application.</p>
<table><thead><tr><th>ID</th><th>Organization</th><th>Type</th><th>Status</th><th>Decision</th></tr></thead><tbody>{rows}</tbody></table></div>""")


@router.post("/admin/{app_id}")
def admin_decide(app_id: str, status: str = Form(...), note: str = Form(default="")):
    if status not in STATUSES:
        raise HTTPException(400, "Unknown status")
    with _lock:
        db = load()
        a = db["applications"].get(app_id)
        if not a:
            raise HTTPException(404, "No such application")
        a["status"], a["note"] = status, note[:300]
        a["history"].append({"at": _now(), "status": status, "by": "Campus Activities (simulated)", "note": note[:300]})
        if status == "Approved":
            slug = _slug(a["org_name"])
            db["groups"][slug] = {"name": a["org_name"], "slug": slug, "recognized_until": "2027-06-30"}
        save(db)
    return RedirectResponse("/mock-engagesc/admin", 303)


def set_status(app_id: str, status: str, note: str = "") -> None:
    """For tests and scripted demos: what the review page does."""
    admin_decide(app_id, status, note)
