/**
 * Copy and choreography data for the landing page.
 *
 * Everything in the chaos and people scenes is an illustrative scenario written
 * by the team. It is labelled as such on the page; none of it is a measurement.
 */

/** The PRD's demo request. It opens the page and is the thread through it. */
export const SENTENCE =
  "We need a room for 100 students next Wednesday, 5 to 8 PM, with a projector and microphones.";

/** How much of the sentence is already typed before the visitor enters. */
export const SENTENCE_HEAD = "We need a room for 100 students";

export type PileKind =
  | "email"
  | "chat"
  | "form"
  | "autoreply"
  | "routing"
  | "calendar"
  | "sticky"
  | "missed";

export type PileItem = {
  id: string;
  kind: PileKind;
  /** Centre position as a percentage of the stage. */
  x: number;
  y: number;
  rot: number;
  /** Direction it flies in from. */
  from: "left" | "right" | "top" | "bottom";
  title?: string;
  meta?: string;
  body?: string;
  /** Hidden on phones, where the pile is thinned out. */
  desktopOnly?: boolean;
  sound: "ping" | "buzz" | "type";
};

export const PILE: PileItem[] = [
  {
    id: "email-1",
    kind: "email",
    x: 27,
    y: 36,
    rot: -6,
    from: "left",
    title: "Room request: AI Networking Night",
    meta: "To: events office",
    body: "Hi, we'd like to book a room for 100 students next Wednesday…",
    sound: "ping",
  },
  {
    id: "chat-1",
    kind: "chat",
    x: 74,
    y: 30,
    rot: 4,
    from: "right",
    meta: "Club exec chat",
    body: "did we get the room??",
    sound: "buzz",
  },
  {
    id: "form-1",
    kind: "form",
    x: 67,
    y: 64,
    rot: 5,
    from: "bottom",
    title: "Event space request",
    meta: "Page 3 of 5",
    sound: "type",
  },
  {
    id: "autoreply",
    kind: "autoreply",
    x: 29,
    y: 70,
    rot: -3,
    from: "left",
    title: "Automatic reply",
    body: "I am out of the office until Monday and will respond when I return.",
    desktopOnly: true,
    sound: "ping",
  },
  {
    id: "routing",
    kind: "routing",
    x: 50,
    y: 21,
    rot: 2,
    from: "top",
    title: "Who handles this room?",
    sound: "ping",
  },
  {
    id: "chat-2",
    kind: "chat",
    x: 82,
    y: 50,
    rot: -5,
    from: "right",
    meta: "Club exec chat",
    body: "flyers go out tmrw, need a location",
    desktopOnly: true,
    sound: "buzz",
  },
  {
    id: "email-2",
    kind: "email",
    x: 41,
    y: 47,
    rot: 7,
    from: "bottom",
    title: "Re: Re: Fwd: Room request",
    meta: "From: a different office",
    body: "This space isn't ours. You may want to try classroom scheduling.",
    sound: "ping",
  },
  {
    id: "calendar",
    kind: "calendar",
    x: 20,
    y: 53,
    rot: 3,
    from: "left",
    title: "Next week",
    desktopOnly: true,
    sound: "type",
  },
  {
    id: "sticky",
    kind: "sticky",
    x: 59,
    y: 39,
    rot: -9,
    from: "top",
    body: "Call back after 3 PM. Ask for the form link again.",
    sound: "type",
  },
  {
    id: "chat-3",
    kind: "chat",
    x: 61,
    y: 80,
    rot: 3,
    from: "bottom",
    meta: "Club exec chat",
    body: "any update?",
    sound: "buzz",
  },
  {
    id: "form-2",
    kind: "email",
    x: 37,
    y: 82,
    rot: -4,
    from: "bottom",
    title: "Request returned",
    meta: "Missing: end time, AV needs",
    body: "Please resubmit with the complete details so we can review.",
    desktopOnly: true,
    sound: "ping",
  },
  {
    id: "missed",
    kind: "missed",
    x: 83,
    y: 75,
    rot: 6,
    from: "right",
    title: "Missed call",
    meta: "Scheduling office · no voicemail",
    desktopOnly: true,
    sound: "buzz",
  },
  {
    id: "chat-4",
    kind: "chat",
    x: 71,
    y: 45,
    rot: 8,
    from: "right",
    meta: "Club exec chat",
    body: "should we just do it on the lawn",
    sound: "buzz",
  },
  {
    id: "email-3",
    kind: "email",
    x: 35,
    y: 23,
    rot: -7,
    from: "top",
    title: "Following up on my follow-up",
    meta: "To: events office",
    body: "Just checking this didn't get lost. The event is in six days.",
    desktopOnly: true,
    sound: "ping",
  },
  {
    id: "email-4",
    kind: "email",
    x: 50,
    y: 52,
    rot: 1,
    from: "top",
    title: "Re: Re: Re: Fwd: Room request",
    meta: "From: events office",
    body: "Can you confirm headcount and whether you need microphones?",
    sound: "ping",
  },
];

/** The word behind the pile changes as the days pass. */
export const GHOST_WORDS = [
  "Request sent.",
  "Following up.",
  "Wrong office.",
  "Following up again.",
  "Still waiting.",
];

export type Person = {
  role: string;
  quote: string;
  stuck: string;
};

export const PEOPLE: Person[] = [
  {
    role: "Club representative",
    quote:
      "I sent the request nine days ago and followed up three times. I still don't know whose desk it's on.",
    stuck: "Chasing a room instead of running the event.",
  },
  {
    role: "Venue reviewer",
    quote:
      "Half of what reaches me is missing a headcount or an end time. I spend the day asking for things people already know.",
    stuck: "Reviewing incomplete requests one email at a time.",
  },
  {
    role: "Student",
    quote: "There are hundreds of clubs here. I found mine in my third semester, by accident.",
    stuck: "No way to ask a club a question before showing up.",
  },
  {
    role: "Student government representative",
    quote: "We run programs students would use. Most of them never hear that we exist.",
    stuck: "Answers and feedback scattered across inboxes.",
  },
];

// ---- The solution script ---------------------------------------------------

export type ScriptMessage =
  | { kind: "user"; text: string }
  | { kind: "agent"; who: string; text: string }
  | { kind: "system"; text: string; tag?: string }
  | {
      kind: "offer";
      who: string;
      label: string;
      venue: string;
      seats: string;
      time: string;
      diff: string;
      match: boolean;
    }
  | { kind: "reviewer"; text: string }
  | { kind: "confirmed"; text: string };

export const SCRIPT: ScriptMessage[] = [
  { kind: "user", text: SENTENCE },
  { kind: "system", text: "Club Agent is reading your request" },
  {
    kind: "agent",
    who: "Club Agent",
    text: "Got it: 100 people, Wednesday 25 November, 5:00 to 8:00 PM, projector and microphones. What should I call the event?",
  },
  { kind: "user", text: "AI Networking Night" },
  {
    kind: "agent",
    who: "Club Agent",
    text: "The summary is ready on the right. Send it to the venue team?",
  },
  { kind: "user", text: "Send it" },
  { kind: "system", text: "Routed to the venue authority for campus event spaces" },
  { kind: "system", text: "Checking venue inventory", tag: "Simulated" },
  {
    kind: "offer",
    who: "Venue workflow",
    label: "Offer",
    venue: "Demo Meeting Room A",
    seats: "120 seats",
    time: "5:30 to 8:30 PM",
    diff: "Starts and ends 30 minutes later than you asked",
    match: false,
  },
  {
    kind: "agent",
    who: "Club Agent",
    text: "The club has to finish by 8:00 PM. Is anything free from 5:00?",
  },
  {
    kind: "offer",
    who: "Venue workflow",
    label: "Counteroffer",
    venue: "Demo Hall B",
    seats: "150 seats",
    time: "5:00 to 8:00 PM",
    diff: "Matches every requirement",
    match: true,
  },
  { kind: "user", text: "Accept for review" },
  { kind: "system", text: "Accepted for review. Not confirmed until a person approves." },
  { kind: "reviewer", text: "Approved. Capacity and equipment check out for this room." },
  { kind: "confirmed", text: "Booking confirmed after reviewer approval" },
];

export const STEPS = ["Draft", "Submitted", "Negotiating", "In review", "Approved", "Confirmed"];

/** Which stepper state is active once `count` messages are visible. */
export function stepFor(count: number) {
  if (count >= 15) return 5;
  if (count >= 14) return 4;
  if (count >= 13) return 3;
  if (count >= 8) return 2;
  if (count >= 6) return 1;
  return 0;
}
