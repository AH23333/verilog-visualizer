// R78 探针（只打读数）：重开文件后仿真起不来，到底是哪颗器件带来的。
//
// 起因（同一场次里的两条读数对不上，r76/r77）：
//  · r77 对照组（一颗 And 的文件）：重开后 running=true、手动 stop()+start() 之后 tick 正常往前走；
//  · r76 [6]（文件里有 MuxSparse＋几颗常量）：重开后 running=false，点按钮不管用，
//    连 `stop()` + `start()` 之后还是 false ⇒ 引擎起不来。
// 我这一批刚把 MuxSparse/Repeater 接进元件库 —— **不能带着"重开就起不来"这种洞收口**，
// 所以按器件一场一场地量：每场新建一个只放一颗器件的文件、存盘、reload、重开，然后打：
//   running / tick（静置 2.5 s 前后）/ 手动 start() 的异常文字 / 控制台 error / 图里 cell 数。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1781; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

const STATE = () => {
  const c = window.__sandboxCircuit;
  const b = document.querySelector('button[title="运行 / 暂停仿真"]');
  return {
    hasCircuit: !!c, running: !!(c && c.running),
    tick: (c && c._engine && c._engine._tick) ?? null,
    interval: c && c.interval, hasEngine: !!(c && c._engine),
    btnText: b ? (b.textContent || '').trim() : null,
    cells: window.__sandboxPaper ? window.__sandboxPaper.model.getCells().length : null,
  };
};
const TRY = () => {
  const c = window.__sandboxCircuit;
  if (!c) return { err: '没有 circuit' };
  const out = {};
  try { c.stop(); } catch (e) { out.stopErr = String(e && e.message || e).slice(0, 200); }
  try { c.start(); } catch (e) { out.startErr = String(e && e.message || e).slice(0, 200); }
  out.rightAfter = !!c.running;
  try { out.engineType = String(c._engine && c._engine.constructor && c._engine.constructor.name); } catch { }
  return out;
};

async function scene(page, gate) {
  const cerr = [];
  const collect = (m) => { if (m.type() === 'error') cerr.push(m.text().slice(0, 220)); };
  page.on('console', collect);
  await UI.enterSandbox(page);
  await UI.newSandboxFile(page);
  await UI.clickGate(page, gate); await sleep(900);
  const id = await page.evaluate((t) => {
    const p = window.__sandboxPaper;
    const c = p.model.getElements().find((e) => String(e.get('type')) === t);
    return c ? String(c.id) : null;
  }, gate);
  if (!id) { console.log(`\n### ${gate}：画布上没有这颗器件（元件库里没进来？）`); page.off('console', collect); return; }
  await page.evaluate(() => window.__sandboxSave && window.__sandboxSave());
  await sleep(900);
  const file = await page.evaluate(async (a) => {
    const { sandboxStore } = await import('/src/store/sandboxStore.ts');
    for (const f of sandboxStore.list()) {
      if (!f.graphJson) continue;
      try { if (JSON.parse(f.graphJson).cells.some((x) => String(x.id) === a)) return f.name; } catch { }
    }
    return null;
  }, id);
  const before = await page.evaluate(STATE);
  await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2600);
  try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
  if (!(await UI.backToSandbox(page))) { console.log(`\n### ${gate}：回不到沙盒`); page.off('console', collect); return; }
  if (file) { try { await page.locator('span').filter({ hasText: String(file).replace(/\.djs$/, '') }).first().click(); await sleep(1800); } catch { } }
  const t0 = await page.evaluate(STATE);
  await sleep(2500);
  const t1 = await page.evaluate(STATE);
  const tried = await page.evaluate(TRY);
  await sleep(2500);
  const t2 = await page.evaluate(STATE);
  console.log(`\n### ${gate}（文件=${J(file)}）`);
  console.log('   存盘前       ', J(before));
  console.log('   重开瞬间     ', J(t0));
  console.log('   静置 2.5 s 后', J(t1), '  ← tick 没走就是没在跑');
  console.log('   start() 结果 ', J(tried));
  console.log('   再等 2.5 s   ', J(t2));
  console.log('   控制台 error ', J(cerr.slice(0, 4)));
  page.off('console', collect);
}

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    try { server.unref(); } catch { }
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1000);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }

    // 一场景一进程：上一场的画面状态会把下一场的 enterSandbox 卡住（r78 第一次跑就是这样，
    // 读不到数就等于没测），所以设备名从命令行传进来，一次只测一颗。
    const which = (process.argv[2] || 'And').split(',');
    for (const g of which) await scene(page, g);
    console.log('\n[E] 页面异常 =', J(perr.slice(0, 5)));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 500));
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
