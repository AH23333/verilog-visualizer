// R35b 专项验收：展开图「卡顿且无内容」修复
//  [1] 坏连线门（端口引用不存在）展开不白屏：器件渲染 + 底栏「连线无法还原」提示
//  [2] Escape 可关闭展开弹窗，且关闭后可重新打开（cleanup 清理 __innerPaper）
//  [3] 带位置的门（编译产物/复制电路）默认不勾选「自动整理」→ 保留原位、跳过 elk
//  [4] 手绘门（无位置）默认勾选「自动整理」→ elk 落位（连线出现 vertices）
//  [5] 全程无页面异常
// R36 追加：嵌套门（门中含门实例）展开
//  [6] 合法嵌套门展开：外层连线 + 内层电路都渲染（曾 100%「渲染失败」）
//  [7] 嵌套模块内含坏线的门展开：降级渲染 + 跳过计数，不再「渲染失败」
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1497;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(400); }
  return false;
}
function badWireGate() {
  return { cells: [
    { id: 'i1', type: 'Input', position: { x: 40, y: 40 }, bits: 1, net: 'a' },
    { id: 'n1', type: 'Not', position: { x: 140, y: 40 }, bits: 1 },
    { id: 'o1', type: 'Output', position: { x: 240, y: 40 }, bits: 1, net: 'y' },
    { id: 'w1', isLink: true, source: { id: 'i1', port: 'out' }, target: { id: 'n1', port: 'in1' }, netname: 'N1', bits: 1 },
    { id: 'w2', isLink: true, source: { id: 'n1', port: 'out' }, target: { id: 'o1', port: 'in' }, netname: 'N2', bits: 1 },
  ] };
}
function handDrawnGate() {
  // 无 position —— 手绘场景，需要 elk 自动整理
  return { cells: [
    { id: 'a', type: 'Input', bits: 1, net: 'a' },
    { id: 'b', type: 'Input', bits: 1, net: 'b' },
    { id: 'g', type: 'And', bits: 1 },
    { id: 'o', type: 'Output', bits: 1, net: 'y' },
    { id: 'w1', isLink: true, source: { id: 'a', port: 'out' }, target: { id: 'g', port: 'in1' }, netname: 'N1', bits: 1 },
    { id: 'w2', isLink: true, source: { id: 'b', port: 'out' }, target: { id: 'g', port: 'in2' }, netname: 'N2', bits: 1 },
    { id: 'w3', isLink: true, source: { id: 'g', port: 'out' }, target: { id: 'o', port: 'in' }, netname: 'N3', bits: 1 },
  ] };
}
// R36: 合法嵌套门 —— 内含 HAND 实例，外层连线引用实例端口（= 内层 IO net）
function validNestedGate() {
  return { cells: [
    { id: 'n_i1', type: 'Input', position: { x: 40, y: 40 }, bits: 1, net: 'x' },
    { id: 'n_sub', type: 'Subcircuit', position: { x: 200, y: 40 }, celltype: 'HAND',
      subcircuitGraph: handDrawnGate() },
    { id: 'n_o1', type: 'Output', position: { x: 360, y: 40 }, bits: 1, net: 'z' },
    { id: 'n_w1', isLink: true, source: { id: 'n_i1', port: 'out' }, target: { id: 'n_sub', port: 'a' }, netname: 'x', bits: 1 },
    { id: 'n_w2', isLink: true, source: { id: 'n_sub', port: 'y' }, target: { id: 'n_o1', port: 'in' }, netname: 'z', bits: 1 },
  ] };
}
// R36: 嵌套坏线门 —— 内含 BADWIRE（其内部 w1 引用 Not 门的不存在端口 in1）
function badNestedGate() {
  return { cells: [
    { id: 'b_i1', type: 'Input', position: { x: 40, y: 40 }, bits: 1, net: 'x' },
    { id: 'b_sub', type: 'Subcircuit', position: { x: 200, y: 40 }, celltype: 'BADWIRE',
      subcircuitGraph: badWireGate() },
    { id: 'b_o1', type: 'Output', position: { x: 360, y: 40 }, bits: 1, net: 'z' },
    { id: 'b_w1', isLink: true, source: { id: 'b_i1', port: 'out' }, target: { id: 'b_sub', port: 'a' }, netname: 'x', bits: 1 },
    { id: 'b_w2', isLink: true, source: { id: 'b_sub', port: 'y' }, target: { id: 'b_o1', port: 'in' }, netname: 'z', bits: 1 },
  ] };
}
async function openExpand(page, gateName) {
  await page.evaluate(() => { delete window.__innerPaper; });
  const pt = await page.evaluate((name) => {
    const p = window.__sandboxPaper;
    const sub = p.model.getCells().find(c => c.get('type') === 'Subcircuit' && c.get('celltype') === name);
    if (!sub) return null;
    const v = sub.findView(p);
    const za = v.el?.querySelector?.('a.zoom');
    if (!za) return null;
    const r = za.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, gateName);
  if (!pt) return null;
  await page.mouse.click(pt.x, pt.y);
  for (let i = 0; i < 24; i++) {
    await sleep(300);
    const st = await page.evaluate(() => {
      const ip = window.__innerPaper;
      if (!ip) return { ready: false };
      const links = ip.model.getLinks();
      const footer = Array.from(document.querySelectorAll('span')).map(s => s.textContent || '').find(t => t.includes('连线无法还原')) || null;
      const fail = Array.from(document.querySelectorAll('span')).map(s => s.textContent || '').find(t => t.includes('渲染失败')) || null;
      const cb = document.querySelector('[data-inner-host]')?.closest('div')?.parentElement?.parentElement
        ?.querySelector('input[type="checkbox"]');
      return {
        ready: true,
        devs: ip.model.getElements().length,
        links: links.length,
        verts: links.filter(l => (l.get('vertices') || []).length).length,
        footer, fail, stages: window.__expandStages,
      };
    });
    if (st.ready && (st.verts > 0 || st.fail || i > 5)) return st;
  }
  return null;
}
(async () => {
  let server, browser;
  try {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2000);
    const gates = JSON.stringify([
      { id: 'g_bw', name: 'BADWIRE', graphJson: JSON.stringify(badWireGate()) },
      { id: 'g_hd', name: 'HAND', graphJson: JSON.stringify(handDrawnGate()) },
      { id: 'g_nok', name: 'NESTOK', graphJson: JSON.stringify(validNestedGate()) },
      { id: 'g_nbad', name: 'NESTBAD', graphJson: JSON.stringify(badNestedGate()) },
    ]);
    await page.evaluate((g) => {
      ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates',
       'verilog-viz-sandbox-settings','verilog-viz-sandbox-w','verilog-viz-sandbox-folders',
       'verilog-viz-font-size'].forEach(k => localStorage.removeItem(k));
      localStorage.setItem('verilog-viz-sandbox-gates', g);
    }, gates);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(900);
    await page.locator('button[title="新建文件"]').first().click(); await sleep(900);
    await page.locator('button[data-activity="modules"]').first().click(); await sleep(500);
    await page.locator('[data-sandbox-sidebar] button:has-text("BADWIRE")').first().click(); await sleep(1200);
    await page.locator('[data-sandbox-sidebar] button:has-text("HAND")').first().click(); await sleep(1200);

    // ===== [1] 坏线门展开不白屏 =====
    // R36：坏线不再以「僵尸线」形态留在图里（此前 links=2 含 1 条坏线）
    const d1 = await openExpand(page, 'BADWIRE');
    (d1 && d1.ready && d1.devs === 3 && d1.links === 1 && d1.footer)
      ? ok('[1] 坏线门降级渲染（3 器件 + 1 有效线 + 底栏提示）', `devs=${d1.devs} links=${d1.links} 提示="${(d1.footer || '').slice(0, 30)}"`)
      : bad('[1] 坏线门展开异常', JSON.stringify(d1));
    // ===== [2] Escape 关闭 + 重开 =====
    await page.keyboard.press('Escape'); await sleep(500);
    const gone = await page.evaluate(() => !window.__innerPaper);
    const d2 = await openExpand(page, 'BADWIRE');
    (gone && d2 && d2.ready)
      ? ok('[2] Escape 关闭弹窗且可重新打开')
      : bad('[2] Escape/重开异常', JSON.stringify({ gone, d2: !!d2 }));
    await page.keyboard.press('Escape'); await sleep(500);

    // ===== [3] 手绘门默认勾选自动整理 + elk 落位 =====
    const d3 = await openExpand(page, 'HAND');
    (d3 && d3.ready && d3.verts > 0 && d3.devs === 4)
      ? ok('[3] 手绘门自动整理（elk 落位）', `devs=${d3.devs} verts=${d3.verts}`)
      : bad('[3] 手绘门 elk 未落位', JSON.stringify(d3));
    // checkbox 状态：手绘门应默认勾选
    const cbChecked = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const l = labels.find(x => (x.textContent || '').includes('自动整理'));
      return l ? l.querySelector('input')?.checked : null;
    });
    (cbChecked === true) ? ok('[3b] 手绘门默认勾选「自动整理」') : bad('[3b] 默认勾选异常', String(cbChecked));
    await page.keyboard.press('Escape'); await sleep(400);

    // ===== [4] 带位置门默认不勾选 =====
    // BADWIRE 有位置 —— 重开确认 checkbox 未勾选
    await openExpand(page, 'BADWIRE');
    const cb2 = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const l = labels.find(x => (x.textContent || '').includes('自动整理'));
      return l ? l.querySelector('input')?.checked : null;
    });
    (cb2 === false) ? ok('[4] 带位置门默认不自动整理（零 elk 开销）') : bad('[4] 默认值异常', String(cb2));
    await page.keyboard.press('Escape'); await sleep(300);

    // ===== [6] 合法嵌套门展开（R36：曾 100%「渲染失败」）=====
    await page.locator('[data-sandbox-sidebar] button:has-text("NESTOK")').first().click(); await sleep(1000);
    const d6 = await openExpand(page, 'NESTOK');
    (d6 && d6.ready && !d6.fail && d6.devs >= 3 && d6.links >= 2)
      ? ok('[6] 合法嵌套门展开（外层 + 内层电路均渲染）', `devs=${d6.devs} links=${d6.links}`)
      : bad('[6] 合法嵌套门展开异常', JSON.stringify(d6));
    await page.keyboard.press('Escape'); await sleep(400);

    // ===== [7] 嵌套坏线门展开（R36：降级渲染，不「渲染失败」）=====
    await page.locator('[data-sandbox-sidebar] button:has-text("NESTBAD")').first().click(); await sleep(1000);
    const d7 = await openExpand(page, 'NESTBAD');
    (d7 && d7.ready && !d7.fail && d7.footer)
      ? ok('[7] 嵌套坏线门降级渲染 + 跳过提示', `devs=${d7.devs} links=${d7.links} 提示="${(d7.footer || '').slice(0, 26)}"`)
      : bad('[7] 嵌套坏线门未降级', JSON.stringify(d7));
    await page.keyboard.press('Escape'); await sleep(300);

    // ===== [5] 无页面异常 =====
    errors.length ? bad('[5] 有页面异常', errors.slice(0, 3).join(' | ')) : ok('[5] 全程无页面异常');
  } finally {
    try { await browser?.close(); } catch {}
    try { server?.kill(); } catch {}
  }
  console.log(`===== 结果: ${pass} pass, ${fail} fail =====`);
  process.exit(fail ? 1 : 0);
})();
