// R41g：真实规模设计（alu_core -> {adder -> full_adder, multiplier -> adder}）
//  测 collectToFolder 出来的每个部件文件：是否堆叠（无 position）、是否缺线、端口形态
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1507; const URL = `http://localhost:${PORT}/`;
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
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      let cj;
      try { cj = (await compileVerilog(codes, 'alu_core')).circuitJson; }
      catch (e) { return { compiled: false, err: String(e && e.message || e).slice(0, 200) }; }
      const topDevs = Object.values(cj.devices || {}).length;
      let bound = 0;
      try { bound = gs.collectToFolder(cj, 'ALU'); } catch (e) { return { compiled: true, collectThrew: String(e && e.message || e).slice(0, 200) }; }
      const files = sandboxStore.list().filter((f) => f.name.startsWith('ALU/'));
      const report = files.map((f) => {
        let cells = []; try { cells = JSON.parse(f.graphJson || '{}').cells || []; } catch { }
        const isWire = (c) => c.isLink || (c.source && c.target && c.source.id && c.target.id);
        const nodes = cells.filter((c) => !isWire(c));
        const links = cells.filter(isWire);
        const noPos = nodes.filter((c) => !c.position).length;
        const atOrigin = nodes.filter((c) => c.position && !c.position.x && !c.position.y).length;
        const xs = new Set(nodes.map((c) => Math.round(c.position ? c.position.x : -1)));
        const ys = new Set(nodes.map((c) => Math.round(c.position ? c.position.y : -1)));
        const seen = new Map(); let stacked = 0;
        for (const n of nodes) { const k = `${Math.round(n.position ? n.position.x : -1)},${Math.round(n.position ? n.position.y : -1)}`; seen.set(k, (seen.get(k) || 0) + 1); if (seen.get(k) > 1) stacked++; }
        const typeCount = nodes.reduce((a, t) => (a[t.type] = (a[t.type] || 0) + 1, a), {});
        return { f: f.name.split('/').pop(), nodes: nodes.length, links: links.length, noPos, atOrigin, distinctX: xs.size, distinctY: ys.size, stacked, typeCount };
      });
      return { compiled: true, topDevs, bound, report };
    }, ['alu_core.v', 'adder.v', 'full_adder.v', 'multiplier.v'].map((f) => ({ name: f, content: rd(f) })));
    console.log(JSON.stringify(out, null, 1));
  } catch (e) { console.log('FATAL', e); } finally { try { await b && b.close(); } catch { } try { s && s.kill(); } catch { } process.exit(0); }
})();
