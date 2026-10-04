// SANDBOX R40 QC v2: corrected panel switching + handle coords
let pw;
try { pw = require('playwright-core'); } catch { pw = require('D:/Visual Studio Code/Something/.tmpbuild/node_modules/playwright-core'); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'D:/Visual Studio Code/Something/.tmpbuild/qc5';
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
  const enterSandbox = async () => { await page.locator('button[data-activity="sandbox"], button[title*="沙盒"]').first().click(); await page.waitForTimeout(700); };
  const toModulesPanel = async () => { await page.locator('button[title="模块"]').click(); await page.waitForTimeout(350); };

  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
  await page.waitForTimeout(700);
  await enterSandbox();
  await page.locator('button[title="新建文件"]').click(); await page.waitForTimeout(800);
  await toModulesPanel();

  await step('U1 sidebar drag handle resizes both ways', async () => {
    const getHandle = async () => page.evaluate(() => {
      const sb = document.querySelector('[data-sandbox-sidebar]');
      const h = [...sb.querySelectorAll('div')].find(d => getComputedStyle(d).cursor === 'col-resize');
      const r = h.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const w = () => page.evaluate(() => Math.round(document.querySelector('[data-sandbox-sidebar]').getBoundingClientRect().width));
    const w0 = await w();
    let h = await getHandle();
    await page.mouse.move(h.x, h.y); await page.mouse.down();
    await page.mouse.move(h.x + 120, h.y, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(250);
    const w1 = await w();
    h = await getHandle(); // re-fetch after resize
    await page.mouse.move(h.x, h.y); await page.mouse.down();
    await page.mouse.move(h.x - 320, h.y, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(250);
    const w2 = await w();
    if (Math.abs(w1 - w0 - 120) > 14) throw new Error(`expand ${w0}->${w1}`);
    if (w2 > 165) throw new Error(`min clamp failed: ${w2}`);
    R.facts.widths = `${w0}->${w1}->${w2}`;
    // restore
    h = await getHandle();
    await page.mouse.move(h.x, h.y); await page.mouse.down();
    await page.mouse.move(h.x + 180, h.y, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
  });

  // palette 在「模块」面板——切过去再测（修复脚本面板时序）
  await page.locator('button[title="模块"]').click(); await page.waitForTimeout(350);

  await step('U4 palette groups collapsed + expand on click (toggle both ways)', async () => {
    // 初始「逻辑门」展开（openGroups 初始含它）——点组头收起，再点展开，验证 toggle 双向
    const clickHdr = () => page.evaluate(() => { const h = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim().startsWith('逻辑门') && d.children.length <= 2); if (h) { h.click(); return true; } return false; });
    const item = () => page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /与门And/.test(b.textContent || '')).length);
    if (!(await clickHdr())) throw new Error('group header not found');
    await page.waitForTimeout(250);
    const collapsed = await item();
    if (collapsed >= 1) throw new Error('collapse failed (items still visible: ' + collapsed + ')');
    if (!(await clickHdr())) throw new Error('second click failed');
    await page.waitForTimeout(250);
    const expanded = await item();
    if (expanded < 1) throw new Error('re-expand failed');
    await page.screenshot({ path: OUT + '/u4-palette.png' });
  });

  await step('U3 place 输入引脚×2 + 输出引脚 + 与门', async () => {
    // 先展开「输入 / 输出」与「逻辑门」分组（默认收起）
    await page.evaluate(() => { for (const g of ['输入 / 输出', '逻辑门']) { const h = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim().startsWith(g) && d.children.length <= 2); if (h) h.click(); } });
    await page.waitForTimeout(250);
    for (const name of ['输入引脚', '输入引脚', '输出引脚', '与门']) {
      await page.locator(`button:has-text("${name}")`).first().click(); await page.waitForTimeout(220);
    }
    const cells = await page.evaluate(() => [...document.querySelectorAll('[model-id]')].length);
    if (cells < 4) throw new Error('parts not placed: ' + cells);
  });

  await step('U3 custom gate: save + place (net dedup fix)', async () => {
    await page.locator('button:has-text("保存为自定义门")').first().click(); await page.waitForTimeout(400);
    const nameInput = page.locator('input:visible').last();
    await nameInput.fill('QC门'); await page.waitForTimeout(200);
    await page.keyboard.press('Enter'); await page.waitForTimeout(600);
    const g = await page.evaluate(() => { const h = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim() === '自定义门' && d.children.length <= 2); if (h) { h.click(); return true; } return false; });
    if (!g) throw new Error('自定义门 group not in palette');
    await page.waitForTimeout(250);
    const placed = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'QC门'); if (b) { b.click(); return true; } return false; });
    if (!placed) throw new Error('QC门 button missing');
    await page.waitForTimeout(900);
    const subCount = await page.evaluate(() => { try { return window.__djsDebug.getPaper().model.getCells().filter(c => c.get('type') === 'Subcircuit').length; } catch { return -1; } });
    if (subCount < 1) throw new Error('custom gate placement failed (subcircuit cells: ' + subCount + ')');
    await page.screenshot({ path: OUT + '/u3-placed.png' });
  });

  await step('U7 palette font uses fs token (联动基线)', async () => {
    const fsToken = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('与门')); return b ? getComputedStyle(b).fontSize : null; });
    R.facts.paletteFontSize = fsToken;
  });

  await step('QC zero native dialogs', async () => { if (native.length) throw new Error('native: ' + native.join(',')); });

  console.log('=== SANDBOX R40 QC v2 SUMMARY ===');
  console.log('PASS ' + R.pass.length + ' / FAIL ' + R.fail.length);
  R.fail.forEach((f) => console.log('  ' + f));
  console.log('facts: ' + JSON.stringify(R.facts, null, 1));
  await page.screenshot({ path: OUT + '/r40-final.png' });
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
