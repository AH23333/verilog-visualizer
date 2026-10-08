// R77 探针（只打读数）：重开带稀疏选择器的文件后，仿真到底起不起得来。
//
// 起因（r76 的两条读数对不上，不是猜）：
//   [4]（还没 reload 前）  running=true、tick 686→772、按钮文字「暂停」        ← 正常
//   [Repeater]（reload 后） running=false、tick 一直 =1，可按钮文字还是「暂停」 ← 界面说在跑、引擎没跑
//   连点三次之后按钮只剩「运行」，tick 还是 1 ⇒ 要么 `circuit.start()` 抛了，
//   要么"起仿真"这条路被某个状态（runningRef）判成"已经在跑"而直接跳过。
// r42 那批修过一次同族（挂载 effect 里 runningRef 恒 true ⇒ 显示暂停、电路冻结）。
// 这一发要分清的是：**是我刚接进来的 MuxSparse 让引擎起不来（那就是我这批的新缺陷），
// 还是任何文件重开都起不来（那是老账）**。所以对照组用最普通的 And。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1771; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

const STATE = () => {
  const c = window.__sandboxCircuit;
  const b = document.querySelector('button[title="运行 / 暂停仿真"]');
  return {
    hasCircuit: !!c,
    running: !!(c && c.running),
    tick: (c && c._engine && c._engine._tick) ?? null,
    interval: c && c.interval,
    btnText: b ? (b.textContent || '').trim() : null,
    cells: window.__sandboxPaper ? window.__sandboxPaper.model.getCells().length : null,
  };
};

/** 直接调 start()/stop() 并把异常文字带回来 —— 绕开按钮，先看引擎本身行不行 */
const TRY_START = () => {
  const c = window.__sandboxCircuit;
  if (!c) return { err: '没有 circuit' };
  let stopErr = null, startErr = null;
  try { c.stop(); } catch (e) { stopErr = String(e && e.message || e).slice(0, 160); }
  try { c.start(); } catch (e) { startErr = String(e && e.message || e).slice(0, 160); }
  return { stopErr, startErr, running: !!c.running };
};

async function scene(page, label, gate) {
  await UI.enterSandbox(page);
  await UI.newSandboxFile(page);
  await UI.clickGate(page, gate); await sleep(800);
  const id = await page.evaluate((t) => {
    const p = window.__sandboxPaper;
    const c = p.model.getElements().find((e) => String(e.get('type')) === t);
    return c ? String(c.id) : null;
  }, gate);
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
  console.log(`\n### ${label}（器件=${gate} 文件=${J(file)}）`);
  console.log('   [存盘前]', J(await page.evaluate(STATE)));

  await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2600);
  try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
  if (!(await UI.backToSandbox(page))) { console.log('   回不到沙盒，这一场不作数'); return; }
  if (file) {
    try { await page.locator('span').filter({ hasText: String(file).replace(/\.djs$/, '') }).first().click(); await sleep(1800); } catch (e) { console.log('   点不开文件', String(e).slice(0, 90)); }
  }
  console.log('   [重开后]', J(await page.evaluate(STATE)));
  console.log('   [直接 start()]', J(await page.evaluate(TRY_START)));
  await sleep(1200);
  console.log('   [start 之后再读]', J(await page.evaluate(STATE)));
  const btn = page.locator('button[title="运行 / 暂停仿真"]').first();
  if (await btn.count()) { await btn.evaluate((el) => el.click()); await sleep(1200); console.log('   [点一次按钮之后]', J(await page.evaluate(STATE))); }
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
    const perr = []; const cerr = [];
    page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') cerr.push(m.text().slice(0, 200)); });
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1000);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }

    await scene(page, '对照组：最普通的一颗 And', 'And');
    await scene(page, '被测组：稀疏选择器 MuxSparse', 'MuxSparse');
    console.log('\n[E] 页面异常 =', J(perr.slice(0, 4)));
    console.log('[E2] 控制台 error =', J(cerr.slice(0, 6)));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 500));
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
