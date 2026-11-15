"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Check, CircleCheck, UserRoundCheck } from "lucide-react";
import { sound } from "@/lib/sound/engine";
import { Poster } from "@/components/ui/Poster";
import { SCRIPT, STEPS, stepFor, type ScriptMessage } from "./content";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const TOTAL = SCRIPT.length;

function cueFor(message: ScriptMessage) {
  switch (message.kind) {
    case "user":
      return "send" as const;
    case "system":
      return "tick" as const;
    case "reviewer":
      return "stamp" as const;
    case "confirmed":
      return "ping" as const;
    default:
      return "receive" as const;
  }
}

/**
 * Scene 5. The same request, handled by agents. Scrolling reveals the scripted
 * exchange one message at a time while the summary and the state stepper follow.
 */
export function Solution({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(1);
  const count = reduced ? TOTAL : scrolled;

  useGSAP(
    () => {
      if (reduced) return;
      ScrollTrigger.create({
        trigger: ref.current,
        start: "top top",
        end: "+=560%",
        pin: true,
        anticipatePin: 1,
        onUpdate: (self) => {
          const next = Math.min(TOTAL, 1 + Math.floor(self.progress * (TOTAL + 0.6)));
          setScrolled((prev) => (prev === next ? prev : next));
        },
      });
    },
    { scope: ref, dependencies: [reduced], revertOnUpdate: true },
  );

  // A cue for each new message, forward only.
  const prev = useRef(count);
  useEffect(() => {
    if (count > prev.current && !reduced) {
      const message = SCRIPT[count - 1];
      sound.play(cueFor(message), message.kind === "confirmed" ? { freq: 1046 } : undefined);
    }
    prev.current = count;
  }, [count, reduced]);

  const step = stepFor(count);
  const actions = SCRIPT.slice(0, count).filter((m) => m.kind === "user").length;
  const visible = SCRIPT.slice(0, count);

  return (
    <div data-header="light">
      <section
        ref={ref}
        aria-label="The same request, handled by agents"
        className={`flex flex-col bg-paper px-6 pb-6 pt-20 text-ink md:px-14 ${
          reduced ? "py-24" : "h-svh overflow-hidden"
        }`}
      >
        <div className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
            <h2 className="max-w-2xl text-[clamp(1.5rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
              The same request, with agents doing the back-and-forth.
            </h2>
            <p className="flex items-baseline gap-2 text-gray-70">
              <span className="tabular text-4xl font-bold leading-none text-cardinal">
                {actions}
              </span>
              <span className="text-sm">
                {actions === 1 ? "action" : "actions"} from you so far
              </span>
            </p>
          </div>

          <Stepper step={step} />

          <div className="mt-5 grid min-h-0 flex-1 gap-8 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div
              className={`flex min-h-0 flex-col justify-end gap-3 ${
                reduced
                  ? ""
                  : "overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_14%)]"
              }`}
            >
              {visible.map((message, i) => (
                <Message key={i} message={message} />
              ))}
            </div>
            <Summary count={count} step={step} />
          </div>
        </div>
      </section>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <>
      {/* Phones get the current state as a sentence instead of six dots. */}
      <p className="mt-5 text-sm md:hidden" aria-live="polite">
        <span className="font-semibold text-cardinal">{STEPS[step]}</span>
        <span className="tabular text-gray-70">
          {" "}
          · step {step + 1} of {STEPS.length}
        </span>
      </p>
      <ol className="mt-6 hidden grid-cols-6 md:grid">
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={label} className="relative">
              {i > 0 && (
                <span
                  aria-hidden
                  className={`absolute right-1/2 top-[9px] h-0.5 w-full transition-colors duration-500 ${
                    i <= step ? "bg-cardinal" : "bg-line"
                  }`}
                />
              )}
              <span
                aria-hidden
                className={`relative mx-auto grid size-5 place-items-center rounded-full border-2 transition-colors duration-500 ${
                  done || active ? "border-cardinal bg-cardinal text-paper" : "border-gray-30 bg-paper"
                }`}
              >
                {done && <Check className="size-3" strokeWidth={3.5} />}
              </span>
              <p
                className={`mt-2 text-center text-sm transition-colors duration-500 ${
                  active ? "font-semibold text-ink" : done ? "text-ink" : "text-gray-70"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {label}
              </p>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Message({ message }: { message: ScriptMessage }) {
  switch (message.kind) {
    case "user":
      return (
        <p className="msg-in ml-auto max-w-[85%] rounded-3xl rounded-br-md bg-cardinal px-4 py-2.5 text-[15px] leading-snug text-paper md:text-base">
          {message.text}
        </p>
      );
    case "agent":
      return (
        <div className="msg-in max-w-[85%]">
          <p className="mb-1 pl-1 text-xs text-gray-70">{message.who}</p>
          <p className="rounded-3xl rounded-bl-md bg-wash px-4 py-2.5 text-[15px] leading-snug md:text-base">
            {message.text}
          </p>
        </div>
      );
    case "system":
      return (
        <p className="msg-in flex items-center justify-center gap-2 py-0.5 text-center text-[13px] text-gray-70">
          {message.text}
          {message.tag && <SimulatedTag />}
        </p>
      );
    case "offer":
      return (
        <div className="msg-in max-w-[85%]">
          <p className="mb-1 pl-1 text-xs text-gray-70">
            {message.who} · {message.label}
          </p>
          <div className="rounded-2xl border border-line px-4 py-3">
            <p className="text-base font-semibold leading-tight">{message.venue}</p>
            <p className="tabular mt-0.5 text-sm text-gray-70">
              {message.seats} · {message.time}
            </p>
            <p className="mt-2 flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className={`size-2 rounded-full ${message.match ? "bg-mark-olive" : "bg-mark-orange"}`}
              />
              {message.diff}
            </p>
          </div>
        </div>
      );
    case "reviewer":
      return (
        <div className="msg-in max-w-[85%]">
          <p className="mb-1 flex items-center gap-1.5 pl-1 text-xs text-gray-70">
            <UserRoundCheck aria-hidden className="size-3.5" />
            Venue reviewer · a person, signed in
          </p>
          <p className="rounded-2xl border border-ink px-4 py-3 font-serif text-lg italic leading-snug">
            {message.text}
          </p>
        </div>
      );
    case "confirmed":
      return (
        <p className="msg-in flex items-center gap-2.5 rounded-2xl bg-wash px-4 py-3 text-base font-semibold">
          <CircleCheck aria-hidden className="size-5 text-mark-olive" />
          {message.text}
        </p>
      );
  }
}

function SimulatedTag() {
  return (
    <span className="rounded-full border border-gold bg-gold-25 px-2 py-0.5 text-[11px] font-medium text-ink">
      Simulated
    </span>
  );
}

function Summary({ count, step }: { count: number; step: number }) {
  const read = count >= 3;
  const titled = count >= 4;
  const routed = count >= 7;
  const venue = count >= 12 ? "Demo Hall B · 150 seats" : count >= 9 ? "Options on the table" : null;

  return (
    <aside className="hidden min-h-0 flex-col md:flex" aria-label="Booking summary">
      <div className="rounded-3xl border border-line p-4">
        <div className="flex items-center gap-3.5">
          {titled ? (
            <Poster seed="ai-networking-night" name="AI Networking Night" className="size-16" />
          ) : (
            <div className="size-16 rounded-xl border-2 border-dashed border-gray-30" />
          )}
          <div className="min-w-0">
            <p className="text-xs text-gray-70">SC AI Club</p>
            <Fill value={titled ? "AI Networking Night" : null} empty="Event needs a name">
              {(v) => <p className="truncate text-xl font-semibold leading-tight">{v}</p>}
            </Fill>
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-wash px-2.5 py-0.5 text-xs font-medium">
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${
                  step >= 4 ? "bg-mark-olive" : step === 3 ? "bg-mark-blue" : "bg-gray-70"
                }`}
              />
              {STEPS[step]}
            </p>
          </div>
        </div>

        <dl className="mt-4 divide-y divide-line overflow-hidden rounded-2xl bg-wash text-[15px]">
          <div className="grid grid-cols-[5.5rem_1fr] px-3.5 py-2.5">
            <dt className="text-gray-70">Starts</dt>
            <dd>
              <Fill value={read ? "Wed 25 Nov, 5:00 PM" : null} />
            </dd>
            <dt className="text-gray-70">Ends</dt>
            <dd>
              <Fill value={read ? "8:00 PM" : null} />
            </dd>
          </div>
          <Row label="People" value={read ? "100" : null} />
          <Row label="Needs" value={read ? "Projector, microphones" : null} />
          <Row label="Routed to" value={routed ? "Campus event spaces" : null} />
          <Row label="Venue" value={venue} />
        </dl>
      </div>

      <p className="mt-3 px-1 text-sm leading-snug text-gray-70">
        {step >= 5
          ? "Confirmed only after a signed-in reviewer approved it."
          : step >= 3
            ? "Accepted is not booked. A person at the venue decides."
            : "The agent fills this in from the conversation. Nothing is sent until you confirm it."}
      </p>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] px-3.5 py-2.5">
      <dt className="text-gray-70">{label}</dt>
      <dd>
        <Fill value={value} />
      </dd>
    </div>
  );
}

/** A summary value that animates in when the agent fills it. */
function Fill({
  value,
  empty = "Not yet",
  children,
}: {
  value: string | null;
  empty?: string;
  children?: (value: string) => React.ReactNode;
}) {
  if (!value) return <div className="text-gray-70">{empty}</div>;
  return (
    <div key={value} className="msg-in tabular">
      {children ? children(value) : value}
    </div>
  );
}
