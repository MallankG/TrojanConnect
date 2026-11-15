"""Booking state machine (PRD §7). The only code that changes a request's `state`.

`transition()` checks both the edge (from -> to, per workflow kind) and who is asking (§7.2). A model
can't reach it directly: the Club Agent's tools only prepare drafts and ask for alternatives, and every
other transition needs a club rep's click, a reviewer, or the backend itself.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

STATE_LABELS = {
    "DRAFT": "Draft",
    "NEEDS_INFORMATION": "Needs information",
    "READY_FOR_SUBMISSION": "Ready for you to confirm",
    "SUBMITTED": "Submitted",
    "ROUTING": "Routing to the venue authority",
    "AVAILABILITY_CHECK": "Checking availability",
    "NEGOTIATING": "Proposal ready for you",
    "PROPOSAL_ACCEPTED": "Proposal accepted",
    "PENDING_HUMAN_REVIEW": "Pending human review",
    "APPROVED": "Approved, not yet confirmed",
    "CONFIRMED": "Confirmed",
    "CHANGES_REQUESTED": "Changes requested",
    "REJECTED": "Rejected",
    "CANCEL_REQUESTED": "Cancellation requested",
    "CANCELLED": "Cancelled",
    "EXPIRED": "Expired",
    "FAILED_REQUIRES_HUMAN": "Needs a human",
}

_DRAFTING = {"DRAFT", "NEEDS_INFORMATION", "READY_FOR_SUBMISSION"}
_REVIEWED = {
    "PENDING_HUMAN_REVIEW": {"APPROVED", "REJECTED", "CHANGES_REQUESTED", "CANCEL_REQUESTED"},
    "APPROVED": {"CONFIRMED", "CANCEL_REQUESTED"},
    "CONFIRMED": {"CANCEL_REQUESTED"},
    "CANCEL_REQUESTED": {"CANCELLED"},
    "CHANGES_REQUESTED": {"NEEDS_INFORMATION", "READY_FOR_SUBMISSION", "CANCELLED"},
    "FAILED_REQUIRES_HUMAN": {"CANCELLED"},
}
_DRAFT_EDGES = {s: {"NEEDS_INFORMATION", "READY_FOR_SUBMISSION", "CANCELLED"} for s in _DRAFTING}
_DRAFT_EDGES["READY_FOR_SUBMISSION"] = _DRAFT_EDGES["READY_FOR_SUBMISSION"] | {"SUBMITTED"}

TRANSITIONS: dict[str, dict[str, set[str]]] = {
    "venue_booking": {
        **_DRAFT_EDGES,
        "SUBMITTED": {"ROUTING", "FAILED_REQUIRES_HUMAN"},
        "ROUTING": {"AVAILABILITY_CHECK", "FAILED_REQUIRES_HUMAN"},
        "AVAILABILITY_CHECK": {"NEGOTIATING", "FAILED_REQUIRES_HUMAN"},
        "NEGOTIATING": {"PROPOSAL_ACCEPTED", "FAILED_REQUIRES_HUMAN", "CANCELLED", "EXPIRED"},
        "PROPOSAL_ACCEPTED": {"PENDING_HUMAN_REVIEW"},
        **_REVIEWED,
    },
    # No inventory to negotiate over: a permit goes straight from routing to the human reviewer.
    "event_permit": {
        **_DRAFT_EDGES,
        "SUBMITTED": {"ROUTING", "FAILED_REQUIRES_HUMAN"},
        "ROUTING": {"PENDING_HUMAN_REVIEW", "FAILED_REQUIRES_HUMAN"},
        **_REVIEWED,
    },
}

# PRD §7.2: who may move a request INTO each state.
TARGET_ROLES: dict[str, set[str]] = {
    "DRAFT": {"club_rep", "club_agent"},
    "NEEDS_INFORMATION": {"club_rep", "club_agent"},
    "READY_FOR_SUBMISSION": {"club_rep", "club_agent"},
    "SUBMITTED": {"club_rep"},
    "ROUTING": {"backend"},
    "AVAILABILITY_CHECK": {"backend"},
    "NEGOTIATING": {"backend"},
    "PROPOSAL_ACCEPTED": {"club_rep"},
    "PENDING_HUMAN_REVIEW": {"backend"},
    "APPROVED": {"reviewer"},
    "REJECTED": {"reviewer"},
    "CHANGES_REQUESTED": {"reviewer"},
    "CONFIRMED": {"backend"},
    "CANCEL_REQUESTED": {"club_rep"},
    "CANCELLED": {"reviewer", "backend"},
    "EXPIRED": {"backend"},
    "FAILED_REQUIRES_HUMAN": {"backend"},
}

# States in which the accepted proposal holds the slot, so no other request can be offered it.
HOLDING = {"PROPOSAL_ACCEPTED", "PENDING_HUMAN_REVIEW", "APPROVED", "CONFIRMED", "CANCEL_REQUESTED"}
# A new request can be started for the same kind once the latest one is in one of these.
CLOSED = {"REJECTED", "CANCELLED", "EXPIRED", "FAILED_REQUIRES_HUMAN"}
DRAFTING = _DRAFTING | {"CHANGES_REQUESTED"}


class TransitionError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


def transition(req: dict[str, Any], to: str, *, actor: str, role: str, reason: str, now: datetime) -> None:
    """Move `req` to `to` or raise TransitionError. Appends the audit entry (actor, timestamp, reason, correlation ID)."""
    frm = req["state"]
    if to not in TRANSITIONS[req["kind"]].get(frm, set()):
        raise TransitionError("INVALID_TRANSITION", f"A {req['kind']} request can't go from {frm} to {to}.")
    if role not in TARGET_ROLES[to]:
        raise TransitionError("PERMISSION_DENIED", f"Role '{role}' may not move a request to {to}.")
    req["state"] = to
    req["version"] += 1
    req["updated_at"] = now.isoformat()
    audit(req, action="state_change", actor=actor, role=role, reason=reason, now=now, from_state=frm, to_state=to)


def audit(req: dict[str, Any], *, action: str, actor: str, role: str, reason: str, now: datetime,
          from_state: str | None = None, to_state: str | None = None, **extra: Any) -> None:
    req["timeline"].append({
        "at": now.isoformat(), "actor": actor, "role": role, "action": action, "reason": reason,
        "from_state": from_state, "to_state": to_state, "correlation_id": req["correlation_id"], **extra,
    })
