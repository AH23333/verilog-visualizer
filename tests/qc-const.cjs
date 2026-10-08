// 诊断：Constant 加入已运行电路后输出为何是 0
const { spawn } = require('child_process');
const UI = require('./_ui.cjs');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1483;
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
    await UI.newSandboxFile(page);

    const r1 = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const c = new dj.cells.Constant({ type: 'Constant', constant: '0010', position: { x: 200, y: 200 } });
      const before = {
        hasPrepare: typeof c.prepare === 'function',
        cacheBeforeAdd: c.get('constantCache') ? c.get('constantCache').toString() : null,
      };
      p.model.addCell(c);
      const out = () => { const o = c.get('outputSignals'); const v = o?.out; return v ? v.toString() : 'n/a'; };
      return {
        before, outAfterAdd: out(),
        cacheAfterAdd: c.get('constantCache') ? c.get('constantCache').toString() : null,
      };
    });
    console.log('加入后:', JSON.stringify(r1));
    await sleep(900);
    const r2 = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(x => x.get('type') === 'Constant');
      const o = c.get('outputSignals'); const v = o?.out;
      const outBefore = v ? v.toString() : 'n/a';
      let prepared = null;
      try { c.prepare?.(); prepared = 'called'; } catch (e) { prepared = 'ERR:' + String(e).slice(0, 60); }
      const outAfterPrepare = (() => { const o = c.get('outputSignals'); const x = o?.out; return x ? x.toString() : 'n/a'; })();
      return { outBefore, prepared, outAfterPrepare, cache: c.get('constantCache') ? c.get('constantCache').toString() : null };
    });
    console.log('等待 0.9s 后 + 手动 prepare:', JSON.stringify(r2));
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
