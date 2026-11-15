// Client component: rendered only from PipelineApp ("use client").
import { useEffect, useRef, useState } from "react";
import { pipelineApi, type RoomAvailability, type RunStatus } from "@/lib/api-client";
import { FIELD_BY_KEY, PERMIT_APPROVED_CATERERS, type Profile } from "@/lib/pipeline/fields";
import { FORMS, emailDraft, mailto, missingFor, type Derived, type DerivedStep, type PipelineState, type RunnableForm } from "@/lib/pipeline/plan";
import { Pill, STATUS_LABEL, btn, btnPrimary, fmtDate } from "./ui";
import type { RecognitionProgress } from "@/lib/pipeline/plan";
import { STATUS_LABEL as RECOGNITION_STATUS_LABEL } from "@/lib/pipeline/recognition";

interface Props {
  d: Derived;
  step: DerivedStep;
  profile: Profile;
  recognition?: RecognitionProgress;
  onState: (s: PipelineState) => void;
  onJumpToField: (key: string) => void;
  onOpenRecognition?: () => void;
}

export function StepDetail({ d, step: s, profile, recognition, onState, onJumpToField, onOpenRecognition }: Props) {
  const [error, setError] = useState<string | null>(null);
  const act = async (p: Promise<PipelineState>) => {
    try { onState(await p); setError(null); } catch (e) { setError((e as Error).message); }
  };

  return (
    <aside className="rounded-xl bg-surface p-6 shadow-sm lg:sticky lg:top-4" aria-label={`Step ${s.n} details`}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={s.status}>{STATUS_LABEL[s.status]}</Pill>
        {s.due && (
          <Pill tone={s.late ? "late" : "plain"}>
            {s.official ? "Deadline" : "Suggested by"}: {fmtDate(s.due)} ({s.lead} days before)
          </Pill>
        )}
      </div>
      <h2 className="mt-2 mb-1 text-xl font-bold">{s.n}. {s.title}</h2>
      <p className="mb-3 text-muted">{s.blurb}</p>
      {s.status === "blocked" && <Pill tone="blocked">Finish first: {s.blockedBy.map(b => d.byId[b].title).join(" → ")}</Pill>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-late-bg px-3 py-2 text-sm text-late">{error}</p>}

      {s.id === "engage" && (
        <div
          data-testid="engage-recognition-note"
          className={`mt-3 rounded-lg p-3 text-sm ${recognition?.applicationStatus === "recognized" ? "bg-ok-bg text-ok" : "bg-wait-bg text-ink"}`}
        >
          <strong>RSO recognition: {RECOGNITION_STATUS_LABEL[recognition?.applicationStatus ?? "not_started"]}.</strong>{" "}
          {recognition?.applicationStatus === "recognized"
            ? "This was recorded manually in TrojanConnect, so confirm the group is active in EngageSC before creating the event."
            : "USC says organizations that miss annual recognition lose all RSO benefits. Confirm your group's status in EngageSC before relying on it for this event."}
          {onOpenRecognition && (
            <button type="button" onClick={onOpenRecognition} className="ml-2 font-semibold text-cardinal underline">
              Open RSO recognition
            </button>
          )}
        </div>
      )}

      <SectionTitle>Checklist</SectionTitle>
      <div>
        {s.substeps.map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-center gap-2.5 border-b border-dashed border-line py-2">
            <input type="checkbox" className="h-[18px] w-[18px] accent-ok" checked={!!s.checks[k]} onChange={e => act(pipelineApi.setCheck(s.id, k, e.target.checked))} />
            {label}
          </label>
        ))}
      </div>

      {s.needsData && s.needsData.length > 0 && (
        <>
          <SectionTitle>Record from replies</SectionTitle>
          <div className="grid gap-2">
            {s.needsData.map(f => (
              <label key={f.key} className="grid gap-1 text-[13px] text-muted">
                {f.label}
                <input
                  key={`${f.key}:${s.data[f.key] ?? ""}`}
                  defaultValue={s.data[f.key] ?? ""}
                  onBlur={e => e.target.value.trim() !== (s.data[f.key] ?? "") && act(pipelineApi.setData(s.id, f.key, e.target.value))}
                  className="rounded-lg border border-line bg-paper px-2.5 py-2 text-ink"
                />
              </label>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Forms & messages</SectionTitle>
      {s.forms.length === 0 && <p className="text-muted">Choose a venue type in the Event profile to see the right form.</p>}
      {s.forms.map(fid => (
        <FormCard key={fid} formId={fid} step={s} d={d} profile={profile} onJumpToField={onJumpToField} />
      ))}

      {s.id === "food" && (
        <div className="mb-2.5 rounded-xl border border-line p-3.5">
          <strong className="text-sm">Approved caterers in the permit system</strong>
          <ul className="mt-2 columns-2 pl-4 text-[13px] text-muted">
            {PERMIT_APPROVED_CATERERS.map(c => <li key={c}>{c}</li>)}
          </ul>
          <div className="mt-2.5"><DraftButton formId="hospitality" profile={profile} label="Draft email to Hospitality (non-approved vendor)" /></div>
        </div>
      )}
      {s.id === "venue" && profile.venueKind === "eeb_phe" && <EeAvailability />}
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{children}</h3>;
}

function DraftButton({ formId, profile, label = "Open email draft", disabled }: { formId: string; profile: Profile; label?: string; disabled?: boolean }) {
  const draft = emailDraft(formId, profile);
  if (!draft || disabled) return <button type="button" className={btn} disabled>{label}</button>;
  return <a className={btnPrimary} href={mailto(draft)}>{label}</a>;
}

function FormCard({ formId, step, d, profile, onJumpToField }: { formId: string; step: DerivedStep; d: Derived; profile: Profile; onJumpToField: (k: string) => void }) {
  const f = FORMS[formId];
  const miss = missingFor(formId, profile);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [run]);

  const permitNeedsRes = formId === "permit" && !/^\d{6}$/.test(d.byId.venue.data.reservationNumber ?? "");
  const blocked = step.status === "blocked";

  const start = async () => {
    setRunErr(null);
    try {
      await pipelineApi.startRun(formId as RunnableForm);
      setRun({ running: true, lines: [] });
      poll.current = setInterval(async () => {
        const r = await pipelineApi.runStatus(formId as RunnableForm);
        setRun(r);
        if (!r.running && poll.current) { clearInterval(poll.current); poll.current = null; }
      }, 1000);
    } catch (e) { setRunErr((e as Error).message); }
  };

  return (
    <div className="mb-2.5 rounded-xl border border-line p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <strong className="text-sm">{f.name}</strong>
        <Pill tone="plain">{{ prefill: "auto pre-fill", email: "email draft", manual: "manual" }[f.auto]}</Pill>
      </div>
      {f.rules.length > 0 && <ul className="mt-2 list-disc pl-[18px] text-[13px] text-muted">{f.rules.map(r => <li key={r}>{r}</li>)}</ul>}
      {miss.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5 text-[13px]">
          Needs:
          {miss.map(m => (
            <button key={m.key} type="button" title={m.problem} onClick={() => onJumpToField(m.key)} className="rounded-md bg-late-bg px-2 py-0.5 text-late">
              {FIELD_BY_KEY[m.key]?.label.split(" (")[0] ?? m.key}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2.5 text-[13px] text-ok">✓ All {f.requires.length} required fields ready</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {f.auto === "prefill" && (
          <>
            <button type="button" className={btnPrimary} onClick={start} disabled={miss.length > 0 || blocked || permitNeedsRes || !!run?.running}>
              {run?.running ? "Running…" : "Pre-fill in browser"}
            </button>
            {f.url && <a className={btn} href={f.url} target="_blank" rel="noopener noreferrer">Open blank</a>}
            {permitNeedsRes && <Pill tone="late">Needs 6-digit reservation # (Venue step)</Pill>}
          </>
        )}
        {f.auto === "email" && (
          <>
            <DraftButton formId={formId} profile={profile} disabled={miss.length > 0} />
            {f.url && <a className={btn} href={f.url} target="_blank" rel="noopener noreferrer">Open template</a>}
          </>
        )}
        {f.auto === "manual" && f.url && <a className={btnPrimary} href={f.url} target="_blank" rel="noopener noreferrer">Open</a>}
      </div>
      {runErr && <p role="alert" className="mt-2 text-[13px] text-late">{runErr}</p>}
      {run && (
        <pre ref={logRef} className="mt-2.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-2.5 text-xs" aria-live="polite">
          {run.lines.join("\n") || "Starting browser…"}
        </pre>
      )}
    </div>
  );
}

function EeAvailability() {
  const [rows, setRows] = useState<RoomAvailability[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | string>("idle");
  const check = async () => {
    setState("loading");
    try { setRows(await pipelineApi.eeAvailability()); setState("idle"); } catch (e) { setState((e as Error).message); }
  };
  return (
    <div className="mb-2.5 rounded-xl border border-line p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <strong className="text-sm">EEB / PHE availability on your date</strong>
        <button type="button" className={btn} onClick={check} disabled={state === "loading"}>{state === "loading" ? "Reading calendars…" : "Check availability"}</button>
      </div>
      {state !== "idle" && state !== "loading" && <p role="alert" className="mt-2 text-[13px] text-late">{state}</p>}
      {rows && (
        <table className="mt-2 w-full border-collapse text-[13px]">
          <tbody>
            {rows.map(r => (
              <tr key={r.room} className="border-b border-line align-top">
                <td className="py-1.5 pr-2 font-semibold">{r.room}</td>
                <td className="py-1.5 pr-2">{r.free ? <Pill tone="done">Free at your time</Pill> : <Pill tone="late">Conflict</Pill>}</td>
                <td className="py-1.5">{r.bookings.length ? r.bookings.map(b => <div key={b}>{b}</div>) : <span className="text-muted">No bookings</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
