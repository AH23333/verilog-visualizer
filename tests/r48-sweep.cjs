// R48 只读探针（只打读数，不作判定）：器件属性有没有被静默丢掉。
//  A. digitaljs 认识哪些器件类型（清单）；
//  B. 每个属性过 `cellsToCircuitJson`（沙盒 cells → 电路 JSON）后还在不在 —— 纯数据；
//  C. 同一份 cells 走完整往返（cells → JSON → digitaljs 建图 → serializeGraphCells）后还在不在。
// 之所以要单独测：以往闸门只跑过 And/Or/Xor/Dff/BusGroup/Subcircuit 这一族，
// Memory / Display7 / Mux / Constant / 旋转过的器件 等于从没进过复制与展开路径。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1581; const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    const res = await page.evaluate(async () => {
      const sv = await import('/src/lib/subcircuitView.ts');
      const ss = await import('/src/lib/sandboxSerialize.ts');
      const djs = window.digitaljs;
      const PROPS = ['angle', 'bits', 'net', 'order', 'groups', 'slice', 'abits', 'constant',
        'polarity', 'initial', 'propagation', 'rdports', 'wrports', 'size', 'position', 'label', 'celltype'];

      // 一颗「带满属性」的器件：所有白名单字段一次给齐
      const rich = (type, id) => ({
        id, type, celltype: '&', label: 'L',
        angle: 90, bits: 4, net: 'n', order: 2, groups: [2, 2],
        slice: { start: 0, width: 2 }, abits: 3, constant: 5, polarity: 'positive',
        initial: 3, propagation: 10, rdports: [{ enable: true }], wrports: [{ enable: false }],
        size: { width: 60, height: 40 }, position: { x: 10, y: 20 },
      });

      const A = { types: Object.keys(djs.cells || {}) };

      // B：正向纯数据（沙盒 cells → 电路 JSON）。用 Input 作代表类型，字段丢失与类型无关时一次就够
      const bIn = rich('Input', 'd1');
      const bJson = sv.cellsToCircuitJson({ cells: [bIn] });
      const bDev = bJson.devices?.d1 || {};
      const B = {
        kept: PROPS.filter((p) => bDev[p] !== undefined),
        dropped: PROPS.filter((p) => bDev[p] === undefined),
        keys: Object.keys(bDev),
      };

      // B2：逆向（电路 JSON → cells）同一张字段表，验证两边对称
      const bBack = sv.circuitJsonToCells({ devices: { d1: { type: 'Input', ...Object.fromEntries(PROPS.map((p) => [p, bIn[p]])) } }, connectors: [] });
      const bBackCell = (bBack.cells || [{}])[0] || {};
      const B2 = {
        kept: PROPS.filter((p) => bBackCell[p] !== undefined),
        dropped: PROPS.filter((p) => bBackCell[p] === undefined),
      };

      // C：完整往返。每类器件单独建图，读回 serializeGraphCells 的字段
      const SET = ['Input', 'Output', 'Not', 'And', 'Or', 'Xor', 'Mux', 'Comp', 'Display7',
        'Memory', 'Rom', 'Constant', 'BusSource', 'BusValue', 'BusUngroup', 'BusGroup',
        'BusSlice', 'ZeroExtend', 'SignExtend', 'Dff', 'FlipFlop', 'Latch', 'Tff', 'PriorityComp',
        'TriState', 'PinIn', 'PinOut', 'PortIn', 'PortOut', 'Label', 'Block', 'Unconnected'];
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-10000px;top:0;width:900px;height:700px';
      document.body.appendChild(host);
      const C = [];
      for (const t of SET) {
        const one = { cells: [rich(t, 'd1')] };
        let row = { type: t, forward: '?', roundtrip: null, err: '' };
        try {
          const json = sv.cellsToCircuitJson(one);
          row.forward = Object.keys(json.devices?.d1 || {}).filter((k) => PROPS.includes(k)).sort().join(',');
          const h = sv.renderCircuitView(djs, host, json, { autoLayout: false });
          if (!h) { row.err = 'no handle（renderCircuitView 直接返回 null）'; }
          else {
            const cells = ss.serializeGraphCells(h.paper.model).cells || [];
            const d = cells.find((c) => c && !c.isLink) || {};
            row.roundtrip = PROPS.filter((p) => d[p] !== undefined).sort().join(',');
            row.rtType = d.type; row.rtId = String(d.id);
            try { h.circuit && h.circuit._graph && h.paper.model.clear(); } catch { }
          }
        } catch (e) { row.err = String((e && e.message) || e).slice(0, 90); }
        C.push(row);
      }
      host.remove();
      return { A, B, B2, C, perr: [] };
    });

    console.log('== A digitaljs.cells 类型清单（' + res.A.types.length + '） ==');
    console.log(res.A.types.join(', '));
    console.log('\n== B cells → 电路 JSON ==');
    console.log('  保留:', res.B.kept.join(','));
    console.log('  丢失:', res.B.dropped.join(',') || '(无)');
    console.log('\n== B2 电路 JSON → cells ==');
    console.log('  保留:', res.B2.kept.join(','));
    console.log('  丢失:', res.B2.dropped.join(',') || '(无)');
    console.log('\n== C 逐类型完整往返（cells→JSON→digitaljs→cells） ==');
    for (const r of res.C) {
      console.log(`  ${String(r.type).padEnd(14)} fwd=[${r.forward}]` +
        (r.err ? ` ERR=${r.err}` : ` rt=[${r.roundtrip}] rtType=${r.rtType}`));
    }
    console.log('\npageErrors=', res.perr.length, perr.slice(0, 5));
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 400));
  } finally {
    try { server && server.kill(); } catch { }
    try { browser && await browser.close(); } catch { }
    process.exit(0);
  }
})();
