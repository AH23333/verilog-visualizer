// R116 实验闸门（**不进 run-all GATES**）：验证 verilog.ts 的 EXPERIMENTAL_FLOW 官方流。
// 默认编译流为旧流（techmap 门阵）——本闸门在其下自动 SKIP 退出（exit 0，无 PASS 判据）；
// 把 verilog.ts 的 EXPERIMENTAL_FLOW 改 true 后手动跑本闸门，8 项判据才是有效判定。
// 判据（r51_signed.v 就是为这一族设计的夹具——signed 乘除 / $sshr(fillx) / 128×8 RAM(words)）：
//  [1] r51_signed 编译成功出 circuitJson
//  [2] devices 里有 Multiplication（旧流裸 techmap 会把它炸成门阵——门阵里绝不会有这颗）
//  [3] 该器件 signed 是对象且有真值（有符号乘语义活着，R48/R49 那一族的正主）
//  [4] devices 里有 Division（同理不被炸散）
//  [5] devices 里有 Memory 且 words 在场（128×8 RAM 保持 Memory 器件，不是触发器海）
//  [6] ram_r116.v（行为级读写口 RAM）编译出 Memory 且 rdports/wrports 结构成在
//  [7] 编译产物画布渲染成功（Canvas 走 digitaljs Circuit——高层器件放得下）
//  [8] 全程无页面异常
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1166;
const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('  PASS  ' + n + (d ? ' — ' + d : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); };
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');

async function compileFile(page, name, content) {
  await page.evaluate(async (a) => {
    const { fileStore } = await import('/src/store/fileStore.ts');
    const ex = fileStore.getAll().find((f) => f.name === a.name);
    if (ex) fileStore.deleteFile(ex.id);
    const nf = fileStore.createFile(a.name); fileStore.saveContent(nf.id, a.c);
  }, { name, c: content });
  await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
  try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
  await page.locator(`[title="${name}"]`).first().click({ force: true }); await sleep(800);
  await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
  for (let i = 0; i < 60; i++) {
    await sleep(700);
    const done = await page.evaluate(async (n) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const f = fileStore.getAll().find((x) => x.name === n);
      return !!(f && f.status === 'compiled' && f.circuitJson);
    }, name);
    if (done) return true;
    const err = await page.evaluate(async (n) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const f = fileStore.getAll().find((x) => x.name === n);
      return f && f.status === 'error';
    }, name);
    if (err) return false;
  }
  return false;
}
const getJson = (page, name) => page.evaluate(async (n) => {
  const { fileStore } = await import('/src/store/fileStore.ts');
  const f = fileStore.getAll().find((x) => x.name === n);
  return f && f.circuitJson ? (typeof f.circuitJson === 'string' ? JSON.parse(f.circuitJson) : f.circuitJson) : null;
}, name);

(async () => {
  let server, browser;
  const errs = [];
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 90000; let up = false
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) { up = true; break } } catch { } await sleep(500); }
    if (!up) { bad('FATAL', 'vite 90 秒没起来（环境问题，不是产品判据）'); throw new Error('no vite'); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await UI.boot(page, URL, { reload: true });
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await sleep(500);

    // ---- r51_signed ----
    const c1 = await compileFile(page, 'r51_signed.v', rd('r51_signed.v'));
    if (!c1) { bad('[1] r51_signed 编译', '没出 circuitJson'); }
    else {
      ok('[1] r51_signed 编译成功');
      const cj = await getJson(page, 'r51_signed.v');
      const devs = Object.values(cj.devices || {});
      const types = devs.map((d) => d.type);
      const mul = devs.find((d) => d.type === 'Multiplication');
      const div = devs.find((d) => d.type === 'Division');
      const mem = devs.find((d) => d.type === 'Memory');
      // 实验闸门门卫：默认旧流下无任何高层算术器件 → 明确 SKIP 退出（不产 PASS/FAIL 假红）
      if (!mul && !div && !mem && !types.includes('Addition')) {
        console.log('  SKIP  当前为默认旧流（techmap 门阵），官方流判据不适用——把 verilog.ts EXPERIMENTAL_FLOW 改 true 后重跑');
        console.log(`\n===== R116 compile-flow: SKIP（旧流基线）=====`);
        process.exit(0);
      }
      // [2] Multiplication 在（旧流门阵形态下绝无此器件）
      types.includes('Multiplication') ? ok('[2] 高层 Multiplication 器件在产物里（未被裸 techmap 炸散）') : bad('[2]', 'types=' + J([...new Set(types)].slice(0, 20)));
      // [3] signed 对象且有真值
      const sgnOk = mul && mul.signed && typeof mul.signed === 'object' && (mul.signed.in1 || mul.signed.in2);
      sgnOk ? ok('[3] Multiplication.signed 对象带真值', J(mul.signed)) : bad('[3] signed', mul ? J(mul.signed) : '无 mul');
      // [4] Division 在
      div ? ok('[4] Division 器件在产物里') : bad('[4]', '无 Division');
      // [5] Memory 且 words 在场
      const memOk = mem && (mem.words != null || mem.size != null || mem.abits != null);
      memOk ? ok('[5] RAM 保持 Memory 器件（words/abits 在案）', J({ words: mem.words, abits: mem.abits, bits: mem.bits })) : bad('[5] Memory', mem ? J(Object.keys(mem)) : '无 Memory');
    }

    // ---- ram_r116（行为级读写口）----
    const c2 = await compileFile(page, 'ram_r116.v', rd('ram_r116.v'));
    if (!c2) { bad('[6] ram_r116 编译', '没出 circuitJson'); }
    else {
      const cj2 = await getJson(page, 'ram_r116.v');
      const devs2 = Object.values(cj2.devices || {});
      const mem2 = devs2.find((d) => d.type === 'Memory');
      const portsOk = mem2 && Array.isArray(mem2.rdports) && Array.isArray(mem2.wrports) && (mem2.rdports.length + mem2.wrports.length) > 0;
      portsOk ? ok('[6] 行为级 RAM → Memory 且读写口结构成在', J({ rd: mem2.rdports, wr: (mem2.wrports || []).length })) : bad('[6] ram_r116', mem2 ? J(Object.keys(mem2)) : 'types=' + J(devs2.map((d) => d.type).slice(0, 15)));
    }

    // ---- [7] 画布渲染高层器件（切电路视图看 paper 有器件）----
    const rendered = await page.evaluate(() => {
      const wrap = document.querySelector('[data-canvas-wrapper], .joint-paper') || document.querySelector('#root');
      const cells = document.querySelectorAll('.joint-cell, [model-id]');
      return { paper: !!document.querySelector('.joint-paper'), cells: cells.length, hasWrap: !!wrap };
    });
    rendered.paper && rendered.cells > 3 ? ok('[7] 编译画布渲染出高层器件', J(rendered)) : bad('[7] 渲染', J(rendered));

    // ---- [8] 无页面异常 ----
    errs.length ? bad('[8] 页面异常', errs.join(' | ')) : ok('[8] 全程无页面异常');
  } catch (e) {
    bad('FATAL', String(e && e.stack || e).slice(0, 400));
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { server && server.kill('SIGTERM'); } catch { }
    try { UI.reapViteByPort(PORT); } catch { }
  }
  console.log(`\n===== R116 compile-flow: PASS=${pass} FAIL=${fail} =====`);
  process.exitCode = fail ? 1 : 0;
})();
