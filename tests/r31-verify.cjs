// R31 验收：沙盒进出 / 右键放置菜单 / 连线磁吸 / 位宽自动转换 / 总线位宽方案
//  [1] 沙盒可切回原视图（活动栏再点 + 左栏 ⤺ 按钮）
//  [2] 画布右键「放置部件」二级菜单完整可见（不跑到屏幕外、可滚动）
//  [3] 端口磁吸：起手/落点都不精确对准圆点也能连上
//  [4] 位宽不匹配时自动插入转换器（1 位 → 4 位插零扩展）
//  [5] 分线器放下即弹「位宽方案」，8 位 → 8 组×1 位 应用生效
//  [6] 全程无页面异常
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1477;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1477)); } catch { }
const UI = require('./_ui.cjs');
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
const clickActivity = async (page, label) => {
  await page.locator(`button[data-activity="${label}"]`).first().click(); await sleep(500);
};

/** 取某个器件指定端口圆点的屏幕坐标（与 app 磁吸同一口径：circle.port 的中心） */
const portPoint = (page, type, port, which) => page.evaluate(({ type, port, which }) => {
  const p = window.__sandboxPaper;
  const cells = p.model.getCells().filter(c => !c.isLink() && c.get('type') === type);
  const cell = which === 'last' ? cells[cells.length - 1] : cells[0];
  if (!cell) return null;
  const v = cell.findView(p);
  const body = Array.from(v.el.querySelectorAll('.joint-port-body'))
    .find(b => b.getAttribute('port') === port);
  if (!body) return null;
  const dot = body.querySelector('circle.port') || body;
  const r = dot.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: String(cell.id) };
}, { type, port, which });

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
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}

    // [1] 沙盒 ↔ 原视图互切
    const inSandbox = () => page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]'));
    await clickActivity(page, 'sandbox'); await sleep(900);
    const entered = await inSandbox();
    await clickActivity(page, 'sandbox'); await sleep(900); // 再点一次 = 返回
    const exited = !(await inSandbox());
    await clickActivity(page, 'sandbox'); await sleep(900); // 重新进入
    const reEntered = await inSandbox();
    await UI.newSandboxFile(page);
    const exitBtn = page.locator('button[data-sandbox-exit]');
    const hasExitBtn = await exitBtn.count();
    if (hasExitBtn) { await exitBtn.click(); await sleep(900); }
    const exitedByBtn = !(await inSandbox());
    console.log('    沙盒进出:', JSON.stringify({ entered, exited, reEntered, hasExitBtn, exitedByBtn }));
    (entered && exited && reEntered && hasExitBtn > 0 && exitedByBtn)
      ? ok('[1] 沙盒可进入 / 再点返回 / ⤺ 按钮退出')
      : bad('[1] 沙盒进出异常', JSON.stringify({ entered, exited, reEntered, hasExitBtn, exitedByBtn }));

    // 回到沙盒继续后续用例
    await clickActivity(page, 'sandbox'); await sleep(1000);
    await UI.newSandboxFile(page);
    await clickActivity(page, 'modules'); await sleep(400);
    // R32 起部件库分组默认折叠 —— 展开全部，后面才能点到 Constant / Lamp / NumDisplay / BusUngroup
    for (const n of ['逻辑门', '输入 / 输出', '时序', '运算', '比较', '选择 / 移位', '总线', '存储', '显示']) {
      try { await page.getByText(n, { exact: true }).first().click({ timeout: 800 }); await sleep(120); } catch {}
    }

    // [2] 右键 → 放置部件：菜单必须完整落在视口内
    await page.mouse.click(700, 500, { button: 'right' }); await sleep(500);
    await page.locator('button:has-text("放置部件")').first().click(); await sleep(500);
    const geo = await page.evaluate(() => {
      // ContextMenu 的 z-index 来自 Tailwind class（z-[2000]），不在内联 style 里
      const menus = Array.from(document.querySelectorAll('div'))
        .filter(d => getComputedStyle(d).position === 'fixed' && d.querySelectorAll('button').length > 3);
      const m = menus[menus.length - 1];
      if (!m) return null;
      const r = m.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
               h: Math.round(r.height), maxH: m.style.maxHeight, overflow: m.style.overflowY,
               vh: window.innerHeight, items: m.querySelectorAll('button').length };
    });
    console.log('    放置部件菜单:', JSON.stringify(geo));
    // R32 起「放置部件」改为二级分类导航：一级菜单只列 9 个分组（+自定义门），不再平铺器件
    (geo && geo.top >= 0 && geo.bottom <= geo.vh + 2 && geo.items >= 9 && geo.items <= 12)
      ? ok('[2] 放置部件二级分类菜单完整可见', `${geo.items} 个分类`)
      : bad('[2] 放置部件菜单异常', JSON.stringify(geo));
    await page.keyboard.press('Escape'); await sleep(300);

    // [3] 磁吸：起点偏移 9px、落点偏移 16px（都不在圆点上）
    const paletteDiag = await page.evaluate(() => ({
      gates: document.querySelectorAll('button[data-gate]').length,
      railHead: (() => { const el = Array.from(document.querySelectorAll('span'))
        .find(s => ['文件', '部件', '层次结构'].includes((s.textContent || '').trim())); return el ? el.textContent.trim() : null; })(),
    }));
    console.log('    器件库诊断:', JSON.stringify(paletteDiag));
    if (!paletteDiag.gates) { await clickActivity(page, 'modules'); await sleep(500); }
    await require('./_ui.cjs').ensurePalette(page);
    await require('./_ui.cjs').clickGate(page, 'Constant'); await sleep(400);
    await require('./_ui.cjs').ensurePalette(page);
    await require('./_ui.cjs').clickGate(page, 'Lamp'); await sleep(400);
    const src = await portPoint(page, 'Constant', 'out', 'last');
    const dst = await portPoint(page, 'Lamp', 'in', 'last');
    await page.mouse.move(src.x + 9, src.y + 7);
    await page.mouse.down();
    await page.mouse.move((src.x + dst.x) / 2, (src.y + dst.y) / 2, { steps: 6 });
    await page.mouse.move(dst.x + 16, dst.y + 12, { steps: 6 });
    await page.mouse.up();
    await sleep(700);
    const snapLink = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const links = p.model.getLinks();
      const l = links[links.length - 1];
      const by = {};
      p.model.getCells().filter((c) => !c.isLink()).forEach((c) => { const t = c.get('type'); by[t] = (by[t] || 0) + 1; });
      const toastEl = Array.from(document.querySelectorAll('div'))
        .map(d => (d.textContent || '').trim()).find(t => t.startsWith('连接被拒绝') || t.startsWith('位宽'));
      return { count: links.length, src: l?.get('source'), dst: l?.get('target'), warnings: p.model._warnings, by, toast: toastEl || null };
    });
    console.log('    磁吸连线:', JSON.stringify(snapLink), 'src/dst 点:', JSON.stringify({ src, dst }));
    (snapLink.src?.id && snapLink.dst?.id && snapLink.warnings === 0)
      ? ok('[3] 端口磁吸：两侧不精准对准也能连上', `${snapLink.src.port} → ${snapLink.dst.port}`)
      : bad('[3] 磁吸连线失败', JSON.stringify(snapLink));

    // [4] 位宽自动转换：1 位常量 → 4 位数值显示
    await require('./_ui.cjs').ensurePalette(page);
    await require('./_ui.cjs').clickGate(page, 'NumDisplay'); await sleep(500);
    const s2 = await portPoint(page, 'Constant', 'out', 'last');
    const d2 = await portPoint(page, 'NumDisplay', 'in', 'last');
    const beforeConv = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return { zero: p.model.getCells().filter(c => c.get('type') === 'ZeroExtend').length,
               links: p.model.getLinks().length };
    });
    await page.mouse.move(s2.x, s2.y);
    await page.mouse.down();
    await page.mouse.move(d2.x, d2.y, { steps: 10 });
    await page.mouse.up();
    await sleep(900);
    const conv = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const z = p.model.getCells().filter(c => c.get('type') === 'ZeroExtend');
      const last = z[z.length - 1];
      const disp = p.model.getCells().filter(c => c.get('type') === 'NumDisplay').slice(-1)[0];
      return { zeroCount: z.length, extend: last?.get('extend'), links: p.model.getLinks().length,
               dispIn: disp?.get('inputSignals')?.in ? disp.get('inputSignals').in.toString().replace('Vector3vl ', '') : 'n/a',
               warnings: p.model._warnings };
    });
    console.log('    自动转换:', JSON.stringify({ beforeConv, conv }));
    (conv.zeroCount > beforeConv.zero && conv.extend && conv.extend.input === 1 && conv.extend.output === 4
      && conv.warnings === 0 && /^0{4}$/.test(conv.dispIn))
      ? ok('[4] 1 位 → 4 位自动插入零扩展并连通', `dispIn=${conv.dispIn}`)
      : bad('[4] 位宽自动转换异常', JSON.stringify({ beforeConv, conv }));

    // [5] 分线器放下即弹位宽方案对话框
    await require('./_ui.cjs').ensurePalette(page);
    await require('./_ui.cjs').clickGate(page, 'BusUngroup'); await sleep(600);
    const dlg = await page.evaluate(() => !!document.querySelector('[data-bus-width-dialog]'));
    if (dlg) {
      await page.locator('[data-bus-width-dialog] button:text-is("8 位")').first().click(); await sleep(250);
      await page.locator('[data-bus-width-dialog] button:has-text("1 位 ×")').first().click(); await sleep(250);
      await page.locator('[data-bus-width-dialog] button:text-is("应用")').click(); await sleep(800);
    }
    const split = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const cells = p.model.getCells().filter(c => c.get('type') === 'BusUngroup');
      const c = cells[cells.length - 1];
      const g = c?.get('groups');
      return { groups: g ? Array.from(g.values()) : null, ports: (c?.get('ports')?.items || []).length };
    });
    console.log('    位宽方案:', JSON.stringify({ dlg, ...split }));
    (dlg && split.groups && split.groups.length === 8 && split.groups.every(w => w === 1) && split.ports === 9)
      ? ok('[5] 分线器位宽方案：8 位总线 → 8 组×1 位', `${split.ports} 个端口`)
      : bad('[5] 位宽方案对话框异常', JSON.stringify({ dlg, ...split }));

    errors.length === 0 ? ok('[6] 全程无页面异常') : bad('[6] 有页面异常', errors[0].slice(0, 160));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
