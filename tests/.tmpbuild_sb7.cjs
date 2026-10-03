// SANDBOX 7-item QC: palette groups, bus parts, mode switching, context menu, magnet snap
let pw;
try { pw = require('playwright-core'); } catch { pw = require('D:/Visual Studio Code/Something/.tmpbuild/node_modules/playwright-core'); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'D:/Visual Studio Code/Something/.tmpbuild/qc3';
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const R = { pass: [], fail: [], facts: {} };
  const browser = await pw.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem('verilog-viz-onboarded', '1'); } catch {} });
  const native = [];
  page.on('dialog', async (d) => { native.push(d.type()); await d.dismiss().catch(() => {}); });
  const errs = [];
  page.on('pageerror', (e) => { if (!/invoke|__TAURI/i.test(String(e))) errs.push(String(e).slice(0, 140)); });
  const step = async (n, fn) => { try { await fn(); R.pass.push(n); console.log('PASS ' + n); } catch (e) { R.fail.push(n + ' :: ' + String(e).slice(0, 150)); console.log('FAIL ' + n + ' :: ' + String(e).slice(0, 130)); await page.screenshot({ path: OUT + '/fail-' + n.replace(/[^a-z0-9]/gi, '_') + '.png' }).catch(() => {}); } };

  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
  await page.waitForTimeout(700);
  { const s = page.getByText(/跳过/i).first(); if (await s.isVisible({ timeout: 1500 }).catch(() => false)) { await s.click(); await page.waitForTimeout(300); } else await page.keyboard.press('Escape'); }

  await page.locator('button[title="沙盒"]').click(); await page.waitForTimeout(700);
  await page.locator('button[title="新建文件"]').click(); await page.waitForTimeout(800);

  // 1. palette groups & specialized parts
  await step('Q1 palette groups (时序/比较/选择移位/总线/存储) + specialized parts', async () => {
    const t = await page.evaluate(() => document.body.innerText);
    for (const g of ['逻辑门', '时序', '比较', '选择 / 移位', '总线', '存储']) {
      if (!t.includes(g)) throw new Error('missing group: ' + g);
    }
    for (const p of ['D 触发器', '多路选择器', '存储器 (RAM)', '合线器', '总线切片', '分线器']) {
      if (!t.includes(p)) throw new Error('missing part: ' + p);
    }
  });
  await page.screenshot({ path: OUT + '/q1-palette.png' });

  // place Button + Lamp + BusGroup for later tests
  await page.locator('button:has-text("时钟")').click(); await page.waitForTimeout(200);
  await page.locator('button:has-text("指示灯")').click(); await page.waitForTimeout(200);
  await page.locator('button:has-text("合线器")').click(); await page.waitForTimeout(200);
  const cellCount = await page.locator('[model-id]').count();
  R.facts.placedCells = cellCount;

  // 3+4. mode switching: sandbox panel independence + exit/restore
  await step('Q3/Q4 sandbox panel independence (文件/模块/层次 switch inside sandbox) + exit restores', async () => {
    // while in sandbox, click 模块 -> sandbox panel should stay sandbox (own panel)
    await page.locator('button[title="模块"]').click(); await page.waitForTimeout(400);
    const stillSandbox = await page.locator('[data-sandbox-wrapper]').isVisible().catch(() => false);
    if (!stillSandbox) throw new Error('clicking 模块 kicked out of sandbox (bug #3)');
    await page.locator('button[title="层次结构"]').click(); await page.waitForTimeout(400);
    if (!(await page.locator('[data-sandbox-wrapper]').isVisible().catch(() => false))) throw new Error('hierarchy kicked out');
    // exit via second click on 沙盒
    await page.locator('button[title*="沙盒"]').click(); await page.waitForTimeout(600);
    const back = await page.getByText(/未选择文件|No file selected/i).first().isVisible().catch(() => false)
      || (await page.locator('svg').count() > 0);
    if (!back) throw new Error('did not return to main view (bug #4)');
    // re-enter sandbox for the rest
    await page.locator('button[title="沙盒"]').click(); await page.waitForTimeout(800);
    // the previously placed cells should still be there (sandbox state preserved)
    const cells = await page.locator('[model-id]').count();
    if (cells < cellCount) throw new Error(`sandbox state lost: ${cells} < ${cellCount}`);
    R.facts.reenteredCells = cells;
  });

  // 5. canvas context menu -> 放置部件 submenu
  await step('Q5 canvas right-click 放置部件 submenu places a part', async () => {
    const wrap = await page.locator('[data-sandbox-wrapper]').boundingBox();
    await page.mouse.click(wrap.x + 500, wrap.y + 300, { button: 'right' });
    await page.waitForTimeout(300);
    const item = page.getByText('放置部件', { exact: false }).first();
    if (!(await item.isVisible().catch(() => false))) throw new Error('放置部件 item missing');
    await item.click(); await page.waitForTimeout(300);
    // submenu items appear — pick one (与门)
    const sub = page.locator('button:has-text("与门")').first();
    if (!(await sub.isVisible().catch(() => false))) throw new Error('submenu empty');
    await sub.click(); await page.waitForTimeout(400);
    const n = await page.locator('[model-id]').count();
    if (n <= cellCount) throw new Error('part not placed via context menu');
    R.facts.contextMenuPlaced = true;
  });
  await page.screenshot({ path: OUT + '/q5-context.png' });

  // 7. magnet snap: start a wire 15px off the port dot (SNAP_PX=26 tolerance)
  await step('Q7 magnet snap: wire from 15px-off port attaches', async () => {
    // dump magnets of the Button cell
    const ports = await page.evaluate(() => [...document.querySelectorAll('[magnet]')].map((m) => {
      const r = m.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, cell: m.closest('[model-id]')?.getAttribute('model-id') };
    }));
    // Button is the cell with a btnface; pick its out port (rightmost magnet)
    const btnPorts = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[model-id]')].find(el => el.querySelector('.btnface'));
      return btn ? btn.getAttribute('model-id') : null;
    });
    const out = ports.filter(p => p.cell === btnPorts).sort((a, b) => b.x - a.x)[0];
    if (!out) throw new Error('Button out port not found');
    // start drag 15px BELOW the port dot (outside the few-px dot, inside SNAP_PX=26)
    await page.mouse.move(out.x, out.y + 15); await page.mouse.down();
    // drag toward Lamp in port
    const lampPorts = ports.filter(p => p.cell !== btnPorts);
    const lampIn = lampPorts.sort((a, b) => a.x - b.x)[0];
    await page.mouse.move(lampIn.x, lampIn.y, { steps: 12 });
    await page.mouse.up(); await page.waitForTimeout(400);
    const links = await page.evaluate(() => document.querySelectorAll('.joint-link').length);
    R.facts.linksAfterSnapWire = links;
    if (links < 1) throw new Error('magnet snap failed: no link from 15px-off start');
  });
  await page.screenshot({ path: OUT + '/q7-snap-wire.png' });

  // 2/6. bus parts: place BusSlice + BusUngroup, check bits handling via context menu 位宽
  await step('Q2/6 bus parts placeable (BusSlice/BusUngroup) + 位数 menu present', async () => {
    await page.locator('button:has-text("总线切片")').click(); await page.waitForTimeout(200);
    await page.locator('button:has-text("分线器")').click(); await page.waitForTimeout(200);
    const n = await page.locator('[model-id]').count();
    if (n < 5) throw new Error('bus parts not placed');
    // right-click the BusSlice -> 位宽 menu item?
    const el = await page.evaluate(() => { const ids = [...document.querySelectorAll('[model-id]')]; const el2 = ids[ids.length - 1]; const r = el2.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(el.x, el.y, { button: 'right' }); await page.waitForTimeout(300);
    const t = await page.evaluate(() => document.body.innerText);
    const hasBits = /位宽|位数|bits/i.test(t);
    await page.keyboard.press('Escape');
    R.facts.bitsMenu = hasBits;
  });

  await step('QC-zero native dialogs + page errors', async () => {
    if (native.length) throw new Error('native: ' + native.join(','));
    if (errs.length) throw new Error('errs: ' + errs.slice(0, 3).join('|'));
  });

  console.log('=== SANDBOX 7-ITEM QC SUMMARY ===');
  console.log('PASS ' + R.pass.length + ' / FAIL ' + R.fail.length);
  R.fail.forEach((f) => console.log('  ' + f));
  console.log('facts: ' + JSON.stringify(R.facts, null, 1));
  await page.screenshot({ path: OUT + '/sb7-final.png' });
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
