// End-to-end: Next.js UI ↔ FastAPI for the RSO recognition workflow. Fake data only; no USC portal is touched.
// Prereqs: FastAPI on :8000 and the frontend on :3000 (`npm run build && npm start`), then `npm run test:e2e`.
// Existing local state (backend/data/event_pipeline.json) is backed up and restored afterwards.
// Uses installed Google Chrome by default; set PW_CHANNEL="" to use Playwright's bundled Chromium.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL ?? "http://localhost:3000/pipeline";
const STATE = path.resolve(HERE, "../../backend/data/event_pipeline.json");
const BACKUP = `${STATE}.e2e-backup`;
const SHOTS = process.env.E2E_SCREENSHOTS; // optional directory for screenshots
const CHANNEL = process.env.PW_CHANNEL ?? "chrome";
let passed = 0, failed = 0;
const ok = (cond, name, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
const section = name => console.log(`\n${name}`);

const hadState = fs.existsSync(STATE);
if (hadState) fs.renameSync(STATE, BACKUP);
const restoreState = () => {
  if (fs.existsSync(STATE)) fs.unlinkSync(STATE);
  if (hadState) fs.renameSync(BACKUP, STATE);
};
process.on("exit", restoreState);
process.on("SIGINT", () => process.exit(130));

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 1280, height: 900 } });
// Freeze "today" at 2026-11-14 10:00 PT so countdowns are deterministic.
await ctx.addInitScript(() => {
  const fixed = new Date("2026-11-14T10:00:00-08:00").getTime();
  const RealDate = Date;
  Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", e => consoleErrors.push(e.message));

const api = (path, init = {}) => page.evaluate(async ([path, init]) => {
  const r = await fetch(`http://localhost:8000/api/v1/pipeline${path}`, {
    ...init, headers: { "Content-Type": "application/json", "X-TrojanConnect-Client": "web" },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, init]);
const state = async () => (await api("/state")).body.recognition;
const nextUp = () => page.getByTestId("next-action").innerText();
const waitSaved = pred => page.waitForFunction(pred, null, { timeout: 5000 }).catch(() => null);

section("1. Load and navigation");
await page.goto(APP);
await page.getByRole("tab", { name: "Event pipeline" }).waitFor();
ok(await page.getByLabel("Event waterfall").isVisible(), "event pipeline tab loads");
await page.getByRole("tab", { name: /RSO recognition/ }).click();
ok(await page.getByRole("heading", { name: "RSO recognition" }).isVisible(), "recognition tab loads");
ok((await page.getByTestId("application-deadline").innerText()).includes("8 days left"), "application countdown: 8 days left on Nov 14");
ok((await page.getByTestId("advisor-deadline").innerText()).includes("17 days left"), "advisor countdown: 17 days left");
ok((await nextUp()).includes("Choose your application pathway"), "next up starts at pathway");

section("2. Pathway guidance");
const pathway = page.getByLabel("Organization pathway");
await pathway.selectOption("fall_application");
await page.getByText("do not submit another application").first().waitFor();
ok(true, "fall applicant told not to resubmit");
ok((await nextUp()).includes("fall application"), "next up for fall applicant points to EngageSC");
await pathway.selectOption("fraternity_sorority");
await page.getByText("Office of Fraternity & Sorority Life process").waitFor();
ok(true, "FSL org rerouted");
ok(await page.getByLabel("Your EngageSC group page URL (optional)").count() === 0, "FSL hides EngageSC group URL field");
await pathway.selectOption("reestablishing");
await page.getByRole("link", { name: "Request officer access to an existing page" }).waitFor();
ok(await page.getByRole("link", { name: "Request officer access to an existing page" }).getAttribute("href") === "https://forms.gle/1ncsGH165vLibRWc8", "re-establishing shows officer-access form");
ok(await page.getByRole("link", { name: "Request re-establishment after a lapse" }).first().isVisible(), "re-establishing shows re-establishment form");
await pathway.selectOption("new");
await page.getByRole("link", { name: "Find or register an RSO in EngageSC" }).waitFor();
ok(await page.getByRole("link", { name: "Find or register an RSO in EngageSC" }).getAttribute("href") === "https://engage.usc.edu/club_signup", "new RSO links to EngageSC directory");
ok((await state()).pathway === "new", "pathway persisted to backend");

section("3. EngageSC handoff URL");
const urlField = page.getByLabel("Your EngageSC group page URL (optional)");
await urlField.fill("https://evil.example/phish");
await urlField.blur();
const alert = page.locator("[role=alert]").filter({ hasText: "engage.usc.edu" });
await alert.waitFor({ timeout: 5000 }).catch(() => {});
ok(await alert.isVisible(), "non-EngageSC URL shows visible error");
ok((await state()).engageGroupUrl === "", "rejected URL not saved");
await urlField.fill("https://engage.usc.edu/trojan-robotics/");
await urlField.blur();
await waitSaved(() => [...document.querySelectorAll("a")].some(a => a.href === "https://engage.usc.edu/trojan-robotics/"));
const portal = page.getByRole("link", { name: "Open your EngageSC group page" }).first();
ok(await portal.getAttribute("href") === "https://engage.usc.edu/trojan-robotics/", "valid URL becomes the portal button");
ok(await portal.getAttribute("target") === "_blank" && (await portal.getAttribute("rel")).includes("noopener"), "portal opens in new tab with noopener");
ok(!(await alert.isVisible()), "error cleared after valid save");

section("4. Roster counts");
const members = page.getByLabel("Additional student members entered");
await members.fill("3"); await members.blur();
await waitSaved(() => document.body.innerText.includes("Add at least 2 more"));
ok(await page.getByText("Add at least 2 more additional student member(s)").isVisible(), "3 members → asks for 2 more");
ok((await nextUp()).includes("five additional student members"), "next up asks for members");
await members.fill("2.5"); await members.blur();
ok(await page.getByText("Enter a whole number from 0 to 1000.").isVisible(), "non-integer count rejected client-side");
await members.fill("6"); await members.blur();
await waitSaved(() => !document.body.innerText.includes("more additional student member"));
ok((await state()).additionalMemberCount === 6, "member count saved");

section("5. Organization preparation + next-up progression");
const prepIds = ["group-details", "roster-entered", "submitter-designated", "constitution", "accountability", "organization-details"];
ok((await nextUp()).includes("Update the EngageSC group details"), "next up = first unchecked prep item");
// constitution was pre-checked via API test? clean state, so check them all
for (const id of prepIds) {
  const box = page.locator(`#recognition-${id}`);
  if (!(await box.isChecked())) await box.check();
}
await waitSaved(() => document.querySelector("[data-testid=next-action]")?.innerText.includes("officer document"));
ok((await nextUp()).includes("Collect 15 outstanding officer documents"), "next up moves to officer documents");
await page.getByRole("button", { name: "Go to step" }).click();
await page.waitForTimeout(600);
ok(await page.locator("#officers-heading").isVisible(), "Go to step scrolls to officer matrix");

section("6. Officer matrix + reminders");
await page.getByRole("button", { name: "Copy reminder for Treasurer" }).click();
const treasurerMsg = await page.evaluate(() => navigator.clipboard.readText());
ok(treasurerMsg.includes("treasurer") && treasurerMsg.includes("usc.prevent.zone") && treasurerMsg.includes("Nov 22"), "per-officer reminder copied with links + deadline");
ok(await page.getByRole("button", { name: "Copied ✓" }).isVisible(), "copy confirmation shown");
const officers = ["President", "Vice president", "Secretary", "Treasurer", "Programming chair"];
const reqs = ["Commitment to Community", "Hazing Prevention 101 certificate", "RSO Officer Learning Path certificate"];

for (const o of officers) for (const r of reqs) {
  if (o === "Programming chair" && r === "RSO Officer Learning Path certificate") continue;
  await page.getByLabel(`${o}: ${r} received`, { exact: true }).check();
}
await waitSaved(() => document.body.innerText.includes("4/5 officers complete"));
ok(await page.getByText("4/5 officers complete").isVisible(), "14 receipts → 4/5 officers complete");
await page.getByRole("button", { name: "Copy reminders for 1 officer" }).click();
const allMsg = await page.evaluate(() => navigator.clipboard.readText());
ok(allMsg.includes("— Programming chair —") && allMsg.includes("Learning Path") && !allMsg.includes("Hazing"), "bulk reminder lists only what's missing");
ok(await page.getByText("1 officer document receipt(s) still need to be checked off.").isVisible(), "readiness blocked by 1 missing receipt");
await page.getByLabel("Programming chair: RSO Officer Learning Path certificate received", { exact: true }).check();
await waitSaved(() => document.body.innerText.includes("Local preparation requirements are checked off"));
ok(await page.getByText("Local preparation requirements are checked off").isVisible(), "all 15 receipts → ready (with 0 accepted positions)");
ok((await state()).acceptedPositionCount === 0, "readiness does not wait on position acceptances");
ok((await nextUp()).includes("Upload everything and submit in EngageSC"), "next up = submit in EngageSC");
const off = (await state()).officers;
ok(Object.values(off).every(o => Object.values(o).every(Boolean)), "all 15 officer receipts persisted");

section("7. Advisor lane (separate)");
await page.getByRole("button", { name: "Copy advisor instructions" }).click();
const advisorMsg = await page.evaluate(() => navigator.clipboard.readText());
ok(advisorMsg.includes("Dec 1, 2026") && advisorMsg.includes("forms.gle/C7h9eSXxyisopTjk8") && advisorMsg.includes("Clery"), "advisor packet copied with deadline, form, Clery note");
for (const id of ["advisor-eligibility", "advisor-position", "advisor-training", "advisor-commitment", "clery-training"]) {
  await page.locator(`#recognition-${id}`).check();
}
await page.waitForTimeout(400);
const s7 = await state();
ok(["advisor-eligibility", "advisor-training", "clery-training"].every(k => s7.checks[k]), "advisor checks saved in general checks");
ok(Object.keys(s7.officers).length === 5, "advisor not mixed into officer matrix");
ok(await page.getByText("Local preparation requirements are checked off").isVisible(), "advisor items don't change application readiness");

section("8. Status + reload persistence");
const status = page.getByLabel("Application status (update after checking EngageSC)");
await status.selectOption("requires_modifications");
await waitSaved(() => document.querySelector("[data-testid=next-action]")?.innerText.includes("modifications"));
ok((await nextUp()).includes("Make the modifications"), "Requires Modifications → next up explains only submitter can edit");
ok(await page.getByRole("tab", { name: /RSO recognition/ }).innerText().then(t => t.includes("action")), "tab badge shows 'action'");
await page.reload();
await page.getByRole("tab", { name: /RSO recognition/ }).click();
ok(await page.getByLabel("Application status (update after checking EngageSC)").inputValue() === "requires_modifications", "status persists after reload");
ok(await page.getByLabel("Organization pathway").inputValue() === "new", "pathway persists after reload");
ok(await page.getByLabel("Treasurer: Commitment to Community received", { exact: true }).isChecked(), "officer receipts persist after reload");
await page.getByLabel("Application status (update after checking EngageSC)").selectOption("pending_approval");
await waitSaved(() => document.body.innerText.includes("Watch email"));
ok(await page.getByRole("tab", { name: /RSO recognition/ }).innerText().then(t => t.includes("pending")), "pending status badge");

section("9. Bad requests fail visibly and don't alter state");
const before = JSON.stringify(await state());
for (const [path, json, code] of [
  ["/recognition/progress", { check: "eligibility", value: true }, 400],
  ["/recognition/officer-progress", { role: "member", requirement: "commitment", value: true }, 422],
  ["/recognition/officer-progress", { role: "president", requirement: "cpr", value: true }, 422],
  ["/recognition/status", { status: "submitted" }, 422],
]) {
  const r = await api(path, { method: "PUT", body: JSON.stringify(json) });
  ok(r.status === code, `${path} ${JSON.stringify(json)} → ${code}`, `(got ${r.status})`);
}
ok(JSON.stringify(await state()) === before, "state unchanged after bad requests");
// Simulate a failed save in the UI: block the API once and toggle a box.
await page.route("**/recognition/progress", r => r.fulfill({ status: 500, contentType: "application/json", body: '{"detail":"Simulated save failure"}' }), { times: 1 });
const followUp = page.locator("#recognition-follow-up");
await followUp.check();
await page.getByText("Simulated save failure").waitFor({ timeout: 5000 }).catch(() => {});
ok(await page.getByText("Simulated save failure").isVisible(), "failed save shows error banner");
ok(!(await followUp.isChecked()), "optimistic checkbox rolled back on failure");

section("10. Event reset isolation");
await api("/reset", { method: "POST" });
const afterReset = await state();
ok(afterReset.pathway === "new" && afterReset.applicationStatus === "pending_approval" && afterReset.officers.president.commitment, "event reset keeps recognition state");

section("11. EngageSC link from the event pipeline");
await page.reload();
await page.getByRole("tab", { name: "Event pipeline" }).click();
await page.getByLabel("Event waterfall").getByRole("button", { name: /^5 EngageSC event/ }).click();
const note = page.getByTestId("engage-recognition-note");
await note.waitFor();
ok((await note.innerText()).includes("Pending Approval"), "EngageSC event step shows recognition status");
await note.getByRole("button", { name: "Open RSO recognition" }).click();
ok(await page.getByRole("heading", { name: "RSO recognition" }).isVisible(), "button jumps to recognition tab");
await page.getByLabel("Application status (update after checking EngageSC)").selectOption("recognized");
await page.waitForTimeout(300);
await page.getByRole("tab", { name: "Event pipeline" }).click();
await page.getByLabel("Event waterfall").getByRole("button", { name: /^5 EngageSC event/ }).click();
ok((await page.getByTestId("engage-recognition-note").innerText()).includes("Recognized"), "event step reflects Recognized");
if (SHOTS) await page.screenshot({ path: `${SHOTS}/engage-step.png`, fullPage: false });

section("12. Deadline passed");
const late = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await late.addInitScript(() => {
  const fixed = new Date("2026-11-23T09:00:00-08:00").getTime();
  const RealDate = Date;
  Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
});
const lp = await late.newPage();
await api("/recognition/status", { method: "PUT", body: JSON.stringify({ status: "draft" }) });
await lp.goto(APP);
await lp.getByRole("tab", { name: /RSO recognition/ }).click();
ok((await lp.getByTestId("application-deadline").innerText()).includes("closed"), "countdown shows closed after Nov 22");
ok(await lp.getByText("USC does not accept late applications. Contact").first().isVisible(), "late warning shown for unsubmitted draft");
await late.close();

section("13. Mobile layout (390px)");
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("tab", { name: /RSO recognition/ }).click();
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 0, "no horizontal page scroll at 390px", `(overflow ${overflow}px)`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/recognition-mobile.png`, fullPage: true });
await page.setViewportSize({ width: 1280, height: 900 });
if (SHOTS) await page.screenshot({ path: `${SHOTS}/recognition-desktop.png`, fullPage: true });

section("14. Console");
const relevant = consoleErrors.filter(e => !e.includes("Simulated save failure") && !e.includes("status of 500") && !e.includes("status of 400") && !e.includes("status of 422"));
ok(relevant.length === 0, "no unexpected console errors", relevant.join(" | "));

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
