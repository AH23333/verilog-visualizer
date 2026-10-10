// R121 闸门：**沙盒画布注释（note）**（用户裁决 2026-10-10，全条逐项）。
//
// 用户原话要旨：
//   双击画布空白 → 唤出输入框且已处于输入态；Esc 退出编辑；有内容后可双击二次修改；
//   框内自动换行；拖边缘改比例、拖四角等比缩放；支持类似部件的旋转和镜像；
//   已旋转/镜像的注释编辑时以**正向文字**呈现，编辑完成后恢复原位置和状态；
//   注释内容在快捷展开图内也可查看，且**与部件的相对位置不可有差错**。
//
// 射程（10 格）：
//   [1] 双击空白 → Annotation cell 建立 + [data-note-edit] textarea 出现且 activeElement
//   [2] Esc 提交退出：textarea 消失、文字进模型（attrs.label/text）；撤销整步移除、重做整步带回
//   [3] 双击已有注释二次编辑：textarea 带出原文
//   [4] 自动换行：长 CJK 文本 → label 里 tspan ≥2，逐行 getComputedTextLength ≤ 盒宽-2×PAD
//   [5] 边手柄 e：宽 +Δ、高不变、锚点＝左缘（position.x 不动）
//   [6] 角手柄 se：等比（纵横比保持，取两轴更强拉伸意图）
//   [7] Ctrl+R 旋转 90°；右键「水平镜像」→ mirror.h=true（与部件同一套变换通道）
//   [8] 旋转/镜像后双击编辑：textarea（正向文字）出现、编辑期间 angle/mirror 不动、
//       Esc 后新文字生效且 angle/mirror 原样保持（「恢复用户修改的位置和状态」）
//   [9] 存盘重开：文字/尺寸/角度/镜像/位置整套回来（attrs 整包透传 + angle/mirror 在
//       DEVICE_PARAM_KEYS + loadCells applyMirror 重挂）
//   [10] 保存为自定义门（注释＋And 器件）→ 新画布放置实例 → 内部电路弹窗 __innerPaper：
//        注释叠加（renderSubcircuitView 末尾 overlayAnnotations）且与器件**绝对坐标逐位相等**
//        ——展开图 autoLayout 关（cells 自带位置）时零误差；angle/mirror 也随行。
//
// ⚠ 判据读模型与 DOM，不读 toast。⚠ 注释的镜像语义与器件刻意不同：**文字随板翻**
//   （cellMirror.syncBodyTextCounterFlip 对 Annotation 跳过字形回正，annotationCell.ts 头注 #3）。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1791;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1791)); } catch { }
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

// 注释读数：按 type 找（页面上通常只有一颗；多处时按 id）
const NOTE = (a) => {
  const paper = (window).__sandboxPaper;
  if (!paper || !paper.model) return null;
  const c = a.id ? paper.model.getCell(a.id)
    : paper.model.getElements().find((e) => String(e.get('type')) === 'Annotation');
  if (!c) return null;
  const v = paper.findViewByModel(c);
  const label = v && v.el ? v.el.querySelector('[joint-selector="label"], [data-selector="label"]') : null;
  const tspans = label ? label.querySelectorAll('tspan') : [];
  const widths = [];
  for (const t of tspans) { try { widths.push(Math.round(t.getComputedTextLength())); } catch { widths.push(-1); } }
  const handle = (d) => {
    if (!v || !v.el) return null;
    const h = v.el.querySelector(`[data-h="${d}"]`);
    if (!h) return null;
    const b = h.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, visible: b.width > 0 && b.height > 0 };
  };
  // 视觉几何（用户报"文本与文本框分离／黑体描边／拉伸不缩放"三类症状的读数口径）
  const bgEl = v && v.el ? v.el.querySelector('[joint-selector="noteBg"]') : null;
  const bodyEl = v && v.el ? v.el.querySelector('[joint-selector="body"]') : null;
  const br = bgEl ? bgEl.getBoundingClientRect() : null;
  const tr = label ? label.getBoundingClientRect() : null;
  const cs = label ? getComputedStyle(label) : null;
  const t1 = tspans[0];
  return {
    id: String(c.id), type: String(c.get('type')),
    text: String((c.attr && c.attr('label/text')) || ''),
    labelProp: String(c.get('label') ?? ''),
    size: c.get('size'), pos: c.get('position'),
    angle: Number(c.get('angle') || 0), mirror: c.get('mirror') || null,
    noteUserSized: !!c.get('noteUserSized'),
    fontScale: Number(c.get('noteFontScale') || 1),
    tspans: tspans.length, lineWidths: widths,
    ta: !!document.querySelector('[data-note-edit]'),
    taFocused: document.activeElement === document.querySelector('[data-note-edit]'),
    taValue: String((document.querySelector('[data-note-edit]') || {}).value ?? ''),
    handleE: handle('e'), handleSe: handle('se'),
    theme: document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme'),
    labelTransform: label ? (label.getAttribute('transform') || 'none') : null,
    bodyStroke: bodyEl ? (bodyEl.getAttribute('stroke') || null) : 'no-body',
    labelStroke: cs ? cs.stroke : null,
    fontWeight: cs ? cs.fontWeight : null,
    fontPx: cs ? Math.round(parseFloat(cs.fontSize) * 100) / 100 : null,
    fill: cs ? cs.fill : null,
    // 文字块相对框的内缩（左/上）与越界量（右/下为正＝超出框）
    inset: br && tr ? {
      l: Math.round(tr.x - br.x), t: Math.round(tr.y - br.y),
      overR: Math.round(tr.right - br.right), overB: Math.round(tr.bottom - br.bottom),
    } : null,
    t1x: t1 ? Number(t1.getAttribute('x')) : null,
    t1y: t1 ? Number(t1.getAttribute('y')) : null,
  };
};

const TXT1 = '第一行注释';
const TXT2 = '自动换行验证这一段注释文字足够长会折到第二行甚至第三行显示出来才行';
const TXT3 = '变换后仍可编辑';

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
    await waitPaper(page);
    const blank = await UI.blankCanvasPoint(page);
    if (!blank) { skip('[1] 双击空白创建＋输入态', 'blankCanvasPoint 找不到空白点'); skip('[2]～[9]', '前置没满足'); }
    else {
      // ---- [1] 双击空白 → 创建 + 输入态 ----
      await page.mouse.dblclick(blank.x, blank.y);
      await sleep(400);
      const s1 = await page.evaluate(NOTE, {});
      (s1 && s1.type === 'Annotation' && s1.ta && s1.taFocused)
        ? ok('[1] 双击空白 → 注释建立且 [data-note-edit] 输入框已聚焦（用户双击即可打字）',
          `id=${s1.id} ta=${s1.ta} focused=${s1.taFocused}`)
        : bad('[1] 双击空白 → 注释建立且 [data-note-edit] 输入框已聚焦（用户双击即可打字）', J(s1));

      // ---- [2] Esc 提交退出 + 文字进模型 + 撤销/重做 ----
      await page.keyboard.type(TXT1, { delay: 20 });
      await page.keyboard.press('Escape');
      await sleep(400);
      const s2 = await page.evaluate(NOTE, {});
      const committed = s2 && !s2.ta && s2.text === TXT1;
      await page.keyboard.press('Control+z');
      await sleep(400);
      const afterUndo = await page.evaluate(() => window.__sandboxPaper.model.getElements().filter((e) => e.get('type') === 'Annotation').length);
      await page.keyboard.press('Control+Shift+z');
      await sleep(400);
      const s2b = await page.evaluate(NOTE, {});
      (committed && afterUndo === 0 && s2b && s2b.text === TXT1)
        ? ok('[2] Esc 提交退出（输入框消失、文字进模型）；Ctrl+Z 整步移除、Ctrl+Shift+Z 整步带回',
          `text=${s2 && s2.text} undo后=${afterUndo} redo后=${s2b && s2b.text}`)
        : bad('[2] Esc 提交退出（输入框消失、文字进模型）；Ctrl+Z 整步移除、Ctrl+Shift+Z 整步带回',
          J({ s2: s2 && { ta: s2.ta, text: s2.text }, afterUndo, s2b: s2b && s2b.text }));

      // ---- [3] 双击二次编辑带出原文 ----
      if (!s2b || s2b.text !== TXT1) {
        skip('[3] 双击二次编辑带出原文', '前置没满足');
        skip('[4] 自动换行（tspan ≥2 且逐行不超宽）', '前置没满足');
      } else {
        const rc = await page.evaluate((a) => {
          const p = (window).__sandboxPaper;
          const c = p.model.getCell(a.id);
          const b = p.findViewByModel(c).el.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }, { id: s2b.id });
        await page.mouse.dblclick(rc.x, rc.y);
        await sleep(400);
        const s3 = await page.evaluate(NOTE, {});
        (s3 && s3.ta && s3.taValue === TXT1)
          ? ok('[3] 双击已有注释 → 二次编辑输入框带出原文', `taValue=${s3.taValue}`)
          : bad('[3] 双击已有注释 → 二次编辑输入框带出原文', J(s3 && { ta: s3.ta, taValue: s3.taValue }));

        // ---- [4] 自动换行：替换成长文本，Esc，量 tspan ----
        await page.keyboard.press('Control+a');
        await page.keyboard.type(TXT2, { delay: 10 });
        await page.keyboard.press('Escape');
        await sleep(400);
        const s4 = await page.evaluate(NOTE, {});
        const maxW = (s4.size.width || 0) - 16 + 2; // NOTE_PAD=8 两侧 + 2px 容差
        const wrapOk = s4 && s4.text === TXT2 && s4.tspans >= 2 && s4.lineWidths.every((w) => w >= 0 && w <= maxW);
        (wrapOk)
          ? ok('[4] 自动换行：长文本拆多颗 tspan，逐行宽 ≤ 盒宽-2×PAD（贪心折行，CJK 逐字断）',
            `tspans=${s4.tspans} widths=${J(s4.lineWidths)} maxW=${maxW}`)
          : bad('[4] 自动换行：长文本拆多颗 tspan，逐行宽 ≤ 盒宽-2×PAD（贪心折行，CJK 逐字断）',
            J(s4 && { text: s4.text.slice(0, 12) + '…', tspans: s4.tspans, widths: s4.lineWidths, w: s4.size.width }));
      }

      // ---- [5] 边手柄 e：宽 +Δ、高不动、锚点＝左缘 ----
      await page.mouse.click(blank.x - 60, blank.y - 60).catch(() => { });
      await sleep(300);
      let s5 = await page.evaluate(NOTE, {});
      if (s5) await page.mouse.click((await page.evaluate((a) => {
        const p = (window).__sandboxPaper;
        const b = p.findViewByModel(p.model.getCell(a.id)).el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }, { id: s5.id })).x, (await page.evaluate((a) => {
        const p = (window).__sandboxPaper;
        const b = p.findViewByModel(p.model.getCell(a.id)).el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }, { id: s5.id })).y);
      await sleep(400);
      s5 = await page.evaluate(NOTE, {});
      if (!s5 || !s5.handleE || !s5.handleE.visible) {
        skip('[5] 边手柄 e 拖拽：宽+Δ 高不变 锚点＝左缘', `手柄不可见：${J(s5 && s5.handleE)}`);
        skip('[6] 角手柄 se 等比缩放', '前置没满足');
        skip('[7] Ctrl+R 旋转 90°＋右键水平镜像', '前置没满足');
        skip('[8] 旋转/镜像后双击编辑：正向文字＋状态保持', '前置没满足');
        skip('[9] 存盘重开整套回来', '前置没满足');
        skip('[10] 部件展开图注释叠加＋相对位置零误差', '前置没满足');
      } else {
        const w0 = s5.size.width, h0 = s5.size.height, x0 = s5.pos.x;
        await page.mouse.move(s5.handleE.x, s5.handleE.y);
        await page.mouse.down();
        await page.mouse.move(s5.handleE.x + 40, s5.handleE.y, { steps: 6 });
        await page.mouse.up();
        await sleep(400);
        const s5b = await page.evaluate(NOTE, { id: s5.id });
        const eOk = s5b && Math.abs(s5b.size.width - (w0 + 40)) <= 2 && Math.abs(s5b.size.height - h0) <= 1
          && Math.abs(s5b.pos.x - x0) <= 1;
        eOk
          ? ok('[5] 边手柄 e 拖 +40px：宽精确 +40、高不变、position.x 不动（不动点＝左缘）',
            `w ${w0}→${s5b.size.width} h ${h0}→${s5b.size.height} x ${x0}→${s5b.pos.x}`)
          : bad('[5] 边手柄 e 拖 +40px：宽精确 +40、高不变、position.x 不动（不动点＝左缘）',
            J({ w0, h0, x0, got: s5b && { w: s5b.size.width, h: s5b.size.height, x: s5b.pos.x } }));

        // ---- [6] 角手柄 se：等比 ----
        const s6 = await page.evaluate(NOTE, { id: s5.id });
        const asp0 = s6.size.width / s6.size.height;
        await page.mouse.move(s6.handleSe.x, s6.handleSe.y);
        await page.mouse.down();
        await page.mouse.move(s6.handleSe.x + 30, s6.handleSe.y + 18, { steps: 6 });
        await page.mouse.up();
        await sleep(400);
        const s6b = await page.evaluate(NOTE, { id: s5.id });
        const asp1 = s6b.size.width / s6b.size.height;
        const cOk = s6b && s6b.size.width > s6.size.width && s6b.size.height > s6.size.height
          && Math.abs(asp1 - asp0) / asp0 < 0.02;
        cOk
          ? ok('[6] 角手柄 se 拖 (+30,+18)：两轴都放大且纵横比保持（等比，k 取更强轴）',
            `asp ${asp0.toFixed(3)}→${asp1.toFixed(3)} w ${s6.size.width}→${s6b.size.width} h ${s6.size.height}→${s6b.size.height}`)
          : bad('[6] 角手柄 se 拖 (+30,+18)：两轴都放大且纵横比保持（等比，k 取更强轴）',
            J({ asp0, asp1, got: s6b && s6b.size }));

        // ---- [7] Ctrl+R 旋转 90°＋右键水平镜像 ----
        await page.keyboard.press('Control+r');
        await sleep(400);
        let s7 = await page.evaluate(NOTE, { id: s5.id });
        const rotOk = s7 && s7.angle === 90;
        const rct = await page.evaluate((a) => {
          const p = (window).__sandboxPaper;
          const b = p.findViewByModel(p.model.getCell(a.id)).el.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }, { id: s5.id });
        await UI.menuClick(page, '水平镜像', rct);
        await sleep(600);
        s7 = await page.evaluate(NOTE, { id: s5.id });
        (rotOk && s7 && s7.mirror && s7.mirror.h === true && !s7.mirror.v)
          ? ok('[7] Ctrl+R → angle=90；右键「水平镜像」→ mirror.h=true（与部件同一套变换通道）',
            `angle=${s7.angle} mirror=${J(s7.mirror)}`)
          : bad('[7] Ctrl+R → angle=90；右键「水平镜像」→ mirror.h=true（与部件同一套变换通道）',
            J({ angle: s7 && s7.angle, mirror: s7 && s7.mirror }));

        // ---- [8] 旋转/镜像后编辑：正向文字 + 状态保持 ----
        const rc8 = await page.evaluate((a) => {
          const p = (window).__sandboxPaper;
          const b = p.findViewByModel(p.model.getCell(a.id)).el.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }, { id: s5.id });
        await page.mouse.dblclick(rc8.x, rc8.y);
        await sleep(400);
        const s8 = await page.evaluate(NOTE, { id: s5.id });
        await page.keyboard.press('Control+a');
        await page.keyboard.type(TXT3, { delay: 10 });
        // 编辑中途再读一次：angle/mirror 必须一动不动（编辑不碰变换）
        const s8mid = await page.evaluate(NOTE, { id: s5.id });
        await page.keyboard.press('Escape');
        await sleep(400);
        const s8b = await page.evaluate(NOTE, { id: s5.id });
        (s8 && s8.ta && s8.taValue === TXT2 && s8mid && s8mid.angle === s7.angle
          && JSON.stringify(s8mid.mirror) === JSON.stringify(s7.mirror)
          && s8b && !s8b.ta && s8b.text === TXT3 && s8b.angle === s7.angle
          && JSON.stringify(s8b.mirror) === JSON.stringify(s7.mirror))
          ? ok('[8] 旋转/镜像后双击编辑：输入框（正向文字）带出原文、编辑期间 angle/mirror 相对镜像后现态不动、Esc 后新文字生效且变换原样保持',
            `baseline angle=${s7.angle} mirror=${J(s7.mirror)}；mid angle=${s8mid.angle}；after text=${s8b.text} angle=${s8b.angle}`)
          : bad('[8] 旋转/镜像后双击编辑：输入框（正向文字）带出原文、编辑期间 angle/mirror 相对镜像后现态不动、Esc 后新文字生效且变换原样保持',
            J({ s8: s8 && { ta: s8.ta, v: s8.taValue.slice(0, 8) }, s7: s7 && { angle: s7.angle, mirror: s7.mirror }, s8mid: s8mid && { angle: s8mid.angle, mirror: s8mid.mirror }, s8b: s8b && { ta: s8b.ta, text: s8b.text, angle: s8b.angle, mirror: s8b.mirror } }));

        // ---- [9] 存盘重开整套回来 ----
        const before = await page.evaluate(NOTE, { id: s5.id });
        await page.locator('button[title*="保存"], button:has-text("保存")').first().click().catch(() => { });
        await sleep(900);
        let s9 = null; const notes9 = [];
        for (let attempt = 1; attempt <= 3 && !s9; attempt++) {
          try {
            await UI.boot(page, URL, { reload: true });
            try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
            await UI.enterSandbox(page);
            await waitPaper(page);
            await sleep(900);
            s9 = await page.evaluate(NOTE, {});
          } catch (e) {
            notes9.push(`第${attempt}次重开没读到：${String((e && e.message) || e).slice(0, 90)}`);
            await sleep(1200);
          }
        }
        const pOk = s9 && s9.text === TXT3 && s9.angle === before.angle
          && JSON.stringify(s9.mirror) === JSON.stringify(before.mirror)
          && Math.abs(s9.size.width - before.size.width) <= 1 && Math.abs(s9.size.height - before.size.height) <= 1
          && Math.abs(s9.pos.x - before.pos.x) <= 1 && Math.abs(s9.pos.y - before.pos.y) <= 1;
        pOk
          ? ok('[9] 存盘重开：文字/尺寸/角度/镜像/位置整套回来（attrs 整包透传＋angle/mirror 在构造期名单＋applyMirror 重挂）',
            `text=${s9.text} angle=${s9.angle} mirror=${J(s9.mirror)} size=${s9.size.width}x${s9.size.height}`)
          : bad('[9] 存盘重开：文字/尺寸/角度/镜像/位置整套回来（attrs 整包透传＋angle/mirror 在构造期名单＋applyMirror 重挂）',
            J({ before: before && { text: before.text, size: before.size, pos: before.pos, angle: before.angle, mirror: before.mirror }, s9: s9 && { text: s9.text, size: s9.size, pos: s9.pos, angle: s9.angle, mirror: s9.mirror }, notes: notes9 }));

        // ---- [10] 部件展开图：注释叠加 + 与器件相对位置零误差 ----
        let arm10 = null;
        try {
          // ⚠ handleSaveGate 硬性要求 ≥1 Input＋≥1 Output（SandboxCanvas:3309），只放 And 会被拒存
          await UI.clickGate(page, 'And');
          await UI.clickGate(page, 'Input');
          await UI.clickGate(page, 'Output');
          await sleep(600);
          await page.locator('button[title^="将当前电路保存为自定义门"]').click();
          await sleep(400);
          await page.fill('input[placeholder="自定义门名称"]', 'annotPart');
          await sleep(200);
          await page.locator('button[title="确认保存为自定义门"]').click();
          await sleep(800);
          await UI.newSandboxFile(page);
          await waitPaper(page);
          const placed = await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')]
              .find((x) => String(x.title || '').startsWith('放置部件') && String(x.textContent || '').trim() === 'annotPart');
            if (!b) return false;
            b.click();
            return true;
          });
          await sleep(1000);
          const def = await page.evaluate(async () => {
            const { sandboxStore } = await import('/src/store/sandboxStore.ts');
            const f = sandboxStore.list().find((x) => x.role === 'part' && x.name === 'annotPart.djs');
            if (!f) return null;
            const cells = JSON.parse(f.graphJson).cells || [];
            const ann = cells.find((c) => c.type === 'Annotation');
            const and = cells.find((c) => c.type === 'And');
            return { ann: ann && { pos: ann.position, angle: ann.angle, mirror: ann.mirror, text: ann.attrs && ann.attrs.label && ann.attrs.label.text }, and: and && { pos: and.position } };
          });
          if (!placed || !def || !def.ann || !def.and) {
            arm10 = { placed, def };
          } else {
            const sc = await page.evaluate(() => {
              const sub = (window).__sandboxPaper.model.getElements().find((e) => e.get('type') === 'Subcircuit');
              if (!sub) return null;
              const b = (window).__sandboxPaper.findViewByModel(sub).el.getBoundingClientRect();
              return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
            });
            if (!sc) arm10 = { placed, def, sc: null };
            else {
              // ⚠ 开内部电路弹窗走现役配方 clickZoomInto（单击放大镜 a.zoom → onZoom 分支）。
              //   自制双击路径实测不灵：joint 的 cell:pointerdblclick 到了（pdbl=3）、
              //   digitaljs 的 open:subcircuit 却从不发出（open=0，沙盒交互态下的 R38 同族）。
              const opened = await UI.clickZoomInto(page, { openedSelector: '[data-inner-host]', tries: 4 });
              if (!opened || !opened.opened) {
                arm10 = { fatal: 'clickZoomInto 没起窗', why: opened && opened.why };
              } else {
                await page.waitForFunction(() => !!(window).__innerPaper && !!(window).__innerPaper.model, null, { timeout: 10000 });
                await sleep(1600); // settleFit 轮询到包围盒稳定（最长 ~1.2s）
                arm10 = await page.evaluate((d) => {
                  const ip = (window).__innerPaper;
                  const ann = ip.model.getElements().find((e) => e.get('type') === 'Annotation');
                  const and = ip.model.getElements().find((e) => e.get('type') === 'And');
                  if (!ann || !and) return { ann: null, and: !!and };
                  return {
                    ann: {
                      pos: ann.get('position'), angle: Number(ann.get('angle') || 0), mirror: ann.get('mirror') || null,
                      text: String(ann.attr('label/text') || ''),
                    },
                    and: { pos: and.get('position') },
                    def: d,
                  };
                }, def);
                // 关弹窗（× 按钮），不给后续臂留遮罩
                await page.locator('button[title="关闭"]').last().click().catch(() => { });
                await sleep(400);
              }
            }
          }
        } catch (e) {
          arm10 = { fatal: String((e && e.message) || e).slice(0, 140) };
        }
        const a = arm10 && arm10.ann, g = arm10 && arm10.and, d = arm10 && (arm10.def || arm10.ann && arm10.ann.def);
        const t10 = a && g && d && d.ann && d.and
          && a.pos.x === d.ann.pos.x && a.pos.y === d.ann.pos.y
          && g.pos.x === d.and.pos.x && g.pos.y === d.and.pos.y
          && a.text === d.ann.text && a.angle === (d.ann.angle || 0)
          && !!(a.mirror && a.mirror.h) === !!(d.ann.mirror && d.ann.mirror.h);
        t10
          ? ok('[10] 展开图叠加：注释与器件绝对坐标逐位相等（与部件相对位置零误差），文字/角度/镜像随行',
            `ann=${J(a && a.pos)} and=${J(g && g.pos)} angle=${a && a.angle}`)
          : bad('[10] 展开图叠加：注释与器件绝对坐标逐位相等（与部件相对位置零误差），文字/角度/镜像随行', J(arm10));
      }
    }

    // ================= 视觉几何族（用户报"文本与框分离／黑体描边／拉伸不缩放"） =================
    // 新建一颗干净的注释（上一颗已经带旋转/镜像，几何读数要独立）
    const blank2 = await UI.blankCanvasPoint(page);
    if (!blank2) {
      ['[11] 文字块落在框内（label 无 transform、内缩＝pad、不越框）',
       '[12] 无继承描边＋字重 normal，且两个主题的 fill 都随主题翻转',
       '[13] 拉伸盒宽 ⇒ 字号等比放大（用户："拉伸文本框没有缩放文本"）',
       '[14] 提交后盒子贴住文字；手动拉过之后不再被贴小（标记随存档走）']
        .forEach((n) => skip(n, '找不到第二处空白点'));
    } else {
      await page.mouse.dblclick(blank2.x, blank2.y);
      await sleep(400);
      await page.keyboard.type('短字' + String.fromCharCode(10) + '第二行也不长', { delay: 15 });
      await page.keyboard.press('Escape');
      await sleep(500);
      const n2 = await page.evaluate(NOTE, {});
      const fitTight = n2 && n2.size.width <= 180 - 20 && n2.size.height <= 60;
      fitTight
        ? ok('[14a] 提交后盒子贴住文字（新建默认 180×76 → 实测 ' + n2.size.width + '×' + n2.size.height + '；用户报"边框比文字宽、上下都有空隙"）',
          `size=${n2.size.width}x${n2.size.height} lines=${n2.tspans} 行宽=${J(n2.lineWidths)}`)
        : bad('[14a] 提交后盒子贴住文字（新建默认 180×76 → 应随文字收缩）',
          J(n2 && { size: n2.size, tspans: n2.tspans, widths: n2.lineWidths }));

      // ---- [11] label 与框同一坐标空间、内缩＝pad、不越框 ----
      const gOk = n2 && n2.labelTransform === 'none' && n2.inset
        && Math.abs(n2.inset.l - 8) <= 4 && Math.abs(n2.inset.t - 8) <= 8
        && n2.inset.overR <= 1 && n2.inset.overB <= 1;
      gOk
        ? ok('[11] 文字块落在框内：label 无 transform（Gate 基类的居中平移已清）、左内缩＝pad、不越框',
          `transform=${n2.labelTransform} inset=${J(n2.inset)} t1=(${n2.t1x},${n2.t1y})`)
        : bad('[11] 文字块落在框内：label 无 transform（Gate 基类的居中平移已清）、左内缩＝pad、不越框',
          J(n2 && { tr: n2.labelTransform, inset: n2.inset, t1x: n2.t1x, t1y: n2.t1y, size: n2.size }));

      // ---- [12] 描边/字重/主题色 ----
      const strokeOk = n2 && (n2.labelStroke === 'none') && (n2.bodyStroke === null || n2.bodyStroke === 'none')
        && String(n2.fontWeight) === '400';
      // 对比度按**亮度阈值**断言（⛔ 拿正则认 rgb() 的写法：一次转义事故就把它变成恒真式，
      // 而且 r121 这一格第一版就是这么坏在测试脚本里的——控制字符混进了正则）。
      const lum = (rgb) => {
        const mm = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(String(rgb || ''));
        return mm ? (Number(mm[1]) + Number(mm[2]) + Number(mm[3])) / 3 : -1;
      };
      const t0 = n2 && n2.theme, l0 = lum(n2 && n2.fill);
      await page.locator('button[data-activity="主题"]').first().click();
      await sleep(700);
      const n2b = await page.evaluate(NOTE, {});
      const t1v = n2b && n2b.theme, l1 = lum(n2b && n2b.fill);
      await page.locator('button[data-activity="主题"]').first().click();
      await sleep(600);
      // 深色主题＝亮字压暗底（亮度>160）；浅色主题＝暗字压亮底（亮度<90）
      const darkSide = (t, l) => (t === 'dark' ? l > 160 : l < 90);
      const contrastOk = !!t0 && !!t1v && t1v !== t0 && l0 >= 0 && l1 >= 0 && darkSide(t0, l0) && darkSide(t1v, l1);
      (strokeOk && contrastOk)
        ? ok('[12] 文字无继承描边（body 的 stroke 不再落到 text）、字重 400，两个主题各自对比度成立（深底亮字／亮底暗字）',
          `stroke=${n2.labelStroke} body=${J(n2.bodyStroke)} weight=${n2.fontWeight}；${t0} 亮度=${l0} ⇒ ${t1v} 亮度=${l1}`)
        : bad('[12] 文字无继承描边（body 的 stroke 不再落到 text）、字重 400，两个主题各自对比度成立（深底亮字／亮底暗字）',
          J({ stroke: n2 && n2.labelStroke, bodyStroke: n2 && n2.bodyStroke, weight: n2 && n2.fontWeight,
            t0, l0, t1: t1v, l1 }));

      // ---- [13] 拉伸 → 字号等比放大 ----
      const sel2 = await page.evaluate((a) => {
        const p = (window).__sandboxPaper;
        const b = p.findViewByModel(p.model.getCell(a.id)).el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }, { id: n2.id });
      await page.mouse.click(sel2.x, sel2.y);
      await sleep(400);
      const before13 = await page.evaluate(NOTE, { id: n2.id });
      const he = before13.handleE;
      if (!he || !he.visible) {
        skip('[13] 拖角＝整块等比缩放（字号跟放大、文字不溢出）；拖边＝只改比例（字号与高都不动）', `手柄不可见：${J(he)}`);
        skip('[14b] 拉过之后不再被自动贴小；noteUserSized 与缩放数随存盘重开回来', '前置没满足');
      } else {
        const w0 = before13.size.width, h0b = before13.size.height, f0b = before13.fontPx;
        // 先拖**边** +60（只改比例），再拖**角** +150（整块等比）。角这一步为什么要拖 150：
        // 盒子是**贴过字**的窄盒（实测 95 起步），拖太少会卡在基准宽附近、放大量看不出来
        // ——第一版判据就是这么误红一格的（产品没错，是夹具的起点变了）。
        await page.mouse.move(he.x, he.y);
        await page.mouse.down();
        await page.mouse.move(he.x + 60, he.y, { steps: 5 });
        await page.mouse.up();
        await sleep(400);
        // 先量**边**：只改比例——字号与高都不该动（角/边不分的回归臂）
        const edgeOnly = await page.evaluate(NOTE, { id: n2.id });
        const edgeNoScale = Math.abs(edgeOnly.fontPx - f0b) < 0.01 && edgeOnly.size.height === h0b;
        const hs2 = edgeOnly.handleSe;
        await page.mouse.move(hs2.x, hs2.y);
        await page.mouse.down();
        await page.mouse.move(hs2.x + 150, hs2.y + 40, { steps: 6 });
        await page.mouse.up();
        await sleep(500);
        const after13 = await page.evaluate(NOTE, { id: n2.id });
        // 期望＝13 × 这颗便签自己的缩放数（⛔ 拿 宽/180 当契约：驱动源换成 noteFontScale
        // 后那个式子就成了恒假——第一版判据就是这么误红过一格的）
        const expectFont = Math.round(13 * after13.fontScale * 100) / 100;
        const scaleOk = edgeNoScale && after13.size.width > w0 + 100 && w0 < 180
          && after13.fontScale > 1.05 && after13.fontPx > f0b + 2
          && Math.abs(after13.fontPx - expectFont) <= 0.6
          // 等比缩放后文字不许溢出到框外（让四条边都放大字号的第一版，实测溢出 51px）
          && after13.inset.overR <= 1 && after13.inset.overB <= 1;
        scaleOk
          ? ok('[13] 拖**角**＝整块等比缩放（字号跟着放大且文字不溢出）；拖**边**＝只改比例（字号与高都不动）',
            `角拖后 w ${w0}→${after13.size.width} font ${f0b}→${after13.fontPx} scale=${after13.fontScale} 期望≈${expectFont} 越界=${J(after13.inset)}；边拖那一步 font 仍=${edgeOnly.fontPx} 高仍=${edgeOnly.size.height}`)
          : bad('[13] 拖**角**＝整块等比缩放（字号跟着放大且文字不溢出）；拖**边**＝只改比例（字号与高都不动）',
            J({ edgeNoScale, edgeFont: edgeOnly && edgeOnly.fontPx, f0b, h0b, w0, got: after13 && { w: after13.size.width, h: after13.size.height, font: after13.fontPx, scale: after13.fontScale, inset: after13.inset }, expectFont }));

        // ---- [14b] 拉过之后：标记立起来，再编辑提交不吞掉用户尺寸 ----
        const flagged = after13.noteUserSized === true;
        // ⚠ 现量现点，且取**noteBg 的矩形**：视图 el 的 bbox 含 8 颗手柄（文字长高时更大），
        //   它的"中心"实测压在南手柄 rect#h-s 上——点手柄等于起缩放，双击永远进不了编辑分支
        //   （[14b] 第一版就是这么红的：读起来像"编辑没生效"，其实是点错了元素）。
        const sel3 = await page.evaluate((a) => {
          const p = (window).__sandboxPaper;
          const v = p.findViewByModel(p.model.getCell(a.id));
          const bg = v.el.querySelector('[joint-selector="noteBg"]') || v.el;
          const b = bg.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }, { id: n2.id });
        // 诊断：这一格第一版红的归因要分得开——是双击没命中，还是命中了没进编辑分支
        await page.evaluate(() => {
          const p = (window).__sandboxPaper;
          (window).__dbl14 = { pd: 0, hit: null };
          p.on('cell:pointerdown', (v) => { if (String(v.model.get('type')) === 'Annotation') (window).__dbl14.pd++; });
        });
        await page.evaluate((pt) => {
          const el = document.elementFromPoint(pt.x, pt.y);
          (window).__dbl14.hit = el ? `${el.tagName}#${el.getAttribute('joint-selector') || ''} in-cell=${!!(el.closest && el.closest('[model-id]'))}` : 'null';
        }, sel3);
        await page.mouse.dblclick(sel3.x, sel3.y);
        await sleep(400);
        const open14 = await page.evaluate(() => ({
          ta: !!document.querySelector('[data-note-edit]'),
          focused: document.activeElement === document.querySelector('[data-note-edit]'),
          diag: (window).__dbl14,
          rect: (() => { const c = (window).__sandboxPaper.model.getElements().find((e) => e.get('type') === 'Annotation'); const v = (window).__sandboxPaper.findViewByModel(c); const b = v.el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })(),
        }));
        await page.keyboard.press('Control+a');
        await page.keyboard.type('又改了文字，盒子不该缩回去', { delay: 10 });
        await page.keyboard.press('Escape');
        await sleep(500);
        const after14 = await page.evaluate(NOTE, { id: n2.id });
        if (!open14.ta || !open14.focused) console.log(`  [现场14b] 编辑器没开或没聚焦：${J(open14)} after14.text=${after14 && after14.text}`);
        const keptLive = flagged && after14.size.width >= after13.size.width - 1 && after14.noteUserSized === true
          && after14.text.indexOf('又改了文字') === 0;
        // 标记本身也要随存档走——不然重开一次后"贴字"就会把用户拉好的尺寸吃掉（这条不是推断，是量出来的）
        await page.locator('button[title^="保存当前沙盒文件"]').first().click().catch(() => { });
        await sleep(900);
        let back14 = null;
        for (let attempt = 1; attempt <= 3 && !back14; attempt++) {
          try {
            await UI.boot(page, URL, { reload: true });
            try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
            await UI.enterSandbox(page);
            await waitPaper(page);
            await sleep(900);
            const got = await page.evaluate(() => (window).__sandboxPaper.model.getElements()
              .filter((e) => String(e.get('type')) === 'Annotation')
              .map((e) => ({ id: String(e.id), w: (e.get('size') || {}).width, flag: !!e.get('noteUserSized'), scale: Number(e.get('noteFontScale') || 1), font: Math.round(parseFloat(getComputedStyle((window).__sandboxPaper.findViewByModel(e).el.querySelector('[joint-selector=\"label\"]')).fontSize) * 100) / 100, text: String(e.get('label') || '') }))
              .find((x) => x.text.indexOf('又改了文字') === 0));
            back14 = got || null;
          } catch (e) { await sleep(1200); }
        }
        const kept = keptLive && back14 && back14.flag === true
          && Math.abs(back14.w - after14.size.width) <= 1
          && Math.abs(back14.scale - after14.fontScale) <= 0.01
          && Math.abs(back14.font - after14.fontPx) <= 0.6;
        kept
          ? ok('[14b] 手动拉过之后不再被自动贴小；noteUserSized 与缩放数（及其算出的字号）都随存盘重开回来',
            `拉后 w=${after14.size.width} font=${after14.fontPx} scale=${after14.fontScale}；重开 w=${back14 && back14.w} font=${back14 && back14.font} scale=${back14 && back14.scale}`)
          : bad('[14b] 手动拉过之后不再被自动贴小；noteUserSized 与缩放数（及其算出的字号）都随存盘重开回来',
            J({ open14, flagged, after13: after13.size, after14: after14 && { size: after14.size, text: after14.text, flag: after14.noteUserSized, fontPx: after14.fontPx, scale: after14.fontScale }, back14 }));
      }
    }

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
