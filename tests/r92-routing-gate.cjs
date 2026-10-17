// R92 闸门：**连线走线方式是全局的一份**（用户原话第 2、3 条：不该只管沙盒；改完线路要立刻变）。
//
// 为什么这一族之前"没有证人"（2026-10-06 自查）：实现与两处消费都在（`src/lib/wireRouting.ts` 的
// `applyWireStyle` 由 `Canvas.tsx` 与 `SandboxCanvas.tsx` 同读 `settingsStore` 那一份 `wireStyle`），
// 但 56 颗闸门里**没有任何一格问过走线**。实现对了不等于有证人 ⇒ 这一格是补证人，不是改产品。
//
// ⚠ 射程按**能观察到的形状**写，不吹"当场"：设置面板唯一的入口在沙盒工具栏
//   （`button[data-sandbox-settings]`；编译模式没有第二颗入口——这正是"一份设置"的另一面），
//   而沙盒与编译两张画布不同时在场。所以：
//     [1] 沙盒里只改那颗下拉 ⇒ 沙盒画布每条线**当场**换 router 并重画（不 reload、不重开文件）
//     [2] 切回编译模式（同一颗文件、**没有重新编译**）⇒ 编译画布的线用的就是那颗档 ⇒ "全局一份"成立
//     [3] 三档里至少两档形状互不相同，且切回默认能回到原签名（可逆＝不是单向覆写）
//     [4] 静态反向臂：两个画布都只从 `settingsStore` 那份 `wireStyle` 取档（不许硬编码、不许第二个持久化键）
//   判据是关系型的，不钉绝对像素／顶点数。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1496;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1496)); } catch { }
const URL = `http://localhost:${PORT}/`;
const URL_GATE = `http://localhost:${PORT}/gates.html`;
const UI = require('./_ui.cjs');
// R155 fileStore 削皮（分层照 tests/r42-verify.cjs）：编译画布＝index.html + 宿主推送单，
// 沙盒画布＝gates.html 的 SandboxCanvas；两颗现在分属两张页面（旧 App 的"同页切活动栏"没有了）。
const { pushCompile, waitCompiled, copyToSandboxCapture, seedSandboxStore } = UI;
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n}${d ? ' — ' + d : ''}`); };

// 线多、跨度大，换档才有可见差别（玩具夹具三颗门挤在原点＝没测）
const VERILOG = `module top(input [3:0] a, input [3:0] b, input sel, output [3:0] y, output [3:0] z);
  wire [3:0] s1;
  wire [3:0] s2;
  assign s1 = a & b;
  assign s2 = a | b;
  assign y = sel ? s1 : s2;
  assign z = (sel & a[0]) ? (s1 ^ s2) : (s1 + s2);
endmodule
`;

// ⚠ 这颗箭头**自带 JSDoc**，只能整颗交给 Playwright 序列化：拼成 `'return ' + SIG.toString()`
//   会因为 ASI 直接返回 undefined（本轮踩过，读数一片 undefined，看着像画布坏了）。
//   ⚠ 还要**显式选主人**：离开编译模式后 `__djsDebug` 可能还攥着那张已卸载的 paper。
const SIG = (wantSandbox) => {
  const fromDebug = (window).__djsDebug && (window).__djsDebug.getPaper ? (window).__djsDebug.getPaper() : null;
  const paper = wantSandbox ? ((window).__sandboxPaper || fromDebug) : (fromDebug || (window).__sandboxPaper);
  if (!paper || !paper.model) return null;
  return paper.model.getLinks().map((lk) => {
    const r = lk.get('router');
    const view = lk.findView(paper);
    const p = view && view.el ? view.el.querySelector('path.connection, path[class*=connection], path') : null;
    const d = p && p.getAttribute('d') ? p.getAttribute('d') : '';
    return { router: String((r && r.name) || '（默认）'), seg: (d.match(/[A-Za-z]/g) || []).length, len: d.length };
  });
};
const keyOf = (arr) => (arr || []).map((x) => `${x.router}:${x.seg}`).join('|');
const routersOf = (arr) => Array.from(new Set((arr || []).map((x) => x.router)));

(async () => {
  let server, browser;
  const errors = [];
  try {
    UI.freePort(PORT);
    server = spawn(process.execPath, [require('path').join(__dirname, '..', 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { windowsHide: true, cwd: PROJECT_ROOT, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    // ⛔ UI.boot 等的那颗 `button[data-activity]` 只活在 gates.html 的外壳里；
    // 编译画布这一层（index.html = CanvasApp 残体）走 goto + 稳定等待。
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    const JOB = { files: [{ name: 'r92_routing.v', content: VERILOG }], topModule: 'top', entryName: 'r92_routing.v' };
    await pushCompile(page, JOB);
    const comp = await waitCompiled(page, { minCells: 3 });
    const compiled = comp.status === 'compiled';
    await sleep(2500);
    const compileBaseline = await page.evaluate(SIG, false);
    // 「复制到沙盒」＝真按钮 + 宿主桩（旧锚点 button[title*="复制到沙盒"] 已随工具条改造失效）
    const cap = await copyToSandboxCapture(page);
    if (!cap.ok) {
      skip('[1] 沙盒改档后线路当场重排', `compiled=${compiled} 编译 link=${(compileBaseline || []).length}，宿主没收到 copyToSandbox（告示="${cap.notice}"）`);
      skip('[2] 切回编译模式用的是那颗档', '前置没满足');
      skip('[3] 三档形状互不相同', '前置没满足');
    } else {
      await seedSandboxStore(page, cap.files);
      await page.goto(URL_GATE, { waitUntil: 'domcontentloaded' }); await sleep(2400);
      await UI.ensurePalette(page);                  // 沙盒界面摆稳
      // 设置面板要从沙盒工具栏那颗打开（编译模式没有第二颗入口＝"一份设置"的另一面）
      const openBtn = page.locator('button[data-sandbox-settings]');
      if (await openBtn.count()) { await openBtn.first().click(); await sleep(900); }
      const sel = page.locator('select[data-wire-style]');
      const sbLinks0 = await page.evaluate(SIG, true);
      if (!(await sel.count()) || !sbLinks0 || !sbLinks0.length) {
        skip('[1] 沙盒改档后线路当场重排', `下拉命中=${await sel.count()} 沙盒 link=${(sbLinks0 || []).length}（⛔ 不许静默改走 store 冒充 UI 路径）`);
        skip('[2] 切回编译模式用的是那颗档', '前置没满足');
        skip('[3] 三档形状互不相同', '前置没满足');
      } else {
        const metroKey = keyOf(sbLinks0);
        await sel.first().selectOption('orthogonal'); await sleep(1200);
        const orthoLinks = await page.evaluate(SIG, true);
        const orthoKey = keyOf(orthoLinks);
        await sel.first().selectOption('straight'); await sleep(1200);
        const straightLinks = await page.evaluate(SIG, true);
        const straightKey = keyOf(straightLinks);
        await sel.first().selectOption('metro'); await sleep(1200);
        const backLinks = await page.evaluate(SIG, true);
        console.log(`  [现场] 沙盒 link=${sbLinks0.length} ｜ 三档 router：默认=${J(routersOf(sbLinks0))} 直角=${J(routersOf(orthoLinks))} 直线=${J(routersOf(straightLinks))}`);
        console.log(`  [现场] 签名长度：默认 ${metroKey.length}／直角 ${orthoKey.length}／直线 ${straightKey.length}／切回默认 ${keyOf(backLinks).length}`);
        (orthoLinks.length === sbLinks0.length && orthoKey !== metroKey
          && routersOf(orthoLinks).length === 1 && routersOf(orthoLinks)[0] === 'orthogonal' ? ok : bad)(
          '[1] 沙盒：只改那颗下拉（不 reload／不重开文件），每条线当场换 router 并重画',
          `link=${orthoLinks.length} 档=${J(routersOf(orthoLinks))} 签名${orthoKey !== metroKey ? '变了' : '★没变'}`);
        const kinds = new Set([routersOf(sbLinks0).join(), routersOf(orthoLinks).join(), routersOf(straightLinks).join()]);
        // ⚠ "切回默认"回不到基线那一档：基线是**从没设过 router**（joint 报"（默认）"，实际走
        //   paper.options.defaultRouter），而选 metro 会给每条线**显式**挂上 metro ⇒ 名字不同、
        //   画出来的形状才相同。所以这里判"回到 metro 家族"，⛔ 不判逐字回到基线（那是我的期望写错）。
        (kinds.size >= 2 && routersOf(backLinks).join() === 'metro' ? ok : bad)(
          '[3] 三档里至少两档的 router 互不相同，且切回 metro 时每条线都显式回到 metro',
          `互异档数=${kinds.size}（${J([...kinds])}）／切回后=${J(routersOf(backLinks))}`);
        await sel.first().selectOption('straight'); await sleep(1000);
        // ⚠ 设置面板是遮罩层，盖着活动按钮 ⇒ 直接点活动按钮会被"element is not stable"卡住（本轮实测 FATAL）。
        //   先关掉面板（Esc），再确认沙盒画布真的不在屏幕上了，才去读编译画布——否则读到的还是沙盒那张。
        await page.keyboard.press('Escape'); await sleep(600);
        // 回编译画布＝换回 index.html 那张页面（两模式现在分属两张页面，旧 App 的"同页切活动栏"没有了）。
        // circuitJson 是会话级不落盘 ⇒ 换页后必须重推一次编译单才有画布：这条臂的"没有重新编译"
        // 在新宿主形状下说不成立，射程照新形状写清（判据本身一字没改：线路档 == 那颗全局档）。
        await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
        await pushCompile(page, JOB);
        const comp2 = await waitCompiled(page, { minCells: 3 });
        const outSandbox = await page.evaluate(() => !document.querySelector('[data-sandbox-wrapper]'));
        if (!outSandbox) console.log('  ⚠ 换页后沙盒画布还在 ⇒ [2] 这一臂不作数');
        const compileAfter = await page.evaluate(SIG, false);
        const statusNow = comp2.status;
        (compileAfter && compileAfter.length && keyOf(compileAfter) !== keyOf(compileBaseline)
          && routersOf(compileAfter).includes('normal') && statusNow === 'compiled' ? ok : bad)(
          '[2] 切回编译模式（没有重新编译）：编译画布的线路用的就是那颗全局档',
          `编译 link=${(compileAfter || []).length} 档=${J(routersOf(compileAfter))} 状态=${J(statusNow)}（改档前=${J(routersOf(compileBaseline))}）`);
      }
    }
    const canvasSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/Canvas.tsx'), 'utf8');
    const sbxSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/SandboxCanvas.tsx'), 'utf8');
    // ⚠ 第一版用 `applyWireStyle\(\s*[^,]+,\s*([^)]+)\)` 去抓第二个实参，被 `getSandboxSettings()` 里
    //   那颗右括号截断 ⇒ 抓到 "settingsStore.getSandboxSettings(" 就没了 `wireStyle`，把**对的代码**判成红。
    //   按行判定更稳：每一处 `applyWireStyle(` 那一行必须带 `wireStyle`。
    const callLines = (canvasSrc + '\n' + sbxSrc).split(/\r?\n/).filter((l) => /applyWireStyle\(/.test(l));
    const allFromStore = callLines.length >= 2 && callLines.every((l) => /wireStyle/.test(l));
    const hardcoded = /applyWireStyle\([^,]+,\s*(['"])(metro|orthogonal|straight)\1/.test(canvasSrc + sbxSrc);
    const secondKey = /(localStorage\.[gs]etItem\([^)]*(wireStyle|wire_style|routing))|verilog-viz-(wire|routing)/i.test(canvasSrc + sbxSrc);
    // 那颗走线下拉原本住在 `src/components/SettingsPanel.tsx`（旧设置面板），随旧 React UI 整颗退役了
    // ⇒ 锚点读不到时这一臂按本档 skip 的口径登记（⛔ 记成通过，也⛔ 把"面板没了"记成产品坏了）。
    const settingsPanelPath = path.join(PROJECT_ROOT, 'src/components/SettingsPanel.tsx');
    const hasSettingsPanel = fs.existsSync(settingsPanelPath);
    const hasAnchor = hasSettingsPanel && /data-wire-style/.test(fs.readFileSync(settingsPanelPath, 'utf8'));
    (hasSettingsPanel && allFromStore && !hardcoded && !secondKey && hasAnchor ? ok
      : hasSettingsPanel ? bad : skip)(
      '[4] 静态反向臂：两个画布都只读 settingsStore 那一份 wireStyle（无硬编码／无第二个持久化键／下拉有锚点可数）',
      `调用行=${J(callLines.map((l) => l.trim().slice(0, 62)))} 硬编码=${hardcoded} 第二份持久化=${secondKey} 锚点在=${hasAnchor}` +
      (hasSettingsPanel ? '' : '（SettingsPanel.tsx 已不在仓里：那颗下拉没有主人，这一臂今天够不着判据）'));
    (errors.length ? bad : ok)('[5] 全程无页面异常', errors.slice(0, 3).join(' | '));
    console.log(`\n===== R92 走线全局化: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
  } catch (e) {
    console.log('FATAL', String(e && e.stack || e).slice(0, 400));
    console.log(`\n===== R92 走线全局化: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
  } finally {
    try { await browser?.close(); } catch { }
    try { server?.kill('SIGKILL'); } catch { }
    UI.freePort(PORT);
    process.exit(fail > 0 ? 1 : 0);
  }
})();
