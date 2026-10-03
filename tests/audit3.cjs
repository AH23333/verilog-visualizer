// 深度自检轮 3：PNG/SVG 导出含新器件（Memory/Display7/总线/计数器）+ 空画布导出
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1488;
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
const menuClick = async (page, label, exact = true) => {
  const loc = exact ? page.locator(`button:text-is("${label}")`) : page.locator(`button:has-text("${label}")`);
  await loc.first().click(); await sleep(400);
};
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
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    // 放一个 Memory + 插入两个示例（覆盖所有新器件渲染路径）
    await page.locator('button[data-gate="Memory"]').click(); await sleep(600);
    await page.locator('button[data-gate="Display7"]').click(); await sleep(600);
    await page.mouse.click(1100, 700, { button: 'right' }); await sleep(500);
    await menuClick(page, '插入示例', false);
    await menuClick(page, '4 位二进制计数器', false);
    await sleep(900);
    // 保存（导出可能要求已保存文件）
    await page.keyboard.press('Control+s'); await sleep(900);

    // PNG 导出
    const dlPng = page.waitForEvent('download', { timeout: 8000 }).then(() => 'download').catch(() => null);
    await page.locator('button[title="导出 PNG"]').click();
    const png = await dlPng;
    await sleep(600);
    png === 'download' ? ok('[3a] PNG 导出触发下载（含 Memory/Display7/总线）') : bad('[3a] PNG 导出无响应', `errors=${errors.length}`);

    // SVG 导出
    const dlSvg = page.waitForEvent('download', { timeout: 8000 }).then(() => 'download').catch(() => null);
    await page.locator('button[title="导出 SVG"]').click();
    const svg = await dlSvg;
    await sleep(600);
    svg === 'download' ? ok('[3b] SVG 导出触发下载') : bad('[3b] SVG 导出无响应');

    // 页面错误检查
    errors.length === 0 ? ok('[3c] 导出全程无页面异常') : bad('[3c] 导出产生页面异常', errors.slice(0, 2).join('|').slice(0, 200));

    // 空文件导出（健壮性）
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    const dlEmpty = page.waitForEvent('download', { timeout: 8000 }).then(() => 'download').catch(() => null);
    await page.locator('button[title="导出 PNG"]').click();
    const empty = await dlEmpty;
    await sleep(600);
    empty === 'download' ? ok('[3d] 空画布导出也不崩（有下载或安全忽略）') : bad('[3d] 空画布导出崩溃', errors.slice(0, 2).join('|').slice(0, 200));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); if (pass + fail === 0) fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
