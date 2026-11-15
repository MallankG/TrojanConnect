import type { Actor, BookingState } from "@/lib/api/types";

/**
 * The booking state machine from PRD 7.1 and 7.2.
 *
 * The mock backend refuses any transition that is not listed here for the
 * acting party, so the UI cannot reach a state the real system would forbid.
 * In particular there is no path to CONFIRMED that skips a reviewer's APPROVED,
 * and no agent can cause either.
 */
const TRANSITIONS: Record<BookingState, Partial<Record<BookingState, Actor[]>>> = {
  DRAFT: {
    NEEDS_INFORMATION: ["club_agent"],
    READY_FOR_SUBMISSION: ["club_agent", "club_rep"],
    CANCELLED: ["club_rep"],
  },
  NEEDS_INFORMATION: {
    READY_FOR_SUBMISSION: ["club_agent", "club_rep"],
    CANCELLED: ["club_rep"],
  },
  READY_FOR_SUBMISSION: {
    SUBMITTED: ["club_rep"],
    NEEDS_INFORMATION: ["club_agent"],
    CANCELLED: ["club_rep"],
  },
  SUBMITTED: { ROUTING: ["backend"], CANCEL_REQUESTED: ["club_rep"] },
  ROUTING: {
    AVAILABILITY_CHECK: ["backend"],
    FAILED_REQUIRES_HUMAN: ["backend"],
    CANCEL_REQUESTED: ["club_rep"],
  },
  AVAILABILITY_CHECK: {
    NEGOTIATING: ["venue_adapter"],
    FAILED_REQUIRES_HUMAN: ["venue_adapter", "backend"],
    CANCEL_REQUESTED: ["club_rep"],
  },
  NEGOTIATING: {
    PROPOSAL_ACCEPTED: ["club_rep"],
    FAILED_REQUIRES_HUMAN: ["venue_adapter", "backend"],
    EXPIRED: ["backend"],
    CANCEL_REQUESTED: ["club_rep"],
  },
  PROPOSAL_ACCEPTED: {
    PENDING_HUMAN_REVIEW: ["backend"],
    CANCEL_REQUESTED: ["club_rep"],
  },
  PENDING_HUMAN_REVIEW: {
    APPROVED: ["reviewer"],
    REJECTED: ["reviewer"],
    CHANGES_REQUESTED: ["reviewer"],
    CANCEL_REQUESTED: ["club_rep"],
  },
  CHANGES_REQUESTED: {
    NEGOTIATING: ["club_rep"],
    PENDING_HUMAN_REVIEW: ["club_rep"],
    CANCEL_REQUESTED: ["club_rep"],
  },
  APPROVED: { CONFIRMED: ["backend"], FAILED_REQUIRES_HUMAN: ["backend"] },
  CONFIRMED: { CANCEL_REQUESTED: ["club_rep"] },
  CANCEL_REQUESTED: { CANCELLED: ["reviewer"] },
  REJECTED: {},
  CANCELLED: {},
  EXPIRED: {},
  FAILED_REQUIRES_HUMAN: {},
};

export function canTransition(from: BookingState, to: BookingState, actor: Actor) {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export class TransitionError extends Error {
  constructor(
    public from: BookingState,
    public to: BookingState,
    public actor: Actor,
  ) {
    super(`${actor} cannot move a booking from ${from} to ${to}`);
  }
}

export function assertTransition(from: BookingState, to: BookingState, actor: Actor) {
  if (!canTransition(from, to, actor)) throw new TransitionError(from, to, actor);
}

// ---- Presentation ----------------------------------------------------------

/** The six steps a person follows. Several machine states share one step. */
export const PHASES = ["Draft", "Submitted", "Negotiating", "In review", "Approved", "Confirmed"];

export function phaseOf(state: BookingState): number {
  switch (state) {
    case "DRAFT":
    case "NEEDS_INFORMATION":
    case "READY_FOR_SUBMISSION":
      return 0;
    case "SUBMITTED":
    case "ROUTING":
    case "AVAILABILITY_CHECK":
      return 1;
    case "NEGOTIATING":
      return 2;
    case "PROPOSAL_ACCEPTED":
    case "PENDING_HUMAN_REVIEW":
    case "CHANGES_REQUESTED":
      return 3;
    case "APPROVED":
      return 4;
    case "CONFIRMED":
      return 5;
    default:
      return -1;
  }
}

export type Tone = "neutral" | "progress" | "review" | "attention" | "good" | "bad";

/** Label and tone for a state. Tone picks the marker colour; the label always carries the meaning. */
export function describeState(state: BookingState): { label: string; tone: Tone; next: string } {
  switch (state) {
    case "DRAFT":
    case "NEEDS_INFORMATION":
      return { label: "Draft", tone: "neutral", next: "Finish the details with your Club Agent" };
    case "READY_FOR_SUBMISSION":
      return { label: "Ready to send", tone: "neutral", next: "Confirm the summary to send it" };
    case "SUBMITTED":
    case "ROUTING":
      return { label: "Routing", tone: "progress", next: "Finding the right venue authority" };
    case "AVAILABILITY_CHECK":
      return { label: "Checking rooms", tone: "progress", next: "Venue workflow is checking inventory" };
    case "NEGOTIATING":
      return { label: "Proposal ready", tone: "attention", next: "Review the proposal and accept or ask for another" };
    case "PROPOSAL_ACCEPTED":
    case "PENDING_HUMAN_REVIEW":
      return { label: "In review", tone: "review", next: "Waiting for the venue reviewer" };
    case "CHANGES_REQUESTED":
      return { label: "Changes requested", tone: "attention", next: "The reviewer asked for changes" };
    case "APPROVED":
      return { label: "Approved", tone: "good", next: "Recording the confirmation" };
    case "CONFIRMED":
      return { label: "Confirmed", tone: "good", next: "Nothing left to do" };
    case "REJECTED":
      return { label: "Rejected", tone: "bad", next: "Read the reviewer's reason" };
    case "CANCEL_REQUESTED":
      return { label: "Cancellation requested", tone: "attention", next: "Waiting for the venue to cancel" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "neutral", next: "This request is closed" };
    case "EXPIRED":
      return { label: "Expired", tone: "neutral", next: "Start a new request" };
    case "FAILED_REQUIRES_HUMAN":
      return { label: "Needs a person", tone: "attention", next: "Escalated to venue staff" };
  }
}

export const isOpen = (state: BookingState) =>
  !["CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED", "FAILED_REQUIRES_HUMAN"].includes(state);
