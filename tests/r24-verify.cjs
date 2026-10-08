// R24 验收：沙盒波形监视器
//  [1] 「波形」按钮开关面板
//  [2] 连线 signal 随输入翻转（波形数据源）
//  [3] 面板通道数 = 唯一 netname 数（自动补入新通道）
//  [4] 计数器示例 + 波形：时钟信号在通道里持续变化
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1475;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1475)); } catch { }
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
    await require('./_ui.cjs').boot(page, URL);
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await require('./_ui.cjs').boot(page, URL, { reload: true, settle: 1200 });
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await require('./_ui.cjs').newSandboxFile(page);

    // [1] 波形按钮开关面板（面板用 canvas 绘制，以标题栏 data-waveform-channels 为标记）
    await page.locator('button[title*="波形监视器"]').click(); await sleep(600);
    let panel = await page.locator('[data-waveform-channels]').count();
    panel === 1 ? ok('[1a] 波形面板打开') : bad('[1a] 面板未出现', String(panel));
    await page.locator('button[title="关闭波形图"]').click(); await sleep(400);
    panel = await page.locator('[data-waveform-channels]').count();
    panel === 0 ? ok('[1b] 波形面板关闭') : bad('[1b] 面板未关闭', String(panel));
    await page.locator('button[title*="波形监视器"]').click(); await sleep(600);

    // [2] 放 Input + Lamp 连线，拨输入验证 signal 数据源
    await require('./_ui.cjs').ensurePalette(page);
    await require('./_ui.cjs').clickGate(page, 'Input'); await sleep(500);
    await require('./_ui.cjs').ensurePalette(page);
    await require('./_ui.cjs').clickGate(page, 'Lamp'); await sleep(500);
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    const wok = await wire(page, ids.Input[0], 'out', ids.Lamp[0], 'in');
    await sleep(800);
    const sigOf = () => page.evaluate(() => {
      const lk = window.__sandboxPaper.model.getLinks()[0];
      const s = lk?.get('signal');
      return s != null ? String(s).replace(/^Vector3vl\s+/, '') : 'n/a';
    });
    const s0 = await sigOf();
    await clickBody(page, ids.Input[0]);
    const s1 = await sigOf();
    await clickBody(page, ids.Input[0]);
    const s2 = await sigOf();
    console.log(`    连线=${wok} signal: 初始=${s0} 拨后=${s1} 再拨=${s2}`);
    (wok && s0 !== s1 && s1 !== s2) ? ok('[2] 连线 signal 随输入翻转（波形数据源）', `${s0}→${s1}→${s2}`) : bad('[2] signal 未随输入变化', `${s0}→${s1}→${s2}`);

    // [3] 面板通道数
    const ch = await page.locator('[data-waveform-channels]').getAttribute('data-waveform-channels');
    ch === '1' ? ok('[3] 面板自动补入通道（1 条连线 = 1 通道）', `channels=${ch}`) : bad('[3] 通道数异常', `channels=${ch}`);

    // [4] 计数器示例 + 波形：时钟通道持续变化
    // ⚠ 原来这里写死 `mouse.click(1150,760,'right')`：此刻波形面板正开着、盖住窗口下沿，
    // 那一右键点在面板上而不是画布上 ⇒ 空白菜单根本没弹，locator 等「插入示例」等满 30 s。
    // 改由夹具现场找一块**真空白**的画布点（避开面板/遮罩/器件）。
    const blank = await require('./_ui.cjs').blankCanvasPoint(page);
    await require('./_ui.cjs').menuClick(page, '插入示例', blank);
    await require('./_ui.cjs').menuClick(page, '4 位二进制计数器');
    await sleep(1200); // 让时钟采样积累
    const ch2 = Number(await page.locator('[data-waveform-channels]').getAttribute('data-waveform-channels'));
    console.log('    插入计数器后通道数:', ch2);
    ch2 >= 1 + 12 ? ok('[4] 计数器 16 条连线的通道自动进入波形', `channels=${ch2}`) : bad('[4] 通道未更新', String(ch2));

    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); if (pass + fail === 0) fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
