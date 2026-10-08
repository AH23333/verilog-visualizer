// R7.5 P1-a 连线验收：放两颗器件 → 拖一根线 → 点电平源 → 指示灯真的亮。
//
// 为什么这一版重写了（两条锚点早就死了，不是产品坏了）：
//  · 旧脚本按**按钮文字** `=== 'Button'` 放器件 —— 「按钮」这颗早已从元件库里撤掉
//    （与「输入引脚」功能重叠），标签又是中文（输入引脚 / 指示灯）⇒ 两次点击都是空操作
//    ⇒ `magnets: []`、links=0、灯永远不亮。
//  · 读灯色用 `[data-type="Lamp"]` —— joint 的视图根节点上**没有 data-type**（本仓 0 处），
//    所以 fill 恒空串。这两条一起造出"拖线坏了 / 灯坏了"的假象（跑批日志里它就是这两红）。
// 现在统一走共用夹具 `tests/_ui.cjs`：按 `data-gate` 放器件、按模型算端口坐标、
// 灯色从器件自己的视图里读，并且**同时读模型电平**（灯绿了不算完，得看 in 是不是 1）。
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1420;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1420)); } catch { }
const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

let server;
let browser;
const results = { pass: 0, fail: 0, unver: 0, facts: {} };
function ok(name, msg = '') { results.pass++; console.log(`  PASS  ${name}${msg ? ' — ' + msg : ''}`); }
function bad(name, msg = '') { results.fail++; console.log(`  FAIL  ${name}${msg ? ' — ' + msg : ''}`); }
function skip(name, msg = '') { results.unver++; console.log(`  UNVERIFIED  ${name}${msg ? ' — ' + msg : ''}`); }

async function waitForServer(timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const res = await fetch(URL); if (res.ok) return true; } catch { }
    await sleep(500);
  }
  return false;
}

/**
 * 指示灯的填充色：要读那颗 **`.led`**，不是灯壳 `.body`。
 * ⚠ 本文件第一版拿 `.body` 当灯读，量到的是外壳的 `rgb(35, 40, 48)`（面板深灰），
 * 于是"灯不亮"—— 而模型侧 `Lamp.in` 明明已经从 0 翻到 1。r20/r23/r24 三颗绿闸门
 * 都是按 `.led` 读的（rgb(3,192,60) 亮 / rgb(252,124,104) 灭），这里向它们对齐。
 * 读不到 `.led` 时**如实报告命中了哪个选择器**，绝不静默退回灯壳。
 */
const lampPaint = (page) => page.evaluate(() => {
  const p = window.__sandboxPaper;
  const c = p && p.model.getElements().find((e) => String(e.get('type')) === 'Lamp');
  if (!c) return { noCell: true };
  const v = p.findViewByModel(c);
  if (!v) return { noView: true };
  const led = v.el.querySelector('.led');
  const pick = led || v.el.querySelector('circle.body, rect.body, .body');
  const cs = pick ? getComputedStyle(pick) : null;
  const raw = (c.get('inputSignals') || {}).in;
  return {
    hit: led ? '.led' : (pick ? '灯壳(不是 .led!)' : null),
    attr: pick ? pick.getAttribute('fill') : null,
    css: cs ? cs.fill : null,
    in: raw == null ? '—' : String(raw).replace(/^Vector3vl\s+/, ''),
  };
});

(async () => {
  try {
    console.log('[1/6] starting vite dev server...');
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'ignore' });
    try { server.unref(); } catch { }
    if (!await waitForServer()) { console.log('FATAL 服务没起来'); results.fail++; throw new Error('no server'); }

    console.log('[2/6] launching Edge headless...');
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; const dialogs = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });

    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => {
      localStorage.removeItem('verilog-viz-sandbox-files');
      localStorage.removeItem('verilog-viz-sandbox-active');
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    console.log('[3/6] 进沙盒，放「输入引脚」+「指示灯」…');
    await UI.enterSandbox(page);
    await UI.clickGate(page, 'Input'); await sleep(700);
    await UI.clickGate(page, 'Lamp'); await sleep(700);
    const ports = await UI.portPoints(page);
    results.facts.ports = ports.map((m) => m.port);
    if (!ports.some((m) => m.port === 'out') || !ports.some((m) => m.port === 'in')) {
      skip('P1a-1: model links >= 1', `画布上没有 out/in 端口可连（看到 ${J(results.facts.ports)}）`);
      throw new Error('器件没放出来');
    }

    console.log('[4/6] 拖线 Input.out → Lamp.in…');
    await UI.dragWire(page, 'out', 'in');
    const linkCount = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return p ? p.model.getLinks().length : -1;
    });
    results.facts.linkCount = linkCount;
    linkCount >= 1 ? ok('P1a-1: model links >= 1', `count=${linkCount}`)
      : bad('P1a-1: model links >= 1', `count=${linkCount}（端口都在，说明拖线没接上）`);

    console.log('[5/6] 点输入引脚换电平，看指示灯…');
    const before = await lampPaint(page);
    const src = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getElements().find((e) => String(e.get('type')) === 'Input');
      const v = c && p.findViewByModel(c); if (!v) return null;
      const r = v.el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!src) skip('P1a-2: Lamp lights up', '拿不到输入引脚的屏幕坐标');
    else {
      await page.mouse.click(src.x, src.y); await sleep(900);
      const after = await lampPaint(page);
      results.facts.lampFill = { before, after };
      console.log('       灯：', J(before), '→', J(after));
      // 两条臂各钉一层，且都用**成对读数**（点前 vs 点后），不写"颜色不等于空"这种松判据：
      //   P1a-2   渲染层：`.led` 的填充色从灭色换成亮色；
      //   P1a-2b  模型层：Lamp 端口确实收到 1（点前是 0）—— 亮灯不是残留的一次上色。
      const litRe = /3,\s*192,\s*60|#03c03c/i;
      const offRe = /252,\s*124,\s*104|#fc7c68|191,\s*197,\s*198/i;
      const colorOf = (o) => String(o.css || '') + ' ' + String(o.attr || '');
      (after.hit === '.led' && litRe.test(colorOf(after)) && offRe.test(colorOf(before))
        ? ok : bad)(
        'P1a-2: 点亮输入后 .led 的填充色从灭色翻成亮色（渲染层）',
        `命中=${J(after.hit)} 点前=${J(before.css || before.attr)} 点后=${J(after.css || after.attr)}`);
      (before.in === '0' && after.in === '1'
        ? ok : bad)(
        'P1a-2b: 模型真给了电平——Lamp 端口 0→1（不是残留上色，也不是读值恒 x）',
        `点前 Lamp.in=${J(before.in)} 点后=${J(after.in)}`);
    }

    dialogs.length === 0 ? ok('P1a-3: 0 native dialogs') : bad('P1a-3: 有原生弹窗', dialogs.join('; '));
    const typeErrors = errors.filter(e => /TypeError/i.test(e));
    typeErrors.length === 0 ? ok('P1a-4: 0 TypeErrors', `total=${errors.length}`) : bad('P1a-4: 有 TypeErrors', typeErrors.join('; '));
    console.log('[6/6] DONE: %d pass, %d fail, %d unverified', results.pass, results.fail, results.unver);
  } catch (e) {
    console.log('FATAL ' + String(e && e.stack || e).slice(0, 300));
    results.fatal = String(e && e.message || e).slice(0, 200);
  } finally {
    console.log('facts: ' + JSON.stringify(results.facts, null, 2));
    try { if (browser) await browser.close(); } catch { }
    try { if (server) server.kill(); } catch { }
    UI.freePort(PORT);
    const code = results.fail > 0 || results.fatal ? 1 : 0;
    console.log(`EXIT=${code}`);
    process.exit(code);
  }
})();
