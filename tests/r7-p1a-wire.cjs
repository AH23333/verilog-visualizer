// R7.4 P1-a 连线验收脚本
// 用法: node tests/r7-p1a-wire.cjs
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
// playwright-core lives in the sibling .tmpbuild workspace, not the project node_modules
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, '..', '.tmpbuild', 'node_modules', 'playwright-core'));
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
    try {
      const res = await fetch(URL);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  // Start vite
  console.log('[1/6] starting vite dev server...');
  // Kill existing on port
  try { execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: PROJECT_ROOT, shell: true, stdio: 'pipe',
  });
  await waitForServer();

  console.log('[2/6] launching Edge headless...');
  browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const dialogs = [];
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

  // Enter sandbox
  console.log('[3/6] entering sandbox, placing Button + Lamp...');
  await page.locator('button[title="Sandbox"]').click();
  await page.waitForTimeout(1000);
  await page.locator('button[title="New file"]').click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Button')?.click());
  await page.waitForTimeout(800);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Lamp')?.click());
  await page.waitForTimeout(800);

  // P1a-1: wire creation via magnet drag
  console.log('[4/6] dragging wire Button.out → Lamp.in...');
  const magnets = await page.evaluate(() => {
    const ms = document.querySelectorAll('[magnet="true"]');
    return [...ms].map(m => {
      const r = m.getBoundingClientRect();
      const portBody = m.closest('.joint-port-body');
      return { x: r.x + r.width/2, y: r.y + r.height/2, port: portBody?.getAttribute('port') };
    });
  });
  results.facts.magnets = magnets;
  console.log('       magnets:', JSON.stringify(magnets));

  // Find Button.out and Lamp.in by port name
  const src = magnets.find(m => m.port === 'out');
  const tgt = magnets.find(m => m.port === 'in');
  if (!src || !tgt) {
    // Fallback: try by position (rightmost out → leftmost in)
    const sorted = [...magnets].sort((a, b) => a.x - b.x);
    const s = sorted[1] || sorted[0];
    const t = sorted[sorted.length - 2] || sorted[sorted.length - 1];
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.move((s.x + t.x)/2, (s.y + t.y)/2, { steps: 3 });
    await page.waitForTimeout(100);
    await page.mouse.move(t.x, t.y, { steps: 5 });
    await page.waitForTimeout(300);
    await page.mouse.up();
  } else {
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

  const wireCount = await page.evaluate(() =>
    document.querySelectorAll('.joint-type-wire, .joint-link, [joint-selector="wire"]').length
  );
  results.facts.wireCount = wireCount;
  wireCount >= 1 ? ok('P1a-1: links ≥ 1', `count=${wireCount}`) : bad('P1a-1: links ≥ 1', `count=${wireCount}`);

  // P1a-2: signal propagation — click Button, check wire stroke + Lamp fill
  console.log('[5/6] clicking Button, checking signal propagation...');
  const beforeState = await page.evaluate(() => {
    const wire = document.querySelector('.joint-type-wire, .joint-link');
    const lamp = document.querySelector('.joint-type-lamp, [data-type="Lamp"]');
    return {
      wireStroke: wire?.querySelector('path')?.getAttribute('stroke') || wire?.querySelector('path')?.style.stroke,
      lampFill: lamp?.querySelector('.body')?.getAttribute('fill') || lamp?.querySelector('.body')?.style.fill,
    };
  });
  results.facts.before = beforeState;

  // Click the Button cell to toggle it
  await page.evaluate(() => {
    const btn = document.querySelector('[data-type="Button"]');
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(500);

  const afterState = await page.evaluate(() => {
    const wire = document.querySelector('.joint-type-wire, .joint-link');
    const lamp = document.querySelector('.joint-type-lamp, [data-type="Lamp"]');
    return {
      wireStroke: wire?.querySelector('path')?.getAttribute('stroke') || wire?.querySelector('path')?.style.stroke,
      lampFill: lamp?.querySelector('.body')?.getAttribute('fill') || lamp?.querySelector('.body')?.style.fill,
    };
  });
  results.facts.after = afterState;
  console.log('       before:', JSON.stringify(beforeState));
  console.log('       after: ', JSON.stringify(afterState));

  const propagated = afterState.wireStroke !== beforeState.wireStroke || afterState.lampFill !== beforeState.lampFill;
  wireCount >= 1 && propagated ? ok('P1a-2: signal propagates', 'wire/lamp color changed') : bad('P1a-2: signal propagates', 'no color change');

  // P1a-3/4: no dialogs, no TypeErrors
  dialogs.length === 0 ? ok('P1a-3: 0 native dialogs') : bad('P1a-3: native dialogs', dialogs.join('; '));
  const typeErrors = errors.filter(e => /TypeError/i.test(e));
  typeErrors.length === 0 ? ok('P1a-4: 0 TypeErrors', `total errors=${errors.length}`) : bad('P1a-4: TypeErrors', typeErrors.join('; '));

  await page.screenshot({ path: path.join(PROJECT_ROOT, '.tmpbuild', 'r7-p1a-final.png') });

  console.log(`[6/6] DONE: ${results.pass} pass, ${results.fail} fail`);
  console.log('facts:', JSON.stringify(results.facts, null, 2));

  await browser.close();
  server.kill();
  process.exit(results.fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); try { browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(2); });
