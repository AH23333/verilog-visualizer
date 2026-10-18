// 在「生产构建」(vite preview, 跑 dist) 下复现「逻辑门无法使用」
//
// ⚠ 入口（波次三，2026-10-18）：这一族原来开的是 dist 的**根路径**（旧 React 单页 + localStorage 沙盒库）。
//   那颗主人随片 5 退役后，根路径只剩编译态残壳 `index.html`：`boot()` 等的活动栏 `button[data-activity]`
//   在上面⛔ 存在 ⇒ 整格 FATAL 在 30s 超时，红的是入口不是产品。
//   而 `gates.html` 又⛔ 在 `vite build` 的 inputs 里（正本 `vite.config.ts:19-25`：main/doc/binding），
//   所以**生产包里的沙盒只剩一颗主人＝`doc.html`**（custom editor）。⇒ 入口搬到它 + `tests/_dochost.cjs`
//   那颗同协议假宿主：这一族继续在**构建产物**上量产品真身，⛔ 为了跑通而降口径去跑 dev 的 gates.html。
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const DH = require('./_dochost.cjs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 4173;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(4173)); } catch { }
const URL = DH.DOC_URL(PORT);          // 等的就是这颗文件：dist 里没有 doc.html 也在这里当场暴露
const DOC = 'qc/preview_circuit.djs';  // 带文件夹的相对名＝顺手验一条真形状（工作区名⛔ 等于裸名）
const EMPTY = JSON.stringify({ cells: [] });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 跑批只认 PASS/FAIL：这颗原来通篇 `>>>` 叙述，一条断言都不打 ⇒ 被 FATAL 盖成 RED 也没人说清它判了什么。
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickGate = async (page, l) => { await require('./_ui.cjs').clickGate(page, l); await sleep(450); };
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
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    // 本格量的是**构建产物** ⇒ 先证明 dist 不比 src 旧（读旧壳会把已修好的东西判成没修，#265 一族）。
    console.log('产物新鲜度:', require('./_ui.cjs').ensureFreshDist(PROJECT_ROOT));
    server = spawn(process.execPath, [require('path').join(__dirname, '..', 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { windowsHide: true, cwd: PROJECT_ROOT, stdio: 'pipe' });
    const okSrv = await waitForServer();
    console.log('preview server:', okSrv ? 'OK' : 'FAIL');
    if (!okSrv) { console.log('FATAL 生产预览服务没起来'); process.exit(1); }
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (/error/i.test(m.type())) errors.push('console: ' + m.text().slice(0, 140)); });
    // 三处死锚点（实测 `放置结果: null` → 整格 FATAL）已全部交掉：
    //   · networkidle 在这台 preview 服务器上等不满 ⇒ `bootDoc` 只等 DOM + 画布锚点；
    //   · `button[data-activity]`（活动栏）随旧 React 单页退役 ⇒ 假宿主下 doc.html 直接挂画布；
    //   · `button[title="新建文件"]` 在编译视图弹 PromptDialog 遮罩 ⇒ 「新建」这件事交给假宿主的 seed 磁盘。
    const seedId = `qc-preview-${Date.now()}`;   // 一次跑一个 seedId：同 seedId 的 reload＝磁盘⛔ 重铺
    await DH.installFakeHost(page, { seedId, docName: DOC, files: { [DOC]: EMPTY } });
    await DH.bootDoc(page, PORT, { settle: 1500 });
    const mounted = await DH.mountProbe(page);   // 三颗 doc 档共用一份屏幕读数（⛔ 各写一遍选择器形状）
    (mounted.paper && mounted.sidebar && mounted.gates > 0)
      ? ok('[0] 生产包里的 doc.html 挂得起沙盒画布（入口这一层先自证）', `部件库先可见 ${mounted.gates} 颗（分组折叠着，展开由夹具负责）`)
      : bad('[0] dist 的 doc.html 没挂起画布 ⇒ 下面各格的前置⛔ 成立', JSON.stringify(mounted));

    console.log('===== [1] 与门：输入引脚驱动 =====');
    await clickGate(page, 'Input'); await clickGate(page, 'Input');
    await clickGate(page, 'And'); await clickGate(page, 'Lamp'); await sleep(600);
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    console.log('    放置结果:', JSON.stringify(ids));
    if (!ids || !ids.And) { bad('[0] 生产包下能从调色板放出一个与门', `放置结果=${JSON.stringify(ids)}`); console.log('FATAL: 与门未被放置'); await browser.close(); process.exit(1); }
    const inPorts = await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).getPorts().filter(p => p.group === 'in').map(p => p.id), ids.And[0]);
    const w = [];
    w.push(await wire(page, ids.Input[0], 'out', ids.And[0], inPorts[0]));
    w.push(await wire(page, ids.Input[1], 'out', ids.And[0], inPorts[1]));
    w.push(await wire(page, ids.And[0], 'out', ids.Lamp[0], 'in'));
    const links = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
    console.log('    连线:', JSON.stringify(w), ' links =', links);
    (w.every(Boolean) && links >= 3 ? ok : bad)('[1] 生产包下三根连线都真接上了', `links=${links} 每次连线=${JSON.stringify(w)}`);
    const rd = () => page.evaluate(({ a, ins, l }) => {
      const p = window.__sandboxPaper;
      const g = (id) => { const c = p.model.getCell(id); if (!c) return 'no-cell'; const o = c.get('outputSignals'); const v = o?.out; return v ? v.toString() : 'n/a'; };
      const lampV = p.model.getCell(l)?.findView(p)?.el?.querySelector?.('.led');
      return { in1: g(ins[0]), in2: g(ins[1]), and: g(a), lamp: lampV ? getComputedStyle(lampV).fill : null };
    }, { a: ids.And[0], ins: ids.Input, l: ids.Lamp[0] });
    console.log('    连线后:', JSON.stringify(await rd()));
    for (const iId of ids.Input) {
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const c = p.model.getCell(id); const v = c.findView(p);
        const b = v.el.querySelector('.btnface') || v.el.querySelector('.body') || v.el;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, iId);
      await page.mouse.click(pt.x, pt.y); await sleep(700);
    }
    const after = await rd();
    console.log('    两个输入都点击后:', JSON.stringify(after));
    const lit = /3, 192, 60|#03c03c/.test(after.lamp);
    (lit ? ok : bad)('[2] 生产构建下拨两个输入后与门把灯点亮（他报的"逻辑门无法使用"不再复现）', JSON.stringify(after));
    console.log('pageerrors:', JSON.stringify(errors.slice(0, 5)));
    console.log(`\n===== QC-PREVIEW DONE: ${pass} pass, ${fail} fail =====`);
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); fail++; }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
