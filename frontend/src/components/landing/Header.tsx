"use client";

import Link from "next/link";
import { Volume2, VolumeX } from "lucide-react";
import { useSound } from "@/lib/sound/SoundProvider";
import { Brand } from "@/components/layout/Brand";

export type HeaderTheme = "dark" | "cardinal" | "light";

const TONE: Record<HeaderTheme, { text: string; ring: string; wrap: string }> = {
  dark: { text: "text-paper", ring: "border-gray-70", wrap: "on-dark" },
  cardinal: { text: "text-gold", ring: "border-gold/60", wrap: "on-cardinal" },
  light: { text: "text-ink", ring: "border-gray-30", wrap: "" },
};

/** Fixed bar that recolours itself to stay legible over each scene. */
export function Header({ theme, showCta }: { theme: HeaderTheme; showCta: boolean }) {
  const { on, toggle } = useSound();
  const tone = TONE[theme];

  return (
    <header
      className={`${tone.wrap} ${tone.text} pointer-events-none fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 py-4 transition-colors duration-300 md:px-14`}
    >
      <Brand className="pointer-events-auto" />
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
