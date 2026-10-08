// R68 闸门：n 元门的**扇入**（digitaljs `inputs`）——入口、重建、往返、如实报断线。
//
// 上游事实（都在 public/digitaljs.js 里读到，不是推测）：
//  · GateX1 族（And@2304610 / Or / Nand / Nor / Xor / Xnor）的 initialize 按 `inputs`
//    生成 in1..inN 端口，并把盒体设成 60*(n/2) × 32*(n/2)（@2302908）；
//  · `inputs` 同时被列进 `_unsupportedPropChanges`（@2303863）⇒ 事后 set 会被回滚，
//    只能重建器件 —— 与 bits/initial/groups 同族。
//  · yosys2digitaljs 不产 MuxSparse（$pmux→Mux1Hot），沙盒元件库里也没有 MuxSparse
//    ⇒ `inputs` 在今天是**只有本应用能写**的参数；r68 探针实测「存档写 inputs=4 →
//    重开变回 2、端口只剩 in1/in2/out」，这就是加白名单前那条真实的丢参数路径。
//
// 判据按臂拆开，每臂只钉一件事（任一臂红都要能说出红在哪个落点）：
//  [A] And 的右键菜单里有内联编辑项「输入引脚数」（入口在不在）
//  [B] 填 4 ⇒ 模型上是 in1..in4 + out、盒体 120×64（真的重建，不是只改了个属性）
//  [C] 保存 → 重开文件仍是 4 输入（deviceParams 白名单那一臂；没加 'inputs' 就红）
//  [D] 从 4 缩到 2 ⇒ 幸存连线只挂在 in1/in2 上，且提示条报出断开的条数（不静默吃线）
//  [E] 非法值（1 / 17 / abc）被拒且端口没变
//  [F] 全程无页面异常
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1682;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1682)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n}（${d}）`); };

const READ = () => {
  const p = window.__sandboxPaper;
  const c = p && p.model.getElements().find((e) => String(e.get('type')) === 'And');
  if (!c) return { noCell: true };
  const sz = c.get('size');
  return {
    id: String(c.id), inputs: c.get('inputs') ?? null, bits: c.get('bits') ?? null,
    inPorts: (c.get('ports')?.items || []).map((x) => String(x.id)).filter((x) => /^in\d+$/.test(x)),
    allPorts: (c.get('ports')?.items || []).map((x) => String(x.id)),
    size: sz && { width: Math.round(sz.width), height: Math.round(sz.height) },
    links: p.model.getConnectedLinks(c).length,
    linkPorts: p.model.getConnectedLinks(c).map((l) => {
      const t = l.get('target'), s = l.get('source');
      return (t?.id === c.id ? t?.port : s?.id === c.id ? s?.port : null);
    }),
  };
};

/** 造一颗常量源并把它的 out 连到 And 的某个 inK（模型级夹具：测的是重建，不是拖线） */
const FEED = (a) => {
  const p = window.__sandboxPaper;
  const d = window.digitaljs;
  const and = p.model.getCell(a.id) || p.model.getElements().find((e) => String(e.get('type')) === 'And');
  if (!and || !d?.cells?.Constant || !d?.cells?.Wire) return { err: 'no-ctor' };
  const made = [];
  for (const port of a.ports) {
    if (!and.getPort?.(port)) { made.push(`${port}:缺端口`); continue; }
    const cst = new d.cells.Constant({ constant: '0', position: { x: 40, y: 60 + made.length * 60 }, bits: 1 });
    p.model.addCell(cst);
    p.model.addCell(new d.cells.Wire({
      source: { id: cst.id, port: 'out' }, target: { id: and.id, port }, signal: '0', netname: `NR${made.length}`,
    }));
    made.push(`${port}←${String(cst.id).slice(0, 6)}`);
  }
  return { made, links: p.model.getConnectedLinks(and).length };
};

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1000);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    await UI.enterSandbox(page);
    await UI.clickGate(page, 'And');
    await sleep(700);
    const before = await page.evaluate(READ);
    if (before.noCell) { skip('[A] 菜单里有「输入引脚数」', '画布上没有 And'); console.log(`\n===== R68 fanin: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`); await browser.close().catch(() => { }); server.kill(); UI.freePort(PORT); process.exit(fail > 0 ? 1 : 0); }
    console.log('  [起点读数]', J(before));

    const centerOf = async (id) => page.evaluate((a) => {
      const p = window.__sandboxPaper;
      const c = p.model.getCell(a.id) || p.model.getElements().find((e) => String(e.get('type')) === 'And');
      if (!c) return null;
      const v = p.findViewByModel(c);
      if (!v) return null;
      const r = v.el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, { id });
    let center = await centerOf(before.id);
    if (!center) { skip('[A] 菜单里有「输入引脚数」', '拿不到 And 的屏幕坐标'); console.log(`\n===== R68 fanin: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`); await browser.close().catch(() => { }); server.kill(); UI.freePort(PORT); process.exit(fail > 0 ? 1 : 0); }
    await page.mouse.click(center.x, center.y, { button: 'right' });
    await sleep(450);
    const menu = await page.evaluate(() => {
      const root = document.querySelector('[data-context-menu]');
      if (!root) return { noMenu: true };
      return {
        buttons: [...root.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean),
        inline: [...root.querySelectorAll('div')].map((d) => {
          const sp = d.querySelector(':scope > span'); const ip = d.querySelector(':scope > input');
          return sp && ip ? (sp.textContent || '').trim() : null;
        }).filter(Boolean),
      };
    });
    (menu.inline && menu.inline.includes('输入引脚数') ? ok : bad)(
      '[A] And 的右键菜单里有内联编辑项「输入引脚数」',
      `内联项=${J(menu.inline || null)} 按钮项数=${(menu.buttons || []).length}${menu.noMenu ? ' 菜单没打开' : ''}`);
    if (menu.noMenu || !menu.inline.includes('输入引脚数')) {
      await page.keyboard.press('Escape'); await sleep(250);
      console.log(`\n===== R68 fanin: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
      process.exit(1);
    }

    // [B] 填 4 —— 已经在开着的菜单里，直接填
    await UI.menuSet(page, '输入引脚数', 4, null);
    const four = await page.evaluate(READ);
    const toastB = await UI.toastText(page);
    const sizeOk = four.size && four.size.width === 120 && four.size.height === 64;
    (four.inputs === 4 && four.inPorts.join(',') === 'in1,in2,in3,in4' && sizeOk ? ok : bad)(
      '[B] 填 4 后模型真的重建（端口 in1..in4、盒体按上游公式 120×64）',
      `inputs=${four.inputs} 端口=${J(four.allPorts)} size=${J(four.size)} 提示=${J(toastB)}`);

    // [C] 保存 → 重开文件仍是 4 输入（这一臂只钉往返，不重复判盒体）
    await page.evaluate(() => window.__sandboxSave && window.__sandboxSave());
    await sleep(900);
    const stored = await page.evaluate(async (a) => {
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      for (const f of sandboxStore.list()) {
        if (!f.graphJson) continue;
        let j; try { j = JSON.parse(f.graphJson); } catch { continue; }
        const c = (j.cells || []).find((x) => x.type === 'And' && String(x.id) === a.id);
        if (c) return { file: f.file || f.name, keys: Object.keys(c), inputs: c.inputs === undefined ? null : c.inputs };
      }
      return null;
    }, { id: four.id });
    console.log('  [存档读数]', J(stored));
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2600);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
    let reopened = null;
    if (!(await UI.backToSandbox(page))) skip('[C] 保存并重开后仍是 4 输入', '回不到沙盒画布');
    else if (!stored) skip('[C] 保存并重开后仍是 4 输入', '存档里没读到那颗 And');
    else {
      try {
        await page.locator('span').filter({ hasText: String(stored.file).replace(/\.djs$/, '') }).first().click();
        await sleep(1800);
        reopened = await page.evaluate(READ);
      } catch (e) { skip('[C] 保存并重开后仍是 4 输入', `点不开文件：${String(e).slice(0, 90)}`); }
      if (reopened && !reopened.noCell) {
        (reopened.inputs === 4 && reopened.inPorts.length === 4 ? ok : bad)(
          '[C] 保存并重开后仍是 4 输入（deviceParams 认这颗键）',
          `重开读到 inputs=${reopened.inputs} 端口=${J(reopened.allPorts)} size=${J(reopened.size)}｜存档里 inputs=${stored && stored.inputs}`);
      } else if (reopened) skip('[C] 保存并重开后仍是 4 输入', '重开后的画布上没有 And');
    }

    // [D] 缩回 2：in3/in4 上的线必须断掉且**报出断了几条**
    const feed = await page.evaluate(FEED, { id: (reopened || four).id, ports: ['in1', 'in2', 'in3', 'in4'] });
    console.log('  [喂线读数]', J(feed));
    const andId = (reopened || four).id;
    const openMenuOn = async (id) => {
      const c = await centerOf(id);
      if (!c) return false;
      await page.mouse.click(c.x, c.y, { button: 'right' });
      await sleep(450);
      return true;
    };
    if (!(await openMenuOn(andId))) skip('[D] 从 4 缩回 2：断线如实报数', '拿不到 And 的屏幕坐标');
    else {
      await UI.menuSet(page, '输入引脚数', 2, null);
      const two = await page.evaluate(READ);
      const tD = await UI.toastText(page);
      const survivors = (two.linkPorts || []).filter(Boolean);
      const lostReported = /断开\s*(\d+)\s*条/.exec(String(tD || ''));
      (two.inputs === 2 && survivors.length === 2 && survivors.every((p) => p === 'in1' || p === 'in2')
        && lostReported && Number(lostReported[1]) === 2 ? ok : bad)(
        '[D] 从 4 缩回 2：只剩 in1/in2 带线，且提示条如实报出断开 2 条',
        `inputs=${two.inputs} 幸存线端口=${J(survivors)} 提示=${J(tD)}（喂线后 links=${feed.links}）`);
    }

    // [E] 非法值：不改端口、给得出原因
    for (const [val, why] of [[1, '小于 2'], [17, '大于 16'], ['abc', '不是数字']]) {
      if (!(await openMenuOn(andId))) { skip(`[E] 拒绝非法扇入「${val}」`, '拿不到 And 的屏幕坐标'); continue; }
      await UI.menuSet(page, '输入引脚数', val, null);
      const after = await page.evaluate(READ);
      const tE = await UI.toastText(page);
      const rejected = after.inputs === 2 && after.inPorts.join(',') === 'in1,in2';
      const explained = tE && /2[–-]16/.test(tE);
      (rejected && explained ? ok : bad)(
        `[E] 拒绝非法扇入「${val}」（${why}）并保持 2 输入`,
        `读到 inputs=${after.inputs} 端口=${J(after.inPorts)} 提示=${J(tE)}`);
    }

    (perr.length ? bad : ok)('[F] 全程无页面异常', perr.slice(0, 3).join(' | '));
    console.log(`\n===== R68 fanin: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
    fail++;
    console.log(`\n===== R68 fanin: ${pass} PASS / ${fail} FAIL / ${unver} UNVERIFIED =====`);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
