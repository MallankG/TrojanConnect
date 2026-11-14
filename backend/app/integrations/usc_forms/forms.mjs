// One pre-filler per form. Each fills from the event profile and STOPS before Submit,
// leaving the browser open for a human to review and press the final button.
import { makeWufoo } from './wufoo.mjs';
import { FORM_URLS, to12h, digits } from './shared.mjs';

const yn = b => (b ? 'Yes' : 'No');
const fullName = P => `${P.firstName} ${P.lastName}`;

// ---------------- TCC meeting room ----------------
async function tcc(page, P, _d, log) {
  const w = makeWufoo(page, log);
  await page.goto(FORM_URLS.tcc);
  log('Contact information');
  await w.set(/^Sponsoring Organization/, P.orgName);
  await w.set(/^Organization Type/, 'Recognized USC Student Organization');
  await w.set(/^Primary Contact Name/, fullName(P));
  await w.set(/^Primary Contact Cell Phone/, P.phone);
  await w.set(/^Primary Contact Email/, P.email);
  await w.set(/E-Board Officer of your RSO/, 'Yes');
  await w.set(/E-Board Officer Position/, P.eboardPosition);
  await w.set(/Responsible RSO E-Board Officer Name/, fullName(P));
  await w.set(/E-Board Contact Email/, P.email);
  await w.set(/E-Board Contact Cell Phone/, P.phone);
  log('Date & times');
  await w.set(/single date or multiple dates/, 'Single date');
  await w.set(/Date #1/, P.date);
  await w.set(/weekly re-occurring/, 'No');
  await w.set(/^Meeting Name/, P.eventName);
  await w.set(/^Meeting Description/, P.description);
  await w.set(/Set Up \(Reservation\) Start Time/, P.setupTime || P.startTime);
  await w.set(/^Meeting Start Time/, P.startTime);
  await w.set(/^Meeting End Time/, P.endTime);
  await w.set(/Tear Down time/, P.teardownTime || P.endTime);
  await w.set(/accept an alternative location/, yn(P.acceptAlternate));
  await w.set(/^Expected Attendance/, String(P.attendance));
  log('Location');
  await w.set(/Are you trying to book/, 'One Room');
  const room = (P.venueChoice1 || '').replace(/^TCC\s*/i, 'TCC ');
  await w.set(/first choice location/, room);
  if (P.venueChoice2) await w.set(/second choice location/, P.venueChoice2.replace(/^TCC\s*/i, 'TCC '), { optional: true });
  await w.set(/select all rooms that you are requesting/, new RegExp('^' + room.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  log('Set-up, AV, extras');
  await w.set(/request additional furniture/, 'No');
  await w.set(/request Audio Visual Equipment/, 'No');
  await w.set(/panel discussion/, 'No');
  await w.set(/serving food and\/or beverages/, yn(P.food));
  if (P.food) {
    const prov = /Private Events/.test(P.catererType) ? 'USC Private Events' : /Retail|Club/.test(P.catererType) ? 'USC Catering TO-GO' : 'Other';
    await w.set(/Who will be providing the food/, prov);
    await w.set(/Name of other food/, P.catererName, { optional: true });
    await w.set(/Description of Food and Beverage/, P.menu);
  }
  await w.set(/Special Attendees/, 'No');
  await w.set(/free to all attendees/, 'Yes');
  await w.set(/healthcare related/, 'No');
  await w.set(/fundraising/, 'No');
  await w.set(/serve alcohol/, 'No');
  await w.set(/filmed or photographed/, yn(P.filmed));
  await w.set(/Marketing your event/, P.marketingPlatform ? 'Yes' : 'No');
  if (P.marketingPlatform) await page.locator('li:has(label.desc:text-matches("Marketing your event","i")) input[type=text]').first().fill(P.marketingPlatform).catch(() => {});
  await w.set(/co-sponsored by another/, 'No');
  await w.set(/involve Minors/, 'No');
  await w.set(/Anything else we should know/, 'N/A');
  await w.highlightSubmit();
  log('✔ Filled. Review every answer, tick "I agree" yourself, then press Submit.');
}

// ---------------- Outdoor venue ----------------
async function outdoor(page, P, _d, log) {
  const w = makeWufoo(page, log);
  await page.goto(FORM_URLS.outdoor);
  await w.set(/^Date #1/, P.date);
  await w.set(/^Sponsoring Organization/, P.orgName);
  await w.set(/^Organization Type/, 'Recognized Student Organization');
  await w.set(/^First Contact Name/, fullName(P));
  await w.set(/^Cell Phone \*/, P.phone);
  await w.set(/^Email \*/, P.email);
  if (P.secondaryName) { await w.set(/^Second Contact Name/, P.secondaryName, { optional: true }); }
  await w.set(/Will this event be co-sponsored/, 'No');
  await w.set(/^Setup Start Time/, P.setupTime || P.startTime);
  await w.set(/^Event Start Time/, P.startTime);
  await w.set(/^Event End Time/, P.endTime);
  await w.set(/^Tear Down/, P.teardownTime || P.endTime);
  await w.set(/single venue or multiple venues/, 'One venue');
  await w.set(/venue location\(s\) you would like to reserve/, new RegExp(String(P.venueChoice1).split(/[ (]/)[0], 'i'));
  await w.set(/accept an alternate location/, yn(P.acceptAlternate));
  await w.set(/^Event Name/, P.eventName);
  await w.set(/^Event Type/, P.eventType === 'Other' ? 'Meeting' : P.eventType);
  await w.set(/^Description of Event/, P.description);
  await w.set(/happened at USC before/, 'No');
  await w.set(/^Event Setup Details/, 'Venue used as-is; no rentals.');
  await w.set(/^Event Timeline/, `${to12h(P.setupTime)} setup · ${to12h(P.startTime)} start · ${to12h(P.endTime)} end · ${to12h(P.teardownTime)} cleanup complete`);
  await w.set(/include props/, 'No');
  await w.set(/renting or setting up any of the listed equipment/, /None/);
  await w.set(/Total Expected Attendance/, String(P.attendance));
  await w.set(/how many will be minors/, '0');
  await w.set(/selling anything/, 'No');
  await w.set(/Will you be fundraising/, 'No');
  await w.set(/serving food or beverages/, yn(P.food));
  await w.set(/bringing food trucks/, yn(/Truck/.test(P.catererType || '')));
  await w.set(/serving alcohol/, 'No');
  await w.set(/filming your event/, yn(P.filmed));
  await w.set(/Special Attendees/, 'No');
  await w.set(/healthcare related/, 'No');
  await w.set(/amplified sound or musical/, yn(P.amplifiedSound));
  await w.set(/Which items would you like to request/, /I do not need/);
  await w.set(/marketing your event/, P.marketingPlatform ? 'Yes' : 'No');
  await w.highlightSubmit();
  log('✔ Filled. Review, tick "I agree" yourself, then Submit. Remember: TES wants this 6 weeks ahead.');
}

// ---------------- Classroom (8 pages) ----------------
async function classroom(page, P, _d, log) {
  const w = makeWufoo(page, log);
  await page.goto(FORM_URLS.classroom);
  const dow = new Date(P.date + 'T12:00').getDay(); // 0 Sun..6 Sat
  const weekend = dow === 0 || dow === 6;
  log('Page 1: intro');
  await w.next();
  log('Page 2: organization & contact');
  await w.set(/organization name exactly as it appears/, P.orgName);
  await w.set(/^Name/, { first: P.firstName, last: P.lastName });
  await w.set(/^Cell Phone Number/, P.phone);
  await w.set(/^Email/, P.email);
  await w.set(/^Input your initials here\. By inputting your initials, you certify/, P.initials);
  if (!(await w.next())) return log('Stopped on page 2. Fix the highlighted fields in the browser.');
  log('Page 3: reservation info');
  await w.set(/^Meeting or Event Name/, P.eventName);
  await w.set(/^Meeting or Event Description/, P.description);
  await w.set(/^Event Type/, /Meeting|Lecture|Conference|Other/.test(P.eventType) ? 'Meeting' : P.eventType);
  await w.set(/^Expected Attendance/, String(P.attendance));
  await w.set(/weekend or weekday/, weekend ? 'Weekend' : 'Weekday');
  await w.set(/open enrollment period/, P.initials);
  if (!(await w.next())) return log('Stopped on page 3. Fix the highlighted fields in the browser.');
  log(`Page: ${weekend ? 'weekend' : 'weekday'} date request`);
  await w.set(/single date or a range of dates/, 'Single Date');
  await w.set(/^Date #1/, P.date);
  await w.set(/^Start Time/, to12h(P.startTime));
  await w.set(/^End Time/, to12h(P.endTime));
  if (!(await w.next())) return log('Stopped on the date page. Check the start/end times against the classroom rules.');
  log('Page: location');
  await w.set(/Are you trying to book/, 'One Room', { optional: true });
  const [bldg, rm] = String(P.venueChoice1 || '').toUpperCase().split(/\s+/);
  if (bldg) {
    await w.set(/first choice location/, `[${bldg}]`.replace(/[[\]]/g, ''), { optional: true });
    const li = await w.findLi(new RegExp(`\\[${bldg}\\]`));
    if (li && rm) {
      const sel = li.locator('select').first();
      const opts = await sel.evaluate(s => [...s.options].map(o => ({ v: o.value, t: o.text })));
      const o = opts.find(o => o.t.startsWith(rm + ' '));
      if (o) await sel.selectOption(o.v); else log(`  · room ${rm} not offered in ${bldg}`);
    }
  }
  if (!(await w.next())) return log('Stopped on the location page.');
  log('Final page: AV & policies');
  await w.set(/expected audience/, (P.audience || ['Students']).map(a => a === 'Students' ? 'USC Students' : /Faculty|Staff/.test(a) ? 'USC Staff/Faculty' : 'Other'));
  await w.set(/amplified sound/, yn(P.amplifiedSound));
  await w.set(/25 or more people/, yn(+P.attendance >= 25));
  await w.set(/funded by Undergraduate or Graduate Student Government/, 'No');
  await w.highlightSubmit();
  log('✔ Filled through the last page. Tick both "I agree" boxes yourself, review, then Submit.');
  if (+P.attendance >= 25 || P.food) log('ℹ This event needs a USC Event Permit (25+ people or food).');
}

// ---------------- ECE conference rooms (EEB / PHE) ----------------
async function eeRoom(page, P, _d, log) {
  const room = String(P.venueChoice1 || '').toUpperCase().replace(/\s+/, '_');
  await page.goto(`https://ee.usc.edu/info/conference_rooms/room_schedule.php?room=${room}`);
  const src = await page.locator('iframe').first().getAttribute('src').catch(() => null);
  if (!src) return log(`Could not find a schedule for "${P.venueChoice1}". Use e.g. "EEB 248" or "PHE 223".`);
  await page.goto(src);
  await page.getByText('Click Here To Make A Request To Use This Conference Room.').click();
  await page.waitForLoadState('load');
  const f = page.locator('form');
  await f.locator('[name=poilcy]').check().catch(() => {});
  await f.locator('[name=room_space_name]').fill(P.venueChoice1).catch(() => {});
  await f.locator('[name=attendees]').selectOption(String(Math.min(+P.attendance, 100))).catch(() => log('  · attendee count not in dropdown; set it manually'));
  const [y, m, d] = P.date.split('-');
  await f.locator('[name=event_date]').fill(`${m}/${d}/${y}`).catch(() => {});
  await f.locator('[name=event_start_time]').selectOption({ label: to12h(P.startTime) }).catch(() => log('  · start time must be on the hour/half hour'));
  await f.locator('[name=event_end_time]').selectOption({ label: to12h(P.endTime) }).catch(() => log('  · end time must be on the hour/half hour'));
  await f.locator('[name=name]').fill(fullName(P));
  await f.locator('[name=email]').fill(P.email);
  await f.locator('[name=telephone]').fill(P.phone);
  await f.locator('[name=dept]').selectOption({ label: 'Other Viterbi Department' }).catch(() => {});
  await f.locator('[name=event_title]').fill(P.eventName);
  await f.locator('[name=event_description]').fill(`${P.description}\n\nOrganization: ${P.orgName}${P.food ? `\nFood: ${P.catererName}` : ''}`);
  log('✔ Filled. Check the policy box and department, then Submit.');
}

// ---------------- USC Event Permit (Salesforce flow) ----------------
async function permit(page, P, D, log) {
  if (!/^\d{6}$/.test(D.reservationNumber || '')) return log('✖ Needs the 6-digit venue reservation number first (enter it on the Venue step).');
  await page.goto(FORM_URLS.permit);
  await page.waitForLoadState('networkidle').catch(() => {});
  const stage = async () => ((await page.locator('body').ariaSnapshot()).match(/listitem: (.*?) - Current Stage/) || [])[1] || '?';
  const sel = async (name, label) => {
    const c = page.getByRole('combobox', { name: new RegExp('^\\*?' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
    if (!(await c.count())) return log(`  · not shown: ${name}`);
    await c.selectOption({ label }).catch(async () => {
      const opts = await c.evaluate(e => [...e.options].map(o => o.text));
      const o = opts.find(o => o.toLowerCase().includes(String(label).toLowerCase()));
      if (o) await c.selectOption({ label: o }); else log(`  · option "${label}" not in ${name}`);
    });
    await page.waitForTimeout(350);
  };
  const txt = async (name, v) => { if (v === undefined || v === '') return; const t = page.getByRole('textbox', { name, exact: true }).or(page.getByRole('spinbutton', { name, exact: true })).first(); if (await t.count()) await t.fill(String(v)); else log(`  · not shown: ${name}`); };
  const fmtDate = s => new Date(s + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const dt = async (group, date, time) => {
    const g = page.getByRole('group', { name: group });
    await g.getByRole('textbox', { name: 'Date' }).fill(fmtDate(date));
    const tc = g.getByRole('combobox', { name: 'Time' });
    await tc.click(); await page.waitForTimeout(200);
    await g.getByRole('option', { name: to12h(time), exact: true }).click({ force: true }).catch(() => log(`  · pick ${to12h(time)} for ${group} manually`));
    await page.keyboard.press('Tab');
  };
  const nextStage = async () => {
    const s = await stage();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(3000);
    const now = await stage();
    if (now === s) { log(`  ! stuck on "${s}". Fix the highlighted field in the browser, then continue by hand.`); return false; }
    return true;
  };
  const isEvent = +P.attendance >= 25 || P.food;
  const outdoorVenue = P.venueKind === 'outdoor';

  log('Stage 1: Initial information');
  await sel('Has the venue been reserved?', 'Yes');
  if (!(await nextStage())) return;

  log('Stage 2: Venue reservation');
  await sel('Gathering Type', isEvent ? 'Event/Gathering' : 'Meeting');
  await sel('Event Location', 'On Campus');
  await sel('Event Type', 'In-Person');
  await txt('Venue Reservation Number', D.reservationNumber);
  await txt('Venue Owner or Manager Name (Name of the person with who you requested the venue with)', D.venueContactName);
  await txt('Venue Contact Email Address', D.venueContactEmail);
  if (!(await nextStage())) return;

  log('Stage 3: Requester');
  await sel('Requester Type', 'Student (Internal)');
  await txt('Requester Name', fullName(P));
  await txt('Requester 10-Digit USC ID', P.uscId);
  await txt('Requester Email', P.email);
  await txt('Requester Mobile Contact Number', digits(P.phone));
  await txt('Onsite Contact Person Name (Day of Event)', P.onsiteName);
  await txt('Onsite Contact Person Mobile Phone Number', digits(P.onsitePhone));
  await txt('Secondary Contact Name', P.secondaryName);
  await txt('Secondary Contact Phone', digits(P.secondaryPhone));
  await txt('Secondary Contact Email', P.secondaryEmail);
  await sel('Type of Primary Event Organizer', 'Recognized Student Orgs');
  await txt('Primary Event Organizer Organization Name', P.orgName);
  await sel('Is this event being co-organized', 'No');
  await sel('Is this event Sponsored/Funded by Non-USC', 'No');
  if (!(await nextStage())) return;

  log('Stage 4: Event details');
  await txt('USC Permit Request Event Name', P.eventName);
  await txt('Event Description', P.description);
  await sel('Campus Location', outdoorVenue ? 'University Park Campus (UPC) Outdoor' : 'University Park Campus (UPC) Indoor');
  const venueOpt = P.venueKind === 'classroom' ? 'Classroom Space' : P.venueKind === 'tcc' ? (/35[012]/.test(P.venueChoice1) ? 'Tutor Campus Center (TCC) Rooms' : 'Other') : 'Other';
  await sel('Campus Venue', venueOpt);
  await dt('Event Start Date/Time', P.date, P.startTime);
  await dt('Event Setup Date/Time', P.date, P.setupTime || P.startTime);
  await dt('Event End Date/Time', P.date, P.endTime);
  await dt('Event Tear-Down Date/Time', P.date, P.teardownTime || P.endTime);
  await sel('Multiple Venues?', 'No');
  await sel('Event Sequence', 'Stand Alone Event');
  await sel('Do you expect your event to include marching', yn(P.amplifiedSound));
  await sel('Sporting Event', 'Not a Sporting Event');
  await sel('Social Dance?', 'No');
  if (!(await nextStage())) return;

  log('Stage 5: Audience');
  await txt('Expected Number of Attendees', Math.min(+P.attendance, 60)); // walkthrough rule
  for (const a of P.audience || ['Students']) await page.locator(`label:has-text("${a}")`).first().click().catch(() => {});
  for (const q of ['Reservations Required to Attend?', 'Paid Admission?', 'Private Event/Invite Only?', 'Are there Special Attendees?', 'Does your event have security needs?', 'Oversized Vehicles Access?', 'Is there any External Advertising?', 'Will the Event be Asking for Donations?', 'Is the Event a Fundraiser?', 'Are you planning to have products', 'Are you planning on giving away products']) await sel(q, 'No');
  await sel('On Campus Parking', 'Patrons are not expected to park on campus');
  if (!(await nextStage())) return;

  log('Stage 6: Vendors (walkthrough: NO to trash/waste)');
  for (const q of ['Will you be installing any type of large rentals', 'Non-USC Vendors?', 'Are there any Specialty activities', 'Does your event have live animals', 'Do you require Facilities Planning', 'Waste Management Services?', 'Do you want your event to be zero-waste?', 'Medical care or therapy', 'Outdoor Stage?', 'Outdoor Seating?', 'Outdoor Cooking or Heating', 'Booths and/or Tables?', 'Large tents', 'Are there any Props Used?', 'Are there any Special Effects?']) await sel(q, 'No');
  await sel('Amplified Sound?', yn(P.amplifiedSound));
  await sel('Electrical Service', 'Event will not require electrical power');
  if (!(await nextStage())) return;

  log('Stage 7: Food & beverage');
  await sel('Will Food and/or Beverages be Served?', yn(P.food));
  if (P.food) {
    await sel('Will Food be Sold?', 'No');
    await sel('Number of Caterer(s)', '1');
    await sel('Caterer Type', P.catererType);
    const nameBox = page.getByRole('combobox', { name: 'Select Caterer Name' });
    if (await nameBox.count()) {
      await nameBox.click(); await page.waitForTimeout(800);
      const opt = page.getByRole('option', { name: P.catererName });
      if (await opt.count()) await opt.first().click({ force: true });
      else log(`  ! "${P.catererName}" is not an approved caterer here. Choose "Vendor not on the List (One-Time Approval)"; health permit + insurance are due 2 weeks before the event.`);
    }
    await sel('Is your vendor driving onto campus?', 'No');
    await sel('Is your vender serving the food or beverages?', yn(P.vendorServes));
    await sel('Is your vendor cooking or preparing food onsite?', 'No');
    await txt('Booking or BEO number', '');
    await txt('Provide Menu Details', P.menu);
    await txt('Value of items served (in USD)', P.foodValue);
    await sel('Payment Type', P.paymentType || 'PO');
    await page.locator(`label:has-text("${P.vendorServes ? 'Caterer' : 'Self-serve'}")`).first().click().catch(() => {});
    await sel('Will Alcohol be Served?', 'No');
    await sel('Will Alcohol be Sold?', 'No');
  }
  if (!(await nextStage())) return;

  log('Stage 8: Media & filming');
  await sel('Will the event be filmed or photographed?', yn(P.filmed));
  await sel('Drone Photography?', 'No');
  await sel('Will Professional/Student Media/Press be Present?', 'No');
  if (!(await nextStage())) return;

  log('✔ Reached Acknowledgements. Read and tick ADA, Smoke-Free and Plastic yourself, review, then Submit. Save the permit code from the confirmation email.');
}

export const FILLERS = { tcc, outdoor, classroom, eeRoom, permit };
