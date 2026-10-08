// 1) 用「输入引脚」驱动与门，点击输入引脚能否改电平（用户说的「逻辑门无输出」主因）
// 2) 展开图 host 内到底渲染了几个元件
const { spawn } = require('child_process');
const UI = require('./_ui.cjs');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1473;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickGate = async (page, l) => { await page.evaluate((x) => document.querySelector('button[data-gate="' + x + '"]')?.click(), l); await sleep(400); };
const portCenter = (page, id, port) => page.evaluate(({ id, port }) => {
  const p = window.__sandboxPaper; const c = p.model.getCell(id); const v = c?.findView(p); if (!v) return null;
  const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { id, port });
async function wire(page, s, sp, t, tp) {
  const a = await portCenter(page, s, sp); const b = await portCenter(page, t, tp);
  if (!a || !b) return false;
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(100);
  await page.mouse.move(b.x, b.y, { steps: 6 }); await sleep(150); await page.mouse.up(); await sleep(450);
  return true;
}
const cellBodyPt = (page, id) => page.evaluate((id) => {
  const p = window.__sandboxPaper; const c = p.model.getCell(id); const v = c.findView(p);
  const b = v.el.querySelector('.btnface') || v.el.querySelector('.body') || v.el;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, id);
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => console.log('PAGEERR', String(e)));
    page.on('console', m => { if (/内部电路|error|Error/.test(m.text())) console.log('  [console]', m.text().slice(0, 200)); });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await UI.newSandboxFile(page);

    console.log('===== [1] 输入引脚驱动与门 =====');
    await clickGate(page, 'Input'); await clickGate(page, 'Input');
    await clickGate(page, 'And'); await clickGate(page, 'Lamp'); await sleep(500);
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    const inPorts = await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).getPorts().filter(p => p.group === 'in').map(p => p.id), ids.And[0]);
    await wire(page, ids.Input[0], 'out', ids.And[0], inPorts[0]);
    await wire(page, ids.Input[1], 'out', ids.And[0], inPorts[1]);
    await wire(page, ids.And[0], 'out', ids.Lamp[0], 'in');
    const rd = () => page.evaluate(({ a, ins, l }) => {
      const p = window.__sandboxPaper;
      const g = (id) => { const o = p.model.getCell(id).get('outputSignals'); const v = o?.out; return v ? v.toString() : 'n/a'; };
      const lampV = p.model.getCell(l)?.findView(p)?.el?.querySelector?.('.led');
      return { in1: g(ins[0]), in2: g(ins[1]), and: g(a), lamp: lampV ? getComputedStyle(lampV).fill : null };
    }, { a: ids.And[0], ins: ids.Input, l: ids.Lamp[0] });
    console.log('    连线后:', JSON.stringify(await rd()));
    const p1 = await cellBodyPt(page, ids.Input[0]);
    await page.mouse.click(p1.x, p1.y); await sleep(600);
    console.log('    点第1个输入引脚后:', JSON.stringify(await rd()));
    const p2 = await cellBodyPt(page, ids.Input[1]);
    await page.mouse.click(p2.x, p2.y); await sleep(600);
    console.log('    再点第2个输入引脚后:', JSON.stringify(await rd()));

    console.log('\n===== [2] 展开图 host 内容 =====');
    await UI.newSandboxFile(page);
    await clickGate(page, 'Input'); await clickGate(page, 'Output'); await sleep(400);
    const io = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    await wire(page, io.Input[0], 'out', io.Output[0], 'in');
    await page.locator('button[title^="将当前电路保存为自定义门"]').click(); await sleep(400);
    await page.fill('input[placeholder="自定义门名称"]', 'Q2'); await sleep(200);
    await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(700);
    await UI.newSandboxFile(page);
    await page.evaluate(() => { const g = window.__sandboxGates.list()[0]; if (g) window.__sandboxGates.place(g.id); });
    await sleep(900);
    const zp = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const s = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
      const r = s.findView(p).el.querySelector('a.zoom').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(zp.x, zp.y); await sleep(1500);
    const host = await page.evaluate(() => {
      const h = document.querySelector('[data-inner-host]');
      if (!h) return { found: false };
      return { found: true, w: h.clientWidth, h: h.clientHeight, svg: h.querySelectorAll('svg').length,
               cells: h.querySelectorAll('.joint-cell').length, children: h.children.length,
               html: h.innerHTML.slice(0, 200) };
    });
    console.log('    弹窗 host:', JSON.stringify(host));
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
