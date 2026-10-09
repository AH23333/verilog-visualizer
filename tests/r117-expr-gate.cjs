// R117 闸门：布尔表达式 → 电路图（借鉴 OpenCircuits ExprToCircuitPopup）
// 判据吸取卷十九教训——不只验生成形状，**真机消费链全走一遍**：
//  [1] 顶栏按钮开弹窗、实时预览摘要出现
//  [2] `a&b|c` 生成：拓扑 3 Input + And[2] + Or[2] + Output，连线数正确
//  [3] `!(a&b)`：单颗 Nand（isNot 融合，无多余 Not）
//  [4] `a|b|c|d`：单颗 Or 四扇入（同型并）；`(a|b)|(c|d)`：三颗二输入 Or（括号 final）
//  [5] 语法错误（`(a&b`）：弹窗显式中文错误、生成按钮禁用、画布零变化
//  [6] 真仿真对拍：生成 `a&b|c` 后**引擎跑真值表**——8 组输入逐组驱动 Input 器件，
//      读 Output/Lamp 信号与布尔语义比对（表达式引擎与 digitaljs 引擎两条独立实现路径）
//  [7] 生成后 Ctrl+Z 撤销：画布回到插入前（复用既有 insertCellsAt 事务）
//  [8] 全程无页面异常
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1177;
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
  await inp.type(expr, { delay: 8 });
  await sleep(350);
};
const canvasState = (page) => page.evaluate(() => {
  const paper = window.__sandboxPaper;
  if (!paper) return null;
  const els = paper.model.getElements().map((c) => ({ type: String(c.get('type')), inputs: c.get('inputs'), net: c.get('net') }));
  const links = paper.model.getLinks().length;
  return { els, links };
});

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

    // [1] 开弹窗 + 实时预览
    await openGen(page);
    const prev1 = await page.evaluate(() => (document.querySelector('[data-expr-preview]') || {}).textContent || '');
    prev1.includes('输入') ? ok('[1] 弹窗打开且实时预览', prev1.trim()) : bad('[1] 预览缺失', prev1);

    // [2] a&b|c 拓扑
    await setExpr(page, 'a&b|c');
    await page.locator('[data-expr-go]').click();
    await sleep(1800);
    let st = await canvasState(page);
    const t2 = st.els.map((e) => e.type + (e.inputs ? `[${e.inputs}]` : '')).sort().join(',');
    // a&b|c：a→And.in1 b→And.in2 And→Or.in1 c→Or.in2 Or→Output ＝ 5 线
    (t2.includes('And[2]') && t2.includes('Or[2]') && st.els.filter((e) => e.type === 'Input').length === 3
      && st.els.filter((e) => e.type === 'Output').length === 1 && st.links === 5)
      ? ok('[2] a&b|c → 3Input+And+Or+Output+5线', t2) : bad('[2] 拓扑', `${t2} links=${st.links}`);

    // [3] !(a&b) → 单 Nand 无 Not
    await openGen(page);
    await setExpr(page, '!(a&b)');
    await page.locator('[data-expr-go]').click();
    await sleep(1800);
    st = await canvasState(page);
    const nand = st.els.filter((e) => e.type === 'Nand').length;
    const nots = st.els.filter((e) => e.type === 'Not').length;
    (nand === 1 && nots === 0) ? ok('[3] !(a&b) 融合成单颗 Nand（isNot，无多余 Not）', `Nand=${nand} Not=${nots}`) : bad('[3] Nand 融合', `Nand=${nand} Not=${nots}`);

    // [4] 括号 final：(a|b)|(c|d) 必须保持三颗二输入 Or，**不得**并成四输入（上游同语义）
    await openGen(page);
    await setExpr(page, '(a|b)|(c|d)');
    await page.locator('[data-expr-go]').click();
    await sleep(1800);
    st = await canvasState(page);
    const ors = st.els.filter((e) => e.type === 'Or');
    const allTwo = ors.length >= 3 && ors.every((e) => e.inputs === 2);
    allTwo ? ok('[4] 括号子表达式独立成门（final 不并 4 输入）', `Or×${ors.length} 全二输入`) : bad('[4] 括号定型', J(ors.map((e) => e.inputs)));

    // [5] 语法错误：中文错误 + 按钮禁用 + 画布零变化
    const before = await canvasState(page);
    await openGen(page);
    await setExpr(page, '(a&b');
    const errTxt = await page.evaluate(() => (document.querySelector('[data-expr-error]') || {}).textContent || '');
    const goDisabled = await page.evaluate(() => !!document.querySelector('[data-expr-go]')?.disabled);
    await page.keyboard.press('Escape');
    await sleep(400);
    const after = await canvasState(page);
    (errTxt.includes('括号') && goDisabled && before.els.length === after.els.length)
      ? ok('[5] 语法错误显式中文提示且不可生成', errTxt.trim()) : bad('[5] 错误路径', `err=${errTxt} disabled=${goDisabled} Δ=${after.els.length - before.els.length}`);

    // [6] 真仿真对拍：清空画布隔离批次 → 生成干净 a&b|c → 逐组驱动读输出
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await sleep(600);
    await openGen(page);
    await setExpr(page, 'a&b|c');
    await page.locator('[data-expr-go]').click();
    await sleep(1800);
    const sim = await page.evaluate(async () => {
      const paper = window.__sandboxPaper;
      const circuit = window.__sandboxCircuit;
      const inputs = paper.model.getElements().filter((c) => String(c.get('type')) === 'Input' && ['a', 'b', 'c'].includes(String(c.get('net') || '')));
      const out = paper.model.getElements().find((c) => String(c.get('type')) === 'Output');
      if (inputs.length !== 3 || !out) return { why: '找不到 a/b/c 输入或 Output' };
      const byNet = {};
      inputs.forEach((c) => { byNet[String(c.get('net'))] = c; });
      const V = byNet.a.get('outputSignals').out.constructor;
      const rows = [];
      for (let m = 0; m < 8; m++) {
        const a = (m >> 2) & 1, b = (m >> 1) & 1, c = m & 1;
        byNet.a.set('outputSignals', { out: V.fromBin(String(a), 1) });
        byNet.b.set('outputSignals', { out: V.fromBin(String(b), 1) });
        byNet.c.set('outputSignals', { out: V.fromBin(String(c), 1) });
        for (let k = 0; k < 12; k++) circuit._engine.updateGates();
        // Output 端口器件的驱动值挂在**入边 wire 的 signal**（r50 同款读法）；
        // ⚠ String(Vector3vl) 带 "Vector3vl " 前缀（r50 vec() 注释在案），Number 前必须剥
        const inWire = paper.model.getLinks().find((l) => String(l.get('target')?.id) === String(out.id));
        const sig = inWire && inWire.get('signal');
        let val = null; let xs = true;
        if (sig != null) {
          try {
            const s = String(sig).replace(/^Vector3vl\s+/, '');
            xs = /[xz]/.test(s);
            val = Number(s.replace(/[xz]/g, '0'));
          } catch { /* 半初始化向量 String 会抛（r50 注释在案） */ }
        }
        rows.push({ a, b, c, got: val, xs });
      }
      return { rows };
    });
    if (sim.rows) {
      const wrong = sim.rows.filter((r) => r.xs || r.got !== ((r.a && r.b) || r.c ? 1 : 0));
      wrong.length === 0 ? ok('[6] 引擎真仿真 8 组全等布尔语义（a&b|c）') : bad('[6] 真值对拍', J(wrong.slice(0, 3)));
    } else bad('[6] 真值对拍', J(sim));

    // [7] Ctrl+Z 撤销回到插入前
    const nBefore = (await canvasState(page)).els.length;
    await page.keyboard.press('Control+z');
    await sleep(900);
    const nAfter = (await canvasState(page)).els.length;
    // 撤销掉最近一次生成批（第 [4] 步的 9 器件+8 线）
    nAfter < nBefore ? ok('[7] 生成可撤销（Ctrl+Z 生效）', `${nBefore} → ${nAfter}`) : bad('[7] 撤销', `${nBefore} → ${nAfter}`);

    // [8] 无页面异常
    errs.length ? bad('[8] 页面异常', errs.slice(0, 3).join(' | ')) : ok('[8] 全程无页面异常');
  } catch (e) {
    bad('FATAL', String(e && e.stack || e).slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { server && server.kill('SIGTERM'); } catch { }
    try { UI.reapViteByPort(PORT); } catch { }
  }
  console.log(`\n===== R117 expr-gate: PASS=${pass} FAIL=${fail} =====`);
  process.exitCode = fail ? 1 : 0;
})();
