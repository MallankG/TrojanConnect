/**
 * Frontend mirror of the PRD data contracts (sections 6, 7, 9 and 13).
 * The backend's Pydantic models are the source of truth; when they exist,
 * these types should be regenerated from them rather than edited by hand.
 */

export type Role = "club_rep" | "venue_reviewer" | "student" | "gov_rep";

export type DemoUser = {
  id: string;
  name: string;
  role: Role;
  /** What the role acts for: a club, a venue authority, a government body. */
  scopeId: string | null;
  scopeName: string | null;
};

// ---- Booking (PRD 7.1) -----------------------------------------------------

export type BookingState =
  | "DRAFT"
  | "NEEDS_INFORMATION"
  | "READY_FOR_SUBMISSION"
  | "SUBMITTED"
  | "ROUTING"
  | "AVAILABILITY_CHECK"
  | "NEGOTIATING"
  | "PROPOSAL_ACCEPTED"
  | "PENDING_HUMAN_REVIEW"
  | "APPROVED"
  | "CONFIRMED"
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED_REQUIRES_HUMAN";

/** Who is allowed to cause a transition (PRD 7.2). */
export type Actor = "club_rep" | "club_agent" | "backend" | "venue_adapter" | "reviewer";

export type Feature = "projector" | "microphone" | "whiteboard" | "stage" | "livestream";

export type EventDraft = {
  title: string | null;
  eventType: string | null;
  attendance: number | null;
  /** ISO instants. The event's timezone is always America/Los_Angeles in this demo. */
  start: string | null;
  end: string | null;
  features: Feature[];
  venueCategory: "campus_event_space" | "classroom";
  /** Things the rules engine cannot judge (alcohol, catering, security…). */
  needsHumanCheck: string[];
};

export type VenueAuthority = {
  id: string;
  name: string;
  /** Always "simulated" in this build; shown in the UI wherever data comes from it. */
  integrationMode: "simulated" | "live";
};

export type Venue = {
  id: string;
  authorityId: string;
  name: string;
  building: string;
  capacity: number;
  features: Feature[];
};

export type ValidationChecks = {
  capacity: boolean;
  features: boolean;
  timeWindow: boolean;
  venueAuthority: boolean;
  availability: boolean;
};

export type ProposalStatus = "active" | "superseded" | "accepted" | "declined" | "expired";

export type Proposal = {
  id: string;
  version: number;
  basedOnProposalId: string | null;
  kind: "OFFER" | "COUNTEROFFER";
  venueId: string;
  authorityId: string;
  start: string;
  end: string;
  capacity: number;
  features: Feature[];
  conditions: string[];
  expiresAt: string;
  inventoryVersion: string;
  status: ProposalStatus;
  checks: ValidationChecks;
  /** Exact differences from what the club asked for. Empty when it matches. */
  differences: string[];
};

export type TimelineActor = "user" | "club_agent" | "venue_workflow" | "backend" | "reviewer";

export type TimelineEntry = {
  id: string;
  at: string;
  actor: TimelineActor;
  actorName: string;
  action: string;
  detail?: string;
  /** State after this entry, when it changed. */
  state?: BookingState;
  /** Agent-to-agent message type (PRD 6.3), when this entry was one. */
  messageType?: string;
  correlationId: string;
};

export type ReviewDecision = "APPROVE" | "REJECT" | "REQUEST_CHANGES";

export type ReviewTask = {
  id: string;
  bookingId: string;
  authorityId: string;
  status: "pending" | "approved" | "rejected" | "changes_requested";
  createdAt: string;
  decision?: {
    decision: ReviewDecision;
    reviewerId: string;
    reviewerName: string;
    reason: string;
    at: string;
  };
};

export type Booking = {
  id: string;
  clubId: string;
  createdBy: string;
  state: BookingState;
  event: EventDraft;
  authorityId: string | null;
  routingReason: string | null;
  proposals: Proposal[];
  acceptedProposalId: string | null;
  /** Offer/counteroffer rounds used so far. Capped at 5 (PRD 6.6). */
  rounds: number;
  /** Venues already offered, so alternatives never repeat one. */
  offeredVenueIds: string[];
  review: ReviewTask | null;
  confirmationReference: string | null;
  timeline: TimelineEntry[];
  conversationId: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
};

// ---- Clubs, events, discovery ---------------------------------------------

export type Club = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  tags: string[];
  members: number;
  meets: string;
  recruitment: "open" | "applications" | "closed";
  verified: boolean;
  faq: { q: string; a: string }[];
};

export type CampusEvent = {
  id: string;
  clubId: string;
  title: string;
  start: string;
  end: string;
  location: string;
  description: string;
};

export type Interest = {
  id: string;
  clubId: string;
  studentId: string;
  studentName: string;
  type: "membership" | "event" | "question";
  message: string;
  sharedContact: boolean;
  at: string;
};

export type StudentPrefs = {
  interests: string[];
  goals: string;
  personalization: boolean;
  savedClubIds: string[];
  /** Asked to be told when alumni mentorship opens. */
  alumniInterest?: boolean;
  /** Opted in to booking updates on WhatsApp (PRD 8.5: explicit opt-in). */
  whatsappOptIn?: boolean;
};

export type Recommendation = {
  club: Club;
  score: number;
  /** Interest tags that matched; the UI turns these into the explanation. */
  matched: string[];
};

// ---- Government -----------------------------------------------------------

export type GovScope = "USG" | "GSG";

export type KnowledgeDoc = {
  id: string;
  scope: GovScope;
  title: string;
  excerpt: string;
  url: string;
  owner: string;
  verifiedAt: string;
  version: string;
};

export type Feedback = {
  id: string;
  scope: GovScope;
  category: string;
  message: string;
  sharedIdentity: boolean;
  fromName: string | null;
  status: "new" | "acknowledged";
  at: string;
};

/** One question asked of the government assistant, for the "common questions" view. */
export type GovQuestion = {
  id: string;
  scope: GovScope;
  text: string;
  /** The source that answered it, or null when nothing approved matched. */
  docId: string | null;
  at: string;
};

export type Announcement = {
  id: string;
  scope: GovScope;
  title: string;
  body: string;
  at: string;
  author: string;
};

// ---- Conversations --------------------------------------------------------

export type Source = { title: string; url: string; verifiedAt: string };

export type MessageCard =
  | { type: "summary"; bookingId: string }
  | { type: "proposal"; bookingId: string; proposalId: string }
  | { type: "status"; bookingId: string }
  | { type: "clubs"; clubIds: string[]; reasons: Record<string, string[]> }
  | { type: "feedback_offer"; scope: GovScope; message: string; category: string }
  | { type: "feedback_sent"; feedbackId: string };

export type ChatMessage = {
  id: string;
  at: string;
  sender: "user" | "agent" | "system" | "reviewer";
  /** Display name of the agent or person. */
  name?: string;
  text: string;
  card?: MessageCard;
  sources?: Source[];
  /** A sourced answer could not be found; the UI marks it. */
  unverified?: boolean;
  failed?: boolean;
};

export type ConversationKind = "booking" | "club" | "student" | "government";

export type Conversation = {
  id: string;
  kind: ConversationKind;
  ownerId: string;
  title: string;
  agentName: string;
  clubId: string | null;
  bookingId: string | null;
  /** Tool activity line shown while the agent works, e.g. "Checking venue inventory". */
  activity: string | null;
  /** Booking chats only: the field the agent last asked for. */
  awaiting: "title" | "attendance" | "time" | null;
  messages: ChatMessage[];
  updatedAt: string;
};

// ---- Notifications --------------------------------------------------------

export type Notification = {
  id: string;
  userId: string;
  text: string;
  href: string;
  at: string;
  read: boolean;
};

// ---- The whole mock database ----------------------------------------------

export type Db = {
  version: number;
  seededAt: string;
  users: DemoUser[];
  clubs: Club[];
  events: CampusEvent[];
  authorities: VenueAuthority[];
  venues: Venue[];
  bookings: Booking[];
  conversations: Conversation[];
  interests: Interest[];
  prefs: Record<string, StudentPrefs>;
  knowledge: KnowledgeDoc[];
  feedback: Feedback[];
  announcements: Announcement[];
  govQuestions: GovQuestion[];
  notifications: Notification[];
};

/** Typed tool/API result (PRD 9.1). */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };
