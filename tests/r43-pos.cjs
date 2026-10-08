// R43 位置保真探针：四方坐标对照
//  A 编译画布（顶层）  B 复制出的顶层沙盒画布  C 编译模式展开图(elk)  D 部件文件画布(dagre)
//  输出：逐 id 位置、包围盒、以及「归一化后」的平均偏移（消掉原点差）
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1531; const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
const dismiss = async (page) => { try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { } };

// 把一组 {id -> {x,y}} 归一化到 [0,1] 方框内再比，消掉平移与整体缩放
const normDev = (a, b) => {
  const keys = Object.keys(a).filter((k) => k in b);
  if (!keys.length) return null;
  const box = (o) => {
    const xs = keys.map((k) => o[k].x); const ys = keys.map((k) => o[k].y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) || 1, h: Math.max(...ys) - Math.min(...ys) || 1 };
  };
  const ba = box(a); const bb = box(b);
  let s = 0; let worst = 0; let worstId = '';
  for (const k of keys) {
    const dx = Math.abs((a[k].x - ba.x0) / ba.w - (b[k].x - bb.x0) / bb.w);
    const dy = Math.abs((a[k].y - ba.y0) / ba.h - (b[k].y - bb.y0) / bb.h);
    const d = Math.hypot(dx, dy);
    s += d; if (d > worst) { worst = d; worstId = k; }
  }
  return { n: keys.length, meanDev: +(s / keys.length).toFixed(4), worstDev: +worst.toFixed(4), worstId };
};

(async () => {
  let server, browser;
  try {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const dl = Date.now() + 30000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200); await dismiss(page);
    const ids = {};
    for (const f of ['multiplier.v', 'adder.v', 'full_adder.v']) {
      ids[f] = await page.evaluate(async (a) => { const { fileStore } = await import('/src/store/fileStore.ts'); const nf = fileStore.createFile(a.n); fileStore.saveContent(nf.id, a.c); return nf.id; }, { n: f, c: rd(f) });
    }
    for (const [file, mod, src] of [['multiplier.v', 'adder', 'adder.v'], ['adder.v', 'full_adder', 'full_adder.v']]) {
      await page.evaluate(async (a) => { const { fileStore } = await import('/src/store/fileStore.ts'); fileStore.setModuleBinding(a.f, a.m, a.s); }, { f: ids[file], m: mod, s: ids[src] });
    }
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300); await dismiss(page);
    await page.locator('[title="multiplier.v"]').first().click({ force: true }); await sleep(800);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    for (let i = 0; i < 90; i++) { await sleep(700); const done = await page.evaluate(async (x) => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getById(x); return !!(f && f.status === 'compiled' && f.circuitJson); }, ids['multiplier.v']); if (done) break; }
    await sleep(3500);

    const readPaper = (hook) => page.evaluate((h) => {
      const p = h === '__djsDebug' ? window.__djsDebug.getPaper() : window[h];
      if (!p) return null;
      const out = {};
      for (const el of p.model.getElements()) { const q = el.position(); out[String(el.id)] = { x: Math.round(q.x), y: Math.round(q.y), t: String(el.get('type')), lb: String(el.get('label') || el.get('net') || el.get('celltype') || '') }; }
      const bb = p.getContentBBox();
      return { n: Object.keys(out).length, bbox: [Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height)], scale: +p.scale().sx.toFixed(3), pos: out };
    }, hook);

    const A = await readPaper('__djsDebug');
    console.log('A 编译画布(顶层):', JSON.stringify({ n: A.n, bbox: A.bbox, scale: A.scale }));

    // C：编译模式展开 adder（elk），等布局稳定
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
      const cur = await page.evaluate(() => { const p = window.__innerPaper; if (!p) return ''; const bb = p.getContentBBox(); return [Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height)].join(','); });
      if (cur && cur === prev) break;
      prev = cur;
    }
    const C = await page.evaluate(() => {
      const p = window.__innerPaper; if (!p) return null;
      const out = {};
      for (const el of p.model.getElements()) { const q = el.position(); out[String(el.id)] = { x: Math.round(q.x), y: Math.round(q.y), t: String(el.get('type')), lb: String(el.get('label') || el.get('net') || el.get('celltype') || '') }; }
      const bb = p.getContentBBox();
      return { n: Object.keys(out).length, bbox: [Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height)], scale: +p.scale().sx.toFixed(3), pos: out };
    });
    console.log('C 编译模式展开 adder(elk):', JSON.stringify({ n: C.n, bbox: C.bbox, scale: C.scale }));
    await page.screenshot({ path: path.join(ROOT, '.tmpbuild', 'r43-C-compile-expand.png') });
    await page.keyboard.press('Escape'); await sleep(600);

    // 复制到沙盒
    await page.locator('button[title*="复制到沙盒"]').first().click(); await sleep(5000);

    // B：复制出的顶层沙盒画布
    await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const f = Object.values(files).find((x) => x.name === 'multiplier/multiplier_sandbox.djs');
      if (f) localStorage.setItem('verilog-viz-sandbox-active', f.id);
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    if (!(await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]')))) { await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1500); }
    await sleep(1800);
    const B = await readPaper('__sandboxPaper');
    console.log('B 复制后顶层沙盒画布:', JSON.stringify({ n: B.n, bbox: B.bbox, scale: B.scale }));
    await page.screenshot({ path: path.join(ROOT, '.tmpbuild', 'r43-B-copied-top.png') });

    // D：adder.djs 部件画布（dagre 落盘）
    await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const f = Object.values(files).find((x) => x.name === 'multiplier/adder.djs');
      if (f) localStorage.setItem('verilog-viz-sandbox-active', f.id);
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    if (!(await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]')))) { await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1500); }
    await sleep(1800);
    const D = await readPaper('__sandboxPaper');
    console.log('D 部件文件 adder.djs(dagre):', JSON.stringify({ n: D.n, bbox: D.bbox, scale: D.scale }));
    await page.screenshot({ path: path.join(ROOT, '.tmpbuild', 'r43-D-part-canvas.png') });

    console.log('=== 对照 ===');
    console.log('A vs B（顶层：编译画布 vs 复制后）:', JSON.stringify(normDev(A.pos, B.pos)));
    console.log('C vs D（adder：elk 展开 vs dagre 部件）:', JSON.stringify(normDev(C.pos, D.pos)));
    // 标签级对照（同名器件在两边是否同位）
    const byLabel = (o) => { const r = {}; for (const k of Object.keys(o)) r[o[k].lb || k] = o[k]; return r; };
    console.log('C vs D 按标签:', JSON.stringify(normDev(byLabel(C.pos), byLabel(D.pos))));
    const sample = Object.keys(D.pos).slice(0, 8).map((k) => `${D.pos[k].lb || k}: C=${C.pos[k] ? C.pos[k].x + ',' + C.pos[k].y : '-'} D=${D.pos[k].x},${D.pos[k].y}`);
    console.log('样例(C|D):', sample.join('  '));
  } catch (e) { console.log('FATAL', e); } finally {
    try { await browser && browser.close(); } catch { }
    try { server && server.kill(); } catch { }
    process.exit(0);
  }
})();
