"""Annual USC RSO recognition: cycle constants, checklist definitions and derived status.

Python mirror of frontend/src/lib/pipeline/recognition.ts and the task lists in
RecognitionWorkflow.tsx, so the backend (API and the recognition agent) can report readiness,
deadlines and the next step. Source: USC Campus Activities' RSO Recognition Process page
(version last updated November 12, 2026). Cycle-specific: refresh every year, in both places.

TrojanConnect only tracks this process. It never talks to EngageSC, never submits the
application, and every status here is what the user reported.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

from . import store

CYCLE = "2026-27"
PROCESS_URL = "https://campusactivities.usc.edu/programs/recognized-student-organizations/rso-recognition-process/"
ENGAGE_HOME = "https://engage.usc.edu/"
ENGAGE_DIRECTORY = "https://engage.usc.edu/club_signup"
OFFICER_ACCESS_FORM = "https://forms.gle/1ncsGH165vLibRWc8"
REESTABLISH_FORM = "https://forms.gle/1EjhFMiAGDzed5wq5"
ADVISOR_REQUIREMENTS_FORM = "https://docs.google.com/forms/d/e/1FAIpQLSdsS-EcbWD3teNru4kaj4Leiu6bxNQDsrEPyIkkEX9e29hI-Q/viewform"
ADVISOR_DOCUMENTS_FORM = "https://forms.gle/C7h9eSXxyisopTjk8"
ADVISOR_TRAINING_URL = "https://usc.reach360.com/share/course/e8fe3a6b-e618-4563-ad8f-544c97fa500c"
ADVISOR_COMMITMENT_URL = ("https://powerforms.docusign.net/3a4f015b-d3b8-4d43-adfa-5ec0f77fc227?env=na3"
                          "&acct=3e63a5c5-bda2-4a75-a74a-95a6367636d6&accountId=3e63a5c5-bda2-4a75-a74a-95a6367636d6")
CONTACT_EMAIL = "stuacts@usc.edu"

# USC: "before 11:59pm" on November 22 (Pacific). Advisor requirements: December 1 (end of day).
_PST = timezone(timedelta(hours=-8))
APPLICATION_DEADLINE = datetime(2026, 11, 22, 23, 59, tzinfo=_PST)
ADVISOR_DEADLINE = datetime(2026, 12, 1, 23, 59, tzinfo=_PST)
APPLICATION_DEADLINE_LABEL = "Nov 22, 2026 · 11:59 PM"
ADVISOR_DEADLINE_LABEL = "Dec 1, 2026"

OFFICERS: dict[str, str] = {"president": "President", "vicePresident": "Vice president", "secretary": "Secretary",
                            "treasurer": "Treasurer", "programmingChair": "Programming chair"}

REQUIREMENTS: dict[str, dict[str, str]] = {
    "commitment": {"label": "Commitment to Community", "url": (
        "https://na3.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=44d5d5cb-159a-4004-ad59-d4c62423a96b"
        "&env=na3&acct=3e63a5c5-bda2-4a75-a74a-95a6367636d6&v=2")},
    "hazingTraining": {"label": "Hazing Prevention 101 certificate", "url": "https://usc.prevent.zone"},
    "learningPath": {"label": "RSO Officer Learning Path certificate",
                     "url": "https://usc.reach360.com/share/learning-path/6af5ef44-a4b6-4303-8bb2-4a55d17951b5"},
}

STATUS_LABELS: dict[str, str] = {
    "not_started": "Not started", "draft": "Draft", "pending_approval": "Pending Approval",
    "requires_modifications": "Requires Modifications", "denied": "Denied", "recognized": "Recognized (manual outcome)",
}

PATHWAYS: dict[str, str] = {
    "undecided": "Not chosen yet", "new": "New RSO", "reestablishing": "Re-establishing after a lapse",
    "fall_application": "Already applied in the fall", "religious_spiritual": "Religious or spiritual organization",
    "fraternity_sorority": "Social fraternity or sorority",
}
ELIGIBLE_PATHWAYS = ("new", "reestablishing", "religious_spiritual")
MIN_ADDITIONAL_MEMBERS = 5


def _task(id_: str, title: str, detail: str, *resources: tuple[str, str]) -> dict[str, Any]:
    return {"id": id_, "title": title, "detail": detail, "resources": [{"label": label, "url": url} for label, url in resources]}


PREP_TASKS = [
    _task("group-details", "Update the EngageSC group details",
          "Refresh categories, logo, mission, and goals. New groups do this while registering.", ("EngageSC directory", ENGAGE_DIRECTORY)),
    _task("roster-entered", "Enter the five officers, advisor, and student members in EngageSC",
          "Required officers: president, vice president, secretary, treasurer, and programming chair. Also list one eligible "
          "full-time USC advisor and at least five additional student members."),
    _task("submitter-designated", "Designate one eligible officer to submit and own follow-up",
          "The submitter must be one of the five required officers. Each student may submit only one RSO application; "
          "the application cannot be transferred."),
    _task("constitution", "Complete the required 2026–27 Constitution template",
          "Keep it in fillable PDF format. Do not print to PDF or flatten it.",
          ("Download Constitution template", "https://campusactivities.usc.edu/wp-content/uploads/2026/11/2026-27-RSO-Constitution-Template-1.pdf")),
    _task("accountability", "Complete the required Accountability Document",
          "Use the required fillable template and review USC’s instructions and sample.",
          ("Download Accountability Document", "https://campusactivities.usc.edu/wp-content/uploads/2026/10/RSO-Accountability-Document-2026.pdf"),
          ("Instructions", "https://campusactivities.usc.edu/wp-content/uploads/2026/07/Instructions-RSO-Accountability-Document-2026.pdf"),
          ("Sample document", "https://campusactivities.usc.edu/wp-content/uploads/2026/07/Example-RSO-Accountability-Document-2026.pdf")),
    _task("organization-details", "Gather the RSO’s remaining application information",
          "Prepare school/department and affiliation details, contact/account information, and answers about activities, "
          "elections, transitions, and property. Specialized activities may require additional approvals.",
          ("RSO Toolkit (USC login required)", "https://drive.google.com/drive/folders/1XcERU3CNiN2cThtsf36oRpQWtoN6UZ_t?usp=sharing")),
    _task("officer-guide-shared", "Share the Student Officer Requirements Guide with the other four officers",
          "Officers should send their three completed requirements to the designated submitter.",
          ("Student Officer Requirements Guide", "https://docs.google.com/document/d/1SXwg8rcMbMsg5mIAyubclE7k4k9-Z7yL_hRILD6o3mk/edit?usp=sharing")),
    _task("position-instructions-sent", "Ask officers, advisor, and members to accept their EngageSC positions",
          "They accept through the position email from mailer@campusgroups.com. You can continue the application before "
          "everyone accepts; do not wait for these responses to proceed."),
]

ADVISOR_TASKS = [
    _task("advisor-eligibility", "Confirm the advisor is eligible and has agreed to the advisor duties",
          "The listed advisor must be full-time USC faculty/staff, not on sabbatical or leave. Advisors agree to the "
          "constitution duties and accept their EngageSC position."),
    _task("advisor-position", "Confirm the advisor accepted their EngageSC position",
          "Acceptance is requested through the email from mailer@campusgroups.com."),
    _task("advisor-training", "Submit the advisor RSO training certificate",
          "Log in to Reach360 with SSO before opening the course. USC directs advisors to submit the certificate and "
          "Commitment form through the dedicated document form, not by email.",
          ("RSO Advisor Training", ADVISOR_TRAINING_URL),
          ("Advisor Recognition Requirements Guide", "https://docs.google.com/document/d/1ZQT6U9Fr2ux-R6sriMMg2dakD42QfJiahsTsb57RzDA/edit?usp=sharing"),
          ("Submit advisor documents", ADVISOR_DOCUMENTS_FORM)),
    _task("advisor-commitment", "Submit the advisor’s Commitment to Community form",
          "Complete the DocuSign, then submit it with the advisor training certificate through USC’s dedicated document "
          "form, not the student application.",
          ("Review sample and sign advisor Commitment form", ADVISOR_COMMITMENT_URL),
          ("Submit advisor documents", ADVISOR_DOCUMENTS_FORM), ("Advisor Requirements form", ADVISOR_REQUIREMENTS_FORM)),
    _task("clery-training", "Confirm the advisor’s Clery Act training status",
          "USC verifies this by TrojanLearn report; the advisor does not submit a certificate. A 2026 completion may "
          "satisfy the current requirement; otherwise follow USC’s refresher instructions.", ("TrojanLearn", "https://trojanlearn.usc.edu")),
]

FOLLOW_UP_TASK = _task(
    "follow-up", "Monitor EngageSC and email; respond to Campus Activities",
    "Only the submitting officer can view or edit the application. Modifications are available only when staff set its "
    "status to Requires Modifications.", ("Review USC’s status and follow-up instructions", PROCESS_URL))

ALL_TASKS = [*PREP_TASKS, *ADVISOR_TASKS, FOLLOW_UP_TASK]
CHECK_IDS = [t["id"] for t in ALL_TASKS]
# Preparation items that must be ticked before the application is ready to submit.
READINESS_CHECKS = ("group-details", "roster-entered", "submitter-designated", "constitution", "accountability", "organization-details")


def days_until(deadline: datetime, now: datetime) -> int:
    """Whole days until `deadline`; 0 on the deadline day, negative once it has passed."""
    seconds = (deadline - now).total_seconds()
    if seconds < 0:
        return -max(1, math.ceil(-seconds / 86_400))
    return math.floor(seconds / 86_400)


def countdown_label(deadline: datetime, now: datetime) -> str:
    days = days_until(deadline, now)
    if days < 0:
        return "closed"
    return "due today" if days == 0 else f"{days} day{'' if days == 1 else 's'} left"


def missing_officer_items(rec: dict[str, Any], role: str) -> list[str]:
    done = (rec.get("officers") or {}).get(role) or {}
    return [req for req in REQUIREMENTS if not done.get(req)]


def officer_reminder(rec: dict[str, Any], role: str, org_name: str) -> str | None:
    """Message the submitting officer copies to one officer, listing exactly what they still owe."""
    missing = missing_officer_items(rec, role)
    if not missing:
        return None
    return "\n".join([
        f"Hi! For {org_name or 'our RSO'}'s 2026–27 USC RSO recognition application, I still need these from you as {OFFICERS[role].lower()}:",
        *[f"• {REQUIREMENTS[m]['label']}: {REQUIREMENTS[m]['url']}" for m in missing],
        "",
        "Log in with USC SSO. Complete the Learning Path after July 1, 2026. Sign the Commitment to Community form with your "
        "first and last name, the RSO name, and your position.",
        f"Please send the certificates and a copy of the signed form to me (the submitting officer). The application closes "
        f"{APPLICATION_DEADLINE_LABEL}, and USC does not accept late applications.",
        "",
        "Also accept your officer position from the EngageSC email (mailer@campusgroups.com) on a laptop or desktop.",
    ])


def advisor_packet(org_name: str) -> str:
    """Message the submitting officer copies to the advisor."""
    return "\n".join([
        f"Hello! Thank you for advising {org_name or 'our RSO'}. USC asks advisors to complete these annual recognition requirements by {ADVISOR_DEADLINE_LABEL}:",
        "• Accept your advisor position from the EngageSC email (mailer@campusgroups.com), on a laptop or desktop.",
        f"• RSO Advisor Training (sign in at usc.reach360.com with SSO first): {ADVISOR_TRAINING_URL}",
        f"• Advisor Commitment to Community form (DocuSign): {ADVISOR_COMMITMENT_URL}",
        f"• Submit the training certificate PDF and the signed Commitment form through USC's advisor form: {ADVISOR_DOCUMENTS_FORM}",
        "• Clery Act CSA training in TrojanLearn. A 2026 completion counts, and USC verifies it by report, so no certificate is needed.",
        "",
        f"USC does not accept these requirements by email. Details: {PROCESS_URL}",
    ])


def next_action(rec: dict[str, Any], now: datetime) -> dict[str, str]:
    """The single most useful next step for the submitting officer."""
    pathway, status, checks = rec.get("pathway", "undecided"), rec.get("applicationStatus", "not_started"), rec.get("checks") or {}

    def step(title: str, detail: str, section: str) -> dict[str, str]:
        return {"title": title, "detail": detail, "section": section}

    if pathway == "undecided":
        return step("Choose your application pathway", "This decides whether you register a new group, re-establish one, or use a different process.", "pathway")
    if pathway == "fall_application":
        return step("Check your fall application in EngageSC", "USC says not to submit a second application.", "portal")
    if pathway == "fraternity_sorority":
        return step("Follow the Fraternity & Sorority Life process", "Social fraternities and sororities are not recognized through this RSO application.", "pathway")
    if status == "requires_modifications":
        return step("Make the modifications Campus Activities requested", "Only the submitting officer can edit, and only while the status is Requires Modifications.", "application")
    if status == "pending_approval":
        return step("Watch email and EngageSC Chat for review updates", "Campus Activities reviews applications in the order received.", "application")
    if status == "recognized":
        return step("Recognized for 2026–27", "Recognition runs through June 30, 2027. Plan to re-apply next cycle.", "application")
    if status == "denied":
        return step("Contact Campus Activities about the decision", f"Reach your assigned staff member or {CONTACT_EMAIL}.", "application")
    if days_until(APPLICATION_DEADLINE, now) < 0:
        return step("The application deadline has passed", f"USC does not accept late applications. Contact {CONTACT_EMAIL} about next steps.", "application")
    if (rec.get("additionalMemberCount") or 0) < MIN_ADDITIONAL_MEMBERS:
        return step("Add at least five additional student members", "These are in addition to the five officers and the advisor.", "roster")
    prep = next((t for t in PREP_TASKS if t["id"] in READINESS_CHECKS and not checks.get(t["id"])), None)
    if prep:
        return step(prep["title"], "Next unchecked organization preparation item.", "preparation")
    missing = sum(len(missing_officer_items(rec, role)) for role in OFFICERS)
    if missing:
        return step(f"Collect {missing} outstanding officer document{'' if missing == 1 else 's'}",
                    "Send each officer a reminder listing exactly what they still owe.", "officers")
    return step("Upload everything and submit in EngageSC", "Your local checklist is complete. The designated officer reviews and submits in the portal.", "application")


def portal_link(rec: dict[str, Any]) -> dict[str, str]:
    """Where the EngageSC hand-off button should go for this pathway."""
    pathway, group_url = rec.get("pathway", "undecided"), rec.get("engageGroupUrl") or ""
    if pathway == "fraternity_sorority":
        return {"label": "View USC recognition guidance", "url": PROCESS_URL}
    if pathway == "fall_application":
        return {"label": "Open existing EngageSC application", "url": group_url or ENGAGE_HOME}
    if group_url:
        return {"label": "Open your EngageSC group page", "url": group_url}
    if pathway in ELIGIBLE_PATHWAYS:
        return {"label": "Find or register an RSO", "url": ENGAGE_DIRECTORY}
    return {"label": "Open EngageSC", "url": ENGAGE_HOME}


def _tasks(tasks: list[dict[str, Any]], checks: dict[str, bool]) -> list[dict[str, Any]]:
    return [{**t, "done": bool(checks.get(t["id"]))} for t in tasks]


def status_view(state: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """Everything a recognition screen shows, derived from the saved checklist."""
    now = now or datetime.now(timezone.utc)
    rec = state.get("recognition") or store.empty_recognition()
    org_name = str((state.get("profile") or {}).get("orgName") or "")
    checks = rec.get("checks") or {}
    pathway, status = rec.get("pathway", "undecided"), rec.get("applicationStatus", "not_started")
    members = rec.get("additionalMemberCount") or 0
    officers = []
    for role, label in OFFICERS.items():
        done = (rec.get("officers") or {}).get(role) or {}
        missing = missing_officer_items(rec, role)
        officers.append({
            "role": role, "label": label,
            "requirements": [{"id": r, "label": REQUIREMENTS[r]["label"], "url": REQUIREMENTS[r]["url"], "done": bool(done.get(r))} for r in REQUIREMENTS],
            "missing": missing, "complete": not missing, "reminder": officer_reminder(rec, role, org_name),
        })
    missing_prep = [t["title"] for t in PREP_TASKS if t["id"] in READINESS_CHECKS and not checks.get(t["id"])]
    missing_docs = [f'{o["label"]}: {REQUIREMENTS[m]["label"]}' for o in officers for m in o["missing"]]
    eligible = pathway in ELIGIBLE_PATHWAYS
    blockers = [
        *([] if eligible else ["Choose an application pathway." if pathway == "undecided" else f"The '{PATHWAYS[pathway]}' pathway does not use this application."]),
        *([f"Add at least {MIN_ADDITIONAL_MEMBERS} additional student members (currently {members})."] if members < MIN_ADDITIONAL_MEMBERS else []),
        *[f"Preparation: {title}" for title in missing_prep],
        *[f"Officer document: {doc}" for doc in missing_docs],
    ]
    done_count = sum(1 for t in ALL_TASKS if checks.get(t["id"])) + sum(1 for o in officers for r in o["requirements"] if r["done"])
    total = len(ALL_TASKS) + len(OFFICERS) * len(REQUIREMENTS)
    app_days = days_until(APPLICATION_DEADLINE, now)
    not_submitted = status in ("not_started", "draft")
    return {
        "cycle": rec.get("cycle", CYCLE), "organization": org_name or None,
        "pathway": pathway, "pathway_label": PATHWAYS.get(pathway, pathway), "eligible_pathway": eligible,
        "application_status": status, "application_status_label": STATUS_LABELS.get(status, status),
        "next_action": next_action(rec, now),
        "ready_to_submit": not blockers, "not_ready_reasons": blockers,
        "tasks_done": done_count, "tasks_total": total, "percent_done": round(100 * done_count / total),
        "deadlines": {
            "application": {"at": APPLICATION_DEADLINE.isoformat(), "label": APPLICATION_DEADLINE_LABEL, "days_left": app_days,
                            "countdown": countdown_label(APPLICATION_DEADLINE, now), "closed": app_days < 0},
            "advisor": {"at": ADVISOR_DEADLINE.isoformat(), "label": ADVISOR_DEADLINE_LABEL, "days_left": days_until(ADVISOR_DEADLINE, now),
                        "countdown": countdown_label(ADVISOR_DEADLINE, now), "closed": days_until(ADVISOR_DEADLINE, now) < 0},
        },
        "late_warning": app_days < 0 and not_submitted and eligible,
        "roster": {"additional_member_count": members, "minimum_additional_members": MIN_ADDITIONAL_MEMBERS,
                   "needs_more_members": members < MIN_ADDITIONAL_MEMBERS,
                   "accepted_position_count": rec.get("acceptedPositionCount") or 0,
                   "positions_to_accept": len(OFFICERS) + 1 + members},
        "engage_group_url": rec.get("engageGroupUrl") or None,
        "portal": portal_link(rec),
        "preparation": _tasks(PREP_TASKS, checks),
        "officers": officers,
        "officer_documents_missing": len(missing_docs),
        "advisor": {"tasks": _tasks(ADVISOR_TASKS, checks), "packet": advisor_packet(org_name)},
        "follow_up": _tasks([FOLLOW_UP_TASK], checks)[0],
        "source": {"url": PROCESS_URL, "note": "Cycle-specific guidance from USC Campus Activities (page updated Nov 12, 2026). "
                                               "Statuses are what the user reported; TrojanConnect does not read EngageSC."},
    }


def schema_view() -> dict[str, Any]:
    """Static definitions for building a recognition UI."""
    return {
        "cycle": CYCLE,
        "pathways": [{"id": k, "label": v, "uses_this_application": k in ELIGIBLE_PATHWAYS} for k, v in PATHWAYS.items()],
        "application_statuses": [{"id": k, "label": v} for k, v in STATUS_LABELS.items()],
        "officers": [{"role": k, "label": v} for k, v in OFFICERS.items()],
        "officer_requirements": [{"id": k, **v} for k, v in REQUIREMENTS.items()],
        "checks": [{"id": t["id"], "title": t["title"], "section": section, "required_to_submit": t["id"] in READINESS_CHECKS}
                   for section, tasks in (("preparation", PREP_TASKS), ("advisor", ADVISOR_TASKS), ("follow_up", [FOLLOW_UP_TASK])) for t in tasks],
        "minimum_additional_members": MIN_ADDITIONAL_MEMBERS,
        "links": {"process": PROCESS_URL, "engage": ENGAGE_HOME, "engage_directory": ENGAGE_DIRECTORY, "officer_access_form": OFFICER_ACCESS_FORM,
                  "reestablish_form": REESTABLISH_FORM, "advisor_documents_form": ADVISOR_DOCUMENTS_FORM, "contact_email": CONTACT_EMAIL},
    }


def engage_note(state: dict[str, Any]) -> dict[str, Any]:
    """What the event pipeline's EngageSC step needs to know about recognition."""
    rec = state.get("recognition") or store.empty_recognition()
    status = rec.get("applicationStatus", "not_started")
    recognized = status == "recognized"
    return {
        "application_status": status, "application_status_label": STATUS_LABELS.get(status, status), "recognized": recognized,
        "note": ("Recognition was recorded manually in TrojanConnect, so confirm the group is active in EngageSC before creating the event."
                 if recognized else
                 "USC says organizations that miss annual recognition lose all RSO benefits. Confirm the group's status in EngageSC "
                 "before relying on it for this event."),
    }


# ---- Writes (shared by the recognition agent; the HTTP endpoints in router.py do the same) ----
def valid_group_url(value: str) -> bool:
    parsed = urlsplit(value)
    return value == "" or (parsed.scheme == "https" and parsed.netloc.lower() == "engage.usc.edu" and len(value) <= 500)


def _recognition(state: dict[str, Any]) -> dict[str, Any]:
    return state.setdefault("recognition", store.empty_recognition())


def save_setup(changes: dict[str, Any], actor: str = "") -> dict[str, Any]:
    def apply(s: dict[str, Any]) -> None:
        _recognition(s).update(changes)
        for key, value in changes.items():
            store.add_log(s, f"{actor}recognition setup: {key} = {value}")
    return store.update(apply)


def save_check(check: str, value: bool, actor: str = "") -> dict[str, Any]:
    def apply(s: dict[str, Any]) -> None:
        _recognition(s).setdefault("checks", {})[check] = value
        store.add_log(s, f"{actor}recognition: {'✓' if value else '✗'} {check}")
    return store.update(apply)


def save_officer_requirement(role: str, requirement: str, value: bool, actor: str = "") -> dict[str, Any]:
    def apply(s: dict[str, Any]) -> None:
        _recognition(s)["officers"][role][requirement] = value
        store.add_log(s, f"{actor}recognition: {role} {requirement} {'✓' if value else '✗'}")
    return store.update(apply)


def save_status(status: str, actor: str = "") -> dict[str, Any]:
    def apply(s: dict[str, Any]) -> None:
        _recognition(s)["applicationStatus"] = status
        store.add_log(s, f"{actor}recognition application status: {status}")
    return store.update(apply)
