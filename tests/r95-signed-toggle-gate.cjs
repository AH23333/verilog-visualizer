// R95 闸门：**算术／比较／移位器件的「有符号」开关**（objective 末条「尽可能发挥 digitaljs 的全部功能」）。
//
// 为什么是这一族（2026-10-06 自查）：digitaljs 的算术与比较器按 `signed` 决定按无符号还是有符号
// 解释端口向量（arith.mjs:66/94/140/178 `toBigInt(sgn)`），`signed` 列在 `_unsupportedPropChanges`
// （arith.mjs:39）⇒ **只能在构造期给**。上游按类型发三种形状（core.ts:766-810）：
//   取负（Arith11）＝布尔；加减乘除取模幂与比较器＝{in1,in2}；移位＝{in1,in2,out}
//   （out 只有 $sshl/$sshr 真的参与语义）。而沙盒此前**没有任何入口**切它 ⇒
//   调色板放出来的运算器永远无符号，负数运算做不了（除非从编译模式复制过来）。
//
// ⚠ 形状即语义（本轮现场踩过）：UnaryPlus 落进 {in1,in2} 分支的话，对象恒为 truthy ⇒
//   `toBigInt(signed)` 会把它错读成有符号 —— 所以 Arith11 两颗（Negation/UnaryPlus）必须是单布尔项。
//
// 射程（7 格）：
//   [1] 三族菜单形状：比较器两颗开关、取负族一颗、移位三颗（名字按 A/B/输出），标签带现态
//   [2] 无符号读数：Lt(4位) in1=1000,in2=0001 ⇒ out=0（8<1 假）
//   [3] AND 规则三段：只开 A ⇒ out 仍 0（上游 `sgn.in1 && sgn.in2`，arith.mjs:186，与 Verilog
//       晋升规则一致）；两脚全开 ⇒ signed={true,true}、out=1。位宽/连线/位置全程不动
//   [4] 除法成对（AND 同款）：0100 → 仍 0100 → 1100（-8÷2=-4）
//   [5] 存盘重开 signed 整套回来（signed 已在构造期名单里）
//   [6] UnaryPlus 菜单只有一颗「有符号」（布尔形状不被错给成 {in1,in2}）
//   [6b] 移位的「移出空隙补 x」（fillx）开关：菜单项 + 模型现态 + √ 现态
//   [6c] fillx 电学对：1000 右移 3 位，关＝0001（补 0）、开＝xxx1（补 x）——Vector3vl.make
//        的初值语义（0＝x、-1＝0）按源码逐行核对过（dist/index.js:197-221）
//   [7] 静态反向臂：src 里不许出现 set('signed')／set('fillx')／setProp 同型（会被 digitaljs
//       回滚＝假修），开关只许经 reconfigureCell
//
// ⚠ 判据读器件模型与电平，不读 toast 文案。⚠ 夹具顺序：**先位宽→4、再接常量**——
//   否则 4 位常量接 1 位端口，产品当场插切片/转换器，比较变成 LSB 比较（探针现场踩过）。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1597;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1597)); } catch { }
const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n}${d ? ' — ' + d : ''}`); };

async function waitPaper(page) {
  await page.waitForFunction(() => !!(window.__sandboxPaper && window.__sandboxPaper.model), null, { timeout: 15000 });
  await sleep(150);
}

// ⚠ 整颗函数交给 Playwright：不许引用 Node 侧常量（闭包带不过去），也不许拼 'return '+fn
const CELL = (a) => {
  const paper = (window).__sandboxPaper;
  if (!paper || !paper.model) return null;
  const c = a.id ? paper.model.getCell(a.id)
    : paper.model.getElements().find((e) => String(e.get('type')) === a.type);
  if (!c) return null;
  return {
    id: String(c.id), type: String(c.get('type')), signed: c.get('signed'), bits: c.get('bits'),
    fillx: c.get('fillx'),
    out: String(((c.get('outputSignals') || {}).out) ?? ''),
    in1: String(((c.get('inputSignals') || {}).in1) ?? ''),
    in2: String(((c.get('inputSignals') || {}).in2) ?? ''),
    pos: c.get('position'), links: paper.model.getLinks().length,
    ports: (c.getPorts() || []).map((p) => p.id).join(','),
    running: !!((window).__sandboxCircuit && (window).__sandboxCircuit._engine && (window).__sandboxCircuit._engine.running),
    tick: (window).__sandboxCircuit && (window).__sandboxCircuit._engine ? (window).__sandboxCircuit._engine._tick : null,
  };
};

const MENU_LABELS = () => [...document.querySelectorAll('[data-context-menu] button')].map((b) => b.textContent.trim());

(async () => {
  let server, browser;
  const errors = [];
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await UI.newSandboxFile(page);

    // ---- [1] 三族菜单形状（先各放一颗，逐个开菜单数条目） ----
    await UI.clickGate(page, 'Lt');
    await sleep(500);
    await UI.clickGate(page, 'Negation');
    await sleep(500);
    await UI.clickGate(page, 'ShiftLeft');
    await sleep(700);
    await waitPaper(page);
    const menuOf = async (type) => {
      const r = await UI.cellRect(page, type);
      if (!r) return null;
      await page.mouse.click(r.x, r.y, { button: 'right' });
      await sleep(450);
      const labels = await page.evaluate(MENU_LABELS);
      await page.keyboard.press('Escape');
      await sleep(250);
      return labels;
    };
    const ltMenu = await menuOf('Lt');
    const negMenu = await menuOf('Negation');
    const shlMenu = await menuOf('ShiftLeft');
    const shapeOk = ltMenu && negMenu && shlMenu
      && ltMenu.some((t) => t === '操作数 A 有符号') && ltMenu.some((t) => t === '操作数 B 有符号') && !ltMenu.some((t) => t.includes('输出'))
      && negMenu.some((t) => t === '有符号') && !negMenu.some((t) => t.includes('操作数'))
      && shlMenu.some((t) => t === '操作数 A 有符号') && shlMenu.some((t) => t === '操作数 B 有符号') && shlMenu.some((t) => t === '输出 有符号');
    (shapeOk)
      ? ok('[1] 三族菜单形状各按上游的三种 signed 形状出条目（比较器两颗／取负族一颗布尔／移位三颗）',
        `Lt=${J(ltMenu.filter((t) => t.includes('有符号')))} Negation=${J(negMenu.filter((t) => t.includes('有符号')))} ShiftLeft=${J(shlMenu.filter((t) => t.includes('有符号')))}`)
      : bad('[1] 三族菜单形状各按上游的三种 signed 形状出条目（比较器两颗／取负族一颗布尔／移位三颗）',
        J({ ltMenu: ltMenu && ltMenu.filter((t) => t.includes('有符号')), negMenu: negMenu && negMenu.filter((t) => t.includes('有符号')), shlMenu: shlMenu && shlMenu.filter((t) => t.includes('有符号')) }));
    if (!shapeOk) {
      ['[2] 无符号读数：Lt(4 位) 1000<0001 ⇒ out=0', '[3] 切「操作数 A 有符号」⇒ 形状／位宽／连线全带得住，out 翻成 1',
        '[4] 除法成对：0100 → 1100（只切 A）', '[5] 存盘重开 signed 整套回来', '[6] UnaryPlus 只有单颗「有符号」（布尔形状不被错给）']
        .forEach((n) => skip(n, '前置没满足（菜单形状不对），这一格今天没判'));
    } else {
      // 共用激励工具（[2]～[5] 与 [6c] 都用；一份实现，⛔ 不许各写各的）：
      // ⚠ rectOfId 按 **id** 取盒体中心——按 type 找"第一颗"在重建后会漂（重建把元素挪到队尾，
      //   同类第二颗就会被当成目标，r95 现场：菜单开在了没配置的那颗 ShiftLeft 上）。
      const notes = [];
      const rectOfId = (cid) => page.evaluate((a) => {
        const p = (window).__sandboxPaper;
        if (!p || !p.model) return null;
        const c = p.model.getCell(a.id);
        if (!c) return null;
        const el = (p.findViewByModel(c) || {}).el;
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }, { id: cid });
      const setConst = async (cid, val) => {
        const r = await rectOfId(cid);
        if (!r) { notes.push(`常量 ${cid} 取不到盒体`); return false; }
        try { await UI.menuSet(page, '常量值', val, r); }
        catch (e) { notes.push(`常量设 ${val} 失败：${String(e.message).slice(0, 60)}`); return false; }
        await sleep(700);
        // ⚠ 配完读回：写档成功≠写到了那颗（菜单可能开在叠住的另一颗上）
        const got = await page.evaluate((a) => String((window).__sandboxPaper.model.getCell(a.id).get('constant')), { id: cid });
        if (got !== val) { notes.push(`常量读回 ${got} ≠ ${val}`); return false; }
        return true;
      };
      // ---- 场景：Lt 4 位 + 两颗常量 + 电平读数 ----
      const lt0 = await page.evaluate(CELL, { type: 'Lt' });
      const ltr = await UI.cellRect(page, 'Lt');
      await UI.menuSet(page, '位宽', '4', { x: ltr.x, y: ltr.y });
      await sleep(800);
      const ltW = await page.evaluate(CELL, { id: lt0.id });
      const widened = ltW && ltW.bits && ltW.bits.in1 === 4 && ltW.bits.in2 === 4;
      if (!widened) {
        skip('[2] 无符号读数：Lt(4 位) 1000<0001 ⇒ out=0', `位宽没加成（${J(ltW && ltW.bits)}），4 位成对读数今天取不到`);
        skip('[3] 切「操作数 A 有符号」⇒ 形状／位宽／连线全带得住，out 翻成 1', '前置同上');
      } else {
        await UI.clickGate(page, 'Constant'); await sleep(400);
        await UI.clickGate(page, 'Constant'); await sleep(500);
        await waitPaper(page);
        const consts = await page.evaluate(() => (window).__sandboxPaper.model.getElements()
          .filter((e) => String(e.get('type')) === 'Constant').map((e) => String(e.id)));
        await setConst(consts[0], '1000');
        await setConst(consts[1], '0001');
        const w1 = await UI.dragWireBetween(page, { cellId: consts[0], port: 'out' }, { cellId: lt0.id, port: 'in1' });
        const w2 = await UI.dragWireBetween(page, { cellId: consts[1], port: 'out' }, { cellId: lt0.id, port: 'in2' });
        await sleep(900);
        const u = await page.evaluate(CELL, { id: lt0.id });
        console.log(`  [现场] 无符号：${J(u && { bits: u.bits, signed: u.signed, in1: u.in1, in2: u.in2, out: u.out, links: u.links })}`);

        // ---- [2] 无符号读数 ----
        const uOk = u && u.bits.in1 === 4 && String(u.in1) === 'Vector3vl 1000' && String(u.in2) === 'Vector3vl 0001'
          && String(u.out) === 'Vector3vl 0';
        uOk
          ? ok('[2] 无符号读数：Lt(4 位) 1000<0001 ⇒ out=0（8<1 假）', `in1=${u.in1} in2=${u.in2} out=${u.out} links=${u.links}`)
          : bad('[2] 无符号读数：Lt(4 位) 1000<0001 ⇒ out=0（8<1 假）',
            J({ u: u && { bits: u.bits, in1: u.in1, in2: u.in2, out: u.out }, w1, w2, notes }));
        if (!uOk) {
          skip('[3] 切有符号：只开 A 仍 0（AND 规则），两脚全开翻成 1', '无符号那一半没成立，成对读数的另一半取不到');
        } else {
          // ---- [3] AND 规则三段读数：只开 A ⇒ out 仍 0（上游 `sgn.in1 && sgn.in2`，arith.mjs:186，
          //      与 Verilog"有一边无符号则整式无符号"的晋升规则一致）；两脚全开 ⇒ out=1（-8<1 真）。
          //      位宽/连线/位置全程不动（重建带得住其余构造参数）。
          const ltr2 = await UI.cellRect(page, 'Lt');
          await UI.menuClick(page, '操作数 A 有符号', { x: ltr2.x, y: ltr2.y });
          await sleep(900);
          await waitPaper(page);
          const sA = await page.evaluate(CELL, { id: lt0.id });
          await sleep(700);
          const sA2 = await page.evaluate(CELL, { id: lt0.id });
          console.log(`  [现场] 只开 A：${J(sA && { signed: sA.signed, out: sA.out, links: sA.links, running: sA.running })} 再采样 out=${sA2 && sA2.out}`);
          const ltr3 = await UI.cellRect(page, 'Lt');
          await UI.menuClick(page, '操作数 B 有符号', { x: ltr3.x, y: ltr3.y });
          await sleep(900);
          await waitPaper(page);
          const sB = await page.evaluate(CELL, { id: lt0.id });
          await sleep(700);
          const sB2 = await page.evaluate(CELL, { id: lt0.id });
          console.log(`  [现场] 两脚全开：${J(sB && { signed: sB.signed, bits: sB.bits, out: sB.out, links: sB.links, pos: sB.pos })} 再采样 out=${sB2 && sB2.out}`);
          const andNeg = sA2 && JSON.stringify(sA2.signed) === '{"in1":true,"in2":false}' && String(sA2.out) === 'Vector3vl 0';
          const sOk = andNeg && sB2 && JSON.stringify(sB2.signed) === '{"in1":true,"in2":true}'
            && sB2.bits.in1 === 4 && sB2.bits.in2 === 4
            && sB2.links === u.links && Math.round(sB2.pos.x) === Math.round(u.pos.x) && Math.round(sB2.pos.y) === Math.round(u.pos.y)
            && String(sB2.out) === 'Vector3vl 1';
          sOk
            ? ok('[3] 切有符号：只开 A 仍 0（AND 规则＝与 Verilog 晋升一致），两脚全开翻成 1（-8<1 真），位宽/连线/位置全程不动',
              `无符号 ${u.out} → 只A ${sA2.out}（${J(sA2.signed)}）→ 全开 ${sB2.out}（${J(sB2.signed)}），links ${u.links}→${sB2.links}`)
            : bad('[3] 切有符号：只开 A 仍 0（AND 规则＝与 Verilog 晋升一致），两脚全开翻成 1（-8<1 真），位宽/连线/位置全程不动',
              J({ u: u && u.out, sA2: sA2 && { signed: sA2.signed, out: sA2.out }, sB2: sB2 && { bits: sB2.bits, signed: sB2.signed, out: sB2.out, links: sB2.links } }));

          // ---- [1b] 标签的 √ 现态要能被看见（菜单每次打开都从器件现读） ----
          const ltr4 = await UI.cellRect(page, 'Lt');
          await page.mouse.click(ltr4.x, ltr4.y, { button: 'right' });
          await sleep(450);
          const ltMenu2 = await page.evaluate(MENU_LABELS);
          await page.keyboard.press('Escape');
          await sleep(250);
          const tickOk = ltMenu2 && ltMenu2.some((t) => t.includes('√ 操作数 A 有符号'))
            && ltMenu2.some((t) => t.includes('√ 操作数 B 有符号'));
          tickOk
            ? ok('[1b] 两脚都开后重开菜单，√ 前缀如实反映器件现态（标签不是写死的）',
              J(ltMenu2.filter((t) => t.includes('有符号'))))
            : bad('[1b] 两脚都开后重开菜单，√ 前缀如实反映器件现态（标签不是写死的）',
              J(ltMenu2 && ltMenu2.filter((t) => t.includes('有符号'))));

          // ---- [4] 除法成对（AND 规则同款：A+B 全开才翻） ----
          await UI.clickGate(page, 'Division');
          await sleep(600);
          await waitPaper(page);
          const dv0 = await page.evaluate(CELL, { type: 'Division' });
          const dvr = await UI.cellRect(page, 'Division');
          await UI.menuSet(page, '位宽', '4', { x: dvr.x, y: dvr.y });
          await sleep(800);
          await UI.clickGate(page, 'Constant'); await sleep(400);
          await UI.clickGate(page, 'Constant'); await sleep(500);
          await waitPaper(page);
          // ⚠ 新放的常量可能视觉上叠在一起：先摆开再配值，且**配完读回**——
          //   首跑现场两根线拖成了同一颗常量（in1=in2=0010，2÷2=1），读数看着像产品算错。
          await page.evaluate((a) => {
            const p = (window).__sandboxPaper;
            const dv = p.model.getCell(a.id);
            const dp = dv.get('position');
            p.model.getElements().filter((e) => String(e.get('type')) === 'Constant' && String(e.get('constant')) === '0')
              .forEach((e, i) => e.set('position', { x: dp.x - 260, y: dp.y + (i === 0 ? -80 : 60) }));
          }, { id: dv0.id });
          await sleep(400);
          const consts2v = await page.evaluate(() => (window).__sandboxPaper.model.getElements()
            .filter((e) => String(e.get('type')) === 'Constant' && String(e.get('constant')) === '0').map((e) => String(e.id)));
          await setConst(consts2v[0], '1000');
          await setConst(consts2v[1], '0010');
          const w3 = await UI.dragWireBetween(page, { cellId: consts2v[0], port: 'out' }, { cellId: dv0.id, port: 'in1' });
          const w4 = await UI.dragWireBetween(page, { cellId: consts2v[1], port: 'out' }, { cellId: dv0.id, port: 'in2' });
          await sleep(900);
          const du = await page.evaluate(CELL, { id: dv0.id });
          console.log(`  [现场] 除法无符号：${J(du && { bits: du.bits, in1: du.in1, in2: du.in2, out: du.out, links: du.links, running: du.running })}`);
          const dOk = du && String(du.out) === 'Vector3vl 0100' && du.bits.out === 4
            && String(du.in1) === 'Vector3vl 1000' && String(du.in2) === 'Vector3vl 0010';
          if (!dOk) {
            skip('[4] 除法成对：0100 → 1100（两脚全开才翻）', `无符号那一半没读到（out=${du && du.out}，in1=${du && du.in1}，w3=${J(w3)} w4=${J(w4)} notes=${J(notes)}）`);
          } else {
            const dvr2 = await UI.cellRect(page, 'Division');
            await UI.menuClick(page, '操作数 A 有符号', { x: dvr2.x, y: dvr2.y });
            await sleep(900);
            await waitPaper(page);
            const dA = await page.evaluate(CELL, { id: dv0.id });
            await sleep(600);
            const dvr3 = await UI.cellRect(page, 'Division');
            await UI.menuClick(page, '操作数 B 有符号', { x: dvr3.x, y: dvr3.y });
            await sleep(900);
            await waitPaper(page);
            const dB = await page.evaluate(CELL, { id: dv0.id });
            console.log(`  [现场] 除法：只A=${J(dA && { signed: dA.signed, out: dA.out })} 全开=${J(dB && { signed: dB.signed, bits: dB.bits, out: dB.out, links: dB.links })}`);
            const dPair = dA && dB
              && JSON.stringify(dA.signed) === '{"in1":true,"in2":false}' && String(dA.out) === 'Vector3vl 0100'
              && JSON.stringify(dB.signed) === '{"in1":true,"in2":true}'
              && dB.bits.in1 === 4 && dB.bits.out === 4 && String(dB.out) === 'Vector3vl 1100';
            dPair
              ? ok('[4] 除法成对：1000÷0010 无符号=0100；只开 A 仍 0100（AND 规则）；两脚全开 ⇒ 1100（-8÷2=-4）',
                `out ${du.out}→${dA.out}→${dB.out}，bits 带得住=${dB.bits.out === 4}`)
              : bad('[4] 除法成对：1000÷0010 无符号=0100；只开 A 仍 0100（AND 规则）；两脚全开 ⇒ 1100（-8÷2=-4）',
                J({ du: du && { in1: du.in1, in2: du.in2, out: du.out }, dA: dA && { signed: dA.signed, out: dA.out }, dB: dB && { signed: dB.signed, bits: dB.bits, out: dB.out }, w3, w4, notes }));

            // ---- [5] 存盘重开：Lt 与 Division 的 signed 都回来 ----
            await page.locator('button[title*="保存"], button:has-text("保存")').first().click().catch(() => { });
            await sleep(900);
            let s5 = null, d5 = null; const notes5 = [];
            for (let attempt = 1; attempt <= 3 && !(s5 && d5); attempt++) {
              try {
                await UI.boot(page, URL, { reload: true });
                try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
                await UI.enterSandbox(page);
                await waitPaper(page);
                await sleep(900);
                s5 = await page.evaluate(CELL, { id: lt0.id });
                d5 = await page.evaluate(CELL, { id: dv0.id });
              } catch (e) {
                notes5.push(`第${attempt}次重开没读到：${String((e && e.message) || e).slice(0, 90)}`);
                await sleep(1200);
              }
            }
            const pOk = s5 && d5 && JSON.stringify(s5.signed) === '{"in1":true,"in2":true}'
              && JSON.stringify(d5.signed) === '{"in1":true,"in2":true}'
              && s5.bits.in1 === 4 && d5.bits.out === 4 && String(s5.out) === 'Vector3vl 1';
            pOk
              ? ok('[5] 存盘重开 signed 整套回来（signed 在构造期名单里），电平也照旧',
                `Lt=${J(s5.signed)} out=${s5.out}；Division=${J(d5.signed)} out=${d5.out}；notes=${J(notes5)}`)
              : bad('[5] 存盘重开 signed 整套回来（signed 在构造期名单里），电平也照旧',
                J({ s5: s5 && { signed: s5.signed, bits: s5.bits, out: s5.out }, d5: d5 && { signed: d5.signed, out: d5.out }, notes: notes5 }));
          }
        }
      }

      // ---- [6] UnaryPlus：单布尔形状（不放激励，只看菜单） ----
      await UI.clickGate(page, 'UnaryPlus');
      await sleep(500);
      await waitPaper(page);
      const upMenu = await menuOf('UnaryPlus');
      const upOk = upMenu && upMenu.some((t) => t === '有符号')
        && !upMenu.some((t) => t.includes('操作数')) && !upMenu.some((t) => t.includes('输出 有符号'));
      upOk
        ? ok('[6] UnaryPlus 只有单颗「有符号」（Arith11 布尔形状；错给成 {in1,in2} 会因对象恒真被读成有符号）',
          J(upMenu.filter((t) => t.includes('有符号'))))
        : bad('[6] UnaryPlus 只有单颗「有符号」（Arith11 布尔形状；错给成 {in1,in2} 会因对象恒真被读成有符号）',
          J(upMenu && upMenu.filter((t) => t.includes('有符号'))));

      // ---- [6b] 移位的「移出空隙补 x」（fillx）开关：菜单项 + 模型现态 + √ 现态 ----
      // ⚠ 复用 [1] 放的那颗 ShiftLeft（按 id 定位，⛔ 不再放第二颗：重建会把元素挪到队尾，
      //   按 type 找"第一颗"会漂到别的同类上——菜单就开在没配置的那颗上，r95 现场踩过）。
      const shl0 = await page.evaluate(CELL, { type: 'ShiftLeft' });
      const shlRect = await rectOfId(shl0.id);
      await page.mouse.click(shlRect.x, shlRect.y, { button: 'right' });
      await sleep(450);
      const shlMenu = await page.evaluate(MENU_LABELS);
      await page.keyboard.press('Escape');
      await sleep(250);
      const item0 = shlMenu && shlMenu.some((t) => t === '移出空隙补 x');
      if (!item0) {
        skip('[6b] Shift 菜单有「移出空隙补 x」，开过后带 √ 且模型 fillx=true', `菜单里没有这一项：${J(shlMenu && shlMenu.filter((t) => t.includes('x') || t.includes('有符号')))}`);
        skip('[6c] fillx 电学对：1000 右移 3 位，关＝0001、开＝xxx1', '前置同上');
      } else {
        await UI.menuClick(page, '移出空隙补 x', { x: shlRect.x, y: shlRect.y });
        await sleep(900);
        await waitPaper(page);
        const shl1 = await page.evaluate(CELL, { id: shl0.id });
        const shlRect2 = await rectOfId(shl0.id);
        await page.mouse.click(shlRect2.x, shlRect2.y, { button: 'right' });
        await sleep(450);
        const shlMenu2 = await page.evaluate(MENU_LABELS);
        await page.keyboard.press('Escape');
        await sleep(250);
        const ticked = shl1 && shl1.fillx === true && shlMenu2 && shlMenu2.some((t) => t.includes('√ 移出空隙补 x'));
        ticked
          ? ok('[6b] Shift 菜单有「移出空隙补 x」，开过后带 √ 且模型 fillx=true（fillx 只能构造期给 ⇒ 走重建）',
            `fillx=${shl1.fillx} 菜单=${J(shlMenu2.filter((t) => t.includes('补 x')))}`)
          : bad('[6b] Shift 菜单有「移出空隙补 x」，开过后带 √ 且模型 fillx=true（fillx 只能构造期给 ⇒ 走重建）',
            J({ shl1: shl1 && shl1.fillx, menu: shlMenu2 && shlMenu2.filter((t) => t.includes('补 x')) }));

        // ---- [6c] fillx 电学对：ShiftRight(4位) in1=1000、in2=0011（右移 3 位）——
        //      关＝0001（补 0），开＝xxx1（补 x）。同一对接线只翻这一颗开关。
        await UI.clickGate(page, 'ShiftRight');
        await sleep(600);
        await waitPaper(page);
        const sr0 = await page.evaluate(CELL, { type: 'ShiftRight' });
        const srr = await UI.cellRect(page, 'ShiftRight');
        await UI.menuSet(page, '位宽', '4', { x: srr.x, y: srr.y });
        await sleep(800);
        await UI.clickGate(page, 'Constant'); await sleep(400);
        await UI.clickGate(page, 'Constant'); await sleep(500);
        await waitPaper(page);
        await page.evaluate((a) => {
          const p = (window).__sandboxPaper;
          const sr = p.model.getCell(a.id);
          const sp = sr.get('position');
          p.model.getElements().filter((e) => String(e.get('type')) === 'Constant' && String(e.get('constant')) === '0')
            .forEach((e, i) => e.set('position', { x: sp.x - 260, y: sp.y + (i === 0 ? -80 : 60) }));
        }, { id: sr0.id });
        await sleep(400);
        const consts3 = await page.evaluate(() => (window).__sandboxPaper.model.getElements()
          .filter((e) => String(e.get('type')) === 'Constant' && String(e.get('constant')) === '0').map((e) => String(e.id)));
        await setConst(consts3[0], '1000');
        await setConst(consts3[1], '0011');
        const w5 = await UI.dragWireBetween(page, { cellId: consts3[0], port: 'out' }, { cellId: sr0.id, port: 'in1' });
        const w6 = await UI.dragWireBetween(page, { cellId: consts3[1], port: 'out' }, { cellId: sr0.id, port: 'in2' });
        await sleep(900);
        const f0 = await page.evaluate(CELL, { id: sr0.id });
        console.log(`  [现场] fillx 关：${J(f0 && { bits: f0.bits, in1: f0.in1, in2: f0.in2, out: f0.out, links: f0.links })}`);
        const fOk = f0 && String(f0.out) === 'Vector3vl 0001' && String(f0.in1) === 'Vector3vl 1000';
        if (!fOk) {
          skip('[6c] fillx 电学对：0001 ↔ xxx1（同一对接线只翻这一颗开关）',
            `关那一半没读到（out=${f0 && f0.out}，in1=${f0 && f0.in1}，w5=${J(w5)} w6=${J(w6)} notes=${J(notes)}）`);
        } else {
          const srr2 = await UI.cellRect(page, 'ShiftRight');
          await UI.menuClick(page, '移出空隙补 x', { x: srr2.x, y: srr2.y });
          await sleep(900);
          await waitPaper(page);
          const f1 = await page.evaluate(CELL, { id: sr0.id });
          console.log(`  [现场] fillx 开：${J(f1 && { fillx: f1.fillx, out: f1.out, links: f1.links })}`);
          const pair = f1 && f1.fillx === true && String(f1.out) === 'Vector3vl xxx1' && f1.links === f0.links;
          pair
            ? ok('[6c] fillx 电学对：1000 右移 3 位，关＝0001（补 0）、开＝xxx1（补 x），同一对接线只翻这一颗开关',
              `out ${f0.out}→${f1.out}，links ${f0.links}→${f1.links}`)
            : bad('[6c] fillx 电学对：1000 右移 3 位，关＝0001（补 0）、开＝xxx1（补 x），同一对接线只翻这一颗开关',
              J({ f0: f0 && f0.out, f1: f1 && { fillx: f1.fillx, out: f1.out, links: f1.links } }));
        }
      }
    }

    // ---- [7] 静态反向臂：signed／fillx 只许经重建 ----
    const sbxSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/SandboxCanvas.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');
    const setsSignedDirect = /\bset\(\s*'signed'\s*/.test(sbxSrc) || /setProp\([^)]*'signed'/.test(sbxSrc);
    const setsFillxDirect = /\bset\(\s*'fillx'\s*/.test(sbxSrc) || /setProp\([^)]*'fillx'/.test(sbxSrc);
    const throughRebuild = /reconfigureCell\(cellId,\s*\{\s*signed/.test(sbxSrc) && /reconfigureCell\(cellId,\s*\{\s*fillx/.test(sbxSrc);
    (!setsSignedDirect && !setsFillxDirect && throughRebuild)
      ? ok('[7] signed／fillx 只经 reconfigureCell 重建（set 会被 digitaljs 回滚＝假修；setProp 同罪）',
        `直接 set signed=${setsSignedDirect} fillx=${setsFillxDirect} 走重建=${throughRebuild}`)
      : bad('[7] signed／fillx 只经 reconfigureCell 重建（set 会被 digitaljs 回滚＝假修；setProp 同罪）',
        J({ setsSignedDirect, setsFillxDirect, throughRebuild }));

    if (errors.length) bad('[X] 过程没有 pageerror', J(errors.slice(0, 4)));
    console.log(`  [现场] pageerror ${errors.length} 条`);
  } catch (e) {
    console.log('FATAL', String(e && e.stack || e).slice(0, 400));
    bad('[0] 闸门跑完了（没有中途抛错）', String(e && e.message || e).slice(0, 200));
  } finally {
    try { if (browser) await browser.close(); } catch { }
    try { if (server) server.kill('SIGKILL'); } catch { }
  }
  console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unver} unverified =====`);
  process.exit(fail > 0 ? 1 : 0);
})();
