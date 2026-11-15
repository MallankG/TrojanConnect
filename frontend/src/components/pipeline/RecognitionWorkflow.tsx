"use client";

// RSO recognition tab. Mirrors USC's "RSO Recognition Process" page section by section; content and
// rules live in lib/pipeline/recognition.ts. TrojanConnect tracks progress and hands off to EngageSC;
// it never signs in to, reads from, or submits to the USC portal.
import { useState, type ReactNode } from "react";
import type {
  CleryStatus,
  RecognitionApplicationStatus,
  RecognitionCategory,
  RecognitionOfficer,
  RecognitionPathway,
  RecognitionProgress,
  RecognitionRequirement,
} from "@/lib/pipeline/plan";
import type { RecognitionSetup } from "@/lib/api-client";
import {
  ADVISOR_DEADLINE,
  ADVISOR_DEADLINE_LABEL,
  ADVISOR_TASKS,
  APPLICATION_DEADLINE,
  APPLICATION_DEADLINE_LABEL,
  APPLICATION_OPENS,
  APPLICATION_TASKS,
  CATEGORIES,
  CATEGORY_TASKS,
  CLERY_OPTIONS,
  CONTACT,
  DOCUMENT_TASKS,
  ELIGIBLE_PATHWAYS,
  FAQ,
  LINKS,
  LOSS_REASONS,
  NOT_RECOGNIZED_REASONS,
  OFFICE_HOURS,
  OFFICER_GUIDE_TASK,
  OFFICERS,
  PATHWAYS,
  RECOGNITION_ENDS_LABEL,
  REQUIREMENTS,
  ROSTER_TASKS,
  SESSIONS,
  STATUS_LABEL,
  STATUS_MEANING,
  SUBMIT_TASKS,
  TRAINING_WINDOW_LABEL,
  advisorPacket,
  advisorProgress,
  appealDeadline,
  countdownLabel,
  daysUntil,
  missingOfficerItems,
  nextAction,
  officerReminder,
  readiness,
  registerButtonLabel,
  startTasks,
  type RecognitionTask,
} from "@/lib/pipeline/recognition";

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as RecognitionApplicationStatus[])
  .map(id => ({ id, label: STATUS_LABEL[id] }));
const input = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-ink";
const linkStyle = "font-semibold text-cardinal underline";
const card = "mb-4 rounded-xl bg-surface p-5 shadow-sm";
const fmtPT = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", ...opts }).format(new Date(iso));

export function RecognitionWorkflow({
  recognition,
  today,
  orgName,
  onCheck,
  onSetup,
  onOfficerRequirement,
  onStatus,
}: {
  recognition: RecognitionProgress | undefined;
  today: Date;
  orgName: string;
  onCheck: (check: string, value: boolean) => Promise<void>;
  onSetup: (patch: RecognitionSetup) => Promise<void>;
  onOfficerRequirement: (role: RecognitionOfficer, requirement: RecognitionRequirement, value: boolean) => Promise<void>;
  onStatus: (status: RecognitionApplicationStatus) => Promise<void>;
}) {
  if (!recognition) return <p className="text-muted">Loading recognition progress…</p>;
  const r = recognition;
  const checks = r.checks;
  const pathway = r.pathway;
  const eligible = ELIGIBLE_PATHWAYS.includes(pathway);
  const status = r.applicationStatus;
  const ready = readiness(r);
  const next = nextAction(r, today);
  const advisor = advisorProgress(r);
  const applicationClosed = daysUntil(APPLICATION_DEADLINE, today) < 0;
  const notYetSubmitted = status === "not_started" || status === "draft";
  const officersWithGaps = OFFICERS.filter(officer => missingOfficerItems(r, officer.id).length);
  const groupUrl = r.engageGroupUrl;
  const portal = pathway === "fraternity_sorority"
    ? { href: LINKS.process, label: "View USC recognition guidance" }
    : groupUrl
      ? { href: groupUrl, label: "Open your EngageSC group page" }
      : pathway === "reestablishing"
        ? { href: LINKS.engageDirectory, label: "Find your RSO's EngageSC page" }
        : pathway === "new"
          ? { href: LINKS.engageDirectory, label: "Open the EngageSC Directory" }
          : { href: LINKS.engageHome, label: "Open EngageSC" };
  const task = (t: RecognitionTask) => (
    <TaskRow key={`${t.id}-${t.title}`} task={t} checked={!!checks[t.id]} onChange={value => onCheck(t.id, value)} />
  );
  const appeal = appealDeadline(r.decisionDate);

  return (
    <div className="mx-auto max-w-5xl">
      {/* ------------------------------------------------ header */}
      <header className="mb-4 rounded-xl border-l-4 border-cardinal bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Annual recognition · {r.cycle} cycle · via EngageSC</p>
            <h2 className="mt-1 text-2xl font-bold">RSO recognition</h2>
          </div>
          {eligible && (
            <p className="text-sm font-semibold text-cardinal" data-testid="readiness-summary">
              {ready.ready ? "Ready to submit in EngageSC" : `${ready.missingTasks.length + (ready.membersNeeded ? 1 : 0) + (ready.missingOfficerDocs ? 1 : 0)} areas left before submitting`}
            </p>
          )}
        </div>
        <p className="mt-2 text-sm text-muted">
          Every RSO must complete recognition in EngageSC each year. Recognition for {r.cycle} runs through {RECOGNITION_ENDS_LABEL}; RSOs that miss the deadline lose recognition and all benefits for the year.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="rounded-lg bg-paper px-3 py-2">
            <strong>Opened:</strong> {fmtPT(APPLICATION_OPENS.toISOString(), { month: "short", day: "numeric" })}
          </span>
          <span className="rounded-lg bg-paper px-3 py-2" data-testid="application-deadline">
            <strong>Application closes:</strong> {APPLICATION_DEADLINE_LABEL} · <span className={daysUntil(APPLICATION_DEADLINE, today) <= 3 ? "font-semibold text-late" : ""}>{countdownLabel(APPLICATION_DEADLINE, today)}</span>
          </span>
          <span className="rounded-lg bg-paper px-3 py-2" data-testid="advisor-deadline">
            <strong>Advisor requirements due:</strong> {ADVISOR_DEADLINE_LABEL} · <span className={daysUntil(ADVISOR_DEADLINE, today) <= 3 ? "font-semibold text-late" : ""}>{countdownLabel(ADVISOR_DEADLINE, today)}</span>
          </span>
        </div>
        <p className="mt-3 text-xs text-muted">
          Late applications are not accepted. Dates and links reflect USC&apos;s page as of Nov 12, 2026:{" "}
          <ExternalLink href={LINKS.process}>verify current requirements</ExternalLink>.
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ready/30 bg-ready-bg p-4" aria-label="Next recognition step" data-testid="next-action">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ready">Next up</p>
          <p className="mt-0.5 font-semibold">{next.title}</p>
          <p className="text-sm text-muted">{next.detail}</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-ready px-3 py-1.5 text-sm font-semibold text-ready"
          onClick={() => {
            const el = document.getElementById(next.target);
            el?.scrollIntoView({ block: "center", behavior: "smooth" });
            if (el instanceof HTMLInputElement) el.focus();
          }}
        >
          Go to step
        </button>
      </section>

      {/* ------------------------------------------------ important dates & help */}
      <details className={card} data-testid="key-dates">
        <summary className="cursor-pointer text-lg font-bold">Important dates, info sessions, workshops, and office hours</summary>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {SESSIONS.map(session => {
            const past = new Date(session.end).getTime() < today.getTime();
            return (
              <li key={`${session.kind}-${session.start}`} className={`rounded-lg bg-paper p-3 ${past ? "opacity-60" : ""}`}>
                <strong>{session.kind}</strong>{past ? " · past" : ""}
                <br />
                {fmtPT(session.start, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}–{fmtPT(session.end, { hour: "numeric", minute: "2-digit" })} PT
                {!past && <> · <ExternalLink href={session.zoom}>Zoom</ExternalLink></>}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm text-muted">
          Info sessions cover requirements and deadlines with Q&amp;A. New RSO workshops help you organize the e-board, mission, and Constitution. Constitution &amp; Accountability workshops include breakout rooms with staff.
        </p>
        <h4 className="mt-4 font-semibold">Office hours (drop-in, includes the Application Breakout Room)</h4>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {OFFICE_HOURS.map(hours => (
            <li key={hours.day}>{hours.day}, {hours.time}: <ExternalLink href={hours.zoom}>Zoom</ExternalLink> or in person at SKS 410 (check in at the front desk)</li>
          ))}
        </ul>
        <p className="mt-3 text-sm">
          <ExternalLink href={LINKS.rsoToolkit}>RSO Toolkit (USC login)</ExternalLink> · <ExternalLink href={LINKS.faq}>Recognition FAQ</ExternalLink> · <ExternalLink href={LINKS.engageHowTo}>How to navigate EngageSC</ExternalLink>
        </p>
      </details>

      {/* ------------------------------------------------ 1. before you begin */}
      <section className={card} aria-labelledby="pathway-heading">
        <h3 id="pathway-heading" className="text-lg font-bold">1. Before you begin: which applies to your RSO?</h3>
        <p className="mt-1 text-sm text-muted">This cycle is for new RSOs and RSOs re-establishing after a lapse. Not sure whether your RSO has an EngageSC page? Search the <ExternalLink href={LINKS.engageDirectory}>EngageSC Directory</ExternalLink> or the “Groups” search bar with several keywords, or ask through <ExternalLink href={LINKS.existingPageForm}>USC&apos;s form</ExternalLink>.</p>
        <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Organization pathway</legend>
          {PATHWAYS.map(option => (
            <label key={option.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${pathway === option.id ? "border-cardinal bg-paper" : "border-line"}`}>
              <input
                type="radio"
                name="recognition-pathway"
                className="mt-1 accent-cardinal"
                checked={pathway === option.id}
                onChange={() => void onSetup({ pathway: option.id as RecognitionPathway })}
              />
              <span>
                <span className="block font-semibold">{option.label}</span>
                <span className="block text-sm text-muted">{option.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {pathway === "fall_application" && (
          <Notice tone="wait">
            USC says RSOs that applied in fall should <strong>not submit another application</strong>; an approved fall application grants recognition through {RECOGNITION_ENDS_LABEL}. Track your existing application below. If your advisor hasn&apos;t finished their requirements, they should submit them as soon as possible.
          </Notice>
        )}
        {pathway === "fraternity_sorority" && (
          <Notice tone="wait">
            Social fraternities and sororities (as defined by the Department of Education) are recognized through the Office of Fraternity &amp; Sorority Life, under the Trojan Greek Community Standards and Accreditation, their governing councils, and inter/national policies. This RSO application doesn&apos;t apply.
          </Notice>
        )}

        {eligible && (
          <>
            <label className="mt-4 flex items-start gap-3 rounded-lg bg-paper p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-[18px] w-[18px] accent-ok"
                checked={r.religiousSpiritual}
                onChange={event => void onSetup({ religiousSpiritual: event.target.checked })}
              />
              <span>
                <strong>Our RSO engages in religious or spiritual activities</strong>
                <span className="block text-muted">
                  {pathway === "new"
                    ? `New religious/spiritual RSOs register with “${registerButtonLabel({ ...r, religiousSpiritual: true })}” and must comply with Office of Religious & Spiritual Life expectations.`
                    : "Religious organizations must comply with Office of Religious & Spiritual Life expectations."}
                </span>
              </span>
            </label>

            <h4 className="mt-5 font-semibold" data-testid="start-path-heading">
              {pathway === "reestablishing" ? "Re-establishing RSO: your RSO already has an EngageSC page" : "New RSO: your RSO does not have an EngageSC page"}
            </h4>
            <ul className="mt-2 list-none p-0">{startTasks(r).map(task)}</ul>

            <div className="mt-4 rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-wait">EngageSC handoff · not live synced</p>
                  <p className="mt-1 text-sm text-muted">
                    The application happens in EngageSC on a laptop or desktop. TrojanConnect doesn&apos;t collect USC passwords or read/submit anything in the portal.
                  </p>
                </div>
                <ExternalLink href={portal.href} button>{portal.label}</ExternalLink>
              </div>
              <label className="mt-3 grid max-w-2xl gap-1 text-sm font-semibold">
                {pathway === "reestablishing" ? "Your RSO's EngageSC group page URL" : "Your new EngageSC group page URL (after registering, optional)"}
                <input
                  key={groupUrl}
                  className={input}
                  type="url"
                  defaultValue={groupUrl}
                  placeholder="https://engage.usc.edu/your-group/"
                  onBlur={event => {
                    const value = event.currentTarget.value.trim();
                    if (value !== groupUrl) void onSetup({ engageGroupUrl: value });
                  }}
                />
              </label>
              <p className="mt-1 text-xs text-muted">Only an https://engage.usc.edu URL is accepted.</p>
            </div>
          </>
        )}
      </section>

      {eligible && (
        <>
          {/* ------------------------------------------------ 2. membership, group details, roster */}
          <section className={card} aria-labelledby="roster-heading">
            <h3 id="roster-heading" className="text-lg font-bold">2. Membership, group details, and roster</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Five required officers: president, vice president, secretary, treasurer, and programming chair.</li>
              <li>One full-time USC faculty or staff advisor who isn&apos;t on sabbatical or leave.</li>
              <li>At least five additional student members.</li>
            </ul>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <NumberField id="members-count" label="Additional student members on the roster" value={r.additionalMemberCount} min={0} max={1000} onSave={value => onSetup({ additionalMemberCount: value })} />
              <NumberField id="accepted-count" label="Positions accepted so far (optional)" value={r.acceptedPositionCount} min={0} max={1006} onSave={value => onSetup({ acceptedPositionCount: value })} />
            </div>
            <ul className="mt-4 list-none p-0">{ROSTER_TASKS.map(task)}</ul>
          </section>

          {/* ------------------------------------------------ 3. constitution & accountability document */}
          <section className={card} aria-labelledby="documents-heading">
            <h3 id="documents-heading" className="text-lg font-bold">3. Constitution and Accountability Document</h3>
            <p className="mt-1 text-sm text-muted">Both use required 2026–27 fillable templates. Constitution &amp; Accountability workshops are listed under Important dates.</p>
            <ul className="mt-3 list-none p-0">{DOCUMENT_TASKS.map(task)}</ul>
          </section>

          {/* ------------------------------------------------ 4. officer requirements */}
          <section className={card} aria-labelledby="officers-heading">
            <h3 id="officers-heading" className="text-lg font-bold">4. Individual officer requirements</h3>
            <p className="mt-1 text-sm text-muted">
              Each of the five officers completes three items individually and sends them to the submitter, who uploads all 15. Trainings must be completed {TRAINING_WINDOW_LABEL}; only currently enrolled students can sign in with SSO. Staff confirm training through a completion report.
            </p>
            <ul className="mt-3 list-none p-0">{task(OFFICER_GUIDE_TASK)}</ul>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-semibold">How each item works</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                <li><strong>Commitment to Community:</strong> review the <ExternalLink href={LINKS.officerCommitmentSample}>sample</ExternalLink>, then <ExternalLink href={LINKS.officerCommitment}>DocuSign the form</ExternalLink> with your first and last name, every RSO you&apos;re an officer of, and each position. Download a copy for the submitter.</li>
                <li><strong>Hazing Prevention 101: Student Edition 2026–2027</strong> on <ExternalLink href={LINKS.hazingTraining}>usc.prevent.zone</ExternalLink>.</li>
                <li><strong>RSO Officer Learning Path</strong> on <ExternalLink href={LINKS.learningPath}>Reach360</ExternalLink>. Review <ExternalLink href={LINKS.usingThisCourse}>“Using This Course”</ExternalLink> first. If it says “You have not been assigned any trainings,” click the link again. For tech issues, try another browser, a private window, or clearing the cache.</li>
                <li>Officer of several RSOs? Take the trainings once and include the certificates in each application.</li>
              </ul>
            </details>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold">{OFFICERS.length - officersWithGaps.length}/{OFFICERS.length} officers complete</span>
              {officersWithGaps.length > 0 && (
                <CopyButton
                  label={`Copy reminders for ${officersWithGaps.length} officer${officersWithGaps.length === 1 ? "" : "s"}`}
                  text={() => officersWithGaps.map(officer => `— ${officer.label} —\n${officerReminder(r, officer.id, orgName)}`).join("\n\n")}
                />
              )}
            </div>
            <div className="relative mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="py-2 pr-3">Officer role</th>
                    {REQUIREMENTS.map(requirement => (
                      <th scope="col" key={requirement.id} className="px-2 py-2 font-semibold">
                        <ExternalLink href={requirement.href}>{requirement.label}</ExternalLink>
                      </th>
                    ))}
                    <th scope="col" className="px-2 py-2 font-semibold">Reminder</th>
                  </tr>
                </thead>
                <tbody>
                  {OFFICERS.map(officer => (
                    <tr key={officer.id} className="border-b border-line last:border-0">
                      <th scope="row" className="py-2 pr-3 font-semibold">{officer.label}</th>
                      {REQUIREMENTS.map(requirement => (
                        <td key={requirement.id} className="px-2 py-2">
                          <input
                            type="checkbox"
                            className="h-[18px] w-[18px] accent-ok"
                            aria-label={`${officer.label}: ${requirement.label} received`}
                            checked={!!r.officers[officer.id]?.[requirement.id]}
                            onChange={event => void onOfficerRequirement(officer.id, requirement.id, event.target.checked)}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-2">
                        {missingOfficerItems(r, officer.id).length ? (
                          <CopyButton label="Copy reminder" ariaLabel={`Copy reminder for ${officer.label}`} text={() => officerReminder(r, officer.id, orgName) ?? ""} />
                        ) : <span className="font-semibold text-ok">All received</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ------------------------------------------------ 5. application questions & category expectations */}
          <section className={card} aria-labelledby="questions-heading">
            <h3 id="questions-heading" className="text-lg font-bold">5. Questions you&apos;ll answer on the application</h3>
            <p className="mt-1 text-sm text-muted">Gather these answers before opening the form. Tick anything that applies to your RSO to see extra steps USC expects.</p>
            <fieldset className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="RSO categories and activities">
              {CATEGORIES.map(category => (
                <label key={category.id} className="flex items-start gap-3 rounded-lg bg-paper p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-[18px] w-[18px] accent-ok"
                    checked={r.categories[category.id]}
                    onChange={event => void onSetup({ categories: { [category.id]: event.target.checked } as Partial<Record<RecognitionCategory, boolean>> })}
                  />
                  <span>
                    <strong>{category.label}</strong>
                    <span className="block text-muted">{category.detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <ul className="mt-4 list-none p-0">
              {APPLICATION_TASKS.map(task)}
              {CATEGORY_TASKS.filter(t => !t.when || t.when(r)).map(task)}
            </ul>
          </section>
        </>
      )}

      {/* ------------------------------------------------ 6. advisor requirements */}
      {(eligible || pathway === "fall_application") && (
        <section className={card} aria-labelledby="advisor-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 id="advisor-heading" className="text-lg font-bold">6. Advisor requirements (separate submission)</h3>
              <p className="mt-1 text-sm text-muted">
                The advisor completes these every year and submits them directly to USC, not with the application, by {ADVISOR_DEADLINE_LABEL}. They can start now. Advising several RSOs? Train once and list every RSO advised.
              </p>
              <p className="mt-1 text-sm font-semibold">{advisor.done}/{advisor.total} advisor items done</p>
            </div>
            <CopyButton label="Copy advisor instructions" text={() => advisorPacket(orgName)} />
          </div>
          <p className="mt-2 text-sm">
            <ExternalLink href={LINKS.advisorGuide}>RSO Advisor Recognition Requirements Guide</ExternalLink> · <ExternalLink href={LINKS.advisorToolkit}>RSO Advisors Toolkit</ExternalLink>
          </p>
          <ul className="mt-3 list-none p-0">{ADVISOR_TASKS.map(task)}</ul>
          <div className="mt-3 rounded-lg bg-paper p-3">
            <label className="grid max-w-md gap-1 text-sm font-semibold">
              Clery Act CSA training (TrojanLearn)
              <select className={input} value={r.cleryStatus} onChange={event => void onSetup({ cleryStatus: event.target.value as CleryStatus })}>
                {CLERY_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <p className="mt-2 text-sm text-muted" data-testid="clery-guidance">
              {CLERY_OPTIONS.find(option => option.id === r.cleryStatus)?.guidance}
            </p>
            <p className="mt-1 text-sm">
              <ExternalLink href={LINKS.trojanLearn}>TrojanLearn</ExternalLink>
              {r.cleryStatus === "needs_refresher" && <> · <ExternalLink href={LINKS.cleryRefresher}>Clery Act Refresher Training for CSAs</ExternalLink></>}
            </p>
            <p className="mt-1 text-xs text-muted">All advisors are Campus Security Authorities. USC will send the Clery deadline separately.</p>
          </div>
        </section>
      )}

      {/* ------------------------------------------------ 7. submit & after submission */}
      {(eligible || pathway === "fall_application") && (
        <section className={card} aria-labelledby="application-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 id="application-heading" className="text-lg font-bold">{pathway === "fall_application" ? "7. Your fall application" : "7. Submit and follow up"}</h3>
              <p className="mt-1 text-sm text-muted">Only the submitting officer can view or edit the application, and it can&apos;t be transferred.</p>
            </div>
            <ExternalLink href={portal.href} button>{portal.label}</ExternalLink>
          </div>

          {applicationClosed && notYetSubmitted && eligible && (
            <Notice tone="late">
              The {APPLICATION_DEADLINE_LABEL} deadline has passed and USC does not accept late applications. Contact {CONTACT.email} about next steps.
            </Notice>
          )}
          {eligible && (ready.ready ? (
            <Notice tone="ok">Your checklist is complete. Review every answer in EngageSC, upload the documents, and submit.</Notice>
          ) : (
            <div className="mt-3 rounded-lg bg-paper p-3 text-sm" data-testid="still-to-prepare">
              <strong>Still to prepare:</strong>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {ready.missingTasks.slice(0, 4).map(t => <li key={t.id}>{t.title}</li>)}
                {ready.missingTasks.length > 4 && <li>{ready.missingTasks.length - 4} more checklist item(s)</li>}
                {ready.membersNeeded > 0 && <li>Add at least {ready.membersNeeded} more additional student member(s) to the roster.</li>}
                {ready.missingOfficerDocs > 0 && <li>{ready.missingOfficerDocs} officer document receipt(s) still need to be checked off.</li>}
              </ul>
            </div>
          ))}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">
              Application status (update after checking EngageSC)
              <select className={input} value={status} onChange={event => void onStatus(event.target.value as RecognitionApplicationStatus)}>
                {STATUS_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <p className="self-end text-sm text-muted" data-testid="status-meaning">{STATUS_MEANING[status]} This is a manual note, not a live sync.</p>
          </div>

          {status === "denied" && (
            <div className="mt-3 rounded-lg bg-late-bg p-3 text-sm" data-testid="appeal-panel">
              <strong className="text-late">Appeal</strong>
              <p className="mt-1">Email Campus Activities a written statement of no more than 5 pages for the AVP for Student Culture and Community (or designee) within ten business days of the decision. That decision is final for this year. RSOs under a sanction that suspended or revoked recognition can&apos;t appeal through this process.</p>
              <label className="mt-2 grid max-w-xs gap-1 font-semibold">
                Date you received the decision
                <input
                  key={r.decisionDate}
                  type="date"
                  className={input}
                  defaultValue={r.decisionDate}
                  onBlur={event => { if (event.currentTarget.value !== r.decisionDate) void onSetup({ decisionDate: event.currentTarget.value }); }}
                />
              </label>
              {appeal && (
                <p className="mt-2 font-semibold" data-testid="appeal-deadline">
                  Appeal due by {appeal.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })} (weekends excluded; check for university holidays).
                </p>
              )}
            </div>
          )}

          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold">Find, review, or modify your application in EngageSC</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>If staff started a Chat, the application link is at the top of the Chat.</li>
              <li>Otherwise go to the EngageSC homepage (not your group page), open the left sidebar, then <strong>My Activity → My Surveys/Forms</strong>.</li>
              <li>From there you can review answers, download a PDF of your submission, resend position notifications, and see which workflow step is reviewing it.</li>
              <li>Statuses: <strong>Draft</strong> (not submitted), <strong>Pending Approval</strong> (under review), <strong>Requires Modifications</strong> (staff requested changes, the only time you can edit), <strong>Denied</strong>.</li>
              <li>Don&apos;t host events or operate as an RSO until recognition is approved.</li>
            </ul>
          </details>
          <ul className="mt-3 list-none p-0">{SUBMIT_TASKS.filter(t => !t.when || t.when(r)).map(task)}</ul>
        </section>
      )}

      {/* ------------------------------------------------ policies, FAQ, contact */}
      <details className={card} data-testid="policies">
        <summary className="cursor-pointer text-lg font-bold">Why an RSO may not be recognized, loss of recognition, and FAQ</summary>
        <h4 className="mt-3 font-semibold">Why an organization may not be recognized</h4>
        <ul className="mt-1 list-disc pl-5 text-sm text-muted">{NOT_RECOGNIZED_REASONS.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <h4 className="mt-3 font-semibold">Loss of recognition</h4>
        <ul className="mt-1 list-disc pl-5 text-sm text-muted">{LOSS_REASONS.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <p className="mt-2 text-sm">
          <ExternalLink href={LINKS.accountabilityPolicy}>RSO Accountability</ExternalLink> · <ExternalLink href={LINKS.benefits}>RSO Benefits &amp; Responsibilities</ExternalLink> · <ExternalLink href={LINKS.studentHandbook}>USC Student Handbook</ExternalLink>
        </p>
        <h4 className="mt-4 font-semibold">Frequently asked</h4>
        <dl className="mt-1 grid gap-2 text-sm">
          {FAQ.map(item => (
            <div key={item.q}>
              <dt className="font-semibold">{item.q}</dt>
              <dd className="text-muted">{item.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-muted">
          Campus Activities · {CONTACT.office} · {CONTACT.phone} · <a className={linkStyle} href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> · {CONTACT.hours}
        </p>
      </details>

      <p className="rounded-lg bg-paper p-3 text-xs text-muted">
        TrojanConnect saves checklist state on its backend. Don&apos;t upload certificates or enter USC passwords here. EngageSC opens in a separate tab, and nothing is read back from the portal automatically.
      </p>
    </div>
  );
}

function ExternalLink({ href, children, button }: { href: string; children: ReactNode; button?: boolean }) {
  return (
    <a
      className={button ? "inline-block rounded-lg bg-cardinal px-4 py-2 text-sm font-semibold text-on-cardinal" : linkStyle}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

function Notice({ tone, children }: { tone: "wait" | "late" | "ok"; children: ReactNode }) {
  const tones = { wait: "bg-wait-bg text-ink", late: "bg-late-bg text-late", ok: "bg-ok-bg text-ok" };
  return <p role="status" className={`mt-3 rounded-lg p-3 text-sm ${tones[tone]}`}>{children}</p>;
}

function NumberField({ id, label, value, min, max, onSave }: {
  id: string; label: string; value: number; min: number; max: number; onSave: (value: number) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="grid gap-1 text-sm font-semibold">
      {label}
      <input
        id={id}
        key={value}
        className={input}
        type="number"
        min={min}
        max={max}
        step={1}
        defaultValue={value}
        onBlur={event => {
          const raw = event.currentTarget.value.trim();
          const parsed = Number(raw);
          if (!raw || !Number.isInteger(parsed) || parsed < min || parsed > max) {
            setError(`Enter a whole number from ${min} to ${max}.`);
            event.currentTarget.value = String(value);
            return;
          }
          setError(null);
          if (parsed !== value) void onSave(parsed);
        }}
      />
      {error && <span role="alert" className="text-xs font-normal text-late">{error}</span>}
    </label>
  );
}

function TaskRow({ task, checked, onChange }: { task: RecognitionTask; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <li className="border-t border-line py-3 first:border-0 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id={`recognition-${task.id}`}
          className="mt-1 h-[18px] w-[18px] shrink-0 accent-ok"
          checked={checked}
          onChange={event => onChange(event.target.checked)}
        />
        <div className="min-w-0">
          <label htmlFor={`recognition-${task.id}`} className="cursor-pointer font-semibold">
            {task.title}
            {task.required && <span className="ml-2 rounded-full bg-block-bg px-1.5 text-xs font-medium text-muted">required</span>}
          </label>
          <p className="mt-1 text-sm text-muted">{task.detail}</p>
          {task.steps && (
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-muted">
              {task.steps.map(step => <li key={step}>{step}</li>)}
            </ol>
          )}
          {task.resources && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {task.resources.map(resource => <ExternalLink key={resource.href} href={resource.href}>{resource.label}</ExternalLink>)}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function CopyButton({ label, ariaLabel, text }: { label: string; ariaLabel?: string; text: () => string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const [manualText, setManualText] = useState("");
  return (
    <span className="inline-grid gap-1">
      <button
        type="button"
        aria-label={state === "copied" ? undefined : ariaLabel}
        aria-live="polite"
        className="rounded-lg border border-line bg-paper px-3 py-1.5 text-sm font-semibold text-cardinal"
        onClick={async () => {
          const value = text();
          try {
            await navigator.clipboard.writeText(value);
            setState("copied");
            setTimeout(() => setState("idle"), 2000);
          } catch {
            setManualText(value);
            setState("manual");
          }
        }}
      >
        {state === "copied" ? "Copied ✓" : label}
      </button>
      {state === "manual" && (
        <textarea
          readOnly
          aria-label="Text to copy"
          className="h-40 w-72 max-w-full rounded-lg border border-line bg-paper p-2 text-xs font-normal text-ink"
          value={manualText}
          onFocus={event => event.currentTarget.select()}
        />
      )}
    </span>
  );
}
