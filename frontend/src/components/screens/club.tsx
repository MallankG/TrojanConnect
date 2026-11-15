"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronRight, MessageCircle, Plus } from "lucide-react";
import { api, useDb, useUser } from "@/lib/api/client";
import type { Booking } from "@/lib/api/types";
import { describeState, isOpen } from "@/lib/booking/state-machine";
import { INVENTORY_VERSION } from "@/lib/api/mock/inventory";
import { SENTENCE } from "@/components/landing/content";
import { fmtDayHeading, fmtRange, fmtRelative, fmtStamp } from "@/lib/time";
import { sound } from "@/lib/sound/engine";
import { Page } from "@/components/layout/AppShell";
import { Poster } from "@/components/ui/Poster";
import {
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
import {
  BookingRow,
  BookingStepper,
  ChecksList,
  ProposalCard,
  RequestSummary,
  Timeline,
  useBookingContext,
} from "@/components/booking/parts";

/** Drafts nobody typed into are noise; hide them from lists. */
const hasContent = (b: Booking) =>
  b.state !== "DRAFT" || !!(b.event.title || b.event.attendance || b.event.start);

function useClubBookings() {
  const db = useDb();
  const user = useUser();
  const bookings = db.bookings.filter((b) => b.clubId === user?.scopeId && hasContent(b));
  return { db, user, bookings, ready: db.seededAt !== "" };
}

export function useCreateRequest() {
  const router = useRouter();
  const toast = useToast();
  return (firstMessage?: string) => {
    const result = api.startBooking();
    if (!result.ok) return toast(result.error.message, "bad");
    sound.play("send");
    router.push(`/conversations/${result.data.conversationId}`);
    if (firstMessage) void api.sendBookingMessage(result.data.conversationId, firstMessage);
  };
}

// ---- Dashboard -------------------------------------------------------------

export function ClubDashboard() {
  const { db, user, bookings, ready } = useClubBookings();
  const create = useCreateRequest();
  const club = db.clubs.find((c) => c.id === user?.scopeId);
  const needsYou = bookings.filter((b) =>
    ["NEGOTIATING", "CHANGES_REQUESTED", "READY_FOR_SUBMISSION", "NEEDS_INFORMATION"].includes(b.state),
  );
  const active = bookings.filter((b) => isOpen(b.state) && !needsYou.includes(b));
  const events = db.events
    .filter((e) => e.clubId === club?.id && new Date(e.start) > new Date())
    .sort((a, b) => a.start.localeCompare(b.start));
  const interests = db.interests.filter((i) => i.clubId === club?.id);

  return (
    <Page>
      <PageHeader
        title={club?.name ?? "Your club"}
        lead="Describe an event in a sentence. Your Club Agent prepares the request and handles the back-and-forth with the venue."
      />

      <div className="mt-6 rounded-3xl bg-cardinal p-5 text-paper md:p-6">
        <p className="text-xl font-semibold leading-tight text-gold md:text-2xl">
          Need a room?
        </p>
        <p className="mt-1 max-w-md text-[15px]">
          Start a request, or try the sample one to see the whole flow.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => create()}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-paper px-5 text-[15px] font-semibold text-cardinal hover:bg-gold-25"
          >
            <Plus aria-hidden className="size-4" />
            Create event request
          </button>
          <button
            type="button"
            onClick={() => create(SENTENCE)}
            className="inline-flex h-11 items-center rounded-full border border-gold/70 px-5 text-[15px] font-medium text-gold hover:border-gold"
          >
            Use the sample request
          </button>
        </div>
      </div>

      <Section title="Needs you" count={needsYou.length}>
        {!ready ? (
          <ListSkeleton rows={2} />
        ) : needsYou.length ? (
          <div className="space-y-1">
            {needsYou.map((b) => (
              <div key={b.id}>
                <BookingRow booking={b} href={`/bookings/${b.id}`} />
                <p className="pb-2 pl-[108px] text-sm">{describeState(b.state).next}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[15px] text-gray-70">Nothing is waiting on you.</p>
        )}
      </Section>

      <Section title="In progress" count={active.length} href="/bookings">
        {!ready ? (
          <ListSkeleton rows={2} />
        ) : active.length ? (
          <div className="space-y-1">
            {active.map((b) => (
              <BookingRow key={b.id} booking={b} href={`/bookings/${b.id}`} />
            ))}
          </div>
        ) : (
          <p className="text-[15px] text-gray-70">No requests with a venue team right now.</p>
        )}
      </Section>

      <Section title="Upcoming events" count={events.length}>
        {events.length ? (
          <ul className="space-y-3">
            {events.slice(0, 4).map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-wash">
                  <Poster seed={e.id} name={e.title} className="size-12" />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{e.title}</span>
                    <span className="tabular block truncate text-sm text-gray-70">
                      {fmtRange(e.start, e.end)} · {e.location}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-gray-70">Confirmed bookings appear here as events.</p>
        )}
      </Section>

      <Section title="Recruitment" count={interests.length} href="/recruitment">
        {interests.length ? (
          <p className="text-[15px]">
            {interests.length} {interests.length === 1 ? "student has" : "students have"} reached out.
            Latest: “{interests[0].message}”
          </p>
        ) : (
          <p className="text-[15px] text-gray-70">No one has expressed interest yet.</p>
        )}
      </Section>
    </Page>
  );
}

export function Section({
  title,
  count,
  href,
  children,
}: {
  title: string;
  count?: number;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-[-0.01em]">
          {title}
          {count !== undefined && count > 0 && <span className="tabular ml-2 font-normal text-gray-70">{count}</span>}
        </h2>
        {href && (
          <Link href={href} className="inline-flex items-center text-sm text-gray-70 hover:text-ink">
            View all
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

// ---- Bookings list ---------------------------------------------------------

export function BookingsList() {
  const { bookings, ready } = useClubBookings();
  const create = useCreateRequest();
  const [tab, setTab] = useState<"active" | "closed">("active");
  const active = bookings.filter((b) => isOpen(b.state));
  const closed = bookings.filter((b) => !isOpen(b.state));
  const shown = (tab === "active" ? active : closed)
    .slice()
    .sort((a, b) => (a.event.start ?? "9").localeCompare(b.event.start ?? "9"));

  const groups = new Map<string, Booking[]>();
  for (const b of shown) {
    const key = b.event.start ? b.event.start.slice(0, 10) : "none";
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }

  return (
    <Page>
      <PageHeader
        title="Bookings"
        action={
          <Button variant="primary" onClick={() => create()}>
            <Plus aria-hidden className="size-4" />
            Create event request
          </Button>
        }
      />
      <div className="mt-6">
        <Tabs
          label="Booking status"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "active", label: "Active", count: active.length },
            { id: "closed", label: "Closed", count: closed.length },
          ]}
        />
      </div>
      <div className="mt-6">
        {!ready ? (
          <ListSkeleton />
        ) : shown.length === 0 ? (
          <EmptyState
            title={tab === "active" ? "No active requests" : "Nothing closed yet"}
            body={
              tab === "active"
                ? "Start a request and your Club Agent will take it from there."
                : "Confirmed, rejected and cancelled requests are kept here."
            }
            action={tab === "active" ? <Button variant="primary" onClick={() => create()}>Create event request</Button> : undefined}
          />
        ) : (
          <div className="relative space-y-6 pl-6">
            <span aria-hidden className="absolute bottom-2 left-[5px] top-2 border-l border-dashed border-gray-30" />
            {[...groups.entries()].map(([key, items]) => {
              const heading = items[0].event.start ? fmtDayHeading(items[0].event.start) : null;
              return (
                <div key={key} className="relative">
                  <span aria-hidden className="absolute -left-6 top-1.5 size-[11px] rounded-full border-2 border-paper bg-gray-70" />
                  <h2 className="text-[15px]">
                    <span className="font-semibold">{heading?.primary ?? "Date not set"}</span>
                    {heading && <span className="text-gray-70"> {heading.secondary}</span>}
                  </h2>
                  <div className="mt-2 space-y-1">
                    {items.map((b) => (
                      <BookingRow key={b.id} booking={b} href={`/bookings/${b.id}`} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Page>
  );
}

// ---- Booking detail --------------------------------------------------------

type DetailTab = "overview" | "negotiation" | "review" | "history";

export function BookingDetail() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const db = useDb();
  const user = useUser();
  const toast = useToast();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const booking = db.bookings.find((b) => b.id === bookingId);

  if (db.seededAt === "") return <Page><ListSkeleton /></Page>;
  if (!booking) {
    return (
      <Page>
        <EmptyState
          title="Booking not found"
          body="It may have been removed when the demo data was reset."
          action={<Link href="/bookings" className={buttonClass("primary")}>Back to bookings</Link>}
        />
      </Page>
    );
  }
  const isOwner = user?.role === "club_rep" && user.scopeId === booking.clubId;
  const isReviewer = user?.role === "venue_reviewer" && user.scopeId === booking.authorityId;
  if (!isOwner && !isReviewer) {
    return (
      <Page>
        <EmptyState
          title="You don't have access to this booking"
          body="Bookings are visible to the club that made them and the reviewer for that venue authority."
        />
      </Page>
    );
  }

  return (
    <Page>
      <BookingHeader booking={booking} back={isOwner ? "/bookings" : "/venue-review"} />
      <div className="mt-6"><BookingStepper booking={booking} /></div>

      <div className="mt-6">
        <Tabs
          label="Booking sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "negotiation", label: "Negotiation", count: booking.proposals.length },
            { id: "review", label: "Review" },
            { id: "history", label: "History", count: booking.timeline.length },
          ]}
        />
      </div>

      <div className="mt-6 space-y-6">
        {tab === "overview" && <Overview booking={booking} isOwner={isOwner} />}

        {tab === "negotiation" && (
          <>
            <p className="tabular text-[15px] text-gray-70">
              {booking.rounds} of 5 negotiation rounds used. Proposals come from the venue workflow&apos;s
              inventory check, never from a model&apos;s guess.
            </p>
            {booking.proposals.length === 0 ? (
              <EmptyState title="No proposals yet" body="They appear here once the request reaches the venue workflow." />
            ) : (
              booking.proposals
                .slice()
                .reverse()
                .map((p) => <ProposalCard key={p.id} booking={booking} proposal={p} />)
            )}
          </>
        )}

        {tab === "review" && (
          <>
            {!booking.review ? (
              <EmptyState
                title="Not with a reviewer yet"
                body="A person at the venue reviews the request after you accept a proposal."
              />
            ) : (
              <div className="rounded-2xl border border-line p-4">
                <p className="text-sm text-gray-70">Human review · sent {fmtRelative(booking.review.createdAt)}</p>
                {booking.review.decision ? (
                  <figure className="mt-2">
                    <blockquote className="font-serif text-xl italic leading-snug">
                      “{booking.review.decision.reason}”
                    </blockquote>
                    <figcaption className="tabular mt-2 text-sm text-gray-70">
                      {booking.review.decision.reviewerName}, venue reviewer · {fmtStamp(booking.review.decision.at)}
                    </figcaption>
                  </figure>
                ) : (
                  <p className="mt-2 text-[17px]">Waiting for a venue reviewer. Agents cannot approve this.</p>
                )}
              </div>
            )}
            {booking.state === "APPROVED" && (
              <p className="text-[15px]">Approved by the reviewer. The backend is recording the confirmation.</p>
            )}
            {booking.state === "CHANGES_REQUESTED" && isOwner && (
              <div className="space-y-3">
                <Field label="Reply to the reviewer">
                  <textarea
                    rows={3}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Answer what they asked"
                    className={inputClass}
                  />
                </Field>
                {error && <ErrorNote>{error}</ErrorNote>}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() => {
                      const result = api.resubmitForReview(booking.id, reply);
                      if (!result.ok) return setError(result.error.message);
                      setReply("");
                      setError(null);
                      toast("Sent back to the reviewer");
                    }}
                  >
                    Reply and resubmit
                  </Button>
                  <Button onClick={() => void api.requestAlternatives(booking.id, "Reviewer requested changes").then(() => setTab("negotiation"))}>
                    Ask for a different room
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            <p className="text-[15px] text-gray-70">
              Every change, with who made it and why. Correlation id{" "}
              <span className="tabular">{booking.correlationId}</span>
            </p>
            <Timeline booking={booking} />
          </>
        )}
      </div>
    </Page>
  );
}

export function BookingHeader({ booking, back }: { booking: Booking; back: string }) {
  const { club } = useBookingContext(booking);
  const status = describeState(booking.state);
  const title = booking.event.title ?? "Untitled request";
  return (
    <>
      <Link href={back} className="inline-flex items-center text-sm text-gray-70 hover:text-ink">
        {back === "/bookings" ? "Bookings" : "Review queue"}
        <ChevronRight aria-hidden className="size-4" />
      </Link>
      <div className="mt-3 flex items-center gap-4">
        <Poster seed={booking.id} name={title} className="size-20 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm text-gray-70">{club?.name}</p>
          <h1 className="text-[clamp(1.5rem,3.2vw,2.25rem)] font-semibold leading-[1.05] tracking-[-0.02em]">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill label={status.label} tone={status.tone} />
            {booking.confirmationReference && (
              <span className="tabular text-sm text-gray-70">Reference {booking.confirmationReference}</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Overview({ booking, isOwner }: { booking: Booking; isOwner: boolean }) {
  const { shown, venue, authority } = useBookingContext(booking);
  const toast = useToast();
  const status = describeState(booking.state);
  const cancellable = isOwner && isOpen(booking.state) && booking.state !== "CANCEL_REQUESTED";

  return (
    <>
      <p className="rounded-2xl bg-wash px-4 py-3 text-[15px]">
        <span className="font-semibold">Next: </span>
        {status.next}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Venue authority" value={authority?.name ?? "Not routed yet"} note={booking.routingReason ?? undefined} />
        <Tile
          label={booking.state === "CONFIRMED" ? "Room" : booking.acceptedProposalId ? "Room, pending approval" : "Room, proposed"}
          value={venue?.name ?? "No room yet"}
          note={shown ? fmtRange(shown.start, shown.end) : undefined}
        />
        <Tile label="Availability data" value={<SimulatedTag label="Simulated inventory" />} note={INVENTORY_VERSION} />
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">What you asked for</h2>
        <RequestSummary booking={booking} />
      </div>

      {shown && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Checks on the {booking.acceptedProposalId ? "accepted" : "current"} proposal</h2>
          <ChecksList proposal={shown} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Link href={`/conversations/${booking.conversationId}`} className={buttonClass("secondary")}>
          <MessageCircle aria-hidden className="size-4" />
          Open conversation
        </Link>
        {cancellable && (
          <Button
            variant="ghost"
            onClick={() => {
              const result = api.requestCancel(booking.id);
              toast(result.ok ? "Cancellation requested" : result.error.message, result.ok ? "good" : "bad");
            }}
          >
            {["DRAFT", "NEEDS_INFORMATION", "READY_FOR_SUBMISSION"].includes(booking.state) ? "Discard draft" : "Request cancellation"}
          </Button>
        )}
      </div>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-2xl border border-line p-3.5">
      <p className="text-sm text-gray-70">{label}</p>
      <div className="mt-1 text-[15px] font-semibold leading-tight">{value}</div>
      {note && <p className="tabular mt-1 text-xs text-gray-70">{note}</p>}
    </div>
  );
}

// ---- Club profile and recruitment ------------------------------------------

function ClubTabs({ current }: { current: "profile" | "recruitment" }) {
  const router = useRouter();
  return (
    <Tabs
      label="Club sections"
      value={current}
      onChange={(id) => router.push(id === "profile" ? "/club-profile" : "/recruitment")}
      tabs={[
        { id: "profile", label: "Public profile" },
        { id: "recruitment", label: "Recruitment" },
      ]}
    />
  );
}

export function ClubProfile() {
  const db = useDb();
  const user = useUser();
  const toast = useToast();
  const club = db.clubs.find((c) => c.id === user?.scopeId);
  const [draft, setDraft] = useState<{ tagline: string; description: string } | null>(null);
  if (!club) return <Page><ListSkeleton /></Page>;
  const values = draft ?? { tagline: club.tagline, description: club.description };

  return (
    <Page>
      <PageHeader title={club.name} lead="What students see, and what your public Club Agent is allowed to say." />
      <div className="mt-6"><ClubTabs current="profile" /></div>

      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const result = api.updateClub(club.id, values);
          toast(result.ok ? "Profile saved" : result.error.message, result.ok ? "good" : "bad");
          setDraft(null);
        }}
      >
        <div className="flex items-center gap-4">
          <Poster seed={club.id} name={club.name} className="size-20" />
          <div>
            <StatusPill label={club.verified ? "Verified organization" : "Not verified"} tone={club.verified ? "good" : "attention"} />
            <p className="tabular mt-1.5 text-sm text-gray-70">{club.members} members · meets {club.meets}</p>
          </div>
        </div>
        <Field label="One-line description">
          <input value={values.tagline} onChange={(e) => setDraft({ ...values, tagline: e.target.value })} maxLength={90} className={inputClass} />
        </Field>
        <Field label="About the club">
          <textarea rows={4} value={values.description} onChange={(e) => setDraft({ ...values, description: e.target.value })} maxLength={500} className={inputClass} />
        </Field>
        <div className="flex gap-2">
          <Button variant="primary" type="submit" disabled={!draft}>Save changes</Button>
          <Link href={`/clubs/${club.id}`} className={buttonClass("secondary")}>View public page</Link>
        </div>
      </form>

      <Section title="Approved answers" count={club.faq.length}>
        <p className="mb-3 text-[15px] text-gray-70">
          Your public Club Agent answers only from these and the profile above. Anything else, it
          says it cannot verify.
        </p>
        <Rows>
          {club.faq.map((f) => (
            <div key={f.q} className="px-4 py-3">
              <dt className="font-medium">{f.q}</dt>
              <dd className="mt-0.5 text-gray-70">{f.a}</dd>
            </div>
          ))}
        </Rows>
      </Section>
    </Page>
  );
}

export function Recruitment() {
  const db = useDb();
  const user = useUser();
  const club = db.clubs.find((c) => c.id === user?.scopeId);
  const interests = db.interests.filter((i) => i.clubId === club?.id);
  if (!club) return <Page><ListSkeleton /></Page>;

  return (
    <Page>
      <PageHeader title={club.name} lead="Students who reached out through your club page." />
      <div className="mt-6"><ClubTabs current="recruitment" /></div>

      <div className="mt-6">
        <Rows>
          <Row label="Status">
            <select
              value={club.recruitment}
              onChange={(e) => api.updateClub(club.id, { recruitment: e.target.value as typeof club.recruitment })}
              className="rounded-lg border border-line bg-paper px-2 py-1 text-[15px]"
              aria-label="Recruitment status"
            >
              <option value="open">Open to everyone</option>
              <option value="applications">By application</option>
              <option value="closed">Closed this semester</option>
            </select>
          </Row>
        </Rows>
      </div>

      <Section title="Expressions of interest" count={interests.length}>
        {interests.length === 0 ? (
          <EmptyState title="No one yet" body="When a student expresses interest on your club page, it lands here." />
        ) : (
          <ul className="divide-y divide-line">
            {interests.map((i) => (
              <li key={i.id} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[15px] font-semibold">{i.studentName}</p>
                  <StatusPill
                    label={i.sharedContact ? "Shared their name" : "Sent without identity"}
                    tone={i.sharedContact ? "good" : "neutral"}
                  />
                </div>
                <p className="mt-1 font-serif text-[17px] italic leading-snug">“{i.message}”</p>
                <p className="mt-1 text-sm text-gray-70">
                  {i.type === "membership" ? "Wants to join" : i.type === "event" ? "About an event" : "A question"} · {fmtRelative(i.at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
