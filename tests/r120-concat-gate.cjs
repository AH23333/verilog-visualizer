// R120 闸门：表达式拼接 {A, B}（BusGroup，左高右低）+ 常量 0/1 + 多语句级联引用
// 判据（真机消费链）：
//  [1] 拼接拓扑：y={a[1:0], b[1:0]} → BusGroup groups=[1,1]（in0=低位 b，in1=高位 a）+ 2 Output 驱动序
//  [2] 常量：y=a&1 → Constant 器件 + And；y=a&3 → 中文错误
//  [3] 级联：s=a^b^cin; cout=...; w={cout,s} → 无第 4 个 Input（w 扇出自 cout/s 门）
//  [4] 真仿真对拍：全加器级联（s/cout/w 三输出）8 组输入实跑全等（w=(cout<<1)|s）
//  [5] 存部件闭环回归（拼接表达式直接存部件可展开）
//  [6] 全程无页面异常
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1180;
const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('  PASS  ' + n + (d ? ' — ' + d : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); };

const openGen = async (page) => {
  await page.locator('button[title*="布尔表达式"]').first().click();
  await page.locator('[data-expr-input]').waitFor({ timeout: 4000 });
  await sleep(250);
};
const setExpr = async (page, expr) => {
  const inp = page.locator('[data-expr-input]');
  await inp.fill('');
  await inp.type(expr, { delay: 4 });
  await sleep(400);
};
const clearCanvas = async (page) => {
  await page.locator('.joint-paper').first().click({ position: { x: 5, y: 5 } }).catch(() => { });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await sleep(400);
};

(async () => {
  let server, browser;
  const errs = [];
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 90000; let up = false;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) { up = true; break; } } catch { } await sleep(400); }
    if (!up) { bad('FATAL', 'vite 90 秒没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await UI.boot(page, URL, { reload: true });
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await UI.enterSandbox(page);
    await UI.newSandboxFile(page);
    await sleep(500);

    // [1] 拼接拓扑：{a[1:0], b[1:0]} → BusGroup groups=[1,1]，a→in1（高）、b→in0（低）
    await openGen(page);
    await setExpr(page, 'y = {a[1:0], b[1:0]}');
    await page.locator('[data-expr-go]').click();
    await sleep(2000);
    let st = await page.evaluate(() => {
      const paper = window.__sandboxPaper;
      const bg = paper.model.getElements().find((c) => String(c.get('type')) === 'BusGroup');
      if (!bg) return null;
      const wires = paper.model.getLinks().filter((l) => String(l.get('target')?.id) === String(bg.id));
      const srcNet = {};
      wires.forEach((l) => {
        const src = paper.model.getCell(l.get('source').id);
        srcNet[String(l.get('target').port)] = String(src.get('net') || '?');
      });
      return { groups: bg.get('groups') ? [...bg.get('groups')] : null, srcNet };
    });
    (st && J(st.groups) === '[2,2]' && st.srcNet.in1 === 'a' && st.srcNet.in0 === 'b')
      ? ok('[1] 拼接拓扑：groups=[2,2]（a[1:0]/b[1:0] 各 2 位），高位 a→in1、低位 b→in0（Verilog 左高右低）', J(st))
      : bad('[1] 拼接拓扑', J(st));

    // [2] 常量器件 + 多位常量错误
    await clearCanvas(page);
    await openGen(page);
    await setExpr(page, 'y = a & 1');
    await page.locator('[data-expr-go]').click();
    await sleep(1800);
    st = await page.evaluate(() => {
      const els = window.__sandboxPaper.model.getElements().map((c) => String(c.get('type')));
      return { konst: els.filter((t) => t === 'Constant').length };
    });
    st.konst === 1 ? ok('[2] 常量 1 落 Constant 器件', J(st)) : bad('[2] 常量', J(st));
    await openGen(page);
    await setExpr(page, 'y = a & 3');
    const err3 = await page.evaluate(() => (document.querySelector('[data-expr-error]') || {}).textContent || '');
    await page.keyboard.press('Escape');
    err3.includes('常量') ? ok('[2b] 多位常量中文错误', err3.trim()) : bad('[2b] 常量错误', err3);

    // [3] 级联：三语句无第 4 个 Input
    await clearCanvas(page);
    await openGen(page);
    await setExpr(page, 's = a^b^cin; cout = (a&b)|(cin&(a^b)); w = {cout, s}');
    await page.locator('[data-expr-go]').click();
    await sleep(2400);
    st = await page.evaluate(() => {
      const paper = window.__sandboxPaper;
      const els = paper.model.getElements();
      const ins = els.filter((c) => String(c.get('type')) === 'Input').map((c) => String(c.get('net'))).sort();
      const outs = els.filter((c) => String(c.get('type')) === 'Output').map((c) => String(c.get('net'))).sort();
      return { ins, outs };
    });
    (J(st.ins) === J(['a', 'b', 'cin']) && J(st.outs) === J(['cout', 's', 'w']))
      ? ok('[3] 级联生成：Input 仅 a/b/cin（w 扇出自 cout/s 门）', J(st)) : bad('[3] 级联', J(st));

    // [4] 真仿真对拍：s/cout/w 三输出 8 组
    const sim = await page.evaluate(async () => {
      const paper = window.__sandboxPaper;
      const circuit = window.__sandboxCircuit;
      const byNet = {}; const outs = {};
      paper.model.getElements().forEach((c) => {
        const t = String(c.get('type')); const n = String(c.get('net') || '');
        if (t === 'Input' && ['a', 'b', 'cin'].includes(n)) byNet[n] = c;
        if (t === 'Output' && ['s', 'cout', 'w'].includes(n)) outs[n] = c;
      });
      if (Object.keys(byNet).length !== 3 || Object.keys(outs).length !== 3) return { why: '器件不齐' };
      const V = byNet.a.get('outputSignals').out.constructor;
      const read = (cell) => {
        const w = paper.model.getLinks().find((l) => String(l.get('target')?.id) === String(cell.id));
        const s = w && w.get('signal');
        if (s == null) return null;
        try { const str = String(s).replace(/^Vector3vl\s+/, ''); return /[xz]/.test(str) ? null : parseInt(str, 2); } catch { return null; }
      };
      const rows = [];
      for (let m = 0; m < 8; m++) {
        const a = (m >> 2) & 1, b = (m >> 1) & 1, cin = m & 1;
        byNet.a.set('outputSignals', { out: V.fromBin(String(a), 1) });
        byNet.b.set('outputSignals', { out: V.fromBin(String(b), 1) });
        byNet.cin.set('outputSignals', { out: V.fromBin(String(cin), 1) });
        for (let k = 0; k < 14; k++) circuit._engine.updateGates();
        rows.push({ a, b, cin, s: read(outs.s), cout: read(outs.cout), w: read(outs.w) });
      }
      return { rows };
    });
    if (sim.rows) {
      const wrong = sim.rows.filter((r) => r.s !== (r.a ^ r.b ^ r.cin)
        || r.cout !== ((r.a & r.b) | (r.cin & (r.a ^ r.b)))
        || r.w !== (((r.cout ?? 0) << 1) | (r.s ?? 0)));
      wrong.length === 0 ? ok('[4] 级联三输出 8 组真值引擎实跑全等') : bad('[4] 对拍', J(wrong.slice(0, 3)));
    } else bad('[4] 对拍', J(sim));

    // [5] 存部件闭环回归（拼接表达式）
    await clearCanvas(page);
    await openGen(page);
    await setExpr(page, 'z = {a[1:0], b[1:0]} & c[3:0]');
    await page.locator('[data-expr-gatemode]').check();
    await page.locator('[data-expr-gatename]').type('expr_concat');
    await sleep(250);
    await page.locator('[data-expr-go]').click();
    await sleep(2200);
    const gateState = await page.evaluate(() => {
      const list = window.__sandboxGates.list().map((g) => g.name);
      const paper = window.__sandboxPaper;
      const sub = paper.model.getElements().find((c) => String(c.get('type')) === 'Subcircuit');
      return { hasGate: list.includes('expr_concat'), hasInstance: !!sub };
    });
    (gateState.hasGate && gateState.hasInstance) ? ok('[5] 拼接表达式存部件闭环', J(gateState)) : bad('[5] 存部件', J(gateState));

    // [6] 无异常
    errs.length ? bad('[6] 页面异常', errs.slice(0, 3).join(' | ')) : ok('[6] 全程无页面异常');
  } catch (e) {
    bad('FATAL', String(e && e.stack || e).slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => { });
    try { server && server.kill('SIGTERM'); } catch { }
    try { UI.reapViteByPort(PORT); } catch { }
  }
  console.log(`\n===== R120 concat-gate: PASS=${pass} FAIL=${fail} =====`);
  process.exitCode = fail ? 1 : 0;
})();
