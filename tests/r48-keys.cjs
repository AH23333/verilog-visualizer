// R48 只读探针（打读数）：编译产物里**实际存在**的器件字段，与本项目白名单对账。
// 白名单之外的字段在「复制到沙盒」（circuitJsonToCells）与「沙盒 → 展开/导出/存部件」
// （cellsToCircuitJson）两条转换里都会被**静默丢掉**。
// 判据用真实设计：r48_exotic（算术/比较/归约/移位/case 多路/存储器/带初值触发器）
// + multiplier/alu_core/fsm_controller（多层总线）。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1582; const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
const freePort = (p) => {
  try {
    require('child_process').execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' });
  } catch { }
};

// 多层设计要整组一起编（单文件编会 Missing module），判据用真实规模：
// multiplier→adder→full_adder、alu_top→alu_core→adder、r48_exotic（算术/多路/触发器/存储器）。
const GROUPS = [
  { top: 'r48_exotic', files: ['r48_exotic.v'] },
  { top: 'multiplier', files: ['multiplier.v', 'adder.v', 'full_adder.v'] },
  { top: 'alu_top', files: ['alu_top.v', 'alu_core.v', 'adder.v', 'full_adder.v'] },
  { top: 'test_top', files: ['test_top.v', 'test_submod.v'] },
];

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

    const rows = [];
    for (const g of GROUPS) {
      const srcs = g.files.map((f) => ({ name: f, content: rd(f) }));
      const r = await page.evaluate(async (a) => {
        const { compileVerilog } = await import('/src/lib/verilog.ts');
        const sv = await import('/src/lib/subcircuitView.ts');
        let res;
        try { res = await compileVerilog(a.srcs, a.top); }
        catch (e) { return { file: a.top, err: String(e && e.message || e).slice(0, 120) }; }
        const json = res.circuitJson;

        // 逐模块收集：类型 → 字段并集（id/type/position 每颗都有，不参与对账）
        const byType = {};
        const connKeys = new Set();
        const allKeys = new Set();
        let devs = 0, wires = 0;
        const walk = (mod, name) => {
          for (const [k, d0] of Object.entries(mod.devices || {})) {
            const d = d0 || {}; devs++;
            const t = String(d.type || '?');
            byType[t] = byType[t] || new Set();
            for (const key of Object.keys(d)) if (!['id', 'type', 'position'].includes(key)) {
              byType[t].add(key); allKeys.add(key);
            }
          }
          for (const c of mod.connectors || []) { wires++; for (const key of Object.keys(c || {})) connKeys.add(key); }
          for (const [sn, sm] of Object.entries(mod.subcircuits || {})) walk(sm, sn);
        };
        walk(json, 'TOP');

        // 真跑一遍往返：编译 JSON → cells → 编译 JSON，逐类型比字段
        const cells = sv.circuitJsonToCells(json);
        const back = sv.cellsToCircuitJson(cells);
        const lostByType = {};
        const cmp = (mod, rb, name) => {
          for (const [k, d0] of Object.entries(mod.devices || {})) {
            const d = d0 || {}; const t = String(d.type || '?');
            const r1 = (rb.devices || {})[k] || (rb.devices || {})[d.id] || {};
            const lost = Object.keys(d).filter((key) => !['id', 'type', 'position'].includes(key) && r1[key] === undefined);
            if (lost.length) (lostByType[t] = lostByType[t] || new Set()).add(...lost);
          }
          for (const [sn, sm] of Object.entries(mod.subcircuits || {})) cmp(sm, (rb.subcircuits || {})[sn] || {}, sn);
        };
        cmp(json, back, 'TOP');

        const ser = (o, set) => Array.from(set.values ? set.values() : set);
        return {
          file: a.top,
          types: Object.keys(byType).map((t) => `${t}[${ser(0, byType[t]).join('|')}]`).sort().join('  '),
          allKeys: Array.from(allKeys).sort(),
          connKeys: Array.from(connKeys).join(','),
          devs, wires,
          lost: Object.keys(lostByType).map((t) => `${t}→${Array.from(lostByType[t]).join(',')}`).sort().join('  '),
        };
      }, { top: g.top, srcs });
      rows.push(r);
    }

    // 本项目两个方向的白名单：对账后不在名单里的编译字段＝复制/展开时被静默丢掉
    const WL = new Set(['id', 'type', 'celltype', 'label', 'order', 'bits', 'net', 'position', 'size',
      'propagation', 'constant', 'polarity', 'initial', 'groups', 'slice', 'abits', 'rdports',
      'wrports', 'angle', 'isLink', 'source', 'target', 'netname', 'vertices', 'subcircuitGraph']);
    const outside = new Set();
    for (const r of rows) for (const k of r.allKeys || []) if (!WL.has(k)) outside.add(k);

    for (const r of rows) {
      if (r.err) { console.log(`\n### ${r.file}: 编译失败 ${r.err}`); continue; }
      console.log(`\n### ${r.file}  器件=${r.devs} 线=${r.wires}  连线字段=[${r.connKeys}]`);
      console.log('  类型字段：', r.types);
      console.log('  往返丢失：', r.lost || '(无)');
    }
    console.log('\n== 编译产物里出现、但不在两个方向白名单里的器件字段（＝复制/展开时静默丢） ==');
    console.log('  ', Array.from(outside).sort().join(', ') || '(无)');
    console.log('\npageErrors=', perr.length, perr.slice(0, 5));
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 400));
  } finally {
    try { server && server.kill(); } catch { }
    try { browser && await browser.close(); } catch { }
    process.exit(0);
  }
})();
