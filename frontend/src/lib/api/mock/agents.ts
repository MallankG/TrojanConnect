import { fmtDay, fmtTime } from "@/lib/time";
import type {
  ChatMessage,
  Club,
  Conversation,
  Db,
  DemoUser,
  GovScope,
  KnowledgeDoc,
  Recommendation,
  Result,
  StudentPrefs,
} from "../types";
import { getDb, mutate, uid } from "./store";

/**
 * Mock versions of the public Club Agent, the Student Agent and the USG/GSG
 * agent. Each answers only from seeded, approved content and says so when it
 * has nothing (PRD 8.3, 8.4). The real agents use Gemini plus retrieval.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (code: string, message: string): Result<never> => ({
  ok: false,
  error: { code, message, retryable: false },
});

const STOP = new Set(
  "a an the is are do does did i you we they it to of for in on at and or with how what when where who can my your our this that be have has need about get there any".split(" "),
);
const tokens = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/(ing|es|s)$/, ""));

function overlap(query: string[], text: string) {
  const target = new Set(tokens(text));
  return query.filter((t) => target.has(t)).length;
}

function post(conversationId: string, message: Omit<ChatMessage, "id" | "at">) {
  mutate((db) => {
    const c = db.conversations.find((x) => x.id === conversationId)!;
    c.messages.push({ id: uid("m"), at: now(), ...message });
    c.activity = null;
    c.updatedAt = now();
  });
}

async function userTurn(conversationId: string, text: string, activity: string) {
  mutate((db) => {
    const c = db.conversations.find((x) => x.id === conversationId)!;
    c.messages.push({ id: uid("m"), at: now(), sender: "user", text });
    c.activity = activity;
    c.updatedAt = now();
  });
  await sleep(850);
}

/** Find the user's conversation of a kind, or create it with a greeting. */
export function openConversation(
  user: DemoUser,
  kind: Conversation["kind"],
  opts: { clubId?: string; title: string; agentName: string; greeting: string },
): string {
  const existing = getDb().conversations.find(
    (c) =>
      c.ownerId === user.id &&
      c.kind === kind &&
      c.clubId === (opts.clubId ?? null) &&
      c.agentName === opts.agentName,
  );
  if (existing) return existing.id;
  const id = uid("c");
  mutate((db) => {
    db.conversations.unshift({
      id,
      kind,
      ownerId: user.id,
      title: opts.title,
      agentName: opts.agentName,
      clubId: opts.clubId ?? null,
      bookingId: null,
      activity: null,
      awaiting: null,
      updatedAt: now(),
      messages: [{ id: uid("m"), at: now(), sender: "agent", name: opts.agentName, text: opts.greeting }],
    });
  });
  return id;
}

// ---- Public Club Agent -----------------------------------------------------

export async function askClub(conversationId: string, text: string): Promise<Result<null>> {
  const conversation = getDb().conversations.find((c) => c.id === conversationId);
  const club = getDb().clubs.find((c) => c.id === conversation?.clubId);
  if (!conversation || !club) return fail("NOT_FOUND", "Conversation not found.");
  await userTurn(conversationId, text, "Looking through the club's approved information");

  const name = `${club.name} agent`;
  const lower = text.toLowerCase();
  const next = getDb()
    .events.filter((e) => e.clubId === club.id && new Date(e.start) > new Date())
    .sort((a, b) => a.start.localeCompare(b.start))[0];

  if (/\b(next|upcoming)\b.*\b(event|meeting)|\bevents?\b/.test(lower)) {
    post(conversationId, {
      sender: "agent",
      name,
      text: next
        ? `Next up is ${next.title} on ${fmtDay(next.start)} at ${fmtTime(next.start)}, ${next.location}. ${next.description}`
        : "There is no upcoming event on the club's calendar right now.",
    });
    return ok(null);
  }
  if (/\b(when|where)\b.*\bmeet|meeting time|how often/.test(lower)) {
    post(conversationId, { sender: "agent", name, text: `We meet ${club.meets}.` });
    return ok(null);
  }
  if (/\b(join|sign ?up|member|recruit|apply)/.test(lower)) {
    const status =
      club.recruitment === "open"
        ? "Membership is open. Come to any meeting, or use Express interest on this page and the officers will see it."
        : club.recruitment === "applications"
          ? "We take new members by application. Use Express interest on this page to let the officers know."
          : "Recruitment is closed this semester. You can still express interest so the officers can reach you when it reopens.";
    const faq = club.faq.find((f) => overlap(tokens(text), f.q) >= 1);
    post(conversationId, { sender: "agent", name, text: faq ? `${faq.a} ${status}` : status });
    return ok(null);
  }

  const q = tokens(text);
  const best = club.faq
    .map((f) => ({ f, score: overlap(q, `${f.q} ${f.a}`) }))
    .sort((a, b) => b.score - a.score)[0];
  if (best && best.score >= 2) {
    post(conversationId, { sender: "agent", name, text: best.f.a });
  } else if (overlap(q, `${club.description} ${club.tagline}`) >= 2 || /what.*(do|about)|tell me/.test(lower)) {
    post(conversationId, { sender: "agent", name, text: club.description });
  } else {
    post(conversationId, {
      sender: "agent",
      name,
      unverified: true,
      text: "I don't have an approved answer for that, and I won't guess. Use Express interest to send the question to the club's officers.",
    });
  }
  return ok(null);
}

// ---- Recommendations -------------------------------------------------------

export function recommend(db: Db, prefs: StudentPrefs | undefined): Recommendation[] {
  const interests = prefs?.personalization ? prefs.interests : [];
  return db.clubs
    .map((club) => {
      const matched = club.tags.filter((t) => interests.includes(t));
      return { club, matched, score: matched.length * 2 + (club.recruitment === "open" ? 0.5 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.club.name.localeCompare(b.club.name));
}

/** A plain sentence built only from the tags that actually matched. */
export function explain(matched: string[]) {
  if (matched.length === 0) return null;
  const list = matched.map((m) => m.toLowerCase());
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `Because you chose ${joined}`;
}

// ---- Student Agent ---------------------------------------------------------

export async function askStudentAgent(conversationId: string, text: string, user: DemoUser): Promise<Result<null>> {
  await userTurn(conversationId, text, "Searching verified club profiles");
  const db = getDb();
  const lower = text.toLowerCase();

  if (/usg|gsg|student government|senate|funding board/.test(lower)) {
    post(conversationId, {
      sender: "agent",
      name: "Student Agent",
      text: "That's a question for the student government assistant, which answers from approved sources. Open Student gov in the top bar and ask it there.",
    });
    return ok(null);
  }

  const q = tokens(text);
  const prefs = db.prefs[user.id];
  const scored = db.clubs
    .map((club: Club) => {
      const tagHits = club.tags.filter((t) => overlap(q, t) > 0);
      const score = tagHits.length * 3 + overlap(q, `${club.name} ${club.tagline} ${club.description}`);
      return { club, tagHits, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length) {
    const reasons: Record<string, string[]> = {};
    for (const s of scored)
      reasons[s.club.id] = s.tagHits.length ? s.tagHits : ["Mentioned in the club's description"];
    post(conversationId, {
      sender: "agent",
      name: "Student Agent",
      text: `I found ${scored.length} ${scored.length === 1 ? "club" : "clubs"} that match what you asked. Open one to ask its Club Agent a question.`,
      card: { type: "clubs", clubIds: scored.map((s) => s.club.id), reasons },
    });
  } else if (/recommend|suggest|what should|for me/.test(lower) && prefs?.personalization) {
    const recs = recommend(db, prefs).filter((r) => r.matched.length).slice(0, 3);
    post(conversationId, {
      sender: "agent",
      name: "Student Agent",
      text: recs.length
        ? "Based on the interests you chose, these are the closest matches."
        : "You haven't chosen any interests yet. Add some in Settings and I can recommend clubs.",
      card: recs.length
        ? { type: "clubs", clubIds: recs.map((r) => r.club.id), reasons: Object.fromEntries(recs.map((r) => [r.club.id, r.matched])) }
        : undefined,
    });
  } else {
    post(conversationId, {
      sender: "agent",
      name: "Student Agent",
      unverified: true,
      text: "I couldn't match that to a club in the directory. Try an interest such as robotics, film or running.",
    });
  }
  return ok(null);
}

// ---- USG / GSG agent -------------------------------------------------------

const CONCERN = /\b(should|problem|issue|complain|concern|unfair|broken|frustrat|wish|needs? to|too (slow|hard|long)|hard to)\b/i;
const CATEGORIES: [RegExp, string][] = [
  [/fund|budget|money|grant/i, "Funding"],
  [/room|space|book|venue/i, "Campus services"],
  [/class|course|professor|academic/i, "Academic affairs"],
  [/dining|food|housing|shuttle|library/i, "Campus services"],
];

export async function askGovernment(conversationId: string, text: string, scope: GovScope): Promise<Result<null>> {
  await userTurn(conversationId, text, "Searching approved sources");
  const q = tokens(text);
  const ranked = getDb()
    .knowledge.filter((d) => d.scope === scope)
    .map((doc: KnowledgeDoc) => ({ doc, score: overlap(q, `${doc.title} ${doc.title} ${doc.excerpt}`) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  const top = ranked[0]?.doc ?? null;
  const name = `${scope} assistant`;

  mutate((db) => {
    db.govQuestions.unshift({ id: uid("q"), scope, text, docId: top?.id ?? null, at: now() });
  });

  const isConcern = CONCERN.test(text);
  const category = CATEGORIES.find(([re]) => re.test(text))?.[1] ?? "General";

  if (top) {
    post(conversationId, {
      sender: "agent",
      name,
      text: top.excerpt,
      sources: ranked.map((r) => ({ title: r.doc.title, url: r.doc.url, verifiedAt: r.doc.verifiedAt })),
    });
  } else {
    post(conversationId, {
      sender: "agent",
      name,
      unverified: true,
      text: `I can't verify that from ${scope}'s approved sources, so I won't answer it. I'm an assistant, not an elected representative.`,
    });
  }
  if (isConcern || !top) {
    post(conversationId, {
      sender: "agent",
      name,
      text: isConcern
        ? "That sounds like something a representative should see. I can pass it on as feedback if you want."
        : "If you'd like a person to follow up, I can pass this on as feedback.",
      card: { type: "feedback_offer", scope, message: text, category },
    });
  }
  return ok(null);
}

export function submitFeedback(
  conversationId: string | null,
  input: { scope: GovScope; category: string; message: string; shareIdentity: boolean },
  user: DemoUser,
): Result<{ feedbackId: string }> {
  if (!input.message.trim()) return fail("VALIDATION_FAILED", "Feedback needs a message.");
  const feedbackId = `FB-${Math.floor(1000 + Math.random() * 9000)}`;
  mutate((db) => {
    db.feedback.unshift({
      id: feedbackId,
      scope: input.scope,
      category: input.category,
      message: input.message.trim(),
      sharedIdentity: input.shareIdentity,
      fromName: input.shareIdentity ? user.name : null,
      status: "new",
      at: now(),
    });
    for (const rep of db.users.filter((u) => u.role === "gov_rep" && u.scopeId === input.scope))
      db.notifications.unshift({ id: uid("n"), userId: rep.id, text: `New feedback: ${input.category}`, href: "/government/feedback", at: now(), read: false });
    const c = conversationId ? db.conversations.find((x) => x.id === conversationId) : null;
    if (c) {
      c.messages.push({
        id: uid("m"),
        at: now(),
        sender: "system",
        text: "Feedback sent",
        card: { type: "feedback_sent", feedbackId },
      });
      c.updatedAt = now();
    }
  });
  return ok({ feedbackId });
}
