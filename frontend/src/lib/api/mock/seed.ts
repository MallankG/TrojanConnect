import { laDayOffset } from "@/lib/time";
import type {
  Booking,
  BookingState,
  CampusEvent,
  Club,
  Conversation,
  Db,
  DemoUser,
  EventDraft,
  Feature,
  KnowledgeDoc,
  Proposal,
  TimelineEntry,
  Venue,
} from "../types";
import { INVENTORY_VERSION } from "./inventory";

/**
 * Seed data for the demo. Clubs, people and venues are invented; nothing here
 * is a real USC organisation, room or policy. Dates are relative to the moment
 * the demo is first opened so the lists always look current.
 */

export const DB_VERSION = 6;

export const USERS: DemoUser[] = [
  { id: "u-maya", name: "Maya Okafor", role: "club_rep", scopeId: "usc-hacksc", scopeName: "HackSC" },
  { id: "u-daniel", name: "Daniel Reyes", role: "venue_reviewer", scopeId: "campus-event-spaces", scopeName: "Campus event spaces" },
  { id: "u-priya", name: "Priya Shah", role: "student", scopeId: null, scopeName: null,
    interests: ["artificial_intelligence", "machine_learning", "entrepreneurship", "hackathons", "startups"] },
  { id: "u-marcus", name: "Marcus Bell", role: "student", scopeId: null, scopeName: null,
    interests: ["film", "music", "performing_arts", "media"] },
  { id: "u-sofia", name: "Sofia Ramirez", role: "student", scopeId: null, scopeName: null,
    interests: ["sustainability", "outdoors", "community_service", "health"] },
  { id: "u-jordan", name: "Jordan Lee", role: "gov_rep", scopeId: "USG", scopeName: "Undergraduate Student Government" },
];

export const INTEREST_TAGS = [
  "Artificial intelligence",
  "Entrepreneurship",
  "Film",
  "Music",
  "Dance",
  "Climate",
  "Robotics",
  "Consulting",
  "Open source",
  "Design",
  "Running",
  "Books",
  "Public health",
  "Finance",
  "Volunteering",
];

const CLUBS: Club[] = [
  {
    id: "trojan-ai",
    name: "Trojan AI Society",
    tagline: "Build, read and argue about machine learning.",
    description:
      "Weekly paper readings, a semester-long build track, and speaker nights with people working on applied AI. Beginners and researchers sit in the same room.",
    tags: ["Artificial intelligence", "Open source", "Entrepreneurship"],
    members: 240,
    meets: "Tuesdays at 7:00 PM",
    recruitment: "open",
    verified: true,
    faq: [
      { q: "Do I need experience to join?", a: "No. The build track has a beginner cohort that starts from Python basics, and paper readings come with a plain-language summary." },
      { q: "What projects do you work on?", a: "This semester's build track has four teams: a course-planning assistant, a campus shuttle predictor, a music tagging model and an open-source evaluation tool." },
      { q: "Is there a membership fee?", a: "No fee. Sign up at any meeting and you are on the list." },
    ],
  },
  {
    id: "venture-row",
    name: "Venture Row",
    tagline: "Student founders, weekly demos, honest feedback.",
    description:
      "A working group for students starting companies. Every Thursday three teams demo and everyone else tells them what is confusing.",
    tags: ["Entrepreneurship", "Finance", "Design"],
    members: 130,
    meets: "Thursdays at 6:30 PM",
    recruitment: "applications",
    verified: true,
    faq: [
      { q: "How do I apply?", a: "Applications open in the first three weeks of each semester. You need an idea you have already tested with at least five people." },
      { q: "Do I need a co-founder?", a: "No. About a third of members start solo and meet collaborators here." },
      { q: "Can graduate students join?", a: "Yes, undergraduate and graduate students are both welcome." },
    ],
  },
  {
    id: "figueroa-film",
    name: "Figueroa Film Collective",
    tagline: "Make a short every month. Screen it to a room.",
    description:
      "Crews form on the first Monday, shoot for three weeks, and screen on the last Friday. Gear is shared and no one needs a reel to join.",
    tags: ["Film", "Design", "Music"],
    members: 95,
    meets: "Mondays at 8:00 PM",
    recruitment: "open",
    verified: true,
    faq: [
      { q: "Do I need my own camera?", a: "No. The collective has three shared kits that crews book through the equipment sheet." },
      { q: "When are screenings?", a: "The last Friday of every month. Screenings are open to all students." },
      { q: "Can I join mid-semester?", a: "Yes. New crews form on the first Monday of each month." },
    ],
  },
  {
    id: "sc-climate-lab",
    name: "SC Climate Lab",
    tagline: "Campus sustainability projects with measurable results.",
    description:
      "Small teams run one project each semester, from dining hall waste audits to bike-share mapping, and publish what they measured.",
    tags: ["Climate", "Volunteering", "Public health"],
    members: 110,
    meets: "Wednesdays at 5:30 PM",
    recruitment: "open",
    verified: true,
    faq: [
      { q: "What kind of projects do you run?", a: "This semester: a dining hall food-waste audit, a shade and heat map of campus walkways, and a repair cafe." },
      { q: "How much time does it take?", a: "About three hours a week, including the Wednesday meeting." },
      { q: "Do I need a science background?", a: "No. Projects need writers, designers and organisers as much as analysts." },
    ],
  },
  {
    id: "exposition-jazz",
    name: "Exposition Jazz Ensemble",
    tagline: "Open rehearsals, monthly sets, all instruments.",
    description:
      "A student-run big band and three small combos. Rehearsals are open: bring an instrument and sit in.",
    tags: ["Music"],
    members: 60,
    meets: "Sundays at 4:00 PM",
    recruitment: "open",
    verified: true,
    faq: [
      { q: "Do I have to audition?", a: "Not for open rehearsals. The big band holds short placement auditions at the start of each semester." },
      { q: "Where do you perform?", a: "One campus set a month, plus an end-of-semester concert." },
      { q: "I play an unusual instrument. Can I join?", a: "Yes. The combos have had harp, tabla and steel pan." },
    ],
  },
  {
    id: "trojan-robotics",
    name: "Trojan Robotics Works",
    tagline: "Design, machine and compete.",
    description:
      "Three competition teams and a workshop night where anyone can learn to solder, model a part or tune a controller.",
    tags: ["Robotics", "Artificial intelligence", "Design"],
    members: 150,
    meets: "Tuesdays and Fridays at 6:00 PM",
    recruitment: "applications",
    verified: true,
    faq: [
      { q: "How do I get on a competition team?", a: "Come to two workshop nights, then apply. Teams take new members each semester." },
      { q: "Is it only for engineering majors?", a: "No. Teams also need people for outreach, budgeting and documentation." },
      { q: "What do you build?", a: "A combat robot, an autonomous rover and an underwater vehicle." },
    ],
  },
  {
    id: "cardinal-consulting",
    name: "Cardinal Consulting Group",
    tagline: "Pro bono projects for local nonprofits.",
    description:
      "Teams of five spend a semester on one client project for a Los Angeles nonprofit, with case training along the way.",
    tags: ["Consulting", "Finance", "Volunteering"],
    members: 80,
    meets: "Mondays at 6:00 PM",
    recruitment: "closed",
    verified: true,
    faq: [
      { q: "When does recruitment open?", a: "Recruitment is closed for this semester and reopens in the first two weeks of the next one." },
      { q: "Who are your clients?", a: "Los Angeles nonprofits working in education, housing and food access." },
      { q: "Do I need a business major?", a: "No. Recent teams have included students from eleven majors." },
    ],
  },
  {
    id: "open-source-sc",
    name: "Open Source SC",
    tagline: "Ship one real pull request a month.",
    description:
      "Pair up, pick an issue in a public project, and get it merged. Maintainers visit to explain how their projects work.",
    tags: ["Open source", "Artificial intelligence"],
    members: 70,
    meets: "Thursdays at 7:30 PM",
    recruitment: "open",
    verified: true,
    faq: [
      { q: "I've never contributed to open source. Is that okay?", a: "Yes. First-timers are paired with someone who has merged a pull request before." },
      { q: "Which projects do you work on?", a: "Members choose. Recent contributions went to developer tools, a mapping library and a screen reader." },
      { q: "Do you hold hack nights?", a: "Yes, the first Thursday of each month runs until midnight." },
    ],
  },
  {
    id: "figueroa-dance",
    name: "Figueroa Street Dance",
    tagline: "Hip-hop, house and popping. No audition.",
    description:
      "Open classes twice a week taught by members, and a showcase crew for those who want to perform.",
    tags: ["Dance", "Music"],
    members: 120,
    meets: "Mondays and Wednesdays at 9:00 PM",
    recruitment: "open",
    verified: true,
    faq: [
      { q: "Do I need dance experience?", a: "No. Monday classes are beginner level and Wednesday classes are open level." },
      { q: "How do I join the showcase crew?", a: "Showcase auditions are in week four. Open classes need no audition." },
      { q: "What should I wear?", a: "Clothes you can move in and clean indoor shoes." },
    ],
  },
  {
    id: "trail-runners",
    name: "Trojan Trail Runners",
    tagline: "Saturday trails, weekday track, all paces.",
    description:
      "Carpool to the Santa Monica Mountains on Saturdays and run campus loops during the week. Every run has a no-drop group.",
    tags: ["Running", "Public health"],
    members: 90,
    meets: "Saturdays at 7:00 AM",
    recruitment: "open",
    verified: true,
    faq: [
      { q: "How fast do I need to be?", a: "Any pace. Every run has a no-drop group that stays together." },
      { q: "How do I get to the trails?", a: "Members carpool from campus. Sign up for a seat in the weekly thread." },
      { q: "Do you race?", a: "Some members enter local trail races together, but it is optional." },
    ],
  },
];

const VENUES: Venue[] = [
  { id: "v-room-a", authorityId: "campus-event-spaces", name: "Demo Meeting Room A", building: "Campus Center (demo)", capacity: 120, features: ["projector", "microphone"] },
  { id: "v-hall-b", authorityId: "campus-event-spaces", name: "Demo Hall B", building: "Campus Center (demo)", capacity: 150, features: ["projector", "microphone", "stage"] },
  { id: "v-seminar-c", authorityId: "campus-event-spaces", name: "Demo Seminar Room C", building: "Student Union (demo)", capacity: 40, features: ["projector", "whiteboard"] },
  { id: "v-ballroom-d", authorityId: "campus-event-spaces", name: "Demo Ballroom D", building: "Campus Center (demo)", capacity: 400, features: ["projector", "microphone", "stage", "livestream"] },
  { id: "v-class-101", authorityId: "classroom-scheduling", name: "Demo Classroom 101", building: "Academic Hall (demo)", capacity: 60, features: ["projector", "whiteboard"] },
  { id: "v-lecture-201", authorityId: "classroom-scheduling", name: "Demo Lecture Hall 201", building: "Academic Hall (demo)", capacity: 220, features: ["projector", "microphone", "whiteboard"] },
];

const KNOWLEDGE: Omit<KnowledgeDoc, "verifiedAt">[] = [
  {
    id: "k-contact",
    scope: "USG",
    title: "How to contact a committee",
    excerpt:
      "Each committee lists a chair and a shared inbox. Send your question to the committee inbox and include your school and year; the chair or a delegate replies. Committee meetings are open to all undergraduates.",
    url: "https://example.edu/demo/usg/committees",
    owner: "USG communications (sample)",
    version: "v3",
  },
  {
    id: "k-funding",
    scope: "USG",
    title: "Funding for student organisations",
    excerpt:
      "Recognised student organisations can apply for event funding through the funding board. Applications are reviewed on a rolling basis and should be submitted at least three weeks before the event, with a budget and an expected headcount.",
    url: "https://example.edu/demo/usg/funding",
    owner: "USG funding board (sample)",
    version: "v5",
  },
  {
    id: "k-rooms",
    scope: "USG",
    title: "Who approves event space",
    excerpt:
      "Student government does not approve room reservations. Event spaces are reserved through the scheduling office that manages each venue. Student government can explain the process and pass on feedback about it.",
    url: "https://example.edu/demo/usg/event-space",
    owner: "USG campus services (sample)",
    version: "v2",
  },
  {
    id: "k-advocacy",
    scope: "USG",
    title: "Raising a concern or proposing a project",
    excerpt:
      "Any undergraduate can submit a concern or a project idea. Submissions are logged, assigned to a committee, and acknowledged. An acknowledgement confirms it was received; it is not a commitment to act.",
    url: "https://example.edu/demo/usg/advocacy",
    owner: "USG advocacy (sample)",
    version: "v4",
  },
  {
    id: "k-elections",
    scope: "USG",
    title: "Elections and how to run",
    excerpt:
      "Elections are held each spring. Candidates file a declaration, attend an information session and follow the campaign rules published by the elections commission.",
    url: "https://example.edu/demo/usg/elections",
    owner: "USG elections commission (sample)",
    version: "v1",
  },
  {
    id: "k-gsg-travel",
    scope: "GSG",
    title: "Conference travel grants for graduate students",
    excerpt:
      "Graduate students presenting at a conference can apply for a travel grant. Applications need an acceptance letter and a budget, and are reviewed once a month.",
    url: "https://example.edu/demo/gsg/travel-grants",
    owner: "GSG finance (sample)",
    version: "v2",
  },
];

// ---- Helpers ---------------------------------------------------------------

let counter = 0;
const sid = (prefix: string) => `${prefix}-seed-${++counter}`;

function event(
  clubId: string,
  title: string,
  now: Date,
  dayOffset: number,
  hour: number,
  minute: number,
  hours: number,
  location: string,
  description: string,
): CampusEvent {
  const start = laDayOffset(now, dayOffset, hour, minute);
  return {
    id: sid("e"),
    clubId,
    title,
    start: start.toISOString(),
    end: new Date(start.getTime() + hours * 3600_000).toISOString(),
    location,
    description,
  };
}

type SeedBooking = {
  clubId: string;
  createdBy: string;
  rep: string;
  title: string;
  eventType: string;
  attendance: number;
  dayOffset: number;
  hour: number;
  hours: number;
  features: Feature[];
  venueId: string;
  /** How far the seeded booking has travelled. */
  upTo: "review" | "changes" | "confirmed";
  /** Minutes ago the request was created. */
  ageMinutes: number;
  reviewReason?: string;
};

function seedBooking(now: Date, s: SeedBooking): { booking: Booking; conversation: Conversation } {
  const id = sid("b");
  const convId = sid("c");
  const corr = sid("corr");
  const venue = VENUES.find((v) => v.id === s.venueId)!;
  const start = laDayOffset(now, s.dayOffset, s.hour, 0);
  const end = new Date(start.getTime() + s.hours * 3600_000);
  const t0 = now.getTime() - s.ageMinutes * 60_000;
  const at = (plusMinutes: number) => new Date(t0 + plusMinutes * 60_000).toISOString();

  const draft: EventDraft = {
    title: s.title,
    eventType: s.eventType,
    attendance: s.attendance,
    start: start.toISOString(),
    end: end.toISOString(),
    features: s.features,
    venueCategory: "campus_event_space",
    needsHumanCheck: [],
  };

  const proposal: Proposal = {
    id: sid("p"),
    version: 1,
    basedOnProposalId: null,
    kind: "OFFER",
    venueId: venue.id,
    authorityId: venue.authorityId,
    start: draft.start!,
    end: draft.end!,
    capacity: venue.capacity,
    features: venue.features,
    conditions: ["Subject to authorized human review"],
    expiresAt: at(34),
    inventoryVersion: INVENTORY_VERSION,
    status: "accepted",
    checks: { capacity: true, features: true, timeWindow: true, venueAuthority: true, availability: true },
    differences: [],
  };

  const line = (
    minute: number,
    actor: TimelineEntry["actor"],
    actorName: string,
    action: string,
    extra: Partial<TimelineEntry> = {},
  ): TimelineEntry => ({ id: sid("t"), at: at(minute), actor, actorName, action, correlationId: corr, ...extra });

  const timeline: TimelineEntry[] = [
    line(0, "user", s.rep, "Started a request with the Club Agent", { state: "DRAFT" }),
    line(1, "club_agent", "Club Agent", "Extracted event details from the conversation", { state: "READY_FOR_SUBMISSION" }),
    line(2, "user", s.rep, "Confirmed the summary and sent the request", { state: "SUBMITTED", messageType: "BOOKING_REQUEST" }),
    line(2, "backend", "Routing service", "Routed to Campus event spaces", { state: "ROUTING", detail: "Configured authority for campus event spaces (routing_v4)" }),
    line(3, "venue_workflow", "Venue workflow", "Checked simulated inventory", { state: "AVAILABILITY_CHECK", messageType: "AVAILABILITY_RESULT", detail: INVENTORY_VERSION }),
    line(3, "venue_workflow", "Venue workflow", `Offered ${venue.name}`, { state: "NEGOTIATING", messageType: "OFFER" }),
    line(4, "user", s.rep, `Accepted ${venue.name} for review`, { state: "PROPOSAL_ACCEPTED", messageType: "ACCEPT_PROPOSAL" }),
    line(4, "backend", "Booking workflow", "Created a review packet for the venue reviewer", { state: "PENDING_HUMAN_REVIEW", messageType: "HUMAN_REVIEW_REQUIRED" }),
  ];

  let state: BookingState = "PENDING_HUMAN_REVIEW";
  const review: Booking["review"] = {
    id: sid("r"),
    bookingId: id,
    authorityId: venue.authorityId,
    status: "pending",
    createdAt: at(4),
  };
  let confirmationReference: string | null = null;

  if (s.upTo === "changes") {
    state = "CHANGES_REQUESTED";
    review.status = "changes_requested";
    review.decision = {
      decision: "REQUEST_CHANGES",
      reviewerId: "u-daniel",
      reviewerName: "Daniel Reyes",
      reason: s.reviewReason ?? "Please confirm the setup time.",
      at: at(40),
    };
    timeline.push(
      line(40, "reviewer", "Daniel Reyes", "Requested changes", { state, messageType: "REVIEW_DECISION", detail: review.decision.reason }),
    );
  }
  if (s.upTo === "confirmed") {
    state = "CONFIRMED";
    review.status = "approved";
    review.decision = {
      decision: "APPROVE",
      reviewerId: "u-daniel",
      reviewerName: "Daniel Reyes",
      reason: s.reviewReason ?? "Requirements reviewed. Room is suitable.",
      at: at(55),
    };
    confirmationReference = `DEMO-${1040 + counter}`;
    timeline.push(
      line(55, "reviewer", "Daniel Reyes", "Approved the request", { state: "APPROVED", messageType: "REVIEW_DECISION", detail: review.decision.reason }),
      line(55, "backend", "Booking workflow", "Rechecked availability and recorded the confirmation", { state: "CONFIRMED", messageType: "BOOKING_STATUS", detail: confirmationReference }),
    );
  }

  const booking: Booking = {
    id,
    clubId: s.clubId,
    createdBy: s.createdBy,
    state,
    event: draft,
    authorityId: venue.authorityId,
    routingReason: "Configured authority for campus event spaces",
    proposals: [proposal],
    acceptedProposalId: proposal.id,
    rounds: 1,
    offeredVenueIds: [venue.id],
    review,
    confirmationReference,
    timeline,
    conversationId: convId,
    correlationId: corr,
    createdAt: at(0),
    updatedAt: timeline[timeline.length - 1].at,
  };

  const conversation: Conversation = {
    id: convId,
    kind: "booking",
    ownerId: s.createdBy,
    title: s.title,
    agentName: "Club Agent",
    clubId: s.clubId,
    bookingId: id,
    activity: null,
    awaiting: null,
    updatedAt: booking.updatedAt,
    messages: [
      { id: sid("m"), at: at(0), sender: "user", text: `We need a room for ${s.attendance} people for ${s.title}.` },
      { id: sid("m"), at: at(1), sender: "agent", name: "Club Agent", text: "Here is what I have. Check it, then send it to the venue team.", card: { type: "summary", bookingId: id } },
      { id: sid("m"), at: at(3), sender: "agent", name: "Venue workflow", text: `${venue.name} fits every requirement.`, card: { type: "proposal", bookingId: id, proposalId: proposal.id } },
      { id: sid("m"), at: at(4), sender: "system", text: "Accepted for review. Not confirmed until a person approves." },
      { id: sid("m"), at: booking.updatedAt, sender: "system", text: "Current status", card: { type: "status", bookingId: id } },
    ],
  };

  return { booking, conversation };
}

export function seed(now = new Date()): Db {
  counter = 0;
  const events: CampusEvent[] = [
    event("trojan-ai", "Paper reading: small models that plan", now, 2, 19, 0, 1.5, "Demo Seminar Room C", "A plain-language walk through one recent paper, then open discussion."),
    event("figueroa-film", "Monthly shorts screening", now, 4, 19, 30, 2, "Demo Hall B", "Six shorts made this month, with a Q&A after each."),
    event("venture-row", "Demo night", now, 5, 18, 30, 2, "Demo Meeting Room A", "Three student teams demo. Everyone else says what confused them."),
    event("sc-climate-lab", "Repair cafe", now, 6, 12, 0, 3, "Student Union (demo) patio", "Bring something broken. Volunteers help you fix it."),
    event("exposition-jazz", "Sunday open rehearsal", now, 1, 16, 0, 2, "Demo Ballroom D", "Bring an instrument and sit in with the big band."),
    event("open-source-sc", "First-pull-request night", now, 8, 19, 30, 3, "Demo Classroom 101", "Pair up, pick a beginner issue, and open your first pull request."),
    event("figueroa-dance", "Beginner house class", now, 3, 21, 0, 1.5, "Demo Hall B", "No experience needed. Wear indoor shoes."),
    event("trail-runners", "Saturday trail run", now, 7, 7, 0, 3, "Carpool from the campus gate", "Six easy miles with a no-drop group."),
  ];

  const seeded = [
    seedBooking(now, { clubId: "trojan-ai", createdBy: "u-maya", rep: "Maya Okafor", title: "Intro to LLMs workshop", eventType: "workshop", attendance: 35, dayOffset: 3, hour: 18, hours: 2, features: ["projector", "whiteboard"], venueId: "v-seminar-c", upTo: "confirmed", ageMinutes: 60 * 26 }),
    seedBooking(now, { clubId: "trojan-ai", createdBy: "u-maya", rep: "Maya Okafor", title: "Research showcase", eventType: "showcase", attendance: 140, dayOffset: 12, hour: 17, hours: 3, features: ["projector", "microphone", "stage"], venueId: "v-hall-b", upTo: "review", ageMinutes: 95 }),
    seedBooking(now, { clubId: "figueroa-film", createdBy: "u-other-1", rep: "Lena Park", title: "Spring film screening", eventType: "screening", attendance: 300, dayOffset: 16, hour: 19, hours: 3, features: ["projector", "microphone"], venueId: "v-ballroom-d", upTo: "review", ageMinutes: 38 }),
    seedBooking(now, { clubId: "sc-climate-lab", createdBy: "u-other-2", rep: "Omar Haddad", title: "Sustainability panel", eventType: "panel", attendance: 90, dayOffset: 9, hour: 16, hours: 2, features: ["projector", "microphone"], venueId: "v-room-a", upTo: "changes", ageMinutes: 60 * 5, reviewReason: "The panel needs four table microphones. Please confirm the count so we can check stock." }),
  ];

  const verifiedAt = laDayOffset(now, -12, 10).toISOString();

  return {
    version: DB_VERSION,
    seededAt: now.toISOString(),
    users: USERS,
    clubs: CLUBS,
    events,
    authorities: [
      { id: "campus-event-spaces", name: "Campus event spaces", integrationMode: "simulated" },
      { id: "classroom-scheduling", name: "Classroom scheduling", integrationMode: "simulated" },
    ],
    venues: VENUES,
    bookings: seeded.map((s) => s.booking),
    conversations: seeded.map((s) => s.conversation),
    interests: [
      { id: sid("i"), clubId: "trojan-ai", studentId: "u-other-3", studentName: "Sam Rivera", type: "membership", message: "I'd like to join the beginner build cohort.", sharedContact: true, at: laDayOffset(now, -1, 14).toISOString() },
      { id: sid("i"), clubId: "trojan-ai", studentId: "u-other-4", studentName: "A student", type: "question", message: "Do you record the paper readings?", sharedContact: false, at: laDayOffset(now, -2, 11).toISOString() },
    ],
    prefs: {
      "u-priya": {
        interests: ["Artificial intelligence", "Entrepreneurship", "Music"],
        goals: "Meet people building things and find a project to join.",
        personalization: true,
        savedClubIds: ["open-source-sc"],
      },
    },
    knowledge: KNOWLEDGE.map((k) => ({ ...k, verifiedAt })),
    feedback: [
      { id: sid("f"), scope: "USG", category: "Campus services", message: "Room booking rules are hard to find. A single page listing who manages which building would help.", sharedIdentity: false, fromName: null, status: "new", at: laDayOffset(now, -1, 16).toISOString() },
      { id: sid("f"), scope: "USG", category: "Funding", message: "Funding decisions arrive after our event date. Could the board publish its review calendar?", sharedIdentity: true, fromName: "Lena Park", status: "acknowledged", at: laDayOffset(now, -4, 9).toISOString() },
    ],
    announcements: [
      { id: sid("a"), scope: "USG", title: "Funding board review dates posted", body: "The funding board now publishes its review dates at the start of each month.", at: laDayOffset(now, -3, 12).toISOString(), author: "Jordan Lee" },
    ],
    govQuestions: [
      ...Array.from({ length: 9 }, (_, i) => ({ id: sid("q"), scope: "USG" as const, text: "How do we get funding for an event?", docId: "k-funding", at: laDayOffset(now, -i - 1, 13).toISOString() })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: sid("q"), scope: "USG" as const, text: "Who approves room bookings?", docId: "k-rooms", at: laDayOffset(now, -i - 1, 15).toISOString() })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: sid("q"), scope: "USG" as const, text: "How do I contact a committee?", docId: "k-contact", at: laDayOffset(now, -i - 2, 10).toISOString() })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: sid("q"), scope: "USG" as const, text: "Can USG extend library hours?", docId: null, at: laDayOffset(now, -i - 2, 20).toISOString() })),
    ],
    notifications: [
      { id: sid("n"), userId: "u-daniel", text: "Spring film screening is waiting for review", href: "/venue-review", at: seeded[2].booking.updatedAt, read: false },
      { id: sid("n"), userId: "u-maya", text: "Intro to LLMs workshop was confirmed", href: `/bookings/${seeded[0].booking.id}`, at: seeded[0].booking.updatedAt, read: true },
    ],
  };
}

export const EMPTY_DB: Db = {
  version: DB_VERSION,
  seededAt: "",
  users: USERS,
  clubs: [],
  events: [],
  authorities: [],
  venues: [],
  bookings: [],
  conversations: [],
  interests: [],
  prefs: {},
  knowledge: [],
  feedback: [],
  announcements: [],
  govQuestions: [],
  notifications: [],
};
