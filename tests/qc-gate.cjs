// 复现：1) 逻辑门是否产生输出  2) 自定义门展开图是否为空
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1471;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickGate = async (page, l) => { await page.evaluate((x) => document.querySelector('button[data-gate="' + x + '"]')?.click(), l); await sleep(400); };
const portCenter = (page, id, port) => page.evaluate(({ id, port }) => {
  const p = window.__sandboxPaper;
  const c = p.model.getCell(id);
  const v = c?.findView(p); if (!v) return null;
  const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { id, port });
async function wire(page, sId, sPort, tId, tPort) {
  const a = await portCenter(page, sId, sPort); const b = await portCenter(page, tId, tPort);
  if (!a || !b) return false;
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(120);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await sleep(80);
  await page.mouse.move(b.x, b.y, { steps: 5 }); await sleep(200); await page.mouse.up(); await sleep(450);
  return true;
}
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => console.log('PAGEERR', String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);

    // ===== 1) 与门：两个按钮 -> 与门 -> 指示灯 =====
    console.log('===== [1] 与门是否产生输出 =====');
    await clickGate(page, 'Button'); await clickGate(page, 'Button');
    await clickGate(page, 'And'); await clickGate(page, 'Lamp'); await sleep(500);
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => {
        const t = c.get('type');
        (by[t] = by[t] || []).push(c.id);
      });
      return by;
    });
    console.log('    部件:', JSON.stringify(ids));
    const andId = ids.And?.[0], lampId = ids.Lamp?.[0];
    const inPorts = await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).getPorts().filter(p => p.group === 'in').map(p => p.id), andId);
    console.log('    与门输入端口:', JSON.stringify(inPorts));
    await wire(page, ids.Button[0], 'out', andId, inPorts[0]);
    await wire(page, ids.Button[1], 'out', andId, inPorts[1]);
    await wire(page, andId, 'out', lampId, 'in');
    const links = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
    console.log('    links =', links);

    const readAnd = () => page.evaluate((id) => {
      const c = window.__sandboxPaper.model.getCell(id);
      const o = c.get('outputSignals'); const v = o?.out;
      const i = c.get('inputSignals');
      return { out: v ? v.toString() : 'n/a', in: i ? Object.fromEntries(Object.entries(i).map(([k, x]) => [k, x && x.toString ? x.toString() : x])) : null };
    }, andId);
    const readLamp = () => page.evaluate((id) => {
      const p = window.__sandboxPaper; const l = p.model.getCell(id);
      const v = l?.findView(p)?.el?.querySelector?.('.led');
      return v ? getComputedStyle(v).fill : null;
    }, lampId);
    console.log('    连线后 与门:', JSON.stringify(await readAnd()), ' 灯:', await readLamp());

    // 点亮两个按钮（真实点击 Button 部件）
    for (const bId of ids.Button) {
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const c = p.model.getCell(id); const v = c.findView(p);
        const b = v.el.querySelector('.body') || v.el; const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, bId);
      await page.mouse.click(pt.x, pt.y); await sleep(500);
    }
    console.log('    两个按钮都按下后 与门:', JSON.stringify(await readAnd()), ' 灯:', await readLamp());

    // ===== 2) 自定义门展开图内容 =====
    console.log('\n===== [2] 自定义门展开图内容 =====');
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    await clickGate(page, 'Input'); await clickGate(page, 'Output'); await sleep(400);
    const io = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    await wire(page, io.Input[0], 'out', io.Output[0], 'in');
    await page.locator('button[title^="将当前电路保存为自定义门"]').click(); await sleep(400);
    await page.fill('input[placeholder="自定义门名称"]', 'G1'); await sleep(200);
    await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(700);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    await page.evaluate(() => { const g = window.__sandboxGates.list()[0]; if (g) window.__sandboxGates.place(g.id); });
    await sleep(900);
    const zoomPt = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const s = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
      const v = s.findView(p); const a = v.el.querySelector('a.zoom');
      const r = a.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(zoomPt.x, zoomPt.y); await sleep(1200);
    const modal = await page.evaluate(() => {
      const span = [...document.querySelectorAll('span')].find(s => /^内部电路：/.test(s.textContent?.trim() || ''));
      let root = span;
      while (root && !root.innerText?.includes('只读视图')) root = root.parentElement;
      return {
        opened: !!span,
        jointCells: document.querySelectorAll('.joint-cell').length,
        inModal: root ? root.querySelectorAll('.joint-cell').length : -1,
        modalText: root ? root.innerText.replace(/\n/g, ' | ').slice(0, 160) : null,
      };
    });
    console.log('    展开图:', JSON.stringify(modal));
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
