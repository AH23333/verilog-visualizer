// R85 验收（原清单第 5、6 条：**位置保真**）——两端坐标**逐 id 对账**，不是"数量对得上"。
//
// 为什么这颗闸门以前不存在：r42 数的是"重叠位置几颗"（stacked==0）、r32 数的是"器件与线的数量"，
// 谁都没把**编译画布 vs 复制后沙盒**、**编译展开图 vs 部件文件画布**这两对坐标摆在一起比过。
// `tests/r43-pos.cjs` 其实早就算了这个（`normDev`），但它通篇 0 条 PASS/FAIL ⇒ 在跑批里连一格都不占。
// 本闸门就是把它那套算法钉上判据（夹具流程与 r43 一致：multiplier 跨文件绑定 adder/full_adder，
// 顶层 45 颗、子层 18 颗，且子层里有 3 颗同名 `full_adder`——真实规模，不是玩具夹具）。
//
// 现场读数（2026-10-06 由 r43 实跑，判据里的阈值就照它写，⛔ 不是先猜再放松）：
//   A 编译画布 n=45 bbox=30,30,2206,828 scale=1      B 复制后沙盒 n=45 bbox=12,12,2206,828 scale=1
//   C 编译展开(elk) n=18                             D 部件文件(dagre) n=18
//   normDev(A,B)=0 / normDev(C,D)=0（按 id），C/D 样例逐对像素相同（12,12｜12,112｜29,62…）
//   ⚠ A 与 B 的**包围盒原点不同**（30,30 vs 12,12）⇒ 整张图允许有一个共同平移，
//     所以判据是"消掉原点差之后逐 id ≤1 px"，并把原始最大偏移一起打出来（不是藏起来）。
//
// 臂：
//   [1] A vs B 的 id 集合完全相同（差集为空；只比数量算不过）
//   [2] A vs B 消原点后逐 id 最大偏移 ≤1 px，且两边 id 数都 ≥45（真规模）
//   [3] C vs D 同上；若两侧 id 命名规则不一致（差集非空）就**如实报未验证**，不偷偷退到按标签
//   [4] 复制后的顶层与部件文件画布上"两颗落在同一坐标"＝0（他原话"位置极其混乱"的那一维）
//   [5] 全程无页面异常
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1585;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1585)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n}（${d}）`); };
const dismiss = async (page) => { try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { } };

/** 两份 {id -> {x,y}} 的对账：差集、原始最大偏移、消掉共同原点差之后的最大偏移、叠住的颗数 */
function compare(a, b) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  const both = ka.filter((k) => k in (b || {}));
  const onlyA = ka.filter((k) => !(k in (b || {})));
  const onlyB = kb.filter((k) => !(k in (a || {})));
  let rawMax = 0, rawWorst = '', relMax = 0, relWorst = '';
  if (both.length) {
    const min = (o, p) => both.reduce((m, k) => Math.min(m, o[k][p]), Infinity);
    const ax = min(a, 'x'), ay = min(a, 'y'), bx = min(b, 'x'), by = min(b, 'y');
    for (const k of both) {
      const d0 = Math.max(Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y));
      if (d0 > rawMax) { rawMax = d0; rawWorst = k; }
      const d1 = Math.max(Math.abs((a[k].x - ax) - (b[k].x - bx)), Math.abs((a[k].y - ay) - (b[k].y - by)));
      if (d1 > relMax) { relMax = d1; relWorst = k; }
    }
  }
  const stacked = (o) => {
    const seen = new Map(); let n = 0;
    for (const k of Object.keys(o || {})) {
      const key = `${o[k].x},${o[k].y}`;
      if (String(o[k].t || '').includes('Wire')) continue;
      if (seen.has(key)) n++; else seen.set(key, k);
    }
    return n;
  };
  return { nA: ka.length, nB: kb.length, matched: both.length, onlyA: onlyA.slice(0, 4), onlyB: onlyB.slice(0, 4),
    rawMax, rawWorst, relMax, relWorst, stackB: stacked(b) };
}

(async () => {
  let server, browser;
  const perr = [];
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    // ⚠ 不能用 15s：vite dev 的 `domcontentloaded` 要等整条初始模块链（type=module 是 deferred）
    // 现场转换完，实测冷启动 DCL ≈ 15.1s——2026-10-06 三连红（含全量跑批 ENVRED）全是撞这条线，
    // curl 各端点都是亚秒级、r57 用默认 30s 一直绿 ⇒ 夹具超时过紧，不是产品回归。
    page.setDefaultTimeout(45000);
    page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await UI.boot(page, URL);
    await dismiss(page);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await UI.boot(page, URL, { reload: true }); await dismiss(page);

    const ids = {};
    for (const f of ['multiplier.v', 'adder.v', 'full_adder.v']) {
      ids[f] = await page.evaluate(async (a) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const nf = fileStore.createFile(a.n); fileStore.saveContent(nf.id, a.c); return nf.id;
      }, { n: f, c: rd(f) });
    }
    for (const [file, mod, src] of [['multiplier.v', 'adder', 'adder.v'], ['adder.v', 'full_adder', 'full_adder.v']]) {
      await page.evaluate(async (a) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        fileStore.setModuleBinding(a.f, a.m, a.s);
      }, { f: ids[file], m: mod, s: ids[src] });
    }
    await UI.boot(page, URL, { reload: true }); await dismiss(page);
    await page.locator('[title="multiplier.v"]').first().click({ force: true }); await sleep(800);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    for (let i = 0; i < 90; i++) {
      await sleep(700);
      const done = await page.evaluate(async (x) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const f = fileStore.getById(x); return !!(f && f.status === 'compiled' && f.circuitJson);
      }, ids['multiplier.v']);
      if (done) break;
    }
    await sleep(3500);

    const readPaper = (hook) => page.evaluate((h) => {
      const p = h === '__djsDebug' ? window.__djsDebug.getPaper() : window[h];
      if (!p) return null;
      const out = {};
      for (const el of p.model.getElements()) {
        const q = el.position();
        out[String(el.id)] = { x: Math.round(q.x), y: Math.round(q.y), t: String(el.get('type')) };
      }
      const bb = p.getContentBBox();
      return { n: Object.keys(out).length, bbox: [Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height)], scale: +p.scale().sx.toFixed(3), pos: out };
    }, hook);

    const A = await readPaper('__djsDebug');
    (A && A.n ? ok : bad)('[0a] 编译画布读到了（顶层夹具真在画布上）', `A n=${A ? A.n : 'null'} bbox=${J(A && A.bbox)}`);

    // C：编译模式里点放大镜展开 adder（elk 布局），等包围盒稳定
    const zp = await page.evaluate(() => {
      const p = window.__djsDebug.getPaper();
      const s = p.model.getCells().filter((c) => c.get('type') === 'Subcircuit')[0];
      const v = s.findView(p); const za = v.el.querySelector('a.zoom'); const r = za.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(zp.x, zp.y);
    let prev = '';
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      const cur = await page.evaluate(() => { const p = window.__innerPaper; if (!p) return ''; const bb = p.getContentBBox(); return [bb.x, bb.y, bb.width, bb.height].map(Math.round).join(','); });
      if (cur && cur === prev) break;
      prev = cur;
    }
    const C = await readPaper('__innerPaper');
    console.log('  [A/C]', J({ A: A && { n: A.n, bbox: A.bbox, scale: A.scale }, C: C && { n: C.n, bbox: C.bbox, scale: C.scale } }));
    await page.keyboard.press('Escape'); await sleep(600);

    // 复制到沙盒 ⇒ B（顶层）与 D（adder 部件文件画布）
    await page.locator('button[title*="复制到沙盒"]').first().click(); await sleep(5000);
    const openSandboxFile = async (name) => {
      await page.evaluate((n) => {
        const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
        const f = Object.values(files).find((x) => x.name === n);
        if (f) localStorage.setItem('verilog-viz-sandbox-active', f.id);
      }, name);
      await UI.boot(page, URL, { reload: true }); await sleep(1200);
      if (!(await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]')))) {
        await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1500);
      }
      await sleep(1800);
    };
    await openSandboxFile('multiplier/multiplier_sandbox.djs');
    const B = await readPaper('__sandboxPaper');
    await openSandboxFile('multiplier/adder.djs');
    const D = await readPaper('__sandboxPaper');
    console.log('  [B/D]', J({ B: B && { n: B.n, bbox: B.bbox, scale: B.scale }, D: D && { n: D.n, bbox: D.bbox, scale: D.scale } }));

    if (!B || !D || !C) { skip('[1]..[4] 位置逐 id 对账', '四份读数里有 null（夹具没跑出来，不作数）'); }
    else {
      const AB = compare(A.pos, B.pos), CD = compare(C.pos, D.pos);
      console.log('  [对账] A vs B=', J(AB), ' C vs D=', J(CD));

      (AB.onlyA.length === 0 && AB.onlyB.length === 0 && AB.matched >= 45 ? ok : bad)(
        '[1] 编译画布 vs 复制后沙盒顶层：id 集合**逐一对上**（不是数量相等）',
        `A=${AB.nA} B=${AB.nB} 共同=${AB.matched} 只在 A=${J(AB.onlyA)} 只在 B=${J(AB.onlyB)}`);
      // ⚠ 偏移这一格必须有"分母"：只有两边**逐一对上**（matched == 两边颗数）时，"最大偏移 ≤1 px"
      //   才是句话——否则 id 集合空掉的话 relMax 会恒 0（设计 M4 那颗变异时就是为把这个洞顶出来）。
      (AB.matched === AB.nA && AB.nA === AB.nB && AB.nA >= 45 && AB.relMax <= 1 ? ok : bad)(
        '[2] 同一对：全部 id 都对得上，且消掉共同原点差后逐 id 最大偏移 ≤1 px',
        `共同 ${AB.matched}／A ${AB.nA}／B ${AB.nB} 消原点 max=${AB.relMax}px（worst id=${String(AB.relWorst).slice(0, 8)}） 原始 max=${AB.rawMax}px（原点差算进原始值：A bbox=${J(A.bbox)} B bbox=${J(B.bbox)}）`);

      if (CD.onlyA.length || CD.onlyB.length) {
        skip('[3] 编译展开图 vs 部件文件画布：逐 id 最大偏移 ≤1 px',
          `两侧 id 命名规则不一致（只在 C=${J(CD.onlyA)} 只在 D=${J(CD.onlyB)}）⇒ 这一臂不作数，需要另立按标签对账的判据`);
      } else {
        (CD.matched === CD.nA && CD.nA === CD.nB && CD.matched >= 18 && CD.relMax <= 1 ? ok : bad)(
          '[3] 编译展开图(elk) vs 部件文件画布(dagre)：id 逐一对上且消原点后最大偏移 ≤1 px',
          `共同=${CD.matched}／C ${CD.nA}／D ${CD.nB} 消原点 max=${CD.relMax}px 原始 max=${CD.rawMax}px 叠住=${CD.stackB}`);
      }

      (B.n >= 45 && D.n >= 18 && AB.stackB === 0 && CD.stackB === 0 ? ok : bad)(
        '[4] 复制出来的顶层与部件文件画布上"两颗落在同一坐标"＝0（他原话"位置极其混乱"那一维）',
        `顶层叠住=${AB.stackB}（${B.n} 颗） 部件画布叠住=${CD.stackB}（${D.n} 颗）`);
    }
    (perr.length ? bad : ok)('[5] 全程无页面异常', perr.slice(0, 3).join(' | '));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unver} 未验证 =====`);
    await browser.close();
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    fail++;
    console.log('FATAL', String(e && e.stack || e).slice(0, 300));
    console.log(`===== 结果: ${pass} pass, ${fail} fail, ${unver} 未验证 =====`);
    try { await browser?.close(); } catch { }
    process.exit(1);
  } finally {
    try { server?.kill('SIGKILL'); } catch { }
    UI.freePort(PORT);
  }
})();
