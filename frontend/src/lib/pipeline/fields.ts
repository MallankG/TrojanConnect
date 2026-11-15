// Canonical event profile for the event pipeline. Every USC form is filled from these fields,
// so a club rep enters each fact once.

export type Profile = Record<string, unknown> & {
  food?: boolean;
  venueKind?: VenueKind;
  audience?: string[];
};

export type VenueKind = "tcc" | "outdoor" | "classroom" | "viterbi" | "eeb_phe";

export const VENUE_KINDS: Record<VenueKind, string> = {
  tcc: "TCC meeting room (Trojan Event Services)",
  outdoor: "Outdoor venue — McCarthy Quad, Alumni Park, … (Trojan Event Services)",
  classroom: "General-use classroom (Campus Activities / Classroom Scheduling)",
  viterbi: "Viterbi venue (Viterbi events office)",
  eeb_phe: "EEB / PHE conference room (ECE department)",
};

export const CATERER_TYPES = [
  "USC Private Events & Conferences",
  "University Club Delivery",
  "USC Hospitality Retail Location (Panda, Seeds, Taco Taco, etc…)",
  "Food Truck",
  "Outside Caterer",
  "Food picked up from store or other location",
  "Offsite location (hotel or restaurant)",
  "Self-prepared",
];

// Caterers offered by the Event Permit's "Select Caterer Name" lookup (read live, Nov 2026).
export const PERMIT_APPROVED_CATERERS = [
  "California Skewers (Katse Inc)", "Caribbean Soul Kitchen", "Catholic Charities of LA Inc (The Village Kitchen)",
  "Chelo Inc", "Chick Fil A USC", "City Fare Catering", "City Tacos", "Corner Bakery Cafe", "Craw Daddy Boiler LLC",
  "Cup Of Cha Tea House", "Carousel Restaurant (Lemon Curry Management)", "La Fiesta Mexican Cuisine LLC",
  "Mi California Pollos Catering", "Zena Llc", "Taylor Made Cuisine Inc", "Creative European Cooking LLC", "Tres La",
  "Untitled Project Catering and Events LLC", "City Kitchen (Urban Plate LLC)", "Vesti Group LLC",
];

export const AUDIENCES = ["Students", "Faculty", "Staff", "Alumni", "General Public"];
export const EQUIPMENT = ["Projector", "Microphone", "Whiteboard", "Tables", "Stage"];
const TIME_FLEX: Record<string, string> = { "0": "Exact time only", "30": "Up to 30 min earlier or later", "60": "Up to 1 hour earlier or later", "120": "Up to 2 hours earlier or later" };

export type FieldType = "text" | "email" | "tel" | "date" | "time" | "number" | "textarea" | "select" | "bool" | "multi";

export interface FieldDef {
  key: string;
  group: string;
  label: string;
  type: FieldType;
  options?: string[];
  optionLabels?: Record<string, string>;
  optional?: boolean;
  validate?: (v: unknown) => true | string;
  when?: (p: Profile) => boolean;
}

export const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

const foodOnly = (p: Profile) => !!p.food;

export const FIELDS: FieldDef[] = [
  { key: "orgName", group: "Organization", label: "Organization name (exactly as on EngageSC, no acronyms)", type: "text" },
  { key: "firstName", group: "You (requester)", label: "First name", type: "text" },
  { key: "lastName", group: "You (requester)", label: "Last name", type: "text" },
  { key: "email", group: "You (requester)", label: "USC email", type: "email" },
  { key: "phone", group: "You (requester)", label: "Cell phone (10 digits)", type: "tel", validate: v => /^\d{10}$/.test(digits(v)) || "Needs 10 digits" },
  { key: "uscId", group: "You (requester)", label: "10-digit USC ID", type: "text", validate: v => /^\d{10}$/.test(String(v)) || "Must be exactly 10 digits" },
  { key: "initials", group: "You (requester)", label: "Initials (officer attestation)", type: "text" },
  { key: "eboardPosition", group: "You (requester)", label: "E-board position", type: "select", options: ["President", "Vice President", "Secretary", "Treasurer", "Programming Chair"] },
  { key: "onsiteName", group: "Day-of contacts", label: "On-site contact name", type: "text" },
  { key: "onsitePhone", group: "Day-of contacts", label: "On-site contact phone", type: "tel" },
  { key: "secondaryName", group: "Day-of contacts", label: "Secondary contact name", type: "text", optional: true },
  { key: "secondaryPhone", group: "Day-of contacts", label: "Secondary contact phone", type: "tel", optional: true },
  { key: "secondaryEmail", group: "Day-of contacts", label: "Secondary contact email", type: "email", optional: true },

  { key: "eventName", group: "Event", label: "Event name (use the same name on every form)", type: "text" },
  { key: "description", group: "Event", label: "Event description", type: "textarea" },
  { key: "eventType", group: "Event", label: "Event type", type: "select", options: ["Meeting", "Lecture/Speaking Engagement", "Conference/Workshop", "Cultural Performance", "Fair", "Exhibit", "Other"] },
  { key: "date", group: "Event", label: "Event date", type: "date" },
  { key: "setupTime", group: "Event", label: "Setup start", type: "time" },
  { key: "startTime", group: "Event", label: "Event start", type: "time" },
  { key: "endTime", group: "Event", label: "Event end", type: "time" },
  { key: "teardownTime", group: "Event", label: "Tear-down done by", type: "time" },
  { key: "backupDates", group: "Event", label: "Backup dates/times (for Viterbi requests)", type: "textarea", optional: true },
  { key: "attendance", group: "Event", label: "Expected attendance", type: "number", validate: v => (+String(v) > 0 && +String(v) <= 60) || "Walkthrough rule: keep attendance at 60 or fewer" },
  { key: "audience", group: "Event", label: "Expected audience", type: "multi", options: AUDIENCES },
  { key: "amplifiedSound", group: "Event", label: "Amplified sound?", type: "bool" },
  { key: "filmed", group: "Event", label: "Filmed or photographed?", type: "bool" },
  { key: "marketingPlatform", group: "Event", label: "Marketing platform", type: "text", optional: true },

  { key: "venueKind", group: "Venue", label: "Where is the event?", type: "select", options: Object.keys(VENUE_KINDS), optionLabels: VENUE_KINDS },
  { key: "venueChoice1", group: "Venue", label: 'First-choice room/space (e.g. "TCC 350", "THH 101", "EEB 248", "McCarthy Quad")', type: "text" },
  { key: "venueChoice2", group: "Venue", label: "Second choice", type: "text", optional: true },
  { key: "acceptAlternate", group: "Venue", label: "Accept an alternate location?", type: "bool" },
  { key: "equipment", group: "Venue", label: "Equipment needed", type: "multi", options: EQUIPMENT, optional: true },
  { key: "timeFlexMinutes", group: "Venue", label: "How far may the time move? (the venue agent may offer a shifted slot)", type: "select", options: Object.keys(TIME_FLEX), optionLabels: TIME_FLEX, optional: true },

  { key: "food", group: "Food", label: "Serving food or drinks?", type: "bool" },
  { key: "catererType", group: "Food", label: "Caterer type", type: "select", options: CATERER_TYPES, when: foodOnly },
  { key: "catererName", group: "Food", label: "Caterer / vendor name", type: "text", when: foodOnly },
  { key: "menu", group: "Food", label: "Menu details", type: "textarea", when: foodOnly },
  { key: "foodValue", group: "Food", label: "Food cost (USD)", type: "number", when: foodOnly },
  { key: "paymentType", group: "Food", label: "Payment type", type: "select", options: ["PO", "ISP (Internal Service Provider)", "PCard", "Credit Card", "Check", "Sponsored", "Not Applicable"], when: foodOnly },
  { key: "vendorServes", group: "Food", label: "Vendor serves the food (vs. self-serve)?", type: "bool", when: foodOnly },

  { key: "budgetTotal", group: "Funding", label: "Total requested budget (USD)", type: "number" },
  { key: "budgetLink", group: "Funding", label: "Link to your completed budget proposal", type: "text" },

  { key: "vpFinanceEmail", group: "Contacts", label: "VP of Finance (Vaibhavi) email", type: "email" },
  { key: "vpCommsEmail", group: "Contacts", label: "VP of Communications (Tyler) email", type: "email" },
  { key: "advisorName", group: "Contacts", label: "Department advisor name", type: "text" },
  { key: "advisorEmail", group: "Contacts", label: "Department advisor email", type: "email" },
  { key: "hospitalityEmail", group: "Contacts", label: "USC Hospitality contact email (non-approved vendors)", type: "email", optional: true },
];

export const FIELD_BY_KEY: Record<string, FieldDef> = Object.fromEntries(FIELDS.map(f => [f.key, f]));

export function isFilled(profile: Profile, key: string): boolean {
  const v = profile[key];
  if (FIELD_BY_KEY[key]?.type === "bool") return v === true || v === false;
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && String(v).trim() !== "";
}

/** null = OK, "missing", or a validation message. */
export function fieldProblem(profile: Profile, key: string): string | null {
  const f = FIELD_BY_KEY[key];
  if (!isFilled(profile, key)) return "missing";
  if (f?.validate) {
    const r = f.validate(profile[key]);
    if (r !== true) return r;
  }
  return null;
}

export function fieldApplies(profile: Profile, key: string): boolean {
  const f = FIELD_BY_KEY[key];
  return !f?.when || f.when(profile);
}

/** "18:30" -> "6:30 PM" */
export function to12h(t: unknown): string {
  if (!t || typeof t !== "string") return "";
  const [hh, m] = t.split(":").map(Number);
  const ap = hh >= 12 ? "PM" : "AM";
  const h = hh % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}
