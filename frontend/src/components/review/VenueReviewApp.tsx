"use client";

// Human venue review (PRD §11.6). A reviewer sees only requests for the venue authorities they are
// assigned to, and approves, rejects or requests changes. Confirmation needs a reference number;
// the backend checks the reviewer's authority on every action. The reviewer picker is a demo
// stand-in for Supabase Auth.
import { useCallback, useEffect, useState } from "react";
import { bookingApi, type Booking, type Reviewer } from "@/lib/api-client";
import { Pill, btn, btnPrimary, type Tone } from "@/components/pipeline/ui";
import { SimulatedTag } from "@/components/ui/kit";

const OPEN = ["PENDING_HUMAN_REVIEW", "APPROVED", "CANCEL_REQUESTED"];
const TONE: Record<string, Tone> = { PENDING_HUMAN_REVIEW: "waiting", APPROVED: "ready", CANCEL_REQUESTED: "waiting", CONFIRMED: "done", REJECTED: "late", CHANGES_REQUESTED: "late", CANCELLED: "plain" };
const STORE_KEY = "tc-demo-reviewer";
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

export function VenueReviewApp() {
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [me, setMe] = useState<string>("");
  const [queue, setQueue] = useState<Booking[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bookingApi.reviewers().then(rs => {
      setReviewers(rs);
      let saved = "";
      try { saved = localStorage.getItem(STORE_KEY) ?? ""; } catch { /* storage unavailable */ }
      setMe(rs.some(r => r.id === saved) ? saved : rs[0]?.id ?? "");
    }, e => setError((e as Error).message));
  }, []);

  const load = useCallback(async () => {
    if (!me) return;
    try { setQueue(await bookingApi.queue(me)); setError(null); } catch (e) { setError((e as Error).message); }
  }, [me]);
  useEffect(() => {
    if (!me) return;
    let alive = true;
    const sync = () => bookingApi.queue(me).then(q => { if (alive) { setQueue(q); setError(null); } }, e => { if (alive) setError((e as Error).message); });
    sync();
    const t = setInterval(sync, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, [me]);

  const pick = (id: string) => {
    setMe(id); setSelected(null); setQueue(null);
    try { localStorage.setItem(STORE_KEY, id); } catch { /* storage unavailable */ }
  };
  const reviewer = reviewers.find(r => r.id === me);
  const current = queue?.find(b => b.id === selected) ?? queue?.find(b => OPEN.includes(b.state)) ?? queue?.[0];
  const openCount = queue?.filter(b => OPEN.includes(b.state)).length ?? 0;

  return (
    <div className="text-ink">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <p className="text-xs font-semibold text-gray-70">Club and Venue agents</p>
          <h1 className="mt-0.5 mb-1 text-[clamp(1.5rem,3.2vw,2.25rem)] font-semibold leading-[1.05] tracking-[-0.02em]">Venue review</h1>
          <p className="text-gray-70">Requests the Club and Venue agents prepared. You decide; nothing is confirmed without you.</p>
        </div>
        <label className="grid gap-1 text-[13px] text-gray-70">
          Signed in as (demo identity, stands in for real sign-in)
          <select value={me} onChange={e => pick(e.target.value)} className="rounded-lg border border-line bg-paper px-2.5 py-2 text-ink">
            {reviewers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      </header>

      {error && <p role="alert" className="mb-3 rounded-xl bg-wash px-3 py-2 text-sm text-cardinal">{error}</p>}
      {reviewer && reviewer.role !== "venue_reviewer" && (
        <p role="status" className="mb-3 rounded-xl bg-gold-25 px-3 py-2 text-sm text-ink">
          {reviewer.name} has no venue authority, so there is nothing to review. Student government does not approve venue reservations.
        </p>
      )}

      <main className="grid items-start gap-6 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <section aria-label="Review queue" className="rounded-2xl bg-paper p-3 border border-line">
          <h2 className="mb-2 px-1 text-xs font-semibold text-gray-70">
            Queue{reviewer?.authorities.length ? ` · ${reviewer.authorities.join(", ")}` : ""} · {openCount} open
          </h2>
          {queue === null && <p className="px-1 text-sm text-gray-70">Loading…</p>}
          {queue?.length === 0 && <p className="px-1 text-sm text-gray-70">No requests yet.</p>}
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {queue?.map(b => (
              <li key={b.id}>
                <button type="button" onClick={() => setSelected(b.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left ${current?.id === b.id ? "border-cardinal bg-paper" : "border-line"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{String(b.review?.packet?.event?.title ?? "Untitled event")}</span>
                    <Pill tone={TONE[b.state] ?? "plain"}>{b.state_label}</Pill>
                  </div>
                  <div className="text-xs text-gray-70">{b.kind_label} · {b.accepted_proposal ? `${b.accepted_proposal.venue_name}, ${fmt(b.accepted_proposal.time.start)}` : b.authority?.name}</div>
                </button>
              </li>
            ))}
          </ul>
        </section>
        {current ? <ReviewDetail key={current.id + current.version} b={current} reviewer={me} onDone={load} /> : <div />}
      </main>
    </div>
  );
}

function ReviewDetail({ b, reviewer, onDone }: { b: Booking; reviewer: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const packet = b.review?.packet;
  const isVenue = b.kind === "venue_booking";
  const refLabel = isVenue ? "Reservation # (6 digits)" : "Permit code";
  const task = b.review!.task_id;

  const run = async (fn: () => Promise<Booking>) => {
    setBusy(true); setError(null);
    try { await fn(); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <article className="rounded-2xl bg-paper p-6 border border-line" aria-label="Request detail">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={TONE[b.state] ?? "plain"}>{b.state_label}</Pill>
        <Pill tone="plain">{b.kind_label} · {b.authority?.name}</Pill>
        {isVenue && <SimulatedTag label="Simulated availability" />}
      </div>
      <h2 className="mt-2 mb-3 text-xl font-bold">{String(packet?.event?.title ?? "Untitled event")}</h2>

      <ul className="m-0 list-none p-0 text-sm">{packet?.summary.map(l => <li key={l} className="py-0.5">{l}</li>)}</ul>
      <p className="mt-1 text-xs text-gray-70">Requested by {String(packet?.requester?.name ?? "?")} ({String(packet?.requester?.email ?? "no email")}, {String(packet?.requester?.eboard_position ?? "role not given")})</p>

      {b.accepted_proposal && (
        <div className="mt-3 rounded-lg border border-line bg-paper p-3">
          <p className="mb-1 text-xs font-semibold text-gray-70">Proposal the club accepted</p>
          <p className="m-0 text-sm font-semibold">{b.accepted_proposal.venue_name} · {fmt(b.accepted_proposal.time.start)}–{new Date(b.accepted_proposal.time.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })}</p>
          <p className="m-0 text-[13px] text-gray-70">Seats {b.accepted_proposal.capacity} · hold {b.accepted_proposal.hold ? `${fmt(b.accepted_proposal.hold.start)} → ${new Date(b.accepted_proposal.hold.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })}` : "event time only"}</p>
          {(packet?.differences ?? []).map(d => <p key={d} className="m-0 mt-1 text-[13px] text-ink">≠ {d} (the club accepted this change)</p>)}
          {packet?.checks && (
            <p className="m-0 mt-1.5 text-[13px] text-ink">{Object.entries(packet.checks).map(([k, v]) => `${v ? "✓" : "✗"} ${k.replace("_", " ")}`).join("  ")}</p>
          )}
          {packet?.negotiation_summary && <p className="m-0 mt-1 text-xs text-gray-70">{packet.negotiation_summary}</p>}
        </div>
      )}

      {packet && packet.attention.length > 0 && (
        <div className="mt-3 rounded-lg bg-gold-25 p-3 text-[13px] text-ink">
          <p className="mb-1 font-semibold">Check before deciding</p>
          <ul className="m-0 list-disc pl-[18px]">{packet.attention.map(a => <li key={a}>{a}</li>)}</ul>
          {packet.not_auto_answered && <p className="mt-1.5">{packet.not_auto_answered}</p>}
        </div>
      )}

      {b.review && b.review.decisions.length > 0 && (
        <ul className="mt-3 list-none p-0 text-[13px]">
          {b.review.decisions.map((d, i) => <li key={i}><b>{d.reviewer_name}</b>: {d.decision.replaceAll("_", " ").toLowerCase()}{d.reason ? ` (${d.reason})` : ""} · {fmt(d.at)}</li>)}
        </ul>
      )}
      {b.confirmation && <p className="mt-2 text-sm text-ink">✓ Confirmed with reference {b.confirmation.reference}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-wash px-3 py-2 text-sm text-cardinal">{error}</p>}

      {(b.state === "PENDING_HUMAN_REVIEW" || b.state === "APPROVED") && (
        <div className="mt-4 grid gap-2.5">
          <label className="grid gap-1 text-[13px] text-gray-70">
            {refLabel}{b.state === "PENDING_HUMAN_REVIEW" ? ": optional now; without it the request stays approved but not confirmed" : ""}
            <input value={reference} onChange={e => setReference(e.target.value)} inputMode={isVenue ? "numeric" : "text"} maxLength={40}
              className="rounded-lg border border-line bg-paper px-2.5 py-2 text-ink" />
          </label>
          {b.state === "PENDING_HUMAN_REVIEW" && (
            <label className="grid gap-1 text-[13px] text-gray-70">
              Reason (required to reject or request changes)
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={1000} className="rounded-lg border border-line bg-paper px-2.5 py-2 text-ink" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {b.state === "PENDING_HUMAN_REVIEW" ? (
              <>
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => run(() => bookingApi.decide(reviewer, task, "APPROVE", reason, reference.trim()))}>
                  {reference.trim() ? "Approve & confirm" : "Approve"}
                </button>
                <button type="button" className={btn} disabled={busy || !reason.trim()} onClick={() => run(() => bookingApi.decide(reviewer, task, "REQUEST_CHANGES", reason))}>Request changes</button>
                <button type="button" className={btn} disabled={busy || !reason.trim()} onClick={() => run(() => bookingApi.decide(reviewer, task, "REJECT", reason))}>Reject</button>
              </>
            ) : (
              <button type="button" className={btnPrimary} disabled={busy || !reference.trim()} onClick={() => run(() => bookingApi.confirm(reviewer, task, reference.trim()))}>Record reference & confirm</button>
            )}
          </div>
        </div>
      )}
      {b.state === "CANCEL_REQUESTED" && (
        <button type="button" className={`${btnPrimary} mt-4`} disabled={busy} onClick={() => run(() => bookingApi.decide(reviewer, task, "CONFIRM_CANCELLATION", "released"))}>Confirm cancellation & release the slot</button>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-[13px] font-semibold">Agent conversation and audit trail</summary>
        <ol className="mt-2 grid list-none gap-1 p-0 text-[13px]">
          {b.messages.map(m => <li key={m.id}><span className="font-semibold">{m.from}</span> <span className="text-xs text-gray-70">{m.type}</span> · {m.note}</li>)}
        </ol>
        <ul className="mt-2 list-none p-0 text-xs text-gray-70">
          {b.timeline.map((e, i) => <li key={i}>{fmt(e.at)} · {e.actor} ({e.role}) · {e.to_state ? `${e.from_state} → ${e.to_state}` : e.action} · {e.reason}</li>)}
        </ul>
      </details>
    </article>
  );
}
