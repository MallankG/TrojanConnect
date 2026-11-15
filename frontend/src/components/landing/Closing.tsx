"use client";

import { useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { ArrowRight } from "lucide-react";
import { sound } from "@/lib/sound/engine";
import { Poster } from "@/components/ui/Poster";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const PRINCIPLES = [
  {
    line: "Agents prepare.",
    human: false,
    detail:
      "They read the request, ask only for what is missing, and trade offers with the venue's workflow. They never invent a room or a free slot.",
  },
  {
    line: "Code enforces.",
    human: false,
    detail:
      "Capacity, timing, equipment and permissions are checked by fixed rules in the backend. A model's confidence is not authorization.",
  },
  {
    line: "People decide.",
    human: true,
    detail:
      "Only a signed-in reviewer for that venue can approve. No model output can mark a booking confirmed.",
  },
];

/** Scene 6: the product principle, set in type and nothing else. */
export function Principle() {
  return (
    <section data-header="light" className="bg-paper px-6 py-28 text-ink md:px-14 md:py-40">
      <div className="mx-auto max-w-6xl">
        <p className="max-w-xl text-lg text-gray-70">
          That exchange ran on three rules. They are the product.
        </p>
        <div className="mt-12 border-t border-ink">
          {PRINCIPLES.map((p) => (
            <div
              key={p.line}
              className="grid gap-x-12 gap-y-3 border-b border-ink py-8 md:grid-cols-[1.25fr_1fr] md:items-end md:py-10"
            >
              <h2
                className={
                  p.human
                    ? "font-serif text-[clamp(2.75rem,8vw,7rem)] italic leading-[0.95] text-cardinal"
                    : "text-[clamp(2.75rem,8vw,7rem)] font-bold leading-[0.9] tracking-[-0.035em]"
                }
                style={p.human ? undefined : { fontVariationSettings: '"wdth" 82' }}
              >
                {p.line}
              </h2>
              <p className="max-w-md text-lg leading-snug text-ink md:pb-2">{p.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const LINKS = [
  { a: "Club agent", b: "Venue workflow", label: "prepares and negotiates room requests", later: false },
  { a: "Student agent", b: "Club agent", label: "finds clubs and asks them questions", later: false },
  { a: "Student agent", b: "USG / GSG agent", label: "gets sourced answers, routes feedback", later: false },
  { a: "Student agent", b: "Alumni agent", label: "opt-in mentorship", later: true },
];

/** Scene 7: who talks to whom, and the two doors into one conversation. */
export function Network({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (reduced) return;
      gsap.from("[data-link-line]", {
        scaleX: 0,
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.12,
        scrollTrigger: { trigger: ref.current, start: "top 60%", once: true },
      });
    },
    { scope: ref, dependencies: [reduced], revertOnUpdate: true },
  );

  return (
    <section ref={ref} data-header="light" className="bg-wash px-6 py-28 text-ink md:px-14 md:py-36">
      <div className="mx-auto max-w-6xl">
        <h2 className="max-w-3xl text-[clamp(2rem,4.6vw,4rem)] font-semibold leading-[1.02] tracking-[-0.025em]">
          Booking a room is the first job. The same network handles the rest of campus life.
        </h2>

        <ul className="mt-14 space-y-3">
          {LINKS.map((link) => (
            <li
              key={link.a + link.b}
              className="grid items-center gap-x-4 gap-y-2 md:grid-cols-[11rem_1fr_11rem]"
            >
              <AgentPill name={link.a} later={false} />
              <div className="relative flex items-center">
                <span
                  data-link-line
                  aria-hidden
                  className={`absolute inset-x-0 top-1/2 origin-left border-t-2 ${
                    link.later ? "border-dashed border-gray-30" : "border-cardinal"
                  }`}
                />
                <span className="relative mx-auto bg-wash px-3 text-center text-[15px] text-ink">
                  {link.label}
                  {link.later && <span className="text-gray-70"> (later)</span>}
                </span>
              </div>
              <AgentPill name={link.b} later={link.later} />
            </li>
          ))}
        </ul>

        <div className="mt-24 grid items-center gap-12 md:grid-cols-[1fr_1.1fr]">
          <div>
            <h3 className="text-3xl font-semibold leading-tight tracking-[-0.02em] md:text-4xl">
              Web and WhatsApp open the same conversation.
            </h3>
            <p className="mt-4 max-w-md text-lg leading-snug text-gray-70">
              One identity, one history, one status. Start a request from your phone and finish it
              at a desk.
            </p>
          </div>
          <div className="flex items-end gap-5">
            <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-line bg-paper">
              <div className="flex items-center gap-1.5 border-b border-line px-3.5 py-2.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} aria-hidden className="size-2 rounded-full bg-gray-30" />
                ))}
                <span className="ml-2 truncate text-xs text-gray-70">trojanconnect / bookings</span>
              </div>
              <div className="flex items-center gap-3.5 p-4">
                <Poster seed="ai-networking-night" name="AI Networking Night" className="size-14" />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold leading-tight">
                    AI Networking Night
                  </p>
                  <p className="tabular text-sm text-gray-70">Wed 25 Nov · 5:00 PM</p>
                  <InReview />
                </div>
              </div>
            </div>
            <div className="w-40 shrink-0 rounded-[1.75rem] border border-line bg-paper p-3 pb-5">
              <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-gray-30" />
              <p className="text-[11px] text-gray-70">Club Agent</p>
              <p className="mt-1 rounded-2xl rounded-bl-sm bg-wash px-2.5 py-2 text-[13px] leading-snug">
                AI Networking Night is with the venue reviewer.
              </p>
              <InReview />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentPill({ name, later }: { name: string; later: boolean }) {
  return (
    <span
      className={`inline-flex h-11 items-center justify-center rounded-full px-4 text-[15px] font-medium ${
        later
          ? "border-2 border-dashed border-gray-30 bg-wash text-gray-70"
          : "bg-ink text-paper"
      }`}
    >
      {name}
    </span>
  );
}

function InReview() {
  return (
    <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-wash px-2.5 py-0.5 text-xs font-medium">
      <span aria-hidden className="size-1.5 rounded-full bg-mark-blue" />
      In review
    </p>
  );
}

/** Scene 8: the way in. */
export function Start() {
  return (
    <>
      <section
        data-header="cardinal"
        className="on-cardinal bg-cardinal px-6 py-32 text-gold md:px-14 md:py-44"
      >
        <div className="mx-auto max-w-6xl">
          <h2
            className="max-w-[14ch] text-[clamp(3rem,10vw,9rem)] font-bold leading-[0.88] tracking-[-0.04em]"
            style={{ fontVariationSettings: '"wdth" 80' }}
          >
            One campus. Many agents. One Trojan community.
          </h2>
          <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link
              href="/demo"
              onClick={() => sound.play("send")}
              className="inline-flex h-14 items-center gap-3 rounded-full bg-paper px-8 text-lg font-semibold text-cardinal transition-colors hover:bg-gold-25"
            >
              Open the demo
              <ArrowRight aria-hidden className="size-5" />
            </Link>
            <p className="max-w-sm text-base leading-snug text-paper">
              Pick a role and run the booking from request to approval. No sign-up; the data is
              seeded.
            </p>
          </div>
        </div>
      </section>
      <footer data-header="dark" className="on-dark bg-ink px-6 py-10 text-gray-30 md:px-14">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-6 text-sm leading-relaxed">
          <p className="text-base font-semibold text-paper">TrojanConnect</p>
          <p className="max-w-2xl">
            A hackathon project built by USC students. It is not affiliated with or endorsed by the
            University of Southern California. Venues, availability and approvals in this demo are
            simulated, and no real reservation is made.
          </p>
        </div>
      </footer>
    </>
  );
}
