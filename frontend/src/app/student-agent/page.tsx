"use client";

import { FormEvent, useState } from "react";

type Message = { sender_type: "user" | "agent" | "system"; content: string };
type Turn = { message: Message; pending_confirmation?: { summary: string } | null };

const api = process.env.NEXT_PUBLIC_STUDENT_AGENT_API_URL ?? "http://localhost:8000";
const user = process.env.NEXT_PUBLIC_DEMO_USER ?? "demo-student-1";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function request(path: string, body: unknown) {
    const response = await fetch(`${api}/api/v1${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Demo-User": user },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "The student agent could not respond.");
    return result.data;
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = new FormData(form).get("message");
    const content = typeof input === "string" ? input.trim() : "";
    if (!content || busy) return;
    form.reset();
    setMessages((items) => [...items, { sender_type: "user", content }]);
    setBusy(true);
    setError("");
    try {
      const data = conversationId
        ? await request(`/conversations/${conversationId}/messages`, { content })
        : await request("/conversations", { agent_type: "student", channel: "web", message: content });
      const turn: Turn = data.turn ?? data;
      if (!conversationId && data.conversation?.id) setConversationId(data.conversation.id);
      setMessages((items) => [...items, turn.message]);
      setPending(Boolean(turn.pending_confirmation));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reach the student agent.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(confirmed: boolean) {
    if (!conversationId || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await request(`/conversations/${conversationId}/confirm`, { confirmed });
      const turn: Turn = data.turn ?? data;
      setMessages((items) => [...items, turn.message]);
      setPending(Boolean(turn.pending_confirmation));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not submit your choice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="chat-shell">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark">T</span> TrojanConnect</a>
        <span className="environment"><span /> Student agent preview</span>
      </header>
      <section className="chat-panel" aria-label="Student agent chat">
        <div className="intro">
          <p className="eyebrow">YOUR USC COMMUNITY, MADE EASIER</p>
          <h1>Find your people.</h1>
          <p className="subhead">Ask about student organizations, events, and ways to get involved at USC.</p>
        </div>
        <div className="messages" aria-live="polite">
          {messages.length === 0 ? (
            <div className="suggestions">
              <p>Try asking</p>
              {["What clubs work on AI and robotics?", "How can I get involved in student government?", "Find service events this month"].map((text) => (
                <button key={text} type="button" onClick={() => {
                  const input = document.querySelector<HTMLInputElement>("#chat-message");
                  if (input) { input.value = text; input.form?.requestSubmit(); }
                }}>{text}<span>↗</span></button>
              ))}
            </div>
          ) : messages.map((message, index) => (
            <article className={`message ${message.sender_type === "user" ? "from-user" : "from-agent"}`} key={`${index}-${message.content.slice(0, 12)}`}>
              {message.sender_type !== "user" && <span className="avatar">T</span>}
              <p>{message.content}</p>
            </article>
          ))}
          {busy && <p className="status">Thinking…</p>}
          {pending && <div className="confirmation"><span>Ready to submit this request?</span><button disabled={busy} onClick={() => confirm(true)}>Confirm</button><button className="secondary" disabled={busy} onClick={() => confirm(false)}>Cancel</button></div>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
        <form className="composer" onSubmit={send}>
          <input id="chat-message" name="message" aria-label="Message the student agent" placeholder="Ask anything about USC student life…" autoComplete="off" />
          <button aria-label="Send message" disabled={busy}>↑</button>
        </form>
        <p className="privacy-note">A local demo session. Your messages are sent to the configured student-agent API.</p>
      </section>
    </main>
  );
}
