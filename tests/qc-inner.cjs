// 定位「自定义门展开图为空」：检查弹窗 host / paper / 图的实际状态
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1472;
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
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => console.log('PAGEERR', String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);

    await clickGate(page, 'Input'); await clickGate(page, 'Output'); await sleep(400);
    const io = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    await wire(page, io.Input[0], 'out', io.Output[0], 'in');
    await page.locator('button[title^="将当前电路保存为自定义门"]').click(); await sleep(400);
    await page.fill('input[placeholder="自定义门名称"]', 'Q'); await sleep(200);
    await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(700);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    await page.evaluate(() => { const g = window.__sandboxGates.list()[0]; if (g) window.__sandboxGates.place(g.id); });
    await sleep(900);

    // 先看 Subcircuit 上到底存了什么
    const stored = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const s = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
      if (!s) return null;
      const sg = s.get('subcircuitGraph');
      const g = s.get('graph');
      return {
        hasSubcircuitGraph: !!sg,
        sgCellCount: sg?.cells?.length ?? -1,
        sgTypes: (sg?.cells || []).map(c => c.type),
        hasGraph: !!g,
        graphCellCount: g && g.getCells ? g.getCells().length : -1,
      };
    });
    console.log('Subcircuit 存储:', JSON.stringify(stored));

    // 打开弹窗
    const zp = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const s = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
      const a = s.findView(p).el.querySelector('a.zoom');
      const r = a.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(zp.x, zp.y); await sleep(1500);
    const dom = await page.evaluate(() => {
      const span = [...document.querySelectorAll('span')].find(s => /^内部电路：/.test(s.textContent?.trim() || ''));
      if (!span) return { opened: false };
      let root = span; while (root && !root.innerText?.includes('只读视图')) root = root.parentElement;
      // host = 弹窗里那个 position:relative 的容器
      const host = root ? [...root.querySelectorAll('div')].find(d => d.style.position === 'relative' && d.style.width === '100%') : null;
      return {
        opened: true,
        hostFound: !!host,
        hostW: host ? host.clientWidth : -1,
        hostH: host ? host.clientHeight : -1,
        hostChildren: host ? host.children.length : -1,
        hostSVG: host ? host.querySelectorAll('svg').length : -1,
        hostJointCells: host ? host.querySelectorAll('.joint-cell').length : -1,
        hostHtmlLen: host ? host.innerHTML.length : -1,
        hostHtmlHead: host ? host.innerHTML.slice(0, 220) : null,
      };
    });
    console.log('弹窗 DOM:', JSON.stringify(dom, null, 1));
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
