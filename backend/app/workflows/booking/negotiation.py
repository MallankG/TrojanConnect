"""The two sides of a venue negotiation (PRD §6.5–§6.6, §8.2).

- VenueSchedulingAgent acts for one venue authority. It offers only options that pass every check
  against the (simulated) inventory: capacity, equipment, opening hours, venue rules and existing
  bookings. When the club's first choice is taken it suggests the venue's own preference, the
  best-fitting room at the requested time.
- ClubNegotiator acts for the club rep within the constraints the rep confirmed: their room ranking,
  whether alternate rooms are OK, and how far the time may move. It re-checks every offer and only
  counters toward options the rep would prefer.

Both are deterministic: availability and acceptance are never decided by a language model (PRD §7.3
#2, §10.1). The negotiation stops at an exact match, when nothing better can exist, or at the round
limit, and leaves at most one active proposal for the rep to accept or decline.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Callable

from . import adapters, inventory, policy
from .inventory import Venue

MAX_ROUNDS = 5  # offers per request (PRD §6.6 default)


@dataclass(frozen=True)
class Option:
    venue: Venue
    shift: int  # minutes relative to the requested time
    start: datetime
    end: datetime
    hold_start: datetime
    hold_end: datetime

    @property
    def key(self) -> tuple[str, int]:
        return (self.venue.id, self.shift)


@dataclass(frozen=True)
class Ask:
    venue_id: str | None  # None = any room the club accepts
    max_shift: int
    by: str  # "club_request" | "venue_suggestion" | "club_counter"
    min_rank: tuple[int, int]  # best club rank this ask could produce; skipped if it can't beat the current best


Hold = tuple[str, datetime, datetime, str]  # venue_id, start, end, request_id


def parse_requested(payload: dict[str, Any]) -> dict[str, Any]:
    t = payload["requested_time"]
    start, end = datetime.fromisoformat(t["start"]), datetime.fromisoformat(t["end"])
    return {
        "start": start, "end": end,
        "hold_start": datetime.fromisoformat(t["setup_start"]) if t.get("setup_start") else start,
        "hold_end": datetime.fromisoformat(t["teardown_end"]) if t.get("teardown_end") else end,
        "flex": int(t.get("flexibility_minutes") or 0),
    }


def shifts(max_shift: int) -> list[int]:
    out = [0]
    for m in range(30, max_shift + 1, 30):
        out += [m, -m]
    return out


def busy_blocks(venue: Venue, day: date, holds: list[Hold], exclude_request: str | None) -> list[tuple[datetime, datetime]]:
    taken = adapters.get_adapter().busy_blocks(venue.id, day)  # simulated today; the admin agent's adapter later
    blocks = [(datetime.combine(day, a, inventory.TZ), datetime.combine(day, b, inventory.TZ)) for a, b in taken]
    blocks += [(s, e) for vid, s, e, rid in holds if vid == venue.id and rid != exclude_request]
    return blocks


def option_problems(payload: dict[str, Any], opt: Option, holds: list[Hold], exclude_request: str | None = None) -> list[dict[str, str]]:
    """Every reason an option can't be offered. Empty = valid (PRD §9.3 validate_proposal)."""
    space = payload["requested_space"]
    out: list[dict[str, str]] = []
    if opt.venue.capacity < int(space["capacity_required"]):
        out.append({"code": "CAPACITY", "message": f"{opt.venue.name} holds {opt.venue.capacity}; {space['capacity_required']} expected.", "source": opt.venue.capacity_source})
    missing = [f for f in space.get("features_required") or [] if f not in opt.venue.features]
    if missing:
        out.append({"code": "FEATURES", "message": f"{opt.venue.name} has no {', '.join(missing)}.", "source": "simulated"})
    if opt.hold_start.date() != opt.hold_end.date():
        return out + [{"code": "VENUE_HOURS", "message": "The booking can't run past midnight.", "source": "simulated"}]
    day = opt.start.date()
    out += policy.issues_as_dicts(policy.window_issues(
        space["venue_kind"], day, opt.start.timetz().replace(tzinfo=None), opt.end.timetz().replace(tzinfo=None),
        opt.hold_start.timetz().replace(tzinfo=None), opt.hold_end.timetz().replace(tzinfo=None),
        bool(payload["flags"].get("amplified_sound"))))
    if any(opt.hold_start < b_end and b_start < opt.hold_end for b_start, b_end in busy_blocks(opt.venue, day, holds, exclude_request)):
        out.append({"code": "UNAVAILABLE", "message": f"{opt.venue.name} is booked during that time.", "source": "simulated"})
    return out


def make_option(payload: dict[str, Any], venue: Venue, shift: int) -> Option:
    r = parse_requested(payload)
    d = timedelta(minutes=shift)
    return Option(venue, shift, r["start"] + d, r["end"] + d, r["hold_start"] + d, r["hold_end"] + d)


class ClubNegotiator:
    """The Club Agent's negotiating policy: the rep's confirmed constraints and preferences, nothing else."""

    def __init__(self, payload: dict[str, Any], authority_id: str) -> None:
        self.payload, self.authority_id = payload, authority_id
        space = payload["requested_space"]
        prefs = [inventory.find_venue(n, authority_id) for n in space.get("building_preference") or []]
        self.choice1 = prefs[0] if prefs else None
        self.choice2 = prefs[1] if len(prefs) > 1 and prefs[1] and prefs[1] != self.choice1 else None
        self.accept_alternate = bool(space.get("accept_alternate"))
        self.flex = parse_requested(payload)["flex"]
        self.capacity = int(space["capacity_required"])

    def venue_rank(self, venue: Venue) -> int:
        return 0 if venue == self.choice1 else 1 if venue == self.choice2 else 2

    def rank(self, opt: Option) -> tuple[int, int]:
        """Lower is better: the rep's room ranking first, then how far the time moved."""
        return (self.venue_rank(opt.venue), abs(opt.shift) // 30)

    def acceptable_venues(self) -> list[Venue]:
        named = [v for v in (self.choice1, self.choice2) if v]
        others = [v for v in inventory.venues_for(self.authority_id) if v not in named] if self.accept_alternate else []
        return named + others

    def check(self, opt: Option) -> list[str]:
        """Hard constraints, re-checked on every offer no matter what the venue side says."""
        out = []
        if opt.venue.authority_id != self.authority_id:
            out.append("outside the routed venue authority")
        if opt.venue not in self.acceptable_venues():
            out.append(f"{opt.venue.name} is not a room the club accepted")
        if abs(opt.shift) > self.flex:
            out.append(f"moves the time by {abs(opt.shift)} min (limit {self.flex})")
        if opt.venue.capacity < self.capacity:
            out.append("too small")
        missing = [f for f in self.payload["requested_space"].get("features_required") or [] if f not in opt.venue.features]
        if missing:
            out.append("missing " + ", ".join(missing))
        return out

    def asks(self) -> list[Ask]:
        c1, c2, f = self.choice1, self.choice2, self.flex
        ladder: list[Ask] = []
        if c1:
            ladder.append(Ask(c1.id, 0, "club_request", (0, 0)))
        ladder.append(Ask(None, 0, "venue_suggestion" if c1 else "club_request", (0, 0)))
        if c1 and f:
            ladder.append(Ask(c1.id, f, "club_counter", (0, 1)))
        if c2:
            ladder.append(Ask(c2.id, 0, "club_counter", (1, 0)))
            if f:
                ladder.append(Ask(c2.id, f, "club_counter", (1, 1)))
        if f and self.accept_alternate:
            ladder.append(Ask(None, f, "club_counter", (2, 1)))
        return ladder


class VenueSchedulingAgent:
    """Acts for one venue authority. Offers only options that pass option_problems()."""

    def __init__(self, authority_id: str, payload: dict[str, Any], holds: list[Hold], club: ClubNegotiator) -> None:
        self.authority_id, self.payload, self.holds, self.club = authority_id, payload, holds, club

    def respond(self, ask: Ask, offered: set[tuple[str, int]]) -> Option | None:
        venues = [inventory.VENUE_BY_ID[ask.venue_id]] if ask.venue_id else self.club.acceptable_venues()
        order = {s: i for i, s in enumerate(shifts(ask.max_shift))}
        options = [make_option(self.payload, v, s) for v in venues for s in order]
        options = [o for o in options if o.key not in offered and not option_problems(self.payload, o, self.holds)]
        # The venue's own preference: closest to the requested time, then the room that fits the group best.
        waste = (lambda o: 0) if ask.venue_id else (lambda o: o.venue.capacity - self.club.capacity)
        options.sort(key=lambda o: (abs(o.shift), waste(o), order[o.shift], o.venue.id))
        return options[0] if options else None

    def feasible_count(self) -> int:
        """How many options exist inside the club's constraints (for the AVAILABILITY_RESULT)."""
        return sum(1 for v in self.club.acceptable_venues() for s in shifts(self.club.flex)
                   if not option_problems(self.payload, make_option(self.payload, v, s), self.holds))


Emit = Callable[..., Any]


def negotiate(venue_agent: VenueSchedulingAgent, club: ClubNegotiator, emit: Emit, *, rounds_used: int,
              offered: set[tuple[str, int]], best: Option | None = None) -> tuple[Option | None, int]:
    """Run the bounded offer/counteroffer exchange. `emit(type, sender, note, option=, ask=)` records each message."""
    rounds = rounds_used
    for ask in club.asks():
        if best and club.rank(best) == (0, 0):
            break
        if rounds >= MAX_ROUNDS:
            emit("BOOKING_STATUS", "club", f"Round limit ({MAX_ROUNDS}) reached; stopping the negotiation.")
            break
        if best and ask.min_rank >= club.rank(best):
            continue
        if ask.by == "club_counter":
            emit("COUNTEROFFER", "club", _counter_note(club, ask), ask=ask)
        opt = venue_agent.respond(ask, offered)
        if not opt:
            emit("DECLINE_PROPOSAL", "venue", _none_note(club, ask))
            continue
        rounds += 1
        offered.add(opt.key)
        emit("OFFER", "venue", _offer_note(club, opt, ask), option=opt)
        problems = club.check(opt)
        if problems:
            emit("DECLINE_PROPOSAL", "club", "Declined: " + "; ".join(problems) + ".")
            continue
        if best is None or club.rank(opt) < club.rank(best):
            best = opt
    return best, rounds


def fmt_time(dt: datetime) -> str:
    return f"{dt.hour % 12 or 12}:{dt.minute:02d} {'PM' if dt.hour >= 12 else 'AM'}"


def describe_shift(shift: int) -> str:
    if not shift:
        return "at the requested time"
    return f"{abs(shift)} min {'later' if shift > 0 else 'earlier'}"


def _offer_note(club: ClubNegotiator, opt: Option, ask: Ask) -> str:
    when = f"{fmt_time(opt.start)}–{fmt_time(opt.end)} ({describe_shift(opt.shift)})"
    if ask.by == "venue_suggestion":
        return f"Suggesting {opt.venue.name} (seats {opt.venue.capacity}) {when}; it is the best fit available."
    return f"{opt.venue.name} (seats {opt.venue.capacity}) is available {when}."


def _counter_note(club: ClubNegotiator, ask: Ask) -> str:
    room = inventory.VENUE_BY_ID[ask.venue_id].name if ask.venue_id else "any room the club accepts"
    rank = "first choice" if ask.venue_id and club.choice1 and ask.venue_id == club.choice1.id else "second choice" if ask.venue_id else "fallback"
    return f"The club would prefer {room} ({rank}). We can move the time by up to {ask.max_shift} min." if ask.max_shift \
        else f"The club would prefer {room} ({rank}) at the requested time."


def _none_note(club: ClubNegotiator, ask: Ask) -> str:
    room = inventory.VENUE_BY_ID[ask.venue_id].name if ask.venue_id else "No room that meets the club's constraints"
    window = f" within {ask.max_shift} min of the requested time" if ask.max_shift else " at the requested time"
    return f"{room} is not available{window}." if ask.venue_id else f"{room} is free{window}."
