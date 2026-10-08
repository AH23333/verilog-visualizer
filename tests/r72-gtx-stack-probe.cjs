// R72 探针（只打读数）：谁把 gt 的输入端口写成 x。
//
// 现场（r21 拆分后的读数，2026-10-05 跑批 + 单跑各一次，两次一样）：
//   gt 的 in1 上那根线：wireBits=4、端口 4 位、warning=false、signal=Vector3vl 0011，
//   而器件自己看到的 inputSignals.in1 = Vector3vl xxxx；
//   同一颗常量（0011）喂给 lt 的 in1 却一切正常 ⇒ 不是值的问题，是**有人在播完之后把
//   这个端口清了**。`_clearInput` 是唯一会写出这种 x 的通路（上游 @2285659：
//   `remove(){…n._clearInput(t.port)}` 与 `_changeTarget` 里清 previous 那一段）。
//   我已经给 finalizeWire 补了收尾重播（r71 [7] 那条钉得住），gt 这一格却还是 x
//   ⇒ 清它的动作发生在**重播之后**，所以只能问运行时：把 change:inputSignals 的调用栈打出来。
//
// 做法：完全照 r21 [3] 的形状造三颗比较器 + 三颗常量，但在拖线**之前**先给 gt 挂上
// `change:inputSignals` 记录器（每次值变化记 old→new + new Error().stack），
// 拖完六根线再把整条时间线打出来。栈里若出现本仓的文件名，就是我们要改的地方；
// 若全是 digitaljs.js 的内部帧，就得按上游语义去补那一步。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1721; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

const portCenter = (page, id, port) => page.evaluate(({ id, port }) => {
  const p = window.__sandboxPaper; const c = p.model.getCell(id); const v = c && c.findView(p);
  if (!v) return null;
  const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { id, port });

async function wire(page, s, sp, t, tp) {
  const a = await portCenter(page, s, sp); const b = await portCenter(page, t, tp);
  if (!a || !b) throw new Error(`找不到端口 ${sp}/${tp}`);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(120);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 }); await sleep(100);
  await page.mouse.move(b.x, b.y, { steps: 6 }); await sleep(250); await page.mouse.up(); await sleep(600);
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
    await UI.enterSandbox(page);
    await UI.newSandboxFile(page);

    // 造夹具 + 给三颗比较器都挂记录器（gt 是主角，lt/eq 当对照组）
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      window.__trace = [];
      const add = (C, args) => { const c = new dj.cells[C](args); p.model.addCell(c); return c.id; };
      const ids = {
        a: add('Constant', { type: 'Constant', constant: '0010', position: { x: 100, y: 150 } }),
        b2: add('Constant', { type: 'Constant', constant: '0010', position: { x: 100, y: 260 } }),
        b3: add('Constant', { type: 'Constant', constant: '0011', position: { x: 100, y: 370 } }),
        eq: add('Eq', { type: 'Eq', bits: { in1: 4, in2: 4 }, position: { x: 380, y: 150 } }),
        lt: add('Lt', { type: 'Lt', bits: { in1: 4, in2: 4 }, position: { x: 380, y: 260 } }),
        gt: add('Gt', { type: 'Gt', bits: { in1: 4, in2: 4 }, position: { x: 380, y: 370 } }),
      };
      for (const k of ['eq', 'lt', 'gt']) {
        const c = p.model.getCell(ids[k]);
        c.on('change:inputSignals', (cell, next) => {
          const prev = cell.previous('inputSignals') || {};
          const nv = next || {};
          for (const port of ['in1', 'in2']) {
            const o = String(prev[port]); const n = String(nv[port]);
            if (o !== n) {
              let st = '';
              try { st = new Error().stack.split('\n').slice(1, 9).join(' <- '); } catch { }
              window.__trace.push(`${k}.${port}: ${o} → ${n} @${Date.now() % 100000}｜${st.slice(0, 700)}`);
            }
          }
        });
      }
      return Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, String(v)]));
    });
    console.log('[夹具]', J(ids));

    const plan = [['a', 'out', 'eq', 'in1'], ['b2', 'out', 'eq', 'in2'], ['b3', 'out', 'lt', 'in1'],
      ['b2', 'out', 'lt', 'in2'], ['b3', 'out', 'gt', 'in1'], ['b2', 'out', 'gt', 'in2']];
    for (const [s, sp, t, tp] of plan) {
      await wire(page, ids[s], sp, ids[t], tp);
      const seen = await page.evaluate((a) => {
        const p = window.__sandboxPaper; const c = p.model.getCell(a.id);
        const l = p.model.getLinks().find((x) => x.get('target')?.id === a.id && x.get('target')?.port === a.port);
        return { seen: String((c.get('inputSignals') || {})[a.port] ?? '—'), wireSignal: l ? String(l.get('signal')) : '无线', links: p.model.getLinks().length };
      }, { id: ids[t], port: tp });
      console.log(`  拖完 ${s}.${sp}→${t}.${tp} ⇒ 器件看到 ${J(seen.seen)}，线里 ${J(seen.wireSignal)}，links=${seen.links}`);
    }

    const out = await page.evaluate((a) => {
      const p = window.__sandboxPaper;
      const rd = (id) => { const c = p.model.getCell(id); return { ins: Object.fromEntries(Object.entries(c.get('inputSignals') || {}).map(([k, v]) => [k, String(v)])), out: String((c.get('outputSignals') || {}).out) }; };
      return { eq: rd(a.eq), lt: rd(a.lt), gt: rd(a.gt), trace: window.__trace.slice(-14) };
    }, ids);
    console.log('[终态]', J({ eq: out.eq, lt: out.lt, gt: out.gt }));
    console.log('[谁写的 x]');
    for (const t of out.trace) console.log('   ', t);
    console.log('[E] 页面异常 =', J(perr.slice(0, 3)));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 500));
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
