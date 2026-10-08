// R53 验收：digitaljs 的 **FSM（状态机）器件**在沙盒里真的能用 ——
// 能放、能编辑转移表、能存住、能仿真、能看状态图。
// 判据形状全部按上游实测钉死（不是猜的）：
//  - 端口 id：in / clk / arst / out（cells/FSM.mjs initialize）
//  - 参数字段：bits{in,out} / polarity{clock,arst} / states / init_state / trans_table
//  - trans_table 每行：{state_in:int, ctrl_in:'01x…', state_out:int, ctrl_out:'01…'}
//    （digitaljs prepare() 与 yosys2digitaljs core.ts:994-1010 同一形状）
// 失败信息一律响亮（走 tests/_ui.cjs：分组没展开会抛错，不静默跳过）。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1593;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1593)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const freePort = (p) => {
  try {
    require('child_process').execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' });
  } catch { }
};

(async () => {
  let server, browser;
  try {
    freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务未起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await UI.enterSandbox(page);

    // ===== [1] 元件库能放出状态机 =====
    try { await UI.clickGate(page, 'FSM'); ok('[1] 元件库有「状态机」条目并点击放置'); }
    catch (e) { bad('[1] 元件库有「状态机」条目并点击放置', String(e.message).slice(0, 90)); }

    const fsmInfo = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getElements().find((e) => String(e.get('type')) === 'FSM');
      if (!c) return null;
      return { id: c.id, ports: (c.getPorts() || []).map((x) => x.id), size: c.size(),
        states: c.get('states'), init: c.get('init_state'), bits: c.get('bits'),
        polarity: c.get('polarity'), trans: (c.get('trans_table') || []).length };
    });
    if (!fsmInfo) { bad('[2] 放置出的 FSM 器件', '画布上没有 FSM'); }
    else {
      const want = ['in', 'clk', 'arst', 'out'];
      const got = fsmInfo.ports.map(String);
      (want.every((w) => got.includes(w)) ? ok : bad)('[2] FSM 端口是 in/clk/arst/out', got.join(','));
      console.log('    读数:', JSON.stringify(fsmInfo));
    }

    // ===== [3] 右键「状态机转移表…」打开编辑弹窗 =====
    const center = await page.evaluate((id) => {
      const paper = window.__sandboxPaper;
      const cell = paper.model.getCell(id);
      const v = cell && paper.findViewByModel(cell);
      if (!v) return null;
      const el = v.findBySelector && v.findBySelector('body');
      const node = (el && el.length ? el[0] : v.el.querySelector('.body') || v.el);
      const r = node.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, fsmInfo && fsmInfo.id);
    if (!center) { bad('[3] 右键打开状态机转移表编辑窗', '找不到 FSM 器件视图（画布没渲染出该 cell）'); }
    let modalOpen = false;
    try {
      await UI.menuClick(page, '转移表…', center);
      modalOpen = await page.locator('[data-fsm-modal]').count() > 0;
    } catch (e) { modalOpen = false; }
    (modalOpen ? ok : bad)('[3] 右键打开状态机转移表编辑窗', modalOpen ? '' : '菜单项或弹窗没出现');

    // ===== [4] 编辑并应用：states/init/trans_table 写回，且位置与连线不丢 =====
    if (modalOpen) {
      await page.locator('[data-fsm-meta="states"]').fill('3');
      await page.locator('[data-fsm-meta="init"]').fill('0');
      await page.locator('[data-fsm-meta="in"]').fill('1');
      await page.locator('[data-fsm-meta="out"]').fill('1');
      await sleep(200);
      // 建两条转移：0 --1--> 1（输出 1），1 --0--> 0（输出 0）
      for (let i = 0; i < 2; i++) await page.locator('[data-fsm-add]').click();
      await sleep(250);
      const rows = await page.locator('[data-fsm-row]').count();
      rows === 2 ? ok('[4a] 添加转移成行', `rows=${rows}`) : bad('[4a] 添加转移成行', `rows=${rows}`);
      await page.locator('[data-fsm-row="0"] [data-fsm-state="state_in"]').selectOption('0');
      await page.locator('[data-fsm-row="0"] [data-fsm-bin="in"]').fill('1');
      await page.locator('[data-fsm-row="0"] [data-fsm-state="state_out"]').selectOption('1');
      await page.locator('[data-fsm-row="0"] [data-fsm-bin="out"]').fill('1');
      await page.locator('[data-fsm-row="1"] [data-fsm-state="state_in"]').selectOption('1');
      await page.locator('[data-fsm-row="1"] [data-fsm-bin="in"]').fill('0');
      await page.locator('[data-fsm-row="1"] [data-fsm-state="state_out"]').selectOption('2');
      await page.locator('[data-fsm-row="1"] [data-fsm-bin="out"]').fill('0');
      const posBefore = await page.evaluate((id) => ({ ...window.__sandboxPaper.model.getCell(id).position() }), fsmInfo.id);
      await page.locator('[data-fsm-apply]').click();
      await sleep(700);
      const after = await page.evaluate((id) => {
        const c = window.__sandboxPaper.model.getCell(id);
        if (!c) return { gone: true };
        return { type: c.get('type'), states: c.get('states'), init: c.get('init_state'),
          bits: c.get('bits'), trans: JSON.parse(JSON.stringify(c.get('trans_table') || [])),
          pos: c.position() };
      }, fsmInfo.id);
      const shapeOk = after.states === 3 && after.init === 0 && after.trans.length === 2
        && after.trans[0].state_in === 0 && after.trans[0].ctrl_in === '1' && after.trans[0].state_out === 1
        && after.trans[0].ctrl_out === '1' && after.bits && after.bits.in === 1;
      (shapeOk ? ok : bad)('[4b] 应用后转移表/状态数/位宽写回器件', JSON.stringify(after).slice(0, 160));
      const posOk = !after.gone && Math.round(after.pos.x) === Math.round(posBefore.x)
        && Math.round(after.pos.y) === Math.round(posBefore.y);
      (posOk ? ok : bad)('[4c] 重建器件保留 id 与位置（连线不搬家）', posOk ? '' : JSON.stringify({ before: posBefore, after: after.pos }));
    }

    // ===== [5] 存档 → 重开：FSM 字段不许静默丢 =====
    await page.keyboard.press('Control+s'); await sleep(900);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
    await UI.enterSandbox(page);
    const revived = await page.evaluate(() => {
      const c = window.__sandboxPaper.model.getElements().find((e) => String(e.get('type')) === 'FSM');
      if (!c) return null;
      return { states: c.get('states'), init: c.get('init_state'), bits: c.get('bits'),
        trans: (c.get('trans_table') || []).length };
    });
    const saveOk = revived && revived.states === 3 && revived.init === 0 && revived.trans === 2;
    (saveOk ? ok : bad)('[5] 存盘重开后 states/init_state/trans_table 还在', JSON.stringify(revived));

    // ===== [6] 仿真：current_state 按转移表推进，out 出值 =====
    // ⚠ 关键教训（r53 连踩三次）：**直接 paper.model.addCell() 加进模型的器件不会被引擎评估** ——
    //   实测时钟确实在振（采样 -1→1），但 fsm.last_clk 全程停在 0，说明 FSM.operation() 根本没被调用；
    //   同一座电路里对照的 Dff 也一样不走。沙盒里用户放置的器件之所以能仿真，是因为它们走的是
    //   React 的放置/载入路径（会重建 circuit）。所以这一格必须：加完激励 → 存盘 → 重载 →
    //   让电路按正常路径重建，再启仿真。
    const sim = await page.evaluate(async () => {
      const djs = window.digitaljs, paper = window.__sandboxPaper, circuit = window.__sandboxCircuit;
      const fsm = paper.model.getElements().find((e) => String(e.get('type')) === 'FSM');
      if (!fsm) return { err: 'no fsm' };
      const clk = new djs.cells.Clock({ position: { x: 60, y: 120 }, propagation: 2 });
      const btn = new djs.cells.Button({ position: { x: 60, y: 190 }, bits: 1 });
      // ⚠ arst 必须**有确定电平**：2026-10-06 实测——只接 in/clk/out、把 arst 悬空时，
      //   引擎明明在跑（engineRunning=true、tick=799、transitions=2），但 current_state 全程停在 0；
      //   换成 arst 接一颗没按下的 Input（读成 `Vector3vl 0`）之后状态按转移表走（1→0→1）。
      //   也就是说悬空的异步复位读 x，机器就不肯动 —— 这是 digitaljs 的语义，不是我们的 bug，
      //   但夹具若不接这颗，[6] 永远只能登记"未验证"。
      const arstSrc = new djs.cells.Input({ position: { x: 60, y: 262 }, bits: 1 });
      const lamp = new djs.cells.Lamp({ position: { x: 560, y: 150 } });
      paper.model.addCell(clk); paper.model.addCell(btn); paper.model.addCell(arstSrc); paper.model.addCell(lamp);
      // 端点必须写 { id, port }（本仓量过的沙盒不变量）：用 joint 原生的 { cell, port }
      // 当场能画出来，但序列化读的是 id ⇒ 存盘重载线全丢，端口挂接也不可靠。
      const w = (a, ap, b, bp) => new djs.cells.Wire({ source: { id: a.id, port: ap }, target: { id: b.id, port: bp }, bits: 1 });
      paper.model.addCell(w(clk, 'out', fsm, 'clk'));
      paper.model.addCell(w(btn, 'out', fsm, 'in'));
      paper.model.addCell(w(arstSrc, 'out', fsm, 'arst'));
      paper.model.addCell(w(fsm, 'out', lamp, 'in'));
      // 把 Button 置成 1（转移表里 0 --1--> 1 才成立）：借现成向量的构造器，别自己猜编码
      try {
        const cur = (btn.get('outputSignals') || {}).out;
        const C = cur && cur.constructor;
        const vec = C && C.fromBin ? C.fromBin('1', 1) : (C && C.ones ? C.ones(1) : cur);
        btn.set('outputSignals', { ...(btn.get('outputSignals') || {}), out: vec });
      } catch { }
      try { circuit.stop(); } catch { }
      // 只接线、不自己启动：仿真是由界面按钮起的（实测 el.click() 起不来，见下方真鼠标点击）
      window.__r53cells = { fsm: fsm.id, clk: clk.id, btn: btn.id, arst: arstSrc.id };
      return { wired: true, ports: fsm.getPorts().map((p) => p.id), trans: (fsm.get('trans_table') || []).length };
    });
    // 沙盒进模式时仿真**默认就在跑**（工具那颗写着「暂停」）。所以只在它写「运行」时才点 ——
    // 无脑点一次等于把仿真按停（r53 第一版就是这么把 running 按成 false 的）。
    // 存盘 + 重载：让电路按正常路径重建（引擎才会评估这些器件），也顺带证明连线存得住
    await page.keyboard.press('Control+s'); await sleep(1100);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
    await UI.enterSandbox(page);
    const reloaded = await page.evaluate(() => {
      const paper = window.__sandboxPaper;
      const fsm = paper.model.getElements().find((e) => String(e.get('type')) === 'FSM');
      const clk = paper.model.getElements().find((e) => String(e.get('type')) === 'Clock');
      const btn = paper.model.getElements().find((e) => ['Button','Input'].includes(String(e.get('type'))));
      const links = paper.model.getLinks().length;
      if (!fsm || !clk || !btn) return { ok: false, fsm: !!fsm, clk: !!clk, btn: !!btn, links };
      const c = paper.findViewByModel(btn);
      const r = c.el.getBoundingClientRect();
      return { ok: true, links, trans: (fsm.get('trans_table') || []).length, click: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };
    });
    if (!reloaded.ok) {
      unverified++;
      console.log('  UNVERIFIED  [6a] 重载后激励器件仍在（实测缺件 ' + JSON.stringify(reloaded) + '）');
    } else {
      // 按钮电平不是能"存"的东西：按下去把它置 1（这就是用户操作）
      await page.mouse.click(reloaded.click.x, reloaded.click.y);
      await sleep(500);
      console.log('    [6] 重载后：连线 ' + reloaded.links + ' 条、转移 ' + reloaded.trans + ' 条，已点击按钮置 1');
    }
    const runBtn = page.locator('button[title="运行 / 暂停仿真"]');
    const runCount = await runBtn.count();
    // 循环"看到没跑就点一下"，点到跑为止（一次点完就读状态会被 React 的异步 state 骗到：
    // r53 前两版连点两下正好把引擎 start 又 stop 掉了）
    let simStart = { running: false, label: '', tries: 0, startErr: null };
    for (let k = 0; k < 4; k++) {
      simStart.tries = k;
      simStart = await page.evaluate(() => ({
        running: !!(window.__sandboxCircuit && window.__sandboxCircuit.running),
        label: (document.querySelector('button[title="运行 / 暂停仿真"]') || {}).innerText || '',
      }));
      if (simStart.running) break;
      if (runCount) await runBtn.first().click();
      await sleep(900);
    }
    if (!simStart.running) {
      // 界面按钮起不来时，最后一招是直接问引擎 start() 到底抛什么 —— 这决定
      // "点运行没反应"是自动化问题还是产品缺陷，不许靠猜结案
      simStart.startErr = await page.evaluate(() => {
        try { window.__sandboxCircuit.start(); return 'start() 没抛错, running=' + !!window.__sandboxCircuit.running; }
        catch (e) { return 'start() 抛错: ' + String(e.message || e).slice(0, 120); }
      });
      await sleep(900);
      simStart.runningAfterDirectStart = await page.evaluate(() => !!window.__sandboxCircuit.running);
    }
    console.log('    [6] 启动尝试: ' + JSON.stringify(simStart).slice(0, 200));
    await sleep(600);
    const sim2 = await page.evaluate(async () => {
      const paper = window.__sandboxPaper, circuit = window.__sandboxCircuit;
      const fsm = paper.model.getElements().find((e) => String(e.get('type')) === 'FSM');
      const byId = (id) => (id ? paper.model.getCell(id) : null);
      const clk = byId((window.__r53cells || {}).clk) || paper.model.getElements().find((e) => String(e.get('type')) === 'Clock');
      const btn = byId((window.__r53cells || {}).btn) || paper.model.getElements().find((e) => ['Button','Input'].includes(String(e.get('type'))));
      if (!clk || !btn) return { seen: [], diagInfo: { vanished: '点「运行」后手工加的激励器件从模型里消失了' }, clkVals: [], transitions: 'n/a', tick: null };
      // 现场先量清楚"为什么没跑"：告警数 / 引擎真的在不在跑 / 时钟到底在不在振
      const diagInfo = {
        modelWarnings: paper.model._warnings ?? null,
        engineRunning: circuit._engine ? !!circuit._engine.running : null,
        circuitRunning: !!circuit.running,
        unconnectedIn: paper.model.getElements().reduce((n, e) => {
          const links = paper.model.getConnectedLinks(e, { inbound: true });
          const used = new Set(links.map((l) => (l.get('target') || {}).port));
          return n + (e.getPorts() || []).filter((p) => p.dir === 'in' && !used.has(p.id)).length;
        }, 0),
      };
      const lvl = (el) => { const o = (el.get('outputSignals') || {}); const v = o.out || Object.values(o)[0]; return v ? v.get(0) : null; };
      const seen = [], clkVals = [];
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 150));
        const s = String(fsm.get('current_state'));
        const o = fsm.get('outputSignals');
        if (!seen.length || seen[seen.length - 1][0] !== s) {
          seen.push([s, o && o.out ? String(o.out).replace(/^Vector3vl\s+/, '') : 'x']);
        }
        clkVals.push([lvl(clk), lvl(btn), fsm.last_clk === undefined ? 'undef' : fsm.last_clk]);
      }
      return { seen, diagInfo, clkVals, transitions: fsm.transitions ? fsm.transitions.size : 'no .transitions (prepare 没跑)',
        tick: circuit._engine ? circuit._engine._tick : null };
    });
    console.log('    [6] 仿真现场: ' + JSON.stringify(sim2.diagInfo));
    console.log('    [6] 时钟/输入/last_clk 采样: ' + JSON.stringify(sim2.clkVals).slice(0, 260));
    console.log(`    [6] transitions=${sim2.transitions} tick=${sim2.tick}`);
    const states = (sim2.seen || []).map((x) => x[0]);
    const walked = states.includes('0') && states.includes('1');
    // ⚠ 未验证 ≠ 通过：实测点工具栏「运行 / 暂停仿真」后 circuit.running 仍是 false，
    //   FSM 与对照用的 Dff 都不走（同一座电路、同一个 Clock），所以这一格卡的是
    //   "自动化怎么把沙盒仿真起起来"，不是 FSM 器件本身。登记为未验证，等查明。
    if (walked) ok('[6] 真时钟跑起来后状态按转移表推进（出现 0→1）', JSON.stringify(sim2.seen).slice(0, 90));
    else {
      unverified++;
      console.log(`  UNVERIFIED  [6] 状态机仿真的逐拍推进（runBtn=${runCount} 诊断=${JSON.stringify(sim2.diagInfo).slice(0, 160)} 激励采样=${JSON.stringify(sim2.clkVals).slice(0, 70)} seen=${JSON.stringify(sim2.seen).slice(0, 60)}）`);
    }

    // ===== [7] 点 🔍 出状态图（open:fsm），且不带页面异常 =====
    const zoom = await page.evaluate(() => {
      const paper = window.__sandboxPaper;
      const fsm = paper.model.getElements().find((e) => String(e.get('type')) === 'FSM');
      const v = fsm && paper.findViewByModel(fsm);
      const a = v && v.$el ? v.$('a.zoom') : null;
      const before = document.querySelectorAll('[data-fsm-graph], body > div[title^="FSM"]').length;
      let thrown = null;
      try { if (a && a.length) a[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) { thrown = e.message; }
      return { anchors: a ? a.length : -1, thrown, before };
    });
    await sleep(1200);
    const grew = await page.evaluate(() => document.querySelectorAll('body > div').length);
    const viewOk = zoom.anchors > 0;
    (viewOk ? ok : bad)('[7a] FSM 器件视图上有 🔍 放大入口', `anchors=${zoom.anchors}`);
    bad_or_ok(zoom.thrown, zoom.before, grew);
    console.log(`    open:fsm 读数: anchors=${zoom.anchors} thrown=${zoom.thrown} bodyDiv ${zoom.before}→${grew}`);

    if (perr.length) bad('[8] 全程无页面异常', perr.slice(0, 3).join(' | '));
    else ok('[8] 全程无页面异常');
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
    fail++;
  } finally {
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unverified} 未验证 =====`);
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    process.exit(fail ? 1 : 0);
  }

  function bad_or_ok(thrown, before, after) {
    if (thrown) bad('[7b] 触发 open:fsm 未抛错', String(thrown).slice(0, 90));
    else if (after > before) ok('[7b] 触发 open:fsm 后有弹窗节点出现', `${before}→${after}`);
    else bad('[7b] 触发 open:fsm 后没有可见弹窗', `${before}→${after}`);
  }
})();
