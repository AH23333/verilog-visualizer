// R7.4 P1-a 连线验收脚本
// 用法: node tests/r7-p1a-wire.cjs
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1420;
const URL = `http://localhost:${PORT}/`;

let server;
let browser;
const results = { pass: 0, fail: 0, facts: {} };

function ok(name, msg = '') { results.pass++; console.log(`  PASS  ${name}${msg ? ' — ' + msg : ''}`); }
function bad(name, msg = '') { results.fail++; console.log(`  FAIL  ${name}${msg ? ' — ' + msg : ''}`); }

async function waitForServer(timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const res = await fetch(URL); if (res.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  console.log('[1/6] starting vite dev server...');
  try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
  await waitForServer();

  console.log('[2/6] launching Edge headless...');
  browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; const dialogs = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.removeItem('verilog-viz-sandbox-files');
    localStorage.removeItem('verilog-viz-sandbox-active');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
  await page.waitForTimeout(500);

  console.log('[3/6] entering sandbox, placing Button + Lamp...');
  await page.locator('button[title="Sandbox"]').click();
  await page.waitForTimeout(1000);
  await page.locator('button[title="New file"]').click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Button')?.click());
  await page.waitForTimeout(800);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Lamp')?.click());
  await page.waitForTimeout(800);

  console.log('[4/6] dragging wire Button.out → Lamp.in...');
  // Find all non-false magnets
  const magnets = await page.evaluate(() => {
    const ms = document.querySelectorAll('[magnet]');
    return [...ms].filter(m => m.getAttribute('magnet') !== 'false').map(m => {
      const r = m.getBoundingClientRect();
      const portBody = m.closest('.joint-port-body');
      return { x: r.x + r.width/2, y: r.y + r.height/2, port: portBody?.getAttribute('port'), val: m.getAttribute('magnet') };
    });
  });
  results.facts.magnets = magnets;
  console.log('       magnets:', JSON.stringify(magnets));

  const src = magnets.find(m => m.port === 'out');
  const tgt = magnets.find(m => m.port === 'in');
  if (src && tgt) {
    await page.mouse.move(src.x, src.y);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.move((src.x + tgt.x)/2, (src.y + tgt.y)/2, { steps: 3 });
    await page.waitForTimeout(100);
    await page.mouse.move(tgt.x, tgt.y, { steps: 5 });
    await page.waitForTimeout(300);
    await page.mouse.up();
  }
  await page.waitForTimeout(1000);

  // P1a-1: model-level assertion via window.__sandboxPaper
  const linkCount = await page.evaluate(() => {
    const paper = window.__sandboxPaper;
    if (!paper) return -1;
    return paper.model.getLinks().length;
  });
  results.facts.linkCount = linkCount;
  linkCount >= 1 ? ok('P1a-1: model links >= 1', `count=${linkCount}`) : bad('P1a-1: model links >= 1', `count=${linkCount}`);

  console.log('[5/6] clicking Button, checking Lamp lights up...');
  const beforeFill = await page.evaluate(() => {
    const lamp = document.querySelector('[data-type="Lamp"]');
    if (!lamp) return '';
    // try multiple selectors
    return lamp.querySelector('circle')?.getAttribute('fill')
      || lamp.querySelector('rect')?.getAttribute('fill')
      || lamp.querySelector('.body')?.getAttribute('fill') || '';
  });

  // Real pointer click on Button cell body
  const btnPos = await page.evaluate(() => {
    const btn = document.querySelector('[data-type="Button"]');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  if (btnPos) {
    await page.mouse.click(btnPos.x, btnPos.y);
    await page.waitForTimeout(500);
  }

  const afterFill = await page.evaluate(() => {
    const lamp = document.querySelector('[data-type="Lamp"]');
    if (!lamp) return '';
    return lamp.querySelector('circle')?.getAttribute('fill')
      || lamp.querySelector('rect')?.getAttribute('fill')
      || lamp.querySelector('.body')?.getAttribute('fill') || '';
  });
  results.facts.lampFill = { before: beforeFill, after: afterFill };
  console.log('       lamp fill: before=' + JSON.stringify(beforeFill) + ' after=' + JSON.stringify(afterFill));

  // Explicit: Lamp lit — fill must be the on-state green (#03c03c)
  const lit = afterFill === '#03c03c' || afterFill === 'rgb(3,192,60)' || afterFill === 'rgb(3, 192, 60)';
  lit ? ok('P1a-2: Lamp lights up', `fill=${afterFill}`) : bad('P1a-2: Lamp lights up', `expected #03c03c, got ${afterFill}`);

  dialogs.length === 0 ? ok('P1a-3: 0 native dialogs') : bad('P1a-3: native dialogs', dialogs.join('; '));
  const typeErrors = errors.filter(e => /TypeError/i.test(e));
  typeErrors.length === 0 ? ok('P1a-4: 0 TypeErrors', `total=${errors.length}`) : bad('P1a-4: TypeErrors', typeErrors.join('; '));

  await page.screenshot({ path: path.join(PROJECT_ROOT, '.tmpbuild', 'r7-p1a-final.png') });

  console.log(`[6/6] DONE: ${results.pass} pass, ${results.fail} fail`);
  console.log('facts:', JSON.stringify(results.facts, null, 2));

  await browser.close();
  server.kill();
  process.exit(results.fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); try { browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(2); });
