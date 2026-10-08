// 只读诊断（r58 v2）：编译主画布那侧的滚轮缩放**到底有没有落到 handler**。
// 上一版我猜了 wrapper 的 DOM 位置，结果测的是没被 transform 的那颗节点 ⇒ 读数无意义。
// 这版不猜：从 paper 根节点往上把**整条祖先链**的 computed transform 全打出来，
// 并分别试三种输入（合成 Ctrl+wheel / 合成普通 wheel / Playwright 真鼠标 wheel），
// 谁让链上某个节点变了，zoom 就真发生了；全都不变才是 handler 没跑。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1641; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');

const CHAIN = `(p) => { const out = []; let n = p.el; let i = 0;
  while (n && i++ < 8) { const cs = getComputedStyle(n);
    out.push({ i, tag: n.tagName, cls: String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className).slice(0, 26),
      tr: cs.transform, origin: cs.transformOrigin }); n = n.parentElement; }
  return out; }`;

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
    await sleep(1500);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

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
    await page.locator('[title="multiplier.v"]').first().click({ force: true }); await sleep(800);
    await page.keyboard.press('F5');
    for (let i = 0; i < 40; i++) {
      await sleep(700);
      const ready = await page.evaluate(() => {
        const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper();
        return !!p && p.model.getElements().length > 3;
      });
      if (ready) break;
    }

    const chain0 = await page.evaluate((src) => { const p = window.__djsDebug.getPaper(); return eval(src)(p); }, CHAIN);
    const cellRect = await page.evaluate(() => {
      const p = window.__djsDebug.getPaper();
      const t = p.model.getElements()[0];
      const n = p.findViewByModel(t).el.querySelector('.body') || p.findViewByModel(t).el;
      const r = n.getBoundingClientRect();
      return { id: t.id, x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width) };
    });
    console.log('paper 祖先链（初始）:', JSON.stringify(chain0));
    console.log('跟踪器件:', JSON.stringify(cellRect));

    const snap = async (tag) => {
      const c = await page.evaluate((src) => eval(src)(window.__djsDebug.getPaper()), CHAIN);
      const r = await page.evaluate((id) => {
        const p = window.__djsDebug.getPaper(); const n = p.findViewByModel(p.model.getCell(id)).el.querySelector('.body');
        const b = (n || p.findViewByModel(p.model.getCell(id)).el).getBoundingClientRect();
        return { w: Math.round(b.width), x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
      }, cellRect.id);
      const changed = c.filter((n, i) => n.tr !== chain0[i].tr).map((n) => `#${n.i}${n.tag}.${n.cls}:${n.tr}`);
      console.log(`${tag}: 变了的部分=${JSON.stringify(changed)} 器件=${JSON.stringify(r)}`);
      return changed.length;
    };

    // ① 合成 Ctrl+wheel（从 paper 根节点派发）
    await page.evaluate((c) => {
      const p = window.__djsDebug.getPaper();
      for (let i = 0; i < 3; i++) {
        p.el.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, clientX: c.x, clientY: c.y, bubbles: true, cancelable: true, ctrlKey: true }));
      }
    }, cellRect);
    await sleep(600);
    await snap('① 合成 Ctrl+wheel ×3');

    // ② 合成普通 wheel（应走平移分支）
    await page.evaluate((c) => {
      const p = window.__djsDebug.getPaper();
      p.el.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, clientX: c.x, clientY: c.y, bubbles: true, cancelable: true }));
    }, cellRect);
    await sleep(600);
    await snap('② 合成普通 wheel ×1');

    // ③ Playwright 真鼠标：move 到器件上 → Ctrl+wheel
    await page.mouse.move(cellRect.x, cellRect.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await sleep(700);
    const n3 = await snap('③ 真鼠标 Ctrl+wheel ×1');
    // ④ 真鼠标普通 wheel
    await page.mouse.wheel(0, -240);
    await sleep(700);
    await snap('④ 真鼠标普通 wheel ×1');

    // ⑤ 干净的一次锚点判定：重新选一个"此刻就在光标下"的器件，只用真输入放大 3 次，
    //    看它还在那不在 —— 这才是用户第 7 条要的判据（合成 wheel 在这侧行为不一致，别用它）
    const pick5 = await page.evaluate(() => {
      const p = window.__djsDebug.getPaper();
      const host = p.el;
      const hr = host.getBoundingClientRect();
      const t = p.model.getElements().find((e) => {
        const n = p.findViewByModel(e).el.querySelector('.body') || p.findViewByModel(e).el;
        const r = n.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        return cx > hr.left + 20 && cx < hr.right - 20 && cy > hr.top + 20 && cy < hr.bottom - 20;
      });
      if (!t) return null;
      const n = p.findViewByModel(t).el.querySelector('.body') || p.findViewByModel(t).el;
      const r = n.getBoundingClientRect();
      return { id: t.id, x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width) };
    });
    console.log('⑤ 锚点器件:', JSON.stringify(pick5));
    if (pick5) {
      await page.mouse.move(pick5.x, pick5.y);
      await page.keyboard.down('Control');
      for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -240); await sleep(250); }
      await page.keyboard.up('Control');
      await sleep(600);
      const after5 = await page.evaluate((id) => {
        const p = window.__djsDebug.getPaper();
        const n = p.findViewByModel(p.model.getCell(id)).el.querySelector('.body');
        const r = (n || p.findViewByModel(p.model.getCell(id)).el).getBoundingClientRect();
        const cs = getComputedStyle(p.el).transform;
        return { w: Math.round(r.width), x: r.left + r.width / 2, y: r.top + r.height / 2, matrix: cs };
      }, pick5.id);
      console.log(`⑤ 真输入 Ctrl+wheel ×3 后: ${JSON.stringify(after5)}`);
      console.log(`⑤ 光标处漂移: dx=${(after5.x - pick5.x).toFixed(1)} dy=${(after5.y - pick5.y).toFixed(1)} 宽 ${pick5.w}→${after5.w}`);
    }
    console.log('结论提示：①③ 里若有变化 ⇒ handler 跑得起来；全为 [] ⇒ 编译模式这侧滚轮没落到 handleWheel。');
    if (perr.length) console.log('页面异常: ' + perr.slice(0, 3).join(' | '));
  } catch (e) { console.log('FATAL ' + String(e.stack || e).slice(0, 400)); }
  finally { if (browser) await browser.close().catch(() => { }); if (server) server.kill(); }
})();
