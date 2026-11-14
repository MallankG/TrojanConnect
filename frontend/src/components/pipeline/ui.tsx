import type { ReactNode } from "react";
import type { StepStatus } from "@/lib/pipeline/plan";

export type Tone = StepStatus | "late" | "plain";

const TONES: Record<Tone, string> = {
  done: "bg-ok-bg text-ok",
  ready: "bg-ready-bg text-ready",
  active: "bg-ready-bg text-ready",
  waiting: "bg-wait-bg text-wait",
  blocked: "bg-block-bg text-block",
  skipped: "bg-block-bg text-block",
  late: "bg-late-bg text-late",
  plain: "bg-block-bg text-muted font-medium",
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
  const cls = `inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} cursor-pointer`}>{children}</button>
  ) : (
    <span className={cls}>{children}</span>
  );
}

export const btn = "inline-flex items-center rounded-lg border border-line bg-paper px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-muted disabled:cursor-not-allowed disabled:opacity-45";
export const btnPrimary = "inline-flex items-center rounded-lg border border-cardinal bg-cardinal px-3 py-1.5 text-[13px] font-semibold text-on-cardinal hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45";

export const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—";
