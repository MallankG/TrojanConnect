"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { pipelineApi } from "@/lib/api-client";
import { VENUE_KINDS, to12h } from "@/lib/pipeline/fields";
import { deriveState, type PipelineState, type StepId } from "@/lib/pipeline/plan";
import { AssistantPanel } from "./AssistantPanel";
import { FieldMatrix } from "./FieldMatrix";
import { ProfileForm } from "./ProfileForm";
import { StepDetail } from "./StepDetail";
import { StepList } from "./StepList";
import { ListSkeleton, Tabs } from "@/components/ui/kit";
import { Pill, btnPrimary, fmtDate } from "./ui";

type Tab = "pipeline" | "assistant" | "profile" | "fields" | "log";
const TABS: [Tab, string][] = [["assistant", "Assistant"], ["pipeline", "Steps"], ["profile", "Event profile"], ["fields", "Field map"], ["log", "Activity"]];

export function PipelineApp() {
  const [state, setState] = useState<PipelineState | null>(null);
  const [today, setToday] = useState<Date | null>(null); // set after mount: no clock reads during prerender
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("assistant");
  const [selected, setSelected] = useState<StepId | null>(null);

  const load = useCallback(async () => {
    try { setState(await pipelineApi.state()); setToday(new Date()); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);

  // Sync with the backend: initial load, then a gentle refresh (skipped while the user is typing).
  useEffect(() => {
    let alive = true;
    const sync = () =>
      pipelineApi.state().then(
        s => { if (alive) { setState(s); setToday(new Date()); setError(null); } },
        e => { if (alive) setError((e as Error).message); },
      );
    sync();
    const t = setInterval(() => { if (!document.activeElement?.closest("form")) sync(); }, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const d = useMemo(() => (state && today ? deriveState(state, today) : null), [state, today]);

  const saveProfile = async (patch: Record<string, unknown>) => {
    try { setState(await pipelineApi.updateProfile(patch)); } catch (e) { setError((e as Error).message); }
  };

  const jumpToField = (key: string) => {
    setTab("profile");
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-field="${key}"]`);
      el?.scrollIntoView({ block: "center" });
      el?.querySelector<HTMLElement>("input,select,textarea")?.focus();
      el?.classList.add("bg-gold-25");
      setTimeout(() => el?.classList.remove("bg-gold-25"), 1400);
    });
  };

  if (!d || !state) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6 text-ink">
        {error ? (
          <div role="alert" className="max-w-md rounded-2xl bg-paper p-6 border border-line">
            <h1 className="mb-2 text-lg font-semibold">Can&apos;t reach the backend</h1>
            <p className="mb-3 text-sm text-gray-70">{error}. Start FastAPI with <code>uvicorn main:app --reload</code> in <code>backend/</code>.</p>
            <button type="button" onClick={load} className={btnPrimary}>Retry</button>
          </div>
        ) : (
          <div className="w-full max-w-3xl"><ListSkeleton rows={4} /></div>
        )}
      </div>
    );
  }

  const P = state.profile;
  const sel = d.byId[selected ?? (d.current[0] ?? d.waiting[0] ?? d.steps[0]).id];
  const pct = Math.round((d.complete / d.total) * 100);
  const late = d.steps.filter(s => s.late);
  const totalMissing = new Set(d.steps.filter(s => !s.done && !s.skip).flatMap(s => s.missing)).size;
  const go = (id: StepId) => { setSelected(id); setTab("pipeline"); };

  return (
    <div className="text-ink">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <p className="text-xs font-semibold text-gray-70">{String(P.orgName || "Event pipeline")}</p>
          <h1 className="mt-0.5 mb-1 text-[clamp(1.5rem,3.2vw,2.25rem)] font-semibold leading-[1.05] tracking-[-0.02em]">{String(P.eventName || "Untitled event")}</h1>
          <p className="text-gray-70">
            {P.date
              ? `${fmtDate(d.eventDate)} · ${to12h(P.startTime) || "—"}–${to12h(P.endTime) || "—"} · ${String(P.venueChoice1 || (P.venueKind ? VENUE_KINDS[P.venueKind] : "venue TBD"))} · ${String(P.attendance || "?")} people`
              : "Set the date and venue in the Event profile tab to compute deadlines."}
          </p>
        </div>
        <div className="md:text-right">
          {d.daysToEvent !== null && <div className="text-[40px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{d.daysToEvent}</div>}
          <div className="text-[13px] text-gray-70">{d.daysToEvent !== null && "days to event · "}{d.complete}/{d.total} steps done</div>
          <div className="mt-2 h-1.5 w-56 overflow-hidden rounded-full bg-line md:ml-auto" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-cardinal" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </header>

      <section className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-wash px-4 py-3.5" aria-label="What needs attention now">
        <b className="text-[13px] font-semibold text-cardinal">Now</b>
        {d.current.length ? d.current.map(s => (
          <Pill key={s.id} tone="ready" onClick={() => go(s.id)}>
            {s.n}. {s.title}{s.daysLeft !== null && ` · ${s.daysLeft < 0 ? `${-s.daysLeft}d overdue` : `${s.daysLeft}d left`}`}
          </Pill>
        )) : <Pill tone="plain">Nothing actionable. Waiting on replies.</Pill>}
        {d.waiting.length > 0 && <b className="text-[13px] text-ink">Waiting on</b>}
        {d.waiting.map(s => <Pill key={s.id} tone="waiting" onClick={() => go(s.id)}>{s.title}</Pill>)}
        {late.length > 0 && <b className="text-[13px] text-cardinal">Late</b>}
        {late.map(s => <Pill key={s.id} tone="late" onClick={() => go(s.id)}>{s.title}</Pill>)}
      </section>

      {error && <p role="alert" className="mb-3 rounded-xl bg-wash px-3 py-2 text-sm text-cardinal">{error}</p>}

      <Tabs
        label="Event planning"
        value={tab}
        onChange={setTab}
        tabs={TABS.map(([id, label]) => ({ id, label, count: id === "profile" && totalMissing > 0 ? totalMissing : undefined }))}
      />

      <div className="pt-6">
        {tab === "pipeline" && (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,400px)_1fr]">
            <StepList d={d} selected={sel.id} onSelect={setSelected} />
            {/* Pin the step on reload: a booking moving to "waiting" must not jump the view to another step. */}
            <StepDetail key={sel.id} d={d} step={sel} profile={P} onState={setState} onReload={() => { setSelected(sel.id); load(); }} onJumpToField={jumpToField} />
          </div>
        )}
        {/* Kept mounted so the conversation survives switching tabs. */}
        <div hidden={tab !== "assistant"}>
          <AssistantPanel d={d} profile={P} onState={setState} onReload={load} onJumpToField={jumpToField} />
        </div>
        {tab === "profile" && <ProfileForm profile={P} onSave={saveProfile} />}
        {tab === "fields" && <FieldMatrix profile={P} />}
        {tab === "log" && (
          <ul className="m-0 list-none rounded-2xl bg-paper p-0 border border-line">
            {state.log.length ? state.log.map((l, i) => (
              <li key={`${l.at}-${i}`} className="flex gap-3.5 border-b border-line px-4 py-2.5 text-[13px]">
                <time className="min-w-36 text-gray-70 tabular-nums">{new Date(l.at).toLocaleString()}</time>
                <span>{l.msg}</span>
              </li>
            )) : <li className="px-4 py-2.5 text-[13px] text-gray-70">No activity yet.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
