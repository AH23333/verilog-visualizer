// r66 只读探针：**每一种元件**的参数在"存盘 → 重开"这条往返里会不会被悄悄丢掉。
//
// 为什么要扫全表：`src/lib/deviceParams.ts` 的 CTOR_PARAM_KEYS 是一份**白名单**——
// 不在名单上的属性在序列化时被剥掉。以前我只按上游源码挑了几个键补进去（signed/fillx/words/offset），
// 那是"推测"。这里不推测：把元件库每一颗都放一遍，读它**活着的**属性键，再读**存进文件后**的键，
// 差集就是"会被吃掉的东西"。先拿读数，再决定名单怎么改。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1661; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

// joint/画布自己的内部属性，不是器件参数，不算"被吃掉"
const INTERNAL = new Set(['position', 'size', 'angle', 'z', 'inEmbeds', 'outEmbeds', 'embeds', 'parent',
  'vertex', 'source', 'target', 'labels', 'tools', 'attrs', 'style', 'id', 'type', 'ports', 'subcircuitGraph',
  'inputSignals', 'outputSignals', 'bitsWidth', 'graph', 'subcircuits', 'displayGraph', 'display']);

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 140)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1200);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    await UI.enterSandbox(page);
    // 元件库全表（data-gate 值 + 中文标签），按 data-gate 去重后再逐个放
    const types = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('button[data-gate]'))
      .map((b) => b.getAttribute('data-gate')))]);
    console.log('元件库类型 =', J(types));

    const placed = [];
    for (const t of types) {
      const before = await page.evaluate(() => window.__sandboxPaper.model.getElements().length);
      try { await UI.clickGate(page, t, { tries: 1 }); } catch (e) { console.log(`  放 ${t} 失败：${String(e.message).slice(0, 60)}`); continue; }
      await sleep(250);
      const got = await page.evaluate((a) => {
        const p = window.__sandboxPaper;
        if (p.model.getElements().length <= a.before) return null;
        const c = p.model.getElements()[p.model.getElements().length - 1];
        return { id: c.id, type: String(c.get('type')), keys: Object.keys(c.attributes) };
      }, { before });
      if (!got) { console.log(`  ${t}: 放置后器件数没变（这一格不作数）`); continue; }
      placed.push(got);
    }
    console.log(`\n放了 ${placed.length} 颗，开始存盘对比…`);

    await page.evaluate(() => window.__sandboxSave && window.__sandboxSave());
    await sleep(1200);
    const stored = await page.evaluate(async (ids) => {
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      const out = {};
      for (const f of sandboxStore.list()) {
        let j; try { j = JSON.parse(f.graphJson || 'null'); } catch { continue; }
        for (const c of (j && j.cells) || []) if (ids.includes(c.id)) out[c.id] = Object.keys(c);
      }
      return out;
    }, placed.map((p) => p.id));

    const rows = [];
    for (const p of placed) {
      const st = stored[p.id];
      if (!st) { rows.push({ type: p.type, note: '存盘里没有这颗' }); continue; }
      const dropped = p.keys.filter((k) => !st.includes(k) && !INTERNAL.has(k));
      if (dropped.length) rows.push({ type: p.type, dropped, live: p.keys.length, stored: st.length });
    }
    console.log('\n=== 会被吃掉的属性（活着的键 − 存盘的键 − joint 内部键）===');
    for (const r of rows) console.log('  ', J(r));
    console.log('干净（无属性丢失）的类型 =', J(placed.filter((p) => !rows.some((r) => r.type === p.type)).map((p) => p.type)));
    console.log('\n每类实际存下来的键（前 3 类）:', J(placed.slice(0, 3).map((p) => ({ t: p.type, live: p.keys, stored: stored[p.id] || null }))));
    console.log('页面异常=', perr.slice(0, 3));
  } catch (e) { console.log('FATAL ' + String(e.stack || e).slice(0, 400)); }
  finally { if (browser) await browser.close().catch(() => { }); if (server) server.kill(); UI.freePort(PORT); }
})();
