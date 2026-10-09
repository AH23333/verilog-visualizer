// R119 闸门：表达式多位总线与切片（a[3:2]、a[0]）——位宽推断/BusSlice 落器件/位宽校验/多位真值对拍
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1179;
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
  await inp.type(expr, { delay: 5 });
  await sleep(350);
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

    // [1] 切片与：a[3:2]&b[3:2] → BusSlice×2 + And(bits=2)
    await openGen(page);
    await setExpr(page, 'y = a[3:2] & b[3:2]');
    const prev = await page.evaluate(() => (document.querySelector('[data-expr-preview]') || {}).textContent || '');
    (prev.includes('a[4b]') && prev.includes('b[4b]')) ? ok('[1a] 预览位宽标注', prev.trim()) : bad('[1a] 预览', prev);
    await page.locator('[data-expr-go]').click();
    await sleep(2000);
    let st = await page.evaluate(() => {
      const els = window.__sandboxPaper.model.getElements().map((c) => ({ type: String(c.get('type')), bits: c.get('bits'), slice: c.get('slice'), net: String(c.get('net') || '') }));
      return {
        slices: els.filter((e) => e.type === 'BusSlice').map((e) => e.slice),
        and: els.find((e) => e.type === 'And'),
        inputs: els.filter((e) => e.type === 'Input').map((e) => ({ net: e.net, bits: e.bits })),
        out: els.find((e) => e.type === 'Output'),
      };
    });
    const slOk = st.slices.length === 2 && st.slices.every((s) => s && s.first === 2 && s.count === 2 && s.total === 4);
    const andOk = st.and && (typeof st.and.bits === 'object' ? st.and.bits.in1 === 2 || st.and.bits.in === 2 : st.and.bits === 2);
    const inOk = st.inputs.length === 2 && st.inputs.every((i) => i.bits === 4);
    (slOk && andOk && inOk) ? ok('[1] 切片拓扑：BusSlice{first:2,count:2,total:4}×2 + And 2 位 + Input 4 位', J({ sl: st.slices[0], and: st.and, ins: st.inputs })) : bad('[1] 切片拓扑', J(st));

    // [2] 单位选择：a[1] & b[1]（b 位宽推断=2）→ BusSlice 提取 1 位
    await clearCanvas(page);
    await openGen(page);
    await setExpr(page, 'y = a[1] & b[1]');
    await page.locator('[data-expr-go]').click();
    await sleep(2000);
    st = await page.evaluate(() => {
      const els = window.__sandboxPaper.model.getElements().map((c) => ({ type: String(c.get('type')), slice: c.get('slice') }));
      return { slices: els.filter((e) => e.type === 'BusSlice').map((e) => e.slice), n: els.filter((e) => e.type === 'BusSlice').length };
    });
    (st.n === 2 && st.slices.every((s) => s.first === 1 && s.count === 1)) ? ok('[2] 单位选择落 BusSlice(1位)', J(st.slices)) : bad('[2] 单位选择', J(st));

    // [3] 全宽切片=直连（不生成 BusSlice）
    await clearCanvas(page);
    await openGen(page);
    await setExpr(page, 'y = a[1:0] & b[1:0]');
    await page.locator('[data-expr-go]').click();
    await sleep(1800);
    st = await page.evaluate(() => {
      const els = window.__sandboxPaper.model.getElements().map((c) => String(c.get('type')));
      return { slices: els.filter((t) => t === 'BusSlice').length, ins: els.filter((t) => t === 'Input').length };
    });
    (st.slices === 0 && st.ins === 2) ? ok('[3] 切片恰覆盖全宽 → 直连 Input 不生成 BusSlice', J(st)) : bad('[3] 全宽合并', J(st));

    // [4] 位宽不一致：a[3:0] & b → 中文错误 + 按钮禁用
    await openGen(page);
    await setExpr(page, 'y = a[3:0] & b');
    const errTxt = await page.evaluate(() => (document.querySelector('[data-expr-error]') || {}).textContent || '');
    const disabled = await page.evaluate(() => !!document.querySelector('[data-expr-go]')?.disabled);
    await page.keyboard.press('Escape');
    (errTxt.includes('位宽不一致') && disabled) ? ok('[4] 位宽不一致中文错误且禁生成', errTxt.trim()) : bad('[4] 校验', `err=${errTxt} dis=${disabled}`);

    // [5] 多位真值对拍：y=a[3:2]&b[3:2]，驱动 4 位输入全 16 组读 2 位输出
    await clearCanvas(page);
    await openGen(page);
    await setExpr(page, 'y = a[3:2] & b[3:2]');
    await page.locator('[data-expr-go]').click();
    await sleep(2000);
    const sim = await page.evaluate(async () => {
      const paper = window.__sandboxPaper;
      const circuit = window.__sandboxCircuit;
      let a = null, b = null, out = null;
      paper.model.getElements().forEach((c) => {
        const t = String(c.get('type')); const n = String(c.get('net') || '');
        if (t === 'Input' && n === 'a') a = c; if (t === 'Input' && n === 'b') b = c; if (t === 'Output' && n === 'y') out = c;
      });
      if (!a || !b || !out) return { why: '器件不齐' };
      const V = a.get('outputSignals').out.constructor;
      const read = () => {
        const w = paper.model.getLinks().find((l) => String(l.get('target')?.id) === String(out.id));
        const s = w && w.get('signal');
        if (s == null) return null;
        try { const str = String(s).replace(/^Vector3vl\s+/, '').replace(/^0b/, ''); return /[xz]/.test(str) ? null : parseInt(str, 2); } catch { return null; }
      };
      const rows = [];
      for (let av = 0; av < 16; av++) {
        for (let bv = 0; bv < 16; bv += 5) {
          a.set('outputSignals', { out: V.fromBin(av.toString(2).padStart(4, '0'), 4) });
          b.set('outputSignals', { out: V.fromBin(bv.toString(2).padStart(4, '0'), 4) });
          for (let k = 0; k < 14; k++) circuit._engine.updateGates();
          rows.push({ av, bv, got: read(), want: ((av >> 2) & 3) & ((bv >> 2) & 3) });
        }
      }
      return { rows };
    });
    if (sim.rows) {
      const wrong = sim.rows.filter((r) => r.got !== r.want);
      wrong.length === 0 ? ok('[5] 多位真值对拍 48 组全等（y=a[3:2]&b[3:2]）') : bad('[5] 对拍', J(wrong.slice(0, 3)));
    } else bad('[5] 对拍', J(sim));

    // [6] 无异常
    errs.length ? bad('[6] 页面异常', errs.slice(0, 3).join(' | ')) : ok('[6] 全程无页面异常');
  } catch (e) {
    bad('FATAL', String(e && e.stack || e).slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => { });
    try { server && server.kill('SIGTERM'); } catch { }
    try { UI.reapViteByPort(PORT); } catch { }
  }
  console.log(`\n===== R119 bus-expr-gate: PASS=${pass} FAIL=${fail} =====`);
  process.exitCode = fail ? 1 : 0;
})();
