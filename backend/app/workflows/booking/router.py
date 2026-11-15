"""Booking API (PRD §12): club-rep actions on venue bookings and event permits, and the human reviewer
queue. These endpoints are the only way to submit, accept, approve or confirm; no agent tool reaches them.

Errors use the PRD §9.1 shape under `detail`: `{code, message, retryable}`.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.security.client import require_client_header, reviewer_id

from . import inventory, service
from .schemas import (AcceptRequest, AlternativesRequest, CancelRequest, ConfirmRequest, DraftRequest, ReviewDecisionRequest,
                      SubmitRequest)

router = APIRouter(prefix="/api/v1", tags=["bookings"], dependencies=[Depends(require_client_header)])


def _call(fn, *args: Any, **kwargs: Any) -> Any:
    try:
        return fn(*args, **kwargs)
    except service.BookingError as e:
        raise HTTPException(e.status, e.as_error()) from e


@router.get("/bookings")
def list_bookings(kind: Literal["venue_booking", "event_permit"] | None = Query(default=None)) -> list[dict[str, Any]]:
    """Requests for the current event, newest first. Each carries state, proposals, agent messages and audit timeline."""
    return service.list_for_event(kind)


@router.get("/bookings/{request_id}")
def get_booking(request_id: str) -> dict[str, Any]:
    return _call(service.get, request_id)


@router.post("/bookings/drafts")
def create_draft(body: DraftRequest) -> dict[str, Any]:
    """Build (or refresh) the draft from the event profile. Returns the summary and `summary_hash` the rep confirms. Submits nothing."""
    return service.view(_call(service.prepare, body.kind)) or {}


@router.post("/bookings/{request_id}/submit")
def submit_booking(request_id: str, body: SubmitRequest) -> dict[str, Any]:
    """The rep confirms the summary they saw. Routes, checks simulated availability and runs the agent negotiation."""
    return service.view(_call(service.submit, request_id, body.summary_hash, body.idempotency_key)) or {}


@router.post("/bookings/{request_id}/proposals/{proposal_id}/accept")
def accept(request_id: str, proposal_id: str, body: AcceptRequest) -> dict[str, Any]:
    """Accept the active proposal for human review. The result is PENDING_HUMAN_REVIEW, never CONFIRMED."""
    return service.view(_call(service.accept_proposal, request_id, proposal_id, body.proposal_version, body.idempotency_key)) or {}


@router.post("/bookings/{request_id}/alternatives")
def alternatives(request_id: str, body: AlternativesRequest) -> dict[str, Any]:
    return service.view(_call(service.request_alternatives, request_id, body.reason, body.idempotency_key)) or {}


@router.post("/bookings/{request_id}/cancel")
def cancel(request_id: str, body: CancelRequest) -> dict[str, Any]:
    return service.view(_call(service.cancel, request_id, body.reason, body.idempotency_key)) or {}


# ---- human venue review ------------------------------------------------------------------------
@router.get("/venue-review/reviewers")
def reviewers() -> list[dict[str, Any]]:
    """Demo reviewer identities (stand-ins for signed-in users) and the authorities each may decide for."""
    return [{"id": r["id"], "name": r["name"], "role": r["role"],
             "authorities": [inventory.AUTHORITIES[a]["name"] for a in r["authorities"]]} for r in inventory.REVIEWERS.values()]


@router.get("/venue-review/queue")
def queue(reviewer: str | None = Depends(reviewer_id)) -> list[dict[str, Any]]:
    """Review tasks for the reviewer's assigned authorities only. Open ones first."""
    return [v for r in _call(service.review_queue, reviewer) if (v := service.view(r, for_reviewer=True))]


@router.post("/reviews/{task_id}/decision")
def decision(task_id: str, body: ReviewDecisionRequest, reviewer: str | None = Depends(reviewer_id)) -> dict[str, Any]:
    """APPROVE (optionally with the confirmation reference), REJECT, REQUEST_CHANGES or CONFIRM_CANCELLATION."""
    req = _call(service.decide, task_id, reviewer, body.decision, body.reason, body.external_confirmation_reference, body.idempotency_key)
    return service.view(req, for_reviewer=True) or {}


@router.post("/reviews/{task_id}/confirm")
def confirm(task_id: str, body: ConfirmRequest, reviewer: str | None = Depends(reviewer_id)) -> dict[str, Any]:
    """Record the confirmation reference for an approved request; the backend then marks it CONFIRMED."""
    req = _call(service.confirm, task_id, reviewer, body.external_confirmation_reference, body.idempotency_key)
    return service.view(req, for_reviewer=True) or {}
