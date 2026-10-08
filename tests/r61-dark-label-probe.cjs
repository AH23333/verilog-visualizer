// r61 只读探针：深色主题下**图上的文字到底是什么颜色**（他第 7 条：所有部件/线路命名仍然为黑色）。
// 不猜 CSS 优先级：直接在两种模式、深浅两色主题下，把 paper 里所有 <text> 的计算色统计出来。
// 判"黑不黑"用亮度：rgb 三通道都 < 60 记作黑字（深底上看不见的那一族）。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1649; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const rd = (f) => require('fs').readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
const J = (o) => JSON.stringify(o);

const STAT = () => {
  const p = window.__probePaper || (window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper())
    || window.__sandboxPaper || window.__innerPaper;
  if (!p) return { noPaper: true };
  const lum = (c) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(c));
    if (!m) return null;
    return Number(m[1]) + Number(m[2]) + Number(m[3]);
  };
  const texts = Array.from(p.el.querySelectorAll('text'));
  const buckets = {};
  let darkOnDark = 0, samples = [];
  for (const t of texts) {
    const cs = getComputedStyle(t);
    const fill = cs.fill === 'none' ? cs.color : cs.fill;
    const key = String(fill);
    buckets[key] = (buckets[key] || 0) + 1;
    const L = lum(fill);
    if (L !== null && L < 180) {
      darkOnDark++;
      if (samples.length < 6) samples.push({ text: String(t.textContent || '').slice(0, 14), fill, cls: String(t.getAttribute('class') || ''), parentCls: String(t.parentElement && t.parentElement.getAttribute('class') || '').slice(0, 22) });
    }
  }
  const root = document.querySelector('[data-theme]') || document.documentElement;
  return {
    theme: root.getAttribute('data-theme') || '?',
    paperCls: String(p.el.getAttribute('class') || ''),
    bg: getComputedStyle(p.el).backgroundColor,
    nText: texts.length, darkOnDark, buckets, samples,
  };
};

const stat = (page) => page.evaluate(`(${STAT.toString()})()`);

const curTheme = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-theme]');
  return el ? el.getAttribute('data-theme') : null;
});
async function setTheme(page, want) {
  if (await curTheme(page) === want) return true;
  await page.locator('button[data-activity="主题"]').first().click(); await sleep(900);
  if (await curTheme(page) === want) return true;
  await page.locator('button[data-activity="主题"]').first().click(); await sleep(900);   // 再试一次（第一次可能点到别的）
  return (await curTheme(page)) === want;
}

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1200);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    // 真路径：三层设计 + 跨文件绑定（单层 adder.v 例化了没绑定的 full_adder ⇒ 直接拒编译，画布是空的）
    const ids = {};
    for (const f of ['multiplier.v', 'adder.v', 'full_adder.v']) {
      ids[f] = await page.evaluate(async (a) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const nf = fileStore.createFile(a.n); fileStore.saveContent(nf.id, a.c); return nf.id;
      }, { n: f, c: rd(f) });
    }
    await page.evaluate(async (a) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      fileStore.setModuleBinding(a.mul, 'adder', a.add); fileStore.setModuleBinding(a.add, 'full_adder', a.fa);
    }, { mul: ids['multiplier.v'], add: ids['adder.v'], fa: ids['full_adder.v'] });
    await page.locator('[title="multiplier.v"]').first().click({ force: true }); await sleep(700);
    await page.keyboard.press('F5');
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(600);
      ready = await page.evaluate(() => { const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper(); return !!p && p.model.getElements().length > 2; });
      if (ready) break;
    }
    if (!ready) { console.log('FATAL 编译主画布没出图（后面全是空话，不作数）'); process.exit(1); }

    for (const want of ['light', 'dark']) {
      const okTheme = await setTheme(page, want);
      await sleep(1200);
      console.log(`\n=== 编译主画布 theme=${want}（切换成功=${okTheme}）===`);
      console.log('  ', J(await stat(page)));
      // 展开图弹窗
      const zp = await page.evaluate(() => {
        const p = window.__djsDebug.getPaper();
        const s = p.model.getElements().find((e) => String(e.get('type')) === 'Subcircuit');
        if (!s) return null;
        const a = p.findViewByModel(s).el.querySelector('a.zoom');
        if (!a) return null;
        const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (zp) {
        await page.mouse.click(zp.x, zp.y);
        for (let i = 0; i < 18; i++) { await sleep(350); if (await page.evaluate(() => !!window.__innerPaper && window.__innerPaper.model.getElements().length > 0)) break; }
        console.log(`  展开图:`, J(await stat(page)));
        await page.keyboard.press('Escape'); await sleep(400);
      } else console.log('  展开图: 顶层没有子部件实例（跳过＝不作数）');
    }

    await UI.enterSandbox(page);
    await UI.clickGate(page, 'And');
    await UI.clickGate(page, 'Input');
    await UI.clickGate(page, 'Output');
    await page.evaluate(() => { window.__probePaper = window.__sandboxPaper; });
    for (const want of ['light', 'dark']) {
      const okTheme = await setTheme(page, want);
      await sleep(1200);
      console.log(`\n=== 沙盒主画布 theme=${want}（切换成功=${okTheme}）===`);
      console.log('  ', J(await stat(page)));
    }
    console.log('\n页面异常=', perr.slice(0, 3));
  } catch (e) { console.log('FATAL ' + String(e.stack || e).slice(0, 400)); }
  finally { if (browser) await browser.close().catch(() => { }); if (server) server.kill(); }
})();
