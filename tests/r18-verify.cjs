// R18 验收：本轮新增功能
//  1) 反向连线（从输入端起手拖到输出端）
//  2) 旋转部件（Ctrl+R）
//  3) 缩放/平移后新增部件仍落在可视区
//  4) 自定义门端口布局正确 + 双击展开内部电路
//  5) 界面汉化
//  6) 右键菜单与系统统一样式
//  7) 设置页面改网格尺寸立即生效
//  8) 撤销 / 重做
// 用法: node tests/r18-verify.cjs
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1433;
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
    localStorage.removeItem('verilog-viz-sandbox-files');
    localStorage.removeItem('verilog-viz-sandbox-active');
    localStorage.removeItem('verilog-viz-sandbox-gates');
    localStorage.removeItem('verilog-viz-sandbox-settings');
  });
  await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
  try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
  await page.locator('button[title="沙盒"]').click(); await sleep(900);
  await page.locator('button[title="新建文件"]').click(); await sleep(1300);
}
const portCenterClient = async (page, cellId, portId) => page.evaluate(([id, p]) => {
  const paper = window.__sandboxPaper;
  const v = paper.model.getCell(id).findView(paper);
  const c = v.el.querySelector(`.joint-port-body[port="${p}"] circle`);
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, [cellId, portId]);

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

    // ================= [1] 反向连线 =================
    console.log('\n===== [1] 反向连线（输入端 → 输出端）=====');
    await clickGate(page, 'Input'); await clickGate(page, 'Lamp'); await sleep(400);
    const pair = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const btn = p.model.getCells().find(c => c.get('type') === 'Input');
      const lamp = p.model.getCells().find(c => c.get('type') === 'Lamp');
      btn.set('position', { x: 200, y: 160 });
      lamp.set('position', { x: 620, y: 320 });
      return { btn: btn.id, lamp: lamp.id };
    });
    await sleep(500);
    const a = await portCenterClient(page, pair.lamp, 'in');   // 起点：输入端
    const b = await portCenterClient(page, pair.btn, 'out');   // 终点：输出端
    console.log('    从 Lamp.in', JSON.stringify(a), '拖到 Button.out', JSON.stringify(b));
    if (!a || !b) { bad('[1] 反向连线建立', '端口圆心取不到'); }
    else {
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
      await page.mouse.move(b.x, b.y, { steps: 6 });
      await page.mouse.up();
      await sleep(700);
      const link = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        const l = p.model.getLinks()[0];
        return l ? { n: p.model.getLinks().length, src: l.get('source'), tgt: l.get('target') } : { n: 0 };
      });
      console.log('   ', JSON.stringify(link));
      const good = link.n === 1 && link.src.id === pair.btn && link.src.port === 'out'
        && link.tgt.id === pair.lamp && link.tgt.port === 'in';
      good ? ok('[1] 反向连线建立且方向为 输出→输入', JSON.stringify(link))
           : bad('[1] 反向连线建立', JSON.stringify(link));
    }

    // ================= [2] 旋转 =================
    console.log('\n===== [2] 旋转部件 =====');
    await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).findView(window.__sandboxPaper).el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 })), pair.btn);
    await sleep(200);
    const rot0 = await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).get('angle') || 0, pair.btn);
    await page.keyboard.press('Control+r'); await sleep(500);
    const rot1 = await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).get('angle') || 0, pair.btn);
    await page.keyboard.press('Control+Shift+r'); await sleep(500);
    const rot2 = await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).get('angle') || 0, pair.btn);
    console.log(`    angle: ${rot0} -> ${rot1} -> ${rot2}`);
    (rot1 === 90 && rot2 === 0) ? ok('[2] Ctrl+R / Shift+Ctrl+R 旋转 90°', `${rot0}→${rot1}→${rot2}`)
                                : bad('[2] 旋转', `${rot0}→${rot1}→${rot2}（期望 0→90→0）`);

    // ================= [3] 缩放后新增部件在可视区 =================
    console.log('\n===== [3] 缩放/平移后新增部件仍在可视区 =====');
    const view = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      p.scale(2.2); p.translate(-600, -400);
      const r = p.el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    await sleep(300);
    await clickGate(page, 'And'); await sleep(600);
    const placed = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().filter(x => x.get('type') === 'And').pop();
      const v = c.findView(p);
      const r = v.el.getBoundingClientRect();
      const pr = p.el.getBoundingClientRect();
      return {
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        inX: r.left >= pr.left - 2 && r.right <= pr.right + 2,
        inY: r.top >= pr.top - 2 && r.bottom <= pr.bottom + 2,
      };
    });
    console.log('    画布', JSON.stringify(view), '新部件', JSON.stringify(placed));
    (placed.inX && placed.inY) ? ok('[3] 缩放 2.2x 后新增部件落在可视区', `center=(${placed.cx.toFixed(0)},${placed.cy.toFixed(0)})`)
                               : bad('[3] 新增部件落在可视区', JSON.stringify(placed));
    await page.evaluate(() => { window.__sandboxPaper.scale(1); window.__sandboxPaper.translate(0, 0); });
    await sleep(300);

    // ================= [4] 自定义门：端口布局 + 展开内部图 =================
    console.log('\n===== [4] 自定义门 =====');
    await page.locator('button[title="新建文件"]').click(); await sleep(1200);
    await clickGate(page, 'Input'); await clickGate(page, 'And'); await clickGate(page, 'Output');
    await sleep(400);
    const gateSetup = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const inp = p.model.getCells().find(c => c.get('type') === 'Input');
      const and = p.model.getCells().find(c => c.get('type') === 'And');
      const out = p.model.getCells().find(c => c.get('type') === 'Output');
      inp.set('position', { x: 120, y: 200 }); inp.set('net', 'A');
      and.set('position', { x: 320, y: 200 });
      out.set('position', { x: 540, y: 200 }); out.set('net', 'Y');
      const inPort = and.getPorts().filter(x => x.group === 'in')[0].id;
      p.model.addCell(new dj.cells.Wire({ source: { id: inp.id, port: 'out' }, target: { id: and.id, port: inPort }, signal: 'x' }));
      p.model.addCell(new dj.cells.Wire({ source: { id: and.id, port: 'out' }, target: { id: out.id, port: 'in' }, signal: 'x' }));
      return { inPort };
    });
    await sleep(600);
    await page.locator('button[title^="将当前电路保存为自定义门"]').click(); await sleep(500);
    const titles = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.title).filter(Boolean));
    console.log('    可用按钮 title =', JSON.stringify(titles));
    await page.fill('input[placeholder="自定义门名称"]', 'MYGATE'); await sleep(200);
    await page.keyboard.press('Enter'); await sleep(900);
    const gateCount = await page.evaluate(() => window.__sandboxGates.list().length);
    console.log('    已保存自定义门数量 =', gateCount);
    await page.locator('button[title="新建文件"]').click(); await sleep(1200);
    await page.evaluate(() => { const g = window.__sandboxGates.list()[0]; if (g) window.__sandboxGates.place(g.id); });
    await sleep(900);
    const subGeom = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const sub = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
      if (!sub) return null;
      const v = sub.findView(p);
      const body = v.el.querySelector('.body');
      const br = body ? body.getBoundingClientRect() : null;
      const dot = (port) => {
        const c = v.el.querySelector(`.joint-port-body[port="${port}"] circle`);
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const ports = sub.getPorts().map(x => x.id);
      return {
        ports,
        bodyLeft: br ? br.left : null, bodyRight: br ? br.right : null,
        dots: Object.fromEntries(ports.map(id => [id, dot(id)])),
      };
    });
    console.log('    ', JSON.stringify(subGeom));
    let gapOk = false;
    if (subGeom && subGeom.bodyRight != null) {
      const s = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        return p.scale().sx || 1;
      });
      const dIn = subGeom.dots['A'] ? (subGeom.bodyLeft - subGeom.dots['A'].x) / s : null;
      const dOut = subGeom.dots['Y'] ? (subGeom.dots['Y'].x - subGeom.bodyRight) / s : null;
      console.log(`    引脚间距（缩放校正后）：in=${dIn} out=${dOut}`);
      gapOk = dIn != null && dOut != null && Math.abs(dIn - 25) <= 2 && Math.abs(dOut - 25) <= 2;
      gapOk ? ok('[4a] 自定义门引脚贴合本体（≈25px）', `in=${dIn} out=${dOut}`)
            : bad('[4a] 自定义门引脚位置', `in=${dIn} out=${dOut}（期望 ≈25）`);
    } else bad('[4a] 自定义门引脚位置', '未取到 Subcircuit');

    // 双击展开内部电路
    const subCenter = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const sub = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
      const v = sub.findView(p);
      const b = v.el.querySelector('.body') || v.el;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(subCenter.x, subCenter.y, { clickCount: 2 }); await sleep(1000);
    const modal = await page.evaluate(() => {
      const el = [...document.querySelectorAll('span')].find(d => /^内部电路：/.test((d.textContent || '').trim()));
      if (!el) return null;
      const views = [...document.querySelectorAll('.joint-cell')].length;
      return { text: el.textContent, views };
    });
    console.log('    内部图弹窗 =', JSON.stringify(modal));
    modal ? ok('[4b] 双击展开自定义门内部电路', String(modal.text)) : bad('[4b] 展开内部电路', '未出现弹窗');
    await page.screenshot({ path: path.join(PROJECT_ROOT, '.tmpbuild', 'r18-inner.png') });
    await page.keyboard.press('Escape'); await sleep(400);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '×' && b.title === '关闭');
      btn?.click();
    });
    await sleep(400);

    // ================= [5] 汉化 =================
    console.log('\n===== [5] 界面汉化 =====');
    const zh = await page.evaluate(() => {
      const txt = document.body.innerText;
      const has = (s) => txt.includes(s);
      return { 逻辑门: has('逻辑门'), 输入输出: has('输入 / 输出'), 自定义门: has('自定义门'), 文件: has('文件'), 单步: has('单步') };
    });
    console.log('   ', JSON.stringify(zh));
    (zh.逻辑门 && zh.输入输出 && zh.文件) ? ok('[5] 沙盒界面已汉化', JSON.stringify(zh)) : bad('[5] 汉化', JSON.stringify(zh));
    const menuZh = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].map(b => b.textContent?.trim());
      return { 文件菜单: btns.includes('文件'), 设置菜单: btns.includes('设置'), 视图: btns.includes('视图') };
    });
    console.log('    菜单栏 =', JSON.stringify(menuZh));
    menuZh.文件菜单 ? ok('[5b] 顶部菜单栏已汉化', JSON.stringify(menuZh)) : bad('[5b] 菜单栏汉化', JSON.stringify(menuZh));

    // ================= [6] 右键菜单统一样式 =================
    console.log('\n===== [6] 右键菜单样式 =====');
    const cellPt = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(x => x.get('type') === 'Subcircuit');
      const v = c.findView(p);
      const b = v.el.querySelector('.body') || v.el;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(cellPt.x, cellPt.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await sleep(600);
    const menuInfo = await page.evaluate(() => {
      const m = [...document.querySelectorAll('div')].find(d => d.className?.includes?.('min-w-[280px]'));
      if (!m) return null;
      const cs = getComputedStyle(m);
      return { cls: m.className, minWidth: cs.minWidth, text: (m.textContent || '').slice(0, 60) };
    });
    console.log('   ', JSON.stringify(menuInfo));
    (menuInfo && menuInfo.minWidth === '280px') ? ok('[6] 沙盒右键菜单复用系统样式', `min-width=${menuInfo.minWidth}`)
                                                : bad('[6] 右键菜单样式', JSON.stringify(menuInfo));
    await page.keyboard.press('Escape'); await sleep(300);

    // ================= [7] 设置页改网格尺寸 =================
    console.log('\n===== [7] 设置页面 =====');
    await page.evaluate(() => document.querySelector('button[data-sandbox-settings]')?.click());
    await sleep(800);
    const settingsOpen = await page.evaluate(() =>
      [...document.querySelectorAll('span')].some(s => s.textContent?.trim() === '设置' && s.style.fontWeight === '600'));
    settingsOpen ? ok('[7] 设置面板打开') : bad('[7] 设置面板打开');
    // 切到沙盒页（tab 按钮 textContent 为“沙盒”，不依赖 className）
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '沙盒');
      b?.click();
    });
    await sleep(500);
    const gridBefore = await page.evaluate(() => {
      const g = document.querySelector('[data-sandbox-grid]');
      return g ? getComputedStyle(g).backgroundSize : null;
    });
    // 真实交互：选中输入框 → 输入 32 → Tab 失焦（触发 React onBlur）
    const gi = page.locator('input[data-setting="网格间距"]');
    await gi.click({ clickCount: 3 });
    await page.keyboard.type('32');
    await page.keyboard.press('Tab');
    await sleep(800);
    const gridAfter = await page.evaluate(() => {
      const g = document.querySelector('[data-sandbox-grid]');
      return g ? getComputedStyle(g).backgroundSize : null;
    });
    console.log('    网格 backgroundSize:', gridBefore, '->', gridAfter);
    (gridAfter && gridAfter.startsWith('32')) ? ok('[7b] 设置页改网格尺寸即时生效', `${gridBefore} → ${gridAfter}`)
                                              : bad('[7b] 网格尺寸生效', `${gridBefore} → ${gridAfter}`);
    await page.keyboard.press('Escape'); await sleep(400);

    // ================= [8] 撤销 / 重做 =================
    console.log('\n===== [8] 撤销 / 重做 =====');
    await clickGate(page, 'Or'); await sleep(500);
    const n1 = await page.evaluate(() => window.__sandboxPaper.model.getCells().filter(c => !c.isLink()).length);
    await page.keyboard.press('Control+z'); await sleep(700);
    const n2 = await page.evaluate(() => window.__sandboxPaper.model.getCells().filter(c => !c.isLink()).length);
    await page.keyboard.press('Control+Shift+z'); await sleep(700);
    const n3 = await page.evaluate(() => window.__sandboxPaper.model.getCells().filter(c => !c.isLink()).length);
    console.log(`    部件数：新增后 ${n1} → 撤销 ${n2} → 重做 ${n3}`);
    (n2 === n1 - 1 && n3 === n1) ? ok('[8] 撤销 / 重做', `${n1}→${n2}→${n3}`) : bad('[8] 撤销 / 重做', `${n1}→${n2}→${n3}`);

    console.log('\n  pageerrors:', JSON.stringify(errors.slice(0, 4)));
    console.log(`\n===== R18 DONE: ${pass} pass, ${fail} fail =====`);
    await browser.close();
  } catch (e) {
    console.log('FATAL', String(e));
    fail++;
  } finally {
    try { server?.kill('SIGKILL'); } catch {}
    process.exit(0);
  }
})();
