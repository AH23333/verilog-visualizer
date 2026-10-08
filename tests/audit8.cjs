// 深度自检轮 8+9：改位宽×已连线（DRC）+ 新器件旋转（Memory/Dff/BusGroup）
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1481;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const realClickGate = async (page, label) => {
  await require('./_ui.cjs').ensurePalette(page);
const UI = require('./_ui.cjs');
  const btn = page.locator(`button[data-gate="${label}"]`);
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click(); await sleep(500);
};
const bodyCenter = (page, id) => page.evaluate((id) => {
  const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
  const r = v.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, id);
const portCenter = (page, id, port) => page.evaluate(({ id, port }) => {
  const p = window.__sandboxPaper; const c = p.model.getCell(id); const v = c?.findView(p); if (!v) return null;
  const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { id, port });
async function wire(page, s, sp, t, tp) {
  const a = await portCenter(page, s, sp); const b = await portCenter(page, t, tp);
  if (!a || !b) return false;
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(120);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 }); await sleep(100);
  await page.mouse.move(b.x, b.y, { steps: 6 }); await sleep(250); await page.mouse.up(); await sleep(600);
  return true;
}
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await UI.newSandboxFile(page);

    // ===== [8] 改位宽 × 已连线 =====
    console.log('\n===== [8] 已连线上改位宽 =====');
    await realClickGate(page, 'Input');
    await realClickGate(page, 'Lamp');
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    const w = await wire(page, ids.Input[0], 'out', ids.Lamp[0], 'in');
    console.log('    连线:', w);
    // Input 改 2 位（连线仍是 1 位）
    const pt = await bodyCenter(page, ids.Input[0]);
    await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(500);
    const binp = page.locator('input[placeholder="bits"]');
    await binp.fill('2'); await binp.press('Enter'); await sleep(500);
    await page.keyboard.press('Escape'); await sleep(500);
    const drc = await page.evaluate(() => (window.__sandboxDrc || []).length || document.querySelectorAll('[data-drc-item]').length);
    // DRC 结果可能在侧栏渲染——读 DOM 文本
    const drcText = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find(d => /非法连接/.test(d.textContent || '') && d.children.length < 6);
      return el ? el.textContent.slice(0, 60) : null;
    });
    console.log('    改位宽后 DRC 提示:', JSON.stringify(drcText));
    // 点击 Input 不崩（传播容错）
    await clickBodySafe(page, ids.Input[0]);
    errors.length === 0 ? ok('[8a] 已连线上改位宽：传播不崩', `DRC提示=${drcText ? '有' : '无'}`) : bad('[8a] 改位宽引发异常', errors[0].slice(0, 120));
    // 撤销 → 恢复 1 位
    await page.keyboard.press('Control+z'); await sleep(700);
    const bitsBack = await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).get('bits'), ids.Input[0]);
    bitsBack === 1 ? ok('[8b] 撤销后位宽恢复 1') : bad('[8b] 撤销未恢复位宽', String(bitsBack));

    // ===== [9] 新器件旋转 =====
    console.log('\n===== [9] 新器件旋转 =====');
    await realClickGate(page, 'Memory');
    await realClickGate(page, 'Dff');
    await realClickGate(page, 'BusGroup');
    const ids2 = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    for (const [label, id] of [['Memory', ids2.Memory[0]], ['Dff', ids2.Dff[0]], ['BusGroup', ids2.BusGroup[0]]]) {
      // 左键点中器件（选中）→ Ctrl+R 旋转，比右键菜单更稳健
      for (let k = 0; k < 4; k++) {
        const pt = await bodyCenter(page, id);
        await page.mouse.click(pt.x, pt.y); await sleep(300);
        await page.keyboard.press('Control+r'); await sleep(350);
      }
      const still = await page.evaluate((id) => {
        const c = window.__sandboxPaper.model.getCell(id);
        const v = c?.findView(window.__sandboxPaper);
        return { angle: c?.get('angle'), visible: !!v && v.el.getBoundingClientRect().width > 0 };
      }, id);
      (still.visible && errors.length === 0)
        ? ok(`[9] ${label} 旋转 360° 无异常（angle=${still.angle}）`)
        : bad(`[9] ${label} 旋转异常`, JSON.stringify(still) + (errors[0] || '').slice(0, 100));
    }
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); if (pass + fail === 0) fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
  async function clickBodySafe(page, id) {
    try {
      const pt = await bodyCenter(page, id);
      await page.mouse.click(pt.x, pt.y); await sleep(500);
    } catch { /* ignore */ }
  }
})();
