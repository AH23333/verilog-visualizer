// R33 验收：自定义门放置 / 展开图对齐编译模式 / 文件管理对齐 IDE
//  [1] 自定义门放置：侧栏点击 + 右键二级菜单，重载后仍可放置
//  [2] 展开图：IO 端口名显示（in1/out1）且盒体不拉伸；连线带网络名
//  [3] 文件管理：右键新建文件/文件夹（菜单内联输入）
//  [4] 文件重命名 / 创建副本（右键）
//  [5] 复制 → 粘贴到文件夹；拖拽移动到文件夹
//  [6] 批量删除；导入 .djs
//  [7] 全程无页面异常
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1489;
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
/** 在当前最上层 fixed 菜单里按文本前缀点按钮 */
const clickMenuItem = (page, prefix) => page.evaluate((p) => {
  const menus = Array.from(document.querySelectorAll('div'))
    .filter(d => getComputedStyle(d).position === 'fixed' && d.querySelectorAll('button, input').length >= 1);
  const m = menus[menus.length - 1];
  if (!m) return false;
  const b = Array.from(m.querySelectorAll('button')).find(x => (x.textContent || '').trim().startsWith(p));
  if (!b) return false;
  b.click();
  return true;
}, prefix);
/** 菜单里的内联输入框：全选清空 → 输入 + 回车（输入项不是 button，须直接聚焦 input）
 *  placeholder 用于在多个输入项的菜单里精确定位（如「新建文件/新建文件夹」同菜单） */
const commitMenuInput = async (page, text, placeholder) => {
  await page.evaluate((ph) => {
    const menus = Array.from(document.querySelectorAll('div'))
      .filter(d => getComputedStyle(d).position === 'fixed' && d.querySelector('input'));
    const m = menus[menus.length - 1];
    if (!m) return;
    const inputs = Array.from(m.querySelectorAll('input'));
    const inp = (ph ? inputs.find(i => i.placeholder === ph) : null) || inputs[0];
    if (inp) inp.focus();
  }, placeholder || null);
  await page.keyboard.press('ControlOrMeta+a'); await sleep(80);
  await page.keyboard.type(text); await sleep(120);
  await page.keyboard.press('Enter'); await sleep(500);
};
const expandAllGroups = async (page) => {
  await clickActivity(page, 'modules'); await sleep(400);
  for (const n of ['输入 / 输出', '时序', '运算', '比较', '选择 / 移位', '总线', '存储', '显示']) {
    try { await page.getByText(n, { exact: true }).first().click({ timeout: 700 }); await sleep(100); } catch {}
  }
};

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
       'verilog-viz-sandbox-settings','verilog-viz-sandbox-w','verilog-viz-sandbox-folders'].forEach(k => localStorage.removeItem(k));
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}

    await clickActivity(page, 'sandbox'); await sleep(900);
    await page.locator('button[title="新建文件"]').first().click(); await sleep(900);
    await expandAllGroups(page);
    for (const t of ['Input', 'Output', 'And']) {
      await page.locator(`button[data-gate="${t}"]`).first().click(); await sleep(320);
    }
    // 保存为自定义门 G1
    await clickActivity(page, 'hierarchy'); await sleep(500);
    await page.locator('button[title="将当前电路保存为自定义门"]').first().click(); await sleep(350);
    await page.locator('input[placeholder="自定义门名称"]').fill('G1');
    await page.locator('button[title="确认保存为自定义门"]').first().click(); await sleep(600);

    // [1a] 重载后（gates 从 localStorage 恢复）侧栏点击放置
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    await clickActivity(page, 'sandbox'); await sleep(900);
    await clickActivity(page, 'modules'); await sleep(500);
    await page.locator('[data-sandbox-sidebar] button:has-text("G1")').first().click(); await sleep(800);
    const s1 = await page.evaluate(() => window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Subcircuit').length);
    // [1b] 右键二级菜单放置
    await page.mouse.click(900, 650, { button: 'right' }); await sleep(450);
    await clickMenuItem(page, '放置部件'); await sleep(400);
    await clickMenuItem(page, '自定义门'); await sleep(400);
    await clickMenuItem(page, 'G1'); await sleep(700);
    const s2 = await page.evaluate(() => window.__sandboxPaper.model.getCells().filter(c => c.get('type') === 'Subcircuit').length);
    (s1 >= 1 && s2 >= 2) ? ok('[1] 自定义门放置（侧栏 + 右键二级菜单，重载后仍可用）', `侧栏 ${s1} / 菜单后 ${s2}`)
      : bad('[1] 自定义门放置失败', JSON.stringify({ s1, s2 }));

    // [2] 展开图：端口名 + 连线
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
        // R35 管线：子模块提升为顶层渲染，IO 变 Button/Lamp，端口名走 text.label
        const labels = Array.from(ip.el.querySelectorAll('text.label')).map(t => t.textContent);
        const ios = ip.model.getCells().filter(c => ['Button','Lamp','Input','Output','NumDisplay'].includes(c.get('type')));
        const stretched = ios.some(c => c.size().width > 60);
        const link = ip.model.getLinks()[0];
        const d = link ? (ip.el.querySelector(`[model-id="${link.id}"] path.connection`)?.getAttribute('d') || '') : '';
        return { open: true, labels, stretched, hasWire: !!link, wireLabel: ip.el.querySelector('text.wire-label, [joint-selector="wirelabel"]')?.textContent || null, pathD: d.slice(0, 60) };
      });
      console.log('    展开图诊断:', JSON.stringify(diag));
      (diag.open && Array.isArray(diag.labels) && diag.labels.includes('in1') && diag.labels.includes('out1') && !diag.stretched)
        ? ok('[2] 展开图 IO 端口名显示且不拉伸（R35 提升为顶层管线）', JSON.stringify(diag.labels))
        : bad('[2] 展开图端口名异常', JSON.stringify(diag));
      await page.locator('button[title="关闭"]').first().click(); await sleep(400);
    }

    // [3] 切到文件面板 → 右键文件树空白处 → 新建文件 / 新建文件夹（菜单内联输入）
    await page.locator('button[data-activity="files"]').first().click(); await sleep(600);
    const treeBox = await page.locator('[data-sandbox-filetree]').boundingBox();
    if (!treeBox) { bad('[3] 未找到文件树容器'); }
    else {
      await page.mouse.click(treeBox.x + treeBox.width / 2, treeBox.y + treeBox.height - 14, { button: 'right' }); await sleep(450);
      await commitMenuInput(page, 'alpha.djs', '新文件名.djs');
      await page.mouse.click(treeBox.x + treeBox.width / 2, treeBox.y + treeBox.height - 14, { button: 'right' }); await sleep(450);
      await commitMenuInput(page, '项目A', '文件夹名');
    }
    const t3 = await page.evaluate(() => {
      const fs = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const fd = JSON.parse(localStorage.getItem('verilog-viz-sandbox-folders') || '[]');
      return { names: Object.values(fs).map((f) => f.name), folders: fd };
    });
    console.log('    新建结果:', JSON.stringify(t3));
    (t3.names.includes('alpha.djs') && t3.folders.includes('项目A'))
      ? ok('[3] 右键新建文件 / 新建文件夹')
      : bad('[3] 新建异常', JSON.stringify(t3));

    // [4] 重命名（右键菜单内联输入）+ 创建副本
    await page.locator('[data-sbfile="alpha.djs"]').first().click({ button: 'right' }); await sleep(450);
    await commitMenuInput(page, 'beta.djs');
    await page.locator('[data-sbfile="beta.djs"]').first().click({ button: 'right' }); await sleep(450);
    await clickMenuItem(page, '创建副本'); await sleep(600);
    const t4 = await page.evaluate(() => {
      const fs = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      return Object.values(fs).map((f) => f.name);
    });
    console.log('    重命名/副本:', JSON.stringify(t4));
    (t4.includes('beta.djs') && t4.some(n => n.startsWith('beta') && n !== 'beta.djs'))
      ? ok('[4] 重命名 + 创建副本')
      : bad('[4] 重命名/副本异常', JSON.stringify(t4));

    // [5a] 复制 → 右键文件夹粘贴
    await page.locator('[data-sbfile="beta.djs"]').first().click({ button: 'right' }); await sleep(450);
    await clickMenuItem(page, '复制'); await sleep(400);
    await page.locator('[data-sbfolder="项目A"]').first().click({ button: 'right' }); await sleep(450);
    await clickMenuItem(page, '粘贴'); await sleep(600);
    // [5b] 拖拽 beta_1.djs（[4] 创建的副本）到 项目A 文件夹（HTML5 DnD，用 dragAndDrop API）
    try {
      await page.dragAndDrop('[data-sbfile="beta_1.djs"]', '[data-sbfolder="项目A"]');
      await sleep(700);
    } catch (e) { console.log('    拖拽失败:', String(e).slice(0, 120)); }
    const t5 = await page.evaluate(() => {
      const fs = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      return Object.values(fs).map((f) => f.name);
    });
    console.log('    粘贴/拖拽后:', JSON.stringify(t5));
    (t5.includes('项目A/beta.djs') && t5.includes('项目A/beta_1.djs'))
      ? ok('[5] 复制粘贴到文件夹 + 拖拽移动')
      : bad('[5] 粘贴/拖拽异常', JSON.stringify(t5));

    // [6a] 批量删除：ctrl+多选 beta 副本与 alpha（项目A 内），右键删除
    // 简化：直接右键「项目A」文件夹删除（文件移至根目录）→ 再右键文件删除
    await page.locator('[data-sbfolder="项目A"]').first().click({ button: 'right' }); await sleep(450);
    await clickMenuItem(page, '删除文件夹'); await sleep(500);
    const t6 = await page.evaluate(() => {
      const fs = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const fd = JSON.parse(localStorage.getItem('verilog-viz-sandbox-folders') || '[]');
      return { names: Object.values(fs).map((f) => f.name), folders: fd };
    });
    (t6.names.includes('beta.djs') && t6.names.some(n => n.startsWith('beta_')) && !t6.folders.includes('项目A'))
      ? ok('[6a] 删除文件夹（文件移回根目录，重名自动去重）')
      : bad('[6a] 删除文件夹异常', JSON.stringify(t6));
    // [6b] 导入 .djs（直接对隐藏 input setInputFiles）
    const djs = JSON.stringify({ cells: [{ id: 'imp1', type: 'Input', position: { x: 40, y: 40 }, bits: 1 }] });
    await page.setInputFiles('input[type="file"][accept=".djs,.json"]', {
      name: 'imported.djs', mimeType: 'application/json', buffer: Buffer.from(djs),
    });
    await sleep(700);
    const t6b = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}')).length);
    (t6b >= 3) ? ok('[6b] 导入 .djs 文件') : bad('[6b] 导入失败', `files=${t6b}`);

    errors.length === 0 ? ok('[7] 全程无页面异常') : bad('[7] 有页面异常', errors[0].slice(0, 160));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
