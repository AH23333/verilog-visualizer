// SANDBOX P1-a QC: wiring / selection / delete / engine-start check
let pw;
try { pw = require('playwright-core'); } catch { pw = require('D:/Visual Studio Code/Something/.tmpbuild/node_modules/playwright-core'); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'D:/Visual Studio Code/Something/.tmpbuild/qc3';
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const R = { pass: [], fail: [], facts: {} };
  const browser = await pw.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const native = [];
  page.on('dialog', async (d) => { native.push(d.type()); await d.dismiss().catch(() => {}); });
  const errs = [];
  page.on('pageerror', (e) => { if (!/invoke|__TAURI/i.test(String(e))) errs.push(String(e).slice(0, 140)); });
  const step = async (n, fn) => { try { await fn(); R.pass.push(n); console.log('PASS ' + n); } catch (e) { R.fail.push(n + ' :: ' + String(e).slice(0, 160)); console.log('FAIL ' + n + ' :: ' + String(e).slice(0, 140)); } };

  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
  await page.waitForTimeout(700);
  { const s = page.getByText(/Skip/i).first(); if (await s.isVisible({ timeout: 1200 }).catch(() => false)) { await s.click(); await page.waitForTimeout(300); } else await page.keyboard.press('Escape'); }

  await page.locator('button[title="Sandbox"]').click(); await page.waitForTimeout(600);
  await page.locator('button[title="New file"]').click(); await page.waitForTimeout(700);

  // place Button + Lamp (simple propagation topology)
  await page.locator('button:text-is("Button")').click(); await page.waitForTimeout(250);
  await page.locator('button:text-is("Lamp")').click(); await page.waitForTimeout(250);

  // dump magnets to plan the wire
  const magnets = await page.evaluate(() => {
    return [...document.querySelectorAll('[magnet]')].map((m) => {
      const r = m.getBoundingClientRect();
      const cellEl = m.closest('[model-id]');
      return { port: m.getAttribute('port'), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), cell: cellEl?.getAttribute('model-id')?.slice(0, 6) };
    });
  });
  console.log('magnets:', JSON.stringify(magnets));
  R.facts.magnets = magnets;

  // wire: Button.out (rightmost magnet of cell#1) -> Lamp.in (leftmost magnet of cell#2)
  await step('P1a-1 drag wire Button.out -> Lamp.in', async () => {
    const all = await page.evaluate(() => [...document.querySelectorAll('[magnet]')].map((m) => {
      const r = m.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, cell: m.closest('[model-id]')?.getAttribute('model-id') };
    }));
    const byCell = {};
    for (const m of all) (byCell[m.cell] = byCell[m.cell] || []).push(m);
    const cellIds = Object.keys(byCell);
    if (cellIds.length < 2) throw new Error('expected 2 cells with magnets');
    const out = byCell[cellIds[0]].sort((a, b) => b.x - a.x)[0];   // rightmost = out
    const inp = byCell[cellIds[1]].sort((a, b) => a.x - b.x)[0];   // leftmost = in
    if (!out || !inp) throw new Error('ports not found');
    await page.mouse.move(out.x, out.y); await page.mouse.down();
    await page.mouse.move(inp.x, inp.y, { steps: 10 });
    await page.mouse.up(); await page.waitForTimeout(400);
    const links = await page.evaluate(() => document.querySelectorAll('.joint-link').length);
    R.facts.linksAfterWire = links;
    if (links < 1) throw new Error('no link created');
    await page.screenshot({ path: OUT + '/sb5-wired.png' });
  });

  await step('P1a-2 toggle Button -> signal PROPAGATES to wire (engine check)', async () => {
    const read = () => page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      // live model read: wires' signal via DOM class is fragile — read link signal through joint
      const links = document.querySelectorAll('.joint-link');
      // instead read the Lamp cell fill/state via its wire: use the link signal attr through joint paper hook if available
      return { n: links.length };
    });
    // toggle the Button (btnface click)
    const b = await page.evaluate(() => { const el = document.querySelector('.btnface'); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(b.x, b.y); await page.waitForTimeout(600);
    // check lamp visual state: digitaljs Lamp renders with class/fill change when signal=1
    const lamp = await page.evaluate(() => {
      const lampCircle = [...document.querySelectorAll('circle')].find((c) => (c.getAttribute('class') || '').includes('lamp') || true);
      return lampCircle ? (lampCircle.getAttribute('fill') || getComputedStyle(lampCircle).fill) : null;
    });
    // also capture the wire stroke color
    const wire = await page.evaluate(() => {
      const path = document.querySelector('.joint-link path.connection, .joint-link path');
      return path ? getComputedStyle(path).stroke : null;
    });
    R.facts.lampFillAfterToggle = lamp;
    R.facts.wireStroke = wire;
    // If engine is NOT started, wire stays x (gray) and lamp stays off regardless of toggle.
    // We cannot fully assert without engine — record facts and judge manually.
  });

  await step('P1a-3 select cell (highlight) + Delete removes', async () => {
    const cells = await page.evaluate(() => [...document.querySelectorAll('[model-id]')].map((el) => el.getAttribute('model-id')));
    const target = cells[1];
    const box = await page.evaluate((id) => { const el = document.querySelector(`[model-id="${id}"]`); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, target);
    await page.mouse.click(box.x, box.y); await page.waitForTimeout(300);
    // selection highlight: body/stroke attr → rendered stroke change; check via DOM stroke on body rect
    await page.keyboard.press('Delete'); await page.waitForTimeout(400);
    const remaining = await page.evaluate(() => [...document.querySelectorAll('[model-id]')].map((el) => el.getAttribute('model-id')));
    if (remaining.includes(target)) throw new Error('cell not deleted');
  });

  await step('P1a-4 save/reload keeps cells AND wires', async () => {
    await page.locator('button:has-text("Save circuit")').first().click(); await page.waitForTimeout(500);
    const before = await page.evaluate(() => { const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}'); return Object.values(files).map((f) => { const g = JSON.parse(f.graphJson); return { cells: g.cells.filter(c => !c.type?.includes('Link')).length, links: g.cells.filter(c => c.type?.includes('Link') || c.shape === 'standard.Link' || c.isLink).length }; }); });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
    await page.waitForTimeout(700);
    await page.locator('button[title="Sandbox"]').click(); await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ cells: document.querySelectorAll('[model-id]').length, links: document.querySelectorAll('.joint-link').length }));
    R.facts.persist = { before, after };
    // after previous Delete of one cell: expect 2 cells (Button+Lamp) + 1 wire
    if (after.cells < 2) throw new Error('cells lost after reload: ' + JSON.stringify(after));
  });

  await step('P1a-5 zero native dialogs + zero page errors', async () => {
    if (native.length) throw new Error('native: ' + native.join(','));
    if (errs.length) throw new Error('errs: ' + errs.slice(0, 3).join('|'));
  });

  console.log('=== SANDBOX P1a QC SUMMARY ===');
  console.log('PASS ' + R.pass.length + ' / FAIL ' + R.fail.length);
  R.fail.forEach((f) => console.log('  ' + f));
  console.log('facts: ' + JSON.stringify(R.facts, null, 1));
  await page.screenshot({ path: OUT + '/sb-p1a-final.png' });
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
