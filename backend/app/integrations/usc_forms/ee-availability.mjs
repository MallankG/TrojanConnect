// Reads the public EEB/PHE room calendars and reports bookings on a given date.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { browserOptions } from './shared.mjs';

export const EE_ROOMS = ['EEB 110', 'EEB 132', 'EEB 203', 'EEB 248', 'EEB 349', 'EEB 403', 'EEB 539', 'PHE 223', 'PHE 631'];

const toMin = s => { const m = s.trim().match(/(\d+):(\d+)\s*(am|pm)/i); if (!m) return null; let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12; return h * 60 + +m[2]; };

export async function eeAvailability(dateStr, start, end, rooms = EE_ROOMS) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const want = start && end ? [toMin(hm(start)), toMin(hm(end))] : null;
  const browser = await chromium.launch(browserOptions(chromium));
  const page = await browser.newPage();
  const out = [];
  try {
    for (const room of rooms) {
      await page.goto(`https://ee.usc.edu/info/conference_rooms/room_schedule.php?room=${room.replace(' ', '_')}`);
      const src = await page.locator('iframe').first().getAttribute('src');
      await page.goto(src);
      const cur = await page.evaluate(() => document.body.innerText.match(/\|\s*(\w+)\s+(\d{4})/)?.slice(1));
      const curMonth = cur ? new Date(`${cur[0]} 1, ${cur[1]}`).getMonth() + 1 : mo;
      if (cur && (curMonth !== mo || +cur[1] !== y)) {
        // change_month() submits a form (navigation), so trigger it async and wait for the new page.
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'load' }),
          page.evaluate(([id, m, yy]) => { setTimeout(() => window.change_month(id, m, yy), 0); }, [room.replace(' ', ''), mo, y]),
        ]);
      }
      // Layout-agnostic parse (the calendar renders as <table> or <div>s depending on the page):
      // a line that is just a number starts a day; following "h:mm am- h:mm pm : title" lines belong
      // to it. Day numbers restart at 1 for the trailing next-month cells, so stop there.
      const bookings = await page.evaluate(day => {
        const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean);
        let cur = null, seenFirst = false;
        const byDay = {};
        for (const l of lines) {
          if (/^\d{1,2}$/.test(l)) {
            const n = +l;
            if (n === 1 && seenFirst) break; // next month's spill-over
            if (n === 1) seenFirst = true;
            cur = seenFirst ? n : null;
            if (cur) byDay[cur] = [];
          } else if (cur && /\d:\d\d\s*[ap]m\s*-/i.test(l)) byDay[cur].push(l);
        }
        return seenFirst ? (byDay[day] ?? []) : null;
      }, d);
      const conflicts = (bookings || []).filter(b => {
        if (!want) return true;
        const [a, z] = b.split(' : ')[0].split('-').map(toMin);
        return a !== null && z !== null && a < want[1] && z > want[0];
      });
      out.push({ room, bookings: bookings || [], free: bookings !== null && conflicts.length === 0, conflicts });
    }
  } finally { await browser.close(); }
  return out;
}

function hm(t) { let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , date, s, e] = process.argv;
  console.log(JSON.stringify(await eeAvailability(date, s, e), null, 2));
}
