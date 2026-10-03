// 探测第二批器件的构造方式与端口：Mux/比较器/移位/总线/取负/存储/Repeater/NumBase
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1493;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 120)));
    await page.goto(URL, { waitUntil: 'networkidle' }); await sleep(2000);
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);

    const probe = await page.evaluate(() => {
      const dj = window.digitaljs;
      const tryMake = (name, args) => {
        try {
          const c = new dj.cells[name](args);
          const ports = (c.getPorts?.() || []).map(p => `${p.id}(b${typeof p.bits === 'object' ? JSON.stringify(p.bits) : p.bits})`);
          const sz = c.get('size');
          return { ok: true, ports: ports.join(','), size: sz ? `${Math.round(sz.width)}x${sz.height == null ? 'auto' : Math.round(sz.height)}` : null };
        } catch (e) { return { ok: false, err: String(e).slice(0, 90) }; }
      };
      const G = () => new Map([[0,1],[1,1],[2,1],[3,1]]);
      return {
        BusGroup_map: tryMake('BusGroup', { type: 'BusGroup', groups: G() }),
        BusUngroup_map: tryMake('BusUngroup', { type: 'BusUngroup', groups: G() }),
        BusSlice_slice: tryMake('BusSlice', { type: 'BusSlice', slice: { first: 0, count: 4, total: 8 } }),
        Memory_rw: tryMake('Memory', { type: 'Memory', bits: 4, abits: 2, rdports: [{}], wrports: [{}] }),
        Memory_rd: tryMake('Memory', { type: 'Memory', bits: 4, abits: 2, rdports: [{}] }),
      };
    });
    Object.entries(probe).forEach(([k, v]) => console.log(k + ':', JSON.stringify(v)));
    // Clock 的周期属性是否存在
    const clk = await page.evaluate(() => {
      const dj = window.digitaljs;
      const c = new dj.cells.Clock({ type: 'Clock' });
      return { period: c.get('period'), phase: c.get('phase'), attrs: Object.keys(c.attributes) };
    });
    console.log('Clock 属性:', JSON.stringify(clk));
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
