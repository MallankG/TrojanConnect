// Client component: rendered only from PipelineApp ("use client").
// Chat with the event agent. The agent reads and updates the plan through backend tools. When it
// starts a pre-fill, the form's card appears here with the live log; email drafts and clearing the
// event come back as cards with a button the user presses.
import { useEffect, useRef, useState } from "react";
import { pipelineApi, type AgentAction, type AgentInfo } from "@/lib/api-client";
import { FIELD_BY_KEY, type Profile } from "@/lib/pipeline/fields";
import { FORMS, type Derived, type PipelineState } from "@/lib/pipeline/plan";
import { DraftButton, FormCard } from "./StepDetail";
import { btn, btnPrimary } from "./ui";

interface Message { role: "user" | "assistant"; text: string; actions?: AgentAction[] }

interface Props {
  d: Derived;
  profile: Profile;
  onState: (s: PipelineState) => void;
  onJumpToField: (key: string) => void;
}

const STARTERS = [
  "What should I do next?",
  "Help me plan a new event",
  "Start my venue request",
  "What's blocking the permit?",
];

export function AssistantPanel({ d, profile, onState, onJumpToField }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { pipelineApi.agentInfo().then(setInfo, () => setInfo(null)); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages.map(({ role, text: t }) => ({ role, text: t }));
    setMessages(m => [...m, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const r = await pipelineApi.agentChat(message, history);
      onState(r.state);
      setMessages(m => [...m, { role: "assistant", text: r.reply, actions: r.actions }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-3" aria-label="Event assistant">
      {info && !info.configured && (
        <p role="status" className="rounded-lg bg-wait-bg px-3 py-2 text-sm text-wait">
          The assistant is not set up yet. Add <code>GEMINI_API_KEY</code> to <code>backend/.env</code> and restart the backend with <code>--env-file .env</code>.
        </p>
      )}

      <div className="rounded-xl bg-surface p-4 shadow-sm" aria-live="polite">
        {messages.length === 0 && (
          <div>
            <p className="mb-1 font-semibold">Plan and book this event by chatting.</p>
            <p className="mb-3 text-sm text-muted">
              Tell me about the event and I&apos;ll fill in the profile, tell you what&apos;s next, and line up each form or email.
              I can open and pre-fill the USC forms for you, but I never press Submit or send an email: you review and do that.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map(s => <button key={s} type="button" className={btn} disabled={busy} onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`mb-3 ${m.role === "user" ? "text-right" : ""}`}>
            <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2 text-left text-sm ${m.role === "user" ? "bg-cardinal text-on-cardinal" : "bg-paper text-ink"}`}>
              {m.text}
            </div>
            {m.actions?.map((a, j) => (
              <div key={j} className="mt-2 text-left">
                <ActionCard action={a} d={d} profile={profile} onState={onState} onJumpToField={onJumpToField} />
              </div>
            ))}
          </div>
        ))}
        {busy && <p className="text-sm text-muted">Working…</p>}
        {error && <p role="alert" className="rounded-lg bg-late-bg px-3 py-2 text-sm text-late">{error}</p>}
        <div ref={endRef} />
      </div>

      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); send(input); }}>
        <label className="sr-only" htmlFor="assistant-input">Message the event assistant</label>
        <input
          id="assistant-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="e.g. We're hosting a 40-person mixer in TCC 350 on March 4, 6–8 PM"
          maxLength={4000}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-ink"
        />
        <button type="submit" className={btnPrimary} disabled={busy || !input.trim()}>Send</button>
      </form>
      <p className="text-xs text-muted">Don&apos;t type your USC ID here. Enter it in the Event profile tab.</p>
    </section>
  );
}

function ActionCard({ action: a, d, profile, onState, onJumpToField }: { action: AgentAction } & Props) {
  const [note, setNote] = useState<string | null>(null);
  if (a.type === "form") {
    const step = a.step ? d.byId[a.step] : undefined;
    if (a.formId === "hospitality") return <DraftButton formId="hospitality" profile={profile} label="Draft email to Hospitality (non-approved vendor)" />;
    if (!step || !FORMS[a.formId]) return null;
    return <FormCard formId={a.formId} step={step} d={d} profile={profile} onJumpToField={onJumpToField} watch={a.running} />;
  }
  if (a.type === "reset") {
    const clear = async () => {
      if (!window.confirm("Clear this event? The profile, progress and activity log will be erased.")) return;
      try { onState(await pipelineApi.reset()); setNote("Event cleared. Tell me about the new event."); }
      catch (e) { setNote((e as Error).message); }
    };
    return note ? <p className="text-sm text-muted">{note}</p> : <button type="button" className={btn} onClick={clear}>Clear this event</button>;
  }
  return (
    <button type="button" className={btnPrimary} onClick={() => onJumpToField(a.key)}>
      Enter {FIELD_BY_KEY[a.key]?.label.split(" (")[0] ?? a.key} in the Event profile
    </button>
  );
}
