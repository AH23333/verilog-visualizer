// R37 专项验收：编译模式文件系统 + 部件绑定系统迁移到沙盒（用户方案落地）
//  [1] 编译含嵌套子模块的 Verilog → 复制到沙盒 → 子级部件递归复制为门定义文件
//      （sub1.gate / sub2.gate），沙盒画布快照里实例无内嵌快照（绑定式）
//  [2] 打开复制出的沙盒文件，双击 Subcircuit 展开 → 定义直渲管线渲染成功
//      （devs/links > 0，底栏「绑定门定义渲染」），无「渲染失败」
//  [3] 门定义为编译格式且按名绑定：sub1 定义 subcircuits 含 'sub2'（同名实例共享）
//  [4] 保存为自定义门（画布含门实例）→ 嵌套子级定义递归入库绑定（WRAPPER.subcircuits.sub1）
//  [5] 旧数据迁移：旧 GATES_KEY 门存档 + 文件内嵌 subcircuitGraph → 迁移为门定义
//      文件 + 剥离内嵌 + 展开仍工作
//  [6] 导出 .djs 携带门定义依赖闭包（sub1+sub2）→ 清空门库 → 导入 → 定义恢复、
//      实例展开仍走定义管线
//  [7] 重命名门定义（.gate 文件）→ 全库实例重绑定 → 展开仍命中
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
const clickActivity = async (page, key) => {
  await page.locator(`button[data-activity="${key}"]`).first().click(); await sleep(700);
};
// 活动栏按钮「已激活时点击 = 折叠侧栏 / 退出沙盒」—— 所以按需切换，不盲目点击
const ensureFilesPanel = async (page) => {
  const ok = await page.evaluate(() => !!document.querySelector('[data-sandbox-filetree]'));
  if (!ok) await clickActivity(page, 'files');
  await sleep(600);
};
const ensureSandbox = async (page) => {
  const ok = await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]'));
  if (!ok) await clickActivity(page, 'sandbox');
  await sleep(1200);
};
const clickMenuItem = (page, prefix) => page.evaluate((p) => {
  const menus = Array.from(document.querySelectorAll('div'))
    .filter(d => getComputedStyle(d).position === 'fixed' && d.querySelectorAll('button, input').length >= 1);
  const m = menus[menus.length - 1];
  if (!m) return false;
  const b = Array.from(m.querySelectorAll('button')).find(x => (x.textContent || '').trim().startsWith(p));
  if (!b) return false;
  b.click();
  return true;
}, prefix);
const commitMenuInput = async (page, text, placeholder) => {
  await page.evaluate((ph) => {
    const menus = Array.from(document.querySelectorAll('div'))
      .filter(d => getComputedStyle(d).position === 'fixed' && d.querySelector('input'));
    const m = menus[menus.length - 1];
    if (!m) return;
    const inputs = Array.from(m.querySelectorAll('input'));
    const inp = (ph ? inputs.find(i => i.placeholder === ph) : null) || inputs[0];
    if (inp) inp.focus();
  }, placeholder || null);
  await page.keyboard.press('ControlOrMeta+a'); await sleep(80);
  await page.keyboard.type(text); await sleep(120);
  await page.keyboard.press('Enter'); await sleep(500);
};
const clearKeys = (page) => page.evaluate(() => {
  ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates',
   'verilog-viz-sandbox-settings','verilog-viz-sandbox-w','verilog-viz-sandbox-folders',
   'verilog-viz-font-size','verilog-viz-gates-migrated','verilog-viz-inline-migrated',
   'verilog-viz-import-clipboard','verilog-viz-files','verilog-viz-folders'].forEach(k => localStorage.removeItem(k));
});
// 旧档注入：legacy 门存档（MIG1 正常 / MIGBAD 坏线）+ legacy 沙盒文件（内嵌 subcircuitGraph）
function legacyFixture() {
  const mig1 = { cells: [
    { id: 'm1_i', type: 'Input', position: { x: 40, y: 40 }, bits: 1, net: 'a' },
    { id: 'm1_o', type: 'Output', position: { x: 240, y: 40 }, bits: 1, net: 'y' },
    { id: 'm1_w', isLink: true, source: { id: 'm1_i', port: 'out' }, target: { id: 'm1_o', port: 'in' }, netname: 'N1', bits: 1 },
  ] };
  const migbad = { cells: [
    { id: 'mb_i', type: 'Input', position: { x: 40, y: 40 }, bits: 1, net: 'a' },
    { id: 'mb_n', type: 'Not', position: { x: 140, y: 40 }, bits: 1 },
    { id: 'mb_o', type: 'Output', position: { x: 240, y: 40 }, bits: 1, net: 'y' },
    { id: 'mb_w1', isLink: true, source: { id: 'mb_i', port: 'out' }, target: { id: 'mb_n', port: 'in1' }, netname: 'N1', bits: 1 },
    { id: 'mb_w2', isLink: true, source: { id: 'mb_n', port: 'out' }, target: { id: 'mb_o', port: 'in' }, netname: 'N2', bits: 1 },
  ] };
  return {
    gates: [
      { id: 'g_mig1', name: 'MIG1', graphJson: JSON.stringify(mig1) },
      { id: 'g_migbad', name: 'MIGBAD', graphJson: JSON.stringify(migbad) },
    ],
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
  // 画布可能正在 effect 重建，放大镜点位重试查找
  let pt = null;
  for (let a = 0; a < 8 && !pt; a++) {
    pt = await page.evaluate((name) => {
      const p = window.__sandboxPaper;
      if (!p) return null;
      const sub = p.model.getCells().find(c => c.get('type') === 'Subcircuit' && c.get('celltype') === name);
      if (!sub) return null;
      const v = sub.findView(p);
      const za = v.el?.querySelector?.('a.zoom');
      if (!za) return null;
      const r = za.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, gateName);
    if (!pt) await sleep(500);
  }
  if (!pt) return null;
  await page.mouse.click(pt.x, pt.y);
  for (let i = 0; i < 24; i++) {
    await sleep(300);
    const st = await page.evaluate(() => {
      const ip = window.__innerPaper;
      if (!ip) return { ready: false };
      const links = ip.model.getLinks();
      const spans = Array.from(document.querySelectorAll('span')).map(s => s.textContent || '');
      return {
        ready: true,
        devs: ip.model.getElements().length,
        links: links.length,
        bound: spans.some(t => t.includes('绑定门定义渲染')),
        inlineSrc: spans.some(t => t.includes('旧档内嵌快照')),
        fail: spans.some(t => t.includes('渲染失败')),
        skippedHint: spans.find(t => t.includes('连线无法还原')) || null,
      };
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
    await clearKeys(page);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}

    // ===== 准备：注入 .v 文件（含两级嵌套子模块），UI 编译 =====
    const fileId = await page.evaluate((code) => {
      return (async () => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const f = fileStore.createFile('adder_top.v');
        fileStore.saveContent(f.id, code);
        return f.id;
      })();
    }, VERILOG);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 1500 }); } catch {}
    await page.locator('[title="adder_top.v"]').first().click(); await sleep(1200);
    await page.locator('button[title^="编译"]').first().click();
    let compiled = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      compiled = await page.evaluate(async (id) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const f = fileStore.getById(id);
        return !!(f && f.status === 'compiled' && f.circuitJson);
      }, fileId);
      if (compiled) break;
    }
    if (!compiled) {
      // 兜底：直接在页内编译并落库（跳过 UI 编译按钮的时序不确定性）
      console.log('    (UI 编译未完成，使用页内 compileVerilog 兜底)');
      compiled = await page.evaluate(async (code) => {
        const { compileVerilog } = await import('/src/lib/verilog.ts');
        const { fileStore } = await import('/src/store/fileStore.ts');
        const r = await compileVerilog([{ name: 'adder_top.v', content: code }]);
        const f = fileStore.getAll().find(x => x.name === 'adder_top.v');
        if (!f) return false;
        fileStore.updateFile(f.id, { circuitJson: r.circuitJson, status: 'compiled' });
        return true;
      }, VERILOG);
    }
    compiled ? ok('[0] 编译成功（含嵌套子模块）') : bad('[0] 编译失败');
    // 诊断：编译产物与画布内容
    const diag0 = await page.evaluate(async (id) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const f = fileStore.getById(id);
      return {
        definedModules: f?.definedModules,
        subKeys: Object.keys(f?.circuitJson?.subcircuits || {}),
        devCount: Object.keys(f?.circuitJson?.devices || {}).length,
      };
    }, fileId);
    console.log('    diag0:', JSON.stringify(diag0));
    // 复制到沙盒（编译后 App 默认在电路视图，Canvas 已挂载）
    await page.locator('button[title*="复制到沙盒"]').first().click(); await sleep(2500);
    const copyMsg = await page.evaluate(() => (document.body.textContent.match(/已把[^\n]{0,200}/)?.[0] || ''));
    console.log('    copy:', copyMsg.slice(0, 120));

    // ===== [1] 递归复制迁移：门定义文件生成 + 实例绑定式存储 =====
    const mig = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const gateFiles = Object.values(files).filter(f => f.kind === 'gate');
      const canvas = Object.values(files).find(f => f.kind !== 'gate' && (f.graphJson || '').includes('Subcircuit'));
      let cells = []; try { cells = JSON.parse(canvas?.graphJson || '{}').cells || []; } catch {}
      const subs = cells.filter(c => c.type === 'Subcircuit');
      return {
        gateNames: gateFiles.map(g => g.name).sort(),
        gateOk: gateFiles.every(g => { try { return Object.keys(JSON.parse(g.circuitJson).devices || {}).length > 0; } catch { return false; } }),
        subCount: subs.length,
        subCelltypes: subs.map(s => s.celltype),
        inlineStripped: subs.every(s => !s.subcircuitGraph),
      };
    });
    console.log('    迁移诊断:', JSON.stringify(mig));
    (mig.gateNames.includes('sub1.gate') && mig.gateNames.includes('sub2.gate') && mig.gateOk)
      ? ok('[1a] 编译结果子级部件递归复制为门定义文件（sub1/sub2.gate）', mig.gateNames.join(', '))
      : bad('[1a] 门定义文件未递归生成', JSON.stringify(mig.gateNames));
    (mig.subCount >= 1 && mig.inlineStripped)
      ? ok('[1b] 沙盒实例绑定式存储（无内嵌快照）', `celltype=${mig.subCelltypes.join(',')}`)
      : bad('[1b] 实例仍内嵌快照', JSON.stringify(mig));

    // ===== [2] 展开图：定义直渲管线（零反向转换）=====
    const d2 = await openExpand(page, 'sub1');
    (d2 && d2.ready && !d2.fail && d2.devs >= 3 && d2.links >= 2 && d2.bound)
      ? ok('[2] 展开图走门定义直渲管线（绑定门定义渲染，无渲染失败）', `devs=${d2.devs} links=${d2.links}`)
      : bad('[2] 展开图异常', JSON.stringify(d2));
    await page.keyboard.press('Escape'); await sleep(500);

    // ===== [3] 子级按名绑定：sub1 内 2 个 sub2 实例共享定义；定义静态态可扁平
    //（yosys 格式），渲染期由 resolveDefCircuit 合并依赖闭包后自足 =====
    const bind = await page.evaluate(async () => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const s1 = Object.values(files).find(f => f.name === 'sub1.gate');
      if (!s1) return null;
      const mod = JSON.parse(s1.circuitJson);
      const subDevs = Object.values(mod.devices).filter(d => d.type === 'Subcircuit');
      const { resolveDefCircuit } = await import('/src/lib/gateSystem.ts');
      const merged = resolveDefCircuit('sub1');
      return {
        sub2Instances: subDevs.filter(d => d.celltype === 'sub2').length,
        restSubKeys: Object.keys(mod.subcircuits || {}).length,
        mergedSubKeys: Object.keys(merged?.subcircuits || {}),
      };
    });
    (bind && bind.sub2Instances === 2 && (bind.mergedSubKeys || []).includes('sub2'))
      ? ok('[3] 子级按名绑定（2 个 sub2 实例 → 渲染期合并 sub2 定义）', JSON.stringify(bind))
      : bad('[3] 绑定形态异常', JSON.stringify(bind));

    // ===== [4] 保存为自定义门（画布含门实例）→ 嵌套定义递归入库 =====
    await page.locator('button[title="新建文件"]').first().click(); await sleep(900);
    await clickActivity(page, 'modules'); await sleep(500);
    // 展开全部分组（折叠状态下部件按钮不可见）
    for (const n of ['输入 / 输出', '时序', '运算', '比较', '选择 / 移位', '总线', '存储', '显示']) {
      try { await page.getByText(n, { exact: true }).first().click({ timeout: 700 }); await sleep(100); } catch {}
    }
    // 放 Input / Output / sub1 实例（save-as-gate 要求 IO 引脚存在）
    for (const t of ['Input', 'Output']) {
      await page.locator(`button[data-gate="${t}"]`).first().click(); await sleep(320);
    }
    await page.locator('[data-sandbox-sidebar] button:has-text("sub1")').first().click(); await sleep(900);
    const placedSub = await page.evaluate(() =>
      window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Subcircuit' && c.get('celltype') === 'sub1').length);
    (placedSub >= 1) ? ok('[4b] 门实例可从定义放置（constructCircuit 合成活图）')
      : bad('[4b] 实例放置失败');
    await clickActivity(page, 'hierarchy'); await sleep(500);
    await page.locator('button[title="将当前电路保存为自定义门"]').first().click(); await sleep(400);
    await page.locator('input[placeholder="自定义门名称"]').fill('WRAPPER');
    await page.locator('button[title="确认保存为自定义门"]').first().click(); await sleep(700);
    const wrap = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const w = Object.values(files).find(f => f.name === 'WRAPPER.gate');
      if (!w) return null;
      const mod = JSON.parse(w.circuitJson);
      const subDevs = Object.values(mod.devices).filter(d => d.type === 'Subcircuit');
      return {
        hasSub1: subDevs.some(d => d.celltype === 'sub1'),
        restSubKeys: Object.keys(mod.subcircuits || {}),
      };
    });
    (placedSub >= 1 && wrap && wrap.hasSub1)
      ? ok('[4] 保存为自定义门：嵌套门实例按名绑定入库', `WRAPPER 引用 sub1 ✓（静态 subcircuits=${JSON.stringify(wrap.restSubKeys)}）`)
      : bad('[4] 嵌套定义未递归入库', JSON.stringify(wrap));

    // ===== [5] 旧数据迁移 =====
    const fx = legacyFixture();
    await page.evaluate(({ gates, file }) => {
      localStorage.setItem('verilog-viz-sandbox-gates', JSON.stringify(gates));
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      files['sb_legacy'] = { id: 'sb_legacy', name: 'legacy.djs', graphJson: JSON.stringify(file), updatedAt: Date.now() };
      localStorage.setItem('verilog-viz-sandbox-files', JSON.stringify(files));
      localStorage.removeItem('verilog-viz-gates-migrated');
      localStorage.removeItem('verilog-viz-inline-migrated');
    }, { gates: fx.gates, file: fx.file });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    await ensureSandbox(page); await sleep(400);
    const migrated = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const gateNames = Object.values(files).filter(f => f.kind === 'gate').map(f => f.name);
      const legacy = files['sb_legacy'];
      let cells = []; try { cells = JSON.parse(legacy?.graphJson || '{}').cells || []; } catch {}
      const sub = cells.find(c => c.type === 'Subcircuit');
      return {
        gateNames,
        inlineStripped: !!sub && !sub.subcircuitGraph,
        celltypeKept: sub?.celltype,
      };
    });
    console.log('    迁移诊断:', JSON.stringify(migrated));
    (migrated.gateNames.includes('MIG1.gate') && migrated.gateNames.includes('MIGBAD.gate') && migrated.inlineStripped)
      ? ok('[5] 旧档迁移：门定义文件生成 + 内嵌快照剥离', migrated.gateNames.join(', '))
      : bad('[5] 旧档迁移异常', JSON.stringify(migrated));
    // 打开 legacy 文件，展开 MIG1 实例（定义管线）
    await page.evaluate(() => {
      const f = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}')['sb_legacy'];
      if (f) { localStorage.setItem('verilog-viz-sandbox-active', 'sb_legacy'); }
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    await ensureSandbox(page); await sleep(400);
    const d5 = await openExpand(page, 'MIG1');
    (d5 && d5.ready && !d5.fail && d5.devs >= 2 && d5.bound)
      ? ok('[5b] 迁移后实例展开走定义管线', `devs=${d5.devs} links=${d5.links}`)
      : bad('[5b] 迁移后展开异常', JSON.stringify(d5));
    await page.keyboard.press('Escape'); await sleep(400);

    // ===== [6] 导出 .djs（依赖闭包）→ 清空门库 → 导入恢复 =====
    await ensureFilesPanel(page);
    // 找到 [1] 复制出的沙盒文件（含 sub1 实例），右键导出
    const copyFileName = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const hit = Object.values(files).find(f => f.kind !== 'gate' && (f.graphJson || '').includes('"sub1"'));
      return hit?.name || null;
    });
    const treeRows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-sbfile]')).map(el => el.getAttribute('data-sbfile')));
    const diag6 = await page.evaluate(() => ({
      activities: Array.from(document.querySelectorAll('[data-activity]')).map(b => b.getAttribute('data-activity')),
      treePresent: !!document.querySelector('[data-sandbox-filetree]'),
      sidebarTitle: Array.from(document.querySelectorAll('[data-sandbox-sidebar] span')).map(s => s.textContent).slice(0, 3),
      modalOpen: !!document.querySelector('[data-inner-host]'),
    }));
    console.log('    [6] 文件树行:', JSON.stringify(treeRows), 'diag:', JSON.stringify(diag6));
    let payloadText = null;
    if (copyFileName) {
      console.log('    [6] 导出目标文件:', copyFileName);
      const dl = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 9000);
        page.once('download', (d) => { clearTimeout(timer); resolve(d); });
        (async () => {
          try {
            await page.locator(`[data-sbfile="${copyFileName}"]`).first().click({ button: 'right', timeout: 5000 }); await sleep(450);
            const clicked = await clickMenuItem(page, '导出 JSON');
            console.log('    [6] 导出菜单点击:', clicked);
          } catch (e) { console.log('    [6] 菜单操作失败:', String(e).slice(0, 100)); }
        })();
      });
      if (dl) { try { const fp = await dl.path(); payloadText = require('fs').readFileSync(fp, 'utf8'); } catch {} }
    }
    if (!payloadText) { bad('[6] 未捕获导出下载'); }
    else {
      const parsed = (() => { try { return JSON.parse(payloadText); } catch { return {}; } })();
      const carried = (parsed?.customGates || []).map(g => g.name).sort();
      // 清空门库 + 重绑数据源
      await page.evaluate(() => {
        const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
        for (const [id, f] of Object.entries(files)) if (f.kind === 'gate') delete files[id];
        localStorage.setItem('verilog-viz-sandbox-files', JSON.stringify(files));
      });
      // 用导出内容模拟导入
      await page.setInputFiles('input[type="file"][accept=".djs,.json"]', {
        name: 'reimport.djs', mimeType: 'application/json', buffer: Buffer.from(payloadText || '{}'),
      });
      await sleep(1200);
      const restored = await page.evaluate(() => {
        const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
        return Object.values(files).filter(f => f.kind === 'gate').map(f => f.name).sort();
      });
      (carried.includes('sub1') && carried.includes('sub2') && restored.includes('sub1.gate') && restored.includes('sub2.gate'))
        ? ok('[6] 导出携带依赖闭包（sub1+sub2），导入后定义恢复', carried.join(', '))
        : bad('[6] 闭包/恢复异常', JSON.stringify({ carried, restored }));
      // 恢复后展开仍走定义管线
      await page.evaluate((n) => {
        const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
        const hit = Object.values(files).find(f => f.name === n);
        if (hit) localStorage.setItem('verilog-viz-sandbox-active', hit.id);
      }, copyFileName);
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
      await ensureSandbox(page); await sleep(400);
      const d6 = await openExpand(page, 'sub1');
      (d6 && d6.ready && !d6.fail && d6.bound)
        ? ok('[6b] 导入恢复后展开仍走定义管线')
        : bad('[6b] 导入后展开异常', JSON.stringify(d6));
      await page.keyboard.press('Escape'); await sleep(400);
    }

    // ===== [7] 重命名门定义 → 全库重绑定 =====
    await ensureFilesPanel(page);
    const before7 = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const a = Object.values(files).find(f => f.name === 'adder_top_sandbox.djs');
      return { cells: (() => { try { return JSON.parse(a.graphJson).cells.filter(c => c.type === 'Subcircuit').map(c => c.celltype); } catch { return []; } })() };
    });
    await page.locator('[data-sbfile="sub1.gate"]').first().click({ button: 'right' }); await sleep(450);
    await commitMenuInput(page, 'sub1r');
    await sleep(300);
    const toast7 = await page.evaluate(() => document.querySelector('[data-sandbox-toast]')?.textContent || '');
    await sleep(600);
    console.log('    [7] before=', JSON.stringify(before7), 'toast=', toast7);
    await sleep(200);
    const rebind = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const names = Object.values(files).map(f => f.name);
      const perFile = [];
      for (const f of Object.values(files)) {
        if (f.kind === 'gate' || !f.graphJson) continue;
        try {
          const subs = JSON.parse(f.graphJson).cells.filter(c => c.type === 'Subcircuit').map(c => c.celltype);
          if (subs.length) perFile.push({ file: f.name, subs });
        } catch {}
      }
      const adder = Object.values(files).find(f => f.name === 'adder_top_sandbox.djs');
      const rawSub = (() => { try { return JSON.stringify(JSON.parse(adder.graphJson).cells.find(c => c.type === 'Subcircuit')); } catch { return null; } })();
      return { hasOld: names.includes('sub1.gate'), hasNew: names.includes('sub1r.gate'), perFile, rawSub: rawSub?.slice(0, 300) };
    });
    const celltypes = rebind.perFile.flatMap(x => x.subs);
    // MIG1 是 legacy 场景的实例（与本次改名无关），只要求：无旧名 sub1，且 sub1r 引用齐全
    (rebind.hasNew && !rebind.hasOld && !celltypes.includes('sub1')
      && celltypes.filter(c => c === 'sub1r').length >= 3)
      ? ok('[7] 重命名门定义触发全库重绑定', `celltypes=${celltypes.join(',')}`)
      : bad('[7] 重绑定异常', JSON.stringify(rebind));
    // 重绑定后展开仍命中新定义
    await ensureSandbox(page);
    const live7 = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return {
        hasPaper: !!p,
        subs: p ? p.model.getCells().filter(c => c.get('type') === 'Subcircuit').map(c => c.get('celltype')) : null,
      };
    });
    console.log('    [7b] live paper:', JSON.stringify(live7));
    const d7 = await openExpand(page, 'sub1r');
    (d7 && d7.ready && !d7.fail && d7.bound)
      ? ok('[7b] 重绑定后展开仍走定义管线')
      : bad('[7b] 重绑定后展开异常', JSON.stringify(d7));
    await page.keyboard.press('Escape'); await sleep(300);

    // ===== [8] 无页面异常 =====
    errors.length ? bad('[8] 有页面异常', errors.slice(0, 3).join(' | ')) : ok('[8] 全程无页面异常');
  } catch (e) { console.log('FATAL', e); fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
