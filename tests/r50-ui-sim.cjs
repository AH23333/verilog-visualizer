// R50 验收：编译模式的「单步」与输入面板的「切换」按钮**按下去真的有效果**。
// 根因：Canvas.tsx 用 `cell.outputSignals` 直接属性取信号向量，而 digitaljs 把它挂在
// attributes 上（cell.get('outputSignals')）——直接属性恒 undefined，于是
// stepOnce 拨不动时钟、toggleInput 在第一行 `if (!sig?._bvec) return` 就返回，
// 面板列出的输入值也永远取不到（表现为「点了没反应」）。
// 这里全程走真实 UI：编译 → 暂停 → 打开输入面板 → 点 rst → 点单步，读数用
// Canvas 自带的 DEV 钩子 __djsDebug（只读）。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1590;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1590)); } catch { } const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const dismiss = async (page) => { try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { } };
const freePort = (p) => {
  try {
    require('child_process').execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' });
  } catch { }
};

// 读数走 Canvas 的 DEV 钩子 getPaper()，逐根 net 各自 try/catch：
// __djsDebug.getSignals() 会对「半初始化」的向量调 String()，digitaljs 的
// Vector3vl.toString() 在那种状态下自己会抛（实测），整颗钩子就崩掉。
const SIGS = () => {
  const d = (window).__djsDebug;
  if (!d) return { has: false };
  const paper = d.getPaper();
  const vec = (s) => { try { return s == null ? 'x' : String(s).replace(/^Vector3vl\s+/, ''); } catch { return 'THROW'; } };
  const nets = {};
  for (const lk of paper.model.getLinks()) {
    const n = String(lk.get('netname') || '');
    if (!n || nets[n] !== undefined) continue;
    nets[n] = vec(lk.get('signal'));
  }
  const cells = {};
  for (const el of paper.model.getElements()) {
    const n = String(el.get('net') || '');
    if (!n || cells[n] !== undefined) continue;
    const o = el.get('outputSignals') || {};
    cells[n] = vec(o.out || Object.values(o)[0]);
  }
  return { has: true, nets, cells };
};

(async () => {
  let server, browser;
  try {
    freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    // ⚠ stdio 必须是 ignore 而且要 unref：用 'pipe' 时这颗 npx 的孙进程（真正的 vite）攥着父进程的
    //   标准流不放 ⇒ 汇总行印了进程却不退出，run-all 只读到 ETIMEDOUT/ENVRED（与 r48 同一因）。
    try { server.unref(); } catch { }
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务未起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 180)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200); await dismiss(page);

    await page.evaluate(async (a) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const nf = fileStore.createFile('r50_counter.v'); fileStore.saveContent(nf.id, a.c);
    }, { c: rd('r50_counter.v') });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300); await dismiss(page);
    await page.locator('[title="r50_counter.v"]').first().click({ force: true }); await sleep(700);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    for (let i = 0; i < 60; i++) {
      await sleep(700);
      const done = await page.evaluate(async () => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getAll()[0]; return !!(f && f.status === 'compiled' && f.circuitJson); });
      if (done) break;
    }
    await sleep(2500);
    if (!(await page.evaluate(() => !!document.querySelector('.joint-paper')))) { bad('前置：编译后没有画布'); throw new Error('no paper'); }

    const s0 = await page.evaluate(SIGS);
    if (!s0.has) { bad('前置：DEV 只读钩子 __djsDebug 不在，无法读数'); throw new Error('no hook'); }
    const preOk = s0.nets && s0.nets.q !== undefined && s0.nets.rst !== undefined;
    preOk ? ok('前置：计数器已编译，q/rst 两根 net 都读得到', `q=${s0.nets.q} rst=${s0.nets.rst} rst器件out=${s0.cells.rst}`)
      : bad('前置：图上找不到 q/rst 两根 net', JSON.stringify(s0.nets));
    if (!preOk) throw new Error('no nets');

    // ===== [1] 暂停后「单步」要真的走时钟沿 =====
    // 计数器 q 的下一拍是 q+1，起点是 x ⇒ x+1 还是 x，必须先用 rst 把它拉出 x，
    // 才谈得上「沿落了没有」（r50b 实测：不先复位时 q 恒 xxxx，判据看不出差别）。
    // R103：暂停/继续已合并成**单态按钮**，title 从 'Pause simulation' 改成
    //   「暂停仿真（定格当前波形，R103）」/「继续运行」⇒ 按旧 title 找会超时。
    //   改用组件上的稳定锚点 data-testid="sim-pause-toggle"。
    await page.locator('[data-testid="sim-pause-toggle"]').first().click(); await sleep(600);
    const paused = await page.evaluate(() => !!document.querySelector('button[title="Step one delta-cycle (F7)"]'));
    const stepClicks = async (n) => {
      for (let i = 0; i < n; i++) {
        const btn = await page.$('button[title="Step one delta-cycle (F7)"]');
        if (!btn) return false;
        await btn.click(); await sleep(320);
      }
      return true;
    };
    // 先把 rst 拉高（走面板那颗按钮，顺便验 toggleInput）
    await page.locator('button[title="切换输入开关面板"]').first().click(); await sleep(700);
    const qBefore = (await page.evaluate(SIGS)).nets.q;
    const clickedRst = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => /rst/i.test((b.textContent || '').trim()));
      if (!btns.length) return false;
      btns[0].click(); return true;
    });
    await sleep(500);
    const sRst = await page.evaluate(SIGS);
    await stepClicks(2);
    const s1 = await page.evaluate(SIGS);
    if (!paused) bad('[1a] 前置：没找到暂停/单步入口');
    else if (!clickedRst) bad('[1a] 前置：面板里点不到 rst 那颗按钮');
    else if (String(sRst.nets.rst) !== '1') bad('[1a] 点「切换」后 rst 没变成 1（toggleInput 无效）', JSON.stringify({ rst: sRst.nets.rst, qBefore: s1.nets.q }));
    else ok('[1a] 点「切换」后 rst 变成 1（走的是 net 上的真值）', `rst=${sRst.nets.rst}，之前 q=${qBefore}`);
    if (String(s1.nets.q) === '0000') ok('[1b] rst=1 时连点 2 次「单步」，q 被时钟沿装载成 0000（沿真的落了）', `q: ${qBefore} → ${s1.nets.q}`);
    else bad('[1b] rst=1 且点了单步，q 却没被装载（时钟沿没落）', JSON.stringify({ qBefore, q: s1.nets.q, rst: s1.nets.rst }));

    // 放开 rst 再走三个沿：q 必须逐拍递增
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => /rst/i.test((b.textContent || '').trim()));
      if (btns.length) btns[0].click();
    });
    await sleep(400);
    const qSeq = [];
    for (let i = 0; i < 3; i++) { await stepClicks(1); qSeq.push((await page.evaluate(SIGS)).nets.q); }
    const rstOff = (await page.evaluate(SIGS)).nets.rst;
    if (String(rstOff) !== '0') bad('[1c] 再点一次「切换」rst 没回到 0（关掉被编码成 x？）', JSON.stringify({ rstOff }));
    else if (new Set(qSeq).size !== 3 || qSeq[2] === '0000') bad('[1c] 单步三个沿后 q 没逐拍递增', JSON.stringify({ rstOff, qSeq }));
    else ok('[1c] 放开 rst 后每个单步沿让 q +1', JSON.stringify({ rstOff, qSeq }));

    // ===== [2] 输入面板列出输入 =====
    const panel = await page.evaluate(() => {
      const heads = Array.from(document.querySelectorAll('div,span,button')).filter((e) => (e.textContent || '').trim() === 'Inputs');
      const box = heads.length ? heads[heads.length - 1].closest('div') : null;
      const root = box && box.parentElement ? box.parentElement : document;
      return { texts: Array.from(root.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 12) };
    });
    const listed = panel.texts.some((t) => /rst/i.test(t));
    listed ? ok('[2] 输入面板列出 rst/clk 输入', JSON.stringify(panel.texts))
      : bad('[2] 输入面板没列出输入', JSON.stringify(panel.texts));

    perr.length === 0 ? ok('[4] 全程无页面异常') : bad('[4] 页面异常', JSON.stringify(perr.slice(0, 3)));
    console.log(`\n== R50: ${pass} PASS / ${fail} FAIL ==`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 300));
    process.exitCode = 1;
  } finally {
    try { server && server.kill(); } catch { }
    try { browser && await browser.close(); } catch { }
  }
})();
