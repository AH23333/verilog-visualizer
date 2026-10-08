// R20 验收：新增器件库 —— D 触发器 / 常量 / 加法器 / 七段数码管
//  1) 调色板放置 D 触发器，自动带 clk 端口（spawnCell 的 polarity 生效）
//  2) 时序真仿真：输入引脚当手动时钟，Q 在上升沿跟随 D
//  3) 加法器 2+3=5
//  4) 七段数码管接收 8 位段码
//  5) 保存/重载后 Dff 仍有 clk 端口（polarity 持久化）
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1482;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1482)); } catch { }
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const realClickGate = async (page, label) => {
  // 走共用夹具：它会先展开分组、按 .first() 点，点不到就抛。
  //   ⚠ 原来这里对 `button[data-gate]` 用严格模式 .click()：时序组里「D 触发器」与「寄存器 EN/RST」
  //   两颗的 data-gate 都是 Dff ⇒ strict mode violation，整颗闸门直接崩（本轮实测）。
  await require('./_ui.cjs').clickGate(page, label);
  await sleep(300);
};
const portCenter = (page, id, port) => page.evaluate(({ id, port }) => {
  const p = window.__sandboxPaper; const c = p.model.getCell(id); const v = c?.findView(p); if (!v) return null;
  const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { id, port });
async function wire(page, s, sp, t, tp) {
  const a = await portCenter(page, s, sp); const b = await portCenter(page, t, tp);
  if (!a || !b) return false;
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(120);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 }); await sleep(100);
  await page.mouse.move(b.x, b.y, { steps: 6 }); await sleep(250); await page.mouse.up(); await sleep(500);
  return true;
}
const clickBody = async (page, id) => {
  const pt = await page.evaluate((id) => {
    const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
    const r = v.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  await page.mouse.click(pt.x, pt.y); await sleep(650);
};
const vecStr = (v) => {
  if (v == null) return 'n/a';
  try {
    if (typeof v.toBigInt === 'function') {
      const b = v.toBigInt();
      if (b != null && Number.isFinite(Number(b))) return String(b);
    }
  } catch { /* 含 x 的向量无法转整数 */ }
  return v.toString();
};
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await require('./_ui.cjs').boot(page, URL);
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await require('./_ui.cjs').boot(page, URL, { reload: true, settle: 1200 });
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await require('./_ui.cjs').newSandboxFile(page);

    // ===== [1] 调色板放置 D 触发器 =====
    console.log('\n===== [1] 放置 D 触发器 =====');
    await realClickGate(page, 'Dff');
    const dff = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(x => x.get('type') === 'Dff');
      if (!c) return null;
      return { id: c.id, ports: (c.getPorts?.() || []).map(x => x.id) };
    });
    console.log('    Dff:', JSON.stringify(dff));
    (dff && dff.ports.includes('in') && dff.ports.includes('out') && dff.ports.includes('clk'))
      ? ok('[1] 调色板放置 D 触发器且自带 clk 端口', dff.ports.join(','))
      : bad('[1] D 触发器放置/端口异常', JSON.stringify(dff));

    // ===== [2] 时序真仿真 =====
    console.log('\n===== [2] D 触发器时序仿真（输入引脚当手动时钟）=====');
    await realClickGate(page, 'Input'); await realClickGate(page, 'Input'); await realClickGate(page, 'Lamp');
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    const dffId = ids.Dff[0];
    const w = [];
    w.push(await wire(page, ids.Input[0], 'out', dffId, 'in'));   // D
    w.push(await wire(page, ids.Input[1], 'out', dffId, 'clk'));  // 手动时钟
    w.push(await wire(page, dffId, 'out', ids.Lamp[0], 'in'));    // Q
    console.log('    连线:', JSON.stringify(w), ' links =', await page.evaluate(() => window.__sandboxPaper.model.getLinks().length));
    const readQ = () => page.evaluate(({ dffId, lampId }) => {
      const p = window.__sandboxPaper;
      const o = p.model.getCell(dffId)?.get('outputSignals'); const v = o?.out;
      const lv = p.model.getCell(lampId)?.findView(p)?.el?.querySelector?.('.led');
      return { q: v ? v.toString() : 'n/a', lamp: lv ? getComputedStyle(lv).fill : null };
    }, { dffId, lampId: ids.Lamp[0] });
    console.log('    连线后:', JSON.stringify(await readQ()));
    await clickBody(page, ids.Input[0]);   // D → 1
    await clickBody(page, ids.Input[1]);   // clk 上升沿 → Q ← 1
    const s2 = await readQ();
    console.log('    D=1 后打一个上升沿:', JSON.stringify(s2));
    const lit = /3, 192, 60|#03c03c/.test(s2.lamp) && /1/.test(s2.q);
    lit ? ok('[2] D 触发器在时钟上升沿锁存 D（时序仿真工作）', JSON.stringify(s2))
        : bad('[2] D 触发器未锁存', JSON.stringify(s2));

    // ===== [3] 加法器 2+3=5 =====
    console.log('\n===== [3] 加法器 =====');
    await require('./_ui.cjs').newSandboxFile(page);
    const placed = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const add = (C, args) => { const c = new dj.cells[C](args); p.model.addCell(c); return c.id; };
      return {
        c1: add('Constant', { type: 'Constant', constant: '0010', position: { x: 150, y: 150 } }),
        c2: add('Constant', { type: 'Constant', constant: '0011', position: { x: 150, y: 300 } }),
        adder: add('Addition', { type: 'Addition', bits: { in1: 4, in2: 4, out: 4 }, position: { x: 420, y: 220 } }),
      };
    });
    await sleep(500);
    const w3 = [];
    w3.push(await wire(page, placed.c1, 'out', placed.adder, 'in1'));
    w3.push(await wire(page, placed.c2, 'out', placed.adder, 'in2'));
    await sleep(800);
    const sum = await page.evaluate((id) => {
      const p = window.__sandboxPaper;
      const o = p.model.getCell(id)?.get('outputSignals'); const v = o?.out;
      if (!v) return 'n/a';
      try {
        if (typeof v.toBigInt === 'function') {
          const b = v.toBigInt();
          if (b != null && Number.isFinite(Number(b))) return String(b);
        }
      } catch (e) { /* 含 x 的向量无法转整数 */ }
      return v.toString();
    }, placed.adder);
    console.log('    加法器输出 =', sum, ' 连线:', JSON.stringify(w3));
    sum === '5' ? ok('[3] 加法器 2+3=5', `out=${sum}`)
                : bad('[3] 加法器输出异常', `out=${sum}`);

    // ===== [4] 七段数码管 =====
    console.log('\n===== [4] 七段数码管 =====');
    await require('./_ui.cjs').newSandboxFile(page);
    const d4 = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const c1 = new dj.cells.Constant({ type: 'Constant', constant: '10101010', position: { x: 150, y: 220 } }); p.model.addCell(c1);
      const d = new dj.cells.Display7({ type: 'Display7', bits: 8, position: { x: 420, y: 200 } }); p.model.addCell(d);
      return { c1: c1.id, disp: d.id };
    });
    await sleep(400);
    const w4 = await wire(page, d4.c1, 'out', d4.disp, 'in');
    await sleep(800);
    const disp = await page.evaluate((id) => {
      const p = window.__sandboxPaper;
      const d = p.model.getCell(id);
      const o = d?.get('inputSignals'); const v = o?.in;
      const view = d?.findView(p);
      return { in: v ? v.toString() : 'n/a', rendered: !!view, ledA: view ? !!view.el.querySelector('[selector="a"], .a') : false };
    }, d4.disp);
    console.log('    数码管:', JSON.stringify(disp));
    (w4 && /10101010/.test(disp.in) && disp.rendered)
      ? ok('[4] 七段数码管接收 8 位段码并渲染', disp.in)
      : bad('[4] 数码管异常', JSON.stringify(disp));

    // ===== [5] 持久化：Dff 的 clk 端口（polarity）保存/重载 =====
    console.log('\n===== [5] D 触发器持久化 =====');
    await require('./_ui.cjs').newSandboxFile(page);
    await realClickGate(page, 'Dff'); await sleep(400);
    await page.evaluate(() => { const p = window.__sandboxPaper; const c = p.model.getCells().find(x => x.get('type') === 'Dff'); c.set('position', { x: 300, y: 200 }); });
    await page.locator('button[title^="保存"]').first().click();
    await sleep(800);
    await require('./_ui.cjs').boot(page, URL, { reload: true });
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    // 重载后落在默认视图（电路/代码），沙盒要夹具自己再进一次；且**不能**用 enterSandbox
    // —— 它读不到 paper 会新建文件，把「持久化」的前置抹掉。r20 原版在这里直接
    // `p.model` → `Cannot read properties of undefined (reading 'model')`（夹具病，非产品）。
    await page.locator('button[data-activity="sandbox"]').click();
    const restored = await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!restored) bad('[5] 重载后 D 触发器仍带 clk 端口（polarity 持久化）', '重载后回到沙盒却没恢复出任何文件：活动文件没被带回来');
    else {
    const dff2 = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(x => x.get('type') === 'Dff');
      return c ? { ports: (c.getPorts?.() || []).map(x => x.id) } : null;
    });
    console.log('    重载后 Dff:', JSON.stringify(dff2));
    (dff2 && dff2.ports.includes('clk'))
      ? ok('[5] 重载后 D 触发器仍带 clk 端口（polarity 持久化）', dff2.ports.join(','))
      : bad('[5] 重载后 D 触发器丢失 clk 端口', JSON.stringify(dff2));
    }

    console.log('\n  pageerrors:', JSON.stringify(errors.slice(0, 4)));
    console.log(`\n===== R20 DONE: ${pass} pass, ${fail} fail =====`);
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); fail++; }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
