// R65：numbase（数值显示的进制）在沙盒里**到底点得动、存不存得下来**（他第 3 条"要添加入口"的延伸：
// 能改的东西必须真的能改，白名单里挂着但改了不生效＝假功能）。
//
// 上游事实（bundle @2291826 起）：NumBase mixin 把 `<select class="numbase">` 放进 foreignObject
// 的 **tooltip** 里，靠 joint 视图事件 `change select.numbase → model.set('numbase', value)` 生效；
// 且 `change:bits` 时若当前进制不在 `usableDisplays()` 名单里会被打回 hex。
// 我们的画布不是完全交互的 ⇒ "这颗 select 在本应用里到底还活不活"只能实测，不能靠"上游有这功能"。
//
// 判据全部可观察，且**不预设进制名单**（先打读数，按读数判）：
//   [1] NumDisplay 的视图里有 select.numbase，且 option 数 > 1；
//   [2] 改一次值并派发 change ⇒ cell.get('numbase') 跟着变（不变＝这功能是死的）；
//   [3] 保存后**存储里的 JSON 带着 numbase**（deviceParams 白名单说它该活下来）；
//   [4] reload 重开后 cell 仍是那个进制（往返闭合）；
//   [5] 全程无页面异常。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1659;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1659)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unverified++; console.log(`  UNVERIFIED  ${n}（${d}）`); };

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
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1200);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    await UI.enterSandbox(page);
    await UI.clickGate(page, 'NumDisplay');
    await sleep(700);
    const info = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getElements().find((e) => String(e.get('type')) === 'NumDisplay');
      if (!c) return { noCell: true };
      const v = p.findViewByModel(c);
      const sel = v && v.el.querySelector('select.numbase');
      return {
        id: c.id, bits: c.get('bits'), cur: c.get('numbase') ?? null,
        hasSelect: !!sel,
        opts: sel ? Array.from(sel.options).map((o) => o.value) : [],
        selVisible: sel ? (() => { const r = sel.getBoundingClientRect(); return r.width > 0 && r.height > 0; })() : false,
      };
    });
    if (info.noCell) { skip('[1] select.numbase 存在', '画布上没有 NumDisplay'); }
    else (info.hasSelect && info.opts.length > 1 ? ok : bad)(
      '[1] NumDisplay 视图里有进制下拉，且不止一个选项',
      `bits=${info.bits} 当前=${info.cur} 选项=${J(info.opts)} 可视=${info.selVisible}`);
    if (!info.hasSelect || info.opts.length < 2) { console.log(`\n===== R65: ${pass} PASS / ${fail} FAIL / ${unverified} UNVERIFIED =====`); process.exit(fail > 0 ? 1 : 0); }

    const want = info.opts.find((o) => o !== info.cur) || info.opts[0];
    // [2] 派发 change（joint 视图事件；不用鼠标，因为它藏在 tooltip 里）
    const changed = await page.evaluate((a) => {
      const p = window.__sandboxPaper;
      const c = p.model.getCell(a.id);
      const sel = p.findViewByModel(c).el.querySelector('select.numbase');
      if (!sel) return { err: 'no-select' };
      sel.value = a.want;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { after: c.get('numbase'), dom: sel.value };
    }, { id: info.id, want });
    const wantNorm = want || info.opts[0];
    (String(changed.after) === String(wantNorm) ? ok : bad)(
      '[2] 改一次进制真的写进模型（不是只改了 DOM）',
      `想要=${J(wantNorm)} ⇒ cell.numbase=${J(changed.after)} select.value=${J(changed.dom)}（原本 ${J(info.cur)}）`);

    // [3] 保存 ⇒ 存储里那颗器件带 numbase
    await page.evaluate(() => window.__sandboxSave && window.__sandboxSave());
    await sleep(900);
    const storedRow = await page.evaluate(async (a) => {
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      for (const f of sandboxStore.list()) {
        if (!f.graphJson) continue;
        let j; try { j = JSON.parse(f.graphJson); } catch { continue; }
        const c = (j.cells || []).find((x) => x.type === 'NumDisplay' && x.id === a.id);
        if (c) return { file: f.name, numbase: c.numbase === undefined ? null : c.numbase, keys: Object.keys(c).filter((k) => /numbase|bits/i.test(k)) };
      }
      return null;
    }, { id: info.id });
    (storedRow && String(storedRow.numbase) === String(wantNorm) ? ok : bad)(
      '[3] 保存后存储里的这颗器件带着新进制（白名单真生效）', J(storedRow));

    // [4] reload 重开 ⇒ 仍是那个进制
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2600);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
    const reopened = await page.evaluate(async (a) => {
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      const f = sandboxStore.list().find((x) => x.graphJson && /NumDisplay/.test(x.graphJson));
      return f ? f.name : null;
    }, {});
    if (!reopened) { skip('[4] reload 后进制还在', '存储里找不到含 NumDisplay 的文件'); }
    else {
      if (!(await UI.backToSandbox(page))) skip('[4] reload 后进制还在', '回不到沙盒画布');
      else {
        await page.locator('span').filter({ hasText: reopened.replace(/\.djs$/, '') }).first().click();
        await sleep(1800);
        const after = await page.evaluate(() => {
          const p = window.__sandboxPaper;
          const c = p && p.model.getElements().find((e) => String(e.get('type')) === 'NumDisplay');
          return c ? { bits: c.get('bits'), numbase: c.get('numbase') ?? null } : null;
        });
        (after && String(after.numbase) === String(wantNorm) ? ok : bad)(
          '[4] reload 重开文件后进制仍是它（往返闭合）', `文件=${reopened} 读到=${J(after)} 期望=${J(wantNorm)}`);
      }
    }

    (perr.length ? bad : ok)('[5] 全程无页面异常', perr.slice(0, 3).join(' | '));
    console.log(`\n===== R65 numbase: ${pass} PASS / ${fail} FAIL / ${unverified} UNVERIFIED =====`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
    fail++;
    console.log(`\n===== R65 numbase: ${pass} PASS / ${fail} FAIL / ${unverified} UNVERIFIED =====`);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
