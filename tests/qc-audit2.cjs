// QC 审计 v2：修正 v1 的两个缺陷后重测
//  v1 缺陷1：[A] 靠「向上找祖先文本」定位开关 → 走到含所有设置行的容器，关错了开关（吸附其实没关）
//            修正：精确定位 label 文本为「吸附到网格」的那一行，并用 localStorage 直接核验 snapToGrid 真的 false
//  v1 缺陷2：[B2] 切主题前没放部件，测的是 0->0（空洞断言）
//            修正：先放 3 个部件再切主题
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1442;
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
  await sleep(400);
};
async function boot(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k));
  });
  await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
  try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
  await page.locator('button[title="沙盒"]').click(); await sleep(800);
  await page.locator('button[title="新建文件"]').click(); await sleep(1200);
}
const snapFlag = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('verilog-viz-sandbox-settings');
  return raw ? JSON.parse(raw).snapToGrid : '(未写入，用默认 true)';
});
async function dragUnderZoom(page) {
  const before = await page.evaluate(() => {
    const c = window.__sandboxPaper.model.getCells().find(c => c.get('type') === 'Input');
    return c ? { x: c.position().x, y: c.position().y } : null;
  });
  if (!before) return { err: 'no Input cell' };
  await page.evaluate(() => window.__sandboxPaper.scale(2));
  await sleep(150);
  const after = await page.evaluate(() => {
    const p = window.__sandboxPaper;
    const el = [...document.querySelectorAll('[model-id]')].find(e => e.getAttribute('data-type') === 'Input');
    if (!el) return null;
    const body = el.querySelector('[magnet="false"]') || el.querySelector('rect');
    const r = body.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const fire = (type, x, y, target) => target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0,
    }));
    fire('mousedown', cx, cy, body);
    fire('mousemove', cx + 120, cy, document);
    fire('mouseup', cx + 120, cy, document);
    const c = p.model.getCells().find(c => c.get('type') === 'Input');
    const pos = c.position();
    return { x: pos.x, y: pos.y };
  });
  await page.evaluate(() => window.__sandboxPaper.scale(1));
  if (!after) return { err: 'drag failed' };
  return { beforeX: before.x, afterX: after.x, modelDx: after.x - before.x, mod16: after.x % 16 };
}
// 精确定位「吸附到网格」那一行的开关并切换
async function setSnap(page, want) {
  await page.evaluate(() => document.querySelector('button[data-sandbox-settings]')?.click());
  await sleep(700);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '沙盒'); b?.click(); });
  await sleep(400);
  const before = await snapFlag(page);
  if (before !== want) {
    const clicked = await page.evaluate(() => {
      const label = [...document.querySelectorAll('div')].find(d => d.children.length === 0 && d.textContent?.trim() === '吸附到网格');
      const btn = label?.parentElement?.nextElementSibling?.querySelector('button');
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!clicked) console.log('    !! 未能定位到「吸附到网格」开关');
    await sleep(500);
  }
  await page.keyboard.press('Escape'); await sleep(400);
  const after = await snapFlag(page);
  return { before, after };
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

    // ================= A) 吸附假说：精确验证 =================
    console.log('\n===== [A] R14[1] 放宽容差是否掩盖真实 bug（精确定位开关）=====');
    await clickGate(page, 'Input'); await sleep(300);
    console.log('    默认 snapToGrid =', await snapFlag(page));
    const d1 = await dragUnderZoom(page);
    console.log('    吸附开启:', JSON.stringify(d1));
    const snapped = d1.mod16 === 0;
    console.log(`    modelΔx=${d1.modelDx} 终点=${d1.afterX}（%16=${d1.mod16}）→ 被吸附到网格=${snapped}`);
    snapped && d1.modelDx !== 60
      ? ok('[A1] 60 被量化成 64 确实源于网格吸附', `终点落在 16 的整数倍`)
      : bad('[A1] 吸附假说不成立', JSON.stringify(d1));

    const r = await setSnap(page, false);
    console.log('    切换 snapToGrid:', JSON.stringify(r));
    if (r.after !== false) { bad('[A2] 吸附未能真正关闭，后续结论不可信', JSON.stringify(r)); }
    else {
      await page.evaluate(() => {
        const c = window.__sandboxPaper.model.getCells().find(x => x.get('type') === 'Input');
        if (c) c.set('position', { x: 200, y: 200 });
      });
      await sleep(300);
      const d2 = await dragUnderZoom(page);
      console.log('    吸附关闭:', JSON.stringify(d2));
      const exact = Math.abs(d2.modelDx - 60) <= 1 && d2.mod16 !== 0;
      exact ? ok('[A2] 关掉吸附后位移精确为 60 且不再量化（坐标换算正确，容差放宽合理）', `modelΔx=${d2.modelDx} 终点=${d2.afterX}(%16=${d2.mod16})`)
            : bad('[A2] 关掉吸附后仍偏离 60 或仍在量化 —— 存在真实坐标 bug', `modelΔx=${d2.modelDx} 终点=${d2.afterX}(%16=${d2.mod16})`);
    }

    // ================= B) 切主题（先放部件，再切）=================
    console.log('\n===== [B] 切主题：网格重绘 + 部件保留（先放置部件）=====');
    await page.locator('button[title="新建文件"]').click(); await sleep(1200);
    await clickGate(page, 'Button'); await clickGate(page, 'Lamp'); await clickGate(page, 'And'); await sleep(500);
    const cellsBefore = await page.evaluate(() => window.__sandboxPaper.model.getCells().map(c => c.get('type')));
    const gridBefore = await page.evaluate(() => {
      const g = document.querySelector('[data-sandbox-grid]');
      return g ? getComputedStyle(g).backgroundImage : null;
    });
    await page.locator('button[title="主题"]').click(); await sleep(1200);
    const cellsAfter = await page.evaluate(() => window.__sandboxPaper.model.getCells().map(c => c.get('type')));
    const gridAfter = await page.evaluate(() => {
      const g = document.querySelector('[data-sandbox-grid]');
      return g ? getComputedStyle(g).backgroundImage : null;
    });
    console.log('    部件 before =', JSON.stringify(cellsBefore), ' after =', JSON.stringify(cellsAfter));
    console.log('    网格颜色变化:', String(gridBefore).slice(0, 60), '->', String(gridAfter).slice(0, 60));
    (cellsBefore.length >= 3 && cellsAfter.length === cellsBefore.length && cellsAfter.includes('Button') && cellsAfter.includes('Lamp'))
      ? ok('[B1] 切主题后部件真实保留', `${cellsBefore.length} 个 -> ${cellsAfter.length} 个`)
      : bad('[B1] 切主题后部件丢失', `${JSON.stringify(cellsBefore)} -> ${JSON.stringify(cellsAfter)}`);
    (gridBefore && gridAfter && gridBefore !== gridAfter)
      ? ok('[B2] 切主题后网格颜色确实重绘')
      : bad('[B2] 切主题后网格未重绘（移除 theme 依赖引入的回归）');

    console.log('\n  pageerrors:', JSON.stringify(errors.slice(0, 4)));
    console.log(`\n===== QC2 DONE: ${pass} pass, ${fail} fail =====`);
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); fail++; }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
