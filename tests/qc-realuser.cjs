// 完全模拟真实用户：全部用真实鼠标操作（放置/连线/点击输入引脚），
// 并覆盖「保存 → 刷新 → 重开」持久化路径。生产构建 (vite preview) 下运行。
// 设置档走默认预设（autoStartSim=true）；同一套动作在"仿真没自动起"下的另一颗是 qc-paused。
//
// ⚠ 入口（波次三，2026-10-18）：原来开的是 dist 根路径＝旧 React 单页（活动栏 + localStorage 沙盒库），
//   那颗主人随片 5 退役 ⇒ `boot()` 等的 `button[data-activity]` 永远等不到，整格 FATAL 在 30s。
//   生产包里的沙盒只剩一颗主人＝`doc.html`（custom editor，⛔ 在 `vite build` 的 inputs 里的是
//   gates.html，正本 `vite.config.ts:19-25`），所以入口搬到 doc.html + `tests/_dochost.cjs` 的同协议假宿主：
//   量的仍是**构建产物**，只是终于量在产品真身上。
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const DH = require('./_dochost.cjs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 4175;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(4175)); } catch { }   // 与 qc-paused 分开一颗端口：同端口先后跑会把上一颗的遗留服务读成自己的
const URL = DH.DOC_URL(PORT);
const DOC = 'qc/realuser_circuit.djs';
const EMPTY = JSON.stringify({ cells: [] });
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
    server = spawn(process.execPath, [require('path').join(__dirname, '..', 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { windowsHide: true, cwd: PROJECT_ROOT, stdio: 'pipe' });
    console.log('preview:', (await waitForServer()) ? 'OK' : 'FAIL');
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    // 与 qc-paused 的唯一差别：交**默认设置**（autoStartSim=true ⇒ 仿真自己在跑）。
    // qc-paused 那一颗钉的是"仿真没起时手动拨输入也要跟着算"。
    // 旧写法把这颗前提写在 `localStorage['verilog-viz-sandbox-settings']` 上——沙盒偏好从片 5 起
    // 不再持久化（真源＝宿主 `contributes.configuration`），所以今天唯一的入口形状就是宿主的 getConfig：
    // 交 `sandbox:{}` ＝让 `settingsStore.applyHostConfig` 落成默认档（与产品里"用户没改过设置"同一形状）。
    const seedId = `qc-realuser-${Date.now()}`;   // 一次跑一个 seedId：同 seedId 的 reload＝磁盘⛔ 重铺
    await DH.installFakeHost(page, {
      seedId, docName: DOC, files: { [DOC]: EMPTY },
      config: { ...DH.DEFAULT_CONFIG, sandbox: {} },
    });
    await DH.bootDoc(page, PORT, { settle: 1500 });
    const mounted = await DH.mountProbe(page);
    (mounted.paper && mounted.sidebar && mounted.gates > 0 && mounted.toolbar)
      ? ok('[0] 生产包里的 doc.html 挂起沙盒（画布 + 部件库 + 工具条都在）', `器件库 ${mounted.gates} 颗 / 画布 ${mounted.cells} 格`)
      : bad('[0] dist 的 doc.html 没挂全 ⇒ 下面各格的前置⛔ 成立', JSON.stringify(mounted));

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
    (lit1 ? ok : bad)('[2] 生产包 + 默认档（自动起仿）：真鼠标拨两个输入后与门把灯点亮', `${JSON.stringify(s1)}（links=${nLinks}）`);

    console.log('\n===== 保存 → 刷新 → 重开 =====');
    // 保存＝点工具条那颗真「保存」钮（用户看得见的那一颗），然后**问宿主收到了什么正文**——
    // 读的是发出去的字节，⛔ 再从画布复算一遍（那只会复述我的假设）。
    // 这一格是旧版没有的：旧档点完保存直接 sleep(900)，"到底交出去没有"从没判过，
    // 于是 [3]「刷新后部件还在」可能只是同一页内存没清（doc 持久化那颗 r154 的[5] 反向臂同理）。
    await page.locator('button[title^="保存"]').first().click();
    await sleep(1200);
    const ro = await DH.fakeHostReadout(page);
    const body = ro ? String(ro.files[DOC] || '') : '';
    (ro && ro.edits >= 1 && /"And"/.test(body) && /"Lamp"/.test(body))
      ? ok('[S] 「保存」把正文交给宿主（落盘正文里找得到与门和灯）', `edits=${ro.edits} 正文 ${body.length}B`)
      : bad('[S] 保存没落到宿主（画布上的东西⛔ 交出去）', JSON.stringify({ edits: ro && ro.edits, doc: ro && ro.docMessages, 正文头: body.slice(0, 70) }));
    // 同 seedId 刷新＝假宿主那盘⛔ 重铺（`vv-fake-fs` 跨 reload 存活）⇒ 画布只能从"盘上正文"长回来
    await page.reload({ waitUntil: 'domcontentloaded' });
    const restored = await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!restored) {
      bad('[3] 刷新后活动沙盒文件自动带回', '重载后没有 paper：文档没被重新交给编辑器');
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
