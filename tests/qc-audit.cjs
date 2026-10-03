// QC 审计：验证我上一轮「修测试变绿」的每个改动是否掩盖了真实 bug
//  A) R14[1] 放宽容差：modelΔx=64 到底是不是「网格吸附」造成的？关掉吸附后是否回到 ~60？
//  B) 主题修复：移除 theme 依赖后，切主题时网格颜色是否真的会重绘？
//  C) R13 自定义门：改用 __sandboxGates.place 是否绕过了真实 UI？直接点调色板按钮能否放置？
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1441;
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
// 复刻 R14 的缩放拖拽：scale=2，屏幕位移 120px → 期望模型位移 60
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
  return { beforeX: before.x, afterX: after.x, modelDx: after.x - before.x };
}
// 打开设置 → 沙盒页 → 切换「吸附到网格」
async function setSnap(page, want) {
  await page.evaluate(() => document.querySelector('button[data-sandbox-settings]')?.click());
  await sleep(700);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '沙盒');
    b?.click();
  });
  await sleep(400);
  const state = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button[title="已开启"], button[title="已关闭"]')];
    const b = btns.find(btn => {
      let n = btn;
      for (let i = 0; i < 4 && n; i++) { n = n.parentElement; if (n?.textContent?.includes('吸附到网格')) return true; }
      return false;
    });
    return b ? b.title : null;
  });
  if (state === '已开启' && !want) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button[title="已开启"], button[title="已关闭"]')];
      const b = btns.find(btn => { let n = btn; for (let i = 0; i < 4 && n; i++) { n = n.parentElement; if (n?.textContent?.includes('吸附到网格')) return true; } return false; });
      b?.click();
    });
    await sleep(400);
  } else if (state === '已关闭' && want) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button[title="已开启"], button[title="已关闭"]')];
      const b = btns.find(btn => { let n = btn; for (let i = 0; i < 4 && n; i++) { n = n.parentElement; if (n?.textContent?.includes('吸附到网格')) return true; } return false; });
      b?.click();
    });
    await sleep(400);
  }
  await page.keyboard.press('Escape'); await sleep(400);
  return state;
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

    // ================= A) 网格吸附是否真的是 64 的成因 =================
    console.log('\n===== [A] R14[1] 容差放宽是否掩盖真实 bug =====');
    await clickGate(page, 'Input'); await sleep(300);
    const d1 = await dragUnderZoom(page);
    console.log('    吸附(默认开):', JSON.stringify(d1));
    if (d1.err) { bad('[A] 吸附开启时拖拽', d1.err); }
    else {
      const snapExplains = (d1.modelDx !== 60) && (Math.abs(d1.afterX % 16) < 0.01 || Math.abs(d1.afterX % 16 - 16) < 0.01);
      console.log(`    modelΔx=${d1.modelDx.toFixed(1)}  终点 x=${d1.afterX}（对16取余=${(d1.afterX % 16).toFixed(2)}）`);
      console.log(`    「终点落在 16 的整数倍」=${snapExplains}  ← 吸附假说的判据`);
    }
    // 关掉吸附再测一次
    const snapState = await setSnap(page, false);
    console.log('    吸附开关当前状态(title):', snapState, '（已尝试关闭）');
    await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(x => x.get('type') === 'Input');
      if (c) c.set('position', { x: 200, y: 200 });
    });
    await sleep(300);
    const d2 = await dragUnderZoom(page);
    console.log('    吸附关闭后:', JSON.stringify(d2));
    if (d2.err) bad('[A] 关闭吸附后拖拽', d2.err);
    else {
      const close = Math.abs(d2.modelDx - 60) <= 4;
      close ? ok('[A] 关掉吸附后模型位移回到 ≈60（容差放宽成立，非掩盖 bug）', `modelΔx=${d2.modelDx.toFixed(1)}`)
            : bad('[A] 关掉吸附后仍偏离 60 —— 存在真实坐标换算 bug！', `modelΔx=${d2.modelDx.toFixed(1)}`);
    }

    // ================= B) 切主题网格是否真的重绘 =================
    console.log('\n===== [B] 移除 theme 依赖后，切主题网格颜色是否仍会更新 =====');
    await page.locator('button[title="新建文件"]').click(); await sleep(1200);
    const gridBefore = await page.evaluate(() => {
      const g = document.querySelector('[data-sandbox-grid]');
      return g ? getComputedStyle(g).backgroundImage + ' | bg=' + getComputedStyle(g).backgroundColor : null;
    });
    const cellsBefore = await page.evaluate(() => window.__sandboxPaper.model.getCells().length);
    await page.locator('button[title="主题"]').click(); await sleep(1200);
    const gridAfter = await page.evaluate(() => {
      const g = document.querySelector('[data-sandbox-grid]');
      return g ? getComputedStyle(g).backgroundImage + ' | bg=' + getComputedStyle(g).backgroundColor : null;
    });
    const cellsAfter = await page.evaluate(() => window.__sandboxPaper.model.getCells().length);
    console.log('    切换前网格:', String(gridBefore).slice(0, 120));
    console.log('    切换后网格:', String(gridAfter).slice(0, 120));
    gridBefore && gridAfter && gridBefore !== gridAfter
      ? ok('[B] 切主题后网格颜色确实重绘', '颜色已变化')
      : bad('[B] 切主题后网格未重绘（颜色未变）— 移除 theme 依赖引入的回归');
    (cellsBefore === cellsAfter)
      ? ok('[B2] 切主题后部件数量不变', `${cellsBefore} -> ${cellsAfter}`)
      : bad('[B2] 切主题后部件数量变化', `${cellsBefore} -> ${cellsAfter}`);

    // ================= C) 自定义门能否通过真实 UI 点击放置 =================
    console.log('\n===== [C] 自定义门：真实点击调色板按钮能否放置（而非绕过 UI）=====');
    await page.locator('button[title="新建文件"]').click(); await sleep(1200);
    await clickGate(page, 'Input'); await clickGate(page, 'Output'); await sleep(300);
    // 连线 Input.out -> Output.in
    const wired = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const inp = p.model.getCells().find(c => c.get('type') === 'Input');
      const outp = p.model.getCells().find(c => c.get('type') === 'Output');
      if (!inp || !outp) return false;
      const portCenter = (cell, port) => {
        const v = cell.findView(p); if (!v) return null;
        const c = v.el.querySelector(`.joint-port-body[port="${port}"] circle`);
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const a = portCenter(inp, 'out'), b = portCenter(outp, 'in');
      if (!a || !b) return false;
      window.__qcPts = { a, b };
      return true;
    });
    if (wired) {
      const pts = await page.evaluate(() => window.__qcPts);
      await page.mouse.move(pts.a.x, pts.a.y); await page.mouse.down();
      await page.mouse.move((pts.a.x + pts.b.x) / 2, (pts.a.y + pts.b.y) / 2, { steps: 5 });
      await page.mouse.move(pts.b.x, pts.b.y, { steps: 5 }); await page.mouse.up();
      await sleep(600);
    }
    await page.locator('button[title^="将当前电路保存为自定义门"]').click(); await sleep(400);
    await page.fill('input[placeholder="自定义门名称"]', 'QCGate'); await sleep(200);
    await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(700);
    const gateCount = await page.evaluate(() => window.__sandboxGates.list().length);
    console.log('    已保存自定义门数量 =', gateCount);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    // 真实点击调色板里的自定义门按钮（文本 QCGate）
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === 'QCGate');
      if (!b) return false;
      b.click();
      return true;
    });
    await sleep(800);
    const sub = await page.evaluate(() => {
      const s = window.__sandboxPaper.model.getCells().find(c => c.get('type') === 'Subcircuit');
      return s ? { type: s.get('type'), celltype: s.get('celltype') } : null;
    });
    console.log('    点击调色板按钮成功 =', clicked, ' 放置结果 =', JSON.stringify(sub));
    (clicked && sub) ? ok('[C] 真实点击自定义门按钮可放置子电路', `celltype=${sub.celltype}`)
                     : bad('[C] 自定义门 UI 点击放置失败', `clicked=${clicked} sub=${JSON.stringify(sub)}`);

    console.log('\n  pageerrors:', JSON.stringify(errors.slice(0, 4)));
    console.log(`\n===== QC DONE: ${pass} pass, ${fail} fail =====`);
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); fail++; }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
