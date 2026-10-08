// R22 验收：总线器件 —— 合总线 / 拆总线 / 切总线
//  1) 调色板放置 BusGroup（groups Map 生成 in0-in3 + 4 位 out）
//  2) 真实链路：4 个输入引脚 → 合总线 → 拆总线 → out0 → 灯，拨输入灯跟随
//  3) 切总线：8 位常量取低 4 位
//  4) 持久化：groups（Map）保存/重载后端口仍在
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1494;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1494)); } catch { }
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
  await page.mouse.move(b.x, b.y, { steps: 6 }); await sleep(250); await page.mouse.up(); await sleep(600);
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

    // ===== [1] 放置合总线 =====
    console.log('\n===== [1] 放置合总线 =====');
    await realClickGate(page, 'BusGroup');
    // 合线器一放下就弹「位宽方案」遮罩（产品刻意）。不点掉它，[2] 之后每次点击都被
    // 那颗 `inset:0` 的遮罩拦住 —— r22 原版就在这里 `locator.click` 卡满 30 s。
    // 这里就按本闸门 [1] 要的 4×1 位方案点「应用」，顺带把应用那条路也走一遍。
    await require('./_ui.cjs').busDialog(page, { total: 4, groupWidth: 1 });
    const bg = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(x => x.get('type') === 'BusGroup');
      if (!c) return null;
      const v = c.findView(p); const r = v?.el?.getBoundingClientRect();
      return { id: c.id, ports: (c.getPorts?.() || []).map(x => `${x.id}(b${x.bits})`).sort(), h: r ? Math.round(r.height) : -1 };
    });
    console.log('    BusGroup:', JSON.stringify(bg));
    (bg && ['in0','in1','in2','in3'].every(x => bg.ports.some(p => p.startsWith(x))) && bg.ports.some(p => p.startsWith('out(b4)')))
      ? ok('[1] 合总线端口齐全（4×1 位入 + 4 位出）', bg.ports.join(','))
      : bad('[1] 合总线端口异常', JSON.stringify(bg));

    // ===== [2] 4 输入 → 合总线 → 拆总线 → 灯 =====
    console.log('\n===== [2] 合/拆总线链路 =====');
    for (const t of ['Input', 'Input', 'Input', 'Input', 'Lamp']) await realClickGate(page, t);
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const ug = new dj.cells.BusUngroup({ type: 'BusUngroup', groups: new Map([[0, 1], [1, 1], [2, 1], [3, 1]]), position: { x: 640, y: 240 }, size: { width: 40, height: 72 } });
      p.model.addCell(ug);
      const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    await sleep(500);
    const w = [];
    for (let i = 0; i < 4; i++) w.push(await wire(page, ids.Input[i], 'out', bg.id, `in${i}`));
    w.push(await wire(page, bg.id, 'out', ids.BusUngroup[0], 'in'));
    w.push(await wire(page, ids.BusUngroup[0], 'out0', ids.Lamp[0], 'in'));
    console.log('    连线:', JSON.stringify(w), ' links =', await page.evaluate(() => window.__sandboxPaper.model.getLinks().length));
    const lampOf = () => page.evaluate((id) => {
      const p = window.__sandboxPaper;
      const lv = p.model.getCell(id)?.findView(p)?.el?.querySelector?.('.led');
      const o = p.model.getCell(id)?.get('inputSignals'); const v = o?.in;
      return { led: lv ? getComputedStyle(lv).fill : null, in: v ? v.toString() : 'n/a' };
    }, ids.Lamp[0]);
    // 依次把 4 个输入全拨到 1（Vector3vl.concat 的位序决定哪个输入对应 out0，不预设）
    for (let i = 0; i < 4; i++) await clickBody(page, ids.Input[i]);
    const on = await lampOf();
    console.log('    全部拨到 1 后 灯:', JSON.stringify(on));
    for (let i = 0; i < 4; i++) await clickBody(page, ids.Input[i]);
    const off = await lampOf();
    console.log('    全部拨回 0 后 灯:', JSON.stringify(off));
    (/3, 192, 60|#03c03c/.test(on.led) && /252, 124, 104|#fc7c68/.test(off.led))
      ? ok('[2] 合总线→拆总线→灯：bit0 状态经总线正确传递', `${JSON.stringify(on)} → ${JSON.stringify(off)}`)
      : bad('[2] 总线链路传递失败', `${JSON.stringify(on)} → ${JSON.stringify(off)}`);

    // ===== [3] 切总线 =====
    console.log('\n===== [3] 切总线（取低 4 位）=====');
    await require('./_ui.cjs').newSandboxFile(page);
    const ids3 = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const c1 = new dj.cells.Constant({ type: 'Constant', constant: '10101010', position: { x: 150, y: 200 } }); p.model.addCell(c1);
      const s = new dj.cells.BusSlice({ type: 'BusSlice', slice: { first: 0, count: 4, total: 8 }, position: { x: 420, y: 200 } }); p.model.addCell(s);
      return { c1: c1.id, slice: s.id };
    });
    await sleep(400);
    const w3 = await wire(page, ids3.c1, 'out', ids3.slice, 'in');
    await sleep(900);
    const sliced = await page.evaluate((id) => {
      const p = window.__sandboxPaper;
      const o = p.model.getCell(id)?.get('outputSignals'); const v = o?.out;
      if (!v) return 'n/a';
      try { if (typeof v.toBigInt === 'function') { const b = v.toBigInt(); if (b != null && Number.isFinite(Number(b))) return String(b); } } catch (e) {}
      return v.toString();
    }, ids3.slice);
    console.log('    切总线输出 =', sliced, ' 连线:', JSON.stringify(w3));
    sliced === '10' ? ok('[3] 切总线取 10101010 的低 4 位 = 10（0b1010）', `out=${sliced}`)
                    : bad('[3] 切总线输出异常', `out=${sliced}`);

    // ===== [4] 持久化 =====
    console.log('\n===== [4] groups 持久化 =====');
    await require('./_ui.cjs').newSandboxFile(page);
    await realClickGate(page, 'BusGroup'); await sleep(400);
    await require('./_ui.cjs').busDialog(page, { total: 4, groupWidth: 1 });
    await page.locator('button[title^="保存"]').first().click();
    await sleep(800);
    await require('./_ui.cjs').boot(page, URL, { reload: true });
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    // ⚠ 重载后落在**默认视图**（电路/代码），沙盒不是能持久化的默认视图 —— 得由夹具自己
    // 再进一次。这里刻意不套 `enterSandbox`：它在读不到 paper 时会**新建文件**，
    // 那等于把「持久化」这颗判据的前置抹掉；这一格要的正是「活动文件被带回来」。
    await page.locator('button[data-activity="sandbox"]').click();
    const restored = await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!restored) bad('[4] 重载后合总线端口仍在（groups 持久化）', '重载后回到沙盒却没恢复出任何文件：活动文件没被带回来');
    else {
    const bg2 = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(x => x.get('type') === 'BusGroup');
      return c ? { ports: (c.getPorts?.() || []).map(x => x.id).sort() } : null;
    });
    console.log('    重载后 BusGroup:', JSON.stringify(bg2));
    (bg2 && ['in0','in1','in2','in3','out'].every(x => bg2.ports.includes(x)))
      ? ok('[4] 重载后合总线端口仍在（groups 持久化）', bg2.ports.join(','))
      : bad('[4] 重载后合总线端口丢失', JSON.stringify(bg2));
    }

    console.log('\n  pageerrors:', JSON.stringify(errors.slice(0, 4)));
    console.log(`\n===== R22 DONE: ${pass} pass, ${fail} fail =====`);
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); fail++; }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
