"use client";

// RSO recognition cards for the Assistant (rso_checklist, handoff, rso_email, rso_status, fields with scope "rso")
// and the RSO recognition tab. Built from the same tokens and pieces as the booking card. TrojanConnect tracks
// progress and hands off to EngageSC; it never signs in to or submits anything on USC systems.
import { useCallback, useEffect, useState } from "react";
import { rsoApi, type RsoPortal, type RsoSchema, type RsoState, type RsoStatus, type RsoStep } from "@/lib/api-client";
import type { FieldDef } from "@/lib/pipeline/fields";
import { Field } from "./ProfileForm";
import { Pill, btn, btnPrimary, type Tone } from "./ui";

// ---- shared state: every card refreshes when any card changes the tracker -----------------------
const EVENT = "tc-rso-changed";
export function announceRsoChange() { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT)); }

export function useRso() {
  const [rso, setRso] = useState<RsoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => rsoApi.state().then(s => { if (alive) { setRso(s); setError(null); } }, e => { if (alive) setError((e as Error).message); });
    load();
    window.addEventListener(EVENT, load);
    return () => { alive = false; window.removeEventListener(EVENT, load); };
  }, []);
  const act = useCallback(async (p: Promise<unknown>) => {
    try { await p; setError(null); } catch (e) { setError((e as Error).message); }
    announceRsoChange();
  }, []);
  return { rso, error, act };
}

let schemaPromise: Promise<RsoSchema> | null = null;
function useRsoSchema() {
  const [schema, setSchema] = useState<RsoSchema | null>(null);
  useEffect(() => {
    let alive = true;
    (schemaPromise ??= rsoApi.schema()).then(s => { if (alive) setSchema(s); }, () => { schemaPromise = null; });
    return () => { alive = false; };
  }, []);
  return schema;
}

const STATUS_TONE: Record<RsoStatus, Tone> = {
  not_started: "plain", in_progress: "ready", pending_approval: "waiting", requires_modifications: "late", denied: "late", recognized: "done",
};
const WHERE: Record<RsoStep["where"], string> = { engage: "on EngageSC", usc: "USC forms and trainings", trojanconnect: "here" };
// Steps the rep ticks themselves; the rest are computed from fields, officer items or the recorded status.
const MANUAL = new Set(["check_directory", "officer_access", "start_application", "group_details", "constitution", "accountability", "questions"]);

const card = "rounded-xl border border-line p-3.5";
const sectionTitle = "mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-70";

function ExternalLinks({ links }: { links: { label: string; url: string; key?: string }[] }) {
  if (!links.length) return null;
  return (
    <ul className="mt-1.5 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[13px]">
      {links.map(l => (
        <li key={l.url}><a className="text-cardinal underline underline-offset-2" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a></li>
      ))}
    </ul>
  );
}

function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange?: (v: boolean) => void; label: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2.5 py-1.5 text-[13px] ${disabled ? "" : "cursor-pointer"}`}>
      <input type="checkbox" className="mt-0.5 h-[16px] w-[16px] shrink-0 accent-ok" checked={checked} disabled={disabled} onChange={e => onChange?.(e.target.checked)} />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

export function RsoStepRow({ step, act, compact = false }: { step: RsoStep; act: (p: Promise<unknown>) => void; compact?: boolean }) {
  const manual = MANUAL.has(step.id);
  return (
    <div className="border-b border-dashed border-line py-2 last:border-0">
      <div className="flex flex-wrap items-start gap-2">
        {manual ? (
          <input type="checkbox" aria-label={`Mark "${step.title}" done`} className="mt-1 h-[16px] w-[16px] accent-ok" checked={step.done}
            onChange={e => act(rsoApi.setCheck(`step.${step.id}`, e.target.checked))} />
        ) : (
          <span aria-hidden className={`mt-0.5 text-sm ${step.done ? "text-ink" : "text-gray-70"}`}>{step.done ? "✓" : "○"}</span>
        )}
        <div className="min-w-0 flex-1">
          <span className={`text-sm font-semibold ${step.done ? "text-gray-70 line-through decoration-1" : ""}`}>{step.title}</span>
          <span className="ml-2 text-xs text-gray-70">{step.done ? "Done" : WHERE[step.where]}</span>
          {!compact && <p className="m-0 mt-0.5 text-[13px] text-gray-70">{step.detail}</p>}
          <ExternalLinks links={step.links} />
        </div>
      </div>
    </div>
  );
}

function Officers({ rso, act }: { rso: RsoState; act: (p: Promise<unknown>) => void }) {
  return (
    <div className="grid gap-2.5">
      {rso.officers.map(o => (
        <div key={o.role} className="rounded-lg bg-paper p-2.5">
          <p className="m-0 text-sm font-semibold">{o.label}{o.name ? `: ${o.name}` : ""} <span className="font-normal text-gray-70">{o.email}</span></p>
          <Check checked={o.accepted} onChange={v => act(rsoApi.setCheck(`${o.role}.accepted`, v))} label="Accepted the position (EngageSC email from mailer@campusgroups.com)" />
          {o.docs.map(d => (
            <Check key={d.id} checked={d.done} onChange={v => act(rsoApi.setCheck(`${o.role}.${d.id}`, v))}
              label={<>{d.label} · <a className="text-cardinal underline underline-offset-2" href={d.url} target="_blank" rel="noopener noreferrer">open ↗</a></>} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Advisor({ rso, act }: { rso: RsoState; act: (p: Promise<unknown>) => void }) {
  return (
    <div className="rounded-lg bg-paper p-2.5">
      <p className="m-0 text-sm font-semibold">{rso.advisor.name || "Advisor"} <span className="font-normal text-gray-70">{rso.advisor.email}</span></p>
      {rso.advisor.full_time !== true && <p className="m-0 mt-1 text-[13px] text-cardinal">Confirm the advisor is full-time USC faculty or staff, not on sabbatical or leave.</p>}
      {rso.advisor.items.map(i => (
        <Check key={i.id} checked={i.done} onChange={v => act(rsoApi.setCheck(`advisor.${i.id}`, v))}
          label={<>{i.label}{i.url && <> · <a className="text-cardinal underline underline-offset-2" href={i.url} target="_blank" rel="noopener noreferrer">open ↗</a></>}</>} />
      ))}
    </div>
  );
}

function Header({ rso }: { rso: RsoState }) {
  const deadline = rso.dates.find(d => d.id === "application_deadline");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="text-sm">{rso.pathway_label ? `RSO recognition · ${rso.pathway_label}` : "RSO recognition"}</strong>
      <div className="flex flex-wrap gap-1.5">
        <Pill tone={STATUS_TONE[rso.status]}>{rso.status_label}</Pill>
        {deadline && !rso.application_closed && <Pill tone={deadline.days_left <= 3 ? "late" : "plain"}>Due Nov 22 · {deadline.days_left}d left</Pill>}
        {rso.application_closed && <Pill tone="late">Application closed</Pill>}
      </div>
    </div>
  );
}

/** Assistant card: {type: "rso_checklist", section, step?}. */
export function RsoChecklistCard({ section, step }: { section: "steps" | "officers" | "advisor" | "step"; step?: string }) {
  const { rso, error, act } = useRso();
  if (error) return <p role="alert" className="text-[13px] text-cardinal">{error}</p>;
  if (!rso) return <p className="text-[13px] text-gray-70">Loading RSO checklist…</p>;
  const one = rso.steps.find(s => s.id === step);
  return (
    <div className={card}>
      <Header rso={rso} />
      {section === "steps" && (
        <>
          <p className="mt-1 mb-1 text-[13px] text-gray-70">{rso.steps_done} of {rso.steps_total} steps done{rso.ready_to_submit ? " · ready to submit on EngageSC" : ""}</p>
          {rso.steps.map(s => <RsoStepRow key={s.id} step={s} act={act} compact />)}
        </>
      )}
      {section === "step" && one && <RsoStepRow step={one} act={act} />}
      {section === "officers" && <div className="mt-2"><Officers rso={rso} act={act} /></div>}
      {section === "advisor" && <div className="mt-2"><Advisor rso={rso} act={act} /></div>}
    </div>
  );
}

/** Assistant card: {type: "handoff", title, url, label, steps}. */
export function HandoffCard({ title, url, label, steps }: { title: string; url: string; label: string; steps: string[] }) {
  return (
    <div className={card}>
      <p className={sectionTitle}>{title}</p>
      <ol className="m-0 mb-2.5 pl-5 text-[13px]">{steps.map(s => <li key={s}>{s}</li>)}</ol>
      <a className={btnPrimary} href={url} target="_blank" rel="noopener noreferrer">{label} ↗</a>
      <p className="mt-2 mb-0 text-xs text-gray-70">Opens EngageSC (USC login). TrojanConnect doesn&apos;t sign in or submit for you.</p>
    </div>
  );
}

/** Assistant card: {type: "rso_portal"}. The portal agent submits through the simulated EngageSC and reads the status back. */
export function RsoPortalCard() {
  const { rso } = useRso();
  const [portal, setPortal] = useState<RsoPortal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = portal?.running ?? false;
  useEffect(() => {
    let alive = true;
    const load = () => rsoApi.portal().then(p => { if (alive) setPortal(p); }, e => { if (alive) setError((e as Error).message); });
    load();
    window.addEventListener(EVENT, load);
    return () => { alive = false; window.removeEventListener(EVENT, load); };
  }, []);
  // Follow a run's live log; when it finishes, refresh every RSO card (the status may have changed).
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const p = await rsoApi.portal().catch(() => null);
      if (!p) return;
      setPortal(p);
      if (!p.running) { clearInterval(t); announceRsoChange(); }
    }, 900);
    return () => clearInterval(t);
  }, [running]);
  const start = async (fn: () => Promise<RsoPortal>) => {
    setError(null);
    try { setPortal(await fn()); } catch (e) { setError((e as Error).message); }
  };
  if (!portal) return null;
  if (!portal.enabled) return <p className="text-[13px] text-gray-70">The simulated portal is turned off. Submit on EngageSC yourself.</p>;
  const app = portal.application;
  const canResubmit = rso?.status === "requires_modifications";
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">Portal agent</strong>
        <Pill tone="waiting">Simulated EngageSC · demo data</Pill>
      </div>
      <p className="mt-1 mb-2 text-[13px] text-gray-70">
        Drives a browser through the simulated EngageSC like a person: signs in, opens the Directory, fills in the form from this checklist,
        uploads placeholder documents, submits, and reads the status from My Activity. Nothing reaches USC.
      </p>
      {app && (
        <p className="m-0 mb-2 text-[13px]">
          Application <b>{app.application_id}</b> · portal status <b>{app.portal_status}</b>{app.note ? ` · “${app.note}”` : ""}
          {app.last_checked && <span className="text-gray-70"> · checked {new Date(app.last_checked).toLocaleTimeString()}</span>}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(!app || canResubmit) && (
          <button type="button" className={btnPrimary} disabled={running || !rso?.ready_to_submit} onClick={() => start(rsoApi.portalSubmit)}
            title={rso?.ready_to_submit ? undefined : "Finish the checklist first"}>
            {running && portal.kind === "submit" ? "Submitting…" : app ? "Resubmit through the portal" : "Submit through the portal"}
          </button>
        )}
        {app && <button type="button" className={btn} disabled={running} onClick={() => start(rsoApi.portalSync)}>{running && portal.kind === "sync" ? "Checking…" : "Check status now"}</button>}
        <a className={btn} href={portal.base_url} target="_blank" rel="noopener noreferrer">Open simulated EngageSC ↗</a>
        {app && <a className={btn} href={portal.admin_url} target="_blank" rel="noopener noreferrer">Simulated Campus Activities review ↗</a>}
      </div>
      {!rso?.ready_to_submit && !app && <p className="mt-2 mb-0 text-[13px] text-cardinal">Not ready yet: {rso?.submit_blockers.join("; ") || "the application window is closed"}</p>}
      {(error || portal.error) && <p role="alert" className="mt-2 mb-0 text-[13px] text-cardinal">{error || portal.error}</p>}
      {portal.lines.length > 0 && (
        <pre className="mt-2.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-2.5 text-xs" aria-live="polite">{portal.lines.join("\n")}</pre>
      )}
    </div>
  );
}

/** Assistant card: {type: "rso_email", target}. */
export function RsoEmailCard({ target }: { target: string }) {
  const [draft, setDraft] = useState<{ to: string; subject: string; mailto: string; ready: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => rsoApi.email(target).then(d => { if (alive) setDraft(d); }, e => { if (alive) setError((e as Error).message); });
    load();
    window.addEventListener(EVENT, load);
    return () => { alive = false; window.removeEventListener(EVENT, load); };
  }, [target]);
  if (error) return <p role="alert" className="text-[13px] text-cardinal">{error}</p>;
  if (!draft) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-[13px]">
      <span className="min-w-0 flex-1"><b>{draft.subject}</b><br /><span className="text-gray-70">{draft.to || "Add their USC email in the roster first"}</span></span>
      {draft.ready ? <a className={btn} href={draft.mailto}>Open email draft</a> : <button type="button" className={btn} disabled>Open email draft</button>}
    </div>
  );
}

/** Assistant card: {type: "rso_status"}. Only a person records what EngageSC shows. */
export function RsoStatusCard() {
  const { rso, error, act } = useRso();
  const options: [Exclude<RsoStatus, "not_started" | "in_progress">, string][] = [
    ["pending_approval", "Submitted · Pending Approval"], ["requires_modifications", "Requires Modifications"], ["denied", "Denied"], ["recognized", "Recognized"],
  ];
  return (
    <div className={card}>
      <p className={sectionTitle}>Record what EngageSC shows</p>
      <div className="flex flex-wrap gap-2">
        {options.map(([s, label]) => (
          <button key={s} type="button" className={rso?.status === s ? btnPrimary : btn} aria-pressed={rso?.status === s}
            onClick={() => { if (window.confirm(`Record the EngageSC status as "${label}"?`)) act(rsoApi.recordStatus(s)); }}>{label}</button>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-[13px] text-cardinal">{error}</p>}
    </div>
  );
}

/** Assistant card: {type: "fields", scope: "rso", keys, title, then}. Each field saves on blur; Continue sends `then`. */
export function RsoFieldsCard({ keys, title, then, onSend, disabled }: { keys: string[]; title: string; then: string; onSend: (t: string) => void; disabled?: boolean }) {
  const schema = useRsoSchema();
  const { rso, act } = useRso();
  const [rejected, setRejected] = useState<Record<string, string>>({});
  if (!schema || !rso) return <p className="text-[13px] text-gray-70">Loading…</p>;
  const defs: FieldDef[] = keys.map(k => schema.fields.find(f => f.key === k)).filter((f): f is NonNullable<typeof f> => !!f)
    .map(f => ({ key: f.key, group: f.group, label: f.label, type: f.type, options: f.options, optionLabels: f.option_labels, optional: f.optional }));
  const save = (patch: Record<string, unknown>) => act(rsoApi.setFields(patch).then(r => setRejected(prev => {
    const next = { ...prev };
    for (const k of Object.keys(patch)) delete next[k];
    return { ...next, ...r.rejected };
  })));
  return (
    <form className={card} onSubmit={e => { e.preventDefault(); onSend(then); }}>
      <p className={sectionTitle}>{title}</p>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {defs.map(f => (
          <div key={f.key}>
            <Field f={f} profile={rso.fields} onSave={save} />
            {rejected[f.key] && <p role="alert" className="-mt-2 mb-2 text-xs text-cardinal">{rejected[f.key]}</p>}
          </div>
        ))}
      </div>
      <button type="submit" className={btnPrimary} disabled={disabled}>Continue</button>
      <span className="ml-2 text-xs text-gray-70">Each field saves when you leave it.</span>
    </form>
  );
}

/** The RSO recognition tab: the whole process on one screen. */
export function RsoPanel({ onAsk }: { onAsk: (message: string) => void }) {
  const { rso, error, act } = useRso();
  const schema = useRsoSchema();
  if (error) return <p role="alert" className="rounded-lg bg-cardinal-10 px-3 py-2 text-sm text-cardinal">{error}</p>;
  if (!rso || !schema) return <p className="text-gray-70">Loading RSO recognition…</p>;
  return (
    <section className="mx-auto grid max-w-3xl gap-4" aria-label="RSO recognition">
      <div className="rounded-xl bg-wash p-5 shadow-sm">
        <Header rso={rso} />
        <p className="mt-2 mb-0 text-[13px] text-gray-70">
          {rso.cycle}. Source: <a className="text-cardinal underline underline-offset-2" href={rso.source.url} target="_blank" rel="noopener noreferrer">{rso.source.label} ↗</a> (checked {rso.source.checked}).
          You submit on EngageSC; TrojanConnect tracks the steps and hands off.
        </p>
        {!rso.pathway ? (
          <div className="mt-3 grid gap-1.5">
            {schema.pathways.map(p => (
              <button key={p.id} type="button" className="rounded-lg border border-line bg-paper px-3 py-2 text-left hover:border-cardinal"
                onClick={() => p.id === "renew" ? onAsk("Renew our existing RSO") : act(rsoApi.setPathway(p.id))}>
                <span className="block text-sm font-semibold">{p.label}</span><span className="block text-xs text-gray-70">{p.detail}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="mt-2 mb-0 text-[13px]">{rso.pathway_detail}</p>
            {rso.next_step && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-wash px-3 py-2 text-[13px] text-ink">
                <span className="min-w-0 flex-1"><b>Next:</b> {rso.next_step.title}</span>
                <button type="button" className={btn} onClick={() => onAsk(`RSO step ${rso.next_step!.id}`)}>Ask the assistant</button>
              </div>
            )}
          </>
        )}
      </div>

      {rso.pathway && rso.steps.length > 0 && (
        <>
          <div className="rounded-xl bg-wash p-5 shadow-sm">
            <p className={sectionTitle}>Steps · {rso.steps_done}/{rso.steps_total}</p>
            {rso.steps.map(s => <RsoStepRow key={s.id} step={s} act={act} />)}
            {rso.handoff && <div className="mt-3"><HandoffCard {...rso.handoff} /></div>}
          </div>
          <div className="rounded-xl bg-wash p-5 shadow-sm">
            <p className={sectionTitle}>Organization and roster</p>
            {rso.roster_gaps.length > 0 && <ul className="mt-0 mb-2 list-disc pl-5 text-[13px] text-cardinal">{rso.roster_gaps.map(g => <li key={g}>{g}</li>)}</ul>}
            <RsoFieldsCard keys={schema.fields.map(f => f.key)} title="Details" then="RSO next step" onSend={onAsk} />
          </div>
          <div className="rounded-xl bg-wash p-5 shadow-sm">
            <p className={sectionTitle}>Officer documents</p>
            <Officers rso={rso} act={act} />
          </div>
          <div className="rounded-xl bg-wash p-5 shadow-sm">
            <p className={sectionTitle}>Advisor requirements (due Dec 1)</p>
            <Advisor rso={rso} act={act} />
          </div>
          <RsoPortalCard />
          <RsoStatusCard />
        </>
      )}

      <div className="rounded-xl bg-wash p-5 text-[13px] shadow-sm">
        <p className={sectionTitle}>Dates</p>
        <ul className="m-0 list-none p-0">{rso.dates.map(d => <li key={d.id} className="py-0.5"><b>{d.label}:</b> {d.text}</li>)}</ul>
        <p className={`${sectionTitle} mt-3`}>Sessions and office hours</p>
        <ul className="m-0 list-none p-0">{schema.sessions.map(s => <li key={s.kind + s.when} className="py-0.5">{s.kind}: {s.when}</li>)}</ul>
        <p className={`${sectionTitle} mt-3`}>Contact</p>
        <p className="m-0">{schema.contact.office} · <a className="text-cardinal underline" href={`mailto:${schema.contact.email}`}>{schema.contact.email}</a> · {schema.contact.phone} · {schema.contact.location} · {schema.contact.hours}</p>
        <p className={`${sectionTitle} mt-3`}>Where USC&apos;s pages disagree</p>
        <ul className="m-0 list-disc pl-5 text-gray-70">{schema.discrepancies.map(d => <li key={d}>{d}</li>)}</ul>
        {rso.pathway && (
          <button type="button" className={`${btn} mt-3`} onClick={() => { if (window.confirm("Clear the RSO tracker?")) act(rsoApi.reset()); }}>Clear RSO tracker</button>
        )}
      </div>
    </section>
  );
}
