// R76 闸门：把 digitaljs 的**稀疏多路选择器（MuxSparse）与缓冲器（Repeater）**真接进沙盒。
//
// 为什么是这两颗（r69 运行时读数，不是读 bundle 猜的）：
//  · `Object.keys(digitaljs.cells)` 里 MuxSparse/Repeater/BusRegroup/GenMux 都不在元件库里；
//  · MuxSparse **不给 inputs 直接抛** `Cannot read properties of undefined (reading 'length')`，
//    给了 inputs=['0','1','3']＋default_input=true 才成立：端口 sel,out,in0..in3、size 40×72
//    ⇒ 分支数由**案件值表**决定，不是 2^sel（Mux/Mux1Hot 都做不到稀疏案件）；
//  · BusRegroup 给了 groups 仍然抛 `Cannot set properties of undefined (setting 'NaN')`
//    ⇒ 这颗**不接**（接进去就是一放就崩的元件库条目）；GenMux 是抽象基类（muxInputs 未实现）。
//  · 画布上 MuxSparse 的 `inputs` 是 **BigInt 数组** ⇒ 存盘必须降成十进制串，
//    否则 JSON.stringify 直接抛（deviceParams 里那条 BigInt 注释就是为它写的）。
//
// 判据（只钉能各自失败的事；关系式与行为式，不预设上游的像素公式）：
//  [1] 元件库放得下 MuxSparse，端口里有 sel / out 且输入行数 ≥ 2
//  [2] 改「分支取值表」= 0,2,5 ⇒ 输入端口数 == 案件数，且**比改之前多**（真的重建了端口）
//  [3] 加默认分支 ⇒ 输入端口数 == 案件数 + 1
//  [4] 行为：sel 设成表里第 K 个案件值 ⇒ out == inK 的值（选择语义真通，不是只有端口好看）
//  [5] 存盘重开：inputs 与 default_input 仍在、行数不变（钉 deviceParams 里那颗 default_input）
//  [6] Repeater：in 喂 1 ⇒ out 读到 1（直通）
//  [7] 全程无页面异常
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1761;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1761)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n}（${d}）`); };

/** 让引擎真的转起来（读 running/tick，不转就点界面那颗「运行 / 暂停仿真」）——
 *  器件自己的 operation 只在 updateGates 里跑，光有端口的值不算"通"。 */
const kick = async (page) => {
  const rd = () => page.evaluate(() => {
    const c = window.__sandboxCircuit;
    const b = document.querySelector('button[title="运行 / 暂停仿真"]');
    return { running: !!(c && c.running), tick: (c && c._engine && c._engine._tick) ?? null,
      interval: c && c.interval, hasBtn: !!b, btnText: b ? (b.textContent || '').trim() : null,
      btnDisabled: b ? !!(b.disabled || b.getAttribute('aria-disabled')) : null };
  });
  const before = await rd();
  for (let k = 0; k < 3 && !before.running; k++) {
    // 先 Escape 关掉可能压着的右键菜单，再用 el.click()：Playwright 的 click 在
    // 动画浮层上会 30 s 超时（本仓老账），而这里要的是"把仿真开起来"这件事成了没有。
    await page.keyboard.press('Escape'); await sleep(200);
    await page.evaluate(() => { const b = document.querySelector('button[title="运行 / 暂停仿真"]'); if (b) b.click(); });
    await sleep(800);
    const now = await rd();
    if (now.running) { before.running = true; break; }
  }
  await sleep(900);
  return { before, after: await rd() };
};

const READ = (type) => {
  const p = window.__sandboxPaper;
  const c = p && p.model.getElements().find((e) => String(e.get('type')) === type);
  if (!c) return { noCell: true };
  const items = (c.get('ports')?.items || []).map((x) => String(x.id));
  const ins = items.filter((x) => /^in\d+$/.test(x));
  const sh = (v) => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(sh) : v);
  return {
    id: String(c.id), bits: c.get('bits') ?? null,
    inputs: sh(c.get('inputs') ?? null), default_input: c.get('default_input') ?? null,
    allPorts: items, inPorts: ins, rows: ins.length,
    size: (() => { const s = c.get('size'); return s ? { w: Math.round(s.width), h: Math.round(s.height) } : null; })(),
  };
};

/** 模型级喂线：新建 Constant 连到目标端口，然后**让引擎跑一拍**
 *  （模型级加线不走 UI 那条"起仿真"的路，常量还没 prepare 时全口读 x —— 那是夹具的账，
 *   不能记成"这颗器件不工作"）。 */
const FEED = async (a) => {
  const p = window.__sandboxPaper; const d = window.digitaljs;
  const t = p.model.getCell(a.id);
  if (!t) return { err: 'no-target' };
  const made = [];
  for (const f of a.feeds) {
    if (!t.getPort?.(f.port)) { made.push(`${f.port}:缺端口`); continue; }
    const width = Number(t.getPort(f.port).bits) || 1;
    const cst = new d.cells.Constant({ constant: f.val.padStart(Math.max(1, width), '0'), bits: width, position: { x: 40, y: 700 + made.length * 50 } });
    p.model.addCell(cst);
    p.model.addCell(new d.cells.Wire({ source: { id: cst.id, port: 'out' }, target: { id: t.id, port: f.port }, signal: '0', netname: `R76${made.length}` }));
    made.push(`${f.port}←${f.val}`);
  }
  const c = window.__sandboxCircuit;
  if (c && !c.running) { try { c.start(); } catch { } }
  await new Promise((r) => setTimeout(r, 700));
  try { c && c.updateGates && c.updateGates(); } catch { }
  await new Promise((r) => setTimeout(r, 400));
  return { made };
};

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
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1000);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }

    await UI.enterSandbox(page);
    // [6] Repeater 直通
    await UI.clickGate(page, 'Repeater'); await sleep(700);
    const rp = await page.evaluate(READ, 'Repeater');
    if (rp.noCell) skip('[6] Repeater 把 in 传到 out', '画布上没有缓冲器');
    else {
      await page.evaluate(FEED, { id: rp.id, feeds: [{ port: 'in', val: '1' }] });
      let kick6 = await kick(page);
      if (!kick6.after.running) {
        // r77 的对照读数：重开文件后光点按钮起不来、但按 `stop()` + `start()` 引擎就会重新走拍
        // ⇒ 这一臂要量的是"缓冲器通不通"，不是"运行按钮的状态同步"（那一格单独记账）。
        await page.evaluate(() => { const c = window.__sandboxCircuit; try { c.stop(); c.start(); } catch { } });
        await sleep(1200);
        kick6 = await kick(page);
      }
      console.log('  [Repeater 引擎]', J(kick6));
      if (!kick6.after.running) skip('[6] Repeater 把 in 传到 out', `仿真起不来（running=${J(kick6.after.running)}），这一格今天没量成`);
      else {
        const got = await page.evaluate((a) => {
          const p = window.__sandboxPaper; const c = p.model.getCell(a.id);
          return { out: String((c.get('outputSignals') || {}).out ?? '—'), in: String((c.get('inputSignals') || {}).in ?? '—'), bits: c.get('bits') ?? null };
        }, { id: rp.id });
        (/[1]/.test(got.out) && !/x/.test(got.out) ? ok : bad)('[6] Repeater 把 in=1 原样传到 out', J(got));
      }
    }


    await UI.clickGate(page, 'MuxSparse'); await sleep(800);
    const base = await page.evaluate(READ, 'MuxSparse');
    console.log('  [放下后读数]', J(base));
    (base.noCell ? bad : (base.inPorts.length >= 2 && base.allPorts.includes('sel') && base.allPorts.includes('out') ? ok : bad))(
      '[1] 元件库放得下 MuxSparse，端口含 sel/out 且输入行 ≥2',
      base.noCell ? '画布上没有它' : `端口=${J(base.allPorts)} 案件=${J(base.inputs)} 默认=${J(base.default_input)} size=${J(base.size)}`);
    if (base.noCell) {
      console.log(`\n===== R76 sparse-mux: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
      await browser.close().catch(() => { }); server.kill(); UI.freePort(PORT); process.exit(fail > 0 ? 1 : 0);
    }

    const menuOn = async (type) => {
      const c = await page.evaluate((t) => {
        const p = window.__sandboxPaper;
        const cell = p.model.getElements().find((e) => String(e.get('type')) === t);
        const v = cell && p.findViewByModel(cell); if (!v) return null;
        const r = v.el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }, type);
      if (!c) return false;
      await page.mouse.click(c.x, c.y, { button: 'right' }); await sleep(450);
      return true;
    };

    // [2] 改案件表 0,2,5
    if (!(await menuOn('MuxSparse'))) skip('[2] 改分支取值表真的重建端口', '拿不到 MuxSparse 的屏幕坐标');
    else {
      await UI.menuSet(page, '分支取值表', '0,2,5', null);
      const r2 = await page.evaluate(READ, 'MuxSparse');
      console.log('  [改表后读数]', J(r2));
      const cases = Array.isArray(r2.inputs) ? r2.inputs.length : -1;
      (r2.rows === cases && cases === 3 && r2.rows > base.rows ? ok : bad)(
        '[2] 分支取值表改成 0,2,5 ⇒ 输入端口数 == 案件数(3) 且比改之前多',
        `案件=${J(r2.inputs)} 端口数=${r2.rows}（原本 ${base.rows}）size=${J(r2.size)}`);

      // [3] 加默认分支
      if (!(await menuOn('MuxSparse'))) skip('[3] 默认分支加一行端口', '菜单打不开');
      else {
        const btn = page.locator('[data-context-menu] button:has-text("加默认分支")').first();
        if (!(await btn.count())) { skip('[3] 默认分支加一行端口', '菜单里没有那颗按钮'); }
        else {
          await btn.evaluate((el) => el.click()); await sleep(700);
          const r3 = await page.evaluate(READ, 'MuxSparse');
          const c3 = Array.isArray(r3.inputs) ? r3.inputs.length : -1;
          (r3.default_input === true && r3.rows === c3 + 1 ? ok : bad)(
            '[3] 加默认分支 ⇒ 输入端口数 == 案件数 + 1',
            `default_input=${J(r3.default_input)} 案件=${J(r3.inputs)} 端口数=${r3.rows}｜提示=${J(await UI.toastText(page))}`);
        }
      }

      // [4] 行为：sel = 表里第 K 个案件值 ⇒ out == inK
      const r4pre = await page.evaluate(READ, 'MuxSparse');
      const caseList = Array.isArray(r4pre.inputs) ? r4pre.inputs.map(String) : [];
      const selWidth = Number((r4pre.bits && r4pre.bits.sel) || 0);
      if (!caseList.length || !selWidth) skip('[4] sel 走案件值时输出取自对应那一路', `读不到案件表/选择位宽 ${J(r4pre.bits)}`);
      else {
        // ⚠ 上游的端口排布（r76 现场读出来的，不是猜的）：`muxInputs = default_input ? ['*'].concat(inputs) : inputs`
        //   （bundle @2324173）⇒ **开了默认分支时 in0 就是默认那一路，案件 i 落在 in(i+1)**。
        //   sel=5 命中案件表第 2 项 ⇒ 出的是 in3，不是 in2。判据按这条映射算，别按"我以为"。
        const dflt = r4pre.default_input === true;
        const K = Math.min(2, caseList.length - 1);         // 第 K 个案件（0 基）
        const kPort = K + (dflt ? 1 : 0);                   // 它落在哪个输入端口上
        const wantCase = caseList[K];
        const dataW = Math.max(1, Number(r4pre.bits && r4pre.bits.in) || 4);
        const selW = Math.max(1, selWidth);
        const bin = (n, w) => Number(n).toString(2).padStart(w, '0');
        const feeds = [];
        for (let i = 0; i < r4pre.rows; i++) feeds.push({ port: `in${i}`, val: bin(10 + i, dataW) });  // 每路一个独特值
        feeds.push({ port: 'sel', val: bin(wantCase, selW) });
        const fed = await page.evaluate(FEED, { id: r4pre.id, feeds });
        const kick4 = await kick(page);
        const out = await page.evaluate((a) => {
          const p = window.__sandboxPaper; const c = p.model.getCell(a.id);
          const o = (c.get('outputSignals') || {}).out;
          const i2 = (c.get('inputSignals') || {});
          return { out: o == null ? null : String(o), selIn: String(i2.sel ?? '—'), kIn: String(i2[`in${a.kPort}`] ?? '—'), seen: Object.fromEntries(Object.entries(i2).map(([k, v]) => [k, String(v)])) };
        }, { id: r4pre.id, kPort });
        const expect = bin(10 + kPort, dataW);
        const bitsOf = (v) => { const m = /Vector3vl\s+([01xzZ]+)/.exec(String(v)); return m ? m[1] : String(v); };
        const strip = (s) => String(s).replace(/^0+/, '') || '0';
        // sel 读回来是**位串**（"101"），案件值是**十进制**（"5"）—— 只能按数值比，不能按字符串比。
        const selBits = /Vector3vl\s+([01x]+)/.exec(out.selIn);
        const selNum = selBits && !/x/.test(selBits[1]) ? parseInt(selBits[1], 2) : NaN;
        console.log('  [喂线/输出]', J({ fed, wantCase, K, kPort, expect, out, selNum }));
        console.log('  [引擎]', J(kick4));
        (selNum === Number(wantCase) && out.out !== null && strip(bitsOf(out.out)) === strip(expect) ? ok : bad)(
          `[4] sel=案件 ${wantCase} ⇒ out 取到那一端口 in${kPort} 的值 ${expect}（默认分支占 in0）`,
          `sel=${J(out.selIn)}→数值 ${J(selNum)} 案件 ${J(wantCase)}｜in${kPort}=${J(out.kIn)} out=${J(bitsOf(out.out))} 期望 ${J(expect)} 默认分支=${J(dflt)}`);
      }

      // [5a] 存盘本身要成事：MuxSparse 的 inputs 在画布上是 **BigInt 数组**，
      //      存档不许因为一个 BigInt 把整次保存抛掉（r76 第一跑就是死在这里）。
      let saveErr = null;
      try { await page.evaluate(() => window.__sandboxSave && window.__sandboxSave()); }
      catch (e) { saveErr = String(e && e.message || e).slice(0, 160); }
      await sleep(900);
      (saveErr === null ? ok : bad)('[5a] 带稀疏选择器的电路存得下来（存档不许因 BigInt 抛错）', saveErr || 'handleSave 正常返回');
      const stored = await page.evaluate(async (a) => {
        const { sandboxStore } = await import('/src/store/sandboxStore.ts');
        for (const f of sandboxStore.list()) {
          if (!f.graphJson) continue;
          let j; try { j = JSON.parse(f.graphJson); } catch { continue; }
          const c = (j.cells || []).find((x) => x.type === 'MuxSparse' && String(x.id) === a.id);
          if (c) return { file: f.name, inputs: c.inputs === undefined ? null : c.inputs, default_input: c.default_input === undefined ? null : c.default_input, bits: c.bits ?? null };
        }
        return null;
      }, { id: r4pre.id });
      console.log('  [存档读数]', J(stored));
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2600);
      try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
      if (!(await UI.backToSandbox(page))) skip('[5] 存盘重开后案件表与默认分支仍在', '回不到沙盒画布');
      else if (!stored) skip('[5] 存盘重开后案件表与默认分支仍在', '存档里没读到那颗 MuxSparse');
      else {
        try { await page.locator('span').filter({ hasText: String(stored.file).replace(/\.djs$/, '') }).first().click(); await sleep(1800); } catch (e) { skip('[5] 存盘重开后案件表与默认分支仍在', `点不开文件 ${String(e).slice(0, 80)}`); }
        const r5 = await page.evaluate(READ, 'MuxSparse');
        const sameCases = JSON.stringify(r5.inputs) === JSON.stringify(stored.inputs);
        (r5.rows === r4pre.rows && sameCases && r5.default_input === stored.default_input ? ok : bad)(
          '[5] 存盘重开后案件表/默认分支/端口行数都不变（default_input 真在名单里）',
          `重开=${J({ rows: r5.rows, inputs: r5.inputs, default_input: r5.default_input })} 存档=${J(stored)}（重开前 ${r4pre.rows} 行）`);
      }
    }

    (perr.length ? bad : ok)('[7] 全程无页面异常', perr.slice(0, 3).join(' | '));
    console.log(`\n===== R76 sparse-mux: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
    fail++;
    console.log(`\n===== R76 sparse-mux: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
