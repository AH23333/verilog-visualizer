// 深度自检轮 5：复制/粘贴示例器件（id 唯一性）+ 粘贴后可工作
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1485;
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
    page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 150)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    await page.mouse.click(1100, 700, { button: 'right' }); await sleep(500);
    await menuClick(page, '插入示例', false);
    await menuClick(page, '半加器', false);
    await sleep(900);
    const before = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const cells = p.model.getCells().filter(c => !c.isLink());
      return { n: cells.length, links: p.model.getLinks().length, ids: cells.map(c => String(c.id)) };
    });
    // 全选 → 复制 → 粘贴
    await page.keyboard.press('Control+a'); await sleep(400);
    await page.keyboard.press('Control+c'); await sleep(400);
    await page.keyboard.press('Control+v'); await sleep(900);
    const after = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const cells = p.model.getCells().filter(c => !c.isLink());
      const ids = cells.map(c => String(c.id));
      const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
      const links = p.model.getLinks();
      // 悬空线检查
      const dangling = links.filter(l => {
        const s = l.get('source'), t = l.get('target');
        return (s.id && !p.model.getCell(s.id)) || (t.id && !p.model.getCell(t.id));
      }).length;
      return { n: cells.length, links: links.length, dup, dangling };
    });
    console.log(`    粘贴前=${JSON.stringify(before)} 粘贴后=${JSON.stringify(after)}`);
    (after.n === before.n * 2 && after.dup.length === 0)
      ? ok('[5a] 复制粘贴器件翻倍且 id 唯一', `n=${after.n} dup=${after.dup.length}`)
      : bad('[5a] 粘贴后 id 冲突或数量异常', JSON.stringify(after));
    after.dangling === 0 ? ok('[5b] 粘贴的连线无悬空') : bad('[5b] 粘贴产生悬空线', String(after.dangling));
    // 粘贴出的半加器可独立工作：找 exXor 的两个副本，拨第二副本的输入
    const xorIds = await page.evaluate(() =>
      window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Xor').map(c => String(c.id)));
    console.log('    Xor 副本数:', xorIds.length, JSON.stringify(xorIds));
    xorIds.length === 2 ? ok('[5c] 粘贴出独立的第二套半加器') : bad('[5c] Xor 副本数异常', String(xorIds.length));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); if (pass + fail === 0) fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
