// R14 沙盒坐标换算验收：缩放/平移后，拖拽部件与连线游离端必须按「模型坐标」1:1 跟随光标，
// 不能按屏幕像素直接叠加（否则放大后部件位移 = 缩放倍数 × 鼠标位移，连线另一端大幅跳动）。
// 根因：此前用 `evt.clientX - rect.left`（屏幕像素）当模型坐标，仅在 scale=1/translate=0 成立。
// 修复：统一改用 paper.clientToLocalPoint(...)。
// 用法: node tests/r14-coords.cjs
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1427;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1427)); } catch { }
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
const ok = (n, m = '') => { results.pass++; console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`); };
const bad = (n, m = '') => { results.fail++; console.log(`  FAIL  ${n}${m ? ' — ' + m : ''}`); };

async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickGate = (page, label) => require('./_ui.cjs').clickGate(page, label);   // 旧的本地版用 ?.click() 静默空转
// 关闭「吸附到网格」：否则拖拽终点会被量化到网格整数倍（60→64），测不出纯坐标换算精度。
// 精确定位：取文本恰为「吸附到网格」的叶子 div，其父的下一个兄弟里就是开关按钮。
async function disableSnap(page) {
  await page.evaluate(() => document.querySelector('button[data-sandbox-settings]')?.click());
  await sleep(700);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '沙盒'); b?.click(); });
  await sleep(400);
  await page.evaluate(() => {
    const raw = localStorage.getItem('verilog-viz-sandbox-settings');
    const cur = raw ? JSON.parse(raw).snapToGrid : true; // 未写入即默认 true
    if (cur === false) return;
    const label = [...document.querySelectorAll('div')].find(d => d.children.length === 0 && d.textContent?.trim() === '吸附到网格');
    label?.parentElement?.nextElementSibling?.querySelector('button')?.click();
  });
  await sleep(500);
  await page.keyboard.press('Escape'); await sleep(400);
  const after = await page.evaluate(() => {
    const raw = localStorage.getItem('verilog-viz-sandbox-settings');
    return raw ? JSON.parse(raw).snapToGrid : null;
  });
  if (after !== false) console.log('    !! 警告：吸附未关闭，测量结果可能被量化');
  return after;
}
// 取某类型 cell 的「body 中心」屏幕坐标（用于拖拽，避开端口 magnet）
const bodyCenter = async (page, type) => page.evaluate((t) => {
  const el = [...document.querySelectorAll('[model-id]')].find(e => e.getAttribute('data-type') === t);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, modelId: el.getAttribute('model-id') };
}, type);
// 取某类型 cell 的指定端口（magnet）屏幕坐标（用于起线）
const portCenter = async (page, type, port) => page.evaluate(({ type, port }) => {
  const cells = [...document.querySelectorAll('[model-id]')];
  for (const el of cells) {
    if (el.getAttribute('data-type') !== type) continue;
    for (const m of [...el.querySelectorAll('[magnet]')].filter(m => m.getAttribute('magnet') !== 'false')) {
      const pb = m.closest('.joint-port-body');
      if (pb?.getAttribute('port') === port) {
        const r = m.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
  }
  return null;
}, { type, port });
async function boot(page) {
  // ⚠ 不用 networkidle：dev 服务器上首页 37 条脚本 + HMR WebSocket 让网络永不空闲，
  // 实测 r14 就是这么 `page.goto: Timeout 30000ms exceeded` → exit=2 整片红（夹具病）。
  // 就绪判据改成「确实画出界面骨架」。口径同 _ui.cjs 的 boot()。
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('button[data-activity]'), null, { timeout: 30000 });
  await page.evaluate(() => {
    localStorage.removeItem('verilog-viz-sandbox-files');
    localStorage.removeItem('verilog-viz-sandbox-active');
    localStorage.removeItem('verilog-viz-sandbox-gates');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('button[data-activity]'), null, { timeout: 30000 });
  await sleep(1200);
  try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
  await require('./_ui.cjs').newSandboxFile(page);
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

    // ===== Phase 1: 缩放后拖拽部件，模型位移 = 屏幕位移 / scale =====
    console.log('[1] Component drag under zoom (scale=2)');
    await boot(page);
    await disableSnap(page);   // 排除网格吸附量化，测量纯坐标换算
    await clickGate(page, 'Input'); await sleep(300);   // Input 有可拖拽 body
    const before = await page.evaluate(() => {
      const c = window.__sandboxPaper.model.getCells().find(c => c.get('type') === 'Input');
      const p = c.position();
      return { x: p.x, y: p.y };
    });
    await page.evaluate(() => window.__sandboxPaper.scale(2));   // 模拟放大
    await sleep(150);
    // 在 body 元素上直接派发冒泡 mousedown（headless 下基于坐标的 Playwright mouse 在缩放后
    // 命中不到 paper 委托监听；直接派发可触发真实的 cell:pointerdown → 拖拽分支）。
    const drag = await page.evaluate(({ dx, dy }) => {
      const p = window.__sandboxPaper;
      const el = [...document.querySelectorAll('[model-id]')].find(e => e.getAttribute('data-type') === 'Input');
      const body = el.querySelector('[magnet="false"]') || el.querySelector('rect');
      const r = body.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const fire = (type, x, y, target) => target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0,
      }));
      fire('mousedown', cx, cy, body);
      fire('mousemove', cx + dx, cy + dy, document);
      fire('mouseup', cx + dx, cy + dy, document);
      const c = p.model.getCells().find(c => c.get('type') === 'Input');
      const pos = c.position();
      return { x: pos.x, y: pos.y };
    }, { dx: 120, dy: 0 });
    await sleep(150);
    const modelDx = drag.x - before.x;
    const expected = 120 / 2;   // scale=2 → 模型位移应为屏幕位移的一半
    // 修复后：60；修复前（bug）：~120。已关闭吸附，容差可收紧（不再受 16px 量化影响）
    (modelDx > expected - 2 && modelDx < expected + 2)
      ? ok('drag tracks 1:1 in model space (scale=2)', `modelΔx=${modelDx.toFixed(1)} ≈ ${expected}`)
      : bad('drag displacement inflated by zoom', `modelΔx=${modelDx.toFixed(1)} expected≈${expected}`);
    await page.evaluate(() => window.__sandboxPaper.scale(1)); await sleep(100);

    // ===== Phase 2: 缩放 + 平移后，连线游离端贴合光标（模型坐标）=====
    console.log('[2] Wire loose-end tracks cursor under zoom+pan (scale=2, translate=50,30)');
    await require('./_ui.cjs').newSandboxFile(page);
    await clickGate(page, 'Input'); await clickGate(page, 'Output'); await sleep(300);
    await page.evaluate(() => { window.__sandboxPaper.scale(2); window.__sandboxPaper.translate(50, 30); });
    await sleep(150);
    const observed = await page.evaluate(({ offX, offY }) => {
      const p = window.__sandboxPaper;
      const cell = [...document.querySelectorAll('[model-id]')].find(e => e.getAttribute('data-type') === 'Input');
      // 找到 Input 的 out 端口（magnet 且非 false）
      let port = null;
      for (const m of cell.querySelectorAll('[magnet]')) {
        if (m.getAttribute('magnet') === 'false') continue;
        const pb = m.closest('.joint-port-body');
        if (pb?.getAttribute('port') === 'out') { port = m; break; }
      }
      if (!port) return { err: 'no out port' };
      const r = port.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const tx = cx + offX, ty = cy + offY;
      const fire = (type, x, y, target) => target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0,
      }));
      fire('mousedown', cx, cy, port);          // 起线
      fire('mousemove', tx, ty, document);      // 拖动游离端到屏幕 (tx,ty)
      const links = p.model.getLinks();
      const temp = links[links.length - 1];
      if (!temp) return { err: 'no temp link', links: links.length };
      const t = temp.get('target');
      const exp = p.clientToLocalPoint(tx, ty); // 真实期望模型坐标
      fire('mouseup', tx, ty, document);        // 不接端口 → 临时线被移除
      return { tx: t.x, ty: t.y, ex: exp.x, ey: exp.y };
    }, { offX: 200, offY: 120 });
    if (observed.err) { bad('wire loose-end test', observed.err); }
    else {
      const dx = Math.abs(observed.tx - observed.ex), dy = Math.abs(observed.ty - observed.ey);
      (dx < 2 && dy < 2)
        ? ok('wire loose-end = cursor model coord (no inflate)', `Δ=(${dx.toFixed(1)},${dy.toFixed(1)})`)
        : bad('wire loose-end displaced by zoom/pan', `target=(${observed.tx.toFixed(1)},${observed.ty.toFixed(1)}) expected=(${observed.ex.toFixed(1)},${observed.ey.toFixed(1)}) Δ=(${dx.toFixed(1)},${dy.toFixed(1)})`);
    }
    await page.evaluate(() => { window.__sandboxPaper.scale(1); window.__sandboxPaper.translate(0, 0); });

    (errors.length === 0) ? ok('no pageerror') : bad('pageerror', errors.slice(0, 3).join(' | '));

    console.log(`\nR14 结果: ${results.pass} PASS / ${results.fail} FAIL`);
    await browser.close(); server.kill('SIGTERM');
    process.exit(results.fail ? 1 : 0);
  } catch (e) {
    console.error('FATAL', e);
    try { server && server.kill('SIGTERM'); } catch {}
    process.exit(2);
  }
})();
