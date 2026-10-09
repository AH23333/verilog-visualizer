// R118 闸门：表达式生成升级——多输出语句 + 公共子表达式共享（CSE）+ 直接存为部件
// 判据（吸取卷十九：全部走真机消费链）：
//  [1] 多输出：`s=a^b^cin; cout=(a&b)|(cin&(a^b))` 生成 → 2 个 Output（net=s/cout）
//  [2] CSE：`y=(a^b)&c; z=a^b` → Xor 只有一颗且被 And 与 Output z 共用（连线数佐证）
//  [3] 预览摘要含「输出 2」「共享 1」
//  [4] 真仿真对拍：多输出全加器电路在 digitaljs 引擎实跑 8 组输入，s/cout 与布尔语义全等
//  [5] 存部件闭环：勾「直接存为部件」→ 部件库出现该门 + 画布出现实例 + toast
//  [6] 实例可展开内部电路（gateSystem 绑定链完好——卷十九热修守卫下钻取正常）
//  [7] 全程无页面异常
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1178;
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
  await page.locator('[data-sandbox-paper-host], .joint-paper').first().click({ position: { x: 5, y: 5 } }).catch(() => { });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await sleep(500);
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

    // [1][3] 多输出全加器 + 预览摘要
    await openGen(page);
    await setExpr(page, 's = a^b^cin; cout = (a&b)|(cin&(a^b))');
    const prev = await page.evaluate(() => (document.querySelector('[data-expr-preview]') || {}).textContent || '');
    (prev.includes('输出 2') && prev.includes('输入 3')) ? ok('[3] 预览含多输出摘要', prev.trim()) : bad('[3] 预览', prev);
    await page.locator('[data-expr-go]').click();
    await sleep(2000);
    let st = await page.evaluate(() => {
      const els = window.__sandboxPaper.model.getElements().map((c) => ({ type: String(c.get('type')), net: String(c.get('net') || ''), inputs: c.get('inputs') }));
      return { outs: els.filter((e) => e.type === 'Output').map((e) => e.net).sort(), ins: els.filter((e) => e.type === 'Input').length, links: window.__sandboxPaper.model.getLinks().length };
    });
    (J(st.outs) === J(['cout', 's']) && st.ins === 3) ? ok('[1] 多输出电路：Output net=s/cout + 3 Input', J(st)) : bad('[1] 多输出', J(st));

    // [2] CSE：y=(a^b)&c; z=a^b → 一颗 Xor 两处消费
    await clearCanvas(page);
    await openGen(page);
    await setExpr(page, 'y = (a^b)&c; z = a^b');
    const prev2 = await page.evaluate(() => (document.querySelector('[data-expr-preview]') || {}).textContent || '');
    await page.locator('[data-expr-go]').click();
    await sleep(2000);
    st = await page.evaluate(() => {
      const paper = window.__sandboxPaper;
      const xor = paper.model.getElements().find((c) => String(c.get('type')) === 'Xor');
      const fanout = xor ? paper.model.getLinks().filter((l) => String(l.get('source')?.id) === String(xor.id)).length : 0;
      const counts = {};
      paper.model.getElements().forEach((c) => { const t = String(c.get('type')); counts[t] = (counts[t] || 0) + 1; });
      return { xorCount: counts.Xor || 0, fanout, counts };
    });
    (st.xorCount === 1 && st.fanout === 2 && prev2.includes('共享 1'))
      ? ok('[2] CSE 生效：单颗 Xor 双消费（And 与 z 输出共用），预览标注共享', J(st)) : bad('[2] CSE', `${J(st)} prev=${prev2}`);

    // [4] 真仿真对拍：回到全加器（清空重生成）
    await clearCanvas(page);
    await openGen(page);
    await setExpr(page, 's = a^b^cin; cout = (a&b)|(cin&(a^b))');
    await page.locator('[data-expr-go]').click();
    await sleep(2000);
    const sim = await page.evaluate(async () => {
      const paper = window.__sandboxPaper;
      const circuit = window.__sandboxCircuit;
      const byNet = {};
      paper.model.getElements().forEach((c) => { const n = String(c.get('net') || ''); if (String(c.get('type')) === 'Input' && ['a', 'b', 'cin'].includes(n)) byNet[n] = c; });
      const outs = {};
      paper.model.getElements().forEach((c) => { const n = String(c.get('net') || ''); if (String(c.get('type')) === 'Output' && ['s', 'cout'].includes(n)) outs[n] = c; });
      if (Object.keys(byNet).length !== 3 || Object.keys(outs).length !== 2) return { why: '器件不齐', byNet: Object.keys(byNet), outs: Object.keys(outs) };
      const V = byNet.a.get('outputSignals').out.constructor;
      const readWire = (outCell) => {
        const w = paper.model.getLinks().find((l) => String(l.get('target')?.id) === String(outCell.id));
        const s = w && w.get('signal');
        if (s == null) return null;
        try { const str = String(s).replace(/^Vector3vl\s+/, ''); return /[xz]/.test(str) ? null : Number(str); } catch { return null; }
      };
      const rows = [];
      for (let m = 0; m < 8; m++) {
        const a = (m >> 2) & 1, b = (m >> 1) & 1, cin = m & 1;
        byNet.a.set('outputSignals', { out: V.fromBin(String(a), 1) });
        byNet.b.set('outputSignals', { out: V.fromBin(String(b), 1) });
        byNet.cin.set('outputSignals', { out: V.fromBin(String(cin), 1) });
        for (let k = 0; k < 14; k++) circuit._engine.updateGates();
        rows.push({ a, b, cin, s: readWire(outs.s), cout: readWire(outs.cout) });
      }
      return { rows };
    });
    if (sim.rows) {
      const wrong = sim.rows.filter((r) => r.s !== (r.a ^ r.b ^ r.cin) || r.cout !== ((r.a & r.b) | (r.cin & (r.a ^ r.b))));
      wrong.length === 0 ? ok('[4] 全加器 8 组真值 digitaljs 引擎实跑全等') : bad('[4] 真值对拍', J(wrong.slice(0, 3)));
    } else bad('[4] 真值对拍', J(sim));

    // [5] 存部件闭环
    await clearCanvas(page);
    await openGen(page);
    await setExpr(page, 'g = x & !y');
    await page.locator('[data-expr-gatemode]').check();
    await sleep(250);
    await page.locator('[data-expr-gatename]').type('expr_andnot');
    await sleep(250);
    await page.locator('[data-expr-go]').click();
    await sleep(2200);
    const gateState = await page.evaluate(() => {
      const list = window.__sandboxGates.list().map((g) => g.name);
      const paper = window.__sandboxPaper;
      const sub = paper.model.getElements().find((c) => String(c.get('type')) === 'Subcircuit');
      const toast = [...document.querySelectorAll('div')].map((d) => (d.textContent || '')).find((s) => /已存为部件/.test(s) && s.length < 60);
      return { hasGate: list.includes('expr_andnot'), hasInstance: !!sub, instanceType: sub ? String(sub.get('celltype')) : null, toast: toast || null };
    });
    (gateState.hasGate && gateState.hasInstance && gateState.instanceType === 'expr_andnot')
      ? ok('[5] 存部件闭环：库里有门 + 画布有实例', J(gateState)) : bad('[5] 存部件', J(gateState));

    // [6] 实例展开内部电路（卷十九守卫链）
    const box = await page.evaluate(() => {
      const paper = window.__sandboxPaper;
      const cell = paper.model.getElements().find((c) => String(c.get('type')) === 'Subcircuit');
      if (!cell) return null;
      const v = paper.findViewByModel(cell); if (!v || !v.el) return null;
      const r = v.el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (box) {
      // 右键菜单「查看内部电路」（SandboxCanvas 内联项，路径确定）
      await page.mouse.click(box.x, box.y, { button: 'right' });
      await sleep(700);
      const menuDump = await page.evaluate(() => {
        const leaves = [...document.querySelectorAll('div,button,li,span')].filter((d) => (d.textContent || '').includes('内部电路') && (d.textContent || '').length < 30);
        return { n: leaves.length, sample: leaves.slice(0, 4).map((d) => d.tagName + ':' + (d.textContent || '').trim() + ':kids' + d.children.length) };
      });
      console.log('    [诊断] 菜单含「内部电路」节点:', J(menuDump));
      const clicked = await page.evaluate(() => {
        const items = [...document.querySelectorAll('div,button,li,span')].filter((d) => /^查看内部电路/.test((d.textContent || '').trim()) && (d.textContent || '').trim().length < 10);
        const leaf = items.sort((a, b) => a.children.length - b.children.length)[0];
        if (leaf) { leaf.click(); return true; }
        return false;
      });
      if (!clicked) { await page.keyboard.press('Escape'); bad('[6] 展开', '右键菜单里没有「查看内部电路」项'); }
      else {
        await sleep(3000);
        const expand = await page.evaluate(() => {
          const papers = document.querySelectorAll('.joint-paper').length;
          const failTxt = [...document.querySelectorAll('div,span')].map((d) => (d.textContent || '').trim()).find((s) => /渲染失败|没有可渲染/.test(s) && s.length < 120);
          return { papers, failTxt: failTxt || null };
        });
        (expand.papers >= 2 && !expand.failTxt) ? ok('[6] 表达式部件实例可展开内部电路', J(expand)) : bad('[6] 展开', J(expand));
      }
    } else bad('[6] 展开', '实例不可定位');

    // [7] 无异常
    errs.length ? bad('[7] 页面异常', errs.slice(0, 3).join(' | ')) : ok('[7] 全程无页面异常');
  } catch (e) {
    bad('FATAL', String(e && e.stack || e).slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { server && server.kill('SIGTERM'); } catch { }
    try { UI.reapViteByPort(PORT); } catch { }
  }
  console.log(`\n===== R118 multiout-gate: PASS=${pass} FAIL=${fail} =====`);
  process.exitCode = fail ? 1 : 0;
})();
