// Client component: rendered only from PipelineApp ("use client").
// Chat with the Club Agent. It reads and updates the plan through backend tools. When it prepares a
// venue booking or permit, the booking card appears here: the user confirms, accepts proposals or
// cancels with its buttons. Email drafts and clearing the event also come back as cards.
import { useEffect, useRef, useState } from "react";
import { pipelineApi, type AgentAction, type AgentInfo } from "@/lib/api-client";
import { FIELD_BY_KEY, fieldApplies, type Profile } from "@/lib/pipeline/fields";
import { AGENT_FORMS, FORMS, VENUE_FORM, type Derived, type PipelineState } from "@/lib/pipeline/plan";
import { BookingCard } from "./BookingCard";
import { Field } from "./ProfileForm";
import { DraftButton, FormCard } from "./StepDetail";
import { inputClass } from "@/components/ui/kit";
import { sound } from "@/lib/sound/engine";
import { btn, btnPrimary } from "./ui";

interface Message { role: "user" | "assistant"; text: string; actions?: AgentAction[] }

interface Props {
  d: Derived;
  profile: Profile;
  onState: (s: PipelineState) => void;
  onReload: () => void;
  onJumpToField: (key: string) => void;
}

const STARTERS = [
  "Book a 35 person event for December 20th 2026 from 7pm - 8pm",
  "What should I do next?",
  "Where is my booking?",
  "Pick a caterer",
];

export function AssistantPanel({ d, profile, onState, onReload, onJumpToField }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<Message[]>([]); // cards call send() later; read the latest messages, not a stale render's
  const busyRef = useRef(false);
  useEffect(() => { historyRef.current = messages; }, [messages]);

  useEffect(() => { pipelineApi.agentInfo().then(setInfo, () => setInfo(null)); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busyRef.current) return;
    busyRef.current = true;
    const history = historyRef.current.map(({ role, text: t }) => ({ role, text: t }));
    setMessages(m => [...m, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    setError(null);
    sound.play("send");
    try {
      const r = await pipelineApi.agentChat(message, history);
      onState(r.state);
      sound.play("receive");
      setMessages(m => [...m, { role: "assistant", text: r.reply, actions: r.actions }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-3" aria-label="Event assistant">
      {info?.mode === "rules" && (
        <p role="status" className="rounded-xl bg-wash px-3.5 py-2.5 text-sm text-gray-70">
          Built-in booking assistant (no AI model): it understands requests like &ldquo;book my venue&rdquo;, &ldquo;where is my booking?&rdquo;,
          &ldquo;another option&rdquo; and &ldquo;apply for the permit&rdquo;. Enter event details in the Event profile tab.
        </p>
      )}

      <div className="rounded-2xl bg-paper p-4 border border-line" aria-live="polite">
        {messages.length === 0 && (
          <div>
            <p className="mb-1 font-semibold">Plan and book this event by chatting.</p>
            <p className="mb-3 text-sm text-gray-70">
              Tell me about the event and I&apos;ll fill in the profile, tell you what&apos;s next, and prepare the venue booking and permit.
              I negotiate rooms and times with the venue agent for you, but you confirm what gets sent, you pick the proposal, and a human reviewer decides.
              I never send an email for you.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map(s => <button key={s} type="button" className={btn} disabled={busy} onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`mb-3 ${m.role === "user" ? "text-right" : ""}`}>
            <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-sm ${m.role === "user" ? "bg-cardinal text-paper" : "bg-wash text-ink"}`}>
              {m.text}
            </div>
            {m.actions?.map((a, j) => (
              // Only the newest card for each booking stays live; older ones would just repeat it.
              a.type === "booking" && messages.slice(i + 1).some(n => n.actions?.some(x => x.type === "booking" && x.kind === a.kind)) ? (
                <p key={j} className="mt-1 text-left text-xs text-gray-70">{a.kind === "venue_booking" ? "Venue booking" : "Permit"} card: see the latest one below.</p>
              ) : (
              <div key={j} className="mt-2 text-left">
                <ActionCard action={a} d={d} profile={profile} onState={onState} onReload={onReload} onJumpToField={onJumpToField}
                  onSend={send} busy={busy} latest={i === messages.length - 1} />
              </div>
              )
            ))}
          </div>
        ))}
        {busy && <p role="status" className="text-sm text-gray-70">Working on it…</p>}
        {error && <p role="alert" className="rounded-lg bg-wash px-3 py-2 text-sm text-cardinal">{error}</p>}
        <div ref={endRef} />
      </div>

      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); send(input); }}>
        <label className="sr-only" htmlFor="assistant-input">Message the event assistant</label>
        <input
          id="assistant-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="e.g. Book a 35 person event for December 20th from 7pm - 8pm"
          maxLength={4000}
          autoComplete="off"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button type="submit" className={btnPrimary} disabled={busy || !input.trim()}>Send</button>
      </form>
      <p className="text-xs text-gray-70">Don&apos;t type your USC ID here. Enter it in the Event profile tab.</p>
    </section>
  );
}

type CardProps = { action: AgentAction; onSend: (text: string) => void; busy: boolean; latest: boolean } & Props;

function ActionCard({ action: a, d, profile, onState, onReload, onJumpToField, onSend, busy, latest }: CardProps) {
  const [note, setNote] = useState<string | null>(null);
  if (a.type === "booking") {
    const formId = a.kind === "event_permit" ? "permit" : profile.venueKind ? VENUE_FORM[profile.venueKind] : Object.keys(AGENT_FORMS)[0];
    return <BookingCard kind={a.kind} formId={formId} profile={profile} onJumpToField={onJumpToField} onPipelineChange={onReload}
      onAfterAction={act => { if (act === "submit" || act === "accept" || act === "alt") onSend("Where is my booking?"); }} />;
  }
  if (a.type === "options") {
    return (
      <div className="rounded-2xl border border-line p-2">
        <p className="mb-1.5 px-1.5 text-xs font-semibold text-gray-70">{a.title}</p>
        <ul className="m-0 grid max-h-80 list-none gap-1 overflow-y-auto p-0">
          {a.options.map(o => (
            <li key={o.message}>
              <button type="button" disabled={busy || !latest} onClick={() => onSend(o.message)}
                className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-left hover:border-cardinal disabled:cursor-not-allowed disabled:opacity-60">
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-xs text-gray-70">{o.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (a.type === "fields") {
    const save = async (patch: Record<string, unknown>) => {
      try { onState(await pipelineApi.updateProfile(patch)); } catch (e) { setNote((e as Error).message); }
    };
    const defs = a.keys.map(k => FIELD_BY_KEY[k]).filter(f => f && fieldApplies(profile, f.key));
    return (
      <form className="rounded-2xl border border-line p-3" onSubmit={e => { e.preventDefault(); onSend(a.then); }}>
        <p className="mb-2 text-xs font-semibold text-gray-70">{a.title}</p>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {defs.map(f => <Field key={f.key} f={f} profile={profile} onSave={save} />)}
        </div>
        {note && <p role="alert" className="text-[13px] text-cardinal">{note}</p>}
        <button type="submit" className={btnPrimary} disabled={busy || !latest}>Continue</button>
        <span className="ml-2 text-xs text-gray-70">Each field saves when you leave it.</span>
      </form>
    );
  }
  if (a.type === "suggestions") {
    if (!latest) return null;
    return (
      <div className="flex flex-wrap gap-2">
        {a.items.map(i => <button key={i.message} type="button" className={btn} disabled={busy} onClick={() => onSend(i.message)}>{i.label}</button>)}
      </div>
    );
  }
  if (a.type === "form") {
    const step = a.step ? d.byId[a.step] : undefined;
    if (a.formId === "hospitality") return <DraftButton formId="hospitality" profile={profile} label="Draft email to Hospitality (non-approved vendor)" />;
    if (!step || !FORMS[a.formId]) return null;
    return <FormCard formId={a.formId} step={step} profile={profile} onJumpToField={onJumpToField} onReload={onReload} />;
  }
  if (a.type === "reset") {
    const clear = async () => {
      if (!window.confirm("Clear this event? The profile, progress and activity log will be erased.")) return;
      try { onState(await pipelineApi.reset()); setNote("Event cleared. Tell me about the new event."); }
      catch (e) { setNote((e as Error).message); }
    };
    return note ? <p className="text-sm text-gray-70">{note}</p> : <button type="button" className={btn} onClick={clear}>Clear this event</button>;
  }
  return (
    <button type="button" className={btnPrimary} onClick={() => onJumpToField(a.key)}>
      Enter {FIELD_BY_KEY[a.key]?.label.split(" (")[0] ?? a.key} in the Event profile
    </button>
  );
}
