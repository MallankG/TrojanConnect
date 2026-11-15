import Link from "next/link";

export default function NotFound() {
  return (
    <main className="on-dark flex min-h-dvh flex-col justify-center bg-ink px-6 text-paper md:px-14">
      <div className="mx-auto w-full max-w-4xl">
        <p className="text-lg text-gray-30">Page not found</p>
        <h1
          className="mt-3 max-w-[14ch] text-[clamp(2.75rem,9vw,7rem)] font-bold leading-[0.92] tracking-[-0.035em] text-gold"
          style={{ fontVariationSettings: '"wdth" 82' }}
        >
          This room isn&apos;t on the map.
        </h1>
        <p className="mt-5 max-w-md text-lg text-paper">
          The address may be mistyped, or the page was removed when the demo data was reset.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/demo"
            className="inline-flex h-12 items-center rounded-full bg-gold px-6 text-base font-semibold text-ink hover:bg-gold-75"
          >
            Open the demo
          </Link>
          <Link
            href="/"
            className="inline-flex h-12 items-center rounded-full border border-gray-70 px-6 text-base font-medium text-paper hover:border-gray-30"
          >
            Back to the story
          </Link>
        </div>
      </div>
    </main>
  );
}
