// R35 验收（沿用 R34 框架，断言随渲染管线升级）：
//  [1] 自定义门含重复 IO net 也能放置（joint "found id duplicities in ports" 修复）
//  [2] 展开图与编译模式钻取同管线（提升为顶层：djs 类 + Button/Lamp + iolabel 端口名）
//  [3] 侧栏三个面板右键各有菜单（文件/部件/层次结构）；画布右键仍是画布菜单
//  [4] 序列化兜底：无 subcircuitGraph 属性的活内图（编译模式场景）也能带出内部电路
//  [5] 导入 .djs 自动注册内嵌 customParts（可编辑部件随文件走）
//  [6] 界面字体大小调整后沙盒侧栏文字同步缩放
//  [7] 全程无页面异常
//  [8] 子模块右键「保存为部件」→ 部件库出现新的可编辑 .djs（复制到沙盒的绑定闭环）
//  [9] 「粘贴复制的电路」：import-clipboard 原样插入画布（id 重映射不冲突）
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1491;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1491)); } catch { }
const UI = require('./_ui.cjs');
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickActivity = async (page, key) => {
  await page.locator(`button[data-activity="${key}"]`).first().click(); await sleep(600);
};
/** 顶层 fixed 菜单的标题（null = 没有打开的菜单） */
const topMenuTitle = (page) => page.evaluate(() => {
  const menus = Array.from(document.querySelectorAll('div'))
    .filter(d => getComputedStyle(d).position === 'fixed' && (d.querySelector('button, input') || d.textContent?.includes('内部电路')));
  const m = menus[menus.length - 1];
  if (!m) return null;
  const t = m.querySelector('div');
  return t ? t.textContent.trim() : null;
});
const closeMenu = async (page) => { await page.keyboard.press('Escape'); await sleep(250); };
const subCount = (page) => page.evaluate(
  () => window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Subcircuit').length);

(async () => {
  let server, browser;
  try {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    await page.evaluate(() => {
      ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates',
       'verilog-viz-sandbox-settings','verilog-viz-sandbox-w','verilog-viz-sandbox-folders',
       'verilog-viz-font-size'].forEach(k => localStorage.removeItem(k));
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}

    // ===== 准备：注入两个自定义门（G1 正常；BAD 两个 Input 同 net='x'，旧代码必然
    // 抛 found id duplicities in ports）===== 
    const badGate = {
      id: 'gate_bad', name: 'BAD',
      graphJson: JSON.stringify({ cells: [
        { id: 'bi1', type: 'Input', position: { x: 40, y: 40 }, bits: 1, net: 'x' },
        { id: 'bi2', type: 'Input', position: { x: 40, y: 120 }, bits: 1, net: 'x' },
        { id: 'bo1', type: 'Output', position: { x: 220, y: 80 }, bits: 1, net: 'y' },
      ] }),
    };
    const normalGate = {
      id: 'gate_g1', name: 'G1',
      graphJson: JSON.stringify({ cells: [
        { id: 'i1', type: 'Input', position: { x: 40, y: 40 }, bits: 1 },
        { id: 'o1', type: 'Output', position: { x: 220, y: 40 }, bits: 1 },
        { id: 'w1', isLink: true, source: { id: 'i1', port: 'out' }, target: { id: 'o1', port: 'in' }, netname: 'N1', bits: 1 },
      ] }),
    };
    await page.evaluate(({ badGate, normalGate }) => {
      localStorage.setItem('verilog-viz-sandbox-gates', JSON.stringify([badGate, normalGate]));
    }, { badGate, normalGate });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);

    await clickActivity(page, 'sandbox'); await sleep(900);
    await UI.newSandboxFile(page);
    await clickActivity(page, 'modules'); await sleep(500);

    // ===== [1] 放置 BAD（重复 net 的门）=====
    await page.locator('[data-sandbox-sidebar] button:has-text("BAD")').first().click(); await sleep(800);
    const s1 = await subCount(page);
    const toastText = await page.evaluate(() => document.querySelector('[data-sandbox-toast]')?.textContent || '');
    // 正常门也放一个，保证非重复场景未回归
    await page.locator('[data-sandbox-sidebar] button:has-text("G1")').first().click(); await sleep(700);
    const s2 = await subCount(page);
    (s1 >= 1 && s2 >= 2 && !toastText.includes('放置失败'))
      ? ok('[1] 重复 net 的自定义门可正常放置（id duplicities 修复）', `BAD=${s1}, BAD+G1=${s2}, toast="${toastText}"`)
      : bad('[1] 自定义门放置异常', JSON.stringify({ s1, s2, toastText }));

    // ===== [2] 展开图：编译模式同源管线（djs 样式类）+ 端口名 =====
    const zoomPt = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const sub = p.model.getCells().filter(c => c.get('type') === 'Subcircuit')[0];
      if (!sub) return null;
      const v = sub.findView(p);
      const za = v.el?.querySelector?.('a.zoom');
      if (!za) return null;
      const r = za.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!zoomPt) { bad('[2] 未找到放大镜'); }
    else {
      await page.mouse.click(zoomPt.x, zoomPt.y); await sleep(2600);
      const diag = await page.evaluate(() => {
        const ip = window.__innerPaper;
        if (!ip) return { open: false };
        // R35 管线：子模块被提升为顶层渲染 —— IO 经 io_ui 变 Button/Lamp，
        // 端口名经 displayOn 后补写进 text.label（与编译视图 Canvas 同策略）
        const iolabels = Array.from(ip.el.querySelectorAll('text.label')).map(t => t.textContent);
        const types = ip.model.getCells().filter(c => !c.isLink()).map(c => c.get('type'));
        return {
          open: true,
          djsClass: ip.el.classList.contains('djs'),
          gridSize: ip.options.gridSize,
          iolabels,
          types,
        };
      });
      console.log('    展开图诊断:', JSON.stringify(diag));
      (diag.open && diag.djsClass && (diag.types || []).includes('Button') && (diag.types || []).includes('Lamp')
        && (diag.iolabels || []).some(t => t && t.trim()))
        ? ok('[2] 展开图与编译模式钻取同管线（提升为顶层 + Button/Lamp + 端口名）', JSON.stringify({ types: diag.types, iolabels: diag.iolabels }))
        : bad('[2] 展开图渲染异常', JSON.stringify(diag));
      await page.locator('button[title="关闭"]').first().click(); await sleep(400);
    }

    // ===== [3] 侧栏三面板右键各有菜单；画布右键 → 画布菜单 =====
    await clickActivity(page, 'files'); await sleep(600);
    // 3a: 面板标题栏附近（树容器之外）右键 —— 旧代码这里会弹「画布」菜单
    const titleBox = await page.evaluate(() => {
      const bar = document.querySelector('[data-sandbox-sidebar]');
      const spans = Array.from(bar.querySelectorAll('span'));
      const t = spans.find(s => ['文件', '部件', '层次结构'].includes((s.textContent || '').trim()));
      const r = t.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.bottom + 14 };
    });
    await page.mouse.click(titleBox.x, titleBox.y, { button: 'right' }); await sleep(450);
    // R100：文件面板右键菜单与编译模式一模一样 ⇒ 无标题头，首项＝「打开」
    const t3a = await page.evaluate(() => {
      const menus = Array.from(document.querySelectorAll('div'))
        .filter(d => getComputedStyle(d).position === 'fixed' && d.querySelector('button, input'));
      const m = menus[menus.length - 1];
      if (!m) return null;
      const b = m.querySelector('button');
      return b ? ('[首按钮] ' + b.textContent.trim()) : null;
    });
    await closeMenu(page);
    // 3b: 部件面板右键 —— R35 新增「部件」菜单
    await clickActivity(page, 'modules'); await sleep(500);
    await page.mouse.click(titleBox.x, titleBox.y, { button: 'right' }); await sleep(450);
    const t3b = await topMenuTitle(page);
    await closeMenu(page);
    // 3c: 层次结构面板右键 —— R35 新增「层次结构」菜单
    await clickActivity(page, 'hierarchy'); await sleep(500);
    // ⚠ 原先用「标题栏下方 14px」这个坐标：层次结构面板内容长短一变，这点就会落在
    //   器件行上（行吃掉右键 ⇒ 菜单不弹）。改点面板中部空白——探针
    //   （tests/.tmp-r101-hier-probe.cjs）单独复现时菜单一直在 ⇒ 不是产品回归。
    const hierBox = await page.evaluate(() => {
      const bar = document.querySelector('[data-sandbox-sidebar]');
      const r = bar.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hierBox.x, hierBox.y, { button: 'right' }); await sleep(450);
    let t3c = await topMenuTitle(page);
    if (!t3c) {
      await page.keyboard.press('Escape'); await sleep(350);
      await page.mouse.click(hierBox.x, hierBox.y, { button: 'right' }); await sleep(600);
      t3c = await topMenuTitle(page);
    }
    await closeMenu(page);
    // 3d: 画布空白右键 —— 必须仍是画布菜单。⚠ 别写死 (900,500)：R101 起画布区被顶部
    //     按钮栏占一行，器件摆放的屏幕位置整体移动，写死坐标会落在器件上（实测弹出了
    //     「自定义门」菜单）。改成现取画布右下角空白。
    const blank = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const r = p.el.getBoundingClientRect();
      return { x: r.right - 40, y: r.bottom - 40 };
    });
    await page.mouse.click(blank.x, blank.y, { button: 'right' }); await sleep(450);
    const t3d = await topMenuTitle(page);
    await closeMenu(page);
    // R101：文件面板空白处右键菜单改为**照抄编译模式**的顺序（新建文件 / 新建文件夹 /
    // 导入文件… / 粘贴 / 刷新），首按钮不再是「导入文件...」
    (t3a === '[首按钮] 新建文件' && t3b === '部件' && t3c === '层次结构' && t3d === '画布')
      ? ok('[3] 侧栏三面板右键各有菜单（文件面板＝编译同款无标题头），画布右键弹画布菜单', `文件="${t3a}" 部件="${t3b}" 层次="${t3c}" 画布="${t3d}"`)
      : bad('[3] 右键菜单归属异常', JSON.stringify({ t3a, t3b, t3c, t3d }));

    // ===== [4] 序列化兜底：无 subcircuitGraph 的活内图也能带出 =====
    const ser = await page.evaluate(async () => {
      const mod = await import('/src/lib/sandboxSerialize.ts');
      const paper = window.__sandboxPaper;
      const sub = paper.model.getCells().filter(c => c.get('type') === 'Subcircuit')[0];
      if (!sub) return { ok: false, why: 'no subcell' };
      // 模拟编译模式的 Subcircuit：只有活 graph，没有 subcircuitGraph 属性
      const clone = { get: (k) => (k === 'subcircuitGraph' ? undefined : sub.get(k)), isLink: () => false };
      const liveGraph = sub.get('graph');
      const out = mod.serializePaperCells({ model: { getCells: () => [clone] } });
      const ser2 = out.cells.find(c => c.type === 'Subcircuit');
      return {
        ok: !!ser2?.subcircuitGraph?.cells?.length,
        n: ser2?.subcircuitGraph?.cells?.length || 0,
        liveCells: liveGraph ? liveGraph.getCells().length : -1,
        keys: ser2 ? Object.keys(ser2) : null,
        realSubGraph: !!sub.get('subcircuitGraph'),
      };
    });
    (ser.ok) ? ok('[4] 活内图序列化兜底生效（复制到沙盒不丢模块）', `inner cells=${ser.n}`)
      : bad('[4] 序列化兜底失败', JSON.stringify(ser));

    // ===== [5] 导入 .djs 自动注册内嵌自定义门 =====
    await clickActivity(page, 'files'); await sleep(600); // 导入输入框只在文件面板渲染
    const djs = JSON.stringify({
      cells: [{ id: 'imp1', type: 'Input', position: { x: 40, y: 40 }, bits: 1 }],
      customGates: [{ name: 'CARRIED', graphJson: JSON.stringify({ cells: [{ id: 'cg1', type: 'Input', position: { x: 10, y: 10 }, bits: 1, net: 'n' }] }) }],
    });
    await page.setInputFiles('input[type="file"][accept=".djs,.json"]', {
      name: 'carried.djs', mimeType: 'application/json', buffer: Buffer.from(djs),
    });
    await sleep(700);
    const carried = await page.evaluate(() => {
      // R39：部件注册为沙盒文件系统里 role:'part' 的可编辑 .djs 文件
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      return Object.values(files).some(f => f.role === 'part' && f.name === 'CARRIED.djs');
    });
    (carried) ? ok('[5] 导入 .djs 自动注册内嵌部件（可编辑 .djs）') : bad('[5] 部件未随文件注册');

    // ===== [6] 字号联动 =====
    const fsAt16 = await page.evaluate(() => {
      const bar = document.querySelector('[data-sandbox-sidebar]');
      const el = bar.querySelector('span');
      return parseFloat(getComputedStyle(el).fontSize);
    });
    await page.evaluate(() => localStorage.setItem('verilog-viz-font-size', '24'));
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    await clickActivity(page, 'sandbox'); await sleep(900);
    const fsAt24 = await page.evaluate(() => {
      const bar = document.querySelector('[data-sandbox-sidebar]');
      const el = bar.querySelector('span');
      return parseFloat(getComputedStyle(el).fontSize);
    });
    console.log(`    侧栏字号: 16px 根字号=${fsAt16}px, 24px 根字号=${fsAt24}px`);
    (fsAt24 > fsAt16 * 1.2) ? ok('[6] 文字大小调整联动沙盒侧栏', `${fsAt16}px → ${fsAt24}px`)
      : bad('[6] 侧栏字号未联动', JSON.stringify({ fsAt16, fsAt24 }));

    // ===== [8] 子模块右键「保存为自定义门」（复制到沙盒的绑定闭环）=====
    // 恢复 16px 根字号，避免影响后续定位
    await page.evaluate(() => localStorage.setItem('verilog-viz-font-size', '16'));
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    await clickActivity(page, 'sandbox'); await sleep(900);
    // 打开含子模块的文件（前面 BAD/G1 放置过的那个；导入 carried.djs 后可能切了活动文件，
    // 逐个找有 Subcircuit 的文件）
    const subFileId = await page.evaluate(() => {
      const files = Object.values(JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}'));
      const hit = files.find(f => {
        try { return JSON.parse(f.graphJson || '{}').cells?.some?.(c => c.type === 'Subcircuit'); } catch { return false; }
      });
      return hit?.id || null;
    });
    if (!subFileId) { bad('[8] 未找到含子模块的沙盒文件'); }
    else {
      await page.evaluate((id) => {
        localStorage.setItem('verilog-viz-sandbox-active', id);
      }, subFileId);
      await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
      await clickActivity(page, 'sandbox'); await sleep(1200);
      // 右键子模块 body（g 元素 bbox 被端口标签撑大 —— 用 body rect 中心）
      const bodyPt = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        const sub = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
        if (!sub) return null;
        const v = sub.findView(p);
        const body = v.el.querySelector('rect.body, rect, g.body') || v.el;
        const r = body.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (!bodyPt) { bad('[8] 画布上没有子模块'); }
      else {
        await page.mouse.click(bodyPt.x, bodyPt.y, { button: 'right' }); await sleep(500);
        const gateInput = page.locator('input[placeholder="部件名"]').first();
        if (!(await gateInput.count())) { bad('[8] 菜单里没有「保存为部件」输入项'); }
        else {
          await gateInput.fill('FROMSUB');
          await page.keyboard.press('Enter'); await sleep(600);
          const saved = await page.evaluate(() => {
            // R39：部件 = role:'part' 的可编辑 .djs 文件（graphJson.cells）
            const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
            const g = Object.values(files).find(x => x.role === 'part' && x.name === 'FROMSUB.djs');
            return g ? { cells: (() => { try { return (JSON.parse(g.graphJson).cells || []).filter(c => !c.isLink).length; } catch { return 0; } })() } : null;
          });
          (saved && saved.cells > 0) ? ok('[8] 子模块已另存为可编辑部件（含内部电路）', `cells=${saved.cells}`)
            : bad('[8] 保存部件失败', JSON.stringify(saved));
        }
        await closeMenu(page);
      }
    }

    // ===== [9] 「粘贴复制的电路」：import-clipboard 原样插入 =====
    const pasteJson = JSON.stringify({ cells: [
      { id: 'pi1', type: 'Input', position: { x: 40, y: 40 }, bits: 1, net: 'px' },
      { id: 'pl1', type: 'Lamp', position: { x: 200, y: 40 }, bits: 1 },
      { id: 'pw1', isLink: true, source: { id: 'pi1', port: 'out' }, target: { id: 'pl1', port: 'in' }, netname: 'PN', bits: 1 },
    ] });
    await page.evaluate((j) => localStorage.setItem('verilog-viz-import-clipboard', j), pasteJson);
    const cntBefore = await page.evaluate(() => window.__sandboxPaper.model.getCells().length);
    // 找一个确定不在任何器件/连线上的空白点（画布右下角往内 60px）
    const blankPt = await page.evaluate(() => {
      const w = document.querySelector('[data-sandbox-wrapper]');
      const r = w.getBoundingClientRect();
      return { x: r.right - 70, y: r.bottom - 70 };
    });
    await page.mouse.click(blankPt.x, blankPt.y, { button: 'right' }); await sleep(450);
    const dbgMenu = await page.evaluate(() => {
      const menus = Array.from(document.querySelectorAll('div'))
        .filter(d => getComputedStyle(d).position === 'fixed' && d.querySelector('button, input'));
      const m = menus[menus.length - 1];
      return m ? m.textContent?.slice(0, 260) : null;
    });
    console.log('    [9] 右键菜单内容:', dbgMenu);
    const pasteBtn = page.locator('button:has-text("粘贴复制的电路")').first();
    if (!(await pasteBtn.count())) { bad('[9] 画布菜单没有「粘贴复制的电路」'); }
    else {
      await pasteBtn.click(); await sleep(1000);
      const cntAfter = await page.evaluate(() => window.__sandboxPaper.model.getCells().length);
      const idsOk = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        const lamp = p.model.getCells().find(c => c.get('type') === 'Lamp' && c.get('net') !== 'p?');
        // 验证 id 重映射：插入后不存在裸 id 'pi1'/'pl1'（应有 _N 批号后缀）
        const ids = new Set(p.model.getCells().map(c => String(c.id)));
        return !ids.has('pi1') && !ids.has('pl1') && p.model.getLinks().length > 0;
      });
      (cntAfter > cntBefore && idsOk) ? ok('[9] 复制的电路已原样粘贴（id 重映射 + 连线完整）', `${cntBefore} → ${cntAfter}`)
        : bad('[9] 粘贴异常', JSON.stringify({ cntBefore, cntAfter, idsOk }));
    }

    // ===== [7] 无页面异常 =====
    errors.length === 0 ? ok('[7] 全程无页面异常') : bad('[7] 有页面异常', errors[0].slice(0, 160));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
