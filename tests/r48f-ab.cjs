// R48f 只读探针：在**真实编译产物**上做 A/B —— 只删一个字段，别的不碰。
// 判定「复制/展开时被丢掉的器件字段」到底带来什么后果（掉器件？掉线？ ctor 抛错？值变了？）。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1585; const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
const freePort = (p) => {
  try {
    require('child_process').execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' });
  } catch { }
};

(async () => {
  let server, browser;
  try {
    freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const dl = Date.now() + 40000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务未起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    const out = await page.evaluate(async (a) => {
      const djs = window.digitaljs;
      const { compileVerilog } = await import('/src/lib/verilog.ts');
      const sv = await import('/src/lib/subcircuitView.ts');
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9000px;top:0;width:1200px;height:900px';
      document.body.appendChild(host);

      const stat = (json, tag, watchIds) => {
        let h = null, err = '';
        try { h = sv.renderCircuitView(djs, host, json, { autoLayout: false }); }
        catch (e) { err = String((e && e.message) || e).slice(0, 70); }
        const r = { tag, err, devs: 0, links: 0, skippedWires: h && h.skippedWires, skippedDevices: h && h.skippedDevices, note: [] };
        if (h) {
          const cells = h.paper.model.getCells();
          r.devs = cells.filter((c) => !c.isLink()).length;
          r.links = cells.filter((c) => c.isLink()).length;
          // 只看「原始编译 JSON 里确实带这个字段」的那些器件 —— 否则采到的是没复位的 Dff，读数没意义
          for (const id of (watchIds || [])) {
            const c = h.paper.model.getCell(id);
            if (!c || c.isLink()) { r.note.push(`${id}=不在图里`); continue; }
            r.note.push(`${id}(${c.get('type')}) arst=${JSON.stringify(c.get('arst_value'))} srst=${JSON.stringify(c.get('srst_value'))} extend=${JSON.stringify(c.get('extend'))} angle=${JSON.stringify(c.get('angle'))}`);
          }
          try { h.paper.model.clear(); } catch { }
        }
        r.note = r.note.slice(0, 6);
        return r;
      };

      const mutate = (json, fn) => { const j = structuredClone(json); fn(j); return j; };
      const delField = (name) => (j) => {
        const walk = (m) => { for (const d of Object.values(m.devices || {})) delete d[name]; for (const s of Object.values(m.subcircuits || {})) walk(s); };
        walk(j);
      };

      const res = [];
      for (const grp of a.groups) {
        let json;
        try { json = (await compileVerilog(grp.srcs, grp.top)).circuitJson; }
        catch (e) { res.push({ top: grp.top, compileErr: String(e.message).slice(0, 90) }); continue; }
        for (const field of grp.fields) {
          // 找出「原始 JSON 里带这个字段」的器件 id（含子模块）。
          // 排序优先「值非零/非默认」的载体 —— 复位值本来就是 0 的器件看不出差别。
          const ids = [];
          const interesting = (v) => {
            if (v && typeof v === 'object') return true;
            const s = String(v);
            return /1|true|[1-9]/.test(s);
          };
          const find = (m) => {
            for (const [k, d] of Object.entries(m.devices || {})) {
              if (!d || d[field] === undefined) continue;
              ids.push({ id: String(d.id || k), v: d[field], hot: interesting(d[field]) ? 0 : 1 });
            }
            for (const s of Object.values(m.subcircuits || {})) find(s);
          };
          find(json);
          ids.sort((x, y) => x.hot - y.hot);
          const picked = ids.slice(0, 4).map((x) => x.id);
          res.push({
            top: grp.top, field, nCarriers: ids.length,
            rawValues: ids.slice(0, 4).map((x) => `${x.id}=${JSON.stringify(x.v)}`),
            keep: stat(json, '原样', picked),
            drop: stat(mutate(json, delField(field)), `删 ${field}`, picked),
          });
        }
      }
      host.remove();
      return res;
    }, {
      groups: [
        { top: 'multiplier', srcs: ['multiplier.v', 'adder.v', 'full_adder.v'].map((f) => ({ name: f, content: rd(f) })), fields: ['extend', 'angle'] },
        { top: 'r48_exotic', srcs: ['r48_exotic.v'].map((f) => ({ name: f, content: rd(f) })), fields: ['arst_value', 'srst_value', 'angle'] },
        { top: 'r48_sync', srcs: ['r48_sync.v'].map((f) => ({ name: f, content: rd(f) })), fields: ['arst_value', 'srst_value', 'enable_srst', 'no_data'] },
      ],
    });

    for (const r of out) {
      if (r.compileErr) { console.log(`编译失败 ${r.top}: ${r.compileErr}`); continue; }
      console.log(`\n### ${r.top} — 字段 ${r.field}（带该字段的器件数=${r.nCarriers}）`);
      console.log('  编译原值:', (r.rawValues || []).join('  ') || '(无)');
      for (const side of ['keep', 'drop']) {
        const s = r[side];
        console.log(`  ${String(s.tag).padEnd(12)} 器件=${s.devs} 线=${s.links} 丢线=${s.skippedWires} 丢器件=${s.skippedDevices} ${s.err ? 'ERR=' + s.err : ''}`);
        console.log(`               ${s.note.join(' | ')}`);
      }
    }
    console.log('\npageErrors=', perr.length, perr.slice(0, 4));
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 400));
  } finally {
    try { server && server.kill(); } catch { }
    try { browser && await browser.close(); } catch { }
    process.exit(0);
  }
})();
