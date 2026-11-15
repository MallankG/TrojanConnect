"use client";

import { useState } from "react";
import type {
  RecognitionApplicationStatus,
  RecognitionOfficer,
  RecognitionPathway,
  RecognitionProgress,
  RecognitionRequirement,
} from "@/lib/pipeline/plan";
import type { RecognitionSetup } from "@/lib/api-client";

import {
  ADVISOR_COMMITMENT_URL,
  ADVISOR_DEADLINE,
  ADVISOR_DEADLINE_LABEL,
  ADVISOR_DOCUMENTS_FORM,
  ADVISOR_REQUIREMENTS_FORM,
  ADVISOR_TRAINING_URL,
  APPLICATION_DEADLINE,
  APPLICATION_DEADLINE_LABEL,
  ELIGIBLE_PATHWAYS,
  ENGAGE_DIRECTORY,
  ENGAGE_HOME,
  OFFICER_ACCESS_FORM,
  OFFICERS,
  PROCESS_URL,
  REESTABLISH_FORM,
  REQUIREMENTS,
  STATUS_LABEL,
  advisorPacket,
  countdownLabel,
  daysUntil,
  missingOfficerItems,
  nextAction,
  officerReminder,
} from "@/lib/pipeline/recognition";

type Resource = { label: string; href: string };
type RecognitionTask = { id: string; title: string; detail: string; resources?: Resource[] };

const TASK_SECTIONS: { step: number; title: string; tasks: RecognitionTask[] }[] = [
  {
    step: 3,
    title: "Organization and application preparation",
    tasks: [
      {
        id: "group-details",
        title: "Update the EngageSC group details",
        detail: "Refresh categories, logo, mission, and goals. New groups do this while registering.",
        resources: [{ label: "EngageSC directory", href: ENGAGE_DIRECTORY }],
      },
      {
        id: "roster-entered",
        title: "Enter the five officers, advisor, and student members in EngageSC",
        detail: "Required officers: president, vice president, secretary, treasurer, and programming chair. Also list one eligible full-time USC advisor and at least five additional student members.",
      },
      {
        id: "submitter-designated",
        title: "Designate one eligible officer to submit and own follow-up",
        detail: "The submitter must be one of the five required officers. Each student may submit only one RSO application; the application cannot be transferred.",
      },
      {
        id: "constitution",
        title: "Complete the required 2026–27 Constitution template",
        detail: "Keep it in fillable PDF format. Do not print to PDF or flatten it.",
        resources: [{ label: "Download Constitution template", href: "https://campusactivities.usc.edu/wp-content/uploads/2026/11/2026-27-RSO-Constitution-Template-1.pdf" }],
      },
      {
        id: "accountability",
        title: "Complete the required Accountability Document",
        detail: "Use the required fillable template and review USC’s instructions and sample.",
        resources: [
          { label: "Download Accountability Document", href: "https://campusactivities.usc.edu/wp-content/uploads/2026/10/RSO-Accountability-Document-2026.pdf" },
          { label: "Instructions", href: "https://campusactivities.usc.edu/wp-content/uploads/2026/07/Instructions-RSO-Accountability-Document-2026.pdf" },
          { label: "Sample document", href: "https://campusactivities.usc.edu/wp-content/uploads/2026/07/Example-RSO-Accountability-Document-2026.pdf" },
        ],
      },
      {
        id: "organization-details",
        title: "Gather the RSO’s remaining application information",
        detail: "Prepare school/department and affiliation details, contact/account information, and answers about activities, elections, transitions, and property. Specialized activities may require additional approvals.",
        resources: [{ label: "RSO Toolkit (USC login required)", href: "https://drive.google.com/drive/folders/1XcERU3CNiN2cThtsf36oRpQWtoN6UZ_t?usp=sharing" }],
      },
      {
        id: "officer-guide-shared",
        title: "Share the Student Officer Requirements Guide with the other four officers",
        detail: "Officers should send their three completed requirements to the designated submitter.",
        resources: [{ label: "Student Officer Requirements Guide", href: "https://docs.google.com/document/d/1SXwg8rcMbMsg5mIAyubclE7k4k9-Z7yL_hRILD6o3mk/edit?usp=sharing" }],
      },
      {
        id: "position-instructions-sent",
        title: "Ask officers, advisor, and members to accept their EngageSC positions",
        detail: "They accept through the position email from mailer@campusgroups.com. You can continue the application before everyone accepts; do not wait for these responses to proceed.",
      },
    ],
  },
  {
    step: 5,
    title: "Advisor requirements (separate submission)",
    tasks: [
      {
        id: "advisor-eligibility",
        title: "Confirm the advisor is eligible and has agreed to the advisor duties",
        detail: "The listed advisor must be full-time USC faculty/staff, not on sabbatical or leave. Advisors agree to the constitution duties and accept their EngageSC position.",
      },
      {
        id: "advisor-position",
        title: "Confirm the advisor accepted their EngageSC position",
        detail: "Acceptance is requested through the email from mailer@campusgroups.com.",
      },
      {
        id: "advisor-training",
        title: "Submit the advisor RSO training certificate",
        detail: "Log in to Reach360 with SSO before opening the course. USC directs advisors to submit the certificate and Commitment form through the dedicated document form, not by email.",
        resources: [
          { label: "RSO Advisor Training", href: ADVISOR_TRAINING_URL },
          { label: "Advisor Recognition Requirements Guide", href: "https://docs.google.com/document/d/1ZQT6U9Fr2ux-R6sriMMg2dakD42QfJiahsTsb57RzDA/edit?usp=sharing" },
          { label: "Submit advisor documents", href: ADVISOR_DOCUMENTS_FORM },
        ],
      },
      {
        id: "advisor-commitment",
        title: "Submit the advisor’s Commitment to Community form",
        detail: "Complete the DocuSign, then submit it with the advisor training certificate through USC’s dedicated document form, not the student application.",
        resources: [
          { label: "Review sample and sign advisor Commitment form", href: ADVISOR_COMMITMENT_URL },
          { label: "Submit advisor documents", href: ADVISOR_DOCUMENTS_FORM },
          { label: "Advisor Requirements form", href: ADVISOR_REQUIREMENTS_FORM },
        ],
      },
      {
        id: "clery-training",
        title: "Confirm the advisor’s Clery Act training status",
        detail: "USC verifies this by TrojanLearn report; the advisor does not submit a certificate. A 2026 completion may satisfy the current requirement; otherwise follow USC’s refresher instructions.",
        resources: [{ label: "TrojanLearn", href: "https://trojanlearn.usc.edu" }],
      },
    ],
  },
];

const FOLLOW_UP_TASK: RecognitionTask = {
  id: "follow-up",
  title: "Monitor EngageSC and email; respond to Campus Activities",
  detail: "Only the submitting officer can view or edit the application. Modifications are available only when staff set its status to Requires Modifications.",
  resources: [{ label: "Review USC’s status and follow-up instructions", href: PROCESS_URL }],
};

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as RecognitionApplicationStatus[])
  .map(id => ({ id, label: STATUS_LABEL[id] }));

const PATHWAY_OPTIONS: { id: RecognitionPathway; label: string }[] = [
  { id: "undecided", label: "Select a pathway…" },
  { id: "new", label: "New RSO" },
  { id: "reestablishing", label: "Re-establishing after a lapse" },
  { id: "fall_application", label: "Already applied in the fall" },
  { id: "religious_spiritual", label: "Religious or spiritual organization" },
  { id: "fraternity_sorority", label: "Social fraternity or sorority" },
];

const REQUIREMENTS_FOR_READINESS = [
  "group-details",
  "roster-entered",
  "submitter-designated",
  "constitution",
  "accountability",
  "organization-details",
];
const input = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-ink";
const linkStyle = "font-semibold text-cardinal underline";

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
  const checks = recognition?.checks ?? {};
  const officers = recognition?.officers;
  const pathway = recognition?.pathway ?? "undecided";
  const additionalMembers = recognition?.additionalMemberCount ?? 0;
  const applicationStatus = recognition?.applicationStatus ?? "not_started";
  const eligible = ELIGIBLE_PATHWAYS.includes(pathway);
  const missingRequirements = REQUIREMENTS_FOR_READINESS.filter(key => !checks[key]);
  const missingOfficerRequirements = OFFICERS.flatMap(officer =>
    missingOfficerItems(recognition, officer.id).map(requirement => `${officer.label}: ${requirement.label}`),
  );
  const prepTasks = TASK_SECTIONS[0].tasks.filter(task => REQUIREMENTS_FOR_READINESS.includes(task.id));
  const next = nextAction(recognition, prepTasks, today);
  const applicationClosed = daysUntil(APPLICATION_DEADLINE, today) < 0;
  const notYetSubmitted = applicationStatus === "not_started" || applicationStatus === "draft";
  const officersWithGaps = OFFICERS.filter(officer => missingOfficerItems(recognition, officer.id).length);
  const needsMoreMembers = additionalMembers < 5;
  const readyToBegin = eligible
    && !missingRequirements.length
    && !missingOfficerRequirements.length
    && !needsMoreMembers;
  const completedTasks = [...TASK_SECTIONS.flatMap(section => section.tasks), FOLLOW_UP_TASK]
    .filter(task => checks[task.id]).length
    + OFFICERS.flatMap(officer => REQUIREMENTS.map(requirement => officers?.[officer.id]?.[requirement.id]))
      .filter(Boolean).length;
  const totalTasks = TASK_SECTIONS.flatMap(section => section.tasks).length + 1 + OFFICERS.length * REQUIREMENTS.length;
  const groupUrl = recognition?.engageGroupUrl ?? "";
  const portalUrl = pathway === "fraternity_sorority"
    ? PROCESS_URL
    : groupUrl || (["new", "reestablishing", "religious_spiritual"].includes(pathway) ? ENGAGE_DIRECTORY : ENGAGE_HOME);
  const portalLabel = pathway === "fraternity_sorority"
    ? "View USC recognition guidance"
    : pathway === "fall_application"
      ? "Open existing EngageSC application"
      : groupUrl
        ? "Open your EngageSC group page"
        : ["new", "reestablishing", "religious_spiritual"].includes(pathway)
          ? "Find or register an RSO"
          : "Open EngageSC";

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5 rounded-xl border-l-4 border-cardinal bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Annual recognition · {recognition?.cycle ?? "2026-27"} cycle</p>
            <h2 className="mt-1 text-2xl font-bold">RSO recognition</h2>
          </div>
          <p className="text-sm font-semibold text-cardinal">{completedTasks}/{totalTasks} requirements tracked</p>
        </div>
        <p className="mt-2 text-sm text-muted">
          {pathway === "fraternity_sorority"
            ? "Social fraternities and sororities follow a separate USC recognition process."
            : pathway === "fall_application"
              ? "Review your existing fall application in EngageSC; do not submit another application."
              : "Prepare the RSO application, coordinate officer and advisor requirements, then continue in EngageSC. This checklist does not submit for you."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="rounded-lg bg-paper px-3 py-2" data-testid="application-deadline">
            <strong>Application closes:</strong> {APPLICATION_DEADLINE_LABEL} · <span className={daysUntil(APPLICATION_DEADLINE, today) <= 3 ? "font-semibold text-late" : ""}>{countdownLabel(APPLICATION_DEADLINE, today)}</span>
          </span>
          <span className="rounded-lg bg-paper px-3 py-2" data-testid="advisor-deadline">
            <strong>Advisor requirements due:</strong> {ADVISOR_DEADLINE_LABEL} · <span className={daysUntil(ADVISOR_DEADLINE, today) <= 3 ? "font-semibold text-late" : ""}>{countdownLabel(ADVISOR_DEADLINE, today)}</span>
          </span>
          <a className="rounded-lg bg-paper px-3 py-2 font-semibold text-cardinal underline" href={PROCESS_URL} target="_blank" rel="noopener noreferrer">
            Verify current USC requirements
          </a>
        </div>
        <p className="mt-3 text-xs text-muted">
          Recognition for this cycle runs through June 30, 2027. Deadlines and linked requirements can change; USC’s page is the source of truth.
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ready/30 bg-ready-bg p-4" aria-label="Next recognition step" data-testid="next-action">
        <div>
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

      <section className="mb-4 rounded-xl bg-surface p-5 shadow-sm" aria-labelledby="pathway-heading">
        <h3 id="pathway-heading" className="text-lg font-bold">1. Choose your application pathway</h3>
        <label className="mt-3 grid max-w-xl gap-1 text-sm font-semibold">
          Organization pathway
          <select
            className={input}
            value={pathway}
            onChange={event => void onSetup({ pathway: event.target.value as RecognitionPathway })}
          >
            {PATHWAY_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        {pathway === "fall_application" && (
          <p className="mt-3 rounded-lg bg-wait-bg p-3 text-sm text-ink">
            USC says not to submit another application if your RSO applied in the fall. Continue in EngageSC to review the existing application instead.
          </p>
        )}
        {pathway === "undecided" && (
          <p className="mt-3 rounded-lg bg-paper p-3 text-sm text-muted">
            Choose the option that matches your RSO before using the preparation checklist.
          </p>
        )}
        {pathway === "fraternity_sorority" && (
          <p className="mt-3 rounded-lg bg-wait-bg p-3 text-sm text-ink">
            Social fraternities and sororities use the Office of Fraternity & Sorority Life process, not this RSO application. Check the USC recognition page for the applicable process.
          </p>
        )}
        {(pathway === "new" || pathway === "religious_spiritual") && (
          <p className="mt-3 text-sm text-muted">
            Start in the EngageSC directory. New religious or spiritual organizations should choose the Office of Religious & Spiritual Life registration option.
          </p>
        )}
        {pathway === "reestablishing" && (
          <p className="mt-3 text-sm text-muted">
            For an existing page, request officer access before opening the application. If the RSO page is missing after a lapse, use USC’s re-establishment form.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {["new", "reestablishing", "religious_spiritual"].includes(pathway) && (
            <a className={linkStyle} href={ENGAGE_DIRECTORY} target="_blank" rel="noopener noreferrer">Find or register an RSO in EngageSC</a>
          )}
          {pathway === "fraternity_sorority" && (
            <a className={linkStyle} href={PROCESS_URL} target="_blank" rel="noopener noreferrer">View USC recognition guidance</a>
          )}
          {pathway === "reestablishing" && (
            <>
              <a className={linkStyle} href={OFFICER_ACCESS_FORM} target="_blank" rel="noopener noreferrer">Request officer access to an existing page</a>
              <a className={linkStyle} href={REESTABLISH_FORM} target="_blank" rel="noopener noreferrer">Request re-establishment after a lapse</a>
            </>
          )}
        </div>
      </section>

      <section className="mb-4 rounded-xl bg-surface p-5 shadow-sm" aria-labelledby="engage-handoff-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-wait">Manual handoff · not live synced</p>
            <h3 id="engage-handoff-heading" className="mt-1 text-lg font-bold">
              {pathway === "fraternity_sorority"
                ? "Follow USC’s separate recognition process"
                : pathway === "fall_application"
                  ? "Review your existing EngageSC application"
                  : "Connect to the EngageSC portal"}
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-muted">
              {pathway === "fraternity_sorority"
                ? "Social fraternities and sororities follow a separate USC process; use the official guidance rather than this RSO application."
                : pathway === "fall_application"
                  ? "Since you applied in fall, continue with that application in EngageSC instead of submitting another one."
                  : "USC’s application is completed in EngageSC. Sign in there, open your RSO group page, and use the recognition application link. TrojanConnect does not collect USC passwords or submit/update the portal."}
            </p>
          </div>
          <a className="rounded-lg bg-cardinal px-4 py-2 text-sm font-semibold text-on-cardinal" href={portalUrl} target="_blank" rel="noopener noreferrer">
            {portalLabel}
          </a>
        </div>
        {pathway !== "fraternity_sorority" && (
          <label className="mt-4 grid max-w-2xl gap-1 text-sm font-semibold">
            Your EngageSC group page URL (optional)
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
        )}
        <p className="mt-1 text-xs text-muted">Only an https://engage.usc.edu group URL is accepted. Your USC sign-in stays in the USC portal.</p>
      </section>

      <section className="mb-4 rounded-xl bg-surface p-5 shadow-sm" aria-labelledby="roster-heading">
        <h3 id="roster-heading" className="text-lg font-bold">2. Roster and submitter</h3>
        <p className="mt-1 text-sm text-muted">Track counts here; add names and approve positions in EngageSC.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Additional student members entered"
            value={additionalMembers}
            min={0}
            max={1000}
            onSave={value => onSetup({ additionalMemberCount: value })}
          />
          <NumberField
            label="Roster positions accepted in EngageSC"
            value={recognition?.acceptedPositionCount ?? 0}
            min={0}
            max={1006}
            onSave={value => onSetup({ acceptedPositionCount: value })}
          />
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>USC requires five named officers, one eligible full-time USC faculty/staff advisor, and at least five additional student members.</li>
          <li>Everyone receives an EngageSC approval email. USC says the submitter may continue before every position is accepted.</li>
        </ul>
      </section>

      {TASK_SECTIONS.slice(0, 1).map(section => (
        <section key={section.title} className="mb-4 rounded-xl bg-surface p-5 shadow-sm">
          <h3 className="mb-3 text-lg font-bold">{section.step}. {section.title}</h3>
          <ul className="m-0 list-none p-0">
            {section.tasks.map(task => (
              <TaskRow key={task.id} task={task} checked={!!checks[task.id]} onChange={value => onCheck(task.id, value)} />
            ))}
          </ul>
        </section>
      ))}

      <section className="mb-4 rounded-xl bg-surface p-5 shadow-sm" aria-labelledby="officers-heading">
        <h3 id="officers-heading" className="text-lg font-bold">4. Collect each required officer’s three items</h3>
        <p className="mt-1 text-sm text-muted">
          Track receipts for each role without storing names or certificate files. USC requires all five officers to send their signed form and two certificates to the designated submitter for EngageSC upload.
        </p>
        <p className="mt-2 text-sm">
          <a className={linkStyle} href="https://docs.google.com/document/d/1MJOsn_A6lQWW5rk0VpYXwwqu2sw7VyFs/edit?usp=sharing" target="_blank" rel="noopener noreferrer">
            Review the Commitment to Community instructions and sample before signing
          </a>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold">{OFFICERS.length - officersWithGaps.length}/{OFFICERS.length} officers complete</span>
          {officersWithGaps.length > 0 && (
            <CopyButton
              label={`Copy reminders for ${officersWithGaps.length} officer${officersWithGaps.length === 1 ? "" : "s"}`}
              text={() => officersWithGaps
                .map(officer => `— ${officer.label} —\n${officerReminder(recognition, officer.id, orgName)}`)
                .join("\n\n")}
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
                    <a className={linkStyle} href={requirement.href} target="_blank" rel="noopener noreferrer">{requirement.label}</a>
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
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`${officer.label}: ${requirement.label} received`}
                          checked={!!officers?.[officer.id]?.[requirement.id]}
                          onChange={event => void onOfficerRequirement(officer.id, requirement.id, event.target.checked)}
                        />
                      </label>
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    {missingOfficerItems(recognition, officer.id).length ? (
                      <CopyButton
                        label="Copy reminder"
                        ariaLabel={`Copy reminder for ${officer.label}`}
                        text={() => officerReminder(recognition, officer.id, orgName) ?? ""}
                      />
                    ) : <span className="font-semibold text-ok">All received</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {TASK_SECTIONS.slice(1).map(section => (
        <section key={section.title} className="mb-4 rounded-xl bg-surface p-5 shadow-sm" aria-labelledby="advisor-heading">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="advisor-heading" className="text-lg font-bold">{section.step}. {section.title}</h3>
              <p className="mt-1 text-sm text-muted">The advisor submits these directly to USC, separately from the application, by {ADVISOR_DEADLINE_LABEL}. They can start now.</p>
            </div>
            <CopyButton label="Copy advisor instructions" text={() => advisorPacket(orgName)} />
          </div>
          <ul className="m-0 list-none p-0">
            {section.tasks.map(task => (
              <TaskRow key={task.id} task={task} checked={!!checks[task.id]} onChange={value => onCheck(task.id, value)} />
            ))}
          </ul>
        </section>
      ))}

      <section className="mb-4 rounded-xl bg-surface p-5 shadow-sm" aria-labelledby="application-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="application-heading" className="text-lg font-bold">
              {pathway === "fraternity_sorority"
                ? "Follow the applicable USC process"
                : pathway === "fall_application"
                  ? "Review your fall application"
                  : "6. Continue or check status in EngageSC"}
            </h3>
            <p className="mt-1 text-sm text-muted">
              {readyToBegin
                ? "Your local preparation checklist is complete. Review every answer and upload the documents in EngageSC before submitting."
                : "Finish the preparation items above, then review everything in EngageSC. This checklist cannot verify what is in the portal."}
            </p>
          </div>
          <a className="rounded-lg bg-cardinal px-4 py-2 text-sm font-semibold text-on-cardinal" href={portalUrl} target="_blank" rel="noopener noreferrer">
            {portalLabel}
          </a>
        </div>
        {applicationClosed && notYetSubmitted && eligible && (
          <p role="status" className="mt-3 rounded-lg bg-late-bg p-3 text-sm text-late">
            The {APPLICATION_DEADLINE_LABEL} deadline has passed and USC does not accept late applications. Contact stuacts@usc.edu about next steps.
          </p>
        )}
        {pathway === "fall_application" || pathway === "fraternity_sorority" ? (
          <p className="mt-3 rounded-lg bg-wait-bg p-3 text-sm">
            This recognition checklist is not the correct submission path for the selected organization. Follow USC’s process guidance before continuing.
          </p>
        ) : !readyToBegin ? (
          <div className="mt-3 rounded-lg bg-paper p-3 text-sm">
            <strong>Still to prepare:</strong>
            <ul className="mt-1 list-disc pl-5 text-muted">
              {needsMoreMembers && <li>Add at least {5 - additionalMembers} more additional student member(s) to the EngageSC roster.</li>}
              {missingRequirements.slice(0, 3).map(key => (
                <li key={key}>{TASK_SECTIONS.flatMap(section => section.tasks).find(task => task.id === key)?.title ?? key}</li>
              ))}
              {missingOfficerRequirements.length > 0 && (
                <li>{missingOfficerRequirements.length} officer document receipt(s) still need to be checked off.</li>
              )}
              {missingRequirements.length > 3 && <li>{missingRequirements.length - 3} more organization preparation item(s).</li>}
            </ul>
          </div>
        ) : (
          <p className="mt-3 rounded-lg bg-ok/10 p-3 text-sm text-ok">
            Local preparation requirements are checked off. USC still requires the designated officer to review and submit the application in EngageSC.
          </p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">
            Application status (update after checking EngageSC)
            <select
              className={input}
              value={applicationStatus}
              onChange={event => void onStatus(event.target.value as RecognitionApplicationStatus)}
            >
              {STATUS_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <p className="self-end text-sm text-muted">
            Status is a manual note, not a live EngageSC sync. If the application requires modifications, only its submitter can edit it.
          </p>
        </div>
        <p className="mt-3 text-sm text-muted">
          To find an existing application, sign in to EngageSC and open <strong>My Activity → My Surveys/Forms</strong>, or follow the application link in an EngageSC Chat from Campus Activities.
        </p>
        <ul className="mt-3 list-none p-0">
          <TaskRow task={FOLLOW_UP_TASK} checked={!!checks[FOLLOW_UP_TASK.id]} onChange={value => onCheck(FOLLOW_UP_TASK.id, value)} />
        </ul>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <a className={linkStyle} href={PROCESS_URL} target="_blank" rel="noopener noreferrer">Application deadline and official instructions</a>
          {pathway === "reestablishing" && <a className={linkStyle} href={REESTABLISH_FORM} target="_blank" rel="noopener noreferrer">Re-establishment form</a>}
        </div>
      </section>

      <p className="rounded-lg bg-paper p-3 text-xs text-muted">
        TrojanConnect saves checklist state locally on its backend. Do not upload certificates or enter USC passwords here. The EngageSC handoff opens USC in a separate tab; no portal content or status is read back automatically.
      </p>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onSave,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onSave: (value: number) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="grid gap-1 text-sm font-semibold">
      {label}
      <input
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
          aria-label={task.title}
          checked={checked}
          onChange={event => onChange(event.target.checked)}
        />
        <div>
          <label htmlFor={`recognition-${task.id}`} className="cursor-pointer font-semibold">{task.title}</label>
          <p className="mt-1 text-sm text-muted">{task.detail}</p>
          {task.resources && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {task.resources.map(resource => (
                <a key={resource.href} className={`text-sm ${linkStyle}`} href={resource.href} target="_blank" rel="noopener noreferrer">
                  {resource.label}
                </a>
              ))}
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
          aria-label="Reminder text to copy"
          className="h-40 w-72 rounded-lg border border-line bg-paper p-2 text-xs font-normal text-ink"
          value={manualText}
          onFocus={event => event.currentTarget.select()}
        />
      )}
    </span>
  );
}
