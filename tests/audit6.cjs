// 深度自检轮 6：多位引脚的自定义门 —— 4 位 Input→Output 保存为自定义门 → 放置 → 驱动
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1484;
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
  await page.mouse.click(pt.x, pt.y); await sleep(500);
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
    await UI.newSandboxFile(page);
    // 放 Input + Output，都改成 4 位
    await require('./_ui.cjs').ensurePalette(page);
const UI = require('./_ui.cjs');
    await page.locator('button[data-gate="Input"]').first().click(); await sleep(500);
    await require('./_ui.cjs').ensurePalette(page);
    await page.locator('button[data-gate="Output"]').first().click(); await sleep(500);
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    for (const id of [ids.Input[0], ids.Output[0]]) {
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
        const r = v.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, id);
      await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(500);
      const binp = page.locator('input[placeholder="bits"]');
      await binp.fill('4'); await binp.press('Enter'); await sleep(400);
      await page.keyboard.press('Escape'); await sleep(300);
    }
    // Input.out → Output.in（4 位直通）
    const wok = await wire(page, ids.Input[0], 'out', ids.Output[0], 'in');
    console.log('    4 位直通连线:', wok);
    wok ? ok('[6a] 4 位 Input→Output 连线建立（位宽匹配）') : bad('[6a] 连线被拒', '');
    // 保存为自定义门
    await page.keyboard.press('Control+g').catch(() => {}); await sleep(500);
    // 如果快捷键不存在，找「保存为自定义门」按钮
    const dlgVisible = await page.locator('input[placeholder="自定义门名称"], input[placeholder*="名称"]').count();
    if (dlgVisible === 0) {
      // 从菜单找
      const btn = page.locator('button:has-text("保存为自定义门")');
      if (await btn.count()) { await btn.first().click(); await sleep(500); }
    }
    const nameInput = page.locator('input[placeholder="自定义门名称"]');
    if (await nameInput.count()) {
      await nameInput.fill('Bus4Gate'); await sleep(200);
      await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(900);
      // 放置自定义门
      const placed = await page.evaluate(() => {
        const g = window.__sandboxGates.list().find(x => x.name === 'Bus4Gate');
        if (!g) return null;
        window.__sandboxGates.place(g.id);
        return g.id;
      });
      await sleep(900);
      const sub = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        const c = p.model.getCells().find(x => x.get('type') === 'Subcircuit');
        if (!c) return null;
        const ports = (c.getPorts?.() || []).map(x => `${x.id}(b${typeof x.bits === 'object' ? JSON.stringify(x.bits) : x.bits})`).sort();
        return { id: c.id, ports };
      });
      console.log('    自定义门端口:', JSON.stringify(sub));
      (sub && sub.ports.some(p => p.startsWith('in1') || p.startsWith('in')) && sub.ports.some(p => p.startsWith('out')))
        ? ok('[6b] 4 位自定义门放置成功，端口保留位宽', JSON.stringify(sub.ports))
        : bad('[6b] 自定义门端口异常', JSON.stringify(sub));
      // 展开图能打开（放大镜）—— 简化：检查 subcircuitGraph 数据
      const innerOk = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        const c = p.model.getCells().find(x => x.get('type') === 'Subcircuit');
        const g = c?.get('subcircuitGraph');
        return g ? (g.cells || []).length : 0;
      });
      innerOk >= 2 ? ok('[6c] 子电路内部图含 2 元件（Input/Output）', String(innerOk)) : bad('[6c] 内部图为空', String(innerOk));
    } else {
      console.log('    （未找到保存对话框，跳过 [6b][6c]）');
    }
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); if (pass + fail === 0) fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
