// R13 沙盒自定义门导入验收：PORTS 元件库恢复 + 保存为自定义门 + USER 分类实例化 +
// 子电路（digitaljs Subcircuit）真仿真（信号穿越自定义门传播）+ 保存/加载持久化
// 用法: node tests/r13-custom-gate.cjs
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1427;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
const ok = (n, m = '') => { results.pass++; console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`); };
const bad = (n, m = '') => { results.fail++; console.log(`  FAIL  ${n}${m ? ' — ' + m : ''}`); };

async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}

// 精确连线：在指定类型 cell 的指定 port 之间拖线（port 名 = IO 的 net / 子电路端口 id）
async function wirePort(page, srcType, srcPort, tgtType, tgtPort) {
  const pts = await page.evaluate(({ srcType, srcPort, tgtType, tgtPort }) => {
    const cells = [...document.querySelectorAll('[model-id]')];
    const find = (type, port) => {
      for (const el of cells) {
        if (el.getAttribute('data-type') !== type) continue;
        const ms = [...el.querySelectorAll('[magnet]')].filter(m => m.getAttribute('magnet') !== 'false');
        for (const m of ms) {
          const pb = m.closest('.joint-port-body');
          if (pb?.getAttribute('port') === port) {
            const r = m.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
        }
      }
      return null;
    };
    return { src: find(srcType, srcPort), tgt: find(tgtType, tgtPort) };
  }, { srcType, srcPort, tgtType, tgtPort });
  if (!pts.src || !pts.tgt) return false;
  await page.mouse.move(pts.src.x, pts.src.y); await page.mouse.down(); await sleep(150);
  await page.mouse.move((pts.src.x + pts.tgt.x) / 2, (pts.src.y + pts.tgt.y) / 2, { steps: 3 }); await sleep(80);
  await page.mouse.move(pts.tgt.x, pts.tgt.y, { steps: 5 }); await sleep(250);
  await page.mouse.up(); await sleep(400);
  return true;
}
const clickGate = async (page, label) => {
  await page.evaluate((l) => document.querySelector('button[data-gate="' + l + '"]')?.click(), label);
  await sleep(450);
};
async function boot(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.removeItem('verilog-viz-sandbox-files');
    localStorage.removeItem('verilog-viz-sandbox-active');
    localStorage.removeItem('verilog-viz-sandbox-gates');
  });
  await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
  try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
  await page.locator('button[title="沙盒"]').click(); await sleep(800);
  await page.locator('button[title="新建文件"]').click(); await sleep(1200);
}

(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });

    // ===== Phase A: 定义并保存一个自定义门（Input -> Output 直通模块）=====
    console.log('[A] Define + save a custom gate');
    await boot(page);
    await clickGate(page, 'Input'); await clickGate(page, 'Output'); await sleep(300);
    const portCells = await page.evaluate(() => window.__sandboxPaper.model.getCells().map(c => c.get('type')).sort());
    (portCells.includes('Input') && portCells.includes('Output'))
      ? ok('PORTS palette restored (Input/Output placeable)', portCells.join(','))
      : bad('PORTS palette', portCells.join(','));
    const netSet = await page.evaluate(() => {
      const io = window.__sandboxPaper.model.getCells().filter(c => ['Input', 'Output'].includes(c.get('type')));
      return io.map(c => c.get('net'));
    });
    (netSet.includes('in1') && netSet.includes('out1'))
      ? ok('interface pins auto-named (in1/out1)', netSet.join(','))
      : bad('pin names', netSet.join(','));

    const wA = await wirePort(page, 'Input', 'out', 'Output', 'in');
    wA ? ok('inner wire Input.out -> Output.in drawn') : bad('inner wire drawn');
    const innerLinks = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
    innerLinks >= 1 ? ok('inner graph has link', `links=${innerLinks}`) : bad('inner link', `links=${innerLinks}`);

    // 通过真实 UI 保存为自定义门
    await page.locator('button[title^="将当前电路保存为自定义门"]').click(); await sleep(300);
    await page.fill('input[placeholder="自定义门名称"]', 'MyGate'); await sleep(150);
    await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(400);
    const gateList = await page.evaluate(() => window.__sandboxGates.list());
    (gateList.length === 1 && gateList[0].name === 'MyGate')
      ? ok('custom gate saved to USER registry', `name=${gateList[0].name}`)
      : bad('gate saved', JSON.stringify(gateList.map(g => g.name)));
    const gateJson = await page.evaluate(() => {
      const g = window.__sandboxGates.list()[0];
      const j = JSON.parse(g.graphJson);
      return j.cells.map(c => c.type);
    });
    (gateJson.includes('Input') && gateJson.includes('Output'))
      ? ok('saved gate graph has interface (Input/Output)', gateJson.join(','))
      : bad('gate graph', gateJson.join(','));

    // ===== Phase B: 实例化自定义门并验证真仿真（信号穿越子电路）=====
    console.log('[B] Instantiate custom gate + simulate through it');
    await page.locator('button[title="新建文件"]').click(); await sleep(1200);
    await clickGate(page, 'Input'); await clickGate(page, 'Lamp'); await sleep(300);
    await page.evaluate(() => { const g = window.__sandboxGates.list()[0]; if (g) window.__sandboxGates.place(g.id); }); await sleep(600); // 通过 USER 注册表实例化自定义门
    const subInfo = await page.evaluate(() => {
      const subs = window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Subcircuit');
      if (!subs.length) return null;
      const s = subs[0];
      return { type: s.get('type'), ports: s.get('ports').items.map(p => p.id), celltype: s.get('celltype') };
    });
    (subInfo && subInfo.type === 'Subcircuit' && subInfo.ports.includes('in1') && subInfo.ports.includes('out1'))
      ? ok('Subcircuit placed with derived ports', `ports=${subInfo.ports.join(',')} label=${subInfo.celltype}`)
      : bad('Subcircuit placed', JSON.stringify(subInfo));

    const wB1 = await wirePort(page, 'Input', 'out', 'Subcircuit', 'in1');
    const wB2 = await wirePort(page, 'Subcircuit', 'out1', 'Lamp', 'in');
    (wB1 && wB2) ? ok('outer wires Button->gate.in / gate.out->Lamp drawn') : bad('outer wires', `b1=${wB1} b2=${wB2}`);

    // 仿真自动运行；点击 Button，断言 Lamp 经自定义门点亮（信号穿越子电路）
    await sleep(300);
    const diag = await page.evaluate(() => {
      const sig = (s) => s ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v && v.toString ? v.toString() : v])) : null;
      const paper = window.__sandboxPaper;
      const cells = paper.model.getCells();
      const sub = cells.find(c => c.get('type') === 'Subcircuit');
      const btn = cells.find(c => c.get('type') === 'Input');
      const inner = sub ? sub.get('graph') : null;
      const innerCells = inner ? inner.getCells().map(c => ({
        type: c.get('type'), net: c.get('net'), mode: c.get('mode'),
        out: sig(c.get('outputSignals')), in: sig(c.get('inputSignals')),
      })) : null;
      return {
        subInput: sig(sub?.get('inputSignals')), subOutput: sig(sub?.get('outputSignals')),
        btnOut: sig(btn?.get('outputSignals')), innerCells,
        subPorts: sub?.get('ports')?.items,
      };
    });
    console.log('DIAG before:', JSON.stringify(diag));
    const lampBefore = await page.evaluate(() => {
      const lamps = window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Lamp');
      const v = lamps[0]?.findView(window.__sandboxPaper)?.el?.querySelector?.('.led');
      return v ? getComputedStyle(v).fill : '';
    });
    await page.locator('[data-type="Input"]').click(); await sleep(600);
    const lampAfter = await page.evaluate(() => {
      const lamps = window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Lamp');
      const v = lamps[0]?.findView(window.__sandboxPaper)?.el?.querySelector?.('.led');
      return v ? getComputedStyle(v).fill : '';
    });
    (lampBefore !== lampAfter)
      ? ok('Lamp state changed after Button click', `${lampBefore} -> ${lampAfter}`)
      : bad('Lamp changed', `${lampBefore} -> ${lampAfter}`);
    // 直通子电路：Button ON -> 内部 Input=1 -> Output=1 -> Lamp 绿
    (lampAfter === '#03c03c' || lampAfter === 'rgb(3, 192, 60)')
      ? ok('Lamp lights GREEN through custom gate (signal propagated)', lampAfter)
      : bad('Lamp green through gate', lampAfter);

    // ===== Phase C: 保存/加载持久化（Subcircuit + 内部图重建）=====
    console.log('[C] Persist custom gate instance (save/reload)');
    await page.evaluate(() => window.__sandboxSave && window.__sandboxSave()); await sleep(400); // Save <file> via QC hook (real handleSave)
    const dbgSer = await page.evaluate(() => window.__sandboxDebugSerialize ? window.__sandboxDebugSerialize() : null);
    console.log('DIAG serialize:', JSON.stringify(dbgSer));
    const preReload = await page.evaluate(() => {
      const raw = localStorage.getItem('verilog-viz-sandbox-files');
      const files = raw ? JSON.parse(raw) : {};
      const activeId = localStorage.getItem('verilog-viz-sandbox-active');
      return { activeId, fileIds: Object.keys(files), subJson: (activeId && files[activeId]) ? JSON.parse(files[activeId].graphJson).cells.filter(c => c.type === 'Subcircuit').length : 'no-active' };
    });
    console.log('DIAG preReload:', JSON.stringify(preReload));
    const savedHasSub = await page.evaluate(() => {
      const f = window.__sandboxPaper.model.toJSON();
      const subs = f.cells.filter(c => c.type === 'Subcircuit');
      if (!subs.length) return { ok: false };
      const g = subs[0].subcircuitGraph || subs[0].graph; // live graph doesn't serialize; use the JSON copy
      const innerTypes = (g?.cells || []).map(c => c.type);
      return { ok: true, innerTypes };
    });
    (savedHasSub.ok && savedHasSub.innerTypes.includes('Input') && savedHasSub.innerTypes.includes('Output'))
      ? ok('saved file embeds Subcircuit + inner graph', JSON.stringify(savedHasSub.innerTypes))
      : bad('saved Subcircuit', JSON.stringify(savedHasSub));

    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(1500);
    // DIAG: what did we actually persist + what reopened?
    const diagReload = await page.evaluate(() => {
      const lsKey = 'verilog-viz-sandbox-files';
      let persisted = null;
      try { persisted = JSON.parse(localStorage.getItem(lsKey) || '{}'); } catch {}
      const activeId = localStorage.getItem('verilog-viz-sandbox-active');
      const f = persisted && activeId ? persisted[activeId] : null;
      let subJson = null;
      if (f && f.graphJson) {
        try { const j = JSON.parse(f.graphJson); subJson = j.cells.filter(c => c.type === 'Subcircuit').length; } catch (e) { subJson = 'parse-err:' + e.message; }
      }
      const pap = window.__sandboxPaper;
      const cells = pap ? pap.model.getCells().map(c => c.get('type')) : null;
      return { activeId, hasFile: !!f, cellCount: cells ? cells.length : -1, cellTypes: cells, subJson };
    });
    console.log('DIAG reload:', JSON.stringify(diagReload));
    // active file auto-reopens after reload; if not, open it from the FILES list
    let reloaded = await page.evaluate(() => {
      const subs = window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Subcircuit');
      if (!subs.length) return { sub: false };
      const inner = subs[0].get('graph');
      const innerTypes = inner.getCells().map(c => c.get('type'));
      return { sub: true, innerTypes, ports: subs[0].get('ports').items.map(p => p.id) };
    });
    if (!reloaded.sub) {
      await page.locator('span').filter({ hasText: /\.djs$/ }).first().click(); await sleep(1200);
      reloaded = await page.evaluate(() => {
        const subs = window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Subcircuit');
        if (!subs.length) return { sub: false };
        const inner = subs[0].get('graph');
        const innerTypes = inner.getCells().map(c => c.get('type'));
        return { sub: true, innerTypes, ports: subs[0].get('ports').items.map(p => p.id) };
      });
    }
    (reloaded.sub && reloaded.innerTypes.includes('Input') && reloaded.innerTypes.includes('Output'))
      ? ok('reload rebuilt Subcircuit + inner graph', JSON.stringify(reloaded.innerTypes))
      : bad('reload Subcircuit', JSON.stringify(reloaded));
    (reloaded.ports && reloaded.ports.includes('in1') && reloaded.ports.includes('out1'))
      ? ok('reloaded Subcircuit ports preserved', reloaded.ports.join(','))
      : bad('reload ports', JSON.stringify(reloaded.ports));

    dialogs.length === 0 ? ok('0 native dialogs') : bad('native dialogs', dialogs.join('; '));
    const typeErrors = errors.filter(e => /TypeError/i.test(e));
    typeErrors.length === 0 ? ok('0 TypeErrors', `total=${errors.length}`) : bad('TypeErrors', typeErrors.join('; '));

    console.log(`\n[DONE] ${results.pass} pass, ${results.fail} fail`);
    await browser.close(); server.kill();
    process.exit(results.fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('FATAL:', e); try { browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(2);
  }
})();
