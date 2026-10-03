// R19 验收：本轮 8 项问题
//  1) 输入/输出 与 端口 整合为同一组
//  2) 汉化补全（快捷键面板 / 命令面板）
//  3) D 触发器（两个或非门交叉互连）能跑出确定电平
//  4) 右键菜单可「放置部件」
//  5) 右键菜单弹出后，左键点画布可关闭
//  6) 自定义门展开图只有一个，且没有 digitaljs 裸弹窗
//  7) 放大镜单击即展开（不需双击）
//  8) 展开图里 Input/Output 端口图案未被横向拉长
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1461;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const clickGate = async (page, label) => {
  await page.evaluate((l) => document.querySelector('button[data-gate="' + l + '"]')?.click(), label);
  await sleep(400);
};
async function boot(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k));
  });
  await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
  try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
  await page.locator('button[title="沙盒"]').click(); await sleep(800);
  await page.locator('button[title="新建文件"]').click(); await sleep(1300);
}
// 按类型+端口名取端口圆心（屏幕坐标）
const portCenter = (page, type, port) => page.evaluate(({ type, port }) => {
  const p = window.__sandboxPaper;
  const c = p.model.getCells().find(x => x.get('type') === type);
  if (!c) return null;
  const v = c.findView(p); if (!v) return null;
  const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { type, port });
async function dragWire(page, sType, sPort, tType, tPort) {
  const a = await portCenter(page, sType, sPort);
  const b = await portCenter(page, tType, tPort);
  if (!a || !b) return false;
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(120);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await sleep(80);
  await page.mouse.move(b.x, b.y, { steps: 5 }); await sleep(200);
  await page.mouse.up(); await sleep(500);
  return true;
}

async function dragWireById(page, srcId, srcPort, tgtId, tgtPort) {
  const pts = await page.evaluate(({ s, sp, t, tp }) => {
    const p = window.__sandboxPaper;
    const pc = (id, port) => {
      const c = p.model.getCell(id); if (!c) return null;
      const v = c.findView(p); if (!v) return null;
      const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    return { a: pc(s, sp), b: pc(t, tp) };
  }, { s: srcId, sp: srcPort, t: tgtId, tp: tgtPort });
  if (!pts.a || !pts.b) return false;
  await page.mouse.move(pts.a.x, pts.a.y); await page.mouse.down(); await sleep(120);
  await page.mouse.move((pts.a.x + pts.b.x) / 2, (pts.a.y + pts.b.y) / 2, { steps: 4 }); await sleep(80);
  await page.mouse.move(pts.b.x, pts.b.y, { steps: 5 }); await sleep(200);
  await page.mouse.up(); await sleep(500);
  return true;
}

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
    await boot(page);

    // ===== [1] 输入/输出 与 端口 整合 =====
    console.log('\n===== [1] 调色板分组整合 =====');
    const pal = await page.evaluate(() => {
      const gates = [...document.querySelectorAll('button[data-gate]')].map(b => b.getAttribute('data-gate'));
      const heads = [...document.querySelectorAll('div')]
        .filter(d => d.children.length === 0 && /^(逻辑门|输入|端口)/.test(d.textContent?.trim() || ''))
        .map(d => d.textContent.trim());
      return { gates, heads };
    });
    console.log('    分组:', JSON.stringify(pal.heads), ' 部件:', JSON.stringify(pal.gates));
    const merged = pal.heads.includes('输入 / 输出') && !pal.heads.some(h => h.includes('端口'))
      && ['Input','Clock','Lamp','Input','Output'].every(t => pal.gates.includes(t));
    merged ? ok('[1] 「输入/输出」与「端口」已合并为一组', pal.heads.join(' , '))
           : bad('[1] 分组未整合', JSON.stringify(pal.heads));

    // ===== [2] 汉化（快捷键面板 / 命令面板）=====
    console.log('\n===== [2] 汉化补全 =====');
    await page.keyboard.press('Control+/'); await sleep(700);
    const sc = await page.evaluate(() => {
      // 只扫对话框内部：body 里还有沙盒调色板（Nand/Button/… 本就是型号名，不是未汉化文案）
      const span = [...document.querySelectorAll('span')].find(s => s.textContent?.trim() === '键盘快捷键');
      let el = span || document.body;
      while (el && !el.innerText.includes('Ctrl+O')) el = el.parentElement;
      const t = (el || document.body).innerText;
      return {
        hasTitle: !!span,
        // 按键名（Delete/Ctrl/Shift/…）本就是键盘上的字，不翻译
        enLeft: (t.match(/[A-Za-z]{4,}/g) || []).filter(w => !/Ctrl|Shift|Alt|Esc|Wheel|Delete|Home|End|Page|F\d|Verilog/.test(w)).slice(0, 8),
        groups: /文件|视图|编辑器|画布/.test(t),
      };
    });
    console.log('    快捷键面板:', JSON.stringify(sc));
    (sc.hasTitle && sc.groups && sc.enLeft.length === 0)
      ? ok('[2a] 快捷键面板已汉化', sc.enLeft.length ? '' : '无残留英文')
      : bad('[2a] 快捷键面板仍有英文', JSON.stringify(sc.enLeft));
    await page.keyboard.press('Escape'); await sleep(400);
    await page.keyboard.press('Control+Shift+p'); await sleep(600);
    const cp = await page.evaluate(() => {
      const i = document.querySelector('input[placeholder]');
      return i ? i.placeholder : null;
    });
    console.log('    命令面板 placeholder:', JSON.stringify(cp));
    (cp && /[一-龥]/.test(cp)) ? ok('[2b] 命令面板已汉化', cp) : bad('[2b] 命令面板未汉化', String(cp));
    await page.keyboard.press('Escape'); await sleep(400);

    // ===== [3] D 触发器：两个或非门交叉互连 =====
    console.log('\n===== [3] D 触发器（或非门交叉互连）=====');
    await clickGate(page, 'Nor'); await sleep(300);
    await clickGate(page, 'Nor'); await sleep(300);
    await clickGate(page, 'Lamp'); await sleep(400);
    const norIds = await page.evaluate(() => window.__sandboxPaper.model.getCells()
      .filter(c => c.get('type') === 'Nor').map(c => c.id));
    // 真正的交叉互连（SR 锁存器/D 触发器核心）：n1.out→n2.in1，n2.out→n1.in2
    const w1 = await dragWireById(page, norIds[0], 'out', norIds[1], 'in1');
    const w2 = await dragWireById(page, norIds[1], 'out', norIds[0], 'in2');
    const linkN = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
    console.log('    或非门 =', norIds.length, ' 交叉线:', w1, w2, ' links =', linkN);
    const lampFill = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const l = p.model.getCells().find(c => c.get('type') === 'Lamp');
      const v = l?.findView(p)?.el?.querySelector?.('.led');
      return v ? getComputedStyle(v).fill : null;
    });
    const outs = await page.evaluate(() => window.__sandboxPaper.model.getCells()
      .filter(c => c.get('type') === 'Nor')
      .map(c => { const o = c.get('outputSignals'); const v = o?.out; return v ? v.toString() : 'n/a'; }));
    console.log('    或非门输出 =', JSON.stringify(outs), ' 灯 =', lampFill);
    const defined = outs.every(o => o.indexOf('x') === -1);
    defined ? ok('[3] 或非门交叉反馈环收敛到确定电平（摆脱 x 锁定）', JSON.stringify(outs))
            : bad('[3] 反馈环仍锁在 x', JSON.stringify(outs));

    // ===== [4] 右键菜单「放置部件」 =====
    console.log('\n===== [4] 右键放置部件 =====');
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    const blankPt = { x: 700, y: 420 };
    await page.mouse.move(blankPt.x, blankPt.y);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await sleep(600);
    const hasPlace = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent?.includes('放置部件')));
    console.log('    菜单含「放置部件」 =', hasPlace);
    if (hasPlace) {
      await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.includes('放置部件'))?.click());
      await sleep(700);
      // 按钮文本是「标签 + 型号提示」拼接（如 "与门And"），不可用全等比较
      const sub = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent?.trim().startsWith('与门')));
      console.log('    二级菜单含「与门」 =', sub);
      await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith('与门'))?.click());
      await sleep(800);
      const andCell = await page.evaluate(() => {
        const c = window.__sandboxPaper.model.getCells().find(x => x.get('type') === 'And');
        return c ? c.position() : null;
      });
      console.log('    放置到的 And =', JSON.stringify(andCell));
      andCell ? ok('[4] 右键「放置部件」成功放置', `pos=(${andCell.x},${andCell.y})`)
              : bad('[4] 右键放置部件未生成部件');
    } else bad('[4] 右键菜单缺少「放置部件」');

    // ===== [5] 左键关闭右键菜单 =====
    console.log('\n===== [5] 左键关闭右键菜单 =====');
    await page.mouse.move(600, 300);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await sleep(600);
    const menuBefore = await page.evaluate(() => [...document.querySelectorAll('div')].some(d => (d.className || '').includes && d.className.includes('min-w-[280px]')));
    await page.mouse.move(500, 500);
    await page.mouse.down(); await page.mouse.up();   // 左键点画布
    await sleep(600);
    const menuAfter = await page.evaluate(() => [...document.querySelectorAll('div')].some(d => (d.className || '').includes && d.className.includes('min-w-[280px]')));
    console.log('    菜单 点击前 =', menuBefore, ' 左键后 =', menuAfter);
    (menuBefore && !menuAfter) ? ok('[5] 左键点击画布可关闭右键菜单')
                               : bad('[5] 左键无法关闭菜单', `before=${menuBefore} after=${menuAfter}`);

    // ===== [6][7][8] 自定义门展开图 =====
    console.log('\n===== [6][7][8] 自定义门展开图 =====');
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    await clickGate(page, 'Input'); await clickGate(page, 'Output'); await sleep(400);
    await dragWire(page, 'Input', 'out', 'Output', 'in');
    await page.locator('button[title^="将当前电路保存为自定义门"]').click(); await sleep(400);
    await page.fill('input[placeholder="自定义门名称"]', 'T19'); await sleep(200);
    await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(700);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    await page.evaluate(() => { const g = window.__sandboxGates.list()[0]; if (g) window.__sandboxGates.place(g.id); });
    await sleep(900);
    // 单击放大镜（a.zoom）
    const zoomPt = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const s = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
      if (!s) return null;
      const v = s.findView(p);
      const a = v.el.querySelector('a.zoom');
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    console.log('    放大镜坐标 =', JSON.stringify(zoomPt));
    if (!zoomPt) bad('[7] 找不到放大镜 a.zoom');
    else {
      await page.mouse.click(zoomPt.x, zoomPt.y);   // 单击
      await sleep(900);
      const modals = await page.evaluate(() => {
        const all = [...document.querySelectorAll('span')].filter(s => /^内部电路：/.test(s.textContent?.trim() || ''));
        // digitaljs 自己的裸弹窗：直接挂在 body 下、title 为 "celltype label"
        const stray = [...document.body.children].filter(el => el.tagName === 'DIV' && /T19/.test(el.getAttribute('title') || ''));
        return { count: all.length, stray: stray.length, text: all[0]?.textContent?.trim() };
      });
      console.log('    展开图数量 =', modals.count, ' digitaljs 裸弹窗 =', modals.stray, ' 标题 =', JSON.stringify(modals.text));
      if (modals.count === 0) {
        const diag = await page.evaluate((pt) => {
          const p = window.__sandboxPaper;
          const s = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
          const hit = document.elementFromPoint(pt.x, pt.y);
          return {
            hasSub: !!s,
            hitTag: hit ? hit.tagName : null,
            hitClosestZoom: hit ? !!hit.closest('a.zoom') : false,
            openMenus: [...document.querySelectorAll('div')].filter(d => String(d.className || '').includes('min-w-[280px]')).length,
          };
        }, zoomPt);
        console.log('    诊断:', JSON.stringify(diag));
        // 手动触发一次，区分是「点击没到」还是「处理器没挂」
        await page.evaluate(() => {
          const p = window.__sandboxPaper;
          const s = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
          if (s) p.trigger('open:subcircuit', s);
        });
        await sleep(800);
        const afterManual = await page.evaluate(() => [...document.querySelectorAll('span')].filter(s => /^内部电路：/.test(s.textContent?.trim() || '')).length);
        console.log('    手动 trigger 后 =', afterManual);
      }
      (modals.count === 1) ? ok('[6] 展开图只有一个（无重复弹窗）', String(modals.text))
                           : bad('[6] 展开图数量异常', `count=${modals.count}`);
      (modals.stray === 0) ? ok('[6b] 无 digitaljs 自带裸弹窗')
                           : bad('[6b] 仍存在 digitaljs 裸弹窗', `stray=${modals.stray}`);
      (modals.count === 1) ? ok('[7] 放大镜单击即可展开', String(modals.text)) : bad('[7] 单击未展开');

      // [8] 端口图案尺寸
      const sizes = await page.evaluate(() => {
        // 1) 数据层：弹窗正是按 subcircuitGraph 重建的，先看端口尺寸是否被写成 30×30
        const p = window.__sandboxPaper;
        const sub = p.model.getCells().find(c => c.get('type') === 'Subcircuit');
        const sg = sub?.get('subcircuitGraph');
        const dataSizes = (sg?.cells || []).filter(c => c.type === 'Input' || c.type === 'Output')
          .map(c => ({ t: c.type, size: c.size }));
        // 2) 渲染层：弹窗内 jointjs 单元（class joint-cell）
        const modalRoot = [...document.querySelectorAll('span')]
          .find(s => /^内部电路：/.test(s.textContent?.trim() || ''))
          ?.closest('div')?.parentElement?.parentElement;
        const cells = [];
        (modalRoot || document).querySelectorAll('.joint-cell').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0) return;
          // 注意：.joint-cell 的包围盒含端口引出线(stub)，天然比盒体宽，不能用来判断是否变形。
          // 单独量盒体本身（.body 或第一个 rect）。
          const bEl = el.querySelector('.body') || el.querySelector('rect');
          const br = bEl ? bEl.getBoundingClientRect() : null;
          cells.push({
            dt: el.getAttribute('data-type'),
            w: Math.round(r.width), h: Math.round(r.height),
            ratio: +(r.width / r.height).toFixed(2),
            bw: br ? Math.round(br.width) : -1, bh: br ? Math.round(br.height) : -1,
            bratio: br ? +(br.width / br.height).toFixed(2) : -1,
          });
        });
        // 3) 弹窗真实渲染：host 里必须画出元件（早先只校验弹窗标题，内容为空也会通过）
        const h = document.querySelector('[data-inner-host]');
        const hostCells = h ? h.querySelectorAll('.joint-cell').length : -1;
        const dump = {
          attrCount: document.querySelectorAll('[data-inner-host]').length,
          hostOuter: h ? h.outerHTML.slice(0, 160) : null,
        };
        return { dataSizes, cells, hostCells, dump };
        return { dataSizes, cells, hostCells };
      });
      console.log('    弹窗 host 内元件数 =', sizes.hostCells, ' dump =', JSON.stringify(sizes.dump));
      (sizes.hostCells > 0)
        ? ok('[8b] 展开图渲染出了内部电路（非空）', `cells=${sizes.hostCells}`)
        : bad('[8b] 展开图为空', `hostCells=${sizes.hostCells}`);
      console.log('    数据层端口 size =', JSON.stringify(sizes.dataSizes));
      console.log('    弹窗内渲染单元 =', JSON.stringify(sizes.cells));
      const ok30 = sizes.dataSizes.length > 0
        && sizes.dataSizes.every(s => s.size && s.size.width === 30 && s.size.height === 30);
      ok30 ? ok('[8] 展开图端口尺寸为 30×30', JSON.stringify(sizes.dataSizes))
           : bad('[8] 端口尺寸异常', JSON.stringify(sizes.dataSizes));
      // 真正要防的是「渲染出来是横条」：端口渲染宽高比应接近 1（连线本身细长，排除）
      const ports = sizes.cells.filter(c => c.dt === 'Input' || c.dt === 'Output');
      console.log('    端口渲染宽高比 =', JSON.stringify(ports));
      const notStretched = ports.length > 0 && ports.every(p => p.bratio > 0 && p.bratio < 1.5);
      notStretched ? ok('[8c] 端口盒体渲染未被横向拉长', JSON.stringify(ports))
                   : bad('[8c] 端口盒体仍是横条', JSON.stringify(ports));
      await page.keyboard.press('Escape'); await sleep(300);
    }

    console.log('\n  pageerrors:', JSON.stringify(errors.slice(0, 4)));
    console.log(`\n===== R19 DONE: ${pass} pass, ${fail} fail =====`);
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); fail++; }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
