// Usage: node run.mjs <formId> <stateJsonPath> <browserProfileDir>
// Launched by the FastAPI event-pipeline workflow. Opens a visible Chromium window (persistent
// profile, so USC logins stick), pre-fills the form from the saved event, then waits for a human
// to review and submit. It never presses Submit itself.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { FILLERS } from './forms.mjs';
import { browserOptions } from './shared.mjs';

const [, , formId, statePath, profileDir] = process.argv;
const log = m => console.log(m);

if (!FILLERS[formId]) { log(`Unknown form "${formId}". Options: ${Object.keys(FILLERS).join(', ')}`); process.exit(2); }
if (!statePath || !profileDir) { log('Usage: node run.mjs <formId> <stateJsonPath> <browserProfileDir>'); process.exit(2); }

const state = JSON.parse(await readFile(statePath, 'utf8'));
const P = state.profile || {};
// Reservation # and venue contact are recorded on the venue step; permit code on the permit step.
const D = { ...(state.progress?.venue?.data || {}), ...(state.progress?.permit?.data || {}) };

const ctx = await chromium.launchPersistentContext(profileDir, { ...browserOptions(chromium), headless: false, viewport: null, args: ['--start-maximized'] });
const page = ctx.pages()[0] || await ctx.newPage();
page.setDefaultTimeout(15000);
try {
  log(`▶ Pre-filling: ${formId}`);
  await FILLERS[formId](page, P, D, log);
} catch (e) {
  log(`✖ ${e.message.split('\n')[0]}. Finish the rest by hand in the open window.`);
}
log('Browser stays open. Close the window when you are done.');
await new Promise(r => ctx.on('close', r));
log('■ Window closed.');
