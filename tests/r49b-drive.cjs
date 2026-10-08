// R49b 只读探针：把「到底怎么推才有值」测出来（不作判定）。
// R49 那颗闸门在变异台架下没红 —— 怀疑两侧逐拍读数全是 x，比了个空。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1588; const URL = `http://localhost:${PORT}/`;
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
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    const out = await page.evaluate(async (a) => {
      const djs = window.digitaljs;
      const sv = await import('/src/lib/subcircuitView.ts');
      const { compileVerilog } = await import('/src/lib/verilog.ts');
      const json = (await compileVerilog(a.srcs, 'r48_sync')).circuitJson;
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9000px;top:0;width:1600px;height:1200px';
      document.body.appendChild(host);
      const h = sv.renderCircuitView(djs, host, structuredClone(json), { autoLayout: false });
      const circuit = h.circuit, paper = h.paper;

      const api = {
        view: ['tick', 'stop', 'run', 'updateGatesNext', 'updateGates', 'start'].map((k) => `${k}:${typeof circuit[k]}`),
        engine: circuit._engine ? ['_tick', 'updateGatesNext', 'updateGates', 'start', 'stop', 'running', '_pq'].map((k) => `${k}:${typeof circuit._engine[k]}`).concat(`running=${circuit._engine.running}`) : 'no _engine',
      };

      const readNets = () => {
        const seen = new Set(); const vals = {};
        for (const lk of paper.model.getLinks()) {
          const net = String(lk.get('netname') || ''); if (!net || seen.has(net)) continue; seen.add(net);
          const sig = lk.get('signal');
          vals[net] = sig != null ? String(sig).replace(/^Vector3vl\s+/, '') : 'x';
        }
        return vals;
      };
      const stat = (v) => { const n = Object.keys(v); return { total: n.length, x: n.filter((k) => /^x+$/.test(v[k])).length, sample: n.slice(0, 6).map((k) => `${k}=${v[k]}`).join(',') }; };

      const R = { api, steps: [] };
      R.steps.push(['刚建好', stat(readNets())]);

      const ins = paper.model.getElements().filter((e) => ['Button', 'NumEntry', 'Input'].includes(String(e.get('type'))));
      const clks = paper.model.getElements().filter((e) => e.get('type') === 'Clock');
      const setv = (el, one) => { try { const s = el.outputSignals && el.outputSignals.out; if (!s || !s._bvec) return false; s._bvec[0] = one ? 1 : 0; s._avec = one ? { 0: 1 } : {}; return true; } catch { return false; } };

      // 配方 1：view 上的 updateGatesNext（Canvas.stepOnce 用的就是它）
      for (let i = 0; i < 6; i++) { try { circuit.updateGatesNext(); } catch (e) { R.viewErr = String(e.message).slice(0, 60); break; } }
      R.steps.push(['view.updateGatesNext ×6', stat(readNets())]);

      // 配方 2：engine 上的 updateGatesNext
      for (let i = 0; i < 6; i++) { try { circuit._engine.updateGatesNext(); } catch (e) { R.engErr = String(e.message).slice(0, 60); break; } }
      R.steps.push(['engine.updateGatesNext ×6', stat(readNets())]);

      // 配方 3：驱动输入=1 再推
      const drove = ins.map((e) => setv(e, 1));
      for (let i = 0; i < 20; i++) { try { circuit._engine.updateGatesNext(); } catch { } }
      R.steps.push(['输入置1 + engine×20', stat(readNets())]);
      R.nIn = ins.length; R.nClk = clks.length; R.drove = drove.join(',');

      // 配方 4：让引擎自己跑 400ms（时钟自动翻）
      try { circuit.run && circuit.run(); } catch { }
      try { circuit._engine.start && circuit._engine.start(); } catch { }
      await new Promise((r) => setTimeout(r, 400));
      R.steps.push(['引擎自跑 400ms', stat(readNets())]);
      R.tickAfter = { view: circuit.tick, eng: circuit._engine._tick, running: circuit._engine.running };

      // 时钟沿能不能把 q 打进去：手动一拍低一拍高，读 Dff 输出
      const qNet = Object.keys(readNets()).find((k) => /q|state/.test(k)) || null;
      const seq = [];
      for (let k = 0; k < 4; k++) {
        for (const c of clks) setv(c, 0);
        try { circuit._engine.updateGatesNext(); } catch { }
        for (const c of clks) setv(c, 1);
        try { circuit._engine.updateGatesNext(); } catch { }
        const v = readNets();
        seq.push(`${qNet}=${v[qNet]}`);
      }
      R.qTrace = seq.join(' → ');
      host.remove();
      return R;
    }, { srcs: ['r48_sync.v'].map((f) => ({ name: f, content: rd(f) })) });

    console.log('API view:', out.api.view.join(' '));
    console.log('API engine:', out.api.engine.join(' '));
    console.log('nIn=', out.nIn, 'nClk=', out.nClk, 'drove=', out.drove, out.viewErr || '', out.engErr || '');
    for (const [tag, s] of out.steps) console.log(`  ${tag.padEnd(26)} 线=${s.total} x态=${s.x}  样例: ${s.sample}`);
    console.log('tickAfter=', JSON.stringify(out.tickAfter));
    console.log('qTrace=', out.qTrace);
    console.log('pageErrors=', perr.length, perr.slice(0, 3));
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 300));
  } finally {
    try { server && server.kill(); } catch { }
    try { browser && await browser.close(); } catch { }
    process.exit(0);
  }
})();
