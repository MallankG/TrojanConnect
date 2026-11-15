// Label-driven filler for Wufoo forms (TCC, Outdoor, Classroom). Finds the visible <li> whose
// label matches, works out what kind of control it holds, and sets it. Never clicks Submit.

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

export function makeWufoo(page, log) {
  // One in-page query instead of per-<li> locator waits (sections without a label would
  // otherwise each burn the full default timeout).
  async function findLi(labelRx) {
    const idx = await page.evaluate(([src, flags]) => {
      const rx = new RegExp(src, flags);
      const lis = [...document.querySelectorAll('form li[id*="li"]')];
      return lis.findIndex(li => {
        const l = li.querySelector('label.desc, legend');
        return !!l && li.offsetParent !== null && rx.test(l.innerText.replace(/\s+/g, ' ').trim());
      });
    }, [labelRx.source, labelRx.flags]);
    return idx < 0 ? null : page.locator('form li[id*="li"]').nth(idx);
  }

  async function set(labelRx, value, { optional = false } = {}) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return false;
    const li = await findLi(labelRx);
    if (!li) { if (!optional) log(`  · not shown on this page: ${labelRx.source.slice(0, 60)}`); return false; }

    const radios = li.locator('input[type=radio]');
    const checks = li.locator('input[type=checkbox]');
    const selects = li.locator('select');
    const texts = li.locator('input[type=text], input[type=email], input[type=tel], input[type=number], input:not([type])');
    const area = li.locator('textarea');

    const pickByLabel = async (inputs, want) => {
      const n = await inputs.count();
      const wants = (Array.isArray(want) ? want : [want]).map(w => (w instanceof RegExp ? w : new RegExp('^\\s*' + String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')));
      let hit = 0;
      for (let i = 0; i < n; i++) {
        const inp = inputs.nth(i);
        const lab = norm(await inp.evaluate(e => e.labels?.[0]?.innerText || e.value));
        if (wants.some(w => w.test(lab))) { if (!(await inp.isChecked())) await inp.check({ force: true }); hit++; }
      }
      return hit;
    };

    if (await radios.count()) {
      const hit = await pickByLabel(radios, value);
      if (!hit) log(`  · no radio option matching "${value}" for ${labelRx.source.slice(0, 40)}`);
      // "Yes, platform or method:" style fields carry a text box too.
      if (typeof value === 'object' && value.text && await texts.count()) await texts.first().fill(value.text);
      return !!hit;
    }
    if (await checks.count()) {
      const hit = await pickByLabel(checks, value);
      if (!hit) log(`  · no checkbox matching ${JSON.stringify(value)} for ${labelRx.source.slice(0, 40)}`);
      return !!hit;
    }

    const nText = await texts.count();
    const maxes = [];
    for (let i = 0; i < nText; i++) maxes.push(+(await texts.nth(i).getAttribute('maxlength')) || 0);

    // Time: hh [mm] [ss] + AM/PM select
    if (await selects.count() && nText >= 1 && maxes.every(m => m === 2) && /^\d{1,2}:\d{2}$/.test(value)) {
      let [h, m] = value.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
      const parts = [String(h).padStart(2, '0'), String(m).padStart(2, '0'), '00'];
      // Wufoo time fields carry a hidden seconds box ("hideSeconds"); only fill visible ones.
      for (let i = 0; i < nText; i++) if (await texts.nth(i).isVisible()) await texts.nth(i).fill(parts[i]);
      await selects.first().selectOption({ label: ap });
      return true;
    }
    // Plain select: match by option text (prefix or contains)
    if (await selects.count() && !nText) {
      const opts = await selects.first().evaluate(s => [...s.options].map(o => ({ v: o.value, t: o.text })));
      const want = String(value).toLowerCase();
      const o = opts.find(o => o.t.toLowerCase() === want) || opts.find(o => o.t.toLowerCase().startsWith(want)) || opts.find(o => o.t.toLowerCase().includes(want));
      if (!o) { log(`  · no option "${value}" for ${labelRx.source.slice(0, 40)}`); return false; }
      await selects.first().selectOption(o.v);
      return true;
    }
    // Phone: 3-3-4
    if (nText === 3 && maxes.join() === '3,3,4') {
      const d = String(value).replace(/\D/g, '');
      await texts.nth(0).fill(d.slice(0, 3)); await texts.nth(1).fill(d.slice(3, 6)); await texts.nth(2).fill(d.slice(6, 10));
      return true;
    }
    // Date: MM DD YYYY
    if (nText === 3 && maxes.join() === '2,2,4' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split('-');
      await texts.nth(0).fill(m); await texts.nth(1).fill(d); await texts.nth(2).fill(y);
      return true;
    }
    // Name: First / Last
    if (nText === 2 && typeof value === 'object') {
      await texts.nth(0).fill(value.first || ''); await texts.nth(1).fill(value.last || '');
      return true;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && nText === 1) { const [y, m, d] = value.split('-'); await texts.first().fill(`${m}/${d}/${y}`); return true; }
    if (await area.count()) { await area.first().fill(String(value)); return true; }
    if (nText) { await texts.first().fill(String(value)); return true; }
    log(`  · could not fill ${labelRx.source.slice(0, 40)}`);
    return false;
  }

  async function next() {
    const btn = page.locator('form [name=nextPageButton]');
    if (!(await btn.count())) return false;
    const before = await page.locator('form').getAttribute('class');
    await btn.click();
    await page.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(1200);
    const errs = await page.locator('form li.error label.desc').allInnerTexts().catch(() => []);
    if (errs.length) { log(`  ! form says these need attention: ${errs.map(norm).join(' | ')}`); return false; }
    return (await page.locator('form').getAttribute('class')) !== before;
  }

  async function highlightSubmit() {
    await page.evaluate(() => {
      const b = document.querySelector('form [name=saveForm], form input[type=submit], form button[type=submit]');
      if (b) { b.style.outline = '4px solid #e8a33d'; b.style.outlineOffset = '4px'; b.scrollIntoView({ block: 'center' }); }
    }).catch(() => {});
  }

  return { set, next, findLi, highlightSubmit };
}
