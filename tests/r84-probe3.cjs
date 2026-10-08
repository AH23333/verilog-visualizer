// R84 探针 3（**不做判定**）：只问一句 —— 弹窗里那一行「绑定失效」的实例，换绑救得回来吗？
// （r84 的 [4] 就是这个形状：先删部件验「绑定失效」，再在弹窗里把它换到 B ⇒ 画布没变、没有提示条。
//   而 r84-probe 里两行都活着时换绑是好的：chg=1、celltype 变、toast「已换绑到…」。）
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1587; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };
const ST = Date.now() % 100000;
const PA = 'PrA' + ST;
const PB = 'PrB' + ST;

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
      return hit;
    };
    const dump = (tag) => page.evaluate((t) => {
      const rows = Array.from(document.querySelectorAll('[data-sbfile]')).map((e) => e.getAttribute('data-sbfile'));
      return {
        tag: t, rows,
        folders: Array.from(document.querySelectorAll('[data-sbfolder]')).map((e) => e.getAttribute('data-sbfolder')),
        files: (() => { try { return null; } catch { return null; } })(),
      };
    }, tag);

    await UI.clickGate(page, 'Input'); await UI.clickGate(page, 'Output'); await sleep(400);
    await partFromCanvas(PA);
    await UI.newSandboxFile(page);
    await UI.clickGate(page, 'Input'); await UI.clickGate(page, 'Output'); await sleep(400);
    await partFromCanvas(PB);
    await UI.newSandboxFile(page);
    console.log('  [放件 PA]', await placePart(PA));
    await page.locator('button[data-activity="files"]').first().click(); await sleep(800);
    console.log('  [树 A]', J(await dump('删之前')));
    await page.evaluate(() => {
      window.__chg = 0; window.__chgInfo = [];
      document.addEventListener('change', (e) => {
        if (e.target && e.target.tagName === 'SELECT') { window.__chg++; window.__chgInfo.push({ v: e.target.value, a: e.target.getAttribute('data-binding-select') }); }
      }, true);
    });
    const read = () => page.evaluate(() => {
      const dlg = document.querySelector('[data-binding-dialog]');
      return {
        dlgOpen: !!dlg,
        head: dlg ? (dlg.textContent || '').slice(0, 100) : null,
        rows: dlg ? Array.from(dlg.querySelectorAll('tbody tr')).map((tr) => ({
          td: Array.from(tr.querySelectorAll('td')).map((x) => (x.textContent || '').trim()),
          selId: (tr.querySelector('select') || {}).getAttribute ? tr.querySelector('select').getAttribute('data-binding-select') : null,
          selVal: (tr.querySelector('select') || {}).value ?? null,
          opts: tr.querySelector('select') ? Array.from(tr.querySelector('select').options).map((o) => o.value) : null,
        })) : null,
        canvas: window.__sandboxPaper ? window.__sandboxPaper.model.getCells().filter((c) => !c.isLink()).map((c) => ({
          id: String(c.id), type: String(c.get('type')), celltype: String(c.get('celltype') || ''), ports: (c.getPorts?.() || []).length,
        })) : null,
        toast: (document.querySelector('[data-sandbox-toast]') || {}).textContent ?? null,
        chg: window.__chg, chgInfo: window.__chgInfo,
      };
    });
    // 只看「绑定失效」那一行：活实例的换绑在 probe/probe2 里已确认是好的（对照组）
    await page.locator('button[data-sandbox-bindings]').first().click(); await sleep(900);
    const r0 = await read();
    console.log('  [删前弹窗]', J(r0.rows), J(r0.canvas));
    await page.keyboard.press('Escape'); await sleep(500);
    // 删掉 PA.djs ⇒ 那一行「绑定失效」
    const del = await (async () => {
      const el = page.locator(`[data-sbfile$="${PA}.djs"]`).first();
      if (!(await el.count())) return 'no-row';
      await el.click({ button: 'right' }); await sleep(500);
      return await page.evaluate((t) => {
        const b = Array.from(document.querySelectorAll('[data-context-menu] button')).find((x) => String(x.textContent || '').trim() === t);
        if (!b || b.disabled) return 'no-item'; b.click(); return true;
      }, '删除');
    })();
    await sleep(1400);
    console.log('  [删部件]', J(del), J(await dump('删之后')));
    await page.locator('button[data-sandbox-bindings]').first().click(); await sleep(900);
    const rb = await read();
    console.log('  [失效行弹窗]', J(rb.rows), ' 画布=', J(rb.canvas), ' toast=', J(rb.toast));
    const brokenRow = (rb.rows || []).find((x) => /绑定失效/.test((x.td || []).join('|')));
    if (brokenRow && brokenRow.selId && (brokenRow.opts || []).includes(PB)) {
      await page.selectOption(`select[data-binding-select="${brokenRow.selId}"]`, PB).catch((e) => console.log('  !! 失效行 selectOption', String(e).slice(0, 120)));
      await sleep(2000);
      const ra = await read();
      console.log('  [失效行换绑后]', J({ rows: ra.rows, canvas: ra.canvas, toast: ra.toast, chg: ra.chg, chgInfo: ra.chgInfo }));
    } else {
      console.log('  [失效行换绑后] 没做到（失效行=', J(brokenRow), '）');
    }
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
