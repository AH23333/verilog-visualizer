// R84 现场取数探针（**不做判定**）：只看三件事的读数
//   ① 弹窗里那颗 <select> 换绑：change 到底有没有到 React、handler 有没有跑、跑完画布变不变；
//   ② 部件清单（gates/parts）与 sandboxStore.list() 的 role/name 形状（上一版 [5] 读出 [] 的原因）；
//   ③ 同名遮蔽夹具：直接经 store 往子文件夹写一份同名部件，看 resolvePartRef 在两个 scope 下给出什么。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1585; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };
const ST = Date.now() % 100000;
const PA = 'RpA' + ST;
const PB = 'RpB' + ST;
const SUB = 'r84psub';

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

    await UI.clickGate(page, 'Input'); await UI.clickGate(page, 'Output'); await sleep(400);
    await partFromCanvas(PA);
    await UI.newSandboxFile(page);
    await UI.clickGate(page, 'Input'); await UI.clickGate(page, 'Output'); await sleep(400);
    await partFromCanvas(PB);
    await UI.newSandboxFile(page);
    await placePart(PA);
    async function placePart(name) {
      const hit = await page.evaluate((n) => {
        const b = Array.from(document.querySelectorAll('button'))
          .find((x) => String(x.title || '').startsWith('放置部件') && String(x.textContent || '').trim() === n);
        if (!b) return false; b.click(); return true;
      }, name);
      await sleep(1000);
      console.log('  [放件]', name, hit);
    }
    const mainName = await page.evaluate(() => import('/src/store/sandboxStore.ts').then((m) => {
      const id = m.sandboxStore.getActiveId();
      const f = m.sandboxStore.get(id);
      return f ? f.name : null;
    }));
    console.log('  [主文件]', J(mainName));

    // ---- ② 库与 store 的形状 ----
    const dump = await page.evaluate(() => import('/src/store/sandboxStore.ts').then((m) => ({
      files: m.sandboxStore.list().map((f) => ({ name: f.name, role: f.role ?? null })),
      keys: Object.keys(m).sort(),
    })));
    console.log('  [store 全部文件]', J(dump.files));
    console.log('  [sandboxStore 模块导出]', J(dump.keys));

    await page.locator('button[data-activity="files"]').first().click(); await sleep(700);

    // ---- ① 换绑 ----
    await page.evaluate(() => {
      window.__chg = 0; window.__chgInfo = [];
      document.addEventListener('change', (e) => {
        const t = e.target;
        if (t && t.tagName === 'SELECT') { window.__chg++; window.__chgInfo.push({ v: t.value, attr: t.getAttribute('data-binding-select') }); }
      }, true);
    });
    await page.locator('button[data-sandbox-bindings]').first().click(); await sleep(1000);
    const head = await page.evaluate(() => {
      const d = document.querySelector('[data-binding-dialog]');
      return d ? (d.textContent || '').slice(0, 120) : null;
    });
    console.log('  [弹窗抬头]', J(head));
    const pre = await page.evaluate(() => {
      const dlg = document.querySelector('[data-binding-dialog]');
      if (!dlg) return { noDlg: true };
      const s = dlg.querySelector('select');
      return {
        selects: dlg.querySelectorAll('select').length,
        val: s ? s.value : null,
        opts: s ? Array.from(s.options).map((o) => ({ v: o.value, t: o.textContent })) : null,
        rows: Array.from(dlg.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())),
      };
    });
    console.log('  [换绑前弹窗]', J(pre));
    console.log('  [换绑前画布]', J(await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return { noPaper: true };
      return p.model.getCells().filter((c) => !c.isLink() && String(c.get('type')) === 'Subcircuit')
        .map((c) => ({ id: String(c.id), celltype: String(c.get('celltype') || ''), ports: (c.getPorts?.() || []).length }));
    })));

    const selId = await page.evaluate(() => {
      const s = document.querySelector('[data-binding-dialog] select');
      return s ? String(s.getAttribute('data-binding-select')) : null;
    });
    let how = 'none';
    try { await page.selectOption(`select[data-binding-select="${selId}"]`, PB); how = 'selectOption'; }
    catch (e) { console.log('  !! selectOption 失败：', String(e).slice(0, 140)); }
    await sleep(1800);
    const post = await page.evaluate(() => {
      const dlg = document.querySelector('[data-binding-dialog]');
      const s = dlg ? dlg.querySelector('select') : null;
      return {
        chg: window.__chg, chgInfo: window.__chgInfo,
        dlgOpen: !!dlg,
        selVal: s ? s.value : null,
        rows: dlg ? Array.from(dlg.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())) : null,
        canvas: window.__sandboxPaper ? window.__sandboxPaper.model.getCells().filter((c) => !c.isLink() && String(c.get('type')) === 'Subcircuit')
          .map((c) => ({ id: String(c.id), celltype: String(c.get('celltype') || ''), ports: (c.getPorts?.() || []).length })) : null,
        toast: (document.querySelector('[data-sandbox-toast]') || {}).textContent ?? null,
      };
    });
    console.log('  [换绑后] 方式=', how, J(post));

    // ---- ③ 同名遮蔽：直接经 store 往子文件夹写一份 PB ----
    const twin = await page.evaluate(async ({ pb, sub }) => {
      const m = await import('/src/store/sandboxStore.ts');
      const g = await import('/src/lib/gateSystem.ts');
      const src = m.sandboxStore.list().find((f) => f.name === pb + '.djs');
      if (!src) return { noSrc: true };
      const created = m.sandboxStore.create(`${sub}/${pb}.djs`, 'part');
      m.sandboxStore.save(created.id, src.graphJson);
      const r0 = g.resolvePartRef(pb, '');
      const r1 = g.resolvePartRef(pb, sub);
      return {
        wrote: created.name,
        files: m.sandboxStore.list().filter((f) => String(f.name).includes(pb)).map((f) => ({ n: f.name, role: f.role ?? null })),
        scopeRoot: r0 ? { name: r0.file.name, role: r0.file.role ?? null } : null,
        scopeSub: r1 ? { name: r1.file.name, role: r1.file.role ?? null } : null,
        defRoot: !!g.resolveDefCells(pb, '')?.cells?.length,
        defSub: !!g.resolveDefCells(pb, sub)?.cells?.length,
      };
    }, { pb: PB, sub: SUB });
    console.log('  [遮蔽现算]', J(twin));

    // 弹窗重开（React 里的 parts 清单要刷新才有两颗同名）
    await page.keyboard.press('Escape'); await sleep(400);
    await page.locator('button[data-sandbox-bindings]').first().click(); await sleep(900);
    const again = await page.evaluate(() => {
      const d = document.querySelector('[data-binding-dialog]');
      const s = d ? d.querySelector('select') : null;
      return {
        head: d ? (d.textContent || '').slice(0, 120) : null,
        opts: s ? Array.from(s.options).map((o) => o.value + '|' + o.textContent) : null,
        rows: d ? Array.from(d.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())) : null,
      };
    });
    console.log('  [遮蔽后弹窗]', J(again));

    // 重载一次：parts 清单是否从 localStorage 重建（[5] 要不要靠 reload 才看得见两颗同名）
    await page.keyboard.press('Escape'); await sleep(400);
    await UI.boot(page, URL, { reload: true });
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(900);
    const restored = await page.evaluate(() => !!window.__sandboxPaper).catch(() => false);
    console.log('  [重载后 paper]', restored);
    if (restored) {
      await page.locator('button[data-sandbox-bindings]').first().click(); await sleep(900);
      const after = await page.evaluate(() => {
        const d = document.querySelector('[data-binding-dialog]');
        const s = d ? d.querySelector('select') : null;
        return {
          head: d ? (d.textContent || '').slice(0, 120) : null,
          opts: s ? Array.from(s.options).map((o) => o.value + '|' + o.textContent) : null,
          rows: d ? Array.from(d.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())) : null,
        };
      });
      console.log('  [重载后弹窗]', J(after));
    }
  } catch (e) {
    console.log('FATAL', String(e && e.stack || e).slice(0, 500));
  } finally {
    console.log('  PAGEERR:', J(perr.slice(0, 6)));
    try { await browser?.close(); } catch { }
    try { server?.kill('SIGKILL'); } catch { }
    UI.freePort(PORT);
    console.log('DONE');
  }
})();
