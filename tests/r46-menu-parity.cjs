// R46：两种模式画布右键菜单的词条对账（增量统一：措辞一致 + 沙盒补上导出）
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1563;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1563)); } catch { } const URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
const freePort = (p) => { try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' }); } catch { } };
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const dismiss = async (page) => { try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { } };

const menuItems = (page) => page.evaluate(() => {
  const m = document.querySelector('[data-context-menu]');
  if (!m) return null;
  return Array.from(m.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean);
});
const rightClickAt = async (page, x, y) => {
  await page.mouse.move(x, y); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  await sleep(900);
};

(async () => {
  let server, b;
  try {
    freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();   // R74 那一族：stdio:'pipe' 的孙进程攥着标准流 ⇒ 闸门跑完不退，ENVRED 假红
    const dl = Date.now() + 45000; let up = false;
    while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) { up = true; break; } } catch { } await sleep(500); }
    if (!up) { console.log('FATAL 开发服务未起来'); process.exit(1); }
    b = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300); await dismiss(page);
    for (const f of ['adder.v', 'full_adder.v']) {
      await page.evaluate(async (a) => { const { fileStore } = await import('/src/store/fileStore.ts'); const nf = fileStore.createFile(a.n); fileStore.saveContent(nf.id, a.c); }, { n: f, c: rd(f) });
    }
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300); await dismiss(page);
    await page.locator('[title="adder.v"]').first().click({ force: true }); await sleep(900);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    for (let i = 0; i < 60; i++) { await sleep(700); const done = await page.evaluate(async () => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getAll()[0]; return !!(f && f.status === 'compiled' && f.circuitJson); }); if (done) break; }
    await sleep(3000);

    // ---- 编译模式画布菜单 ----
    const cbox = await page.evaluate(() => { const r = document.querySelector('.joint-paper').getBoundingClientRect(); return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.6 }; });
    await rightClickAt(page, cbox.x, cbox.y);
    const compileMenu = await menuItems(page);
    console.log('  编译模式:', JSON.stringify(compileMenu));
    // ---- [H] 「放大」这一颗不是死菜单：点下去 wrapper 的 scale 真的变了 ----
    // ⚠ 必须在 Escape 之前做（菜单一关就得重新右键，而重新右键会把菜单再弹出来挡住判定）
    const scaleNow = () => page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('div')).find((x) => /scale\(/.test(x.style.transform || ''));
      if (!d) return null;
      const m = /scale\(([\d.]+)\)/.exec(d.style.transform);
      return m ? Number(m[1]) : d.style.transform;
    });
    const zBefore = await scaleNow();
    try { await page.locator('[data-context-menu] button').filter({ hasText: /^放大/ }).first().click({ timeout: 4000 }); } catch { }
    await sleep(800);
    const zAfter = await scaleNow();
    (typeof zBefore === 'number' && typeof zAfter === 'number' && zAfter > zBefore ? ok : bad)(
      '[H] 编译模式菜单里的「放大」真的改到画面（不是死菜单项）', JSON.stringify({ zBefore, zAfter }));
    await page.keyboard.press('Escape'); await sleep(400);

    // ---- 沙盒模式画布菜单（先建一个文件，空状态没有画布）----
    await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      const f = Object.values(files).find((x) => /\.djs$/.test(x.name)) || null; void f;
    });
    await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(1500);
    // R102：沙盒「新建文件」＝弹窗命名（与编译模式一致），直接点会留下遮罩 ⇒ 走共用夹具
    try { await require('./_ui.cjs').newSandboxFile(page); } catch { }
    await sleep(1800);
    const sbox = await page.evaluate(() => {
      const host = document.querySelector('[data-sandbox-paper-host]') || document.querySelector('[data-sandbox-wrapper]');
      if (!host) return null;
      const r = host.getBoundingClientRect();
      return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.55 };
    });
    if (!sbox) { bad('[A] 找不到沙盒画布'); }
    else {
      await rightClickAt(page, sbox.x, sbox.y);
      const sbMenu = await menuItems(page);
      console.log('  沙盒模式:', JSON.stringify(sbMenu));
      await page.keyboard.press('Escape'); await sleep(300);

      const need = ['适应窗口', '重置缩放'];
      const have = (arr) => need.filter((w) => (arr || []).some((t) => t.includes(w)));
      const cOk = have(compileMenu).length === need.length, sOk = have(sbMenu).length === need.length;
      (cOk && sOk) ? ok('[A] 缩放类措辞两边一致（适应窗口 / 重置缩放）') : bad('[A] 措辞不一致', JSON.stringify({ cOk, sOk, c: have(compileMenu), s: have(sbMenu) }));
      const stale = ['缩放至适应', '重置视图'];
      const hits = [...(compileMenu || []), ...(sbMenu || [])].filter((t) => stale.some((w) => t.includes(w)));
      hits.length === 0 ? ok('[B] 旧措辞已无残留') : bad('[B] 仍有旧措辞', JSON.stringify(hits));
      const exp = ['导出 PNG', '导出 SVG', '导出 Verilog'].filter((w) => (sbMenu || []).some((t) => t.includes(w)));
      exp.length === 3 ? ok('[C] 沙盒画布菜单补上了三项导出（与编译模式同一组词）') : bad('[C] 沙盒菜单缺导出', JSON.stringify({ exp, sbMenu }));
      const keep = ['放置部件', '插入示例', '粘贴', '全选', '撤销', '重做', '清除选择'].filter((w) => (sbMenu || []).some((t) => t.includes(w)));
      keep.length === 7 ? ok('[D] 沙盒菜单原有项未丢', JSON.stringify(keep)) : bad('[D] 沙盒菜单原有项丢失', JSON.stringify(keep));
      // ---- [G] 视图那一组：两边都要有四颗，且**相对顺序一致** ----
      // 只判"两边都有 适应窗口/重置缩放"（上面 [A] 那一臂）会漏掉这一族真正的病：
      // 编译模式此前只有那两颗、没有放大/缩小，顺序还与沙盒相反 ⇒ 换个模式就找不到缩放入口。
      const VIEW = ['放大', '缩小', '适应窗口', '重置缩放'];
      const seqOf = (arr) => VIEW.map((w) => (arr || []).findIndex((t) => (t || '').trim().startsWith(w)));
      const ordered = (ix) => ix.every((v, i) => i === 0 || v > ix[i - 1]);
      const cs = seqOf(compileMenu), ss = seqOf(sbMenu);
      (cs.every((i) => i >= 0) && ss.every((i) => i >= 0) && ordered(cs) && ordered(ss) ? ok : bad)(
        '[G] 视图那一组两边齐且同序（放大→缩小→适应窗口→重置缩放，从 DOM 现读）',
        JSON.stringify({ 编译: cs, 沙盒: ss }));
      const cExp = ['导出 SVG', '导出 PNG'].filter((w) => (compileMenu || []).some((t) => t.includes(w)));
      cExp.length === 2 ? ok('[E] 编译模式导出项未受影响', JSON.stringify(cExp)) : bad('[E] 编译模式导出项异常', JSON.stringify(compileMenu));
    }
    perr.length ? bad('[F] 存在页面异常', perr[0]) : ok('[F] 全程无页面异常');
  } catch (e) { console.log('FATAL', e); fail++; } finally {
    try { b && b.close(); } catch { }
    try { server && server.kill(); } catch { }
    console.log(`\n== R46: ${pass} PASS / ${fail} FAIL ==`);
    process.exit(fail > 0 ? 1 : 0);
  }
})();
