// R82 验收（用户裁决 R-B：跨文件夹移动要自动 ensure-def）：**文件搬进新文件夹，带不走定义就得在新文件夹里把定义补出来**。
//
// 为什么这是用户裁决而不是我加的活：`ensureDefsFromCells` 早就在粘贴（SandboxCanvas.tsx:1602）、
// 剪贴板复制（1706）、导入 `.djs`（3091）三条路上跑了，唯独"移动文件"只 `moveFilesToFolder` + sync
// ⇒ 画布里那些**只剩内嵌快照、没有同名部件文件**的实例（旧存档、部件被删过的存档）进了新文件夹后
// 仍靠「根→全库」兜底解析：文件夹不自治，而同文件夹一旦出现同名部件时解析结果会随遮蔽打分翻面。
//
// 夹具（全程真 UI，不自造 store 状态；**每份夹具都用同一个配方现造现用**）：
//   新画布放 Input/Output → 存为部件 NAME → 再开一张画布 → 左侧栏点「放置部件」放一颗实例
//   → 从文件树**删掉** NAME.djs → 保存这张画布。
//   删部件之后再保存这一步是关键：`stripBoundInlineJson` 只在"部件存在"时剥内嵌快照
//   （gateSystem.ts:437），部件没了就剥不了 ⇒ 存档里留下 `subcircuitGraph`，正是"带不走定义"的形状。
//   ⚠ 一份夹具只能用一次：搬完之后重开文件会让应用自动提交，那时若部件已被补出来，快照就被剥了
//     （第一版就是这么把拖拽臂的前置用光的，读数 `拖前内嵌快照=false` ⇒ 那一格只能记 UNVERIFIED，
//      不能读成"通过"）。所以 A、B 两份各造各用。
//
// 两条移动路径各有调用点，必须各测各的（只测一条就是把另一条当"没改的旧代码"）：
//   · 拖拽：SandboxFileTree 的 onDrop → props.onMoveFiles → `handleMoveFiles`（臂 [2A]）；
//   · 剪切→粘贴：`handlePasteInto` 的 cut 分支（臂 [2B][3B]）。
//
// 臂：[1A]/[1B] 夹具形状；[2A] 拖进文件夹补定义；[2B] 剪切粘贴补定义；[3B] 提示条说实话；
//     [4B] 搬完后实例仍能在画布上展开内部电路；[5B] 再搬出去／再搬回来不多造副本、仍是同一颗文件。
//
// 变异验证（各臂要咬得住自己那一条路径）：
//   · 剪贴板那条不补（cut 分支改 `carried = 0`）⇒ 只红 [3][4][5][6][7] 那一族（本表 [2B][3B][4B][5B]）；
//   · 拖拽那条不补（`handleMoveFiles` 改 `carried = 0`）⇒ 只红 [2A]，其余六格保持绿。
//
// ⚠ JointJS 的 `isLink` 是**方法**：`getCells().filter(c => !c.isLink)` 里函数恒真 ⇒ 一颗器件都留不下，
//   读数会变成"画布 0 颗"这种假现场（第一版就栽在这里）。这里一律按 `c.get('type')` 筛。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1582;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1582)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unverified++; console.log(`  UNVERIFIED  ${n}（${d}）`); };

const STAMP = Date.now() % 100000;
const NAME_A = 'RbA' + STAMP;
const NAME_B = 'RbB' + STAMP;
const SUB_A = 'r82drag';
const SUB_B = 'r82paste';

/** JointJS 的 `isLink` 是**方法**，`filter(c => !c.isLink)` 会把每颗器件都筛掉（函数恒真）⇒ 一律按 type 筛 */
const canvasSubs = (page) => page.evaluate(() => {
  const p = window.__sandboxPaper;
  if (!p) return { noPaper: true, n: 0, types: [] };
  const all = p.model.getCells();
  const cs = all.filter((c) => String(c.get('type')) === 'Subcircuit');
  return { n: cs.length, celltype: cs[0] ? String(cs[0].get('celltype') || '') : null, types: all.map((c) => String(c.get('type'))).slice(0, 8) };
});
/** 从 name 的斜杠路径推所在文件夹（store 里没有维护 SandboxFile.folder 这个字段） */
const dirOfName = (n) => (String(n).includes('/') ? String(n).slice(0, String(n).lastIndexOf('/')) : '');

/** 认出"存档里带 NAME 实例的那份主文件"，并报告它有没有内嵌快照 */
const findMain = (page, cm) => page.evaluate(async (name) => {
  const m = await import('/src/store/sandboxStore.ts');
  for (const f of m.sandboxStore.list()) {
    if (f.role === 'part') continue;
    let obj = null;
    try { obj = JSON.parse(f.graphJson || '{}'); } catch { continue; }
    const cs = (obj.cells || []).filter((c) => c && c.type === 'Subcircuit' && String(c.celltype || '') === name);
    if (cs.length) return { id: String(f.id), name: String(f.name), nSub: cs.length, inline: !!(cs[0].subcircuitGraph && cs[0].subcircuitGraph.cells) };
  }
  return null;
}, cm);

const partFiles = (page, cm) => page.evaluate(async (name) => {
  const m = await import('/src/store/sandboxStore.ts');
  return m.sandboxStore.list().filter((f) => f.role === 'part' && String(f.name).includes(name))
    .map((f) => String(f.name));
}, cm);

/** 右键某一行 → 点那一项（菜单锚点 data-context-menu；项用 el.click()，带动画等不到"稳定"） */
async function rowMenu(page, sel, label) {
  const el = page.locator(sel).first();
  if (!(await el.count())) throw new Error(`rowMenu: 找不到行 ${sel}`);
  await el.click({ button: 'right' });
  await sleep(450);
  const done = await page.evaluate((t) => {
    const b = Array.from(document.querySelectorAll('[data-context-menu] button'))
      .find((x) => String(x.textContent || '').trim() === t);
    if (!b || b.disabled) return false;
    b.click(); return true;
  }, label);
  await sleep(700);
  return done;
}

/** 回到文件面板并**现取**文件树矩形（坐标绝不能缓存：面板换过之后老坐标点到别的东西上） */
async function treeRect(page) {
  await page.locator('button[data-activity="files"]').first().click().catch(() => { });
  await sleep(600);
  const el = page.locator('[data-sandbox-filetree]').first();
  if (!(await el.count())) throw new Error('treeRect: 文件树容器不在（左侧面板没停在「文件」）');
  const box = await el.boundingBox();
  if (!box) throw new Error('treeRect: 文件树容器没有尺寸');
  return box;
}
/** 在文件树空白处右键 = 根目录语境 */
async function rootRightClick(page) {
  const box = await treeRect(page);
  await page.mouse.click(Math.round(box.x + 22), Math.round(box.y + box.height - 14), { button: 'right' });
  await sleep(500);
  return box;
}

/**
 * 建文件夹。R101 起沙盒的「新建文件夹」与编译模式一致：**点菜单项后弹 PromptDialog**
 * （菜单里不再有内联输入框），所以这里改为「点项 → 填弹窗 → 回车」。
 */
async function makeFolder(page, name) {
  await rootRightClick(page);
  const item = page.locator('[data-context-menu] button:has-text("新建文件夹")').first();
  if (!(await item.count())) return false;
  await item.click();
  await sleep(500);
  const dlg = page.locator('[role="dialog"], [role="alertdialog"]').last();
  try { await dlg.waitFor({ timeout: 6000 }); } catch { return false; }
  await dlg.locator('input').first().click();
  await page.keyboard.press('ControlOrMeta+a'); await sleep(80);
  await page.keyboard.type(name); await sleep(120);
  await page.keyboard.press('Enter');
  await sleep(900);
  return (await page.locator(`[data-sbfolder="${name}"]`).count()) === 1;
}

/** 现造一份"有实例、无部件文件、存档留内嵌快照"的夹具 */
async function buildFixture(page, name) {
  await UI.newSandboxFile(page);
  await UI.clickGate(page, 'Input'); await UI.clickGate(page, 'Output'); await sleep(400);
  await page.locator('button[title^="将当前电路保存为自定义门"]').first().click(); await sleep(400);
  await page.locator('input[placeholder="自定义门名称"]').fill(name); await sleep(200);
  await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(1000);
  const partsAfterSave = await partFiles(page, name);

  await UI.newSandboxFile(page);                       // 主文件：另开一张画布
  const placed = await page.evaluate((n) => {
    const b = Array.from(document.querySelectorAll('button'))
      .find((x) => String(x.title || '').startsWith('放置部件') && String(x.textContent || '').trim() === n);
    if (!b) return false; b.click(); return true;
  }, name);
  await sleep(900);

  await page.locator('button[data-activity="files"]').first().click(); await sleep(600);
  const delOk = await rowMenu(page, `[data-sbfile$="${name}.djs"]`, '删除');
  await sleep(900);
  await page.locator('button[title^="保存当前沙盒文件"]').first().click(); await sleep(1000);

  const main = await findMain(page, name);
  const canvas = await canvasSubs(page);
  const partsNow = await partFiles(page, name);
  return { partsAfterSave, placed, delOk, main, canvas, partsNow };
}

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await UI.enterSandbox(page);
    await page.locator('button[data-activity="files"]').first().click(); await sleep(600);
    const treeBox = await treeRect(page);   // 只用于开局确认容器在；坐标一律现取，不缓存

    // ================= 夹具 A：给**拖拽**这条臂 =================
    const A = await buildFixture(page, NAME_A);
    console.log('  [夹具A]', J({ partsAfterSave: A.partsAfterSave, placed: A.placed, delOk: A.delOk, main: A.main, canvas: A.canvas, partsNow: A.partsNow }));
    (A.partsAfterSave.length === 1 && A.placed && A.delOk && A.canvas.n === 1 && A.main && A.main.inline && A.partsNow.length === 0
      ? ok : bad)('[1A] 夹具 A 形状：一颗绑定 NAME_A 的实例在画布上、部件文件已删、存档仍留内嵌快照',
      `部件存过=${J(A.partsAfterSave)} 放件=${A.placed} 删=${A.delOk} 画布=${J(A.canvas)} 内嵌=${A.main && A.main.inline} 删后部件=${J(A.partsNow)}`);

    const folderA = await makeFolder(page, SUB_A);
    let dragOk = false;
    if (folderA && A.main) {
      // ⚠ 落点必须是**那一行文件夹**：丢在文件树空白处＝"移到根目录"。
      //   第一版就是丢在树体上：主文件没进 SUB_A（看着像拖没生效），可部件却被补在了根里
      //   —— 拖动其实成功了，只是拖去了另一个目的地。
      await page.locator(`[data-sbfile="${A.main.name}"]`).first()
        .dragTo(page.locator(`[data-sbfolder="${SUB_A}"]`).first())
        .catch(() => { });
      await sleep(1600);
      const moved = await findMain(page, NAME_A);
      dragOk = !!moved && dirOfName(moved.name) === SUB_A;
    }
    const partsA = await partFiles(page, NAME_A);
    console.log('  [拖拽臂] 建夹=', folderA, ' 拖成=', dragOk, ' 部件=', J(partsA));
    (!folderA || !dragOk ? skip : partsA.length === 1 && dirOfName(partsA[0]) === SUB_A ? ok : bad)(
      '[2A] 拖拽进新文件夹：主文件真进了 ' + SUB_A + '，且该文件夹里补出 1 颗部件定义（拖这条径也跑）',
      !folderA || !dragOk ? `建夹=${folderA} 拖成=${dragOk}（前置没成，不作数）` : J(partsA));

    // ================= 夹具 B：给**剪切→粘贴**这条臂 =================
    const B = await buildFixture(page, NAME_B);
    console.log('  [夹具B]', J({ partsAfterSave: B.partsAfterSave, placed: B.placed, delOk: B.delOk, main: B.main, inline: B.main && B.main.inline }));
    (B.partsAfterSave.length === 1 && B.placed && B.delOk && B.main && B.main.inline && B.partsNow.length === 0
      ? ok : bad)('[1B] 夹具 B 形状同上（给粘贴这条臂用）',
      `部件存过=${J(B.partsAfterSave)} 放件=${B.placed} 删=${B.delOk} 内嵌=${B.main && B.main.inline} 删后部件=${J(B.partsNow)}`);

    const folderB = await makeFolder(page, SUB_B);
    const cut = folderB && B.main ? await rowMenu(page, `[data-sbfile="${B.main.name}"]`, '剪切') : false;
    const pasted = folderB ? await rowMenu(page, `[data-sbfolder="${SUB_B}"]`, '粘贴') : false;
    const toast = await UI.toastText(page);
    await sleep(1500);
    const movedB = await findMain(page, NAME_B);
    const partsB = await partFiles(page, NAME_B);
    console.log('  [粘贴臂] 建夹=', folderB, ' 剪切=', cut, ' 粘贴=', pasted, ' 主文件=', J(movedB && movedB.name), ' 部件=', J(partsB), ' toast=', J(toast));

    (!cut || !pasted ? skip : movedB && dirOfName(movedB.name) === SUB_B && partsB.length === 1 && dirOfName(partsB[0]) === SUB_B
      ? ok : bad)('[2B] 剪切→粘贴进 ' + SUB_B + '：主文件真进去了，且该文件夹里补出 1 颗部件定义',
      !cut || !pasted ? `剪切=${cut} 粘贴=${pasted}（没做成移动，不作数）` : `主文件=${J(movedB && movedB.name)} 部件=${J(partsB)}`);

    (/随行补齐\s*1/.test(String(toast || '')) ? ok : bad)('[3B] 提示条说实话：明说补了 1 颗随行定义', J(toast));

    // ---- [4B] 搬完之后那颗实例仍要能展开（绑定真可用，不是"多了个文件"）----
    const reopened = await page.locator(`[data-sbfile="${movedB ? movedB.name : ''}"]`).count();
    if (reopened) { await page.locator(`[data-sbfile="${movedB.name}"]`).first().click(); await sleep(1400); }
    const zoomSeen = await page.waitForFunction((n) => {
      const p = window.__sandboxPaper;
      const sub = p && p.model.getCells().find((c) => String(c.get('type')) === 'Subcircuit' && String(c.get('celltype') || '') === n);
      const v = sub && sub.findView(p);
      return !!(v && v.el.querySelector('a.zoom'));
    }, NAME_B, { timeout: 9000 }).then(() => true).catch(() => false);
    const clicked = zoomSeen ? await page.evaluate((n) => {
      const p = window.__sandboxPaper;
      const sub = p.model.getCells().find((c) => String(c.get('type')) === 'Subcircuit' && String(c.get('celltype') || '') === n);
      const v = sub && sub.findView(p);
      const a = v && v.el.querySelector('a.zoom');
      if (a) a.click();
      return !!a;
    }, NAME_B) : false;
    await sleep(1400);
    const inner = await page.evaluate(() => {
      const host = document.querySelector('[data-inner-host]');
      const title = Array.from(document.querySelectorAll('span')).find((s) => (s.textContent || '').startsWith('内部电路：'));
      return { open: !!host, hasSvg: !!(host && host.querySelector('svg')), title: title ? title.textContent.trim() : null };
    });
    console.log('  [展开]', J({ reopened, zoomSeen, clicked, ...inner }));
    (reopened === 1 && zoomSeen && clicked && inner.open && inner.hasSvg ? ok : bad)(
      '[4B] 搬进新文件夹后实例仍能展开内部电路', `重开=${reopened} 锚点=${zoomSeen} 点=${clicked} 弹框=${inner.open} svg=${inner.hasSvg} 标题=${J(inner.title)}`);
    if (inner.open) { await page.locator('button[title="关闭"]').first().click().catch(() => { }); await sleep(500); }

    // ---- [5B] 幂等：再搬回根、再搬进 SUB_B，部件始终 1 颗、主文件仍是同一份 ----
    const back1 = movedB ? await rowMenu(page, `[data-sbfile="${movedB.name}"]`, '剪切') : false;
    await rootRightClick(page);
    const pastRoot = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('[data-context-menu] button')).find((x) => String(x.textContent || '').trim() === '粘贴');
      if (!b || b.disabled) return false; b.click(); return true;
    });
    await sleep(1400);
    const r2 = await findMain(page, NAME_B);
    const back2 = r2 ? await rowMenu(page, `[data-sbfile="${r2.name}"]`, '剪切') : false;
    const pastSub2 = await rowMenu(page, `[data-sbfolder="${SUB_B}"]`, '粘贴');
    await sleep(1400);
    const partsC = await partFiles(page, NAME_B);
    const r3 = await findMain(page, NAME_B);
    console.log('  [幂等] 搬回根=', back1, pastRoot, ' 再进 SUB=', back2, pastSub2, ' 部件=', J(partsC), ' 仍是那颗=', r3 && r3.id === B.main.id);
    (partsC.length === 1 && r3 && r3.id === B.main.id ? ok : bad)(
      '[5B] 再搬出去／再搬回来：部件仍 1 颗、主文件仍是同一份（补定义幂等，没造出副本）',
      `部件=${J(partsC)} id 相同=${r3 && r3.id === B.main.id} 搬动=${back1}/${pastRoot}/${back2}/${pastSub2}`);

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
