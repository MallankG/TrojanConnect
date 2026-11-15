"use client";

import { useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { api, useDb, useUser } from "@/lib/api/client";
import type { GovScope, KnowledgeDoc } from "@/lib/api/types";
import { fmtDay, fmtRelative } from "@/lib/time";
import { sound } from "@/lib/sound/engine";
import { Page } from "@/components/layout/AppShell";
import { Chat } from "@/components/chat/Chat";
import { useOpenChat } from "@/components/chat/useOpenChat";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  ListSkeleton,
  PageHeader,
  Sheet,
  StatusPill,
  Tabs,
  inputClass,
  useToast,
} from "@/components/ui/kit";
import { Section } from "./club";

const SAMPLE_NOTE =
  "Sample knowledge base written for this demo. It is not official USG or GSG content and must be replaced with approved sources.";

// ---- Assistant -------------------------------------------------------------

export function GovernmentHome() {
  const db = useDb();
  const user = useUser();
  const isRep = user?.role === "gov_rep";
  const [picked, setPicked] = useState<GovScope>("USG");
  const scope: GovScope = isRep ? (user.scopeId as GovScope) : picked;
  const chatId = useOpenChat(() => api.openGovernmentChat(scope), [scope, user?.id]);
  const announcements = db.announcements.filter((a) => a.scope === scope);

  return (
    <Page>
      <PageHeader
        title={isRep ? `${scope} assistant` : "Student government"}
        lead={
          isRep
            ? "What students see. Answers come only from your approved sources."
            : "Ask what student government does, who to contact, or raise a concern. Every answer links its source."
        }
      />
      {!isRep && (
        <div className="mt-6">
          <Tabs
            label="Government body"
            value={picked}
            onChange={setPicked}
            tabs={[
              { id: "USG", label: "Undergraduate (USG)" },
              { id: "GSG", label: "Graduate (GSG)" },
            ]}
          />
        </div>
      )}
      <p className="mt-4 rounded-xl bg-gold-25 px-3.5 py-2.5 text-sm">{SAMPLE_NOTE}</p>

      <div className="mt-4">
        {chatId ? (
          <Chat
            key={chatId}
            conversationId={chatId}
            className="h-[30rem]"
            placeholder={`Ask the ${scope} assistant`}
            suggestions={
              scope === "USG"
                ? ["How do we get funding for an event?", "Who approves room bookings?", "Room booking rules are too hard to find"]
                : ["How do travel grants work?"]
            }
          />
        ) : (
          <div className="skeleton h-[30rem]" />
        )}
      </div>

      <Section title="Announcements" count={announcements.length}>
        {announcements.length ? (
          <ul className="divide-y divide-line">
            {announcements.map((a) => (
              <li key={a.id} className="py-3.5">
                <p className="text-[17px] font-semibold leading-tight">{a.title}</p>
                <p className="mt-1 text-[15px]">{a.body}</p>
                <p className="mt-1 text-sm text-gray-70">{a.author} · {fmtRelative(a.at)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-gray-70">No announcements from {scope} yet.</p>
        )}
      </Section>

      {isRep && <Composer />}
      {isRep && <Analytics scope={scope} />}
    </Page>
  );
}

function Composer() {
  const user = useUser();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Section title="New announcement">
      <div className="grid gap-5 md:grid-cols-2">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const result = api.publishAnnouncement(title, body);
            if (!result.ok) return setError(result.error.message);
            sound.play("send");
            toast("Announcement published");
            setTitle("");
            setBody("");
            setError(null);
          }}
        >
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className={inputClass} />
          </Field>
          <Field label="Message">
            <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={400} className={inputClass} />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button variant="primary" type="submit">Publish to students</Button>
        </form>
        <div>
          <p className="text-sm font-medium">Preview</p>
          <div className="mt-1.5 rounded-2xl border border-line p-4">
            <p className="text-[17px] font-semibold leading-tight">{title || "Your title"}</p>
            <p className="mt-1 whitespace-pre-wrap text-[15px]">{body || "Your message appears here as students will see it."}</p>
            <p className="mt-1 text-sm text-gray-70">{user?.name} · Just now</p>
          </div>
        </div>
      </div>
    </Section>
  );
}

function Analytics({ scope }: { scope: GovScope }) {
  const db = useDb();
  const questions = db.govQuestions.filter((q) => q.scope === scope);
  const byDoc = new Map<string, number>();
  for (const q of questions) byDoc.set(q.docId ?? "none", (byDoc.get(q.docId ?? "none") ?? 0) + 1);
  const rows = [...byDoc.entries()]
    .map(([id, count]) => ({
      id,
      count,
      label: id === "none" ? "No approved source matched" : db.knowledge.find((k) => k.id === id)?.title ?? "Removed source",
    }))
    .sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <Section title="What students ask about" count={questions.length}>
      {rows.length === 0 ? (
        <p className="text-[15px] text-gray-70">Questions are counted here once students start asking.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="flex items-baseline justify-between gap-3 text-[15px]">
                <span className={r.id === "none" ? "font-medium" : ""}>{r.label}</span>
                <span className="tabular text-gray-70">{r.count}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-wash">
                <div
                  className={`h-2 rounded-full ${r.id === "none" ? "bg-mark-orange" : "bg-cardinal"}`}
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-gray-70">
        Questions with no matching source are where a new approved page would help most.
      </p>
    </Section>
  );
}

// ---- Sources ---------------------------------------------------------------

type Draft = { id?: string; title: string; excerpt: string; url: string; owner: string };
const BLANK: Draft = { title: "", excerpt: "", url: "", owner: "" };

export function Knowledge() {
  const db = useDb();
  const user = useUser();
  const toast = useToast();
  const scope = user?.scopeId as GovScope;
  const docs = db.knowledge.filter((k) => k.scope === scope);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const edit = (doc: KnowledgeDoc) =>
    setDraft({ id: doc.id, title: doc.title, excerpt: doc.excerpt, url: doc.url, owner: doc.owner });

  return (
    <Page>
      <PageHeader
        title="Approved sources"
        lead={`The ${scope} assistant can only answer from these. Each answer links the source it used.`}
        action={
          <Button variant="primary" onClick={() => setDraft(BLANK)}>
            <Plus aria-hidden className="size-4" />
            Add a source
          </Button>
        }
      />
      <p className="mt-4 rounded-xl bg-gold-25 px-3.5 py-2.5 text-sm">{SAMPLE_NOTE}</p>

      <div className="mt-6">
        {db.seededAt === "" ? (
          <ListSkeleton />
        ) : docs.length === 0 ? (
          <EmptyState
            title="No sources yet"
            body="Until you add one, the assistant tells students it cannot verify an answer."
            action={<Button variant="primary" onClick={() => setDraft(BLANK)}>Add a source</Button>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {docs.map((doc) => (
              <li key={doc.id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-[17px] font-semibold leading-tight">{doc.title}</p>
                  <Button onClick={() => edit(doc)}>Edit</Button>
                </div>
                <p className="mt-1 max-w-[65ch] text-[15px] text-gray-70">{doc.excerpt}</p>
                <p className="tabular mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-70">
                  <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink underline decoration-gray-30 underline-offset-2">
                    <ExternalLink aria-hidden className="size-3.5" />
                    Source page
                  </a>
                  <span>{doc.owner}</span>
                  <span>{doc.version}</span>
                  <span>Verified {fmtDay(doc.verifiedAt)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Sheet
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title={draft?.id ? "Edit source" : "Add a source"}
        description="Saving marks it verified today and raises its version."
      >
        {draft && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.title.trim() || !draft.excerpt.trim() || !draft.url.trim())
                return setError("A source needs a title, the approved text and a link.");
              const result = api.saveKnowledge({ ...draft, scope });
              if (!result.ok) return setError(result.error.message);
              toast("Source saved");
              setError(null);
              setDraft(null);
            }}
          >
            <Field label="Title"><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputClass} /></Field>
            <Field label="Approved text" hint="What the assistant may say">
              <textarea rows={5} value={draft.excerpt} onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Link to the source page"><input type="url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://" className={inputClass} /></Field>
            <Field label="Owner"><input value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} placeholder="Committee or office" className={inputClass} /></Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button variant="primary" type="submit" size="lg" className="w-full">Save source</Button>
          </form>
        )}
      </Sheet>
    </Page>
  );
}

// ---- Feedback inbox --------------------------------------------------------

export function FeedbackInbox() {
  const db = useDb();
  const user = useUser();
  const toast = useToast();
  const [tab, setTab] = useState<"new" | "acknowledged">("new");
  const all = db.feedback.filter((f) => f.scope === user?.scopeId);
  const shown = all.filter((f) => f.status === tab);

  return (
    <Page>
      <PageHeader
        title="Feedback"
        lead="Concerns students chose to route to you. Identity is shown only when they agreed to share it."
      />
      <div className="mt-6">
        <Tabs
          label="Feedback status"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "new", label: "New", count: all.filter((f) => f.status === "new").length },
            { id: "acknowledged", label: "Acknowledged", count: all.filter((f) => f.status === "acknowledged").length },
          ]}
        />
      </div>
      <div className="mt-2">
        {db.seededAt === "" ? (
          <div className="mt-4"><ListSkeleton /></div>
        ) : shown.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title={tab === "new" ? "Inbox is clear" : "Nothing acknowledged yet"}
              body={tab === "new" ? "New feedback arrives when a student agrees to send it." : "Acknowledged items are kept here."}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((f) => (
              <li key={f.id} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-gray-70">
                    <span className="tabular">{f.id}</span> · {f.category} · {fmtRelative(f.at)}
                  </p>
                  <StatusPill
                    label={f.sharedIdentity ? `From ${f.fromName}` : "Identity not shared"}
                    tone={f.sharedIdentity ? "good" : "neutral"}
                  />
                </div>
                <p className="mt-1.5 max-w-[65ch] font-serif text-[19px] italic leading-snug">“{f.message}”</p>
                {f.status === "new" && (
                  <Button
                    className="mt-3"
                    onClick={() => {
                      api.acknowledgeFeedback(f.id);
                      toast("Marked acknowledged");
                    }}
                  >
                    Mark acknowledged
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}
