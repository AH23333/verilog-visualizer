// R12 沙盒导出验收：SVG / 综合网表 / JSON —— 真实按钮触发 <a download> + 内容按成品判据；PNG 全下线
// 用法: node tests/r12-export.cjs
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1427;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1427)); } catch { }
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

// 放置 / 连线 / 进沙盒统一走共用夹具（会显式展开折叠的分组，点不到就抛错）
const UI = require('./_ui.cjs');
const dragWire = (page) => UI.dragWire(page, 'out', 'in');
const clickGate = (page, label) => UI.clickGate(page, label);
async function boot(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.removeItem('verilog-viz-sandbox-files'); localStorage.removeItem('verilog-viz-sandbox-active'); });
  await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
  try { await page.locator('button:has-text("Skip"), button:has-text("跳过")').first().click({ timeout: 2500 }); } catch {}
  await UI.enterSandbox(page);
  if (await page.locator('button[title="新建文件"]').count()) { await UI.newSandboxFile(page); }
}

function svgLooksOk(p) { const b = fs.readFileSync(p, 'utf8'); return b.includes('<svg') && (b.includes('joint-cell') || b.includes('<rect') || b.includes('<path')); }
function netlistLooksOk(p) { const b = fs.readFileSync(p, 'utf8'); return /module\s+\w+\(/.test(b) && b.includes('endmodule'); }

(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn(process.execPath, [require('path').join(__dirname, '..', 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { windowsHide: true, cwd: PROJECT_ROOT, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });

    console.log('[A] Build a small circuit');
    await boot(page);
    await clickGate(page, 'Input'); await clickGate(page, 'Lamp'); await sleep(300);
    const w = await dragWire(page);
    w ? ok('wire Button.out -> Lamp.in drawn') : bad('wire Button.out -> Lamp.in drawn');
    const cellCount = await page.evaluate(() => window.__sandboxPaper.model.getCells().length);
    cellCount >= 2 ? ok('cells present before export', `cells=${cellCount}`) : bad('cells present', `cells=${cellCount}`);

    // =====================================================================
    console.log('[B] Export SVG — real <a download> + 深度重绘结构判据');
    const svgBtn = await page.locator('button[title="导出 SVG"]').count();
    svgBtn === 1 ? ok('Export SVG button exists') : bad('Export SVG button exists', `count=${svgBtn}`);

    const svgPath = path.join(PROJECT_ROOT, '.tmpbuild', 'r12-export.svg');
    let sName = '';
    try {
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.locator('button[title="导出 SVG"]').click(),
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

    // QC 钩子直读 SVG 字符串 + 深度重绘三连（自包含 / 取景 / 无 HTML 异物）
    const svgStr = await page.evaluate(() => window.__sandboxExport.svgString());
    (typeof svgStr === 'string' && svgStr.includes('<svg') && svgStr.includes('joint-cell'))
      ? ok('QC hook svgString() has cells', `len=${svgStr.length}`)
      : bad('QC hook svgString', String(svgStr).slice(0, 40));
    (typeof svgStr === 'string' && !svgStr.includes('foreignObject'))
      ? ok('SVG is self-contained (no foreignObject / inline controls)')
      : bad('SVG foreignObject 残留', '去 PNG 时连交互控件一起从导出里拿掉了，不该还留着');
    (typeof svgStr === 'string' && svgStr.includes('viewBox'))
      ? ok('SVG has viewBox (fitted to content)')
      : bad('SVG viewBox', '深度重绘要求按模型包围盒取景');
    // R135：底色不再写死 #ffffff——深色主题下器件填充本就是近黑的 #232830，压白底就成了
    //   用户报的"部件全为纯黑色矩形"。现在的契约＝**导出底色与屏幕画布底色同值**（成对判据），
    //   ⛔ 退回"文件里有 #ffffff 就算绿"（那正是被改掉的错）。
    const triple = (c) => {
      const s = String(c || '').trim();
      let m = /^rgba?\((\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,]+([\d.]+))?\)$/.exec(s);
      if (m) return m[4] === '0' ? null : [Number(m[1]), Number(m[2]), Number(m[3])].join(',');
      m = /^#([0-9a-fA-F]{3,8})$/.exec(s);
      if (m) { let t = m[1]; if (t.length === 3 || t.length === 4) t = t.split('').slice(0, 3).map((x) => x + x).join(''); t = t.slice(0, 6); return [parseInt(t.slice(0, 2), 16), parseInt(t.slice(2, 4), 16), parseInt(t.slice(4, 6), 16)].join(','); }
      return null;
    };
    const bgM = /<rect[^>]*width="100%"[^>]*fill="([^"]+)"/.exec(String(svgStr || ''));
    const liveBg = await page.evaluate(() => {
      let el = (window.__sandboxPaper && window.__sandboxPaper.el) || document.querySelector('.joint-paper');
      for (; el; el = el.parentElement) {
        const c = getComputedStyle(el).backgroundColor;
        if (c && c !== 'transparent' && !/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(c)) return c;
      }
      return getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || null;
    });
    (bgM && triple(bgM[1]) && triple(liveBg) && triple(bgM[1]) === triple(liveBg))
      ? ok('导出底色跟随屏幕画布（非透明、与主题一致）', `文件=${bgM && bgM[1]} 屏幕=${liveBg}`)
      : bad('导出底色跟随屏幕画布', `文件=${bgM && bgM[1]}（triple=${bgM && triple(bgM[1])}）屏幕=${liveBg}（triple=${triple(liveBg)}）`);

    // =====================================================================
    console.log('[C] Export 综合网表 (.v) — real <a download> + QC hook');
    const nlBtn = await page.locator('button[title^="导出综合网表"]').count();
    nlBtn === 1 ? ok('综合网表 button exists') : bad('综合网表 button exists', `count=${nlBtn}`);

    const nlPath = path.join(PROJECT_ROOT, '.tmpbuild', 'r12-export.v');
    let nName = '';
    try {
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.locator('button[title^="导出综合网表"]').click(),
      ]);
      nName = dl.suggestedFilename();
      await dl.saveAs(nlPath);
    } catch (e) { bad('综合网表 download captured', String(e)); }
    (nName && nName.endsWith('.v')) ? ok('综合网表 filename extension (.v)', nName) : bad('综合网表 filename extension', nName);
    if (fs.existsSync(nlPath)) {
      netlistLooksOk(nlPath) ? ok('综合网表 contains module…endmodule') : bad('综合网表 markup', fs.readFileSync(nlPath, 'utf8').slice(0, 120));
      const sz = fs.statSync(nlPath).size;
      sz > 60 ? ok('综合网表 non-trivial size', `${sz}B`) : bad('综合网表 size', `${sz}B`);
    } else bad('综合网表 file written', nlPath);

    const nlStr = await page.evaluate(() => window.__sandboxExport.netlistString());
    (typeof nlStr === 'string' && /module\s+sandbox_circuit\(/.test(nlStr))
      ? ok('QC hook netlistString() has module sandbox_circuit', `len=${nlStr.length}`)
      : bad('QC hook netlistString', String(nlStr).slice(0, 60));

    // =====================================================================
    console.log('[D] Export JSON (.djs) — real <a download> + 内容可解析');
    const jBtn = await page.locator('button[title^="导出 JSON"]').count();
    jBtn === 1 ? ok('导出 JSON button exists') : bad('导出 JSON button exists', `count=${jBtn}`);

    const jPath = path.join(PROJECT_ROOT, '.tmpbuild', 'r12-export.djs');
    let jName = '';
    try {
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.locator('button[title^="导出 JSON"]').click(),
      ]);
      jName = dl.suggestedFilename();
      await dl.saveAs(jPath);
    } catch (e) { bad('JSON download captured', String(e)); }
    (jName && jName.endsWith('.djs')) ? ok('JSON filename extension (.djs)', jName) : bad('JSON filename extension', jName);
    if (fs.existsSync(jPath)) {
      try {
        const o = JSON.parse(fs.readFileSync(jPath, 'utf8'));
        (o && Array.isArray(o.cells) && o.cells.length >= 2)
          ? ok('JSON parseable with circuit cells', `cells=${o.cells.length}`)
          : bad('JSON cells', JSON.stringify(Object.keys(o || {})));
      } catch (e) { bad('JSON parse', String(e)); }
    } else bad('JSON file written', jPath);

    // =====================================================================
    console.log('[E] PNG 全下线 — 工具栏按钮 / QC 钩子 / 右键菜单都不得再给 PNG 出口');
    const pngBtn = await page.locator('button[title^="导出 PNG"]').count();
    pngBtn === 0 ? ok('no 导出 PNG button in toolbar') : bad('toolbar still has PNG button', `count=${pngBtn}`);
    const hasPngHook = await page.evaluate(() => !!(window.__sandboxExport && 'pngDataUrl' in window.__sandboxExport));
    hasPngHook ? bad('QC hook pngDataUrl still exposed') : ok('QC hook pngDataUrl removed');
    await page.mouse.click(1100, 700, { button: 'right' }); await sleep(500);
    const menuTxt = await page.evaluate(() => {
      const m = document.querySelector('[data-context-menu]');
      return m ? Array.from(m.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean) : null;
    });
    (menuTxt || []).some((t) => /PNG/i.test(t))
      ? bad('canvas context menu still has PNG', JSON.stringify(menuTxt))
      : ok('no PNG in canvas context menu');
    (menuTxt || []).filter((t) => /导出 SVG|综合网表|导出 JSON/.test(t)).length >= 2
      ? ok('context menu exports: SVG / 综合网表 / JSON', JSON.stringify(menuTxt))
      : bad('context menu exports faded', JSON.stringify(menuTxt));

    // =====================================================================
    console.log('[F] 生产路径（Tauri）— 注入 __TAURI_INTERNALS__ 后必须走原生 save_export_file，不再 <a download>');
    await page.keyboard.press('Escape'); await sleep(200);
    await page.evaluate(() => {
      window.__capturedExport = null;
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => { window.__capturedExport = { cmd, args }; return 'C:/tmp/r12-fake.svg'; },
      };
    });
    let tauriDownloads = 0;
    const onTauriDl = () => { tauriDownloads++; };
    page.on('download', onTauriDl);
    await page.locator('button[title="导出 SVG"]').click();
    await sleep(900);
    page.off('download', onTauriDl);
    const cap = await page.evaluate(() => window.__capturedExport);
    (cap && cap.cmd === 'save_export_file')
      ? ok('[F1] Tauri 路径：SVG 导出走原生 save_export_file')
      : bad('[F1] Tauri 路径未走 save_export_file', JSON.stringify(cap));
    if (cap && cap.args && Array.isArray(cap.args.content)) {
      const txt = Buffer.from(cap.args.content).toString('utf8');
      const nm = String(cap.args.defaultName || '');
      (txt.includes('<svg') && nm.endsWith('.svg'))
        ? ok('[F2] save_export_file 载荷 = 自包含 SVG + .svg 文件名', nm)
        : bad('[F2] 载荷异常', JSON.stringify({ nm, head: txt.slice(0, 30) }));
    } else bad('[F2] 载荷异常', 'no content[] array');
    tauriDownloads === 0 ? ok('[F3] Tauri 路径不再产生 <a download>') : bad('[F3] 仍走浏览器下载', `n=${tauriDownloads}`);
    await page.evaluate(() => { delete window.__TAURI_INTERNALS__; });

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