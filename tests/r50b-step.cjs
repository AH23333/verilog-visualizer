// R50b 只读探针：digitaljs 的 Vector3vl 里「0 / 1 / x」到底怎么编码，
// 以及 Canvas.stepOnce 那套 `sig._bvec[0]=…; sig._avec={…}` 的手写编码
// 造出来的是不是「0」——如果不是，时序电路的单步就永远等不到上升沿。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1591; const URL = `http://localhost:${PORT}/`;
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
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    const out = await page.evaluate(async (a) => {
      const djs = window.digitaljs;
      const sv = await import('/src/lib/subcircuitView.ts');
      const { compileVerilog } = await import('/src/lib/verilog.ts');
      const json = (await compileVerilog(a.srcs, 'r50_counter')).circuitJson;
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9000px;top:0;width:900px;height:700px';
      document.body.appendChild(host);
      const h = sv.renderCircuitView(djs, host, structuredClone(json), { autoLayout: false });
      const circuit = h.circuit, paper = h.paper;
      try { circuit.stop(); } catch { }

      const netOf = (name) => {
        for (const lk of paper.model.getLinks()) if (String(lk.get('netname')) === name) return lk;
        return null;
      };
      const vecOf = (name) => { const lk = netOf(name); return lk ? lk.get('signal') : null; };
      const dump = (v) => { if (!v) return 'null'; let s; try { s = String(v); } catch { s = 'THROW'; } return `${s}  bvec=${JSON.stringify(v._bvec)} avec=${JSON.stringify(v._avec)}`; };
      const clkCell = paper.model.getElements().find((e) => String(e.get('type')) === 'Clock');
      const rstCell = paper.model.getElements().find((e) => String(e.get('net')) === 'rst');
      const C = (clkCell.get('outputSignals').out || Object.values(clkCell.get('outputSignals'))[0]).constructor;

      const R = { ctorName: C.name, encodings: {}, trace: [] };
      // 用官方构造器造三种已知值，看内部编码
      R.encodings.fromBin0 = dump(C.fromBin('0', 1));
      R.encodings.fromBin1 = dump(C.fromBin('1', 1));
      R.encodings.zeros = dump(C.zeros(1));
      R.encodings.handZero = (() => { const v = C.fromBin('1', 1); v._bvec[0] = 0; v._avec = {}; return dump(v); })();
      R.encodings.handOne = (() => { const v = C.fromBin('0', 1); v._bvec[0] = 1; v._avec = { 0: 1 }; return dump(v); })();

      // 照 Canvas.stepOnce 的写法拨时钟，看 q 走不走
      const poke = (el, one) => {
        const o = el.get('outputSignals') || {}; const sig = o.out || Object.values(o)[0];
        if (!sig || !sig._bvec) return false;
        sig._bvec[0] = one ? 1 : 0; sig._avec = one ? { 0: 1 } : {};
        return true;
      };
      const settle = (n) => { for (let i = 0; i < n; i++) { try { circuit._engine.updateGatesNext(); } catch { } } };
      R.trace.push(['起始', `clk=${dump(vecOf('clk'))} q=${dump(vecOf('q'))} d=${dump(vecOf('d'))}`]);
      for (let k = 0; k < 3; k++) {
        poke(clkCell, 0); settle(10);
        R.trace.push([`第${k + 1}轮 拉低后`, `clk=${dump(vecOf('clk'))} q=${dump(vecOf('q'))}`]);
        poke(clkCell, 1); settle(10);
        R.trace.push([`第${k + 1}轮 拉高后`, `clk=${dump(vecOf('clk'))} q=${dump(vecOf('q'))}`]);
      }
      // 换成官方 fromBin 写法再试
      const setv = (el, bin) => {
        const bits = Number(el.get('bits')) || 1;
        const o = el.get('outputSignals') || {}; const cur = o.out || Object.values(o)[0];
        if (!cur || !cur.constructor) return false;
        const vec = cur.constructor.fromBin(String(bin).padStart(bits, '0').slice(-bits), bits);
        el.set('outputSignals', { ...o, out: vec });
        try { el.trigger('change:outputSignals', el, { outputSignals: { ...o, out: vec } }, {}); } catch { }
        return true;
      };
      R.trace.push(['改用 fromBin', '']);
      for (let k = 0; k < 3; k++) {
        setv(clkCell, '0'); settle(10);
        setv(clkCell, '1'); settle(10);
        R.trace.push([`fromBin 第${k + 1}轮`, `clk=${dump(vecOf('clk'))} q=${dump(vecOf('q'))}`]);
      }
      // q 的下一拍是 q+1 = x，只能靠复位把它拉出 x：先 rst=1 走沿，再放开走沿
      R.trace.push(['rst=1 + 两个沿', '']);
      setv(rstCell, '1');
      setv(clkCell, '0'); settle(12);
      setv(clkCell, '1'); settle(12);
      R.trace.push(['  沿1 后', `rst=${dump(vecOf('rst'))} clk=${dump(vecOf('clk'))} q=${dump(vecOf('q'))}`]);
      setv(clkCell, '0'); settle(12);
      setv(clkCell, '1'); settle(12);
      R.trace.push(['  沿2 后', `q=${dump(vecOf('q'))}`]);
      R.trace.push(['rst=0 + 三个沿', '']);
      setv(rstCell, '0');
      for (let k = 0; k < 3; k++) {
        setv(clkCell, '0'); settle(12);
        setv(clkCell, '1'); settle(12);
        R.trace.push([`  沿${k + 3} 后`, `q=${dump(vecOf('q'))}`]);
      }
      host.remove();
      return R;
    }, { srcs: ['r50_counter.v'].map((f) => ({ name: f, content: rd(f) })) });

    console.log('ctor=', out.ctorName);
    for (const [k, v] of Object.entries(out.encodings)) console.log(`  ${k.padEnd(10)} ${v}`);
    for (const [t, v] of out.trace) console.log(`  ${t.padEnd(16)} ${v}`);
    console.log('pageErrors=', perr.length, perr.slice(0, 3));
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 300));
  } finally {
    try { server && server.kill(); } catch { }
    try { browser && await browser.close(); } catch { }
    process.exit(0);
  }
})();
