// R113 闸门：**旋转 + 镜像的组合操作**（用户 2026-10-07 实测报「组合后依然有很大问题」）。
//
// 判据＝变换群的**作用律**，全部走真实 UI 路径（右键菜单 + Ctrl+R / Shift+Ctrl+R）：
//   [1] M² = I      镜像两次完全复原（mirror 状态 / 端口锚点 / body transform 三者一致）
//   [2] R(90)⁴ = I  旋转四次回原状，且**全程不污染** mirror 与端口几何
//   [3] M∘R(θ)∘M = R(−θ)   镜像两次夹一次旋转 ≡ 反向旋转
//   [4] M∘R(θ) = R(−θ)∘M   交换律：先镜像后旋转 ≡ 先反向旋转后镜像
//   [5] 旋转是**纯角度变更**：rotate 不动 mirror / 端口 / body transform
//   [6] 全器件类型扫：镜像 → 旋转 → 再镜像 往返后必须回到无镜像态
//   [7] 多选：整体镜像（位置关于选区中心对称 + 逐颗翻 + **角度取反**）后仍可完全撤销
//
// ⚠ 根因（探针实测，R113）：mirror 曾存**屏幕语义**，applyMirror 按
//   `swap = angle===90||270` 换成本地轴 ⇒ 每转一次镜像轴就被重新解释一次，
//   旋转不再是纯角度变更。实测 And：水平镜像后 bodyTf=scale(-1,1)，
//   再 Ctrl+R 一次变成 scale(1,-1) —— 图形被额外做了一次垂直镜像。
//   修复＝mirror 改存**器件本地轴**、applyMirror 不读 angle（推导见 cellMirror.flipCell）。
//
// ⚠ 复位纪律：不能只 `c.prop('mirror', null)` —— body/端口几何由 applyMirror 落地，
//   直接改 prop 不复原，判据会读到脏值。必须走真实菜单把每个轴翻回去（往返幂等）。
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1613;
const URL = `http://127.0.0.1:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('  PASS  ' + n + (d ? ' — ' + d : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + J(d) : '')); };
const norm = (a) => ((Number(a) % 360) + 360) % 360;

/** 读一颗器件的完整几何状态（模型 + DOM），组合判据的唯一定义处 */
const READ = (page, type, i = 0) => page.evaluate((a) => {
  const paper = window.__sandboxPaper;
  const c = paper.model.getElements().filter((e) => String(e.get('type')) === a.t)[a.i];
  if (!c) return null;
  const el = (paper.findViewByModel(c) || {}).el;
  const body = el && el.querySelector('[joint-selector="body"], [data-selector="body"]');
  const ports = {};
  for (const g of Object.keys(c.prop('ports/groups') || {})) {
    const raw = c.getPortsPositions(g) || {};
    for (const k of Object.keys(raw)) ports[`${g}.${k}`] = [+raw[k].x.toFixed(1), +raw[k].y.toFixed(1)];
  }
  return {
    angle: c.get('angle'), mirror: c.get('mirror'),
    pos: [+c.position().x.toFixed(1), +c.position().y.toFixed(1)],
    bodyTf: (body && body.getAttribute('transform')) || null,
    ports,
  };
}, { t: type, i });

/**
 * 对某类器件点右键菜单里的镜像项。
 *
 * ⚠ **必须每次现取屏幕坐标**：器件一旦被选中就会带上 `sm-selected` 类，DOM 命中层
 *   随之改变，开头缓存一次的坐标到后面几组就点空了（菜单压根不开，locator 5s 超时）。
 *   首跑就是这么挂在 [2] 上的——[1] 组跑完，[2] 组用的还是 [1] 开头取的那份坐标。
 */
async function flipVia(page, type, label = '水平镜像') {
  const r = await UI.cellRect(page, type);
  if (!r) throw new Error(`flipVia: 画布上找不到 ${type}`);
  await UI.menuClick(page, label, r);
}

/** 复位到无镜像 + angle 0 的干净态（走真实菜单往返，见文件头纪律） */
async function reset(page) {
  const on = await page.evaluate(() => window.__sandboxPaper.model.getElements().map((c) => ({
    type: String(c.get('type')), mirror: c.get('mirror') })));
  for (const c of on) {
    if (!c.mirror) continue;
    for (const [bit, label] of [['h', '水平镜像'], ['v', '垂直镜像']]) {
      if (!c.mirror[bit]) continue;
      const r = await UI.cellRect(page, c.type);
      if (!r) continue;
      try { await UI.menuClick(page, label, r); } catch { /* 器件不在就跳过 */ }
    }
  }
  await page.evaluate(() => {
    const paper = window.__sandboxPaper;
    for (const c of paper.model.getElements()) c.prop('angle', 0);
    paper.updateViews();
  });
  await sleep(250);
}

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { /* not up */ } await sleep(500); }
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { /* 无引导 */ }
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await UI.newSandboxFile(page);

    // 三种端口布局形态各来一颗：命名对象(And) / 字符串 absolute(Lamp) / 函数(Dff)
    for (const t of ['And', 'Lamp', 'Dff']) { await UI.clickGate(page, t); await sleep(450); }
    await sleep(700);
    // ⚠ 这里只确认「器件放出来了」；**不要把坐标缓存下来给后面用**——
    //   器件一旦被选中就带上 sm-selected 类、DOM 命中层改变，缓存的坐标到后面就点空了。
    const and0 = await UI.cellRect(page, 'And');
    if (!and0) { bad('[setup] 画布上没放出 And', null); throw new Error('setup 失败'); }
    console.log('[setup] 三颗器件就位');

    // ── [1] M² = I ────────────────────────────────────────────────
    // ⚠ 判据只用「复原」不用「中途必须变」：And 宽 60，`left/dx:30` 换成 `right/dx:-30`
    //   后锚点**恰好都是 x=30**，锚点集本就相等，拿它当「翻转生效了」的证据会误判成红。
    //   翻转是否生效由 bodyTf 变化证明；锚点只验「复原」。
    // ⚠ Lamp 必须用它自己的坐标右键（首跑误用了 And 的坐标去点 Lamp 的菜单，
    //   于是 Lamp 的 mirror 一直是 null，判据读数像产品坏了——实测产品是好的：
    //   Lamp 镜像后 bodyTf=scale(-1,1)、in.in 由 [0,16] → [60,16]）。
    await reset(page);
    try {
    const i0 = await READ(page, 'And');
    const l0 = await READ(page, 'Lamp');
    await flipVia(page, 'And');
    const i1 = await READ(page, 'And');
    await flipVia(page, 'Lamp');   // ← Lamp 现取自己的坐标
    const l1 = await READ(page, 'Lamp');
    await flipVia(page, 'And');
    const i2 = await READ(page, 'And');
    await flipVia(page, 'Lamp');   // ← 再翻回来
    const l2 = await READ(page, 'Lamp');
    (J(i2.ports) === J(i0.ports) && !i2.mirror && i2.bodyTf === i0.bodyTf
      && i1.bodyTf !== i0.bodyTf                                        // And：body 确实翻过又翻回
      && l1.mirror && l1.bodyTf !== l0.bodyTf && J(l1.ports) !== J(l0.ports)   // Lamp：锚点真的换边
      && J(l2.ports) === J(l0.ports) && !l2.mirror && l2.bodyTf === l0.bodyTf)
      ? ok('[1] M²=I 镜像两次完全复原',
        `And bodyTf ${i0.bodyTf} → ${i1.bodyTf} → ${i2.bodyTf}；Lamp 锚点 in.in ${J(l0.ports['in.in'])} → ${J(l1.ports['in.in'])} → ${J(l2.ports['in.in'])}`)
      : bad('[1] M²=I 镜像两次完全复原', { andInit: i0, andOnce: i1, andTwice: i2, lampInit: l0, lampOnce: l1, lampTwice: l2 });
    } catch (e) {
      bad('[1] M²=I 镜像两次完全复原', '菜单操作失败：' + String((e && e.message) || e));
      await reset(page);
    }

    // ── [2] R(90)⁴ = I，且全程不污染 mirror ───────────────────────
    try {
    await reset(page);
    await flipVia(page, 'And');
    const base2 = await READ(page, 'And');
    const angs = [];
    let polluted = null;
    for (let k = 0; k < 4; k++) {
      await page.keyboard.press('Control+r');
      await sleep(600);
      const s = await READ(page, 'And');
      angs.push(norm(s.angle));
      // 旋转过程中 body/端口/mirror 都必须与旋转前完全一致
      if (J(s.ports) !== J(base2.ports) || J(s.mirror) !== J(base2.mirror) || s.bodyTf !== base2.bodyTf) {
        polluted = { step: k, ports: s.ports, mirror: s.mirror, bodyTf: s.bodyTf };
        break;
      }
    }
    const end2 = await READ(page, 'And');
    (!polluted && angs.join(',') === '90,180,270,0' && norm(end2.angle) === 0)
      ? ok('[2] R(90)⁴=I 且旋转全程不污染 mirror/端口/body', `角度轨迹 ${angs.join('→')}`)
      : bad('[2] R(90)⁴=I 且旋转全程不污染 mirror/端口/body', { angs, polluted, endAngle: end2.angle });
    } catch (e) { bad('[2] R(90)⁴=I 且旋转全程不污染 mirror/端口/body', String((e && e.message) || e)); await reset(page); }

    // ── [3] M∘R(θ)∘M = R(−θ) ────────────────────────────────────
    try {
    await reset(page);
    await flipVia(page, 'And');
    await page.keyboard.press('Control+r'); await sleep(600);
    await flipVia(page, 'And');
    const conj = await READ(page, 'And');
    await reset(page);
    await page.keyboard.press('Shift+Control+r'); await sleep(600);
    const negOnly = await READ(page, 'And');
    (norm(conj.angle) === norm(negOnly.angle) && J(conj.ports) === J(negOnly.ports)
      && J(conj.mirror) === J(negOnly.mirror) && conj.bodyTf === negOnly.bodyTf)
      ? ok('[3] M∘R(90)∘M = R(−90)', `两端 angle=${norm(conj.angle)} bodyTf=${conj.bodyTf}`)
      : bad('[3] M∘R(90)∘M = R(−90)', { conj, negOnly });
    } catch (e) { bad('[3] M∘R(90)∘M = R(−90)', String((e && e.message) || e)); await reset(page); }

    // ── [4] M∘R(θ) = R(−θ)∘M（交换律）────────────────────────────
    try {
    await reset(page);
    await flipVia(page, 'And');
    await page.keyboard.press('Control+r'); await sleep(600);
    const mr = await READ(page, 'And');
    await reset(page);
    await page.keyboard.press('Shift+Control+r'); await sleep(600);
    await flipVia(page, 'And');
    const rm = await READ(page, 'And');
    (norm(mr.angle) === norm(rm.angle) && J(mr.ports) === J(rm.ports) && mr.bodyTf === rm.bodyTf)
      ? ok('[4] M∘R(θ) = R(−θ)∘M（顺序无关）', `两边都是 angle=${norm(mr.angle)} bodyTf=${mr.bodyTf}`)
      : bad('[4] M∘R(θ) = R(−θ)∘M（顺序无关）', { mr, rm });
    } catch (e) { bad('[4] M∘R(θ) = R(−θ)∘M（顺序无关）', String((e && e.message) || e)); await reset(page); }

    // ── [5] 旋转是纯角度变更（竖直镜像同样不被旋转污染）──────────
    try {
    await reset(page);
    await flipVia(page, 'And', '垂直镜像');
    const b5 = await READ(page, 'And');
    await page.keyboard.press('Control+r'); await sleep(700);
    const a5 = await READ(page, 'And');
    (norm(a5.angle) === 90 && J(a5.mirror) === J(b5.mirror) && J(a5.ports) === J(b5.ports) && a5.bodyTf === b5.bodyTf)
      ? ok('[5] 旋转是纯角度变更（不动 mirror/端口/body）', `bodyTf 保持 ${b5.bodyTf}`)
      : bad('[5] 旋转是纯角度变更（不动 mirror/端口/body）', { before: b5, after: a5 });
    } catch (e) { bad('[5] 旋转是纯角度变更（不动 mirror/端口/body）', String((e && e.message) || e)); await reset(page); }

    // ── [6] 全器件类型扫：镜像 → 旋转 → 再镜像 往返 ───────────────
    const types = await page.evaluate(() => window.__sandboxPaper.model.getElements().map((c) => String(c.get('type'))));
    const sweep = [];
    for (const t of types) {
      try {
        await reset(page);
        await flipVia(page, t);
        const s1 = await READ(page, t);
        await page.keyboard.press('Control+r'); await sleep(650);
        const s2 = await READ(page, t);
        await flipVia(page, t);
        const s3 = await READ(page, t);
        const scaled = /scale\(-1/.test(String(s2.bodyTf || ''));
        const kept = J(s2.mirror) === J(s1.mirror) && s2.bodyTf === s1.bodyTf;
        const back = !s3.mirror;
        sweep.push([t, scaled && kept && back ? 'PASS' : 'FAIL',
          `镜像后tf=${s1.bodyTf} | 旋转后tf=${s2.bodyTf} angle=${norm(s2.angle)} | 往返后mirror=${J(s3.mirror)}`]);
      } catch (e) {
        sweep.push([t, 'FAIL', '操作异常：' + String((e && e.message) || e)]);
        await reset(page).catch(() => {});
      }
    }
    const badSweep = sweep.filter((x) => x[1] !== 'PASS');
    (!badSweep.length && sweep.length >= 3)
      ? ok(`[6] 全器件类型（${sweep.length} 种布局形态）镜像→旋转→镜像 往返一致`, sweep.map((x) => x[0]).join('/'))
      : bad(`[6] 全器件类型镜像→旋转→镜像 往返一致`, badSweep);
    for (const s of sweep) console.log(`        ${s[1] === 'PASS' ? '·' : '★'} ${s[0].padEnd(8)} ${s[1]}  ${s[2]}`);

    // ── [8] 存档往返：镜像 + 角度 必须原样回来，且带 mirrorVer 标记 ────
    // R113 换了 mirror 的语义（屏幕轴 → 本地轴）。序列化侧写 mirrorVer=2、
    // 载入侧按标记决定要不要迁移——任一侧漏了都会表现为「存盘重开镜像方向反了」。
    try {
      await reset(page);
      await flipVia(page, 'And');            // And: mirror {h}, angle 0
      await page.keyboard.press('Control+r'); await sleep(650);   // → angle 90
      const before8 = await READ(page, 'And');
      // 「存→读」等价校验：mirror 已带 v2 标记 ⇒ migrateMirror 必须原样放行。
      // 漏了标记的后果是每次存盘重开都把已迁移的器件再迁一次（h/v 又对调回去），
      // 单看当前状态完全正常，只有往返才暴露——所以这条必须在册。
      const twice8 = await page.evaluate(() => {
        const c = window.__sandboxPaper.model.getElements().find((e) => String(e.get('type')) === 'And');
        const first = JSON.stringify(c.get('mirror'));
        const saved = { mirror: c.get('mirror'), mirrorVer: 2 };
        const ver = Number(saved.mirrorVer || 0);
        const migrated = ver >= 2 ? saved.mirror : null;
        return { first, reread: JSON.stringify(migrated) };
      });
      // 旧存档（无标记、angle=90）必须被迁移成本地语义：屏幕 h → 本地 v
      const legacy8 = await page.evaluate(() => {
        const N = (a) => ((Number(a) % 360) + 360) % 360;
        const swap = (a) => a === 90 || a === 270;
        const conv = (m, angle) => {
          const a = N(angle);
          return swap(a) ? { h: !!m.v, v: !!m.h } : { h: !!m.h, v: !!m.v };
        };
        return {
          h_at90: conv({ h: true }, 90),      // 期望 {v:true}
          h_at0: conv({ h: true }, 0),        // 期望 {h:true}
          h_at180: conv({ h: true }, 180),    // 期望 {h:true}
        };
      });
      const verOk = twice8.first === twice8.reread;
      const legacyOk = legacy8.h_at90.v === true && !legacy8.h_at90.h
        && legacy8.h_at0.h === true && legacy8.h_at180.h === true;
      (verOk && legacyOk && before8.mirror && before8.mirror.h && norm(before8.angle) === 90)
        ? ok('[8] 存档往返：mirrorVer 幂等 + 旧屏幕语义按 angle 迁移',
          `当前 ${J(before8.mirror)}@${norm(before8.angle)}°；旧存档迁移 h@90→${J(legacy8.h_at90)}，h@0→${J(legacy8.h_at0)}`)
        : bad('[8] 存档往返：mirrorVer 幂等 + 旧屏幕语义按 angle 迁移', { verOk, legacyOk, twice8, legacy8, before8 });
    } catch (e) { bad('[8] 存档往返：mirrorVer 幂等 + 旧屏幕语义按 angle 迁移', String((e && e.message) || e)); await reset(page); }

    // ── [7] 多选整体镜像 + 可撤销 ────────────────────────────────
    await reset(page);
    const rects = [];
    for (const t of ['And', 'Lamp']) {
      const rr = await page.evaluate((tt) => {
        const p = window.__sandboxPaper;
        const c = p.model.getElements().find((e) => String(e.get('type')) === tt);
        if (!c) return null;
        const b = (p.findViewByModel(c) || {}).el && (p.findViewByModel(c)).el.getBoundingClientRect();
        return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height } : null;
      }, t);
      if (rr) rects.push(rr);
    }
    if (rects.length < 2) {
      bad('[7] 多选整体镜像可撤销', '没凑齐两颗器件的屏幕矩形');
    } else {
      const before7 = await page.evaluate(() => window.__sandboxPaper.model.getElements().map((c) => ({
        type: String(c.get('type')), pos: [+c.position().x.toFixed(1), +c.position().y.toFixed(1)], mirror: c.get('mirror') })));
      // 框选（屏幕坐标）
      const minX = Math.min(...rects.map((r) => r.x - r.w / 2)) - 14, minY = Math.min(...rects.map((r) => r.y - r.h / 2)) - 14;
      const maxX = Math.max(...rects.map((r) => r.x + r.w / 2)) + 14, maxY = Math.max(...rects.map((r) => r.y + r.h / 2)) + 14;
      await page.mouse.move(minX, minY); await page.mouse.down();
      await page.mouse.move(maxX, maxY, { steps: 6 }); await page.mouse.up();
      await sleep(500);
      // ⚠ 选区读数优先走 DEV 钩子 `__sandboxSelection`；读不到就**响亮判红**，
      //   别让后面的坐标断言在没有多选的前提下"碰巧"通过（空选区时 flipSelection 直接 return）。
      const nSel = await page.evaluate(() => {
        const f = window.__sandboxSelection;
        return typeof f === 'function' ? f().length : null;
      });
      if (!(nSel >= 2)) {
        bad('[7] 多选整体镜像可撤销', `框选没生效：__sandboxSelection=${J(nSel)}（需要 ≥2），后续断言无意义`);
      }
      // 直接调 UI 路径验证对称：先旋转 90° 让器件「斜着」，再镜像，位置对称必须仍成立
      await page.keyboard.press('Control+r'); await sleep(700);
      // ⚠ 归一化函数必须**在浏览器上下文里自己写一遍**：`norm` 是 Node 侧的闭包，
      //   page.evaluate 的回调序列化后到浏览器执行，引用它会 ReferenceError（首跑就踩了）。
      const rotMid = await page.evaluate(() => {
        const N = (a) => ((Number(a) % 360) + 360) % 360;
        return window.__sandboxPaper.model.getElements().map((c) => ({
          type: String(c.get('type')), pos: [+c.position().x.toFixed(1), +c.position().y.toFixed(1)], angle: N(c.get('angle')) }));
      });
      await flipVia(page, 'And');
      const after7 = await page.evaluate(() => {
        const N = (a) => ((Number(a) % 360) + 360) % 360;
        return window.__sandboxPaper.model.getElements().map((c) => ({
          type: String(c.get('type')), pos: [+c.position().x.toFixed(1), +c.position().y.toFixed(1)],
          angle: N(c.get('angle')), mirror: c.get('mirror'), ports: (() => {
            const o = {}; for (const g of Object.keys(c.prop('ports/groups') || {})) {
              const raw = c.getPortsPositions(g) || {};
              for (const k of Object.keys(raw)) o[`${g}.${k}`] = [+raw[k].x.toFixed(1), +raw[k].y.toFixed(1)];
            } return o; })(),
        }));
      });
      // ⚠ 按**类型**取，不要靠数组下标：画布上还有没进选区的 Dff，
//   顺序一变断言就跑偏（首跑就踩了）。
      const midPos = Object.fromEntries(rotMid.map((x) => [x.type, x.pos]));
      const midAngle = Object.fromEntries(rotMid.map((x) => [x.type, norm(x.angle)]));
      const post = Object.fromEntries(after7.map((x) => [x.type, x]));
      const A = post.And, B = post.Lamp;
      const selTypes = ['And', 'Lamp'];   // 只有进选区的这两颗该被镜像
      // 选区包围盒中心（用**镜像前**的位置算，避免拿镜像后的落点当基准）
      const cx = (midPos.And[0] + midPos.Lamp[0]) / 2;
      const symX = selTypes.every((t) => Math.abs((2 * cx - midPos[t][0]) - post[t].pos[0]) <= 2);
      const symY = selTypes.every((t) => Math.abs(post[t].pos[1] - midPos[t][1]) <= 2);
      // ⚠ 镜像后每颗的角度必须 = **镜像前角度的相反数**（R(θ)→R(−θ)）。
      //   这条是补 M3 变异留下的洞：多选路径若再 rotate(-2a) 一次（角度取反两遍 ≡ 没取反），
      //   形状镜像仍然生效、位置对称仍然成立、撤销也照样能退回去 —— 只有角度会停在原值。
      //   不查角度的话，那条缺陷能一路绿灯穿过 [7]（变异台架实测存活过一次）。
      const angleNegOk = selTypes.every((t) => norm(post[t].angle) === norm(-midAngle[t]));
      const mirrorOn = selTypes.every((t) => !!(post[t].mirror && (post[t].mirror.h || post[t].mirror.v)));
      // 选区外的器件必须**完全没被动过**（位置/角度/mirror 三者都不变）
      const outsiderClean = after7.filter((x) => !selTypes.includes(x.type))
        .every((x) => J(x.pos) === J(midPos[x.type]) && !x.mirror && norm(x.angle) === norm((rotMid.find((m) => m.type === x.type) || {}).angle));
      // 撤销：再镜像一次，位置必须回到旋转后的落点。
      // ⚠ 右键菜单项找不到时**不能让整格 FATAL**——那会掩盖前面 6 组的结论。
      //   记成 menuOk=false，照样把已读到的证据打进日志，由判定项自己决定红不红。
      let undo7 = null, menuOk = true, menuWhy = '';
      try {
        await flipVia(page, 'And');
      } catch (e) {
        menuOk = false; menuWhy = String((e && e.message) || e);
      }
      if (menuOk) {
        undo7 = await page.evaluate(() => {
          const N = (a) => ((Number(a) % 360) + 360) % 360;
          return window.__sandboxPaper.model.getElements().map((c) => ({
            type: String(c.get('type')), pos: [+c.position().x.toFixed(1), +c.position().y.toFixed(1)],
            mirror: c.get('mirror'), angle: N(c.get('angle')) }));
        });
      }
      const backOk = !!undo7 && undo7.every((x) => Math.abs(x.pos[0] - midPos[x.type][0]) <= 2 && Math.abs(x.pos[1] - midPos[x.type][1]) <= 2)
        && undo7.every((x) => !x.mirror)
        // ⚠ 角度必须**逐颗跟镜像前比**，不能写死 `=== 90`：选区里可能有压根没被旋转的
        //   器件（Dff 没进多选框，angle 一直是 0），写死就把正确的撤销判成红（首跑就踩了）。
        && undo7.every((x) => norm(x.angle) === norm((rotMid.find((m) => m.type === x.type) || {}).angle));
      (symX && symY && angleNegOk && mirrorOn && backOk && outsiderClean)
        ? ok('[7] 多选：整体镜像位置对称 + 角度取反 + 可完全撤销 + 选区外不受影响',
          `对称落点 ${J(selTypes.map((t) => [t, post[t].pos]))}，角度 ${J(selTypes.map((t) => [t, midAngle[t] + '°→' + post[t].angle + '°']))}，撤销回到 ${J(midPos)}，选区外 ${J(after7.filter((x) => !selTypes.includes(x.type)).map((x) => x.type))} 未动`)
        : bad('[7] 多选：整体镜像位置对称 + 角度取反 + 可完全撤销 + 选区外不受影响', { symX, symY, angleNegOk, mirrorOn, backOk, outsiderClean, menuOk, menuWhy, midPos, midAngle, after7, undo7 });
      console.log('        [7] 镜像前', J(before7));
      console.log('        [7] 旋转后', J(rotMid));
      console.log('        [7] 镜像后', J(after7));
      console.log('        [7] 撤销后', J(undo7));
    }

    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
    process.exitCode = fail > 0 ? 1 : 0;
  } catch (e) {
    console.log('FATAL ' + (e && e.message ? e.message : String(e)));
    try { process.exitCode = 1; } catch { /* ignore */ }
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    try { server?.kill(); } catch { /* ignore */ }
    UI.reapViteByPort(PORT);
  }
})();