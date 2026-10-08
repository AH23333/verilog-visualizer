// R45：两种模式的侧栏 / 活动栏 / 画布右键菜单差异清单（给「统一为编译模式样式」定范围）
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1561; const URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
const freePort = (p) => { try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' }); } catch { } };
const dismiss = async (page) => { try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { } };

const dump = (page) => page.evaluate(() => {
  const txt = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22);
  const act = Array.from(document.querySelectorAll('button[data-activity]')).map((b) => ({ key: b.getAttribute('data-activity'), title: b.getAttribute('title'), cls: b.className.slice(0, 60), active: b.getAttribute('aria-current') || (b.className.includes('active') ? 'cls' : '') }));
  const side = document.querySelector('[data-sandbox-sidebar], .sidebar, aside, [class*="sidebar"]');
  const head = side ? Array.from(side.querySelectorAll(':scope > div')).slice(0, 2).map((d) => txt(d)).join(' / ') : null;
  const row = side ? side.querySelector('[data-sbfile], [title$=".v"], [title$=".djs"]') : null;
  const cs = row ? getComputedStyle(row) : null;
  return {
    activities: act,
    sidebarHead: head,
    rowSample: row ? { tag: row.tagName, cls: String(row.className).slice(0, 70), title: row.getAttribute('title'), padLeft: cs.paddingLeft, bl: cs.borderLeftWidth, bg: cs.backgroundColor.slice(0, 24), h: cs.height } : null,
    toolbarBtns: Array.from(document.querySelectorAll('button')).map((b) => txt(b)).filter(Boolean).slice(0, 26),
  };
});

(async () => {
  let s, b;
  try {
    freePort(PORT);
    s = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const dl = Date.now() + 40000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    b = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300); await dismiss(page);
    await page.evaluate(async (a) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const f = fileStore.createFile('adder.v'); fileStore.saveContent(f.id, a.c);
      const f2 = fileStore.createFile('full_adder.v'); fileStore.saveContent(f2.id, a.c2);
    }, { c: rd('adder.v'), c2: rd('full_adder.v') });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300); await dismiss(page);
    await page.locator('[title="adder.v"]').first().click({ force: true }); await sleep(900);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    for (let i = 0; i < 60; i++) { await sleep(700); const done = await page.evaluate(async () => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getAll()[0]; return !!(f && f.status === 'compiled' && f.circuitJson); }); if (done) break; }
    await sleep(2500);
    console.log('=== 编译模式 ===');
    console.log(JSON.stringify(await dump(page), null, 1));
    // 编译模式画布右键
    const cm = await page.evaluate(() => { const p = document.querySelector('.joint-paper').getBoundingClientRect(); return { x: p.left + p.width * 0.6, y: p.top + p.height * 0.6 }; });
    await page.mouse.move(cm.x, cm.y); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await sleep(800);
    const compileMenu = await page.evaluate(() => { const m = document.querySelector('[data-context-menu]'); return m ? Array.from(m.querySelectorAll('button')).map((x) => (x.textContent || '').trim()) : null; });
    console.log('  编译画布右键:', JSON.stringify(compileMenu));
    await page.keyboard.press('Escape'); await sleep(400);

    // 沙盒模式
    await page.locator('button[data-activity="sandbox"]').first().click(); await sleep(2000);
    console.log('=== 沙盒模式 ===');
    console.log(JSON.stringify(await dump(page), null, 1));
    const smr = await page.evaluate(() => { const r = document.querySelector('[data-sandbox-wrapper]').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.6 }; });
    await page.mouse.move(smr.x, smr.y); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await sleep(900);
    const sandboxMenu = await page.evaluate(() => { const m = document.querySelector('[data-context-menu]'); return m ? { title: (m.previousSibling && (m.previousSibling.textContent || '').trim()) || '', items: Array.from(m.querySelectorAll('button')).map((x) => (x.textContent || '').trim()) } : null; });
    console.log('  画布右键:', JSON.stringify(sandboxMenu));
    // 文件树右键
    const fr = await page.evaluate(() => { const f = document.querySelector('[data-sbfile]'); if (!f) return null; const r = f.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; });
    if (fr) { await page.mouse.move(fr.x, fr.y); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); }
    await sleep(800);
    const fileMenu = await page.evaluate(() => { const m = document.querySelector('[data-context-menu]'); return m ? Array.from(m.querySelectorAll('button')).map((x) => (x.textContent || '').trim()) : null; });
    console.log('  文件行右键:', JSON.stringify(fileMenu));
    // 编译模式文件行右键（对照）
    await page.keyboard.press('Escape'); await sleep(300);
    await page.locator('button[data-activity="files"]').first().click(); await sleep(1000);
    const cf = await page.evaluate(() => {
      const f = document.querySelector('[title="adder.v"]'); if (!f) return null;
      const el = f.closest('[class*="file"]') || f.parentElement;
      const r = el.getBoundingClientRect();
      window.__fr = { x: r.left + 10, y: r.top + r.height / 2 };
      return el.className.slice(0, 60);
    });
    if (cf) { await page.mouse.move(await page.evaluate(() => window.__fr.x), await page.evaluate(() => window.__fr.y)); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); }
    await sleep(800);
    const compileFileMenu = await page.evaluate(() => { const m = document.querySelector('[data-context-menu]'); return m ? Array.from(m.querySelectorAll('button')).map((x) => (x.textContent || '').trim()) : null; });
    console.log('  编译模式文件行右键:', JSON.stringify(compileFileMenu), '(row=', cf, ')');
  } catch (e) { console.log('FATAL', e); } finally { try { await b && b.close(); } catch { } try { s && s.kill(); } catch { } process.exit(0); }
})();
