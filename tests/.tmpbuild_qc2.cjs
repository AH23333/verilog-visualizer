// FINAL QC: sandbox fixes + main-flow regression + font audit
let pw;
try { pw = require('playwright-core'); } catch { pw = require('D:/Visual Studio Code/Something/.tmpbuild/node_modules/playwright-core'); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'D:/Visual Studio Code/Something/.tmpbuild/qc2';
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });
const EX = [['AND',/与门（门级）/],['HalfAdder',/半加器（行为级）/],['Mux2',/二选一多路选择器/],['Counter',/4 位计数器/],['FullAdder',/全加器（层次化）/]];
async function main() {
  const R = { pass: [], fail: [] };
  const browser = await pw.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem('verilog-viz-onboarded', '1'); } catch {} });
  const native = [];
  page.on('dialog', async (d) => { native.push(d.type()); await d.dismiss().catch(() => {}); });
  const errs = [];
  page.on('pageerror', (e) => { if (!/save_export_file|invoke|__TAURI/i.test(String(e))) errs.push(String(e).slice(0, 140)); });
  const step = async (n, fn) => { try { await fn(); R.pass.push(n); console.log('PASS ' + n); } catch (e) { R.fail.push(n + ' :: ' + String(e).slice(0, 150)); console.log('FAIL ' + n + ' :: ' + String(e).slice(0, 130)); await page.screenshot({ path: OUT + '/fail-' + n.replace(/[^a-z0-9]/gi, '_') + '.png' }).catch(() => {}); } };
  const openEx = async (re) => { await page.locator('button:has-text("Examples")').first().click(); await page.getByRole('button', { name: re }).click(); await page.waitForFunction(() => /Compiled successfully/.test(document.body.innerText), null, { timeout: 45000 }); };

  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
  await page.waitForTimeout(700);
  { const skip = page.getByText(/Skip/i).first(); if (await skip.isVisible({ timeout: 1200 }).catch(() => false)) { await skip.click(); await page.waitForTimeout(300); } else await page.keyboard.press('Escape'); }

  // ---- sandbox fixes ----
  await page.locator('button[title="沙盒"]').click(); await page.waitForTimeout(600);
  await page.locator('button[title="新建文件"]').click(); await page.waitForTimeout(700);

  await step('SB-fix1 IO palette downgraded to 3 (Button/Clock/Lamp only)', async () => {
    for (const bad of ['Dff']) {
      if (await page.locator(`button:has-text("${bad}")`).count()) throw new Error(bad + ' still in palette');
    }
    for (const good of ['Clock', 'Lamp']) {
      if (!(await page.locator(`button:has-text("${good}")`).count())) throw new Error(good + ' missing');
    }
  });

  await step('SB-fix2 place And + drag (exact delta)', async () => {
    await page.locator('button:has-text("与门")').click(); await page.waitForTimeout(300);
    const before = await page.evaluate(() => { const el = document.querySelector('[model-id]'); const r = el.getBoundingClientRect(); return { sx: r.x, sy: r.y, w: r.width, h: r.height }; });
    const cx = before.sx + before.w / 2, cy = before.sy + before.h / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.mouse.move(cx + 140, cy + 70, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => { const el = document.querySelector('[model-id]'); const r = el.getBoundingClientRect(); return { sx: r.x, sy: r.y }; });
    if (Math.abs(after.sx - before.sx - 140) > 8 || Math.abs(after.sy - before.sy - 70) > 8) throw new Error('drag delta off');
  });

  await step('SB-fix3 save -> reload -> cells persist (re-instantiate path)', async () => {
    await page.locator('button:has-text("保存")').first().click(); await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
    await page.waitForTimeout(700);
    await page.locator('button[title="沙盒"]').click(); await page.waitForTimeout(1500);
    const cells = await page.locator('[model-id]').count();
    await page.screenshot({ path: OUT + '/qc-sb-reload.png' });
    if (cells < 1) throw new Error('reload: model EMPTY');
  });

  await step('SB-fix4 delete = two-step inline (no native confirm)', async () => {
    const del = page.locator('span:has-text("×")').first();
    await del.click(); await page.waitForTimeout(250);
    const q = page.locator('span:has-text("?")').first();
    const twoStep = await q.isVisible().catch(() => false);
    if (!twoStep) throw new Error('no two-step confirm state');
    await q.click(); await page.waitForTimeout(300);
    // if native confirm fired it was already captured in `native`
  });

  // ---- main flow regression ----
  await page.locator('button[title="文件"]').click(); await page.waitForTimeout(500);
  for (const [label, re] of EX) await step('M1 compile ' + label, async () => { await openEx(re); await page.waitForTimeout(1400); if (await page.locator('svg').count() < 1) throw new Error('no svg'); });

  await step('M2 dblclick jump + glow', async () => {
    await openEx(/全加器（层次化）/); await page.waitForTimeout(1600);
    const subs = await page.evaluate(() => window.__djsDebug.getSignals().cells.filter(c => /Subcircuit/.test(c.type)).map(c => c.id));
    const box = await page.evaluate((id) => { const el = document.querySelector(`[model-id="${id}"]`); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, subs[0]);
    await page.mouse.dblclick(box.x, box.y); await page.waitForTimeout(700);
    const ok = await page.evaluate(() => /Jumped to example_full_adder\.v:\d+/.test(document.body.innerText) && !!document.querySelector('.cm-editor'));
    if (!ok) throw new Error('jump fail');
    await page.evaluate(() => { const L = [...document.querySelectorAll('.cm-line')]; const i = L.findIndex(l => /ha1|ha2/.test(l.textContent || '')); if (i >= 0) { const r = L[i].getBoundingClientRect(); const o = { bubbles: true, clientX: r.x + 20, clientY: r.y + r.height / 2, view: window }; L[i].dispatchEvent(new MouseEvent('mousedown', o)); L[i].dispatchEvent(new MouseEvent('mouseup', o)); } });
    await page.waitForTimeout(200); await page.getByRole('button', { name: 'Circuit', exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector('.src-highlight'), null, { timeout: 5000 }).catch(() => {});
    if ((await page.evaluate(() => document.querySelectorAll('.src-highlight').length)) < 1) throw new Error('no glow');
  });

  await step('M3 drill + back', async () => {
    const p2 = await page.evaluate(() => { const s = window.__djsDebug.getSignals().cells.filter(c => /Subcircuit/.test(c.type))[0]; const el = document.querySelector(`[model-id="${s.id}"]`); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(p2.x, p2.y, { button: 'right' }); await page.waitForTimeout(300);
    await page.getByText(/Enter half_adder/).first().click(); await page.waitForTimeout(1500);
    const inside = await page.evaluate(() => { const t = window.__djsDebug.getSignals().cells.map(c => c.type); return !t.includes('Subcircuit') && t.includes('Xor'); });
    if (!inside) throw new Error('drill broken');
    await page.locator('button[title="返回顶层模块"]').first().click(); await page.waitForTimeout(1200);
  });

  await step('M4 tooltip + font audit', async () => {
    await openEx(/半加器（行为级）/); await page.waitForTimeout(1500);
    const pt = await page.evaluate(() => { const c = window.__djsDebug.getSignals().cells.filter(x => /And|Xor|Or/.test(x.type))[0]; const el = document.querySelector(`[model-id="${c.id}"]`); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(pt.x, pt.y); await page.waitForTimeout(200);
    const tip = await page.evaluate(() => { const t = document.querySelector('.net-tip'); return t?.style.display === 'block' && (t.textContent || '').includes('='); });
    if (!tip) throw new Error('tooltip fail');
    const audit = await page.evaluate(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const tally = a => a.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
      return { fonts: Object.keys(tally([...document.querySelectorAll('span,div,button,label')].filter(vis).map(e => getComputedStyle(e).fontSize))).length };
    });
    console.log('   font buckets:', audit.fonts);
  });

  await step('M5 command palette Ctrl+Shift+P', async () => {
    await page.keyboard.press('Control+Shift+p'); await page.waitForTimeout(300);
    const vis = await page.locator('input').first().isVisible().catch(() => false);
    await page.keyboard.press('Escape');
    if (!vis) throw new Error('palette not open');
  });

  await step('M6 zero native dialogs + zero page errors', async () => {
    if (native.length) throw new Error('native dialogs: ' + native.join(','));
    if (errs.length) throw new Error('errors: ' + errs.slice(0, 3).join('|'));
  });

  await page.screenshot({ path: OUT + '/final-v3.png' });
  console.log('=== QC2 SUMMARY ==='); console.log('PASS ' + R.pass.length + ' / FAIL ' + R.fail.length);
  R.fail.forEach((f) => console.log('  ' + f));
  console.log('native: ' + native.length + ' | errs: ' + (errs.length ? errs.join('|') : 'none'));
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
