"use client";

// Club representative screens on the live backend: booking requests (/api/v1/bookings), the club's
// public profile and outreach posts, and the recruitment inbox (backend/app/workflows/campus).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, CalendarPlus, Megaphone, UserPlus } from "lucide-react";
import { campus, live, useUser } from "@/lib/api/client";
import { bookingApi, pipelineApi, type Booking } from "@/lib/api-client";
import type { PipelineState } from "@/lib/pipeline/plan";
import { fmtDay, fmtRange, fmtRelative, fmtStamp } from "@/lib/time";
import { sound } from "@/lib/sound/engine";
import { Page } from "@/components/layout/AppShell";
import { Poster } from "@/components/ui/Poster";
import { BookingCard } from "@/components/pipeline/BookingCard";
import { VENUE_FORM } from "@/lib/pipeline/plan";
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
import { Section } from "./club";

type Tone = "neutral" | "progress" | "review" | "attention" | "good" | "bad";
const TONE: Partial<Record<Booking["state"], Tone>> = {
  CONFIRMED: "good", APPROVED: "review", PENDING_HUMAN_REVIEW: "review", NEGOTIATING: "attention",
  READY_FOR_SUBMISSION: "attention", NEEDS_INFORMATION: "attention", CHANGES_REQUESTED: "attention",
  REJECTED: "bad", FAILED_REQUIRES_HUMAN: "bad", CANCELLED: "neutral", EXPIRED: "neutral",
};
const CLOSED: Booking["state"][] = ["CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED", "FAILED_REQUIRES_HUMAN"];
const NEEDS_YOU: Booking["state"][] = ["NEEDS_INFORMATION", "READY_FOR_SUBMISSION", "NEGOTIATING", "CHANGES_REQUESTED"];

/** Every booking request for the current event, refreshed every 10 s while a reviewer may be deciding. */
function useBookings() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => bookingApi.list().then(
      (b) => alive && (setBookings(b), setError(null)),
      (e) => alive && setError((e as Error).message),
    );
    load();
    const t = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { bookings, error };
}

function BookingLine({ b }: { b: Booking }) {
  const p = b.accepted_proposal ?? b.active_proposal;
  return (
    <Link href={`/bookings/${b.id}`} className="flex items-start gap-3.5 rounded-2xl p-2 hover:bg-wash">
      <Poster seed={b.id} name={b.kind_label} className="size-14 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[17px] font-semibold leading-tight">{b.kind_label}</span>
          <StatusPill label={b.state_label} tone={TONE[b.state] ?? "neutral"} />
        </span>
        <span className="tabular mt-0.5 block truncate text-sm text-gray-70">
          {p ? `${p.venue_name} · ${fmtRange(p.time.start, p.time.end)}` : b.authority?.name ?? "Not routed yet"}
        </span>
        <span className="mt-0.5 block text-sm">{b.next_action}</span>
      </span>
    </Link>
  );
}

// ---- Dashboard ---------------------------------------------------------------

export function ClubDashboard() {
  const user = useUser();
  const clubId = user?.scopeId ?? null;
  const club = live.useClub(clubId);
  const events = live.useClubEvents(clubId);
  const interests = campus.useInterests(clubId);
  const { bookings, error } = useBookings();
  const open = (bookings ?? []).filter((b) => !CLOSED.includes(b.state));
  const needsYou = open.filter((b) => NEEDS_YOU.includes(b.state));
  const waiting = open.filter((b) => !NEEDS_YOU.includes(b.state));

  return (
    <Page>
      <PageHeader
        title={club.data?.name ?? "Your club"}
        lead="Plan events with the assistant, keep students posted, and see who wants to join."
      />

      <div className="mt-6 rounded-3xl bg-cardinal p-5 text-paper md:p-6">
        <p className="text-xl font-semibold leading-tight text-gold md:text-2xl">Planning an event?</p>
        <p className="mt-1 max-w-md text-[15px]">
          Tell the assistant the date, time and headcount. It finds free rooms, prepares the venue request and
          permit, and walks you through food, funding and publicity.
        </p>
        <Link href="/plan" className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-paper px-5 text-[15px] font-semibold text-cardinal hover:bg-gold-25">
          Open the assistant
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>

      <Section title="Needs you" count={needsYou.length}>
        {error ? <ErrorNote>{error}</ErrorNote> : !bookings ? <ListSkeleton rows={2} /> : needsYou.length ? (
          <div className="space-y-1">{needsYou.map((b) => <BookingLine key={b.id} b={b} />)}</div>
        ) : (
          <p className="text-[15px] text-gray-70">Nothing is waiting on you.</p>
        )}
      </Section>

      <Section title="With a reviewer" count={waiting.length} href="/bookings">
        {!bookings ? <ListSkeleton rows={1} /> : waiting.length ? (
          <div className="space-y-1">{waiting.map((b) => <BookingLine key={b.id} b={b} />)}</div>
        ) : (
          <p className="text-[15px] text-gray-70">No requests with a venue team right now.</p>
        )}
      </Section>

      {clubId && <PostComposer clubId={clubId} />}

      <Section title="Upcoming events" count={events.data?.length}>
        {events.error ? <ErrorNote>{events.error}</ErrorNote> : !events.data ? <ListSkeleton rows={2} /> : events.data.length ? (
          <ul className="space-y-1">
            {events.data.slice(0, 5).map((e) => (
              <li key={e.id}>
                <Link href={`/events/${encodeURIComponent(e.id)}`} className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-wash">
                  <Poster seed={e.id} name={e.title} className="size-12" />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{e.title}</span>
                    <span className="tabular block truncate text-sm text-gray-70">{fmtRange(e.start, e.end)}{e.location ? ` · ${e.location}` : ""}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-gray-70">Post an event above and it appears here and on the Events page.</p>
        )}
      </Section>

      <Section title="Recruitment" count={interests.data?.length} href="/recruitment">
        {interests.error ? <ErrorNote>{interests.error}</ErrorNote> : !interests.data ? <ListSkeleton rows={1} /> : interests.data.length ? (
          <p className="text-[15px]">
            {interests.data.length} {interests.data.length === 1 ? "student has" : "students have"} reached out. Latest: “{interests.data[0].message}”
          </p>
        ) : (
          <p className="text-[15px] text-gray-70">No one has expressed interest yet.</p>
        )}
      </Section>
    </Page>
  );
}

// ---- Outreach ----------------------------------------------------------------

const KINDS = [
  { id: "event", label: "Event", icon: CalendarPlus },
  { id: "recruitment", label: "Recruitment", icon: UserPlus },
  { id: "update", label: "Update", icon: Megaphone },
] as const;

/** Post an event, a recruitment call or an update. Students who saved the club or reached out are notified. */
export function PostComposer({ clubId }: { clubId: string }) {
  const toast = useToast();
  const posts = campus.usePosts(clubId);
  const [kind, setKind] = useState<"event" | "recruitment" | "update">("event");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("19:30");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<"open" | "application" | "closed">("open");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || !body.trim()) return setError("Add a title and a message.");
    if (kind === "event" && !date) return setError("Pick the event date.");
    const iso = (t: string) => new Date(`${date}T${t}:00`).toISOString();
    setBusy(true);
    const result = await campus.post(clubId, {
      kind, title, body,
      ...(kind === "event" ? { event: { start_at: iso(start), end_at: iso(end), location } } : {}),
      ...(kind === "recruitment" ? { recruitment_status: status } : {}),
    });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    sound.play("send");
    toast("Posted. Followers are notified.");
    setTitle(""); setBody(""); setError(null);
  };

  return (
    <Section title="Post to students" count={posts.data?.length}>
      <form className="space-y-3 rounded-3xl border border-line p-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Post type">
          {KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => setKind(k.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-colors ${kind === k.id ? "border-ink bg-ink text-paper" : "border-line hover:border-gray-70"}`}>
              <k.icon aria-hidden className="size-4" />
              {k.label}
            </button>
          ))}
        </div>
        <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className={inputClass} /></Field>
        <Field label="Message"><textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} className={inputClass} /></Field>
        {kind === "event" && (
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} /></Field>
            <Field label="Starts"><input type="time" step={1800} value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} /></Field>
            <Field label="Ends"><input type="time" step={1800} value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} /></Field>
            <Field label="Where"><input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} className={inputClass} /></Field>
          </div>
        )}
        {kind === "recruitment" && (
          <Field label="Recruitment status">
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputClass}>
              <option value="open">Open to everyone</option>
              <option value="application">By application</option>
              <option value="closed">Closed</option>
            </select>
          </Field>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" type="submit" disabled={busy}>{busy ? "Posting…" : "Post"}</Button>
          <span className="text-sm text-gray-70">Goes to students who saved your club or expressed interest.</span>
        </div>
      </form>
      {posts.data && posts.data.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {posts.data.slice(0, 5).map((p) => (
            <li key={p.id} className="py-3">
              <p className="text-sm text-gray-70">{KINDS.find((k) => k.id === p.kind)?.label} · {fmtRelative(p.created_at)}</p>
              <p className="text-[17px] font-semibold leading-tight">{p.title}</p>
              <p className="mt-0.5 text-[15px]">{p.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---- Bookings ----------------------------------------------------------------

export function BookingsList() {
  const { bookings, error } = useBookings();
  const [tab, setTab] = useState<"active" | "closed">("active");
  const active = (bookings ?? []).filter((b) => !CLOSED.includes(b.state));
  const closed = (bookings ?? []).filter((b) => CLOSED.includes(b.state));
  const shown = tab === "active" ? active : closed;

  return (
    <Page>
      <PageHeader
        title="Bookings"
        lead="Venue requests and event permits for your current event. Only a reviewer's confirmation makes a booking."
        action={<Link href="/plan" className={buttonClass("primary")}>Plan an event</Link>}
      />
      <div className="mt-3"><SimulatedTag label="Simulated venue availability" /></div>
      <div className="mt-6">
        <Tabs label="Booking status" value={tab} onChange={setTab}
          tabs={[{ id: "active", label: "Active", count: active.length }, { id: "closed", label: "Closed", count: closed.length }]} />
      </div>
      <div className="mt-4">
        {error ? <ErrorNote>{error}</ErrorNote> : !bookings ? <ListSkeleton /> : shown.length === 0 ? (
          <EmptyState
            title={tab === "active" ? "No active requests" : "Nothing closed yet"}
            body={tab === "active" ? "Tell the assistant about your event and it prepares the venue request." : "Confirmed, rejected and cancelled requests are kept here."}
            action={tab === "active" ? <Link href="/plan" className={buttonClass("primary")}>Open the assistant</Link> : undefined}
          />
        ) : (
          <div className="space-y-1">{shown.map((b) => <BookingLine key={b.id} b={b} />)}</div>
        )}
      </div>
    </Page>
  );
}

/** One request: the live booking card when it is the current one, otherwise its record and audit trail. */
export function BookingDetail() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const router = useRouter();
  const { bookings, error } = useBookings();
  const [state, setState] = useState<PipelineState | null>(null);
  const reload = useCallback(() => { pipelineApi.state().then(setState, () => setState(null)); }, []);
  useEffect(reload, [reload]);
  const b = bookings?.find((x) => x.id === bookingId);
  const latest = b && bookings?.find((x) => x.kind === b.kind)?.id === b.id;

  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!bookings) return <Page><ListSkeleton /></Page>;
  if (!b) return <Page><EmptyState title="Request not found" body="It may belong to an earlier event that was cleared." action={<Link href="/bookings" className={buttonClass("primary")}>Back to bookings</Link>} /></Page>;
  const profile = state?.profile ?? {};
  const formId = b.kind === "event_permit" ? "permit" : (profile.venueKind ? VENUE_FORM[profile.venueKind as keyof typeof VENUE_FORM] : "tcc");

  return (
    <Page>
      <PageHeader title={b.kind_label} lead={b.authority ? `Routed to ${b.authority.name}` : "Not routed yet"} />
      <div className="mt-3 flex flex-wrap gap-2">
        <StatusPill label={b.state_label} tone={TONE[b.state] ?? "neutral"} />
        {b.simulated && <SimulatedTag label="Simulated availability" />}
      </div>
      <div className="mt-6">
        {latest && state ? (
          <BookingCard kind={b.kind} formId={formId} profile={profile} onJumpToField={() => router.push("/plan")} onPipelineChange={reload} />
        ) : (
          <Rows>
            {b.summary.map((line) => <Row key={line} label="Request">{line}</Row>)}
            {b.confirmation && <Row label="Reference">{b.confirmation.reference}</Row>}
            <Row label="Next">{b.next_action}</Row>
          </Rows>
        )}
      </div>
      <Section title="Audit trail" count={b.timeline.length}>
        <ul className="space-y-2 text-sm">
          {b.timeline.map((e, i) => (
            <li key={i} className="flex flex-wrap gap-x-2 border-b border-line pb-2">
              <time className="tabular text-gray-70">{fmtStamp(e.at)}</time>
              <span className="font-medium">{e.to_state ? `${e.from_state ?? "—"} → ${e.to_state}` : e.action.replaceAll("_", " ")}</span>
              <span className="text-gray-70">{e.actor} ({e.role})</span>
              <span>{e.reason}</span>
            </li>
          ))}
        </ul>
      </Section>
    </Page>
  );
}

// ---- Club profile and recruitment --------------------------------------------

function ClubTabs({ current }: { current: "profile" | "recruitment" }) {
  const router = useRouter();
  return (
    <Tabs label="Club sections" value={current}
      onChange={(id) => router.push(id === "profile" ? "/club-profile" : "/recruitment")}
      tabs={[{ id: "profile", label: "Public profile" }, { id: "recruitment", label: "Recruitment" }]} />
  );
}

export function ClubProfile() {
  const user = useUser();
  const toast = useToast();
  const result = live.useClub(user?.scopeId ?? null);
  const club = result.data;
  const [draft, setDraft] = useState<{ description: string; meets: string; howToJoin: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (result.error) return <Page><ErrorNote>{result.error}</ErrorNote></Page>;
  if (!club) return <Page><ListSkeleton /></Page>;
  const values = draft ?? { description: club.description, meets: club.meets, howToJoin: club.live?.howToJoin ?? "" };

  return (
    <Page>
      <PageHeader title={club.name} lead="What students see, and all your public Club Agent is allowed to say." />
      <div className="mt-6"><ClubTabs current="profile" /></div>
      <form className="mt-6 space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await campus.updateClub(club.id, { public_description: values.description, meeting_schedule: values.meets, how_to_join: values.howToJoin });
        setBusy(false);
        toast(r.ok ? "Profile saved" : r.error.message, r.ok ? "good" : "bad");
        if (r.ok) setDraft(null);
      }}>
        <div className="flex items-center gap-4">
          <Poster seed={club.id} name={club.name} className="size-20" />
          <div className="space-y-1.5">
            <StatusPill label={club.verified ? "Verified organization" : "Not verified"} tone={club.verified ? "good" : "attention"} />
            {club.live?.dataLabel === "demo" && <p className="text-sm text-gray-70">Sample club for this demo.</p>}
          </div>
        </div>
        <Field label="About the club">
          <textarea rows={5} value={values.description} onChange={(e) => setDraft({ ...values, description: e.target.value })} maxLength={2000} className={inputClass} />
        </Field>
        <Field label="When you meet"><input value={values.meets} onChange={(e) => setDraft({ ...values, meets: e.target.value })} maxLength={300} className={inputClass} /></Field>
        <Field label="How to join"><textarea rows={3} value={values.howToJoin} onChange={(e) => setDraft({ ...values, howToJoin: e.target.value })} maxLength={600} className={inputClass} /></Field>
        <div className="flex gap-2">
          <Button variant="primary" type="submit" disabled={!draft || busy}>Save changes</Button>
          <Link href={`/clubs/${club.id}`} className={buttonClass("secondary")}>View public page</Link>
        </div>
      </form>
      <Section title="Approved answers" count={club.faq.length}>
        <p className="mb-3 text-[15px] text-gray-70">Your public Club Agent answers only from these, the profile above and your events.</p>
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

const STATUS_LABEL = { open: "Open to everyone", applications: "By application", closed: "Closed this semester", unknown: "Not stated" };

export function Recruitment() {
  const user = useUser();
  const toast = useToast();
  const clubId = user?.scopeId ?? null;
  const club = live.useClub(clubId);
  const interests = campus.useInterests(clubId);
  if (club.error) return <Page><ErrorNote>{club.error}</ErrorNote></Page>;
  if (!club.data || !clubId) return <Page><ListSkeleton /></Page>;
  const c = club.data;

  return (
    <Page>
      <PageHeader title={c.name} lead="Students who reached out through your club page or its Club Agent." />
      <div className="mt-6"><ClubTabs current="recruitment" /></div>
      <div className="mt-6">
        <Rows>
          <Row label="Status">
            <select value={c.recruitment === "applications" ? "application" : c.recruitment} aria-label="Recruitment status"
              onChange={async (e) => {
                const r = await campus.updateClub(c.id, { recruitment_status: e.target.value });
                toast(r.ok ? `Recruitment: ${STATUS_LABEL[e.target.value === "application" ? "applications" : (e.target.value as "open")]}` : r.error.message, r.ok ? "good" : "bad");
              }}
              className="rounded-lg border border-line bg-paper px-2 py-1 text-[15px]">
              <option value="open">Open to everyone</option>
              <option value="application">By application</option>
              <option value="closed">Closed this semester</option>
              <option value="unknown">Not stated</option>
            </select>
          </Row>
        </Rows>
      </div>
      <PostComposer clubId={clubId} />
      <Section title="Expressions of interest" count={interests.data?.length}>
        {interests.error ? <ErrorNote>{interests.error}</ErrorNote> : !interests.data ? <ListSkeleton /> : interests.data.length === 0 ? (
          <EmptyState title="No one yet" body="When a student expresses interest on your club page, it lands here." />
        ) : (
          <ul className="divide-y divide-line">
            {interests.data.map((i) => (
              <li key={i.id} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[15px] font-semibold">{i.from ? `${i.from.name}${i.from.email ? ` · ${i.from.email}` : ""}` : "A student"}</p>
                  <StatusPill label={i.shared_contact ? "Shared contact details" : "Sent without identity"} tone={i.shared_contact ? "good" : "neutral"} />
                </div>
                <p className="mt-1 font-serif text-[17px] italic leading-snug">“{i.message || "No message"}”</p>
                <p className="mt-1 text-sm text-gray-70">
                  {i.interest_type === "membership" ? "Wants to join" : i.interest_type === "event" ? "About an event" : "A question"} · {fmtDay(i.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
