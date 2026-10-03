// 定位放大镜单击不展开的原因
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1462;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickGate = async (page, l) => { await page.evaluate((x) => document.querySelector('button[data-gate="' + x + '"]')?.click(), l); await sleep(400); };
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('console', m => console.log('  [console]', m.text().slice(0, 160)));
    page.on('pageerror', e => console.log('PAGEERR', String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);

    await clickGate(page, 'Input'); await clickGate(page, 'Output'); await sleep(400);
    // 连线
    const pts = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const pc = (t, port) => { const c = p.model.getCells().find(x => x.get('type') === t); const v = c.findView(p);
        const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`); const r = el.getBoundingClientRect();
        return { x: r.left + r.width/2, y: r.top + r.height/2 }; };
      return { a: pc('Input','out'), b: pc('Output','in') };
    });
    await page.mouse.move(pts.a.x, pts.a.y); await page.mouse.down();
    await page.mouse.move(pts.b.x, pts.b.y, { steps: 6 }); await page.mouse.up(); await sleep(600);
    await page.locator('button[title^="将当前电路保存为自定义门"]').click(); await sleep(400);
    await page.fill('input[placeholder="自定义门名称"]', 'Z1'); await sleep(200);
    await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(700);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    await page.evaluate(() => { const g = window.__sandboxGates.list()[0]; if (g) window.__sandboxGates.place(g.id); });
    await sleep(900);

    const info = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const s = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
      const v = s.findView(p);
      const a = v.el.querySelector('a.zoom');
      if (!a) return { hasZoom: false, svgHtml: v.el.innerHTML.slice(0, 300) };
      const r = a.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        hasZoom: true,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        center: { x: cx, y: cy },
        hitTag: hit ? hit.tagName : null,
        hitClass: hit ? String(hit.getAttribute('class') || '') : null,
        hitClosestZoom: hit ? !!hit.closest('a.zoom') : false,
        zoomHtml: a.outerHTML.slice(0, 200),
      };
    });
    console.log('放大镜信息:', JSON.stringify(info, null, 1));

    // 1) 手动触发事件，验证我们的处理器是否挂上了
    await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const s = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
      p.trigger('open:subcircuit', s);
    });
    await sleep(800);
    const afterTrigger = await page.evaluate(() => [...document.querySelectorAll('span')].filter(s => /^内部电路：/.test(s.textContent?.trim() || '')).length);
    console.log('手动 trigger 后 展开图数量 =', afterTrigger);
    await page.keyboard.press('Escape'); await sleep(400);

    // 2) 真实点击
    if (info.hasZoom) {
      await page.mouse.click(info.center.x, info.center.y);
      await sleep(900);
      const afterClick = await page.evaluate(() => [...document.querySelectorAll('span')].filter(s => /^内部电路：/.test(s.textContent?.trim() || '')).length);
      console.log('真实单击后 展开图数量 =', afterClick);

      // 3) 双击对比
      if (!afterClick) {
        await page.mouse.click(info.center.x, info.center.y, { clickCount: 2 });
        await sleep(900);
        const afterDbl = await page.evaluate(() => [...document.querySelectorAll('span')].filter(s => /^内部电路：/.test(s.textContent?.trim() || '')).length);
        console.log('双击后 展开图数量 =', afterDbl);
      }
    }
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
