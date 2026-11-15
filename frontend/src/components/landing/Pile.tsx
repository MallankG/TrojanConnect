import { Mail, PhoneMissed, Reply } from "lucide-react";
import type { PileItem } from "./content";

const OFFICES = ["Event services", "Classroom scheduling", "Building contact"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** One piece of the paperwork pile. Styling only; the stage positions and animates it. */
export function PileCard({ item }: { item: PileItem }) {
  switch (item.kind) {
    case "email":
      return (
        <div className="w-[min(72vw,300px)] rounded-lg bg-paper p-3.5 text-ink shadow-[0_18px_40px_rgba(0,0,0,0.55)]">
          <div className="flex items-start gap-2">
            <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-gray-70" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold leading-tight">{item.title}</p>
              <p className="mt-0.5 text-xs text-gray-70">{item.meta}</p>
            </div>
          </div>
          <p className="mt-2 text-[13px] leading-snug text-ink/80">{item.body}</p>
        </div>
      );

    case "autoreply":
      return (
        <div className="w-[min(70vw,280px)] rounded-lg border border-gray-70 bg-ink p-3.5 text-paper">
          <div className="flex items-center gap-2 text-gray-30">
            <Reply aria-hidden className="size-4" />
            <p className="text-xs">{item.title}</p>
          </div>
          <p className="mt-2 text-[13px] leading-snug">{item.body}</p>
        </div>
      );

    case "chat":
      return (
        <div className="max-w-[min(70vw,260px)]">
          <p className="mb-1 pl-3 text-[11px] text-gray-30">{item.meta}</p>
          <p className="rounded-2xl rounded-bl-sm bg-gray-70 px-3.5 py-2 text-[15px] leading-snug text-paper shadow-[0_14px_30px_rgba(0,0,0,0.5)]">
            {item.body}
          </p>
        </div>
      );

    case "form":
      return (
        <div className="w-[min(72vw,290px)] rounded-lg bg-paper p-3.5 text-ink shadow-[0_18px_40px_rgba(0,0,0,0.55)]">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[15px] font-semibold leading-tight">{item.title}</p>
            <p className="tabular shrink-0 text-xs text-gray-70">{item.meta}</p>
          </div>
          <div className="mt-3 space-y-2">
            {["Risk assessment", "Floor plan upload", "Advisor signature"].map((label) => (
              <div key={label}>
                <p className="flex items-center gap-1.5 text-[11px] text-gray-70">
                  <span aria-hidden className="size-1.5 rounded-full bg-mark-red" />
                  {label} (required)
                </p>
                <div className="mt-1 h-6 rounded border border-gray-30" />
              </div>
            ))}
          </div>
        </div>
      );

    case "routing":
      return (
        <div className="w-[min(84vw,400px)] rounded-lg border border-gray-70 bg-ink p-3.5 text-paper shadow-[0_18px_40px_rgba(0,0,0,0.6)]">
          <p className="text-[15px] font-semibold">{item.title}</p>
          <div className="relative mt-3 grid grid-cols-3 gap-2">
            {OFFICES.map((office) => (
              <p
                key={office}
                className="rounded border border-gray-70 px-2 py-2 text-center text-[11px] leading-tight text-gray-30"
              >
                {office}
              </p>
            ))}
            <span
              aria-hidden
              className="route-dot absolute -top-1.5 left-[16.6%] size-3 -translate-x-1/2 rounded-full bg-gold"
            />
          </div>
        </div>
      );

    case "calendar":
      return (
        <div className="w-[250px] rounded-lg bg-paper p-3.5 text-ink shadow-[0_18px_40px_rgba(0,0,0,0.55)]">
          <p className="text-[15px] font-semibold">{item.title}</p>
          <div className="mt-2 grid grid-cols-5 gap-1">
            {DAYS.map((d) => (
              <p key={d} className="text-center text-[10px] text-gray-70">
                {d}
              </p>
            ))}
            {Array.from({ length: 15 }, (_, i) => (
              <div
                key={i}
                className="relative h-6 overflow-hidden rounded-sm border border-gray-30"
              >
                <span
                  aria-hidden
                  data-strike
                  className="absolute inset-0 origin-left bg-gray-30"
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-gray-70">Every slot already taken or unconfirmed</p>
        </div>
      );

    case "sticky":
      return (
        <div className="w-[190px] bg-gold p-3.5 text-ink shadow-[0_18px_40px_rgba(0,0,0,0.55)]">
          <p className="font-serif text-[15px] italic leading-snug">{item.body}</p>
        </div>
      );

    case "missed":
      return (
        <div className="flex w-[260px] items-center gap-3 rounded-full border border-gray-70 bg-ink px-4 py-2.5 text-paper">
          <PhoneMissed aria-hidden className="size-4 shrink-0 text-gray-30" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-tight">{item.title}</p>
            <p className="truncate text-[11px] text-gray-30">{item.meta}</p>
          </div>
        </div>
      );
  }
}
