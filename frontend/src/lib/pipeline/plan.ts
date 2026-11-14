// The event waterfall: steps, dependencies, deadlines, the forms/emails each step uses, and the
// profile fields each form needs. Mapped by visiting every link in the walkthrough (Nov 2026).
import { fieldApplies, fieldProblem, to12h, VENUE_KINDS, type Profile, type VenueKind } from "./fields";

export type FormMode = "prefill" | "email" | "manual";
export type RunnableForm = "tcc" | "outdoor" | "classroom" | "eeRoom" | "permit";

export interface FormDef {
  name: string;
  url?: string;
  auto: FormMode;
  requires: string[];
  rules: string[];
}

const COMMON_CONTACT = ["orgName", "firstName", "lastName", "email", "phone"];
const COMMON_EVENT = ["eventName", "description", "date", "startTime", "endTime", "attendance"];

export const FORMS: Record<string, FormDef> = {
  tcc: {
    name: "TCC Meeting Room Request (Wufoo)", url: "https://scevents.wufoo.com/forms/p11ku1c01p5kpxf/", auto: "prefill",
    requires: [...COMMON_CONTACT, "eboardPosition", ...COMMON_EVENT, "setupTime", "teardownTime", "venueChoice1", "acceptAlternate", "food", "filmed"],
    rules: ["Submit at least 3 weeks before the event.", "Room capacity is never exceeded (TCC 221 = 10, 350/351/352 combo = 126).", "Each room has 1 trash can; extra trash boxes are charged if food is served."],
  },
  outdoor: {
    name: "Outdoor Venue Request (Wufoo)", url: "https://scevents.wufoo.com/forms/q1ofqron0clb1tz/", auto: "prefill",
    requires: [...COMMON_CONTACT, ...COMMON_EVENT, "setupTime", "teardownTime", "venueChoice1", "acceptAlternate", "eventType", "food", "filmed", "amplifiedSound"],
    rules: ["TES asks for 6 weeks notice. Your walkthrough says 3+, so the tracker uses 6.", "Outdoor events run 8:00 AM–11:30 PM; no amplified sound after 8 PM.", "Not available during Welcome Experience, Festival of Books, home football days or commencement."],
  },
  classroom: {
    name: "Classroom Space Request (Wufoo, 8 pages)", url: "https://usccampusactivities.wufoo.com/forms/classroom-space-request-form/", auto: "prefill",
    requires: [...COMMON_CONTACT, "initials", ...COMMON_EVENT, "eventType", "venueChoice1", "audience", "amplifiedSound"],
    rules: ["Only for weeks 4 through the last day of instruction; never on holidays, study days or finals.", "Starts: Mon–Thu 6:00 PM or later, Fri 3:00 PM or later. Must end by 11:00 PM.", "Not accepted within 48 hours. Fri–Sun requests are due by Thursday 12:00 PM the week before.", "Recommended: at least 2 weeks ahead. A permit is needed if 25+ people OR food."],
  },
  eeRoom: {
    name: "ECE Conference Room Request (EEB/PHE)", url: "https://ee.usc.edu/info/conference_rooms/", auto: "prefill",
    requires: ["firstName", "lastName", "email", "phone", "eventName", "description", "date", "startTime", "endTime", "attendance", "venueChoice1"],
    rules: ["Submit at least 3 days ahead (2 weeks recommended).", "Non-EE departments can book at most 1 month out.", 'Availability calendars are public. Use "Check availability".'],
  },
  viterbiEmail: {
    name: "Email Kevin Giang (kgiang@usc.edu)", auto: "email",
    requires: ["eventName", "date", "startTime", "endTime", "attendance"],
    rules: ["Include ideal date/time AND a list of backup options."],
  },
  vendorList: {
    name: "Approved vendor list (Google Sheet; needs USC login)", url: "https://docs.google.com/spreadsheets/d/1MpsjBRyMtZVtkoQi1tp1xVVln6KU6G45/edit?gid=213302733", auto: "manual",
    requires: ["catererName", "catererType", "menu", "foodValue"],
    rules: ["Not on the list → contact USC Hospitality. The permit then needs a one-time approval (health permit + insurance) due 2 weeks before the event."],
  },
  permit: {
    name: "USC Event Permit (Salesforce, 11 stages)", url: "https://usc-its.my.site.com/eventpermits/s/request-submission", auto: "prefill",
    requires: [...COMMON_CONTACT, "uscId", "onsiteName", "onsitePhone", ...COMMON_EVENT, "setupTime", "teardownTime", "audience", "food", "filmed", "amplifiedSound", "catererType", "catererName", "menu", "foodValue", "paymentType", "vendorServes"],
    rules: ["Only after the room is CONFIRMED (needs the 6-digit reservation #).", "Walkthrough: answer NO to trash/waste services; attendance must not be over 60.", "Pre-filler stops at Acknowledgements (ADA, Smoke-Free, Plastic). You tick those and submit."],
  },
  budgetEmail: {
    name: "Email budget proposal to VP Finance (Vaibhavi)", url: "https://docs.google.com/spreadsheets/d/1SLqu6rXsgGxxRK2foMnV9HJJy8abhFsr/edit?gid=4042447", auto: "email",
    requires: ["vpFinanceEmail", "eventName", "date", "budgetTotal", "budgetLink"],
    rules: ['The budget template link in the walkthrough returns "410 Gone". Ask Vaibhavi for the current template.', "She submits to Viterbi; you then order in person at OHE and must be there for delivery."],
  },
  engage: {
    name: "EngageSC event + permit code", url: "https://engage.usc.edu/", auto: "manual",
    requires: ["eventName", "date", "startTime", "endTime"],
    rules: ["Requires a room reservation AND the event permit.", "Create the event, enter the permit code, sign, and submit for approval (see the walkthrough video)."],
  },
  accessEmail: {
    name: "Ask VP Comms (Tyler) for accessibility & non-discrimination statements", auto: "email",
    requires: ["vpCommsEmail", "eventName"], rules: [],
  },
  commsEmail: {
    name: "Send graphic to VP Comms (Tyler) for Instagram", auto: "email",
    requires: ["vpCommsEmail", "eventName", "date", "startTime", "venueChoice1"], rules: ["Make the graphic in Canva first and attach it."],
  },
  advisorEmail: {
    name: "Send graphic to department advisor", auto: "email",
    requires: ["advisorEmail", "advisorName", "eventName", "date", "startTime", "venueChoice1"], rules: [],
  },
};

export const VENUE_FORM: Record<VenueKind, string> = { tcc: "tcc", outdoor: "outdoor", classroom: "classroom", viterbi: "viterbiEmail", eeb_phe: "eeRoom" };
const VENUE_LEAD_DAYS: Record<VenueKind, number> = { outdoor: 42, tcc: 21, classroom: 14, viterbi: 21, eeb_phe: 14 };

export type StepId = "venue" | "food" | "permit" | "funding" | "engage" | "access" | "publicity";
export type StepStatus = "done" | "ready" | "active" | "waiting" | "blocked" | "skipped";

export interface StepDef {
  id: StepId;
  n: number;
  title: string;
  owner: string;
  after: StepId[];
  lead: number;
  official: boolean;
  skip?: boolean;
  forms: string[];
  substeps: [string, string][];
  needsData?: { key: string; label: string }[];
  blurb: string;
  doneKey: string;
}

export function buildSteps(profile: Profile): StepDef[] {
  const vk = profile.venueKind;
  const noFood = profile.food === false;
  return [
    {
      id: "venue", n: 1, title: "Reserve the venue", owner: "You → venue office",
      after: [], lead: vk ? VENUE_LEAD_DAYS[vk] : 21, official: true,
      forms: vk ? [VENUE_FORM[vk]] : [], doneKey: "confirmed",
      substeps: [["submitted", "Request submitted"], ["confirmed", "Reservation confirmed"]],
      needsData: [
        { key: "reservationNumber", label: "Reservation # (6 digits, for the permit)" },
        { key: "venueContactName", label: "Venue manager name (who confirmed it)" },
        { key: "venueContactEmail", label: "Venue manager email" },
      ],
      blurb: vk ? VENUE_KINDS[vk] : "Choose a venue type in the profile first.",
    },
    {
      id: "food", n: 2, title: "Pick an approved food vendor", owner: "You",
      after: [], lead: 21, official: false, skip: noFood, forms: ["vendorList"], doneKey: "quote",
      substeps: [["picked", "Vendor chosen from approved list"], ["quote", "Quote / menu in hand"], ["hospitality", "Not approved: contacted Hospitality (skip if approved)"]],
      blurb: "The permit lookup currently lists 20 approved outside caterers; the full list is on the USC-only sheet.",
    },
    {
      id: "permit", n: 3, title: "Event permit application", owner: "You → DPS + departments",
      after: noFood ? ["venue"] : ["venue", "food"], lead: 14, official: true, forms: ["permit"], doneKey: "approved",
      substeps: [["submitted", "Permit submitted"], ["followups", "Followed up with each department listed in the confirmation email"], ["approved", "Permit approved"]],
      needsData: [{ key: "permitCode", label: "Permit number / code" }],
      blurb: 'Fill in only after the room is confirmed. Answer "No" to trash and keep attendance at 60 or under.',
    },
    {
      id: "funding", n: 4, title: "Funding application → VP Finance", owner: "You → Vaibhavi → Viterbi → OHE",
      after: noFood ? [] : ["food"], lead: 14, official: false, forms: ["budgetEmail"], doneKey: "delivery",
      substeps: [["proposal", "Budget proposal completed"], ["sent", "Sent to Vaibhavi"], ["approved", "Approved & submitted to Viterbi"], ["ohe", "Ordered in person at OHE"], ["delivery", "Delivery time confirmed (you are available)"]],
      blurb: "Vaibhavi approves the budget and submits it to Viterbi. You then place the order in person at OHE.",
    },
    {
      id: "engage", n: 5, title: "EngageSC event", owner: "You → Campus Activities",
      after: ["venue", "permit"], lead: 10, official: false, forms: ["engage"], doneKey: "approved",
      substeps: [["created", "Event created with permit code"], ["signed", "Signed & submitted for approval"], ["approved", "Approved on EngageSC"]],
      blurb: "Needs a confirmed room reservation and the permit code.",
    },
    {
      id: "access", n: 6, title: "Accessibility & non-discrimination statements", owner: "You ↔ Tyler",
      after: [], lead: 10, official: false, forms: ["accessEmail"], doneKey: "added",
      substeps: [["asked", "Requested statements from Tyler"], ["added", "Statements added to graphic & EngageSC page"]],
      blurb: "Done before publicity so the statements appear on the graphic.",
    },
    {
      id: "publicity", n: 7, title: "Publicize", owner: "You → Tyler, advisor",
      after: ["engage", "access"], lead: 7, official: false, forms: ["commsEmail", "advisorEmail"], doneKey: "advisor",
      substeps: [["graphic", "Graphic made (Canva)"], ["tyler", "Sent to Tyler for Instagram"], ["advisor", "Sent to department advisor"], ["dayof", "Re-posted on the day of the event"]],
      blurb: "Re-post on the day of the event.",
    },
  ];
}

export interface StepProgress { checks: Record<string, boolean>; data: Record<string, string> }
export interface PipelineState { profile: Profile; progress: Partial<Record<StepId, StepProgress>>; log: { at: string; msg: string }[] }

export interface DerivedStep extends StepDef {
  checks: Record<string, boolean>;
  data: Record<string, string>;
  done: boolean;
  status: StepStatus;
  blockedBy: StepId[];
  due: Date | null;
  daysLeft: number | null;
  missing: string[];
  nDone: number;
  late: boolean;
}

export interface Derived {
  steps: DerivedStep[];
  byId: Record<StepId, DerivedStep>;
  current: DerivedStep[];
  waiting: DerivedStep[];
  complete: number;
  total: number;
  eventDate: Date | null;
  daysToEvent: number | null;
}

const DAY = 86_400_000;
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);
export function parseLocalDate(s: unknown): Date | null {
  if (!s || typeof s !== "string") return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function missingFor(formId: string, profile: Profile): { key: string; problem: string }[] {
  const f = FORMS[formId];
  if (!f) return [];
  const out: { key: string; problem: string }[] = [];
  for (const k of f.requires) {
    if (!fieldApplies(profile, k)) continue;
    const p = fieldProblem(profile, k);
    if (p) out.push({ key: k, problem: p });
  }
  return out;
}

const WAITING_ON: Partial<Record<StepId, (c: Record<string, boolean>) => boolean>> = {
  venue: c => !!c.submitted,
  permit: c => !!c.submitted,
  funding: c => !!c.sent && !c.approved,
  engage: c => !!c.signed,
};

/** Derive each step's live status from saved progress + profile + today's date. */
export function deriveState(state: PipelineState, today: Date): Derived {
  const profile = state.profile ?? {};
  const steps = buildSteps(profile);
  const eventDate = parseLocalDate(profile.date);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const byId = {} as Record<StepId, DerivedStep>;
  for (const s of steps) {
    const p = state.progress?.[s.id] ?? { checks: {}, data: {} };
    const checks = p.checks ?? {};
    const nDone = s.substeps.filter(([k]) => checks[k]).length;
    const done = !!s.skip || !!checks[s.doneKey] || (s.id === "food" && !!checks.picked && !!checks.quote);
    const blockedBy = s.after.filter(d => !byId[d]?.done);
    const due = eventDate ? new Date(eventDate.getTime() - s.lead * DAY) : null;
    const daysLeft = due ? daysBetween(t0, due) : null;
    const missing = [...new Set(s.forms.flatMap(fid => missingFor(fid, profile).map(m => m.key)))];
    let status: StepStatus;
    if (s.skip) status = "skipped";
    else if (done) status = "done";
    else if (blockedBy.length) status = "blocked";
    else if (WAITING_ON[s.id]?.(checks)) status = "waiting";
    else if (nDone > 0) status = "active";
    else status = "ready";
    byId[s.id] = { ...s, checks, data: p.data ?? {}, done, status, blockedBy, due, daysLeft, missing, nDone, late: daysLeft !== null && daysLeft < 0 && !done && !s.skip };
  }
  const list = steps.map(s => byId[s.id]);
  return {
    steps: list, byId,
    current: list.filter(s => s.status === "ready" || s.status === "active"),
    waiting: list.filter(s => s.status === "waiting"),
    complete: list.filter(s => s.done || s.skip).length,
    total: list.length,
    eventDate,
    daysToEvent: eventDate ? daysBetween(t0, eventDate) : null,
  };
}

// ---- Email drafts ---------------------------------------------------------------------------
export interface EmailDraft { to: string; subject: string; body: string }

export function emailDraft(formId: string, P: Profile): EmailDraft | null {
  const s = (k: string) => String(P[k] ?? "");
  const when = `${s("date") || "[date]"}, ${to12h(P.startTime) || "[start]"}–${to12h(P.endTime) || "[end]"}`;
  const me = `${s("firstName")} ${s("lastName")}`.trim() || "[your name]";
  const sig = `\n\nThank you,\n${me}\n${s("orgName")}\n${s("email")} · ${s("phone")}`;
  switch (formId) {
    case "viterbiEmail": return {
      to: "kgiang@usc.edu", subject: `Venue request: ${s("eventName") || "[event]"}`,
      body: `Hi Kevin,\n\nI'd like to request a Viterbi venue for an upcoming event.\n\nEvent name: ${s("eventName")}\nIdeal date/time: ${when}\nBackup options:\n${s("backupDates") || "  - [add backups]"}\nExpected number of attendees: ${s("attendance")}\n${P.venueChoice1 ? `Preferred space: ${s("venueChoice1")}\n` : ""}${sig}`,
    };
    case "budgetEmail": return {
      to: s("vpFinanceEmail"), subject: `Funding application: ${s("eventName")} (${s("date")})`,
      body: `Hi Vaibhavi,\n\nPlease find our budget proposal for ${s("eventName")} on ${when}${P.venueChoice1 ? ` at ${s("venueChoice1")}` : ""}.\n\nTotal requested: $${s("budgetTotal")}\nBudget proposal: ${s("budgetLink")}\n${P.food ? `Food vendor: ${s("catererName")} (${s("catererType")}) — approx. $${s("foodValue")}\n` : ""}Expected attendance: ${s("attendance")}\n\nCould you review and, if approved, submit it to Viterbi? I'll place the order in person at OHE and will be available for delivery.${sig}`,
    };
    case "accessEmail": return {
      to: s("vpCommsEmail"), subject: `Accessibility & non-discrimination statements — ${s("eventName")}`,
      body: `Hi Tyler,\n\nCould you send the accessibility and non-discrimination statements to include for ${s("eventName")} (${when})? Let me know if anything about the event needs changing.${sig}`,
    };
    case "commsEmail": return {
      to: s("vpCommsEmail"), subject: `Instagram post: ${s("eventName")} — ${s("date")}`,
      body: `Hi Tyler,\n\nAttached is the graphic for ${s("eventName")}.\n\nWhen: ${when}\nWhere: ${s("venueChoice1")}\n${s("description")}\n\nCould you post it on Instagram? We'll re-share on the day of the event as well.\n\n[ATTACH GRAPHIC]${sig}`,
    };
    case "advisorEmail": return {
      to: s("advisorEmail"), subject: `Please share: ${s("eventName")} — ${s("date")}`,
      body: `Hi ${s("advisorName")},\n\nWe're hosting ${s("eventName")} on ${when} at ${s("venueChoice1")}. Would you be able to share the attached graphic with the department?\n\n${s("description")}\n\n[ATTACH GRAPHIC]${sig}`,
    };
    case "hospitality": return {
      to: s("hospitalityEmail"), subject: `Non-approved vendor request — ${s("eventName")}`,
      body: `Hello,\n\nWe'd like to use ${s("catererName")}, which is not on the approved vendor list, for ${s("eventName")} on ${when} (~${s("attendance")} attendees). What's needed for a one-time approval?${sig}`,
    };
  }
  return null;
}

export const mailto = (d: EmailDraft) =>
  `mailto:${encodeURIComponent(d.to)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
