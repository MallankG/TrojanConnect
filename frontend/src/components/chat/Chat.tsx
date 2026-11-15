"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  ChevronDown,
  ExternalLink,
  Flag,
  RotateCw,
  ShieldQuestion,
  UserRoundCheck,
} from "lucide-react";
import { api, useDb, useUser } from "@/lib/api/client";
import type { ChatMessage, Conversation, MessageCard, Result } from "@/lib/api/types";
import { dateKey, fmtDay, fmtDayHeading, fmtTime, minutesBetween } from "@/lib/time";
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

// ---- Grouping --------------------------------------------------------------

/** Consecutive messages from one sender inside this many minutes read as one turn. */
const GROUP_WINDOW_MINUTES = 6;

/** A pause at least this long is worth putting a clock on. */
const STAMP_GAP_MINUTES = 20;

type Turn = {
  kind: "turn";
  key: string;
  sender: ChatMessage["sender"];
  name?: string;
  messages: ChatMessage[];
  /** Set on the turns that close a stretch of talking; only those show a time. */
  stamped?: boolean;
};
type Note = { kind: "note"; key: string; message: ChatMessage };
type DayRule = { kind: "day"; key: string; label: string };
type Row = Turn | Note | DayRule;

/**
 * Lay the transcript out the way a messaging app reads it: a rule whenever the
 * day changes, system lines on their own, and runs from one sender collapsed
 * into a single turn that shows its name and avatar once.
 */
function toRows(messages: ChatMessage[]): Row[] {
  const rows: Row[] = [];
  let day = "";

  for (const message of messages) {
    const key = dateKey(message.at);
    if (key !== day) {
      day = key;
      const { primary } = fmtDayHeading(message.at);
      rows.push({ kind: "day", key: `day-${key}`, label: primary });
    }

    // System lines and anything carrying a card stand alone: cards are wide, and
    // stacking them inside a run makes the sender's turn hard to follow.
    if (message.sender === "system") {
      rows.push({ kind: "note", key: message.id, message });
      continue;
    }

    const last = rows[rows.length - 1];
    const joins =
      last?.kind === "turn" &&
      last.sender === message.sender &&
      last.name === message.name &&
      !last.messages[last.messages.length - 1].card &&
      minutesBetween(last.messages[last.messages.length - 1].at, message.at) <= GROUP_WINDOW_MINUTES;

    if (joins) (last as Turn).messages.push(message);
    else rows.push({ kind: "turn", key: message.id, sender: message.sender, name: message.name, messages: [message] });
  }

  // A time under every turn is noise. Keep it where it earns its place: the end
  // of the transcript, and either side of a real pause in the conversation.
  const turns = rows.filter((r): r is Turn => r.kind === "turn");
  turns.forEach((turn, i) => {
    const next = turns[i + 1];
    const ended = turn.messages[turn.messages.length - 1].at;
    turn.stamped = !next || minutesBetween(ended, next.messages[0].at) > STAMP_GAP_MINUTES;
  });

  return rows;
}

/** Bubble corners: square off the edge a bubble shares with the one above it. */
function corners(side: "left" | "right", first: boolean, last: boolean) {
  const base = "rounded-3xl";
  if (side === "right") {
    return `${base} ${first ? "" : "rounded-tr-lg"} ${last ? "rounded-br-md" : "rounded-br-lg"}`;
  }
  return `${base} ${first ? "" : "rounded-tl-lg"} ${last ? "rounded-bl-md" : "rounded-bl-lg"}`;
}

// ---- Chat ------------------------------------------------------------------

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
  const [pinned, setPinned] = useState(true);
  const [missed, setMissed] = useState(0);

  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const count = conversation?.messages.length ?? 0;
  const seen = useRef(count);
  const pinnedRef = useRef(true);

  const toBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
    setMissed(0);
  }, []);

  // "Pinned" means the reader is at the live end of the transcript. Scrolling up
  // to re-read something should not be yanked back by an arriving message.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    pinnedRef.current = atEnd;
    setPinned(atEnd);
    if (atEnd) setMissed(0);
  }, []);

  // Follow new messages, and sound the cue for whoever sent one.
  useEffect(() => {
    const first = seen.current === 0;
    if (pinnedRef.current || first) {
      const el = scroller.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: first ? "auto" : "smooth" });
    } else if (count > seen.current) {
      setMissed((n) => n + (count - seen.current));
    }

    if (count > seen.current && conversation) {
      const last = conversation.messages[count - 1];
      if (last.sender === "reviewer") sound.play("stamp");
      else if (last.sender === "agent") sound.play("receive");
      else if (last.sender === "system") sound.play("tick", { volume: 0.5 });
    }
    seen.current = count;
  }, [count, conversation, conversation?.activity]);

  // Grow the composer with its content, up to the cap the stylesheet sets.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const rows = useMemo(() => toRows(conversation?.messages ?? []), [conversation?.messages]);

  if (!conversation) {
    return (
      <EmptyState
        title="Conversation not found"
        body="It may belong to another demo role, or the demo data was reset."
      />
    );
  }
  const mine = conversation.ownerId === user?.id;
  const working = Boolean(conversation.activity);

  const submit = async (value: string) => {
    const message = value.trim();
    if (!message || sending) return;
    setText("");
    setFailed(null);
    setSending(true);
    pinnedRef.current = true;
    setPinned(true);
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
      className={`flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-line bg-paper ${className}`}
    >
      <header className="z-10 flex items-center gap-3 border-b border-line bg-paper/85 px-4 py-3 backdrop-blur-xl">
        <span
          aria-hidden
          className={`grid size-10 shrink-0 place-items-center rounded-full bg-cardinal text-sm font-bold text-gold ${
            working ? "thinking-halo" : ""
          }`}
        >
          {conversation.agentName[0]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">{conversation.agentName}</p>
          <p className="truncate text-xs leading-snug text-gray-70">{ROLE_LINE[conversation.kind]}</p>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 py-4"
        >
          {/*
            Rows are keyed by position, not by message id. A streamed reply is shown as a
            temporary message that the finished turn then replaces under a new id; keyed by
            id, the finished bubble would mount afresh and play its entrance a second time.
            The transcript only ever grows at the end, so a position is a stable identity.
          */}
          {rows.map((row, i) => {
            const key = `${row.kind}-${i}`;
            if (row.kind === "day") return <DayRule key={key} label={row.label} />;
            if (row.kind === "note") return <Note key={key} message={row.message} />;
            return <Turn key={key} turn={row} />;
          })}

          {conversation.activity && (
            <div role="status" className="rise-in flex items-center gap-2.5 pt-1">
              <span aria-hidden className="size-7 shrink-0" />
              <span className="inline-flex items-center gap-2 rounded-3xl rounded-bl-md bg-wash px-3.5 py-2.5">
                <span className="flex gap-1" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="size-1.5 rounded-full bg-gray-70"
                      style={{ animation: `dot-pulse 1.2s ${i * 0.18}s infinite` }}
                    />
                  ))}
                </span>
                <span className="text-[13px] text-gray-70">{conversation.activity}</span>
              </span>
            </div>
          )}

          {failed && (
            <div className="rise-in space-y-2 pt-2">
              <ErrorNote>{failed.message}</ErrorNote>
              <Button onClick={() => submit(failed.text)}>
                <RotateCw aria-hidden className="size-4" />
                Send again
              </Button>
            </div>
          )}
        </div>

        {!pinned && (
          <button
            type="button"
            onClick={() => toBottom()}
            className="pop-in absolute inset-x-0 bottom-3 z-10 mx-auto flex h-9 w-fit items-center gap-1.5 rounded-full bg-ink pl-3 pr-3.5 text-[13px] font-medium text-paper shadow-lg"
          >
            <ChevronDown aria-hidden className="size-4" />
            {missed > 0 ? `${missed} new message${missed === 1 ? "" : "s"}` : "Latest"}
          </button>
        )}
      </div>

      {mine ? (
        <div className="border-t border-line p-3">
          {suggestions.length > 0 && conversation.messages.length <= 1 && (
            <div className="-mx-3 mb-2.5 flex snap-x gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className="chip-in shrink-0 snap-start rounded-full border border-line bg-paper px-3.5 py-2 text-left text-sm transition-[border-color,transform] hover:-translate-y-px hover:border-ink active:translate-y-0"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="composer flex items-end gap-2 rounded-[26px] bg-wash p-1.5 pl-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(text);
            }}
          >
            <label className="sr-only" htmlFor={`msg-${conversation.id}`}>Message</label>
            <textarea
              ref={box}
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
              className="max-h-32 min-h-10 flex-1 resize-none self-center bg-transparent py-2 text-[15px] leading-snug placeholder:text-gray-70 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              aria-label="Send message"
              className="send-key grid size-10 shrink-0 place-items-center rounded-full bg-cardinal text-paper hover:bg-cardinal-20 disabled:bg-gray-30 disabled:text-paper"
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
      className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-gray-70 transition-colors hover:text-ink"
    >
      <Flag aria-hidden className="size-3.5" />
      Report a problem with {conversation.agentName}
    </button>
  );
}

// ---- Rows ------------------------------------------------------------------

function DayRule({ label }: { label: string }) {
  return (
    <div className="rise-in flex items-center gap-3 py-3 first:pt-1">
      <span aria-hidden className="h-px flex-1 bg-line" />
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-70">{label}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

/** A system line: a short centred note, or a card on its own. */
function Note({ message }: { message: ChatMessage }) {
  if (message.card) {
    return (
      <div className="bubble-in max-w-[92%] py-1" style={{ "--bubble-origin": "bottom left" } as React.CSSProperties}>
        <Card card={message.card} />
      </div>
    );
  }
  return (
    <p className="rise-in py-1.5 text-center text-[13px] text-gray-70">{message.text}</p>
  );
}

/** One run of messages from a single sender. */
function Turn({ turn }: { turn: Turn }) {
  const own = turn.sender === "user";
  const side = own ? "right" : "left";
  const last = turn.messages[turn.messages.length - 1];

  if (turn.sender === "reviewer") {
    return (
      <div className="bubble-in max-w-[92%] py-1.5" style={{ "--bubble-origin": "bottom left" } as React.CSSProperties}>
        <p className="mb-1.5 flex items-center gap-1.5 pl-1 text-xs text-gray-70">
          <UserRoundCheck aria-hidden className="size-3.5" />
          {turn.name}, venue reviewer · a person
        </p>
        <div className="space-y-1">
          {turn.messages.map((m, i) => (
            <p key={i} className="rounded-2xl border border-ink px-4 py-3 font-serif text-[17px] italic leading-snug">
              {m.text}
            </p>
          ))}
        </div>
        {turn.stamped && <Stamp at={last.at} align="left" />}
      </div>
    );
  }

  if (own) {
    return (
      <div className="flex flex-col items-end gap-1 py-1.5">
        {turn.messages.map((m, i) => (
          <p
            key={i}
            style={{ "--bubble-origin": "bottom right" } as React.CSSProperties}
            className={`bubble-in w-fit max-w-[85%] whitespace-pre-wrap bg-cardinal px-4 py-2.5 text-[15px] leading-snug text-paper ${corners(
              side,
              i === 0,
              i === turn.messages.length - 1,
            )}`}
          >
            {m.text}
          </p>
        ))}
        {turn.stamped && <Stamp at={last.at} align="right" />}
      </div>
    );
  }

  // The agent. One avatar for the whole run, sitting on the baseline of its last
  // bubble — so the name and the time live outside the row that holds it.
  return (
    <div className="py-1.5">
      {turn.name && <p className="mb-1 pl-[2.625rem] text-xs text-gray-70">{turn.name}</p>}
      <div className="flex items-end gap-2.5">
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-bold text-gold"
        >
          {(turn.name ?? "A")[0]}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          {turn.messages.map((m, i) => (
            <AgentMessage
              key={i}
              message={m}
              shape={corners(side, i === 0, i === turn.messages.length - 1)}
            />
          ))}
        </div>
      </div>
      {turn.stamped && (
        <p className="tabular mt-1 pl-[2.625rem] text-[11px] text-gray-70">{fmtTime(last.at)}</p>
      )}
    </div>
  );
}

function AgentMessage({ message, shape }: { message: ChatMessage; shape: string }) {
  return (
    <div className="max-w-[92%]" style={{ "--bubble-origin": "bottom left" } as React.CSSProperties}>
      <p className={`bubble-in w-fit whitespace-pre-wrap bg-wash px-4 py-2.5 text-[15px] leading-snug ${shape}`}>
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

/** The time a turn ended, under its last bubble. */
function Stamp({ at, align }: { at: string; align: "left" | "right" }) {
  return (
    <p className={`tabular mt-1 text-[11px] text-gray-70 ${align === "right" ? "pr-1 text-right" : "pl-1"}`}>
      {fmtTime(at)}
    </p>
  );
}

// ---- Cards -----------------------------------------------------------------

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
              <Link
                href={`/clubs/${id}`}
                className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-wash"
              >
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
    <div className="rounded-2xl border border-gold bg-gold-25/40 p-4 text-[15px]">
      <p className="text-sm font-medium text-gray-70">Needs your confirmation</p>
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
