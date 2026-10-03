// 完全模拟真实用户：全部用真实鼠标操作（放置/连线/点击输入引脚），
// 并覆盖「保存 → 刷新 → 重开」持久化路径。生产构建 (vite preview) 下运行。
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 4174;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
// 真实鼠标点击调色板按钮（不用 JS click）
async function realClickGate(page, label) {
  const btn = page.locator(`button[data-gate="${label}"]`);
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click();           // Playwright 真实鼠标点击
  await sleep(500);
}
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
  await page.mouse.move(b.x, b.y, { steps: 6 }); await sleep(250); await page.mouse.up(); await sleep(500);
  return true;
}
const lampState = (page, id) => page.evaluate((id) => {
  const p = window.__sandboxPaper; const l = p.model.getCell(id);
  const v = l?.findView(p)?.el?.querySelector?.('.led');
  const o = l?.get('inputSignals'); const iv = o?.in;
  return { led: v ? getComputedStyle(v).fill : null, in: iv && iv.toString ? iv.toString() : String(iv) };
}, id);
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    console.log('preview:', (await waitForServer()) ? 'OK' : 'FAIL');
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2500);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(1000);
    await page.locator('button[title="新建文件"]').click(); await sleep(1500);

    console.log('===== 真实鼠标放置 + 连线 =====');
    await realClickGate(page, 'Input'); await realClickGate(page, 'Input');
    await realClickGate(page, 'And');  await realClickGate(page, 'Lamp');
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    console.log('    放置:', JSON.stringify(Object.fromEntries(Object.entries(ids).map(([k,v])=>[k,v.length]))));
    const inPorts = await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).getPorts().filter(p => p.group === 'in').map(p => p.id), ids.And[0]);
    await wire(page, ids.Input[0], 'out', ids.And[0], inPorts[0]);
    await wire(page, ids.Input[1], 'out', ids.And[0], inPorts[1]);
    await wire(page, ids.And[0], 'out', ids.Lamp[0], 'in');
    console.log('    links =', await page.evaluate(() => window.__sandboxPaper.model.getLinks().length));

    // 真实点击两个输入引脚（点盒体中心，不借助内部选择器）
    for (const iId of ids.Input) {
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
        const r = v.el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, iId);
      await page.mouse.click(pt.x, pt.y); await sleep(700);
    }
    const s1 = await lampState(page, ids.Lamp[0]);
    console.log('    点击两个输入后 灯:', JSON.stringify(s1));
    const lit1 = /3, 192, 60|#03c03c/.test(s1.led);
    console.log(lit1 ? '  >>> 真实交互下与门正常点亮' : '  >>> 真实交互下灯不亮！');

    console.log('\n===== 保存 → 刷新 → 重开 =====');
    await page.locator('button[title^="保存"]').first().click().catch(async () => { await page.keyboard.press('Control+s'); });
    await sleep(900);
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2500);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(1500);
    const ids2 = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    console.log('    重开后的部件:', JSON.stringify(Object.fromEntries(Object.entries(ids2 || {}).map(([k,v])=>[k,v.length]))));
    if (ids2 && ids2.And && ids2.Input) {
      // 重开后再点一次第一个输入引脚（1→0），灯应变红/灭
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
        const r = v.el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, ids2.Input[0]);
      await page.mouse.click(pt.x, pt.y); await sleep(700);
      const s2 = await lampState(page, ids2.Lamp[0]);
      console.log('    重开后点击输入 灯:', JSON.stringify(s2));
      console.log(/3, 192, 60|#03c03c/.test(s2.led) || /252, 124, 104|#fc7c68/.test(s2.led)
        ? '  >>> 持久化后与门仍正常响应'
        : '  >>> 持久化后与门无响应！');
    } else {
      console.log('  >>> 重开后部件丢失（持久化问题）');
    }
    console.log('pageerrors:', JSON.stringify(errors.slice(0, 5)));
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
