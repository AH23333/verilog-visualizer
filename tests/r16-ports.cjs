// R16 探针：量化「连线实际端点」与「组件端口圆心」的像素偏差（item: 端点偏移）
// 在真实渲染的 SVG 上测量：wire path 的首/末点 vs 端口 magnet 圆心的 paper-local 坐标差。
// 用法: node tests/r16-ports.cjs
const { spawn } = require('child_process');
const UI = require('./_ui.cjs');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1431;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickGate = async (page, label) => {
  await page.evaluate((l) => document.querySelector('button[data-gate="' + l + '"]')?.click(), label);
  await sleep(400);
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

    // 放置需要测量的部件（走真实侧栏入口）
    for (const t of ['Button', 'Lamp', 'And', 'Input', 'Output', 'Clock']) await clickGate(page, t);
    await sleep(500);

    // 拉开位置，避免重叠影响测量
    await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const order = ['Button', 'Lamp', 'And', 'Input', 'Output', 'Clock'];
      const seen = new Set();
      let i = 0;
      for (const c of p.model.getCells()) {
        const t = c.get('type');
        if (seen.has(t)) continue;
        if (!order.includes(t)) continue;
        seen.add(t);
        c.set('position', { x: 80, y: 40 + i * 90 });
        i++;
      }
    });
    await sleep(400);

    console.log('\n===== [A] 端口布局原始数据 =====');
    const layout = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const rows = [];
      for (const c of p.model.getCells()) {
        if (c.isLink && c.isLink()) continue;
        const v = c.findView(p);
        const ports = (c.getPorts ? c.getPorts() : []) || [];
        const pos = c.get('position'), size = c.size();
        for (const pt of ports) {
          const body = v && v.el.querySelector(`.joint-port-body[port="${pt.id}"]`);
          const circ = body && body.querySelector('circle');
          let center = null;
          if (circ) {
            const r = circ.getBoundingClientRect();
            const l = p.clientToLocalPoint(r.left + r.width / 2, r.top + r.height / 2);
            center = { x: +l.x.toFixed(1), y: +l.y.toFixed(1) };
          }
          rows.push({
            type: c.get('type'), port: pt.id, group: pt.group,
            cellPos: pos, cellSize: size,
            bodyTransform: body ? body.getAttribute('transform') : null,
            circleAttrs: circ ? { cx: circ.getAttribute('cx'), cy: circ.getAttribute('cy'), r: circ.getAttribute('r'), transform: circ.getAttribute('transform') } : null,
            circleCenterLocal: center,
            portsPositions: c.getPortsPositions ? JSON.parse(JSON.stringify(c.getPortsPositions(pt.group))) : null,
          });
        }
      }
      return rows;
    });
    for (const r of layout) console.log('  ', JSON.stringify(r));

    // 连线：Button.out→Lamp.in, Input.out→Output.in, Clock.out→And.in
    console.log('\n===== [B] 连线端点 vs 端口圆心 =====');
    const wired = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const dj = window.digitaljs;
      const find = (t) => p.model.getCells().find(c => c.get('type') === t);
      const btn = find('Button'), lamp = find('Lamp'), inp = find('Input'), outp = find('Output'), clk = find('Clock'), and = find('And');
      const andPorts = and.getPorts().filter(x => x.group === 'in');
      const pairs = [
        ['Button.out -> Lamp.in', btn, 'out', lamp, 'in'],
        ['Input.out -> Output.in', inp, 'out', outp, 'in'],
        ['Clock.out -> And.in', clk, 'out', and, andPorts[0] ? andPorts[0].id : 'in'],
      ];
      const made = [];
      for (const [label, s, sp, t, tp] of pairs) {
        if (!s || !t) { made.push({ label, err: 'missing cell' }); continue; }
        try {
          const w = new dj.cells.Wire({ source: { id: s.id, port: sp }, target: { id: t.id, port: tp }, signal: 'x', netname: 'W' + made.length });
          p.model.addCell(w);
          made.push({ label, ok: true });
        } catch (e) { made.push({ label, err: String(e) }); }
      }
      return made;
    });
    console.log('  wired:', JSON.stringify(wired));
    await sleep(700);

    const meas = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const rows = [];
      for (const l of p.model.getCells()) {
        if (!l.isLink || !l.isLink()) continue;
        const lv = l.findView(p);
        if (!lv || !lv.el) continue;
        const pathEl = lv.el.querySelector('path.connection') || lv.el.querySelector('.connection') || lv.el.querySelector('path');
        if (!pathEl) continue;
        const m = pathEl.getScreenCTM();
        const len = pathEl.getTotalLength();
        const toLocal = (pt) => {
          const sp = new DOMPoint(pt.x, pt.y).matrixTransform(m);
          const l2 = p.clientToLocalPoint(sp.x, sp.y);
          return { x: +l2.x.toFixed(1), y: +l2.y.toFixed(1) };
        };
        const sEnd = toLocal(pathEl.getPointAtLength(0));
        const tEnd = toLocal(pathEl.getPointAtLength(len));
        const portCenter = (cellId, portId) => {
          const cell = p.model.getCell(cellId);
          const v = cell && cell.findView(p);
          if (!v) return null;
          const body = v.el.querySelector(`.joint-port-body[port="${portId}"]`);
          const circ = body && body.querySelector('circle');
          if (!circ) return null;
          const r = circ.getBoundingClientRect();
          const l2 = p.clientToLocalPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { x: +l2.x.toFixed(1), y: +l2.y.toFixed(1) };
        };
        const sid = l.get('source').id, sp = l.get('source').port;
        const tid = l.get('target').id, tp = l.get('target').port;
        const sc = portCenter(sid, sp), tc = portCenter(tid, tp);
        rows.push({
          net: l.get('netname'),
          src: p.model.getCell(sid).get('type') + '.' + sp,
          srcPortCenter: sc, srcWireEnd: sEnd,
          srcDelta: sc ? { dx: +(sEnd.x - sc.x).toFixed(1), dy: +(sEnd.y - sc.y).toFixed(1) } : null,
          tgt: p.model.getCell(tid).get('type') + '.' + tp,
          tgtPortCenter: tc, tgtWireEnd: tEnd,
          tgtDelta: tc ? { dx: +(tEnd.x - tc.x).toFixed(1), dy: +(tEnd.y - tc.y).toFixed(1) } : null,
        });
      }
      return rows;
    });
    for (const r of meas) console.log('  ', JSON.stringify(r));

    console.log('\n  pageerrors:', JSON.stringify(errors.slice(0, 5)));
    await browser.close();
  } catch (e) {
    console.log('FATAL', String(e));
  } finally {
    try { server?.kill('SIGKILL'); } catch {}
    process.exit(0);
  }
})();
