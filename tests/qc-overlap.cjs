// QC：验证连续放置多个部件是否堆叠在同一位置（R11 2 次失败的疑似根因）
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1443;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickGate = async (page, label) => {
  await page.evaluate((l) => document.querySelector('button[data-gate="' + l + '"]')?.click(), label);
  await sleep(400);
};
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => console.log('PAGEERR', String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1200);

    for (const t of ['Button', 'Lamp', 'And']) await clickGate(page, t);
    await sleep(600);
    const pos = await page.evaluate(() => window.__sandboxPaper.model.getCells()
      .filter(c => !c.isLink())
      .map(c => ({ type: c.get('type'), x: c.position().x, y: c.position().y })));
    console.log('各部件位置：', JSON.stringify(pos, null, 1));
    const uniq = new Set(pos.map(p => `${p.x},${p.y}`));
    console.log(`不同位置数量 = ${uniq.size} / 部件数 = ${pos.length}`);
    console.log(uniq.size < pos.length
      ? '>>> 结论：部件确实堆叠在同一位置（真实 UX 缺陷）'
      : '>>> 结论：部件位置互不重叠');

    // 复刻 R11 的连线拖拽，看是否因此失败
    const magnets = await page.evaluate(() => {
      const ms = document.querySelectorAll('[magnet]');
      return [...ms].filter(m => m.getAttribute('magnet') !== 'false').map(m => {
        const r = m.getBoundingClientRect();
        const pb = m.closest('.joint-port-body');
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, port: pb?.getAttribute('port') };
      });
    });
    const src = magnets.find(m => m.port === 'out');
    const tgt = magnets.find(m => m.port === 'in');
    console.log('起终点端口：', JSON.stringify(src), '->', JSON.stringify(tgt));
    if (src && tgt) {
      await page.mouse.move(src.x, src.y); await page.mouse.down(); await sleep(150);
      await page.mouse.move((src.x + tgt.x) / 2, (src.y + tgt.y) / 2, { steps: 3 }); await sleep(80);
      await page.mouse.move(tgt.x, tgt.y, { steps: 5 }); await sleep(250);
      await page.mouse.up(); await sleep(500);
      const links = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
      console.log('连线结果 links =', links, links === 0 ? '（失败：端口因重叠而拖拽落空）' : '（成功）');
    }
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
