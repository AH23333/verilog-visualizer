// R12 沙盒导出验收：Export PNG / Export SVG —— 真实按钮触发 <a download> + 像素级非空校验
// 用法: node tests/r12-export.cjs
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1427;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
const ok = (n, m = '') => { results.pass++; console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`); };
const bad = (n, m = '') => { results.fail++; console.log(`  FAIL  ${n}${m ? ' — ' + m : ''}`); };

async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}

async function dragWire(page) {
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
  if (!src || !tgt) return false;
  await page.mouse.move(src.x, src.y); await page.mouse.down(); await sleep(150);
  await page.mouse.move((src.x + tgt.x) / 2, (src.y + tgt.y) / 2, { steps: 3 }); await sleep(80);
  await page.mouse.move(tgt.x, tgt.y, { steps: 5 }); await sleep(250);
  await page.mouse.up(); await sleep(400);
  return true;
}
const clickGate = async (page, label) => {
  await page.evaluate((l) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === l)?.click(), label);
  await sleep(400);
};
async function boot(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.removeItem('verilog-viz-sandbox-files'); localStorage.removeItem('verilog-viz-sandbox-active'); });
  await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
  try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
  await page.locator('button[title="Sandbox"]').click(); await sleep(800);
  await page.locator('button[title="New file"]').click(); await sleep(1200);
}

// 像素级校验：把 PNG dataURL 画到 canvas，统计非白像素数，证明电路真的被渲染出来
async function countNonWhite(page, dataUrl) {
  return page.evaluate(async (du) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = du; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nw = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 248 && d[i + 1] > 248 && d[i + 2] > 248) continue; // 近白
      nw++;
    }
    return { w: img.width, h: img.height, nonWhite: nw };
  }, dataUrl);
}

function pngMagicOk(p) { const b = fs.readFileSync(p); return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; }
function svgLooksOk(p) { const b = fs.readFileSync(p, 'utf8'); return b.includes('<svg') && (b.includes('joint-cell') || b.includes('<rect') || b.includes('<path')); }

(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });

    console.log('[A] Build a small circuit');
    await boot(page);
    await clickGate(page, 'Button'); await clickGate(page, 'Lamp'); await sleep(300);
    const w = await dragWire(page);
    w ? ok('wire Button.out -> Lamp.in drawn') : bad('wire Button.out -> Lamp.in drawn');
    const cellCount = await page.evaluate(() => window.__sandboxPaper.model.getCells().length);
    cellCount >= 2 ? ok('cells present before export', `cells=${cellCount}`) : bad('cells present', `cells=${cellCount}`);

    console.log('[B] Export PNG — real <a download> + pixel check');
    const pngBtn = await page.locator('button[title="Export circuit as PNG"]').count();
    pngBtn === 1 ? ok('Export PNG button exists') : bad('Export PNG button exists', `count=${pngBtn}`);

    const pngPath = path.join(PROJECT_ROOT, '.tmpbuild', 'r12-export.png');
    let dlName = '';
    try {
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.locator('button[title="Export circuit as PNG"]').click(),
      ]);
      dlName = dl.suggestedFilename();
      await dl.saveAs(pngPath);
    } catch (e) { bad('Export PNG download captured', String(e)); }
    if (dlName) ok('PNG download filename', dlName); else bad('PNG download filename', '(none)');
    (dlName.endsWith('.png')) ? ok('PNG filename extension') : bad('PNG filename extension', dlName);
    if (fs.existsSync(pngPath)) {
      pngMagicOk(pngPath) ? ok('PNG file is valid (magic 89 50 4E 47)') : bad('PNG valid', 'bad magic');
      const sz = fs.statSync(pngPath).size;
      sz > 500 ? ok('PNG file non-trivial size', `${sz}B`) : bad('PNG size', `${sz}B`);
    } else bad('PNG file written', pngPath);

    // 像素级：证明电路真的被画出来（而非空白）
    const du = await page.evaluate(() => window.__sandboxExport.pngDataUrl(2));
    du && du.startsWith('data:image/png') ? ok('PNG dataUrl produced') : bad('PNG dataUrl', String(du).slice(0, 40));
    if (du) {
      const px = await countNonWhite(page, du);
      px.nonWhite > 100 ? ok('PNG actually renders circuit (non-white px)', `nonWhite=${px.nonWhite} ${px.w}x${px.h}`) : bad('PNG renders circuit', `nonWhite=${px.nonWhite}`);
    }

    console.log('[C] Export SVG — real <a download> + structure');
    const svgBtn = await page.locator('button[title="Export circuit as SVG"]').count();
    svgBtn === 1 ? ok('Export SVG button exists') : bad('Export SVG button exists', `count=${svgBtn}`);

    const svgPath = path.join(PROJECT_ROOT, '.tmpbuild', 'r12-export.svg');
    let sName = '';
    try {
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.locator('button[title="Export circuit as SVG"]').click(),
      ]);
      sName = dl.suggestedFilename();
      await dl.saveAs(svgPath);
    } catch (e) { bad('Export SVG download captured', String(e)); }
    if (sName) ok('SVG download filename', sName); else bad('SVG download filename', '(none)');
    (sName.endsWith('.svg')) ? ok('SVG filename extension') : bad('SVG filename extension', sName);
    if (fs.existsSync(svgPath)) {
      svgLooksOk(svgPath) ? ok('SVG contains circuit markup (<svg> + cells)') : bad('SVG markup', 'missing cells');
      const sz = fs.statSync(svgPath).size;
      sz > 200 ? ok('SVG non-trivial size', `${sz}B`) : bad('SVG size', `${sz}B`);
    } else bad('SVG file written', svgPath);

    // QC 钩子直读 SVG 字符串
    const svgStr = await page.evaluate(() => window.__sandboxExport.svgString());
    (typeof svgStr === 'string' && svgStr.includes('<svg') && svgStr.includes('joint-cell'))
      ? ok('QC hook svgString() has cells', `len=${svgStr.length}`)
      : bad('QC hook svgString', String(svgStr).slice(0, 40));

    dialogs.length === 0 ? ok('0 native dialogs') : bad('native dialogs', dialogs.join('; '));
    const typeErrors = errors.filter(e => /TypeError/i.test(e));
    typeErrors.length === 0 ? ok('0 TypeErrors', `total=${errors.length}`) : bad('TypeErrors', typeErrors.join('; '));

    console.log(`\n[DONE] ${results.pass} pass, ${results.fail} fail`);
    await browser.close(); server.kill();
    process.exit(results.fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('FATAL:', e); try { browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(2);
  }
})();
