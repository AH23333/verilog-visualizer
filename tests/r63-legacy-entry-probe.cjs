// r63 只读探针：老闸门（r11/r13/r14/r17/r18）同一句 `Cannot read properties of undefined (reading 'model')`
// 到底卡在哪一步。它们的 boot() 是「清 localStorage → reload → 点 `button[title="新建文件"]`」，
// 然后直接读 `window.__sandboxPaper`。我猜"从没点进沙盒"，但**先量再改**：
// 把每一步之后的现场（当前是不是沙盒、那颗按钮在不在、点了之后 paper 有没有、有没有弹窗挡着）全打出来。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1655; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

const scene = (page) => page.evaluate(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const dlg = Array.from(document.querySelectorAll('div')).filter((d) => {
    const c = String(d.className || '');
    return /fixed inset-0 z-\[2?\d{3}\]/.test(c);
  }).map((d) => String(d.textContent || '').replace(/\s+/g, ' ').slice(0, 46));
  const act = Array.from(document.querySelectorAll('button[data-activity]'))
    .map((b) => b.getAttribute('data-activity') + (b.getAttribute('aria-current') === 'true' || String(b.className).includes('text-accent') ? '*' : ''));
  return {
    sandboxPaper: q('svg') > 0 && !!window.__sandboxPaper,
    compilePaper: !!(window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper()),
    btnNewFile: q('button[title="新建文件"]'),
    gateBtns: q('button[data-gate]'),
    activity: act,
    dialogs: dlg,
    bodyHint: String((document.querySelector('main') || document.body).textContent || '').replace(/\s+/g, ' ').slice(0, 90),
  };
});

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 140)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1200);

    // 完全照 r11 的 boot：清掉沙盒两把键再 reload
    await page.evaluate(() => { localStorage.removeItem('verilog-viz-sandbox-files'); localStorage.removeItem('verilog-viz-sandbox-active'); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
    console.log('[0 干净起步]', J(await scene(page)));

    // ① 老闸门的下一步：点「新建文件」
    const cnt = await page.locator('button[title="新建文件"]').count();
    console.log('[1] 新建文件按钮数 =', cnt);
    if (cnt) {
      await UI.newSandboxFile(page);
      console.log('[1 之后]', J(await scene(page)));
    } else console.log('[1 之后] 没点（按钮不存在）⇒ 老闸门在这里就该是 TimeoutError 而不是 undefined.model');

    // ② 走正确入口：点 data-activity="sandbox"
    const sb = await page.locator('button[data-activity="sandbox"]').count();
    if (sb) {
      await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1500);
      console.log('[2 点了沙盒 activity 之后]', J(await scene(page)));
      if (!(await page.evaluate(() => !!window.__sandboxPaper))) {
        await UI.newSandboxFile(page);
        console.log('[2b 沙盒里再新建文件]', J(await scene(page)));
      }
    } else console.log('[2] 没有 sandbox activity 按钮（异常）');

    // ③ 元件库是不是空的（老闸门用 ?.click() 静默放器件）
    console.log('[3] 元件库按钮 =', await page.evaluate(() => Array.from(document.querySelectorAll('button[data-gate]')).length),
      ' 分组标题 =', await page.evaluate(() => Array.from(document.querySelectorAll('button[data-gate]')).slice(0, 3).map((b) => String(b.textContent || '').trim())));
    console.log('页面异常=', perr.slice(0, 3));
  } catch (e) { console.log('FATAL ' + String(e.stack || e).slice(0, 400)); }
  finally { if (browser) await browser.close().catch(() => { }); if (server) server.kill(); UI.freePort(PORT); }
})();
