// R73 探针（只打读数）：拖线**中途扫过一颗已驱动的输入端口**之后，是谁把那个端口留在 x。
//
// 背景：r71 [8] 这条臂在 finalizeWire 补了 prev 重播之后**仍然是红的**
//   （in1 "Vector3vl 0" → "Vector3vl x"，而终点 ZeroExtend.in 反而是好的 0）。
//   同一族动作在 r21 上却已经被修好了（gt 那格从红转绿）⇒ 差别只在"扫过的那一口是不是
//   最后一次 set 的 previous"。这里把时间线打全：每次 inputSignals 变化记 old→new + 调用栈，
//   然后看那次 x 是**谁**写的（本仓的帧 or digitaljs 内部帧）。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1731; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

const center = (page, type, port) => page.evaluate((a) => {
  const p = window.__sandboxPaper;
  const c = p && p.model.getElements().find((e) => String(e.get('type')) === a.type);
  if (!c) return { noCell: true };
  const v = p.findViewByModel(c);
  const el = v && v.el.querySelector(`.joint-port-body[port="${a.port}"] circle`);
  if (!el) return { noMagnet: true };
  const r = el.getBoundingClientRect();
  return { id: String(c.id), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}, { type, port });

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
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1000);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
    await UI.enterSandbox(page);
    await UI.clickGate(page, 'Constant'); await sleep(600);
    await UI.clickGate(page, 'And'); await sleep(600);
    await UI.clickGate(page, 'ZeroExtend'); await sleep(600);

    // 第一步：正常把 Constant.out → And.in1 连上
    const c0 = await center(page, 'Constant', 'out');
    const a1 = await center(page, 'And', 'in1');
    await page.mouse.move(c0.x, c0.y); await page.mouse.down(); await sleep(140);
    await page.mouse.move((c0.x + a1.x) / 2, (c0.y + a1.y) / 2, { steps: 4 }); await sleep(120);
    await page.mouse.move(a1.x, a1.y, { steps: 5 }); await sleep(240); await page.mouse.up(); await sleep(700);
    const first = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getElements().find((e) => String(e.get('type')) === 'And');
      return { in1: String((c.get('inputSignals') || {}).in1 ?? '—'), links: p.model.getLinks().length };
    });
    console.log('[1] 连好 Constant→And.in1 =', J(first));

    // 挂记录器：And 的 inputSignals 每变一次记 old→new + 栈（留 22 帧，看清 _setInput 是谁调的）；
    // 同时记每根连线 signal 的变化 —— 若"幸存的那根线"自己也被短暂写成 x，
    // 那我补的重播就是把 x 又播了一遍，这完全是另一种因。
    await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getElements().find((e) => String(e.get('type')) === 'And');
      window.__tr = [];
      const push = (s) => window.__tr.push(s);
      const stack = () => { try { return new Error().stack.split('\n').slice(1, 24).filter((x) => !/eval at|\[native code\]/.test(x)).join(' <- '); } catch { return ''; } };
      c.on('change:inputSignals', (cell, next) => {
        const prev = cell.previous('inputSignals') || {};
        for (const k of ['in1', 'in2']) {
          const o = String(prev[k]), n = String((next || {})[k]);
          if (o !== n) push(`CELL And.${k}: ${o} → ${n}｜${stack().slice(0, 1500)}`);
        }
      });
      const attach = (l) => {
        l.on('change:signal', (wire, nv) => {
          const o = String(wire.previous('signal')), n = String(nv);
          if (o !== n) push(`WIRE ${String(wire.get('source').id).slice(0, 6)}.out→${String((wire.get('target') || {}).id || '悬空').slice(0, 6)}.${(wire.get('target') || {}).port || '—'}: ${o} → ${n}｜${stack().slice(0, 900)}`);
        });
        l.on('change:target', (wire, nv) => {
          const o = wire.previous('target');
          push(`TARGET → ${String(nv.id || '悬空').slice(0, 6)}.${nv.port || '—'}（上一个 ${String((o && o.id) || '悬空').slice(0, 6)}.${(o && o.port) || '—'}）`);
        });
      };
      for (const l of p.model.getLinks()) attach(l);
      // 临时线是拖线过程中才建的，必须在新建时就挂上记录器
      p.model.on('cell:add', (cell) => { if (cell && typeof cell.isLink === 'function' && cell.isLink()) attach(cell); });
    });

    // 第二步：从 Constant.out 起线，中途先吸 And.in1、再挪到 ZeroExtend.in
    const c1 = await center(page, 'Constant', 'out');
    const a1b = await center(page, 'And', 'in1');
    const zIn = await center(page, 'ZeroExtend', 'in');
    await page.mouse.move(c1.x, c1.y); await page.mouse.down(); await sleep(140);
    await page.mouse.move(a1b.x, a1b.y, { steps: 4 }); await sleep(280);      // 吸在 in1
    const midSnap = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const t = p.model.getLinks().map((l) => ({ tgt: String(l.get('target').id || '').slice(0, 6) + '.' + (l.get('target').port || '悬空'), sig: String(l.get('signal')) }));
      return t;
    });
    console.log('[2] 吸住 in1 那一刻，图上所有线的 target =', J(midSnap));
    await page.mouse.move(zIn.x, zIn.y, { steps: 4 }); await sleep(280);      // 挪到 ZeroExtend.in
    await page.mouse.up(); await sleep(800);

    const end = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const and = p.model.getElements().find((e) => String(e.get('type')) === 'And');
      const z = p.model.getElements().find((e) => String(e.get('type')) === 'ZeroExtend');
      const linksOf = (c) => p.model.getLinks().filter((l) => l.get('target')?.id === c.id)
        .map((l) => l.get('target').port + '←' + String(l.get('source').id).slice(0, 6) + ' sig=' + String(l.get('signal')) + ' warn=' + String(l.get('warning')));
      return {
        andIn1: String((and.get('inputSignals') || {}).in1 ?? '—'),
        zIn: String((z.get('inputSignals') || {}).in ?? '—'),
        andLinks: linksOf(and), zLinks: linksOf(z), totalLinks: p.model.getLinks().length,
        trace: window.__tr,
      };
    });
    console.log('[3] 终态：And.in1 =', J(end.andIn1), 'ZeroExtend.in =', J(end.zIn), 'links =', end.totalLinks);
    console.log('    And 的线：', J(end.andLinks));
    console.log('    ZeroExtend 的线：', J(end.zLinks));
    console.log('[4] 时间线（谁写的）：');
    for (const t of end.trace) console.log('   ', t);
    console.log('[E] 页面异常 =', J(perr.slice(0, 3)));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 500));
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
