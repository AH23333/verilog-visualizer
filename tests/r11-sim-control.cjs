// R11 仿真控制验收：Reset（真重置，保拓扑）/ Pause（冻结仿真）/ Step（单步推进）
// 用法: node tests/r11-sim-control.cjs
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1427;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1427)); } catch { }
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
const ok = (n, m = '') => { results.pass++; console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`); };
const bad = (n, m = '') => { results.fail++; console.log(`  FAIL  ${n}${m ? ' — ' + m : ''}`); };

async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}

async function dragWire(page) {
  const magnets = await page.evaluate(() => {
    const ms = document.querySelectorAll('[magnet]');
    return [...ms].filter(m => m.getAttribute('magnet') !== 'false').map(m => {
      const r = m.getBoundingClientRect();
      const pb = m.closest('.joint-port-body');
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, port: pb?.getAttribute('port'), val: m.getAttribute('magnet') };
    });
  });
  const src = magnets.find(m => m.port === 'out');
  const tgt = magnets.find(m => m.port === 'in');
  if (!src || !tgt) return false;
  await page.mouse.move(src.x, src.y); await page.mouse.down(); await sleep(150);
  await page.mouse.move((src.x + tgt.x) / 2, (src.y + tgt.y) / 2, { steps: 3 }); await sleep(80);
  await page.mouse.move(tgt.x, tgt.y, { steps: 5 }); await sleep(250);
  await page.mouse.up(); await sleep(400);
  return true;
}
async function lampFill(page) {
  // ⚠ 旧版找 `[data-type="Lamp"]`：src 里根本没有这个属性 ⇒ 恒返回 ''，"灯亮没亮"从来没被量到过。
  //   现在从 paper 的模型出发回到那颗视图；画布上没有 Lamp 就直接抛，别让 null 冒充一种颜色。
  const f = await require('./_ui.cjs').cellFill(page, 'Lamp');
  if (f === null) throw new Error('lampFill: 画布上没有 Lamp 器件，这条判据够不着');
  return f;
}
const isLit = (f) => f === '#03c03c' || f === 'rgb(3,192,60)' || f === 'rgb(3, 192, 60)';
const clickGate = (page, label) => require('./_ui.cjs').clickGate(page, label);   // 旧的本地版用 ?.click() 静默空转
async function boot(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.removeItem('verilog-viz-sandbox-files'); localStorage.removeItem('verilog-viz-sandbox-active'); });
  await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
  try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
  await require('./_ui.cjs').newSandboxFile(page);
}

(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });

    console.log('[A] Reset — true reset, topology preserved');
    await boot(page);
    await clickGate(page, 'Input'); await clickGate(page, 'Lamp'); await sleep(300);
    const w1 = await dragWire(page);
    const before = await page.evaluate(() => { const p = window.__sandboxPaper; return { cells: p.model.getCells().length, links: p.model.getLinks().length, cid: p.cid }; });
    const btnPos = await require('./_ui.cjs').cellRect(page, 'Input');
    if (!btnPos) throw new Error('找不到 Input 的盒体（器件没放上去，后面的点击不作数）');
    await page.mouse.click(btnPos.x, btnPos.y); await sleep(500);
    const lampOn = await lampFill(page);
    w1 ? ok('wire Button.out -> Lamp.in drawn') : bad('wire Button.out -> Lamp.in drawn');
    before.links >= 1 ? ok('wire connected before reset', `links=${before.links}`) : bad('wire connected before reset', `links=${before.links}`);
    isLit(lampOn) ? ok('Button ON lights Lamp') : bad('Button ON lights Lamp', `fill=${lampOn}`);

    await page.locator('button[title="复位仿真"]').click(); await sleep(1000);
    const after = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return { cells: p.model.getCells().length, links: p.model.getLinks().length, cid: p.cid,
        wrapperCount: document.querySelectorAll('[data-sandbox-wrapper]').length,
        svgCount: document.querySelectorAll('[data-sandbox-wrapper] svg').length };
    });
    const lampAfterReset = await lampFill(page);
    after.wrapperCount === 1 ? ok('wrapper survives Reset') : bad('wrapper survives Reset', `count=${after.wrapperCount}`);
    after.svgCount >= 1 ? ok('paper re-created after Reset', `svg=${after.svgCount}`) : bad('paper re-created after Reset', `svg=${after.svgCount}`);
    after.cid !== before.cid ? ok('effect rebuilt paper on Reset', `${before.cid}->${after.cid}`) : bad('effect rebuilt paper', `unchanged ${after.cid}`);
    after.cells === before.cells ? ok('topology preserved (cells)', `${before.cells}->${after.cells}`) : bad('topology preserved (cells)', `${before.cells}->${after.cells}`);
    after.links === before.links ? ok('topology preserved (links)', `${before.links}->${after.links}`) : bad('topology preserved (links)', `${before.links}->${after.links}`);
    !isLit(lampAfterReset) ? ok('Reset returns Lamp to power-on (off)', `fill=${lampAfterReset}`) : bad('Reset returns Lamp to power-on', `fill=${lampAfterReset}`);

    console.log('[B] Pause + Step');
    await require('./_ui.cjs').newSandboxFile(page);
    await clickGate(page, 'Clock'); await clickGate(page, 'Lamp'); await sleep(300);
    const w2 = await dragWire(page);
    const linksB = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
    w2 && linksB >= 1 ? ok('wire Clock.out -> Lamp.in drawn', `links=${linksB}`) : bad('wire Clock.out -> Lamp.in drawn', `links=${linksB}`);

    await page.locator('button[title="运行 / 暂停仿真"]').click(); await sleep(300);
    const runningAfterPause = await page.evaluate(() => window.__sandboxCircuit?.running ?? null);
    // ⚠ 上游没有公开的 tick 读数：字段是 `_tick`（bundle：`this._tick = t+1|0`）。
    //   原来读 `?.tick ?? -1` 恒为 -1 ⇒ "暂停后 tick 不动"三颗相等＝空过，而"单步会推进"必然假红。
    //   读不到就判红，不再让 null 冒充"稳定"。
    const tickOf = () => page.evaluate(() => {
      const c = window.__sandboxCircuit;
      if (!c) return null;
      // 引擎是 Circuit._engine（bundle：`this._engine=new e(this._graph,i)`），`_tick` 住在那颗上，
      // 读 circuit._tick 恒 undefined ⇒ 两格判据够不着（这轮实测就是 null/null/null）。
      const e = c._engine || c;
      return typeof e._tick === 'number' ? e._tick : null;
    });
    const tA = await tickOf(); await sleep(250);
    const tB = await tickOf(); await sleep(250);
    const tC = await tickOf();
    (tA === null || tB === null || tC === null)
      ? bad('Pause freezes sim (tick stable)', `_tick 读不到：${tA}/${tB}/${tC} —— 这条判据够不着，不许空过`)
      : ((tA === tB && tB === tC) ? ok('Pause freezes sim (tick stable)', `${tA}/${tB}/${tC}, running=${runningAfterPause}`)
        : bad('Pause freezes sim', `${tA}/${tB}/${tC}, running=${runningAfterPause}`));
    const lampBefore = await lampFill(page);
    await page.locator('button[title="单步执行"]').click(); await sleep(400);
    const tAfter = await tickOf();
    const lampAfter = await lampFill(page);
    (tAfter === null || tC === null)
      ? bad('Step advances paused sim', `_tick 读不到：${tC}->${tAfter}，这条判据够不着`)
      : ((tAfter > tC) ? ok('Step advances paused sim', `${tC}->${tAfter} (+${tAfter - tC})`)
        : bad('Step advances paused sim', `${tC}->${tAfter}`));
    (lampBefore !== lampAfter) ? ok('Step flips Clock-driven Lamp', `${lampBefore} -> ${lampAfter}`) : bad('Step flips Clock-driven Lamp', `${lampBefore} -> ${lampAfter}`);
    const pauseLabel = await page.locator('button[title="运行 / 暂停仿真"]').textContent();
    pauseLabel.trim() === '运行' ? ok('Pause toggled label to 运行') : bad('Pause label', pauseLabel);

    dialogs.length === 0 ? ok('0 native dialogs') : bad('native dialogs', dialogs.join('; '));
    const typeErrors = errors.filter(e => /TypeError/i.test(e));
    typeErrors.length === 0 ? ok('0 TypeErrors', `total=${errors.length}`) : bad('TypeErrors', typeErrors.join('; '));

    await page.screenshot({ path: path.join(PROJECT_ROOT, '.tmpbuild', 'r11-final.png') });
    console.log(`\n[DONE] ${results.pass} pass, ${results.fail} fail`);
    await browser.close(); server.kill();
    process.exit(results.fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('FATAL:', e); try { browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(2);
  }
})();
