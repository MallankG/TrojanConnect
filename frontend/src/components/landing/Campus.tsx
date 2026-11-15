"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bell, Check, Hash, Search } from "lucide-react";
import { sound } from "@/lib/sound/engine";
import { Poster } from "@/components/ui/Poster";
import { Texture } from "./Texture";

/**
 * The last scene before the way in. The page opened with one person typing one
 * sentence; it closes with three more people typing theirs, in the same type,
 * each answered by the part of the product that handles it: RSO recognition,
 * club outreach, and finding a club.
 *
 * The screens are examples drawn by hand, like the rest of the landing page.
 * The facts beside them (13 steps, 15 documents, what Slack can and cannot do)
 * describe what the product does.
 */

type Chapter = {
  id: string;
  /** Who is writing, in the form the hero uses. */
  who: string;
  sentence: string;
  body: string;
  points: React.ReactNode[];
  screen: React.ReactNode;
  /** Put the screen on the left on wide layouts. */
  flip?: boolean;
};

const Command = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-paper/10 px-1.5 py-0.5 font-mono text-[13px] text-paper">{children}</code>
);

const CHAPTERS: Chapter[] = [
  {
    id: "recognition",
    who: "A club president writes:",
    sentence: "We need to get our club recognized before the deadline.",
    body: "Recognition at USC is 13 steps, a roster and 15 officer documents, against one deadline that does not move.",
    points: [
      "Finds your pathway: a new club, a renewal, a club sport or a religious group.",
      "Tracks every step with its USC form and the days left.",
      "Drafts the reminder to whoever still owes a document.",
      "You submit on EngageSC yourself. An agent never does.",
    ],
    screen: <RecognitionScreen />,
  },
  {
    id: "outreach",
    who: "A club officer writes:",
    sentence: "Applications open Monday. Tell everyone who follows us.",
    body: "A verified officer posts once. It reaches every student who saved the club, and the club's Slack channel.",
    points: [
      "Events, recruitment calls and updates, from one place.",
      "An interest inbox that shows a student's name only if they chose to share it.",
      <>
        Post from the web, or with <Command>/trojan post</Command> in Slack, after a preview.
      </>,
    ],
    screen: <OutreachScreen />,
    flip: true,
  },
  {
    id: "discover",
    who: "A first-year writes:",
    sentence: "Something with robots. I've never built one.",
    body: "The Student Agent searches nearly 2,000 student organizations using only the interests you picked, and says why each one matched.",
    points: [
      "Ask a club's agent before you show up. It answers only from the club's public profile.",
      "Say you're interested. Your name goes along only if you tick the box.",
      "Hear from the clubs you saved, and get sourced answers from USG and GSG.",
    ],
    screen: <DiscoverScreen />,
  },
];

export function Campus({ reduced }: { reduced: boolean }) {
  return (
    <section
      data-header="dark"
      aria-labelledby="campus-heading"
      className="on-dark relative overflow-hidden bg-ink px-6 pb-16 pt-28 text-paper md:px-14 md:pb-20 md:pt-36"
    >
      <Texture />
      <div className="relative z-10 mx-auto max-w-6xl">
        <h2
          id="campus-heading"
          className="max-w-3xl text-[clamp(2rem,4.6vw,4rem)] font-semibold leading-[1.02] tracking-[-0.025em]"
        >
          That was one sentence. Here are three more.
        </h2>
        <p className="mt-5 max-w-xl text-lg leading-snug text-gray-30 md:text-xl">
          Different people, the same network. Agents prepare, code checks, and a person makes the
          call.
        </p>

        <div className="mt-16 md:mt-20">
          {CHAPTERS.map((chapter) => (
            <ChapterRow key={chapter.id} chapter={chapter} reduced={reduced} />
          ))}
        </div>

        <p className="border-t border-paper/15 pt-6 text-sm text-gray-30">
          Example screens. The names are illustrative; in the demo, clubs come from public club
          pages.
        </p>
      </div>
    </section>
  );
}

/**
 * One sentence and its answer. The sentence types itself the first time it is
 * scrolled into view, as the hero's does, and the screen beside it wakes up
 * when the sentence is finished: the ask, then the response.
 */
function ChapterRow({ chapter, reduced }: { chapter: Chapter; reduced: boolean }) {
  const { ref, shown, done } = useTyped(chapter.sentence, reduced);

  return (
    <article className="grid items-center gap-10 border-t border-paper/15 py-14 md:grid-cols-2 md:gap-16 md:py-20">
      <div className={chapter.flip ? "md:order-2" : undefined}>
        <p className="text-base text-gray-30 md:text-lg">{chapter.who}</p>

        {/* The whole sentence is in the DOM for screen readers; the typed part is visual. */}
        <h3 className="sr-only">{chapter.sentence}</h3>
        <p
          ref={ref}
          aria-hidden
          className="mt-3 max-w-[18ch] text-[clamp(1.75rem,3.6vw,3rem)] font-medium leading-[1.06] tracking-[-0.02em] text-gold"
          style={{ fontVariationSettings: '"wdth" 88' }}
        >
          {chapter.sentence.slice(0, shown)}
          {!done && <span className="caret" />}
          {/* The untyped remainder holds its space so nothing below jumps. */}
          <span className="invisible">{chapter.sentence.slice(shown)}</span>
        </p>

        <p className="mt-6 max-w-lg text-lg leading-snug text-paper">{chapter.body}</p>
        <ul className="mt-5 max-w-lg space-y-2.5 text-[15px] leading-snug text-gray-30">
          {chapter.points.map((point, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-gold" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>

      <div
        className={`transition-[opacity,transform] duration-700 ease-out-quint motion-reduce:transition-none ${
          done ? "translate-y-0 opacity-100" : "translate-y-3 opacity-30"
        }`}
      >
        {chapter.screen}
      </div>
    </article>
  );
}

/** Types `text` once, the first time the returned ref scrolls into view. */
function useTyped(text: string, reduced: boolean) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [started, setStarted] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || started) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setStarted(true);
      },
      { threshold: 0.6, rootMargin: "0px 0px -12% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started || reduced) return;
    let typed = 0;
    const id = window.setInterval(() => {
      typed += 1;
      if (text[typed - 1] !== " ") sound.play("type", { volume: 0.5 });
      setCount(typed);
      if (typed >= text.length) window.clearInterval(id);
    }, 30);
    return () => window.clearInterval(id);
  }, [started, reduced, text]);

  const shown = reduced ? text.length : Math.min(count, text.length);
  return { ref, shown, done: shown >= text.length };
}

// ---- Screens ---------------------------------------------------------------

function Screen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="img" aria-label={label} className="rounded-3xl bg-paper p-4 text-ink md:p-5">
      {children}
    </div>
  );
}

type StepState = "done" | "partial" | "todo" | "yours";

const STEPS: { state: StepState; title: string; note?: string }[] = [
  { state: "done", title: "Officer access on the EngageSC page" },
  { state: "done", title: "Roster updated", note: "5 officers, an advisor, 5 more members" },
  { state: "partial", title: "Officer documents", note: "13 of 15 in. Reminder drafted for the treasurer." },
  { state: "todo", title: "Constitution, on this year's template" },
  { state: "yours", title: "Submit on EngageSC", note: "Yours to do. An agent never submits." },
];

function StepMark({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-cardinal text-paper">
        <Check className="size-3" strokeWidth={3.5} />
      </span>
    );
  }
  if (state === "partial") {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-cardinal">
        <span className="size-2 rounded-full bg-cardinal" />
      </span>
    );
  }
  if (state === "yours") {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-gold text-ink">
        <ArrowUpRight className="size-3" strokeWidth={3} />
      </span>
    );
  }
  return <span className="block size-5 shrink-0 rounded-full border-2 border-gray-30" />;
}

function RecognitionScreen() {
  return (
    <Screen label="Example: a recognition checklist for a renewing club, with two steps done, officer documents nearly complete, and submission left to the officer.">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-gray-70">RSO recognition, renewing</p>
          <p className="text-xl font-semibold leading-tight">SC AI Club</p>
        </div>
        <p className="tabular inline-flex items-center gap-1.5 rounded-full bg-wash px-2.5 py-1 text-xs font-medium">
          <span className="size-1.5 rounded-full bg-mark-orange" />
          Closes 22 Nov, 11:59 PM
        </p>
      </div>

      <ol className="mt-4 divide-y divide-line overflow-hidden rounded-2xl bg-wash">
        {STEPS.map((step) => (
          <li key={step.title} className="flex items-start gap-3 px-3.5 py-3">
            <span className="mt-0.5 shrink-0">
              <StepMark state={step.state} />
            </span>
            <span className="min-w-0">
              <span
                className={`block text-[15px] leading-snug ${
                  step.state === "todo" ? "text-gray-70" : "font-medium"
                }`}
              >
                {step.title}
              </span>
              {step.note && (
                <span className="tabular block text-[13px] leading-snug text-gray-70">{step.note}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </Screen>
  );
}

function OutreachScreen() {
  return (
    <Screen label="Example: a recruitment post from a club, sent to students who saved the club and to its Slack channel, with two students interested.">
      <div className="flex items-center gap-3">
        <Poster seed="sc-ai-club" name="SC AI Club" className="size-11" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">SC AI Club</p>
          <p className="truncate text-xs text-gray-70">Posted by a verified officer</p>
        </div>
        <p className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium">Recruitment</p>
      </div>

      <p className="mt-4 text-xl font-semibold leading-tight">Applications open Monday</p>
      <p className="mt-1 text-[15px] leading-snug text-gray-70">
        Builders, designers and first-timers welcome. Apply by Friday.
      </p>

      <dl className="mt-4 divide-y divide-line overflow-hidden rounded-2xl bg-wash text-[15px]">
        <div className="px-3.5 py-3">
          <dt className="text-xs text-gray-70">Went to</dt>
          <dd className="mt-1.5 space-y-1.5">
            <p className="flex items-center gap-2">
              <Bell className="size-4 shrink-0 text-gray-70" />
              Everyone who saved the club
            </p>
            <p className="flex items-center gap-2">
              <Hash className="size-4 shrink-0 text-gray-70" />
              sc-ai-club, in Slack
            </p>
          </dd>
        </div>
        <div className="px-3.5 py-3">
          <dt className="text-xs text-gray-70">Interested</dt>
          <dd className="mt-1.5 space-y-2">
            <p className="flex items-center gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-[10px] font-semibold text-gold">
                PS
              </span>
              <span className="min-w-0">
                <span className="block leading-tight">Priya Shah</span>
                <span className="block text-[13px] text-gray-70">Shared a name and email</span>
              </span>
            </p>
            <p className="flex items-center gap-2.5">
              <span className="size-7 shrink-0 rounded-full bg-gray-30" />
              <span className="min-w-0">
                <span className="block leading-tight">A student</span>
                <span className="block text-[13px] text-gray-70">Kept their contact private</span>
              </span>
            </p>
          </dd>
        </div>
      </dl>
    </Screen>
  );
}

function DiscoverScreen() {
  return (
    <Screen label="Example: a search for robotics clubs that returns one match with its reasons, followed by a question answered by that club's agent.">
      <p className="flex items-center gap-2.5 rounded-full bg-wash px-4 py-2.5 text-[15px]">
        <Search className="size-4 shrink-0 text-gray-70" />
        something with robots
      </p>

      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-line p-3">
        <Poster seed="trojan-robotics" name="Trojan Robotics Works" className="size-14" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold leading-tight">Trojan Robotics Works</p>
          <p className="truncate text-sm text-gray-70">Matched on robotics, design</p>
        </div>
        <p className="rounded-full border border-line px-3 py-1 text-xs font-medium">Saved</p>
      </div>

      <div className="mt-4 space-y-2">
        <p className="ml-auto w-fit max-w-[85%] rounded-3xl rounded-br-md bg-cardinal px-4 py-2.5 text-[15px] leading-snug text-paper">
          Do I need experience?
        </p>
        <div className="max-w-[88%]">
          <p className="mb-1 pl-1 text-xs text-gray-70">Trojan Robotics Works agent</p>
          <p className="rounded-3xl rounded-bl-md bg-wash px-4 py-2.5 text-[15px] leading-snug">
            No. Workshop nights are open to anyone, and teams take new members each semester.
          </p>
          <p className="mt-1 pl-1 text-xs text-gray-70">From the club&apos;s public profile</p>
        </div>
      </div>
    </Screen>
  );
}
