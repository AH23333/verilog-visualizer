// R49c 只读探针：搞清楚「怎么把输入打进这座桥」——r49b 里 setv 全部返回 false，
// 所有数据 net 一直是 x，于是 R49 比的是两串 x（假通过）。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1589; const URL = `http://localhost:${PORT}/`;
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
      const R = { phases: [] };

      const ioCells = () => paper.model.getElements().filter((e) => ['Button', 'NumEntry', 'Input', 'Clock'].includes(String(e.get('type'))));
      const probeCell = (el) => ({
        type: String(el.get('type')),
        bits: Number(el.get('bits')) || 1,
        propOut: !!(el.outputSignals && el.outputSignals.out),
        attrOut: !!(el.get('outputSignals') && el.get('outputSignals').out),
        keys: Object.keys(el.attributes || {}).filter((k) => /signal|value|on|mode/i.test(k)).join(','),
        val: (() => { const o = (el.outputSignals || el.get('outputSignals') || {}).out; return o ? String(o).replace(/^Vector3vl\s+/, '') : null; })(),
      });
      R.beforeStart = ioCells().map(probeCell);

      // 先让引擎跑一会，再看信号挂在哪
      try { circuit.start(); } catch (e) { R.startErr = String(e.message).slice(0, 60); }
      await new Promise((r) => setTimeout(r, 300));
      R.afterStart = ioCells().map(probeCell);

      const readNets = () => {
        const seen = new Set(); const v = {};
        for (const lk of paper.model.getLinks()) {
          const net = String(lk.get('netname') || ''); if (!net || seen.has(net)) continue; seen.add(net);
          const sig = lk.get('signal');
          v[net] = sig != null ? String(sig).replace(/^Vector3vl\s+/, '') : 'x';
        }
        return v;
      };
      const nonX = () => { const v = readNets(); return Object.entries(v).filter(([, s]) => !/^x+$/.test(s)).map(([k, s]) => `${k}=${s}`).join(','); };
      R.phases.push(['start 后', nonX()]);

      // 用 Vector3vl 构造器（从现有实例取）写确定值 —— 与 MemoryViewModal 同法
      const anyVec = (() => { for (const c of paper.model.getCells()) { const o = (c.outputSignals || (c.get && c.get('outputSignals')) || {}).out; if (o) return o; } return null; })();
      R.vecCtor = anyVec ? anyVec.constructor.name : 'none';
      const Ctor = anyVec && anyVec.constructor;
      const setInput = (el, binStr) => {
        try {
          const bits = Number(el.get('bits')) || 1;
          const vec = Ctor.fromBin ? Ctor.fromBin(binStr.padStart(bits, '0').slice(-bits), bits) : Ctor.zeros(bits);
          el.set('outputSignals', { ...(el.get('outputSignals') || {}), out: vec });
          try { el.trigger('change:outputSignals', el, { outputSignals: { out: vec } }, {}); } catch { }
          return true;
        } catch (e) { return 'ERR:' + String(e.message).slice(0, 50); }
      };
      const cells = ioCells();
      R.setResults = cells.map((c) => `${c.get('type')}:${setInput(c, '11111111')}`);
      try { circuit.updateGates(); } catch { }
      try { circuit._engine.updateGates(); } catch { }
      await new Promise((r) => setTimeout(r, 300));
      R.phases.push(['写入全1 + updateGates', nonX()]);
      R.netsNow = readNets();
      host.remove();
      return R;
    }, { srcs: ['r48_sync.v'].map((f) => ({ name: f, content: rd(f) })) });

    console.log('start 前 IO：', JSON.stringify(out.beforeStart));
    console.log('start 后 IO：', JSON.stringify(out.afterStart), out.startErr || '');
    console.log('向量构造器:', out.vecCtor, ' 写入结果:', out.setResults.join(' '));
    for (const [t, v] of out.phases) console.log(`  ${t.padEnd(24)} 非x的 net: ${v || '(全是 x)'}`);
    console.log('全部 net 读数:', JSON.stringify(out.netsNow));
    console.log('pageErrors=', perr.length, perr.slice(0, 3));
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 300));
  } finally {
    try { server && server.kill(); } catch { }
    try { browser && await browser.close(); } catch { }
    process.exit(0);
  }
})();
