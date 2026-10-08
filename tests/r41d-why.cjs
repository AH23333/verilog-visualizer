// R41d：精确指出「哪几条连线还原不了、端点是什么器件」
//  路径：编译 multiplier/adder/full_adder → collectToFolder → 读部件文件 cells
//        → cellsToCircuitJson → 用 buildInnerGraph 建活内图 → 逐条连线做端口存在性检查
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1504; const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8').replace(/^/, '');

(async () => {
  let s, b;
  try {
    s = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const d = Date.now() + 30000; while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(400); }
    b = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await b.newPage();
    page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);

    const out = await page.evaluate(async (codes) => {
      const { compileVerilog } = await import('/src/lib/verilog.ts');
      const gs = await import('/src/lib/gateSystem.ts');
      const sv = await import('/src/lib/subcircuitView.ts');
      const sc = await import('/src/lib/subcircuit.ts');
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      const cj = (await compileVerilog(codes.files, 'multiplier')).circuitJson;
      gs.collectToFolder(cj, 'R41D');
      const res = {};
      for (const part of ['adder', 'full_adder']) {
        const cells = gs.resolveDefCells(part, 'R41D');
        const nodes = cells.cells.filter((c) => !c.isLink && !(c.source && c.target));
        const links = cells.cells.filter((c) => c.isLink || (c.source && c.target));
        const circuit = sv.cellsToCircuitJson(cells);
        // 活内图：端口从内层 Input/Output 生成（digitaljs Subcircuit.initialize 语义）
        const djs = window.digitaljs;
        const Graph = new djs.Circuit({ devices: {}, connectors: [] })._graph.constructor;
        const inner = sc.buildInnerGraph(djs, Graph, cells, null);
        const portOf = new Map();
        for (const el of inner.getElements()) {
          const ps = typeof el.getPorts === 'function' ? el.getPorts().map((p) => p.id || p) : [];
          portOf.set(String(el.id), ps.map(String));
        }
        const bad = [];
        for (const l of links) {
          const sp = portOf.get(String(l.source.id));
          const tp = portOf.get(String(l.target.id));
          const okS = sp && sp.includes(String(l.source.port));
          const okT = tp && tp.includes(String(l.target.port));
          if (!okS || !okT) {
            const dev = (id) => nodes.find((n) => String(n.id) === String(id)) || {};
            bad.push({
              src: `${l.source.id}(${dev(l.source.id).type}:${dev(l.source.id).net || dev(l.source.id).label || ''}).${l.source.port} ${okS ? 'ok' : 'MISS'}`,
              tgt: `${l.target.id}(${dev(l.target.id).type}:${dev(l.target.id).net || dev(l.target.id).label || ''}).${l.target.port} ${okT ? 'ok' : 'MISS'}`,
            });
          }
        }
        res[part] = {
          nodeTypes: nodes.map((n) => `${n.type}:${n.net || n.label || n.celltype || ''}`).join(' '),
          circuitDevices: Object.keys(circuit.devices).length,
          circuitConns: circuit.connectors.length,
          innerElements: inner.getElements().length,
          innerLinks: inner.getLinks().length,
          badCount: bad.length, bad: bad.slice(0, 8),
        };
      }
      return res;
    }, {
      files: ['multiplier.v', 'adder.v', 'full_adder.v'].map((f) => ({ name: f, content: rd(f) })),
    });
    console.log(JSON.stringify(out, null, 1));
  } catch (e) { console.log('FATAL', e); } finally { try { await b && b.close(); } catch { } try { s && s.kill(); } catch { } process.exit(0); }
})();
