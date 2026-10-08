// R74 探针（只打读数）：点「输入引脚」到底切不切换电平——以及是不是被"起手吸附"吞掉了。
//
// 起因（两条独立读数，不是猜）：
//  · r70：按当前屏幕坐标点 Input 的机身，点的整个过程里 `Input.outputSignals.out` 一直是 1，
//    而转换器的入口却从 1 变成 x ⇒ 那一下没落在"切换电平"上，落在了别的交互上。
//  · r23：夹具连点 `Input[1]` 想把数据写成 1，逐跳读数里那颗 Input 的 out 始终是 0
//    ⇒ [2b] 现在读 0（不再是 x），[2c] 的"绿"其实是这条连锁出来的空转。
// 本仓自己的注释写着「按钮的输入引脚功能完全重叠（都是**可点击切换**的电平源）」，
// 也就是说"点一下就翻电平"是**设计里有的**行为。到底是没实现、还是被拖线起手吞了，
// 只能问运行时：一次点击里如果冒出过一根临时线（cell:add 后又 cell:remove），
// 那就是 `cell:pointerdown` 的 14 px 起手吸附把它当"起线"处理了。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1741; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    try { server.unref(); } catch { }
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1000);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
    await UI.enterSandbox(page);
    await UI.clickGate(page, 'Input'); await sleep(700);

    // 记录"一次点击里有没有起过一根临时线"
    await page.evaluate(() => {
      const p = window.__sandboxPaper;
      window.__ev = [];
      p.model.on('cell:add', (c) => window.__ev.push(`+${c.isLink?.() ? 'LINE' : String(c.get('type'))}`));
      p.model.on('cell:remove', (c) => window.__ev.push(`-${c.isLink?.() ? 'LINE' : String(c.get('type'))}`));
    });

    const shot = () => page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getElements().find((e) => String(e.get('type')) === 'Input');
      const v = p.findViewByModel(c);
      const r = v.el.getBoundingClientRect();
      const marks = [...v.el.querySelectorAll('*')].map((el) => el.className && String(el.className.baseVal ?? el.className)).filter(Boolean);
      return {
        out: String((c.get('outputSignals') || {}).out ?? '—'),
        bits: c.get('bits') ?? null, mode: c.get('mode') ?? null,
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        center: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
        classes: Array.from(new Set(marks)).slice(0, 12),
      };
    });

    const s0 = await shot();
    console.log('[0] 放下的 Input =', J(s0));

    // [1] 点机身中心
    await page.mouse.click(s0.center.x, s0.center.y); await sleep(600);
    console.log('[1] 点机身中心之后 =', J(await shot()), '事件序列 =', J(await page.evaluate(() => window.__ev.splice(0))));

    // [2] 再点一次
    const s2 = await shot();
    await page.mouse.click(s2.center.x, s2.center.y); await sleep(600);
    console.log('[2] 再点一次之后 =', J(await shot()), '事件序列 =', J(await page.evaluate(() => window.__ev.splice(0))));

    // [3] 点端口磁吸附近（离 out 圆点 6 px）——这是最容易被起手吸附吃掉的位置
    const s3 = await shot();
    const near = { x: s3.box.x + s3.box.w + 6, y: s3.center.y };
    await page.mouse.click(near.x, near.y); await sleep(600);
    console.log('[3] 点 out 磁吸外 6 px 之后 =', J(await shot()), '事件序列 =', J(await page.evaluate(() => window.__ev.splice(0))));

    // [4] 对照： Lamp 是不是也点不动（同一族 IO 器件）
    await UI.clickGate(page, 'Lamp'); await sleep(700);
    const lamp = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getElements().find((e) => String(e.get('type')) === 'Lamp');
      const v = p.findViewByModel(c); const r = v.el.getBoundingClientRect();
      return { in: String((c.get('inputSignals') || {}).in ?? '—'), center: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } };
    });
    await page.mouse.click(lamp.center.x, lamp.center.y); await sleep(500);
    console.log('[4] Lamp 点一下（不该有事，只是对照点击通路）=', J(lamp), '事件序列 =', J(await page.evaluate(() => window.__ev.splice(0))));

    console.log('[E] 页面异常 =', J(perr.slice(0, 3)));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
