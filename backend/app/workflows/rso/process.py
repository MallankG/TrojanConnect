"""USC RSO recognition process: steps, rules, dates and links, as data.

Source: USC Campus Activities, read 14 Nov 2026 (refresh every cycle):
- RSO Recognition Process (last updated 12 Nov 2026), the main source:
  https://campusactivities.usc.edu/programs/recognized-student-organizations/rso-recognition-process/
- New Student Organizations, FAQ – RSO Recognition Process, RSO Accountability, RSO Benefits &
  Responsibilities, How to Navigate Engage (all under campusactivities.usc.edu).

Where USC's pages disagree, the newer Recognition Process page wins and the difference is kept in
DISCREPANCIES so the UI can show it. Everything that needs a USC login (EngageSC, trainings, Docusign,
the Toolkit) is a hand-off link: TrojanConnect never signs in to or submits anything on USC systems.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Los_Angeles")
CYCLE = "Spring 2027 recognition (2026–27)"
SOURCE_CHECKED = "2026-11-14"

# ---- links -----------------------------------------------------------------------------------------
L: dict[str, dict[str, str]] = {
    # Campus Activities pages
    "process": {"label": "RSO Recognition Process", "url": "https://campusactivities.usc.edu/programs/recognized-student-organizations/rso-recognition-process/"},
    "new_orgs": {"label": "New Student Organizations", "url": "https://campusactivities.usc.edu/programs/recognized-student-organizations/new-student-organizations/"},
    "faq": {"label": "FAQ – RSO Recognition Process", "url": "https://campusactivities.usc.edu/programs/recognized-student-organizations/faq-rso-recognition-process/"},
    "accountability_page": {"label": "RSO Accountability", "url": "https://campusactivities.usc.edu/programs/recognized-student-organizations/rso-accountability/"},
    "benefits": {"label": "RSO Benefits & Responsibilities", "url": "https://campusactivities.usc.edu/programs/recognized-student-organizations/rso-privileges-responsibilities/"},
    "navigate_engage": {"label": "How to Navigate Engage", "url": "https://campusactivities.usc.edu/engagesc/how-to-navigate-engage/"},
    "resources": {"label": "RSO Resources", "url": "https://campusactivities.usc.edu/programs/recognized-student-organizations/rso-resources/"},
    # EngageSC (USC login; desktop or laptop only for the application)
    "engage_home": {"label": "EngageSC", "url": "https://engage.usc.edu/"},
    "engage_directory": {"label": "EngageSC Directory", "url": "https://engage.usc.edu/club_signup"},
    # Forms
    "page_check_form": {"label": "Check whether your group has an EngageSC page", "url": "https://forms.gle/Ai828xHoLZ1L6F539"},
    "officer_access_form": {"label": "Request to be added as an officer", "url": "https://forms.gle/1ncsGH165vLibRWc8"},
    "reestablish_form": {"label": "Re-establish a lapsed RSO (not listed as an officer)", "url": "https://forms.gle/1EjhFMiAGDzed5wq5"},
    "new_rso_mailing_list": {"label": "New RSO process mailing list", "url": "https://forms.gle/4nouDYW7sTy68CMw5"},
    "dormant_form": {"label": "Form for groups dormant for years or that missed a cycle", "url": "https://docs.google.com/forms/d/e/1FAIpQLSfSaDE2QHCe1X1g9P5Wv5lSWPHpUNLF-GRajmFC5G4S7tG11A/viewform"},
    "advisor_requirements_form": {"label": "Advisor Requirements form", "url": "https://docs.google.com/forms/d/e/1FAIpQLSdsS-EcbWD3teNru4kaj4Leiu6bxNQDsrEPyIkkEX9e29hI-Q/viewform"},
    "advisor_documents_form": {"label": "Advisor documents form (also linked by USC)", "url": "https://forms.gle/C7h9eSXxyisopTjk8"},
    # Templates and guides
    "constitution_template": {"label": "2026–27 Constitution template (fillable PDF)", "url": "https://campusactivities.usc.edu/wp-content/uploads/2026/11/2026-27-RSO-Constitution-Template-1.pdf"},
    "constitution_sample": {"label": "Constitution sample (RSO Toolkit, USC login)", "url": "https://drive.google.com/drive/folders/1Lb4NjjISKf0VlZBAzaFT8Iek3XyKYkg7?usp=sharing"},
    "accountability_template": {"label": "2026–27 Accountability Document template (fillable PDF)", "url": "https://campusactivities.usc.edu/wp-content/uploads/2026/10/RSO-Accountability-Document-2026.pdf"},
    "accountability_instructions": {"label": "Accountability Document instructions", "url": "https://campusactivities.usc.edu/wp-content/uploads/2026/07/Instructions-RSO-Accountability-Document-2026.pdf"},
    "accountability_example": {"label": "Accountability Document example", "url": "https://campusactivities.usc.edu/wp-content/uploads/2026/07/Example-RSO-Accountability-Document-2026.pdf"},
    "toolkit": {"label": "RSO Toolkit (USC login)", "url": "https://drive.google.com/drive/folders/1XcERU3CNiN2cThtsf36oRpQWtoN6UZ_t?usp=sharing"},
    "officer_guide": {"label": "Student Officer Requirements Guide", "url": "https://docs.google.com/document/d/1SXwg8rcMbMsg5mIAyubclE7k4k9-Z7yL_hRILD6o3mk/edit?usp=sharing"},
    "advisor_guide": {"label": "RSO Advisor Recognition Requirements Guide", "url": "https://docs.google.com/document/d/1ZQT6U9Fr2ux-R6sriMMg2dakD42QfJiahsTsb57RzDA/edit?usp=sharing"},
    "advisor_toolkit": {"label": "RSO Advisors Toolkit", "url": "https://drive.google.com/drive/folders/1pFY0_lYTpFwYU4AyS0zqC_pYl-9eucPZ?usp=drive_link"},
    # Officer requirements
    "hazing_101": {"label": "Hazing Prevention 101: Student Edition 2026–27", "url": "https://usc.prevent.zone"},
    "learning_path": {"label": "RSO Officer Learning Path (Reach360)", "url": "https://usc.reach360.com/share/learning-path/6af5ef44-a4b6-4303-8bb2-4a55d17951b5"},
    "learning_path_intro": {"label": "\"Using This Course\" module (read first)", "url": "https://usc.reach360.com/share/course/f56b9b3b-59d4-42ad-adca-4aaf25ebea3b"},
    "officer_commitment": {"label": "Officer Commitment to Community (Docusign)", "url": "https://na3.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=44d5d5cb-159a-4004-ad59-d4c62423a96b&env=na3&acct=3e63a5c5-bda2-4a75-a74a-95a6367636d6&v=2"},
    "officer_commitment_sample": {"label": "Officer Commitment to Community sample", "url": "https://docs.google.com/document/d/1MJOsn_A6lQWW5rk0VpYXwwqu2sw7VyFs/edit?usp=sharing&ouid=103873627988062661349&rtpof=true&sd=true"},
    # Advisor requirements
    "advisor_training": {"label": "RSO Advisor Training (Reach360; sign in at usc.reach360.com first)", "url": "https://usc.reach360.com/share/course/e8fe3a6b-e618-4563-ad8f-544c97fa500c"},
    "advisor_commitment": {"label": "Advisor Commitment to Community (Docusign)", "url": "https://powerforms.docusign.net/3a4f015b-d3b8-4d43-adfa-5ec0f77fc227?env=na3&acct=3e63a5c5-bda2-4a75-a74a-95a6367636d6&accountId=3e63a5c5-bda2-4a75-a74a-95a6367636d6"},
    "advisor_commitment_sample": {"label": "Advisor Commitment to Community sample", "url": "https://docs.google.com/document/d/1O_q-ZU9QIbnwa1OkZkOftKzt2Al5PDnv/edit?usp=drive_link&ouid=103873627988062661349&rtpof=true&sd=true"},
    "clery_refresher": {"label": "Clery Act Refresher Training for CSAs (TrojanLearn)", "url": "https://trojanlearn.csod.com/ui/lms-learning-details/app/course/7de66fea-10b0-46a2-ad92-a1d478452a9b"},
    # Policies
    "student_handbook": {"label": "USC Student Handbook", "url": "https://policy.usc.edu/studenthandbook/"},
    "student_commitment": {"label": "USC Student Commitment", "url": "https://culturejourney.usc.edu/student-commitment/"},
    "non_discrimination": {"label": "Notice of Non-discrimination", "url": "https://ocrc.usc.edu/policies-and-processes/notice-of-non-discrimination/"},
}


def link(key: str) -> dict[str, str]:
    return {"key": key, **L[key]}


# ---- dates (exact page wording kept in `text`) ------------------------------------------------------
def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=TZ)


DATES: list[dict[str, Any]] = [
    {"id": "opens", "at": _dt("2026-10-27T00:00"), "label": "Application opens", "text": "October 27: Application opens"},
    {"id": "application_deadline", "at": _dt("2026-11-22T23:59"), "label": "Application closes",
     "text": "November 22 at 11:59pm: Application closes. You must submit the form on EngageSC before 11:59pm. Late applications are not accepted."},
    {"id": "advisor_deadline", "at": _dt("2026-12-01T23:59"), "label": "Advisor requirements due",
     "text": "December 1: Deadline for advisors to submit their requirements. Advisors may begin their requirements at any time."},
    {"id": "recognition_ends", "at": _dt("2027-06-30T23:59"), "label": "Recognition ends",
     "text": "Recognition lasts from the date your application is approved through June 30, 2027."},
]
DATE_BY_ID = {d["id"]: d for d in DATES}


def when(date_id: str, fmt: str = "%b %-d") -> str:
    """A date from DATES as text, so wording follows the dates when they change each cycle."""
    return DATE_BY_ID[date_id]["at"].strftime(fmt)


DEADLINE = when("application_deadline", "%b %-d, %-I:%M %p")  # "Nov 22, 11:59 PM"
ADVISOR_DUE = when("advisor_deadline", "%B %-d")               # "December 1"
RECOGNITION_END = when("recognition_ends", "%B %-d, %Y")       # "June 30, 2027"
TRAINING_WINDOW = "between July 1, 2026 and the application deadline"

SESSIONS: list[dict[str, str]] = [
    {"kind": "Info session (Zoom)", "when": "Tue Nov 3, 10:00–11:00 AM"},
    {"kind": "Info session (Zoom)", "when": "Tue Nov 9, 2:30–3:30 PM"},
    {"kind": "Info session (Zoom)", "when": "Tue Nov 17, 4:00–5:00 PM"},
    {"kind": "New RSO workshop (Zoom)", "when": "Thu Oct 29, Tue Nov 3, Wed Nov 4, 4:00–5:00 PM"},
    {"kind": "Constitution & Accountability Document workshop (Zoom)", "when": "Tue Nov 3, 3:00–4:00 PM; Fri Nov 6, 11:00 AM–12:00 PM"},
    {"kind": "Drop-in office hours (Zoom or SKS 410)", "when": "Tuesdays 11:00 AM–12:00 PM; Fridays 2:00–3:00 PM"},
]

CONTACT = {"office": "Campus Activities", "email": "stuacts@usc.edu", "phone": "213-740-5649",
           "location": "Steven & Kathryn Sample Hall (SKS) 410, 3607 Trousdale Parkway", "hours": "Monday–Friday, 9:00 AM–5:00 PM"}

# ---- people and documents ---------------------------------------------------------------------------
OFFICER_ROLES: list[tuple[str, str]] = [("president", "President"), ("vicePresident", "Vice president"), ("secretary", "Secretary"),
                                        ("treasurer", "Treasurer"), ("programmingChair", "Programming chair")]
ROLE_LABEL = dict(OFFICER_ROLES)
OFFICER_DOCS: list[tuple[str, str, str]] = [  # id, label, link key
    ("hazing", "Hazing Prevention 101 certificate", "hazing_101"),
    ("learningPath", "RSO Officer Learning Path certificate", "learning_path"),
    ("commitment", "Commitment to Community form (signed)", "officer_commitment"),
]
ADVISOR_ITEMS: list[tuple[str, str, str | None]] = [
    ("accepted", "Accepted the advisor position (email from mailer@campusgroups.com, on a laptop or desktop)", None),
    ("training", "RSO Advisor Training certificate (PDF)", "advisor_training"),
    ("commitment", "Advisor Commitment to Community (signed PDF)", "advisor_commitment"),
    ("clery", "Clery Act CSA training: done in 2026, or the refresher if older (verified by report, no certificate)", "clery_refresher"),
    ("submitted", "Training certificate and Commitment form submitted through the Advisor Requirements form", "advisor_requirements_form"),
]
MIN_ADDITIONAL_MEMBERS = 5

APPLICATION_QUESTIONS = [
    "School or department affiliation", "National or outside affiliations", "Organization email and account information",
    "Activities involving minors, travel or healthcare", "Typical events", "Elections and officer transition schedule",
    "Property the organization owns or controls",
]

DENIAL_REASONS = [
    "Incomplete application, including missing documents or incomplete officer training",
    "Not in good standing with the Office of Community Expectations (OCE) or the Office of Civil Rights Compliance (OCRC)",
    "Conduct inconsistent with the USC Student Handbook or USC Student Commitment",
    "Not student-led and student-run, or not open to all eligible students",
    "Charging for services instead of accepting permissible donations",
    "Purpose or activities that conflict with university policies, or required approvals not obtained "
    "(e.g. University Clinical Services, Youth Protection Services, FSL, Recreational Sports, ORSL)",
]

OPEN_MEMBERSHIP_RULES = [
    "Voting membership and officer positions are limited to currently enrolled USC students.",
    "Membership can't be limited by major, class standing, GPA or other academic requirements.",
    "No interviews, applications or assessments for membership, no required dues, and no requirement to join another organization.",
    "The governing documents must include a non-discrimination statement.",
]

DISCREPANCIES = [
    "Members: the Recognition Process page (updated Nov 12, 2026) asks for at least five additional student members; the older FAQ says ten. "
    "TrojanConnect follows the newer page. Confirm with Campus Activities if unsure.",
    "Advisor documents: USC links two forms (the Advisor Requirements form and forms.gle/C7h9eSXxyisopTjk8). Use the Advisor Requirements form "
    "unless Campus Activities tells you otherwise.",
    "Recognition period: the page says both \"August 1–June 30\" and \"from approval through June 30, 2027\".",
]

# ---- pathways ---------------------------------------------------------------------------------------
PATHWAYS: dict[str, dict[str, Any]] = {
    "new": {"label": "Start a new RSO", "detail": "Never recognized at USC. New RSOs can only receive Spring recognition in their first year.", "flow": "new"},
    "renew": {"label": "Renew an existing RSO", "detail": "Previously recognized. All recognition ended June 30, 2026, so every RSO reapplies each year.", "flow": "renew"},
    "religious": {"label": "Religious or spiritual group", "detail": "Same steps, registered through the Office of Religious and Spiritual Life (ORSL) button.", "flow": "new"},
    "fall_applicant": {"label": "We applied in fall", "detail": "Fall applications run through June 30, 2027. Don't submit a new application.", "flow": None},
    "fsl": {"label": "Social fraternity or sorority", "detail": "Recognized through Fraternity & Sorority Life (FSL), not this process.", "flow": None},
    "club_sports": {"label": "Club sport", "detail": "Become an RSO first (this process), then complete the Recreational Sports Council process.", "flow": "new"},
}


def steps_for(pathway: str | None, *, listed_officer: bool | None = None) -> list[dict[str, Any]]:
    """The ordered steps for a pathway. Each step: id, title, detail, where (engage | usc | trojanconnect), links, requirement keys."""
    flow = PATHWAYS.get(pathway or "", {}).get("flow")
    if not flow:
        return []
    religious = pathway == "religious"
    s: list[dict[str, Any]] = []

    def add(id_: str, title: str, detail: str, where: str, links: list[str], **extra: Any) -> None:
        s.append({"id": id_, "title": title, "detail": detail, "where": where, "links": [link(k) for k in links], **extra})

    if flow == "new":
        add("check_directory", "Check the group isn't already on EngageSC",
            "Search the EngageSC Directory (or the Groups search) with several keywords. If the group exists, renew instead.",
            "engage", ["engage_directory", "page_check_form"])
    else:
        access = ("You're listed as an officer on the group's EngageSC page, so you can start." if listed_officer else
                  "Only listed officers can submit. Request officer access on the existing page, or, if the group lapsed and you're "
                  "not listed, use the re-establish form.")
        add("officer_access", "Get officer access on the group's EngageSC page", access, "engage",
            [] if listed_officer else ["officer_access_form", "reestablish_form", "page_check_form"])
    add("submitter", "Choose the one officer who submits",
        "One of the five required officers submits. The application can't be transferred or edited by another officer, and each student "
        "can submit only one recognition application.", "trojanconnect", [])
    if flow == "new":
        button = "+Register a new Office of Religious and Spiritual Life" if religious else "+Register a new Recognized Student Organization"
        add("start_application", "Start the application on EngageSC",
            f"In the EngageSC Directory, click \"{button}\". Use a laptop or desktop, not the mobile app.", "engage", ["engage_directory"], handoff=True)
    else:
        add("start_application", "Open your group's page on EngageSC",
            "Review the blue box at the top of the group page and scroll down to begin. Use a laptop or desktop.", "engage", ["engage_home"], handoff=True)
    add("roster", "Build the roster" if flow == "new" else "Update the roster",
        "Five officers (president, vice president, secretary, treasurer, programming chair), one full-time USC faculty or staff advisor "
        f"(not on sabbatical or leave), and at least {MIN_ADDITIONAL_MEMBERS} additional student members. Add people by USC email. If someone "
        "doesn't appear, they must log in to EngageSC once and make their profile visible (Privacy Settings > Profile visibility)."
        + ("" if flow == "new" else " Replace each previous officer with the current one."), "engage", [])
    add("acceptances", "Officers and advisor accept their positions",
        "Each one accepts through the email from mailer@campusgroups.com, on a laptop or desktop. You don't need to wait for approvals to continue.",
        "engage", [])
    add("group_details", "Update group details", "Categories, logo, mission and goals, matching how the group operates now.", "engage", [])
    add("constitution", "Constitution (2026–27 template)",
        "Fill in the required 2026–27 template as a fillable form. Don't print to PDF or flatten it. Include a non-discrimination statement.",
        "usc", ["constitution_template", "constitution_sample"])
    add("accountability", "Accountability Document (2026–27 template)",
        "Read the instructions and example first, then fill in the required template. Don't flatten it.", "usc",
        ["accountability_instructions", "accountability_example", "accountability_template"])
    add("officer_docs", "Officer documents (all five officers)",
        f"Each officer completes, {TRAINING_WINDOW}, and sends to the submitting officer: Hazing Prevention 101, the RSO Officer Learning Path, "
        "and the signed Commitment to Community. Certificates must be from this academic year.", "usc",
        ["hazing_101", "learning_path", "learning_path_intro", "officer_commitment", "officer_commitment_sample", "officer_guide"])
    add("questions", "Answer the application questions",
        "Covers: " + "; ".join(APPLICATION_QUESTIONS).lower() + ". Additional approvals may be required. Upload the Accountability Document and all officer documents.",
        "engage", [])
    add("submit", "Submit on EngageSC before the deadline",
        f"Submit before {DEADLINE}. Late applications aren't accepted. A confirmation email follows within a few days.",
        "engage", ["engage_home"], handoff=True)
    add("advisor", f"Advisor requirements (separate, due {ADVISOR_DUE})",
        "Not part of the application: the advisor completes the training, the Commitment to Community and Clery Act training, and submits them "
        "through USC's advisor form.", "usc", ["advisor_training", "advisor_commitment", "clery_refresher", "advisor_requirements_form", "advisor_guide"])
    add("review", "Review by Campus Activities",
        "Applications are reviewed in the order received; an assigned staff member works with you in EngageSC Chat. If the status becomes "
        "Requires Modifications, only the submitting officer can edit it (EngageSC > My Activity > My Surveys/Forms).", "engage", ["engage_home"])
    return s


STATUSES: dict[str, str] = {
    "not_started": "Not started",
    "in_progress": "Preparing",
    "pending_approval": "Pending Approval (submitted on EngageSC)",
    "requires_modifications": "Requires Modifications",
    "denied": "Denied",
    "recognized": "Recognized",
}
# Outcomes the club rep records from EngageSC; TrojanConnect can't read EngageSC.
RECORDABLE = ("pending_approval", "requires_modifications", "denied", "recognized")
