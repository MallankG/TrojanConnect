"use client";

import Link from "next/link";

/** Shown when a screen throws. Says what happened and how to recover. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col justify-center bg-paper px-6 text-ink md:px-14">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.025em]">
          This screen stopped working.
        </h1>
        <p className="mt-4 text-lg text-gray-70">
          Nothing was sent or changed. Try the screen again. If it keeps failing, resetting the
          demo data from the role picker clears any broken state.
        </p>
        {error.digest && <p className="tabular mt-3 text-sm text-gray-70">Error reference {error.digest}</p>}
        <div className="mt-7 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-12 items-center rounded-full bg-cardinal px-6 text-base font-semibold text-paper hover:bg-cardinal-20"
          >
            Try again
          </button>
          <Link
            href="/demo"
            className="inline-flex h-12 items-center rounded-full border border-line px-6 text-base font-medium hover:border-gray-70"
          >
            Go to the role picker
          </Link>
        </div>
      </div>
    </main>
  );
}
