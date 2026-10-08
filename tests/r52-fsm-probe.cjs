// R52 只读探针（打现场读数，不作判定）：digitaljs 的 **FSM 器件**在这份打包好的
// public/digitaljs.js 里到底能不能用 —— 不做任何 src 改动，直接在沙盒的 paper 上手搓一颗：
//  [1] cells.FSM 是否存在、能否构造（states/init_state/trans_table/polarity/bits）
//  [2] 端口是不是 in / clk / arst / out，尺寸与体渲染
//  [3] 接上 Clock + Lamp 跑引擎：current_state 会不会按 trans_table 走、out 会不会出值
//  [4] 点器件上的 🔍（a.zoom）→ digitaljs 的 open:fsm 弹窗会不会抛错
//      （FSMView._displayEditor 依赖 @joint/layout-directed-graph 的 DirectedGraph.layout，
//       bundle 里搜不到这个标识符 —— 这一格就是来量它到底存不存在的）
//  [5] 现有序列化（serializePaperCells）会丢掉哪些 FSM 字段
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1631; const URL = `http://localhost:${PORT}/`;
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
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务未起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 220)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 20000 });
    await sleep(800);

    const r = await page.evaluate(async () => {
      const djs = window.digitaljs, paper = window.__sandboxPaper, circuit = window.__sandboxCircuit;
      const out = { hasFSM: !!(djs && djs.cells && djs.cells.FSM), steps: {}, errs: [] };
      if (!out.hasFSM) return out;

      const tt = [
        { state_in: 0, ctrl_in: '1', state_out: 1, ctrl_out: '0' },
        { state_in: 1, ctrl_in: '0', state_out: 2, ctrl_out: '1' },
        { state_in: 1, ctrl_in: '1', state_out: 3, ctrl_out: '0' },
        { state_in: 2, ctrl_in: 'x', state_out: 0, ctrl_out: '1' },
        { state_in: 3, ctrl_in: 'x', state_out: 0, ctrl_out: '0' },
      ];
      // [1] 构造
      let fsm = null;
      try {
        fsm = new djs.cells.FSM({
          position: { x: 200, y: 200 }, label: 'FSM1',
          bits: { in: 1, out: 1 }, polarity: { clock: 1, arst: 1 },
          states: 4, init_state: 0, trans_table: tt,
        });
        paper.model.addCell(fsm);
        out.steps.construct = { id: fsm.id, size: fsm.size(), type: fsm.get('type') };
      } catch (e) { out.errs.push('construct: ' + e.message); return out; }

      // [2] 端口
      try {
        out.steps.ports = (fsm.getPorts() || []).map((p) => ({ id: p.id, dir: p.dir, bits: p.bits }));
      } catch (e) { out.errs.push('ports: ' + e.message); }

      // [3] 接线跑引擎：Clock -> clk, Button -> in, FSM.out -> Lamp
      try {
        const clk = new djs.cells.Clock({ position: { x: 60, y: 200 } });
        const btn = new djs.cells.Button({ position: { x: 60, y: 260 }, bits: 1 });
        const lamp = new djs.cells.Lamp({ position: { x: 400, y: 200 } });
        paper.model.addCell(clk); paper.model.addCell(btn); paper.model.addCell(lamp);
        const w = (a, ap, b, bp) => new djs.cells.Wire({ source: { cell: a.id, port: ap }, target: { cell: b.id, port: bp }, bits: 1 });
        paper.model.addCell(w(clk, 'out', fsm, 'clk'));
        paper.model.addCell(w(btn, 'out', fsm, 'in'));
        paper.model.addCell(w(fsm, 'out', lamp, 'in'));
        out.steps.wired = paper.model.getLinks().length;

        try { circuit.stop(); } catch { }
        const states = [], outs = [];
        const sigOf = (el) => { const o = (el.get && el.get('outputSignals')) || {}; return o.out || Object.values(o)[0]; };
        const setBtn = (v) => { try { const C = sigOf(btn).constructor; const o = btn.get('outputSignals') || {}; btn.set('outputSignals', { ...o, out: C.fromBin(v, 1) }); } catch { } };
        const setClk = (v) => { try { const C = sigOf(clk).constructor; const o = clk.get('outputSignals') || {}; clk.set('outputSignals', { ...o, out: C.fromBin(v, 1) }); } catch { } };
        const settle = (n) => { for (let i = 0; i < n; i++) { try { circuit._engine.updateGatesNext(); } catch { } } };
        setBtn('0');
        for (let k = 0; k < 6; k++) {
          setClk('0'); settle(12); setClk('1'); settle(12);
          states.push(String(fsm.get('current_state')));
          const o = fsm.get('outputSignals'); const ov = o && o.out;
          outs.push(ov ? String(ov).replace(/^Vector3vl\s+/, '') : 'x');
          setBtn(k % 2 ? '1' : '0');
        }
        out.steps.tick = { states, outs, engineKeys: Object.keys(circuit._engine || {}).slice(0, 8) };
      } catch (e) { out.errs.push('sim: ' + e.message); }

      // [4] 点 🔍 触发 open:fsm
      try {
        const view = paper.findViewByModel(fsm);
        const zoomEl = view && view.$el ? view.$('a.zoom') : null;
        out.steps.zoomAnchor = zoomEl ? Number(zoomEl.length) : -1;
        const before = document.querySelectorAll('body > div[title]').length;
        let evtErr = null;
        try { if (zoomEl && zoomEl.length) zoomEl[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); }
        catch (e) { evtErr = e.message; }
        await new Promise((r2) => setTimeout(r2, 900));
        const after = document.querySelectorAll('body > div[title]').length;
        out.steps.openFsm = { before, after, grew: after > before, evtErr };
      } catch (e) { out.errs.push('openFsm: ' + e.message); }

      // [5] 序列化会不会丢 FSM 字段
      try {
        const ss = await import('/src/lib/sandboxSerialize.ts');
        const snap = ss.serializePaperCells(paper);
        const f = snap.cells.find((c) => c.type === 'FSM');
        out.steps.serialized = f ? {
          has_states: f.states != null, has_init_state: f.init_state != null,
          has_trans_table: f.trans_table != null, has_polarity: f.polarity != null,
          bits: f.bits, keys: Object.keys(f).length,
        } : { missing: true };
      } catch (e) { out.errs.push('serialize: ' + e.message); }
      return out;
    });

    console.log('cells.FSM 存在:', r.hasFSM);
    for (const [k, v] of Object.entries(r.steps || {})) console.log(`[${k}] ${JSON.stringify(v)}`);
    if (r.errs && r.errs.length) console.log('错误: ' + r.errs.join(' | '));
    if (perr.length) console.log('页面异常: ' + perr.slice(0, 6).join(' | '));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
  }
})();
