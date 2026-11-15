"""Deterministic event-plan logic: profile fields, forms, steps, deadlines and status.

Python mirror of frontend/src/lib/pipeline/{fields,plan}.ts so the backend (and the event
agent's tools) can compute status and missing fields without trusting the client or a model.
Keep the two in sync until the frontend reads this from the API (see
docs/event-pipeline-integration.md, "Source of truth").
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any, Callable

Profile = dict[str, Any]

VENUE_KINDS: dict[str, str] = {
    "tcc": "TCC meeting room (Trojan Event Services)",
    "outdoor": "Outdoor venue — McCarthy Quad, Alumni Park, … (Trojan Event Services)",
    "classroom": "General-use classroom (Campus Activities / Classroom Scheduling)",
    "viterbi": "Viterbi venue (Viterbi events office)",
    "eeb_phe": "EEB / PHE conference room (ECE department)",
}

CATERER_TYPES = [
    "USC Private Events & Conferences",
    "University Club Delivery",
    "USC Hospitality Retail Location (Panda, Seeds, Taco Taco, etc…)",
    "Food Truck",
    "Outside Caterer",
    "Food picked up from store or other location",
    "Offsite location (hotel or restaurant)",
    "Self-prepared",
]

# Caterers offered by the Event Permit's "Select Caterer Name" lookup (read live, Nov 2026).
PERMIT_APPROVED_CATERERS = [
    "California Skewers (Katse Inc)", "Caribbean Soul Kitchen", "Catholic Charities of LA Inc (The Village Kitchen)",
    "Chelo Inc", "Chick Fil A USC", "City Fare Catering", "City Tacos", "Corner Bakery Cafe", "Craw Daddy Boiler LLC",
    "Cup Of Cha Tea House", "Carousel Restaurant (Lemon Curry Management)", "La Fiesta Mexican Cuisine LLC",
    "Mi California Pollos Catering", "Zena Llc", "Taylor Made Cuisine Inc", "Creative European Cooking LLC", "Tres La",
    "Untitled Project Catering and Events LLC", "City Kitchen (Urban Plate LLC)", "Vesti Group LLC",
]

AUDIENCES = ["Students", "Faculty", "Staff", "Alumni", "General Public"]
EBOARD = ["President", "Vice President", "Secretary", "Treasurer", "Programming Chair"]
EVENT_TYPES = ["Meeting", "Lecture/Speaking Engagement", "Conference/Workshop", "Cultural Performance", "Fair", "Exhibit", "Other"]
EQUIPMENT = ["Projector", "Microphone", "Whiteboard", "Tables", "Stage"]
TIME_FLEX = ["0", "30", "60", "120"]
PAYMENT_TYPES = ["PO", "ISP (Internal Service Provider)", "PCard", "Credit Card", "Check", "Sponsored", "Not Applicable"]


def digits(v: Any) -> str:
    return re.sub(r"\D", "", str(v if v is not None else ""))


def _num(v: Any) -> float:
    try:
        return float(str(v))
    except ValueError:
        return float("nan")


def _food_only(p: Profile) -> bool:
    return bool(p.get("food"))


def _f(key: str, label: str, type_: str = "text", *, options: list[str] | None = None, optional: bool = False,
       validate: Callable[[Any], str | None] | None = None, when: Callable[[Profile], bool] | None = None) -> dict[str, Any]:
    return {"key": key, "label": label, "type": type_, "options": options, "optional": optional, "validate": validate, "when": when}


FIELDS: list[dict[str, Any]] = [
    _f("orgName", "Organization name (exactly as on EngageSC, no acronyms)"),
    _f("firstName", "First name"),
    _f("lastName", "Last name"),
    _f("email", "USC email", "email"),
    _f("phone", "Cell phone (10 digits)", "tel", validate=lambda v: None if re.fullmatch(r"\d{10}", digits(v)) else "Needs 10 digits"),
    _f("uscId", "10-digit USC ID", validate=lambda v: None if re.fullmatch(r"\d{10}", str(v)) else "Must be exactly 10 digits"),
    _f("initials", "Initials (officer attestation)"),
    _f("eboardPosition", "E-board position", "select", options=EBOARD),
    _f("onsiteName", "On-site contact name"),
    _f("onsitePhone", "On-site contact phone", "tel"),
    _f("secondaryName", "Secondary contact name", optional=True),
    _f("secondaryPhone", "Secondary contact phone", "tel", optional=True),
    _f("secondaryEmail", "Secondary contact email", "email", optional=True),
    _f("eventName", "Event name (use the same name on every form)"),
    _f("description", "Event description", "textarea"),
    _f("eventType", "Event type", "select", options=EVENT_TYPES),
    _f("date", "Event date", "date"),
    _f("setupTime", "Setup start", "time"),
    _f("startTime", "Event start", "time"),
    _f("endTime", "Event end", "time"),
    _f("teardownTime", "Tear-down done by", "time"),
    _f("backupDates", "Backup dates/times (for Viterbi requests)", "textarea", optional=True),
    _f("attendance", "Expected attendance", "number",
       validate=lambda v: None if 0 < _num(v) <= 60 else "Walkthrough rule: keep attendance at 60 or fewer"),
    _f("audience", "Expected audience", "multi", options=AUDIENCES),
    _f("amplifiedSound", "Amplified sound?", "bool"),
    _f("filmed", "Filmed or photographed?", "bool"),
    _f("marketingPlatform", "Marketing platform", optional=True),
    _f("venueKind", "Where is the event?", "select", options=list(VENUE_KINDS)),
    _f("venueChoice1", 'First-choice room/space (e.g. "TCC 350", "THH 101", "EEB 248", "McCarthy Quad")'),
    _f("venueChoice2", "Second choice", optional=True),
    _f("acceptAlternate", "Accept an alternate location?", "bool"),
    _f("equipment", "Equipment needed", "multi", options=EQUIPMENT, optional=True),
    _f("timeFlexMinutes", "How far may the time move? (minutes, earlier or later)", "select", options=TIME_FLEX, optional=True),
    _f("food", "Serving food or drinks?", "bool"),
    _f("catererType", "Caterer type", "select", options=CATERER_TYPES, when=_food_only),
    _f("catererName", "Caterer / vendor name", when=_food_only),
    _f("menu", "Menu details", "textarea", when=_food_only),
    _f("foodValue", "Food cost (USD)", "number", when=_food_only),
    _f("paymentType", "Payment type", "select", options=PAYMENT_TYPES, when=_food_only),
    _f("vendorServes", "Vendor serves the food (vs. self-serve)?", "bool", when=_food_only),
    _f("budgetTotal", "Total requested budget (USD)", "number"),
    _f("budgetLink", "Link to your completed budget proposal"),
    _f("vpFinanceEmail", "VP of Finance (Vaibhavi) email", "email"),
    _f("vpCommsEmail", "VP of Communications (Tyler) email", "email"),
    _f("advisorName", "Department advisor name"),
    _f("advisorEmail", "Department advisor email", "email"),
    _f("hospitalityEmail", "USC Hospitality contact email (non-approved vendors)", "email", optional=True),
]
_GROUPS = {
    "Organization": ["orgName"],
    "You (requester)": ["firstName", "lastName", "email", "phone", "uscId", "initials", "eboardPosition"],
    "Day-of contacts": ["onsiteName", "onsitePhone", "secondaryName", "secondaryPhone", "secondaryEmail"],
    "Event": ["eventName", "description", "eventType", "date", "setupTime", "startTime", "endTime", "teardownTime", "backupDates",
              "attendance", "audience", "amplifiedSound", "filmed", "marketingPlatform"],
    "Venue": ["venueKind", "venueChoice1", "venueChoice2", "acceptAlternate", "equipment", "timeFlexMinutes"],
    "Food": ["food", "catererType", "catererName", "menu", "foodValue", "paymentType", "vendorServes"],
    "Funding": ["budgetTotal", "budgetLink"],
    "Contacts": ["vpFinanceEmail", "vpCommsEmail", "advisorName", "advisorEmail", "hospitalityEmail"],
}
FIELD_BY_KEY: dict[str, dict[str, Any]] = {f["key"]: f for f in FIELDS}
for _group, _keys in _GROUPS.items():
    for _k in _keys:
        FIELD_BY_KEY[_k]["group"] = _group


def short_label(key: str) -> str:
    f = FIELD_BY_KEY.get(key)
    return f["label"].split(" (")[0] if f else key


def is_filled(profile: Profile, key: str) -> bool:
    v = profile.get(key)
    if FIELD_BY_KEY.get(key, {}).get("type") == "bool":
        return v is True or v is False
    if isinstance(v, list):
        return len(v) > 0
    return v is not None and str(v).strip() != ""


def field_problem(profile: Profile, key: str) -> str | None:
    """None = OK, "missing", or a validation message."""
    if not is_filled(profile, key):
        return "missing"
    validate = FIELD_BY_KEY.get(key, {}).get("validate")
    return validate(profile[key]) if validate else None


def field_applies(profile: Profile, key: str) -> bool:
    when = FIELD_BY_KEY.get(key, {}).get("when")
    return when is None or when(profile)


def coerce_field(key: str, value: Any) -> tuple[Any, str | None]:
    """Normalise a proposed profile value to its stored shape. Returns (value, error)."""
    f = FIELD_BY_KEY.get(key)
    if not f:
        return None, "Unknown field"
    t = f["type"]
    if t == "bool":
        if isinstance(value, bool):
            return value, None
        if str(value).strip().lower() in ("yes", "true", "y"):
            return True, None
        if str(value).strip().lower() in ("no", "false", "n"):
            return False, None
        return None, "Must be true or false"
    if t == "multi":
        vals = value if isinstance(value, list) else [value]
        bad = [v for v in vals if v not in f["options"]]
        if bad or (not vals and not f["optional"]):
            return None, f"Allowed values: {', '.join(f['options'])}"
        return vals, None
    s = str(value).strip()
    if t == "select" and s not in f["options"]:
        return None, f"Allowed values: {', '.join(f['options'])}"
    if t == "date":
        try:
            date.fromisoformat(s)
        except ValueError:
            return None, "Use YYYY-MM-DD"
    if t == "time":
        m = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)", s)
        if not m:
            return None, "Use 24-hour HH:MM"
        if m.group(2) not in ("00", "30"):
            return None, "USC forms only accept times on the hour or half hour"
    if t == "number" and _num(s) != _num(s):
        return None, "Must be a number"
    if t == "tel":
        s = digits(s)
    if t == "email" and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", s):
        return None, "Not a valid email address"
    if s and f["validate"] and (err := f["validate"](s)):
        return None, err
    return s, None


# ---- Forms ----------------------------------------------------------------------------------
_CONTACT = ["orgName", "firstName", "lastName", "email", "phone"]
_EVENT = ["eventName", "description", "date", "startTime", "endTime", "attendance"]

FORMS: dict[str, dict[str, Any]] = {
    "tcc": {
        "name": "TCC meeting room request", "url": "https://scevents.wufoo.com/forms/p11ku1c01p5kpxf/", "auto": "agent",
        "requires": [*_CONTACT, "eboardPosition", *_EVENT, "setupTime", "teardownTime", "venueChoice1", "acceptAlternate", "food", "filmed"],
        "rules": ["Submit at least 3 weeks before the event.", "Room capacity is never exceeded (TCC 221 = 10, 350/351/352 combo = 126).",
                  "Each room has 1 trash can; extra trash boxes are charged if food is served."],
    },
    "outdoor": {
        "name": "Outdoor venue request (TES)", "url": "https://scevents.wufoo.com/forms/q1ofqron0clb1tz/", "auto": "agent",
        "requires": [*_CONTACT, *_EVENT, "setupTime", "teardownTime", "venueChoice1", "acceptAlternate", "eventType", "food", "filmed", "amplifiedSound"],
        "rules": ["TES asks for 6 weeks notice. Your walkthrough says 3+, so the tracker uses 6.",
                  "Outdoor events run 8:00 AM–11:30 PM; no amplified sound after 8 PM.",
                  "Not available during Welcome Experience, Festival of Books, home football days or commencement."],
    },
    "classroom": {
        "name": "Classroom space request", "url": "https://usccampusactivities.wufoo.com/forms/classroom-space-request-form/", "auto": "agent",
        "requires": [*_CONTACT, "initials", *_EVENT, "eventType", "venueChoice1", "audience", "amplifiedSound"],
        "rules": ["Only for weeks 4 through the last day of instruction; never on holidays, study days or finals.",
                  "Starts: Mon–Thu 6:00 PM or later, Fri 3:00 PM or later. Must end by 11:00 PM.",
                  "Not accepted within 48 hours. Fri–Sun requests are due by Thursday 12:00 PM the week before.",
                  "Recommended: at least 2 weeks ahead. A permit is needed if 25+ people OR food."],
    },
    "eeRoom": {
        "name": "ECE conference room request (EEB/PHE)", "url": "https://ee.usc.edu/info/conference_rooms/", "auto": "agent",
        "requires": ["firstName", "lastName", "email", "phone", "eventName", "description", "date", "startTime", "endTime", "attendance", "venueChoice1"],
        "rules": ["Submit at least 3 days ahead (2 weeks recommended).", "Non-EE departments can book at most 1 month out.",
                  "Booking is handled by the venue agent; availability comes from the simulated inventory."],
    },
    "viterbiRoom": {
        "name": "Viterbi venue request", "auto": "agent",
        "requires": [*_CONTACT, *_EVENT, "venueChoice1", "acceptAlternate"],
        "rules": ["No published lead time; the tracker uses 3 weeks.", "Give backup rooms or allow alternates so the venue agent has options."],
    },
    "viterbiEmail": {
        "name": "Email Kevin Giang (kgiang@usc.edu)", "auto": "email", "to": "kgiang@usc.edu",
        "requires": ["eventName", "date", "startTime", "endTime", "attendance"],
        "rules": ["Include ideal date/time AND a list of backup options."],
    },
    "vendorList": {
        "name": "Approved vendor list (Google Sheet; needs USC login)",
        "url": "https://docs.google.com/spreadsheets/d/1MpsjBRyMtZVtkoQi1tp1xVVln6KU6G45/edit?gid=213302733", "auto": "manual",
        "requires": ["catererName", "catererType", "menu", "foodValue"],
        "rules": ["Not on the list → contact USC Hospitality. The permit then needs a one-time approval (health permit + insurance) due 2 weeks before the event."],
    },
    "permit": {
        "name": "USC event permit", "url": "https://usc-its.my.site.com/eventpermits/s/request-submission", "auto": "agent",
        "requires": [*_CONTACT, "uscId", "onsiteName", "onsitePhone", *_EVENT, "setupTime", "teardownTime", "audience", "food", "filmed",
                     "amplifiedSound", "catererType", "catererName", "menu", "foodValue", "paymentType", "vendorServes"],
        "rules": ["Only after the room is CONFIRMED (needs the 6-digit reservation #).",
                  "Walkthrough: answer NO to trash/waste services; attendance must not be over 60.",
                  "The permits reviewer checks ADA, Smoke-Free and Plastic acknowledgements and anything about security, alcohol or insurance with you; "
                  "TrojanConnect never answers those questions for you."],
    },
    "budgetEmail": {
        "name": "Email budget proposal to VP Finance (Vaibhavi)", "auto": "email", "to_field": "vpFinanceEmail",
        "url": "https://docs.google.com/spreadsheets/d/1SLqu6rXsgGxxRK2foMnV9HJJy8abhFsr/edit?gid=4042447",
        "requires": ["vpFinanceEmail", "eventName", "date", "budgetTotal", "budgetLink"],
        "rules": ['The budget template link in the walkthrough returns "410 Gone". Ask Vaibhavi for the current template.',
                  "She submits to Viterbi; you then order in person at OHE and must be there for delivery."],
    },
    "engage": {
        "name": "EngageSC event + permit code", "url": "https://engage.usc.edu/", "auto": "manual",
        "requires": ["eventName", "date", "startTime", "endTime"],
        "rules": ["Requires a room reservation AND the event permit.",
                  "Create the event, enter the permit code, sign, and submit for approval (see the walkthrough video)."],
    },
    "accessEmail": {
        "name": "Ask VP Comms (Tyler) for accessibility & non-discrimination statements", "auto": "email", "to_field": "vpCommsEmail",
        "requires": ["vpCommsEmail", "eventName"], "rules": [],
    },
    "commsEmail": {
        "name": "Send graphic to VP Comms (Tyler) for Instagram", "auto": "email", "to_field": "vpCommsEmail",
        "requires": ["vpCommsEmail", "eventName", "date", "startTime", "venueChoice1"], "rules": ["Make the graphic in Canva first and attach it."],
    },
    "advisorEmail": {
        "name": "Send graphic to department advisor", "auto": "email", "to_field": "advisorEmail",
        "requires": ["advisorEmail", "advisorName", "eventName", "date", "startTime", "venueChoice1"], "rules": [],
    },
    # Not attached to a step: offered from the Food step for vendors that aren't approved.
    "hospitality": {
        "name": "Email USC Hospitality about a non-approved vendor", "auto": "email", "to_field": "hospitalityEmail",
        "requires": ["hospitalityEmail", "catererName", "eventName", "date", "attendance"], "rules": [],
    },
}

# Forms whose submission is handled by the booking agent workflow (app/workflows/booking), not a USC portal.
AGENT_FORMS = ("tcc", "outdoor", "classroom", "eeRoom", "viterbiRoom", "permit")
VENUE_FORM = {"tcc": "tcc", "outdoor": "outdoor", "classroom": "classroom", "viterbi": "viterbiRoom", "eeb_phe": "eeRoom"}
VENUE_LEAD_DAYS = {"outdoor": 42, "tcc": 21, "classroom": 14, "viterbi": 21, "eeb_phe": 14}

STEP_IDS = ("venue", "food", "permit", "funding", "engage", "access", "publicity")

STEP_DATA_RULES: dict[tuple[str, str], Callable[[str], str | None]] = {
    ("venue", "reservationNumber"): lambda v: None if re.fullmatch(r"\d{6}", v) else "The reservation number is exactly 6 digits",
}


def missing_for(form_id: str, profile: Profile) -> list[dict[str, str]]:
    form = FORMS.get(form_id)
    if not form:
        return []
    out = []
    for k in form["requires"]:
        if not field_applies(profile, k):
            continue
        problem = field_problem(profile, k)
        if problem:
            out.append({"key": k, "label": short_label(k), "problem": problem})
    return out


def build_steps(profile: Profile) -> list[dict[str, Any]]:
    vk = profile.get("venueKind")
    vk = vk if vk in VENUE_KINDS else None
    no_food = profile.get("food") is False

    def step(id_: str, n: int, title: str, after: list[str], lead: int, official: bool, forms: list[str], done_key: str,
             substeps: list[tuple[str, str]], *, skip: bool = False, needs_data: list[tuple[str, str]] | None = None) -> dict[str, Any]:
        return {"id": id_, "n": n, "title": title, "after": after, "lead": lead, "official": official, "forms": forms,
                "doneKey": done_key, "substeps": substeps, "skip": skip, "needsData": needs_data or []}

    steps = [
        step("venue", 1, "Reserve the venue", [], VENUE_LEAD_DAYS[vk] if vk else 21, True,
             ([VENUE_FORM[vk]] + (["viterbiEmail"] if vk == "viterbi" else [])) if vk else [], "confirmed",
             [("submitted", "Request submitted"), ("confirmed", "Reservation confirmed")],
             needs_data=[("reservationNumber", "Reservation # (6 digits, for the permit)"),
                         ("venueContactName", "Venue manager name (who confirmed it)"), ("venueContactEmail", "Venue manager email")]),
        step("food", 2, "Pick an approved food vendor", [], 21, False, ["vendorList"], "quote",
             [("picked", "Vendor chosen from approved list"), ("quote", "Quote / menu in hand"),
              ("hospitality", "Not approved: contacted Hospitality (skip if approved)")], skip=no_food),
        step("permit", 3, "Event permit application", ["venue"] if no_food else ["venue", "food"], 14, True, ["permit"], "approved",
             [("submitted", "Permit submitted"), ("followups", "Followed up with each department listed in the confirmation email"),
              ("approved", "Permit approved")], needs_data=[("permitCode", "Permit number / code")]),
        step("funding", 4, "Funding application → VP Finance", [] if no_food else ["food"], 14, False, ["budgetEmail"], "delivery",
             [("proposal", "Budget proposal completed"), ("sent", "Sent to Vaibhavi"), ("approved", "Approved & submitted to Viterbi"),
              ("ohe", "Ordered in person at OHE"), ("delivery", "Delivery time confirmed (you are available)")]),
        step("engage", 5, "EngageSC event", ["venue", "permit"], 10, False, ["engage"], "approved",
             [("created", "Event created with permit code"), ("signed", "Signed & submitted for approval"), ("approved", "Approved on EngageSC")]),
        step("access", 6, "Accessibility & non-discrimination statements", [], 10, False, ["accessEmail"], "added",
             [("asked", "Requested statements from Tyler"), ("added", "Statements added to graphic & EngageSC page")]),
        step("publicity", 7, "Publicize", ["engage", "access"], 7, False, ["commsEmail", "advisorEmail"], "advisor",
             [("graphic", "Graphic made (Canva)"), ("tyler", "Sent to Tyler for Instagram"), ("advisor", "Sent to department advisor"),
              ("dayof", "Re-posted on the day of the event")]),
    ]
    text = {
        "venue": ("Club Agent ↔ Venue Agent → reviewer", (VENUE_KINDS[vk] + ". The venue agent negotiates a room and time; a human reviewer confirms.")
                  if vk else "Choose a venue type in the profile first."),
        "food": ("You", "The permit lookup currently lists 20 approved outside caterers; the full list is on the USC-only sheet."),
        "permit": ("Club Agent → Event Permits reviewer", "Opens once the room is confirmed. The permits reviewer decides and issues the permit code."),
        "funding": ("You → Vaibhavi → Viterbi → OHE", "Vaibhavi approves the budget and submits it to Viterbi. You then place the order in person at OHE."),
        "engage": ("You → Campus Activities", "Needs a confirmed room reservation and the permit code."),
        "access": ("You ↔ Tyler", "Done before publicity so the statements appear on the graphic."),
        "publicity": ("You → Tyler, advisor", "Re-post on the day of the event."),
    }
    for s in steps:
        s["owner"], s["blurb"] = text[s["id"]]
    return steps


_WAITING_ON: dict[str, Callable[[dict[str, bool]], bool]] = {
    "venue": lambda c: bool(c.get("submitted")),
    "permit": lambda c: bool(c.get("submitted")),
    "funding": lambda c: bool(c.get("sent")) and not c.get("approved"),
    "engage": lambda c: bool(c.get("signed")),
}


def parse_date(s: Any) -> date | None:
    try:
        return date.fromisoformat(s) if isinstance(s, str) and s else None
    except ValueError:
        return None


def derive_state(state: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    """Each step's live status from saved progress + profile + today's date."""
    today = today or date.today()
    profile: Profile = state.get("profile") or {}
    event_date = parse_date(profile.get("date"))
    by_id: dict[str, dict[str, Any]] = {}
    for s in build_steps(profile):
        p = (state.get("progress") or {}).get(s["id"]) or {}
        checks = p.get("checks") or {}
        n_done = sum(1 for k, _ in s["substeps"] if checks.get(k))
        done = s["skip"] or bool(checks.get(s["doneKey"])) or (s["id"] == "food" and bool(checks.get("picked")) and bool(checks.get("quote")))
        blocked_by = [d for d in s["after"] if not by_id[d]["done"]]
        due = event_date - timedelta(days=s["lead"]) if event_date else None
        days_left = (due - today).days if due else None
        missing = list(dict.fromkeys(m["key"] for fid in s["forms"] for m in missing_for(fid, profile)))
        if s["skip"]:
            status = "skipped"
        elif done:
            status = "done"
        elif blocked_by:
            status = "blocked"
        elif _WAITING_ON.get(s["id"], lambda c: False)(checks):
            status = "waiting"
        elif n_done > 0:
            status = "active"
        else:
            status = "ready"
        by_id[s["id"]] = {**s, "checks": checks, "data": p.get("data") or {}, "done": done, "status": status, "blockedBy": blocked_by,
                          "due": due, "daysLeft": days_left, "missing": missing, "nDone": n_done,
                          "late": days_left is not None and days_left < 0 and not done and not s["skip"]}
    steps = list(by_id.values())
    return {
        "steps": steps, "byId": by_id,
        "complete": sum(1 for s in steps if s["done"] or s["skip"]), "total": len(steps),
        "eventDate": event_date, "daysToEvent": (event_date - today).days if event_date else None,
    }


# ---- Email drafts ---------------------------------------------------------------------------
def to12h(t: Any) -> str:
    """ "18:30" -> "6:30 PM" """
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", t) if isinstance(t, str) else None
    if not m:
        return ""
    hh = int(m.group(1))
    return f"{hh % 12 or 12}:{m.group(2)} {'PM' if hh >= 12 else 'AM'}"


def email_draft(form_id: str, P: Profile) -> dict[str, str] | None:
    """The email a human sends for an `auto: email` form. Nothing is ever sent by the app."""
    def s(k: str) -> str:
        v = P.get(k)
        return "" if v is None else str(v)

    when = f'{s("date") or "[date]"}, {to12h(P.get("startTime")) or "[start]"}–{to12h(P.get("endTime")) or "[end]"}'
    me = f'{s("firstName")} {s("lastName")}'.strip() or "[your name]"
    sig = f'\n\nThank you,\n{me}\n{s("orgName")}\n{s("email")} · {s("phone")}'
    place = s("venueChoice1")
    if form_id == "viterbiEmail":
        return {"to": "kgiang@usc.edu", "subject": f'Venue request: {s("eventName") or "[event]"}',
                "body": "Hi Kevin,\n\nI'd like to request a Viterbi venue for an upcoming event.\n\n"
                        f'Event name: {s("eventName")}\nIdeal date/time: {when}\nBackup options:\n{s("backupDates") or "  - [add backups]"}\n'
                        f'Expected number of attendees: {s("attendance")}\n' + (f"Preferred space: {place}\n" if place else "") + sig}
    if form_id == "budgetEmail":
        food = f'Food vendor: {s("catererName")} ({s("catererType")}) — approx. ${s("foodValue")}\n' if P.get("food") else ""
        return {"to": s("vpFinanceEmail"), "subject": f'Funding application: {s("eventName")} ({s("date")})',
                "body": f'Hi Vaibhavi,\n\nPlease find our budget proposal for {s("eventName")} on {when}' + (f" at {place}" if place else "")
                        + f'.\n\nTotal requested: ${s("budgetTotal")}\nBudget proposal: {s("budgetLink")}\n{food}'
                        f'Expected attendance: {s("attendance")}\n\nCould you review and, if approved, submit it to Viterbi? '
                        "I'll place the order in person at OHE and will be available for delivery." + sig}
    if form_id == "accessEmail":
        return {"to": s("vpCommsEmail"), "subject": f'Accessibility & non-discrimination statements — {s("eventName")}',
                "body": f'Hi Tyler,\n\nCould you send the accessibility and non-discrimination statements to include for {s("eventName")} '
                        f"({when})? Let me know if anything about the event needs changing." + sig}
    if form_id == "commsEmail":
        return {"to": s("vpCommsEmail"), "subject": f'Instagram post: {s("eventName")} — {s("date")}',
                "body": f'Hi Tyler,\n\nAttached is the graphic for {s("eventName")}.\n\nWhen: {when}\nWhere: {place}\n{s("description")}\n\n'
                        "Could you post it on Instagram? We'll re-share on the day of the event as well.\n\n[ATTACH GRAPHIC]" + sig}
    if form_id == "advisorEmail":
        return {"to": s("advisorEmail"), "subject": f'Please share: {s("eventName")} — {s("date")}',
                "body": f'Hi {s("advisorName")},\n\nWe\'re hosting {s("eventName")} on {when} at {place}. Would you be able to share the '
                        f'attached graphic with the department?\n\n{s("description")}\n\n[ATTACH GRAPHIC]' + sig}
    if form_id == "hospitality":
        return {"to": s("hospitalityEmail"), "subject": f'Non-approved vendor request — {s("eventName")}',
                "body": f'Hello,\n\nWe\'d like to use {s("catererName")}, which is not on the approved vendor list, for {s("eventName")} on {when} '
                        f'(~{s("attendance")} attendees). What\'s needed for a one-time approval?' + sig}
    return None
