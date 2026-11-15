"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, ExternalLink, Flag, RotateCw, ShieldQuestion, UserRoundCheck } from "lucide-react";
import { api, useDb, useUser } from "@/lib/api/client";
import type { ChatMessage, Conversation, MessageCard, Result } from "@/lib/api/types";
import { fmtDay, fmtTime } from "@/lib/time";
import { sound } from "@/lib/sound/engine";
import { Poster } from "@/components/ui/Poster";
import { Button, ErrorNote, EmptyState, useToast } from "@/components/ui/kit";
import { ProposalCard, RequestSummary, StatusCard } from "@/components/booking/parts";

/** Route a message to the right agent for this kind of conversation. */
function send(conversation: Conversation, text: string): Promise<Result<null>> {
  switch (conversation.kind) {
    case "booking":
      return api.sendBookingMessage(conversation.id, text);
    case "club":
      return api.askClub(conversation.id, text);
    case "student":
      return api.askStudentAgent(conversation.id, text);
    case "government":
      return api.askGovernment(conversation.id, text, conversation.agentName.startsWith("GSG") ? "GSG" : "USG");
  }
}

const ROLE_LINE: Record<Conversation["kind"], string> = {
  booking: "Acts for your club. Prepares and negotiates; cannot approve or confirm.",
  club: "Answers only from the club's public profile, FAQ and events.",
  student: "Uses only the interests you chose and public club profiles.",
  government: "Answers from approved sources. Not an elected representative.",
};

export function Chat({
  conversationId,
  suggestions = [],
  placeholder = "Write a message",
  className = "",
}: {
  conversationId: string;
  suggestions?: string[];
  placeholder?: string;
  className?: string;
}) {
  const db = useDb();
  const user = useUser();
  const conversation = db.conversations.find((c) => c.id === conversationId);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState<{ text: string; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const count = conversation?.messages.length ?? 0;
  const seen = useRef(count);

  // Keep the newest message in view, and give incoming messages a soft cue.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: seen.current === 0 ? "auto" : "smooth" });
    if (count > seen.current && conversation) {
      const last = conversation.messages[count - 1];
      if (last.sender === "reviewer") sound.play("stamp");
      else if (last.sender === "agent") sound.play("receive");
      else if (last.sender === "system") sound.play("tick", { volume: 0.5 });
    }
    seen.current = count;
  }, [count, conversation, conversation?.activity]);

  if (!conversation) {
    return (
      <EmptyState
        title="Conversation not found"
        body="It may belong to another demo role, or the demo data was reset."
      />
    );
  }
  const mine = conversation.ownerId === user?.id;

  const submit = async (value: string) => {
    const message = value.trim();
    if (!message || sending) return;
    setText("");
    setFailed(null);
    setSending(true);
    sound.play("send");
    try {
      const result = await send(conversation, message);
      if (!result.ok) setFailed({ text: message, message: result.error.message });
    } catch {
      setFailed({ text: message, message: "The message could not be delivered." });
    }
    setSending(false);
  };

  return (
    <section
      aria-label={`Conversation with ${conversation.agentName}`}
      className={`flex min-h-0 flex-col overflow-hidden rounded-3xl border border-line bg-paper ${className}`}
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-cardinal text-sm font-bold text-gold">
          {conversation.agentName[0]}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-tight">{conversation.agentName}</p>
          <p className="truncate text-xs text-gray-70">{ROLE_LINE[conversation.kind]}</p>
        </div>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {conversation.messages.map((message) => (
          <Bubble key={message.id} message={message} />
        ))}
        {conversation.activity && (
          <p role="status" className="flex items-center justify-center gap-2 py-1 text-[13px] text-gray-70">
            <span className="flex gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 rounded-full bg-gray-70"
                  style={{ animation: `dot-pulse 1.2s ${i * 0.18}s infinite` }}
                />
              ))}
            </span>
            {conversation.activity}
          </p>
        )}
        {failed && (
          <div className="space-y-2">
            <ErrorNote>{failed.message}</ErrorNote>
            <Button onClick={() => submit(failed.text)}>
              <RotateCw aria-hidden className="size-4" />
              Send again
            </Button>
          </div>
        )}
      </div>

      {mine ? (
        <div className="border-t border-line p-3">
          {suggestions.length > 0 && conversation.messages.length <= 1 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="rounded-full border border-line px-3 py-1.5 text-left text-sm hover:border-gray-70"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex items-end gap-2 rounded-[26px] bg-wash p-1.5 pl-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(text);
            }}
          >
            <label className="sr-only" htmlFor={`msg-${conversation.id}`}>Message</label>
            <textarea
              id={`msg-${conversation.id}`}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit(text);
                }
              }}
              placeholder={placeholder}
              className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] placeholder:text-gray-70 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              aria-label="Send message"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-cardinal text-paper transition-colors hover:bg-cardinal-20 disabled:opacity-40"
            >
              <ArrowUp className="size-5" strokeWidth={2.5} />
            </button>
          </form>
          <Escalate conversation={conversation} />
        </div>
      ) : (
        <p className="border-t border-line px-4 py-3 text-sm text-gray-70">
          You are reading this conversation. Only its owner can send messages.
        </p>
      )}
    </section>
  );
}

/** "Report or escalate" (PRD 11.8): hands the thread to a person. */
function Escalate({ conversation }: { conversation: Conversation }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast("Flagged for a person to review")}
      className="mt-2 inline-flex items-center gap-1.5 px-2 text-xs text-gray-70 hover:text-ink"
    >
      <Flag aria-hidden className="size-3.5" />
      Report a problem with {conversation.agentName}
    </button>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.sender === "system") {
    return (
      <div className="msg-in">
        {message.card ? (
          <div className="max-w-[92%]"><Card card={message.card} /></div>
        ) : (
          <p className="py-0.5 text-center text-[13px] text-gray-70">{message.text}</p>
        )}
      </div>
    );
  }
  if (message.sender === "user") {
    return (
      <p className="msg-in ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-md bg-cardinal px-4 py-2.5 text-[15px] leading-snug text-paper">
        {message.text}
      </p>
    );
  }
  if (message.sender === "reviewer") {
    return (
      <div className="msg-in max-w-[92%]">
        <p className="mb-1 flex items-center gap-1.5 pl-1 text-xs text-gray-70">
          <UserRoundCheck aria-hidden className="size-3.5" />
          {message.name}, venue reviewer · a person
        </p>
        <p className="rounded-2xl border border-ink px-4 py-3 font-serif text-[17px] italic leading-snug">
          {message.text}
        </p>
      </div>
    );
  }
  return (
    <div className="msg-in max-w-[92%]">
      <p className="mb-1 pl-1 text-xs text-gray-70">{message.name}</p>
      <p className="w-fit whitespace-pre-wrap rounded-3xl rounded-bl-md bg-wash px-4 py-2.5 text-[15px] leading-snug">
        {message.unverified && (
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium">
            <ShieldQuestion aria-hidden className="size-3.5" />
            Not verified
          </span>
        )}
        {message.text}
      </p>
      {message.toolSummary && (
        <p className="mt-1 pl-1 text-xs text-gray-70">Checked: {message.toolSummary}</p>
      )}
      {message.sources && (
        <ul className="mt-2 space-y-1 pl-1">
          {message.sources.map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm underline decoration-gray-30 underline-offset-2 hover:decoration-ink"
              >
                <ExternalLink aria-hidden className="size-3.5" />
                {s.title}
              </a>
              <span className="tabular text-xs text-gray-70">
                {" "}· {s.kind === "news" ? "news report" : s.owner ?? "official source"}, checked {fmtDay(s.verifiedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {message.card && <div className="mt-2"><Card card={message.card} /></div>}
    </div>
  );
}

function Card({ card }: { card: MessageCard }) {
  const db = useDb();
  const user = useUser();
  const toast = useToast();

  if (card.type === "summary" || card.type === "proposal" || card.type === "status") {
    const booking = db.bookings.find((b) => b.id === card.bookingId);
    if (!booking) return null;
    if (card.type === "status") return <StatusCard booking={booking} />;
    if (card.type === "proposal") {
      const proposal = booking.proposals.find((p) => p.id === card.proposalId);
      return proposal ? <ProposalCard booking={booking} proposal={proposal} /> : null;
    }
    const ready = booking.state === "READY_FOR_SUBMISSION" && user?.scopeId === booking.clubId;
    return (
      <div className="rounded-2xl border border-line bg-paper p-3">
        <RequestSummary booking={booking} />
        {ready ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                const result = await api.submitBooking(booking.id);
                if (!result.ok) toast(result.error.message, "bad");
              }}
            >
              Send to venue team
            </Button>
            <p className="text-sm text-gray-70">Or type a correction below.</p>
          </div>
        ) : (
          <p className="mt-2 px-1 text-sm text-gray-70">
            {["DRAFT", "NEEDS_INFORMATION"].includes(booking.state) ? "Still missing details." : "Sent to the venue team."}
          </p>
        )}
      </div>
    );
  }

  if (card.type === "clubs") {
    return (
      <ul className="space-y-1 rounded-2xl border border-line bg-paper p-2">
        {card.clubIds.map((id) => {
          const name = card.names?.[id] ?? db.clubs.find((c) => c.id === id)?.name;
          if (!name) return null;
          return (
            <li key={id}>
              <Link href={`/clubs/${id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-wash">
                <Poster seed={id} name={name} className="size-12" />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{name}</span>
                  <span className="block truncate text-sm text-gray-70">
                    Matched on {card.reasons[id]?.join(", ").toLowerCase()}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  if (card.type === "feedback_offer") return <FeedbackOffer card={card} />;
  if (card.type === "confirm") return <ConfirmCard card={card} />;

  return (
    <div className="rounded-2xl border border-line bg-paper p-4 text-[15px]">
      <p className="font-semibold">
        Feedback received. Reference <span className="tabular">{card.feedbackId}</span>
      </p>
      <p className="mt-1 text-gray-70">
        This confirms it was logged and routed to a representative. It is not a promise of a reply
        or a resolution.
      </p>
    </div>
  );
}

/** The agent wants to write something (e.g. send interest to a club). Nothing happens until the user says yes (PRD 8.1). */
function ConfirmCard({ card }: { card: Extract<MessageCard, { type: "confirm" }> }) {
  const db = useDb();
  const toast = useToast();
  const conversation = db.conversations.find((c) => c.messages.some((m) => m.card?.type === "confirm" && m.card.summary === card.summary));
  const [busy, setBusy] = useState(false);
  const answer = async (confirmed: boolean) => {
    if (!conversation) return;
    setBusy(true);
    const result = await api.confirmAgentAction(conversation.id, confirmed);
    setBusy(false);
    if (!result.ok) toast(result.error.message, "bad");
    else sound.play(confirmed ? "send" : "tick");
  };
  return (
    <div className="rounded-2xl border border-line bg-paper p-4 text-[15px]">
      <p className="text-sm text-gray-70">Needs your confirmation</p>
      <p className="mt-1">{card.summary}</p>
      {card.done ? (
        <p className="mt-2 text-sm text-gray-70">Answered.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => answer(true)}>Yes, send it</Button>
          <Button disabled={busy} onClick={() => answer(false)}>No, cancel</Button>
        </div>
      )}
    </div>
  );
}

function FeedbackOffer({ card }: { card: Extract<MessageCard, { type: "feedback_offer" }> }) {
  const db = useDb();
  const toast = useToast();
  const [share, setShare] = useState(false);
  const [sending, setSending] = useState(false);
  const conversation = db.conversations.find((c) =>
    c.messages.some((m) => m.card === card || (m.card?.type === "feedback_offer" && m.card.message === card.message)),
  );
  const sent = conversation?.messages.some((m) => m.card?.type === "feedback_sent");
  if (sent) return null;
  return (
    <div className="rounded-2xl border border-line bg-paper p-4 text-[15px]">
      <p className="text-sm text-gray-70">Send to {card.scope} as feedback · {card.category}</p>
      <p className="mt-1 font-serif text-[17px] italic leading-snug">“{card.message}”</p>
      <label className="mt-3 flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={share}
          onChange={(e) => setShare(e.target.checked)}
          className="mt-1 size-4 accent-cardinal"
        />
        <span>
          Include my name so a representative can follow up
          <span className="block text-sm text-gray-70">Left unticked, it is sent without your identity.</span>
        </span>
      </label>
      <Button
        variant="primary"
        className="mt-3"
        disabled={sending}
        onClick={async () => {
          setSending(true);
          const result = await api.submitFeedback(conversation?.id ?? null, {
            scope: card.scope,
            category: card.category,
            message: card.message,
            shareIdentity: share,
          });
          setSending(false);
          if (!result.ok) return toast(result.error.message, "bad");
          sound.play("send");
        }}
      >
        Send as feedback
      </Button>
    </div>
  );
}

export function eventLine(start: string) {
  return `${fmtDay(start)}, ${fmtTime(start)}`;
}
