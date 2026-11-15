"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, ClipboardCheck, Compass, Landmark, MessageCircle, Users } from "lucide-react";
import { LIVE_TAGS, api, live, setRole, tagLabel, useDb, useUser } from "@/lib/api/client";
import type { Conversation, Role } from "@/lib/api/types";
import { USERS } from "@/lib/api/mock/seed";
import { SENTENCE } from "@/components/landing/content";
import { fmtRelative } from "@/lib/time";
import { useSound } from "@/lib/sound/SoundProvider";
import { sound } from "@/lib/sound/engine";
import { HOME, Page, ROLE_LABEL } from "@/components/layout/AppShell";
import { Chat } from "@/components/chat/Chat";
import { Wordmark } from "@/components/brand/Logo";
import { Avatar, Button, EmptyState, ErrorNote, Field, ListSkeleton, PageHeader, Row, Rows, Tabs, buttonClass, inputClass, useToast } from "@/components/ui/kit";
import { BookingStepper, RequestSummary, StatusCard } from "@/components/booking/parts";
import { Section } from "./club";
import { ClubDashboard } from "./clubLive";
import { StudentDashboard } from "./student";
import { WhatsAppPreview } from "./extras";

// ---- Role picker -----------------------------------------------------------

const ROLE_INFO: Record<Role, { icon: typeof Users; does: string }> = {
  club_rep: { icon: Users, does: "Describe an event, let the Club Agent negotiate a room, accept a proposal." },
  venue_reviewer: { icon: ClipboardCheck, does: "Open the queue and approve, reject or request changes. Only this role can." },
  student: { icon: Compass, does: "Find clubs by interest, ask a Club Agent a question, express interest." },
  gov_rep: { icon: Landmark, does: "Manage approved sources, read routed feedback, publish announcements." },
};

const TWO_WINDOW = [
  "Open this page in two browser windows, side by side.",
  "Pick Club representative in one and Venue reviewer in the other.",
  "As the club, open the Assistant and tap “Book a 35 person event…”, then pick a room.",
  "Fill in the missing details, confirm the summary, and accept the venue agent's proposal.",
  "As the reviewer, approve it and enter a reservation number. The club's booking turns to Confirmed.",
];

export function RolePicker() {
  const router = useRouter();
  const current = useUser();
  const toast = useToast();

  const enter = (user: (typeof USERS)[number]) => {
    setRole(user.id);
    sound.play("send");
    router.push(HOME[user.role]);
  };

  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
        <Link href="/" aria-label="Trojan Connect, back to the story"><Wordmark tone="light" height={36} priority /></Link>
        <nav className="flex gap-5 text-sm text-gray-70">
          <Link href="/sign-in" className="hover:text-ink">Sign in</Link>
          <Link href="/" className="hover:text-ink">Back to the story</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-5 pb-24 pt-8 md:pt-14">
        <h1 className="max-w-[16ch] text-[clamp(2.25rem,6vw,4.5rem)] font-bold leading-[0.95] tracking-[-0.035em]" style={{ fontVariationSettings: '"wdth" 84' }}>
          Who are you in this demo?
        </h1>
        <p className="mt-4 max-w-xl text-lg text-gray-70">
          Four roles, three students with different interests. There is no sign-up: each is a
          seeded account, and you can switch at any time.
        </p>

        <ul className="mt-10 grid gap-3 sm:grid-cols-2">
          {USERS.map((u) => {
            const info = ROLE_INFO[u.role];
            return (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => enter(u)}
                  className={`group flex h-full w-full flex-col rounded-3xl border p-5 text-left transition-colors hover:border-ink ${
                    current?.id === u.id ? "border-ink" : "border-line"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className="grid size-11 place-items-center rounded-full bg-cardinal text-gold">
                      <info.icon aria-hidden className="size-5" />
                    </span>
                    <span>
                      <span className="block text-xl font-semibold leading-tight">{ROLE_LABEL[u.role]}</span>
                      <span className="block text-sm text-gray-70">
                        {u.name}
                        {u.scopeName ? `, ${u.scopeName}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="mt-4 block text-[15px]">{info.does}</span>
                  {u.interests && (
                    <span className="mt-3 flex flex-wrap gap-1.5">
                      {u.interests.map((t) => (
                        <span key={t} className="rounded-full border border-line px-2.5 py-0.5 text-xs">{tagLabel(t)}</span>
                      ))}
                    </span>
                  )}
                  <span className="mt-auto flex items-center gap-1.5 pt-4 text-[15px] font-semibold text-cardinal">
                    {current?.id === u.id ? "Continue" : "Enter"} as {u.name.split(" ")[0]}
                    <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <section className="mt-14 grid gap-8 border-t border-ink pt-8 md:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 className="text-2xl font-semibold leading-tight tracking-[-0.02em]">
              Run the booking across two windows
            </h2>
            <p className="mt-2 text-[15px] text-gray-70">
              Both windows use the same backend, so each sees the other&apos;s changes within a few seconds.
            </p>
          </div>
          <ol className="space-y-3">
            {TWO_WINDOW.map((step, i) => (
              <li key={step} className="grid grid-cols-[1.75rem_1fr] text-[17px] leading-snug">
                <span className="tabular font-semibold text-cardinal">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-wash px-5 py-4">
          <p className="max-w-xl text-sm text-gray-70">
            A hackathon project, not affiliated with or endorsed by USC. Club and student-government
            information comes from public pages; the people are demo accounts, and rooms and availability
            are simulated. No real reservation is made.
          </p>
          <Button
            onClick={() => {
              api.resetDemo();
              toast("Demo data reset");
            }}
          >
            Reset demo data
          </Button>
        </div>
      </main>
    </div>
  );
}

// ---- Dashboard switch ------------------------------------------------------

export function Dashboard() {
  const user = useUser();
  const router = useRouter();
  const elsewhere = user && (user.role === "venue_reviewer" || user.role === "gov_rep");
  useEffect(() => {
    if (elsewhere) router.replace(HOME[user.role]);
  }, [elsewhere, user, router]);
  if (!user || elsewhere) return <Page><ListSkeleton /></Page>;
  return user.role === "club_rep" ? <ClubDashboard /> : <StudentDashboard />;
}

// ---- Conversations ---------------------------------------------------------

const KIND_LABEL: Record<Conversation["kind"], string> = {
  booking: "Event request",
  club: "Club question",
  student: "Student Agent",
  government: "Student government",
};

export function Conversations() {
  const db = useDb();
  const user = useUser();
  const mine = db.conversations
    .filter((c) => c.ownerId === user?.id && c.messages.some((m) => m.sender === "user"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <Page>
      <PageHeader title="Chats" lead="Every conversation with an agent is kept, on web and on WhatsApp alike." />
      <div className="mt-6">
        {db.seededAt === "" ? (
          <ListSkeleton />
        ) : mine.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            body={
              user?.role === "club_rep"
                ? "Start an event request and the thread with your Club Agent appears here."
                : "Ask a club or the Student Agent a question and the thread appears here."
            }
            action={<Link href={user ? HOME[user.role] : "/demo"} className={buttonClass("primary")}>Go to home</Link>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((c) => {
              const last = c.messages[c.messages.length - 1];
              return (
                <li key={c.id}>
                  <Link href={`/conversations/${c.id}`} className="flex items-center gap-3.5 rounded-xl px-2 py-3.5 hover:bg-wash">
                    <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-cardinal text-gold">
                      <MessageCircle className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[15px] font-semibold">{c.title}</span>
                        <span className="shrink-0 text-xs text-gray-70">{fmtRelative(c.updatedAt)}</span>
                      </span>
                      <span className="block truncate text-sm text-gray-70">
                        {KIND_LABEL[c.kind]} · {last?.card?.type === "status" ? "Status update" : last?.text}
                      </span>
                    </span>
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

export function ConversationDetail() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const db = useDb();
  const user = useUser();
  const conversation = db.conversations.find((c) => c.id === conversationId);
  const booking = db.bookings.find((b) => b.id === conversation?.bookingId);
  const [channel, setChannel] = useState<"web" | "whatsapp">("web");

  if (db.seededAt === "") return <Page><ListSkeleton /></Page>;
  if (!conversation || conversation.ownerId !== user?.id) {
    return (
      <Page>
        <EmptyState
          title="Conversation not found"
          body="Conversations are private to the person who started them."
          action={<Link href="/conversations" className={buttonClass("primary")}>Back to chats</Link>}
        />
      </Page>
    );
  }

  return (
    <Page wide={!!booking}>
      <Link href="/conversations" className="inline-flex items-center text-sm text-gray-70 hover:text-ink">
        Chats
        <ChevronRight aria-hidden className="size-4" />
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] md:text-3xl">{conversation.title}</h1>

      {booking && <div className="mt-5"><BookingStepper booking={booking} /></div>}

      {booking && (
        <div className="mt-5">
          <Tabs
            label="Channel"
            value={channel}
            onChange={setChannel}
            tabs={[
              { id: "web", label: "Web chat" },
              { id: "whatsapp", label: "WhatsApp preview" },
            ]}
          />
        </div>
      )}

      <div className={`mt-5 grid gap-6 ${booking ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]" : ""}`}>
        {channel === "whatsapp" && booking ? (
          <WhatsAppPreview conversation={conversation} />
        ) : (
          <Chat
            conversationId={conversation.id}
            className="h-[min(40rem,calc(100dvh-15rem))] min-h-[26rem]"
            placeholder={booking ? "Describe the event, or answer the agent" : "Write a message"}
            suggestions={booking ? [SENTENCE] : []}
          />
        )}
        {booking && (
          <aside aria-label="Booking details" className="space-y-4">
            <StatusCard booking={booking} />
            <div>
              <h2 className="mb-2 text-lg font-semibold">The request so far</h2>
              <RequestSummary booking={booking} />
              <p className="mt-2 px-1 text-sm text-gray-70">
                Filled in by the Club Agent from this conversation. Nothing is sent until you confirm it.
              </p>
            </div>
          </aside>
        )}
      </div>
    </Page>
  );
}

// ---- Settings --------------------------------------------------------------

export function Settings() {
  const db = useDb();
  const user = useUser();
  const toast = useToast();
  const { on, toggle } = useSound();
  const prefs = user ? db.prefs[user.id] : undefined;

  return (
    <Page>
      <PageHeader title="Settings" />

      <Section title="Account">
        <Rows>
          <Row label="Signed in as">
            <span className="flex items-center gap-2.5">
              {user && <Avatar name={user.name} className="size-7 text-[10px]" />}
              {user?.name}
            </span>
          </Row>
          <Row label="Role">{user ? ROLE_LABEL[user.role] : ""}{user?.scopeName ? `, ${user.scopeName}` : ""}</Row>
          <Row label="Sign-in">Demo account. USC single sign-on is on the way.</Row>
        </Rows>
        <Link href="/demo" className={`${buttonClass("secondary")} mt-3`}>Switch role</Link>
      </Section>

      {user?.role === "student" && <StudentPrefsSettings />}

      <Section title="WhatsApp">
        <label className="flex items-start gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={prefs?.whatsappOptIn ?? false}
            onChange={(e) => {
              api.updatePrefs({ whatsappOptIn: e.target.checked });
              toast(e.target.checked ? "Opted in to WhatsApp updates" : "Opted out of WhatsApp updates");
            }}
            className="mt-1 size-4 accent-cardinal"
          />
          <span>
            Send me updates on WhatsApp
            <span className="block max-w-[58ch] text-sm text-gray-70">
              Simulated in this demo: no number is linked and no message is sent. When connected,
              updates go only to a verified number, and anything sensitive is confirmed here in
              the web app.
            </span>
          </span>
        </label>
      </Section>

      <Section title="Sound">
        <label className="flex items-start gap-3 text-[15px]">
          <input type="checkbox" checked={on} onChange={toggle} className="mt-1 size-4 accent-cardinal" />
          <span>
            Play interface sounds
            <span className="block text-sm text-gray-70">Short cues when messages arrive and decisions are made.</span>
          </span>
        </label>
      </Section>

      <Section title="Demo data">
        <p className="mb-3 max-w-[60ch] text-[15px] text-gray-70">
          Restores the seeded clubs, bookings and conversations in every open window.
        </p>
        <Button
          onClick={() => {
            api.resetDemo();
            toast("Demo data reset");
          }}
        >
          Reset demo data
        </Button>
      </Section>
    </Page>
  );
}

/** Interests, goals and personalization, stored on the backend (GET/PUT /me/preferences). */
function StudentPrefsSettings() {
  const toast = useToast();
  const prefs = live.usePrefs(true);
  const saved = live.useSaved(true);
  const [busy, setBusy] = useState(false);
  const interests = prefs.data?.interest_tags ?? [];
  const chips = [...new Set([...interests, ...LIVE_TAGS])];
  const save = async (patch: Parameters<typeof live.updatePrefs>[0], done?: string) => {
    setBusy(true);
    const result = await live.updatePrefs(patch);
    setBusy(false);
    if (!result.ok) toast(result.error.message, "bad");
    else if (done) toast(done);
  };

  if (prefs.error) return <Section title="Your interests"><ErrorNote>{prefs.error}</ErrorNote></Section>;
  if (!prefs.data) return <Section title="Your interests"><ListSkeleton rows={2} /></Section>;

  return (
    <>
      <Section title="Your interests">
        <p className="mb-3 max-w-[60ch] text-[15px] text-gray-70">
          Recommendations use only what you pick here. Nothing is inferred about you, and you
          can clear it at any time.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Interests">
          {chips.map((tag) => {
            const picked = interests.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={picked}
                disabled={busy}
                onClick={() => {
                  void save({ interest_tags: picked ? interests.filter((t) => t !== tag) : [...interests, tag] });
                  sound.play("tick", { volume: 0.5 });
                }}
                className={`rounded-full border px-3.5 py-2 text-sm transition-colors disabled:opacity-60 ${
                  picked ? "border-cardinal bg-cardinal text-paper" : "border-line hover:border-gray-70"
                }`}
              >
                {tagLabel(tag)}
              </button>
            );
          })}
        </div>
        <div className="mt-4">
          <Field label="What are you looking for?" hint="Optional">
            <input
              key={prefs.data.goals}
              defaultValue={prefs.data.goals}
              maxLength={1000}
              onBlur={(e) => e.target.value !== prefs.data?.goals && save({ goals: e.target.value }, "Saved")}
              className={inputClass}
            />
          </Field>
        </div>
      </Section>

      <Section title="Personalization">
        <label className="flex items-start gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={prefs.data.personalization_enabled}
            disabled={busy}
            onChange={(e) => save({ personalization_enabled: e.target.checked })}
            className="mt-1 size-4 accent-cardinal"
          />
          <span>
            Recommend clubs from my interests
            <span className="block text-sm text-gray-70">
              Off: no recommendations or match reasons are shown.
            </span>
          </span>
        </label>
        <Button
          className="mt-4"
          disabled={busy}
          onClick={async () => {
            await Promise.all((saved.data ?? []).map((c) => live.setSaved(c.id, false)));
            await save({ interest_tags: [], goals: "" }, "Interests and saved clubs cleared");
          }}
        >
          Clear my interests and saved clubs
        </Button>
      </Section>
    </>
  );
}
