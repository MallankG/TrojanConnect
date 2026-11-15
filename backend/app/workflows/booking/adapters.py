"""Venue booking adapters: where availability comes from and where a confirmed booking is placed.

The workflow (service.py) talks to the venue side only through this interface, so the simulated
booking used today can later be swapped for an admin agent that books through the real USC systems,
without changing the state machine, the agents, the review step or the API.

Calls made by the workflow:
- `busy_blocks(venue_id, day)`: times a venue is already taken (the Venue Scheduling Agent never offers them).
- `place_booking(request, reference)`: called once, at confirmation, after an authorized reviewer approved.
  Returns `{"status": "placed", "reference": ..., ...}` to confirm the request with that reference, or
  `{"status": "pending", ...}` to leave it APPROVED (e.g. an admin agent that needs a person to press
  Submit on the USC form), or raises AdapterError to refuse.

BOOKING_ADAPTER picks the adapter. Only `simulated` exists today.

Writing the admin-agent adapter later: implement the same two methods. `place_booking` gets the full
request document (payload, accepted proposal, review decision), so it can fill the venue office's form
and return the office's real reservation number. Keep PRD §7.3 #8–9 in mind: only with authorized
access, and never without the human approval that precedes this call.
"""

from __future__ import annotations

import os
from datetime import date, time
from typing import Any, Protocol

from . import inventory


class AdapterError(Exception):
    """The venue side refused the booking; the request stays APPROVED and the reason is shown."""


class VenueBookingAdapter(Protocol):
    name: str
    integration_mode: str  # "simulated" | "live"

    def busy_blocks(self, venue_id: str, day: date) -> list[tuple[time, time]]: ...

    def place_booking(self, request: dict[str, Any], reference: str) -> dict[str, Any]: ...


class SimulatedVenueAdapter:
    """Today's mock: seeded busy blocks, and confirmation with the reviewer's (or simulated office's) reference."""
    name = "simulated"
    integration_mode = "simulated"

    def busy_blocks(self, venue_id: str, day: date) -> list[tuple[time, time]]:
        return inventory.seeded_busy(venue_id, day)  # looked up at call time so demos and tests can replace it

    def place_booking(self, request: dict[str, Any], reference: str) -> dict[str, Any]:
        return {"status": "placed", "reference": reference, "adapter": self.name, "integration_mode": self.integration_mode,
                "note": "Simulated: no external venue system was contacted."}


_ADAPTERS: dict[str, type] = {"simulated": SimulatedVenueAdapter}


def get_adapter() -> VenueBookingAdapter:
    name = os.environ.get("BOOKING_ADAPTER", "simulated").lower()
    if name not in _ADAPTERS:
        raise RuntimeError(f"Unknown BOOKING_ADAPTER '{name}'. Available: {', '.join(_ADAPTERS)}")
    return _ADAPTERS[name]()


def register(name: str, adapter_cls: type) -> None:
    """Make another adapter (e.g. the admin agent) selectable with BOOKING_ADAPTER=<name>."""
    _ADAPTERS[name] = adapter_cls
