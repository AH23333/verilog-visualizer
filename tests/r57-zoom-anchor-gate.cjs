// R57 验收：**滚轮缩放的锚点**（他的第 7 条：「两个模式下使用滚轮缩放部件放大镜展开图会丢失电路图画面，应该是缩放中心不对」）
//
// 钉的是可观察的几何不变量，不钉内部实现：
//   A. 光标底下那个器件，缩放之后**还在光标底下**（client 坐标位移 ≤ 3px）；
//   B. 内容仍在视口里（"画面丢了"这一半）；
//   C. 缩放真的发生了 —— 否则 A/B 是空话（r57 前两版就栽在"没缩放也在判锚点"）。
//
// 三处都量：编译主画布、部件放大镜展开图（两种模式共用同一座弹窗）、沙盒主画布。
//
// ⚠ 两种输入方式各有适用面（都是 r58 实测出来的，别再猜）：
//   · 编译主画布的缩放是 `Canvas.tsx` 的 `applyTransform()` 写 CSS transform 到 `.joint-paper` 那颗 div，
//     **合成 WheelEvent 在这里行为不一致**（3 次 -240 得到 0.506，真输入 1 次得到 ×1.1）⇒ 这侧只用真输入；
//     Playwright 的 `mouse.wheel` 确实带上了 Control（实测 matrix 从 0.5058→0.5564 ＝ ×1.1）。
//   · joint 自己缩放的两处（展开图 / 沙盒画布）合成事件就够，且能精确控制在光标处。
//   · R100 起展开图滚轮语义改为「普通＝纵移 / Shift＝横移 / Ctrl＝缩放」——本格 [2] 随之
//     改发 Ctrl+滚轮，[2b] 正向钉住平移语义。
//   · 锚点必须选"此刻真的在视口里"的器件：先前有一次我把器件平移到了视口下沿外面，
//     真输入打在了画布外，matrix 全程不变，看着像"功能坏了"（其实是我测错位置）。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1635;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1635)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };

const freePort = UI.freePort;

/**
 * 在指定 paper 上选一颗"稳稳在视口里"的器件，返回它的 client 中心 + 当前两种缩放读数：
 *   js  = joint paper.scale().sx（沙盒画布 / 展开图用它缩放）
 *   css = paper 根节点 computed matrix 的 a 项（编译主画布用 CSS transform 缩放）
 * ⚠ 只写一个会漏：编译侧 js 恒 1，沙盒侧 css 恒 1。
 */
const probe = (page, a) => page.evaluate((x) => {
  const p = x.hook === '__djsDebug'
    ? (window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper())
    : window[x.hook];
  if (!p) return { noPaper: true };
  const host = x.hostSel ? document.querySelector(x.hostSel) : (p.el && p.el.parentElement) || document.body;
  const hr = host.getBoundingClientRect();
  const mat = () => { const m = /matrix\(([-0-9.]+)/.exec(getComputedStyle(p.el).transform); return m ? Number(m[1]) : 1; };
  const nodeOf = (e) => { const v = p.findViewByModel(e); return v && v.el ? (v.el.querySelector('.body') || v.el) : null; };
  const inside = (r) => { const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return r.width > 8 && cx > hr.left + 24 && cx < hr.right - 24 && cy > hr.top + 24 && cy < hr.bottom - 24; };
  const els = p.model.getElements();
  const pick = els.find((e) => {
    if (x.hook === '__djsDebug' && String(e.get('type')) === 'Subcircuit') return false;
    const n = nodeOf(e); return n && inside(n.getBoundingClientRect());
  });
  if (!pick) {
    const n0 = els.length ? nodeOf(els[0]) : null;
    const r0 = n0 ? n0.getBoundingClientRect() : null;
    return { noPick: true, n: els.length,
      first: r0 ? [Math.round(r0.left), Math.round(r0.top), Math.round(r0.width)] : null,
      host: [Math.round(hr.left), Math.round(hr.top), Math.round(hr.right), Math.round(hr.bottom)] };
  }
  const r = nodeOf(pick).getBoundingClientRect();
  return { id: pick.id, type: String(pick.get('type')), cx: r.left + r.width / 2, cy: r.top + r.height / 2,
    w: Math.round(r.width), js: Number(p.scale().sx) || 1, css: mat() };
}, a);

/** 同一颗器件在滚轮之后的读数 + 与光标处的位移 */
const measure = (page, a) => page.evaluate((x) => {
  const p = x.hook === '__djsDebug'
    ? (window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper())
    : window[x.hook];
  const host = x.hostSel ? document.querySelector(x.hostSel) : (p.el && p.el.parentElement) || document.body;
  const cell = p.model.getCell(x.id);
  if (!cell) return { gone: true };
  const v = p.findViewByModel(cell);
  const n = v.el.querySelector('.body') || v.el;
  const r = n.getBoundingClientRect();
  const hr = host.getBoundingClientRect();
  const nx = r.left + r.width / 2, ny = r.top + r.height / 2;
  const m = /matrix\(([-0-9.]+)/.exec(getComputedStyle(p.el).transform);
  return {
    w: Math.round(r.width), js: Number(p.scale().sx) || 1, css: m ? Number(m[1]) : 1,
    dx: Math.round((nx - x.cx) * 10) / 10, dy: Math.round((ny - x.cy) * 10) / 10,
    stillInside: nx >= hr.left - 4 && nx <= hr.right + 4 && ny >= hr.top - 4 && ny <= hr.bottom + 4,
  };
}, a);

/** 合成滚轮（joint 缩放那两处够用）：必须从 paper 根节点往外发，从祖先往下发不会触发子元素 handler */
const synthWheel = (page, a) => page.evaluate((x) => {
  const p = x.hook === '__djsDebug' ? (window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper()) : window[x.hook];
  const target = p.el || document.body;
  for (let i = 0; i < x.times; i++) {
    target.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -240, clientX: x.cx, clientY: x.cy, bubbles: true, cancelable: true, ctrlKey: !!x.ctrl,
    }));
  }
}, a);

/** 真输入滚轮（编译主画布这侧只能用这个） */
async function realWheel(page, t, ctrl) {
  await page.mouse.move(t.cx, t.cy);
  if (ctrl) await page.keyboard.down('Control');
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -240); await sleep(220); }
  if (ctrl) await page.keyboard.up('Control');
}

async function anchorRun(page, hook, opts) {
  const arg = { hook, hostSel: opts.hostSel };
  let before = await probe(page, arg);
  if (opts.settle) {
    // 编译侧刚出图时"自动适应窗口"还会异步落地：先等它跑完再重新定位光标，
    // 否则测的是它搬家的位移，不是滚轮的锚点（r59 读数：搬一次 500px 以上）。
    await sleep(opts.settle);
    before = await probe(page, arg);
  }
  if (!before || before.noPaper) return { missing: 'paper 拿不到（hook ' + hook + '）' };
  if (before.noPick) return { missing: `视口内没有稳稳可见的器件：器件 ${before.n} 颗，首颗 [x,y,w]=${JSON.stringify(before.first)}，host=${JSON.stringify(before.host)}` };
  if (opts.mode === 'real') await realWheel(page, before, opts.ctrl);
  else await synthWheel(page, { ...arg, ...before, ctrl: opts.ctrl, times: opts.times || 3 });
  await sleep(900);
  const after = await measure(page, { ...arg, ...before });
  return { before, after };
}

const verdict = (name, r) => {
  if (r.missing) { unverified++; console.log(`  UNVERIFIED  ${name}（${r.missing}）`); return; }
  if (r.after.gone) { bad(name + '：缩放后器件从模型里消失', ''); return; }
  const { before, after } = r;
  const zoomed = Math.abs(after.js - before.js) > 0.02 || Math.abs(after.css - before.css) > 0.02;
  if (!zoomed) { bad(name + '：滚轮没产生缩放', `joint ${before.js.toFixed(3)}→${after.js.toFixed(3)} css ${before.css.toFixed(3)}→${after.css.toFixed(3)}`); return; }
  const drift = Math.max(Math.abs(after.dx), Math.abs(after.dy));
  (drift <= 3 && after.stillInside ? ok : bad)(name,
    `宽 ${before.w}→${after.w} 缩放 joint ${before.js.toFixed(3)}→${after.js.toFixed(3)} / css ${before.css.toFixed(3)}→${after.css.toFixed(3)}，光标处漂移 dx=${after.dx} dy=${after.dy}，仍在视口=${after.stillInside}（${before.type}）`);
};

(async () => {
  let server, browser;
  try {
    freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务未起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 180)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    // 把 vite 的"发现新依赖 → 重新预构建 → 整页 reload"吃掉，否则测到一半 Execution context destroyed
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1500);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    // 应用真路径：3 文件 + 跨文件绑定 + F5
    const ids = {};
    for (const f of ['multiplier.v', 'adder.v', 'full_adder.v']) {
      ids[f] = await page.evaluate(async (a) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const nf = fileStore.createFile(a.n); fileStore.saveContent(nf.id, a.c); return nf.id;
      }, { n: f, c: rd(f) });
    }
    await page.evaluate(async (a) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      fileStore.setModuleBinding(a.mul, 'adder', a.add);
      fileStore.setModuleBinding(a.add, 'full_adder', a.fa);
    }, { mul: ids['multiplier.v'], add: ids['adder.v'], fa: ids['full_adder.v'] });
    await page.locator('[title="multiplier.v"]').first().click({ force: true }); await sleep(800);
    await page.keyboard.press('F5');
    let hasPaper = false;
    for (let i = 0; i < 40; i++) {
      await sleep(700);
      hasPaper = await page.evaluate(() => {
        const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper();
        return !!p && p.model.getElements().length > 3;
      });
      if (hasPaper) break;
    }
    if (!hasPaper) { console.log('FATAL 主画布没渲染出电路'); process.exit(1); }

    // [1] 编译主画布：Ctrl+滚轮（真输入）
    verdict('[1] 编译主画布 Ctrl+滚轮以光标为锚',
      await anchorRun(page, '__djsDebug', { mode: 'real', ctrl: true, settle: 2500 }));

    // [2] 部件放大镜展开图（两种模式共用同一座弹窗 = 他报的那处）
    const zp = await page.evaluate(() => {
      const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper();
      if (!p) return null;
      const s = p.model.getElements().find((e) => String(e.get('type')) === 'Subcircuit');
      if (!s) return null;
      const za = p.findViewByModel(s).el.querySelector('a.zoom');
      if (!za) return null;
      const r = za.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!zp) { unverified++; console.log('  UNVERIFIED  [2] 展开图滚轮锚点（顶层没有子部件实例，🔍 无处可点）'); }
    else {
      await page.mouse.click(zp.x, zp.y);
      let ready = false;
      for (let i = 0; i < 22; i++) {
        await sleep(400);
        ready = await page.evaluate(() => { const p = window.__innerPaper; return !!p && p.model.getElements().length > 0; });
        if (ready) break;
      }
      if (!ready) { unverified++; console.log('  UNVERIFIED  [2] 展开图滚轮锚点（弹窗没渲染出器件）'); }
      else {
        await sleep(1500);   // elk 异步写坐标，等它稳
        // R100 定版语义：普通滚轮＝上下平移、Shift+滚轮＝左右平移，**只有 Ctrl+滚轮＝缩放**。
        // 本格因此从「合成普通滚轮」改为「合成 Ctrl+滚轮」（普通滚轮不再缩放是产品语义，不是回归）。
        verdict('[2] 展开图 Ctrl+滚轮以光标为锚（两种模式共用的弹窗）',
          await anchorRun(page, '__innerPaper', { mode: 'synth', hostSel: '[data-inner-host]', times: 3, ctrl: true }));
        // [2b] 正向钉住 R100 语义：普通滚轮＝ty 平移、Shift+滚轮＝tx 平移，两档都不改缩放
        const pan = await page.evaluate(() => {
          const p = window.__innerPaper;
          if (!p) return null;
          const t0 = p.translate(); const s0 = Number(p.scale().sx) || 1;
          const el = p.el || document.body;
          const wheel = (mods) => el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -240, clientX: window.innerWidth / 2, clientY: window.innerHeight / 2,
            bubbles: true, cancelable: true, ctrlKey: !!(mods && mods.c), shiftKey: !!(mods && mods.s),
          }));
          for (let i = 0; i < 3; i++) wheel();
          const t1 = p.translate(); const s1 = Number(p.scale().sx) || 1;
          for (let i = 0; i < 3; i++) wheel({ s: true });
          const t2 = p.translate(); const s2 = Number(p.scale().sx) || 1;
          return {
            dy: Math.round((t1.ty - t0.ty) * 10) / 10, dz1: Math.round(Math.abs(s1 - s0) * 1000) / 1000,
            dx: Math.round((t2.tx - t1.tx) * 10) / 10, dz2: Math.round(Math.abs(s2 - s1) * 1000) / 1000,
          };
        });
        if (!pan) { unverified++; console.log('  UNVERIFIED  [2b] 展开图平移语义（paper 不可用）'); }
        else {
          const panOk = Math.abs(pan.dy) >= 60 && pan.dz1 < 0.02 && Math.abs(pan.dx) >= 60 && pan.dz2 < 0.02;
          (panOk ? ok : bad)('[2b] 展开图普通/Shift滚轮＝平移且不缩放（R100 语义）',
            `纵移 Δty=${pan.dy} 缩放差 ${pan.dz1}｜横移 Δtx=${pan.dx} 缩放差 ${pan.dz2}`);
        }
        await page.keyboard.press('Escape'); await sleep(500);
      }
    }

    // [3] 沙盒主画布 Ctrl+滚轮（以前只 paper.scale(k) 不补平移 → 放大后整块滑出视野）
    await UI.enterSandbox(page);
    await UI.clickGate(page, 'And');
    await UI.clickGate(page, 'Or');
    await sleep(600);
    verdict('[3] 沙盒主画布 Ctrl+滚轮以光标为锚', await anchorRun(page, '__sandboxPaper', { mode: 'synth', ctrl: true, times: 3 }));

    (perr.length ? bad : ok)('[4] 全程无页面异常', perr.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
    fail++;
  } finally {
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unverified} 未验证 =====`);
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    process.exit(fail ? 1 : 0);
  }
})();
