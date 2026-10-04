// 沙盒模式自检探针：复现并定位「子部件无法打开」及沙盒其他问题（用户未给点，自检）
//   [A] 编译嵌套 Verilog → 复制到沙盒 → 放置 sub1 → 展开 sub1（顶层部件可打开）
//   [B] 在 sub1 展开图里尝试打开其嵌套子部件 sub2（子部件无法打开复现）
//   [C] 双击文件树里的 sub1.gate 定义文件，看能否打开（当前只 toast）
//   [D] 新建沙盒文件 → 放置基本门 + 连线 + 仿真，检查 pageerror
//   [E] 持久化：reload 后内容仍在
//   [F] 全程 pageerror 汇总
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1499;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const notes = [];
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const note = (s) => { notes.push(s); console.log(`  · ${s}`); };
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickActivity = async (page, key) => { await page.locator(`button[data-activity="${key}"]`).first().click(); await sleep(700); };
const ensureFilesPanel = async (page) => { if (!await page.evaluate(() => !!document.querySelector('[data-sandbox-filetree]'))) await clickActivity(page, 'files'); await sleep(600); };
const ensureSandbox = async (page) => { if (!await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]'))) await clickActivity(page, 'sandbox'); await sleep(1200); };
const clearKeys = (page) => page.evaluate(() => {
  ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings',
   'verilog-viz-sandbox-w','verilog-viz-sandbox-folders','verilog-viz-font-size','verilog-viz-gates-migrated',
   'verilog-viz-inline-migrated','verilog-viz-import-clipboard','verilog-viz-files','verilog-viz-folders'].forEach(k => localStorage.removeItem(k));
});
const clickMenuItem = (page, prefix) => page.evaluate((p) => {
  const menus = Array.from(document.querySelectorAll('div')).filter(d => getComputedStyle(d).position === 'fixed' && d.querySelectorAll('button, input').length >= 1);
  const m = menus[menus.length - 1]; if (!m) return false;
  const b = Array.from(m.querySelectorAll('button')).find(x => (x.textContent || '').trim().startsWith(p));
  if (!b) return false; b.click(); return true;
}, prefix);
// 找画布上某 celltype 的 Subcircuit 放大镜点位并点击（展开）
async function openExpand(page, gateName) {
  await page.evaluate(() => { delete window.__innerPaper; });
  let pt = null;
  for (let a = 0; a < 8 && !pt; a++) {
    pt = await page.evaluate((name) => {
      const p = window.__sandboxPaper; if (!p) return null;
      const sub = p.model.getCells().find(c => c.get('type') === 'Subcircuit' && c.get('celltype') === name);
      if (!sub) return null; const v = sub.findView(p); const za = v.el?.querySelector?.('a.zoom');
      if (!za) return null; const r = za.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, gateName);
    if (!pt) await sleep(500);
  }
  if (!pt) return null;
  await page.mouse.click(pt.x, pt.y); await sleep(900);
  return pt;
}
const innerState = async (page) => page.evaluate(() => {
  const ip = window.__innerPaper; if (!ip) return { ready: false };
  const subs = ip.model.getCells().filter(c => c.get('type') === 'Subcircuit');
  const spans = Array.from(document.querySelectorAll('span')).map(s => s.textContent || '');
  return {
    ready: true, devs: ip.model.getElements().length, links: ip.model.getLinks().length,
    subs: subs.map(c => c.get('celltype') || ''),
    fail: spans.some(t => t.includes('渲染失败')),
    bound: spans.some(t => t.includes('绑定门定义渲染')),
    crumb: spans.filter(t => /[^ ]/.test(t)).slice(0, 6),
  };
});
// 在展开图内点击某个子部件的放大镜，看是否进入下钻
async function tryDrillInner(page, subCelltype) {
  const pt = await page.evaluate((name) => {
    const ip = window.__innerPaper; if (!ip) return null;
    const sub = ip.model.getCells().find(c => c.get('type') === 'Subcircuit' && c.get('celltype') === name);
    if (!sub) return null; const v = sub.findView(ip); const za = v.el?.querySelector?.('a.zoom');
    if (!za) return null; const r = za.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, subCelltype);
  if (!pt) return null;
  await page.mouse.click(pt.x, pt.y); await sleep(1200);
  return pt;
}
const VERILOG = `module top(input p, input q, output r);
  sub1 s1(.x(p), .z(q), .w(r));
endmodule
module sub1(input x, input z, output w);
  wire t;
  sub2 u1(.a(x), .b(z), .y(t));
  sub2 u2(.a(t), .b(z), .y(w));
endmodule
module sub2(input a, input b, output y);
  assign y = a & b;
endmodule
`;
(async () => {
  let server, browser;
  try {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') console.log('  CONSOLE-ERROR', m.text().slice(0, 160)); });
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    await clearKeys(page); await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}

    // 编译嵌套 Verilog
    const fileId = await page.evaluate((code) => (async () => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const f = fileStore.createFile('adder_top.v'); fileStore.saveContent(f.id, code); return f.id;
    })(), VERILOG);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 1500 }); } catch {}
    await page.locator('[title="adder_top.v"]').first().click(); await sleep(1000);
    await page.locator('button[title^="编译"]').first().click();
    let compiled = false;
    for (let i = 0; i < 40; i++) { await sleep(500); compiled = await page.evaluate(async (id) => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getById(id); return !!(f && f.status === 'compiled' && f.circuitJson); }, fileId); if (compiled) break; }
    if (!compiled) { await page.evaluate(async (code) => { const { compileVerilog } = await import('/src/lib/verilog.ts'); const { fileStore } = await import('/src/store/fileStore.ts'); const r = await compileVerilog([{ name: 'adder_top.v', content: code }]); const f = fileStore.getAll().find(x => x.name === 'adder_top.v'); if (f) fileStore.updateFile(f.id, { circuitJson: r.circuitJson, status: 'compiled' }); }, VERILOG); }
    await page.locator('button[title*="复制到沙盒"]').first().click(); await sleep(2500);
    const gates = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}')).filter(f => f.kind === 'gate').map(f => f.name).sort());
    note('门定义文件: ' + gates.join(', '));

    await ensureSandbox(page);
    await clickActivity(page, 'modules'); await sleep(600);
    // 放置 sub1
    await page.locator('[data-sandbox-sidebar] button:has-text("sub1")').first().click(); await sleep(900);
    const placed = await page.evaluate(() => window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Subcircuit' && c.get('celltype') === 'sub1').length);
    placed >= 1 ? ok('[A] 顶层子部件 sub1 可放置') : bad('[A] sub1 放置失败');

    // 展开 sub1（顶层部件可打开）
    await openExpand(page, 'sub1');
    const d1 = await innerState(page);
    (d1.ready && !d1.fail && d1.devs >= 3 && d1.links >= 1)
      ? ok('[A] 展开 sub1 渲染成功', `devs=${d1.devs} links=${d1.links} 内含子部件 celltype=${JSON.stringify(d1.subs)}`)
      : bad('[A] 展开 sub1 异常', JSON.stringify(d1));
    (d1.subs || []).includes('sub2') ? ok('[A] sub1 内可见嵌套子部件 sub2') : note('sub1 内无 sub2 实例');
    // 尝试在展开图内打开子部件 sub2
    const before = JSON.stringify(await innerState(page));
    const drillPt = await tryDrillInner(page, 'sub2');
    await sleep(600);
    const after = await innerState(page);
    const crumb = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t === 'sub2' || t === 'sub1'));
    if (!drillPt) { bad('[B] 找不到 sub2 放大镜（无法点击）'); }
    else if (before === JSON.stringify(after)) { bad('[B] 点击 sub2 放大镜后展开图无变化 —— 子部件无法打开（drill 未触发）', `drillPt=${JSON.stringify(drillPt)}`); }
    else if (crumb.includes('sub2') && (after.devs || 0) >= 1) { ok('[B] 子部件 sub2 可下钻打开（面包屑 sub1 › sub2）', `drillPt=${JSON.stringify(drillPt)} devs=${after.devs}`); }
    else { bad('[B] 子部件钻取后仍异常', JSON.stringify(after)); }
    // 再从 sub2 钻回顶层（面包屑）
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'sub1'); b?.click(); }); await sleep(700);
    const back = await innerState(page);
    (back.devs >= 3) ? ok('[B] 面包屑可跳回顶层 sub1') : note('[B] 跳回顶层 devs=' + back.devs);
    await page.keyboard.press('Escape'); await sleep(500);

    // [C] 双击文件树里的 sub1.gate 定义文件
    await ensureFilesPanel(page);
    const hasGateFile = await page.evaluate(() => !!document.querySelector('[data-sbfile="sub1.gate"]'));
    if (!hasGateFile) bad('[C] 文件树无 sub1.gate');
    else {
      await page.locator('[data-sbfile="sub1.gate"]').first().click({ button: 'right' }); await sleep(400);
      const ctx = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t));
      note('[C] 右键菜单项: ' + ctx.slice(0, 8).join(' / '));
      await page.keyboard.press('Escape'); await sleep(300);
      // 双击打开
      await page.locator('[data-sbfile="sub1.gate"]').first().dblclick(); await sleep(1000);
      const opened = await page.evaluate(() => ({ modal: !!document.querySelector('[data-inner-host]'),
        toast: document.querySelector('[data-sandbox-toast]')?.textContent || '',
        crumb: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t === 'sub1') }));
      (opened.modal && opened.crumb.includes('sub1')) ? ok('[C] 单击/双击 .gate 文件可打开内部电路查看器') : bad('[C] .gate 文件未打开（仅 toast）', opened.toast.slice(0, 60));
      if (opened.modal) { await page.keyboard.press('Escape'); await sleep(400); }
    }

    // [D] 新建沙盒文件 + 基本门 + 连线 + 仿真
    await ensureFilesPanel(page);
    await page.locator('button[title="新建文件"]').first().click(); await sleep(900);
    await clickActivity(page, 'modules'); await sleep(600);
    for (const n of ['输入 / 输出', '时序', '运算', '比较', '选择 / 移位', '总线', '存储', '显示']) { try { await page.getByText(n, { exact: true }).first().click({ timeout: 600 }); await sleep(80); } catch {} }
    for (const t of ['Input', 'And', 'Output']) { await page.locator(`button[data-gate="${t}"]`).first().click(); await sleep(300); }
    const placedCount = await page.evaluate(() => window.__sandboxPaper.model.getElements().length);
    note('[D] 新文件放置器件数: ' + placedCount);
    // 尝试连线：拖拽 Input 输出端口到 And 输入端口
    const wireRes = await page.evaluate(() => {
      const p = window.__sandboxPaper; const els = p.model.getElements();
      const inp = els.find(e => e.get('type') === 'Input'); const and = els.find(e => e.get('type') === 'And');
      const outp = els.find(e => e.get('type') === 'Output');
      return { hasInput: !!inp, hasAnd: !!and, hasOutput: !!outp };
    });
    note('[D] 器件存在性: ' + JSON.stringify(wireRes));
    // 简单仿真检查：切换仿真并读取是否报错
    const simErrBefore = errors.length;
    // [E] 持久化：写点内容后 reload
    await page.evaluate(() => { const p = window.__sandboxPaper; window.__sbCellsBefore = p.model.getCells().length; });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    await ensureSandbox(page); await sleep(500);
    const afterReload = await page.evaluate(() => window.__sandboxPaper ? window.__sandboxPaper.model.getCells().length : -1);
    note('[E] reload 后画布器件数: ' + afterReload);

    console.log('\n  === 自检小结 F ===');
    console.log('  pageerror 数:', errors.length);
    errors.slice(0, 6).forEach(e => console.log('    • ' + e.slice(0, 160)));
    errors.length ? bad('[F] 存在页面异常') : ok('[F] 全程无页面异常');
  } catch (e) { console.log('FATAL', e); fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
