"use client";

import { useEffect, useState } from "react";
import { ArrowDown, Volume2, VolumeX } from "lucide-react";
import { sound } from "@/lib/sound/engine";
import { SENTENCE, SENTENCE_HEAD } from "./content";

type Props = {
  entered: boolean;
  reduced: boolean;
  onEnter: (withSound: boolean) => void;
};

/**
 * The gate and the ask in one section. Before the visitor enters, the request is
 * half-typed and the page is locked. Entering finishes the sentence.
 */
export function Hero({ entered, reduced, onEnter }: Props) {
  const [count, setCount] = useState(SENTENCE_HEAD.length);
  const done = count >= SENTENCE.length;

  useEffect(() => {
    if (!entered || done) return;
    if (reduced) {
      const id = requestAnimationFrame(() => setCount(SENTENCE.length));
      return () => cancelAnimationFrame(id);
    }
    const id = window.setInterval(() => {
      setCount((c) => {
        const next = Math.min(c + 1, SENTENCE.length);
        if (SENTENCE[next - 1] !== " ") sound.play("type");
        return next;
      });
    }, 34);
    return () => window.clearInterval(id);
  }, [entered, done, reduced]);

  return (
    <section
      data-header="dark"
      className="on-dark relative flex min-h-svh flex-col justify-center bg-ink px-6 py-28 text-paper md:px-14"
    >
      <div className="mx-auto w-full max-w-6xl">
        <p className="text-base text-gray-30 md:text-lg">
          A club officer at USC needs a room, and writes:
        </p>

        {/* The full sentence is always in the DOM for screen readers; the typed part is visual. */}
        <h1 className="sr-only">{SENTENCE}</h1>
        <p
          aria-hidden
          className="mt-5 max-w-[22ch] text-[clamp(2rem,6.2vw,5.5rem)] font-medium leading-[1.04] tracking-[-0.02em] text-gold"
          style={{ fontVariationSettings: '"wdth" 88' }}
        >
          {SENTENCE.slice(0, count)}
          {!done && <span className="caret" />}
          {/* The untyped remainder holds its space so nothing below jumps. */}
          <span
            data-rest={SENTENCE.slice(count)}
            className="after:invisible after:content-[attr(data-rest)]"
          />
        </p>

        <div className="mt-10 min-h-24">
          {!entered ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onEnter(true)}
                className="inline-flex h-12 items-center gap-2.5 rounded-full bg-gold px-6 text-base font-semibold text-ink transition-colors hover:bg-gold-75"
              >
                <Volume2 aria-hidden className="size-5" />
                Enter with sound
              </button>
              <button
                type="button"
                onClick={() => onEnter(false)}
                className="inline-flex h-12 items-center gap-2.5 rounded-full border border-gray-70 px-6 text-base font-medium text-paper transition-colors hover:border-gray-30"
              >
                <VolumeX aria-hidden className="size-5" />
                Enter muted
              </button>
              <p className="basis-full pt-1 text-sm text-gray-30">
                This page uses sound to tell the story. You can switch it off at any time.
              </p>
            </div>
          ) : (
            <div
              className="transition-opacity duration-700"
              style={{ opacity: done ? 1 : 0 }}
              aria-hidden={!done}
            >
              <p className="max-w-xl text-xl leading-snug text-paper md:text-2xl">
                Here is what happens to that sentence today.
              </p>
              <p className="mt-6 inline-flex items-center gap-2 text-sm text-gray-30">
                <ArrowDown aria-hidden className="size-4" />
                Scroll to follow it
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
