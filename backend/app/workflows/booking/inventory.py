"""Seeded demo inventory for the Venue Scheduling Agent: venue authorities, venues, routing rules,
reviewer identities and simulated availability.

SIMULATED (PRD §9.3 `search_venue_inventory`, §11.5). Nothing here is read from or written to a USC
system. The authorities, room names, lead times and the rules marked `source="live form"` were
collected from the public USC forms in Nov 2026 (docs/event-pipeline.md). Capacities (except the two
TCC figures printed on the TCC form), features, the hours marked simulated and every busy block are
demo data, and the UI labels them "Simulated availability".

Swap this module for the Supabase tables `venue_authorities`, `venues`, `venue_routing_rules` and
`venue_availability` (PRD §13) when the database lands.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date, time
from typing import Any
from zoneinfo import ZoneInfo

TZ_NAME = "America/Los_Angeles"
TZ = ZoneInfo(TZ_NAME)
INVENTORY_VERSION = "inventory_v1-simulated"
ROUTING_VERSION = "routing_v1"
SOURCE_LABEL = "Simulated availability: seeded demo inventory, not a live USC calendar. A free slot is not a reservation."

AUTHORITIES: dict[str, dict[str, Any]] = {
    "tes": {"id": "tes", "name": "Trojan Event Services (TES)", "authority_type": "venue_office"},
    "classroom_scheduling": {"id": "classroom_scheduling", "name": "Campus Activities / Classroom Scheduling", "authority_type": "venue_office"},
    "viterbi_events": {"id": "viterbi_events", "name": "Viterbi School event spaces", "authority_type": "venue_office"},
    "ece_rooms": {"id": "ece_rooms", "name": "ECE Department conference rooms", "authority_type": "venue_office"},
    "event_permits": {"id": "event_permits", "name": "USC Event Permits (DPS and reviewing departments)", "authority_type": "permit_office"},
}
for _a in AUTHORITIES.values():
    _a["integration_mode"] = "simulated"

PERMIT_AUTHORITY = "event_permits"

# Venue type (the profile's venueKind) -> scheduling authority. Routing comes from this table, never a model guess.
ROUTING_RULES: list[dict[str, Any]] = [
    {"id": "route-tcc", "venue_kind": "tcc", "authority_id": "tes"},
    {"id": "route-outdoor", "venue_kind": "outdoor", "authority_id": "tes"},
    {"id": "route-classroom", "venue_kind": "classroom", "authority_id": "classroom_scheduling"},
    {"id": "route-viterbi", "venue_kind": "viterbi", "authority_id": "viterbi_events"},
    {"id": "route-eeb-phe", "venue_kind": "eeb_phe", "authority_id": "ece_rooms"},
]
for _r in ROUTING_RULES:
    _r.update(version=ROUTING_VERSION, active=True)

EQUIPMENT = ["Projector", "Microphone", "Whiteboard", "Tables", "Stage"]


@dataclass(frozen=True)
class Venue:
    id: str
    authority_id: str
    venue_kind: str
    name: str
    capacity: int
    features: tuple[str, ...]
    capacity_source: str = "simulated"


def _v(id_: str, kind: str, name: str, capacity: int, features: str, capacity_source: str = "simulated") -> Venue:
    authority = next(r["authority_id"] for r in ROUTING_RULES if r["venue_kind"] == kind)
    return Venue(id_, authority, kind, name, capacity, tuple(f for f in features.split(",") if f), capacity_source)


_AV = "Projector,Microphone,Tables"
VENUES: list[Venue] = [
    _v("tcc-221", "tcc", "TCC 221", 10, "Projector,Tables", "live form"),
    _v("tcc-227", "tcc", "TCC 227", 16, "Projector,Whiteboard,Tables"),
    _v("tcc-350", "tcc", "TCC 350", 42, _AV),
    _v("tcc-351", "tcc", "TCC 351", 42, _AV),
    _v("tcc-352", "tcc", "TCC 352", 42, _AV),
    _v("tcc-350-352", "tcc", "TCC 350/351/352 (combined)", 126, _AV + ",Stage", "live form"),
    _v("tcc-450", "tcc", "TCC 450 (Forum)", 60, _AV + ",Stage"),
    _v("mccarthy-quad", "outdoor", "McCarthy Quad", 500, "Tables,Stage"),
    _v("alumni-park", "outdoor", "Alumni Park", 400, "Tables,Stage"),
    _v("hahn-plaza", "outdoor", "Hahn Plaza", 200, "Tables"),
    _v("associates-park", "outdoor", "Associates Park", 150, "Tables"),
    _v("thh-101", "classroom", "THH 101", 190, "Projector,Microphone,Whiteboard"),
    _v("thh-102", "classroom", "THH 102", 60, "Projector,Whiteboard"),
    _v("sgm-123", "classroom", "SGM 123", 70, "Projector,Microphone,Whiteboard"),
    _v("vkc-152", "classroom", "VKC 152", 45, "Projector,Whiteboard"),
    _v("wph-207", "classroom", "WPH 207", 50, "Projector,Whiteboard"),
    _v("rth-105", "viterbi", "RTH 105", 60, "Projector,Microphone,Whiteboard"),
    _v("ohe-136", "viterbi", "OHE 136", 50, "Projector,Whiteboard"),
    _v("sgm-124", "viterbi", "SGM 124", 40, "Projector,Whiteboard"),
    _v("eeb-110", "eeb_phe", "EEB 110", 20, "Projector,Whiteboard,Tables"),
    _v("eeb-132", "eeb_phe", "EEB 132", 60, "Projector,Microphone,Whiteboard"),
    _v("eeb-203", "eeb_phe", "EEB 203", 16, "Projector,Whiteboard,Tables"),
    _v("eeb-248", "eeb_phe", "EEB 248", 30, "Projector,Whiteboard,Tables"),
    _v("eeb-349", "eeb_phe", "EEB 349", 14, "Projector,Whiteboard,Tables"),
    _v("eeb-403", "eeb_phe", "EEB 403", 12, "Projector,Whiteboard,Tables"),
    _v("eeb-539", "eeb_phe", "EEB 539", 24, "Projector,Whiteboard,Tables"),
    _v("phe-223", "eeb_phe", "PHE 223", 30, "Projector,Whiteboard,Tables"),
    _v("phe-631", "eeb_phe", "PHE 631", 18, "Projector,Whiteboard,Tables"),
]
VENUE_BY_ID = {v.id: v for v in VENUES}

# Opening hours per venue type: (open, close, source). Outdoor hours are on the TES form; the rest are demo values.
VENUE_HOURS: dict[str, tuple[time, time, str]] = {
    "tcc": (time(7, 0), time(23, 0), "simulated"),
    "outdoor": (time(8, 0), time(23, 30), "live form"),
    "classroom": (time(8, 0), time(23, 0), "live form"),
    "viterbi": (time(8, 0), time(22, 0), "simulated"),
    "eeb_phe": (time(8, 0), time(22, 0), "simulated"),
}

# Demo identities standing in for Supabase Auth users with a `venue_reviewer` role (PRD §3.1, §14).
# The USG representative has no venue authority and exists to show that approval is refused.
REVIEWERS: dict[str, dict[str, Any]] = {
    "rev-tes": {"name": "TES reviewer (demo)", "role": "venue_reviewer", "authorities": ["tes"]},
    "rev-classroom": {"name": "Classroom Scheduling reviewer (demo)", "role": "venue_reviewer", "authorities": ["classroom_scheduling"]},
    "rev-viterbi": {"name": "Viterbi events reviewer (demo)", "role": "venue_reviewer", "authorities": ["viterbi_events"]},
    "rev-ece": {"name": "ECE rooms reviewer (demo)", "role": "venue_reviewer", "authorities": ["ece_rooms"]},
    "rev-permits": {"name": "Event Permits reviewer (demo)", "role": "venue_reviewer", "authorities": ["event_permits"]},
    "rep-usg": {"name": "USG representative (demo)", "role": "usg_representative", "authorities": []},
}
for _id, _r in REVIEWERS.items():
    _r.update(id=_id, email=f"{_id}@reviewers.demo.invalid", active=True)


# Opt-in demo stand-ins for the venue offices (DEMO_AUTO_REVIEW=true). They approve through the same
# authorization checks as a human reviewer, and every decision they make is labelled simulated.
SIMULATED_REVIEWERS: dict[str, dict[str, Any]] = {
    f"sim-{a}": {"id": f"sim-{a}", "name": f"Simulated {AUTHORITIES[a]['name']} office (demo)", "role": "venue_reviewer", "authorities": [a],
                 "email": f"sim-{a}@reviewers.demo.invalid", "active": True, "simulated": True}
    for a in AUTHORITIES
}


def reviewer_record(reviewer_id: str) -> dict[str, Any] | None:
    return REVIEWERS.get(reviewer_id) or SIMULATED_REVIEWERS.get(reviewer_id)


def _norm(name: str) -> str:
    return re.sub(r"[^A-Z0-9/]", "", name.upper())


def route(venue_kind: str | None) -> dict[str, Any] | None:
    """The active routing rule for a venue type, or None (= ROUTING_UNRESOLVED, escalate)."""
    return next((r for r in ROUTING_RULES if r["active"] and r["venue_kind"] == venue_kind), None)


def find_venue(name: Any, authority_id: str) -> Venue | None:
    """A venue in this authority's inventory matching what the club typed ("tcc350", "TCC 350")."""
    key = _norm(str(name or ""))
    if not key:
        return None
    return next((v for v in VENUES if v.authority_id == authority_id and (_norm(v.name) == key or _norm(v.name).startswith(key + "("))), None)


def venues_for(authority_id: str) -> list[Venue]:
    return [v for v in VENUES if v.authority_id == authority_id]


def seeded_busy(venue_id: str, day: date) -> list[tuple[time, time]]:
    """Demo bookings already on the calendar: 0–2 blocks per venue per day, stable for a given date.

    Deterministic so a demo replays the same way. Tests replace this function.
    """
    h = hashlib.sha256(f"{venue_id}:{day.isoformat()}".encode()).digest()
    blocks = []
    for i in range(h[0] % 3):
        start_half = 18 + h[1 + i] % 24  # 9:00 AM .. 8:30 PM, in half hours
        length = 2 + h[4 + i] % 4  # 1 to 2.5 hours
        end_half = min(start_half + length, 46)
        blocks.append((time(start_half // 2, 30 * (start_half % 2)), time(end_half // 2, 30 * (end_half % 2))))
    return sorted(blocks)
