"use client";

import Link from "next/link";
import { Volume2, VolumeX } from "lucide-react";
import { useSound } from "@/lib/sound/SoundProvider";
import { Wordmark, type Tone } from "@/components/brand/Logo";

export type HeaderTheme = "dark" | "cardinal" | "light";

type ToneSpec = {
  text: string;
  ring: string;
  wrap: string;
  /** Which artwork to show — the tone of whatever sits immediately behind it. */
  mark: Tone;
  /** Cardinal hides the mark's cardinal arch, so there it sits on a paper chip. */
  plate: boolean;
  /** Backdrop once the page has scrolled, so body text passing under stays readable. */
  scrim: string;
};

const TONE: Record<HeaderTheme, ToneSpec> = {
  dark: {
    text: "text-paper", ring: "border-gray-70", wrap: "on-dark",
    mark: "dark", plate: false, scrim: "bg-ink/70",
  },
  cardinal: {
    text: "text-gold", ring: "border-gold/60", wrap: "on-cardinal",
    mark: "light", plate: true, scrim: "bg-cardinal/70",
  },
  light: {
    text: "text-ink", ring: "border-gray-30", wrap: "",
    mark: "light", plate: false, scrim: "bg-paper/75",
  },
};

/** Fixed bar that recolours itself to stay legible over each scene. */
export function Header({
  theme,
  showCta,
  scrolled,
}: {
  theme: HeaderTheme;
  showCta: boolean;
  scrolled: boolean;
}) {
  const { on, toggle } = useSound();
  const tone = TONE[theme];

  return (
    <header
      className={`${tone.wrap} ${tone.text} ${
        scrolled ? `${tone.scrim} backdrop-blur-md` : "bg-transparent"
      } pointer-events-none fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 py-4 transition-colors duration-300 md:px-14`}
    >
      <Link href="/" aria-label="Trojan Connect, back to the top" className="pointer-events-auto">
        <Wordmark tone={tone.mark} height={tone.plate ? 30 : 42} plate={tone.plate} priority />
      </Link>
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={on}
          className={`inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm ${tone.ring}`}
        >
          {on ? (
            <Volume2 aria-hidden className="size-4" />
          ) : (
            <VolumeX aria-hidden className="size-4" />
          )}
          {on ? "Sound on" : "Sound off"}
        </button>
        {showCta && (
          <Link
            href="/demo"
            className={`hidden h-10 items-center rounded-full border px-4 text-sm font-medium sm:inline-flex ${tone.ring}`}
          >
            Open the demo
          </Link>
        )}
      </div>
    </header>
  );
}
