// R88 运行时器件清单探针（**只读取数，不判定、不改 src**）
//
// 为什么要它：目标里那句「尽可能发挥 digitaljs 的全部功能」不能靠"我觉得还缺什么"来推进。
// 本仓已经有过一次教训（R75～R78）：**有的上游器件给了构造期参数仍然抛错**（`BusRegroup`／`GenMux`），
// 只看类型名清单会把这些"看着能接其实一放就崩"的器件接元件库；而静态 grep `public/digitaljs.js`
// 这次也证明不可靠（我拿 `cells.X =` 去扫，扫出来的大半是 `addGate`／`updateGates` 这类 API 名）。
// ⇒ 唯一可信的读数是**在页面里真构造一次**：
//   ① `Object.keys(digitaljs.cells)` 的全集；
//   ② 每颗用默认参数 new 一次，能不能成、拿到几个端口；
//   ③ 与沙盒元件库（`PALETTE`）对账：哪些没接、没接的哪些是"能实例化但没入口"、
//      哪些是"实例化就抛"（后者刻意不接是**决定**，不是遗漏）。
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1588; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await UI.enterSandbox(page);   // 要有 paper：构造 cell 需要一个带 display3vl 的 Graph 上下文

    const inv = await page.evaluate(async () => {
      const djs = window.digitaljs;
      if (!djs) return { noDigitaljs: true };
      // ⚠ `digitaljs.cells` 这张表里**模型与视图混在一起**（`And` 与 `AndView` 并列），
      //   而 `*View` 的构造签名是 `(def, cell)`——按器件的方式 new 必然抛
      //   "Cannot read properties of undefined (reading 'id')"（r88 第一版就被这批 View 灌满了 [C] 档）。
      //   判"接不接得了"只看模型类，视图类一律排除。
      const all = Object.keys(djs.cells || {}).sort();
      const names = all.filter((n) => !/View$/.test(n));
      const viewCount = all.length - names.length;
      const Graph = window.__sandboxPaper?.model?.constructor || null;
      const out = [];
      for (const n of names) {
        const Ctor = djs.cells[n];
        if (typeof Ctor !== 'function') { out.push({ n, ctor: 'non-class' }); continue; }
        let ports = null, err = null;
        try {
          const inst = new Ctor({ type: n, position: { x: 20, y: 20 } });
          ports = (inst.getPorts?.() || []).length;
          try { inst.remove?.(); } catch { }
        } catch (e) { err = String(e && e.message || e).slice(0, 70); }
        // 有的类要求构造期参数（inputs/bits/groups…），默认参数建不起来 ≠ 不能接，只是必须给参数
        let withParams = null;
        if (err) {
          for (const extra of [{ bits: { in: 2, out: 2 } }, { inputs: 3 }, { bits: 4 }, { groups: [2, 2] },
          { slice: { first: 0, count: 2 }, bits: 4 }, { rdports: [{}, {}], wrports: [{}] }]) {
            try {
              const inst = new Ctor({ type: n, position: { x: 20, y: 20 }, ...extra });
              withParams = { extra: Object.keys(extra).join(','), ports: (inst.getPorts?.() || []).length };
              try { inst.remove?.(); } catch { }
              break;
            } catch { /* 换下一组参数 */ }
          }
        }
        out.push({ n, ports, err: err || null, withParams });
      }
      // 沙盒元件库现算：DOM 里真实存在的 data-gate（不读源码常量，避免"清单与面板两份主人"）
      const inPanel = Array.from(document.querySelectorAll('button[data-gate]')).map((b) => b.getAttribute('data-gate'));
      return { graph: !!Graph, total: names.length, viewCount, cells: out, inPanel: Array.from(new Set(inPanel)) };
    });

    if (inv.noDigitaljs) { console.log('★页面上没有 window.digitaljs（前置没成）'); process.exit(1); }
    const missing = inv.cells.filter((c) => !inv.inPanel.includes(c.n));
    const buildable = missing.filter((c) => c.ports != null);
    const needsParams = missing.filter((c) => c.err && c.withParams);
    const broken = missing.filter((c) => c.err && !c.withParams);
    console.log(`上游**模型** cells 共 ${inv.total} 颗（另有 ${inv.viewCount} 颗 *View 视图类，按定义排除）；元件库里有 ${inv.inPanel.length} 种 data-gate；未接 ${missing.length} 颗`);
    console.log(`\n[A] 默认参数就能建、但元件库没接（这才是"少接了"的候选）：${buildable.length} 颗`);
    for (const c of buildable) console.log(`    ${c.n}  端口 ${c.ports}`);
    console.log(`\n[B] 必须给构造期参数才建得起来（接就得带默认参数）：${needsParams.length} 颗`);
    for (const c of needsParams) console.log(`    ${c.n}  需要 ${J(c.withParams?.extra)} → 端口 ${c.withParams?.ports}`);
    console.log(`\n[C] 给了参数仍抛（刻意不接是决定）：${broken.length} 颗`);
    for (const c of broken.slice(0, 40)) console.log(`    ${c.n}  ${(c.err || '').slice(0, 60)}`);
    console.log('\n[元件库现有]', J(inv.inPanel));
    console.log('  PAGEERR:', J(perr.slice(0, 4)));
  } catch (e) {
    console.log('FATAL', String(e && e.stack || e).slice(0, 400));
  } finally {
    try { await browser?.close(); } catch { }
    try { server?.kill('SIGKILL'); } catch { }
    UI.freePort(PORT);
    process.exit(0);
  }
})();
