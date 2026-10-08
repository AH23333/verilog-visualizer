// R94 闸门：**寄存器（Dff）的极性／端口编辑窗**（objective 末条「尽可能发挥 digitaljs 的全部功能」）。
//
// 为什么这一族值得单独一颗闸门（2026-10-06 自查）：digitaljs 的 Dff 支持 polarity 的 **7 个键**
// （clock/enable/arst/srst/set/clr/aload，`in` 之外还多出 ain、以及 enable_srst / no_data /
// arst_value / srst_value），但沙盒此前只有调色板两颗固定组合（`P('Dff')` 与「寄存器 EN/RST」），
// **没有任何入口改得动** —— 而同类的 Memory 有端口配置窗、FSM 有转移表窗。
//
// ⚠ 三条只在读上游源码时才看得见的形状（都已按现场读数钉住，不是审美判断）：
//  1) 端口按 `polarity` 里**键在不在**生成（dff.mjs:42-70）⇒ "取消这一脚"必须把键**删掉**，
//     留 `键: undefined` 等于这一脚还在；
//  2) 低有效必须写 `false`：引擎两边都认（`pol = v => v ? 1 : -1`），但**字形只认严格 false**
//     （base.mjs:139 `port.polarity === false` 才加 overline，而 `0 === false` 为假）⇒
//     写 0 的"低有效复位脚"在画布上与高有效长得一模一样，看图接反复位电路；
//  3) set / clr 是**与数据同宽**的端口（dff.mjs:53/57），1 位的只有 clk/en/arst/srst/aload。
//
// 射程（9 格，每格只认下面这一件事）：
//   [1] 菜单有入口、编辑器能打开、且回显器件当前档位（不是每次从空白开始）
//   [2] 端口按勾选长出来；没勾的那一脚**键真被删了**；set/clr 与数据同宽、srst 1 位
//   [3] 低有效＝写 false 且画上有横线；翻高有效两者一起没（配对，不钉绝对像素）
//   [4] 同一对接线只翻极性 ⇒ Q 的两次读数整体反过来（电学证人：这一脚真按低有效工作）
//   [5] 重建不搬家（id／位置／连线数在翻极性那次重建前后一致）
//   [6] 菜单改位宽不抹掉弹窗配好的 initial／srst_value（部分参数重建必须带得住其余构造期参数）
//   [7] 存盘重开整套回来（含 bits —— 现场读数：bits 不在构造期名单里时 4 位寄存器重开变 1 位）
//   [8] 静态反向臂：低有效只许写 false；polarity 只许经重建，不许事后 set（会被 digitaljs 回滚）
//   [9] 静态反向臂：'bits' 在 deviceParams 那份构造期名单里，且主人只有一处
//
// ⚠ 判据读的是**器件模型与画布 DOM**，不读弹窗自己写的反馈语（r87 那一族的教训：
//   不许从我们自己的文案里"认事"）。toast 只打进日志供人看。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1595;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1595)); } catch { }
const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n}${d ? ' — ' + d : ''}`); };

/**
 * 等沙盒 paper 真在。⚠ 本轮台架现场（MA/MB 两格）：`__sandboxPaper` 会在某个窗口期是
 * undefined —— **同一个变异上一跑能跑通全程、下一跑半路崩，崩点还各不相同** ⇒ 这是夹具的
 * 时序竞态（画布重建的空档），不是变异特有行为。所以每个"要摸画布"的阶段之前都等一下，
 * 把竞态变成等待；⛔ 不许把无守卫的 `__sandboxPaper.model` 留在 evaluate 里——
 * 崩一次 = [0] 红 + 后面所有格子失去观察（第 100 条规则）。
 */
async function waitPaper(page, timeout = 15000) {
  await page.waitForFunction(() => !!(window.__sandboxPaper && window.__sandboxPaper.model), null, { timeout });
  await sleep(150);
}

// ⚠ 整颗箭头交给 Playwright，不许拼 'return ' + fn.toString()（挂了 JSDoc 会因 ASI 返回 undefined）；
//   也**不许引用 Node 侧的常量**（函数是被序列化到页面里跑的，闭包带不过去 —— 本轮现场踩过）。
const SNAP = (cellId) => {
  const paper = (window).__sandboxPaper;
  if (!paper) return null;
  const KEYS = ['clock', 'enable', 'arst', 'srst', 'set', 'clr', 'aload'];
  const c = cellId ? paper.model.getCell(cellId)
    : paper.model.getElements().find((e) => String(e.get('type')) === 'Dff');
  if (!c) return null;
  const el = (paper.findViewByModel(c) || {}).el;
  const pol = c.get('polarity') || {};
  return {
    id: String(c.id), bits: c.get('bits'), initial: c.get('initial'),
    polarity: pol, keys: KEYS.filter((k) => k in pol),
    srst_value: c.get('srst_value'), arst_value: c.get('arst_value'),
    enable_srst: c.get('enable_srst'), no_data: c.get('no_data'),
    ports: (c.getPorts() || []).map((p) => p.id).sort(),
    portBits: Object.fromEntries((c.getPorts() || []).map((p) => [p.id, p.bits])),
    overline: el ? [...el.querySelectorAll('[text-decoration]')]
      .filter((n) => String(n.getAttribute('text-decoration') || '').includes('overline'))
      .map((n) => String(n.textContent)) : null,
    pos: c.get('position'), links: paper.model.getLinks().length,
    q: String(((c.get('outputSignals') || {}).out) ?? ''),
    ins: Object.fromEntries(Object.entries(c.get('inputSignals') || {}).map(([k, v]) => [k, String(v)])),
  };
};

/** 打开「端口与极性…」弹窗（右键那颗唯一的 Dff） */
async function openEditor(page) {
  const r = await UI.cellRect(page, 'Dff');
  if (!r) return { ok: false, why: '画布上没有 Dff' };
  await page.mouse.click(r.x, r.y, { button: 'right' });
  await sleep(450);
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('[data-context-menu] button')].map((b) => b.textContent.trim()));
  const item = page.locator('[data-context-menu] button', { hasText: '端口与极性' }).first();
  if (!(await item.count())) return { ok: false, why: `菜单里没有「端口与极性…」`, labels };
  await item.click();
  await sleep(550);
  const shown = await page.evaluate(() => {
    const root = document.querySelector('[data-dffports-modal]');
    if (!root) return { open: false };
    const rows = [...root.querySelectorAll('[data-dffports-row]')].map((r2) => {
      const on = r2.querySelector('[data-dffports-on]');
      const pol = r2.querySelector('[data-dffports-pol]');
      return { key: r2.getAttribute('data-dffports-row'), checked: on ? on.checked : null, pol: pol ? pol.value : null, hasValue: !!r2.querySelector('[data-dffports-value]') };
    });
    return {
      open: true, rows,
      bits: (root.querySelector('[data-dffports-f="bits"]') || {}).value,
      initial: (root.querySelector('[data-dffports-f="initial"]') || {}).value,
      enableSrSt: (() => { const i = root.querySelector('[data-dffports-enable-srst]'); return i ? { checked: i.checked, disabled: i.disabled } : null; })(),
      noData: (() => { const i = root.querySelector('[data-dffports-no-data]'); return i ? i.checked : null; })(),
      anchors: ['apply', 'cancel', 'close'].map((a) => `${a}=${!!root.querySelector(`[data-dffports-${a}]`)}`),
    };
  });
  return { ok: shown.open === true, ...shown, labels };
}

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
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await UI.newSandboxFile(page);
    await UI.clickGate(page, 'Dff');
    await waitPaper(page);
    await sleep(600);
    const dff0 = await page.evaluate(SNAP, null);
    const id = dff0 && dff0.id;
    console.log(`  [现场] 放出来的 Dff：${J(dff0 && { bits: dff0.bits, keys: dff0.keys, ports: dff0.ports })}`);

    // ---- [1] 入口 + 首次回显 ----
    const first = await openEditor(page);
    const echo0 = first.rows || [];
    const clkRow = echo0.find((r) => r.key === 'clock');
    const others = echo0.filter((r) => ['enable', 'arst', 'srst', 'set', 'clr', 'aload'].includes(r.key));
    (first.ok && clkRow && clkRow.checked === true && clkRow.pol === '1'
      && others.length === 6 && others.every((r) => r.checked === false))
      ? ok('[1] 右键有「端口与极性…」入口，编辑器打开且回显器件当前档位',
        `clock=${J(clkRow)} 其余六脚全未勾=${others.every((r) => r.checked === false)} 锚点 ${J(first.anchors)}`)
      : bad('[1] 右键有「端口与极性…」入口，编辑器打开且回显器件当前档位',
        J({ opened: first.ok, clkRow, others, why: first.why, labels: first.labels }));
    if (!first.ok) {
      ['[2] 端口按勾选长出来，没勾的那一脚键真被删了', '[3] 低有效＝写 false 且画上有横线，翻高有效两者一起没',
        '[4] 同一对接线只翻极性，Q 的两次读数整体反过来', '[5] 重建不搬家：id／位置／连线数不变',
        '[6] 菜单改位宽不抹掉弹窗配好的 initial／srst_value', '[7] 存盘重开整套参数回来（含 bits）']
        .forEach((n) => skip(n, '前置没满足（入口/编辑器没打开），这一格今天没判'));
    } else {
      // 配一版：4 位 / 初值 0000 / 取消时钟 / 清零低有效 / 同步复位高有效且复位值 0101
      await page.locator('[data-dffports-f="bits"]').fill('4');
      await page.locator('[data-dffports-f="initial"]').fill('0000');
      await page.locator('[data-dffports-on="clock"]').setChecked(false);
      await page.locator('[data-dffports-on="clr"]').setChecked(true);
      await page.locator('[data-dffports-pol="clr"]').selectOption('0');
      await page.locator('[data-dffports-on="srst"]').setChecked(true);
      await page.locator('[data-dffports-value="srst_value"] input').fill('0101');
      await page.locator('[data-dffports-apply]').click();
      await sleep(1200);
      await waitPaper(page);
      const s1 = await page.evaluate(SNAP, id);
      let flipBlocked = null;   // [7] 也要读它：翻面没发生 ⇒ [7] 钉的状态不存在，落"未验"
      console.log(`  [现场] 第一次应用后：${J(s1 && { bits: s1.bits, keys: s1.keys, ports: s1.ports, portBits: s1.portBits, overline: s1.overline })}`);
      console.log(`  [现场] toast：${J(await UI.toastText(page))}`);

      // ---- [2] 端口形状 ----
      const noClkKey = s1 && !(s1.polarity || {}).hasOwnProperty?.('clock') && !s1.keys.includes('clock');
      const portsOk = s1 && ['clr', 'in', 'out', 'srst'].join() === s1.ports.join();
      const wideOk = s1 && s1.portBits.clr === s1.bits && s1.portBits.srst === 1;
      (portsOk && noClkKey && wideOk)
        ? ok('[2] 端口按勾选长出来，没勾的那一脚键真被删了（留 undefined 会被 digitaljs 当地址存在）',
          `ports=${J(s1.ports)} keys=${J(s1.keys)} portBits=${J(s1.portBits)} bits=${s1.bits}`)
        : bad('[2] 端口按勾选长出来，没勾的那一脚键真被删了（留 undefined 会被 digitaljs 当地址存在）',
          J({ ports: s1 && s1.ports, keys: s1 && s1.keys, portBits: s1 && s1.portBits, bits: s1 && s1.bits, noClkKey, portsOk, wideOk }));

      // ---- [3] 低有效的两半（字形 + 写的是 false），并要翻面后一起没 ----
      const lowShape = s1 && s1.polarity.clr === false;
      const lowDecor = !!(s1 && (s1.overline || []).length);
      if (!lowShape || !lowDecor) {
        bad('[3] 低有效＝写 false 且画上有横线；翻成高有效两者一起没（配对）',
          J({ lowShape, lowDecor, polarity: s1 && s1.polarity, overline: s1 && s1.overline, why: '低有效那一半就没成立，翻面不必再看' }));
        skip('[4] 同一对接线只翻极性，Q 的两次读数整体反过来', '极性格没成立，成对读数的两半取不到');
      } else {
        // 接两颗常量当激励：D=1111、clr 可改（位宽对齐，否则产品会插一颗零扩展，读数就没法解释）
        await waitPaper(page);
        await UI.clickGate(page, 'Constant');
        await sleep(500);
        await UI.clickGate(page, 'Constant');
        await waitPaper(page);
        await sleep(600);
        const consts = await page.evaluate(() => ((window).__sandboxPaper
          ? (window).__sandboxPaper.model.getElements()
          : [])
          .filter((e) => String(e.get('type')) === 'Constant')
          .map((e) => ({ id: String(e.id), pos: e.get('position') })));
        const notes = [];
        const setConst = async (cid, val) => {
          const r = await page.evaluate((a) => {
            const p = (window).__sandboxPaper;
            if (!p || !p.model) return null;
            const c = a.id ? p.model.getCell(a.id) : null;
            if (!c) return null;
            const el = (p.findViewByModel(c) || {}).el;
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
          }, { id: cid });
          if (!r) { notes.push(`常量 ${cid} 取不到盒体点`); return false; }
          try { await UI.menuSet(page, '常量值', val, r); }
          catch (e) { notes.push(`常量设 ${val} 失败：${String(e.message).slice(0, 60)}`); return false; }
          await sleep(800);
          return true;
        };
        // ⚠ 顺序有讲究：**先把两颗常量配成 4 位，再拖线**。反过来（先拖再改）会在拖那一步
        //   撞上"1 位常量 → 4 位端口"的位宽不匹配，产品当场插一颗零扩展转换器顶上，
        //   而它落点就压着常量 —— 之后右键点到的是转换器菜单（没有「常量值」），本轮现场踩过。
        await setConst(consts[0] && consts[0].id, '1111');
        await setConst(consts[1] && consts[1].id, '1111');
        const wiredD = await UI.dragWireBetween(page, { cellId: consts[0] && consts[0].id, port: 'out' }, { cellId: id, port: 'in' });
        const wiredR = await UI.dragWireBetween(page, { cellId: consts[1] && consts[1].id, port: 'out' }, { cellId: id, port: 'clr' });
        const qLowIn1 = (await page.evaluate(SNAP, id) || {}).q;
        await setConst(consts[1] && consts[1].id, '0000');
        const qLowIn0 = (await page.evaluate(SNAP, id) || {}).q;
        const beforeFlip = await page.evaluate(SNAP, id);

        // 翻面：只改极性，接线一根都不动
        const second = await openEditor(page);
        const echo1 = second.bits === '4' && second.rows && second.rows.some((r) => r.key === 'clr' && r.checked === true && r.pol === '0')
          && second.rows.some((r) => r.key === 'srst' && r.checked === true && r.hasValue === true);
        (second.ok && echo1)
          ? ok('[1b] 编辑器二次打开回显的是刚应用过的档位（不是每次从空白开始）',
            `bits=${second.bits} rows=${J((second.rows || []).map((r) => `${r.key}:${r.checked}/${r.pol}${r.hasValue ? '+值' : ''}`))}`)
          : bad('[1b] 编辑器二次打开回显的是刚应用过的档位（不是每次从空白开始）',
            J({ opened: second.ok, bits: second.bits, rows: second.rows, why: second.why }));
        let qHighIn0 = null, qHighIn1 = null, afterFlip = null;
        if (second.ok) {
          // ⚠ 极性下拉是 `disabled={!on}` —— 编辑器若没把已配的档回显出来，它就是禁用的；
          //   selectOption 对 disabled 的 select 会等满 30s 然后 FATAL（首轮台架 MA 现场踩过）。
          //   "翻不了面"是这一格**存在的意义之一**，必须按三态处理，不许让整颗闸门崩掉。
          const polSel = page.locator('[data-dffports-pol="clr"]');
          flipBlocked = !(await polSel.isEnabled().catch(() => false));
          if (!flipBlocked) {
            await polSel.selectOption('1');
            await page.locator('[data-dffports-apply]').click();
            await sleep(1200);
            await waitPaper(page);
            afterFlip = await page.evaluate(SNAP, id);
            qHighIn0 = afterFlip ? afterFlip.q : null;    // 此刻驱动常量仍是 0000；paper 空档时如实给 null（[4] 落未验）
            await setConst(consts[1] && consts[1].id, '1111');
            qHighIn1 = (await page.evaluate(SNAP, id) || {}).q;
          } else {
            await page.locator('[data-dffports-cancel]').click().catch(() => { });
            await sleep(400);
          }
        }
        if (flipBlocked) {
          skip('[3] 低有效＝写 false 且画上有横线；翻成高有效两者一起没（配对）',
            `低有效那一半成立（polarity.clr=false、横线 ${J(s1.overline)}），但翻面做不了（极性下拉禁用＝编辑器没回显档位）⇒ 只验了一半，整格不作数`);
        } else {
        const shapePair = lowShape && afterFlip && afterFlip.polarity.clr === true
          && (afterFlip.overline || []).length === 0;
        shapePair
          ? ok('[3] 低有效＝写 false 且画上有横线；翻成高有效两者一起没（配对）',
            `低：polarity.clr=false overline=${J(s1.overline)} → 高：polarity.clr=true overline=${J(afterFlip.overline)}`)
          : bad('[3] 低有效＝写 false 且画上有横线；翻成高有效两者一起没（配对）',
            J({ lowShape, lowDecor, after: afterFlip && { polarity: afterFlip.polarity, overline: afterFlip.overline } }));
        }

        // ---- [4] 电学成对：同一对接线，极性翻面后两半读数必须互换 ----
        const readable = [qLowIn1, qLowIn0, qHighIn0, qHighIn1].filter((x) => x && !/x/i.test(x));
        if (readable.length < 4 || !afterFlip) {
          skip('[4] 同一对接线只翻极性，Q 的两次读数整体反过来',
            `四格读数只拿到 ${readable.length} 格（读不到 x／缺格都不作数）：${J({ qLowIn1, qLowIn0, qHighIn0, qHighIn1, wiredD, wiredR, notes })}`);
        } else {
          const swapped = qLowIn1 === qHighIn0 && qLowIn0 === qHighIn1 && qLowIn1 !== qLowIn0;
          swapped
            ? ok('[4] 同一对接线只翻极性，Q 的两次读数整体反过来（这一脚真按低有效工作，不只是画了条横线）',
              `低有效：clr=1111→${qLowIn1}、clr=0000→${qLowIn0}；高有效：clr=0000→${qHighIn0}、clr=1111→${qHighIn1}`)
            : bad('[4] 同一对接线只翻极性，Q 的两次读数整体反过来（这一脚真按低有效工作，不只是画了条横线）',
              J({ qLowIn1, qLowIn0, qHighIn0, qHighIn1 }));
        }

        // ---- [5] 重建不搬家 ----
        if (!afterFlip || !beforeFlip) {
          skip('[5] 重建不搬家：id／位置／连线数在翻极性那次重建前后一致', '编辑器第二次没打开，翻面那一步没发生，这一格今天没判');
        } else {
        const still = afterFlip && afterFlip.id === id && beforeFlip
          && Math.round(afterFlip.pos.x) === Math.round(beforeFlip.pos.x)
          && Math.round(afterFlip.pos.y) === Math.round(beforeFlip.pos.y)
          && afterFlip.links === beforeFlip.links && beforeFlip.links >= 2;
        still
          ? ok('[5] 重建不搬家：id／位置／连线数在翻极性那次重建前后一致',
            `pos ${J(beforeFlip.pos)}→${J(afterFlip.pos)}，links ${beforeFlip.links}→${afterFlip.links}`)
          : bad('[5] 重建不搬家：id／位置／连线数在翻极性那次重建前后一致',
            J({ before: beforeFlip && { pos: beforeFlip.pos, links: beforeFlip.links }, after: afterFlip && { id: afterFlip.id, pos: afterFlip.pos, links: afterFlip.links } }));
        }
      }

      // ---- [6] 部分参数的重建不许抹掉其余构造期参数（菜单改位宽） ----
      await waitPaper(page);
      const r6 = await UI.cellRect(page, 'Dff');
      await UI.menuSet(page, '位宽', '6', { x: r6.x, y: r6.y });
      const s6 = await page.evaluate(SNAP, id);
      const carried = s6 && s6.bits === 6 && s6.initial === '0000' && s6.srst_value === '0101'
        && s6.keys.includes('clr') && s6.keys.includes('srst') && !s6.keys.includes('clock');
      carried
        ? ok('[6] 菜单改位宽不抹掉弹窗配好的 initial／srst_value（重建必须先并上器件现有构造参数）',
          `bits=${s6.bits} initial=${s6.initial} srst_value=${s6.srst_value} keys=${J(s6.keys)} portBits=${J(s6.portBits)}`)
        : bad('[6] 菜单改位宽不抹掉弹窗配好的 initial／srst_value（重建必须先并上器件现有构造参数）',
          J(s6 && { bits: s6.bits, initial: s6.initial, srst_value: s6.srst_value, keys: s6.keys, polarity: s6.polarity }));

      // ---- [7] 存盘重开：整套参数回来（含 bits） ----
      if (flipBlocked) {
        // ⚠ 这一格钉的是"翻面之后的存档形状"（polarity.clr === true）：翻面没发生，那个状态
        //   今天就不存在 —— 与 [3][4][5] 同一原因落"未验"，⛔ 不许读成绿或红（首轮台架 MA 的期望表洞）。
        skip('[7] 存盘重开整套参数回来（bits 必须在构造期名单里：事后 set 被 digitaljs 回滚）',
          '翻面没发生 ⇒ 这一格要钉的状态不存在，与 [3][4][5] 同一原因不作数');
      } else {
        let s7 = null; const notes7 = [];
        // ⚠ 重开那段有导航竞态（"Execution context was destroyed"）：evaluate 撞上 reload。
        //   同一段代码五格都好、一格崩 ⇒ 是竞态不是确定缺陷 ⇒ 按重试处理，三次都读不到才如实报。
        for (let attempt = 1; attempt <= 3 && !s7; attempt++) {
          try {
            await page.locator('button[title*="保存"], button:has-text("保存")').first().click().catch(() => { });
            await sleep(900);
            await UI.boot(page, URL, { reload: true });
            try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
            await UI.enterSandbox(page);
            await waitPaper(page);
            await sleep(900);
            s7 = await page.evaluate(SNAP, id);
          } catch (e) {
            notes7.push(`第${attempt}次重开没读到：${String((e && e.message) || e).slice(0, 90)}`);
            await sleep(1200);
          }
        }
        const persisted = s7 && s7.bits === 6 && s7.initial === '0000' && s7.srst_value === '0101'
          && s7.polarity.clr === true && s7.portBits.clr === 6 && s7.ports.join() === ['clr', 'in', 'out', 'srst'].sort().join();
        persisted
          ? ok('[7] 存盘重开整套参数回来（bits 必须在构造期名单里：事后 set 被 digitaljs 回滚）',
            `bits=${s7.bits} ports=${J(s7.ports)} portBits=${J(s7.portBits)} polarity=${J(s7.polarity)} srst_value=${s7.srst_value}`)
          : bad('[7] 存盘重开整套参数回来（bits 必须在构造期名单里：事后 set 被 digitaljs 回滚）',
            J({ ...(s7 && { bits: s7.bits, ports: s7.ports, portBits: s7.portBits, polarity: s7.polarity, srst_value: s7.srst_value, initial: s7.initial }), notes: notes7 }));
      }
    }

    // ---- [8] 静态反向臂：低有效只许写 false；polarity 只许经重建 ----
    // ⚠ 必须先抹掉注释再判（r90 那一族的现成教训：这份文件里逐字引用了 `cell.set('bits', …)`
    //   与 `polarity[what] ? 1 : -1`，不抹注释就会自己咬自己）。
    // ⚠ 禁字面清单会被换词绕过 ⇒ 按**句式**划射程：任何"给 polarity 的某一脚赋值"的右边
    //   都不许出现裸 0／1 数字字面量（`? 1 : 0` 这种改写照样被抓）。
    const stripComments = (s) => (s || '')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');
    const modalSrc = stripComments(fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/DffPortsModal.tsx'), 'utf8'));
    const sbxSrc = stripComments(fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/SandboxCanvas.tsx'), 'utf8'));
    const polAssigns = [...modalSrc.matchAll(/polarity\[[^\]]*\]\s*=\s*([^;\n]*)/g)].map((m) => m[1]);
    const numericPol = polAssigns.filter((rhs) => /(^|[^\w.])(0|1)(?![\w.])/.test(rhs));
    const setsPolarityDirect = /\bset\(\s*'polarity'\s*/.test(sbxSrc) || /setProp\([^)]*'polarity'/.test(sbxSrc);
    const goesThroughRebuild = /reconfigureCell\(dffPortsDlg/.test(sbxSrc);
    (polAssigns.length > 0 && numericPol.length === 0 && !setsPolarityDirect && goesThroughRebuild)
      ? ok('[8] polarity 只写布尔（`0 === false` 为假 ⇒ 写 0 就没有横线），且只经重建、不许事后 set',
        `赋值 ${polAssigns.length} 处全是布尔形状（${J(polAssigns.map((s) => s.trim()))}）；直接 set=${setsPolarityDirect} 走重建=${goesThroughRebuild}`)
      : bad('[8] polarity 只写布尔（`0 === false` 为假 ⇒ 写 0 就没有横线），且只经重建、不许事后 set',
        J({ polAssigns, numericPol, setsPolarityDirect, goesThroughRebuild }));

    // ---- [9] 静态反向臂：'bits' 在构造期名单里且主人只有一处 ----
    const dpSrc = stripComments(fs.readFileSync(path.join(PROJECT_ROOT, 'src/lib/deviceParams.ts'), 'utf8'));
    const block = (/export const CTOR_PARAM_KEYS\s*=\s*\[([\s\S]*?)\];/.exec(dpSrc) || [])[1] || '';
    const bitsHits = (block.match(/(['"])bits\1/g) || []).length;
    const loadSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'src/lib/sandboxLoad.ts'), 'utf8');
    const ctorOwnerOnly = /ctorParams\(c\)/.test(loadSrc) && !/new digitaljs\.cells\[[^\]]*\]\(/.test(loadSrc);
    (bitsHits === 1 && ctorOwnerOnly)
      ? ok("[9] 'bits' 在 deviceParams 那份构造期名单里（恰好一次），载入侧只有 ctorParams 一个主人",
        `bits 出现 ${bitsHits} 次；sandboxLoad 走 ctorParams=${/ctorParams\(c\)/.test(loadSrc)}`)
      : bad("[9] 'bits' 在 deviceParams 那份构造期名单里（恰好一次），载入侧只有 ctorParams 一个主人",
        J({ bitsHits, ctorOwnerOnly, blockLen: block.length }));

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
