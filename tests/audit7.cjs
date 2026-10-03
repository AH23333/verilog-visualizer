// 深度自检轮 7：含新器件的电路保存为自定义门 → 放置 → 展开图字段完整性
// （Constant 值 / BusGroup groups / Dff polarity 是否在 buildInnerGraph 重建时丢失）
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1482;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const menuClick = async (page, label, exact = true) => {
  const loc = exact ? page.locator(`button:text-is("${label}")`) : page.locator(`button:has-text("${label}")`);
  await loc.first().click(); await sleep(400);
};
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 150)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);

    // 构造：Input → Output（直通）；Constant('0101') → Lamp；BusGroup 单独放一个
    for (const t of ['Input', 'Output', 'Constant', 'Lamp', 'BusGroup']) await page.locator(`button[data-gate="${t}"]`).click().catch(() => {}); await sleep(500);
    // 设 Constant 值
    const cst = await page.evaluate(() => window.__sandboxPaper.model.getCells().find(c => c.get('type') === 'Constant')?.id);
    await page.evaluate((id) => { window.__sandboxPaper.model.getCell(id).set('constant', '0101'); }, cst);
    // 连线 Input→Output
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
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
    const w1 = await wire(page, ids.Input[0], 'out', ids.Output[0], 'in');
    const w2 = await wire(page, cst, 'out', ids.Lamp[0], 'in');
    console.log('    连线:', w1, w2);
    // 保存为自定义门
    const saveBtn = page.locator('button:has-text("保存为自定义门")');
    await saveBtn.first().click(); await sleep(500);
    await page.locator('input[placeholder="自定义门名称"]').fill('AuditGate');
    await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(900);
    // 放置
    const placed = await page.evaluate(() => {
      const g = window.__sandboxGates.list().find(x => x.name === 'AuditGate');
      if (!g) return null;
      window.__sandboxGates.place(g.id);
      return true;
    });
    await sleep(900);
    // 数据层断言：自定义门存档 JSON + 放置出的 Subcircuit 内部图
    const r = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const g = window.__sandboxGates.list().find(x => x.name === 'AuditGate');
      const savedJson = g ? g.graphJson : '';
      const saved = savedJson ? JSON.parse(savedJson) : { cells: [] };
      const savedConst = saved.cells.find(c => c.type === 'Constant');
      const savedBus = saved.cells.find(c => c.type === 'BusGroup');
      const sub = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
      const inner = sub ? JSON.parse(JSON.stringify(sub.get('subcircuitGraph'))) : { cells: [] };
      const innerConst = (inner.cells || []).find(c => c.type === 'Constant');
      const innerBus = (inner.cells || []).find(c => c.type === 'BusGroup');
      const busPorts = innerBus ? (function () {
        // 重建后端口在 cell.attrs？直接看存下的 ports
        return innerBus.ports ? (innerBus.ports.items || []).map(x => x.id).sort() : null;
      })() : null;
      return {
        savedConst: savedConst ? savedConst.constant : null,
        savedGroups: savedBus ? JSON.stringify(savedBus.groups) : null,
        innerConst: innerConst ? innerConst.constant : null,
        innerGroups: innerBus ? JSON.stringify(innerBus.groups) : null,
        innerBusPorts: busPorts,
        innerCells: (inner.cells || []).length,
      };
    });
    console.log('    数据:', JSON.stringify(r, null, 1));
    r.savedConst === '0101' ? ok('[7a] 存档里 Constant 值已保存', r.savedConst) : bad('[7a] 存档 Constant 丢失', String(r.savedConst));
    r.innerConst === '0101'
      ? ok('[7b] 展开图重建后 Constant 值保留', r.innerConst)
      : bad('[7b] 展开图重建丢失 Constant 值（预期缺陷）', `存档=${r.savedConst} 重建=${r.innerConst}`);
    r.innerGroups === r.savedGroups
      ? ok('[7c] 展开图重建后 BusGroup groups 保留', r.innerGroups)
      : bad('[7c] 展开图重建丢失/变形 BusGroup groups', `存档=${r.savedGroups} 重建=${r.innerGroups}`);
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); if (pass + fail === 0) fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
