// R42 验收闸门 —— 把用户报告的 5 条 + 深检发现的 3 条钉成可重跑的判据
//  判据全部来自「同一份真实设计在两条管线下的对照」，不靠玩具电路：
//   设计 A（3 文件）：multiplier -> adder -> full_adder（4 位总线 + 切片 + 合线器）
//   设计 B（4 文件）：alu_core -> {adder -> full_adder, multiplier -> adder} —— 3 层钻取
//   设计 C（2 文件）：fsm_controller -> counter（行为级 + 跨文件绑定）
//
//  [1] 复制到沙盒：每个 part 文件 noPos==0 且 stacked==0（不再「全部堆叠」）
//  [2] part 文件端口形态：多位引脚还原成 Input/Output（无 NumEntry/NumDisplay 残留）
//  [2b] 端口盒体按数据层尺寸画（渲染宽高比＝数据宽高比）——⚠ 不是"宽高比 <1.5"：
//       多位引脚本来就是宽盒子（实测 4 位脚 47×30、总线输出脚 62×30），那种阈值会把正常渲染判成缺陷
//  [3] 同名多实例：每个实例都拿得到内图（不再只有第 1 个是实体）
//  [4] 展开图对账：沙盒展开 == 编译模式展开（同模块 links 相等 + 「完整还原」）
//  [5] 引脚顺序与编译模式一致（order 随行）
//  [6] 编译模式 3 层子部件展开图能渲染（R40 回归点）
//  [7] 展开图可放大：+ / 1:1 / 适应 三个按钮都改变 scale
//  [8] 绑定迁移：跨文件绑定的每个模块都在沙盒落成 part 文件且可解析
//  [9] 行为级 + BOM 文件能编译；缺模块走 MissingModules（绑定弹窗）而不是裸异常
//  [10] 全程无 pageerror、无 <rect> height NaN
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1521;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1521)); } catch { } const URL = `http://localhost:${PORT}/`;
const OUT = path.join(ROOT, '.tmpbuild');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };

const dismiss = async (page) => { try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { } };
const addFiles = async (page, names) => {
  const ids = {};
  for (const f of names) {
    ids[f] = await page.evaluate(async (a) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const nf = fileStore.createFile(a.n); fileStore.saveContent(nf.id, a.c); return nf.id;
    }, { n: f, c: rd(f) });
  }
  return ids;
};
const bind = async (page, ids, rows) => {
  for (const [file, mod, src] of rows) {
    await page.evaluate(async (a) => { const { fileStore } = await import('/src/store/fileStore.ts'); fileStore.setModuleBinding(a.f, a.m, a.s); }, { f: ids[file], m: mod, s: ids[src] });
  }
};
const waitCompiled = async (page, id) => {
  for (let i = 0; i < 90; i++) {
    await sleep(700);
    const st = await page.evaluate(async (x) => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getById(x); return { done: !!(f && f.status === 'compiled' && f.circuitJson), status: f && f.status, err: f && f.errorMessage, missing: f && f.missingModules }; }, id);
    if (st.done) return st;
    if (st.status === 'error') return st;
  }
  return { done: false, status: 'timeout' };
};
const paperOf = (page, hook) => hook === '__djsDebug'
  ? page.evaluate(() => { const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper(); return p ? p.model.getCells().filter((c) => c.get('type') === 'Subcircuit').map((c) => String(c.get('celltype'))) : []; })
  : page.evaluate((h) => { const p = window[h]; return p ? p.model.getCells().filter((c) => c.get('type') === 'Subcircuit').map((c) => String(c.get('celltype'))) : []; }, hook);

// 等弹窗的适配收敛（elk 异步写坐标；稳定前锚点位置不可信）
const waitSettled = async (page, maxMs = 3000) => {
  let prev = ''; let r = null; const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    r = await page.evaluate(() => {
      const p = window.__innerPaper; if (!p) return null;
      const bb = p.getContentBBox();
      return { scale: +p.scale().sx.toFixed(3), box: [Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height)].join(',') };
    });
    if (r && r.box === prev) return r;
    prev = r ? r.box : '';
    await sleep(200);
  }
  return r;
};

const zoomAt = (page, hook, idx) => page.evaluate(async (a) => {  const p = a.hook === '__djsDebug' ? (window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper()) : window[a.hook];
  if (!p) return null;
  const subs = p.model.getCells().filter((c) => c.get('type') === 'Subcircuit');
  const s = subs[a.idx]; if (!s) return null;
  const v = s.findView(p); const za = v && v.el && v.el.querySelector('a.zoom'); if (!za) return null;
  const r = za.getBoundingClientRect(); if (!r.width) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: String(s.get('celltype') || '') };
}, { hook, idx });

const readInner = (page) => page.evaluate(() => {
  const host = document.querySelector('[data-inner-host]'); const p = window.__innerPaper;
  const txt = document.body.textContent || '';
  const ports = p ? p.model.getCells().filter((c) => c.get('type') === 'Subcircuit').map((c) => (c.get('ports').items || []).map((x) => x.id).join(',')) : [];
  // 面包屑：弹窗标题行里的层级按钮（顶层 + 每钻一层多一枚）
  const crumbs = Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim())
    .filter((t) => /^(multiplier|adder|full_adder|counter|sel4|子部件|内嵌子电路)$/.test(t));
  return {
    modal: !!host, devs: p ? p.model.getElements().length : 0, links: p ? p.model.getLinks().length : 0,
    conns: host ? host.querySelectorAll('.connection').length : 0,
    scale: p ? p.scale().sx : 0,
    skipped: /(\d+) 条连线无法还原/.exec(txt)?.[1] || '0',
    full: txt.includes('完整还原'),
    fail: (txt.match(/内部电路渲染失败[^\n]{0,120}/) || [])[0] || '',
    subPorts: ports, crumbs,
  };
});

(async () => {
  let server, browser;
  try {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const dl = Date.now() + 30000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    const perr = []; const cerr = [];
    page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') cerr.push((m.text() || '').slice(0, 160)); });

    // ================= 设计 A：multiplier 3 层 =================
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200); await dismiss(page);
    const idA = await addFiles(page, ['multiplier.v', 'adder.v', 'full_adder.v']);
    await bind(page, idA, [['multiplier.v', 'adder', 'adder.v'], ['adder.v', 'full_adder', 'full_adder.v']]);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300); await dismiss(page);
    await page.locator('[title="multiplier.v"]').first().click({ force: true }); await sleep(800);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    const cA = await waitCompiled(page, idA['multiplier.v']);
    cA.done ? ok('[A] 编译通过', `status=${cA.status}`) : bad('[A] 编译失败', JSON.stringify(cA));
    await sleep(2500);

    // [4][5] 编译模式展开 adder（基准读数）
    const subsA = await paperOf(page, '__djsDebug');
    let base = null;
    const zp0 = await zoomAt(page, '__djsDebug', 0);
    if (zp0) {
      await page.mouse.click(zp0.x, zp0.y);
      for (let a = 0; a < 16; a++) { await sleep(450); base = await readInner(page); if (base && (base.devs > 0 || base.fail)) break; }
      await waitSettled(page); base = await readInner(page);
    }
    console.log('  编译模式基准:', JSON.stringify(base));
    await page.keyboard.press('Escape'); await sleep(600);
    (base && base.devs > 0 && base.conns === base.links && base.skipped === '0')
      ? ok('[4a] 编译模式展开图完整（连线全渲染、无跳过）', `devs=${base.devs} links=${base.links} conns=${base.conns}`)
      : bad('[4a] 编译模式展开图不完整', JSON.stringify(base));

    // 复制到沙盒
    await page.locator('button[title*="复制到沙盒"]').first().click(); await sleep(5000);
    const parts = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      return Object.values(files).map((f) => {
        let cells = []; try { cells = JSON.parse(f.graphJson || '{}').cells || []; } catch { }
        const isWire = (c) => c.isLink || (c.source && c.target && c.source.id && c.target.id);
        const nodes = cells.filter((c) => !isWire(c)); const links = cells.filter(isWire);
        const seen = new Map(); let stacked = 0;
        for (const n of nodes) { const k = `${Math.round(n.position ? n.position.x : -1)},${Math.round(n.position ? n.position.y : -1)}`; seen.set(k, (seen.get(k) || 0) + 1); if (seen.get(k) > 1) stacked++; }
        const io = nodes.filter((n) => n.type === 'Input' || n.type === n.type && ['Input', 'Output'].includes(n.type));
        const widget = nodes.filter((n) => ['NumEntry', 'NumDisplay', 'Button', 'Lamp', 'Clock', 'Display7'].includes(n.type)).map((n) => `${n.type}:${n.net || n.label || ''}`);
        const bg = nodes.filter((n) => n.type === 'BusGroup' || n.type === 'BusUngroup');
        const bgNoGroups = bg.filter((n) => !Array.isArray(n.groups)).length;
        const subs = nodes.filter((n) => n.type === 'Subcircuit');
        const orderMissing = nodes.filter((n) => ['Input', 'Output'].includes(n.type) && n.order == null).length;
        return { name: f.name, role: f.role || '', nodes: nodes.length, links: links.length, noPos: nodes.filter((n) => !n.position).length, stacked, io: io.length, widget, bgNoGroups, subs: subs.length, orderMissing };
      });
    });
    console.log('  沙盒文件:', JSON.stringify(parts, null, 1));
    const partFiles = parts.filter((p) => p.role === 'part');
    (partFiles.length >= 2 && partFiles.every((p) => p.noPos === 0 && p.stacked === 0))
      ? ok('[1] 每个 part 文件都有真实坐标、无叠放', partFiles.map((p) => `${p.name}:${p.nodes}节点/${p.links}线`).join(' '))
      : bad('[1] part 文件仍堆叠/缺坐标', JSON.stringify(partFiles.map((p) => ({ n: p.name, noPos: p.noPos, stacked: p.stacked }))));
    (partFiles.every((p) => p.widget.length === 0))
      ? ok('[2] 部件引脚都是可编辑的 Input/Output（无展示控件残留）', partFiles.map((p) => `${p.name}:${p.io}脚`).join(' '))
      : bad('[2] 部件里残留展示控件当引脚', JSON.stringify(partFiles.map((p) => ({ n: p.name, widget: p.widget }))));
    (partFiles.every((p) => p.bgNoGroups === 0))
      ? ok('[3a] 合线器 groups 随行（端口位宽不丢）') : bad('[3a] 合线器 groups 丢失', JSON.stringify(partFiles.map((p) => ({ n: p.name, bgNoGroups: p.bgNoGroups }))));
    (partFiles.every((p) => p.orderMissing === 0))
      ? ok('[5a] 部件文件保留 order（引脚顺序）') : bad('[5a] order 丢失（引脚会按字母序重排）', JSON.stringify(partFiles.map((p) => ({ n: p.name, orderMissing: p.orderMissing }))));

    // 打开 adder.djs：[3] 同名多实例 + [4b] 沙盒展开对账 + [7] 放大
    await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const f = Object.values(files).find((x) => x.name === 'multiplier/adder.djs');
      if (f) localStorage.setItem('verilog-viz-sandbox-active', f.id);
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    if (!(await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]')))) { await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1500); }
    await sleep(1500);
    const innerOk = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      const subs = p.model.getCells().filter((c) => c.get('type') === 'Subcircuit');
      return subs.map((s) => ({ ct: String(s.get('celltype') || ''), ports: (s.get('ports').items || []).map((x) => x.id).join(','), inner: (s.get('graph') ? s.get('graph').getElements().length : 0) }));
    });
    console.log('  adder.djs 上的 4 个 full_adder 实例:', JSON.stringify(innerOk));
    (innerOk && innerOk.length >= 4 && innerOk.every((s) => s.inner > 0 && s.ports.split(',').length >= 5))
      ? ok('[3b] 同名多实例每个都拿到内图与端口（不再只有第 1 个是实体）', innerOk.map((s) => `${s.inner}/${s.ports}`).join(' '))
      : bad('[3b] 存在空壳实例', JSON.stringify(innerOk));
    if (base && innerOk) {
      const sameOrder = innerOk.every((s) => s.ports === innerOk[0].ports);
      const basePorts = (base.subPorts || [])[0] || '';
      (sameOrder && basePorts && innerOk[0].ports === basePorts)
        ? ok('[5b] 沙盒实例端口顺序 == 编译模式', `sandbox=${innerOk[0].ports} | compile=${basePorts}`)
        : bad('[5b] 端口顺序与编译模式不一致', `sandbox=${innerOk[0].ports} | compile=${basePorts} sameOrder=${sameOrder}`);
    }
    // ---- [2b] 部件画布上的端口盒体"按数据层说的尺寸画"（这才是 r19 [8c] 想判的那件事） ----
    // 现场读数（2026-10-06，adder.djs 画布）：1 位脚 30×30（比 1.00），4 位脚 47×30（比 1.58），
    // 输出总线脚 62×30（比 2.08）⇒ **多位引脚本来就该是宽盒子**（数据层 size 自己就这么写）。
    // 所以我从 r19 沿用来的"宽高比 <1.5"是错的判据：它会把正常渲染的总线脚判成缺陷，
    // 而真正要防的病（盒体被 CSS/布局横向拉长）它也不一定抓得到。
    // 换成**与缩放无关**的关系判据：渲染出来的宽高比必须等于数据层声明的宽高比（±0.05 容差）。
    const portBoxes = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      const out = [];
      for (const c of p.model.getElements()) {
        const t = String(c.get('type'));
        if (t !== 'Input' && t !== 'Output') continue;
        try {
          const v = p.findViewByModel(c);
          const found = v && v.findBySelector ? v.findBySelector('body') : null;
          const el = (found && found.length ? found[0] : (v && v.el ? v.el.querySelector('.body') || v.el : null));
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const sz = c.get('size');
          if (!(r.width > 0) || !(r.height > 0) || !sz || !(sz.width > 0) || !(sz.height > 0)) continue;
          out.push({ t, rendered: `${Math.round(r.width)}x${Math.round(r.height)}`, data: `${Math.round(sz.width)}x${Math.round(sz.height)}`,
            rr: +(r.width / r.height).toFixed(2), dr: +(sz.width / sz.height).toFixed(2) });
        } catch { /* 单颗读不到不判，数量下界在臂里 */ }
      }
      return out;
    });
    console.log('  端口盒体（部件画布 adder.djs）:', JSON.stringify(portBoxes));
    const drift = (portBoxes || []).filter((b) => Math.abs(b.rr - b.dr) > 0.05);
    (portBoxes && portBoxes.length >= 3 && drift.length === 0)
      ? ok('[2b] 端口盒体按数据层尺寸画（渲染宽高比＝数据宽高比，与缩放无关；多位脚本来就该宽）',
        `${portBoxes.length} 颗，比=${portBoxes.map((b) => `${b.rr}/${b.dr}`).join(' ')}`)
      : bad('[2b] 端口盒体被横向拉长了（渲染与数据层尺寸不一致）或量太少', JSON.stringify({ 颗数: (portBoxes || []).length, 偏差: drift }));

    const z1 = await zoomAt(page, '__sandboxPaper', 0);
    let sb = null;
    if (z1) {
      await page.mouse.click(z1.x, z1.y);
      for (let a = 0; a < 16; a++) { await sleep(450); sb = await readInner(page); if (sb && (sb.devs > 0 || sb.fail)) break; }
      await waitSettled(page); sb = await readInner(page);
    }
    console.log('  沙盒展开 full_adder（adder.djs 上的实例）:', JSON.stringify(sb));
    (sb && sb.devs > 0 && sb.conns === sb.links && sb.skipped === '0')
      ? ok('[4b] 沙盒展开图完整（连线全渲染、零跳过）', `devs=${sb.devs} links=${sb.links} conns=${sb.conns}`)
      : bad('[4b] 沙盒展开图不完整', JSON.stringify(sb));
    await page.keyboard.press('Escape'); await sleep(500);

    // 同模块对照：打开复制出来的顶层画布，展开它的 adder 实例，与编译模式基准比数
    await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const f = Object.values(files).find((x) => x.name === 'multiplier/multiplier_sandbox.djs');
      if (f) localStorage.setItem('verilog-viz-sandbox-active', f.id);
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    if (!(await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]')))) { await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1500); }
    await sleep(1500);
    const z2 = await zoomAt(page, '__sandboxPaper', 0);
    let sbTop = null;
    if (z2) {
      await page.mouse.click(z2.x, z2.y);
      for (let a = 0; a < 16; a++) { await sleep(450); sbTop = await readInner(page); if (sbTop && (sbTop.devs > 0 || sbTop.fail)) break; }
      await waitSettled(page); sbTop = await readInner(page);
    }
    console.log('  沙盒展开 adder（顶层画布上的实例）:', JSON.stringify(sbTop));
    (sbTop && base && sbTop.links === base.links && sbTop.devs === base.devs && sbTop.conns === sbTop.links && sbTop.skipped === '0')
      ? ok('[4c] 同一模块：沙盒展开 == 编译模式展开（器件数/连线数/渲染数全等）', `sandbox=${sbTop.devs}/${sbTop.links}/${sbTop.conns} compile=${base.devs}/${base.links}/${base.conns}`)
      : bad('[4c] 同一模块两条管线数不上', JSON.stringify({ sbTop, base }));
    await page.screenshot({ path: path.join(OUT, 'r42-sandbox-expand.png') });

    // [7] 放大查看（弹窗内的缩放按钮，用 data-xz 锚点，避免与画布工具栏同名按钮相撞）
    const before = sbTop ? sbTop.scale : 0;
    await page.locator('button[data-xz="+"]').click(); await sleep(250);
    await page.locator('button[data-xz="+"]').click(); await sleep(250);
    const after = await page.evaluate(() => (window.__innerPaper ? window.__innerPaper.scale().sx : 0));
    await page.locator('button[data-xz="1:1"]').click(); await sleep(300);
    const actual = await page.evaluate(() => (window.__innerPaper ? window.__innerPaper.scale().sx : 0));
    await page.locator('button[data-xz="适应"]').click(); await sleep(300);
    const fit = await page.evaluate(() => (window.__innerPaper ? window.__innerPaper.scale().sx : 0));
    (after > before && Math.abs(actual - 1) < 0.01 && fit > 0)
      ? ok('[7] 展开图可放大：+ 放大 / 1:1 回实际大小 / 适应', `${before.toFixed(3)} → ${after.toFixed(3)} → 1:1=${actual.toFixed(2)} → 适应=${fit.toFixed(3)}`)
      : bad('[7] 展开图缩放按钮无效', JSON.stringify({ before, after, actual, fit }));
    await page.keyboard.press('Escape'); await sleep(500);

    // ================= 设计 B：alu_core（编译模式 3 层展开）=================
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200); await dismiss(page);
    const idB = await addFiles(page, ['alu_core.v', 'adder.v', 'full_adder.v', 'multiplier.v']);
    await bind(page, idB, [['alu_core.v', 'adder', 'adder.v'], ['alu_core.v', 'multiplier', 'multiplier.v'], ['adder.v', 'full_adder', 'full_adder.v'], ['multiplier.v', 'adder', 'adder.v']]);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300); await dismiss(page);
    await page.locator('[title="alu_core.v"]').first().click({ force: true }); await sleep(800);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    const cB = await waitCompiled(page, idB['alu_core.v']);
    cB.done ? ok('[B] alu_core 编译通过') : bad('[B] alu_core 编译失败', JSON.stringify(cB));
    await sleep(2500);
    const subsB = await paperOf(page, '__djsDebug');
    let deep = null;
    const idxMul = Math.max(0, subsB.indexOf('multiplier'));
    const zpB = await zoomAt(page, '__djsDebug', idxMul);
    if (zpB) {
      await page.mouse.click(zpB.x, zpB.y);
      for (let a = 0; a < 18; a++) { await sleep(450); deep = await readInner(page); if (deep && (deep.devs > 0 || deep.fail)) break; }
      // elk 是异步写坐标的：适配要等包围盒稳定，否则放大镜锚点会被瞬时的 3× 推出视口
      const settled = await waitSettled(page);
      console.log('  稳定后的弹窗:', JSON.stringify(settled));
      // 再钻一层（adder → full_adder）
      const zpC = await page.evaluate(() => {
        const p = window.__innerPaper; if (!p) return null;
        const s = p.model.getCells().filter((c) => c.get('type') === 'Subcircuit')[0]; if (!s) return null;
        const v = s.findView(p); const za = v && v.el && v.el.querySelector('a.zoom'); if (!za) return null;
        const r = za.getBoundingClientRect();
        const host = document.querySelector('[data-inner-host]'); const hr = host.getBoundingClientRect();
        const inside = r.left >= hr.left - 2 && r.right <= hr.right + 2 && r.top >= hr.top - 2 && r.bottom <= hr.bottom + 2;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, inside, w: Math.round(r.width) };
      });
      console.log('  弹窗内放大镜锚点:', JSON.stringify(zpC));
      if (zpC && zpC.inside) {
        await page.mouse.click(zpC.x, zpC.y);
        for (let a = 0; a < 18; a++) { await sleep(450); deep.drill = await readInner(page); if (deep.drill && deep.drill.devs > 0 && deep.drill.crumbs.length > deep.crumbs.length) break; }
      } else {
        deep.drill = { err: 'anchor not clickable', zpC };
      }
    }
    console.log('  3 层展开:', JSON.stringify(deep));
    (deep && deep.devs > 0 && deep.conns === deep.links && !deep.fail)
      ? ok('[6] 编译模式 3 层子部件展开图可渲染', `devs=${deep.devs} links=${deep.links} conns=${deep.conns}`)
      : bad('[6] 编译模式 3 层展开图仍失败', JSON.stringify(deep));
    (deep && deep.drill && deep.drill.devs > 0 && deep.drill.conns === deep.drill.links
      && deep.drill.devs !== deep.devs && (deep.drill.crumbs || []).length > (deep.crumbs || []).length)
      ? ok('[6b] 展开图里继续钻取下一层（换层：面包屑变长、器件数变化）', `${deep.devs} → ${deep.drill.devs} devs，crumbs=${JSON.stringify(deep.drill.crumbs)}`)
      : bad('[6b] 二层钻取没有真的换层', JSON.stringify({ parent: { devs: deep && deep.devs, crumbs: deep && deep.crumbs }, drill: deep && deep.drill }));
    await page.screenshot({ path: path.join(OUT, 'r42-deep-expand.png') });
    await page.keyboard.press('Escape'); await sleep(500);

    // [8] 绑定迁移：设计 C（行为级 counter，跨文件绑定）
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200); await dismiss(page);
    const idC = await addFiles(page, ['fsm_controller.v', 'test_counter_behavioral.v']);
    await bind(page, idC, [['fsm_controller.v', 'counter', 'test_counter_behavioral.v']]);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300); await dismiss(page);
    await page.locator('[title="fsm_controller.v"]').first().click({ force: true }); await sleep(800);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    const cC = await waitCompiled(page, idC['fsm_controller.v']);
    (cC.done) ? ok('[9a] 行为级 + BOM 文件 + 跨文件绑定：编译通过') : bad('[9a] 编译失败', JSON.stringify(cC));
    await sleep(2000);
    await page.locator('button[title*="复制到沙盒"]').first().click(); await sleep(4500);
    const bound = await page.evaluate(async () => {
      const gs = await import('/src/lib/gateSystem.ts');
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const parts = Object.values(files).filter((f) => f.role === 'part').map((f) => f.name);
      const resolved = {};
      for (const f of Object.values(files)) {
        if (f.role !== 'part') continue;
        const nm = f.name.split('/').pop().replace(/\.djs$/, '');
        const dir = f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/')) : '';
        const c = gs.resolveDefCells(nm, dir);
        resolved[nm] = c ? c.cells.filter((x) => !x.isLink).length : 0;
      }
      return { parts, resolved };
    });
    console.log('  绑定迁移:', JSON.stringify(bound));
    (bound.parts.some((p) => /counter\.djs$/.test(p)) && Object.values(bound.resolved).every((n) => n > 0))
      ? ok('[8] 跨文件绑定的模块全部落成可解析的部件文件', JSON.stringify(bound.resolved))
      : bad('[8] 绑定迁移不全', JSON.stringify(bound));

    // [9b] 缺模块 → MissingModules（不是裸 Invalid cell type）
    const miss = await page.evaluate(async (a) => {
      const { compileVerilog } = await import('/src/lib/verilog.ts');
      try { await compileVerilog([{ name: 'fsm_controller.v', content: a.fsm }], 'fsm_controller'); return { threw: false }; }
      catch (e) { return { threw: true, cls: e.constructor.name, missing: e.missingModules || null, msg: String(e.message).slice(0, 80) }; }
    }, { fsm: rd('fsm_controller.v') });
    (miss.cls === 'MissingModulesError' && (miss.missing || []).includes('counter'))
      ? ok('[9b] 缺模块走绑定流程（MissingModulesError）', JSON.stringify(miss))
      : bad('[9b] 缺模块仍是裸异常', JSON.stringify(miss));

    // [10] 异常与 SVG 报错
    const nan = cerr.filter((t) => /NaN/.test(t));
    (perr.length === 0 && nan.length === 0)
      ? ok('[10] 无页面异常、无 <rect> NaN', `consoleErrors=${cerr.length}`)
      : bad('[10] 存在异常', JSON.stringify({ perr: perr.slice(0, 3), nan: nan.slice(0, 3) }));
  } catch (e) { console.log('FATAL', e); fail++; } finally {
    try { await browser && browser.close(); } catch { }
    try { server && server.kill(); } catch { }
    console.log(`\n== R42: ${pass} PASS / ${fail} FAIL ==`);
    process.exit(fail > 0 ? 1 : 0);
  }
})();
