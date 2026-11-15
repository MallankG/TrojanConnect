import { FIELDS, fieldProblem, type Profile } from "@/lib/pipeline/fields";
import { FORMS } from "@/lib/pipeline/plan";

const FORM_IDS = Object.keys(FORMS);
const USED = FIELDS.filter(f => FORM_IDS.some(id => FORMS[id].requires.includes(f.key)));

/** Which profile field feeds which form, and whether it's filled yet. */
export function FieldMatrix({ profile }: { profile: Profile }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-paper border border-line">
      <table className="min-w-[900px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-paper px-2.5 py-1.5 text-left align-bottom">Field</th>
            {FORM_IDS.map(id => (
              <th key={id} className="h-44 px-2.5 py-1.5 text-left align-bottom font-semibold whitespace-nowrap [writing-mode:vertical-rl] rotate-180">
                {FORMS[id].name.split(" (")[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {USED.map(f => {
            const ok = !fieldProblem(profile, f.key);
            return (
              <tr key={f.key} className="border-t border-line">
                <td className="sticky left-0 bg-paper px-2.5 py-1.5">{f.label.split(" (")[0]}</td>
                {FORM_IDS.map(id => (
                  <td key={id} className={`px-2.5 py-1.5 text-center font-bold ${ok ? "text-ink" : "text-cardinal"}`}>
                    {FORMS[id].requires.includes(f.key) ? (ok ? <span aria-label="filled">●</span> : <span aria-label="missing">○</span>) : null}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
