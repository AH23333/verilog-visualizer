// R123 闸门：部件循环依赖（套娃/互嵌）——渲染断环 + 放置拦截 + 常驻警告。
// 用户报障（2026-10-11）：部件文件内放自己的实例导致渲染失败，且无环提示。
// 射程：
//  [1] 环档案展开图不炸：main.djs 引用 foo（foo 自引用）→ 放大镜 → 无 stack overflow
//      pageerror，__innerPaper 存在，回边层渲染为 `foo__cycle` 空壳（断环生效）
//  [2] 自嵌套放置拦截：打开 foo.djs（部件）→ 部件面板放 foo → 画布 foo 实例数不增
//  [3] 互嵌放置拦截：baz↔qux 互引 → 打开 baz.djs 放 qux → 实例数不增
//  [4] 常驻警告条：打开 main.djs → [data-sb-cycle-warn] 存在且含 foo
//  [5] 不误伤：正常嵌套（outer→inner，无环）→ 放置成功 + 无警告条
//  [6] 全程 pageerror 0（判据读模型/DOM，不读 toast 文案）
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1491;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(PORT)); } catch {}
const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const results = { pass: 0, fail: 0 };
const ok = (n, m = '') => { results.pass++; console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`); };
const bad = (n, m = '') => { results.fail++; console.log(`  FAIL  ${n}${m ? ' — ' + m : ''}`); };

async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}

/** 直写 fixture：部件档案（绕过"放置拦截"——环档案是存量数据的形状）。
 *  在浏览器里执行（page.evaluate 传源码字符串），mk 与 r123 头部说明一致。 */
const FIXTURE_SRC = `(() => {
  const mk = (id, name, role, celltypes) => ({
    id, name, role, updatedAt: Date.now(),
    graphJson: JSON.stringify({
      cells: [
        { id: id + '_i', type: 'Input', position: { x: 60, y: 60 }, bits: 1, net: 'a' },
        { id: id + '_o', type: 'Output', position: { x: 300, y: 60 }, bits: 1, net: 'q' },
        { id: id + '_g', type: 'And', position: { x: 160, y: 60 }, bits: 1 },
        ...celltypes.map((ct, i) => ({ id: id + '_s' + i, type: 'Subcircuit', celltype: ct, position: { x: 120 + i * 90, y: 160 } })),
      ],
    }),
  });
  const all = Object.assign({}, JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}'));
  all.f_foo = mk('f_foo', 'foo.djs', 'part', ['foo']);
  all.f_main = mk('f_main', 'main.djs', 'circuit', ['foo']);
  all.f_baz = mk('f_baz', 'baz.djs', 'part', ['qux']);
  all.f_qux = mk('f_qux', 'qux.djs', 'part', ['baz']);
  all.f_inner = mk('f_inner', 'inner.djs', 'part', []);
  all.f_outer = mk('f_outer', 'outer.djs', 'circuit', ['inner']);
  localStorage.setItem('verilog-viz-sandbox-files', JSON.stringify(all));
})()`;

/** 部件面板（modules tab 的「部件（可编辑电路）」区）按名放置——clickGate 只认元件库。
 *  ⚠ enterSandbox 后左面板可能不在 files；部件按钮在 modules 面板，先切过去。 */
const placePartByName = async (page, name) => {
  await page.evaluate(() => {
    const b = document.querySelector('button[data-activity="modules"]');
    if (b) b.click();
  });
  await sleep(500);
  const hit = await page.evaluate((n) => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => String(x.textContent || '').trim() === n
      || /放置部件/.test(x.title || '') && String(x.title).includes(`“${n}”`));
    if (b) { b.click(); return true; }
    return false;
  }, name);
  if (!hit) throw new Error(`placePartByName: 部件面板没有 "${name}"`);
};

const openFile = async (page, name) => {
  const sel = `[data-sbfile="${name}"]`;
  if (!(await page.locator(sel).count())) {
    const fb = page.locator('button[data-activity="files"]');
    if (await fb.count()) { await fb.first().click(); await sleep(350); }
  }
  await page.locator(sel).first().click();
  await sleep(1200);
};
const subCount = (page, ct) => page.evaluate((c) => {
  const p = window.__sandboxPaper;
  if (!p) return -1;
  return p.model.getElements().filter((x) => x.get('type') === 'Subcircuit' && String(x.get('celltype') || '') === c).length;
}, ct);

(async () => {
  let server, browser;
  const pageErrors = [];
  try {
    require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`);
  } catch {}
  try {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate((src) => {
      ['verilog-viz-sandbox-files', 'verilog-viz-sandbox-active', 'verilog-viz-sandbox-folders',
        'verilog-viz-sandbox-gates', 'verilog-viz-sandbox-settings']
        .forEach((k) => localStorage.removeItem(k));
      // eslint-disable-next-line no-eval —— 测试夹具注入，源码自本文件常量
      (0, eval)(src);
    }, FIXTURE_SRC);
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(2000);
    try { await page.locator('button:has-text("Skip"), button:has-text("跳过")').first().click({ timeout: 2500 }); } catch {}
    await UI.enterSandbox(page);

    // ===== [1] 环档案展开图不炸（渲染断环）——直接走模态入口 open:subcircuit =====
    await openFile(page, 'main.djs');
    await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getElements().find((x) => x.get('type') === 'Subcircuit');
      if (c) p.trigger('open:subcircuit', c);
    });
    await sleep(4500);
    const inner = await page.evaluate(() => {
      const p = window.__innerPaper;
      if (!p) return null;
      const subs = p.model.getElements().filter((x) => x.get('type') === 'Subcircuit').map((x) => String(x.get('celltype') || ''));
      return { subs, total: p.model.getElements().length, done: (window.__expandStages || []).some((s) => s.startsWith('done')) };
    });
    const stackOverflow = pageErrors.some((e) => /Maximum call stack|RangeError|devices/i.test(e));
    (inner && !stackOverflow && inner.done && inner.total > 0)
      ? ok('[1] 环档案展开图渲染完成（断环空壳兜底，无 undefined.devices 抛错）', JSON.stringify(inner))
      : bad('[1] 环档案展开图', 'inner=' + JSON.stringify(inner) + ' stackOverflow=' + stackOverflow);
    await page.keyboard.press('Escape'); await sleep(400);

    // ===== [4] 常驻警告条 =====
    const warnTxt = await page.evaluate(() => {
      const el = document.querySelector('[data-sb-cycle-warn]');
      return el ? String(el.textContent) : null;
    });
    (warnTxt && warnTxt.includes('foo'))
      ? ok('[4] 打开含环闭包的文件 → 警告条常驻且点名 foo', warnTxt.slice(0, 60))
      : bad('[4] 警告条缺失', String(warnTxt));

    // ===== [2] 自嵌套放置拦截 =====
    await openFile(page, 'foo.djs');
    const before2 = await subCount(page, 'foo');
    await placePartByName(page, 'foo');
    await sleep(900);
    const after2 = await subCount(page, 'foo');
    (before2 >= 0 && after2 === before2)
      ? ok('[2] 部件文件内放置自己 → 拦截（实例数不增）', `${before2}→${after2}`)
      : bad('[2] 自嵌套放置拦截', `${before2}→${after2}`);

    // ===== [3] 互嵌放置拦截 =====
    await openFile(page, 'baz.djs');
    const before3 = await subCount(page, 'qux');
    await placePartByName(page, 'qux');
    await sleep(900);
    const after3 = await subCount(page, 'qux');
    (before3 >= 0 && after3 === before3)
      ? ok('[3] 互嵌环（baz→qux→baz）放置拦截', `${before3}→${after3}`)
      : bad('[3] 互嵌放置拦截', `${before3}→${after3}`);

    // ===== [5] 正常嵌套不误伤 =====
    await openFile(page, 'outer.djs');
    await page.evaluate(() => { window.__outerBase = (() => { const p = window.__sandboxPaper; return p.model.getElements().filter((x) => x.get('type') === 'Subcircuit' && x.get('celltype') === 'inner').length; })(); });
    const before5 = await page.evaluate(() => window.__outerBase);
    await placePartByName(page, 'inner');
    await sleep(900);
    const after5 = await subCount(page, 'inner');
    const warn5 = await page.evaluate(() => !!document.querySelector('[data-sb-cycle-warn]'));
    (after5 === before5 + 1 && !warn5)
      ? ok('[5] 无环部件放置正常、不误报警告', `${before5}→${after5} warn=${warn5}`)
      : bad('[5] 正常嵌套被误伤', `${before5}→${after5} warn=${warn5}`);

    // ===== [6] pageerror 总数 =====
    pageErrors.length === 0
      ? ok('[6] 全程 pageerror 0')
      : bad('[6] pageerror', pageErrors.slice(0, 3).join(' | '));

    await page.screenshot({ path: path.join(PROJECT_ROOT, 'tests', '.out-r123.png') });
    console.log(`\n===== 结果: ${results.pass} pass, ${results.fail} fail =====`);
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 300));
    if (results.pass + results.fail === 0) results.fail = 1;
  } finally {
    try { await browser?.close(); } catch {}
    try { server?.kill(); } catch {}
    process.exit(results.fail > 0 ? 1 : 0);
  }
})();
