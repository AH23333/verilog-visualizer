// R84 验收（用户裁决 R-B：「绑定入口统一」＝删掉多选总览，只留一个文件级绑定弹窗）
//
// 真行为：沙盒工具栏那颗「部件绑定」（`button[data-sandbox-bindings]`）和文件树右键
// 「绑定...」现在是**同一颗**弹窗（SandboxFileBindingDialog，`[data-file-binding-dialog]`）：
// 都是对"该文件 graphJson 里的子电路实例按 celltype 名聚合出行"，每行下拉选部件定义文件，
// 确认写 `file.partBindings`（gateSystem 解析最高优先），重新打开文件后生效。
//
// 判据（射程各自写清）：
//   [1] 入口与统一性：工具栏那颗按钮在、可用（活动文件是电路而非门定义），点开是
//       文件级绑定弹窗且抬头＝本文件；右键那颗文件「绑定...」开的**也是它**（抬头同一个）；
//   [2] 行数对账：弹窗里每行 `data-binding-name`（含 ×count）== 该文件 graphJson 里
//       Subcircuit celltype 名聚合（成对判据，不是"有一行就算过"）；
//   [3] 绑定写盘 & 重载生效：确定 ⇒ `file.partBindings[celltype]` = 选中的部件 id、
//       提示条说「已保存」；重载后重开弹窗那一行还指着它（绑定是**存进文件**的，不是只在
//       内存里），`resolvePartRef` 也按这条绑定解析；
//   [4] 自动/失效说实话：没显式绑定时行**如实预选**到 autoMap 现算那颗（下拉值 =
//       resolvePartRef 结果、store 无显式绑定）；把那个部件文件删掉后重开 ⇒ 下拉回到
//       「-- 选择部件文件 --」、不画「已绑定」（不许给用户一个已消失的东西）。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1584;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1584)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unverified++; console.log(`  UNVERIFIED  ${n}（${d}）`); };

const ST = Date.now() % 100000;
const PA = 'RaA' + ST;
const PB = 'RaB' + ST;

/** 弹窗里的内容（DOM 是唯一真相：行名、×count、下拉当前项、已绑定徽章都按屏幕上看到的读） */
const dlgState = (page) => page.evaluate(() => {
  const dlg = document.querySelector('[data-file-binding-dialog]');
  if (!dlg) return null;
  const h2 = dlg.querySelector('h2');
  const rows = Array.from(dlg.querySelectorAll('[data-binding-name]')).map((el) => {
    const sel = el.querySelector('select');
    const opt = sel ? sel.options[sel.selectedIndex] : null;
    const cm = (el.textContent || '').match(/×(\d+)/);
    return {
      name: String(el.getAttribute('data-binding-name')),
      count: cm ? Number(cm[1]) : 0,
      val: opt ? String(opt.value) : null,
      optLabel: opt ? opt.textContent.trim() : '',
      bound: (el.textContent || '').includes('已绑定'),
    };
  });
  return {
    header: h2 ? h2.textContent.trim() : null,
    sub: (() => { const p = dlg.querySelector('p'); return p ? p.textContent.trim() : null; })(),
    nRows: rows.length,
    rows,
  };
});
/** 工具栏入口点开弹窗；没有那按钮直接返回 false（反向探针 M1 守这点，不许 FATAL） */
async function openFileBinding(page) {
  const b = page.locator('button[data-sandbox-bindings]');
  if (!(await b.count())) return false;
  await b.first().click(); await sleep(900);
  return (await page.locator('[data-file-binding-dialog]').count()) === 1;
}
/** 关闭弹窗：统一走「取消」按钮（遮罩 inset:0，不先关掉会挡住后面一切点击） */
async function closeFileBinding(page) {
  const b = page.locator('[data-file-binding-dialog] button:has-text("取消")');
  if (await b.count()) { await b.first().click(); await sleep(600); }
}
/** 文件树右键行 → 点菜单项；行找不到返回 null（前置没成要说话，不许 FATAL） */
async function fileMenu(page, sel, label) {
  const el = page.locator(sel).first();
  if (!(await el.count())) return null;
  await el.click({ button: 'right' }); await sleep(450);
  const done = await page.evaluate((t) => {
    const b = Array.from(document.querySelectorAll('[data-context-menu] button')).find((x) => String(x.textContent || '').trim() === t);
    if (!b || b.disabled) return false; b.click(); return true;
  }, label);
  await sleep(800);
  return done;
}
async function partFromCanvas(page, name) {
  await page.locator('button[title^="将当前电路保存为自定义门"]').first().click(); await sleep(400);
  await page.locator('input[placeholder="自定义门名称"]').fill(name); await sleep(200);
  await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(1000);
}
async function placePart(page, name) {
  const hit = await page.evaluate((n) => {
    const b = Array.from(document.querySelectorAll('button'))
      .find((x) => String(x.title || '').startsWith('放置部件') && String(x.textContent || '').trim() === n);
    if (!b) return false; b.click(); return true;
  }, name);
  await sleep(900);
  if (!hit) throw new Error(`左侧栏没有「放置部件 ${name}」那一行`);
}
/** 当前活动文件（含 Subcircuit 实例的电路文件）在 store 里的 id / name / 聚合行 */
async function mainInfo(page, pa) {
  return page.evaluate(async (pa) => {
    const m = await import('/src/store/sandboxStore.ts');
    const match = m.sandboxStore.list().map((f) => {
      let j = null; try { j = JSON.parse(f.graphJson || '{}'); } catch { }
      return { f, j };
    }).find(({ f, j }) => f.role !== 'part' && (j.cells || []).some((c) => c?.type === 'Subcircuit' && c.celltype === pa));
    if (!match) return null;
    const counts = {};
    for (const c of (match.j.cells || [])) {
      if (c?.type === 'Subcircuit' && c.celltype) counts[String(c.celltype)] = (counts[String(c.celltype)] || 0) + 1;
    }
    return { id: match.f.id, name: match.f.name, counts };
  }, pa);
}

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn(process.execPath, [require('path').join(__dirname, '..', 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { windowsHide: true, cwd: ROOT, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(30000);
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await UI.enterSandbox(page);

    // 部件 A（根目录）：一张只放 Input/Output 的画布
    await UI.clickGate(page, 'Input'); await UI.clickGate(page, 'Output'); await sleep(400);
    await partFromCanvas(page, PA);
    // 部件 B：**另开一张干净画布**再存 ⇒ B 的定义与 A 无关（旧版把 B 存进含 A 实例的画布，删 A 后 B 自己也失效，是夹具造的假红）
    await UI.newSandboxFile(page);
    await UI.clickGate(page, 'Input'); await UI.clickGate(page, 'Output'); await sleep(400);
    await partFromCanvas(page, PB);
    // 主画布：另开一张，放一颗 A 实例（celltype 聚合出 1 行：A）
    await UI.newSandboxFile(page);
    await placePart(page, PA);
    // 自动保存改为间隔节流后，store 快照可能滞后；夹具直接读 store（mainInfo），
    // 先以手动保存把活画布落盘 —— 与用户「放完存一下再开绑定」的语义一致。
    await page.evaluate(() => window.__sandboxSave && window.__sandboxSave());
    await sleep(600);

    const mi = await mainInfo(page, PA);
    const pbId = await page.evaluate(async (pb) => {
      const m = await import('/src/store/sandboxStore.ts');
      const f = m.sandboxStore.list().find((x) => x.role === 'part' && x.name.replace(/\.djs$/i, '').split('/').pop() === pb);
      return f ? f.id : null;
    }, PB);
    console.log('  [夹具] 主文件=', J(mi), ' PB 部件 id=', pbId ? String(pbId).slice(0, 8) + '…' : null);
    if (!mi || !pbId) { console.log('  FATAL 夹具没建起来'); process.exit(1); }
    const headerOf = (name) => `部件绑定：${name.split('/').pop()}`;

    // ===== [1] 工具栏入口 + 与文件右键同一颗弹窗 =====
    const open1 = await openFileBinding(page);
    const st1 = open1 ? await dlgState(page) : null;
    (open1 && st1 && st1.header === headerOf(mi.name) ? ok : bad)(
      '[1] 工具栏「部件绑定」点开的是文件级绑定弹窗，抬头＝当前电路文件',
      st1 ? `抬头=${J(st1.header)}（要=${J(headerOf(mi.name))}）` : `弹窗没起来（open=${open1}）`);
    await closeFileBinding(page);

    await page.locator('button[data-activity="files"]').first().click(); await sleep(700);
    const ctx = await fileMenu(page, `[data-sbfile$="${path.posix.basename(mi.name)}"]`, '绑定...');
    const st1b = await dlgState(page);
    if (ctx === null) {
      skip('[1] 文件右键「绑定...」开的也是同一颗弹窗', '文件行没找到（前置未成，结论不作数）');
    } else {
      (st1b && st1b.header === headerOf(mi.name) ? ok : bad)(
        '[1] 文件右键「绑定...」开的也是同一颗弹窗（抬头同一个文件）',
        st1b ? `抬头=${J(st1b.header)}` : '右键菜单没开出弹窗');
    }
    await closeFileBinding(page);

    // ===== [2] 行数对账：弹窗行 == 文件 graphJson 聚合 =====
    const expect2 = Object.entries(mi.counts).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
    const open2 = await openFileBinding(page);
    const st2 = open2 ? await dlgState(page) : null;
    const rowsOk2 = st2 && st2.rows.length === expect2.length
      && expect2.every((e) => {
        const r = st2.rows.find((x) => x.name === e.name);
        return r && r.count === e.count;
      });
    (rowsOk2 ? ok : bad)(
      '[2] data-binding-name 行与文件 graphJson 的 Subcircuit 聚合逐一对上（含 ×count）',
      open2 === false ? '入口没起来' : `弹窗 ${J(st2 && { nRows: st2.nRows, rows: st2.rows })} 要=${J(expect2)}`);
    await closeFileBinding(page);

    // ===== [4] 自动/失效说实话（先于任何显式绑定）=====
    // 这颗弹窗的"自动"是**如实预选**：没显式绑定时，下拉挂在 autoMap 现算那颗上
    // （resolvePartRef 按作用域打分的结果），而不是自己发明一颗 —— 所以对照物是
    // `resolvePartRef(PA, dirOf(主文件))` 的 file.id，外加"store 里没有任何显式绑定"。
    const autoId = await page.evaluate(async (pa) => {
      const g = await import('/src/lib/gateSystem.ts');
      const r = g.resolvePartRef(pa, '');
      return r ? String(r.file?.id || r.file?.name || r.file) : null;
    }, PA);
    const open4a = await openFileBinding(page);
    const st4a = open4a ? await dlgState(page) : null;
    const rowA4 = (st4a?.rows || []).find((r) => r.name === PA);
    const dbPre = await page.evaluate(async (id) => {
      const m = await import('/src/store/sandboxStore.ts');
      return m.sandboxStore.get(id)?.partBindings || {};
    }, mi.id);
    const autoOk = (rowA4 && rowA4.val === autoId) && Object.keys(dbPre).length === 0;
    (autoOk ? ok : bad)(
      '[4] 未显式绑定时：行如实预选到 autoMap 现算的那颗（下拉值 = resolvePartRef 结果），store 无显式绑定',
      `val=${J(rowA4 && rowA4.val)} auto=${J(autoId)} 显式绑定=${J(dbPre)}`);
    await closeFileBinding(page);

    // 删掉 A 的部件文件 ⇒ 重开：那行必须说实话"没得选了"
    await page.locator('button[data-activity="files"]').first().click(); await sleep(700);
    const del = await fileMenu(page, `[data-sbfile$="${PA}.djs"]`, '删除');
    const open4b = await openFileBinding(page);
    const st4b = open4b ? await dlgState(page) : null;
    const rowA4b = (st4b?.rows || []).find((r) => r.name === PA);
    (del !== true ? skip('no-op') : rowA4b && rowA4b.val === '' && rowA4b.optLabel === '-- 选择部件文件 --' && !rowA4b.bound ? ok : bad)(
      '[4] 删掉部件文件后重开：那行落到「-- 选择部件文件 --」、不画「已绑定」（不给用户一个已消失的东西）',
      !rowA4b ? `没读到 A 行 ${J(st4b)}` : `val=${J(rowA4b.val)} 选项=${J(rowA4b.optLabel)} bound=${J(rowA4b.bound)}`);
    await closeFileBinding(page);

    // ===== [3] 绑定写盘 & 重载生效 =====
    const open3 = await openFileBinding(page);
    const st3 = open3 ? await dlgState(page) : null;
    let bound3 = false;
    if (st3) {
      try {
        await page.locator(`[data-binding-name="${PA}"] select`).selectOption(pbId);
        bound3 = true;
      } catch (e) { console.log('    !! selectOption 没成：', String(e).slice(0, 120)); }
      await sleep(500);
      const confirmBtn = page.locator('[data-file-binding-dialog] button:has-text("确定")');
      if (await confirmBtn.count()) { await confirmBtn.first().click(); await sleep(900); }
    }
    const toast3 = await UI.toastText(page);
    const db = await page.evaluate(async (id) => {
      const m = await import('/src/store/sandboxStore.ts');
      return { pb: m.sandboxStore.get(id)?.partBindings || null };
    }, mi.id);
    (bound3 && db.pb && db.pb[PA] === pbId && /已保存/.test(String(toast3 || '')) ? ok : bad)(
      '[3] 确定后 file.partBindings[celltype] 写库、提示条说「已保存」',
      !bound3 ? '下拉没选中' : `partBindings=${J(db.pb)} toast=${J(toast3)}`);

    // 重载：绑定必须从**文件**里回来（不是只在内存里），且 resolvePartRef 按它解析
    await UI.boot(page, URL, { reload: true });
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1500);
    const back3 = await page.evaluate(() => !!window.__sandboxPaper);
    if (!back3) {
      skip('[3] 重载后绑定仍生效 + resolvePartRef 按绑定解析', '重载后沙盒画布没回来（前置未成，结论不作数）');
    } else {
      const open3r = await openFileBinding(page);
      const st3r = open3r ? await dlgState(page) : null;
      const rowA3r = (st3r?.rows || []).find((r) => r.name === PA);
      const res = await page.evaluate(async (pa) => {
        const g = await import('/src/lib/gateSystem.ts');
        const r = g.resolvePartRef(pa, '');
        return r ? String(r.file?.id || r.file?.name || r.file) : null;
      }, PA);
      (rowA3r && rowA3r.val === pbId && rowA3r.bound && res === pbId ? ok : bad)(
        '[3] 重载后那一行还指着选中的部件文件（绑定是存进文件的），resolvePartRef 也按它解析',
        `行=${J(rowA3r)} 解析=${J(res)} 要=${String(pbId).slice(0, 8)}…`);
      await closeFileBinding(page);
    }

    console.log('  PAGEERR:', J(perr.slice(0, 3)));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unverified} 未验证 =====`);
    await browser.close();
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    fail++;
    console.log('FATAL', String(e).slice(0, 300));
    console.log(`===== 结果: ${pass} pass, ${fail} fail, ${unverified} 未验证 =====`);
    try { await browser?.close(); } catch { }
    process.exit(1);
  } finally {
    try { server?.kill('SIGKILL'); } catch { }
  }
})();