// R61 验收：**深色主题下图上的文字不许是黑的**（他第 7 条：深色主题下两个模式所有部件/线路命名仍为黑色）
//
// 判据是成对的，单看"深色＝白字"会被"根本没文字"洗绿：
//   · 深色主题：paper 里所有 <text> 的计算色，暗字（三通道之和 < 180）必须为 **0 颗**，且文字总数要够；
//   · 浅色主题：反过来，暗字必须**占绝大多数**（> 90%）—— 这一格红了说明 CSS 变量整条挂了。
// 三处都量：编译主画布、部件放大镜展开图（两种模式共用）、沙盒主画布。
//
// 现场读数来自 tests/r61-dark-label-probe.cjs：dark=rgb(228,228,236)、light=rgb(24,24,27)。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1651;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1651)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unverified++; console.log(`  UNVERIFIED  ${n}（${d}）`); };

const STAT = () => {
  const p = window.__probePaper || (window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper());
  if (!p) return { noPaper: true };
  const texts = Array.from(p.el.querySelectorAll('text'));
  const buckets = {};
  let dark = 0;
  for (const t of texts) {
    const cs = getComputedStyle(t);
    const fill = cs.fill === 'none' || !cs.fill ? cs.color : cs.fill;
    const key = String(fill);
    buckets[key] = (buckets[key] || 0) + 1;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(key);
    if (m && Number(m[1]) + Number(m[2]) + Number(m[3]) < 180) dark++;
  }
  const themeEl = document.querySelector('[data-theme]');
  // 弹窗可能被主题切换关掉：脱离文档的节点读出来是空串 ⇒ "暗字 0 颗"会假绿。必须当场戳穿。
  return { theme: themeEl ? themeEl.getAttribute('data-theme') : null, n: texts.length, dark, buckets,
    inDoc: document.contains(p.el), host: String(p.el.getAttribute('class') || '').slice(0, 30) };
};
const stat = (page) => page.evaluate(`(${STAT.toString()})()`);

const curTheme = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-theme]');
  return el ? el.getAttribute('data-theme') : null;
});
async function setTheme(page, want) {
  if (await curTheme(page) === want) return true;
  for (let k = 0; k < 2; k++) {
    await page.locator('button[data-activity="主题"]').first().click(); await sleep(900);
    if (await curTheme(page) === want) return true;
  }
  return false;
}

/** 一格判据：want=主题，minText=最少文字数（防止"没文字所以全绿"） */
async function judge(page, name, want, minText) {
  if (!await setTheme(page, want)) { skip(name, `主题切不到 ${want}`); return; }
  await sleep(1000);
  const s = await stat(page);
  if (s.noPaper) { skip(name, 'paper 拿不到'); return; }
  if (!s.inDoc) { bad(name + '：paper 节点已脱离文档（读数不作数）', `host=${s.host}`); return; }
  if (s.theme !== want) { bad(name + '：data-theme 与实际读数不一致', `读=${s.theme}`); return; }
  if (s.n < minText) { bad(name + '：文字太少，判据够不着', `只有 ${s.n} 颗 <text>（要 ≥${minText}）`); return; }
  if (want === 'dark') {
    (s.dark === 0 ? ok : bad)(name, `${s.n} 颗文字里暗字 ${s.dark} 颗，色板=${J(s.buckets)}`);
  } else {
    const ratio = s.dark / s.n;
    (ratio > 0.9 ? ok : bad)(name + '（浅色反向对照）', `${s.n} 颗里暗字 ${s.dark} 颗（应 >90%），色板=${J(s.buckets)}`);
  }
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
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 180)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1200);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    // 真路径：三层设计 + 跨文件绑定（玩具夹具的单层设计在这条链上会被拒编译）
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
      ready = await page.evaluate(() => {
        const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper();
        return !!p && p.model.getElements().length > 2;
      });
      if (ready) break;
    }
    if (!ready) { console.log('FATAL 编译主画布没出图 —— 后面全是空话，不作数'); process.exit(1); }

    for (const want of ['dark', 'light']) {
      await judge(page, `[1] 编译主画布 theme=${want}`, want, 50);
    }

    // 展开图弹窗（两种模式共用，他报的正是这处）
    const zoomXY = () => page.evaluate(() => {
      const p = window.__djsDebug.getPaper();
      const s = p.model.getElements().find((e) => String(e.get('type')) === 'Subcircuit');
      if (!s) return null;
      const a = p.findViewByModel(s).el.querySelector('a.zoom');
      if (!a) return null;
      const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const openInner = async () => {
      const z = await zoomXY();
      if (!z) return 'no-zoom';
      await page.mouse.click(z.x, z.y);
      for (let i = 0; i < 20; i++) {
        await sleep(350);
        if (await page.evaluate(() => !!window.__innerPaper && window.__innerPaper.model.getElements().length > 0)) {
          await page.evaluate(() => { window.__probePaper = window.__innerPaper; });
          return 'ok';
        }
      }
      return 'no-render';
    };
    // ⚠ 每换一次主题都重开一次弹窗：弹窗可能被主题切换关掉，拿脱文档的节点读数会假绿
    for (const want of ['dark', 'light']) {
      if (!await setTheme(page, want)) { skip(`[2] 展开图 theme=${want}`, `主题切不到 ${want}`); continue; }
      const st = await openInner();
      if (st === 'no-zoom') { skip(`[2] 展开图 theme=${want}`, '顶层没有子部件实例，🔍 无处可点'); break; }
      if (st === 'no-render') { skip(`[2] 展开图 theme=${want}`, '弹窗没渲染出器件'); continue; }
      await judge(page, `[2] 展开图 theme=${want}`, want, 20);
      await page.evaluate(() => { delete window.__probePaper; });
      await page.keyboard.press('Escape'); await sleep(400);
    }

    // 沙盒主画布
    await UI.enterSandbox(page);
    for (const t of ['And', 'Input', 'Output']) await UI.clickGate(page, t);
    await page.evaluate(() => { window.__probePaper = window.__sandboxPaper; });
    for (const want of ['dark', 'light']) {
      await judge(page, `[3] 沙盒主画布 theme=${want}`, want, 8);
    }

    (perr.length ? bad : ok)('[4] 全程无页面异常', perr.slice(0, 3).join(' | '));
    console.log(`\n===== R61 深色主题文字: ${pass} PASS / ${fail} FAIL / ${unverified} UNVERIFIED =====`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
    fail++;
    console.log(`\n===== R61 深色主题文字: ${pass} PASS / ${fail} FAIL / ${unverified} UNVERIFIED =====`);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
  }
})();
