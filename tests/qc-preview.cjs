// 在「生产构建」(vite preview, 跑 dist) 下复现「逻辑门无法使用」
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickGate = async (page, l) => { await page.evaluate((x) => document.querySelector('button[data-gate="' + x + '"]')?.click(), l); await sleep(450); };
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
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    const okSrv = await waitForServer();
    console.log('preview server:', okSrv ? 'OK' : 'FAIL');
    if (!okSrv) process.exit(2);
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (/error/i.test(m.type())) errors.push('console: ' + m.text().slice(0, 140)); });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2500);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(1000);
    await page.locator('button[title="新建文件"]').click(); await sleep(1500);

    console.log('===== [1] 与门：输入引脚驱动 =====');
    await clickGate(page, 'Input'); await clickGate(page, 'Input');
    await clickGate(page, 'And'); await clickGate(page, 'Lamp'); await sleep(600);
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    console.log('    放置结果:', JSON.stringify(ids));
    if (!ids || !ids.And) { console.log('FATAL: 与门未被放置'); process.exit(1); }
    const inPorts = await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).getPorts().filter(p => p.group === 'in').map(p => p.id), ids.And[0]);
    const w = [];
    w.push(await wire(page, ids.Input[0], 'out', ids.And[0], inPorts[0]));
    w.push(await wire(page, ids.Input[1], 'out', ids.And[0], inPorts[1]));
    w.push(await wire(page, ids.And[0], 'out', ids.Lamp[0], 'in'));
    const links = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
    console.log('    连线:', JSON.stringify(w), ' links =', links);
    const rd = () => page.evaluate(({ a, ins, l }) => {
      const p = window.__sandboxPaper;
      const g = (id) => { const c = p.model.getCell(id); if (!c) return 'no-cell'; const o = c.get('outputSignals'); const v = o?.out; return v ? v.toString() : 'n/a'; };
      const lampV = p.model.getCell(l)?.findView(p)?.el?.querySelector?.('.led');
      return { in1: g(ins[0]), in2: g(ins[1]), and: g(a), lamp: lampV ? getComputedStyle(lampV).fill : null };
    }, { a: ids.And[0], ins: ids.Input, l: ids.Lamp[0] });
    console.log('    连线后:', JSON.stringify(await rd()));
    for (const iId of ids.Input) {
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const c = p.model.getCell(id); const v = c.findView(p);
        const b = v.el.querySelector('.btnface') || v.el.querySelector('.body') || v.el;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, iId);
      await page.mouse.click(pt.x, pt.y); await sleep(700);
    }
    const after = await rd();
    console.log('    两个输入都点击后:', JSON.stringify(after));
    const lit = /3, 192, 60|#03c03c/.test(after.lamp);
    console.log(lit ? '>>> 生产构建下与门正常' : '>>> 生产构建下与门无输出（复现用户问题）');
    console.log('pageerrors:', JSON.stringify(errors.slice(0, 5)));
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
