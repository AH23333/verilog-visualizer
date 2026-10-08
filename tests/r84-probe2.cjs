// R84 探针 2（**不做判定**）：只问一个问题 ——
// 「**绑定失效**的那一行（部件文件已被删）还能不能通过弹窗换绑救回来？」
// 上一版 r84 的 [4] 就是这个形状：先删部件（为了验「绑定失效」），再在弹窗里换绑到 B ⇒ 画布没变、
// 也没有提示条。而 r84-probe 里两行都活着时换绑是好的（chg=1、celltype 变、toast「已换绑到…」）。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1586; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };
const ST = Date.now() % 100000;
const PA = 'PqA' + ST;
const PB = 'PqB' + ST;

async function fileMenu(page, sel, label) {
  await page.locator(sel).first().click({ button: 'right' }); await sleep(500);
  return await page.evaluate((t) => {
    const b = Array.from(document.querySelectorAll('[data-context-menu] button')).find((x) => String(x.textContent || '').trim() === t);
    if (!b || b.disabled) return false; b.click(); return true;
  }, label);
}

(async () => {
  let server, browser;
  const perr = [];
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') perr.push('C:' + m.text().slice(0, 160)); });
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await UI.enterSandbox(page);
    const partFromCanvas = async (name) => {
      await page.locator('button[title^="将当前电路保存为自定义门"]').first().click(); await sleep(400);
      await page.locator('input[placeholder="自定义门名称"]').fill(name); await sleep(200);
      await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(1200);
    };
    const placePart = async (name) => {
      const hit = await page.evaluate((n) => {
        const b = Array.from(document.querySelectorAll('button'))
          .find((x) => String(x.title || '').startsWith('放置部件') && String(x.textContent || '').trim() === n);
        if (!b) return false; b.click(); return true;
      }, name);
      await sleep(1000);
      console.log('  [放件]', name, hit);
    };
    await UI.clickGate(page, 'Input'); await UI.clickGate(page, 'Output'); await sleep(400);
    await partFromCanvas(PA);
    await UI.newSandboxFile(page);
    await UI.clickGate(page, 'Input'); await UI.clickGate(page, 'Output'); await sleep(400);
    await partFromCanvas(PB);
    await UI.newSandboxFile(page);
    await placePart(PA);
    await page.locator('button[data-activity="files"]').first().click(); await sleep(700);

    await page.evaluate(() => {
      window.__chg = 0; window.__chgInfo = [];
      document.addEventListener('change', (e) => {
        if (e.target && e.target.tagName === 'SELECT') { window.__chg++; window.__chgInfo.push({ v: e.target.value, a: e.target.getAttribute('data-binding-select') }); }
      }, true);
    });
    const read = () => page.evaluate(() => {
      const dlg = document.querySelector('[data-binding-dialog]');
      const tr = dlg ? dlg.querySelector('tbody tr') : null;
      const s = dlg ? dlg.querySelector('select') : null;
      return {
        dlgOpen: !!dlg,
        head: dlg ? (dlg.textContent || '').slice(0, 100) : null,
        cells: tr ? Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim()) : null,
        selId: s ? s.getAttribute('data-binding-select') : null,
        selVal: s ? s.value : null,
        opts: s ? Array.from(s.options).map((o) => o.value) : null,
        chg: window.__chg, chgInfo: window.__chgInfo,
        canvas: window.__sandboxPaper ? window.__sandboxPaper.model.getCells().filter((c) => !c.isLink()).map((c) => ({
          id: String(c.id), type: String(c.get('type')), celltype: String(c.get('celltype') || ''), ports: (c.getPorts?.() || []).length,
        })) : null,
        toast: (document.querySelector('[data-sandbox-toast]') || {}).textContent ?? null,
      };
    });
    await page.locator('button[data-sandbox-bindings]').first().click(); await sleep(900);
    console.log('  [A 换绑前]', J(await read()));
    const idA = (await read()).selId;
    try { await page.selectOption(`select[data-binding-select="${idA}"]`, PB); } catch (e) { console.log('  !! selectOption', String(e).slice(0, 120)); }
    await sleep(1800);
    console.log('  [B 活实例换绑后]', J(await read()));
    await page.keyboard.press('Escape'); await sleep(500);

    // 现在：实例绑 PB。再放一颗 PA 实例，删掉 PA 文件 ⇒ 那一行「绑定失效」，试着把它换绑回 PB
    // ⚠ 上一版探针这里 `[放件] false`：左侧面板停在「文件」上，「放置部件」那一列根本没渲染
    //   ⇒ 第二颗实例压根没放出来，后面的「失效行」自然找不到。先把面板切对并打印是哪一栏。
    async function whichPanel(name) {
      for (const key of ['sandbox', 'modules', 'files']) {
        await page.locator(`button[data-activity="${key}"]`).first().click().catch(() => { });
        await sleep(700);
        const has = await page.evaluate((n) => !!Array.from(document.querySelectorAll('button'))
          .find((x) => String(x.title || '').startsWith('放置部件') && String(x.textContent || '').trim() === n), name);
        if (has) return key;
      }
      return null;
    }
    const pn = await whichPanel(PA);
    console.log('  [放置部件住在哪一栏]', J(pn));
    await placePart(PA);
    console.log('  [放完画布]', J(await page.evaluate(() => (window.__sandboxPaper || { model: { getCells: () => [] } }).model.getCells()
      .filter((c) => !c.isLink()).map((c) => ({ t: String(c.get('type')), ct: String(c.get('celltype') || '') })))));
    await page.locator('button[data-activity="files"]').first().click(); await sleep(700);
    const del = await fileMenu(page, `[data-sbfile$="${PA}.djs"]`, '删除');
    await sleep(1200);
    console.log('  [删部件]', del, J((await page.evaluate(() => import('/src/store/sandboxStore.ts').then((m) => m.sandboxStore.list().map((f) => f.name)))).length));
    await page.locator('button[data-sandbox-bindings]').first().click(); await sleep(900);
    const before = await read();
    console.log('  [C 删后弹窗]', J(before));
    // 逐行选：找「绑定失效」那一行自己的 select
    const broken = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('[data-binding-dialog] tbody tr'));
      const tr = trs.find((x) => /绑定失效/.test(x.textContent || ''));
      if (!tr) return null;
      const s = tr.querySelector('select');
      return s ? { id: s.getAttribute('data-binding-select'), val: s.value, opts: Array.from(s.options).map((o) => o.value) } : null;
    });
    console.log('  [D 失效行]', J(broken));
    if (broken) {
      try { await page.selectOption(`select[data-binding-select="${broken.id}"]`, PB); } catch (e) { console.log('  !! selectOption 失效行', String(e).slice(0, 120)); }
      await sleep(1800);
    }
    console.log('  [E 失效行换绑后]', J(await read()));
  } catch (e) {
    console.log('FATAL', String(e && e.stack || e).slice(0, 400));
  } finally {
    console.log('  PAGEERR:', J(perr.slice(0, 6)));
    try { await browser?.close(); } catch { }
    try { server?.kill('SIGKILL'); } catch { }
    UI.freePort(PORT);
    console.log('DONE');
  }
})();
