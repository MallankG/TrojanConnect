import type { Derived, StepId } from "@/lib/pipeline/plan";
import { Pill, STATUS_LABEL, fmtDate } from "./ui";

const DOT: Record<string, string> = {
  done: "bg-ok border-ok text-surface",
  ready: "bg-surface border-cardinal text-cardinal",
  active: "bg-surface border-cardinal text-cardinal",
  waiting: "bg-surface border-wait text-wait",
  blocked: "bg-surface border-line text-block",
  skipped: "bg-surface border-line text-block",
};

export function StepList({ d, selected, onSelect }: { d: Derived; selected: StepId; onSelect: (id: StepId) => void }) {
  const current = new Set(d.current.map(s => s.id));
  return (
    <ol className="relative m-0 list-none p-0 before:absolute before:top-5 before:bottom-5 before:left-[21px] before:w-0.5 before:bg-line" aria-label="Event waterfall">
      {d.steps.map(s => {
        const isCurrent = current.has(s.id);
        return (
          <li key={s.id} className="mb-2">
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={s.id === selected ? "step" : undefined}
              className={`relative grid w-full grid-cols-[44px_1fr] gap-2.5 rounded-xl py-2.5 pr-3 text-left ${s.id === selected ? "bg-surface shadow-sm" : "hover:bg-surface/60"}`}
            >
              <span
                className={`relative z-10 ml-[7px] grid h-[30px] w-[30px] place-items-center rounded-full border-2 text-[13px] font-bold ${DOT[s.status]} ${isCurrent ? "ring-4 ring-cardinal/20" : ""}`}
              >
                {s.done ? "✓" : s.n}
              </span>
              <span>
                {isCurrent && <span className="block text-[11px] font-bold uppercase tracking-wider text-cardinal">▶ You are here</span>}
                <span className="block text-[15px] font-semibold">{s.title}</span>
                <span className="block text-[13px] text-muted">{s.owner}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Pill tone={s.status}>{STATUS_LABEL[s.status]}</Pill>
                  {s.due && !s.done && !s.skip && (
                    <Pill tone={s.late ? "late" : "plain"}>
                      {s.official ? "Due" : "Aim for"} {fmtDate(s.due)}
                      {s.daysLeft !== null && ` · ${s.daysLeft < 0 ? `${-s.daysLeft}d late` : `${s.daysLeft}d`}`}
                    </Pill>
                  )}
                  {s.substeps.length > 1 && !s.done && !s.skip && <Pill tone="plain">{s.nDone}/{s.substeps.length}</Pill>}
                </span>
                {s.status === "blocked" && (
                  <span className="mt-1 block text-[13px] text-muted">Waiting for: {s.blockedBy.map(b => d.byId[b].title).join(", ")}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
