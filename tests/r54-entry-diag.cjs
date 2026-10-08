// 只读诊断：进沙盒为什么拿不到 __sandboxPaper（打页面异常 + DOM 读数，不作判定）
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1627; const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let server, browser;
  try {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = [], cons = [];
    page.on('pageerror', (e) => perr.push(String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') cons.push(m.type() + ': ' + String(m.text()).slice(0, 180)); });
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);

    const dump = async (tag) => {
      const d = await page.evaluate(() => ({
        paper: !!window.__sandboxPaper,
        gates: document.querySelectorAll('button[data-gate]').length,
        heads: document.querySelectorAll('div[title="展开分组"], div[title="收起分组"]').length,
        activity: [...document.querySelectorAll('[data-activity]')].map((b) => b.getAttribute('data-activity')),
        wrapper: !!document.querySelector('[data-sandbox-wrapper]'),
        bodyLen: document.body.innerText.length,
        sample: document.body.innerText.slice(0, 120).replace(/\n/g, ' | '),
      }));
      console.log(tag, JSON.stringify(d));
    };
    await dump('A 首屏');
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch (e) { console.log('跳过没点到:', String(e.message).slice(0, 60)); }
    await dump('B 关掉引导');
    await page.locator('button[data-activity="sandbox"]').click(); await sleep(3000);
    await dump('C 进沙盒后');
    await sleep(3000);
    await dump('D 再等 3s');
    const btns = await page.evaluate(() => [...document.querySelectorAll('button')].slice(0, 60).map(b => (b.getAttribute('title') || b.textContent || '').trim().slice(0, 24)).filter(Boolean));
    console.log('按钮清单:', JSON.stringify(btns));
    const plus = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '+' || x.getAttribute('title') === '新建文件'); if (!b) return null; const t = b.getAttribute('title'); b.click(); return t; });
    console.log('点新建:', JSON.stringify(plus));
    await sleep(2500);
    await dump('E 新建文件后');
    console.log('页面异常:', perr.slice(0, 5).join(' || ') || '无');
    console.log('控制台:', cons.slice(0, 8).join(' || ') || '无');
    await page.screenshot({ path: path.join(ROOT, '.tmpbuild', 'r54-sandbox-entry.png') });
  } catch (e) { console.log('FATAL ' + String(e.stack || e).slice(0, 300)); }
  finally { if (browser) await browser.close().catch(() => { }); if (server) server.kill(); }
})();
