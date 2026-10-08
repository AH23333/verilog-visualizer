// Debug: does changing grid size in settings actually update the grid layer?
const { spawn } = require('child_process');
const UI = require('./_ui.cjs');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1436;
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
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k));
    });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await UI.newSandboxFile(page);

    // open settings
    await page.evaluate(() => document.querySelector('button[data-sandbox-settings]')?.click());
    await sleep(800);
    // go to 沙盒 tab (tab buttons have textContent '沙盒', not a className with 'block')
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '沙盒');
      b?.click();
    });
    await sleep(400);

    const beforeGrid = await page.evaluate(() => getComputedStyle(document.querySelector('[data-sandbox-grid]')).backgroundSize);
    const inputInfo = await page.evaluate(() => {
      const gi = document.querySelector('input[data-setting="网格间距"]');
      return gi ? { found: true, value: gi.value, tag: gi.tagName, parent: gi.parentElement?.className } : { found: false };
    });
    console.log('BEFORE grid bgSize =', beforeGrid);
    console.log('INPUT =', JSON.stringify(inputInfo));

    // --- Approach A: real Playwright fill + blur by clicking the toggle area ---
    const gi = page.locator('input[data-setting="网格间距"]');
    await gi.click({ clickCount: 3 });
    await page.keyboard.type('32');
    await sleep(150);
    await page.keyboard.press('Tab'); // real blur -> focusout
    await sleep(900);
    const afterTab = await page.evaluate(() => getComputedStyle(document.querySelector('[data-sandbox-grid]')).backgroundSize);
    console.log('AFTER real-type+Tab grid bgSize =', afterTab);

    // --- Approach B: also try programmatic focusout again, read store indirectly ---
    const storeRead = await page.evaluate(() => {
      // try to read via the input staying 32
      const gi = document.querySelector('input[data-setting="网格间距"]');
      const el = document.querySelector('[data-sandbox-grid]');
      return { inputVal: gi ? gi.value : null, bg: el ? getComputedStyle(el).backgroundSize : null };
    });
    console.log('STORE/INPUT read =', JSON.stringify(storeRead));

    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
