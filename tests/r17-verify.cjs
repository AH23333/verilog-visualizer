// R17 验收：本轮 4 项修复
//  1) 切主题 / 切 Files-Modules-Hierarchy 后自定义部件不消失
//  2) 连线端点必须落在端口圆心（dx≈0）
//  3) 框选 + 右键菜单
//  4) 非法连接（两个开关接同一输入）必须被拒绝
// 用法: node tests/r17-verify.cjs
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1432;
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
const clickGate = async (page, label) => {
  await page.evaluate((l) => document.querySelector('button[data-gate="' + l + '"]')?.click(), label);
  await sleep(350);
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
  await page.locator('button[title="沙盒"]').click(); await sleep(800);
  await page.locator('button[title="新建文件"]').click(); await sleep(1200);
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
    page.on('pageerror', e => errors.push(String(e) + '\n' + String(e.stack || '').split('\n').slice(0, 6).join('\n')));
    await boot(page);

    // ---------- 准备：放置并定位部件 ----------
    for (const t of ['Or', 'Lamp', 'And', 'Input', 'Output', 'Clock']) await clickGate(page, t);
    await sleep(400);
    await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const order = ['Or', 'Lamp', 'And', 'Input', 'Output', 'Clock'];
      const seen = new Set(); let i = 0;
      for (const c of p.model.getCells()) {
        const t = c.get('type');
        if (seen.has(t) || !order.includes(t)) continue;
        seen.add(t);
        c.set('position', { x: 200, y: 140 + i * 95 });
        i++;
      }
    });
    await sleep(400);

    console.log('\n===== [1] 端口端点几何（连线端点 vs 端口圆心）=====');
    await page.evaluate(() => {
      const p = window.__sandboxPaper; const dj = window.digitaljs;
      const find = (t) => p.model.getCells().find(c => c.get('type') === t);
      const btn = find('Input'), lamp = find('Lamp'), inp = find('Input'), outp = find('Output'), clk = find('Clock'), and = find('And');
      const inPort = and.getPorts().filter(x => x.group === 'in')[0];
      const pairs = [[btn, 'out', lamp, 'in'], [inp, 'out', outp, 'in'], [clk, 'out', and, inPort.id]];
      let n = 0;
      for (const [s, sp, t, tp] of pairs) {
        if (!s || !t) continue;
        const w = new dj.cells.Wire({ source: { id: s.id, port: sp }, target: { id: t.id, port: tp }, signal: 'x', netname: 'W' + (n++) });
        p.model.addCell(w);
      }
    });
    await sleep(800);
    const geom = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const rows = [];
      for (const l of p.model.getLinks()) {
        const lv = l.findView(p); if (!lv || !lv.el) continue;
        const pathEl = lv.el.querySelector('path.connection');
        if (!pathEl) continue;
        const m = pathEl.getScreenCTM(); const len = pathEl.getTotalLength();
        const toLocal = (pt) => { const s = new DOMPoint(pt.x, pt.y).matrixTransform(m); const q = p.clientToLocalPoint(s.x, s.y); return { x: q.x, y: q.y }; };
        const sEnd = toLocal(pathEl.getPointAtLength(0));
        const tEnd = toLocal(pathEl.getPointAtLength(len));
        const pc = (id, port) => {
          const cell = p.model.getCell(id); const v = cell && cell.findView(p); if (!v) return null;
          const c = v.el.querySelector(`.joint-port-body[port="${port}"] circle`);
          if (!c) return null;
          const r = c.getBoundingClientRect(); const q = p.clientToLocalPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { x: q.x, y: q.y };
        };
        const s = l.get('source'), t = l.get('target');
        const sc = pc(s.id, s.port), tc = pc(t.id, t.port);
        const an = (v) => (v ? { x: +v.x.toFixed(1), y: +v.y.toFixed(1) } : null);
        rows.push({
          net: l.get('netname'),
          src: p.model.getCell(s.id).get('type') + '.' + s.port,
          srcDot: sc, srcAnchor: an(lv.sourceAnchor), srcPoint: an(lv.sourcePoint), srcWireEnd: { x: +sEnd.x.toFixed(1), y: +sEnd.y.toFixed(1) },
          srcDx: sc ? +(sEnd.x - sc.x).toFixed(1) : null,
          tgt: p.model.getCell(t.id).get('type') + '.' + t.port,
          tgtDot: tc, tgtAnchor: an(lv.targetAnchor), tgtPoint: an(lv.targetPoint), tgtWireEnd: { x: +tEnd.x.toFixed(1), y: +tEnd.y.toFixed(1) },
          tgtDx: tc ? +(tEnd.x - tc.x).toFixed(1) : null,
        });
      }
      return rows;
    });
    for (const r of geom) console.log('   ', JSON.stringify(r));
    const worst = geom.reduce((m, r) => Math.max(m, Math.abs(r.srcDx || 0), Math.abs(r.tgtDx || 0)), 0);
    worst <= 2 ? ok('[1] 连线端点落在端口圆心', `max |dx| = ${worst}px`) : bad('[1] 连线端点落在端口圆心', `max |dx| = ${worst}px（应 ≤2）`);

    // ---------- [2] 主题切换不丢部件 ----------
    console.log('\n===== [2] 切主题后部件保留 =====');
    const before = await page.evaluate(() => window.__sandboxPaper.model.getCells().length);
    await page.locator('button[title="主题"]').click(); await sleep(1200);
    const afterTheme = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return { cells: p ? p.model.getCells().length : -1, types: p ? p.model.getCells().map(c => c.get('type')) : [] };
    });
    console.log('    before cells =', before, ' after theme =', JSON.stringify(afterTheme));
    afterTheme.cells === before && afterTheme.types.includes('Input') && afterTheme.types.includes('Lamp')
      ? ok('[2] 切换主题后部件保留', `cells=${afterTheme.cells}`)
      : bad('[2] 切换主题后部件保留', `before=${before} after=${afterTheme.cells}`);

    // ---------- [3] 切 Files/Modules/Hierarchy 后回来部件保留 ----------
    console.log('\n===== [3] 切侧栏面板后部件保留 =====');
    for (const panel of ['文件', '模块', '层次结构']) {
      await page.locator(`button[title="${panel}"]`).click(); await sleep(700);
      await page.locator('button[title="沙盒"]').click(); await sleep(1400);
      const st = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        return p ? { cells: p.model.getCells().length, types: p.model.getCells().map(c => c.get('type')) } : { cells: -1, types: [] };
      });
      const kept = st.types.includes('Input') && st.types.includes('Lamp') && st.types.includes('Clock') && st.cells >= before;
      kept ? ok(`[3] 切到 ${panel} 再回来部件保留`, `cells=${st.cells}`)
           : bad(`[3] 切到 ${panel} 再回来部件保留`, `cells=${st.cells} types=${JSON.stringify(st.types)}`);
    }

    // ---------- [4] 框选 ----------
    console.log('\n===== [4] 框选 =====');
    const box = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const a = p.localToClientPoint(20, 20);
      const b = p.localToClientPoint(600, 800);
      return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
    });
    await page.mouse.move(box.a.x, box.a.y);
    await page.mouse.down();
    await page.mouse.move((box.a.x + box.b.x) / 2, (box.a.y + box.b.y) / 2, { steps: 5 });
    await page.mouse.move(box.b.x, box.b.y, { steps: 5 });
    await page.mouse.up();
    await sleep(500);
    const selDbg = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const ids = window.__sandboxSelection ? window.__sandboxSelection() : null;
      const cls = [...document.querySelectorAll('.sm-selected')].length;
      const perCell = p.model.getCells().filter(c => !c.isLink()).map(c => {
        const v = c.findView(p);
        return { t: c.get('type'), id: c.id, hasView: !!v, cls: v ? v.el.classList.contains('sm-selected') : null };
      });
      return {
        ids, idsLen: ids ? ids.length : -1, cls, perCell,
        domIds: [...document.querySelectorAll('[model-id]')].map(e => e.getAttribute('model-id')),
        inPaperEl: p.el ? p.el.querySelectorAll('[model-id]').length : -1,
        viewKeys: p.views ? Object.keys(p.views).length : -1,
        anchorCalls: window.__anchorCalls == null ? 'none' : window.__anchorCalls,
        modelIds: document.querySelectorAll('[model-id]').length,
        hosts: document.querySelectorAll('[data-sandbox-paper-host]').length,
        grids: document.querySelectorAll('[data-sandbox-grid]').length,
        paperElInDom: p.el ? document.contains(p.el) : null,
        paperIsWindow: p === window.__sandboxPaper,
      };
    });
    console.log('    框选诊断 =', JSON.stringify(selDbg));
    const selCount = selDbg.cls;
    selCount >= 6 ? ok('[4] 框选选中全部部件', `selected=${selCount}`) : bad('[4] 框选选中全部部件', `selected=${selCount}（期望 ≥6）`);

    // 框选后 Delete 清空
    await page.keyboard.press('Delete'); await sleep(400);
    const afterDel = await page.evaluate(() => window.__sandboxPaper.model.getCells().filter(c => !c.isLink()).length);
    afterDel === 0 ? ok('[4b] 框选后 Delete 批量删除', `cells=${afterDel}`) : bad('[4b] 框选后 Delete 批量删除', `cells=${afterDel}`);

    // ---------- [5] 右键菜单 ----------
    console.log('\n===== [5] 右键菜单 =====');
    await clickGate(page, 'And'); await sleep(500);
    const cellPt = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(x => x.get('type') === 'And');
      const v = c.findView(p);
      const body = v.el.querySelector('.body, .gate, .btnface, .led') || v.el;
      const r = body.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(cellPt.x, cellPt.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await sleep(500);
    const menuText = await page.evaluate(() => {
      const m = [...document.querySelectorAll('div')].find(d => (d.className || '').includes('min-w-[280px]'));
      return m ? m.textContent : null;
    });
    console.log('    menu =', JSON.stringify(menuText));
    menuText && /删除/.test(menuText) && /创建副本/.test(menuText)
      ? ok('[5] 部件右键菜单弹出', String(menuText).slice(0, 40))
      : bad('[5] 部件右键菜单弹出', String(menuText));
    await page.keyboard.press('Escape'); await sleep(300);

    // ---------- [6] 非法连接被拒绝 ----------
    console.log('\n===== [6] 非法连接（两开关接同一输入）=====');
    for (const t of ['Input', 'Input', 'Lamp']) await clickGate(page, t);
    await sleep(500);
    const coords = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const btns = p.model.getCells().filter(c => c.get('type') === 'Input');
      const lamp = p.model.getCells().find(c => c.get('type') === 'Lamp');
      const btnIds = btns.map((b, i) => { b.set('position', { x: 150, y: 150 + i * 120 }); return b.id; });
      lamp.set('position', { x: 520, y: 210 });
      return {
        btnIds, lampId: lamp.id,
        allTypes: p.model.getCells().map(c => c.get('type')),
        viewOk: p.model.getCells().filter(c => !c.isLink()).map(c => ({ t: c.get('type'), v: !!c.findView(p) })),
      };
    });
    console.log('    coords =', JSON.stringify(coords));
    await sleep(600);
    const dragWire = async (srcId, srcPort, tgtId, tgtPort) => {
      const pts = await page.evaluate(([s, sp, t, tp]) => {
        const p = window.__sandboxPaper;
        const pc = (id, port) => {
          const cell = p.model.getCell(id);
          const v = cell.findView(p);
          if (!v) return { err: `no view for ${id}` };
          const c = v.el.querySelector(`.joint-port-body[port="${port}"] circle`);
          if (!c) return { err: `no port ${port} on ${cell.get('type')}; bodies=${v.el.querySelectorAll('.joint-port-body').length}` };
          const r = c.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };
        return { a: pc(s, sp), b: pc(t, tp) };
      }, [srcId, srcPort, tgtId, tgtPort]);
      if (pts.a.err || pts.b.err) { console.log('    dragWire 跳过:', JSON.stringify(pts)); return; }
      await page.mouse.move(pts.a.x, pts.a.y);
      await page.mouse.down();
      await page.mouse.move((pts.a.x + pts.b.x) / 2, (pts.a.y + pts.b.y) / 2, { steps: 5 });
      await page.mouse.move(pts.b.x, pts.b.y, { steps: 5 });
      await page.mouse.up();
      await sleep(600);
    };
    await dragWire(coords.btnIds[0], 'out', coords.lampId, 'in');
    const l1 = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
    await dragWire(coords.btnIds[1], 'out', coords.lampId, 'in');
    const l2 = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
    const toastText = await page.evaluate(() => {
      const t = [...document.querySelectorAll('div')].find(d => /^连接被拒绝/.test(d.textContent || '') && d.style.position === 'absolute');
      return t ? t.textContent : null;
    });
    console.log('    第一条线后 links =', l1, ' 第二条线后 links =', l2, ' toast =', JSON.stringify(toastText));
    (l1 === 1 && l2 === 1) ? ok('[6] 第二个开关接同一输入被拒绝', `links 保持 ${l2}`)
                           : bad('[6] 第二个开关接同一输入被拒绝', `links=${l2}（期望 1）`);
    !!toastText ? ok('[6b] 给出拒绝原因提示', String(toastText).slice(0, 50)) : bad('[6b] 给出拒绝原因提示', 'no toast');

    console.log('\n  pageerrors:', JSON.stringify(errors.slice(0, 5)));
    console.log(`\n===== R17 DONE: ${pass} pass, ${fail} fail =====`);
    await browser.close();
  } catch (e) {
    console.log('FATAL', String(e));
    fail++;
  } finally {
    try { server?.kill('SIGKILL'); } catch {}
    process.exit(0);
  }
})();
