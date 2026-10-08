// r59 只读诊断：编译主画布 Ctrl+滚轮的锚点为什么偏 ~700px（他第 7 条的另一半）。
// 不猜：一次一格真输入滚轮，把三件事同时打出来——
//   ① wrapper 的**内联** transform（只有 React 的 applyTransform 会写）⇒ 证明 handleWheel 跑没跑；
//   ② paper / 祖先链的 computed transform ⇒ 证明 joint 那侧有没有自己动手；
//   ③ 光标下那颗器件的 client 中心 与「按 CSS 模型应当落在哪」的预测值。
// 预测：screen = containerRect.left + off + pan + zoom*local，off = wrapper 未变换时的布局原点。
// 若实测 ≠ 预测，off（wrapper 相对容器有位移）或"有人二次缩放"就是根因。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1643; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');

const J = (o) => JSON.stringify(o);

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
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(700);
      ready = await page.evaluate(() => {
        const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper();
        return !!p && p.model.getElements().length > 3;
      });
      if (ready) break;
    }
    if (!ready) { console.log('FATAL 编译没出图（paper 里没有器件）'); process.exit(1); }

    // 祖先链 computed transform（从 paper 根节点往上 8 层）
    const chain = () => page.evaluate(() => {
      const p = window.__djsDebug.getPaper();
      const out = []; let n = p.el, i = 0;
      while (n && i++ < 8) {
        const cs = getComputedStyle(n);
        const cls = String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className).slice(0, 24);
        out.push({ i, tag: n.tagName, cls, tr: cs.transform, r: [Math.round(n.getBoundingClientRect().left), Math.round(n.getBoundingClientRect().top)] });
        n = n.parentElement;
      }
      return out;
    });

    // 选一颗稳稳在视口里的器件，并记下它的 paper-local 中心（缩放后 local 不变，可直接预测 client）
    const pick = await page.evaluate(() => {
      const p = window.__djsDebug.getPaper();
      const hr = p.el.getBoundingClientRect();
      const inBox = (r) => r.width > 8 && r.left + r.width / 2 > hr.left + 40 && r.left + r.width / 2 < hr.right - 40
        && r.top + r.height / 2 > hr.top + 40 && r.top + r.height / 2 < hr.bottom - 40;
      const nodeOf = (e) => { const v = p.findViewByModel(e); return v && v.el ? (v.el.querySelector('.body') || v.el) : null; };
      const t = p.model.getElements().find((e) => { const n = nodeOf(e); return n && inBox(n.getBoundingClientRect()); });
      if (!t) return null;
      const n = nodeOf(t); const r = n.getBoundingClientRect();
      const local = p.clientToLocalPoint ? p.clientToLocalPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return { id: t.id, type: String(t.get('type')), cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        w: Math.round(r.width), local: local ? { x: Math.round(local.x * 100) / 100, y: Math.round(local.y * 100) / 100 } : null };
    });
    if (!pick) { console.log('FATAL 视口内没有可跟踪的器件'); process.exit(1); }

    const snap = async (tag) => {
      const st = await page.evaluate(() => window.__djsDebug.getZoomState());
      const af = await page.evaluate((id) => {
        const p = window.__djsDebug.getPaper();
        const v = p.findViewByModel(p.model.getCell(id));
        const n = (v.el.querySelector('.body') || v.el);
        const r = n.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: Math.round(r.width) };
      }, pick.id);
      // 预测：screen = 布局原点 + pan + zoom*local（origin 0 0 ⇒ 变换后盒左上 = 布局原点 + pan）
      const layout = st.wrapperRect ? { x: st.wrapperRect.l - st.pan.x, y: st.wrapperRect.t - st.pan.y } : null;
      const off = layout ? { x: layout.x - st.container.l, y: layout.y - st.container.t } : null;
      const pred = (layout && (!st.jointScale || st.jointScale.sx === 1))
        ? { x: layout.x + st.pan.x + st.zoom * pick.local.x, y: layout.y + st.pan.y + st.zoom * pick.local.y }
        : null;
      console.log(`\n[${tag}] zoom=${st.zoom.toFixed(4)} pan=${J(st.pan)} userView=${st.userView} joint=${J(st.jointScale)}`);
      console.log(`  wrapperInline=${JSON.stringify(st.wrapperInline)} origin=${JSON.stringify(st.wrapperOrigin)}`);
      console.log(`  container=${J(st.container)} wrapperRect=${J(st.wrapperRect)} paperRect=${J(st.paperRect)} paperInline=${JSON.stringify(st.paperInline)}`);
      console.log(`  wrapper布局原点=${J(layout)} 相对容器 off=${J(off)}（off≠0 ⇒ 锚点公式漏了这项）`);
      console.log(`  器件 client=(${af.cx.toFixed(1)}, ${af.cy.toFixed(1)}) w=${af.w}`);
      if (pred) console.log(`  CSS 模型预测=(${pred.x.toFixed(1)}, ${pred.y.toFixed(1)}) 残差=(${(af.cx - pred.x).toFixed(1)}, ${(af.cy - pred.y).toFixed(1)})`);
      console.log(`  与光标位移 d=(${(af.cx - pick.cx).toFixed(1)}, ${(af.cy - pick.cy).toFixed(1)})`);
      console.log(`  chain=${J(await chain())}`);
      return { st, af };
    };

    console.log('初始 pick=' + J(pick));
    await snap('0 基线');
    // 让 elk 的异步重排与 render:done 自动适应窗口先跑完（真人也是等画面稳了才滚）
    await sleep(3500);
    const pick2 = await page.evaluate((id) => {
      const p = window.__djsDebug.getPaper();
      const n = p.findViewByModel(p.model.getCell(id)).el.querySelector('.body');
      const el2 = n || p.findViewByModel(p.model.getCell(id)).el;
      const r = el2.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const local = p.clientToLocalPoint ? p.clientToLocalPoint(cx, cy) : null;
      return { cx, cy, w: Math.round(r.width),
        local: local ? { x: Math.round(local.x * 100) / 100, y: Math.round(local.y * 100) / 100 } : null };
    }, pick.id);
    console.log('静置 3.5 s 后同一器件=' + J(pick2) + '（这段位移是自动适应窗口做的，不算缺陷）');
    pick.cx = pick2.cx; pick.cy = pick2.cy; pick.w = pick2.w; pick.local = pick2.local;
    for (const tick of [1, 2, 3]) {
      await page.mouse.move(pick.cx, pick.cy);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -240);        // deltaY<0 ⇒ handleWheel 应取 delta=1.1（放大）
      await page.keyboard.up('Control');
      await sleep(800);
      await snap(`${tick} 真输入 Ctrl+wheel ×1 (deltaY=-240)`);
    }

    // 普通滚轮：只该平移，zoom 不许变
    await sleep(3500);
    await snap('★ 三次滚轮后静置 3.5 s（zoom/pan 若又变回"适应窗口"值 ⇒ 抹画面的还在干活）');
    await page.mouse.move(pick.cx, pick.cy);
    await page.mouse.wheel(0, -120);
    await sleep(700);
    const pl = await snap('4 真输入 普通 wheel ×1（只该平移）');
    console.log('\n结论提示：wrapperInline 变了 ⇒ React handler 跑了；chain 里若 paper/祖先也变 ⇒ 有第二颗缩放者。');
    console.log('残差恒 0 ⇒ CSS 模型自洽，锚点错在公式；残差随 zoom 放大 ⇒ off 或二次缩放。');
    if (pl.st.wrapperInline === null) console.log('⚠ wrapperInline 读不到（wrapper 已重建？）');
    if (perr.length) console.log('页面异常: ' + perr.slice(0, 3).join(' | '));
  } catch (e) { console.log('FATAL ' + String(e.stack || e).slice(0, 400)); }
  finally { if (browser) await browser.close().catch(() => { }); if (server) server.kill(); }
})();
