// R15 探针：在真实渲染的 SVG 里量化沙盒问题（不判定 PASS/FAIL，只打印测量值）
// 覆盖：网格是否存在、body↔port 间隙（item2）、连线端点是否落在 port 中心（item3）、
// 选中高亮是否生效（item5）、连线能否被选中/删除（item6）、reset 后是否丢属性。
// 用法: node tests/r15-probe.cjs
const { spawn } = require('child_process');
const UI = require('./_ui.cjs');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1429;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickGate = async (page, label) => {
  await page.evaluate((l) => document.querySelector('button[data-gate="' + l + '"]')?.click(), label);
  await sleep(450);
};
async function boot(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.removeItem('verilog-viz-sandbox-files');
    localStorage.removeItem('verilog-viz-sandbox-active');
    localStorage.removeItem('verilog-viz-sandbox-gates');
  });
  await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
  try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
  await UI.newSandboxFile(page);
}
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
    await boot(page);

    console.log('\n===== [A] GRID =====');
    const grid = await page.evaluate(() => {
      const layers = [...document.querySelectorAll('[data-sandbox-grid]')];
      const g = layers[0];
      const cs = g ? getComputedStyle(g) : null;
      const host = document.querySelector('[data-sandbox-paper-host]');
      const hostCs = host ? getComputedStyle(host) : null;
      return {
        gridLayerCount: layers.length,
        hasGridLayer: !!g,
        inlineHasMesh: g ? /linear-gradient/.test(g.style.backgroundImage) : false,
        computedImage: cs ? cs.backgroundImage.slice(0, 60) : null,
        computedSize: cs ? cs.backgroundSize : null,
        hasMeshComputed: cs ? /linear-gradient/.test(cs.backgroundImage) : false,
        hostBgImage: hostCs ? hostCs.backgroundImage.slice(0, 30) : null,
        hostBgColor: hostCs ? hostCs.backgroundColor : null,
      };
    });
    console.log('  grid:', JSON.stringify(grid));

    console.log('\n===== [B] ITEM2: body ↔ port gap (Input) =====');
    await clickGate(page, 'Input'); await clickGate(page, 'Output'); await sleep(400);
    const meas = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const out = p.model.getCells().find(c => c.get('type') === 'Output');
      const inp = p.model.getCells().find(c => c.get('type') === 'Input');
      const report = {};
      for (const [name, cell] of [['Input', inp], ['Output', out]]) {
        const v = cell.findView(p);
        const size = cell.size();
        const pos = cell.position();
        const portId = name === 'Input' ? 'out' : 'in';
        // 端口圆圈（局部 SVG 坐标，需 + pos）
        const portBody = v.el.querySelector('.joint-port-body');
        const circ = portBody ? portBody.querySelector('circle') : null;
        let portCx = null, portCy = null;
        if (circ) { portCx = +circ.getAttribute('cx') + pos.x; portCy = +circ.getAttribute('cy') + pos.y; }
        // body 选择器：btnface(Input) / led(Output)
        const bodyEl = v.el.querySelector('.btnface, .led, [joint-selector="btnface"], [joint-selector="led"]');
        const bodyBBox = bodyEl ? (() => { const b = bodyEl.getBBox(); return { x: b.x + pos.x, y: b.y + pos.y, w: b.width, h: b.height }; })() : null;
        report[name] = { size, pos, portId, portCx, portCy, bodyBBox };
      }
      return report;
    });
    console.log('  meas:', JSON.stringify(meas, null, 2));

    console.log('\n===== [C] ITEM3: wire endpoint vs port center =====');
    const connect = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const inp = p.model.getCells().find(c => c.get('type') === 'Input');
      const out = p.model.getCells().find(c => c.get('type') === 'Output');
      const iv = inp.findView(p), ov = out.findView(p);
      const portCircle = (cell, portId) => {
        const v = cell.findView(p);
        const pb = v.el.querySelector('.joint-port-body');
        const c = pb.querySelector('circle');
        const pos = cell.position();
        return { x: +c.getAttribute('cx') + pos.x, y: +c.getAttribute('cy') + pos.y };
      };
      const sp = portCircle(inp, 'out'), tp = portCircle(out, 'in');
      const Wire = window.digitaljs.cells.Wire;
      const link = new Wire({ source: { id: inp.id, port: 'out' }, target: { id: out.id, port: 'in' }, signal: 'x', netname: 'Nprobe' });
      p.model.addCell(link);
      const sp2 = link.getSourcePoint(), tp2 = link.getTargetPoint();
      const dIn = Math.hypot(sp2.x - sp.x, sp2.y - sp.y);
      const dOut = Math.hypot(tp2.x - tp.x, tp2.y - tp.y);
      return {
        sourcePortCenter: sp, wireSourcePoint: { x: sp2.x, y: sp2.y }, dIn: +dIn.toFixed(2),
        targetPortCenter: tp, wireTargetPoint: { x: tp2.x, y: tp2.y }, dOut: +dOut.toFixed(2),
      };
    });
    console.log('  connect:', JSON.stringify(connect, null, 2));

    console.log('\n===== [D] ITEM5: selection highlight =====');
    const sel = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const inp = p.model.getCells().find(c => c.get('type') === 'Input');
      const v = inp.findView(p);
      // 模拟 clicking body: 触发我们的 cell:pointerdown（body 分支）
      const evt = new MouseEvent('mousedown', { bubbles: true, clientX: 200, clientY: 200 });
      const bodyEl = v.el.querySelector('[joint-selector="btnface"], .btnface, [joint-selector="body"], .body');
      bodyEl.dispatchEvent(evt);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      const after = {
        attrBodyStroke: inp.attr('body/stroke'),
        elClass: v.el.getAttribute('class'),
        hasSmSelected: v.el.classList.contains('sm-selected'),
      };
      return after;
    });
    console.log('  sel:', JSON.stringify(sel));

    console.log('\n===== [E] ITEM6: wire select + delete =====');
    const wdel = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const link = p.model.getLinks().find(l => l.get('netname') === 'Nprobe');
      // 触发 link:pointerdown
      let linkHandlerFired = false;
      const lv = link.findView(p);
      const evt = new MouseEvent('mousedown', { bubbles: true, clientX: 400, clientY: 300 });
      let fired = false;
      p.once('link:pointerdown', () => { fired = true; });
      lv.el.dispatchEvent(evt);
      const before = p.model.getLinks().length;
      const lid = link.id;
      // 模拟 Delete
      const ke = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true });
      document.dispatchEvent(ke);
      const after = p.model.getLinks().length;
      return { linkPointerdownFired: fired, linksBefore: before, linksAfter: after, removed: !p.model.getCell(lid) };
    });
    console.log('  wdel:', JSON.stringify(wdel));

    console.log('\n===== [F] ITEM1: reset 后是否丢属性 =====');
    // 先给 Input 设 net/label，再 reset，看是否保留
    const beforeReset = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const inp = p.model.getCells().find(c => c.get('type') === 'Input');
      if (!inp) return { missing: true };
      inp.set('net', 'inX'); inp.set('label', 'LBL');
      return { net: inp.get('net'), label: inp.get('label'), size: inp.size() };
    });
    console.log('  beforeReset:', JSON.stringify(beforeReset));
    if (!beforeReset.missing) {
      await page.locator('button[title="复位仿真"]').click(); await sleep(1500);
      const afterReset = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        const inp = p.model.getCells().find(c => c.get('type') === 'Input');
        return inp ? { net: inp.get('net'), label: inp.get('label'), size: inp.size(), exists: true } : { exists: false };
      });
      console.log('  afterReset :', JSON.stringify(afterReset));
    }

    console.log('\n===== errors =====');
    console.log('  pageerrors:', JSON.stringify(errors));

  } finally {
    if (browser) await browser.close();
    if (server) try { server.kill('SIGTERM'); } catch {}
  }
})();
