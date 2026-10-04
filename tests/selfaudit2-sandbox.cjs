// R39 沙盒自检：文件夹组织 + 子部件可编辑 + 部件绑定
//  [1] 复制到沙盒：建同名文件夹，主电路 + 递归子部件（.djs）都在文件夹里
//  [2] 子部件是**可编辑 .djs 画布文件**（role:'part'，graphJson 有器件），能打开编辑
//  [3] 主电路实例按 celltype 绑定（同文件夹优先），无内嵌快照
//  [4] 展开 sub1 渲染成功且可见嵌套 sub2
//  [5] 编辑子部件定义 → 绑定实例展开反映新内容（单一真源/绑定语义）
//  [6] 全程无页面异常
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
const note = (s) => console.log(`  · ${s}`);
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
   'verilog-viz-inline-migrated','verilog-viz-gatefiles-migrated','verilog-viz-import-clipboard',
   'verilog-viz-files','verilog-viz-folders'].forEach(k => localStorage.removeItem(k));
});
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
  await page.mouse.click(pt.x, pt.y); await sleep(1200);
  return pt;
}
const innerState = async (page) => page.evaluate(() => {
  const ip = window.__innerPaper; if (!ip) return { ready: false };
  const spans = Array.from(document.querySelectorAll('span')).map(s => s.textContent || '');
  return {
    ready: true, devs: ip.model.getElements().length, links: ip.model.getLinks().length,
    subs: ip.model.getCells().filter(c => c.get('type') === 'Subcircuit').map(c => c.get('celltype') || ''),
    fail: spans.some(t => t.includes('渲染失败')),
  };
});
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
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    await clearKeys(page); await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}

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

    const m1 = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const all = Object.values(files);
      const parts = all.filter(f => f.role === 'part');
      const main = all.find(f => f.kind !== 'gate' && f.role !== 'part' && (f.graphJson || '').includes('Subcircuit'));
      const mainCells = (() => { try { return JSON.parse(main.graphJson).cells; } catch { return []; } })();
      const subs = mainCells.filter(c => c.type === 'Subcircuit');
      return {
        allNames: all.map(f => f.name).sort(),
        partNames: parts.map(f => f.name).sort(),
        partHasCells: parts.map(f => { try { return (JSON.parse(f.graphJson || '{}').cells || []).some(c => !c.isLink); } catch { return false; } }),
        mainName: main?.name,
        subCelltypes: subs.map(s => s.celltype),
        inlineStripped: subs.every(s => !s.subcircuitGraph),
      };
    });
    console.log('  诊断:', JSON.stringify(m1));
    const inFolder = m1.allNames.every(n => n.startsWith('adder_top/'));
    (inFolder && m1.partNames.includes('adder_top/sub1.djs') && m1.partNames.includes('adder_top/sub2.djs'))
      ? ok('[1] 文件夹组织：主电路 + 递归子部件都在 adder_top/ 下', m1.allNames.join(', '))
      : bad('[1] 文件夹组织异常', JSON.stringify(m1.allNames));
    (m1.partHasCells.length >= 2 && m1.partHasCells.every(Boolean))
      ? ok('[2] 子部件是可编辑 .djs 画布文件（含器件，role:part）')
      : bad('[2] 子部件不是可编辑画布', JSON.stringify(m1.partHasCells));
    (m1.subCelltypes.includes('sub1') && m1.inlineStripped)
      ? ok('[3] 主电路实例按 celltype 绑定（同文件夹），无内嵌快照', `celltype=${m1.subCelltypes.join(',')}`)
      : bad('[3] 绑定/剥离异常', JSON.stringify(m1));

    await ensureSandbox(page); await ensureFilesPanel(page);
    const openPart = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const p = Object.values(files).find(f => f.name === 'adder_top/sub1.djs');
      if (p) localStorage.setItem('verilog-viz-sandbox-active', p.id);
      return !!p;
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    await ensureSandbox(page); await sleep(600);
    const sub1Canvas = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      return { cells: p.model.getElements().length, subs: p.model.getCells().filter(c => c.get('type') === 'Subcircuit').map(c => c.get('celltype')) };
    });
    (openPart && sub1Canvas && sub1Canvas.cells >= 3 && sub1Canvas.subs.includes('sub2'))
      ? ok('[2b] 子部件文件可直接打开为可编辑画布（内含 sub2 实例）', `cells=${sub1Canvas.cells} subs=${sub1Canvas.subs}`)
      : bad('[2b] 子部件打开异常', JSON.stringify(sub1Canvas));

    await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const p = Object.values(files).find(f => f.name === 'adder_top/adder_top_sandbox.djs');
      if (p) localStorage.setItem('verilog-viz-sandbox-active', p.id);
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    await ensureSandbox(page); await sleep(600);
    await openExpand(page, 'sub1');
    const d1 = await innerState(page);
    (d1.ready && !d1.fail && d1.devs >= 3 && d1.subs.includes('sub2'))
      ? ok('[4] 展开 sub1 渲染成功且可见嵌套 sub2', `devs=${d1.devs} links=${d1.links}`)
      : bad('[4] 展开 sub1 异常', JSON.stringify(d1));
    await page.keyboard.press('Escape'); await sleep(500);

    const edited = await page.evaluate(async () => {
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const sub2 = Object.values(files).find(f => f.name === 'adder_top/sub2.djs');
      if (!sub2) return { ok: false };
      const cells = JSON.parse(sub2.graphJson).cells;
      const before = cells.filter(c => !c.isLink).length;
      cells.push({ id: 'edit_not', type: 'Not', position: { x: 10, y: 200 }, bits: 1 });
      sandboxStore.save(sub2.id, JSON.stringify({ cells }));
      return { ok: true, before, after: cells.filter(c => !c.isLink).length };
    });
    note('[5] 编辑 sub2 定义: ' + JSON.stringify(edited));
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    await ensureSandbox(page); await sleep(600);
    await openExpand(page, 'sub1');
    const sub2pt = await page.evaluate(() => {
      const ip = window.__innerPaper; if (!ip) return null;
      const s2 = ip.model.getCells().find(c => c.get('type') === 'Subcircuit' && c.get('celltype') === 'sub2');
      if (!s2) return null; const v = s2.findView(ip); const za = v.el?.querySelector?.('a.zoom');
      if (!za) return null; const r = za.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (sub2pt) { await page.mouse.click(sub2pt.x, sub2pt.y); await sleep(1400); }
    const d5b = await innerState(page);
    (edited.ok && d5b.ready && d5b.devs >= edited.after - 1)
      ? ok('[5] 编辑子部件定义后，绑定实例展开反映新内容（单一真源）', `sub2 devs=${d5b.devs} (定义节点=${edited.after})`)
      : bad('[5] 编辑定义未反映到实例', JSON.stringify({ edited, d5b, sub2pt: !!sub2pt }));
    await page.keyboard.press('Escape'); await sleep(400);

    console.log('\n  === [6] 页面异常 ===');
    errors.length ? bad('[6] 存在页面异常', errors.slice(0, 3).join(' | ')) : ok('[6] 全程无页面异常');
  } catch (e) { console.log('FATAL', e); fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
