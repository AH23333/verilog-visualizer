const { spawn } = require('child_process');
const UI = require('./_ui.cjs');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1434;
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
    page.on('console', m => { if (/SMDEBUG/.test(m.text())) console.log('PAGE>', m.text()); if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    console.log('after sandbox click, errors=', JSON.stringify(errors.slice(0, 5)));
    console.log('data-gate buttons =', await page.evaluate(() => document.querySelectorAll('[data-gate]').length));
    await UI.newSandboxFile(page);
    console.log('activePaper =', await page.evaluate(() => !!window.__sandboxPaper));
    console.log('cells =', await page.evaluate(() => window.__sandboxPaper ? window.__sandboxPaper.model.getCells().length : -1));
    await page.evaluate(() => document.querySelector('button[data-gate="Button"]')?.click());
    await sleep(800);
    console.log('after Button click, types =', await page.evaluate(() => window.__sandboxPaper ? window.__sandboxPaper.model.getCells().map(c => c.get('type')) : 'nopaper'));
    console.log('errors =', JSON.stringify(errors.slice(0, 8)));
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
