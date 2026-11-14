// Constants/helpers for the USC form pre-fillers. Field requirements and UI rules live in
// frontend/src/lib/pipeline/plan.ts; keep the URLs below in sync with it.

export const FORM_URLS = {
  tcc: 'https://scevents.wufoo.com/forms/p11ku1c01p5kpxf/',
  outdoor: 'https://scevents.wufoo.com/forms/q1ofqron0clb1tz/',
  classroom: 'https://usccampusactivities.wufoo.com/forms/classroom-space-request-form/',
  eeRoom: 'https://ee.usc.edu/info/conference_rooms/',
  permit: 'https://usc-its.my.site.com/eventpermits/s/request-submission',
};

export function digits(v) { return String(v ?? '').replace(/\D/g, ''); }

// "18:30" -> "6:30 PM"
export function to12h(t) {
  if (!t) return '';
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}
