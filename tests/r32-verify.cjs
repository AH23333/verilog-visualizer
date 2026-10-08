// R32 验收：侧栏可调宽度 / 进入沙盒保持面板语境 / 自定义门保存+展开 / 二级菜单 / 复制到沙盒
//  [1] 沙盒左侧栏宽度可拖拽调整（160–420px）并持久化
//  [2] 进入沙盒时保持进入前的面板语境（文件→文件 / 模块→部件 / 层次结构→层次结构）
//  [3] 保存自定义门：Input+Output → 存档含内部电路 JSON
//  [4] 右键「放置部件」二级分类导航 + 自定义门分组；点击分类项能放置器件
//  [5] 自定义门放入画布 + 放大镜展开内部电路模态框
//  [6] 左侧部件库分组默认折叠、点组头展开
//  [7] 主模式编译出的电路一键「复制到沙盒」并在沙盒画布重建
//  [8] 全程无页面异常
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1482;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1482)); } catch { }
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
const inSandbox = (page) => page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]'));
/** 沙盒侧栏标题（文件 / 部件 / 层次结构） */
const sidebarTitle = (page) => page.evaluate(() => {
  const bar = document.querySelector('[data-sandbox-sidebar]');
  if (!bar) return null;
  const span = Array.from(bar.querySelectorAll('span'))
    .find(s => ['文件', '部件', '层次结构'].includes((s.textContent || '').trim()));
  return span ? span.textContent.trim() : null;
});

(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    await page.evaluate(() => {
      ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates',
       'verilog-viz-sandbox-settings','verilog-viz-sandbox-w'].forEach(k => localStorage.removeItem(k));
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}

    // ========== [2] 面板语境保持：files → 文件 / modules → 部件 / hierarchy → 层次结构 ==========
    await clickActivity(page, 'sandbox'); await sleep(800);
    const t1 = await sidebarTitle(page);
    await clickActivity(page, 'sandbox'); await sleep(600);           // 退出
    await clickActivity(page, 'modules'); await sleep(400);           // IDE 切到「模块」
    await clickActivity(page, 'sandbox'); await sleep(800);
    const t2 = await sidebarTitle(page);
    await clickActivity(page, 'sandbox'); await sleep(600);           // 退出
    await clickActivity(page, 'hierarchy'); await sleep(400);         // IDE 切到「层次结构」
    await clickActivity(page, 'sandbox'); await sleep(800);
    const t3 = await sidebarTitle(page);
    console.log('    语境保持:', JSON.stringify({ t1, t2, t3 }));
    (t1 === '文件' && t2 === '部件' && t3 === '层次结构')
      ? ok('[2] 进入沙盒保持进入前的面板语境')
      : bad('[2] 沙盒面板语境异常', JSON.stringify({ t1, t2, t3 }));

    // ========== [1] 侧栏宽度可拖拽调整 + 持久化 ==========
    const w0 = await page.evaluate(() => document.querySelector('[data-sandbox-sidebar]').getBoundingClientRect().width);
    const handleBox = await page.evaluate(() => {
      const bar = document.querySelector('[data-sandbox-sidebar]');
      const h = bar.querySelector('div[title="拖动调整宽度"]');
      const r = h.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      // 手柄只有外露在侧栏右缘之外的部分接收事件（内容容器盖住内侧 3px）
      return { x: br.right + 1, y: br.top + br.height / 2, hasHandle: !!h };
    });
    if (!handleBox.hasHandle) { bad('[1] 未找到拖拽手柄'); throw new Error('no handle'); }
    await page.mouse.move(handleBox.x, handleBox.y);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 90, handleBox.y, { steps: 8 });
    await page.mouse.up(); await sleep(300);
    const w1 = await page.evaluate(() => ({
      w: document.querySelector('[data-sandbox-sidebar]').getBoundingClientRect().width,
      saved: parseFloat(localStorage.getItem('verilog-viz-sandbox-w') || ''),
    }));
    // 往回拖过头，验证下限 180（R115a 起与编译模式侧栏同区间 180–500）
    await page.mouse.move(handleBox.x + 90, handleBox.y);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 90 - 500, handleBox.y, { steps: 10 });
    await page.mouse.up(); await sleep(300);
    const w2 = await page.evaluate(() => ({
      w: document.querySelector('[data-sandbox-sidebar]').getBoundingClientRect().width,
      saved: parseFloat(localStorage.getItem('verilog-viz-sandbox-w') || ''),
    }));
    console.log('    侧栏宽度:', JSON.stringify({ w0, w1, w2 }));
    (Math.abs(w0 - 240) < 6 && Math.abs(w1.w - (w0 + 90)) < 8 && Math.abs(w1.saved - w1.w) < 2
      && Math.abs(w2.w - 180) < 6)
      ? ok('[1] 侧栏拖拽调宽生效且持久化', `${w0} → ${Math.round(w1.w)} → ${Math.round(w2.w)}（下限 160）`)
      : bad('[1] 侧栏调宽异常', JSON.stringify({ w0, w1, w2 }));

    // ========== [3] 新建文件 + 放 IO + 保存自定义门 ==========
    await UI.newSandboxFile(page);
    await clickActivity(page, 'modules'); await sleep(500);
    // 「输入 / 输出」分组默认折叠 → 点组头展开
    await page.getByText('输入 / 输出', { exact: true }).first().click(); await sleep(400);
    await require('./_ui.cjs').clickGate(page, 'Input'); await sleep(400);
    await require('./_ui.cjs').clickGate(page, 'Output'); await sleep(400);
    const io = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); by[t] = (by[t] || 0) + 1; });
      return by;
    });
    (io.Input >= 1 && io.Output >= 1) ? ok('[3a] 放置 Input + Output') : bad('[3a] IO 放置失败', JSON.stringify(io));

    await clickActivity(page, 'hierarchy'); await sleep(500);
    await page.locator('button[title="将当前电路保存为自定义门"]').first().click(); await sleep(400);
    await page.locator('input[placeholder="自定义门名称"]').fill('MyGate32');
    await page.locator('button[title="确认保存为自定义门"]').first().click(); await sleep(600);
    const gateSaved = await page.evaluate(() => {
      // R39：部件 = 沙盒文件系统里 role:'part' 的可编辑 .djs 文件（cells 画布格式）
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const g = Object.values(files).find(f => f.role === 'part' && /MyGate32\.djs$/.test(f.name));
      if (!g) return null;
      let types = []; try { types = (JSON.parse(g.graphJson).cells || []).filter(c => !c.isLink).map(c => c.type); } catch {}
      return { name: 'MyGate32', name2: g.name, types };
    });
    (gateSaved && gateSaved.types.includes('Input') && gateSaved.types.includes('Output'))
      ? ok('[3b] 部件保存：可编辑 .djs 部件文件含内部电路', `${gateSaved.name2} · ${gateSaved.types.length} cells`)
      : bad('[3b] 部件保存异常', JSON.stringify(gateSaved));

    // ========== [4] 右键二级分类导航 + 自定义门分组 ==========
    await page.mouse.click(760, 460, { button: 'right' }); await sleep(500);
    await page.locator('button:has-text("放置部件")').first().click(); await sleep(500);
    const catsRaw = await page.evaluate(() => {
      const menus = Array.from(document.querySelectorAll('div'))
        .filter(d => getComputedStyle(d).position === 'fixed' && d.querySelectorAll('button').length > 3);
      const m = menus[menus.length - 1];
      return m ? Array.from(m.querySelectorAll('button')).map(b => (b.textContent || '').trim()) : null;
    });
    // hint（type / ▶）拼在 label 后面，剥离后比对
    const cats = catsRaw && catsRaw.map(t => t.replace(/▶$/, '').trim());
    console.log('    分类菜单:', JSON.stringify(catsRaw));
    const wantCats = ['逻辑门', '输入 / 输出', '时序', '运算', '比较', '选择 / 移位', '总线', '存储', '显示', '自定义门'];
    (cats && wantCats.every(c => cats.includes(c)) && !cats.includes('And'))
      ? ok('[4a] 放置部件为二级分类导航（含自定义门，不再平铺全部器件）')
      : bad('[4a] 分类菜单异常', JSON.stringify(cats));

    // 进「时序」分类 → 放一个 D 触发器（验证分类项可放置）
    await page.locator('button:has-text("时序")').first().click(); await sleep(500);
    const seqMenu = await page.evaluate(() => {
      const menus = Array.from(document.querySelectorAll('div'))
        .filter(d => getComputedStyle(d).position === 'fixed' && d.querySelectorAll('button').length > 2);
      const m = menus[menus.length - 1];
      return m ? Array.from(m.querySelectorAll('button')).map(b => (b.textContent || '').trim()) : null;
    });
    (seqMenu && seqMenu.includes('← 返回分类') && seqMenu.some(l => l.includes('触发器')))
      ? ok('[4b] 分类 → 组内器件列表（带返回）', `${seqMenu.length} 项`)
      : bad('[4b] 组内列表异常', JSON.stringify(seqMenu));
    await page.locator('button:has-text("触发器")').first().click(); await sleep(600);
    const dffPlaced = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return p.model.getCells().filter(c => c.get('type') === 'Dff').length;
    });
    (dffPlaced >= 1) ? ok('[4c] 从二级菜单放置 D 触发器') : bad('[4c] 二级菜单放置失败', `dff=${dffPlaced}`);

    // ========== [5] 自定义门放入画布 + 展开内部电路 ==========
    // 注意：Dff 刚被放在 (760,460)，这里换个空白点右键，避免落在器件上弹出门器件菜单
    await page.mouse.click(980, 620, { button: 'right' }); await sleep(400);
    await page.locator('button:has-text("放置部件")').first().click(); await sleep(400);
    // 菜单按钮文本是「自定义门▶」（label+hint）；has-text 会误匹配侧栏的「保存为自定义门」。
    // 这里直接在"最上层 fixed 菜单容器"里按文本前缀找按钮并点击（与断言同一套定位逻辑）。
    const clickMenuItem = async (prefix) => page.evaluate((p) => {
      // 注意：自定义门子菜单只有 2 个按钮（返回分类 + 门项），阈值用 >= 2
      const menus = Array.from(document.querySelectorAll('div'))
        .filter(d => getComputedStyle(d).position === 'fixed' && d.querySelectorAll('button').length >= 2);
      const m = menus[menus.length - 1];
      if (!m) return false;
      const b = Array.from(m.querySelectorAll('button'))
        .find(x => (x.textContent || '').trim().startsWith(p));
      if (!b) return false;
      b.click();
      return true;
    }, prefix);
    (await clickMenuItem('自定义门')) ? await sleep(400) : bad('[5] 分类菜单里没有「自定义门」');
    (await clickMenuItem('MyGate32')) ? await sleep(700) : bad('[5] 自定义门列表里没有 MyGate32');
    const subPlaced = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const subs = p.model.getCells().filter(c => c.get('type') === 'Subcircuit');
      return subs.length;
    });
    (subPlaced >= 1) ? ok('[5a] 自定义门以 Subcircuit 放入画布') : bad('[5a] 自定义门放置失败', `subs=${subPlaced}`);

    // 点放大镜 a.zoom → 内部电路模态框
    const zoomPt = subPlaced >= 1 ? await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const sub = p.model.getCells().filter(c => c.get('type') === 'Subcircuit')[0];
      if (!sub) return null;
      const v = sub.findView(p);
      const za = v.el?.querySelector?.('a.zoom');
      if (!za) return null;
      const r = za.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }) : null;
    if (subPlaced < 1) {
      bad('[5b] 无自定义门可展开（未放置成功）');
    } else if (zoomPt) {
      await page.mouse.click(zoomPt.x, zoomPt.y); await sleep(1200);
      const inner = await page.evaluate(() => {
        const host = document.querySelector('[data-inner-host]');
        const title = Array.from(document.querySelectorAll('span'))
          .find(s => (s.textContent || '').startsWith('内部电路：'));
        const svg = host ? host.querySelector('svg') : null;
        return { open: !!host, hasSvg: !!svg, title: title ? title.textContent.trim() : null };
      });
      (inner.open && inner.hasSvg && (inner.title || '').includes('MyGate32'))
        ? ok('[5b] 放大镜展开内部电路模态框', inner.title)
        : bad('[5b] 展开模态框异常', JSON.stringify(inner));
      await page.locator('button[title="关闭"]').first().click(); await sleep(400);
    } else {
      bad('[5b] 未找到放大镜 a.zoom');
    }

    // ========== [6] 部件库分组折叠：默认只开「逻辑门」 ==========
    await clickActivity(page, 'modules'); await sleep(500);
    // 收起 [3] 里展开过的「输入 / 输出」，恢复到默认只有「逻辑门」展开的状态
    await page.getByText('输入 / 输出', { exact: true }).first().click(); await sleep(400);
    const collapsed2 = await page.evaluate(() => {
      const bar = document.querySelector('[data-sandbox-sidebar]');
      // 组头自己带 title="收起分组"/"展开分组"，它的 parent 就是那一组的容器 ⇒
      // 「哪组开着 / 开着的组里有几颗」全部**从 DOM 现算**，不抄成员表。
      const heads = Array.from(bar.querySelectorAll('div[title="收起分组"], div[title="展开分组"]'));
      const groups = heads.map((h) => ({
        name: (h.querySelector('span')?.textContent || '').trim(),
        open: h.getAttribute('title') === '收起分组',
        items: Array.from(h.parentElement ? h.parentElement.querySelectorAll(':scope > button[data-gate]') : [])
          .map((b) => b.getAttribute('data-gate')),
      }));
      const visible = Array.from(bar.querySelectorAll('button[data-gate]')).map((b) => b.getAttribute('data-gate'));
      return { headers: new Set(groups.map((g) => g.name)).size, groups, visible };
    });
    console.log('    折叠面板:', JSON.stringify({ headers: collapsed2.headers, open: collapsed2.groups.filter((g) => g.open).map((g) => g.name), visible: collapsed2.visible }));
    // ⚠ 本格原来钉的是「逻辑门 = 7 项」这张**成员表**。批次 R68/R76 往同一组里加了缓冲器（Repeater）
    // 之后它就红了——红的是我把形状钉死在成员数上（过钉），分组折叠这件事本身没坏。
    // 判据改成说自己的射程：只有一组开着、开着的正是「逻辑门」、库里可见的颗数==那一组的颗数
    // （其余组一颗都不许漏出来），且不少于 7 颗（防止"组是空的所以全绿"）。
    const opened = collapsed2.groups.filter((g) => g.open);
    const shapeOk = collapsed2.headers >= 8 && opened.length === 1 && opened[0].name === '逻辑门'
      && collapsed2.visible.length >= 7 && collapsed2.visible.length === opened[0].items.length;
    shapeOk
      ? ok('[6] 默认只展开「逻辑门」一组：库里可见颗数恰好等于该组颗数，其余组一颗不漏（成员随调色板定义，不钉死）',
        `组头 ${collapsed2.headers} 个，开着=${opened[0].name}(${opened[0].items.length} 颗)，可见=${collapsed2.visible.length}`)
      : bad('[6] 分组折叠形状异常', JSON.stringify({ headers: collapsed2.headers, opened, visible: collapsed2.visible }));
    const baseVisible = collapsed2.visible.length;
    await page.getByText('显示', { exact: true }).first().click(); await sleep(400);
    const displayVisible = await page.evaluate(() => {
      const bar = document.querySelector('[data-sandbox-sidebar]');
      return bar.querySelectorAll('button[data-gate]').length;
    });
    // ⚠ 这一臂原来比的是 `> LOGIC.length`（7）。同组加了缓冲器之后库里本来就 8 颗，
    // 「显示」没点开也会 8 > 7 ⇒ 判据自己烂成了一个恒真式。改成比**同一屏的展开前基线**。
    (displayVisible > baseVisible) ? ok('[6b] 点组头把「显示」分组的项加进库里', `${baseVisible} → ${displayVisible}`)
      : bad('[6b] 展开分组后库里颗数没变', `基线=${baseVisible} 展开后=${displayVisible}`);

    // ========== [7] 主模式编译电路 → 一键复制到沙盒 ==========
    await clickActivity(page, 'sandbox'); await sleep(700);  // 退出沙盒（回到 circuit 视图）
    await page.locator('button[data-tool="examples"]').first().click(); await sleep(800);
    await page.locator('button:has-text("Adder")').first().click({ timeout: 4000 }).catch(async () => {
      // 兜底：点第一个示例
      await page.locator('button:has-text(".v")').first().click();
    });
    await sleep(6000); // 等编译 + 布局
    const circuitReady = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).map(b => (b.textContent || '').trim());
      return { hasCopy: btns.includes('复制到沙盒') };
    });
    if (!circuitReady.hasCopy) {
      // 可能示例没编译成功，尝试手动编译
      await page.locator('button[title="编译 (F5)"]').first().click(); await sleep(6000);
    }
    const copyBtn = page.locator('button:has-text("复制到沙盒")');
    const hasCopy = await copyBtn.count();
    if (!hasCopy) { bad('[7] 找不到「复制到沙盒」按钮（电路未编译出）'); }
    else {
      await copyBtn.first().click(); await sleep(1800);
      const copied = await page.evaluate(() => {
        const inSb = !!document.querySelector('[data-sandbox-wrapper]');
        const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
        const sbFile = Object.values(files).find(f => String(f.name).includes('_sandbox'));
        const p = window.__sandboxPaper;
        const elems = p ? p.model.getCells().filter(c => !c.isLink()).length : 0;
        const links = p ? p.model.getLinks().length : 0;
        return { inSb, sbFileName: sbFile ? sbFile.name : null, elems, links };
      });
      console.log('    复制到沙盒:', JSON.stringify(copied));
      (copied.inSb && copied.sbFileName && copied.elems >= 2)
        ? ok('[7] 主模式电路一键复制到沙盒并重建', `${copied.sbFileName}: ${copied.elems} 器件 / ${copied.links} 线`)
        : bad('[7] 复制到沙盒异常', JSON.stringify(copied));
      // 复制出的电路可二次编辑：再放一个器件（复制后落在「文件」面板，先切「部件」并展开分组）
      await clickActivity(page, 'modules'); await sleep(400);
      await page.getByText('输入 / 输出', { exact: true }).first().click(); await sleep(400);
      await require('./_ui.cjs').clickGate(page, 'Lamp'); await sleep(500);
      const editable = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        return p.model.getCells().filter(c => !c.isLink() && c.get('type') === 'Lamp').length;
      });
      (editable >= 1) ? ok('[7b] 复制出的电路可继续二次编辑') : bad('[7b] 二次编辑失败');
    }

    errors.length === 0 ? ok('[8] 全程无页面异常') : bad('[8] 有页面异常', errors[0].slice(0, 160));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
