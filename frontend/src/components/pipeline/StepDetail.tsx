// Client component: rendered only from PipelineApp ("use client").
import { useState } from "react";
import { pipelineApi } from "@/lib/api-client";
import { FIELD_BY_KEY, PERMIT_APPROVED_CATERERS, type Profile } from "@/lib/pipeline/fields";
import { AGENT_FORMS, FORMS, WORKFLOW_OWNED, emailDraft, mailto, missingFor, type Derived, type DerivedStep, type PipelineState } from "@/lib/pipeline/plan";
import { BookingCard } from "./BookingCard";
import { Pill, STATUS_LABEL, btn, btnPrimary, fmtDate } from "./ui";

interface Props {
  d: Derived;
  step: DerivedStep;
  profile: Profile;
  onState: (s: PipelineState) => void;
  onReload: () => void;
  onJumpToField: (key: string) => void;
}

export function StepDetail({ d, step: s, profile, onState, onReload, onJumpToField }: Props) {
  const owned = WORKFLOW_OWNED[s.id];
  const [error, setError] = useState<string | null>(null);
  const act = async (p: Promise<PipelineState>) => {
    try { onState(await p); setError(null); } catch (e) { setError((e as Error).message); }
  };

  return (
    <aside className="rounded-2xl bg-paper p-6 border border-line lg:sticky lg:top-4" aria-label={`Step ${s.n} details`}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={s.status}>{STATUS_LABEL[s.status]}</Pill>
        {s.due && (
          <Pill tone={s.late ? "late" : "plain"}>
            {s.official ? "Deadline" : "Suggested by"}: {fmtDate(s.due)} ({s.lead} days before)
          </Pill>
        )}
      </div>
      <h2 className="mt-2 mb-1 text-xl font-bold">{s.n}. {s.title}</h2>
      <p className="mb-3 text-gray-70">{s.blurb}</p>
      {s.status === "blocked" && <Pill tone="blocked">Finish first: {s.blockedBy.map(b => d.byId[b].title).join(" → ")}</Pill>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-wash px-3 py-2 text-sm text-cardinal">{error}</p>}

      <SectionTitle>Checklist</SectionTitle>
      <div>
        {s.substeps.map(([k, label]) => {
          const auto = owned?.checks.includes(k);
          return (
            <label key={k} className={`flex items-center gap-2.5 border-b border-dashed border-line py-2 ${auto ? "" : "cursor-pointer"}`}
              title={auto ? "Set by the booking workflow when a reviewer decides" : undefined}>
              <input type="checkbox" className="h-[18px] w-[18px] accent-cardinal" checked={!!s.checks[k]} disabled={auto}
                onChange={e => act(pipelineApi.setCheck(s.id, k, e.target.checked))} />
              {label}
              {auto && <span className="text-xs text-gray-70">(set by the booking workflow)</span>}
            </label>
          );
        })}
      </div>

      {s.needsData && s.needsData.length > 0 && (
        <>
          <SectionTitle>{owned ? "From the confirmed booking" : "Record from replies"}</SectionTitle>
          <div className="grid gap-2">
            {s.needsData.map(f => {
              const auto = owned?.data.includes(f.key);
              return (
                <label key={f.key} className="grid gap-1 text-[13px] text-gray-70">
                  {f.label}
                  <input
                    key={`${f.key}:${s.data[f.key] ?? ""}`}
                    defaultValue={s.data[f.key] ?? ""}
                    readOnly={auto}
                    placeholder={auto ? "Filled in when the reviewer confirms" : undefined}
                    onBlur={e => !auto && e.target.value.trim() !== (s.data[f.key] ?? "") && act(pipelineApi.setData(s.id, f.key, e.target.value))}
                    className={`rounded-lg border border-line px-2.5 py-2 text-ink ${auto ? "bg-wash" : "bg-paper"}`}
                  />
                </label>
              );
            })}
          </div>
        </>
      )}

      <SectionTitle>Forms & messages</SectionTitle>
      {s.forms.length === 0 && <p className="text-gray-70">Choose a venue type in the Event profile to see the right form.</p>}
      {s.forms.map(fid => (
        <FormCard key={fid} formId={fid} step={s} profile={profile} onJumpToField={onJumpToField} onReload={onReload} />
      ))}

      {s.id === "food" && (
        <div className="mb-2.5 rounded-2xl border border-line p-3.5">
          <strong className="text-sm">Approved caterers in the permit system</strong>
          <ul className="mt-2 columns-2 pl-4 text-[13px] text-gray-70">
            {PERMIT_APPROVED_CATERERS.map(c => <li key={c}>{c}</li>)}
          </ul>
          <div className="mt-2.5"><DraftButton formId="hospitality" profile={profile} label="Draft email to Hospitality (non-approved vendor)" /></div>
        </div>
      )}
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 mb-2 text-xs font-semibold text-gray-70">{children}</h3>;
}

export function DraftButton({ formId, profile, label = "Open email draft", disabled }: { formId: string; profile: Profile; label?: string; disabled?: boolean }) {
  const draft = emailDraft(formId, profile);
  if (!draft || disabled) return <button type="button" className={btn} disabled>{label}</button>;
  return <a className={btnPrimary} href={mailto(draft)}>{label}</a>;
}

export function FormCard({ formId, step, profile, onJumpToField, onReload }: { formId: string; step: DerivedStep; profile: Profile; onJumpToField: (k: string) => void; onReload: () => void }) {
  const f = FORMS[formId];
  if (f.auto === "agent") {
    return <BookingCard kind={AGENT_FORMS[formId]} formId={formId} profile={profile} blocked={step.status === "blocked"} onJumpToField={onJumpToField} onPipelineChange={onReload} />;
  }
  const miss = missingFor(formId, profile);
  return (
    <div className="mb-2.5 rounded-2xl border border-line p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <strong className="text-sm">{f.name}</strong>
        <Pill tone="plain">{{ email: "email draft", manual: "manual" }[f.auto]}</Pill>
      </div>
      {f.rules.length > 0 && <ul className="mt-2 list-disc pl-[18px] text-[13px] text-gray-70">{f.rules.map(r => <li key={r}>{r}</li>)}</ul>}
      {miss.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5 text-[13px]">
          Needs:
          {miss.map(m => (
            <button key={m.key} type="button" title={m.problem} onClick={() => onJumpToField(m.key)} className="rounded-md bg-wash px-2 py-0.5 text-cardinal">
              {FIELD_BY_KEY[m.key]?.label.split(" (")[0] ?? m.key}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2.5 text-[13px] text-ink">✓ All {f.requires.length} required fields ready</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {f.auto === "email" && (
          <>
            <DraftButton formId={formId} profile={profile} disabled={miss.length > 0} />
            {f.url && <a className={btn} href={f.url} target="_blank" rel="noopener noreferrer">Open template</a>}
          </>
        )}
        {f.auto === "manual" && f.url && <a className={btnPrimary} href={f.url} target="_blank" rel="noopener noreferrer">Open</a>}
      </div>
    </div>
  );
}
