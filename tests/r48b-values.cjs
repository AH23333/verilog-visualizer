// R48b 只读探针：把 multiplier 里「往返丢失」那几条的**原始值**打出来，
// 分清两种情况：①值本来就是空串/0（丢了不影响）②值有内容却被真丢了（影响渲染/仿真）。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1583; const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
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

    const out = await page.evaluate(async (a) => {
      const { compileVerilog } = await import('/src/lib/verilog.ts');
      const sv = await import('/src/lib/subcircuitView.ts');
      const ss = await import('/src/lib/sandboxSerialize.ts');
      const res = await compileVerilog(a.srcs, 'multiplier');
      const json = res.circuitJson;
      const cells = sv.circuitJsonToCells(json);
      const back = sv.cellsToCircuitJson(cells);

      const dump = (mod, tag) => {
        const rows = [];
        for (const [k, d0] of Object.entries(mod.devices || {})) {
          const d = d0 || {};
          const t = String(d.type || '?');
          if (!['BusGroup', 'BusSlice', 'Input', 'Output', 'Xor', 'Subcircuit', 'ZeroExtend', 'Constant'].includes(t)) continue;
          const r = { tag, t, key: String(k), id: String(d.id) };
          for (const f of ['net', 'label', 'groups', 'slice', 'extend', 'order', 'bits', 'celltype', 'constant', 'hide_label', 'arst_value', 'source_positions']) {
            if (d[f] === undefined) continue;
            let v = d[f];
            if (f === 'source_positions') v = JSON.stringify(v).slice(0, 40);
            else if (typeof v === 'object') v = JSON.stringify(v);
            r[f] = `${typeof d[f]}:${String(v).slice(0, 46)}`;
          }
          rows.push(r);
        }
        return rows;
      };
      const rows = [...dump(json, 'raw'), ...dump(Object.values(json.subcircuits || {})[0] || {}, 'raw-sub')];

      // 每个 device key 在往返后剩什么
      const flatBack = { ...(back.devices || {}) };
      for (const m of Object.values(back.subcircuits || {})) Object.assign(flatBack, m.devices || {});
      const flatCells = {};
      for (const c of cells.cells || []) if (!c.isLink) flatCells[String(c.id)] = c;

      const detail = rows.map((r) => {
        const c = flatCells[r.key] || flatCells[r.id];
        const b = flatBack[r.key] || flatBack[r.id];
        const fields = ['net', 'label', 'groups', 'slice', 'extend', 'hide_label', 'arst_value', 'source_positions'];
        const lost = fields.filter((f) => r[f] !== undefined && !(c && c[f] !== undefined));
        const lostBack = fields.filter((f) => r[f] !== undefined && !(b && b[f] !== undefined));
        return { t: r.t, key: r.key, sample: fields.filter((f) => r[f]).map((f) => `${f}=${r[f]}`), lostToCells: lost, lostBackJson: lostBack };
      });
      return { detail: detail.slice(0, 14), nDev: rows.length, nCells: cells.cells.length, nBack: Object.keys(flatBack).length };
    }, { srcs: ['multiplier.v', 'adder.v', 'full_adder.v'].map((f) => ({ name: f, content: rd(f) })) });

    console.log('器件数=', out.nDev, ' cells 数=', out.nCells, ' 往返后 device 数=', out.nBack);
    for (const d of out.detail) {
      console.log(`\n ${d.t} #${d.key}`);
      console.log('   原值 :', d.sample.join('  ') || '(无这些字段)');
      console.log('   →cells 丢:', d.lostToCells.join(',') || '(无)', '  →JSON 丢:', d.lostBackJson.join(',') || '(无)');
    }
    console.log('\npageErrors=', perr.length, perr.slice(0, 5));
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 400));
  } finally {
    try { server && server.kill(); } catch { }
    try { browser && await browser.close(); } catch { }
    process.exit(0);
  }
})();
