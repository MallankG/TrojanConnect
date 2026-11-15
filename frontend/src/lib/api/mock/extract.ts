import { laDate, laDayOffset, laParts } from "@/lib/time";
import type { EventDraft, Feature } from "../types";

/**
 * Stand-in for the Club Agent's `extract_event_requirements` tool (PRD 9.2).
 * The real backend uses Gemini with structured output; this is a small rule
 * parser so the demo works offline and always gives the same answer.
 */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const FEATURES: [RegExp, Feature][] = [
  [/projector|screen|slides/i, "projector"],
  [/\bmics?\b|microphone/i, "microphone"],
  [/whiteboard/i, "whiteboard"],
  [/\bstage\b/i, "stage"],
  [/live ?stream|streaming/i, "livestream"],
];

const TYPES = ["networking", "workshop", "screening", "panel", "showcase", "performance", "social", "meeting", "talk"];

/** Requirements the rules engine cannot judge; they go to a person (PRD 8.2). */
const HUMAN_CHECK: [RegExp, string][] = [
  [/alcohol|beer|wine/i, "Alcohol service"],
  [/cater|food truck/i, "Catering"],
  [/security|guard/i, "Security staffing"],
  [/insurance/i, "Insurance"],
];

type Day = { y: number; m: number; d: number };

function findDay(text: string, now: Date): Day | null {
  const lower = text.toLowerCase();
  const today = laParts(now);
  const offset = (n: number): Day => {
    const p = laParts(laDayOffset(now, n, 12));
    return { y: p.y, m: p.m, d: p.d };
  };
  if (/\btomorrow\b/.test(lower)) return offset(1);
  if (/\btoday\b|\btonight\b/.test(lower)) return offset(0);

  const wd = lower.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wd) {
    let ahead = (WEEKDAYS.indexOf(wd[2]) - today.weekday + 7) % 7 || 7;
    // "next Wednesday" means the one at least a week out.
    if (wd[1]) ahead += ahead < 7 ? 7 : 0;
    return offset(ahead);
  }

  const md = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/);
  const dm = lower.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  const slash = lower.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  let m = 0;
  let d = 0;
  if (md) [m, d] = [MONTHS.indexOf(md[1]) + 1, +md[2]];
  else if (dm) [m, d] = [MONTHS.indexOf(dm[2]) + 1, +dm[1]];
  else if (slash) [m, d] = [+slash[1], +slash[2]];
  if (!m || !d || d > 31 || m > 12) return null;
  const past = m < today.m || (m === today.m && d < today.d);
  return { y: today.y + (past ? 1 : 0), m, d };
}

function findTimes(text: string) {
  const m = text.match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
  );
  if (!m) return null;
  const endHalf = m[6].toLowerCase();
  const to24 = (h: number, half: string) => (h % 12) + (half === "pm" ? 12 : 0);
  const endH = to24(+m[4], endHalf);
  let startH = to24(+m[1], (m[3] ?? endHalf).toLowerCase());
  // "11 to 1 PM" starts in the morning.
  if (!m[3] && startH >= endH) startH -= 12;
  if (startH < 0 || startH >= endH) return null;
  return { startH, startM: +(m[2] ?? 0), endH, endM: +(m[5] ?? 0) };
}

export type Extraction = { patch: Partial<EventDraft>; found: string[] };

export function extract(
  text: string,
  current: EventDraft,
  awaiting: "title" | "attendance" | "time" | null,
  now = new Date(),
): Extraction {
  const patch: Partial<EventDraft> = {};
  const found: string[] = [];

  const people =
    text.match(/(\d{1,4})\s*(?:people|students|attendees|guests|folks|ppl|members)/i) ??
    text.match(/\bfor\s+(\d{2,4})\b(?!\s*(?:am|pm|:))/i) ??
    (awaiting === "attendance" ? text.match(/(\d{1,4})/) : null);
  if (people && +people[1] > 0) {
    patch.attendance = +people[1];
    found.push("attendance");
  }

  const times = findTimes(text);
  const day = findDay(text, now);
  if (times || day) {
    const base = day ?? (current.start ? laParts(new Date(current.start)) : null);
    const t =
      times ??
      (current.start && current.end
        ? (() => {
            const s = laParts(new Date(current.start!));
            const e = laParts(new Date(current.end!));
            return { startH: s.h, startM: s.min, endH: e.h, endM: e.min };
          })()
        : null);
    if (base && t) {
      patch.start = laDate(base.y, base.m, base.d, t.startH, t.startM).toISOString();
      patch.end = laDate(base.y, base.m, base.d, t.endH, t.endM).toISOString();
      found.push("time");
    }
  }

  const features = FEATURES.filter(([re]) => re.test(text)).map(([, f]) => f);
  if (features.length) {
    patch.features = [...new Set([...current.features, ...features])];
    found.push("features");
  }

  const type = TYPES.find((t) => new RegExp(`\\b${t}`, "i").test(text));
  if (type) patch.eventType = type;

  if (/classroom|lecture hall/i.test(text)) patch.venueCategory = "classroom";

  const checks = HUMAN_CHECK.filter(([re]) => re.test(text)).map(([, label]) => label);
  if (checks.length) patch.needsHumanCheck = [...new Set([...current.needsHumanCheck, ...checks])];

  const named =
    text.match(/(?:called|titled|named|call it)\s+["“']?([^"”'.\n,]{3,60})/i) ??
    text.match(/["“]([^"”]{3,60})["”]/);
  if (named) {
    patch.title = named[1].trim();
    found.push("title");
  } else if (awaiting === "title" && found.length === 0 && text.trim().length <= 70) {
    patch.title = text.trim().replace(/[.!]$/, "");
    found.push("title");
  }

  return { patch, found };
}

export function missingFields(draft: EventDraft): ("title" | "attendance" | "time")[] {
  const out: ("title" | "attendance" | "time")[] = [];
  if (!draft.attendance) out.push("attendance");
  if (!draft.start || !draft.end) out.push("time");
  if (!draft.title) out.push("title");
  return out;
}

export const QUESTION: Record<"title" | "attendance" | "time", string> = {
  attendance: "How many people are you expecting?",
  time: "Which day, and from what time to what time?",
  title: "What should I call the event?",
};
