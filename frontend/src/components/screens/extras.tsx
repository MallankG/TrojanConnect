"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CalendarPlus, ChevronRight, Clock, MapPin } from "lucide-react";
import { api, live, setRole, useDb, useUser } from "@/lib/api/client";
import type { ChatMessage, Conversation, Db } from "@/lib/api/types";
import { USERS } from "@/lib/api/mock/seed";
import { FEATURE_LABEL } from "@/lib/api/mock/inventory";
import { describeState } from "@/lib/booking/state-machine";
import { fmtDayHeading, fmtRange, fmtTime, fmtTimeRange } from "@/lib/time";
import { sound } from "@/lib/sound/engine";
import { HOME, Page, ROLE_LABEL } from "@/components/layout/AppShell";
import { Poster } from "@/components/ui/Poster";
import { Mark, Wordmark } from "@/components/brand/Logo";
import { Avatar, Button, EmptyState, ListSkeleton, PageHeader, SimulatedTag, buttonClass, useToast } from "@/components/ui/kit";
import { Section } from "./club";
import { EventList, InterestSheet } from "./student";

// ---- Event page ------------------------------------------------------------

const icsStamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function EventPage() {
  const { eventId: rawId } = useParams<{ eventId: string }>();
  const eventId = decodeURIComponent(rawId);
  const user = useUser();
  const [interestOpen, setInterestOpen] = useState(false);
  // Live: GET /events (no single-event route), then the host club's profile and calendar.
  const events = live.useEvents();
  const event = events.data?.find((e) => e.id === eventId);
  const clubResult = live.useClub(event?.clubId ?? null);
  const clubEvents = live.useClubEvents(event?.clubId ?? null);
  const club = clubResult.data;

  if (!events.data && !events.error) return <Page><ListSkeleton /></Page>;
  if (event && !club && !clubResult.error) return <Page><ListSkeleton /></Page>;
  if (!event || !club) {
    return (
      <Page>
        <EmptyState
          title={events.error ? "Can't load events" : "Event not found"}
          body={events.error ?? clubResult.error ?? "It may have passed or been removed from the club's calendar."}
          action={<Link href={user ? HOME[user.role] : "/demo"} className={buttonClass("primary")}>Go to home</Link>}
        />
      </Page>
    );
  }

  const heading = fmtDayHeading(event.start);
  const isStudent = user?.role === "student";
  const more = (clubEvents.data ?? [])
    .filter((e) => e.id !== event.id && new Date(e.start) > new Date())
    .sort((a, b) => a.start.localeCompare(b.start));

  const download = () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//TrojanConnect//Demo//EN",
      "BEGIN:VEVENT",
      `UID:${event.id}@trojanconnect.demo`,
      `DTSTAMP:${icsStamp(new Date().toISOString())}`,
      `DTSTART:${icsStamp(event.start)}`,
      `DTEND:${icsStamp(event.end)}`,
      `SUMMARY:${event.title}`,
      `LOCATION:${event.location}`,
      `DESCRIPTION:${event.description} (from ${club.name}'s published calendar)`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    sound.play("tick");
  };

  return (
    <Page>
      <Link href={isStudent ? "/events" : `/clubs/${club.id}`} className="inline-flex items-center text-sm text-gray-70 hover:text-ink">
        {isStudent ? "Events" : club.name}
        <ChevronRight aria-hidden className="size-4" />
      </Link>
      <Poster seed={event.id} name={event.title} className="mt-3 h-48 w-full md:h-60" />
      <h1 className="mt-5 text-[clamp(2rem,4.4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.025em]">
        {event.title}
      </h1>
      <Link href={`/clubs/${club.id}`} className="mt-2 inline-flex items-center gap-2 text-[15px] hover:underline">
        <Poster seed={club.id} name={club.name} className="size-6 rounded-md" />
        Hosted by {club.name}
      </Link>

      <dl className="mt-5 space-y-2 text-[17px]">
        <div className="flex items-start gap-3">
          <dt><Clock aria-hidden className="mt-1 size-5 text-gray-70" /><span className="sr-only">When</span></dt>
          <dd className="tabular">
            <span className="font-semibold">{heading.primary}</span>
            <span className="text-gray-70"> {heading.secondary}</span>
            <span className="block text-gray-70">{fmtTimeRange(event.start, event.end)}, Los Angeles time</span>
          </dd>
        </div>
        <div className="flex items-start gap-3">
          <dt><MapPin aria-hidden className="mt-1 size-5 text-gray-70" /><span className="sr-only">Where</span></dt>
          <dd className="flex flex-wrap items-center gap-2">
            {event.location || "Location not published"}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="primary" onClick={download}>
          <CalendarPlus aria-hidden className="size-4" />
          Add to calendar
        </Button>
        {isStudent && <Link href={`/clubs/${club.id}#ask`} className={buttonClass("secondary")}>Ask the club</Link>}
        {isStudent && <Button onClick={() => setInterestOpen(true)}>Tell the club you are coming</Button>}
      </div>

      <Section title="About this event">
        <p className="max-w-[65ch] text-[17px] leading-relaxed">{event.description || "The club hasn't published details for this event."}</p>
      </Section>

      {more.length > 0 && (
        <Section title={`More from ${club.name}`} count={more.length}>
          <EventList events={more} />
        </Section>
      )}

      <InterestSheet club={club} open={interestOpen} onOpenChange={setInterestOpen} initialType="event" />
    </Page>
  );
}

// ---- Alumni preview (PRD P2) -----------------------------------------------

const ALUMNI_PLAN = [
  {
    title: "Both sides opt in",
    body: "An alumnus chooses to be listed and a student chooses to ask. Nobody is matched without saying yes.",
  },
  {
    title: "Alumni share only what they pick",
    body: "Profile details are private by default. Each field is shared one at a time, and can be withdrawn.",
  },
  {
    title: "The agent introduces, people talk",
    body: "An Alumni Agent can find a relevant match and draft the introduction. It never speaks for the alumnus.",
  },
];

export function AlumniPreview() {
  const db = useDb();
  const user = useUser();
  const toast = useToast();
  const asked = user ? db.prefs[user.id]?.alumniInterest ?? false : false;

  return (
    <Page>
      <PageHeader
        title="Alumni mentorship"
        lead="Opt-in conversations between students and alumni, introduced by an agent that never speaks for either side."
      />
      <p className="mt-5 flex items-start gap-2.5 rounded-2xl border border-line px-4 py-3 text-[15px]">
        <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-mark-orange" />
        <span>
          <span className="font-semibold">Not open yet. </span>
          Alumni accounts are closed while we get consent and privacy right, so nothing on this
          page sends a message. Room booking, club discovery and student government came first.
        </span>
      </p>

      <Section title="How it will work">
        <div className="border-t border-ink">
          {ALUMNI_PLAN.map((item) => (
            <div key={item.title} className="grid gap-x-8 gap-y-1 border-b border-line py-5 md:grid-cols-[1fr_1.4fr]">
              <h3 className="text-xl font-semibold leading-tight tracking-[-0.01em]">{item.title}</h3>
              <p className="text-[17px] leading-snug text-gray-70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {user?.role === "student" && (
        <Section title="Want this?">
          <label className="flex items-start gap-3 text-[15px]">
            <input
              type="checkbox"
              checked={asked}
              onChange={(e) => {
                api.updatePrefs({ alumniInterest: e.target.checked });
                toast(e.target.checked ? "Noted. We'll count you in." : "Removed");
              }}
              className="mt-1 size-4 accent-cardinal"
            />
            <span>
              Count me as interested in alumni mentorship
              <span className="block text-sm text-gray-70">
                Saved with your demo profile. It shares nothing with anyone.
              </span>
            </span>
          </label>
        </Section>
      )}
    </Page>
  );
}

// ---- Sign in ---------------------------------------------------------------

export function SignIn() {
  const router = useRouter();
  const current = useUser();

  return (
    <div className="grid min-h-dvh bg-paper md:grid-cols-2">
      <div className="on-cardinal hidden flex-col justify-between bg-cardinal p-10 text-gold md:flex">
        <Link href="/" aria-label="Trojan Connect, back to the story"><Wordmark tone="light" height={40} plate priority /></Link>
        <p className="max-w-[12ch] text-[clamp(2.5rem,5vw,4.5rem)] font-bold leading-[0.92] tracking-[-0.035em]" style={{ fontVariationSettings: '"wdth" 82' }}>
          Agents prepare. People decide.
        </p>
        <p className="max-w-sm text-sm text-paper">
          A hackathon project, not affiliated with or endorsed by USC.
        </p>
      </div>
      <main className="flex min-w-0 flex-col justify-center px-6 py-14 md:px-14">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" aria-label="Trojan Connect, back to the story" className="md:hidden"><Wordmark tone="light" height={34} /></Link>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.025em] md:mt-0">Sign in</h1>
          <p className="mt-2 text-[15px] text-gray-70">
            Single sign-on with a USC account is on the way. Today you can continue as one of
            four demo accounts — no password, and nothing leaves your browser.
          </p>
          <ul className="mt-6 space-y-2">
            {USERS.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => {
                    setRole(u.id);
                    sound.play("send");
                    router.push(HOME[u.role]);
                  }}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left hover:border-ink ${
                    current?.id === u.id ? "border-ink" : "border-line"
                  }`}
                >
                  <Avatar name={u.name} className="size-11 text-sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-semibold leading-tight">{u.name}</span>
                    <span className="block truncate text-sm text-gray-70">
                      {ROLE_LABEL[u.role]}
                      {u.scopeName ? `, ${u.scopeName}` : ""}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-5 text-gray-70" />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-gray-70">
            Want the guided version?{" "}
            <Link href="/demo" className="text-ink underline underline-offset-2">See what each role can do</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

// ---- WhatsApp preview ------------------------------------------------------

/** How a chat message reads as plain text on a phone, where cards cannot render. */
function asText(db: Db, message: ChatMessage): string | null {
  const card = message.card;
  if (!card) return message.text;
  if (card.type === "summary" || card.type === "proposal" || card.type === "status") {
    const booking = db.bookings.find((b) => b.id === card.bookingId);
    if (!booking) return message.text;
    const e = booking.event;
    if (card.type === "summary") {
      return [
        message.text,
        "",
        `Event: ${e.title ?? "not set"}`,
        e.start && e.end ? `When: ${fmtRange(e.start, e.end)}` : "When: not set",
        `People: ${e.attendance ?? "not set"}`,
        `Needs: ${e.features.map((f) => FEATURE_LABEL[f]).join(", ") || "nothing"}`,
        "",
        "To send this to the venue team, confirm it in the web app.",
      ].join("\n");
    }
    if (card.type === "proposal") {
      const p = booking.proposals.find((x) => x.id === card.proposalId);
      const venue = db.venues.find((v) => v.id === p?.venueId);
      if (!p || !venue) return message.text;
      return [
        `${p.kind === "OFFER" ? "Offer" : "Counteroffer"}: ${venue.name}, ${p.capacity} seats`,
        fmtRange(p.start, p.end),
        p.differences.length ? `Different from your request. ${p.differences.join("; ")}` : "Matches everything you asked for.",
        "Availability is simulated.",
        "",
        "Reply 1 to accept for review, or 2 for another option.",
      ].join("\n");
    }
    const status = describeState(booking.state);
    return [
      `${e.title}: ${status.label}`,
      status.next,
      booking.review?.decision ? `Reviewer: “${booking.review.decision.reason}”` : "",
      booking.confirmationReference ? `Reference ${booking.confirmationReference}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return message.text;
}

/**
 * The same conversation as it would arrive on WhatsApp. Web and WhatsApp are
 * two channels into one session (PRD 15), so this reads the same messages.
 */
export function WhatsAppPreview({ conversation }: { conversation: Conversation }) {
  const db = useDb();
  return (
    <div>
      <div className="mx-auto w-full max-w-[360px] rounded-[2.5rem] border border-gray-30 bg-ink p-2.5">
        <div className="flex h-[36rem] flex-col overflow-hidden rounded-[2rem] bg-wash">
          <div className="flex items-center gap-2.5 bg-paper px-4 py-3">
            <Mark tone="light" size={36} />
            <div>
              <p className="text-[15px] font-semibold leading-tight">Trojan Connect</p>
              <p className="text-xs text-gray-70">{conversation.agentName} · business account</p>
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {conversation.messages.map((m) => {
              const text = asText(db, m);
              if (!text) return null;
              const mine = m.sender === "user";
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <p
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[14px] leading-snug ${
                      mine ? "rounded-br-sm bg-gold-50 text-ink" : "rounded-bl-sm bg-paper text-ink"
                    }`}
                  >
                    {m.sender === "reviewer" && <span className="block text-xs text-gray-70">{m.name}, venue reviewer</span>}
                    {text}
                    <span className="tabular mt-0.5 block text-right text-[10px] text-gray-70">{fmtTime(m.at)}</span>
                  </p>
                </div>
              );
            })}
          </div>
          <p className="bg-paper px-4 py-2.5 text-center text-xs text-gray-70">Preview only. Reply in the web chat.</p>
        </div>
      </div>
      <p className="mx-auto mt-3 max-w-[360px] text-sm text-gray-70">
        <SimulatedTag label="Simulated channel" /> The WhatsApp Cloud API is not connected in this
        demo. This shows the same thread as it would be delivered, with cards flattened to text.
        Sending a request or anything that needs stronger verification is confirmed in the web app.
      </p>
    </div>
  );
}
