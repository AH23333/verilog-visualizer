// R84 验收（用户裁决 R-A：「要添加入口」＝部件绑定的**全局视图**）
//
// 他要的不是"再多几颗右键项"——换绑此前只能一颗一颗实例地操作，而他想知道的是
// "这张图里谁绑到哪儿了、哪个已经失效"。那是一个**表**。落点：沙盒左侧栏「设置」旁
// 新增一颗「部件绑定」（`button[data-sandbox-bindings]`），打开 `BindingDialog`。
// 换绑仍走现成的 `rebindSubcircuitCell`（重建实例 + 按端口名接回连线），
// 所以这一格里没有第二套绑定逻辑可写——也就没有"弹窗自己算了一套、真解析另一套"的飘掉空间。
//
// 判据（射程各自写清）：
//   [1] 入口在：那颗按钮存在、可用、点开有弹窗；
//   [2] 行数与画布对账：弹窗里的行数 == 画布上 Subcircuit 的颗数（成对判据，不是"大于 0"）；
//   [3] 状态列说实话：把部件文件删掉后重扫 ⇒ 那一行从「已绑定」变「绑定失效」
//       （他第 9 条的痛点：挂着名字但放不出来 / 展不开）；
//   [4] 换绑真生效：在弹窗里把那颗**失效**实例换到 B ⇒ 画布上那颗的 celltype 变 B、端口数按 B 重算、
//       提示条报「已换绑到」；
//   [5] 实际解析列不许自说自话：DOM 里报的文件夹必须等于 `resolvePartRef(name, scope)`
//       **现算**的结果，且夹具要真的构成遮蔽（同一颗名字在根与子文件夹各一份、两个作用域解析到
//       不同文件），否则这格验不出"按作用域挑选"。
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
const SUB = 'r84sub';

const subCount = (page) => page.evaluate(() => {
  const p = window.__sandboxPaper;
  if (!p) return { noPaper: true, n: 0, rows: [] };
  const cs = p.model.getCells().filter((c) => !c.isLink() && String(c.get('type')) === 'Subcircuit');
  return { n: cs.length, rows: cs.map((c) => ({ id: String(c.id), celltype: String(c.get('celltype') || ''), ports: (c.getPorts?.() || []).length })) };
});
/** 弹窗里的表格行（DOM 是唯一真相：列名、状态、实际解析都按屏幕上看到的读） */
const dlgRows = (page) => page.evaluate(() => {
  const dlg = document.querySelector('[data-binding-dialog]');
  if (!dlg) return null;
  return Array.from(dlg.querySelectorAll('tbody tr')).map((tr) => {
    const td = Array.from(tr.querySelectorAll('td'));
    const sel = tr.querySelector('select');
    return {
      inst: (td[0]?.textContent || '').replace(/定位$/, '').trim(),
      state: (td[1]?.textContent || '').replace(/⟡/, '').trim(),
      mark: (td[1]?.textContent || '').includes('⟡'),
      bound: (td[2]?.textContent || '').trim(),
      resolved: (td[3]?.textContent || '').trim(),
      select: sel ? String(sel.value) : null,
      selectId: sel ? String(sel.getAttribute('data-binding-select')) : null,
    };
  });
});
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
/**
 * 点开绑定总览；**入口按钮不在就直接返回 false**。
 * ⚠ 这一句守的是反向探针 M1：把 `data-sandbox-bindings` 改名后，不带守卫的 `locator.click()`
 *   会在 30 s 超时里抛错 ⇒ 整颗闸门 FATAL，于是"入口没了"这件本该报 **FAIL** 的事
 *   被读成"后面几格没判定"。前置没了要各格自己说"未验证"，不是整颗崩掉。
 */
async function openBindings(page) {
  const b = page.locator('button[data-sandbox-bindings]');
  if (!(await b.count())) return false;
  await b.first().click(); await sleep(900);
  return (await page.locator('[data-binding-dialog]').count()) === 1;
}

async function fileMenu(page, sel, label) {  const el = page.locator(sel).first();
  if (!(await el.count())) throw new Error(`找不到行 ${sel}`);
  // 现场诊断：Playwright 的 call log 在流里会被截掉，看不清"谁拦住了点击"——自己读一次。
  const who = await page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return { noEl: true };
    const r = e.getBoundingClientRect();
    const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
    return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      top: top ? `${top.tagName}.${String(top.className).slice(0, 40)}` : null,
      topAttrs: top ? Array.from(top.attributes || []).map((a) => `${a.name}=${a.value.slice(0, 24)}`).join(' ') : null };
  }, sel);
  console.log(`    [诊断 ${label}]`, J(who));
  await el.click({ button: 'right' }); await sleep(450);
  const done = await page.evaluate((t) => {
    const b = Array.from(document.querySelectorAll('[data-context-menu] button')).find((x) => String(x.textContent || '').trim() === t);
    if (!b || b.disabled) return false; b.click(); return true;
  }, label);
  await sleep(800);
  return done;
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
    // 前置没成要在 9 s 内说话，别把 30 s 默认超时耗在等一颗不存在的按钮上（反向探针 M1 实测）
    page.setDefaultTimeout(30000);
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await UI.enterSandbox(page);

    // 部件 A（根目录）：一张只放 Input/Output 的画布
    await UI.clickGate(page, 'Input'); await UI.clickGate(page, 'Output'); await sleep(400);
    await partFromCanvas(page, PA);
    // 部件 B：**另开一张干净画布**再放 Input/Output ⇒ B 的定义与 A 无关。
    // ⚠ 第一版在"已经放着 A 实例"的那张画布上直接存 B，于是 B 的定义里嵌着对 A 的引用；
    //   [3] 删掉 A 之后 B 自己也成了"没有可用定义"，[4] 换绑必然取消 —— 那是夹具自己造的假红。
    await UI.newSandboxFile(page);
    await UI.clickGate(page, 'Input'); await UI.clickGate(page, 'Output'); await sleep(400);
    await partFromCanvas(page, PB);
    // 主画布：另开一张，放一颗 A 实例
    await UI.newSandboxFile(page);
    await placePart(page, PA);
    await page.locator('button[data-activity="files"]').first().click(); await sleep(700);

    // ===== [1] 入口在 =====
    const btnCount = await page.locator('button[data-sandbox-bindings]').count();
    const opened1 = btnCount ? await openBindings(page) : false;
    (btnCount === 1 && opened1 ? ok : bad)('[1] 左侧栏有「部件绑定」入口，点开是总览弹窗',
      `按钮=${btnCount} 弹窗开起来=${opened1}`);

    // ===== [2] 行数 == 画布上的实例数 =====
    const canvas = await subCount(page);
    const rows = await dlgRows(page);
    console.log('  [对账] 画布=', J(canvas), ' 弹窗行=', J(rows));
    (rows && rows.length === canvas.n && canvas.n >= 1 ? ok : bad)(
      '[2] 弹窗行数与画布上子电路实例数逐一对上（不是"有一行就算过"）',
      `画布 ${canvas.n} 颗 / 弹窗 ${rows ? rows.length : '没读到'} 行`);

    // ===== [3] 删掉部件文件 ⇒ 状态列改口「绑定失效」 =====
    // ⚠ 弹窗是 `inset:0` 的遮罩：不先关掉，后面每次点文件树/画布都被它拦住
    //   （本仓 R79 记过的位宽遮罩同一族）。这里先把"Esc 到没到 document"量出来再说结论——
    //   遮罩关不掉可以有两种因：事件根本没到（键盘焦点问题）／到了但没人处理（处理器没挂上）。
    const beforeState = (rows || []).find((r) => r.bound === PA);
    await page.evaluate(() => { window.__escN = 0; const h = () => { window.__escN++; }; window.__escH = h; document.addEventListener('keydown', h); });
    await page.keyboard.press('Escape'); await sleep(500);
    const escProbe = await page.evaluate(() => {
      if (window.__escH) document.removeEventListener('keydown', window.__escH);
      return { reached: window.__escN ?? null, dlgStill: !!document.querySelector('[data-binding-dialog]') };
    });
    console.log('    [Esc 诊断]', J(escProbe));
    const closed3 = escProbe.dlgStill === false;
    const del = await fileMenu(page, `[data-sbfile$="${PA}.djs"]`, '删除');
    const reopened3 = await openBindings(page);   // 重开＝重新扫描
    const rows3 = await dlgRows(page);
    const rowA = (rows3 || []).find((r) => r.bound === PA);
    console.log('  [删部件后] Esc 关得掉=', closed3, ' ', J(rowA), ' 删除动作=', del, ' 重开=', reopened3);
    (!del || !reopened3 || !rowA ? skip : rowA.state === '绑定失效' && beforeState && beforeState.state === '已绑定'
      ? ok : bad)('[3] 删掉部件文件后重扫，那一行从「已绑定」变「绑定失效」（Esc 也关得掉弹窗）',
      !del || !reopened3 || !rowA ? `删除=${del} 重开=${reopened3} 读到行=${J(rowA)}` : `点删除前=${J(beforeState && beforeState.state)} 现在=${J(rowA.state)} Esc=${closed3}`);

    // ===== [4] 在弹窗里换绑 ⇒ 画布真变（此时那一行是「绑定失效」，正是他第 9 条的现场）=====
    // 现场依据（r84-probe3 实测）：失效行同样换得回来 —— change 到了 React（chg=1）、
    // 画布那颗 celltype 变 PB、端口 2 颗、提示条「已换绑到「PB」」。
    // ⚠ 找行只认「绑定到」那一列：失效行的 <select> 读出来是空串（当前值在选项里不存在，
    //   React 把选择框落回「（未绑定）」），拿 select.value 当绑定名会一行也找不到。
    const rows4pre = await dlgRows(page);
    const target = (rows4pre || []).find((r) => r.bound === PA);
    const opts = target && target.selectId ? await page.evaluate((id) => {
      const s = document.querySelector(`select[data-binding-select="${id}"]`);
      return s ? Array.from(s.options).map((o) => o.value) : null;
    }, target.selectId) : null;
    let swapped = false;
    if (target && target.selectId && opts && opts.includes(PB)) {
      try { await page.selectOption(`select[data-binding-select="${target.selectId}"]`, PB); swapped = true; }
      catch (e) { console.log('    !! selectOption 没成：', String(e).slice(0, 120)); }
      await sleep(1600);
    }
    const toast4 = await UI.toastText(page);
    const canvas4 = await subCount(page);
    console.log('  [换绑后] 选项=', J(opts), ' 发起=', swapped, ' 画布=', J(canvas4), ' toast=', J(toast4));
    (!swapped ? skip : canvas4.rows.length === 1 && canvas4.rows[0].celltype === PB && canvas4.rows[0].ports === 2
      && /已换绑/.test(String(toast4)) ? ok : bad)(
      '[4] 在总览里把那颗失效实例换绑到 B：画布上那颗的绑定名与端口数按 B 重算，提示条说实话',
      !swapped ? `下拉里没有 B 这一项（选项=${J(opts)} 行=${J(target)}）` : `画布=${J(canvas4.rows)} toast=${J(toast4)}`);

    // ===== [5] 「实际解析」列 == resolvePartRef 现算的结果（同名遮蔽时唯一能解释行为的字段）=====
    await page.keyboard.press('Escape'); await sleep(500);
    // 遮蔽夹具：往子文件夹再写一份**同名**部件（把根目录那一份的画布原样抄过去）。
    // ⚠ 不走 UI 建文件：那要「先切到文件栏建文件夹 → 建文件 → 开它 → 切回放件栏放 Input/Output
    //   → 再存部件 → 切回主文件」六步，而 r84-probe2 实测「放置部件」那一列在「文件」栏下根本
    //   不在 DOM 里（`[放件] false`）—— 夹具在半路就静默空跑了。这一格只管"库里有两颗同名"。
    const twin = await page.evaluate(async ({ n, sub }) => {
      const m = await import('/src/store/sandboxStore.ts');
      const src = m.sandboxStore.list().find((f) => f.role === 'part' && f.name === n + '.djs');
      if (!src) return { noSrc: true, have: m.sandboxStore.list().map((f) => `${f.name}|${f.role ?? ''}`) };
      const created = m.sandboxStore.create(`${sub}/${n}.djs`, 'part');
      m.sandboxStore.save(created.id, src.graphJson);
      return { wrote: created.name };
    }, { n: PB, sub: SUB });
    console.log('  [遮蔽夹具]', J(twin));
    // 弹窗抬头那句「库里有部件 N 颗」读的是 React 里的部件清单：直接写库它不会重扫 ⇒ 重载一次
    // （顺带验一份真东西：换绑后的绑定是**存进文件**的，不是只在内存里）。
    await UI.boot(page, URL, { reload: true });
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1500);
    const back = await page.evaluate(() => !!window.__sandboxPaper);
    if (!back) {
      skip('[5] 「实际解析」列等于 resolvePartRef 现算的那一颗，且同名 ⟡ 标出来', '重载后沙盒画布没回来（前置未成，结论不作数）');
    } else {
      const opened5 = await openBindings(page);
      const rows5 = opened5 ? await dlgRows(page) : null;
      const rowB = (rows5 || []).find((r) => r.bound === PB);
      const calc = await page.evaluate(async ({ n, sub }) => {
        const g = await import('/src/lib/gateSystem.ts');
        const dir = (f) => { const s = String(f.name); return s.includes('/') ? s.slice(0, s.lastIndexOf('/')) : ''; };
        const sameName = (await import('/src/store/sandboxStore.ts')).sandboxStore.list()
          .filter((f) => f.role === 'part').map((f) => f.name).filter((s) => s.replace(/\.djs$/, '').split('/').pop() === n).length;
        const a = g.resolvePartRef(n, ''), b = g.resolvePartRef(n, sub);
        return { sameName, root: a ? dir(a.file) : null, sub: b ? dir(b.file) : null };
      }, { n: PB, sub: SUB });
      console.log('  [遮蔽] 现算=', J(calc), ' 弹窗那行=', J(rowB));
      (calc.sameName < 2 || twin.noSrc ? skip : calc.root === calc.sub ? skip : !rowB || calc.root === null ? skip
        : rowB.resolved === (calc.root === '' ? '根目录' : `${calc.root}/`) && rowB.mark
          ? ok : bad)(
        '[5] 「实际解析」列等于 resolvePartRef 现算的那一颗，且同名 ⟡ 标出来',
        calc.sameName < 2 || twin.noSrc ? `同名部件只有 ${calc.sameName} 颗（夹具=${J(twin)}），遮蔽没造起来`
          : calc.root === calc.sub ? `两个作用域解析到同一颗（${J(calc)}）⇒ 这格验不出"按作用域挑选"`
            : !rowB || calc.root === null ? `行/解析缺失 行=${J(rowB)} 现算=${J(calc)}`
              : `列=${J(rowB.resolved)} 现算=${J(calc.root)} ⟡=${J(rowB.mark)}`);
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
