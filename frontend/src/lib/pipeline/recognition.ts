// RSO recognition: cycle constants and pure helpers shared by the recognition tab and the
// event pipeline's EngageSC step. Source of truth: USC Campus Activities' RSO Recognition
// Process page (checked against the version last updated November 12, 2026). Refresh every cycle.
import type {
  RecognitionApplicationStatus,
  RecognitionOfficer,
  RecognitionPathway,
  RecognitionProgress,
  RecognitionRequirement,
} from "./plan";

export const PROCESS_URL = "https://campusactivities.usc.edu/programs/recognized-student-organizations/rso-recognition-process/";
export const ENGAGE_HOME = "https://engage.usc.edu/";
export const ENGAGE_DIRECTORY = "https://engage.usc.edu/club_signup";
export const OFFICER_ACCESS_FORM = "https://forms.gle/1ncsGH165vLibRWc8";
export const REESTABLISH_FORM = "https://forms.gle/1EjhFMiAGDzed5wq5";
export const ADVISOR_REQUIREMENTS_FORM = "https://docs.google.com/forms/d/e/1FAIpQLSdsS-EcbWD3teNru4kaj4Leiu6bxNQDsrEPyIkkEX9e29hI-Q/viewform";
export const ADVISOR_DOCUMENTS_FORM = "https://forms.gle/C7h9eSXxyisopTjk8";
export const ADVISOR_TRAINING_URL = "https://usc.reach360.com/share/course/e8fe3a6b-e618-4563-ad8f-544c97fa500c";
export const ADVISOR_COMMITMENT_URL = "https://powerforms.docusign.net/3a4f015b-d3b8-4d43-adfa-5ec0f77fc227?env=na3&acct=3e63a5c5-bda2-4a75-a74a-95a6367636d6&accountId=3e63a5c5-bda2-4a75-a74a-95a6367636d6";

// USC: "before 11:59pm" on November 22 (Pacific). Advisor requirements: December 1 (end of day).
export const APPLICATION_DEADLINE = new Date("2026-11-22T23:59:00-08:00");
export const ADVISOR_DEADLINE = new Date("2026-12-01T23:59:00-08:00");
export const APPLICATION_DEADLINE_LABEL = "Nov 22, 2026 · 11:59 PM";
export const ADVISOR_DEADLINE_LABEL = "Dec 1, 2026";

export const OFFICERS: { id: RecognitionOfficer; label: string }[] = [
  { id: "president", label: "President" },
  { id: "vicePresident", label: "Vice president" },
  { id: "secretary", label: "Secretary" },
  { id: "treasurer", label: "Treasurer" },
  { id: "programmingChair", label: "Programming chair" },
];

export const REQUIREMENTS: { id: RecognitionRequirement; label: string; href: string }[] = [
  {
    id: "commitment",
    label: "Commitment to Community",
    href: "https://na3.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=44d5d5cb-159a-4004-ad59-d4c62423a96b&env=na3&acct=3e63a5c5-bda2-4a75-a74a-95a6367636d6&v=2",
  },
  { id: "hazingTraining", label: "Hazing Prevention 101 certificate", href: "https://usc.prevent.zone" },
  {
    id: "learningPath",
    label: "RSO Officer Learning Path certificate",
    href: "https://usc.reach360.com/share/learning-path/6af5ef44-a4b6-4303-8bb2-4a55d17951b5",
  },
];

export const STATUS_LABEL: Record<RecognitionApplicationStatus, string> = {
  not_started: "Not started",
  draft: "Draft",
  pending_approval: "Pending Approval",
  requires_modifications: "Requires Modifications",
  denied: "Denied",
  recognized: "Recognized (manual outcome)",
};

export const ELIGIBLE_PATHWAYS: RecognitionPathway[] = ["new", "reestablishing", "religious_spiritual"];

/** Whole days from `today` until `deadline`; 0 on the deadline day, negative once it has passed. */
export function daysUntil(deadline: Date, today: Date): number {
  if (today.getTime() > deadline.getTime()) {
    return -Math.max(1, Math.ceil((today.getTime() - deadline.getTime()) / 86_400_000));
  }
  return Math.floor((deadline.getTime() - today.getTime()) / 86_400_000);
}

export function countdownLabel(deadline: Date, today: Date): string {
  const days = daysUntil(deadline, today);
  if (days < 0) return "closed";
  if (days === 0) return "due today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

export function missingOfficerItems(recognition: RecognitionProgress | undefined, role: RecognitionOfficer) {
  return REQUIREMENTS.filter(requirement => !recognition?.officers?.[role]?.[requirement.id]);
}

export function officerReminder(
  recognition: RecognitionProgress | undefined,
  role: RecognitionOfficer,
  orgName: string,
): string | null {
  const missing = missingOfficerItems(recognition, role);
  if (!missing.length) return null;
  const roleLabel = OFFICERS.find(officer => officer.id === role)?.label ?? role;
  const org = orgName || "our RSO";
  return [
    `Hi! For ${org}'s 2026–27 USC RSO recognition application, I still need these from you as ${roleLabel.toLowerCase()}:`,
    ...missing.map(item => `• ${item.label}: ${item.href}`),
    "",
    "Log in with USC SSO. Complete the Learning Path after July 1, 2026. Sign the Commitment to Community form with your first and last name, the RSO name, and your position.",
    `Please send the certificates and a copy of the signed form to me (the submitting officer). The application closes ${APPLICATION_DEADLINE_LABEL}, and USC does not accept late applications.`,
    "",
    "Also accept your officer position from the EngageSC email (mailer@campusgroups.com) on a laptop or desktop.",
  ].join("\n");
}

export function advisorPacket(orgName: string): string {
  const org = orgName || "our RSO";
  return [
    `Hello! Thank you for advising ${org}. USC asks advisors to complete these annual recognition requirements by ${ADVISOR_DEADLINE_LABEL}:`,
    "• Accept your advisor position from the EngageSC email (mailer@campusgroups.com), on a laptop or desktop.",
    `• RSO Advisor Training (sign in at usc.reach360.com with SSO first): ${ADVISOR_TRAINING_URL}`,
    `• Advisor Commitment to Community form (DocuSign): ${ADVISOR_COMMITMENT_URL}`,
    `• Submit the training certificate PDF and the signed Commitment form through USC's advisor form: ${ADVISOR_DOCUMENTS_FORM}`,
    "• Clery Act CSA training in TrojanLearn. A 2026 completion counts, and USC verifies it by report, so no certificate is needed.",
    "",
    `USC does not accept these requirements by email. Details: ${PROCESS_URL}`,
  ].join("\n");
}

export type NextAction = { title: string; detail: string; target: string };

/** The single most useful next step for the submitting officer, derived from local checklist state. */
export function nextAction(
  recognition: RecognitionProgress | undefined,
  prepTasks: { id: string; title: string }[],
  today: Date,
): NextAction {
  const pathway = recognition?.pathway ?? "undecided";
  const status = recognition?.applicationStatus ?? "not_started";
  const checks = recognition?.checks ?? {};
  if (pathway === "undecided") {
    return { title: "Choose your application pathway", detail: "This decides whether you register a new group, re-establish one, or use a different process.", target: "pathway-heading" };
  }
  if (pathway === "fall_application") {
    return { title: "Check your fall application in EngageSC", detail: "USC says not to submit a second application.", target: "engage-handoff-heading" };
  }
  if (pathway === "fraternity_sorority") {
    return { title: "Follow the Fraternity & Sorority Life process", detail: "Social fraternities and sororities are not recognized through this RSO application.", target: "pathway-heading" };
  }
  if (status === "requires_modifications") {
    return { title: "Make the modifications Campus Activities requested", detail: "Only the submitting officer can edit, and only while the status is Requires Modifications.", target: "application-heading" };
  }
  if (status === "pending_approval") {
    return { title: "Watch email and EngageSC Chat for review updates", detail: "Campus Activities reviews applications in the order received.", target: "application-heading" };
  }
  if (status === "recognized") {
    return { title: "Recognized for 2026–27", detail: "Recognition runs through June 30, 2027. Plan to re-apply next cycle.", target: "application-heading" };
  }
  if (status === "denied") {
    return { title: "Contact Campus Activities about the decision", detail: "Reach your assigned staff member or stuacts@usc.edu.", target: "application-heading" };
  }
  if (daysUntil(APPLICATION_DEADLINE, today) < 0) {
    return { title: "The application deadline has passed", detail: "USC does not accept late applications. Contact stuacts@usc.edu about next steps.", target: "application-heading" };
  }
  if ((recognition?.additionalMemberCount ?? 0) < 5) {
    return { title: "Add at least five additional student members", detail: "These are in addition to the five officers and the advisor.", target: "roster-heading" };
  }
  const prep = prepTasks.find(task => !checks[task.id]);
  if (prep) return { title: prep.title, detail: "Next unchecked organization preparation item.", target: `recognition-${prep.id}` };
  const missing = OFFICERS.reduce((n, officer) => n + missingOfficerItems(recognition, officer.id).length, 0);
  if (missing) {
    return { title: `Collect ${missing} outstanding officer document${missing === 1 ? "" : "s"}`, detail: "Use “Copy reminder” to send each officer exactly what they still owe.", target: "officers-heading" };
  }
  return { title: "Upload everything and submit in EngageSC", detail: "Your local checklist is complete. The designated officer reviews and submits in the portal.", target: "application-heading" };
}
