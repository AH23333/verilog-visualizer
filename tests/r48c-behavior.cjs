// R48c 只读探针：把「字段丢了到底有没有后果」测成结构读数。
//  A. ZeroExtend 的 extend（{input,output} 位宽）丢了以后端口/位宽怎么变；
//  B. Dff 的 arst_value 丢了以后数字基/端口/内部状态怎么变；
//  C. hide_label 丢了以后画面上会不会多出标签文字。
// 另外顺手打印 digitaljs Circuit 的可用 API，供后面「仿真语义对齐」探针用。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1584; const URL = `http://localhost:${PORT}/`;
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
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    const warns = []; page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text().slice(0, 120)); });
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    const out = await page.evaluate(async () => {
      const djs = window.digitaljs;
      const sv = await import('/src/lib/subcircuitView.ts');
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9000px;top:0;width:900px;height:700px';
      document.body.appendChild(host);

      const build = (json) => {
        const h = sv.renderCircuitView(djs, host, structuredClone(json), { autoLayout: false });
        return h;
      };
      const portsOf = (h, id) => {
        const c = h && h.paper && h.paper.model.getCell(id);
        if (!c) return null;
        const items = (c.get('ports').items || []);
        return { n: items.length, ids: items.map((p) => p.id).join(','), bits: c.get('bits'), size: JSON.stringify(c.get('size')) };
      };
      const labelCount = (h) => {
        if (!h) return -1;
        const svg = h.paper.svg;
        const texts = Array.from(svg.querySelectorAll('text'));
        return texts.filter((t) => (t.textContent || '').trim().length).map((t) => (t.textContent || '').trim()).slice(0, 12).join('|');
      };

      const R = {};
      // ---- A: ZeroExtend with / without extend ----
      const ze = (extend) => ({
        devices: {
          c1: { id: 'c1', type: 'Constant', bits: 2, constant: 3, position: { x: 40, y: 60 } },
          z1: { id: 'z1', type: 'ZeroExtend', position: { x: 180, y: 60 }, ...(extend ? { extend } : {}) },
          o1: { id: 'o1', type: 'Output', bits: 5, net: 'y', position: { x: 340, y: 60 } },
        },
        connectors: [
          { from: { id: 'c1', port: 'out' }, to: { id: 'z1', port: 'in' }, name: 'n1' },
          { from: { id: 'z1', port: 'out' }, to: { id: 'o1', port: 'in' }, name: 'n2' },
        ],
        subcircuits: {},
      });
      const withExt = build(ze({ input: 2, output: 5 }));
      const noExt = build(ze(null));
      R.A = {
        withExt: portsOf(withExt, 'z1'), noExt: portsOf(noExt, 'z1'),
        skippedWith: withExt && withExt.skippedWires, skippedNo: noExt && noExt.skippedWires,
        outValWith: labelCount(withExt), outValNo: labelCount(noExt),
      };

      // ---- B: Dff with / without arst_value ----
      const dff = (arst) => ({
        devices: {
          d0: { id: 'd0', type: 'Constant', bits: 8, constant: 90, position: { x: 40, y: 60 } },
          f: { id: 'f', type: 'Dff', bits: 8, polarity: { clock: 'positive', arst: 'positive', set: 'positive' }, ...(arst !== undefined ? { arst_value: arst } : {}), position: { x: 180, y: 60 } },
          o: { id: 'o', type: 'Output', bits: 8, net: 'q', position: { x: 340, y: 60 } },
        },
        connectors: [
          { from: { id: 'd0', port: 'out' }, to: { id: 'f', port: 'd' }, name: 'n1' },
          { from: { id: 'f', port: 'q' }, to: { id: 'o', port: 'in' }, name: 'n2' },
        ],
        subcircuits: {},
      });
      const hArst = build(dff(255));
      const hNo = build(dff(undefined));
      const cellInfo = (h) => {
        const c = h && h.paper && h.paper.model.getCell('f');
        if (!c) return null;
        return {
          ports: (c.get('ports').items || []).map((p) => p.id).join(','),
          arst_value: c.get('arst_value'), initial: c.get('initial'), bits: c.get('bits'),
          keys: Object.keys(c.attributes || {}).filter((k) => /arst|init|value/i.test(k)).join(','),
        };
      };
      R.B = { withArst: cellInfo(hArst), noArst: cellInfo(hNo) };

      // ---- C: hide_label ----
      const hl = (hide) => ({
        devices: {
          i: { id: 'i', type: 'Input', bits: 1, net: 'a', position: { x: 40, y: 60 } },
          g: { id: 'g', type: 'And', bits: 1, label: 'dev3', ...(hide ? { hide_label: true } : {}), position: { x: 160, y: 60 } },
          o: { id: 'o', type: 'Output', bits: 1, net: 'y', position: { x: 320, y: 60 } },
        },
        connectors: [
          { from: { id: 'i', port: 'out' }, to: { id: 'g', port: 'in1' }, name: 'w1' },
          { from: { id: 'g', port: 'out' }, to: { id: 'o', port: 'in' }, name: 'w2' },
        ],
        subcircuits: {},
      });
      const hHide = build(hl(true)); const hShow = build(hl(false));
      R.C = { withHide: labelCount(hHide), noHide: labelCount(hShow) };

      // ---- Circuit API 面 ----
      const one = build({ devices: { i: { id: 'i', type: 'Input', bits: 1, net: 'a', position: { x: 40, y: 40 } } }, connectors: [], subcircuits: {} });
      R.api = one && one.circuit ? Object.keys(one.circuit).concat(['|proto:' + Object.getOwnPropertyNames(Object.getPrototypeOf(one.circuit) || {}).join(','),
        '|inner:' + (one.circuit.circuit ? Object.keys(one.circuit.circuit).join(',') : 'none')]) : [];
      host.remove();
      return R;
    });

    console.log('A ZeroExtend extend 有/无：', JSON.stringify(out.A, null, 1));
    console.log('B Dff arst_value 有/无：', JSON.stringify(out.B, null, 1));
    console.log('C hide_label 有/无（画面文字）：', JSON.stringify(out.C, null, 1));
    console.log('API:', JSON.stringify(out.api));
    console.log('pageErrors=', perr.length, perr.slice(0, 3));
    console.log('console warn/err=', warns.length, warns.slice(0, 6));
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 400));
  } finally {
    try { server && server.kill(); } catch { }
    try { browser && await browser.close(); } catch { }
    process.exit(0);
  }
})();
