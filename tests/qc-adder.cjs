// 诊断：加法器场景各点信号
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1484;
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
    page.on('pageerror', e => console.log('PAGEERR', String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' }); await sleep(2000);
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);

    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const add = (C, args) => { const c = new dj.cells[C](args); p.model.addCell(c); return c.id; };
      return {
        c1: add('Constant', { type: 'Constant', constant: '0010', position: { x: 150, y: 150 } }),
        c2: add('Constant', { type: 'Constant', constant: '0011', position: { x: 150, y: 300 } }),
        adder: add('Addition', { type: 'Addition', bits: 4, position: { x: 420, y: 220 } }),
      };
    });
    await sleep(1200);   // 给常量输出充分时间稳定
    // 用模型直连（排除拖拽因素）
    const linked = await page.evaluate((ids) => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const mk = (s, sp, t, tp) => p.model.addCell(new dj.cells.Wire({ source: { id: s, port: sp }, target: { id: t, port: tp }, netname: 'D' + Math.random(), signal: 'x' }));
      mk(ids.c1, 'out', ids.adder, 'in1');
      mk(ids.c2, 'out', ids.adder, 'in2');
      return true;
    }, ids);
    await sleep(1500);
    const dump = await page.evaluate((ids) => {
      const p = window.__sandboxPaper;
      const sig = (id, which) => {
        const c = p.model.getCell(id);
        const o = which === 'in' ? c?.get('inputSignals') : c?.get('outputSignals');
        const v = which === 'in' ? o?.in1 ?? o?.in2 : o?.out;
        return v ? v.toString() : 'n/a';
      };
      return {
        c1_const: p.model.getCell(ids.c1).get('constant'),
        c1_out: sig(ids.c1, 'out'),
        c2_out: sig(ids.c2, 'out'),
        adder_in1: (() => { const o = p.model.getCell(ids.adder).get('inputSignals'); return o?.in1 ? o.in1.toString() : 'n/a'; })(),
        adder_in2: (() => { const o = p.model.getCell(ids.adder).get('inputSignals'); return o?.in2 ? o.in2.toString() : 'n/a'; })(),
        adder_out: sig(ids.adder, 'out'),
        adder_bits: p.model.getCell(ids.adder).get('bits'),
        links: p.model.getLinks().length,
      };
    }, ids);
    console.log('信号转储:', JSON.stringify(dump, null, 1));
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
