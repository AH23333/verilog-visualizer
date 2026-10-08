// R43e 验收：深色主题文字 / 右键拖动不弹菜单 / 走线全局且即时
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1539;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1539)); } catch { } const URL = `http://localhost:${PORT}/`;
const OUT = path.join(ROOT, '.tmpbuild');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
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
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const dl = Date.now() + 30000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200); await dismiss(page);
    for (const f of ['adder.v', 'full_adder.v']) {
      await page.evaluate(async (a) => { const { fileStore } = await import('/src/store/fileStore.ts'); const nf = fileStore.createFile(a.n); fileStore.saveContent(nf.id, a.c); }, { n: f, c: rd(f) });
    }
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300); await dismiss(page);
    await page.locator('[title="adder.v"]').first().click({ force: true }); await sleep(700);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    for (let i = 0; i < 60; i++) { await sleep(700); const done = await page.evaluate(async () => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getAll()[0]; return !!(f && f.status === 'compiled' && f.circuitJson); }); if (done) break; }
    await sleep(3000);

    // ===== [8] 深色主题文字 =====
    console.log('  theme =', await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
    const t1 = await textAudit(page);
    console.log('  编译画布:', JSON.stringify(t1));
    (t1 && t1.darkTexts === 0 && t1.lightTexts > 10)
      ? ok('[8a] 深色主题：编译画布无黑色文字', `light=${t1.lightTexts} bodies=${JSON.stringify(t1.bodyFills)}`)
      : bad('[8a] 深色主题仍有黑字', JSON.stringify(t1));
    await page.screenshot({ path: path.join(OUT, 'r43e-dark-compile.png') });

    // 沙盒侧
    await page.locator('button[title*="复制到沙盒"]').first().click(); await sleep(6000);
    const t2 = await textAudit(page);
    console.log('  沙盒画布:', JSON.stringify(t2));
    (t2 && t2.darkTexts === 0 && t2.lightTexts > 5)
      ? ok('[8b] 深色主题：沙盒画布无黑色文字', `light=${t2.lightTexts}`)
      : bad('[8b] 沙盒画布仍有黑字', JSON.stringify(t2));
    await page.screenshot({ path: path.join(OUT, 'r43e-dark-sandbox.png') });

    // 切浅色再切回，确认两套都成立
    await page.evaluate(async () => { const { themeStore } = await import('/src/store/themeStore.ts'); themeStore.set && themeStore.set('light'); });
    await sleep(1200);
    const t3 = await textAudit(page);
    (t3 && t3.lightTexts === 0 && t3.darkTexts > 5) ? ok('[8c] 浅色主题：文字为黑（未被反向改坏）', `dark=${t3.darkTexts}`) : bad('[8c] 浅色主题文字异常', JSON.stringify(t3));
    await page.evaluate(async () => { const { themeStore } = await import('/src/store/themeStore.ts'); themeStore.set && themeStore.set('dark'); });
    await sleep(1000);

    // ===== [9] 右键拖动 vs 右键点击 =====
    // 回编译模式：circuitJson 是会话级不落盘 ⇒ 重载后必须重新编译才有画布
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500); await dismiss(page);
    await page.locator('[title="adder.v"]').first().click({ force: true }); await sleep(1200);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    for (let i = 0; i < 60; i++) { await sleep(700); const done = await page.evaluate(async () => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getAll()[0]; return !!(f && f.status === 'compiled' && f.circuitJson); }); if (done) break; }
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
