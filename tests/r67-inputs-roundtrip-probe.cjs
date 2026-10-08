// r67 只读探针：扇入数 `inputs` 与 `mode` 在存盘时被剥掉（r66 的读数）——**到底会不会真的丢用户改的东西**？
// 分开两件事：① 序列化留不留（白名单说了算）；② 引擎/界面是不是根本不需要它（重建时按别的键推出来）。
// 这里走真路径改值（右键菜单里的"输入端数"），存盘 → 重开 → 看那颗门还剩几个输入端。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1663; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

const cellInfo = (page, nth) => page.evaluate((n) => {
  const p = window.__sandboxPaper;
  const els = p.model.getElements().filter((e) => String(e.get('type')) === n.type);
  const c = els[els.length - 1];
  if (!c) return null;
  const ports = ((c.get('ports') || {}).items || []).filter((x) => (x.group === 'in')).length;
  return { id: c.id, inputs: c.get('inputs'), bits: c.get('bits'), inPorts: ports, portIds: ((c.get('ports') || {}).items || []).map((x) => x.id) };
}, nth);

const menuSet = async (page, label, value) => {
  const at = await page.evaluate(() => {
    const p = window.__sandboxPaper;
    const c = p.model.getElements()[p.model.getElements().length - 1];
    const r = p.findViewByModel(c).el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(at.x, at.y, { button: 'right' }); await sleep(500);
  const item = page.locator('[data-context-menu] button', { hasText: label });
  if (!(await item.count())) { await page.keyboard.press('Escape'); return false; }
  await item.first().click(); await sleep(400);
  const inp = page.locator('input[placeholder="' + value + '"]').first();
  if (await inp.count()) { await inp.fill(String(value.v === undefined ? value : value.v)); }
  else {
    const anyInp = page.locator('[data-context-menu] input').first();
    if (!(await anyInp.count())) { await page.keyboard.press('Escape'); return false; }
    await anyInp.fill(String(value.n));
  }
  await page.keyboard.press('Enter'); await sleep(600);
  await page.keyboard.press('Escape'); await sleep(300);
  return true;
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
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 140)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1200);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    await UI.enterSandbox(page);
    await UI.clickGate(page, 'And');
    await sleep(500);
    console.log('刚放下的 And =', J(await cellInfo(page, { type: 'And' })));

    // 这颗门右键都有哪些可改项？（先拿读数，不猜菜单标签）
    const at = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getElements()[p.model.getElements().length - 1];
      const r = p.findViewByModel(c).el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    await page.mouse.click(at.x, at.y, { button: 'right' }); await sleep(500);
    const menu = await page.evaluate(() => Array.from(document.querySelectorAll('[data-context-menu] button')).map((b) => String(b.textContent || '').trim()));
    console.log('And 的右键菜单 =', J(menu));
    await page.keyboard.press('Escape'); await sleep(250);

    // 走真路径改扇入：找"输入端/扇入/端口数"这一类标签
    const label = menu.find((m) => /输入端|扇入|几个输入|端口数/.test(m));
    if (!label) { console.log('⇒ 菜单里没有改扇入数的入口（这一格不作数；只能用模型层验证序列化）'); }
    else {
      const okClick = await page.evaluate((t) => {
        const b = Array.from(document.querySelectorAll('button')).find((x) => String(x.textContent || '').trim() === t);
        if (!b) return false; b.click(); return true;
      }, label);
      await page.mouse.click(at.x, at.y, { button: 'right' }); await sleep(450);
      await page.evaluate((t) => {
        const b = Array.from(document.querySelectorAll('[data-context-menu] button')).find((x) => String(x.textContent || '').trim() === t);
        if (b) b.click();
      }, label);
      await sleep(500);
      const inpInfo = await page.evaluate(() => {
        const i = document.querySelector('[data-context-menu] input');
        return i ? { ph: i.placeholder, val: i.value } : null;
      });
      console.log('  弹出输入框 =', J(inpInfo), '（点了菜单项？', okClick, '）');
      if (inpInfo) {
        await page.evaluate(() => {
          const i = document.querySelector('[data-context-menu] input');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(i, '4'); i.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.keyboard.press('Enter'); await sleep(700);
      }
      await page.keyboard.press('Escape'); await sleep(300);
    }
    const edited = await cellInfo(page, { type: 'And' });
    console.log('\n改过之后的 And =', J(edited));

    await page.evaluate(() => window.__sandboxSave && window.__sandboxSave());
    await sleep(1000);
    const stored = await page.evaluate(async () => {
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      for (const f of sandboxStore.list()) {
        let j; try { j = JSON.parse(f.graphJson || 'null'); } catch { continue; }
        const c = ((j && j.cells) || []).find((x) => x.type === 'And');
        if (c) return { file: f.name, keys: Object.keys(c), inputs: c.inputs === undefined ? null : c.inputs, portIds: ((c.ports || {}).items || []).map((x) => x.id) };
      }
      return null;
    });
    console.log('存盘里的 And =', J(stored));

    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2600);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
    if (await UI.backToSandbox(page)) {
      const name = stored && stored.file ? stored.file.replace(/\.djs$/, '') : null;
      if (name) { await page.locator('span').filter({ hasText: name }).first().click(); await sleep(1800); }
      const reopened = await cellInfo(page, { type: 'And' });
      console.log('\n重开之后的 And =', J(reopened));
      const lostIn = edited && reopened && JSON.stringify(edited.inputs) !== JSON.stringify(reopened.inputs);
      const lostPorts = edited && reopened && edited.inPorts !== reopened.inPorts;
      console.log(lostIn || lostPorts
        ? '⚠ 丢了：扇入数/输入端口数在重开后与改后不一致 ⇒ 白名单该收 inputs（以及端口数派生）'
        : '✓ 没丢：重开后与改后一致 ⇒ 序列化剥的是可以重算出来的东西');
    } else console.log('回不到沙盒（这一格不作数）');
    console.log('页面异常=', perr.slice(0, 3));
  } catch (e) { console.log('FATAL ' + String(e.stack || e).slice(0, 400)); }
  finally { if (browser) await browser.close().catch(() => { }); if (server) server.kill(); UI.freePort(PORT); }
})();
