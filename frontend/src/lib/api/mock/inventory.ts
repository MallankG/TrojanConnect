import { laParts, minutesBetween } from "@/lib/time";
import type { Booking, Db, EventDraft, Feature, ValidationChecks, Venue } from "../types";

/**
 * The simulated venue adapter: routing, availability and proposal validation.
 * Everything here is deterministic code, never model output (PRD 7.3, 9.3).
 */

export const INVENTORY_VERSION = "inventory_v17";
export const ROUTING_VERSION = "routing_v4";

/** Venue category to authority, as a configured table (PRD 9.3 route_booking_request). */
const ROUTES: Record<EventDraft["venueCategory"], string> = {
  campus_event_space: "campus-event-spaces",
  classroom: "classroom-scheduling",
};

export function routeRequest(db: Db, draft: EventDraft) {
  const authorityId = ROUTES[draft.venueCategory];
  const authority = db.authorities.find((a) => a.id === authorityId);
  if (!authority) return null;
  return {
    authorityId,
    reason: `Configured authority for ${draft.venueCategory === "classroom" ? "classrooms" : "campus event spaces"} (${ROUTING_VERSION})`,
  };
}

type Block = { start: number; end: number };

function hash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Busy blocks for a venue on a day, in minutes after midnight. Rooms are open
 * 08:00 to 22:00. Demo Meeting Room A has a standing Wednesday block until
 * 5:30 PM, which is what makes the scripted request need a counteroffer.
 */
function busyBlocks(db: Db, venue: Venue, start: Date, ignoreBookingId?: string): Block[] {
  const p = laParts(start);
  const blocks: Block[] = [
    { start: 0, end: 8 * 60 },
    { start: 22 * 60, end: 24 * 60 },
  ];
  if (venue.id === "v-room-a" && p.weekday === 3) blocks.push({ start: 15 * 60, end: 17 * 60 + 30 });
  else {
    const h = hash(`${venue.id}:${p.y}-${p.m}-${p.d}`);
    const begin = 9 * 60 + (h % 8) * 30;
    blocks.push({ start: begin, end: begin + 120 });
  }
  // Confirmed bookings take the room, so the same slot is never sold twice.
  for (const b of db.bookings) {
    if (b.id === ignoreBookingId || b.state !== "CONFIRMED") continue;
    const accepted = b.proposals.find((x) => x.id === b.acceptedProposalId);
    if (!accepted || accepted.venueId !== venue.id) continue;
    const s = laParts(new Date(accepted.start));
    if (s.y !== p.y || s.m !== p.m || s.d !== p.d) continue;
    const e = laParts(new Date(accepted.end));
    blocks.push({ start: s.h * 60 + s.min, end: e.h * 60 + e.min });
  }
  return blocks;
}

const isFree = (blocks: Block[], start: number, end: number) =>
  blocks.every((b) => end <= b.start || start >= b.end);

export type Candidate = {
  venue: Venue;
  start: string;
  end: string;
  /** Minutes the slot starts after the requested start. 0 means an exact fit. */
  shift: number;
};

/** PRD 9.3 search_venue_inventory. */
export function searchInventory(db: Db, booking: Booking): Candidate[] {
  const { event, authorityId } = booking;
  if (!event.start || !event.end || !event.attendance || !authorityId) return [];
  const start = new Date(event.start);
  const duration = minutesBetween(event.start, event.end);
  const p = laParts(start);
  const startMin = p.h * 60 + p.min;

  const out: Candidate[] = [];
  for (const venue of db.venues) {
    if (venue.authorityId !== authorityId) continue;
    if (venue.capacity < event.attendance) continue;
    if (!event.features.every((f) => venue.features.includes(f))) continue;
    const blocks = busyBlocks(db, venue, start, booking.id);
    for (let shift = 0; shift <= 90; shift += 30) {
      if (isFree(blocks, startMin + shift, startMin + shift + duration)) {
        out.push({
          venue,
          start: new Date(start.getTime() + shift * 60_000).toISOString(),
          end: new Date(start.getTime() + (shift + duration) * 60_000).toISOString(),
          shift,
        });
        break;
      }
    }
  }
  // Smallest room that fits comes first, as a scheduling office would offer it.
  return out.sort((a, b) => a.venue.capacity - b.venue.capacity);
}

/** PRD 9.3 validate_proposal. */
export function validateProposal(
  db: Db,
  booking: Booking,
  venue: Venue,
  start: string,
  end: string,
): ValidationChecks {
  const { event } = booking;
  const blocks = busyBlocks(db, venue, new Date(start), booking.id);
  const s = laParts(new Date(start));
  const startMin = s.h * 60 + s.min;
  return {
    capacity: venue.capacity >= (event.attendance ?? Infinity),
    features: event.features.every((f) => venue.features.includes(f)),
    timeWindow: start === event.start && end === event.end,
    venueAuthority: venue.authorityId === booking.authorityId,
    availability: isFree(blocks, startMin, startMin + minutesBetween(start, end)),
  };
}

export const FEATURE_LABEL: Record<Feature, string> = {
  projector: "Projector",
  microphone: "Microphones",
  whiteboard: "Whiteboard",
  stage: "Stage",
  livestream: "Livestream",
};
