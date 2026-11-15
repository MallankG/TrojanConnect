import type { ReactNode } from "react";
import type { StepStatus } from "@/lib/pipeline/plan";

export type Tone = StepStatus | "late" | "plain";

// Same look as kit's StatusPill: words plus a marker, so colour is never the only signal.
const MARKER: Record<Tone, string> = {
  done: "bg-mark-olive",
  ready: "bg-mark-blue",
  active: "bg-mark-blue",
  waiting: "bg-mark-orange",
  blocked: "bg-gray-30",
  skipped: "bg-gray-30",
  late: "bg-mark-red",
  plain: "bg-gray-70",
};

export const STATUS_LABEL: Record<StepStatus, string> = {
  done: "Done",
  ready: "Ready to start",
  active: "In progress",
  waiting: "Waiting on reply",
  blocked: "Blocked",
  skipped: "Not needed",
};

export function Pill({ tone, children, onClick }: { tone: Tone; children: ReactNode; onClick?: () => void }) {
  const cls = "inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-0.5 text-xs font-medium text-ink";
  const body = <><span aria-hidden className={`size-1.5 shrink-0 rounded-full ${MARKER[tone]}`} />{children}</>;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} cursor-pointer transition-colors hover:border-gray-70`}>{body}</button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

// Compact versions of kit's buttonClass("secondary" | "primary").
const btnBase = "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45";
export const btn = `${btnBase} border border-line bg-paper text-ink hover:border-gray-70`;
export const btnPrimary = `${btnBase} border border-cardinal bg-cardinal text-paper hover:bg-cardinal-20`;

export const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—";
