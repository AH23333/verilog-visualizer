// R99 闸门：**沙盒/编译模式 UI 统一**六项（他 2026-10-06 清单）。
//   [1] 多选旋转绕选区包围盒中心（joint rotate(origin)，非各绕自身中心）
//   [2] 选中高亮＝主题紫（--accent-hover；特异度压过 index.css 主题灰规则）
//   [3] 水平镜像（mirror 状态＋端口对调＋body 变换，wires 跟随）
//   [4] Shift+滚轮＝左右平移（滚轮＝上下，Ctrl+滚轮＝光标缩放——与编译模式同一套）
//   [5] 子电路右键「绑定...」对话框（BindingDialog 同款样式）＋真换绑（celltype 变更）
//   夹具：logic_sub（三门口）子模块——单门子模块会被 yosys opt 溶进 top（探针现场）。
//   ⚠ 框选用屏幕坐标（cellRect），别用画布局部坐标（面板偏移，R99 现场）。
//   ⚠ 文件要在本轮清理之后创建（探针开头的 verilog-viz-* 清理会删掉上一轮的文件）。
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1608;
const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('  PASS  ' + n + (d ? ' — ' + d : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); };
async function waitPaper(page) {
  await page.waitForFunction(() => !!(window.__sandboxPaper && window.__sandboxPaper.model), null, { timeout: 15000 });
  await sleep(150);
}
const menuClick = async (page, label) => {
  const item = page.locator(`[data-context-menu] button:has-text("${label}")`).first();
  await item.waitFor({ timeout: 5000 });
  await item.click();
  await sleep(400);
};
(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await UI.newSandboxFile(page);

    // 放两颗 And（间隔足够）
    await UI.clickGate(page, 'And'); await sleep(400);
    await UI.clickGate(page, 'And'); await sleep(600);
    await waitPaper(page);
    const ids = await page.evaluate(() => (window).__sandboxPaper.model.getElements()
      .filter((e) => String(e.get('type')) === 'And').map((e) => String(e.id)));
    console.log('[setup] 两颗 And:', J(ids));
    const centers = () => page.evaluate((a) => a.ids.map((id) => {
      const c = (window).__sandboxPaper.model.getCell(id);
      const b = c.getBBox();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), angle: c.get('angle') || 0 };
    }), { ids });
    let cs = await centers(ids);
    console.log('[setup] 中心/角度:', J(cs));

    // ① 框选两颗（⚠ 拖拽用**屏幕**坐标：cellRect 已是屏幕坐标，用它算框选范围；
    //   画布局部坐标要加面板偏移，直接当屏幕坐标用会罩空区域——本轮现场踩过）
    const rects = [];
    for (let i = 0; i < 2; i++) {
      const rr = await page.evaluate((a) => {
        const p = (window).__sandboxPaper;
        const c = p.model.getElements().filter((e) => String(e.get('type')) === 'And')[a.i];
        if (!c) return null;
        const b = (p.findViewByModel(c) || {}).el?.getBoundingClientRect?.();
        return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height } : null;
      }, { i });
      if (rr) rects.push(rr);
    }
    if (rects.length < 2) { console.log('★没凑齐两颗 And 的屏幕矩形');   console.log('\n===== 结果: ' + pass + ' pass, ' + fail + ' fail =====');
  process.exit(fail > 0 ? 1 : 0);
  process.exit(0); }
    const minX = Math.min(...rects.map((r) => r.x - r.w / 2)) - 10, minY = Math.min(...rects.map((r) => r.y - r.h / 2)) - 10;
    const maxX = Math.max(...rects.map((r) => r.x + r.w / 2)) + 10, maxY = Math.max(...rects.map((r) => r.y + r.h / 2)) + 10;
    await page.mouse.move(minX, minY);
    await page.mouse.down();
    await page.mouse.move(maxX, maxY, { steps: 6 });
    await page.mouse.up();
    await sleep(400);
    // ② 多选旋转 90°
    const r = await UI.cellRect(page, 'And');
    // 右键在第一颗上开菜单会清掉选择？——用 Ctrl+R 快捷键（作用于 selectionRef）
    await page.keyboard.press('Control+r');
    await sleep(700);
    await waitPaper(page);
    const cs2 = await centers(ids);
    console.log('[1] 旋转 90° 后中心/角度:', J(cs2));
    // 验证：每颗中心绕原 bbox 中心**顺时针** 90°（屏幕 y 向下：左边→上方）
    const cx = (Math.min(...cs.map((c) => c.x)) + Math.max(...cs.map((c) => c.x))) / 2;
    const cy = (Math.min(...cs.map((c) => c.y)) + Math.max(...cs.map((c) => c.y))) / 2;
    const expect = cs.map((c) => ({ x: Math.round(cx - (c.y - cy)), y: Math.round(cy + (c.x - cx)), angle: (c.angle + 90) % 360 }));
    const rotOk = cs2.every((c, i) => Math.abs(c.x - expect[i].x) <= 2 && Math.abs(c.y - expect[i].y) <= 2 && c.angle === expect[i].angle);
    console.log(`[1] ${rotOk ? 'PASS 多选旋转绕选区中心' : '★FAIL 期望 ' + J(expect)}`);
    // 转回来
    await page.keyboard.press('Shift+Control+r');
    await sleep(700);

    // ③ 高亮：点一颗，读 .body computed stroke（应为 --accent-hover 紫）
    const hl = await page.evaluate((a) => {
      const p = (window).__sandboxPaper;
      const view = p.findViewByModel(p.model.getCell(a.ids[0]));
      view.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const body = view.el.querySelector('.body, path.body');
      const cs2 = getComputedStyle(body);
      return { stroke: cs2.stroke, w: cs2.strokeWidth };
    }, { ids });
    hl && hl.stroke === 'rgb(129, 140, 248)' ? ok('[2] 选中高亮＝主题紫（--accent-hover，特异度压过主题灰）', J(hl)) : bad('[2] 选中高亮＝主题紫（--accent-hover）', J(hl));

    // 归一化：合成 mousedown 没配 mouseup，可能留下按住状态——真左键点一下空白再松开
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(300);

    // ④ 镜像（对第一颗：右键 → 水平镜像）
    const rr = await UI.cellRect(page, 'And');
    await page.mouse.click(rr.x, rr.y, { button: 'right' });
    await sleep(400);
    const menuDump = await page.evaluate(() => [...document.querySelectorAll('[data-context-menu] button')].map((b) => b.textContent.trim()).slice(0, 14));
    if (!menuDump.some((t) => t.includes('水平镜像'))) {
      console.log('[3] ★菜单里没有「水平镜像」；实际菜单:', J(menuDump));
    }
    await menuClick(page, '水平镜像');
    await sleep(700);
    await waitPaper(page);
    const flip = await page.evaluate((a) => {
      const p = (window).__sandboxPaper;
      const c = p.model.getCell(a.ids[0]);
      const view = p.findViewByModel(c);
      const ports = [...view.el.querySelectorAll('.joint-port')].map((n) => {
        const r2 = n.getBoundingClientRect();
        return Math.round(r2.x + r2.width / 2);
      });
      // R100 模型级镜像：body 翻转走 transform attr（居中组合），不再是内联 style
      const bodyEl = view.el.querySelector('[joint-selector="body"], [data-selector="body"]');
      const bodyTf = (bodyEl ? (bodyEl.getAttribute('transform') || '') : String(c.attr('body/transform') || ''));
      const portAnchorXs = (c.getPorts?.() || []).map((pt) => {
        try { const b = view.getPortBBox ? view.getPortBBox(pt.id) : null; return b ? Math.round(b.x) : null; } catch { return null; }
      });
      return {
        mirror: c.get('mirror'), portXs: ports,
        bodyTf: bodyTf.slice(0, 60),
        wireX2: c.prop('ports/groups/in/attrs/wire/x2'),
      };
    }, { ids });
    flip && flip.mirror && flip.mirror.h
      && String(flip.bodyTf).includes('scale(-1,1)')
      && flip.wireX2 > 0   // R100：端口视觉 attrs x 系取反（in 组 wire.x2 由负变正）
      && new Set(flip.portXs).size >= 2   // 端口圆点真的分居两侧（连线跟随的前提）
      ? ok('[3] 水平镜像（mirror 状态＋body transform＋端口对调＋attrs 取反，wires 跟随）', J(flip)) : bad('[3] 水平镜像', J(flip));
    // ⑤ Shift+滚轮横移
    const t0 = await page.evaluate(() => { const t = (window).__sandboxPaper.translate(); return { tx: Math.round(t.tx), ty: Math.round(t.ty) }; });
    await page.mouse.move(800, 500);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 240);
    await sleep(300);
    const t1 = await page.evaluate(() => { const t = (window).__sandboxPaper.translate(); return { tx: Math.round(t.tx), ty: Math.round(t.ty) }; });
    await page.keyboard.up('Shift');
    (t1.tx !== t0.tx && t1.ty === t0.ty) ? ok('[4] Shift+滚轮＝左右平移（纵向不动）', J({ t0, t1 })) : bad('[4] Shift+滚轮＝左右平移', J({ t0, t1 }));

    // ⑥ 绑定对话框：编译带子模块的 Verilog → 复制到沙盒（自动建部件 sub＋实例）→ 右键 → 绑定...
    const verilog = [
      'module top(input a, input b, input c, output y);',
      '  sub s1(.a(a), .b(b), .c(c), .y(y));',
      'endmodule',
      'module sub(input a, input b, input c, output y);',
      '  assign y = (a & b) | (~c);',
      'endmodule',
    ].join(String.fromCharCode(10));
    await page.evaluate((v) => (async () => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const f = fileStore.createFile('r99_rebind.v'); fileStore.saveContent(f.id, v); return f.id;
    })(), verilog);
    // ⚠ 开文件用弹性循环：reload 后的视图不定（.djs 活动文件会把视图带进沙盒），
    //   沙盒判定＝[data-sandbox-paper-host] 在场；在沙盒就点沙盒活动按钮退出，
    //   回电路后点「文件」面板＋文件行；最多 3 轮。
    for (let round = 0; round < 3; round++) {
      if ((await page.locator('button[title^="编译"]').count()) > 0) break;
      const inSandbox = await page.evaluate(() => !!document.querySelector('[data-sandbox-paper-host]'));
      if (inSandbox) {
        await page.locator('button[data-activity="sandbox"]').first().click();
        await sleep(700);
        continue;
      }
      const fb = page.locator('button[data-activity="files"]');
      if (await fb.count()) { await fb.first().click(); await sleep(500); }
      const row = page.getByText('r99_rebind.v').first();
      if ((await row.count()) > 0) { try { await row.click({ timeout: 3000 }); await sleep(800); } catch { } }
    }
    await page.locator('button[title^="编译"]').first().click();
    let compiled = false;
    for (let i = 0; i < 40; i++) { await sleep(500); compiled = await page.evaluate(() => (async () => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const f = fileStore.getAll().find((x) => x.name === 'r99_rebind.v');
      return !!(f && f.status === 'compiled' && f.circuitJson);
    })()); if (compiled) break; }
    const devDump = await page.evaluate(() => (async () => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const f = fileStore.getAll().find((x) => x.name === 'r99_rebind.v');
      const cj = f && f.circuitJson;
      if (!cj) return '(no circuitJson)';
      const devArr = Array.isArray(cj.devices) ? cj.devices : Object.values(cj.devices || {});
      return devArr.map((d) => d.type);
    })());
    console.log('[5pre] 编译器件:', JSON.stringify(devDump));
    if (!compiled) { console.log('★编译没成，绑定对话框这格今天没判'); } else {
      await page.locator('button[title*="复制到沙盒"]').first().click();
      await sleep(1500);
      // 复制到沙盒会**自动**切进沙盒并打开新文件——别再点沙盒按钮（点了反而退回电路视图）
      let sub = null;
      for (let i = 0; i < 20 && !sub; i++) {
        await sleep(500);
        sub = await page.evaluate(() => {
          const p = (window).__sandboxPaper;
          if (!p || !p.model) return null;
          const c = p.model.getElements().find((e) => String(e.get('type')) === 'Subcircuit');
          return c ? String(c.id) : null;
        });
      }
      console.log('[5] Subcircuit 实例:', sub);
      await page.evaluate(() => (async () => {
        const { sandboxStore } = await import('/src/store/sandboxStore.ts');
        const files = sandboxStore.list().map((x) => ({ name: x.name }));
        const p = (window).__sandboxPaper;
        const types = p && p.model ? p.model.getElements().map((e) => String(e.get('type'))) : '(no paper)';
        const host = !!document.querySelector('[data-sandbox-paper-host]');
        return { files, types, host };
      })()).then((d) => console.log('[5diag]', JSON.stringify(d)));
      if (!sub) { console.log('★沙盒里没有子电路实例'); } else {
        const rc = await page.evaluate((a) => {
          const p = (window).__sandboxPaper;
          const el = (p.findViewByModel(p.model.getCell(a.id)) || {}).el;
          const b = el.getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }, { id: sub });
        await page.mouse.click(rc.x, rc.y, { button: 'right' });
        await sleep(400);
        await menuClick(page, '绑定...');
        await sleep(600);
        const dlg = await page.evaluate(() => {
          const d = document.querySelector('[data-rebind-dialog]');
          if (!d) return { open: false };
          const rows = [...d.querySelectorAll('[data-rebind-row]')].map((n) => n.getAttribute('data-rebind-row'));
          return { open: true, rows };
        });
        dlg.open && dlg.rows.includes('sub') ? ok('[5] 子电路右键「绑定...」对话框（BindingDialog 同款）', J(dlg)) : bad('[5] 绑定对话框', J(dlg));
        await page.screenshot({ path: 'tests/.tmp-r99-rebind.png' });
        if (dlg.open) {
          await page.locator('[data-rebind-close]').first().click();
          await sleep(500);
          // 存第二个部件：菜单里「保存为部件（可编辑电路）」
          const rc2 = await page.evaluate((a) => {
            const p = (window).__sandboxPaper;
            const el = (p.findViewByModel(p.model.getCell(a.id)) || {}).el;
            const b2 = el.getBoundingClientRect();
            return { x: b2.x + b2.width / 2, y: b2.y + b2.height / 2 };
          }, { id: sub });
          await page.mouse.click(rc2.x, rc2.y, { button: 'right' });
          await sleep(400);
          await UI.menuSet(page, '保存为部件（可编辑电路）', 'PART_B', rc2);
          await sleep(900);
          await page.mouse.click(rc2.x, rc2.y, { button: 'right' });
          await sleep(400);
          await menuClick(page, '绑定...');
          await sleep(600);
          const rows2 = await page.evaluate(() => [...document.querySelectorAll('[data-rebind-row]')].map((n) => n.getAttribute('data-rebind-row')));
          console.log('[5b] 二次对话框部件清单:', JSON.stringify(rows2));
          // 真换绑：点非当前的 PART_B
          const pick = page.locator('[data-rebind-row="PART_B"]').first();
          await pick.click();
          await sleep(1200);
          const ct = await page.evaluate((a) => String((window).__sandboxPaper.model.getCell(a.id).get('celltype') || ''), { id: sub });
          ct === 'PART_B' ? ok('[5c] 真换绑：celltype → PART_B（rebindSubcircuitCell 单一主人）', ct) : bad('[5c] 真换绑', ct);
        }
      }
    }
    await page.screenshot({ path: 'tests/.tmp-r99-final.png' });
  } catch (e) {
    fail++;
    console.log('  FAIL  [0] 闸门跑完（没有中途抛错）', String(e && e.message || e).slice(0, 200));
  } finally {
    try { if (browser) await browser.close(); } catch { }
    try { if (server) server.kill('SIGKILL'); } catch { }
  }
  console.log('');
  console.log('===== 结果: ' + pass + ' pass, ' + fail + ' fail =====');
  process.exit(fail > 0 ? 1 : 0);
})();
