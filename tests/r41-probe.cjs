// R41 现场复现探针（只取读数，不作判定）
//  真实场景：7 个 .v 文件 + 跨文件模块绑定 + 5 层层级 + 总线/DFF
//   alu_top -> alu_core -> {adder -> full_adder, multiplier -> adder}
//                     -> fsm_controller -> counter
//  A 编译产物模块表形状（position/vertices）
//  B 编译模式逐个放大镜 -> 展开图 devs/links/rendered conns/failMsg
//  C 复制到沙盒后每个文件：节点/坐标多样性/连线/悬空连线/堆叠
//  D 每个沙盒文件画布：model links vs rendered .connection + 截图
//  E 每个沙盒画布逐个放大镜 -> 展开图读数 + 截图
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1497;
const URL = `http://localhost:${PORT}/`;
const OUT = path.join(PROJECT_ROOT, '.tmpbuild');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILES = ['multiplier.v', 'adder.v', 'full_adder.v'];
const BIND = [['multiplier.v', 'adder', 'adder.v'], ['adder.v', 'full_adder', 'full_adder.v']];
const TOP_FILE = 'multiplier.v';

const zoomPoint = (page, hook, idx) => page.evaluate(async (a) => {
  const p = a.hook === '__djsDebug'
    ? (window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper())
    : window[a.hook];
  if (!p) return { err: 'no-paper' };
  const subs = p.model.getCells().filter((c) => c.get('type') === 'Subcircuit');
  const s = subs[a.idx];
  if (!s) return { err: 'no-sub', total: subs.length };
  const v = s.findView(p);
  const za = v && v.el && v.el.querySelector('a.zoom');
  if (!za) return { err: 'no-zoom-el', name: String(s.get('celltype') || ''), total: subs.length };
  const r = za.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { err: 'zero-rect(offscreen)', name: String(s.get('celltype') || ''), total: subs.length, w: r.width, h: r.height };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: String(s.get('celltype') || ''), total: subs.length };
}, { hook, idx });

const innerRead = (page) => page.evaluate(() => {
  const host = document.querySelector('[data-inner-host]');
  const paper = window.__innerPaper;
  const txt = document.body.textContent || '';
  return {
    modal: !!host,
    devs: paper ? paper.model.getElements().length : 0,
    links: paper ? paper.model.getLinks().length : 0,
    conns: host ? host.querySelectorAll('.connection').length : 0,
    subs: paper ? paper.model.getCells().filter((c) => c.get('type') === 'Subcircuit').length : 0,
    scale: paper && paper.scale ? paper.scale().sx : null,
    failMsg: (txt.match(/内部电路渲染失败[^\n]{0,140}/) || [])[0] || (txt.match(/没有可渲染的内部电路[^\n]{0,100}/) || [])[0] || (txt.match(/不存在或已删除[^\n]{0,80}/) || [])[0] || '',
    stages: (window.__expandStages || []).join(' '),
  };
});

const canvasRead = (page, hook) => page.evaluate((h) => {
  const paper = window[h]; if (!paper) return null;
  const nodes = paper.model.getElements();
  const links = paper.model.getLinks();
  const seen = new Map(); let stacked = 0;
  for (const n of nodes) { const p = n.position(); const k = `${Math.round(p.x)},${Math.round(p.y)}`; seen.set(k, (seen.get(k) || 0) + 1); if (seen.get(k) > 1) stacked++; }
  return { els: nodes.length, links: links.length, conns: paper.el ? paper.el.querySelectorAll('.connection').length : 0, stacked, scale: paper.scale().sx };
}, hook);

(async () => {
  let server, browser;
  const log = (...a) => console.log(...a);
  try {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    const pageErrors = []; const consoleErrs = [];
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push((m.text() || '').slice(0, 240)); });

    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    const ids = {};
    for (const f of FILES) {
      const content = fs.readFileSync(path.join(PROJECT_ROOT, 'test_files', f), 'utf8');
      ids[f] = await page.evaluate(async (a) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const nf = fileStore.createFile(a.name); fileStore.saveContent(nf.id, a.code); return nf.id;
      }, { name: f, code: content });
    }
    for (const [file, mod, src] of BIND) {
      await page.evaluate(async (a) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        fileStore.setModuleBinding(a.fid, a.m, a.sid);
      }, { fid: ids[file], m: mod, sid: ids[src] });
    }
    const nFiles = await page.evaluate(async () => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      return fileStore.getAll().map((f) => ({ n: f.name, mods: f.definedModules }));
    });
    log('FILES:', JSON.stringify(nFiles));

    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.locator('[title="multiplier.v"]').first().click(); await sleep(900);
    await page.locator('button[title^="编译"]').first().click();
    let compiled = false;
    for (let i = 0; i < 90; i++) {
      await sleep(700);
      compiled = await page.evaluate(async (id) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const f = fileStore.getById(id); return !!(f && f.status === 'compiled' && f.circuitJson);
      }, ids[TOP_FILE]);
      if (compiled) break;
    }
    log('COMPILED =', compiled);
    if (!compiled) {
      const st = await page.evaluate(async (id) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const f = fileStore.getById(id); return { status: f && f.status, err: f && f.errorMessage, missing: f && f.missingModules };
      }, ids[TOP_FILE]);
      log('COMPILE STATE:', JSON.stringify(st));
      await page.screenshot({ path: path.join(OUT, 'r41-compile-fail.png') });
      return;
    }
    await sleep(3000);
    await page.screenshot({ path: path.join(OUT, 'r41-a-compile-canvas.png') });

    // ---- A ----
    const shape = await page.evaluate(async (id) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const cj = JSON.parse(JSON.stringify(fileStore.getById(id).circuitJson));
      const fmt = (name, m, depth) => {
        const devs = Object.values(m.devices || {});
        return {
          name: '  '.repeat(depth) + name, devices: devs.length,
          withPos: devs.filter((d) => d.position && (d.position.x || d.position.y)).length,
          subDevs: devs.filter((d) => d.type === 'Subcircuit').length,
          subKeys: Object.keys(m.subcircuits || {}).length,
          connectors: (m.connectors || []).length,
          withVerts: (m.connectors || []).filter((c) => (c.vertices || []).length).length,
        };
      };
      const out = [fmt('TOP(multiplier)', cj, 0)];
      const walk = (m, depth) => {
        for (const [k, s] of Object.entries(m.subcircuits || {})) {
          if (!s || !s.devices || depth > 3) continue;
          out.push(fmt(k, s, depth)); walk(s, depth + 1);
        }
      };
      walk(cj, 1);
      return { topKeys: Object.keys(cj.subcircuits || {}), modules: out };
    }, ids[TOP_FILE]);
    log('=== A 编译产物模块表 ===');
    log('  top.subcircuits keys:', JSON.stringify(shape.topKeys));
    for (const m of shape.modules) log(`   ${m.name}: devices=${m.devices} withPos=${m.withPos} subDevs=${m.subDevs} subKeys=${m.subKeys} conns=${m.connectors} withVerts=${m.withVerts}`);

    // ---- B 编译模式展开 ----
    log('=== B 编译模式展开图 ===');
    const nSubC = await page.evaluate(() => {
      const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper();
      return p ? p.model.getCells().filter((c) => c.get('type') === 'Subcircuit').map((c) => String(c.get('celltype') || '')) : [];
    });
    log('  顶层子部件实例:', JSON.stringify(nSubC));
    for (let i = 0; i < Math.min(nSubC.length, 4); i++) {
      const zp = await zoomPoint(page, '__djsDebug', i);
      if (zp.err) { log(`  [compile#${i} ${nSubC[i]}] ERR ${JSON.stringify(zp)}`); continue; }
      await page.mouse.click(zp.x, zp.y);
      let rd = null;
      for (let a = 0; a < 16; a++) { await sleep(450); rd = await innerRead(page); if (rd && rd.modal && (rd.devs > 0 || rd.failMsg)) break; }
      log(`  [compile#${i} ${zp.name}] ->`, JSON.stringify(rd));
      await page.screenshot({ path: path.join(OUT, `r41-b-compile-${i}-${String(zp.name).replace(/[^\w]+/g, '_')}.png`) });
      await page.keyboard.press('Escape'); await sleep(700);
    }

    // ---- C 复制到沙盒 ----
    await page.locator('button[title*="复制到沙盒"]').first().click(); await sleep(5000);
    const parts = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      return Object.values(files).map((f) => {
        let cells = []; try { cells = JSON.parse(f.graphJson || '{}').cells || []; } catch { }
        const isWire = (c) => c.isLink || (c.source && c.target && c.source.id && c.target.id);
        const nodes = cells.filter((c) => !isWire(c));
        const links = cells.filter(isWire);
        const idSet = new Set(nodes.map((c) => String(c.id)));
        const xs = new Set(nodes.map((c) => Math.round(c.position ? c.position.x : -999)));
        const ys = new Set(nodes.map((c) => Math.round(c.position ? c.position.y : -999)));
        const seen = new Map(); let stacked = 0;
        for (const n of nodes) { const k = `${Math.round(n.position ? n.position.x : 0)},${Math.round(n.position ? n.position.y : 0)}`; seen.set(k, (seen.get(k) || 0) + 1); if (seen.get(k) > 1) stacked++; }
        const dangling = links.filter((l) => !idSet.has(String(l.source && l.source.id)) || !idSet.has(String(l.target && l.target.id)));
        return {
          name: f.name, role: f.role || f.kind || '', nodes: nodes.length, links: links.length,
          distinctX: xs.size, distinctY: ys.size, stacked,
          dangling: dangling.length, dSample: dangling.slice(0, 2).map((l) => `${(l.source || {}).id}:${(l.source || {}).port}=>${(l.target || {}).id}:${(l.target || {}).port}`),
          subs: nodes.filter((c) => c.type === 'Subcircuit').map((c) => String(c.celltype || '')),
          withVerts: links.filter((l) => (l.vertices || []).length).length,
          noPos: nodes.filter((c) => !c.position).length,
        };
      });
    });
    log('=== C 沙盒文件（复制到沙盒后）===');
    for (const p of parts) log('   ', JSON.stringify(p));
    await page.screenshot({ path: path.join(OUT, 'r41-c-after-copy.png') });

    // ---- D + E ----
    for (const p of parts.filter((x) => x.name.endsWith('.djs'))) {
      const set = await page.evaluate((nm) => {
        const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
        const f = Object.values(files).find((x) => x.name === nm);
        if (!f) return false; localStorage.setItem('verilog-viz-sandbox-active', f.id); return true;
      }, p.name);
      if (!set) continue;
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
      if (!(await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]')))) {
        await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1500);
      }
      await sleep(1500);
      log(`=== D 画布 ${p.name} ===`, JSON.stringify(await canvasRead(page, '__sandboxPaper')));
      await page.screenshot({ path: path.join(OUT, `r41-d-${p.name.replace(/[^\w]+/g, '_')}.png`) });
      const nSub = await page.evaluate(() => {
        const paper = window.__sandboxPaper;
        return paper ? paper.model.getCells().filter((c) => c.get('type') === 'Subcircuit').map((c) => String(c.get('celltype') || '')) : [];
      });
      for (let i = 0; i < Math.min(nSub.length, 3); i++) {
        const zp = await zoomPoint(page, '__sandboxPaper', i);
        if (zp.err) { log(`  [sb ${p.name}#${i} ${nSub[i]}] ERR ${JSON.stringify(zp)}`); continue; }
        await page.mouse.click(zp.x, zp.y);
        let rd = null;
        for (let a = 0; a < 16; a++) { await sleep(450); rd = await innerRead(page); if (rd && rd.modal && (rd.devs > 0 || rd.failMsg)) break; }
        log(`  [sb ${p.name}#${i} ${zp.name}] ->`, JSON.stringify(rd));
        if (i === 0) await page.screenshot({ path: path.join(OUT, `r41-e-${p.name.replace(/[^\w]+/g, '_')}.png`) });
        await page.keyboard.press('Escape'); await sleep(600);
      }
    }

    log('=== PAGE ERRORS ===', JSON.stringify(pageErrors.slice(0, 8)));
    log('=== CONSOLE ERRORS (first 12) ===');
    for (const e of consoleErrs.slice(0, 12)) log('   ', e);
  } catch (e) {
    console.log('FATAL', e);
  } finally {
    try { await browser && browser.close(); } catch { }
    try { server && server.kill(); } catch { }
    process.exit(0);
  }
})();
