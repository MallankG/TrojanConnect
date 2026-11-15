"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BadgeCheck, Bookmark, CalendarDays, MessageCircle, Search } from "lucide-react";
import { api, explain, recommend, useDb, useUser } from "@/lib/api/client";
import type { CampusEvent, Club, Interest } from "@/lib/api/types";
import { INTEREST_TAGS } from "@/lib/api/mock/seed";
import { fmtDay, fmtDayHeading, fmtTime, fmtTimeRange } from "@/lib/time";
import { sound } from "@/lib/sound/engine";
import { Page } from "@/components/layout/AppShell";
import { Chat } from "@/components/chat/Chat";
import { useOpenChat } from "@/components/chat/useOpenChat";
import { Poster } from "@/components/ui/Poster";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  ListSkeleton,
  PageHeader,
  Sheet,
  StatusPill,
  buttonClass,
  inputClass,
  useToast,
} from "@/components/ui/kit";
import { Section } from "./club";

const RECRUITMENT: Record<Club["recruitment"], { label: string; tone: "good" | "attention" | "neutral" }> = {
  open: { label: "Open to join", tone: "good" },
  applications: { label: "By application", tone: "attention" },
  closed: { label: "Closed this semester", tone: "neutral" },
};

function useStudent() {
  const db = useDb();
  const user = useUser();
  const prefs = user ? db.prefs[user.id] : undefined;
  return { db, user, prefs, ready: db.seededAt !== "" };
}

function nextEvent(events: CampusEvent[], clubId: string) {
  return events
    .filter((e) => e.clubId === clubId && new Date(e.start) > new Date())
    .sort((a, b) => a.start.localeCompare(b.start))[0];
}

function SaveButton({ clubId, saved, name }: { clubId: string; saved: boolean; name: string }) {
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from saved clubs` : `Save ${name}`}
      onClick={() => {
        api.toggleSaved(clubId);
        sound.play("tick", { volume: 0.5 });
      }}
      className={`${buttonClass("secondary")} ${saved ? "border-ink" : ""}`}
    >
      <Bookmark aria-hidden className={`size-4 ${saved ? "fill-ink" : ""}`} />
      {saved ? "Saved" : "Save"}
    </button>
  );
}

/** A club as a compact row: poster, name, the reason it is shown, next event. */
function ClubRow({ club, reason }: { club: Club; reason?: string | null }) {
  return (
    <Link href={`/clubs/${club.id}`} className="flex items-center gap-3.5 rounded-2xl p-2 hover:bg-wash">
      <Poster seed={club.id} name={club.name} className="size-16 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-[17px] font-semibold leading-tight">{club.name}</span>
        <span className="block truncate text-[15px] text-gray-70">{club.tagline}</span>
        {reason && <span className="mt-0.5 block truncate text-sm">{reason}</span>}
      </span>
    </Link>
  );
}

// ---- Dashboard -------------------------------------------------------------

export function StudentDashboard() {
  const { db, user, prefs, ready } = useStudent();
  const chatId = useOpenChat(() => api.openStudentChat(), []);
  const recs = recommend(db, prefs).filter((r) => r.matched.length > 0).slice(0, 3);
  const saved = db.clubs.filter((c) => prefs?.savedClubIds.includes(c.id));
  const relevant = new Set([...recs.map((r) => r.club.id), ...saved.map((c) => c.id)]);
  const events = db.events
    .filter((e) => relevant.has(e.clubId) && new Date(e.start) > new Date())
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 4);
  const chats = db.conversations.filter((c) => c.ownerId === user?.id && c.kind === "club").slice(0, 3);

  return (
    <Page>
      <PageHeader
        title={`Hi ${user?.name.split(" ")[0] ?? ""}`}
        lead="Find a club, ask it a question before you show up, and see what is on this week."
      />

      <div className="mt-6">
        {chatId ? (
          <Chat
            conversationId={chatId}
            className="h-[26rem]"
            placeholder="Ask about clubs, e.g. something with robots"
            suggestions={["Clubs about film", "I want to build AI projects", "Recommend something for me"]}
          />
        ) : (
          <div className="skeleton h-[26rem]" />
        )}
      </div>

      <Section title="Recommended for you" href="/discover">
        {!ready ? (
          <ListSkeleton />
        ) : !prefs?.personalization ? (
          <EmptyState
            title="Personalization is off"
            body="Recommendations use only the interests you choose. Turn it on in Settings to see them."
            action={<Link href="/settings" className={buttonClass("primary")}>Open settings</Link>}
          />
        ) : recs.length === 0 ? (
          <EmptyState
            title="Pick a few interests"
            body="Recommendations use only the interests you choose, never anything inferred about you."
            action={<Link href="/settings" className={buttonClass("primary")}>Choose interests</Link>}
          />
        ) : (
          <div className="space-y-1">
            {recs.map((r) => (
              <ClubRow key={r.club.id} club={r.club} reason={explain(r.matched)} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Coming up" href="/events">
        {events.length ? <EventList events={events} /> : (
          <p className="text-[15px] text-gray-70">Events from clubs you save or match appear here.</p>
        )}
      </Section>

      <Section title="Saved clubs" count={saved.length}>
        {saved.length ? (
          <div className="space-y-1">{saved.map((c) => <ClubRow key={c.id} club={c} />)}</div>
        ) : (
          <p className="text-[15px] text-gray-70">Save a club from Discover to keep it here.</p>
        )}
      </Section>

      <Section title="Coming later">
        <Link href="/alumni" className="block rounded-2xl border border-dashed border-gray-30 p-4 hover:border-gray-70">
          <span className="block text-[17px] font-semibold">Alumni mentorship</span>
          <span className="block text-[15px] text-gray-70">
            Opt-in conversations with alumni. Not built yet; see what is planned.
          </span>
        </Link>
      </Section>

      <Section title="Recent conversations" count={chats.length} href="/conversations">
        {chats.length ? (
          <ul className="space-y-1">
            {chats.map((c) => (
              <li key={c.id}>
                <Link href={`/conversations/${c.id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-wash">
                  <MessageCircle aria-hidden className="size-5 shrink-0 text-gray-70" />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{c.title}</span>
                    <span className="block truncate text-sm text-gray-70">{c.messages[c.messages.length - 1]?.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-gray-70">Ask a club a question and the thread is kept here.</p>
        )}
      </Section>
    </Page>
  );
}

export function EventList({ events }: { events: CampusEvent[] }) {
  const db = useDb();
  return (
    <ul className="space-y-1">
      {events.map((e) => {
        const club = db.clubs.find((c) => c.id === e.clubId);
        return (
          <li key={e.id}>
            <Link href={`/events/${e.id}`} className="flex gap-3.5 rounded-2xl p-2 hover:bg-wash">
              <Poster seed={e.id} name={e.title} className="size-16 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-sm text-gray-70">{club?.name}</span>
                <span className="block truncate text-[17px] font-semibold leading-tight">{e.title}</span>
                <span className="tabular block truncate text-sm text-gray-70">
                  {fmtDay(e.start)}, {fmtTimeRange(e.start, e.end)} · {e.location}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Discover --------------------------------------------------------------

export function Discover() {
  const { db, prefs, ready } = useStudent();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [savedOnly, setSavedOnly] = useState(false);
  const saved = prefs?.savedClubIds ?? [];

  const results = recommend(db, prefs).filter(({ club }) => {
    if (savedOnly && !saved.includes(club.id)) return false;
    if (tag && !club.tags.includes(tag)) return false;
    return `${club.name} ${club.tagline} ${club.description} ${club.tags.join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  });
  const clear = () => {
    setQuery("");
    setTag(null);
    setSavedOnly(false);
  };

  return (
    <Page wide>
      <PageHeader
        title="Discover clubs"
        lead="Sample clubs for this demo. Matches are explained by the interests you chose, nothing else."
        action={
          <button
            type="button"
            aria-pressed={savedOnly}
            onClick={() => setSavedOnly((v) => !v)}
            className={`${buttonClass(savedOnly ? "primary" : "secondary")}`}
          >
            <Bookmark aria-hidden className="size-4" />
            {savedOnly ? "Showing saved" : <>Saved <span className="tabular">{saved.length}</span></>}
          </button>
        }
      />

      <div className="relative mt-6 max-w-xl">
        <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-gray-70" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clubs or interests"
          aria-label="Search clubs"
          className={`${inputClass} h-12 pl-11`}
        />
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by interest">
        {INTEREST_TAGS.map((t) => {
          const on = tag === t;
          const yours = prefs?.interests.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => setTag(on ? null : t)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-colors ${
                on ? "border-ink bg-ink text-paper" : "border-line hover:border-gray-70"
              }`}
            >
              {yours && <span aria-hidden className={`size-1.5 rounded-full ${on ? "bg-gold" : "bg-cardinal"}`} />}
              {t}
              {yours && <span className="sr-only">(one of your interests)</span>}
            </button>
          );
        })}
      </div>

      <p className="tabular mt-6 text-sm text-gray-70" aria-live="polite">
        {results.length} {results.length === 1 ? "club" : "clubs"}
      </p>
      {!ready ? (
        <div className="mt-4"><ListSkeleton /></div>
      ) : results.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No clubs match"
            body="Try a different word or interest."
            action={<Button variant="primary" onClick={clear}>Clear filters</Button>}
          />
        </div>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map(({ club, matched }) => {
            const next = nextEvent(db.events, club.id);
            const why = explain(matched);
            return (
              <li key={club.id} className="flex min-w-0 flex-col rounded-3xl border border-line p-3">
                <Link href={`/clubs/${club.id}`} className="block">
                  <Poster seed={club.id} name={club.name} className="h-36 w-full" />
                  <p className="mt-3 text-xl font-semibold leading-tight">{club.name}</p>
                </Link>
                <p className="mt-1 text-[15px] text-gray-70">{club.tagline}</p>
                {why && (
                  <p className="mt-3 rounded-xl bg-wash px-3 py-2 text-sm">{why}</p>
                )}
                <p className="tabular mt-3 flex items-center gap-1.5 text-sm text-gray-70">
                  <CalendarDays aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {next ? `${next.title}, ${fmtDay(next.start)} ${fmtTime(next.start)}` : `Meets ${club.meets}`}
                  </span>
                </p>
                <div className="mt-auto flex gap-2 pt-4">
                  <Link href={`/clubs/${club.id}#ask`} className={`${buttonClass("primary")} flex-1`}>
                    Ask this club
                  </Link>
                  <SaveButton clubId={club.id} saved={saved.includes(club.id)} name={club.name} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}

// ---- Club page -------------------------------------------------------------

export function ClubPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { db, user, prefs, ready } = useStudent();
  const club = db.clubs.find((c) => c.id === clubId);
  const [interestOpen, setInterestOpen] = useState(false);
  const isStudent = user?.role === "student";
  const chatId = useOpenChat(
    () => (club && isStudent ? api.openClubChat(club.id) : ""),
    [club?.id, isStudent],
  );

  if (!ready) return <Page><ListSkeleton /></Page>;
  if (!club) {
    return (
      <Page>
        <EmptyState
          title="Club not found"
          body="It isn't in the demo directory."
          action={<Link href="/discover" className={buttonClass("primary")}>Back to Discover</Link>}
        />
      </Page>
    );
  }
  const events = db.events
    .filter((e) => e.clubId === club.id && new Date(e.start) > new Date())
    .sort((a, b) => a.start.localeCompare(b.start));
  const why = explain(recommend(db, prefs).find((r) => r.club.id === club.id)?.matched ?? []);
  const recruitment = RECRUITMENT[club.recruitment];

  return (
    <Page>
      <Poster seed={club.id} name={club.name} className="h-48 w-full md:h-60" />
      <h1 className="mt-5 text-[clamp(2rem,4.4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.025em]">
        {club.name}
      </h1>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-gray-70">
        {club.verified && (
          <span className="inline-flex items-center gap-1 text-ink">
            <BadgeCheck aria-hidden className="size-4" />
            Verified organization
          </span>
        )}
        <span className="tabular">{club.members} members</span>
        <span>Meets {club.meets}</span>
      </p>
      <div className="mt-2"><StatusPill label={recruitment.label} tone={recruitment.tone} /></div>
      {why && isStudent && <p className="mt-3 text-[15px]">{why}.</p>}

      {isStudent && (
        <div className="mt-5 grid grid-cols-3 gap-2">
          <a href="#ask" className={buttonClass("primary")}>Ask this club</a>
          <SaveButton clubId={club.id} saved={prefs?.savedClubIds.includes(club.id) ?? false} name={club.name} />
          <Button onClick={() => setInterestOpen(true)}>Express interest</Button>
        </div>
      )}

      <Section title="About">
        <p className="max-w-[65ch] text-[17px] leading-relaxed">{club.description}</p>
        <p className="mt-3 flex flex-wrap gap-1.5">
          {club.tags.map((t) => (
            <span key={t} className="rounded-full border border-line px-2.5 py-1 text-sm">{t}</span>
          ))}
        </p>
      </Section>

      <Section title="Upcoming events" count={events.length}>
        {events.length ? <EventList events={events} /> : (
          <p className="text-[15px] text-gray-70">Nothing on the calendar yet. The club meets {club.meets}.</p>
        )}
      </Section>

      {isStudent && (
        <section id="ask" className="mt-10 scroll-mt-24">
          <h2 className="mb-3 text-xl font-semibold tracking-[-0.01em]">Ask the club</h2>
          {chatId ? (
            <Chat
              conversationId={chatId}
              className="h-[28rem]"
              placeholder={`Ask ${club.name} a question`}
              suggestions={club.faq.slice(0, 2).map((f) => f.q).concat("When is your next event?")}
            />
          ) : (
            <div className="skeleton h-[28rem]" />
          )}
        </section>
      )}

      <InterestSheet club={club} open={interestOpen} onOpenChange={setInterestOpen} />
    </Page>
  );
}

export function InterestSheet({
  club,
  open,
  onOpenChange,
  initialType = "membership",
}: {
  club: Club;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: Interest["type"];
}) {
  const user = useUser();
  const toast = useToast();
  const [type, setType] = useState<Interest["type"]>(initialType);
  const [message, setMessage] = useState("");
  const [share, setShare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Express interest in ${club.name}`}
      description="This goes to the club's officers, and only to them."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!message.trim()) return setError("Write a short message so the officers know what you are after.");
          const result = api.submitInterest(club.id, { type, message, shareContact: share });
          if (!result.ok) return setError(result.error.message);
          sound.play("send");
          toast(share ? "Sent with your name" : "Sent without your name");
          setMessage("");
          setError(null);
          onOpenChange(false);
        }}
      >
        <Field label="What is this about?">
          <select value={type} onChange={(e) => setType(e.target.value as Interest["type"])} className={inputClass}>
            <option value="membership">I want to join</option>
            <option value="event">An event</option>
            <option value="question">A question</option>
          </select>
        </Field>
        <Field label="Message">
          <textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="A sentence or two"
            className={inputClass}
          />
        </Field>
        <label className="flex items-start gap-2.5 text-[15px]">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-1 size-4 accent-cardinal" />
          <span>
            Share my name ({user?.name}) with the officers
            <span className="block text-sm text-gray-70">
              Left unticked, they see the message from “A student” and cannot reply to you directly.
            </span>
          </span>
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button variant="primary" type="submit" size="lg" className="w-full">
          {share ? "Send with my name" : "Send without my name"}
        </Button>
      </form>
    </Sheet>
  );
}

// ---- Events ----------------------------------------------------------------

export function Events() {
  const { db, prefs, ready } = useStudent();
  const [savedOnly, setSavedOnly] = useState(false);
  const events = db.events
    .filter((e) => new Date(e.end) > new Date())
    .filter((e) => !savedOnly || prefs?.savedClubIds.includes(e.clubId))
    .sort((a, b) => a.start.localeCompare(b.start));

  const groups = new Map<string, CampusEvent[]>();
  for (const e of events) {
    const key = fmtDay(e.start);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <Page>
      <PageHeader
        title="Events"
        lead="What clubs have on the calendar. Sample events for this demo."
        action={
          <button type="button" aria-pressed={savedOnly} onClick={() => setSavedOnly((v) => !v)} className={buttonClass(savedOnly ? "primary" : "secondary")}>
            <Bookmark aria-hidden className="size-4" />
            {savedOnly ? "Saved clubs only" : "All clubs"}
          </button>
        }
      />
      <div className="mt-8">
        {!ready ? (
          <ListSkeleton />
        ) : events.length === 0 ? (
          <EmptyState
            title="No events to show"
            body={savedOnly ? "None of your saved clubs has an upcoming event." : "Nothing is on the calendar."}
            action={savedOnly ? <Button variant="primary" onClick={() => setSavedOnly(false)}>Show all clubs</Button> : undefined}
          />
        ) : (
          <div className="relative space-y-6 pl-6">
            <span aria-hidden className="absolute bottom-2 left-[5px] top-2 border-l border-dashed border-gray-30" />
            {[...groups.entries()].map(([key, items]) => {
              const heading = fmtDayHeading(items[0].start);
              return (
                <div key={key} className="relative">
                  <span aria-hidden className="absolute -left-6 top-1.5 size-[11px] rounded-full border-2 border-paper bg-gray-70" />
                  <h2 className="text-[15px]">
                    <span className="font-semibold">{heading.primary}</span>
                    <span className="text-gray-70"> {heading.secondary}</span>
                  </h2>
                  <div className="mt-2"><EventList events={items} /></div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Page>
  );
}
