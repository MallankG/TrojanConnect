"use client";

/**
 * The one module the UI talks to. Each command mirrors an endpoint in PRD
 * section 12 and returns the typed result from PRD 9.1.
 *
 * Club data (directory, profiles, events, search, recommendations, saved clubs,
 * interest, preferences, Student and Club Agent chat) is live from the FastAPI
 * backend through ./live. Everything else still runs on the in-browser mock. To move the
 * FastAPI backend, replace a function body with a fetch to the endpoint named
 * in its comment (base URL: NEXT_PUBLIC_API_BASE_URL) and swap `useDb` readers
 * for fetched data plus Supabase Realtime. Components need no changes.
 *
 * The acting user is passed in here only because the mock has no session; the
 * real backend derives identity from the authenticated session, never from
 * the client (PRD 9.1).
 */

import type { Club, GovScope, Interest, KnowledgeDoc, Result, StudentPrefs } from "./types";
import * as booking from "./mock/booking";
import * as agents from "./mock/agents";
import { currentUser, mutate, resetDb, uid } from "./mock/store";
import { campus, live } from "./live";

export { useDb, useUser, setRole, getDb } from "./mock/store";
export { campus, live, invalidate, tagLabel, LIVE_TAGS } from "./live";

const denied = (message: string): Result<never> => ({
  ok: false,
  error: { code: "PERMISSION_DENIED", message, retryable: false },
});

function me() {
  const user = currentUser();
  if (!user) throw new Error("No demo role selected");
  return user;
}

export const api = {
  // POST /api/v1/conversations + /bookings/drafts
  startBooking: () => booking.startBooking(me()),
  // POST /api/v1/conversations/{id}/messages
  sendBookingMessage: (conversationId: string, text: string) =>
    booking.sendBookingMessage(conversationId, text, me()),
  // POST /api/v1/bookings/{id}/submit
  submitBooking: (bookingId: string) => booking.submitBooking(bookingId, me()),
  // POST /api/v1/bookings/{id}/proposals/{proposalId}/accept
  acceptProposal: (bookingId: string, proposalId: string, version: number) =>
    booking.acceptProposal(bookingId, proposalId, version, me()),
  // POST /api/v1/bookings/{id}/alternatives
  requestAlternatives: (bookingId: string, reason: string) =>
    booking.requestAlternatives(bookingId, reason, me()),
  resubmitForReview: (bookingId: string, note: string) =>
    booking.resubmitForReview(bookingId, note, me()),
  requestCancel: (bookingId: string) => booking.requestCancel(bookingId, me()),
  // POST /api/v1/reviews/{reviewId}/decision
  recordDecision: (reviewId: string, decision: "APPROVE" | "REJECT" | "REQUEST_CHANGES", reason: string) =>
    booking.recordDecision(reviewId, decision, reason, me()),
  markCancelled: (bookingId: string) => booking.markCancelled(bookingId, me()),

  // Club and Student Agent chats run on the live backend (POST /conversations, /messages).
  openClubChat(clubId: string, clubName: string) {
    return agents.openConversation(me(), "club", {
      clubId,
      title: clubName,
      agentName: `${clubName} agent`,
      greeting: `Hi, I'm the agent for ${clubName}. I answer only from the club's public profile, FAQ and events, and say so when they don't cover something. What would you like to know?`,
    });
  },
  openStudentChat: () =>
    agents.openConversation(me(), "student", {
      title: "Student Agent",
      agentName: "Student Agent",
      greeting: "Tell me what you're into and I'll find clubs in the directory that match. I only use the interests you chose and the clubs' public profiles.",
    }),
  openGovernmentChat: (scope: GovScope) =>
    agents.openConversation(me(), "government", {
      title: `${scope} assistant`,
      agentName: `${scope} assistant`,
      greeting: `I answer questions about ${scope} from approved sources and link each one. I'm an assistant, not an elected representative, and I can't make commitments on ${scope}'s behalf.`,
    }),
  askClub: (conversationId: string, text: string) => live.ask(conversationId, text),
  askStudentAgent: (conversationId: string, text: string) => live.ask(conversationId, text),
  // POST /api/v1/conversations/{id}/confirm
  confirmAgentAction: (conversationId: string, confirmed: boolean) => live.confirm(conversationId, confirmed),
  // POST /api/v1/government/ask (approved, attributed sources only)
  askGovernment: (conversationId: string, text: string, scope: GovScope) => campus.ask(conversationId, text, scope),
  // POST /api/v1/feedback
  submitFeedback: (
    conversationId: string | null,
    input: { scope: GovScope; category: string; message: string; shareIdentity: boolean },
  ) => campus.submitFeedback(conversationId, input),

  // POST /api/v1/clubs/{id}/interest
  submitInterest(clubId: string, input: { type: Interest["type"]; message: string; shareContact: boolean }): Promise<Result<null>> {
    if (me().role !== "student") return Promise.resolve(denied("Only students can express interest in a club."));
    return live.submitInterest(clubId, input);
  },
  // POST / DELETE /api/v1/clubs/{id}/save
  setSaved: (clubId: string, saved: boolean) => live.setSaved(clubId, saved),

  updatePrefs(patch: Partial<StudentPrefs>) {
    const user = me();
    mutate((db) => {
      const base: StudentPrefs = db.prefs[user.id] ?? { interests: [], goals: "", personalization: true, savedClubIds: [] };
      db.prefs[user.id] = { ...base, ...patch };
    });
  },
  updateClub(clubId: string, patch: { tagline?: string; description?: string; recruitment?: Club["recruitment"] }): Result<null> {
    const user = me();
    if (user.role !== "club_rep" || user.scopeId !== clubId) return denied("You can only edit your own club's profile.");
    mutate((db) => Object.assign(db.clubs.find((c) => c.id === clubId)!, patch));
    return { ok: true, data: null };
  },

  saveKnowledge(doc: Omit<KnowledgeDoc, "id" | "verifiedAt" | "version"> & { id?: string }): Result<null> {
    const user = me();
    if (user.role !== "gov_rep" || user.scopeId !== doc.scope) return denied("You can only manage your own government body's sources.");
    mutate((db) => {
      const existing = doc.id ? db.knowledge.find((k) => k.id === doc.id) : null;
      const verifiedAt = new Date().toISOString();
      if (existing) Object.assign(existing, doc, { verifiedAt, version: `v${+existing.version.slice(1) + 1}` });
      else db.knowledge.unshift({ ...doc, id: uid("k"), verifiedAt, version: "v1" });
    });
    return { ok: true, data: null };
  },
  acknowledgeFeedback(feedbackId: string): Result<null> {
    const user = me();
    if (user.role !== "gov_rep") return denied("Only a government representative can acknowledge feedback.");
    mutate((db) => {
      const item = db.feedback.find((f) => f.id === feedbackId && f.scope === user.scopeId);
      if (item) item.status = "acknowledged";
    });
    return { ok: true, data: null };
  },
  publishAnnouncement(title: string, body: string): Result<null> {
    const user = me();
    if (user.role !== "gov_rep" || !user.scopeId) return denied("Only a government representative can publish announcements.");
    if (!title.trim() || !body.trim()) return { ok: false, error: { code: "VALIDATION_FAILED", message: "An announcement needs a title and a message.", retryable: false } };
    mutate((db) => {
      db.announcements.unshift({ id: uid("a"), scope: user.scopeId as GovScope, title: title.trim(), body: body.trim(), at: new Date().toISOString(), author: user.name });
    });
    return { ok: true, data: null };
  },

  markNotificationsRead() {
    const user = me();
    mutate((db) => {
      for (const n of db.notifications) if (n.userId === user.id) n.read = true;
    });
  },
  resetDemo: () => resetDb(),
};
