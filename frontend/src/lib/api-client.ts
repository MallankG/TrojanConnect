// Thin client for the FastAPI backend. Base URL is configurable for deploys.
import type { BookingKind, PipelineState, StepId } from "./pipeline/plan";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Backend errors use the standard envelope `{ok: false, error: {code, message, retryable}}` (PRD §9.1); `detail` is still accepted. */
export class ApiError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) { super(message); }
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    // Custom header forces a CORS preflight; the backend rejects requests without it (CSRF guard).
    headers: { "content-type": "application/json", "X-TrojanConnect-Client": "web", ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body?.error?.message) throw new ApiError(body.error.message, body.error.code, res.status);
    const d = body?.detail;
    if (d && typeof d === "object" && !Array.isArray(d)) throw new ApiError(d.message ?? res.statusText, d.code, res.status);
    if (Array.isArray(d)) throw new ApiError(d.map((x: { msg?: string }) => x.msg).join("; "), "VALIDATION", res.status);
    throw new ApiError(d ?? res.statusText, undefined, res.status);
  }
  return body as T;
}

const key = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export type AgentAction =
  | { type: "form"; formId: string; step: StepId | null }
  | { type: "booking"; kind: BookingKind }
  | { type: "reset" }
  | { type: "field"; key: string }
  | { type: "options"; title: string; options: { label: string; detail: string; message: string }[] }
  | { type: "fields"; title: string; keys: string[]; then: string; scope?: "event" | "rso" }
  | { type: "rso_checklist"; section: "steps" | "officers" | "advisor" | "step"; step?: string }
  | { type: "handoff"; title: string; url: string; label: string; steps: string[] }
  | { type: "rso_email"; target: string }
  | { type: "rso_status" }
  | { type: "rso_portal" }
  | { type: "suggestions"; items: { label: string; message: string }[] };
export interface AgentInfo { configured: boolean; mode?: "gemini" | "rules"; model: string }
export interface AgentReply { reply: string; actions: AgentAction[]; tools: { tool: string; ok: boolean; error: string | null }[]; state: PipelineState; model: string }

// ---- Booking workflow (PRD §6–§9) ----------------------------------------------------------
export type BookingState =
  | "DRAFT" | "NEEDS_INFORMATION" | "READY_FOR_SUBMISSION" | "SUBMITTED" | "ROUTING" | "AVAILABILITY_CHECK" | "NEGOTIATING"
  | "PROPOSAL_ACCEPTED" | "PENDING_HUMAN_REVIEW" | "APPROVED" | "CONFIRMED" | "CHANGES_REQUESTED" | "REJECTED"
  | "CANCEL_REQUESTED" | "CANCELLED" | "EXPIRED" | "FAILED_REQUIRES_HUMAN";

export interface Window { start: string; end: string; timezone: string }
export interface Proposal {
  proposal_id: string; proposal_version: number; venue_id: string; venue_name: string; venue_authority_id: string;
  time: Window; hold: Window | null; capacity: number; included_features: string[]; conditions: string[];
  expires_at: string; source_availability_version: string; shift: number;
  status: "offered" | "active" | "superseded" | "declined" | "declined_by_club_agent" | "accepted" | "expired" | "stale" | "withdrawn";
  differences: string[];
}
export interface AgentMessageView { id: string; type: string; from: string; from_type: "club" | "venue" | "review_queue" | "workflow"; to: string; note: string; at: string; proposal_id?: string }
export interface AuditEntry { at: string; actor: string; role: string; action: string; reason: string; from_state: string | null; to_state: string | null; correlation_id: string }
export interface ReviewDecision { decision: string; reason: string; reviewer_id: string; reviewer_name: string; at: string }
export interface Booking {
  id: string; kind: BookingKind; kind_label: string; state: BookingState; state_label: string;
  stage: number | null; stages: string[]; version: number; created_at: string; updated_at: string;
  authority: { id: string; name: string; integration_mode: string } | null;
  summary: string[]; summary_hash: string;
  missing_fields: { key: string; label: string; problem: string }[]; blockers: string[];
  warnings: { code: string; message: string; source: string }[];
  availability: { inventory_version: string; checked_at: string; source: string; feasible_options: number } | null;
  simulated: boolean; source_label: string; rounds: number; max_rounds: number;
  proposals: Proposal[]; active_proposal: Proposal | null; accepted_proposal: Proposal | null;
  messages: AgentMessageView[];
  review: { task_id: string; authority_id: string; status: string; created_at: string; decisions: ReviewDecision[];
    packet?: { summary: string[]; attention: string[]; differences?: string[]; checks?: Record<string, boolean>; negotiation_summary?: string;
      availability_source?: Booking["availability"]; not_auto_answered?: string; event: Record<string, unknown>; requester: Record<string, unknown> } } | null;
  confirmation: { reference: string; confirmed_at: string; contact_name: string; contact_email: string } | null;
  escalation: { code: string; reason: string; details: { message?: string }[] } | null;
  timeline: AuditEntry[]; next_action: string;
  can: { prepare: boolean; submit: boolean; accept: boolean; alternatives: boolean; cancel: boolean };
}
export interface Reviewer { id: string; name: string; role: string; authorities: string[] }

const reviewerHeaders = (reviewer: string) => ({ "X-TrojanConnect-Reviewer": reviewer });

export const bookingApi = {
  list: (kind?: BookingKind) => call<Booking[]>(`/api/v1/bookings${kind ? `?kind=${kind}` : ""}`),
  prepare: (kind: BookingKind) => call<Booking>("/api/v1/bookings/drafts", { method: "POST", json: { kind } }),
  submit: (b: Booking) => call<Booking>(`/api/v1/bookings/${b.id}/submit`, { method: "POST", json: { summary_hash: b.summary_hash, user_confirmed_summary: true, idempotency_key: key() } }),
  accept: (b: Booking, p: Proposal) =>
    call<Booking>(`/api/v1/bookings/${b.id}/proposals/${p.proposal_id}/accept`, { method: "POST", json: { proposal_version: p.proposal_version, user_confirmed: true, idempotency_key: key() } }),
  alternatives: (b: Booking, reason = "") => call<Booking>(`/api/v1/bookings/${b.id}/alternatives`, { method: "POST", json: { reason, idempotency_key: key() } }),
  cancel: (b: Booking, reason = "") => call<Booking>(`/api/v1/bookings/${b.id}/cancel`, { method: "POST", json: { reason, idempotency_key: key() } }),
  reviewers: () => call<Reviewer[]>("/api/v1/venue-review/reviewers"),
  queue: (reviewer: string) => call<Booking[]>("/api/v1/venue-review/queue", { headers: reviewerHeaders(reviewer) }),
  decide: (reviewer: string, taskId: string, decision: "APPROVE" | "REJECT" | "REQUEST_CHANGES" | "CONFIRM_CANCELLATION", reason: string, reference?: string) =>
    call<Booking>(`/api/v1/reviews/${taskId}/decision`, {
      method: "POST", headers: reviewerHeaders(reviewer),
      json: { decision, reason, external_confirmation_reference: reference || null, idempotency_key: key() },
    }),
  confirm: (reviewer: string, taskId: string, reference: string) =>
    call<Booking>(`/api/v1/reviews/${taskId}/confirm`, { method: "POST", headers: reviewerHeaders(reviewer), json: { external_confirmation_reference: reference, idempotency_key: key() } }),
};

export const pipelineApi = {
  state: () => call<PipelineState>("/api/v1/pipeline/state"),
  updateProfile: (patch: Record<string, unknown>) => call<PipelineState>("/api/v1/pipeline/profile", { method: "PUT", json: patch }),
  setCheck: (step: StepId, check: string, value: boolean) => call<PipelineState>("/api/v1/pipeline/progress", { method: "PUT", json: { step, check, value } }),
  setData: (step: StepId, dataKey: string, dataValue: string) => call<PipelineState>("/api/v1/pipeline/progress", { method: "PUT", json: { step, dataKey, dataValue } }),
  reset: () => call<PipelineState>("/api/v1/pipeline/reset", { method: "POST" }),
  agentInfo: () => call<AgentInfo>("/api/v1/pipeline/agent"),
  agentChat: (message: string, history: { role: "user" | "assistant"; text: string }[]) =>
    call<AgentReply>("/api/v1/pipeline/agent/chat", { method: "POST", json: { message, history } }),
};

// ---- RSO recognition (/api/v1/rso) -----------------------------------------------------------
/** kind: usc_form = a real USC form that sends answers to Campus Activities; usc_login = a real USC site (login); info = public page. */
export interface RsoLink { key: string; label: string; url: string; kind?: "usc_form" | "usc_login" | "info" }
export interface RsoStep { id: string; title: string; detail: string; where: "engage" | "usc" | "trojanconnect"; links: RsoLink[]; done: boolean; handoff?: boolean }
export interface RsoFieldDef { key: string; label: string; type: "text" | "textarea" | "email" | "number" | "select" | "bool"; group: string; options?: string[]; option_labels?: Record<string, string>; optional?: boolean }
export type RsoStatus = "not_started" | "in_progress" | "pending_approval" | "requires_modifications" | "denied" | "recognized";
export interface RsoState {
  cycle: string; source: RsoLink & { checked: string };
  pathway: string | null; pathway_label: string | null; pathway_detail: string | null; listed_officer: boolean | null;
  status: RsoStatus; status_label: string; status_note: string;
  fields: Record<string, unknown>; steps: RsoStep[]; steps_done: number; steps_total: number; next_step: RsoStep | null;
  ready_to_submit: boolean; submit_blockers: string[]; application_closed: boolean;
  dates: { id: string; label: string; text: string; at: string; days_left: number }[];
  officers: { role: string; label: string; name: string; email: string; accepted: boolean; docs: (RsoLink & { id: string; label: string; done: boolean })[] }[];
  advisor: { name: string; email: string; full_time: boolean | null; items: (Partial<RsoLink> & { id: string; label: string; done: boolean })[] };
  roster_gaps: string[]; members: number; min_members: number;
  handoff: { title: string; url: string; label: string; steps: string[] } | null;
  log: { at: string; actor: string; msg: string }[];
}
export interface RsoSchema {
  cycle: string; fields: RsoFieldDef[]; field_groups: string[];
  pathways: { id: string; label: string; detail: string; flow: string | null }[];
  contact: { office: string; email: string; phone: string; location: string; hours: string };
  sessions: { kind: string; when: string }[]; denial_reasons: string[]; open_membership_rules: string[]; discrepancies: string[];
  links: RsoLink[];
}
export interface RsoPortal {
  enabled: boolean; mode: "simulated" | "live" | null; base_url: string; admin_url: string;
  running: boolean; kind: "submit" | "sync" | "check" | null; error: string | null; lines: string[];
  application: { application_id?: string; portal_status?: string; note?: string; submitted_at?: string; last_checked?: string;
    directory_check?: { found: boolean; matches: string[]; name: string; at: string } } | null;
}
export interface RsoEmail { target: string; to: string; subject: string; body: string; mailto: string; ready: boolean }

export const rsoApi = {
  schema: () => call<RsoSchema>("/api/v1/rso/schema"),
  state: () => call<RsoState>("/api/v1/rso/state"),
  setFields: (patch: Record<string, unknown>) => call<{ saved: Record<string, unknown>; rejected: Record<string, string>; state: RsoState }>("/api/v1/rso/fields", { method: "PUT", json: patch }),
  setPathway: (pathway: string, listed_officer?: boolean) => call<RsoState>("/api/v1/rso/pathway", { method: "PUT", json: { pathway, listed_officer } }),
  setCheck: (key: string, done: boolean) => call<RsoState>("/api/v1/rso/checks", { method: "PUT", json: { key, done } }),
  recordStatus: (status: Exclude<RsoStatus, "not_started" | "in_progress">, note = "") => call<RsoState>("/api/v1/rso/status", { method: "PUT", json: { status, note } }),
  email: (target: string) => call<RsoEmail>(`/api/v1/rso/emails/${target}`),
  reset: () => call<RsoState>("/api/v1/rso/reset", { method: "POST" }),
  portal: () => call<RsoPortal>("/api/v1/rso/portal"),
  portalSubmit: () => call<RsoPortal>("/api/v1/rso/portal/submit", { method: "POST" }),
  portalSync: () => call<RsoPortal>("/api/v1/rso/portal/sync", { method: "POST" }),
  portalCheckDirectory: () => call<RsoPortal>("/api/v1/rso/portal/check-directory", { method: "POST" }),
};
