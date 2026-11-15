"use client";

type Resource = { label: string; href: string };
type RecognitionTask = { id: string; title: string; detail: string; resources?: Resource[] };
type RecognitionSection = { title: string; tasks: RecognitionTask[] };

const PROCESS_URL = "https://campusactivities.usc.edu/programs/recognized-student-organizations/rso-recognition-process/";

const SECTIONS: RecognitionSection[] = [
  {
    title: "1. Confirm eligibility and access",
    tasks: [
      {
        id: "eligibility",
        title: "Confirm this is the right process for your organization",
        detail: "The 2026–27 cycle is for new RSOs and groups re-establishing after a lapse. If you applied in the fall, do not submit another application. Social fraternities and sororities use the Office of Fraternity & Sorority Life process instead.",
        resources: [{ label: "USC recognition process", href: PROCESS_URL }],
      },
      {
        id: "access",
        title: "Find the EngageSC group page and confirm the submitter has officer access",
        detail: "Only an officer in one of the five required positions can submit. For a lapsed RSO that is not listed, use USC’s re-establishment form.",
        resources: [
          { label: "EngageSC directory", href: "https://engage.usc.edu/club_signup" },
          { label: "Request re-establishment access", href: "https://forms.gle/1EjhFMiAGDzed5wq5" },
        ],
      },
    ],
  },
  {
    title: "2. Update the group and roster",
    tasks: [
      {
        id: "group-details",
        title: "Update group details",
        detail: "Refresh the organization’s categories, logo, mission, and goals in EngageSC. New groups register through the directory; religious or spiritual groups use the Office of Religious & Spiritual Life option.",
        resources: [{ label: "EngageSC directory", href: "https://engage.usc.edu/club_signup" }],
      },
      {
        id: "roster",
        title: "Add the required officers, advisor, and members",
        detail: "List a president, vice president, secretary, treasurer, and programming chair; one full-time USC faculty or staff advisor who is not on leave or sabbatical; and at least five additional student members.",
      },
      {
        id: "position-acceptance",
        title: "Ask everyone to accept their EngageSC position",
        detail: "Officers, the advisor, and members receive an email from mailer@campusgroups.com. You can continue the application after completing the roster; you do not have to wait for every acceptance.",
      },
    ],
  },
  {
    title: "3. Prepare organization materials",
    tasks: [
      {
        id: "constitution",
        title: "Complete the required 2026–27 Constitution template",
        detail: "Keep the fillable PDF format. Do not print to PDF or flatten the completed form.",
        resources: [{ label: "Download Constitution template", href: "https://campusactivities.usc.edu/wp-content/uploads/2026/11/2026-27-RSO-Constitution-Template-1.pdf" }],
      },
      {
        id: "accountability",
        title: "Complete the required Accountability Document",
        detail: "Use the required fillable template and review USC’s instructions and sample before completing it.",
        resources: [
          { label: "Download Accountability Document", href: "https://campusactivities.usc.edu/wp-content/uploads/2026/10/RSO-Accountability-Document-2026.pdf" },
          { label: "Instructions", href: "https://campusactivities.usc.edu/wp-content/uploads/2026/07/Instructions-RSO-Accountability-Document-2026.pdf" },
          { label: "Sample document", href: "https://campusactivities.usc.edu/wp-content/uploads/2026/07/Example-RSO-Accountability-Document-2026.pdf" },
        ],
      },
      {
        id: "organization-details",
        title: "Gather the organization’s application details",
        detail: "Prepare school/department and affiliation information, contact/account details, and answers about activities, elections, transitions, and property. Affiliated or specialized groups may need additional approvals or governing documents.",
        resources: [{ label: "RSO Toolkit (USC login required)", href: "https://drive.google.com/drive/folders/1XcERU3CNiN2cThtsf36oRpQWtoN6UZ_t?usp=sharing" }],
      },
    ],
  },
  {
    title: "4. Collect each officer’s requirements",
    tasks: [
      {
        id: "officer-commitments",
        title: "Collect a Commitment to Community form from all five officers",
        detail: "Each officer completes and signs their own form, then sends it to the designated submitter for upload. The submitter should share the officer requirements guide with the other four officers.",
        resources: [
          { label: "Student Officer Requirements Guide", href: "https://docs.google.com/document/d/1SXwg8rcMbMsg5mIAyubclE7k4k9-Z7yL_hRILD6o3mk/edit?usp=sharing" },
          { label: "Commitment form instructions", href: "https://docs.google.com/document/d/1MJOsn_A6lQWW5rk0VpYXwwqu2sw7VyFs/edit?usp=sharing" },
          { label: "Complete the form via DocuSign", href: "https://na3.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=44d5d5cb-159a-4004-ad59-d4c62423a96b&env=na3&acct=3e63a5c5-bda2-4a75-a74a-95a6367636d6&v=2" },
        ],
      },
      {
        id: "officer-hazing-training",
        title: "Collect Hazing Prevention 101 certificates from all five officers",
        detail: "The required 2026–27 training must be completed between July 1, 2026 and the application deadline.",
        resources: [{ label: "Hazing Prevention 101: Student Edition", href: "https://usc.prevent.zone" }],
      },
      {
        id: "officer-learning-path",
        title: "Collect RSO Officer Learning Path certificates from all five officers",
        detail: "Officers should send their completion certificates to the application submitter.",
        resources: [
          { label: "RSO Officer Learning Path", href: "https://usc.reach360.com/share/learning-path/6af5ef44-a4b6-4303-8bb2-4a55d17951b5" },
          { label: "Using This Course", href: "https://usc.reach360.com/share/course/f56b9b3b-59d4-42ad-adca-4aaf25ebea3b" },
        ],
      },
    ],
  },
  {
    title: "5. Complete advisor requirements separately",
    tasks: [
      {
        id: "advisor-eligibility",
        title: "Confirm the advisor meets USC’s eligibility requirements",
        detail: "The listed advisor must be full-time USC faculty or staff, not on sabbatical or leave, and agree to the duties in the RSO constitution.",
      },
      {
        id: "advisor-position",
        title: "Have the advisor accept their EngageSC position",
        detail: "The advisor accepts through the position email from mailer@campusgroups.com.",
      },
      {
        id: "advisor-training",
        title: "Submit the advisor training certificate through USC’s advisor form",
        detail: "Advisors can begin at any time and do not need to wait for the RSO application. Submit the RSO Advisor Training certificate with the advisor’s Commitment to Community form. Do not submit advisor requirements by email.",
        resources: [
          { label: "RSO Advisor Training", href: "https://usc.reach360.com/share/course/e8fe3a6b-e618-4563-ad8f-544c97fa500c" },
          { label: "Advisor Requirements form", href: "https://docs.google.com/forms/d/e/1FAIpQLSdsS-EcbWD3teNru4kaj4Leiu6bxNQDsrEPyIkkEX9e29hI-Q/viewform" },
        ],
      },
      {
        id: "advisor-commitment",
        title: "Submit the advisor’s Commitment to Community form",
        detail: "Advisors complete their own form and submit it through the Advisor Requirements form, not with the student officers’ application uploads.",
        resources: [{ label: "Advisor Commitment form", href: "https://powerforms.docusign.net/3a4f015b-d3b8-4d43-adfa-5ec0f77fc227?env=na3&acct=3e63a5c5-bda2-4a75-a74a-95a6367636d6&accountId=3e63a5c5-bda2-4a75-a74a-95a6367636d6" }],
      },
      {
        id: "clery-training",
        title: "Confirm the advisor’s Clery Act training status",
        detail: "USC confirms completion via TrojanLearn report; no certificate is submitted. The USC page explains when a refresher is required.",
        resources: [{ label: "TrojanLearn", href: "https://trojanlearn.usc.edu" }],
      },
    ],
  },
  {
    title: "6. Submit and follow up",
    tasks: [
      {
        id: "application",
        title: "Complete the EngageSC recognition application",
        detail: "One current officer in a required position submits all organization materials and all 15 officer documents (three for each of five officers). A student may submit for only one RSO; coordinate if you serve multiple groups.",
        resources: [{ label: "Open EngageSC", href: "https://engage.usc.edu/" }],
      },
      {
        id: "submitted",
        title: "Submit before the 2026–27 application deadline",
        detail: "The application deadline is November 22, 2026 at 11:59 PM. The advisor requirements have a separate December 1, 2026 deadline. Late applications are not accepted.",
      },
      {
        id: "follow-up",
        title: "Monitor the application and respond to Campus Activities",
        detail: "Watch for the confirmation email and EngageSC Chat. Statuses include Draft, Pending Approval, Requires Modifications, and Denied. Only the submitting officer can view or edit the application, and edits are available when staff set it to Requires Modifications.",
        resources: [{ label: "Review official process and status details", href: PROCESS_URL }],
      },
    ],
  },
];

export function RecognitionWorkflow({
  checks,
  onCheck,
}: {
  checks: Record<string, boolean>;
  onCheck: (check: string, value: boolean) => Promise<void>;
}) {
  const tasks = SECTIONS.flatMap(section => section.tasks);
  const complete = tasks.filter(task => checks[task.id]).length;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5 rounded-xl border-l-4 border-cardinal bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Parallel annual workflow · 2026–27 cycle</p>
            <h2 className="mt-1 text-2xl font-bold">RSO recognition</h2>
          </div>
          <p className="text-sm font-semibold text-cardinal">{complete}/{tasks.length} tasks complete</p>
        </div>
        <p className="mt-2 text-sm text-muted">
          Track recognition alongside event planning. USC grants RSO benefits after recognition; completing this checklist does not submit the application.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="rounded-lg bg-paper px-3 py-2"><strong>Application:</strong> Nov 22, 2026 · 11:59 PM</span>
          <span className="rounded-lg bg-paper px-3 py-2"><strong>Advisor requirements:</strong> Dec 1, 2026</span>
          <a className="rounded-lg bg-paper px-3 py-2 font-semibold text-cardinal underline" href={PROCESS_URL} target="_blank" rel="noopener noreferrer">
            Verify current USC requirements
          </a>
        </div>
        <p className="mt-3 text-xs text-muted">
          Deadlines and linked requirements are from USC’s recognition page and may change. Always verify them with USC. Recognition dates for 2026–27 run through June 30, 2027.
        </p>
      </header>

      <div className="grid gap-4">
        {SECTIONS.map(section => (
          <section key={section.title} className="rounded-xl bg-surface p-5 shadow-sm">
            <h3 className="mb-3 text-lg font-bold">{section.title}</h3>
            <ul className="m-0 list-none p-0">
              {section.tasks.map(task => (
                <li key={task.id} className="border-t border-line py-3 first:border-0 first:pt-0 last:pb-0">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-[18px] w-[18px] shrink-0 accent-ok"
                      checked={!!checks[task.id]}
                      onChange={event => void onCheck(task.id, event.target.checked)}
                    />
                    <span>
                      <span className="block font-semibold">{task.title}</span>
                      <span className="mt-1 block text-sm text-muted">{task.detail}</span>
                      {task.resources && (
                        <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                          {task.resources.map(resource => (
                            <a
                              key={resource.href}
                              className="text-sm font-semibold text-cardinal underline"
                              href={resource.href}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {resource.label}
                            </a>
                          ))}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-4 rounded-lg bg-paper p-3 text-xs text-muted">
        Checklist progress is saved with the event pipeline on this backend. The live USC page is the source of truth for eligibility, documents, deadlines, and application status.
      </p>
    </div>
  );
}
