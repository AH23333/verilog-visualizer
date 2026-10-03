// 探测新增器件的真实端口结构：Dff / Display7 / Constant / 加减乘
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1481;
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
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' }); await sleep(2000);
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);

    const probe = await page.evaluate(() => {
      const dj = window.digitaljs;
      const out = {};
      const tryMake = (name, args) => {
        try {
          const c = new dj.cells[name](args);
          const ports = (c.getPorts?.() || []).map(p => `${p.id}(${p.group}/${p.dir}${p.portlabel ? ':' + p.portlabel : ''})`);
          const sz = c.get('size');
          return { ok: true, ports, size: sz ? `${Math.round(sz.width)}x${sz.height === undefined || sz.height === null ? 'auto' : Math.round(sz.height)}` : null, bits: c.get('bits') };
        } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
      };
      out.Dff_clock = tryMake('Dff', { type: 'Dff', bits: 1, polarity: { clock: 1 } });
      out.Dff_noclock = tryMake('Dff', { type: 'Dff', bits: 1 });
      out.Display7 = tryMake('Display7', { type: 'Display7', bits: 8 });
      out.Constant = tryMake('Constant', { type: 'Constant', constant: '0' });
      out.Constant4 = tryMake('Constant', { type: 'Constant', constant: '1010' });
      out.Addition = tryMake('Addition', { type: 'Addition', bits: 4 });
      out.Subtraction = tryMake('Subtraction', { type: 'Subtraction', bits: 4 });
      out.Multiplication = tryMake('Multiplication', { type: 'Multiplication', bits: 4 });
      out.Mux = tryMake('Mux', { type: 'Mux', bits: { in: 1, sel: 1 } });
      return out;
    });
    Object.entries(probe).forEach(([k, v]) => console.log(k + ':', JSON.stringify(v)));
    // 实际加入画布，确认渲染不出错
    const added = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const res = {};
      const add = (name, args) => { try { const c = new dj.cells[name](args); p.model.addCell(c); return c.id; } catch (e) { return 'ERR:' + String(e).slice(0, 80); } };
      res.dff = add('Dff', { type: 'Dff', bits: 1, position: { x: 100, y: 100 }, polarity: { clock: 1 } });
      res.disp = add('Display7', { type: 'Display7', bits: 8, position: { x: 300, y: 100 } });
      res.konst = add('Constant', { type: 'Constant', constant: '1', position: { x: 100, y: 300 } });
      res.add = add('Addition', { type: 'Addition', bits: 4, position: { x: 300, y: 300 } });
      return res;
    });
    console.log('加入画布:', JSON.stringify(added));
    await sleep(900);
    const views = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return p.model.getCells().filter(c => !c.isLink()).map(c => {
        const v = c.findView(p);
        const r = v?.el?.getBoundingClientRect();
        const ports = (c.getPorts?.() || []).map(x => x.id);
        return { t: c.get('type'), rendered: !!v, w: r ? Math.round(r.width) : -1, h: r ? Math.round(r.height) : -1, ports: ports.join(',') };
      });
    });
    console.log('渲染情况:');
    views.forEach(v => console.log('  ', JSON.stringify(v)));
    console.log('pageerrors:', JSON.stringify(errors.slice(0, 4)));
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
