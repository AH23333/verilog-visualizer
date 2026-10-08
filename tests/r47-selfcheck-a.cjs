// R47 深检 A：我这两处改动可能带进来的回归
//  1) 自动线名（assignAutoNetNames）对波形通道表的影响：数量/重名/真名是否被挤掉
//  2) 部件布局改用 elk + 等稳定后，「复制到沙盒」的耗时（逐模块计时）
//  3) 自动名会不会与真名撞车（同名 net 在 digitaljs 的 wires 索引里互相覆盖）
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1567; const URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
const freePort = (p) => { try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' }); } catch { } };

(async () => {
  let server, b;
  try {
    freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const dl = Date.now() + 45000; let up = false;
    while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) { up = true; break; } } catch { } await sleep(500); }
    if (!up) { console.log('FATAL 服务未起来'); process.exit(1); }
    b = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    // ---- 1/3 通道表：带自动名之后 ----
    const chan = await page.evaluate(async (a) => {
      const { compileVerilog } = await import('/src/lib/verilog.ts');
      const r = await compileVerilog(a.files, 'multiplier');
      const names = [];
      const walk = (m, tag) => {
        for (const c of m.connectors || []) names.push({ tag, name: c.name });
        for (const [k, s] of Object.entries(m.subcircuits || {})) if (s && s.devices) walk(s, k);
      };
      walk(r.circuitJson, 'TOP');
      const byTag = {};
      for (const n of names) { (byTag[n.tag] = byTag[n.tag] || []).push(n.name); }
      const dupReport = {};
      for (const [t, list] of Object.entries(byTag)) {
        const seen = new Map();
        for (const x of list) seen.set(x, (seen.get(x) || 0) + 1);
        dupReport[t] = { total: list.length, auto: list.filter((x) => /^N\d+$/.test(x)).length, named: list.filter((x) => !/^N\d+$/.test(x)).length, dups: [...seen.entries()].filter(([, c]) => c > 1).slice(0, 4) };
      }
      return dupReport;
    }, { files: ['multiplier.v', 'adder.v', 'full_adder.v'].map((f) => ({ name: f, content: rd(f) })) });
    console.log('=== 1) 连线名分布（含自动名）===');
    for (const [t, v] of Object.entries(chan)) console.log(`   ${t}: 线=${v.total} 自动名=${v.auto} 真名=${v.named} 重名=${JSON.stringify(v.dups)}`);

    // 波形面板实际打开一次，看通道列表与是否报错
    await page.evaluate(async (a) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      for (const f of a.files) { const nf = fileStore.createFile(f.name); fileStore.saveContent(nf.id, f.content); }
    }, { files: ['multiplier.v', 'adder.v', 'full_adder.v'].map((f) => ({ name: f, content: rd(f) })) });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2300);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.locator('[title="multiplier.v"]').first().click({ force: true }); await sleep(800);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    for (let i = 0; i < 80; i++) { await sleep(700); const done = await page.evaluate(async () => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getAll()[0]; return !!(f && f.status === 'compiled' && f.circuitJson); }); if (done) break; }
    await sleep(2500);
    await page.locator('button[data-tool="examples"], button:has-text("示例")').first().click().catch(() => { });
    await page.keyboard.press('Escape'); await sleep(300);
    await page.locator('button[title*="波形"], button:has-text("Wave")').first().click().catch(async () => {
      await page.locator('button:has-text("波形")').first().click();
    });
    await sleep(1500);
    const wave = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const sel = Array.from(document.querySelectorAll('select')).map((s) => Array.from(s.options).map((o) => o.textContent).slice(0, 8));
      return { open: /波形/.test(txt), selects: sel.slice(0, 3), hasN: (txt.match(/\bN\d+\b/g) || []).slice(0, 6) };
    });
    console.log('=== 2) 编译模式波形面板:', JSON.stringify(wave));
    await page.screenshot({ path: path.join(ROOT, '.tmpbuild', 'r47-wave.png') });

    // ---- 4) 复制到沙盒逐模块耗时（elk + 等稳定）----
    const timing = await page.evaluate(async (a) => {
      const { compileVerilog } = await import('/src/lib/verilog.ts');
      const gs = await import('/src/lib/gateSystem.ts');
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      const out = {};
      for (const [key, list, top] of a.sets) {
        const t0 = performance.now();
        let cj;
        try { cj = (await compileVerilog(list, top)).circuitJson; } catch (e) { out[key] = { compile: 'FAIL ' + String(e.message).slice(0, 60) }; continue; }
        const tCompile = performance.now() - t0;
        const t1 = performance.now();
        let n = 0;
        try { n = await gs.collectToFolder(cj, 'T' + key); } catch (e) { out[key] = { compile: +tCompile.toFixed(0), collect: 'THROW ' + String(e.message).slice(0, 80) }; continue; }
        const tCollect = performance.now() - t1;
        out[key] = { compileMs: +tCompile.toFixed(0), collectMs: +tCollect.toFixed(0), parts: n, perPartMs: +(tCollect / Math.max(1, n)).toFixed(0), modules: Object.keys(cj.subcircuits || {}).length };
      }
      sandboxStore.list().forEach(() => { });
      return out;
    }, {
      sets: [
        ['mult', ['multiplier.v', 'adder.v', 'full_adder.v'].map((f) => ({ name: f, content: rd(f) })), 'multiplier'],
        ['alu', ['alu_core.v', 'adder.v', 'full_adder.v', 'multiplier.v'].map((f) => ({ name: f, content: rd(f) })), 'alu_core'],
        ['adder', ['adder.v', 'full_adder.v'].map((f) => ({ name: f, content: rd(f) })), 'adder'],
      ],
    });
    console.log('=== 3) 复制到沙盒耗时 ===');
    for (const [k, v] of Object.entries(timing)) console.log('   ', k, JSON.stringify(v));
  } catch (e) { console.log('FATAL', e); } finally {
    try { b && b.close(); } catch { }
    try { server && server.kill(); } catch { }
    process.exit(0);
  }
})();
