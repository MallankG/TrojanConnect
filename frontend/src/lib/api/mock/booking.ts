import { assertTransition, TransitionError } from "@/lib/booking/state-machine";
import { fmtRange, fmtTimeRange } from "@/lib/time";
import type {
  Actor,
  Booking,
  BookingState,
  ChatMessage,
  Conversation,
  Db,
  DemoUser,
  EventDraft,
  Proposal,
  Result,
  ReviewDecision,
  TimelineEntry,
} from "../types";
import { extract, missingFields, QUESTION } from "./extract";
import {
  INVENTORY_VERSION,
  routeRequest,
  searchInventory,
  validateProposal,
  type Candidate,
} from "./inventory";
import { getDb, mutate, uid } from "./store";

/**
 * The mock booking backend: the Club Agent's draft conversation, the venue
 * workflow, and the reviewer's decision. Every state change goes through
 * `move`, which enforces the state machine and writes the audit timeline.
 */

const MAX_ROUNDS = 5;
const PROPOSAL_TTL_MS = 30 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (code: string, message: string, retryable = false): Result<never> => ({
  ok: false,
  error: { code, message, retryable },
});

const ACTOR_KIND: Record<Actor, TimelineEntry["actor"]> = {
  club_rep: "user",
  club_agent: "club_agent",
  backend: "backend",
  venue_adapter: "venue_workflow",
  reviewer: "reviewer",
};

function findBooking(db: Db, id: string) {
  const booking = db.bookings.find((b) => b.id === id);
  if (!booking) throw new Error(`Booking ${id} not found`);
  return booking;
}
const findConversation = (db: Db, id: string) => db.conversations.find((c) => c.id === id)!;

function log(
  booking: Booking,
  actor: Actor,
  actorName: string,
  action: string,
  extra: Partial<TimelineEntry> = {},
) {
  booking.timeline.push({
    id: uid("t"),
    at: now(),
    actor: ACTOR_KIND[actor],
    actorName,
    action,
    correlationId: booking.correlationId,
    ...extra,
  });
  booking.updatedAt = now();
}

/** The only way a booking changes state. */
function move(
  booking: Booking,
  to: BookingState,
  actor: Actor,
  actorName: string,
  action: string,
  extra: Partial<TimelineEntry> = {},
) {
  assertTransition(booking.state, to, actor);
  booking.state = to;
  log(booking, actor, actorName, action, { state: to, ...extra });
}

function say(conversation: Conversation, message: Omit<ChatMessage, "id" | "at">) {
  conversation.messages.push({ id: uid("m"), at: now(), ...message });
  conversation.updatedAt = now();
}

function notify(db: Db, userId: string, text: string, href: string) {
  db.notifications.unshift({ id: uid("n"), userId, text, href, at: now(), read: false });
}

const emptyDraft = (): EventDraft => ({
  title: null,
  eventType: null,
  attendance: null,
  start: null,
  end: null,
  features: [],
  venueCategory: "campus_event_space",
  needsHumanCheck: [],
});

function ownsBooking(user: DemoUser, booking: Booking) {
  return user.role === "club_rep" && user.scopeId === booking.clubId;
}

// ---- Draft conversation ----------------------------------------------------

export function startBooking(user: DemoUser): Result<{ conversationId: string; bookingId: string }> {
  if (user.role !== "club_rep" || !user.scopeId)
    return fail("PERMISSION_DENIED", "Only a verified club representative can start a request.");
  const bookingId = uid("b");
  const conversationId = uid("c");
  mutate((db) => {
    const booking: Booking = {
      id: bookingId,
      clubId: user.scopeId!,
      createdBy: user.id,
      state: "DRAFT",
      event: emptyDraft(),
      authorityId: null,
      routingReason: null,
      proposals: [],
      acceptedProposalId: null,
      rounds: 0,
      offeredVenueIds: [],
      review: null,
      confirmationReference: null,
      timeline: [],
      conversationId,
      correlationId: uid("corr"),
      createdAt: now(),
      updatedAt: now(),
    };
    log(booking, "club_rep", user.name, "Started a request with the Club Agent", { state: "DRAFT" });
    db.bookings.unshift(booking);
    db.conversations.unshift({
      id: conversationId,
      kind: "booking",
      ownerId: user.id,
      title: "New event request",
      agentName: "Club Agent",
      clubId: user.scopeId,
      bookingId,
      activity: null,
      awaiting: null,
      updatedAt: now(),
      messages: [
        {
          id: uid("m"),
          at: now(),
          sender: "agent",
          name: "Club Agent",
          text: `Hi ${user.name.split(" ")[0]}. Tell me about the event in your own words: how many people, which day and time, and any equipment you need.`,
        },
      ],
    });
  });
  return ok({ conversationId, bookingId });
}

export async function sendBookingMessage(
  conversationId: string,
  text: string,
  user: DemoUser,
): Promise<Result<null>> {
  const conversation = findConversation(getDb(), conversationId);
  const booking = findBooking(getDb(), conversation.bookingId!);
  if (!ownsBooking(user, booking))
    return fail("PERMISSION_DENIED", "You are not authorized to act for this organization.");

  mutate((db) => {
    const c = findConversation(db, conversationId);
    say(c, { sender: "user", text });
    c.activity = "Reading your message";
  });
  await sleep(750);

  const editable = ["DRAFT", "NEEDS_INFORMATION", "READY_FOR_SUBMISSION"].includes(booking.state);
  mutate((db) => {
    const c = findConversation(db, conversationId);
    const b = findBooking(db, c.bookingId!);
    c.activity = null;

    if (!editable) {
      say(c, {
        sender: "agent",
        name: "Club Agent",
        text: "This request has already been sent, so I can't change its details here. The current status is below. To change the room or time, ask for alternatives on the proposal.",
        card: { type: "status", bookingId: b.id },
      });
      return;
    }

    const { patch, found } = extract(text, b.event, c.awaiting);
    Object.assign(b.event, patch);
    if (b.event.title) c.title = b.event.title;
    const missing = missingFields(b.event);

    if (found.length === 0 && missing.length) {
      say(c, {
        sender: "agent",
        name: "Club Agent",
        text: `I couldn't find event details in that. ${QUESTION[missing[0]]}`,
      });
      c.awaiting = missing[0];
      return;
    }
    if (missing.length) {
      if (b.state === "DRAFT" || b.state === "READY_FOR_SUBMISSION")
        move(b, "NEEDS_INFORMATION", "club_agent", "Club Agent", "Asked for missing details", {
          detail: `Missing: ${missing.join(", ")}`,
        });
      c.awaiting = missing[0];
      say(c, { sender: "agent", name: "Club Agent", text: `Got it. ${QUESTION[missing[0]]}` });
      return;
    }
    c.awaiting = null;
    if (b.state !== "READY_FOR_SUBMISSION")
      move(b, "READY_FOR_SUBMISSION", "club_agent", "Club Agent", "Extracted event details from the conversation");
    const flagged = b.event.needsHumanCheck.length
      ? ` I've flagged ${b.event.needsHumanCheck.join(" and ").toLowerCase()} for the reviewer; that needs a person.`
      : "";
    say(c, {
      sender: "agent",
      name: "Club Agent",
      text: `Here is what I have. Check it, then send it to the venue team. Nothing is sent until you confirm.${flagged}`,
      card: { type: "summary", bookingId: b.id },
    });
  });
  return ok(null);
}

// ---- Submission and the venue workflow -------------------------------------

export async function submitBooking(bookingId: string, user: DemoUser): Promise<Result<null>> {
  const current = findBooking(getDb(), bookingId);
  if (!ownsBooking(user, current))
    return fail("PERMISSION_DENIED", "You are not authorized to submit requests for this organization.");
  if (current.state !== "READY_FOR_SUBMISSION")
    return fail("INVALID_STATE", "This request is not ready to send.");
  if (missingFields(current.event).length)
    return fail("VALIDATION_FAILED", "Required details are missing.");

  mutate((db) => {
    const b = findBooking(db, bookingId);
    const c = findConversation(db, b.conversationId);
    move(b, "SUBMITTED", "club_rep", user.name, "Confirmed the summary and sent the request", {
      messageType: "BOOKING_REQUEST",
    });
    say(c, { sender: "user", text: "Send it to the venue team" });
    c.activity = "Routing to the right venue authority";
  });
  void runVenueWorkflow(bookingId);
  return ok(null);
}

function setActivity(bookingId: string, activity: string | null) {
  mutate((db) => {
    const b = findBooking(db, bookingId);
    findConversation(db, b.conversationId).activity = activity;
  });
}

function escalate(bookingId: string, actor: Actor, reason: string) {
  mutate((db) => {
    const b = findBooking(db, bookingId);
    const c = findConversation(db, b.conversationId);
    c.activity = null;
    move(b, "FAILED_REQUIRES_HUMAN", actor, actor === "backend" ? "Booking workflow" : "Venue workflow", "Escalated to venue staff", { detail: reason, messageType: "ERROR" });
    say(c, {
      sender: "agent",
      name: "Club Agent",
      text: `${reason} I've stopped here and passed it to venue staff rather than guess.`,
      card: { type: "status", bookingId },
    });
  });
}

async function runVenueWorkflow(bookingId: string) {
  try {
    await sleep(900);
    const route = routeRequest(getDb(), findBooking(getDb(), bookingId).event);
    if (!route) return escalate(bookingId, "backend", "I couldn't find a configured authority for this kind of space.");
    mutate((db) => {
      const b = findBooking(db, bookingId);
      const c = findConversation(db, b.conversationId);
      move(b, "ROUTING", "backend", "Routing service", "Resolved the venue authority");
      b.authorityId = route.authorityId;
      b.routingReason = route.reason;
      const name = db.authorities.find((a) => a.id === route.authorityId)!.name;
      log(b, "backend", "Routing service", `Routed to ${name}`, { detail: route.reason });
      say(c, { sender: "system", text: `Routed to ${name}` });
      c.activity = "Checking configured venue inventory";
    });

    await sleep(1100);
    mutate((db) => {
      const b = findBooking(db, bookingId);
      move(b, "AVAILABILITY_CHECK", "backend", "Booking workflow", "Asked the venue workflow for availability", {
        messageType: "AVAILABILITY_QUERY",
      });
    });
    const candidates = searchInventory(getDb(), findBooking(getDb(), bookingId));
    if (candidates.length === 0)
      return escalate(bookingId, "venue_adapter", "No room in the simulated inventory fits the headcount, equipment and time.");

    await sleep(900);
    mutate((db) => {
      const b = findBooking(db, bookingId);
      const c = findConversation(db, b.conversationId);
      log(b, "venue_adapter", "Venue workflow", `Found ${candidates.length} candidate ${candidates.length === 1 ? "room" : "rooms"}`, {
        messageType: "AVAILABILITY_RESULT",
        detail: INVENTORY_VERSION,
      });
      say(c, { sender: "system", text: "Checked venue inventory (simulated data)" });
      c.activity = "Negotiating with the venue workflow";
    });

    // First offer: the smallest room that fits, even if its slot is shifted.
    await sleep(900);
    const first = candidates[0];
    offer(bookingId, first, "OFFER", null, true);

    if (first.shift > 0) {
      const exact = candidates.find((x) => x.shift === 0);
      await sleep(1200);
      mutate((db) => {
        const b = findBooking(db, bookingId);
        const c = findConversation(db, b.conversationId);
        const p = b.proposals[b.proposals.length - 1];
        p.status = "declined";
        b.rounds += 1;
        log(b, "club_agent", "Club Agent", "Countered: the confirmed time window is a hard constraint", {
          messageType: "COUNTEROFFER",
          detail: `Requested ${fmtRange(b.event.start!, b.event.end!)}`,
        });
        say(c, {
          sender: "agent",
          name: "Club Agent",
          text: `That starts ${first.shift} minutes late. You confirmed ${fmtTimeRange(b.event.start!, b.event.end!)}, so I've asked for a room that keeps it.`,
        });
      });
      await sleep(1200);
      if (exact) offer(bookingId, exact, "COUNTEROFFER", first.venue.id, false);
      else {
        // Nothing matches exactly: put the shifted option back and let the person decide.
        mutate((db) => {
          const b = findBooking(db, bookingId);
          b.proposals[b.proposals.length - 1].status = "active";
          say(findConversation(db, b.conversationId), {
            sender: "agent",
            name: "Club Agent",
            text: "No room keeps your exact time. The option above is the closest. Accepting it means accepting the changed time.",
          });
        });
      }
    }
    setActivity(bookingId, null);
  } catch (error) {
    setActivity(bookingId, null);
    if (!(error instanceof TransitionError)) throw error;
  }
}

function differencesFor(event: EventDraft, candidate: Candidate) {
  const out: string[] = [];
  if (candidate.start !== event.start || candidate.end !== event.end)
    out.push(`Time: ${fmtTimeRange(candidate.start, candidate.end)} instead of ${fmtTimeRange(event.start!, event.end!)}`);
  return out;
}

function offer(
  bookingId: string,
  candidate: Candidate,
  kind: Proposal["kind"],
  basedOnVenueId: string | null,
  first: boolean,
) {
  mutate((db) => {
    const b = findBooking(db, bookingId);
    const c = findConversation(db, b.conversationId);
    for (const p of b.proposals) if (p.status === "active") p.status = "superseded";
    const basedOn = basedOnVenueId
      ? b.proposals.findLast((p) => p.venueId === basedOnVenueId)?.id ?? null
      : null;
    const proposal: Proposal = {
      id: uid("p"),
      version: b.proposals.length + 1,
      basedOnProposalId: basedOn,
      kind,
      venueId: candidate.venue.id,
      authorityId: candidate.venue.authorityId,
      start: candidate.start,
      end: candidate.end,
      capacity: candidate.venue.capacity,
      features: candidate.venue.features,
      conditions: ["Subject to authorized human review", ...b.event.needsHumanCheck.map((x) => `Needs a human check: ${x}`)],
      expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString(),
      inventoryVersion: INVENTORY_VERSION,
      status: "active",
      checks: validateProposal(db, b, candidate.venue, candidate.start, candidate.end),
      differences: differencesFor(b.event, candidate),
    };
    b.proposals.push(proposal);
    b.offeredVenueIds.push(candidate.venue.id);
    b.rounds += 1;
    const action = `${kind === "OFFER" ? "Offered" : "Counteroffered"} ${candidate.venue.name}`;
    if (first) move(b, "NEGOTIATING", "venue_adapter", "Venue workflow", action, { messageType: kind });
    else log(b, "venue_adapter", "Venue workflow", action, { messageType: kind });
    say(c, {
      sender: "agent",
      name: "Venue workflow",
      text: proposal.differences.length
        ? `${candidate.venue.name} fits the headcount and equipment, with a different time.`
        : `${candidate.venue.name} fits every requirement.`,
      card: { type: "proposal", bookingId, proposalId: proposal.id },
    });
  });
}

// ---- Club representative actions -------------------------------------------

export function acceptProposal(
  bookingId: string,
  proposalId: string,
  version: number,
  user: DemoUser,
): Result<null> {
  const current = findBooking(getDb(), bookingId);
  if (!ownsBooking(user, current))
    return fail("PERMISSION_DENIED", "You are not authorized to accept proposals for this organization.");
  const target = current.proposals.find((p) => p.id === proposalId);
  if (!target || target.version !== version || target.status !== "active")
    return fail("STALE_PROPOSAL", "This proposal is no longer the current one.");
  if (new Date(target.expiresAt).getTime() < Date.now()) {
    mutate((db) => {
      findBooking(db, bookingId).proposals.find((p) => p.id === proposalId)!.status = "expired";
    });
    return fail("PROPOSAL_EXPIRED", "This proposal has expired. Ask for alternatives to get a fresh one.");
  }
  const venue = getDb().venues.find((v) => v.id === target.venueId)!;
  const checks = validateProposal(getDb(), current, venue, target.start, target.end);
  if (!checks.capacity || !checks.features || !checks.venueAuthority || !checks.availability)
    return fail("VALIDATION_FAILED", "This room no longer passes the availability checks.", true);

  try {
    mutate((db) => {
      const b = findBooking(db, bookingId);
      const c = findConversation(db, b.conversationId);
      const p = b.proposals.find((x) => x.id === proposalId)!;
      p.status = "accepted";
      b.acceptedProposalId = p.id;
      move(b, "PROPOSAL_ACCEPTED", "club_rep", user.name, `Accepted ${venue.name} for review`, { messageType: "ACCEPT_PROPOSAL" });
      b.review = { id: uid("r"), bookingId, authorityId: p.authorityId, status: "pending", createdAt: now() };
      move(b, "PENDING_HUMAN_REVIEW", "backend", "Booking workflow", "Created a review packet for the venue reviewer", { messageType: "HUMAN_REVIEW_REQUIRED" });
      say(c, { sender: "system", text: "Accepted for review. Not confirmed until a person approves." });
      say(c, { sender: "system", text: "Current status", card: { type: "status", bookingId } });
      for (const reviewer of db.users.filter((u) => u.role === "venue_reviewer" && u.scopeId === p.authorityId))
        notify(db, reviewer.id, `${b.event.title} is waiting for review`, `/venue-review/${b.review.id}`);
    });
  } catch (error) {
    return fail("INVALID_STATE", (error as Error).message);
  }
  return ok(null);
}

export async function requestAlternatives(
  bookingId: string,
  reason: string,
  user: DemoUser,
): Promise<Result<null>> {
  const current = findBooking(getDb(), bookingId);
  if (!ownsBooking(user, current))
    return fail("PERMISSION_DENIED", "You are not authorized to act for this organization.");
  if (current.state !== "NEGOTIATING" && current.state !== "CHANGES_REQUESTED")
    return fail("INVALID_STATE", "Alternatives can only be requested while a proposal is open.");

  mutate((db) => {
    const b = findBooking(db, bookingId);
    const c = findConversation(db, b.conversationId);
    if (b.state === "CHANGES_REQUESTED")
      move(b, "NEGOTIATING", "club_rep", user.name, "Reopened negotiation after the reviewer's request");
    log(b, "club_rep", user.name, "Asked for another option", { detail: reason || undefined });
    say(c, { sender: "user", text: reason ? `Another option, please: ${reason}` : "Another option, please" });
    c.activity = "Checking configured venue inventory";
  });
  await sleep(1300);

  const fresh = findBooking(getDb(), bookingId);
  if (fresh.rounds >= MAX_ROUNDS) {
    escalate(bookingId, "backend", "We've reached the limit of five negotiation rounds.");
    return ok(null);
  }
  const next = searchInventory(getDb(), fresh)
    .filter((x) => !fresh.offeredVenueIds.includes(x.venue.id))
    .sort((a, b) => a.shift - b.shift)[0];
  if (!next) {
    mutate((db) => {
      const b = findBooking(db, bookingId);
      const c = findConversation(db, b.conversationId);
      c.activity = null;
      log(b, "venue_adapter", "Venue workflow", "No further rooms fit the request", { messageType: "AVAILABILITY_RESULT" });
      say(c, {
        sender: "agent",
        name: "Venue workflow",
        text: "No other room in the simulated inventory fits the headcount, equipment and time. The last proposal is still open if it works for you.",
      });
    });
    return ok(null);
  }
  offer(bookingId, next, "COUNTEROFFER", null, false);
  setActivity(bookingId, null);
  return ok(null);
}

export function resubmitForReview(bookingId: string, note: string, user: DemoUser): Result<null> {
  const current = findBooking(getDb(), bookingId);
  if (!ownsBooking(user, current))
    return fail("PERMISSION_DENIED", "You are not authorized to act for this organization.");
  if (!note.trim()) return fail("VALIDATION_FAILED", "Add a reply for the reviewer.");
  try {
    mutate((db) => {
      const b = findBooking(db, bookingId);
      move(b, "PENDING_HUMAN_REVIEW", "club_rep", user.name, "Replied to the reviewer and resubmitted", { detail: note, messageType: "CLARIFICATION_RESPONSE" });
      b.review = { id: uid("r"), bookingId, authorityId: b.authorityId!, status: "pending", createdAt: now() };
      say(findConversation(db, b.conversationId), { sender: "user", text: note });
      say(findConversation(db, b.conversationId), { sender: "system", text: "Sent back to the venue reviewer" });
      for (const reviewer of db.users.filter((u) => u.role === "venue_reviewer" && u.scopeId === b.authorityId))
        notify(db, reviewer.id, `${b.event.title} was resubmitted`, `/venue-review/${b.review.id}`);
    });
  } catch (error) {
    return fail("INVALID_STATE", (error as Error).message);
  }
  return ok(null);
}

export function requestCancel(bookingId: string, user: DemoUser): Result<null> {
  const current = findBooking(getDb(), bookingId);
  if (!ownsBooking(user, current))
    return fail("PERMISSION_DENIED", "You are not authorized to act for this organization.");
  const draft = ["DRAFT", "NEEDS_INFORMATION", "READY_FOR_SUBMISSION"].includes(current.state);
  try {
    mutate((db) => {
      const b = findBooking(db, bookingId);
      if (draft) move(b, "CANCELLED", "club_rep", user.name, "Discarded the draft");
      else move(b, "CANCEL_REQUESTED", "club_rep", user.name, "Requested cancellation", { messageType: "CANCEL_REQUEST" });
      say(findConversation(db, b.conversationId), {
        sender: "system",
        text: draft ? "Draft discarded" : "Cancellation requested. The venue team will confirm it.",
      });
    });
  } catch (error) {
    return fail("INVALID_STATE", (error as Error).message);
  }
  return ok(null);
}

// ---- Reviewer actions (never exposed to an agent) --------------------------

export function recordDecision(
  reviewId: string,
  decision: ReviewDecision,
  reason: string,
  user: DemoUser,
): Result<null> {
  const current = getDb().bookings.find((b) => b.review?.id === reviewId);
  if (!current?.review) return fail("NOT_FOUND", "Review task not found.");
  if (user.role !== "venue_reviewer" || user.scopeId !== current.review.authorityId)
    return fail("PERMISSION_DENIED", "Only a reviewer assigned to this venue authority can decide this request.");
  if (current.review.status !== "pending") return fail("INVALID_STATE", "This request has already been decided.");
  if (decision !== "APPROVE" && !reason.trim())
    return fail("VALIDATION_FAILED", "A reason is required to reject or request changes.");

  try {
    mutate((db) => {
      const b = findBooking(db, current.id);
      const c = findConversation(db, b.conversationId);
      const review = b.review!;
      const text = reason.trim() || "Requirements reviewed.";
      review.decision = { decision, reviewerId: user.id, reviewerName: user.name, reason: text, at: now() };
      const extra = { messageType: "REVIEW_DECISION", detail: text };

      if (decision === "APPROVE") {
        review.status = "approved";
        move(b, "APPROVED", "reviewer", user.name, "Approved the request", extra);
        say(c, { sender: "reviewer", name: user.name, text: `Approved. ${text}` });
        // Backend-only step: recheck the room, then confirm.
        const accepted = b.proposals.find((p) => p.id === b.acceptedProposalId)!;
        const venue = db.venues.find((v) => v.id === accepted.venueId)!;
        const checks = validateProposal(db, b, venue, accepted.start, accepted.end);
        if (checks.availability && checks.capacity && checks.features) {
          b.confirmationReference = `DEMO-${Math.floor(1000 + Math.random() * 9000)}`;
          move(b, "CONFIRMED", "backend", "Booking workflow", "Rechecked availability and recorded the confirmation", {
            messageType: "BOOKING_STATUS",
            detail: b.confirmationReference,
          });
          db.events.push({
            id: uid("e"),
            clubId: b.clubId,
            title: b.event.title!,
            start: accepted.start,
            end: accepted.end,
            location: venue.name,
            description: `${b.event.eventType ?? "Event"} hosted by ${db.clubs.find((x) => x.id === b.clubId)?.name ?? "the club"}.`,
          });
        } else {
          move(b, "FAILED_REQUIRES_HUMAN", "backend", "Booking workflow", "Room was no longer available at confirmation", { messageType: "ERROR" });
        }
      } else if (decision === "REJECT") {
        review.status = "rejected";
        move(b, "REJECTED", "reviewer", user.name, "Rejected the request", extra);
        say(c, { sender: "reviewer", name: user.name, text: `Rejected. ${text}` });
      } else {
        review.status = "changes_requested";
        move(b, "CHANGES_REQUESTED", "reviewer", user.name, "Requested changes", extra);
        say(c, { sender: "reviewer", name: user.name, text });
      }
      say(c, { sender: "system", text: "Current status", card: { type: "status", bookingId: b.id } });
      notify(
        db,
        b.createdBy,
        `${b.event.title}: ${decision === "APPROVE" ? "confirmed" : decision === "REJECT" ? "rejected" : "changes requested"}`,
        `/bookings/${b.id}`,
      );
    });
  } catch (error) {
    return fail("INVALID_STATE", (error as Error).message);
  }
  return ok(null);
}

export function markCancelled(bookingId: string, user: DemoUser): Result<null> {
  const current = findBooking(getDb(), bookingId);
  if (user.role !== "venue_reviewer" || user.scopeId !== current.authorityId)
    return fail("PERMISSION_DENIED", "Only a reviewer assigned to this venue authority can cancel this booking.");
  try {
    mutate((db) => {
      const b = findBooking(db, bookingId);
      move(b, "CANCELLED", "reviewer", user.name, "Marked the booking cancelled", { messageType: "BOOKING_STATUS" });
      say(findConversation(db, b.conversationId), { sender: "system", text: "The venue team cancelled this booking" });
      notify(db, b.createdBy, `${b.event.title} was cancelled`, `/bookings/${b.id}`);
    });
  } catch (error) {
    return fail("INVALID_STATE", (error as Error).message);
  }
  return ok(null);
}
