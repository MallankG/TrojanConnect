"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { ArrowUp } from "lucide-react";
import { sound } from "@/lib/sound/engine";
import { GHOST_WORDS, PEOPLE, PILE, SENTENCE } from "./content";
import { Texture } from "./Texture";
import { PileCard } from "./Pile";
import type { HeaderTheme } from "./Header";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const CAPTION = "An illustrative scenario, not a measurement.";
const VOICES_NOTE = "Composite voices, written to illustrate the problem.";
const VERDICT = "Nobody here is slow. The process is.";
const TURN = "Same sentence. This time it goes to a Club Agent.";

type Props = {
  reduced: boolean;
  narrow: boolean;
  setTheme: (theme: HeaderTheme) => void;
};

/**
 * Scenes 2 to 4: the chaos, the people stuck in it, and the turn.
 * One pinned stage, because the pile has to survive from the first email to the
 * moment it collapses into a single line.
 */
export function ChaosStage(props: Props) {
  return props.reduced ? <ChaosStatic /> : <ChaosPinned {...props} />;
}

function ChaosPinned({ narrow, setTheme }: Props) {
  const stage = useRef<HTMLElement>(null);
  const items = narrow ? PILE.filter((p) => !p.desktopOnly) : PILE;

  useGSAP(
    () => {
      const el = stage.current!;
      const q = gsap.utils.selector(el);
      const cards = q("[data-card]");
      const ghosts = q("[data-ghost]");
      const persons = q("[data-person]");
      const dayEl = q("[data-day]")[0];
      const followEl = q("[data-follow]")[0];
      const jitterEls = q("[data-jitter]");
      const proxy = { chaos: 0, day: 1, follow: 0 };

      const tl = gsap.timeline({
        defaults: { ease: "power2.out" },
        scrollTrigger: {
          trigger: el,
          start: "top top",
          end: "+=720%",
          pin: true,
          scrub: 0.6,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: () => {
            const t = tl.time();
            setTheme(t >= 90.5 ? "cardinal" : "dark");
            // The drone swells through the build, holds under the people, and is
            // gone by the time the pile collapses.
            sound.setDrone(t < 40 ? t / 40 : t < 81 ? 0.5 : 0);
          },
          onLeave: () => sound.setDrone(0),
          onLeaveBack: () => sound.setDrone(0),
        },
      });

      // Sound cues only fire when scrolling forward; rewinding stays quiet.
      const cue = (at: number, fn: () => void) =>
        tl.call(
          () => {
            if ((tl.scrollTrigger?.direction ?? 1) > 0) fn();
          },
          undefined,
          at,
        );

      // ---- Scene 2: the pile builds ---------------------------------------
      gsap.set(ghosts, { autoAlpha: 0 });
      gsap.set([persons, q("[data-verdict]"), q("[data-voices]")], { autoAlpha: 0 });
      gsap.set(q("[data-line]"), { scaleX: 0 });

      const span = 36 / cards.length;
      cards.forEach((card, i) => {
        const item = items[i];
        const at = 1.5 + i * span;
        gsap.set(card, { rotation: item.rot });
        tl.from(
          card,
          {
            x: () =>
              item.from === "left"
                ? -window.innerWidth * 0.7
                : item.from === "right"
                  ? window.innerWidth * 0.7
                  : (i % 2 ? 1 : -1) * 120,
            y: () =>
              item.from === "top"
                ? -window.innerHeight * 0.7
                : item.from === "bottom"
                  ? window.innerHeight * 0.7
                  : (i % 2 ? -1 : 1) * 90,
            rotation: item.rot + (i % 2 ? 38 : -38),
            scale: 1.3,
            opacity: 0,
            duration: 3,
            ease: "power3.out",
          },
          at,
        );
        // Each arrival is pitched a little further off, so the pings sour.
        cue(at + 0.5, () =>
          sound.play(item.sound, { freq: 620 + ((i * 7) % 5) * 95, detune: i * 42 }),
        );
        if (item.kind === "calendar") {
          tl.from(
            card.querySelectorAll("[data-strike]"),
            { scaleX: 0, duration: 0.5, stagger: 0.45, ease: "power1.out" },
            at + 2.5,
          );
        }
      });

      tl.to(
        proxy,
        {
          chaos: 1,
          day: 14,
          follow: 11,
          duration: 37,
          ease: "none",
          onUpdate: () => {
            dayEl.textContent = String(Math.round(proxy.day));
            followEl.textContent = String(Math.round(proxy.follow));
          },
        },
        1.5,
      );

      ghosts.forEach((ghost, k) => {
        tl.to(ghost, { autoAlpha: 1, duration: 1.4 }, k * 8);
        if (k < ghosts.length - 1) tl.to(ghost, { autoAlpha: 0, duration: 1.2 }, (k + 1) * 8 - 0.8);
      });
      tl.to(q("[data-sentence]"), { opacity: 0.3, scale: 0.92, duration: 8 }, 14);

      // ---- Scene 3: the people ---------------------------------------------
      tl.to(q("[data-pile]"), { opacity: 0.14, filter: "blur(5px)", duration: 4 }, 40)
        .to(ghosts[ghosts.length - 1], { autoAlpha: 0, duration: 3 }, 40)
        .to(q("[data-sentence]"), { opacity: 0, duration: 3 }, 40)
        .to(q("[data-counter]"), { opacity: 0.4, duration: 3 }, 40)
        .to(q("[data-voices]"), { autoAlpha: 1, duration: 2 }, 44);

      persons.forEach((person, k) => {
        const at = 45 + k * 7;
        tl.fromTo(
          person,
          { autoAlpha: 0, y: 44 },
          { autoAlpha: 1, y: 0, duration: 1.6, ease: "power3.out" },
          at,
        ).to(person, { autoAlpha: 0, y: -32, duration: 1.4, ease: "power2.in" }, at + 5.6);
      });
      tl.fromTo(
        q("[data-verdict]"),
        { autoAlpha: 0, y: 30 },
        { autoAlpha: 1, y: 0, duration: 2 },
        73,
      ).to(q("[data-verdict]"), { autoAlpha: 0, duration: 1.5 }, 79);

      // ---- Scene 4: the turn ------------------------------------------------
      cue(80.6, () => sound.killDrone());
      cue(81.2, () => sound.play("whoosh"));
      tl.to(q("[data-pile]"), { opacity: 1, filter: "blur(0px)", duration: 1.2 }, 80.3)
        .to(
          [q("[data-counter]"), q("[data-caption]"), q("[data-voices]")],
          { autoAlpha: 0, duration: 1.2 },
          80.5,
        )
        .to(proxy, { chaos: 0, duration: 2 }, 81)
        .to(
          cards,
          {
            x: (i: number) => ((50 - items[i].x) / 100) * el.clientWidth,
            y: (i: number) => ((50 - items[i].y) / 100) * el.clientHeight,
            rotation: 0,
            scaleY: 0.025,
            scaleX: 1.5,
            duration: 3.6,
            ease: "power3.inOut",
            stagger: 0.07,
          },
          81,
        )
        .to(q("[data-line]"), { scaleX: 1, duration: 2, ease: "power2.inOut" }, 84)
        .to(cards, { opacity: 0, duration: 0.8 }, 85.2)
        // Silence, with a single line on screen.
        .fromTo(
          q("[data-wipe]"),
          { clipPath: "inset(0% 100% 0% 0%)" },
          { clipPath: "inset(0% 0% 0% 0%)", duration: 3, ease: "power3.inOut" },
          88.5,
        )
        .from(q("[data-turn-label]"), { opacity: 0, y: 28, duration: 1.6 }, 91.5)
        .from(q("[data-composer]"), { opacity: 0, y: 28, duration: 1.6 }, 92.6)
        .to(q("[data-send]"), { scale: 0.84, duration: 0.35, yoyo: true, repeat: 1 }, 96.6)
        .to(q("[data-composer-text]"), { opacity: 0, duration: 0.5 }, 97.1)
        .from(q("[data-placeholder]"), { opacity: 0, duration: 0.5 }, 97.4)
        .from(q("[data-bubble]"), { opacity: 0, y: 46, duration: 1.4, ease: "power3.out" }, 97.1)
        .to({}, { duration: 1.6 }, 99);

      cue(97, () => {
        sound.play("send");
        sound.play("resolve");
      });

      // Nervous type: the counter and ghost word shiver while the chaos holds.
      let last = 0;
      const jitter = (time: number) => {
        if (time - last < 0.09) return;
        last = time;
        const c = proxy.chaos;
        for (const node of jitterEls) {
          const s = (node as HTMLElement).style;
          s.setProperty("--wdth", String(100 - Math.random() * 25 * c));
          s.setProperty("--wght", String(Math.round(700 - Math.random() * 380 * c)));
        }
      };
      gsap.ticker.add(jitter);
      return () => gsap.ticker.remove(jitter);
    },
    { scope: stage, dependencies: [narrow], revertOnUpdate: true },
  );

  return (
    <div data-header="dark">
      <section
        ref={stage}
        aria-label="What happens to the request today"
        className="on-dark relative h-svh overflow-hidden bg-ink text-paper"
      >
        <Texture variant="quiet" />
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          {GHOST_WORDS.map((word) => (
            <p
              key={word}
              data-ghost
              data-jitter
              className="col-start-1 row-start-1 px-4 text-center text-[clamp(3.5rem,15vw,15rem)] leading-[0.9] tracking-[-0.03em] text-paper/10"
              style={{ fontVariationSettings: '"wdth" var(--wdth, 100), "wght" var(--wght, 700)' }}
            >
              {word}
            </p>
          ))}
        </div>

        <p
          data-sentence
          aria-hidden
          className="absolute left-1/2 top-1/2 w-[min(80vw,34rem)] -translate-x-1/2 -translate-y-1/2 text-center text-[clamp(1.1rem,2.1vw,1.75rem)] font-medium leading-tight text-gold"
        >
          {SENTENCE}
        </p>

        <div data-pile className="absolute inset-0" aria-hidden>
          {items.map((item) => (
            <div
              key={item.id}
              data-card
              className="absolute -translate-x-1/2 -translate-y-1/2 will-change-transform"
              style={{ left: `${item.x}%`, top: `${item.y}%` }}
            >
              <PileCard item={item} />
            </div>
          ))}
        </div>

        <div data-counter className="absolute left-6 top-20 md:left-14 md:top-24">
          <p className="text-sm text-gray-30">Day</p>
          <p
            data-day
            data-jitter
            className="tabular text-[clamp(3.5rem,9vw,8rem)] leading-none text-gold"
            style={{ fontVariationSettings: '"wdth" var(--wdth, 100), "wght" var(--wght, 800)' }}
          >
            1
          </p>
          <p className="tabular mt-1 text-sm text-gray-30">
            <span data-follow>0</span> follow-ups sent
          </p>
        </div>
        <p data-caption className="absolute bottom-5 left-6 text-xs text-gray-30 md:left-14">
          {CAPTION}
        </p>

        {/* Screen readers get the scenario as prose; the pile itself is decorative. */}
        <p className="sr-only">
          Over fourteen days the request turns into email threads, forms, automatic replies, missed
          calls and group chat messages, bounced between offices, with eleven follow-ups sent.
        </p>

        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 md:px-14">
          {PEOPLE.map((person) => (
            <figure
              key={person.role}
              data-person
              className="col-start-1 row-start-1 w-full max-w-4xl"
            >
              <figcaption className="text-lg font-medium text-gold md:text-xl">
                {person.role}
              </figcaption>
              <blockquote className="mt-4 font-serif text-[clamp(1.6rem,3.8vw,3.4rem)] italic leading-[1.16] text-paper">
                “{person.quote}”
              </blockquote>
              <p className="mt-5 text-base text-gray-30 md:text-lg">{person.stuck}</p>
            </figure>
          ))}
          <p
            data-verdict
            className="col-start-1 row-start-1 max-w-4xl text-center text-[clamp(2rem,5.6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-paper"
          >
            {VERDICT}
          </p>
        </div>
        <p data-voices className="absolute bottom-5 right-6 text-xs text-gray-30 md:right-14">
          {VOICES_NOTE}
        </p>

        <div
          data-line
          aria-hidden
          className="absolute left-[15vw] top-1/2 h-[3px] w-[70vw] origin-left bg-gold"
        />

        <div
          data-wipe
          className="on-cardinal absolute inset-0 bg-cardinal"
          style={{ clipPath: "inset(0% 100% 0% 0%)" }}
        >
          <TurnContent />
        </div>
      </section>
    </div>
  );
}

/** `settled` shows the end state (message sent), for the reduced-motion layout. */
function TurnContent({ settled = false }: { settled?: boolean }) {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col justify-center px-6">
      <h2
        data-turn-label
        className="text-[clamp(1.75rem,4vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-gold"
      >
        {TURN}
      </h2>
      <div className="mt-10">
        <p
          data-bubble
          className="mb-4 ml-auto max-w-[88%] rounded-3xl rounded-br-md bg-paper px-5 py-3.5 text-lg leading-snug text-ink"
        >
          {SENTENCE}
        </p>
        <div
          data-composer
          className="grid grid-cols-[1fr_auto] items-end gap-3 rounded-[28px] bg-paper p-2.5 pl-5 text-ink"
        >
          <div className="grid py-2 text-lg leading-snug">
            {!settled && (
              <p data-composer-text className="col-start-1 row-start-1">
                {SENTENCE}
              </p>
            )}
            <p data-placeholder aria-hidden className="col-start-1 row-start-1 text-gray-70">
              Message your Club Agent
            </p>
          </div>
          <span
            data-send
            aria-hidden
            className="grid size-12 place-items-center rounded-full bg-gold text-ink"
          >
            <ArrowUp className="size-5" strokeWidth={2.5} />
          </span>
        </div>
      </div>
    </div>
  );
}

/** Reduced-motion version: the same content, laid out as a page you read. */
function ChaosStatic() {
  return (
    <>
      <section data-header="dark" className="on-dark relative overflow-hidden bg-ink px-6 py-24 text-paper md:px-14">
        <Texture />
        <div className="relative z-10 mx-auto max-w-6xl">
          <p className="text-sm text-gray-30">Day</p>
          <p className="tabular text-8xl font-extrabold leading-none text-gold">14</p>
          <p className="tabular mt-1 text-sm text-gray-30">11 follow-ups sent</p>
          <h2 className="mt-8 max-w-3xl text-4xl font-semibold leading-tight tracking-[-0.02em] md:text-6xl">
            {GHOST_WORDS[GHOST_WORDS.length - 1]}
          </h2>
          <p className="mt-4 max-w-2xl text-lg text-gray-30">
            Two weeks on, one sentence has become email threads, forms, automatic replies and group
            chat messages, bounced between offices.
          </p>
          <div className="mt-10 flex flex-wrap items-start gap-4">
            {PILE.map((item) => (
              <PileCard key={item.id} item={item} />
            ))}
          </div>
          <p className="mt-6 text-xs text-gray-30">{CAPTION}</p>

          <div className="mt-24 space-y-16">
            {PEOPLE.map((person) => (
              <figure key={person.role} className="max-w-4xl">
                <figcaption className="text-lg font-medium text-gold">{person.role}</figcaption>
                <blockquote className="mt-3 font-serif text-3xl italic leading-tight md:text-5xl">
                  “{person.quote}”
                </blockquote>
                <p className="mt-4 text-base text-gray-30">{person.stuck}</p>
              </figure>
            ))}
          </div>
          <p className="mt-6 text-xs text-gray-30">{VOICES_NOTE}</p>
          <p className="mt-24 max-w-4xl text-5xl font-semibold leading-none tracking-[-0.02em] md:text-7xl">
            {VERDICT}
          </p>
        </div>
      </section>
      <section data-header="cardinal" className="on-cardinal bg-cardinal py-28">
        <TurnContent settled />
      </section>
    </>
  );
}
