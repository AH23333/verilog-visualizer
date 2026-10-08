// R69 探针（只打读数，不作判定）：上游 `digitaljs.cells` 到底有哪些**可实例化**的器件类，
// 我们的元件库缺哪几颗，缺的那几颗构造出来长什么样（端口/尺寸/构造期参数）。
//
// 为什么不能靠读 bundle 猜：`public/digitaljs.js` 里 `.define("X")` 只扫到 86 个类，而
// Lamp / Button / NumEntry 这些**明明能用**的器件根本不在其中（它们不是 define 造的）
// ⇒ 器件全集只能问运行时那张表：`Object.keys(window.digitaljs.cells)`。
//
// 打四组读数：
//  [1] cells 表全量（按字母序）＋元件库实际出现的 data-gate 值；
//  [2] 差集里每颗：new cells.X({type:X,position}) 是否抛错、抛什么；
//  [3] 每颗成功构造后的端口 id、size、以及构造期参数的现场形状
//      （inputs / default_input / groups / bits / polarity —— 决定要不要进 deviceParams 名单）；
//  [4] 元件库里有、但 cells 表里没有的（说明我们靠 extra 变体或历史存档撑着，别误删）。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1691; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

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

    const palette = await page.evaluate(() => [...document.querySelectorAll('button[data-gate]')]
      .map((b) => b.getAttribute('data-gate')));
    console.log('[1a] 元件库 data-gate =', J(palette));

    const table = await page.evaluate(() => {
      const d = window.digitaljs;
      if (!d?.cells) return { noTable: true };
      return { keys: Object.keys(d.cells).sort(), n: Object.keys(d.cells).length };
    });
    console.log('[1b] cells 表 =', J(table));
    if (table.noTable) { console.log('没有 cells 表，后面不作数'); }
    else {
      const diff = await page.evaluate((pal) => {
        const all = Object.keys(window.digitaljs.cells);
        const pset = new Set(pal);
        const notInPalette = all.filter((k) => !pset.has(k) && !/View$/.test(k) && /^[A-Z]/.test(k)
          && !/^(Wire|Subcircuit|IO|Input|Output|Box|Gate|Arith|Compare|Shift|NumBase|Monitor|Button)$/.test(k));
        const missingFromTable = pal.filter((t) => !all.includes(t));
        return { notInPalette: notInPalette.sort(), missingFromTable };
      }, palette);
      console.log('[1c] 上游有、元件库没有的 =', J(diff.notInPalette));
      console.log('[4]  元件库有、cells 表没有的 =', J(diff.missingFromTable));

      const tried = [];
      for (const t of diff.notInPalette) {
        const r = await page.evaluate((a) => {
          const d = window.digitaljs;
          const C = d.cells[a];
          const out = { type: a, isViewLike: /View$/.test(a) };
          try {
            const c = new C({ type: a, position: { x: 20, y: 20 } });
            out.ok = true;
            out.ports = (c.get('ports')?.items || []).map((p) => String(p.id));
            const s = c.get('size'); out.size = s ? { w: Math.round(s.width), h: Math.round(s.height) } : null;
            for (const k of ['inputs', 'default_input', 'groups', 'bits', 'polarity', 'constant', 'leftOp', 'slice', 'extend', 'states']) {
              const v = c.get(k);
              if (v === undefined) continue;
              out[k] = Array.isArray(v) ? v.map((x) => (typeof x === 'bigint' ? `BigInt(${x})` : x))
                : typeof v === 'bigint' ? `BigInt(${v})` : v;
            }
          } catch (e) { out.ok = false; out.err = String(e && e.message || e).slice(0, 120); }
          return out;
        }, t);
        tried.push(r);
      }
      console.log('[2/3] 逐颗构造读数：');
      for (const r of tried) console.log('   ', J(r));
      const okN = tried.filter((r) => r.ok).length;
      console.log(`     可构造 ${okN} / ${tried.length}（抛错的通常是抽象基类或需要构造期参数的器件）`);

      // 抛错的那几颗再试一次「带构造期参数」的形状 —— 这决定它们能不能进元件库，
      // 以及要往 deviceParams 名单里补哪几颗键（r69 第一遍读数：MuxSparse 没 inputs 直接抛
      // "Cannot read properties of undefined (reading 'length')"、BusRegroup 没 groups 抛
      // "Cannot set properties of undefined (setting 'NaN')"）。
      const RETRY = {
        MuxSparse: { inputs: ['0', '1', '3'], default_input: true, bits: { in: 4, sel: 2 } },
        BusRegroup: { groups: [1, 1, 2, 4] },
        GenMux: { bits: { in: 1, sel: 2 } },
      };
      console.log('[5] 抛错的那几颗，带着构造期参数再试：');
      for (const r of tried) {
        const extra = RETRY[r.type];
        if (!extra || r.ok) continue;
        const again = await page.evaluate((a) => {
          const d = window.digitaljs;
          const out = { type: a.type, extra: a.extra };
          try {
            const c = new d.cells[a.type](Object.assign({ type: a.type, position: { x: 20, y: 20 } }, a.extra));
            out.ok = true;
            out.ports = (c.get('ports')?.items || []).map((p) => String(p.id));
            const s = c.get('size'); out.size = s ? { w: Math.round(s.width), h: Math.round(s.height) } : null;
            for (const k of ['inputs', 'default_input', 'groups', 'bits']) {
              const v = c.get(k);
              if (v === undefined) continue;
              out[k] = Array.isArray(v) ? v.map((x) => (typeof x === 'bigint' ? `BigInt(${x})` : x))
                : typeof v === 'bigint' ? `BigInt(${v})` : v;
            }
          } catch (e) { out.ok = false; out.err = String(e && e.message || e).slice(0, 140); }
          return out;
        }, { type: r.type, extra });
        console.log('   ', J(again));
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
