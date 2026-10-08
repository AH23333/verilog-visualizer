// 完全模拟真实用户：全部用真实鼠标操作（放置/连线/点击输入引脚），
// 并覆盖「保存 → 刷新 → 重开」持久化路径。生产构建 (vite preview) 下运行。
// 设置档走默认预设（autoStartSim=true）；同一套动作在"仿真没自动起"下的另一颗是 qc-paused。
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 4175;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(4175)); } catch { }   // 与 qc-paused 分开一颗端口：同端口先后跑会把上一颗的遗留服务读成自己的
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 跑批只认 PASS/FAIL 行：本格原来通篇 `>>>` 叙述、一条断言都不打 ⇒ NOVERDICT 被 FATAL 盖成 RED，
// 谁也没法说它到底判了什么。下面把三条真实交互结论各钉一颗判据。
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
// 真实鼠标点击调色板按钮（不用 JS click）
async function realClickGate(page, label) {
  await require('./_ui.cjs').ensurePalette(page);
  const btn = page.locator(`button[data-gate="${label}"]`);
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click();           // Playwright 真实鼠标点击
  await sleep(500);
}
const portCenter = (page, id, port) => page.evaluate(({ id, port }) => {
  const p = window.__sandboxPaper; const c = p.model.getCell(id); const v = c?.findView(p); if (!v) return null;
  const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { id, port });
async function wire(page, s, sp, t, tp) {
  const a = await portCenter(page, s, sp); const b = await portCenter(page, t, tp);
  if (!a || !b) return false;
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(120);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 }); await sleep(100);
  await page.mouse.move(b.x, b.y, { steps: 6 }); await sleep(250); await page.mouse.up(); await sleep(500);
  return true;
}
const lampState = (page, id) => page.evaluate((id) => {
  const p = window.__sandboxPaper; const l = p.model.getCell(id);
  const v = l?.findView(p)?.el?.querySelector?.('.led');
  const o = l?.get('inputSignals'); const iv = o?.in;
  return { led: v ? getComputedStyle(v).fill : null, in: iv && iv.toString ? iv.toString() : String(iv) };
}, id);
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    // 这一格量的是**构建产物**：先证明 dist 不比 src 旧，否则读的是上一版的壳（#265 一族）。
    console.log('产物新鲜度:', require('./_ui.cjs').ensureFreshDist(PROJECT_ROOT));
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    console.log('preview:', (await waitForServer()) ? 'OK' : 'FAIL');
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await require('./_ui.cjs').boot(page, URL);
    // 与 qc-paused 的唯一差别：**不写设置档**，走默认预设（autoStartSim: true ⇒ 仿真自己在跑）。
    // qc-paused 那一颗钉的是"仿真没起时手动拨输入也要跟着算"。
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k=>localStorage.removeItem(k)); });
    await require('./_ui.cjs').boot(page, URL, { reload: true, settle: 1500 });
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    // ⚠ 死锚点（实测遮罩拦点击）：`button[title="新建文件"]` 在**编译视图**点下去弹的是
    // PromptDialog（`fixed inset-0 z-[2100]`），不填就不关 ⇒ 后面每次真鼠标点击都被它拦住。
    await require('./_ui.cjs').newSandboxFile(page);

    console.log('===== 真实鼠标放置 + 连线 =====');
    await realClickGate(page, 'Input'); await realClickGate(page, 'Input');
    await realClickGate(page, 'And');  await realClickGate(page, 'Lamp');
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    console.log('    放置:', JSON.stringify(Object.fromEntries(Object.entries(ids).map(([k,v])=>[k,v.length]))));
    const inPorts = await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).getPorts().filter(p => p.group === 'in').map(p => p.id), ids.And[0]);
    await wire(page, ids.Input[0], 'out', ids.And[0], inPorts[0]);
    await wire(page, ids.Input[1], 'out', ids.And[0], inPorts[1]);
    await wire(page, ids.And[0], 'out', ids.Lamp[0], 'in');
    const nLinks = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
    console.log('    links =', nLinks);
    (nLinks >= 3 ? ok : bad)('[1] 生产包下真鼠标放置 + 三根连线都接上', `links=${nLinks}`);

    // 真实点击两个输入引脚（点盒体中心，不借助内部选择器）
    for (const iId of ids.Input) {
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
        const r = v.el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, iId);
      await page.mouse.click(pt.x, pt.y); await sleep(700);
    }
    const s1 = await lampState(page, ids.Lamp[0]);
    console.log('    点击两个输入后 灯:', JSON.stringify(s1));
    const lit1 = /3, 192, 60|#03c03c/.test(s1.led);
    (lit1 ? ok : bad)('[2] 生产包 + 不自动起仿：真鼠标拨两个输入后与门把灯点亮', `${JSON.stringify(s1)}（links=${nLinks}）`);

    console.log('\n===== 保存 → 刷新 → 重开 =====');
    await page.locator('button[title^="保存"]').first().click();
    await sleep(900);
    await require('./_ui.cjs').boot(page, URL, { reload: true, settle: 1500 });
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    // 重载后落在默认视图（电路/代码）：沙盒必须由夹具再进去。刻意不用 enterSandbox ——
    // 它读不到 paper 会**新建文件**，那正好把"持久化"这颗判据的前置抹掉。
    await page.locator('button[data-activity="sandbox"]').click();
    const restored = await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!restored) {
      bad('[3] 刷新后活动沙盒文件自动带回', '回到沙盒却没有 paper：活动文件没被恢复');
      bad('[4] 刷新后与门仍响应真鼠标点击', '前置没成（没有画布），不作数');
    } else {
    const ids2 = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    console.log('    重开后的部件:', JSON.stringify(Object.fromEntries(Object.entries(ids2 || {}).map(([k,v])=>[k,v.length]))));
    const kept = !!(ids2 && ids2.And && ids2.Input && ids2.Input.length >= 2 && ids2.Lamp);
    kept ? ok('[3] 刷新后与门/两个输入/灯都带回来了', JSON.stringify(Object.fromEntries(Object.entries(ids2).map(([k, v]) => [k, v.length]))))
         : bad('[3] 刷新后部件丢失', JSON.stringify(ids2));
    if (kept) {
      // 重开后再点一次第一个输入引脚（0→1，另一个仍 0）⇒ 与门输出 0，灯必须**跟着变**，
      // 这一格判的是"重开后的连线还活着"，不预设灯色（预设就是没见过的读数）。
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
        const r = v.el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, ids2.Input[0]);
      await page.mouse.click(pt.x, pt.y); await sleep(700);
      const s2 = await lampState(page, ids2.Lamp[0]);
      console.log('    重开后点击输入 灯:', JSON.stringify(s2));
      (/3, 192, 60|#03c03c|252, 124, 104|#fc7c68/.test(String(s2.led)) && s2.in !== 'n/a')
        ? ok('[4] 刷新后与门仍响应真鼠标点击（灯被重画、端口有读数）', `${JSON.stringify(s2)}`)
        : bad('[4] 刷新后与门无响应', JSON.stringify(s2));
    } else {
      bad('[4] 刷新后与门仍响应真鼠标点击', '前置没成（部件丢失），不作数');
    }
    }
    console.log('pageerrors:', JSON.stringify(errors.slice(0, 5)));
    console.log(`\n===== QC-REALUSER DONE: ${pass} pass, ${fail} fail =====`);
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); fail++; }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
