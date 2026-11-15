"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BadgeCheck, Bookmark, CalendarDays, ExternalLink, MessageCircle, Search } from "lucide-react";
import { LIVE_TAGS, api, live, tagLabel, useDb, useUser } from "@/lib/api/client";
import type { CampusEvent, Club, Interest } from "@/lib/api/types";
import { fmtDay, fmtDayHeading, fmtTimeRange } from "@/lib/time";
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

// Club data on these screens is live from the backend directory (lib/api/live.ts).

const RECRUITMENT: Record<Club["recruitment"], { label: string; tone: "good" | "attention" | "neutral" }> = {
  open: { label: "Open to join", tone: "good" },
  applications: { label: "By application", tone: "attention" },
  closed: { label: "Closed this semester", tone: "neutral" },
  unknown: { label: "Recruitment not stated", tone: "neutral" },
};

function useStudent() {
  const user = useUser();
  return { user, isStudent: user?.role === "student" };
}

/** Saved club ids for the signed-in student, with a toggle that writes to the backend. */
function useSavedIds(enabled: boolean) {
  const saved = live.useSaved(enabled);
  return { ids: new Set((saved.data ?? []).map((c) => c.id)), clubs: saved.data, error: saved.error };
}

function SaveButton({ clubId, saved, name }: { clubId: string; saved: boolean; name: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={saved}
      disabled={busy}
      aria-label={saved ? `Remove ${name} from saved clubs` : `Save ${name}`}
      onClick={async () => {
        setBusy(true);
        const result = await api.setSaved(clubId, !saved);
        setBusy(false);
        if (!result.ok) return toast(result.error.message, "bad");
        sound.play("tick", { volume: 0.5 });
      }}
      className={`${buttonClass("secondary")} ${saved ? "border-ink" : ""}`}
    >
      <Bookmark aria-hidden className={`size-4 ${saved ? "fill-ink" : ""}`} />
      {saved ? "Saved" : "Save"}
    </button>
  );
}

/** A club as a compact row: poster, name, the reason it is shown. */
function ClubRow({ id, name, tagline, reason }: { id: string; name: string; tagline?: string; reason?: string | null }) {
  return (
    <Link href={`/clubs/${id}`} className="flex items-center gap-3.5 rounded-2xl p-2 hover:bg-wash">
      <Poster seed={id} name={name} className="size-16 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-[17px] font-semibold leading-tight">{name}</span>
        {tagline && <span className="block truncate text-[15px] text-gray-70">{tagline}</span>}
        {reason && <span className="mt-0.5 block truncate text-sm">{reason}</span>}
      </span>
    </Link>
  );
}

/** Rate a recommendation (PRD 2.3). "Not relevant" ranks it lower; "Hide" removes it. */
function RecFeedback({ clubId, name }: { clubId: string; name: string }) {
  const toast = useToast();
  const [sent, setSent] = useState<string | null>(null);
  const rate = async (feedback: "helpful" | "not_relevant" | "hide", done: string) => {
    const r = await live.recommendationFeedback(clubId, feedback);
    if (!r.ok) return toast(r.error.message, "bad");
    setSent(done);
    sound.play("tick", { volume: 0.4 });
  };
  if (sent) return <span className="text-sm text-gray-70">{sent}</span>;
  return (
    <span className="flex gap-1" role="group" aria-label={`Rate the recommendation for ${name}`}>
      <button type="button" onClick={() => rate("helpful", "Thanks")} className="rounded-full px-2.5 py-1 text-sm text-gray-70 hover:bg-wash hover:text-ink">Helpful</button>
      <button type="button" onClick={() => rate("not_relevant", "Noted")} className="rounded-full px-2.5 py-1 text-sm text-gray-70 hover:bg-wash hover:text-ink">Not relevant</button>
      <button type="button" onClick={() => rate("hide", "Hidden")} className="rounded-full px-2.5 py-1 text-sm text-gray-70 hover:bg-wash hover:text-ink">Hide</button>
    </span>
  );
}

const matchedLine = (tags: string[]) => (tags.length ? `Matches your interest in ${tags.map(tagLabel).join(", ").toLowerCase()}` : null);

/** Where a live profile came from (PRD 8.1: no invented facts; 8.4: cite sources). */
function SourceNote({ club }: { club: Club }) {
  const meta = club.live;
  if (!meta) return null;
  const label =
    meta.dataLabel === "public_web"
      ? `Collected from the club's public pages${meta.collectedAt ? ` on ${fmtDay(meta.collectedAt)}` : ""}. Not reviewed by the club's officers.`
      : meta.dataLabel === "demo"
        ? "Sample club for this demo."
        : "Managed by the club's officers.";
  return (
    <div className="mt-3 text-sm text-gray-70">
      <p>{label}</p>
      {meta.sourceUrls.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {meta.sourceUrls.slice(0, 3).map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-gray-30 underline-offset-2 hover:text-ink">
                <ExternalLink aria-hidden className="size-3.5" />
                {new URL(url).hostname + new URL(url).pathname.replace(/\/$/, "")}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LiveError({ message }: { message: string }) {
  return <ErrorNote>{message}</ErrorNote>;
}

// ---- Dashboard -------------------------------------------------------------

export function StudentDashboard() {
  const db = useDb();
  const { user, isStudent } = useStudent();
  const chatId = useOpenChat(() => api.openStudentChat(), []);
  const prefs = live.usePrefs(isStudent);
  const personalized = prefs.data?.personalization_enabled ?? false;
  const recs = live.useRecommendations(isStudent && personalized);
  const saved = useSavedIds(isStudent);
  const events = live.useEvents();
  const upcoming = (events.data ?? []).filter((e) => new Date(e.end) > new Date()).slice(0, 4);
  const chats = db.conversations.filter((c) => c.ownerId === user?.id && c.kind === "club").slice(0, 3);

  return (
    <Page>
      <PageHeader
        title={`Hi ${user?.name.split(" ")[0] ?? ""}`}
        lead="Find a club, ask it a question before you show up, and see what is on this week."
      />

      <section aria-label="Your interests" className="mt-6 rounded-2xl bg-wash p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Your interests</h2>
          <Link href="/settings" className="text-sm text-gray-70 underline decoration-gray-30 underline-offset-2 hover:text-ink">Edit</Link>
        </div>
        {prefs.error ? (
          <p className="mt-2 text-sm text-gray-70">{prefs.error}</p>
        ) : !prefs.data ? (
          <div className="skeleton mt-2 h-8" />
        ) : prefs.data.interest_tags.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {prefs.data.interest_tags.map((t) => (
              <li key={t} className="rounded-full border border-line bg-paper px-3 py-1 text-sm">{tagLabel(t)}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-70">None yet. Pick a few in Settings and recommendations use only those.</p>
        )}
        {prefs.data?.goals && <p className="mt-2 text-sm text-gray-70">Looking for: {prefs.data.goals}</p>}
        {prefs.data && !prefs.data.personalization_enabled && <p className="mt-2 text-sm">Personalization is off.</p>}
      </section>

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
        {prefs.error ? (
          <LiveError message={prefs.error} />
        ) : !prefs.data ? (
          <ListSkeleton />
        ) : !personalized ? (
          <EmptyState
            title="Personalization is off"
            body="Recommendations use only the interests you choose. Turn it on in Settings to see them."
            action={<Link href="/settings" className={buttonClass("primary")}>Open settings</Link>}
          />
        ) : recs.error ? (
          <LiveError message={recs.error} />
        ) : !recs.data ? (
          <ListSkeleton />
        ) : recs.data.length === 0 ? (
          <EmptyState
            title="Pick a few interests"
            body="Recommendations use only the interests you choose, never anything inferred about you."
            action={<Link href="/settings" className={buttonClass("primary")}>Choose interests</Link>}
          />
        ) : (
          <>
            <div className="space-y-1">
              {recs.data.slice(0, 4).map((r) => (
                <div key={r.organization_id} className="flex flex-wrap items-center gap-x-2">
                  <div className="min-w-0 flex-1">
                    <ClubRow id={r.organization_id} name={r.club_name} reason={matchedLine(r.matched_tags) ?? "Related to the goals you wrote"} />
                  </div>
                  <RecFeedback clubId={r.organization_id} name={r.club_name} />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-70">Ranked by relevance to the interests you chose. A relevance score, not a prediction that you will join.</p>
          </>
        )}
      </Section>

      <Section title="Coming up" href="/events">
        {events.error ? <LiveError message={events.error} /> : !events.data ? <ListSkeleton rows={2} /> : upcoming.length ? (
          <EventList events={upcoming} />
        ) : (
          <p className="text-[15px] text-gray-70">No club has published an upcoming event yet.</p>
        )}
      </Section>

      <Section title="Saved clubs" count={saved.clubs?.length}>
        {saved.error ? <LiveError message={saved.error} /> : !saved.clubs ? <ListSkeleton rows={2} /> : saved.clubs.length ? (
          <div className="space-y-1">{saved.clubs.map((c) => <ClubRow key={c.id} id={c.id} name={c.name} tagline={c.tagline} />)}</div>
        ) : (
          <p className="text-[15px] text-gray-70">Save a club from Discover to keep it here.</p>
        )}
      </Section>

      <Section title="On the roadmap">
        <Link href="/alumni" className="block rounded-2xl border border-line p-4 transition-colors hover:border-ink">
          <span className="flex items-center gap-2">
            <span className="text-[17px] font-semibold">Alumni mentorship</span>
            <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-gray-70">Not open yet</span>
          </span>
          <span className="block text-[15px] text-gray-70">
            Agent-made introductions to alumni, with consent on both sides. See how it will work.
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

function EventRow({ event: e }: { event: CampusEvent }) {
  const club = live.useClub(e.clubId);
  return (
    <li>
      <Link href={`/events/${encodeURIComponent(e.id)}`} className="flex gap-3.5 rounded-2xl p-2 hover:bg-wash">
        <Poster seed={e.id} name={e.title} className="size-16 shrink-0" />
        <span className="min-w-0">
          <span className="block truncate text-sm text-gray-70">{club.data?.name ?? "\u00a0"}</span>
          <span className="block truncate text-[17px] font-semibold leading-tight">{e.title}</span>
          <span className="tabular block truncate text-sm text-gray-70">
            {fmtDay(e.start)}, {fmtTimeRange(e.start, e.end)}{e.location ? ` · ${e.location}` : ""}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function EventList({ events }: { events: CampusEvent[] }) {
  return <ul className="space-y-1">{events.map((e) => <EventRow key={e.id} event={e} />)}</ul>;
}

// ---- Discover --------------------------------------------------------------

export function Discover() {
  const { isStudent } = useStudent();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [savedOnly, setSavedOnly] = useState(false);
  const saved = useSavedIds(isStudent);
  const prefs = live.usePrefs(isStudent);
  const yours = new Set(prefs.data?.interest_tags ?? []);
  const chips = [...new Set([...(prefs.data?.interest_tags ?? []), ...LIVE_TAGS])];

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const search = live.useClubs(debounced, tag);
  const results = savedOnly
    ? (saved.clubs ?? []).map((club) => ({ club, matched: [] as string[] }))
    : search.data;
  const error = savedOnly ? saved.error : search.error;
  const searching = !!(debounced.trim() || tag);
  const clear = () => {
    setQuery("");
    setDebounced("");
    setTag(null);
    setSavedOnly(false);
  };

  return (
    <Page wide>
      <PageHeader
        title="Discover clubs"
        lead="The campus club directory. Matches are explained by what you searched or the interests you chose, nothing else."
        action={
          isStudent && (
            <button
              type="button"
              aria-pressed={savedOnly}
              onClick={() => setSavedOnly((v) => !v)}
              className={`${buttonClass(savedOnly ? "primary" : "secondary")}`}
            >
              <Bookmark aria-hidden className="size-4" />
              {savedOnly ? "Showing saved" : <>Saved <span className="tabular">{saved.clubs?.length ?? ""}</span></>}
            </button>
          )
        }
      />

      <div className="relative mt-6 max-w-xl">
        <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-gray-70" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clubs or interests, e.g. robotics, film, consulting"
          aria-label="Search clubs"
          maxLength={300}
          className={`${inputClass} h-12 pl-11`}
        />
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by interest">
        {chips.map((t) => {
          const on = tag === t;
          const mine = yours.has(t);
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
              {mine && <span aria-hidden className={`size-1.5 rounded-full ${on ? "bg-gold" : "bg-cardinal"}`} />}
              {tagLabel(t)}
              {mine && <span className="sr-only">(one of your interests)</span>}
            </button>
          );
        })}
      </div>

      <p className="tabular mt-6 text-sm text-gray-70" aria-live="polite">
        {results
          ? savedOnly
            ? `${results.length} saved ${results.length === 1 ? "club" : "clubs"}`
            : searching
              ? `${results.length} closest ${results.length === 1 ? "match" : "matches"}`
              : `Showing ${results.length} clubs. Search or pick an interest to narrow the directory.`
          : "Loading clubs…"}
      </p>
      {error ? (
        <div className="mt-4"><LiveError message={error} /></div>
      ) : !results ? (
        <div className="mt-4"><ListSkeleton /></div>
      ) : results.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={savedOnly ? "No saved clubs yet" : "No clubs match"}
            body={savedOnly ? "Save a club and it shows up here." : "Try a different word or interest."}
            action={<Button variant="primary" onClick={clear}>Clear filters</Button>}
          />
        </div>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map(({ club, matched }) => {
            const why = matchedLine(matched.filter((t) => yours.has(t)));
            return (
              <li key={club.id} className="flex min-w-0 flex-col rounded-3xl border border-line p-3">
                <Link href={`/clubs/${club.id}`} className="block">
                  <Poster seed={club.id} name={club.name} className="h-36 w-full" />
                  <p className="mt-3 text-xl font-semibold leading-tight">{club.name}</p>
                </Link>
                <p className="mt-1 text-[15px] text-gray-70">{club.tagline}</p>
                <p className="mt-2 line-clamp-3 text-sm">{club.description}</p>
                {why && <p className="mt-3 rounded-xl bg-wash px-3 py-2 text-sm">{why}</p>}
                {club.meets && (
                  <p className="mt-3 flex items-center gap-1.5 text-sm text-gray-70">
                    <CalendarDays aria-hidden className="size-3.5 shrink-0" />
                    <span className="truncate">Meets {club.meets}</span>
                  </p>
                )}
                <div className="mt-auto flex gap-2 pt-4">
                  <Link href={`/clubs/${club.id}#ask`} className={`${buttonClass("primary")} flex-1`}>
                    {isStudent ? "Ask this club" : "Open club"}
                  </Link>
                  {isStudent && <SaveButton clubId={club.id} saved={saved.ids.has(club.id)} name={club.name} />}
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
  const { clubId: rawId } = useParams<{ clubId: string }>();
  const clubId = decodeURIComponent(rawId);
  const { isStudent } = useStudent();
  const result = live.useClub(clubId);
  const club = result.data;
  const events = live.useClubEvents(club ? clubId : null);
  const fit = live.useFit(club && isStudent ? clubId : null);
  const saved = useSavedIds(isStudent);
  const [interestOpen, setInterestOpen] = useState(false);
  const chatId = useOpenChat(
    () => (club && isStudent ? api.openClubChat(club.id, club.name) : ""),
    [club?.id, isStudent],
  );

  if (result.error) {
    return (
      <Page>
        <EmptyState
          title={/not found/i.test(result.error) ? "Club not found" : "Can't load this club"}
          body={result.error}
          action={<Link href="/discover" className={buttonClass("primary")}>Back to Discover</Link>}
        />
      </Page>
    );
  }
  if (!club) return <Page><ListSkeleton /></Page>;
  const recruitment = RECRUITMENT[club.recruitment];
  const upcoming = (events.data ?? []).filter((e) => new Date(e.end) > new Date());

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
        <span>{club.tagline}</span>
        {club.meets && <span>Meets {club.meets}</span>}
      </p>
      <div className="mt-2"><StatusPill label={recruitment.label} tone={recruitment.tone} /></div>
      {fit.data && fit.data.fit_level !== "unknown" && fit.data.reasons.length > 0 && (
        <p className="mt-3 text-[15px]">{fit.data.reasons[0]}</p>
      )}

      {isStudent && (
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <a href="#ask" className={`${buttonClass("primary")} col-span-2 sm:col-span-1`}>Ask this club</a>
          <SaveButton clubId={club.id} saved={saved.ids.has(club.id)} name={club.name} />
          <Button onClick={() => setInterestOpen(true)}>Express interest</Button>
        </div>
      )}

      <Section title="About">
        <p className="max-w-[65ch] whitespace-pre-line text-[17px] leading-relaxed">{club.description || "The club hasn't published a description."}</p>
        {club.tags.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-1.5">
            {club.tags.map((t) => (
              <span key={t} className="rounded-full border border-line px-2.5 py-1 text-sm">{tagLabel(t)}</span>
            ))}
          </p>
        )}
        <SourceNote club={club} />
      </Section>

      {(club.live?.activities.length || club.live?.howToJoin || club.live?.timeCommitment) ? (
        <Section title="What members do">
          {club.live?.activities.length ? (
            <ul className="list-disc space-y-1 pl-5 text-[15px]">
              {club.live.activities.map((a) => <li key={a}>{a}</li>)}
            </ul>
          ) : null}
          {club.live?.timeCommitment && <p className="mt-3 text-[15px]"><span className="text-gray-70">Time commitment:</span> {club.live.timeCommitment}</p>}
          {club.live?.howToJoin && <p className="mt-2 text-[15px]"><span className="text-gray-70">How to join:</span> {club.live.howToJoin}</p>}
        </Section>
      ) : null}

      {club.faq.length > 0 && (
        <Section title="Questions people ask" count={club.faq.length}>
          <dl className="divide-y divide-line overflow-hidden rounded-2xl bg-wash text-[15px]">
            {club.faq.map((f) => (
              <div key={f.q} className="px-4 py-3">
                <dt className="font-semibold">{f.q}</dt>
                <dd className="mt-1 text-gray-70">{f.a}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      <Section title="Upcoming events" count={events.data ? upcoming.length : undefined}>
        {events.error ? <LiveError message={events.error} /> : !events.data ? <ListSkeleton rows={2} /> : upcoming.length ? (
          <EventList events={upcoming} />
        ) : (
          <p className="text-[15px] text-gray-70">The club hasn&apos;t published an upcoming event.</p>
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
  const [sending, setSending] = useState(false);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Express interest in ${club.name}`}
      description="This goes to the club's officers, and only to them."
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (sending) return;
          if (!message.trim()) return setError("Write a short message so the officers know what you are after.");
          setSending(true);
          const result = await api.submitInterest(club.id, { type, message, shareContact: share });
          setSending(false);
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
        <Button variant="primary" type="submit" size="lg" className="w-full" disabled={sending}>
          {share ? "Send with my name" : "Send without my name"}
        </Button>
      </form>
    </Sheet>
  );
}

// ---- Events ----------------------------------------------------------------

export function Events() {
  const { isStudent } = useStudent();
  const [savedOnly, setSavedOnly] = useState(false);
  const saved = useSavedIds(isStudent);
  const result = live.useEvents();
  const events = (result.data ?? [])
    .filter((e) => new Date(e.end) > new Date())
    .filter((e) => !savedOnly || saved.ids.has(e.clubId))
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
        lead="What clubs have published on their calendars."
        action={
          isStudent && (
            <button type="button" aria-pressed={savedOnly} onClick={() => setSavedOnly((v) => !v)} className={buttonClass(savedOnly ? "primary" : "secondary")}>
              <Bookmark aria-hidden className="size-4" />
              {savedOnly ? "Saved clubs only" : "All clubs"}
            </button>
          )
        }
      />
      <div className="mt-8">
        {result.error ? (
          <LiveError message={result.error} />
        ) : !result.data ? (
          <ListSkeleton />
        ) : events.length === 0 ? (
          <EmptyState
            title="No events to show"
            body={savedOnly ? "None of your saved clubs has an upcoming event." : "No club has published an upcoming event."}
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
