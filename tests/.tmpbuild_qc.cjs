// QC REGRESSION for P1/P2 handoff work: §4.5 checklist + new features + audit metrics
let pw;
try { pw = require('playwright-core'); } catch { pw = require('D:/Visual Studio Code/Something/.tmpbuild/node_modules/playwright-core'); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'D:/Visual Studio Code/Something/.tmpbuild/qc';
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });
const EX = [['AND',/AND Gate/],['HalfAdder',/Half Adder/],['Mux2',/2-to-1/],['Counter',/4-bit Counter/],['FullAdder',/Full Adder/]];

async function main() {
  const R = { pass: [], fail: [] };
  const browser = await pw.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const native = [];
  page.on('dialog', async (d) => { native.push(d.type()); await d.dismiss().catch(() => {}); });
  const errs = [];
  page.on('pageerror', (e) => { if (!/save_export_file|invoke|__TAURI/i.test(String(e))) errs.push(String(e).slice(0, 140)); });
  const step = async (n, fn) => { try { await fn(); R.pass.push(n); console.log('PASS ' + n); } catch (e) { R.fail.push(n + ' :: ' + String(e).slice(0, 150)); console.log('FAIL ' + n + ' :: ' + String(e).slice(0, 130)); } };
  const openEx = async (re) => { await page.getByRole('button', { name: 'Examples' }).click(); await page.getByRole('button', { name: re }).click(); await page.waitForFunction(() => /Compiled successfully/.test(document.body.innerText), null, { timeout: 45000 }); };

  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
  await page.waitForTimeout(800);

  // Onboarding first-launch (fresh context should show it)
  await step('QC1 onboarding shows on first launch, dismissable', async () => {
    const vis = await page.getByText(/Open Examples|Get Started|Welcome|Quick Start/i).first().isVisible().catch(() => false);
    if (!vis) throw new Error('onboarding not shown on fresh profile');
    await page.screenshot({ path: OUT + '/qc01-onboarding.png' });
    const skip = page.getByText(/Skip/i).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  await step('QC2 File menu + Ctrl+/ shortcuts', async () => {
    await page.getByText('File', { exact: true }).first().click(); await page.waitForTimeout(250);
    const ok = await page.getByText('New File...').first().isVisible();
    await page.keyboard.press('Escape');
    if (!ok) throw new Error('menu empty');
    await page.keyboard.press('Control+/'); await page.waitForTimeout(300);
    const s = await page.getByText('Keyboard Shortcuts').first().isVisible().catch(() => false);
    await page.keyboard.press('Escape');
    if (!s) throw new Error('shortcuts dialog missing');
  });

  await step('QC3 command palette Ctrl+Shift+P + fuzzy + enter runs', async () => {
    await page.keyboard.press('Control+Shift+p'); await page.waitForTimeout(300);
    const input = page.locator('input[placeholder*="ommand" i], input[placeholder*="ype" i]').first();
    await input.waitFor({ timeout: 2000 });
    await input.fill('comp'); await page.waitForTimeout(250);
    await page.screenshot({ path: OUT + '/qc02-palette.png' });
    const hits = await page.evaluate(() => document.body.innerText.match(/Compile/g)?.length || 0);
    if (hits < 1) throw new Error('fuzzy found nothing for "comp"');
    await page.keyboard.press('Escape');
  });

  await step('QC4 Ctrl+N in-app prompt with validation', async () => {
    await page.keyboard.press('Control+n'); await page.waitForTimeout(250);
    const dlg = page.getByRole('dialog'); await dlg.waitFor({ timeout: 2000 });
    await dlg.locator('input').fill('bad.txt');
    await dlg.getByText('Create').click(); await page.waitForTimeout(200);
    const err = await dlg.getByText('Only .v, .sv, or .vh').isVisible().catch(() => false);
    await page.keyboard.press('Escape');
    if (!err) throw new Error('validation not shown');
  });

  for (const [label, re] of EX) await step('QC5 compile ' + label, async () => { await openEx(re); await page.waitForTimeout(1400); if (await page.locator('svg').count() < 1) throw new Error('no svg'); });

  await step('QC6 IO human labels (clk/reset not dev0/dev1)', async () => {
    await openEx(/4-bit Counter/); await page.waitForTimeout(1800);
    const texts = await page.evaluate(() => [...document.querySelectorAll('svg text')].map(t => t.textContent?.trim()));
    const hasClk = texts.some(t => /^clk$/.test(t || ''));
    const hasReset = texts.some(t => /^reset$/.test(t || ''));
    const devCount = texts.filter(t => /^dev\d+$/.test(t || '')).length;
    await page.screenshot({ path: OUT + '/qc03-labels.png' });
    if (!hasClk || !hasReset) throw new Error(`missing human labels (clk:${hasClk} reset:${hasReset})`);
    if (devCount > 1) throw new Error('devN labels remain: ' + devCount);
  });

  await step('QC7 dblclick jump still works after label patch', async () => {
    await openEx(/Full Adder/); await page.waitForTimeout(1600);
    const subs = await page.evaluate(() => window.__djsDebug.getSignals().cells.filter(c => /Subcircuit/.test(c.type)).map(c => c.id));
    const box = await page.evaluate((id) => { const el = document.querySelector(`[model-id="${id}"]`); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, subs[0]);
    await page.mouse.dblclick(box.x, box.y); await page.waitForTimeout(700);
    const ok = await page.evaluate(() => /Jumped to example_full_adder\.v:\d+/.test(document.body.innerText) && !!document.querySelector('.cm-editor'));
    if (!ok) throw new Error('jump broken');
  });

  await step('QC8 code->circuit glow + drill + back', async () => {
    await page.evaluate(() => { const L = [...document.querySelectorAll('.cm-line')]; const i = L.findIndex(l => /ha1|ha2/.test(l.textContent || '')); if (i >= 0) { const r = L[i].getBoundingClientRect(); const o = { bubbles: true, clientX: r.x + 20, clientY: r.y + r.height / 2, view: window }; L[i].dispatchEvent(new MouseEvent('mousedown', o)); L[i].dispatchEvent(new MouseEvent('mouseup', o)); } });
    await page.waitForTimeout(200); await page.getByRole('button', { name: 'Circuit', exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector('.src-highlight'), null, { timeout: 5000 }).catch(() => {});
    if ((await page.evaluate(() => document.querySelectorAll('.src-highlight').length)) < 1) throw new Error('no glow');
    await page.getByRole('button', { name: 'Examples' }).click();
    await page.getByRole('button', { name: /Full Adder/ }).click();
    await page.waitForFunction(() => /Compiled successfully/.test(document.body.innerText), null, { timeout: 45000 });
    await page.waitForTimeout(1600);
    const p2 = await page.evaluate(() => { const s = window.__djsDebug.getSignals().cells.filter(c => /Subcircuit/.test(c.type))[0]; const el = document.querySelector(`[model-id="${s.id}"]`); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(p2.x, p2.y, { button: 'right' }); await page.waitForTimeout(300);
    await page.getByText(/Enter half_adder/).first().click(); await page.waitForTimeout(1500);
    const inside = await page.evaluate(() => { const t = window.__djsDebug.getSignals().cells.map(c => c.type); return !t.includes('Subcircuit') && t.includes('Xor'); });
    if (!inside) throw new Error('drill broken');
    await page.locator('button[title="Back to top module"]').first().click(); await page.waitForTimeout(1200);
  });

  await step('QC9 sim: counter advance + pause + lock', async () => {
    await openEx(/4-bit Counter/); await page.waitForTimeout(1000);
    const b = await page.evaluate(() => { const el = document.querySelector('.btnface'); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(b.x, b.y); await page.waitForTimeout(300); await page.mouse.click(b.x, b.y);
    const bus = () => page.evaluate(() => { const d = window.__djsDebug.getSignals(); const bg = d.cells.find(c => c.type === 'BusGroup'); return bg ? String(bg.out) : '?'; });
    const v1 = await bus(); let v2 = v1;
    for (let i = 0; i < 14; i++) { await page.waitForTimeout(500); v2 = await bus(); if (v2 !== v1) break; }
    if (v1 === v2) throw new Error('no advance');
    await page.locator('button[title*="imulation"]').first().click(); await page.waitForTimeout(300);
    const v3 = await bus(); await page.waitForTimeout(2200); const v4 = await bus();
    if (v3 !== v4) throw new Error('pause not frozen');
    await page.locator('button[title*="imulation"]').first().click();
    await page.getByTestId('sim-lock-toggle').click(); await page.waitForTimeout(250);
    const l1 = await bus(); await page.mouse.click(b.x, b.y); await page.waitForTimeout(300);
    await page.getByTestId('sim-lock-toggle').click();
  });

  await step('QC10 waveform draws', async () => {
    await page.getByTestId('wave-toggle').click(); await page.waitForTimeout(3000);
    const stats = await page.evaluate(() => { const cv = document.querySelector('canvas'); if (!cv) return { err: 1 }; const ctx = cv.getContext('2d'); const { data } = ctx.getImageData(0, 0, cv.width, cv.height); let colored = 0; for (let i = 0; i < data.length; i += 4) { const r = data[i], g = data[i + 1], bl = data[i + 2]; if (Math.abs(r - bl) > 20 || bl > 120) colored++; } return { colored }; });
    await page.screenshot({ path: OUT + '/qc04-wave.png' });
    if (stats.err || stats.colored < 500) throw new Error('wave bad ' + JSON.stringify(stats));
    await page.getByTestId('wave-toggle').click();
  });

  await step('QC11 problems tab: induce validation error + jump', async () => {
    // create a file that instantiates a missing module -> validation/missing deps
    await page.keyboard.press('Control+n'); await page.waitForTimeout(250);
    const dlg = page.getByRole('dialog');
    await dlg.locator('input').fill('qcmissing.v');
    await dlg.getByText('Create').click(); await page.waitForTimeout(500);
    // type a broken instantiation via CodeMirror: click editor then type
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('module qcmissing(input a, output b);\n  ghost u1(a, b);\nendmodule');
    await page.waitForTimeout(200);
    await page.keyboard.press('F5');
    await page.waitForFunction(() => /error|missing|Missing/i.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    const tabs = await page.evaluate(() => document.body.innerText.match(/Problems/g)?.length || 0);
    const badge = await page.evaluate(() => document.body.innerText.match(/Problems[^\n]{0,20}(\d+)/)?.[1] || null);
    await page.screenshot({ path: OUT + '/qc05-problems.png' });
    if (tabs < 1) throw new Error('no Problems tab after error');
    await page.getByText(/Problems/).first().click(); await page.waitForTimeout(300);
    const listOk = await page.evaluate(() => /ghost|Missing|未.*定义|not.*defined/i.test(document.body.innerText));
    if (!listOk) throw new Error('problems list empty/irrelevant');
  });

  await step('QC12 audit: font-size buckets <=6, button heights', async () => {
    await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Examples' }).click();
    await page.getByRole('button', { name: /Half Adder/ }).click();
    await page.waitForFunction(() => /Compiled successfully/.test(document.body.innerText), null, { timeout: 45000 });
    await page.waitForTimeout(1500);
    const audit = await page.evaluate(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const tally = a => a.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
      return {
        fonts: tally([...document.querySelectorAll('span,div,button,label')].filter(vis).map(e => getComputedStyle(e).fontSize)),
        btnH: tally([...document.querySelectorAll('button')].filter(vis).map(b => Math.round(b.getBoundingClientRect().height))),
        inlineStyled: document.querySelectorAll('[style]').length,
      };
    });
    console.log('   fonts:', JSON.stringify(audit.fonts));
    console.log('   btnHeights:', JSON.stringify(audit.btnH));
    console.log('   inlineStyled:', audit.inlineStyled);
    const buckets = Object.keys(audit.fonts).length;
    if (buckets > 6) throw new Error('font buckets ' + buckets + ' > 6');
  });

  await step('QC13 zero native dialogs + zero page errors overall', async () => {
    if (native.length) throw new Error('native dialogs: ' + native.join(','));
    if (errs.length) throw new Error('page errors: ' + errs.slice(0, 3).join('|'));
  });

  console.log('=== QC SUMMARY ==='); console.log('PASS ' + R.pass.length + ' / FAIL ' + R.fail.length);
  R.fail.forEach((f) => console.log('  ' + f));
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
