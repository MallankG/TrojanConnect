// Client component: rendered only from PipelineApp ("use client").
import { FIELDS, fieldApplies, fieldProblem, type FieldDef, type Profile } from "@/lib/pipeline/fields";
import { FORMS } from "@/lib/pipeline/plan";

const USED_BY: Record<string, number> = Object.fromEntries(
  FIELDS.map(f => [f.key, Object.values(FORMS).filter(v => v.requires.includes(f.key)).length]),
);
const GROUPS = [...new Set(FIELDS.map(f => f.group))];
const input = "w-full rounded-lg border bg-paper px-2.5 py-2 text-ink";

export function ProfileForm({ profile, onSave }: { profile: Profile; onSave: (patch: Record<string, unknown>) => void }) {
  return (
    <form className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4" onSubmit={e => e.preventDefault()}>
      {GROUPS.map(g => (
        <fieldset key={g} className="m-0 rounded-xl border-0 bg-surface p-4 shadow-sm">
          <legend className="float-left mb-2 w-full p-0 font-bold">{g}</legend>
          <div className="clear-both">
            {FIELDS.filter(f => f.group === g && fieldApplies(profile, f.key)).map(f => (
              <Field key={f.key} f={f} profile={profile} onSave={onSave} />
            ))}
          </div>
        </fieldset>
      ))}
    </form>
  );
}

function Field({ f, profile, onSave }: { f: FieldDef; profile: Profile; onSave: (patch: Record<string, unknown>) => void }) {
  const v = profile[f.key];
  const prob = f.optional ? null : fieldProblem(profile, f.key);
  const bad = !!prob && prob !== "missing";
  const border = bad ? "border-late" : "border-line";
  const commit = (val: unknown) => { if (val !== v) onSave({ [f.key]: val }); };
  const id = `fld-${f.key}`;

  let control: React.ReactNode;
  if (f.type === "select") {
    control = (
      <select id={id} className={`${input} ${border}`} value={String(v ?? "")} onChange={e => commit(e.target.value)}>
        <option value="">Choose…</option>
        {f.options!.map(o => <option key={o} value={o}>{f.optionLabels?.[o] ?? o}</option>)}
      </select>
    );
  } else if (f.type === "bool") {
    control = (
      <div className="flex gap-3.5" role="radiogroup" aria-labelledby={`${id}-l`}>
        {[true, false].map(b => (
          <label key={String(b)} className="inline-flex items-center gap-1.5">
            <input type="radio" name={f.key} checked={v === b} onChange={() => commit(b)} /> {b ? "Yes" : "No"}
          </label>
        ))}
      </div>
    );
  } else if (f.type === "multi") {
    const arr = (v as string[] | undefined) ?? [];
    control = (
      <div className="flex flex-wrap gap-3" role="group" aria-labelledby={`${id}-l`}>
        {f.options!.map(o => (
          <label key={o} className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={arr.includes(o)} onChange={e => commit(e.target.checked ? [...arr, o] : arr.filter(x => x !== o))} /> {o}
          </label>
        ))}
      </div>
    );
  } else if (f.type === "textarea") {
    control = <textarea id={id} key={String(v ?? "")} defaultValue={String(v ?? "")} onBlur={e => commit(e.target.value)} className={`${input} ${border} min-h-[70px] resize-y`} />;
  } else {
    control = (
      <input
        id={id}
        key={String(v ?? "")}
        type={f.type === "number" ? "number" : f.type}
        step={f.type === "time" ? 1800 : undefined}
        defaultValue={String(v ?? "")}
        onBlur={e => commit(e.target.value)}
        className={`${input} ${border}`}
      />
    );
  }

  return (
    <div className="mb-3 grid gap-1 rounded-lg" data-field={f.key}>
      <label id={`${id}-l`} htmlFor={f.type === "bool" || f.type === "multi" ? undefined : id} className="text-[13px] text-muted">
        {f.label}{f.optional && " (optional)"}
      </label>
      {control}
      {bad && <span className="text-xs text-late">{prob}</span>}
      {USED_BY[f.key] > 0 && <span className="text-[11px] text-muted">Used by {USED_BY[f.key]} form{USED_BY[f.key] > 1 ? "s" : ""}</span>}
    </div>
  );
}
