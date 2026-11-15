"""RSO agent: walks a club through USC RSO recognition, for a new organization or a renewal.

Rule-based and deterministic, like the built-in Club Agent. It reads plain requests ("start a new RSO",
"renew our RSO", "what's next for our RSO?", "RSO officer documents"), updates the tracker in
app/workflows/rso through validated calls, and answers with text plus the Assistant's cards.

Limits it keeps (the same as the booking agent's):
- It never submits anything to EngageSC and never records a submission or a decision. The submitting officer
  submits on EngageSC; the club rep records the outcome with the `rso_status` card's buttons.
- Every USC-login step is a hand-off link (`handoff` card or step links).

Cards it returns, besides `options`, `fields` (scope "rso") and `suggestions`:
- {"type": "rso_checklist", "section": "steps" | "officers" | "advisor" | "step", "step": <id>?}
- {"type": "handoff", "title", "url", "label", "steps": [...]}: continue on EngageSC
- {"type": "rso_email", "target": "advisor" | <officer role>}: email draft (opens in the mail app)
- {"type": "rso_status"}: buttons to record what EngageSC shows
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from app.workflows.rso import process as P
from app.workflows.rso import service as rso

LABEL = "rso-rules"
# Whole words/phrases only: a bare substring test would send "35 person event" (pe-rso-n) to the RSO agent.
TRIGGERS = re.compile(r"\b(rsos?|recognition|recognized student org\w*|get(ting)? recognized|recognition process|re-?recogni\w*|"
                      r"new student org\w*|new club|start a club|register (a|our) (club|student org\w*)|"
                      r"renew\w* (our|the|my|an?) (existing )?(club|org\w*|group|student org\w*)|re-?register|reapply|engagesc application|"
                      r"accountability document|constitution|hazing prevention|learning path|club sports?|fraternit\w*|sororit\w*)\b", re.I)
_QUESTION_START = ("can", "does", "do", "is", "are", "what", "how", "why", "who", "when", "should", "will", "would", "could")
STEP_WORDS = [("constitution", ("constitution",)), ("accountability", ("accountability",)), ("group_details", ("group details", "logo", "mission")),
              ("questions", ("application question",)), ("check_directory", ("directory", "already exist")),
              ("start_application", ("start the application", "start on engagesc")), ("acceptances", ("accept", "acceptance"))]


def _portal_on() -> bool:
    from app.workflows.rso import mock_portal
    return mock_portal.enabled()


def handles(message: str) -> bool:
    return bool(TRIGGERS.search(message))


class Ctx:
    def __init__(self) -> None:
        self.actions: list[dict[str, Any]] = []
        self.trace: list[dict[str, Any]] = []

    def add(self, action: dict[str, Any]) -> None:
        if action not in self.actions:
            self.actions.append(action)

    def did(self, tool: str, ok: bool = True, error: str | None = None) -> None:
        self.trace.append({"tool": tool, "ok": ok, "error": error})


def _has(t: str, *words: str) -> bool:
    return any(w in t for w in words)


def _lines(items: list[str]) -> str:
    return "\n".join(f"- {x}" for x in items)


def _deadline_line(v: dict[str, Any]) -> str:
    d = next(x for x in v["dates"] if x["id"] == "application_deadline")
    a = next(x for x in v["dates"] if x["id"] == "advisor_deadline")
    if v["application_closed"]:
        return f"The {P.CYCLE} application closed {P.DEADLINE}; USC doesn't accept late applications. Email stuacts@usc.edu about next steps."
    return (f"Application deadline: {P.DEADLINE} ({d['days_left']} days left). Advisor requirements: {P.ADVISOR_DUE} ({a['days_left']} days left). "
            f"Late applications aren't accepted.")


def _suggest(ctx: Ctx, v: dict[str, Any], extra: list[tuple[str, str]] | None = None) -> None:
    items = list(extra or [])
    nxt = v.get("next_step")
    if nxt:
        items.append((f"Next: {nxt['title']}", f"RSO step {nxt['id']}"))
    for label, msg in (("Officer documents", "RSO officer documents"), ("Advisor requirements", "RSO advisor requirements"),
                       ("All RSO steps", "Show all RSO steps"), ("Deadlines", "RSO deadlines")):
        if (label, msg) not in items:
            items.append((label, msg))
    ctx.add({"type": "suggestions", "items": [{"label": a, "message": b} for a, b in items[:5]]})


def _pathway_options(ctx: Ctx) -> None:
    ctx.add({"type": "options", "title": "Which describes your organization?", "options": [
        {"label": v["label"], "detail": v["detail"], "message": msg} for msg, v in (
            ("Start a new RSO", P.PATHWAYS["new"]), ("Renew our existing RSO", P.PATHWAYS["renew"]),
            ("RSO: we applied in fall", P.PATHWAYS["fall_applicant"]), ("RSO for a religious or spiritual group", P.PATHWAYS["religious"]),
            ("RSO for a club sport", P.PATHWAYS["club_sports"]), ("RSO for a social fraternity or sorority", P.PATHWAYS["fsl"]))]})


def _start(ctx: Ctx, pathway: str, listed: bool | None = None) -> str:
    rso.set_pathway(pathway, listed, actor="rso_agent")
    ctx.did("set_pathway")
    v = rso.view()
    pw = P.PATHWAYS[pathway]
    if not pw["flow"]:
        if pathway == "fall_applicant":
            ctx.add({"type": "rso_status"})
            return (f"{pw['detail']} Check your fall application's status on EngageSC (My Activity > My Surveys/Forms) and record it below. "
                    "Questions: stuacts@usc.edu.")
        return f"{pw['detail']} TrojanConnect doesn't handle that process. Contact Fraternity & Sorority Life, or Campus Activities at stuacts@usc.edu."
    head = {"new": "Let's register a new RSO.", "renew": "Let's renew your RSO for 2026–27.", "religious": "Let's register your religious or spiritual group.",
            "club_sports": "Club sports first become an RSO through this process, then complete the Recreational Sports Council process."}[pathway]
    out = [head, pw["detail"], _deadline_line(v),
           f"You'll need: 5 officers (president, vice president, secretary, treasurer, programming chair), 1 full-time USC faculty or staff advisor, "
           f"and at least {P.MIN_ADDITIONAL_MEMBERS} more student members; the 2026–27 constitution and Accountability Document templates; and "
           "three documents from every officer.",
           f"There are {v['steps_total']} steps. Start with who submits and the organization name below."]
    ctx.add({"type": "fields", "scope": "rso", "keys": ["organizationName", "submitterRole", "submitterName"] + (["engageGroupUrl"] if pw["flow"] == "renew" else []),
             "title": "About the organization", "then": "RSO next step"})
    ctx.add({"type": "rso_checklist", "section": "steps"})
    return "\n".join(out)


def _step_reply(ctx: Ctx, step_id: str) -> str:
    v = rso.view()
    step = next((s for s in v["steps"] if s["id"] == step_id), None)
    if not step:
        _pathway_options(ctx)
        return "First tell me whether this is a new RSO or a renewal."
    sid = step["id"]
    if sid in ("submitter",):
        ctx.add({"type": "fields", "scope": "rso", "keys": ["organizationName", "submitterRole", "submitterName"], "title": "Submitting officer", "then": "RSO next step"})
    elif sid == "roster":
        keys = [k for r, _ in P.OFFICER_ROLES for k in (f"{r}Name", f"{r}Email")] + ["facultyAdvisorName", "facultyAdvisorEmail", "facultyAdvisorFullTime", "memberCount"]
        ctx.add({"type": "fields", "scope": "rso", "keys": keys, "title": "Roster", "then": "RSO next step"})
    elif sid == "officer_docs":
        return _officer_docs(ctx)
    elif sid == "advisor":
        return _advisor(ctx)
    elif sid in ("submit", "start_application") and v["handoff"]:
        if sid == "submit" and not v["ready_to_submit"]:
            ctx.add({"type": "rso_checklist", "section": "steps"})
            return "Not ready to submit yet. Still to do:\n" + _lines(v["submit_blockers"]) + ("\n" + _deadline_line(v))
        if sid == "submit" and _portal_on():
            ctx.add({"type": "rso_portal"})
            ctx.add({"type": "handoff", **v["handoff"]})
            return ("Everything on the checklist is done. Press \"Submit through the portal\" and the portal agent fills in and submits the "
                    "application on the simulated EngageSC (demo data), then reads back the application ID. On the real EngageSC, the submitting "
                    f"officer submits before {P.DEADLINE} (link below).")
        ctx.add({"type": "handoff", **v["handoff"]})
        if sid == "submit":
            ctx.add({"type": "rso_status"})
            return (f"Everything on the checklist is done. The submitting officer now submits on EngageSC before {P.DEADLINE}. "
                    "Once it's submitted, record the status below (it should show Pending Approval).")
    elif sid == "review":
        ctx.add({"type": "rso_status"})
    ctx.add({"type": "rso_checklist", "section": "step", "step": sid})
    gaps = ("\nStill needed: " + "; ".join(v["roster_gaps"])) if sid == "roster" and v["roster_gaps"] else ""
    return f"{step['title']}{' (done)' if step['done'] else ''}.\n{step['detail']}{gaps}"


def _officer_docs(ctx: Ctx) -> str:
    v = rso.view()
    ctx.add({"type": "rso_checklist", "section": "officers"})
    out = [f"Each officer completes these {P.TRAINING_WINDOW} and sends them to the submitting officer, who uploads them:",
           _lines([d[1] for d in P.OFFICER_DOCS])]
    owing = []
    for o in v["officers"]:
        missing = [d for d in o["docs"] if not d["done"]]
        if missing:
            owing.append(f"{o['label']}{(' (' + o['name'] + ')') if o['name'] else ''}: {len(missing)} missing")
            ctx.add({"type": "rso_email", "target": o["role"]})
    out.append(("Still owed:\n" + _lines(owing)) if owing else "All 15 officer documents are in.")
    if owing:
        out.append("Use the email cards to send each officer exactly what they still owe, and tick items off as they arrive.")
    return "\n".join(out)


def _advisor(ctx: Ctx) -> str:
    v = rso.view()
    ctx.add({"type": "rso_checklist", "section": "advisor"})
    ctx.add({"type": "rso_email", "target": "advisor"})
    missing = [i["label"] for i in v["advisor"]["items"] if not i["done"]]
    return (f"Advisor requirements are separate from the application and due {P.ADVISOR_DUE}. "
            + ("Still to do:\n" + _lines(missing) if missing else "All done.")
            + "\nThe advisor must be full-time USC faculty or staff, not on sabbatical or leave, with USC email and SSO access.")


def respond(ctx: Ctx, message: str, now: datetime | None = None) -> str:
    t = message.lower()
    v = rso.view(now=now)

    # Pathway choice. Once a pathway is saved, a question that merely mentions a topic ("can religious students be
    # excluded?") must not switch it; button messages and statements still do.
    asking = "?" in t or (t.split() or [""])[0] in _QUESTION_START
    if v["pathway"] and asking:
        pass
    elif _has(t, "applied in fall", "fall applicant", "applied during fall"):
        return _start(ctx, "fall_applicant")
    elif _has(t, "fraternity", "sorority"):
        return _start(ctx, "fsl")
    elif _has(t, "religious", "spiritual"):
        return _start(ctx, "religious")
    elif "club sport" in t:
        return _start(ctx, "club_sports")
    elif _has(t, "listed officer", "i'm listed", "i am listed"):
        return _start(ctx, "renew", True)
    elif _has(t, "not listed", "not an officer on"):
        return _start(ctx, "renew", False)
    elif _has(t, "renew", "re-register", "reapply", "existing rso", "existing club", "re-recogni", "re-establish"):
        ctx.add({"type": "options", "title": "Are you listed as an officer on the group's EngageSC page?", "options": [
            {"label": "Yes, I'm a listed officer", "detail": "You can start the renewal right away", "message": "Renew our RSO: I'm a listed officer"},
            {"label": "No, I'm not listed", "detail": "Request officer access, or re-establish a lapsed group", "message": "Renew our RSO: I'm not listed as an officer"}]})
        return ("All RSO recognition ended June 30, 2026, so every RSO reapplies on EngageSC each year, and prior recognition doesn't guarantee renewal. "
                "Only officers listed on the group's EngageSC page can submit.\n" + _deadline_line(v))
    elif _has(t, "start a new", "new rso", "new club", "start a club", "register a new", "register a club", "register our club", "create a club", "new student org"):
        return _start(ctx, "new")

    if not v["pathway"]:
        _pathway_options(ctx)
        return ("I can take you through USC RSO recognition for a new organization or a renewal, step by step, and hand off to EngageSC where "
                "you submit.\n" + _deadline_line(v))

    if t.startswith("rso step "):
        return _step_reply(ctx, t.removeprefix("rso step ").strip())

    # Specific topics
    if _has(t, "deadline", "dates", "when is", "info session", "workshop", "office hour"):
        _suggest(ctx, v)
        return _deadline_line(v) + "\nSessions:\n" + _lines([f"{s['kind']}: {s['when']}" for s in P.SESSIONS]) + \
            f"\nRecognition lasts from approval through {P.RECOGNITION_END}."
    if _has(t, "contact", "help", "question for", "email campus"):
        c = P.CONTACT
        return f"{c['office']}: {c['email']} · {c['phone']} · {c['location']} · {c['hours']}. Drop-in office hours: Tuesdays 11 AM–12 PM, Fridays 2–3 PM."
    if _has(t, "officer doc", "officer document", "certificate", "hazing", "learning path", "commitment"):
        return _officer_docs(ctx)
    if _has(t, "advisor"):
        return _advisor(ctx)
    if _has(t, "requirement", "rule", "eligib", "denied", "why could", "open membership"):
        _suggest(ctx, v)
        return ("Membership rules:\n" + _lines(P.OPEN_MEMBERSHIP_RULES) + "\nCommon reasons for denial:\n" + _lines(P.DENIAL_REASONS)
                + "\nNote: " + P.DISCREPANCIES[0])
    if _has(t, "roster", "members", "officers"):
        return _step_reply(ctx, "roster")
    if _has(t, "check status", "check our rso status", "check the portal", "portal status") and v.get("portal"):
        ctx.add({"type": "rso_portal"})
        return f"Application {v['portal']['application_id']} was last seen as {v['portal']['portal_status']}. Press \"Check status now\" to read it from the portal again."
    if _has(t, "record", "pending approval", "requires modification", "were denied", "recognized now", "got recognized", "status on engagesc"):
        ctx.add({"type": "rso_status"})
        return "Record what EngageSC shows with the buttons below. Only you can record this; I never assume a submission or decision."
    if _has(t, "submit", "engagesc", "hand off", "handoff"):
        return _step_reply(ctx, "submit")
    for sid, words in STEP_WORDS:
        if _has(t, *words):
            return _step_reply(ctx, sid)
    if _has(t, "all rso steps", "show all", "checklist", "steps"):
        ctx.add({"type": "rso_checklist", "section": "steps"})
        _suggest(ctx, v)
        return f"{v['pathway_label']}: {v['steps_done']} of {v['steps_total']} steps done. Status: {v['status_label']}.\n{_deadline_line(v)}"

    # Status / next step
    if v["status"] == "recognized":
        _suggest(ctx, v, [("Plan an event", "Book a 35 person event for December 20th 2026 from 7pm - 8pm")])
        return (f"Your RSO is recognized through {P.RECOGNITION_END}, so it can now create events on EngageSC (the event pipeline's EngageSC "
                "step). Want to plan one? Renew again next cycle.")
    if v["status"] == "requires_modifications":
        if v.get("portal"):
            ctx.add({"type": "rso_portal"})
        if v["handoff"]:
            ctx.add({"type": "handoff", **v["handoff"]})
        ctx.add({"type": "rso_status"})
        return ("Campus Activities asked for modifications. Only the submitting officer can edit, from EngageSC > My Activity > My Surveys/Forms. "
                "Reply in EngageSC Chat, then record the new status.")
    if v["status"] == "pending_approval":
        ctx.add({"type": "rso_portal"} if v.get("portal") else {"type": "rso_status"})
        return ("Submitted and pending approval. Campus Activities reviews in the order received; watch your email and EngageSC Chat. "
                + (f"Advisor requirements are still due by {P.ADVISOR_DUE}." if not next((s for s in v["steps"] if s["id"] == "advisor"), {}).get("done") else ""))
    if v["status"] == "denied":
        ctx.add({"type": "rso_status"})
        return "Recorded as denied. You can appeal within ten business days of the decision by emailing Campus Activities (stuacts@usc.edu)."
    nxt = v["next_step"]
    if not nxt:
        ctx.add({"type": "rso_checklist", "section": "steps"})
        return "Every step is done."
    reply = f"{v['steps_done']} of {v['steps_total']} steps done. {_deadline_line(v)}\nNext: " + _step_reply(ctx, nxt["id"])
    _suggest(ctx, rso.view(now=now))
    return reply


def run_turn(message: str, history: list[dict[str, Any]] | None = None, now: datetime | None = None) -> dict[str, Any]:
    ctx = Ctx()
    reply = respond(ctx, message[:4000], now or datetime.now(timezone.utc))
    return {"reply": reply, "actions": ctx.actions, "tools": ctx.trace, "rso": rso.view(now=now), "model": LABEL}
