"""Pydantic contracts for the booking workflow (PRD §6 agent-to-agent contract, §9.1 conventions).

Every message between the Club Agent and the Venue Scheduling Agent is built through `AgentMessage`,
which rejects unknown fields and unknown message types. Agents never mutate state by talking to each
other: the service validates each message, then the service (not the message) changes state.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CONTRACT_VERSION = "1.0"


class MessageType(str, Enum):
    BOOKING_REQUEST = "BOOKING_REQUEST"
    CLARIFICATION_REQUEST = "CLARIFICATION_REQUEST"
    CLARIFICATION_RESPONSE = "CLARIFICATION_RESPONSE"
    AVAILABILITY_QUERY = "AVAILABILITY_QUERY"
    AVAILABILITY_RESULT = "AVAILABILITY_RESULT"
    OFFER = "OFFER"
    COUNTEROFFER = "COUNTEROFFER"
    ACCEPT_PROPOSAL = "ACCEPT_PROPOSAL"
    DECLINE_PROPOSAL = "DECLINE_PROPOSAL"
    HUMAN_REVIEW_REQUIRED = "HUMAN_REVIEW_REQUIRED"
    REVIEW_DECISION = "REVIEW_DECISION"
    BOOKING_STATUS = "BOOKING_STATUS"
    CANCEL_REQUEST = "CANCEL_REQUEST"
    ERROR = "ERROR"


TIME_SENSITIVE = {MessageType.OFFER, MessageType.COUNTEROFFER, MessageType.AVAILABILITY_RESULT}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentRef(Strict):
    agent_id: str = Field(max_length=120)
    agent_type: Literal["club", "venue", "review_queue", "workflow"]
    owner_id: str = Field(max_length=120)


class TimeWindow(Strict):
    start: datetime
    end: datetime
    timezone: str = Field(max_length=64)

    @model_validator(mode="after")
    def _order(self) -> "TimeWindow":
        if self.start.tzinfo is None or self.end.tzinfo is None:
            raise ValueError("timestamps need a timezone")
        if not self.start < self.end:
            raise ValueError("start must precede end")
        return self


class ProposalPayload(Strict):
    """PRD §6.5. A complete option; an accepted proposal is not a confirmed booking."""
    proposal_id: str = Field(max_length=64)
    proposal_version: int = Field(ge=1)
    based_on_proposal_id: str | None = Field(default=None, max_length=64)
    venue_id: str | None = Field(max_length=64)  # None only in a counteroffer that leaves the room open
    venue_name: str | None = Field(default=None, max_length=120)
    venue_authority_id: str = Field(max_length=64)
    time: TimeWindow
    hold: TimeWindow | None = None  # setup to tear-down
    capacity: int | None = Field(default=None, ge=1)
    included_features: list[str] = Field(default_factory=list, max_length=20)
    conditions: list[str] = Field(default_factory=list, max_length=10)
    expires_at: datetime
    source_availability_version: str = Field(max_length=64)


class NotePayload(Strict):
    note: str = Field(max_length=2000)
    data: dict[str, Any] = Field(default_factory=dict)


class AgentMessage(Strict):
    contract_version: Literal["1.0"] = CONTRACT_VERSION
    message_id: str
    conversation_id: str
    correlation_id: str
    causation_id: str | None
    workflow_type: Literal["venue_booking", "event_permit"]
    workflow_id: str
    sender: AgentRef
    recipient: AgentRef
    message_type: MessageType
    created_at: datetime
    expires_at: datetime | None
    idempotency_key: str = Field(max_length=200)
    payload: ProposalPayload | NotePayload
    note: str = Field(default="", max_length=2000)  # human-readable line for the timeline
    trace: dict[str, Any]

    @model_validator(mode="after")
    def _rules(self) -> "AgentMessage":
        if self.message_type in TIME_SENSITIVE and self.expires_at is None:
            raise ValueError(f"{self.message_type.value} needs expires_at")
        is_proposal = self.message_type in (MessageType.OFFER, MessageType.COUNTEROFFER)
        if is_proposal != isinstance(self.payload, ProposalPayload):
            raise ValueError("OFFER/COUNTEROFFER carry a proposal payload; other messages carry a note payload")
        return self


# ---- API request bodies -----------------------------------------------------------------------
Kind = Literal["venue_booking", "event_permit"]
IDEMPOTENCY = Field(min_length=8, max_length=200, description="Client-generated unique key; a retry with the same key has no extra effect.")


class DraftRequest(Strict):
    kind: Kind


class SubmitRequest(Strict):
    summary_hash: str = Field(min_length=8, max_length=64, description="The summary_hash of the draft the user reviewed.")
    user_confirmed_summary: Literal[True]
    idempotency_key: str = IDEMPOTENCY


class AcceptRequest(Strict):
    proposal_version: int = Field(ge=1)
    user_confirmed: Literal[True]
    idempotency_key: str = IDEMPOTENCY


class AlternativesRequest(Strict):
    reason: str = Field(default="", max_length=500)
    idempotency_key: str = IDEMPOTENCY


class CancelRequest(Strict):
    reason: str = Field(default="", max_length=500)
    idempotency_key: str = IDEMPOTENCY


class ReviewDecisionRequest(Strict):
    decision: Literal["APPROVE", "REJECT", "REQUEST_CHANGES", "CONFIRM_CANCELLATION"]
    reason: str = Field(default="", max_length=1000)
    external_confirmation_reference: str | None = Field(default=None, max_length=40)
    idempotency_key: str = IDEMPOTENCY


class ConfirmRequest(Strict):
    external_confirmation_reference: str = Field(min_length=1, max_length=40)
    idempotency_key: str = IDEMPOTENCY
