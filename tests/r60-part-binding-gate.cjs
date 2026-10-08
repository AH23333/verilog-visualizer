// R60 验收：沙盒「自定义部件」的**绑定闭环**（他第 9、10 条）
//   9. 部件文件删掉之后，右键的部件栏里不许还挂着它（挂着的又放不出来）；
//   10. 存为新部件之后，放上去的实例要**自动绑定**到那个部件文件，不用手动换绑。
//
// 判据钉可观察形状，不钉内部函数名（现场读数来自 tests/r60-part-entry-probe.cjs）：
//   · 存部件 ⇒ 左栏出现「放置部件“NAME”」行，且画布右键「放置部件 → 自定义门▶」里有它；
//   · 从画布菜单点它 ⇒ 器件数 +1，新器件 type='Subcircuit' 且 **celltype === NAME**（这就是自动绑定）；
//   · 删部件（两步 ×）⇒ 上面两处都立刻不再有它；画布上已放置的实例不许凭空消失或把页面搞崩。
//
// ⚠ 菜单项一律用 el.click()：`locator.click()` 要等元素"稳定"，而菜单是带动画的，等不到（实测超时 30 s）。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1647;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1647)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unverified++; console.log(`  UNVERIFIED  ${n}（${d}）`); };

const menuLabels = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-context-menu] button')).map((b) => String(b.textContent || '').trim()));
const clickItem = (page, label) => page.evaluate((t) => {
  const b = Array.from(document.querySelectorAll('[data-context-menu] button'))
    .find((x) => String(x.textContent || '').trim() === t);
  if (!b) return false; b.click(); return true;
}, label);
const cells = (page) => page.evaluate(() => window.__sandboxPaper.model.getCells().length);
const partRows = (page, name) => page.evaluate((n) =>
  Array.from(document.querySelectorAll('button'))
    .filter((b) => String(b.title || '').startsWith('放置部件') && String(b.textContent || '').trim() === n).length, name);

/** 画布右键 → 放置部件 → 自定义门▶，把子菜单标签读回来（不在→返回 null，调用方按三态处理） */
async function customCatItems(page, at) {
  await page.mouse.click(at.x, at.y, { button: 'right' }); await sleep(450);
  if (!await clickItem(page, '放置部件▶')) { await page.keyboard.press('Escape'); return null; }
  await sleep(400);
  const lvl1 = await menuLabels(page);
  const cat = lvl1.find((l) => l.includes('自定义门'));
  if (!cat) { await page.keyboard.press('Escape'); return { none: true, lvl1 }; }
  await clickItem(page, cat); await sleep(400);
  const items = (await menuLabels(page)).filter((l) => l !== '← 返回分类');
  return { items, cat };
}

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 180)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    // 把 vite「发现新依赖 → 重新预构建 → 整页 reload」这一波吃掉
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1200);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    await UI.enterSandbox(page);
    await UI.clickGate(page, 'Input');
    await UI.clickGate(page, 'Output');
    await sleep(500);
    const base = await cells(page);
    if (base < 2) { console.log('FATAL 沙盒画布上没放进出/输出，后面全是空话'); process.exit(1); }
    const NAME = 'R60Part' + (Date.now() % 100000);

    // ---- 存为部件（走真入口：部件面板右键 → 新建部件（保存当前电路）→ 名称 → 确定）----
    await page.locator('button[data-activity="modules"]').first().click(); await sleep(500);
    const anchor = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div,span')).find((d) => String(d.textContent || '').trim() === '部件（可编辑电路）');
      if (!el) return null; el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return (r.top > 0 && r.top < 900) ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
    });
    if (!anchor) { console.log('FATAL 部件面板标题拿不到/不在视口，无法走真入口'); process.exit(1); }
    await page.mouse.click(anchor.x, anchor.y, { button: 'right' }); await sleep(500);
    if (!await clickItem(page, '新建部件（保存当前电路）')) { console.log('FATAL 侧栏菜单里没有「新建部件（保存当前电路）」'); process.exit(1); }
    await sleep(600);
    await page.locator('input[placeholder="自定义门名称"]').fill(NAME);
    await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(1000);

    // [1] 两处清单立刻出现它
    const rows1 = await partRows(page, NAME);
    const host = await page.evaluate(() => {
      const p = window.__sandboxPaper; const r = p.el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width - 40), y: Math.round(r.top + r.height - 40) };
    });
    const cat1 = await customCatItems(page, host);
    (rows1 === 1 && cat1 && cat1.items && cat1.items.some((l) => l.includes(NAME)) ? ok : bad)(
      '[1] 存为新部件后，左栏与画布右键「自定义门」立刻列出它',
      `左栏行=${rows1} 颗，画布子菜单=${J(cat1 && cat1.items)}`);

    // [2] 从画布菜单放置 ⇒ 自动绑定（celltype === 部件文件名）
    if (!cat1 || !cat1.items || !cat1.items.some((l) => l.includes(NAME))) {
      skip('[2] 放置的实例自动绑定到部件文件', '菜单里没有它，点不到');
    } else {
      const c0 = await cells(page);
      await clickItem(page, cat1.items.find((l) => l.includes(NAME))); await sleep(900);
      const shape = await page.evaluate((n) => {
        const cs = window.__sandboxPaper.model.getCells();
        const last = cs[cs.length - 1];
        return { n: cs.length, type: String(last.get('type')), celltype: last.get('celltype') ?? null, name: n };
      }, NAME);
      (shape.n === c0 + 1 && shape.type === 'Subcircuit' && shape.celltype === NAME ? ok : bad)(
        '[2] 从菜单放置的实例自动绑定（celltype 就是部件名，不用手动换绑）',
        `器件 ${c0}→${shape.n}，type=${shape.type} celltype=${shape.celltype}`);
    }

    // [3] 部件真身就是沙盒文件：store 里恰好一颗 role:'part' 的 NAME.djs（清单与文件系统同源）
    const partFiles = (page, n) => page.evaluate(async (name) => {
      const m = await import('/src/store/sandboxStore.ts');
      return m.sandboxStore.list().filter((f) => String(f.name).includes(name))
        .map((f) => ({ name: f.name, role: String(f.role || '') }));
    }, n);
    const rows3 = await partFiles(page, NAME);
    (rows3.length === 1 && rows3[0].role === 'part' ? ok : bad)(
      '[3] 部件真身是沙盒文件（store 里恰好一颗 role=part 的同名文件）', J(rows3));

    // [4] 删除部件 ⇒ 两处立刻消失（他第 9 条：删了还挂着、点了放不出来）
    const delClicked = await page.evaluate((n) => {
      const row = Array.from(document.querySelectorAll('button')).find((x) =>
        String(x.title || '').startsWith('放置部件') && String(x.textContent || '').trim() === n);
      if (!row) return 'no-row';
      const span = row.parentElement && row.parentElement.querySelector('span[title="删除部件"]');
      if (!span) return 'no-x';
      span.click(); return 'first';
    }, NAME);
    await sleep(500);
    const del2 = await page.evaluate((n) => {
      const row = Array.from(document.querySelectorAll('button')).find((x) =>
        String(x.title || '').startsWith('放置部件') && String(x.textContent || '').trim() === n);
      const span = row && row.parentElement && row.parentElement.querySelector('span[title="删除部件"]');
      if (!span) return 'no-x-2';
      const confirming = String(span.textContent || '').trim() === '?';   // 第二步才是真删
      span.click(); return confirming ? 'deleted' : 'not-confirming';
    }, NAME);
    await sleep(900);
    const rows2 = await partRows(page, NAME);
    const cat2 = await customCatItems(page, host);
    const cat2Items = cat2 ? (cat2.items || ['（「自定义门」分类整块没了）']) : ['（右键菜单没打开）'];
    const gone = rows2 === 0 && (!cat2 || !cat2.items || !cat2.items.some((l) => l.includes(NAME)));
    (gone ? ok : bad)('[4] 删掉部件文件后，左栏与右键都立刻不再有它',
      `删除路径=${delClicked}/${del2}，左栏行=${rows2}，画布子菜单=${J(cat2Items)}`);
    const rows4b = await partFiles(page, NAME);
    (rows4b.length === 0 ? ok : bad)('[4b] 删部件就是删文件（store 里已无同名文件，[3] 的反面）', J(rows4b));

    // [5] 已放置的实例不许因为定义被删而从图上消失，也不许把页面搞崩
    const afterDel = await cells(page);
    (afterDel >= base + 1 ? ok : bad)('[5] 删除定义不影响已放置实例的显示（图不塌）',
      `基线 ${base} 颗 → 存/放/删之后 ${afterDel} 颗`);

    (perr.length ? bad : ok)('[6] 全程无页面异常', perr.slice(0, 3).join(' | '));
    console.log(`\n===== R60 部件绑定: ${pass} PASS / ${fail} FAIL / ${unverified} UNVERIFIED =====`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
    fail++;
    console.log(`\n===== R60 部件绑定: ${pass} PASS / ${fail} FAIL / ${unverified} UNVERIFIED =====`);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
  }
})();
