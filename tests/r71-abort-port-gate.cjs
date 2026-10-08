// R71 闸门：**起线没接成（取消或被拒）绝不许把"另有驱动"的输入端口留在 x**。
//
// 上游事实（bundle @2285659，Wire.remove）：
//   remove(){ const t=this.get('target'), n=this.graph.getCell(t.id);
//             n && 'port' in t && n._clearInput(t.port); … }
//   ⇒ 摘线时它**不看那个端口是不是还有别的线在驱动**，一律清成 x。
//   反向起线（在输入引脚上按下）的临时线，目标端就挂在那个被驱动的端口上，
//   于是「按了一下没连成」= 端口永久 x：驱动它的源此后不再变值，没有任何一次传播会救它。
//   r70 探针实测：线里仍是 1、器件端口却是 x，连点源两次都不回。
//   应用侧的放大 factor：`cell:pointerdown` 有 14 px 的「起手吸附」（SandboxCanvas 里
//   nearestPortDot(…, 14)），用户想点选器件、落在端口附近，就已经在起线了。
//
// 判据（每臂只钉一件事；读不到就 UNVERIFIED，不算绿）：
//  [1] 前置：Constant→And.in1 连成，And 看到的是**确定值**（起点必须是好的）
//  [2] 在 And.in1 磁吸上按下又松开、不移动 ⇒ 连线数不变，且 And.in1 仍是那个确定值
//      （这一格就是修复的靶心：把 dropTempWire 退回 tempLink.remove() 必须红在这里）
//  [3] 同一动作再来两次 ⇒ 仍不变（不累积、不越点越坏）
//  [4] 从 And.out 正向起线、拖到"已被 Constant 占用"的 Lamp.in ⇒ 若这次连接被拒，
//      被临时线挂过的 Lamp.in 必须还是驱动线的那个值；
//      若应用是"替换驱动"语义（不是拒绝），这一格判不了 ⇒ UNVERIFIED，不许算绿
//  [5] 端口本来就没驱动时，取消起线后仍是 x（**不许替用户编一个值**）
//  [7] 拖线中途先吸上、松开后又把 target 设一遍 ⇒ 那根线不许把自己的值抹成 x
//      （上游 `_changeTarget` 清"上一个 target 端口"，而上一个 == 这一个，finalizeWire 收尾必须重播）
//  [6] 全程无页面异常
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1712;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1712)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n}（${d}）`); };

/** 画布上某器件某端口的**当前**屏幕圆心（每次操作前重算：插线/重排会挪动画面） */
const magnetCenter = (page, type, port) => page.evaluate((a) => {
  const p = window.__sandboxPaper;
  const c = p && p.model.getElements().find((e) => String(e.get('type')) === a.type);
  if (!c) return { noCell: true };
  const v = p.findViewByModel(c);
  const el = v && v.el.querySelector(`.joint-port-body[port="${a.port}"] circle`);
  if (!el) return { noMagnet: true, id: String(c.id) };
  const r = el.getBoundingClientRect();
  return { id: String(c.id), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}, { type, port });

/** 读某颗器件在某个输入端口上看到的值，以及画布上的连线数 */
const readPort = (page, type, port) => page.evaluate((a) => {
  const p = window.__sandboxPaper;
  const c = p.model.getElements().find((e) => String(e.get('type')) === a.type);
  if (!c) return { noCell: true };
  const v = (c.get('inputSignals') || {})[a.port];
  return { id: String(c.id), val: v == null ? null : String(v), hasX: v == null ? null : /x/i.test(String(v)), links: p.model.getLinks().length };
}, { type, port });

/** 真鼠标从 a 的端口拖到 b 的端口（直线，中途不停） */
async function dragTo(page, a, b) {
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(150);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await sleep(80);
  await page.mouse.move(b.x, b.y, { steps: 5 }); await sleep(200);
  await page.mouse.up(); await sleep(700);
}

/** 「按下、不动、松开」：起了一根线又立刻取消（用户点选器件时最容易撞上的一条） */
async function pressRelease(page, m) {
  await page.mouse.move(m.x, m.y); await sleep(120);
  await page.mouse.down(); await sleep(120); await page.mouse.up(); await sleep(700);
}

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
    await UI.clickGate(page, 'Constant'); await sleep(600);
    await UI.clickGate(page, 'And'); await sleep(600);
    await UI.clickGate(page, 'ZeroExtend'); await sleep(600);
    await UI.clickGate(page, 'Lamp'); await sleep(600);

    const cst = await magnetCenter(page, 'Constant', 'out');
    const aIn1 = await magnetCenter(page, 'And', 'in1');
    if (cst.noCell || aIn1.noCell || cst.noMagnet || aIn1.noMagnet) {
      skip('[1] Constant→And.in1 连成且端口看到确定值', `夹具端口找不到：Constant=${J(cst)} And=${J(aIn1)}`);
      console.log(`\n===== R71 abort-port: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
      process.exit(fail > 0 ? 1 : 0);
    }

    await dragTo(page, cst, aIn1);
    const base = await readPort(page, 'And', 'in1');
    console.log('  [1] 连成后 And.in1 =', J(base), '（Constant 的 out 是确定值，所以这里不该有 x）');
    (base.links >= 1 && base.val !== null && !base.hasX ? ok : bad)(
      '[1] Constant→And.in1 连上，And 看到的是确定值（起点是好的）',
      `And.in1=${J(base.val)} links=${base.links}`);
    if (base.hasX || base.val === null) {
      console.log(`\n===== R71 abort-port: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
      process.exit(1);
    }

    // [2] 在被驱动的输入口上「按下又松开」
    const m2 = await magnetCenter(page, 'And', 'in1');
    await pressRelease(page, m2);
    const after2 = await readPort(page, 'And', 'in1');
    (after2.val === base.val && !after2.hasX && after2.links === base.links ? ok : bad)(
      '[2] 在已驱动的 And.in1 上按下又松开（起线取消）⇒ 端口值不被清成 x、线没少',
      `前=${J(base.val)} 后=${J(after2.val)} links ${base.links}→${after2.links}`);

    // [3] 连做两次
    for (let k = 0; k < 2; k++) { const m = await magnetCenter(page, 'And', 'in1'); await pressRelease(page, m); }
    const after3 = await readPort(page, 'And', 'in1');
    (after3.val === base.val && !after3.hasX ? ok : bad)(
      '[3] 同样的取消连做两次之后仍是那个值（不累积、不越点越坏）',
      `前=${J(base.val)} 后=${J(after3.val)} links=${after3.links}`);

    // [4] 反向起线拖到已被占用的输入口：看应用是"拒绝"还是"替换"
    // [4] 正反面：把一根**合法输出**拖到"已被别的线占用"的输入口 ⇒ 若这次被拒，
    //     被临时线挂过的口（就是那颗已占用的口）必须还是原来那个值。
    //     ⚠ v1 这一支走成了「两端都是输入口」的拒绝（提示：起点必须是输出端口），
    //       那条路根本不碰目标端口，等于没测到靶心 ⇒ 改成从 And.out 正向起线。
    const lampIn0 = await magnetCenter(page, 'Lamp', 'in');
    const cNow = await magnetCenter(page, 'Constant', 'out');
    if (lampIn0.noMagnet || cNow.noMagnet) skip('[4] 连接被拒时，被挂过的输入口仍是原值', `找不到 Lamp.in / Constant.out ${J(lampIn0)} ${J(cNow)}`);
    else {
      await dragTo(page, cNow, lampIn0);                    // 同一颗 Constant 扇出驱动 Lamp.in（合法）
      const lampBefore = await readPort(page, 'Lamp', 'in');
      if (lampBefore.hasX || lampBefore.val === null) {
        skip('[4] 连接被拒时，被挂过的输入口仍是原值', `Lamp.in 没能被 Constant 占用（读到 ${J(lampBefore.val)}）`);
      } else {
        const andOut = await magnetCenter(page, 'And', 'out');
        const lampNow = await magnetCenter(page, 'Lamp', 'in');
        await dragTo(page, andOut, lampNow);                // 目标已被占用 ⇒ 期待被拒
        const toast = await UI.toastText(page);
        const lampAfter = await readPort(page, 'Lamp', 'in');
        const andOutAfter = await readPort(page, 'And', 'in1');
        if (/被拒绝/.test(String(toast || ''))) {
          (lampAfter.val === lampBefore.val && !lampAfter.hasX && andOutAfter.val === base.val ? ok : bad)(
            '[4] 往"已被占用"的 Lamp.in 上拖一根线、被拒 ⇒ Lamp.in 还是那根驱动线的值（And.in1 也没被牵连）',
            `提示=${J(toast)} Lamp.in ${J(lampBefore.val)}→${J(lampAfter.val)}｜And.in1=${J(andOutAfter.val)}`);
        } else {
          skip('[4] 连接被拒时，被挂过的输入口仍是原值', `今天没走出"拒绝"这条路（提示=${J(toast)}，Lamp.in ${J(lampBefore.val)}→${J(lampAfter.val)}）`);
        }
      }
    }

    // [5] 没驱动的端口：取消起线后**仍然是 x**（修复不许替用户编值）
    const zIn = await magnetCenter(page, 'ZeroExtend', 'in');
    const zBefore = await readPort(page, 'ZeroExtend', 'in');
    if (zIn.noCell || zIn.noMagnet) skip('[5] 无驱动的端口取消后仍是 x', `找不到 ZeroExtend.in ${J(zIn)}`);
    else {
      await pressRelease(page, zIn);
      const zAfter = await readPort(page, 'ZeroExtend', 'in');
      (zAfter.hasX === true || zAfter.val === null ? ok : bad)(
        '[5] 本来就没驱动的 ZeroExtend.in：取消起线后仍是 x（没被替用户编成 0）',
        `前=${J(zBefore.val)} 后=${J(zAfter.val)}`);
    }

    // [7] 拖线**中途先吸上、松开后又把 target 设了一遍**（= finalizeWire 的真实形状）：
    //     上游 `_changeTarget` 会清掉"上一个 target 端口"，而这里上一个 == 这一个，
    //     于是那根线把自己的值抹了 ⇒ 端口恒 x。这一臂钉的就是这一刀（钉不钉得住看收尾那一播）。
    const cOut2 = await magnetCenter(page, 'Constant', 'out');
    const aIn2 = await magnetCenter(page, 'And', 'in2');
    if (cOut2.noMagnet || aIn2.noMagnet) skip('[7] 中途吸上、松开后再设一次 target ⇒ 端口仍是确定值', `找不到端口磁吸 ${J(cOut2)} ${J(aIn2)}`);
    else {
      await page.mouse.move(cOut2.x, cOut2.y); await page.mouse.down(); await sleep(150);
      await page.mouse.move(aIn2.x, aIn2.y, { steps: 5 }); await sleep(250);   // 先吸上（temp.set('target') 第一次）
      await page.mouse.move(aIn2.x - 40, aIn2.y, { steps: 2 }); await sleep(150); // 松开磁吸
      await page.mouse.move(aIn2.x, aIn2.y, { steps: 2 }); await sleep(200);   // 再吸上（第二次）
      await page.mouse.up(); await sleep(800);
      const in2 = await readPort(page, 'And', 'in2');
      const lnk = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        const c = p.model.getElements().find((e) => String(e.get('type')) === 'And');
        const l = p.model.getLinks().find((x) => x.get('target')?.id === c.id && x.get('target')?.port === 'in2');
        return l ? { bits: l.get('bits') ?? null, signal: String(l.get('signal')), warning: l.get('warning') ?? null } : null;
      });
      (in2.val !== null && !in2.hasX ? ok : bad)(
        '[7] 中途吸上、松开后再设一次 target ⇒ And.in2 看到的是确定值（线没把自己抹成 x）',
        `And.in2=${J(in2.val)}｜这根线 itself=${J(lnk)}`);
    }

    // [8] 拖线**中途扫过另一颗已被驱动的端口**（先吸 And.in1、再吸 And.in2、松开）：
    //     上游每次换 target 都会把"上一个口"清成 x，而那个口此时另有驱动线 ⇒ 必须被推回去。
    const cOut3 = await magnetCenter(page, 'Constant', 'out');
    const aIn1b = await magnetCenter(page, 'And', 'in1');
    const zIn2 = await magnetCenter(page, 'ZeroExtend', 'in');   // 终点要落在**空闲**的口上（in2 已被 [7] 占用）
    if (cOut3.noMagnet || aIn1b.noMagnet || zIn2.noMagnet) skip('[8] 中途扫过已驱动的端口 ⇒ 那口仍是它自己驱动线的值', `端口磁吸不全 ${J(cOut3)} ${J(aIn1b)} ${J(zIn2)}`);
    else {
      const before8 = await readPort(page, 'And', 'in1');
      await page.mouse.move(cOut3.x, cOut3.y); await page.mouse.down(); await sleep(150);
      await page.mouse.move(aIn1b.x, aIn1b.y, { steps: 4 }); await sleep(250);   // 先吸在已驱动的 in1 上
      await page.mouse.move(zIn2.x, zIn2.y, { steps: 4 }); await sleep(250);     // 再挪到 ZeroExtend.in
      await page.mouse.up(); await sleep(800);
      const after8 = await readPort(page, 'And', 'in1');
      const zNow = await readPort(page, 'ZeroExtend', 'in');
      (after8.val !== null && !after8.hasX ? ok : bad)(
        '[8] 中途扫过已驱动的 And.in1 再落到 ZeroExtend.in ⇒ in1 仍是它自己驱动线的值（没被扫过的线抹成 x）',
        `in1 ${J(before8.val)}→${J(after8.val)}｜新连的 ZeroExtend.in=${J(zNow.val)} links=${after8.links}`);
    }

    (perr.length ? bad : ok)('[6] 全程无页面异常', perr.slice(0, 3).join(' | '));
    console.log(`\n===== R71 abort-port: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
    fail++;
    console.log(`\n===== R71 abort-port: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
