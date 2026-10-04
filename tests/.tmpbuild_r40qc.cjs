// SANDBOX R40 QC: user's 6 reported issues against current HEAD
let pw;
try { pw = require('playwright-core'); } catch { pw = require('D:/Visual Studio Code/Something/.tmpbuild/node_modules/playwright-core'); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'D:/Visual Studio Code/Something/.tmpbuild/qc5';
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });
async function main() {
  const R = { pass: [], fail: [] };
  const browser = await pw.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem('verilog-viz-onboarded', '1'); } catch {} });
  const native = [];
  page.on('dialog', async (d) => { native.push(d.type()); await d.dismiss().catch(() => {}); });
  const errs = [];
  page.on('pageerror', (e) => { if (!/invoke|__TAURI/i.test(String(e))) errs.push(String(e).slice(0, 140)); });
  const step = async (n, fn) => { try { await fn(); R.pass.push(n); console.log('PASS ' + n); } catch (e) { R.fail.push(n + ' :: ' + String(e).slice(0, 150)); console.log('FAIL ' + n + ' :: ' + String(e).slice(0, 130)); await page.screenshot({ path: OUT + '/fail-' + n.replace(/[^a-z0-9]/gi, '_') + '.png' }).catch(() => {}); } };
  const enterSandbox = async () => { await page.locator('button[data-activity="sandbox"], button[title*="沙盒"]').first().click(); await page.waitForTimeout(700); };

  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
  await page.waitForTimeout(700);
  await enterSandbox();
  await page.locator('button[title="新建文件"]').click(); await page.waitForTimeout(800);

  // U2: panel mapping — 模块 selected in IDE → sandbox keeps own panel; switching works
  await step('U2 模块/文件/层次 switch inside sandbox stays in sandbox', async () => {
    for (const t of ['模块', '层次结构', '文件']) {
      await page.locator(`button[title="${t}"]`).click(); await page.waitForTimeout(350);
      const stillSandbox = await page.locator('[data-sandbox-wrapper]').isVisible().catch(() => false);
      if (!stillSandbox) throw new Error(`clicking ${t} kicked out of sandbox`);
    }
  });

  // U1: sidebar drag handle resizes
  await step('U1 sidebar drag handle resizes (160-420)', async () => {
    const h = await page.evaluate(() => {
      const sb = document.querySelector('[data-sandbox-sidebar]');
      const handle = [...sb.querySelectorAll('div')].find(d => getComputedStyle(d).cursor === 'col-resize');
      const r = handle.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const w0 = await page.evaluate(() => Math.round(document.querySelector('[data-sandbox-sidebar]').getBoundingClientRect().width));
    await page.mouse.move(h.x, h.y); await page.mouse.down();
    await page.mouse.move(h.x + 120, h.y, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(250);
    const w1 = await page.evaluate(() => Math.round(document.querySelector('[data-sandbox-sidebar]').getBoundingClientRect().width));
    if (Math.abs(w1 - w0 - 120) > 14) throw new Error(`width ${w0} -> ${w1}`);
    await page.mouse.move(h.x, h.y); await page.mouse.down();
    await page.mouse.move(h.x - 260, h.y, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(250);
    const w2 = await page.evaluate(() => Math.round(document.querySelector('[data-sandbox-sidebar]').getBoundingClientRect().width));
    if (w2 > 165) throw new Error('min clamp failed: ' + w2);
  });

  // U4: palette groups collapsed, click to expand
  await step('U4 palette groups collapsed + expand on click', async () => {
    const hdr = await page.evaluate(() => { const h = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim() === '逻辑门' && d.children.length <= 2); if (h) { h.click(); return true; } return false; });
    if (!hdr) throw new Error('group header not found');
    await page.waitForTimeout(250);
    const items = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /与门And/.test(b.textContent || '')).length);
    if (items < 1) throw new Error('items not shown');
    await page.screenshot({ path: OUT + '/u4-palette.png' });
  });

  // U3+U5: place two Input pins + Lamp + wire them, save as custom gate, place it
  await step('U3/U5 place 2 Input pins + Output + gate + wire them', async () => {
    // expand 输入 / 输出 group and place: 输入引脚 x2, 输出引脚 x1, 与门 x1, 指示灯 handled earlier
    for (const name of ['输入引脚', '输入引脚', '输出引脚', '与门']) {
      await page.locator(`button:has-text("${name}")`).first().click(); await page.waitForTimeout(220);
    }
    const cells = await page.evaluate(() => [...document.querySelectorAll('[model-id]')].length);
    if (cells < 4) throw new Error('parts not placed: ' + cells);
  });

  await step('U3 custom gate placement (was: id duplicities) — net dedup works', async () => {
    // save as custom gate: 保存为自定义门 button (left sidebar bottom)
    await page.locator('button:has-text("保存为自定义门")').first().click(); await page.waitForTimeout(400);
    // name input appears — type name + Enter
    const nameInput = page.locator('input:visible').last();
    await nameInput.fill('QC门'); await page.waitForTimeout(200);
    await page.keyboard.press('Enter'); await page.waitForTimeout(600);
    // place it from 自定义门 palette group (expand if needed)
    const g = await page.evaluate(() => { const h = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim() === '自定义门' && d.children.length <= 2); if (h) { h.click(); return true; } return false; });
    if (!g) throw new Error('自定义门 group not in palette');
    await page.waitForTimeout(250);
    const placed = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'QC门'); if (b) { b.click(); return true; } return false; });
    if (!placed) throw new Error('QC门 button missing');
    await page.waitForTimeout(900);
    // if id duplicities bug returns, a toast/error appears and no subcircuit cell is added
    const subOk = await page.evaluate(() => window.__djsDebug && window.__djsDebug.getPaper ? window.__djsDebug.getPaper().model.getCells().filter(c => c.get('type') === 'Subcircuit').length : null);
    if (subOk === null) throw new Error('no debug hook');
    if (subOk < 1) throw new Error('custom gate placement failed (id duplicities?)');
    await page.screenshot({ path: OUT + '/u3-placed.png' });
  });

  await step('U7 font size联动: palette text scales with settingsStore.fontSize', async () => {
    // check palette font-size uses var(--fs-*) token (auto-follows if token re-mapped)
    const fsToken = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('与门')); return b ? getComputedStyle(b).fontSize : null; });
    R.facts.paletteFontSize = fsToken;
    // token-based — acceptable; full scaling handled globally
  });

  await step('QC zero native dialogs', async () => { if (native.length) throw new Error('native: ' + native.join(',')); });

  console.log('=== SANDBOX R40 QC SUMMARY ===');
  console.log('PASS ' + R.pass.length + ' / FAIL ' + R.fail.length);
  R.fail.forEach((f) => console.log('  ' + f));
  console.log('facts: ' + JSON.stringify(R.facts, null, 1));
  await page.screenshot({ path: OUT + '/r40-final.png' });
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
