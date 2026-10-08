// R40 验收：子部件布局（不堆叠）+ 线路渲染 + 展开图只读钻取（沙盒 + 编译模式共用）
//  [1] 复制到沙盒的子部件 part 文件：坐标多样（不堆叠）
//  [2] 子部件画布与快捷展开图：连线真实渲染（renderedConns == modelLinks）
//  [3] 沙盒展开图只读：器件不可拖动、开关不可切换，但能继续钻取子部件
//  [4] 编译模式子部件快捷展开图：拦截内置弹窗 → 只读预览，可钻取
//  [5] 全程无页面异常
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const UI = require('./_ui.cjs');   // clickZoomInto：放大镜这一族的落点 owner
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1494;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1494)); } catch { }
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
const clickActivity = async (page, key) => { await page.locator(`button[data-activity="${key}"]`).first().click(); await sleep(700); };
const ensureSandbox = async (page) => { if (!await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]'))) await clickActivity(page, 'sandbox'); await sleep(1300); };
const clearKeys = (page) => page.evaluate(() => {
  ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings',
   'verilog-viz-sandbox-w','verilog-viz-sandbox-folders','verilog-viz-font-size','verilog-viz-gates-migrated',
   'verilog-viz-inline-migrated','verilog-viz-gatefiles-migrated','verilog-viz-import-clipboard',
   'verilog-viz-files','verilog-viz-folders'].forEach(k => localStorage.removeItem(k));
});
const VERILOG = `module top(input p, input q, output r);
  sub1 s1(.x(p), .z(q), .w(r));
endmodule
module sub1(input x, input z, output w);
  wire t;
  sub2 u1(.a(x), .b(z), .y(t));
  sub2 u2(.a(t), .b(z), .y(w));
endmodule
module sub2(input a, input b, output y);
  assign y = a & b;
endmodule
`;
(async () => {
  let server, browser;
  try {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { const t = m.text() || ''; if (t.includes('内部电路') || t.includes('渲染失败')) console.log('  CONSOLE:', t.slice(0, 300)); });
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    await clearKeys(page); await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    const fileId = await page.evaluate((code) => (async () => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const f = fileStore.createFile('adder_top.v'); fileStore.saveContent(f.id, code); return f.id;
    })(), VERILOG);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 1500 }); } catch {}
    await page.locator('[title="adder_top.v"]').first().click(); await sleep(1000);
    await page.locator('button[title^="编译"]').first().click();
    for (let i = 0; i < 40; i++) { await sleep(500); const c = await page.evaluate(async (id) => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getById(id); return !!(f && f.status === 'compiled' && f.circuitJson); }, fileId); if (c) break; }

    // ===== [4] 编译模式子部件快捷展开图（只读预览）=====
    // ⚠ 落点**不许缓存**，也**不许换成 locator.click**（两种读数的解释都写在
    //   tests/_ui.cjs 的 clickZoomInto 文件头）：编译就绪后画布还要做一次"适应窗口"，
    //   旧写法量完 rect 再去点 ⇒ 点空；同一颗夹具两次跑出两种脸（一次 modal:false、
    //   一次连工具栏的「复制到沙盒」都等不到）。locator 那条则是 4/4 超时：放大镜在
    //   joint 工具层里 computed visibility=hidden，Playwright 的动作性检查过不去。
    const zoomCount = () => page.evaluate(() => Array.from(document.querySelectorAll('a.zoom'))
      .filter((a) => a.getBoundingClientRect().width > 0).length);
    let zoomsSeen = 0;
    for (let a = 0; a < 10; a++) { zoomsSeen = await zoomCount(); if (zoomsSeen > 0) break; await sleep(600); }
    if (!zoomsSeen) bad('[4] 编译模式画布上找不到子部件放大镜', `可见 a.zoom=${zoomsSeen}`);
    else {
      const z = await UI.clickZoomInto(page);
      console.log(`  [4] 放大镜第 ${z.tries} 次${z.opened ? '起窗' : '仍没起窗'}${z.why.length ? ' ｜ ' + z.why.join(' ｜ ') : ''}`);
      const cm = await page.evaluate(() => {
        const host = document.querySelector('[data-inner-host]');
        if (!host) return { modal: false };
        const paper = window.__innerPaper;
        return {
          modal: true,
          hostHtmlLen: host.innerHTML.length,
          hostSvg: !!host.querySelector('svg'),
          modalText: (document.body.textContent || '').match(/内部电路渲染失败[^\n]{0,120}/)?.[0] || '',
          devs: paper ? paper.model.getElements().length : 0,
          links: paper ? paper.model.getLinks().length : 0,
          renderedConns: host.querySelectorAll('.connection').length,
          pointerEvents: paper && paper.el ? paper.el.style.pointerEvents : null,
          btnfaceBlocked: paper && paper.el && paper.el.querySelectorAll('.btnface').length
            ? Array.from(paper.el.querySelectorAll('.btnface')).every(e => getComputedStyle(e).pointerEvents === 'none')
            : 'no-btnface',
          draggable: paper ? paper.model.getElements().every(e => e.get('draggable') === false) : null,
          subs: paper ? paper.model.getCells().filter(c => c.get('type') === 'Subcircuit').length : 0,
        };
      });
      console.log('  compilePreview:', JSON.stringify(cm));
      (cm.modal && cm.devs > 0 && cm.draggable && cm.btnfaceBlocked && cm.renderedConns > 0)
        ? ok('[4] 编译模式子部件展开图=只读预览（禁拖动/禁开关）+ 线路渲染', `devs=${cm.devs} conns=${cm.renderedConns} btnfaceBlocked=${cm.btnfaceBlocked} draggable=${cm.draggable}`)
        : bad('[4] 编译模式只读预览异常', JSON.stringify(cm));
      // 钻取下级 sub2（同一套"等画面停 + 现量现点"，弹窗内那张画布也要适应窗口）
      if (cm.subs > 0) {
        const crumbUp = () => page.evaluate(() => Array.from(document.querySelectorAll('button'))
          .some((b) => (b.textContent || '').trim() === 'sub2'));
        const z2 = await UI.clickZoomInto(page, { within: '[data-inner-host]', openedSelector: crumbUp });
        console.log(`  [4b] 内层放大镜第 ${z2.tries} 次${z2.opened ? '钻下去' : '没钻下去'}${z2.why.length ? ' ｜ ' + z2.why.join(' ｜ ') : ''}`);
        if (z2.opened) {
          await sleep(600);
          const cm2 = await page.evaluate(() => {
            const paper = window.__innerPaper; if (!paper) return null;
            return { devs: paper.model.getElements().length, crumb: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t === 'sub2').length };
          });
          (cm2 && cm2.crumb >= 1) ? ok('[4b] 编译模式展开图可继续钻取子部件（面包屑）', `devs=${cm2.devs}`)
            : bad('[4b] 编译模式钻取失败', JSON.stringify(cm2));
        } else bad('[4b] 内层放大镜点不动（重试都没钻下去）', JSON.stringify(z2.why));
      }
      await page.keyboard.press('Escape'); await sleep(500);
    }

    // ===== [1][2][3] 复制到沙盒 → 子部件布局/线路/只读 =====
    await page.locator('button[title*="复制到沙盒"]').first().click(); await sleep(3000);
    const layout = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const out = {};
      for (const f of Object.values(files)) {
        if (f.role !== 'part') continue;
        const cells = (() => { try { return JSON.parse(f.graphJson || '{}').cells || []; } catch { return []; } })();
        const nodes = cells.filter(c => !c.isLink);
        out[f.name] = { distinctX: new Set(nodes.map(c => Math.round(c.position?.x ?? -999))).size, nodes: nodes.length, links: cells.filter(c => c.isLink).length };
      }
      return out;
    });
    const partLayouts = Object.entries(layout);
    (partLayouts.length >= 2 && partLayouts.every(([, v]) => v.distinctX > 1))
      ? ok('[1] 子部件 part 文件坐标多样（不再堆叠）', partLayouts.map(([k, v]) => `${k}:x${v.distinctX}`).join(' '))
      : bad('[1] 子部件仍堆叠', JSON.stringify(layout));

    // 打开 sub1.djs 画布，检查连线渲染 + 打开展开图
    await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const p = Object.values(files).find(f => f.name === 'adder_top/sub1.djs');
      if (p) localStorage.setItem('verilog-viz-sandbox-active', p.id);
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    await ensureSandbox(page); await sleep(900);
    const cv = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      return { links: p.model.getLinks().length, conns: p.el ? p.el.querySelectorAll('.connection').length : 0 };
    });
    (cv && cv.links > 0 && cv.conns === cv.links) ? ok('[2a] 子部件画布连线渲染完整', `links=${cv.links} conns=${cv.conns}`)
      : bad('[2a] 子部件画布连线缺失', JSON.stringify(cv));

    const zb = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      const sub = p.model.getCells().find(c => c.get('type') === 'Subcircuit'); if (!sub) return null;
      const v = sub.findView(p); const za = v.el?.querySelector?.('a.zoom'); if (!za) return null;
      const r = za.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!zb) bad('[3] 沙盒画布找不到子部件放大镜');
    else {
      await page.mouse.click(zb.x, zb.y); await sleep(1600);
      const sb = await page.evaluate(() => {
        const paper = window.__innerPaper; if (!paper) return null;
        const svg = paper.el;
        return {
          devs: paper.model.getElements().length, links: paper.model.getLinks().length,
          conns: svg ? svg.querySelectorAll('.connection').length : 0,
          pe: paper.el ? paper.el.style.pointerEvents : null,
          btnfaceBlocked: paper.el.querySelectorAll('.btnface').length
            ? Array.from(paper.el.querySelectorAll('.btnface')).every(e => getComputedStyle(e).pointerEvents === 'none')
            : 'no-btnface',
          draggable: paper.model.getElements().every(e => e.get('draggable') === false),
        };
      });
      console.log('  sandboxPreview:', JSON.stringify(sb));
      (sb && sb.devs > 0 && sb.btnfaceBlocked && sb.draggable && sb.links > 0 && sb.conns === sb.links)
        ? ok('[2b][3] 沙盒展开图=只读（禁拖动/禁开关）+ 线路渲染', `devs=${sb.devs} links=${sb.links} conns=${sb.conns}`)
        : bad('[2b][3] 沙盒展开图异常', JSON.stringify(sb));
      await page.keyboard.press('Escape'); await sleep(400);
    }

    errors.length ? bad('[5] 存在页面异常', errors.slice(0, 3).join(' | ')) : ok('[5] 全程无页面异常');

    // ===== [6] 沙盒侧栏与编译模式对齐 =====
    if (!await page.evaluate(() => !!document.querySelector('[data-sandbox-filetree]'))) await clickActivity(page, 'files');
    await sleep(800);
    const tree = await page.evaluate(() => {
      const t = document.querySelector('[data-sandbox-filetree]');
      if (!t) return null;
      const folder = t.querySelector('[data-sbfolder]');
      const file = t.querySelector('[data-sbfile]');
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const fcs = file ? cs(file) : null;
      return {
        hasFolder: !!folder, hasFile: !!file,
        // 编译模式特征：accent-muted 底 + 2px 左高亮条 + 14px 缩进步长 + hover 类
        activeBorderLeft: fcs ? fcs.borderLeftWidth : null,
        activeBorderColor: fcs ? fcs.borderLeftColor : null,
        rowPadLeft: file ? getComputedStyle(file).paddingLeft : null,
        hasRenameBtn: !!(file && file.querySelector('.sb-rename-btn')),
        fileRowClass: file ? file.className : null,
        dragMimeFoldersDraggable: folder ? folder.getAttribute('draggable') : null,
        rootOutlineStyle: cs(t) ? cs(t).outlineStyle : null,
      };
    });
    console.log('  TREE:', JSON.stringify(tree));
    (tree && tree.hasFolder && tree.hasFile && tree.hasRenameBtn && tree.activeBorderLeft === '2px'
      && tree.fileRowClass.includes('sb-file-row') && tree.dragMimeFoldersDraggable === 'true')
      ? ok('[6] 沙盒侧栏与编译模式对齐（图标/左高亮条/hover重命名/文件夹可拖/根投放区）', `borderLeft=${tree.activeBorderLeft} pad=${tree.rowPadLeft}`)
      : bad('[6] 沙盒侧栏未对齐', JSON.stringify(tree));
  } catch (e) { console.log('FATAL', e); fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
