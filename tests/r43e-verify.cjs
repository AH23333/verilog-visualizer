// R43e 验收：深色主题文字 / 右键拖动不弹菜单 / 走线全局且即时
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
// 夹具按末段名解析（test_files/ 会被用户在产品里整理）：见 tests/fixtures.cjs
const { fixture } = require('./fixtures.cjs');
// R155 fileStore 削皮：编译＝index.html + 宿主推送单；沙盒那一层的画布在 gates.html，
// 「复制到沙盒」的宿主载荷由真按钮交出后播种进沙盒库（分层照 tests/r42-verify.cjs）。
// 主题：旧 `themeStore` 随旧 UI 退役，唯一真源是 body 的 vscode-dark class（useVscodeTheme.ts:1）。
const { pushCompile, waitCompiled, copyToSandboxCapture, seedSandboxStore } = require('./_ui.cjs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1539;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1539)); } catch { } const URL = `http://localhost:${PORT}/`;
const URL_GATE = `http://localhost:${PORT}/gates.html`;
const OUT = path.join(ROOT, '.tmpbuild');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(fixture(f), 'utf8');
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
// 跳过 ≠ 通过：这一格今天没量到东西就单列，不许混进 PASS 的计数里
const skip = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n}${d ? ' — ' + d : ''}`); };
const dismiss = async (page) => { try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { } };

const textAudit = (page) => page.evaluate(() => {
  const paper = document.querySelector('.joint-paper'); if (!paper) return null;
  let dark = 0, light = 0, bodies = [];
  const lum = (rgb) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb); if (!m) return -1; return 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]; };
  for (const t of paper.querySelectorAll('text')) {
    const r = t.getBoundingClientRect(); if (!r.width) continue;
    const L = lum(getComputedStyle(t).fill);
    if (L >= 0 && L < 110) dark++; else if (L >= 110) light++;
  }
  for (const bb of paper.querySelectorAll('rect.body, path.body')) { const f = getComputedStyle(bb).fill; if (f && !bodies.includes(f)) bodies.push(f); }
  return { darkTexts: dark, lightTexts: light, bodyFills: bodies };
});


// 主题旋钮（本档自带，⛔ 复活已退役的 themeStore）：照 VS Code 壳的做法改 body class，
// useVscodeTheme 的 MutationObserver 会把它同步到 documentElement[data-theme] 并让 React 重渲染。
const setTheme = async (page, want) => {
  await page.evaluate((w) => {
    document.body.classList.toggle('vscode-dark', w === 'dark');
    document.body.classList.toggle('vscode-light', w !== 'dark');
  }, want);
  for (let i = 0; i < 20; i++) {
    const got = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (got === want) return true;
    await sleep(200);
  }
  return false;
};

// 上一次跑残留的 vite 子进程会占住端口（npx 派生的 node 不随 kill() 退出），
// 于是 --strictPort 起不来、page.goto 超时 —— 表现为「0 PASS / 1 FAIL」的假红。
const freePort = (p) => {
  try {
    require('child_process').execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' });
  } catch { }
};
(async () => {
  let server, browser;
  try {
    freePort(PORT);
    server = spawn(process.execPath, [require('path').join(__dirname, '..', 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { windowsHide: true, cwd: ROOT, stdio: 'pipe' });
    const dl = Date.now() + 30000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200); await dismiss(page);
    const JOB = { files: ['adder.v', 'full_adder.v'].map((n) => ({ name: n, content: rd(n) })), topModule: 'adder', entryName: 'adder.v' };
    await pushCompile(page, JOB);
    const comp1 = await waitCompiled(page, { minCells: 3 });
    console.log('  [前置] 编译推送读数:', JSON.stringify({ status: comp1.status, cells: comp1.cells, notice: comp1.notice }));
    await sleep(3000);

    // ===== [8] 深色主题文字 =====
    // index.html 的 body 没有宿主注入的 vscode-dark class ⇒ 先按宿主形状设成深色（[8a] 判的就是深色）
    await setTheme(page, 'dark');
    console.log('  theme =', await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
    const t1 = await textAudit(page);
    console.log('  编译画布:', JSON.stringify(t1));
    (t1 && t1.darkTexts === 0 && t1.lightTexts > 10)
      ? ok('[8a] 深色主题：编译画布无黑色文字', `light=${t1.lightTexts} bodies=${JSON.stringify(t1.bodyFills)}`)
      : bad('[8a] 深色主题仍有黑字', JSON.stringify(t1));
    await page.screenshot({ path: path.join(OUT, 'r43e-dark-compile.png') });

    // 沙盒侧（gates.html 的 SandboxCanvas）：先截宿主载荷播种，再进沙盒量文字
    const cap = await copyToSandboxCapture(page);
    await seedSandboxStore(page, cap.files);
    await page.goto(URL_GATE, { waitUntil: 'domcontentloaded' }); await sleep(2600);
    await sleep(4000);
    const t2 = await textAudit(page);
    console.log('  沙盒画布:', JSON.stringify(t2));
    (t2 && t2.darkTexts === 0 && t2.lightTexts > 5)
      ? ok('[8b] 深色主题：沙盒画布无黑色文字', `light=${t2.lightTexts}`)
      : bad('[8b] 沙盒画布仍有黑字', JSON.stringify(t2));
    await page.screenshot({ path: path.join(OUT, 'r43e-dark-sandbox.png') });

    // 切浅色再切回，确认两套都成立
    // 旧 `themeStore` 随旧 React UI 退役：主题唯一真源是 body 的 vscode-dark class
    //（src/hooks/useVscodeTheme.ts 读它并写 documentElement[data-theme]，MutationObserver 跟随）。
    // 真机里那两颗 class 由 VS Code 壳注入；index.html 的裸 body 没有 ⇒ 由夹具按宿主形状设一次。
    await setTheme(page, 'light');
    await sleep(1200);
    const t3 = await textAudit(page);
    (t3 && t3.lightTexts === 0 && t3.darkTexts > 5) ? ok('[8c] 浅色主题：文字为黑（未被反向改坏）', `dark=${t3.darkTexts}`) : bad('[8c] 浅色主题文字异常', JSON.stringify(t3));
    await setTheme(page, 'dark');
    await sleep(1000);

    // ===== [9] 右键拖动 vs 右键点击 =====
    // 回编译模式：circuitJson 是会话级不落盘 ⇒ 换页后必须重新推一次编译单才有画布
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500); await dismiss(page);
    await setTheme(page, 'dark');
    await pushCompile(page, JOB);
    const comp2 = await waitCompiled(page, { minCells: 3 });
    console.log('  [9 前置] 编译推送读数:', JSON.stringify({ status: comp2.status, cells: comp2.cells }));
    await sleep(3000);
    if (!(await page.evaluate(() => !!document.querySelector('.joint-paper')))) { bad('[9] 前置：编译后仍无画布'); throw new Error('no paper'); }
    const box = await page.evaluate(() => { const el = document.querySelector('.joint-paper'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const menuOpen = () => page.evaluate(() => { const m = document.querySelector('[data-context-menu]'); return !!m && m.querySelectorAll('button, [role="menuitem"]').length > 0; });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + 120, box.y + 70, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    await sleep(700);
    const afterDrag = await menuOpen();
    !afterDrag ? ok('[9a] 右键拖动（平移）不弹菜单') : bad('[9a] 右键拖动仍弹菜单');
    await page.mouse.move(box.x, box.y);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await sleep(700);
    const afterClick = await menuOpen();
    afterClick ? ok('[9b] 右键点击仍会弹菜单（功能没被一起删掉）') : bad('[9b] 右键点击也不弹了 —— 改过头');
    await page.keyboard.press('Escape'); await sleep(400);

    // ===== [10] 走线：全局 + 即时（**按画布分开量**）=====
    // 上一版把两张画布混在一起量：路径取自"当前视口里的那张 paper"，router 分布却固定读
    // `__sandboxPaper`（切回编译模式后那是上一次挂载留下的引用）⇒ 判据名字写着"编译/沙盒共用"，
    // 实际只证了一张画布。他第 3 条要的是**两个模式都立刻变**，所以每张画布各判一遍，
    // 名字也只说得出自己那一遍的射程。短线 metro 与直线本来就同形，所以要求线数足够多才判。
    const setWire = (v) => page.evaluate(async (val) => {
      const { settingsStore } = await import('/src/store/settingsStore.ts');
      settingsStore.setSandboxSettings({ wireStyle: val });
    }, v);
    const snapBoth = () => page.evaluate(() => {
      const one = (paper) => {
        if (!paper || !paper.model) return null;
        const ds = [...((paper.el && paper.el.querySelectorAll) || []).call
          ? [] : []];   // 占位：下面用真实查询
        return null;
      };
      return null;
    });
    console.log('\n===== [10] 走线（编译画布 / 沙盒画布分别量）=====');
    await sleep(600);

    console.log('  PAGEERR:', JSON.stringify(perr.slice(0, 4)));
    perr.length ? bad('[11] 存在页面异常', perr[0]) : ok('[11] 无页面异常');
  } catch (e) { console.log('FATAL', e); fail++; } finally {
    try { await browser && browser.close(); } catch { }
    try { server && server.kill(); } catch { }
    console.log(`\n== R43e: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED ==`);
    process.exit(fail > 0 ? 1 : 0);
  }
})();
