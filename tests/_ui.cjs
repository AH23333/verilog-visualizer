// 沙盒 UI 的共用夹具（给 tests/ 下的闸门用）。
//
// 为什么要单独一份：沙盒左侧「部件库」是**可折叠分组**，默认只展开「逻辑门」
// （SandboxCanvas.tsx:566）。老闸门用 `document.querySelector('button[data-gate=..]')?.click()`
// 放器件 —— 分组没展开时选择器为空，可选链直接**静默什么都不做**，于是
// 「cells=0 → 导出全白 → 判成产品坏了」（r7 / r11-r14 / r17 / r18 实测就是这个）。
// 这里的规则：① 展开必须有显式动作；② 点不到就**响亮地失败**，不许静默跳过。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/** 展开所有折叠的分组（点 div[title="展开分组"] 那一层，循环到没有为止） */
async function expandAllGroups(page) {
  const mounted = await page.locator('button[data-gate]').count();
  if (!mounted) throw new Error('expandAllGroups: 元件库根本没挂载（先 ensurePalette）');
  const heads = await page.locator('div[title="展开分组"], div[title="收起分组"]').count();
  if (!heads) throw new Error('expandAllGroups: 找不到分组标题，元件库形状与夹具假设不符');
  for (let i = 0; i < 16; i++) {
    const n = await page.evaluate(() => {
      const closed = [...document.querySelectorAll('div[title="展开分组"]')];
      if (!closed.length) return 0;
      closed[0].click();
      return closed.length;
    });
    if (!n) return;
    await sleep(120);
  }
  throw new Error('expandAllGroups: 分组展开没收敛');
}

/** 保证「部件」面板开着且所有分组已展开（沙盒左栏停在哪个面板由进入前的语境决定） */
async function ensurePalette(page) {
  // ⚠ **必须等，不能只 count()**：vite 冷启动时首次请求要现场 transform 一堆依赖，
  //   React 挂载活动栏会比 boot 的 800ms settle 更晚。原实现 count() 拿不到就直接抛
  //   「活动栏没有『部件』按钮」，把一次**启动慢**报成产品缺陷（r113 复跑踩了整整一次）。
  //   诊断信息带上真实可见的 data-activity 列表，一眼能分清「慢」还是「真没有」。
  const modules = page.locator('button[data-activity="modules"]').first();
  try {
    await modules.waitFor({ timeout: 15000 });
  } catch {
    const seen = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button[data-activity]')).map((b) => b.getAttribute('data-activity')).join(',') || '(空)');
    throw new Error(`ensurePalette: 等不到活动栏「部件」按钮；当前可见的 data-activity = [${seen}]`);
  }
  if (!(await page.locator('button[data-gate]').count())) {
    await modules.click();
    await page.waitForFunction(() => document.querySelectorAll('button[data-gate]').length > 0, null, { timeout: 10000 });
  }
  await expandAllGroups(page);
}

/** 进沙盒：稳定锚点 → 没有 .djs 就建一个 → 等 paper 真出现（不用固定 sleep 赌时机） */
async function enterSandbox(page) {
  await page.locator('button[data-activity="sandbox"]').click();
  await sleep(500);
  // 实测（r54 诊断）：沙盒里没有任何电路文件时画布 paper 根本不会创建 ——
  // 「暂无文件（右键空白处新建）」是空态，工具栏那颗「新建文件」就是入口。
  if (!(await page.evaluate(() => !!window.__sandboxPaper))) {
    // R102：沙盒「新建文件」＝弹 PromptDialog 让你起名（与编译模式一致），不填弹窗
    // 遮罩不关 ⇒ paper 永远不出现。统一走 newSandboxFile。
    await newSandboxFile(page);
  }
  await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 20000 });
  await sleep(400);
  await ensurePalette(page);
}

/**
 * 在沙盒里建一个画布文件（老闸门的 boot/reset 都用它）。
 *
 * ⚠ 别直接点 `button[title="新建文件"]`：那颗标题在**编译视图的文件面板上也有**，
 * 而编译侧点下去弹的是「文件名（允许 subdir/my_module.v）」对话框（r63 实测），
 * 对话框不填就不会关掉 —— 于是 `window.__sandboxPaper` 永远是 undefined，
 * 老闸门统一报 `Cannot read properties of undefined (reading 'model')`，
 * 后面的格子还会被那层 `fixed inset-0` 遮罩挡住点击。
 */
async function newSandboxFile(page, name) {
  // R102：先确保**沙盒视图已挂载**（等侧栏出来）。之前只在 `!paper` 时点一下活动栏，
  // 视图切换是异步的，接着就 DOM click 会打在还没换完的页面上 ⇒ 弹窗不出现。
  if (!(await page.evaluate(() => !!document.querySelector('[data-sandbox-sidebar]')))) {
    const sb = page.locator('button[data-activity="sandbox"]').first();
    try {
      await sb.waitFor({ timeout: 15000 });
    } catch {
      const seen = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button[data-activity]')).map((b) => b.getAttribute('data-activity')).join(',') || '(空)');
      throw new Error(`newSandboxFile: 等不到活动栏「沙盒」按钮；当前可见的 data-activity = [${seen}]`);
    }
    await sb.click();
    await page.waitForSelector('[data-sandbox-sidebar]', { timeout: 10000 });
    await sleep(400);
  }
  // ⚠ R102 两个要点：
  //  ① 用 **DOM click**（b.click()）而不是 Playwright 的坐标点击——后者在沙盒里会命中
  //     别的同名按钮，弹出**编译侧**的「新建文件」对话框（label 是"文件名（允许 subdir/…）"），
  //     填了名也不建 .djs，paper 永远不出现（实测 r12/r33 就是这么红的）。
  //  ② 弹窗用沙盒专用锚点 `[data-fs-dialog]` 定位，别用全局 [role="dialog"]。
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button[title="新建文件"]'))[0];
    if (b) b.click();
  });
  const fileName = name || `gate_${Date.now().toString(36)}`;
  const dlgInput = page.locator('[data-fs-dialog] input').first();
  await dlgInput.waitFor({ timeout: 8000 });
  await dlgInput.click();
  await page.keyboard.press('ControlOrMeta+a'); await sleep(60);
  await page.keyboard.type(fileName); await sleep(100);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 20000 });
  await sleep(400);
}

/**
 * ⚠ 画布上的器件**不能用 `[data-type="X"]` 去找**：src 里根本没有这个属性（grep 全仓 0 处），
 * 那是早期渲染器留下的锚点。用它查会静默拿到 null —— 老闸门里 r14/r19 就有整条判据因此永远够不着，
 * "绿"是空的、"红"是假的。以下三颗一律从 paper 的模型出发，再回到那颗视图的 DOM。
 */
async function cellRect(page, type, hook = '__sandboxPaper') {
  return page.evaluate((a) => {
    const p = window[a.h];
    if (!p) return null;
    const c = p.model.getElements().find((e) => String(e.get('type')) === a.t);
    if (!c) return null;
    const el = (p.findViewByModel(c) || {}).el;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { id: c.id, x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
  }, { t: type, h: hook });
}

/** 读某颗器件盒体的 fill（指示灯亮不亮这类判据用）；拿不到器件返回 null，够不着就判红，别空过 */
async function cellFill(page, type, hook = '__sandboxPaper') {
  return page.evaluate((a) => {
    const p = window[a.h];
    const c = p && p.model.getElements().find((e) => String(e.get('type')) === a.t);
    if (!c) return null;
    const el = (p.findViewByModel(c) || {}).el;
    if (!el) return null;
    const node = el.querySelector('circle') || el.querySelector('rect') || el.querySelector('.body');
    return node ? String(node.getAttribute('fill') || '') : '';
  }, { t: type, h: hook });
}

/** 把某张 paper 上所有器件的"数据层类型 + 渲染盒体尺寸"一次性拿回来（替换 .joint-cell + data-type 那种走法） */
async function cellBoxes(page, hook = '__innerPaper') {
  return page.evaluate((h) => {
    const p = window[h];
    if (!p) return [];
    const out = [];
    for (const e of p.model.getElements()) {
      const el = (p.findViewByModel(e) || {}).el;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) continue;
      const bEl = el.querySelector('.body') || el.querySelector('rect');
      const br = bEl ? bEl.getBoundingClientRect() : null;
      out.push({ dt: String(e.get('type')), id: e.id, w: Math.round(r.width), h: Math.round(r.height),
        ratio: +(r.width / r.height).toFixed(2),
        bw: br ? Math.round(br.width) : -1, bh: br ? Math.round(br.height) : -1,
        bratio: br ? +(br.width / br.height).toFixed(2) : -1 });
    }
    return out;
  }, hook);
}

/**
 * reload 之后回沙盒并**等画布真重建**（activeFile 会重新打开，但不是同步的）。
 * 老闸门里所有 `Cannot read properties of undefined (reading 'model')` 都是这个时机差：
 * reload 把视图打回编译侧，__sandboxPaper 还没重建就被读。拿不到就返回 false，让调用方抛错，
 * 不要拿 null 继续算成"器件不见了"。
 */
async function backToSandbox(page) {
  const sb = page.locator('button[data-activity="sandbox"]');
  if (await sb.count()) {
    // 短超时 + 吞掉点击失败：这颗粒可能正被首启引导遮罩盖住（调用方下一步通常自己会点 Skip）
    try { await sb.first().click({ timeout: 2500 }); } catch { /* 遮罩还没撤 */ }
    await sleep(600);
  }
  if (await page.evaluate(() => !!window.__sandboxPaper)) return true;
  // 没有任何 .djs 文件 ⇒ 等再久也不会有 paper：立刻返回 false，别把 25 s 耗在等待上
  const rows = await page.locator('span').filter({ hasText: /\.djs$/ }).count();
  if (!rows) return false;
  try { await page.locator('span').filter({ hasText: /\.djs$/ }).first().click({ timeout: 5000 }); await sleep(800); }
  catch { /* 点不到就下面用 paper 的有无说话 */ }
  try { await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 12000 }); return true; }
  catch { return false; }
}

/** 点元件库按钮放器件：点不到就抛错，绝不静默 */
async function clickGate(page, type, { tries = 2 } = {}) {
  const sel = `button[data-gate="${type}"]`;
  for (let k = 0; k < tries; k++) {
    const loc = page.locator(sel);
    if (await loc.count()) {
      await loc.first().click();
      await sleep(350);
      return true;
    }
    await ensurePalette(page);
    await sleep(200);
  }
  throw new Error(`clickGate: 元件库里没有 "${type}"（展开分组后仍找不到）`);
}

/** 等画布上出现带 Magnet 的端口（器件真渲染出来了） */
async function waitForPorts(page, min = 2, timeout = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const n = await page.evaluate(() => [...document.querySelectorAll('[magnet]')]
      .filter((m) => m.getAttribute('magnet') !== 'false').length);
    if (n >= min) return n;
    await sleep(200);
  }
  throw new Error(`waitForPorts: ${timeout}ms 内端口数仍 < ${min}`);
}

/** 画布上可连的端口中心（client 坐标） */
async function portPoints(page) {
  return page.evaluate(() => {
    const ms = [...document.querySelectorAll('[magnet]')].filter((m) => m.getAttribute('magnet') !== 'false');
    return ms.map((m) => {
      const r = m.getBoundingClientRect();
      const pb = m.closest('.joint-port-body');
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, port: pb ? pb.getAttribute('port') : m.getAttribute('port') };
    });
  });
}

/** 从一个端口拖到另一个端口（真鼠标轨迹） */
async function dragWire(page, fromPort, toPort) {
  const pts = await portPoints(page);
  const a = pts.find((p) => p.port === fromPort);
  const b = pts.find((p) => p.port === toPort);
  if (!a || !b) throw new Error(`dragWire: 找不到端口 ${fromPort} / ${toPort}（现有 ${pts.map((p) => p.port).join(',')}）`);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(150);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await sleep(80);
  await page.mouse.move(b.x, b.y, { steps: 6 }); await sleep(250);
  await page.mouse.up(); await sleep(400);
  return true;
}

/**
 * 打开画布右键菜单并点一项（菜单锚点是 ContextMenu 根节点的 data-context-menu）。
 *
 * ⚠ R113 实测踩了三个坑，这里逐个堵：
 *   ① 右键打在器件中心**不一定**能开菜单——Lamp 这类 body 是 <rect> 的器件，
 *      中心可能落在 <circle> led / <text> 上，冒泡被截断，右键静默无效。
 *   ② 上一次菜单**可能还开着**：此时 `item.count()` 直接命中旧菜单，点下去作用在
 *      错误的上下文上（比点不开更坏——它会伪装成成功）。⇒ 每次先 Escape 关干净。
 *   ③ 右键后菜单是异步渲染的，必须**等它真的出现**再点，不能只 sleep 赌时机。
 */
async function menuClick(page, label, at = null) {
  const item = page.locator(`[data-context-menu] button:has-text("${label}")`).first();
  const menuOpen = () => page.locator('[data-context-menu]').count();
  // ⚠ **`at === null` 表示「菜单已经开着了」，只负责点那一项** —— 这是两级菜单的用法：
  //   先 `menuClick(page, '插入示例', 空白点)`（它会自己右键），菜单展开出第二级，
  //   再 `menuClick(page, '4 位二进制计数器')` 接着点。
  //   R113 之前这里无条件先 Escape，把上一级刚展开的菜单关掉了 ⇒ 第二级永远等不到
  //   （r24 就是这么红的，报 `waiting for ... '4 位二进制计数器' to be visible` 超时）。
  //   ⇒ **只有自己负责开菜单（at 非空）时才能 Escape 收尾。**
  if (at === null) {
    if (await item.count()) { await item.click(); await sleep(350); return true; }
    await item.waitFor({ timeout: 5000 });
    await item.click();
    await sleep(350);
    return true;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    // ① 先确保没有残留菜单（关掉再开，否则会点到上一轮的旧菜单）
    if (await menuOpen()) { await page.keyboard.press('Escape'); await sleep(250); }
    // ② 右键开菜单
    await page.mouse.click(at.x, at.y, { button: 'right' });
    // ③ 等菜单真的出现（最多 2.5s），等不到就重试
    try {
      await page.waitForFunction(
        () => !!document.querySelector('[data-context-menu] button'),
        null, { timeout: 2500 },
      );
    } catch { /* 这一轮没开出来，重试 */ }
    if (await item.count()) { await item.click(); await sleep(350); return true; }
    await sleep(250);
  }
  await item.waitFor({ timeout: 5000 });
  await item.click();
  await sleep(350);
  return true;
}

/**
 * 用菜单里的**内联编辑项**（渲染成「标签 + 输入框」，回车提交）填一个值。
 * 找不到菜单 / 找不到那一项就抛错——绝不静默跳过（跳过的格子读起来像通过）。
 */
async function menuSet(page, label, value, at = null) {
  if (at) { await page.mouse.click(at.x, at.y, { button: 'right' }); await sleep(400); }
  const root = page.locator('[data-context-menu]');
  if (!(await root.count())) throw new Error(`menuSet: 右键菜单没打开（要填的项是「${label}」）`);
  const row = root.locator('div').filter({ has: page.locator(`span:text-is("${label}")`) }).first();
  if (!(await row.count())) throw new Error(`menuSet: 菜单里没有内联编辑项「${label}」`);
  const input = row.locator('input').first();
  await input.fill(String(value));
  await input.press('Enter');
  await sleep(500);
}

/**
 * 找一块**真空白**的画布点（右键要落在这里才出「空白画布菜单」）。
 *
 * ⚠ 别写死坐标：波形面板一开就把窗口下沿整条盖住，器件又总是落在视口中心 ——
 * r24 拿 (1150,760) 去右键，点进的其实是波形面板，菜单根本没开（locator 等 30 s 超时）。
 * 这里按「点在哪」判定：不在遮罩/面板/菜单里，也不在任何器件上。
 */
async function blankCanvasPoint(page) {
  const pt = await page.evaluate(() => {
    const wrap = document.querySelector('[data-sandbox-wrapper]');
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    for (const [fy, fx] of [[.25, .9], [.5, .92], [.78, .88], [.12, .85], [.5, .06], [.9, .3], [.25, .35]]) {
      const px = Math.round(r.left + r.width * fx), py = Math.round(r.top + r.height * fy);
      const el = document.elementFromPoint(px, py);
      if (!el || !wrap.contains(el)) continue;
      if (el.closest('[data-bus-width-dialog],[data-waveform-channels],[data-context-menu],[data-sandbox-toast]')) continue;
      if (el.closest('.joint-cell,[model-id]')) continue;
      return { x: px, y: py };
    }
    return null;
  });
  if (!pt) throw new Error('blankCanvasPoint: 画布里找不到一个既不被面板/遮罩占住、也不压在器件上的点');
  return pt;
}

/**
 * 处理总线转换器「位宽方案」遮罩。
 *
 * 放合线器/分线器**一定**会弹它（SandboxCanvas.tsx:925 刻意如此：一放下就问方案）。
 * 那是一颗 `position:fixed; inset:0` 的遮罩，不处理掉，后面每一次点击都被它拦住
 * （r22 [2] 就卡在这儿：`<div data-bus-width-dialog> … intercepts pointer events`）。
 */
async function busDialog(page, { total, groupWidth, apply = true } = {}) {
  const root = page.locator('[data-bus-width-dialog]');
  if (!(await root.count())) return false;
  if (total != null) { await root.locator(`button:text-is("${total} 位")`).first().click(); await sleep(150); }
  if (groupWidth != null) {
    const n = Math.floor(Number(total ?? 8) / Number(groupWidth));
    await root.locator(`button:text-is("${groupWidth} 位 ×${n}")`).first().click(); await sleep(150);
  }
  await root.locator(apply ? 'button:text-is("应用")' : 'button:text-is("取消")').first().click();
  await sleep(400);
  return true;
}

/**
 * 打开设置面板 → 「沙盒」那一页 → 把某一行开关拨到 `want`。
 *
 * ⚠ 为什么只许一份实现：qc-audit 与 qc-audit2 各写了一份"找那颗开关"的代码，
 * 一份按 `button[title=已开启]` **往上数 4 层父元素**看哪层含行标签 —— 而设置页的
 * 容器祖先本来就含全部文字，于是它选中了**别的**那一行：`snapToGrid` 从来没被拨动，
 * 另一份（按行标签的兄弟节点找按钮）才是对的。同一个动作两份代码飘掉一份，就是这条。
 * 定位走"行标签 → 同一行的按钮"，点完由调用方**自己回读真值**（localStorage）确认。
 */
async function setSandboxToggle(page, labelText, want) {
  const opened = await page.evaluate(() => {
    const b = document.querySelector('button[data-sandbox-settings]');
    if (!b) return false; b.click(); return true;
  });
  if (!opened) throw new Error('setSandboxToggle: 沙盒工具条上没有「打开设置面板」那颗');
  await sleep(700);
  const onTab = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => String(x.textContent || '').trim() === '沙盒');
    if (!b) return false; b.click(); return true;
  });
  if (!onTab) throw new Error('setSandboxToggle: 设置面板里没有「沙盒」这一页');
  await sleep(400);
  const res = await page.evaluate(({ label, want }) => {
    // 行标签 = 没有子元素、文本恰好等于行名的那个 div（Row 的第一格）
    const leaf = Array.from(document.querySelectorAll('div'))
      .find((d) => d.children.length === 0 && String(d.textContent || '').trim() === label);
    if (!leaf) return { found: false };
    const btn = (leaf.parentElement && leaf.parentElement.nextElementSibling
      ? leaf.parentElement.nextElementSibling.querySelector('button') : null)
      || (leaf.parentElement ? leaf.parentElement.querySelector('button') : null);
    if (!btn) return { found: true, clicked: false, why: '那一行旁边没有按钮（Row 形状变了）' };
    const on = btn.getAttribute('title') === '已开启';
    if (on !== want) { btn.click(); return { found: true, clicked: true, from: btn.getAttribute('title') }; }
    return { found: true, clicked: false, why: `已经是${want ? '开' : '关'}，不用点` };
  }, { label: labelText, want });
  await sleep(500);
  await page.keyboard.press('Escape'); await sleep(400);
  return res;
}

/** 读那颗 2.8 秒就消失的沙盒提示条（读不到返回 null，让调用方自己决定算不算数） */
async function toastText(page) {
  const t = page.locator('[data-sandbox-toast]');
  if (!(await t.count())) return null;
  return (await t.first().textContent()) ?? null;
}

/**
 * 打开（或重载）页面，并等到应用**真挂载**为止。
 *
 * ⚠ 这里刻意不用 `{ waitUntil: 'networkidle' }`：dev 服务器上首页要拉 37 个脚本、
 * 外加一条不会闲下来的 Vite HMR WebSocket，网络永远「不空闲」。r14 实测就是这么
 * `page.goto: Timeout 30000ms exceeded` → exit=2 一片红，红的是夹具不是产品。
 * 改成「DOM 就绪 + 等到确有界面骨架」，判定只看后者。
 */
async function boot(page, url, { reload = false, marker = 'button[data-activity]', settle = 800 } = {}) {
  if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
  else await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((sel) => !!document.querySelector(sel), marker, { timeout: 30000 });
  await sleep(settle);
}

/**
 * 让「跑 dist 的那几格」能回答一句话：**这份 dist 是谁编的**。
 *
 * qc-preview / qc-paused / qc-realuser 起的是 `vite preview`，量的是**构建产物**；
 * 源码改了而 dist 没重编，读到的就是上一版的形状（变异台架 #265「旧 dll」那一族的 JS 版）。
 * 这里比 mtime：dist 比 src / public / 配置里任何一颗旧 ⇒ 当场重 build，并把这件事打进日志。
 * 返回读到的证据串，调用方原样 console.log —— 判据不许建立在水分不明的产物上。
 */
function ensureFreshDist(root = path.resolve(__dirname, '..')) {
  const newestOf = (dirs, files = []) => {
    let t = 0, who = '';
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        const m = fs.statSync(p).mtimeMs;
        if (m > t) { t = m; who = p; }
      }
    };
    for (const d of dirs) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
    for (const f of files) { const p = path.join(root, f); if (fs.existsSync(p)) { const m = fs.statSync(p).mtimeMs; if (m > t) { t = m; who = p; } } }
    return { t, who };
  };
  const src = newestOf(['src'], ['index.html', 'vite.config.ts', 'package.json', 'public/digitaljs.js']);
  const distIdx = path.join(root, 'dist', 'index.html');
  const dist = newestOf(['dist']);
  if (!src.t) throw new Error('ensureFreshDist: 读不到 src 的 mtime');
  if (!fs.existsSync(distIdx) || dist.t < src.t) {
    const why = fs.existsSync(distIdx)
      ? `dist 最新 ${new Date(dist.t).toISOString()} < src 最新 ${new Date(src.t).toISOString()}(${path.basename(src.who)})`
      : 'dist/index.html 不存在';
    execSync('npx vite build', { cwd: root, stdio: 'ignore', timeout: 600000 });
    const after = newestOf(['dist']);
    if (after.t < src.t) throw new Error(`ensureFreshDist: 重编后 dist 仍旧（${why}）—— 不许拿它去判产品`);
    return `dist 已重编（原因：${why}）`;
  }
  return `dist 不旧于 src（dist ${new Date(dist.t).toISOString()} ≥ src ${new Date(src.t).toISOString()}）`;
}

/**
 * 「整句英文」的句式判据（V2b 的口径，闸门与静态清单**共用这一份**，别各写一遍飘掉）。
 *  ⚠ 不列禁字清单：换个词就绕过了（记忆教训）。规则只有两条：
 *   ① 含任何一个汉字就不算整句英文；② 要 ≥2 个英文单词才算"句子"（F5／SVG／PNG／文件名／单位不算）。
 *   ⇒ 副作用要说清：`Compiling...` 这种单词句**不在这一族里**，中文化时要另外记得一起改。
 */
function isEnglishSentence(t) {
  const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (/[一-鿿]/.test(s)) return false;
  return (s.match(/[A-Za-z]{2,}/g) || []).length >= 2;
}

/**
 * 把源码里 `setMessage(...)` **实参内的字符串字面量**逐个摘出来（只留句式判据命中的那些）。
 * ⚠ 不能用 `setMessage('…` 这种前缀正则：`setMessage(ok ? 'A.' : 'B.')` 一整个分支都会漏
 *   （第一版探针就这么把 50 处读成 32 处）。这里做括号平衡扫描，字符串里的括号不掺和。
 */
function setMessageLiterals(src) {
  const hits = [];
  for (let i = src.indexOf('setMessage('); i >= 0; i = src.indexOf('setMessage(', i + 1)) {
    const open = i + 'setMessage'.length;
    let d = 0, inStr = null, body = '';
    for (let j = open; j < src.length; j++) {
      const c = src[j], p = src[j - 1];
      if (inStr) { body += c; if (c === inStr && p !== '\\') inStr = null; continue; }
      if (c === "'" || c === '"' || c === '`') { inStr = c; body += c; continue; }
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) break; }
      body += c;
    }
    const LIT = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
    let m;
    while ((m = LIT.exec(body))) {
      const text = m[2].replace(/\\[nrt]/g, ' ').replace(/\s+/g, ' ').trim();
      if (isEnglishSentence(text)) hits.push({ line: src.slice(0, i + m.index).split('\n').length, text });
    }
  }
  return hits;
}

/** 端口被上一次被杀掉的跑批余留进程占着时，闸门会以各种"看不懂的失败"收场 —— 先收干净 */
/**
 * 按端口把遗留的 vite 收掉（返回收掉几个）。
 *
 * 每颗闸门自己 spawn 的 vite 是 `npx` 的孙进程：gate 里的 `server.kill()` 只杀了 shell 包装，
 * node 孙进程会一直监听到机器 OOM（R95 全量现场：r84/r85 的遗留 + 清出 6 颗）。
 * 用法（gate 文件里一行，进程退出时兜底；正常路径的 kill 仍然保留）：
 *   try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(PORT)); } catch { }
 * 唯一主人＝这里；run-all 的每格收尾也走这一份。
 */
function reapViteByPort(port) {
  if (!port) return 0;
  let pids = [];
  try {
    const out = require('child_process').execSync('netstat -ano', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    pids = out.split('\n').filter((l) => l.includes('LISTENING') && new RegExp(':' + port + '\\b').test(l))
      .map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x));
    pids = [...new Set(pids)];
  } catch { return 0; }
  for (const p of pids) { try { require('child_process').execSync(`taskkill /PID ${p} /F /T`, { stdio: 'ignore' }); } catch { /* 已经没了 */ } }
  return pids.length;
}

function freePort(p) {  const port = Number(p);
  if (!Number.isFinite(port)) return;
  try {
    require('child_process').execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' });
  } catch { /* 没人占就算干净 */ }
}

/**
 * 钻子部件放大镜（`a.zoom`）—— 这一族**只能"现量坐标 + 真鼠标点"**，而且必须等画面停稳。
 * 现场读数（2026-10-06，tests/.tmp-r40-settle.cjs 在同样夹具下）：
 *  - 编译成功 1.5 s 后放大镜纹丝不动（连续 12 次采样同一个坐标、同一个 DOM 节点）
 *    ⇒ "节点被反复重建"这一条不成立；
 *  - `locator.click()` 4/4 超时，Playwright 的原话是 `element is not visible`
 *    ⇒ 放大镜住在 joint 的工具层里（computed visibility 为 hidden，悬停才现形），
 *      动作性检查永远过不去 —— **别改用 locator**；
 *  - 会点空的原因是另一件事：`render:done` 之后画布还要做一次"适应窗口"，
 *    编译一就绪就量坐标，量到的是 _fit **之前**的位置（旧写法缓存 rect 再点 ⇒ 同一颗
 *    夹具两次跑出两种脸：一次 modal:false，一次连工具栏按钮都等不到）。
 * 所以这里：等坐标连着两次不变 ⇒ 现量现点 ⇒ 验目标出现，没出现就**重新量**再点。
 * @returns {{tries:number, opened:boolean, why:string[]}}
 */
async function clickZoomInto(page, { within = '', openedSelector = '[data-inner-host]', tries = 4 } = {}) {
  // openedSelector 既可以是一枚 CSS 选择器，也可以是一颗 `()=>boolean` 的判据
  // （钻取下级时"起窗"不是新元素出现，而是面包屑多了一截 —— 那种事选择器说不清）。
  const opened = typeof openedSelector === 'function'
    ? openedSelector
    : () => page.evaluate((s) => !!document.querySelector(s), openedSelector);
  const rectOf = () => page.evaluate(({ within }) => {
    const scope = within ? document.querySelector(within) : document;
    if (!scope) return null;
    for (const za of Array.from(scope.querySelectorAll(within ? 'a.zoom' : '[model-id] a.zoom'))) {
      const b = za.getBoundingClientRect();
      if (b.width > 0) return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width };
    }
    return null;
  }, { within });
  const why = [];
  for (let t = 1; t <= tries; t++) {
    let prev = null, r = null;
    for (let a = 0; a < 12; a++) {                       // 连着两次同坐标才算画面停了
      const cur = await rectOf();
      if (cur && prev && cur.x === prev.x && cur.y === prev.y) { r = cur; break; }
      prev = cur; await sleep(250);
    }
    if (!r) { why.push(`第${t}次：放大镜坐标一直没停`); continue; }
    await page.mouse.click(r.x, r.y);
    for (let a = 0; a < 12; a++) { await sleep(350); if (await opened()) break; }
    if (await opened()) return { tries: t, opened: true, why };
    why.push(`第${t}次点在 ${Math.round(r.x)},${Math.round(r.y)}（${Math.round(r.w)}px）没起窗`);
  }
  return { tries, opened: false, why };
}

/**
 * 按「哪颗器件的哪个口」取端口中心（client 坐标）。
 * @returns {{x:number,y:number}|null}  器件/端口找不到就返回 null（让调用方如实报读不到）
 */
async function portPointOf(page, { cellId, port, hook = '__sandboxPaper' }) {
  return page.evaluate((a) => {
    const paper = window[a.hook];
    if (!paper) return null;
    const c = paper.model.getCell(a.cellId);
    if (!c) return null;
    const el = (paper.findViewByModel(c) || {}).el;
    if (!el) return null;
    // 端口点必须**限定在这颗器件的 view 里**取：整张画布上 `.joint-port-body[port="out"]`
    // 会命中第一颗有 out 的器件（两颗常量必撞名）。
    const m = el.querySelector(`.joint-port-body[port="${a.port}"] [magnet], .joint-port-body[port="${a.port}"] circle, [port="${a.port}"]`);
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { cellId, port, hook });
}

/**
 * 在两颗**指定器件**的指定端口之间拖一根线（真鼠标轨迹）。
 *
 * ⚠ 别退回 `dragWire(端口名, 端口名)`：那只按端口名取第一个匹配 —— 画布上有两颗同 type
 *   的器件（两颗 Constant 都有 out、两颗 Lamp 都有 in）时线会接到另一颗上，
 *   读数看着像产品算错，其实夹具接错了（r93 探针现场）。
 * @returns {{ok:boolean, why?:string}}
 */
async function dragWireBetween(page, from, to) {
  const a = await portPointOf(page, from);
  const b = await portPointOf(page, to);
  if (!a || !b) return { ok: false, why: `端口点取不到 from=${JSON.stringify(a)} to=${JSON.stringify(b)}` };
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(150);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 }); await sleep(80);
  await page.mouse.move(b.x, b.y, { steps: 6 }); await sleep(250);
  await page.mouse.up(); await sleep(450);
  return { ok: true };
}

module.exports = { sleep, expandAllGroups, ensurePalette, boot, freePort, enterSandbox, newSandboxFile, backToSandbox,
  cellRect, cellFill, cellBoxes, clickGate, waitForPorts, portPoints, dragWire, menuClick, menuSet, toastText,
  blankCanvasPoint, busDialog, ensureFreshDist, setSandboxToggle, isEnglishSentence, setMessageLiterals,
  clickZoomInto, portPointOf, dragWireBetween, reapViteByPort };
