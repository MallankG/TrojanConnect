"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, useDb, useUser } from "@/lib/api/client";
import type { Booking, ReviewDecision } from "@/lib/api/types";
import { INVENTORY_VERSION } from "@/lib/api/mock/inventory";
import { fmtRange, fmtRelative, fmtStamp } from "@/lib/time";
import { sound } from "@/lib/sound/engine";
import { Page } from "@/components/layout/AppShell";
import { Poster } from "@/components/ui/Poster";
import {
  Avatar,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  ListSkeleton,
  PageHeader,
  Row,
  Rows,
  SimulatedTag,
  StatusPill,
  Tabs,
  buttonClass,
  inputClass,
  useToast,
} from "@/components/ui/kit";
import { ChecksList, RequestSummary, Timeline } from "@/components/booking/parts";
import { BookingHeader, Section } from "./club";

type QueueTab = "pending" | "changes" | "approved" | "rejected" | "cancel";

function bucket(b: Booking): QueueTab | null {
  if (b.state === "CANCEL_REQUESTED") return "cancel";
  switch (b.review?.status) {
    case "pending":
      return "pending";
    case "changes_requested":
      return "changes";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    default:
      return null;
  }
}

export function ReviewQueue() {
  const db = useDb();
  const user = useUser();
  const [tab, setTab] = useState<QueueTab>("pending");
  const [venueId, setVenueId] = useState("all");
  const [query, setQuery] = useState("");

  // Reviewers only ever see requests routed to their own authority.
  const mine = db.bookings.filter((b) => b.authorityId === user?.scopeId && bucket(b));
  const count = (t: QueueTab) => mine.filter((b) => bucket(b) === t).length;
  const venues = db.venues.filter((v) => v.authorityId === user?.scopeId);

  const rows = mine
    .filter((b) => bucket(b) === tab)
    .filter((b) => {
      const accepted = b.proposals.find((p) => p.id === b.acceptedProposalId);
      if (venueId !== "all" && accepted?.venueId !== venueId) return false;
      const club = db.clubs.find((c) => c.id === b.clubId)?.name ?? "";
      return `${b.event.title} ${club}`.toLowerCase().includes(query.toLowerCase());
    })
    .sort((a, b) => (a.review?.createdAt ?? "").localeCompare(b.review?.createdAt ?? ""));

  return (
    <Page>
      <PageHeader
        title="Review queue"
        lead={`Requests routed to ${user?.scopeName}. Each arrives complete, with the checks already run. The decision is yours.`}
      />
      <div className="mt-6">
        <Tabs
          label="Queue"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "pending", label: "Pending", count: count("pending") },
            { id: "changes", label: "Changes requested", count: count("changes") },
            { id: "approved", label: "Approved", count: count("approved") },
            { id: "rejected", label: "Rejected", count: count("rejected") },
            { id: "cancel", label: "Cancellations", count: count("cancel") },
          ]}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by event or club"
          aria-label="Search requests"
          className={`${inputClass} max-w-xs`}
        />
        <select
          value={venueId}
          onChange={(e) => setVenueId(e.target.value)}
          aria-label="Filter by room"
          className="rounded-xl border border-line bg-paper px-3 text-[15px]"
        >
          <option value="all">All rooms</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        {db.seededAt === "" ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState
            title={tab === "pending" ? "Queue is clear" : "Nothing here"}
            body={
              tab === "pending"
                ? "New requests appear the moment a club accepts a proposal."
                : "No requests match this view."
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((b) => {
              const club = db.clubs.find((c) => c.id === b.clubId);
              const accepted = b.proposals.find((p) => p.id === b.acceptedProposalId);
              const venue = db.venues.find((v) => v.id === accepted?.venueId);
              const flagged = b.event.needsHumanCheck.length > 0;
              return (
                <li key={b.id}>
                  <Link
                    href={`/venue-review/${b.review!.id}`}
                    className="flex items-center gap-3.5 rounded-xl px-2 py-3.5 hover:bg-wash"
                  >
                    <Poster seed={b.id} name={b.event.title ?? "?"} className="size-12 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold">{b.event.title}</p>
                      <p className="tabular truncate text-sm text-gray-70">
                        {club?.name} · {venue?.name} · {b.event.attendance} people
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {flagged ? (
                        <StatusPill label="Needs a human check" tone="attention" />
                      ) : (
                        <StatusPill label="All checks passed" tone="good" />
                      )}
                      <p className="mt-1 text-xs text-gray-70">{fmtRelative(b.review!.createdAt)}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Page>
  );
}

export function ReviewDetail() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const db = useDb();
  const user = useUser();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const booking = db.bookings.find((b) => b.review?.id === reviewId);

  if (db.seededAt === "") return <Page><ListSkeleton /></Page>;
  if (!booking || !booking.review) {
    return (
      <Page>
        <EmptyState
          title="Request not found"
          body="It may have been resubmitted under a new review, or the demo data was reset."
          action={<Link href="/venue-review" className={buttonClass("primary")}>Back to the queue</Link>}
        />
      </Page>
    );
  }
  if (booking.authorityId !== user?.scopeId) {
    return (
      <Page>
        <EmptyState
          title="Not assigned to you"
          body="This request belongs to a different venue authority. Reviewers only see their own queue."
        />
      </Page>
    );
  }

  const accepted = booking.proposals.find((p) => p.id === booking.acceptedProposalId);
  const venue = db.venues.find((v) => v.id === accepted?.venueId);
  const pending = booking.review.status === "pending" && booking.state === "PENDING_HUMAN_REVIEW";

  const decide = (decision: ReviewDecision) => {
    const result = api.recordDecision(booking.review!.id, decision, reason);
    if (!result.ok) return setError(result.error.message);
    setError(null);
    setReason("");
    if (decision === "APPROVE") {
      sound.play("stamp");
      toast("Approved. Booking confirmed.");
    } else {
      sound.play("decline");
      toast(decision === "REJECT" ? "Request rejected" : "Changes requested");
    }
  };

  return (
    <Page>
      <BookingHeader booking={booking} back="/venue-review" />

      {booking.event.needsHumanCheck.length > 0 && (
        <p className="mt-6 flex items-start gap-2.5 rounded-2xl border border-line px-4 py-3 text-[15px]">
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-mark-orange" />
          <span>
            <span className="font-semibold">Outside the rules engine: </span>
            {booking.event.needsHumanCheck.join(", ")}. The agents flagged this for you and made no
            assumption about it.
          </span>
        </p>
      )}

      <Section title="The request">
        <RequestSummary booking={booking} />
      </Section>

      {accepted && venue && (
        <Section title="Proposal the club accepted">
          <Rows>
            <Row label="Room">{venue.name}, {venue.building}</Row>
            <Row label="When"><span className="tabular">{fmtRange(accepted.start, accepted.end)}</span></Row>
            <Row label="Capacity"><span className="tabular">{venue.capacity} seats for {booking.event.attendance} people</span></Row>
            <Row label="Source">
              <span className="flex flex-wrap items-center gap-2">
                <SimulatedTag label="Simulated inventory" />
                <span className="tabular text-gray-70">{INVENTORY_VERSION}</span>
              </span>
            </Row>
          </Rows>
          <div className="mt-4"><ChecksList proposal={accepted} /></div>
          {accepted.differences.length > 0 && (
            <p className="mt-3 text-[15px]">
              The club explicitly accepted this change: {accepted.differences.join("; ")}
            </p>
          )}
        </Section>
      )}

      <Section title="Decision">
        {pending ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 text-[15px]">
              <Avatar name={user.name} />
              <span>
                Deciding as <span className="font-semibold">{user.name}</span>, reviewer for {user.scopeName}. Your
                name and the time are recorded.
              </span>
            </div>
            <Field label="Reason" hint="Required to reject or request changes">
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What the club should know"
                className={inputClass}
              />
            </Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => decide("APPROVE")}>Approve</Button>
              <Button onClick={() => decide("REQUEST_CHANGES")}>Request changes</Button>
              <Button onClick={() => decide("REJECT")}>Reject</Button>
            </div>
          </div>
        ) : booking.state === "CANCEL_REQUESTED" ? (
          <div className="space-y-3">
            <p className="text-[15px]">The club asked to cancel this booking.</p>
            <Button
              variant="primary"
              onClick={() => {
                const result = api.markCancelled(booking.id);
                toast(result.ok ? "Booking cancelled" : result.error.message, result.ok ? "good" : "bad");
              }}
            >
              Mark cancelled
            </Button>
          </div>
        ) : booking.review.decision ? (
          <figure className="rounded-2xl border border-line p-4">
            <blockquote className="font-serif text-xl italic leading-snug">“{booking.review.decision.reason}”</blockquote>
            <figcaption className="tabular mt-2 text-sm text-gray-70">
              {booking.review.decision.reviewerName} · {booking.review.decision.decision.replace("_", " ").toLowerCase()} · {fmtStamp(booking.review.decision.at)}
            </figcaption>
          </figure>
        ) : (
          <p className="text-[15px] text-gray-70">No decision is needed right now.</p>
        )}
      </Section>

      <Section title="How it got here" count={booking.timeline.length}>
        <Timeline booking={booking} />
      </Section>
    </Page>
  );
}
