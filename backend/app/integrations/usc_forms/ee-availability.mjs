// Reads the public EEB/PHE room calendars and reports bookings on a given date.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const EE_ROOMS = ['EEB 110', 'EEB 132', 'EEB 203', 'EEB 248', 'EEB 349', 'EEB 403', 'EEB 539', 'PHE 223', 'PHE 631'];

const toMin = s => { const m = s.trim().match(/(\d+):(\d+)\s*(am|pm)/i); if (!m) return null; let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12; return h * 60 + +m[2]; };

export async function eeAvailability(dateStr, start, end, rooms = EE_ROOMS) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const want = start && end ? [toMin(hm(start)), toMin(hm(end))] : null;
  const browser = await chromium.launch();
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
        await page.evaluate(([id, m, yy]) => window.change_month(id, m, yy), [room.replace(' ', ''), mo, y]);
        await page.waitForLoadState('load');
      }
      const bookings = await page.evaluate(day => {
        const cells = [...document.querySelectorAll('td')];
        const cell = cells.find(td => td.innerText.trim().split('\n')[0].trim() === String(day));
        if (!cell) return null;
        return cell.innerText.split('\n').slice(1).map(s => s.trim()).filter(s => /\d:\d\d/.test(s));
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
