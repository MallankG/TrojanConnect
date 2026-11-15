"""Deterministic venue policy checks (PRD §7.3 #10: no hallucinated policy; §8.2: no agent can bypass a
venue's lead time, capacity or other configured policy).

Two kinds of check:
- request_issues: depend only on the event date (lead time, booking window). They can't be negotiated
  away, so a request that fails one is escalated to a human instead of getting offers.
- window_issues: depend on the time window, so the Venue Agent can offer a shifted time inside the
  club's flexibility instead.

Each issue cites where the rule comes from: "live form" (the public USC form, Nov 2026), "walkthrough"
(the club's event walkthrough) or "simulated" (demo value).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta
from typing import Any

from .inventory import TZ, VENUE_HOURS

# Minimum days of notice per venue type (the tracker's lead times in plan.VENUE_LEAD_DAYS are the
# suggested deadlines; these are the hard minimums the venue offices state).
MIN_NOTICE_DAYS = {"tcc": (21, "live form"), "outdoor": (42, "live form")}


@dataclass(frozen=True)
class Issue:
    code: str
    message: str
    source: str

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


def _fmt(t: time) -> str:
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'PM' if t.hour >= 12 else 'AM'}"


def request_issues(venue_kind: str, event_date: date, event_start: time, now: datetime) -> list[Issue]:
    today = now.astimezone(TZ).date()
    days = (event_date - today).days
    out: list[Issue] = []
    if days < 0:
        return [Issue("EVENT_IN_PAST", "The event date has already passed.", "walkthrough")]
    if venue_kind in MIN_NOTICE_DAYS:
        need, src = MIN_NOTICE_DAYS[venue_kind]
        if days < need:
            out.append(Issue("LEAD_TIME", f"This venue needs {need} days' notice; the event is {days} days away.", src))
    if venue_kind == "classroom":
        start = datetime.combine(event_date, event_start, TZ)
        if start - now < timedelta(hours=48):
            out.append(Issue("LEAD_TIME", "Classroom requests are not accepted within 48 hours of the event.", "live form"))
        wd = event_date.weekday()  # Mon=0
        if wd >= 4:  # Fri–Sun: due Thursday 12:00 PM the week before
            thursday = event_date - timedelta(days=wd - 3 + 7)
            if now > datetime.combine(thursday, time(12, 0), TZ):
                out.append(Issue("LEAD_TIME", f"Friday–Sunday classroom requests were due by Thursday {thursday:%b %-d} at 12:00 PM.", "live form"))
    if venue_kind == "eeb_phe":
        if days < 3:
            out.append(Issue("LEAD_TIME", "ECE rooms need at least 3 days' notice.", "live form"))
        if days > 31:
            opens = event_date - timedelta(days=31)
            out.append(Issue("TOO_EARLY", f"ECE rooms can be booked at most 1 month ahead by non-EE groups; requests open {opens:%a %b %-d}.", "live form"))
    return out


def window_issues(venue_kind: str, event_date: date, start: time, end: time, hold_start: time, hold_end: time,
                  amplified_sound: bool) -> list[Issue]:
    out: list[Issue] = []
    if not start < end:
        return [Issue("TIME_ORDER", "The event must end after it starts.", "walkthrough")]
    open_, close, src = VENUE_HOURS.get(venue_kind, (time(8, 0), time(22, 0), "simulated"))
    if hold_start < open_ or hold_end > close:
        out.append(Issue("VENUE_HOURS", f"Setup to tear-down must fit within {_fmt(open_)}–{_fmt(close)}.", src))
    if venue_kind == "outdoor" and amplified_sound and end > time(20, 0):
        out.append(Issue("AMPLIFIED_SOUND", "No amplified sound outdoors after 8:00 PM.", "live form"))
    if venue_kind == "classroom":
        wd = event_date.weekday()
        if wd <= 3 and start < time(18, 0):
            out.append(Issue("CLASSROOM_START", "Mon–Thu classroom events start at 6:00 PM or later.", "live form"))
        if wd == 4 and start < time(15, 0):
            out.append(Issue("CLASSROOM_START", "Friday classroom events start at 3:00 PM or later.", "live form"))
        if end > time(23, 0):
            out.append(Issue("CLASSROOM_END", "Classroom events must end by 11:00 PM.", "live form"))
    return out


def reviewer_notes(venue_kind: str) -> list[str]:
    """Rules the backend can't check from the data it has; the human reviewer checks them."""
    return {
        "classroom": ["Check the academic calendar: classrooms are only for weeks 4 through the last day of instruction, never holidays, study days or finals."],
        "outdoor": ["Check for blackout dates: Welcome Experience, Festival of Books, home football days, commencement."],
        "viterbi": ["No published lead time for Viterbi spaces: confirm the request gives enough notice."],
    }.get(venue_kind, [])


def issues_as_dicts(issues: list[Issue]) -> list[dict[str, Any]]:
    return [i.as_dict() for i in issues]
