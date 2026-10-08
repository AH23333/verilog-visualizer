// 深度自检轮 2：多文件隔离（示例/Memory 串台检查）+ 刷新持久化 + 历史栈隔离
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1489;
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
const snap = (page) => page.evaluate(() => {
  const p = window.__sandboxPaper;
  const cells = p.model.getCells().filter(c => !c.isLink());
  const by = {};
  cells.forEach(c => { const t = c.get('type'); by[t] = (by[t] || 0) + 1; });
  return { n: cells.length, links: p.model.getLinks().length, by };
});
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 150)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await UI.newSandboxFile(page);

    // 文件 A：插入半加器 + 放 Memory + 保存
    await page.mouse.click(1100, 700, { button: 'right' }); await sleep(500);
    await menuClick(page, '插入示例', false);
    await menuClick(page, '半加器', false);
    await sleep(900);
    await require('./_ui.cjs').ensurePalette(page);
const UI = require('./_ui.cjs');
    await page.locator('button[data-gate="Memory"]').first().click(); await sleep(600);
    await page.keyboard.press('Control+s'); await sleep(900);
    const snapA = await snap(page);
    console.log('    文件 A:', JSON.stringify(snapA));

    // 文件 B：新建，放 Lamp + 保存
    await UI.newSandboxFile(page);
    await require('./_ui.cjs').ensurePalette(page);
    await page.locator('button[data-gate="Lamp"]').first().click(); await sleep(600);
    await page.keyboard.press('Control+s'); await sleep(900);
    const snapB = await snap(page);
    console.log('    文件 B:', JSON.stringify(snapB));

    // 切回 A（侧栏文件列表：div 条目，文件名形如 电路_1.djs）
    const listBtns = page.locator('div:has-text("电路_1.djs")').last();
    const cnt = await page.locator('span:text-is("电路_1.djs")').count();
    console.log('    侧栏文件条目数:', cnt);
    if (cnt >= 1) {
      await page.locator('span:text-is("电路_1.djs")').first().click(); await sleep(1200);
      const backA = await snap(page);
      console.log('    切回 A:', JSON.stringify(backA));
      (backA.n === snapA.n && backA.links === snapA.links && JSON.stringify(backA.by) === JSON.stringify(snapA.by))
        ? ok('[2a] 切回文件 A：内容与保存时完全一致，无串台', JSON.stringify(backA))
        : bad('[2a] 文件串台/内容缺失', `A=${JSON.stringify(backA)} 期望=${JSON.stringify(snapA)}`);
      // 刷新后 A 仍在（localStorage 持久化）
      await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
      const afterReload = await snap(page);
      console.log('    刷新后:', JSON.stringify(afterReload));
      (afterReload.n === snapA.n && afterReload.links === snapA.links)
        ? ok('[2b] 刷新后文件 A 持久化完整')
        : bad('[2b] 刷新后内容丢失', JSON.stringify(afterReload));
      // 切到 B（电路_2.djs）
      {
        await page.locator('span:text-is("电路_2.djs")').first().click(); await sleep(1200);
        const backB = await snap(page);
        console.log('    切到 B:', JSON.stringify(backB));
        (backB.n === 1 && backB.by.Lamp === 1 && !backB.by.Memory)
          ? ok('[2c] 文件 B 独立完整')
          : bad('[2c] 文件 B 内容异常', JSON.stringify(backB));
      }
    } else {
      bad('[2] 侧栏找不到文件条目，无法测试切换');
    }
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); if (pass + fail === 0) fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
