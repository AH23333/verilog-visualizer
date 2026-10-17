// R135 闸门（同批第二颗：搜索面）：**部件搜索（Ctrl+F）在两模式里真的能"定位＋高亮"**
// （用户 2026-10-13 请求；功能本体早在 `32d3633` 落地＝`lib/partSearch.ts` 总线＋`PartSearchDialog`
// ＋两侧 locate，但 68 格里没有一颗问过它＝本卷 T-1 的欠账，这一颗补上）。
//
// 射程（9 格，编译模式 4＋反向对照 1＋沙盒 4）：
//   [1] 编译模式 Ctrl+F → 弹窗出现且**输入框已聚焦**（按下去就能打字）
//   [2] 输入的查询词命中行数 == 模型里同一类型器件的颗数（成对判据，⛔ 只数 DOM 行数会被"全列出来"洗绿）
//   [3] 点一行 → 那颗 cell 拿到 `.sm-selected`、弹窗关闭、矩形进入 paper 可视区
//   [4] **先把选中清掉**，再走键盘路径（Ctrl+F → 打字 → Enter）⇒ 仍落到那条命中（Enter 走 hits[0]）
//   [5] 反向对照：代码视图里 Ctrl+F 归编辑器查找，⛔ 弹部件搜索（分流判据的另一半）
//   [6]～[9] 沙盒那四格同上（源经总线换宿主：⛔ 拿到编译模式那份旧源）
//
// ⚠ 查询词不写死 'And'：从模型里取**当前最多的那种 type** 当查询词，两模式各自现算，
//   免得器件表一改就误红（r32「逻辑门=7 项」那一族的教训）。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1802;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(PORT)); } catch { }
const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
// 夹具按末段名解析（test_files/ 会被用户在产品里整理）：见 tests/fixtures.cjs
const { fixture } = require('./fixtures.cjs');
const sleep = UI.sleep;
const rd = (f) => fs.readFileSync(fixture(f), 'utf8');
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n} — ${d}`); };

/** 弹窗现场：开着没、焦点在不在输入框、列了几行 */
const DIALOG = () => {
  const dlg = document.querySelector('[data-part-search-dialog]');
  const input = document.querySelector('[data-part-search-input]');
  return {
    open: !!dlg,
    focused: !!input && document.activeElement === input,
    items: document.querySelectorAll('[data-part-search-item]').length,
    hint: dlg ? String(dlg.textContent || '').slice(0, 44) : null,
  };
};

/** 从模型现算"最多那种 type"＋它的颗数与 id（查询词与期望行数同源，⛔ 写死器件名） */
const DOMINANT = () => {
  const p = window.__sandboxPaper || (window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper());
  if (!p || !p.model) return { noPaper: true };
  const tally = {};
  for (const e of p.model.getElements()) {
    const t = String(e.get('type') || '');
    if (!t) continue;
    (tally[t] = tally[t] || []).push(String(e.id));
  }
  let best = null, second = null;
  for (const t of Object.keys(tally)) {
    if (!best || tally[t].length > tally[best].length) { second = best; best = t; }
    else if (!second || tally[t].length > tally[second].length) second = t;
  }
  return {
    type: best, n: best ? tally[best].length : 0, ids: best ? tally[best] : [],
    kinds: Object.keys(tally).length,
    alt: second, altN: second ? tally[second].length : 0, altIds: second ? tally[second] : [],
  };
};

/** 那颗 cell 是否被标选、是否落在 paper 可视区 */
const CELL_AT = (a) => {
  const paper = a.sandbox ? window.__sandboxPaper : (window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper());
  if (!paper || !paper.model) return { noPaper: true };
  const c = paper.model.getCell(a.id);
  if (!c) return { missing: true };
  const v = paper.findViewByModel(c);
  if (!v || !v.el) return { noView: true };
  const b = v.el.getBoundingClientRect();
  const host = v.el.closest('.joint-paper') || document.body;
  const pb = host.getBoundingClientRect();
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  const cls = String(v.el.getAttribute('class') || '');
  return {
    type: String(c.get('type') || ''),
    // 两模式各自的高亮通道（⛔ 只认一种会把另一侧判成"没高亮"）：
    //  · 沙盒＝选择态 class（`setSelectionRef([id])`，紫色描边）
    //  · 编译＝`src-highlight`（与"代码↔电路溯源"同一条发光通道＋居中）
    selected: /(^|\s)sm-selected(\s|$)/.test(cls),
    glow: /(^|\s)src-highlight(\s|$)/.test(cls),
    inView: b.width > 0 && cx >= pb.left - 2 && cx <= pb.right + 2 && cy >= pb.top - 2 && cy <= pb.bottom + 2,
    rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width) },
    paperBox: { l: Math.round(pb.left), r: Math.round(pb.right) },
  };
};

/**
 * 一整套四格：Ctrl+F 开框／行数配对／点击定位／键盘定位。
 * mode='compile' 用 __djsDebug 那张 paper，mode='sandbox' 用 __sandboxPaper。
 */
async function suite(page, tag, mode) {
  const dom = await page.evaluate(DOMINANT);
  if (dom.noPaper || !dom.type || dom.n < 1) {
    [`[${tag}1] Ctrl+F 打开部件搜索且输入框已聚焦`, `[${tag}2] 命中行数与模型颗数配对`,
      `[${tag}3] 点击命中行 ⇒ 标选＋进入可视区`, `[${tag}4] 清掉选中后 Enter 走同一落点`]
      .forEach((n) => skip(n, `模型读数不够：${J(dom)}`));
    return;
  }
  const sandbox = mode === 'sandbox';

  await page.keyboard.press('Control+f');
  await sleep(500);
  const d1 = await page.evaluate(DIALOG);
  (d1.open && d1.focused)
    ? ok(`[${tag}1] ${mode} Ctrl+F 打开部件搜索且**输入框已聚焦**（按下即可打字）`, `open=${d1.open} focused=${d1.focused} 提示=${J(d1.hint)}`)
    : bad(`[${tag}1] ${mode} Ctrl+F 打开部件搜索且输入框已聚焦`, J(d1));

  if (!d1.open) {
    skip(`[${tag}2] 命中行数与模型颗数配对`, '弹窗没开');
    skip(`[${tag}3] 点击命中行 ⇒ 标选＋进入可视区`, '弹窗没开');
    skip(`[${tag}4] 清掉选中后 Enter 走同一落点`, '弹窗没开');
    return;
  }

  // ---- [2] 行数与模型颗数配对（查询词＝模型里最多那种 type）----
  await page.keyboard.type(dom.type, { delay: 30 });
  await sleep(400);
  const d2 = await page.evaluate(DIALOG);
  (d2.items === dom.n && d2.items > 0)
    ? ok(`[${tag}2] 输入 "${dom.type}" 的行数 == 模型里该类型的颗数（成对判据，⛔ 只数 DOM 会被"全列出来"洗绿）`,
      `行数=${d2.items} 模型=${dom.n} kinds=${dom.kinds}｜提示=${J(d2.hint)}`)
    : bad(`[${tag}2] 输入 "${dom.type}" 的行数 == 模型里该类型的颗数`, J({ d2, dom }));

  // ---- [3] 点第一行 ⇒ 标选并进入可视区 ----
  const first = dom.ids[0];
  await page.locator('[data-part-search-item]').first().click();
  await sleep(700);
  const d3 = await page.evaluate(DIALOG);
  const c3 = await page.evaluate(CELL_AT, { id: first, sandbox });
  const lit3 = c3.selected || c3.glow;
  (!d3.open && lit3 && c3.inView)
    ? ok(`[${tag}3] 点击命中行：弹窗关闭、那颗 cell 被点亮（${c3.glow ? 'src-highlight 发光' : '选择态 .sm-selected'}）、矩形进入 paper 可视区`,
      `id=${first.slice(0, 8)} type=${c3.type} glow=${c3.glow} selected=${c3.selected} rect=${J(c3.rect)}`)
    : bad(`[${tag}3] 点击命中行：弹窗关闭、那颗被点亮、且进入可视区`, J({ open: d3.open, c3, first }));

  // ---- [4] 键盘路径：换**另一种 type**当落点（⛔ 依赖"点空白取消高亮"——密电路里
  //  blankCanvasPoint 会抛"找不到空白点"，而取消高亮本来也不是这条判据要问的事）----
  if (!dom.alt || !dom.altIds || !dom.altIds.length) {
    skip(`[${tag}4] 键盘路径（Ctrl+F→输入另一种 type→Enter）落到另一颗`, `模型里没有第二种 type 可换：${J({ type: dom.type, kinds: dom.kinds })}`);
    return;
  }
  await page.keyboard.press('Control+f');
  await sleep(400);
  await page.keyboard.type(dom.alt, { delay: 30 });
  await sleep(400);
  await page.keyboard.press('Enter');
  await sleep(700);
  const d4 = await page.evaluate(DIALOG);
  const c4 = await page.evaluate(CELL_AT, { id: dom.altIds[0], sandbox });
  (!d4.open && (c4.selected || c4.glow) && c4.inView)
    ? ok(`[${tag}4] 键盘路径落点成立：Ctrl+F→输入 "${dom.alt}"→Enter 取第一条命中，那颗被点亮（${c4.glow ? '发光' : '选择态'}）且在可视区`,
      `id=${String(dom.altIds[0]).slice(0, 8)} type=${c4.type} glow=${c4.glow} selected=${c4.selected}`)
    : bad(`[${tag}4] 键盘路径落点成立（Enter 取第一条命中并点亮）`, J({ open: d4.open, c4, alt: dom.alt, altIds: dom.altIds.slice(0, 3) }));
}

(async () => {
  let server, browser;
  const errors = [];
  try {
    UI.freePort(PORT);
    server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'],
      { windowsHide: true, cwd: ROOT, stdio: 'ignore' });
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

    // ================= 编译模式（先在台上，⛔ 从沙盒往回切：那三个面板按钮只换左栏、
    // 留在沙盒模式——App.tsx:1136 的注释就是这条，回不去就别硬试）=================
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    for (const f of ['adder.v', 'full_adder.v']) {
      await page.evaluate(async (a) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const nf = fileStore.createFile(a.n); fileStore.saveContent(nf.id, a.c);
      }, { n: f, c: rd(f) });
    }
    await page.evaluate(async () => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const add = fileStore.getAll().find((x) => x.name === 'adder.v');
      const fa = fileStore.getAll().find((x) => x.name === 'full_adder.v');
      if (add && fa) fileStore.setModuleBinding(add.id, 'full_adder', fa.id);
    });
    // store 写完不会让 React 那份清单重扫（R84 夹具课）⇒ 重载一次，顺带验落盘
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.locator('[title="adder.v"]').first().click({ force: true });
    await sleep(600);
    await page.keyboard.press('F5');
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(600);
      ready = await page.evaluate(() => {
        const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper();
        return !!p && p.model.getElements().length > 2;
      });
      if (ready) break;
    }
    if (!ready) {
      ['[c1] ', '[c2] ', '[c3] ', '[c4] '].forEach((p) => skip(p + '编译模式那一套', '编译主画布没出图'));
    } else {
      await sleep(1200);
      await suite(page, 'c', 'compile');
    }

    // ---- [5] 反向对照：代码视图里 Ctrl+F 归编辑器查找，不弹部件搜索 ----
    const codeBtn = page.locator('button:has-text("代码")').first();
    if (!(await codeBtn.count())) skip('[5] 反向对照：代码视图里 Ctrl+F 不弹部件搜索', '找不到「代码」视图按钮');
    else {
      await codeBtn.click().catch(() => { });
      await sleep(800);
      const cm = page.locator('.cm-content').first();
      if (!(await cm.count())) skip('[5] 反向对照：代码视图里 Ctrl+F 不弹部件搜索', '代码视图没出现 .cm-content');
      else {
        await cm.click();
        await sleep(400);
        await page.keyboard.press('Control+f');
        await sleep(600);
        const e5 = await page.evaluate(DIALOG);
        const panel = await page.evaluate(() => !!document.querySelector('.cm-panel, .cm-panel-search, [class*="cm-search"]'));
        !e5.open
          ? ok('[5] 反向对照：编辑器聚焦时 Ctrl+F **不**弹部件搜索（分流判据的另一半成立，⛔ 只在画布有效）',
            `部件搜索弹窗=${e5.open}｜CodeMirror 查找面板=${panel}`)
          : bad('[5] 反向对照：编辑器聚焦时不应弹部件搜索', J(e5));
      }
    }

    // ================= 沙盒模式（总线换成 SandboxCanvas 那份源）=================
    await UI.newSandboxFile(page);
    await page.waitForFunction(() => !!(window).__sandboxPaper && !!(window).__sandboxPaper.model, null, { timeout: 15000 });
    await UI.clickGate(page, 'And'); await sleep(300);
    await UI.clickGate(page, 'And'); await sleep(300);
    await UI.clickGate(page, 'Lamp'); await sleep(500);
    const blank2 = await UI.blankCanvasPoint(page);
    if (blank2) { await page.mouse.click(blank2.x, blank2.y); await sleep(350); }
    await suite(page, 's', 'sandbox');

    if (errors.length) bad('[X] 过程没有 pageerror', J(errors.slice(0, 3)));
    console.log(`  [现场] pageerror ${errors.length} 条`);
  } catch (e) {
    console.log('FATAL', String((e && e.stack) || e).slice(0, 300));
    bad('[0] 闸门跑完了（没有中途抛错）', String((e && e.message) || e).slice(0, 160));
  } finally {
    try { if (browser) await browser.close(); } catch { }
    try { if (server) server.kill('SIGKILL'); } catch { }
  }
  console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unver} unverified =====`);
  process.exit(fail > 0 ? 1 : 0);
})();
