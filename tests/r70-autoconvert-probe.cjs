// R70 探针（只打读数）：拖线时**自动插入的位宽转换器**为什么会让下游读到 x。
//
// 起因（全量跑批 r23 的逐跳读数，不是猜）：
//   c53c12:Input out=00  →  21e159:ZeroExtend in=xx  →  wr0addr=xxx
//   9b5c2d:Input out=0   →  d7da9f:ZeroExtend in=0   →  wr0data=00000000
//   两条链唯一的区别：data 那颗 Input 在插好转换器**之后**被点过（值变了一次），
//   地址那颗是在插转换器之前设好的（之后没再变）。
// 代码侧的对应形状（`SandboxCanvas.tsx:1969` → `mkWire` @1938）：转换器插完是用
// `mkWire()` 补两条线，而 mkWire 一律写死 `signal: 'x'`；`loadCells` 那一侧同一个问题
// 是靠 `flushStaleQueue()` 冲一遍才不恒 x（@1985 的注释就在说这件事），
// `connectWithAutoConvert` 里**没有**这一步。⇒ 新线只等源器件"下一次再发一遍"，
// 用户不碰源就一直 x。这一条要么被读数证实，要么证伪，不许靠读码定案。
//
// 读数设计（每一步都打现场值）：
//  [1] 刚插好转换器：源的 out、入线 signal、转换器 in/out、Memory 端口看到的值；
//  [2] 按**当前**屏幕坐标点一下源 Input（值真的变一次），同一组读数；
//  [3] 再点回，看是否跟着变。
//  [4] 复刻 v1 跑出来的怪事：在不挪动鼠标的前提下「按下又抬起」落在**已被占用的端口磁吸**上
//      （v1 用的是插线前算好的旧坐标，插完转换器画面重排 ⇒ 那一点落到了磁吸上）。
//      要看的是：入线 signal 仍是确定值、而转换器 in 却被写成 x，并且之后再也回不来。
//
// ⚠ v1 的读数已经把我自己那条「mkWire 播 x、新线不继承源当前值」的假设**证伪**了：
//   [1] 里 conv.in=1、out=001、Memory.rd0addr=001 —— 插入那一刻继承得好好的。
//   反而是在一次点击之后：wire.signal 仍是 1，conv.in 变成 x，且源的值从没变过（1→1）。
//   所以这一版的射程是「端口为什么会被写 x」，不是「新线播不播值」。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1701; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

const SNAP = () => {
  const p = window.__sandboxPaper;
  const els = p.model.getElements();
  const mem = els.find((e) => String(e.get('type')) === 'Memory');
  const inp = els.find((e) => String(e.get('type')) === 'Input');
  const conv = els.find((e) => /Extend|Slice/.test(String(e.get('type'))));
  const sh = (x) => (x == null ? '—' : String(x));
  const links = p.model.getLinks().map((l) => ({
    src: String(l.get('source').id).slice(0, 6), sp: l.get('source').port,
    tgt: String(l.get('target').id).slice(0, 6), tp: l.get('target').port,
    signal: sh((l.get('signal') || {}).value ?? l.get('signal')), bits: l.get('bits') ?? null,
  }));
  return {
    has: { mem: !!mem, inp: !!inp, conv: !!conv, links: links.length },
    input: inp ? { bits: inp.get('bits'), out: sh((inp.get('outputSignals') || {}).out) } : null,
    conv: conv ? {
      type: String(conv.get('type')), extend: conv.get('extend') ?? null, slice: conv.get('slice') ?? null,
      in: sh((conv.get('inputSignals') || {}).in), out: sh((conv.get('outputSignals') || {}).out),
    } : null,
    mem: mem ? {
      rd0addr: sh((mem.get('inputSignals') || {}).rd0addr),
      wr0addr: sh((mem.get('inputSignals') || {}).wr0addr),
    } : null,
    links,
  };
};

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
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
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    await UI.enterSandbox(page);
    await UI.clickGate(page, 'Memory'); await sleep(600);
    await UI.clickGate(page, 'Input'); await sleep(600);

    // 先把源点亮（值变成 1）——关键：这一步发生在**插线之前**，正是 r23 的地址那颗的形状
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const inp = p.model.getElements().find((e) => String(e.get('type')) === 'Input');
      return inp ? { id: String(inp.id) } : null;
    });
    if (!ids) { console.log('[ABORT] 画布上没有 Input'); }
    else {
      const clicked = await page.evaluate((a) => {
        const p = window.__sandboxPaper;
        const c = p.model.getCell(a.id);
        const v = c && p.findViewByModel(c);
        if (!v) return 'no-view';
        const el = v.el.querySelector('[magnet="false"]') || v.el;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }, ids);
      if (clicked && clicked.x !== undefined) { await page.mouse.click(clicked.x, clicked.y); await sleep(500); }
      console.log('[0] 插线前源读数 =', J(await page.evaluate(SNAP)));

      const okDrag = await UI.dragWire(page, 'out', 'rd0addr').catch((e) => String(e).slice(0, 120));
      console.log('[drag] =', J(okDrag));
      await sleep(900);
      const s1 = await page.evaluate(SNAP);
      console.log('[1] 刚插好转换器 =', J(s1));

      // ⚠ 每次点击前**重算**坐标：插完转换器画面会重排（适应窗口），用插线前算好的旧坐标
      //    点下去会落到别的元素上（v1 的 [2] 就是这么把一次「点源」点成了「点磁吸」，
      //    结果反而暴露出下面 [4] 这一族）。
      const freshCenter = (sel) => page.evaluate((a) => {
        const p = window.__sandboxPaper;
        const c = p.model.getElements().find((e) => String(e.get('type')) === a.type);
        const v = c && p.findViewByModel(c);
        if (!v) return null;
        const el = a.port ? v.el.querySelector(`.joint-port-body[port="${a.port}"] circle`)
          : (v.el.querySelector('[magnet="false"]') || v.el);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }, sel);

      if (s1.has.conv) {
        const cIn = await freshCenter({ type: 'Input' });
        if (cIn) { await page.mouse.click(cIn.x, cIn.y); await sleep(700); }
        const s2 = await page.evaluate(SNAP);
        console.log('[2] 按当前坐标点了一下源 Input 之后 =', J(s2), '｜点前源是', J(s1.input));

        const cIn2 = await freshCenter({ type: 'Input' });
        if (cIn2) { await page.mouse.click(cIn2.x, cIn2.y); await sleep(700); }
        console.log('[3] 再点回原值之后 =', J(await page.evaluate(SNAP)));

        // [4] 在已被占用的入口磁吸上「按下又抬起、不移动」——看端口会不会被写 x
        const cMag = await freshCenter({ type: 'ZeroExtend', port: 'in' });
        console.log('[4-pre] ZeroExtend.in 磁吸坐标 =', J(cMag));
        if (cMag) {
          await page.mouse.move(cMag.x, cMag.y); await sleep(200);
          await page.mouse.down(); await sleep(150); await page.mouse.up(); await sleep(800);
          const s4 = await page.evaluate(SNAP);
          console.log('[4] 空点一次已占用的磁吸之后 =', J(s4));

          // [5] 让源真的变两次值，看那格 x 能不能自己回来（回不来＝用户只能删线重接）
          const cIn3 = await freshCenter({ type: 'Input' });
          if (cIn3) { await page.mouse.click(cIn3.x, cIn3.y); await sleep(500); await page.mouse.click(cIn3.x, cIn3.y); await sleep(700); }
          console.log('[5] 源连点两次（值变两回）之后 =', J(await page.evaluate(SNAP)));
        } else {
          console.log('[4/5] 找不到 ZeroExtend.in 的磁吸，这两步不作数');
        }
      } else {
        console.log('[2/3] 没有转换器插进来（这条落点没走自动转换），后两步不作数');
      }
    }
    console.log('[E] 页面异常 =', J(perr.slice(0, 3)));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
