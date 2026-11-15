"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Clock, MapPin, Minus } from "lucide-react";
import { api, useDb, useUser } from "@/lib/api/client";
import type { Booking, Proposal } from "@/lib/api/types";
import { FEATURE_LABEL } from "@/lib/api/mock/inventory";
import { PHASES, describeState, phaseOf } from "@/lib/booking/state-machine";
import { fmtDay, fmtRange, fmtStamp, fmtTime, fmtTimeRange } from "@/lib/time";
import { sound } from "@/lib/sound/engine";
import { Poster } from "@/components/ui/Poster";
import { Button, ErrorNote, Row, Rows, SimulatedTag, StatusPill, buttonClass, useToast } from "@/components/ui/kit";

export function useBookingContext(booking: Booking) {
  const db = useDb();
  const club = db.clubs.find((c) => c.id === booking.clubId);
  const accepted = booking.proposals.find((p) => p.id === booking.acceptedProposalId) ?? null;
  const active = booking.proposals.find((p) => p.status === "active") ?? null;
  const shown = accepted ?? active;
  const venue = shown ? db.venues.find((v) => v.id === shown.venueId) ?? null : null;
  const authority = db.authorities.find((a) => a.id === booking.authorityId) ?? null;
  return { club, accepted, active, shown, venue, authority };
}

/** A booking as a list row: poster with the status pill on its edge, then who, what, when, where. */
export function BookingRow({ booking, href }: { booking: Booking; href: string }) {
  const { club, shown, venue } = useBookingContext(booking);
  const status = describeState(booking.state);
  const title = booking.event.title ?? "Untitled request";
  const start = shown?.start ?? booking.event.start;
  const end = shown?.end ?? booking.event.end;

  return (
    <Link href={href} className="group flex gap-4 rounded-2xl p-2 transition-colors hover:bg-wash">
      <div className="relative shrink-0 pb-2.5">
        <Poster seed={booking.id} name={title} className="size-[76px]" />
        <StatusPill label={status.label} tone={status.tone} className="absolute -bottom-0.5 left-1/2 -translate-x-1/2" />
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="truncate text-sm text-gray-70">{club?.name}</p>
        <p className="truncate text-lg font-semibold leading-tight">{title}</p>
        <p className="tabular mt-1 flex items-center gap-1.5 text-sm text-gray-70">
          <Clock aria-hidden className="size-3.5 shrink-0" />
          {start && end ? fmtRange(start, end) : "Time not set"}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-gray-70">
          <MapPin aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{venue ? venue.name : "No room yet"}</span>
        </p>
      </div>
    </Link>
  );
}

/** The six steps a person follows, plus a plain line for anything off the main path. */
export function BookingStepper({ booking }: { booking: Booking }) {
  const phase = phaseOf(booking.state);
  const status = describeState(booking.state);
  if (phase < 0) {
    return (
      <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-wash px-4 py-3 text-[15px]">
        <StatusPill label={status.label} tone={status.tone} />
        {status.next}
      </p>
    );
  }
  return (
    <div>
      <p className="text-sm md:hidden" aria-live="polite">
        <span className="font-semibold">{PHASES[phase]}</span>
        <span className="tabular text-gray-70"> · step {phase + 1} of {PHASES.length}</span>
      </p>
      <ol className="hidden grid-cols-6 md:grid">
        {PHASES.map((label, i) => {
          const done = i < phase || booking.state === "CONFIRMED";
          const current = i === phase && booking.state !== "CONFIRMED";
          return (
            <li key={label} className="relative">
              {i > 0 && (
                <span
                  aria-hidden
                  className={`absolute right-1/2 top-[9px] h-0.5 w-full transition-colors duration-500 ${i <= phase ? "bg-cardinal" : "bg-line"}`}
                />
              )}
              <span
                aria-hidden
                className={`relative mx-auto grid size-5 place-items-center rounded-full border-2 transition-colors duration-500 ${
                  done || current ? "border-cardinal bg-cardinal text-paper" : "border-gray-30 bg-paper"
                }`}
              >
                {done && <Check className="size-3" strokeWidth={3.5} />}
              </span>
              <p
                aria-current={current ? "step" : undefined}
                className={`mt-2 text-center text-sm ${current ? "font-semibold" : done ? "" : "text-gray-70"}`}
              >
                {label}
              </p>
            </li>
          );
        })}
      </ol>
      {booking.state === "CHANGES_REQUESTED" && (
        <p className="mt-3 flex items-center gap-2 text-sm">
          <StatusPill label={status.label} tone={status.tone} />
          {status.next}
        </p>
      )}
    </div>
  );
}

/** What the club asked for. Empty fields stay visibly empty. */
export function RequestSummary({ booking }: { booking: Booking }) {
  const { event } = booking;
  const empty = <span className="text-gray-70">Not provided yet</span>;
  return (
    <Rows>
      <Row label="Event">{event.title ?? empty}</Row>
      <div className="grid grid-cols-[6.5rem_1fr] gap-x-3 px-4 py-2.5">
        <dt className="text-gray-70">Starts</dt>
        <dd className="tabular">{event.start ? `${fmtDay(event.start)}, ${fmtTime(event.start)}` : empty}</dd>
        <dt className="text-gray-70">Ends</dt>
        <dd className="tabular">{event.end ? fmtTime(event.end) : empty}</dd>
      </div>
      <Row label="People"><span className="tabular">{event.attendance ?? empty}</span></Row>
      <Row label="Needs">
        {event.features.length ? event.features.map((f) => FEATURE_LABEL[f]).join(", ") : "No equipment requested"}
      </Row>
      {event.needsHumanCheck.length > 0 && (
        <Row label="For a person">
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full bg-mark-orange" />
            {event.needsHumanCheck.join(", ")}
          </span>
        </Row>
      )}
    </Rows>
  );
}

const CHECK_LABEL: Record<keyof Proposal["checks"], string> = {
  capacity: "Capacity covers the headcount",
  features: "Room has the requested equipment",
  timeWindow: "Matches the requested time",
  venueAuthority: "Room belongs to this authority",
  availability: "Free in the venue inventory",
};

/** Results of the deterministic checks, so nobody has to trust a summary. */
export function ChecksList({ proposal }: { proposal: Proposal }) {
  return (
    <ul className="space-y-1.5 text-[15px]">
      {(Object.keys(CHECK_LABEL) as (keyof Proposal["checks"])[]).map((key) => {
        const pass = proposal.checks[key];
        return (
          <li key={key} className="flex items-center gap-2.5">
            <span
              className={`grid size-5 shrink-0 place-items-center rounded-full text-paper ${pass ? "bg-mark-olive" : "bg-mark-orange"}`}
            >
              {pass ? <Check aria-hidden className="size-3" strokeWidth={3.5} /> : <Minus aria-hidden className="size-3" strokeWidth={3.5} />}
            </span>
            {CHECK_LABEL[key]}
            <span className="sr-only">{pass ? "(passed)" : "(differs)"}</span>
          </li>
        );
      })}
    </ul>
  );
}

const PROPOSAL_STATUS: Record<Proposal["status"], string> = {
  active: "Open",
  accepted: "Accepted for review",
  superseded: "Replaced",
  declined: "Declined by Club Agent",
  expired: "Expired",
};

/** One offer or counteroffer, with the exact differences from the request. */
export function ProposalCard({
  booking,
  proposal,
  actions = true,
}: {
  booking: Booking;
  proposal: Proposal;
  actions?: boolean;
}) {
  const db = useDb();
  const user = useUser();
  const toast = useToast();
  const venue = db.venues.find((v) => v.id === proposal.venueId);
  const [acceptedChange, setAcceptedChange] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canAct =
    actions &&
    proposal.status === "active" &&
    booking.state === "NEGOTIATING" &&
    user?.role === "club_rep" &&
    user.scopeId === booking.clubId;
  const changed = proposal.differences.length > 0;

  const accept = () => {
    const result = api.acceptProposal(booking.id, proposal.id, proposal.version);
    if (!result.ok) return setError(result.error.message);
    sound.play("send");
    toast("Sent to the venue reviewer");
  };
  const alternatives = async () => {
    setBusy(true);
    setAsking(false);
    const result = await api.requestAlternatives(booking.id, reason.trim());
    setBusy(false);
    setReason("");
    if (!result.ok) setError(result.error.message);
  };

  return (
    <div className={`rounded-2xl border bg-paper p-4 ${proposal.status === "active" ? "border-ink" : "border-line"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-70">
          {proposal.kind === "OFFER" ? "Offer" : "Counteroffer"} <span className="tabular">v{proposal.version}</span> · {PROPOSAL_STATUS[proposal.status]}
        </p>
        <SimulatedTag label="Simulated availability" />
      </div>
      <p className="mt-2 text-xl font-semibold leading-tight">{venue?.name}</p>
      <p className="tabular text-[15px] text-gray-70">
        {venue?.building} · {proposal.capacity} seats
      </p>
      <p className="tabular mt-2 text-[15px]">{fmtRange(proposal.start, proposal.end)}</p>
      <p className="text-[15px] text-gray-70">{proposal.features.map((f) => FEATURE_LABEL[f]).join(", ")}</p>

      <div className="mt-3 rounded-xl bg-wash px-3.5 py-2.5 text-[15px]">
        {changed ? (
          <ul className="space-y-1">
            {proposal.differences.map((d) => (
              <li key={d} className="flex items-start gap-2">
                <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-mark-orange" />
                <span><span className="font-medium">Different from your request.</span> {d}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full bg-mark-olive" />
            Matches everything you asked for
          </p>
        )}
      </div>
      {proposal.conditions.map((c) => (
        <p key={c} className="mt-2 text-sm text-gray-70">{c}</p>
      ))}

      {canAct && (
        <div className="mt-4 space-y-3">
          {changed && (
            <label className="flex items-start gap-2.5 text-[15px]">
              <input
                type="checkbox"
                checked={acceptedChange}
                onChange={(e) => setAcceptedChange(e.target.checked)}
                className="mt-1 size-4 accent-cardinal"
              />
              I accept the changed time ({fmtTimeRange(proposal.start, proposal.end)})
            </label>
          )}
          {asking ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What should be different? (optional)"
                className="w-full rounded-xl border border-line px-3.5 py-2.5 text-[15px] focus:border-ink focus:outline-none"
              />
              <div className="flex gap-2">
                <Button variant="primary" onClick={alternatives}>Ask for another option</Button>
                <Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy || (changed && !acceptedChange)} onClick={accept}>
                Accept for review
              </Button>
              <Button disabled={busy} onClick={() => setAsking(true)}>
                {busy ? "Checking…" : "Ask for alternatives"}
              </Button>
            </div>
          )}
          <p className="text-sm text-gray-70">
            Accepting sends this to a venue reviewer. It is not a booking until they approve.
          </p>
        </div>
      )}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </div>
  );
}

/** Status at a glance, for chat threads and dashboards. */
export function StatusCard({ booking, link = true }: { booking: Booking; link?: boolean }) {
  const status = describeState(booking.state);
  const { venue, shown } = useBookingContext(booking);
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={status.label} tone={status.tone} />
        {booking.state === "APPROVED" && <span className="text-sm text-gray-70">Approved, not yet confirmed</span>}
        {booking.confirmationReference && (
          <span className="tabular text-sm text-gray-70">Reference {booking.confirmationReference}</span>
        )}
      </div>
      <p className="mt-2 text-[17px] font-semibold leading-tight">{booking.event.title}</p>
      {shown && venue && (
        <p className="tabular text-[15px] text-gray-70">
          {venue.name} · {fmtRange(shown.start, shown.end)}
        </p>
      )}
      <p className="mt-2 text-[15px]">{status.next}</p>
      {booking.review?.decision && (
        <figure className="mt-3 border-t border-line pt-3">
          <blockquote className="font-serif text-[17px] italic leading-snug">“{booking.review.decision.reason}”</blockquote>
          <figcaption className="mt-1 text-sm text-gray-70">
            {booking.review.decision.reviewerName}, venue reviewer · {fmtStamp(booking.review.decision.at)}
          </figcaption>
        </figure>
      )}
      {link && (
        <Link href={`/bookings/${booking.id}`} className={`${buttonClass("secondary")} mt-3`}>
          Open booking
        </Link>
      )}
    </div>
  );
}

const ACTOR_LABEL = {
  user: "Club representative",
  club_agent: "Agent",
  venue_workflow: "Venue workflow",
  backend: "Backend",
  reviewer: "Venue reviewer",
} as const;

/** The audit trail: every change with who, when, why and its correlation id. */
export function Timeline({ booking }: { booking: Booking }) {
  return (
    <ol className="relative">
      <span aria-hidden className="absolute bottom-2 left-[5px] top-2 border-l border-dashed border-gray-30" />
      {booking.timeline.map((entry) => (
        <li key={entry.id} className="relative pb-5 pl-7 last:pb-0">
          <span
            aria-hidden
            className={`absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-paper ${
              entry.actor === "reviewer" || entry.actor === "user" ? "bg-cardinal" : "bg-gray-70"
            }`}
          />
          <p className="text-[15px] leading-snug">
            <span className="font-medium">{entry.action}</span>
          </p>
          {entry.detail && <p className="text-[15px] text-gray-70">{entry.detail}</p>}
          <p className="tabular mt-0.5 text-xs text-gray-70">
            {entry.actorName} ({ACTOR_LABEL[entry.actor]}) · {fmtStamp(entry.at)}
            {entry.messageType ? ` · ${entry.messageType}` : ""}
            {entry.state ? ` · ${entry.state}` : ""}
          </p>
        </li>
      ))}
      <li className="sr-only">Correlation id {booking.correlationId}</li>
    </ol>
  );
}
