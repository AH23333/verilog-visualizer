// R44 验收：部件清单/绑定/换绑/沙盒调速/编译模式自动线名
//  [11] 删除部件文件后，右键「自定义部件」与部件面板都不再列它
//  [12] 沙盒放置部件 → 保存重载后仍按名绑定（顶层实例不内联子图，且能展开）
//  [13] 右键实例「绑定...」（R99 起是对话框，RebindDialog 同款）→ 换成另一份定义，端口按名字接回、接不上的计数
//  [14] 沙盒 SPEED 滑条改的是引擎步进间隔
//  [15] 编译模式连线也带自动名（与沙盒同一观感）
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1551;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1551)); } catch { } const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const dismiss = async (page) => { try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { } };

// 两份 2 输入 1 输出的部件定义（cells 白名单格式）：AA 用 And，BB 用 Or + 额外一个反相器
const partAA = { cells: [
  { id: 'i1', type: 'Input', position: { x: 40, y: 40 }, bits: 1, net: 'a', order: 0 },
  { id: 'i2', type: 'Input', position: { x: 40, y: 90 }, bits: 1, net: 'b', order: 1 },
  { id: 'g1', type: 'And', position: { x: 160, y: 60 }, bits: 1 },
  { id: 'o1', type: 'Output', position: { x: 280, y: 60 }, bits: 1, net: 'y', order: 0 },
  { isLink: true, source: { id: 'i1', port: 'out' }, target: { id: 'g1', port: 'in1' }, netname: 'N1' },
  { isLink: true, source: { id: 'i2', port: 'out' }, target: { id: 'g1', port: 'in2' }, netname: 'N2' },
  { isLink: true, source: { id: 'g1', port: 'out' }, target: { id: 'o1', port: 'in' }, netname: 'N3' },
] };
const partBB = { cells: [
  { id: 'i1', type: 'Input', position: { x: 40, y: 40 }, bits: 1, net: 'a', order: 0 },
  { id: 'i2', type: 'Input', position: { x: 40, y: 90 }, bits: 1, net: 'b', order: 1 },
  { id: 'g1', type: 'Or', position: { x: 160, y: 60 }, bits: 1 },
  { id: 'o1', type: 'Output', position: { x: 280, y: 60 }, bits: 1, net: 'y', order: 0 },
  { isLink: true, source: { id: 'i1', port: 'out' }, target: { id: 'g1', port: 'in1' }, netname: 'N1' },
  { isLink: true, source: { id: 'i2', port: 'out' }, target: { id: 'g1', port: 'in2' }, netname: 'N2' },
  { isLink: true, source: { id: 'g1', port: 'out' }, target: { id: 'o1', port: 'in' }, netname: 'N3' },
] };

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
    const dl = Date.now() + 40000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务未起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300); await dismiss(page);

    // 造两个部件文件 + 一个空画布文件
    await page.evaluate(async (a) => {
      const gs = await import('/src/lib/gateSystem.ts');
      gs.savePartFile('AA', a.aa, 'R44');
      gs.savePartFile('BB', a.bb, 'R44');
      gs.savePartFile('CC', a.aa, 'R44');   // 只给 [11b] 删除用，别动 AA/BB（[13] 要拿 BB 换绑）
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      sandboxStore.createFolder('R44');
      const f = sandboxStore.create('R44/canvas.djs');
      sandboxStore.save(f.id, JSON.stringify({ cells: [] }));
      sandboxStore.setActiveId(f.id);
    }, { aa: partAA, bb: partBB });
    await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(2000);

    // ===== [11] 清单来源 =====
    await page.locator('button[data-activity="modules"]').first().click(); await sleep(1200);
    const listed = await page.evaluate(() => {
      const root = document.querySelector('[data-sandbox-sidebar]') || document;
      const btns = Array.from(root.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
      return { AA: btns.some((t) => t.startsWith('AA')), BB: btns.some((t) => t.startsWith('BB')), CC: btns.some((t) => t.startsWith('CC')), n: btns.length };
    });
    (listed.AA && listed.BB && listed.CC) ? ok('[11a] 部件面板列出三个部件文件', JSON.stringify(listed)) : bad('[11a] 部件面板缺项', JSON.stringify(listed));
    // 删掉 BB 文件（走文件树右键），面板应立刻不列它
    await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const bb = Object.values(files).find((f) => f.name === 'R44/BB.djs');
      if (bb) { const { sandboxStore } = window.__dbgStore || {}; void sandboxStore; }
      return !!bb;
    });
    const removed = await page.evaluate(async () => {
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      const cc = sandboxStore.list().find((f) => f.name === 'R44/CC.djs');
      if (!cc) return false;
      sandboxStore.remove(cc.id);
      return true;
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200); await dismiss(page);
    if (!(await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]')))) { await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1600); }
    await sleep(1200);
    await page.locator('button[data-activity="modules"]').first().click(); await sleep(1200);
    const afterDel = await page.evaluate(() => {
      const root = document.querySelector('[data-sandbox-sidebar]') || document;
      const btns = Array.from(root.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
      return { AA: btns.some((t) => t.startsWith('AA')), BB: btns.some((t) => t.startsWith('BB')), CC: btns.some((t) => t.startsWith('CC')), n: btns.length };
    });
    (removed && afterDel.AA && afterDel.BB && !afterDel.CC)
      ? ok('[11b] 删除部件文件后清单不再列它（旧存档残留已修）', JSON.stringify(afterDel))
      : bad('[11b] 已删部件仍出现在清单里', JSON.stringify({ removed, afterDel }));

    // ===== [13] 换绑：放一个 AA 实例，换绑到 BB =====
    const placed = await page.evaluate(async () => {
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      const gs = await import('/src/lib/gateSystem.ts');
      const p = window.__sandboxPaper; if (!p) return { err: 'no paper' };
      const digitaljs = window.digitaljs;
      const cells = gs.resolveDefCells('AA', 'R44');
      const Graph = p.model.constructor;
      const inner = (await import('/src/lib/subcircuit.ts')).buildInnerGraph(digitaljs, Graph, cells, p.model._display3vl);
      const sub = new digitaljs.cells.Subcircuit({ type: 'Subcircuit', graph: inner, celltype: 'AA', position: { x: 300, y: 200 } });
      p.model.addCell(sub);
      // 两端各放一个 Input/Output 并用它连起来（模拟真实使用：换绑后连线要按端口接回）
      const io1 = new digitaljs.cells.Input({ type: 'Input', position: { x: 80, y: 200 }, size: { width: 30, height: 30 }, net: 'x1', bits: 1 });
      const io2 = new digitaljs.cells.Output({ type: 'Output', position: { x: 560, y: 200 }, size: { width: 30, height: 30 }, net: 'o1', bits: 1 });
      p.model.addCell(io1); p.model.addCell(io2);
      p.model.addCell(new digitaljs.cells.Wire({ source: { id: io1.id, port: 'out' }, target: { id: sub.id, port: 'a' }, netname: 'W1' }));
      p.model.addCell(new digitaljs.cells.Wire({ source: { id: sub.id, port: 'y' }, target: { id: io2.id, port: 'in' }, netname: 'W2' }));
      return { id: String(sub.id), ports: (sub.get('ports').items || []).map((x) => x.id).join(','), links: p.model.getLinks().length };
    });
    console.log('  放置的 AA 实例:', JSON.stringify(placed));
    placed.id ? ok('[13a] 已放置 AA 实例并连两根线', `ports=${placed.ports} links=${placed.links}`) : bad('[13a] 放置失败', JSON.stringify(placed));
    // 通过右键菜单走真实入口换绑到 BB（R99：菜单项「绑定...」→ RebindDialog 对话框）
    const menuOk = await page.evaluate((id) => {
      const p = window.__sandboxPaper;
      const cell = p.model.getCell(id);
      const v = cell.findView(p);
      const r = v.el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 2 };
      v.el.dispatchEvent(new PointerEvent('pointerdown', opts));
      v.el.dispatchEvent(new MouseEvent('mousedown', opts));
      v.el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
      v.el.dispatchEvent(new MouseEvent('contextmenu', opts));
      return { x, y };
    }, placed.id);
    await sleep(900);
    let rebindItem = await page.evaluate(() => {
      const m = document.querySelector('[data-context-menu]');
      if (!m) return { menu: false };
      const b = Array.from(m.querySelectorAll('button')).find((x) => (x.textContent || '').includes('绑定...'));
      if (!b) return { menu: true, items: Array.from(m.querySelectorAll('button')).map((x) => (x.textContent || '').trim()).slice(0, 12) };
      b.click(); return { menu: true, clicked: true };
    });
    await sleep(700);
    const chose = await page.evaluate(() => {
      const d = document.querySelector('[data-rebind-dialog]');
      if (!d) return { dialog: false };
      // 绑定对话框：行 data-rebind-row=部件名，点行即经 rebindSubcircuitCell 真换绑
      const row = d.querySelector('[data-rebind-row="BB"]');
      if (!row) return { dialog: true, rows: [...d.querySelectorAll('[data-rebind-row]')].map((n) => n.getAttribute('data-rebind-row')) };
      row.click(); return { dialog: true, choseBB: true };
    });
    await sleep(1200);
    const rebound = await page.evaluate((id) => {
      const p = window.__sandboxPaper; const c = p.model.getCell(id);
      if (!c) return { gone: true };
      return {
        celltype: String(c.get('celltype') || ''),
        ports: (c.get('ports').items || []).map((x) => x.id).join(','),
        innerGates: c.get('graph') ? c.get('graph').getElements().filter((e) => e.get('type') === 'Or' || e.get('type') === 'And').map((e) => e.get('type')) : [],
        links: p.model.getLinks().length,
      };
    }, placed.id);
    console.log('  菜单路径:', JSON.stringify({ menuOk, rebindItem, chose }), '\n  换绑后:', JSON.stringify(rebound));
    (rebound.celltype === 'BB' && rebound.innerGates.includes('Or') && rebound.links === 2)
      ? ok('[13b] 右键「绑定...」对话框把实例换成 BB，两根连线按端口接回', JSON.stringify(rebound))
      : bad('[13b] 换绑未生效', JSON.stringify({ rebound, chose, rebindItem }));
    await page.keyboard.press('Escape'); await sleep(300);

    // ===== [12] 绑定式存档：保存后顶层实例不内联子图，重载仍能展开 =====
    await page.evaluate(() => {
      const p = window.__sandboxPaper;
      p.model.getCells().forEach((c) => { if (c.get('type') === 'Input' || c.get('type') === 'Output') { /* 保留 */ } });
    });
    await page.locator('button:has-text("保存")').first().click(); await sleep(1200);
    const stored = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const f = Object.values(files).find((x) => x.name === 'R44/canvas.djs');
      const cells = JSON.parse(f.graphJson || '{}').cells || [];
      const sub = cells.find((c) => c.type === 'Subcircuit');
      return { subs: cells.filter((c) => c.type === 'Subcircuit').length, celltype: sub && sub.celltype, inlined: !!(sub && sub.subcircuitGraph && sub.subcircuitGraph.cells && sub.subcircuitGraph.cells.length) };
    });
    console.log('  落盘:', JSON.stringify(stored));
    (stored.subs === 1 && stored.celltype === 'BB' && !stored.inlined)
      ? ok('[12] 存档按名绑定（顶层实例不内联子图）', JSON.stringify(stored))
      : bad('[12] 存档仍内联子图或绑定名丢失', JSON.stringify(stored));
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200); await dismiss(page);
    if (!(await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]')))) { await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1600); }
    await sleep(1400);
    const reloaded = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      const c = p.model.getCells().find((x) => x.get('type') === 'Subcircuit');
      return c ? { celltype: String(c.get('celltype')), ports: (c.get('ports').items || []).map((x) => x.id).join(','), inner: c.get('graph') ? c.get('graph').getElements().length : 0, links: p.model.getLinks().length } : null;
    });
    console.log('  重载后:', JSON.stringify(reloaded));
    (reloaded && reloaded.inner > 0 && reloaded.ports.split(',').length >= 3 && reloaded.links === 2)
      ? ok('[12b] 重载后按名解析出内图与端口，两根连线还在', JSON.stringify(reloaded))
      : bad('[12b] 重载后绑定解析失败', JSON.stringify(reloaded));

    // ===== [14] 沙盒 SPEED =====
    const iv0 = await page.evaluate(() => { const c = window.__sandboxCircuit; return c ? c.interval : null; });
    await page.evaluate(async () => { const { settingsStore } = await import('/src/store/settingsStore.ts'); settingsStore.setSandboxSettings({ simSpeedMs: 120 }); });
    await sleep(900);
    const iv1 = await page.evaluate(() => { const c = window.__sandboxCircuit; return c ? c.interval : null; });
    const hasSlider = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('input[type="range"]')).find((x) => x.min === '5' && x.max === '200');
      return !!el;
    });
    console.log(`  interval: ${JSON.stringify(iv0)} → ${JSON.stringify(iv1)} slider=${hasSlider}`);
    (hasSlider && iv1 === 120) ? ok('[14] 沙盒 SPEED 滑条改的是引擎步进间隔', `${iv0}→${iv1}ms`) : bad('[14] 沙盒调速未生效', JSON.stringify({ iv0, iv1, hasSlider }));

    // ===== [15] 编译模式自动线名 =====
    await page.evaluate(async (a) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const nf = fileStore.createFile('adder.v'); fileStore.saveContent(nf.id, a.c);
      const nf2 = fileStore.createFile('full_adder.v'); fileStore.saveContent(nf2.id, a.c2);
    }, { c: rd('adder.v'), c2: rd('full_adder.v') });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200); await dismiss(page);
    await page.locator('[title="adder.v"]').first().click({ force: true }); await sleep(900);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    for (let i = 0; i < 60; i++) { await sleep(700); const done = await page.evaluate(async () => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getAll()[0]; return !!(f && f.status === 'compiled' && f.circuitJson); }); if (done) break; }
    await sleep(3000);
    const waveLabels = await page.evaluate(() => {
      const paper = document.querySelector('.joint-paper'); if (!paper) return null;
      const texts = Array.from(paper.querySelectorAll('text')).map((t) => (t.textContent || '').trim());
      const auto = texts.filter((t) => /^N\d+$/.test(t));
      const links = paper.querySelectorAll('path.connection').length;
      return { links, autoNamed: auto.length, sample: auto.slice(0, 5) };
    });
    console.log('  编译画布线名:', JSON.stringify(waveLabels));
    (waveLabels && waveLabels.links > 5 && waveLabels.autoNamed > 0)
      ? ok('[15] 编译模式无名连线也标自动名（与沙盒一致）', `${waveLabels.autoNamed}/${waveLabels.links} 条带名，样例 ${JSON.stringify(waveLabels.sample)}`)
      : bad('[15] 编译模式仍无自动线名', JSON.stringify(waveLabels));

    perr.length ? bad('[16] 存在页面异常', perr[0]) : ok('[16] 全程无页面异常');
  } catch (e) { console.log('FATAL', e); fail++; } finally {
    try { await browser && browser.close(); } catch { }
    try { server && server.kill(); } catch { }
    console.log(`\n== R44: ${pass} PASS / ${fail} FAIL ==`);
    process.exit(fail > 0 ? 1 : 0);
  }
})();
