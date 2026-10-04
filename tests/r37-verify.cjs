// R39 专项验收：编译模式文件系统 + 部件绑定系统迁移到沙盒（文件夹 + 可编辑部件）
//  [1] 编译含嵌套子模块的 Verilog → 复制到沙盒 → 建同名文件夹，子级部件递归复制
//      为该文件夹下的**可编辑 .djs 部件文件**（sub1.djs/sub2.djs），主电路实例
//      按 celltype 绑定（无内嵌快照）
//  [2] 子部件文件可直接打开为可编辑画布（含嵌套实例）
//  [3] 子部件内嵌套实例按名绑定（sub1.djs 含 sub2 实例）
//  [4] 保存为部件（画布含部件实例）→ 嵌套子部件递归入库绑定
//  [5] 旧数据迁移：旧 GATES_KEY 存档 + 文件内嵌 subcircuitGraph + 旧 .gate → 部件文件
//  [6] 导出 .djs 携带部件依赖闭包 → 清空部件库 → 导入 → 恢复 + 展开仍工作
//  [7] 重命名部件（.djs）→ 全库实例重绑定 → 展开仍命中
//  [8] 全程无页面异常
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1498;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickActivity = async (page, key) => { await page.locator(`button[data-activity="${key}"]`).first().click(); await sleep(700); };
const ensureFilesPanel = async (page) => { if (!await page.evaluate(() => !!document.querySelector('[data-sandbox-filetree]'))) await clickActivity(page, 'files'); await sleep(600); };
const ensureSandbox = async (page) => { if (!await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]'))) await clickActivity(page, 'sandbox'); await sleep(1200); };
const clickMenuItem = (page, prefix) => page.evaluate((p) => {
  const menus = Array.from(document.querySelectorAll('div')).filter(d => getComputedStyle(d).position === 'fixed' && d.querySelectorAll('button, input').length >= 1);
  const m = menus[menus.length - 1]; if (!m) return false;
  const b = Array.from(m.querySelectorAll('button')).find(x => (x.textContent || '').trim().startsWith(p));
  if (!b) return false; b.click(); return true;
}, prefix);
const commitMenuInput = async (page, text) => {
  await page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('div')).filter(d => getComputedStyle(d).position === 'fixed' && d.querySelector('input'));
    const m = menus[menus.length - 1]; if (!m) return;
    const inp = m.querySelector('input'); if (inp) inp.focus();
  });
  await page.keyboard.press('ControlOrMeta+a'); await sleep(80);
  await page.keyboard.type(text); await sleep(120);
  await page.keyboard.press('Enter'); await sleep(500);
};
const clearKeys = (page) => page.evaluate(() => {
  ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings',
   'verilog-viz-sandbox-w','verilog-viz-sandbox-folders','verilog-viz-font-size','verilog-viz-gates-migrated',
   'verilog-viz-inline-migrated','verilog-viz-gatefiles-migrated','verilog-viz-import-clipboard',
   'verilog-viz-files','verilog-viz-folders'].forEach(k => localStorage.removeItem(k));
});
function legacyFixture() {
  const mig1 = { cells: [
    { id: 'm1_i', type: 'Input', position: { x: 40, y: 40 }, bits: 1, net: 'a' },
    { id: 'm1_o', type: 'Output', position: { x: 240, y: 40 }, bits: 1, net: 'y' },
    { id: 'm1_w', isLink: true, source: { id: 'm1_i', port: 'out' }, target: { id: 'm1_o', port: 'in' }, netname: 'N1', bits: 1 },
  ] };
  return {
    gates: [{ id: 'g_mig1', name: 'MIG1', graphJson: JSON.stringify(mig1) }],
    file: { cells: [
      { id: 'lf_i', type: 'Input', position: { x: 40, y: 40 }, bits: 1, net: 'p' },
      { id: 'lf_sub', type: 'Subcircuit', position: { x: 200, y: 40 }, celltype: 'MIG1', subcircuitGraph: mig1 },
      { id: 'lf_o', type: 'Output', position: { x: 380, y: 40 }, bits: 1, net: 'q' },
      { id: 'lf_w1', isLink: true, source: { id: 'lf_i', port: 'out' }, target: { id: 'lf_sub', port: 'a' }, netname: 'N1', bits: 1 },
      { id: 'lf_w2', isLink: true, source: { id: 'lf_sub', port: 'y' }, target: { id: 'lf_o', port: 'in' }, netname: 'N2', bits: 1 },
    ] },
  };
}
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
  await page.mouse.click(pt.x, pt.y);
  for (let i = 0; i < 24; i++) {
    await sleep(300);
    const st = await page.evaluate(() => {
      const ip = window.__innerPaper; if (!ip) return { ready: false };
      return { ready: true, devs: ip.model.getElements().length, links: ip.model.getLinks().length,
        fail: Array.from(document.querySelectorAll('span')).some(t => (t.textContent || '').includes('渲染失败')) };
    });
    if (st.ready && (st.links > 0 || st.fail || i > 5)) return st;
  }
  return null;
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
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    await clearKeys(page); await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}

    const fileId = await page.evaluate((code) => (async () => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const f = fileStore.createFile('adder_top.v'); fileStore.saveContent(f.id, code); return f.id;
    })(), VERILOG);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 1500 }); } catch {}
    await page.locator('[title="adder_top.v"]').first().click(); await sleep(1200);
    await page.locator('button[title^="编译"]').first().click();
    let compiled = false;
    for (let i = 0; i < 40; i++) { await sleep(500); compiled = await page.evaluate(async (id) => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getById(id); return !!(f && f.status === 'compiled' && f.circuitJson); }, fileId); if (compiled) break; }
    if (!compiled) { await page.evaluate(async (code) => { const { compileVerilog } = await import('/src/lib/verilog.ts'); const { fileStore } = await import('/src/store/fileStore.ts'); const r = await compileVerilog([{ name: 'adder_top.v', content: code }]); const f = fileStore.getAll().find(x => x.name === 'adder_top.v'); if (f) fileStore.updateFile(f.id, { circuitJson: r.circuitJson, status: 'compiled' }); }, VERILOG); }
    compiled ? ok('[0] 编译成功（含嵌套子模块）') : bad('[0] 编译失败');
    await page.locator('button[title*="复制到沙盒"]').first().click(); await sleep(2500);

    // ===== [1] 文件夹组织 + 递归可编辑部件 + 绑定式存储 =====
    const mig = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const all = Object.values(files);
      const parts = all.filter(f => f.role === 'part');
      const main = all.find(f => f.role !== 'part' && (f.graphJson || '').includes('Subcircuit'));
      const cells = (() => { try { return JSON.parse(main.graphJson).cells; } catch { return []; } })();
      const subs = cells.filter(c => c.type === 'Subcircuit');
      return {
        allNames: all.map(f => f.name).sort(),
        partNames: parts.map(f => f.name).sort(),
        partOk: parts.every(p => { try { return (JSON.parse(p.graphJson || '{}').cells || []).some(c => !c.isLink); } catch { return false; } }),
        subCelltypes: subs.map(s => s.celltype),
        inlineStripped: subs.every(s => !s.subcircuitGraph),
      };
    });
    console.log('    诊断:', JSON.stringify(mig));
    const inFolder = mig.allNames.every(n => n.startsWith('adder_top/'));
    (inFolder && mig.partNames.includes('adder_top/sub1.djs') && mig.partNames.includes('adder_top/sub2.djs') && mig.partOk)
      ? ok('[1a] 文件夹组织 + 子部件递归复制为可编辑 .djs', mig.allNames.join(', '))
      : bad('[1a] 文件夹/部件生成异常', JSON.stringify(mig));
    (mig.subCelltypes.includes('sub1') && mig.inlineStripped)
      ? ok('[1b] 主电路实例绑定式存储（无内嵌快照）', `celltype=${mig.subCelltypes.join(',')}`)
      : bad('[1b] 实例仍内嵌快照', JSON.stringify(mig));

    // ===== [2] 打开子部件文件为可编辑画布 =====
    await ensureSandbox(page);
    await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const p = Object.values(files).find(f => f.name === 'adder_top/sub1.djs');
      if (p) localStorage.setItem('verilog-viz-sandbox-active', p.id);
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    await ensureSandbox(page); await sleep(600);
    const sub1Open = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      return { cells: p.model.getElements().length, subs: p.model.getCells().filter(c => c.get('type') === 'Subcircuit').map(c => c.get('celltype')) };
    });
    (sub1Open && sub1Open.cells >= 3 && sub1Open.subs.includes('sub2'))
      ? ok('[2] 子部件文件打开为可编辑画布（内含嵌套 sub2 实例）', `cells=${sub1Open.cells} subs=${sub1Open.subs}`)
      : bad('[2] 子部件打开异常', JSON.stringify(sub1Open));

    // ===== [3] 展开（渲染管线）=====
    await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const p = Object.values(files).find(f => f.name === 'adder_top/adder_top_sandbox.djs');
      if (p) localStorage.setItem('verilog-viz-sandbox-active', p.id);
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    await ensureSandbox(page); await sleep(600);
    const d2 = await openExpand(page, 'sub1');
    (d2 && d2.ready && !d2.fail && d2.devs >= 3)
      ? ok('[3] 展开 sub1 渲染成功（绑定部件 → 编译渲染管线）', `devs=${d2.devs} links=${d2.links}`)
      : bad('[3] 展开 sub1 异常', JSON.stringify(d2));
    await page.keyboard.press('Escape'); await sleep(500);

    // ===== [4] 保存为部件（画布含实例）→ 嵌套递归入库 =====
    await page.locator('button[title="新建文件"]').first().click(); await sleep(900);
    await clickActivity(page, 'modules'); await sleep(500);
    for (const n of ['输入 / 输出', '运算', '比较']) { try { await page.getByText(n, { exact: true }).first().click({ timeout: 600 }); await sleep(100); } catch {} }
    for (const t of ['Input', 'Output']) { await page.locator(`button[data-gate="${t}"]`).first().click(); await sleep(300); }
    // 放置 sub1 实例（部件面板）
    await page.locator('[data-sandbox-sidebar] button:has-text("sub1")').first().click(); await sleep(900);
    const placedSub = await page.evaluate(() => window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Subcircuit' && c.get('celltype') === 'sub1').length);
    placedSub >= 1 ? ok('[4b] 部件实例可从定义放置') : bad('[4b] 实例放置失败');
    await clickActivity(page, 'hierarchy'); await sleep(500);
    await page.locator('button[title="将当前电路保存为自定义门"]').first().click(); await sleep(400);
    await page.locator('input[placeholder="自定义门名称"]').fill('WRAPPER');
    await page.locator('button[title="确认保存为自定义门"]').first().click(); await sleep(700);
    const wrap = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const w = Object.values(files).find(f => f.role === 'part' && /(^|\/)WRAPPER\.djs$/.test(f.name));
      if (!w) return null;
      const cells = JSON.parse(w.graphJson).cells;
      const hasSub1 = cells.some(c => c.type === 'Subcircuit' && c.celltype === 'sub1');
      return { hasSub1, name: w.name };
    });
    (placedSub >= 1 && wrap && wrap.hasSub1)
      ? ok('[4] 保存为部件：嵌套实例按名绑定入库', `${wrap.name} 引用 sub1 ✓`)
      : bad('[4] 嵌套部件未递归入库', JSON.stringify(wrap));

    // ===== [5] 旧数据迁移 =====
    const fx = legacyFixture();
    await page.evaluate(({ gates, file }) => {
      localStorage.setItem('verilog-viz-sandbox-gates', JSON.stringify(gates));
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      files['sb_legacy'] = { id: 'sb_legacy', name: 'legacy.djs', graphJson: JSON.stringify(file), updatedAt: Date.now() };
      localStorage.setItem('verilog-viz-sandbox-files', JSON.stringify(files));
      localStorage.removeItem('verilog-viz-gates-migrated');
      localStorage.removeItem('verilog-viz-inline-migrated');
      localStorage.removeItem('verilog-viz-gatefiles-migrated');
    }, { gates: fx.gates, file: fx.file });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    await ensureSandbox(page); await sleep(400);
    const migrated = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const partNames = Object.values(files).filter(f => f.role === 'part').map(f => f.name);
      const legacy = files['sb_legacy'];
      let cells = []; try { cells = JSON.parse(legacy?.graphJson || '{}').cells || []; } catch {}
      const sub = cells.find(c => c.type === 'Subcircuit');
      return { partNames, inlineStripped: !!sub && !sub.subcircuitGraph, celltypeKept: sub?.celltype };
    });
    (migrated.partNames.includes('MIG1.djs') && migrated.inlineStripped)
      ? ok('[5] 旧档迁移：门存档 + 内嵌快照 → 可编辑部件 + 剥离', migrated.partNames.join(', '))
      : bad('[5] 旧档迁移异常', JSON.stringify(migrated));
    await page.evaluate(() => localStorage.setItem('verilog-viz-sandbox-active', 'sb_legacy'));
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    await ensureSandbox(page); await sleep(400);
    const d5 = await openExpand(page, 'MIG1');
    (d5 && d5.ready && !d5.fail && d5.devs >= 2)
      ? ok('[5b] 迁移后实例展开正常', `devs=${d5.devs} links=${d5.links}`)
      : bad('[5b] 迁移后展开异常', JSON.stringify(d5));
    await page.keyboard.press('Escape'); await sleep(400);

    // ===== [6] 导出部件闭包 → 清空 → 导入恢复 =====
    await ensureFilesPanel(page);
    const copyFileName = 'adder_top/adder_top_sandbox.djs';
    let payloadText = null;
    const dl = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 9000);
      page.once('download', (d) => { clearTimeout(timer); resolve(d); });
      (async () => {
        try {
          await page.locator(`[data-sbfile="${copyFileName}"]`).first().click({ button: 'right', timeout: 5000 }); await sleep(450);
          await clickMenuItem(page, '导出 JSON');
        } catch (e) { console.log('    [6] 菜单失败:', String(e).slice(0, 80)); }
      })();
    });
    if (dl) { try { payloadText = require('fs').readFileSync(await dl.path(), 'utf8'); } catch {} }
    if (!payloadText) bad('[6] 未捕获导出下载');
    else {
      const parsed = (() => { try { return JSON.parse(payloadText); } catch { return {}; } })();
      const carried = (parsed?.customParts || []).map(p => p.name).sort();
      await page.evaluate(() => {
        const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
        for (const [id, f] of Object.entries(files)) if (f.role === 'part') delete files[id];
        localStorage.setItem('verilog-viz-sandbox-files', JSON.stringify(files));
      });
      await page.setInputFiles('input[type="file"][accept=".djs,.json"]', {
        name: 'reimport.djs', mimeType: 'application/json', buffer: Buffer.from(payloadText || '{}'),
      });
      await sleep(1200);
      const restored = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}')).filter(f => f.role === 'part').map(f => f.name).sort());
      (carried.includes('sub1') && carried.includes('sub2') && restored.some(n => /sub1\.djs$/.test(n)) && restored.some(n => /sub2\.djs$/.test(n)))
        ? ok('[6] 导出携带部件依赖闭包，导入后恢复', `carried=${carried.join(',')} restored=${restored.join(',')}`)
        : bad('[6] 闭包/恢复异常', JSON.stringify({ carried, restored }));
      await page.evaluate((n) => {
        const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
        const hit = Object.values(files).find(f => f.name === n);
        if (hit) localStorage.setItem('verilog-viz-sandbox-active', hit.id);
      }, copyFileName);
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
      await ensureSandbox(page); await sleep(400);
      const d6 = await openExpand(page, 'sub1');
      (d6 && d6.ready && !d6.fail) ? ok('[6b] 导入恢复后展开正常') : bad('[6b] 导入后展开异常', JSON.stringify(d6));
      await page.keyboard.press('Escape'); await sleep(400);
    }

    // ===== [7] 重命名部件 → 全库重绑定 =====
    await ensureFilesPanel(page);
    // 部件可能落在 adder_top/（复制时）或根目录（导入恢复时）——泛化定位 sub1.djs
    const sub1Sb = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('[data-sbfile]'))
        .find(e => /(^|\/)sub1\.djs$/.test(e.getAttribute('data-sbfile') || ''));
      return el ? el.getAttribute('data-sbfile') : null;
    });
    if (!sub1Sb) { bad('[7] 文件树未找到 sub1.djs 部件'); }
    else {
      const oldPath = sub1Sb, newPath = sub1Sb.replace(/sub1\.djs$/, 'sub1r.djs');
      await page.locator(`[data-sbfile="${oldPath}"]`).first().click({ button: 'right' }); await sleep(450);
      await commitMenuInput(page, 'sub1r');
      await sleep(600);
      const rebind = await page.evaluate(() => {
        const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
        const names = Object.values(files).map(f => f.name);
        const perFile = [];
        for (const f of Object.values(files)) {
          if (f.role === 'part' || !f.graphJson) continue;
          try { const subs = JSON.parse(f.graphJson).cells.filter(c => c.type === 'Subcircuit').map(c => c.celltype); if (subs.length) perFile.push({ file: f.name, subs }); } catch {}
        }
        return { hasOld: names.includes('__OLD__'), names, perFile };
      });
      const celltypes = rebind.perFile.flatMap(x => x.subs);
      const hasNew = rebind.names.some(n => /sub1r\.djs$/.test(n));
      const hasOld = rebind.names.some(n => /(^|\/)sub1\.djs$/.test(n));
      (hasNew && !hasOld && celltypes.filter(c => c === 'sub1r').length >= 1)
        ? ok('[7] 重命名部件触发全库重绑定', `celltypes=${celltypes.join(',')}`)
        : bad('[7] 重绑定异常', JSON.stringify({ hasNew, hasOld, rebind }));
      await ensureSandbox(page);
      const d7 = await openExpand(page, 'sub1r');
      (d7 && d7.ready && !d7.fail) ? ok('[7b] 重绑定后展开仍命中') : bad('[7b] 重绑定后展开异常', JSON.stringify(d7));
      await page.keyboard.press('Escape'); await sleep(300);
    }

    errors.length ? bad('[8] 有页面异常', errors.slice(0, 3).join(' | ')) : ok('[8] 全程无页面异常');
  } catch (e) { console.log('FATAL', e); fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
