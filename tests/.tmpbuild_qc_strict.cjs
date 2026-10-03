// SANDBOX QC-STRICT: pin down drag delta + reload integrity with exact assertions
let pw;
try { pw = require('playwright-core'); } catch { pw = require('D:/Visual Studio Code/Something/.tmpbuild/node_modules/playwright-core'); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function main() {
  const R = { pass: [], fail: [], facts: {} };
  const browser = await pw.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const native = [];
  page.on('dialog', async (d) => { native.push(d.type()); await d.accept().catch(() => {}); });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
  const step = async (n, fn) => { try { await fn(); R.pass.push(n); console.log('PASS ' + n); } catch (e) { R.fail.push(n + ' :: ' + String(e).slice(0, 160)); console.log('FAIL ' + n + ' :: ' + String(e).slice(0, 140)); } };

  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
  await page.waitForTimeout(700);
  { const skip = page.getByText(/Skip/i).first(); if (await skip.isVisible({ timeout: 1200 }).catch(() => false)) { await skip.click(); await page.waitForTimeout(300); } else await page.keyboard.press('Escape'); }

  // fresh sandbox file
 await page.locator('button[title="沙盒"]').click(); await page.waitForTimeout(600);
 await page.locator('button[title="新建文件"]').click(); await page.waitForTimeout(800);

  // place ONE gate at a known-ish spot; capture exact model position
  await page.locator('button:has-text("与门")').click(); await page.waitForTimeout(300);
  const posBefore = await page.evaluate(() => {
    const el = document.querySelector('[model-id]');
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('model-id'), sx: r.x, sy: r.y, w: r.width, h: r.height };
  });
  R.facts.posBefore = posBefore;

  await step('DRAG: model position moves by exact delta (+150,+80)', async () => {
    const cx = posBefore.sx + posBefore.w / 2, cy = posBefore.sy + posBefore.h / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 150, cy + 80, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => {
      const el = document.querySelector(`[model-id="${document.querySelector('[model-id]').getAttribute('model-id')}"]`);
      const r = el.getBoundingClientRect();
      return { sx: r.x, sy: r.y };
    });
    const dx = after.sx - posBefore.sx, dy = after.sy - posBefore.sy;
    R.facts.dragDelta = { dx: Math.round(dx), dy: Math.round(dy) };
    // screen-space delta must match mouse delta exactly if model+view are in sync
    if (Math.abs(dx - 150) > 8 || Math.abs(dy - 80) > 8) throw new Error(`drag delta off: dx=${Math.round(dx)} dy=${Math.round(dy)} (expect ~150/80)`);
  });

  await step('SAVE+RELOAD: cell survives AND position matches post-drag', async () => {
    await page.locator('button:has-text("保存")').first().click();
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.locator('button[title="沙盒"]').click();
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => {
      const el = document.querySelector('[model-id]');
      return { cells: document.querySelectorAll('[model-id]').length, sx: el ? Math.round(el.getBoundingClientRect().x) : null, loadErr: (window.__qcLoadErr || null) };
    });
    R.facts.afterReload = state;
    if (state.cells < 1) throw new Error('reload: model EMPTY (fromJSON failed)');
    if (Math.abs(state.sx - (posBefore.sx + 150)) > 12) throw new Error(`reload: x drifted ${state.sx} vs ${Math.round(posBefore.sx + 150)}`);
  });

  await step('VERIFY: no fromJSON errors (re-instantiation works)', async () => {
    const loadFail = errors.find(e => /Could not find cell constructor/i.test(e));
    R.facts.loadFailEvidence = loadFail || null;
    if (loadFail) throw new Error('fromJSON error still present: ' + loadFail);
  });

  console.log('=== STRICT SUMMARY ===');
  console.log('PASS ' + R.pass.length + ' / FAIL ' + R.fail.length);
  R.fail.forEach((f) => console.log('  ' + f));
  console.log('facts: ' + JSON.stringify(R.facts, null, 1));
  console.log('console errors: ' + (errors.length ? errors.slice(0, 4).join(' | ') : 'none'));
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
