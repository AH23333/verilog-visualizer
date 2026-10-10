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
  return {
    id: String(c.id), type: String(c.get('type')),
    text: String((c.attr && c.attr('label/text')) || ''),
    size: c.get('size'), pos: c.get('position'),
    angle: Number(c.get('angle') || 0), mirror: c.get('mirror') || null,
    tspans: tspans.length, lineWidths: widths,
    ta: !!document.querySelector('[data-note-edit]'),
    taFocused: document.activeElement === document.querySelector('[data-note-edit]'),
    taValue: String((document.querySelector('[data-note-edit]') || {}).value ?? ''),
    handleE: handle('e'), handleSe: handle('se'),
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
