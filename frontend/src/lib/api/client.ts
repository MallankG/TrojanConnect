"use client";

/**
 * The one module the UI talks to. Each command mirrors an endpoint in PRD
 * section 12 and returns the typed result from PRD 9.1.
 *
 * Today every call goes to the in-browser mock under ./mock. To move to the
 * FastAPI backend, replace a function body with a fetch to the endpoint named
 * in its comment (base URL: NEXT_PUBLIC_API_BASE_URL) and swap `useDb` readers
 * for fetched data plus Supabase Realtime. Components need no changes.
 *
 * The acting user is passed in here only because the mock has no session; the
 * real backend derives identity from the authenticated session, never from
 * the client (PRD 9.1).
 */

import type { GovScope, Interest, KnowledgeDoc, Result, StudentPrefs } from "./types";
import * as booking from "./mock/booking";
import * as agents from "./mock/agents";
import { currentUser, getDb, mutate, resetDb, uid } from "./mock/store";

export { useDb, useUser, setRole, getDb } from "./mock/store";
export { recommend, explain } from "./mock/agents";

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

  openClubChat(clubId: string) {
    const club = getDb().clubs.find((c) => c.id === clubId)!;
    return agents.openConversation(me(), "club", {
      clubId,
      title: club.name,
      agentName: `${club.name} agent`,
      greeting: `Hi, I'm the agent for ${club.name}. I answer from information the club's officers approved. What would you like to know?`,
    });
  },
  openStudentChat: () =>
    agents.openConversation(me(), "student", {
      title: "Student Agent",
      agentName: "Student Agent",
      greeting: "Tell me what you're into and I'll find clubs that match. I only use the interests you chose and the clubs' public profiles.",
    }),
  openGovernmentChat: (scope: GovScope) =>
    agents.openConversation(me(), "government", {
      title: `${scope} assistant`,
      agentName: `${scope} assistant`,
      greeting: `I answer questions about ${scope} from approved sources and link each one. I'm an assistant, not an elected representative, and I can't make commitments on ${scope}'s behalf.`,
    }),
  askClub: (conversationId: string, text: string) => agents.askClub(conversationId, text),
  askStudentAgent: (conversationId: string, text: string) =>
    agents.askStudentAgent(conversationId, text, me()),
  askGovernment: (conversationId: string, text: string, scope: GovScope) =>
    agents.askGovernment(conversationId, text, scope),
  // POST /api/v1/feedback
  submitFeedback: (
    conversationId: string | null,
    input: { scope: GovScope; category: string; message: string; shareIdentity: boolean },
  ) => agents.submitFeedback(conversationId, input, me()),

  // POST /api/v1/clubs/{id}/interest
  submitInterest(clubId: string, input: { type: Interest["type"]; message: string; shareContact: boolean }): Result<null> {
    const user = me();
    if (user.role !== "student") return denied("Only students can express interest in a club.");
    mutate((db) => {
      db.interests.unshift({
        id: uid("i"),
        clubId,
        studentId: user.id,
        studentName: input.shareContact ? user.name : "A student",
        type: input.type,
        message: input.message.trim(),
        sharedContact: input.shareContact,
        at: new Date().toISOString(),
      });
      for (const rep of db.users.filter((u) => u.role === "club_rep" && u.scopeId === clubId))
        db.notifications.unshift({ id: uid("n"), userId: rep.id, text: "A student expressed interest in your club", href: "/recruitment", at: new Date().toISOString(), read: false });
    });
    return { ok: true, data: null };
  },

  updatePrefs(patch: Partial<StudentPrefs>) {
    const user = me();
    mutate((db) => {
      const base: StudentPrefs = db.prefs[user.id] ?? { interests: [], goals: "", personalization: true, savedClubIds: [] };
      db.prefs[user.id] = { ...base, ...patch };
    });
  },
  toggleSaved(clubId: string) {
    const user = me();
    mutate((db) => {
      const prefs = (db.prefs[user.id] ??= { interests: [], goals: "", personalization: true, savedClubIds: [] });
      prefs.savedClubIds = prefs.savedClubIds.includes(clubId)
        ? prefs.savedClubIds.filter((id) => id !== clubId)
        : [...prefs.savedClubIds, clubId];
    });
  },

  updateClub(clubId: string, patch: { tagline?: string; description?: string; recruitment?: "open" | "applications" | "closed" }): Result<null> {
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
