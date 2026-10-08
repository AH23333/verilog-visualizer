// 只读诊断（不作判定）：沙盒里真仿真跑起来时，FSM 的时钟到底有没有到、
// 与 Dff 的对照（同一座电路、同一个 Clock）—— 用来分清「夹具没启动仿真」
// 与「FSM 器件本身不走状态」两种下落。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1629; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;

(async () => {
  let server, browser;
  try {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await UI.enterSandbox(page);

    const r = await page.evaluate(async () => {
      const djs = window.digitaljs, paper = window.__sandboxPaper, circuit = window.__sandboxCircuit;
      const out = {};
      const fsm = new djs.cells.FSM({
        position: { x: 260, y: 120 }, label: 'M', bits: { in: 1, out: 1 },
        polarity: { clock: 1, arst: 1 }, states: 2, init_state: 0,
        trans_table: [{ state_in: 0, ctrl_in: '1', state_out: 1, ctrl_out: '1' },
                      { state_in: 1, ctrl_in: '0', state_out: 0, ctrl_out: '0' }],
      });
      const dff = new djs.cells.Dff({ position: { x: 260, y: 260 }, bits: 1, polarity: { clock: 1 } });
      const clk = new djs.cells.Clock({ position: { x: 60, y: 160 } });
      const btn = new djs.cells.Button({ position: { x: 60, y: 240 }, bits: 1 });
      const lamp = new djs.cells.Lamp({ position: { x: 520, y: 120 } });
      const lamp2 = new djs.cells.Lamp({ position: { x: 520, y: 260 } });
      paper.model.addCell(fsm); paper.model.addCell(dff); paper.model.addCell(clk);
      paper.model.addCell(btn); paper.model.addCell(lamp); paper.model.addCell(lamp2);
      const w = (a, ap, b, bp) => new djs.cells.Wire({ source: { cell: a.id, port: ap }, target: { cell: b.id, port: bp }, bits: 1 });
      paper.model.addCell(w(clk, 'out', fsm, 'clk'));
      paper.model.addCell(w(clk, 'out', dff, 'clk'));
      paper.model.addCell(w(btn, 'out', fsm, 'in'));
      paper.model.addCell(w(btn, 'out', dff, 'in1'));
      paper.model.addCell(w(fsm, 'out', lamp, 'in'));
      paper.model.addCell(w(dff, 'out', lamp2, 'in'));
      out.dffPorts = dff.getPorts().map((p) => p.id);
      // 把按钮置 1
      const cur = (btn.get('outputSignals') || {}).out;
      const C = cur && cur.constructor;
      out.vecCtor = C ? C.name : 'none';
      out.zeroGet = cur ? cur.get(0) : null;
      if (C) {
        const one = C.fromBin ? C.fromBin('1', 1) : null;
        btn.set('outputSignals', { ...(btn.get('outputSignals') || {}), out: one });
        out.oneGet = one ? one.get(0) : null;
        out.xGet = C.xes ? C.xes(1).get(0) : null;
      }
      // 启动沙盒的仿真（工具栏那颗按钮）
      const runBtn = document.querySelector('button[title="运行 / 暂停仿真"]');
      out.runBtnFound = !!runBtn;
      if (runBtn) runBtn.click();
      const trace = [];
      for (let i = 0; i < 24; i++) {
        await new Promise((r2) => setTimeout(r2, 150));
        const cs = (c) => { const o = c.get('outputSignals') || {}; const k = Object.keys(o); const v = o[k[0]]; return v ? v.get(0) : null; };
        trace.push([String(fsm.get('current_state')), cs(clk), cs(btn), cs(dff), fsm.last_clk]);
      }
      out.trace = trace;
      out.running = circuit.running;
      out.engineInterval = circuit._engine && circuit._engine._interval_ms;
      return out;
    });
    console.log(JSON.stringify(r, null, 1).slice(0, 2600));
    if (perr.length) console.log('页面异常: ' + perr.slice(0, 4).join(' | '));
  } catch (e) { console.log('FATAL ' + String(e.stack || e).slice(0, 400)); }
  finally { if (browser) await browser.close().catch(() => { }); if (server) server.kill(); }
})();
