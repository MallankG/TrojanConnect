// Client component: rendered from StepDetail and AssistantPanel ("use client" parents).
// A venue booking or event permit handled by the booking agent workflow. The club rep confirms the
// summary, the Club Agent and Venue Scheduling Agent negotiate, the rep accepts one proposal, and a
// human reviewer decides. Only the backend marks a request confirmed. Nothing goes to a USC portal.
import { useCallback, useEffect, useState } from "react";
import { bookingApi, type AgentMessageView, type Booking, type BookingState, type Proposal } from "@/lib/api-client";
import { FIELD_BY_KEY, type Profile } from "@/lib/pipeline/fields";
import { FORMS, missingFor, type BookingKind } from "@/lib/pipeline/plan";
import { Pill, btn, btnPrimary, type Tone } from "./ui";

const TONE: Partial<Record<BookingState, Tone>> = {
  CONFIRMED: "done", APPROVED: "waiting", PENDING_HUMAN_REVIEW: "waiting", CANCEL_REQUESTED: "waiting",
  NEGOTIATING: "ready", READY_FOR_SUBMISSION: "ready",
  FAILED_REQUIRES_HUMAN: "late", REJECTED: "late", CHANGES_REQUESTED: "late", NEEDS_INFORMATION: "late",
};
const WAITING_ON_HUMAN: BookingState[] = ["PENDING_HUMAN_REVIEW", "APPROVED", "CANCEL_REQUESTED"];
const SENDER: Record<AgentMessageView["from_type"], string> = { club: "Club Agent", venue: "Venue Agent", review_queue: "Reviewer", workflow: "Workflow" };

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
const fmtStamp = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

interface Props {
  kind: BookingKind;
  formId: string;
  profile: Profile;
  blocked?: boolean;
  onJumpToField: (key: string) => void;
  /** The workflow updates the venue / permit step; the parent reloads the pipeline. */
  onPipelineChange: () => void;
  /** Called after a successful button action (the Assistant uses it to narrate what happened next). */
  onAfterAction?: (action: string) => void;
}

export function BookingCard({ kind, formId, profile, blocked, onJumpToField, onPipelineChange, onAfterAction }: Props) {
  const f = FORMS[formId];
  const [b, setB] = useState<Booking | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setB((await bookingApi.list(kind))[0] ?? null); } catch (e) { setError((e as Error).message); }
  }, [kind]);
  useEffect(() => {
    let alive = true;
    bookingApi.list(kind).then(rs => { if (alive) setB(rs[0] ?? null); }, e => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [kind]);

  // A reviewer decides elsewhere (/venue-review): poll while the request waits on a human.
  const state = b?.state;
  useEffect(() => {
    if (!state || !WAITING_ON_HUMAN.includes(state)) return;
    const t = setInterval(async () => {
      const next = (await bookingApi.list(kind).catch(() => []))[0];
      if (next && next.state !== state) { setB(next); onPipelineChange(); }
    }, 8000);
    return () => clearInterval(t);
  }, [state, kind, onPipelineChange]);

  const act = async (label: string, fn: () => Promise<Booking>) => {
    setBusy(label); setError(null);
    try { setB(await fn()); onPipelineChange(); onAfterAction?.(label); }
    catch (e) { setError((e as Error).message); await load(); }
    finally { setBusy(null); }
  };

  const localMissing = missingFor(formId, profile);
  const missing = b?.state === "NEEDS_INFORMATION" ? b.missing_fields : localMissing.map(m => ({ key: m.key, label: FIELD_BY_KEY[m.key]?.label.split(" (")[0] ?? m.key, problem: m.problem }));
  const showPrepare = !b || b.can.prepare;

  return (
    <div className="mb-2.5 rounded-xl border border-line p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{f?.name ?? "Booking request"}</strong>
        <div className="flex flex-wrap gap-1.5">
          <Pill tone="plain">{kind === "venue_booking" ? "venue agent" : "permit review"}</Pill>
          {kind === "venue_booking" && <Pill tone="waiting">Simulated availability</Pill>}
        </div>
      </div>
      {f?.rules.length > 0 && <ul className="mt-2 list-disc pl-[18px] text-[13px] text-muted">{f.rules.map(r => <li key={r}>{r}</li>)}</ul>}

      {b === undefined && <p className="mt-2.5 text-[13px] text-muted">Loading request…</p>}
      {b && <Stages b={b} />}
      {b && (
        <div className="mt-2.5 flex flex-wrap items-start gap-2 text-[13px]">
          <Pill tone={TONE[b.state] ?? "plain"}>{b.state_label}</Pill>
          <span className="min-w-0 flex-1">{b.next_action}</span>
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-late-bg px-3 py-2 text-[13px] text-late">{error}</p>}

      {/* Drafting: what's missing, then the summary the rep confirms. */}
      {showPrepare && b?.state !== "READY_FOR_SUBMISSION" && (
        <>
          {missing.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5 text-[13px]">
              Needs:
              {missing.map(m => (
                <button key={m.key} type="button" title={m.problem} onClick={() => onJumpToField(m.key)} className="rounded-md bg-late-bg px-2 py-0.5 text-late">{m.label}</button>
              ))}
            </div>
          )}
          {b?.blockers.map(x => <p key={x} className="mt-2 text-[13px] text-late">{x}</p>)}
          <div className="mt-2.5">
            <button type="button" className={btnPrimary} disabled={!!busy || (blocked && !b)} onClick={() => act("prepare", () => bookingApi.prepare(kind))}>
              {busy === "prepare" ? "Preparing…" : b && b.state !== "DRAFT" && !["CANCELLED", "REJECTED", "FAILED_REQUIRES_HUMAN", "EXPIRED"].includes(b.state) ? "Prepare again from profile" : "Prepare request"}
            </button>
          </div>
        </>
      )}

      {b?.state === "READY_FOR_SUBMISSION" && (
        <div className="mt-2.5 rounded-lg bg-paper p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Check this before sending</p>
          <ul className="m-0 list-none p-0 text-[13px]">{b.summary.map(l => <li key={l} className="py-0.5">{l}</li>)}</ul>
          {b.warnings.map(w => <p key={w.message} className="mt-2 text-[13px] text-late">⚠ {w.message} <span className="text-muted">({w.source}; a human will need to step in)</span></p>)}
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={!!busy} onClick={() => act("submit", () => bookingApi.submit(b))}>
              {busy === "submit" ? "Sending…" : kind === "venue_booking" ? "Confirm & send to venue agent" : "Confirm & send to permits reviewer"}
            </button>
            <button type="button" className={btn} disabled={!!busy} onClick={() => act("prepare", () => bookingApi.prepare(kind))}>Refresh from profile</button>
          </div>
          <p className="mt-2 text-xs text-muted">Nothing is sent to USC. The request goes to the TrojanConnect venue workflow, where a human reviewer decides.</p>
        </div>
      )}

      {b?.active_proposal && (
        <ProposalBox p={b.active_proposal} title="Proposal from the venue agent" note={`Not a booking yet. Offer expires ${fmtStamp(b.active_proposal.expires_at)}.`}>
          <button type="button" className={btnPrimary} disabled={!!busy} onClick={() => act("accept", () => bookingApi.accept(b, b.active_proposal!))}>
            {busy === "accept" ? "Sending for review…" : "Accept & send for review"}
          </button>
          <button type="button" className={btn} disabled={!!busy || !b.can.alternatives} onClick={() => act("alt", () => bookingApi.alternatives(b))}
            title={b.can.alternatives ? undefined : `Round limit (${b.max_rounds}) reached`}>
            {busy === "alt" ? "Asking…" : "Ask for another option"}
          </button>
          <span className="self-center text-xs text-muted">Round {b.rounds} of {b.max_rounds}</span>
        </ProposalBox>
      )}
      {b?.state === "NEGOTIATING" && !b.active_proposal && (
        <p className="mt-2 text-[13px] text-late">The proposal expired or is no longer valid. Ask for another option to get a fresh one.</p>
      )}
      {b?.state === "NEGOTIATING" && !b.active_proposal && b.can.alternatives && (
        <button type="button" className={`${btn} mt-2`} disabled={!!busy} onClick={() => act("alt", () => bookingApi.alternatives(b))}>Ask for another option</button>
      )}
      {b?.accepted_proposal && ["PENDING_HUMAN_REVIEW", "APPROVED", "CONFIRMED", "CANCEL_REQUESTED", "CHANGES_REQUESTED", "REJECTED"].includes(b.state) && (
        <ProposalBox p={b.accepted_proposal} title={b.state === "CONFIRMED" ? "Confirmed booking" : "Accepted proposal"}
          note={b.state === "CONFIRMED" ? `Reservation #${b.confirmation?.reference} · contact: ${b.confirmation?.contact_name}` : b.state === "APPROVED" ? "Approved, not yet confirmed." : "Pending human review: not confirmed."} />
      )}
      {kind === "event_permit" && b?.state === "CONFIRMED" && (
        <p className="mt-2.5 text-[13px] text-ok">✓ Permit code {b.confirmation?.reference} (issued by {b.confirmation?.contact_name})</p>
      )}
      {b?.escalation && b.state === "FAILED_REQUIRES_HUMAN" && b.escalation.details.length > 0 && (
        <ul className="mt-2 list-disc pl-[18px] text-[13px] text-late">{b.escalation.details.map((d, i) => <li key={i}>{d.message}</li>)}</ul>
      )}

      {b && b.messages.length > 0 && (
        <details className="mt-3" open={b.state === "NEGOTIATING"}>
          <summary className="cursor-pointer text-[13px] font-semibold">Agent conversation ({b.messages.length})</summary>
          <ol className="mt-2 grid list-none gap-1.5 p-0">
            {b.messages.map(m => (
              <li key={m.id} className={`rounded-lg px-2.5 py-1.5 text-[13px] ${m.from_type === "club" ? "ml-6 bg-ready-bg" : "mr-6 bg-paper"}`}>
                <span className="font-semibold">{SENDER[m.from_type]}</span> <span className="text-xs text-muted">{m.type.replaceAll("_", " ").toLowerCase()}</span>
                <div>{m.note}</div>
              </li>
            ))}
          </ol>
          {b.availability && <p className="mt-1.5 text-xs text-muted">{b.source_label} Inventory {b.availability.inventory_version}, checked {fmtStamp(b.availability.checked_at)}.</p>}
        </details>
      )}
      {b && b.timeline.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[13px] font-semibold">Audit trail ({b.timeline.length})</summary>
          <ul className="mt-2 list-none p-0 text-xs">
            {b.timeline.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 border-b border-line py-1">
                <time className="text-muted tabular-nums">{fmtStamp(e.at)}</time>
                <span className="font-semibold">{e.to_state ? `${e.from_state ?? "—"} → ${e.to_state}` : e.action.replaceAll("_", " ")}</span>
                <span className="text-muted">{e.actor} ({e.role})</span>
                <span>{e.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {b?.can.cancel && (
        <button type="button" className={`${btn} mt-2.5`} disabled={!!busy} onClick={() => {
          const held = ["PENDING_HUMAN_REVIEW", "APPROVED", "CONFIRMED"].includes(b.state);
          if (window.confirm(held ? "Ask the reviewer to cancel this request?" : "Withdraw this request?")) act("cancel", () => bookingApi.cancel(b, "cancelled by the club rep"));
        }}>
          {["PENDING_HUMAN_REVIEW", "APPROVED", "CONFIRMED"].includes(b.state) ? "Request cancellation" : "Withdraw request"}
        </button>
      )}
    </div>
  );
}

function Stages({ b }: { b: Booking }) {
  const closed = b.stage === null;
  return (
    <ol className="mt-3 flex list-none flex-wrap gap-1 p-0" aria-label="Request progress">
      {b.stages.map((label, i) => {
        const done = !closed && b.stage !== null && i < b.stage;
        const now = !closed && i === b.stage;
        return (
          <li key={label} aria-current={now ? "step" : undefined}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${now ? "bg-cardinal text-on-cardinal" : done ? "bg-ok-bg text-ok" : "bg-block-bg text-muted"}`}>
            {done ? "✓ " : ""}{label}
          </li>
        );
      })}
    </ol>
  );
}

function ProposalBox({ p, title, note, children }: { p: Proposal; title: string; note: string; children?: React.ReactNode }) {
  return (
    <div className="mt-2.5 rounded-lg border border-line bg-paper p-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      <p className="m-0 text-sm font-semibold">{p.venue_name} · {fmtDay(p.time.start)}, {fmtTime(p.time.start)}–{fmtTime(p.time.end)}</p>
      <p className="m-0 text-[13px] text-muted">Seats {p.capacity} · {p.included_features.join(", ") || "no listed equipment"}</p>
      {p.differences.length ? (
        <ul className="mt-1.5 list-none p-0 text-[13px] text-wait">{p.differences.map(d => <li key={d}>≠ {d}</li>)}</ul>
      ) : <p className="mt-1.5 text-[13px] text-ok">= Exactly what you asked for</p>}
      <p className="mt-1.5 text-xs text-muted">{note}</p>
      {children && <div className="mt-2.5 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
