"use client";

/**
 * Live club data from the FastAPI student-agent backend (PRD 9.4, 12): the club directory,
 * club profiles and events, search, recommendations, saved clubs, interest, preferences, and
 * the Student Agent and public Club Agent conversations.
 *
 * Identity: the backend derives the actor from the session. Until Supabase Auth is wired, the
 * dev-only `X-Demo-User` header names a demo student; the backend never reads a role from it.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { CampusEvent, Club, Conversation, Result } from "./types";
import { currentUser, getDb, mutate, uid } from "./mock/store";
import { isStream, readStream } from "./sse";

const API = process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/** Demo role -> backend demo student. Priya is the seeded student with preferences. */
const DEMO_BACKEND_USER: Record<string, string> = {
  "u-priya": "demo-student-1",
  "u-marcus": "demo-student-3",
  "u-sofia": "demo-student-4",
  "u-maya": "demo-rep-1",
  "u-jordan": "demo-usg-rep",
};

// ---- Backend shapes (backend/app/schemas/student.py) -------------------------

export type ClubProfile = {
  organization_id: string;
  name: string;
  category: string;
  tags: string[];
  public_description: string;
  history: string;
  founded_year: number | null;
  activities: string[];
  meeting_schedule: string;
  time_commitment: string;
  membership_requirements: string;
  recruitment_status: "open" | "application" | "closed" | "unknown";
  how_to_join: string;
  who_thrives_here: string;
  faq: { question: string; answer: string }[];
  public_contact: string;
  verification_status: "verified" | "pending" | "unverified";
  data_label: "demo" | "public_web" | "live";
  website: string;
  social_links: Record<string, string>;
  source_urls: string[];
  collected_at: string | null;
};
type ClubEvent = { id: string; organization_id: string; title: string; description: string; start_at: string; end_at: string; location: string };
export type LiveRecommendation = { organization_id: string; club_name: string; score: number; matched_tags: string[]; explanation: string };
export type FitCheck = { organization_id: string; fit_level: "strong" | "possible" | "weak" | "unknown"; reasons: string[]; concerns: string[]; questions_to_ask: string[] };
export type LivePrefs = { interest_tags: string[]; goals: string; personalization_enabled: boolean };
type AgentCard = { type: "club" | "recommendation" | "event" | "fit_check" | "interest_confirmation"; data: Record<string, unknown> };
type AgentTurn = {
  conversation_id: string;
  message: { content: string };
  tool_activity: { tool: string; summary: string; ok: boolean }[];
  cards: AgentCard[];
  pending_confirmation: { action: string; summary: string } | null;
};

// ---- Mapping to the UI's types ----------------------------------------------

const RECRUITMENT: Record<ClubProfile["recruitment_status"], Club["recruitment"]> = {
  open: "open",
  application: "applications",
  closed: "closed",
  unknown: "unknown",
};

export const tagLabel = (t: string) => {
  const s = t.replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function toClub(p: ClubProfile): Club {
  return {
    id: p.organization_id,
    name: p.name,
    tagline: p.category,
    description: p.public_description.replace(/\\r\\n|\\n/g, "\n"),
    tags: p.tags,
    meets: p.meeting_schedule,
    recruitment: RECRUITMENT[p.recruitment_status] ?? "unknown",
    verified: p.verification_status === "verified",
    faq: p.faq.map((f) => ({ q: f.question, a: f.answer })),
    live: {
      dataLabel: p.data_label,
      howToJoin: p.how_to_join,
      activities: p.activities,
      timeCommitment: p.time_commitment,
      website: p.website,
      sourceUrls: p.source_urls,
      collectedAt: p.collected_at,
    },
  };
}

const toEvent = (e: ClubEvent): CampusEvent => ({
  id: e.id,
  clubId: e.organization_id,
  title: e.title,
  start: e.start_at,
  end: e.end_at,
  location: e.location,
  description: e.description,
});

// ---- Transport --------------------------------------------------------------

/** Dev demo sign-in: which backend identity the signed-in demo user acts as. Roles stay server-side. */
export function demoUserHeader(): Record<string, string> {
  const user = currentUser();
  return user ? { "X-Demo-User": DEMO_BACKEND_USER[user.id] ?? user.id } : {};
}

function request(path: string, init?: { method?: string; json?: unknown }) {
  return fetch(`${API}/api/v1${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "X-TrojanConnect-Client": "web",
      ...demoUserHeader(),
    },
    body: init?.json === undefined ? undefined : JSON.stringify(init.json),
    cache: "no-store",
  });
}

/** The envelope's data, or an Error carrying the backend's message. */
function unwrap<T>(res: Response, body: { ok?: boolean; data?: unknown; error?: unknown; detail?: unknown } | null): T {
  if (!res.ok || body?.ok === false) {
    const err = (body?.error ?? body?.detail) as string | { message?: string } | undefined;
    throw new Error(typeof err === "string" ? err : err?.message ?? `The club service answered ${res.status}.`);
  }
  return (body?.data ?? body) as T;
}

async function call<T>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const res = await request(path, init);
  return unwrap<T>(res, await res.json().catch(() => ({})));
}

/** POST to a `/stream` endpoint: `onText` sees the reply as it arrives; resolves with the normal response. */
async function streamCall<T>(path: string, json: unknown, onText: (soFar: string) => void): Promise<T> {
  const res = await request(path, { method: "POST", json });
  if (!isStream(res)) return unwrap<T>(res, await res.json().catch(() => ({})));
  return unwrap<T>(res, await readStream(res, onText));
}

/** Shows a reply while it streams in, as an agent message that the finished turn then replaces. */
function streamingMessage(conversationId: string, agentName: string) {
  const id = uid("m");
  return {
    show(text: string) {
      edit(conversationId, (c) => {
        let m = c.messages.find((x) => x.id === id);
        if (!m) {
          c.activity = null;
          m = { id, at: new Date().toISOString(), sender: "agent", name: agentName, text: "" };
          c.messages.push(m);
        }
        m.text = text;
      });
    },
    remove() {
      if (getDb().conversations.some((c) => c.messages.some((m) => m.id === id)))
        edit(conversationId, (c) => (c.messages = c.messages.filter((m) => m.id !== id)));
    },
  };
}

const message = (e: unknown) =>
  e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Can't reach the club service. Is the backend running?";
const failure = (e: unknown): Result<never> => ({ ok: false, error: { code: "LIVE_ERROR", message: message(e), retryable: true } });

// ---- Cached reads with invalidation -------------------------------------------

const cache = new Map<string, unknown>();
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** Drop cached reads whose path starts with any prefix, and refetch what is on screen. */
export function invalidate(...prefixes: string[]) {
  for (const key of [...cache.keys()]) if (prefixes.some((p) => key.includes(`|${p}`))) cache.delete(key);
  version++;
  listeners.forEach((l) => l());
}

type Live<T> = { data: T | undefined; error: string | null };

/** GET a backend path (null = skip). First render is always `undefined`, so SSR stays deterministic. */
function useGet<T, U = T>(path: string | null, map?: (raw: T) => U): Live<U> {
  const v = useSyncExternalStore(subscribe, () => version, () => 0);
  const [state, setState] = useState<Live<U> & { key: string | null }>({ data: undefined, error: null, key: null });
  useEffect(() => {
    if (!path) return;
    const key = `${currentUser()?.id ?? ""}|${path}`;
    if (cache.has(key)) {
      const data = cache.get(key) as U;
      const frame = requestAnimationFrame(() => setState({ data, error: null, key: path }));
      return () => cancelAnimationFrame(frame);
    }
    let alive = true;
    call<T>(path).then(
      (raw) => {
        const data = map ? map(raw) : (raw as unknown as U);
        cache.set(key, data);
        if (alive) setState({ data, error: null, key: path });
      },
      (e) => alive && setState({ data: undefined, error: message(e), key: path }),
    );
    return () => {
      alive = false;
    };
    // `map` is a stable module-level function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, v]);
  // Show the previous result while a new path loads only if it was for the same path.
  return state.key === path ? state : { data: undefined, error: null };
}

const hitsToClubs = (hits: { club: ClubProfile; matched_tags: string[] }[]) =>
  hits.map((h) => ({ club: toClub(h.club), matched: h.matched_tags }));
const profilesToClubs = (ps: ClubProfile[]) => ps.map(toClub);
const eventsMap = (es: ClubEvent[]) => es.map(toEvent);

export const live = {
  useClubs(query: string, tag: string | null, limit = 48) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query.trim()) params.set("query", query.trim());
    if (tag) params.set("tags", tag);
    return useGet(`/clubs?${params}`, hitsToClubs);
  },
  useClub: (id: string | null) => useGet(id ? `/clubs/${encodeURIComponent(id)}` : null, toClub),
  useClubEvents: (id: string | null) => useGet(id ? `/clubs/${encodeURIComponent(id)}/events` : null, eventsMap),
  useEvents: () => useGet("/events?limit=200", eventsMap),
  useFit: (id: string | null) => useGet<FitCheck>(id ? `/clubs/${encodeURIComponent(id)}/fit` : null),
  useRecommendations: (enabled: boolean) => useGet<LiveRecommendation[]>(enabled ? "/recommendations?limit=6" : null),
  useSaved: (enabled: boolean) => useGet(enabled ? "/me/saved-clubs" : null, profilesToClubs),
  usePrefs: (enabled: boolean) => useGet<LivePrefs>(enabled ? "/me/preferences" : null),

  async setSaved(clubId: string, saved: boolean): Promise<Result<null>> {
    try {
      await call(`/clubs/${encodeURIComponent(clubId)}/save`, { method: saved ? "POST" : "DELETE" });
      invalidate("/me/saved-clubs");
      return { ok: true, data: null };
    } catch (e) {
      return failure(e);
    }
  },

  /** POST /recommendations/feedback (PRD 2.3: every recommendation can be rated). "hide" removes it. */
  async recommendationFeedback(clubId: string, feedback: "helpful" | "not_relevant" | "hide"): Promise<Result<null>> {
    try {
      await call("/recommendations/feedback", { method: "POST", json: { organization_id: clubId, feedback } });
      if (feedback !== "helpful") invalidate("/recommendations");
      return { ok: true, data: null };
    } catch (e) {
      return failure(e);
    }
  },

  async updatePrefs(patch: Partial<LivePrefs>): Promise<Result<null>> {
    try {
      await call("/me/preferences", { method: "PUT", json: patch });
      invalidate("/me/preferences", "/recommendations", "/clubs/");
      return { ok: true, data: null };
    } catch (e) {
      return failure(e);
    }
  },

  /** POST /clubs/{id}/interest. The sheet's send button is the explicit confirmation (PRD 8.3). */
  async submitInterest(clubId: string, input: { type: "membership" | "event" | "question"; message: string; shareContact: boolean }): Promise<Result<null>> {
    try {
      await call(`/clubs/${encodeURIComponent(clubId)}/interest`, {
        method: "POST",
        json: {
          interest_type: input.type === "question" ? "general" : input.type,
          message: input.message.trim(),
          share_contact: input.shareContact,
          user_confirmed: true,
          idempotency_key: crypto.randomUUID(),
        },
      });
      return { ok: true, data: null };
    } catch (e) {
      return failure(e);
    }
  },

  // ---- Agent conversations ----------------------------------------------------
  // The thread is mirrored into the local conversation list so the existing Chat surface and
  // "Recent conversations" work unchanged; the backend keeps the authoritative history.

  async ask(conversationId: string, text: string): Promise<Result<null>> {
    const local = getDb().conversations.find((c) => c.id === conversationId);
    if (!local || (local.kind !== "club" && local.kind !== "student")) return failure(new Error("Conversation not found."));
    edit(conversationId, (c) => {
      c.messages.push({ id: uid("m"), at: new Date().toISOString(), sender: "user", text });
      c.activity = local.kind === "club" ? "Reading the club's public profile" : "Searching the club directory";
    });
    try {
      let remoteId = local.remoteId;
      if (!remoteId) {
        const started = await call<{ conversation: { id: string } }>("/conversations", {
          method: "POST",
          json: { agent_type: local.kind, organization_id: local.clubId ?? undefined, channel: "web" },
        });
        remoteId = started.conversation.id;
        edit(conversationId, (c) => (c.remoteId = remoteId));
      }
      const streaming = streamingMessage(conversationId, local.agentName);
      try {
        const turn = await streamCall<AgentTurn>(`/conversations/${remoteId}/messages/stream`, { content: text }, streaming.show);
        streaming.remove();
        postTurn(conversationId, local.agentName, turn);
      } catch (e) {
        streaming.remove();
        throw e;
      }
      return { ok: true, data: null };
    } catch (e) {
      edit(conversationId, (c) => (c.activity = null));
      return failure(e);
    }
  },

  /** POST /conversations/{id}/confirm: the user approves or declines the agent's pending write. */
  async confirm(conversationId: string, confirmed: boolean): Promise<Result<null>> {
    const local = getDb().conversations.find((c) => c.id === conversationId);
    if (!local?.remoteId) return failure(new Error("Conversation not found."));
    edit(conversationId, (c) => (c.activity = confirmed ? "Sending to the club" : "Cancelling"));
    try {
      const turn = await call<AgentTurn>(`/conversations/${local.remoteId}/confirm`, { method: "POST", json: { confirmed } });
      // Only an answer the backend accepted closes the prompt; a failure leaves it to retry.
      edit(conversationId, (c) => {
        for (const m of c.messages) if (m.card?.type === "confirm") m.card = { ...m.card, done: true };
      });
      postTurn(conversationId, local.agentName, turn);
      return { ok: true, data: null };
    } catch (e) {
      edit(conversationId, (c) => (c.activity = null));
      return failure(e);
    }
  },
};

function edit(conversationId: string, fn: (c: Conversation) => void) {
  mutate((db) => {
    const c = db.conversations.find((x) => x.id === conversationId);
    if (c) {
      fn(c);
      c.updatedAt = new Date().toISOString();
    }
  });
}

/** Turn backend cards into the Chat surface's cards: a club list, and a confirmation prompt. */
function postTurn(conversationId: string, agentName: string, turn: AgentTurn) {
  const clubIds: string[] = [];
  const reasons: Record<string, string[]> = {};
  const names: Record<string, string> = {};
  for (const card of turn.cards) {
    const d = card.data as Record<string, unknown>;
    const club = (d.club as Record<string, unknown> | undefined) ?? (card.type === "club" ? d : undefined);
    const id = String(club?.organization_id ?? (card.type === "recommendation" ? d.organization_id : "") ?? "");
    if (!id || clubIds.includes(id) || (card.type !== "club" && card.type !== "recommendation")) continue;
    clubIds.push(id);
    names[id] = String(club?.name ?? d.club_name ?? id);
    const tags = (d.matched_tags as string[] | undefined)?.length ? (d.matched_tags as string[]) : [String(club?.category ?? "Club profile")];
    reasons[id] = tags.map(tagLabel);
  }
  const activity = turn.tool_activity.map((t) => t.summary).join(" · ");
  edit(conversationId, (c) => {
    c.activity = null;
    c.messages.push({
      id: uid("m"),
      at: new Date().toISOString(),
      sender: "agent",
      name: agentName,
      text: turn.message.content,
      toolSummary: activity || undefined,
      card: turn.pending_confirmation
        ? { type: "confirm", summary: turn.pending_confirmation.summary, done: false }
        : clubIds.length
          ? { type: "clubs", clubIds, reasons, names }
          : undefined,
    });
  });
}

// ---- Student government and club outreach (backend/app/workflows/campus) -------------------

export type GovSource = { id: string; scope: "USG" | "GSG"; title: string; excerpt: string; url: string; owner: string; kind: "official" | "news"; verified_at: string; version: string };
export type GovFeedback = { id: string; scope: string; category: string; message: string; identity_sharing_consent: boolean; from_name: string | null; status: "new" | "acknowledged"; created_at: string };
export type GovAnalytics = { questions: number; answered_pct: number | null; concerns: number; top_topics: { topic: string; count: number }[] };
export type Announcement = { id: string; scope: string; title: string; body: string; author: string; created_at: string };
export type ClubPost = { id: string; organization_id: string; club_name: string; kind: "event" | "recruitment" | "update"; title: string; body: string; event_id: string | null; author: string; created_at: string };
export type ClubInterestItem = { id: string; interest_type: string; message: string; created_at: string; shared_contact: boolean; from: { name: string; email: string } | null };
export type LiveNotification = { id: string; text: string; href: string; at: string };
type AskResult = { answer: string; verified: boolean; sources: { title: string; url: string; owner: string; verified_at: string; kind: string }[]; feedback_offer: { scope: "USG" | "GSG"; category: string; message: string } | null };

async function write<T>(path: string, method: string, json?: unknown): Promise<Result<T>> {
  try {
    return { ok: true, data: await call<T>(path, { method, json }) };
  } catch (e) {
    return failure(e);
  }
}

export const campus = {
  useSources: (scope: string | null) => useGet<GovSource[]>(scope ? `/government/sources?scope=${scope}` : null),
  useAnnouncements: (scope: string | null) => useGet<Announcement[]>(scope ? `/government/announcements?scope=${scope}` : null),
  useFeedback: (scope: string | null) => useGet<GovFeedback[]>(scope ? `/government/feedback?scope=${scope}` : null),
  useAnalytics: (scope: string | null) => useGet<GovAnalytics>(scope ? `/government/analytics?scope=${scope}` : null),
  usePosts: (clubId: string | null) => useGet<ClubPost[]>(clubId ? `/clubs/${encodeURIComponent(clubId)}/posts` : null),
  useInterests: (clubId: string | null) => useGet<ClubInterestItem[]>(clubId ? `/clubs/${encodeURIComponent(clubId)}/interests` : null),
  useNotifications: (enabled: boolean) => useGet<LiveNotification[]>(enabled ? "/me/notifications" : null),

  async publish(scope: string, title: string, body: string) {
    const r = await write<Announcement>("/government/announcements", "POST", { scope, title, body });
    if (r.ok) invalidate("/government/announcements", "/me/notifications");
    return r;
  },
  async saveSource(doc: { id?: string; scope: string; title: string; excerpt: string; url: string; owner: string }) {
    const r = await write<GovSource>("/government/sources", "POST", { ...doc, id: doc.id || undefined });
    if (r.ok) invalidate("/government/sources");
    return r;
  },
  async acknowledge(scope: string, id: string) {
    const r = await write(`/government/feedback/${id}/acknowledge?scope=${scope}`, "POST");
    if (r.ok) invalidate("/government/feedback", "/me/notifications");
    return r;
  },
  async post(clubId: string, body: { kind: ClubPost["kind"]; title: string; body: string; event?: { start_at: string; end_at: string; location: string }; recruitment_status?: string }) {
    const r = await write<ClubPost>(`/clubs/${encodeURIComponent(clubId)}/posts`, "POST", body);
    if (r.ok) invalidate(`/clubs/${encodeURIComponent(clubId)}`, "/events", "/me/notifications");
    return r;
  },
  async updateClub(clubId: string, patch: Record<string, string>) {
    const r = await write(`/clubs/${encodeURIComponent(clubId)}`, "PATCH", patch);
    if (r.ok) invalidate(`/clubs/${encodeURIComponent(clubId)}`, "/clubs?");
    return r;
  },

  /** The government assistant: an approved-source answer with links, or "can't verify" plus an offer to route it. */
  async ask(conversationId: string, text: string, scope: "USG" | "GSG"): Promise<Result<null>> {
    edit(conversationId, (c) => {
      c.messages.push({ id: uid("m"), at: new Date().toISOString(), sender: "user", text });
      c.activity = `Searching ${scope}'s approved sources`;
    });
    const local = getDb().conversations.find((c) => c.id === conversationId);
    const streaming = streamingMessage(conversationId, local?.agentName ?? scope);
    let r: Result<AskResult>;
    try {
      r = { ok: true, data: await streamCall<AskResult>("/government/ask/stream", { scope, question: text }, streaming.show) };
    } catch (e) {
      r = failure(e);
    }
    streaming.remove();
    if (!r.ok) {
      edit(conversationId, (c) => (c.activity = null));
      return r;
    }
    edit(conversationId, (c) => {
      c.activity = null;
      c.messages.push({
        id: uid("m"),
        at: new Date().toISOString(),
        sender: "agent",
        name: local?.agentName,
        text: r.data.answer,
        unverified: !r.data.verified,
        sources: r.data.sources.map((s) => ({ title: s.title, url: s.url, verifiedAt: s.verified_at, owner: s.owner, kind: s.kind })),
        card: r.data.feedback_offer ? { type: "feedback_offer", ...r.data.feedback_offer } : undefined,
      });
    });
    invalidate("/government/analytics");
    return { ok: true, data: null };
  },

  /** POST /feedback. Pressing "Send as feedback" is the consent; identity only with the separate tick. */
  async submitFeedback(conversationId: string | null, input: { scope: string; category: string; message: string; shareIdentity: boolean }): Promise<Result<null>> {
    const r = await write<{ id: string }>("/feedback", "POST", {
      scope: input.scope, category: input.category, message: input.message, share_identity: input.shareIdentity,
      user_confirmed: true, idempotency_key: crypto.randomUUID(),
    });
    if (!r.ok) return r;
    if (conversationId)
      edit(conversationId, (c) => {
        c.messages.push({ id: uid("m"), at: new Date().toISOString(), sender: "system", text: "Feedback sent", card: { type: "feedback_sent", feedbackId: r.data.id } });
      });
    invalidate("/government/feedback", "/me/notifications");
    return { ok: true, data: null };
  },
};

/** Curated filter chips from the live directory's most common tags. */
export const LIVE_TAGS = [
  "academic", "professional_development", "career", "community_service", "cultural", "wellness",
  "health", "recreation", "performing_arts", "music", "dance", "film", "media", "design", "research",
  "engineering", "artificial_intelligence", "entrepreneurship", "sustainability", "outdoors", "sports",
  "advocacy", "political", "law", "spiritual",
];
