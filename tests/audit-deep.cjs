// 深挖 BusGroup 传播休眠：
//  exp1: 手动调 bus.operation(inputSignals) —— 区分「operation 逻辑坏」vs「传播链断」
//  exp2: dump engine 对 bus 的监听与队列状态
//  exp3: 最小 loadCells 复现（Input×4→BusGroup→BusUngroup→Lamp 全走 loadCells，无手动拖线）
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1471;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);

    // 问题场景：插入数字钟示例（含 BusGroup/Memory/Display7）
    await page.mouse.click(1150, 760, { button: 'right' }); await sleep(500);
    await page.locator('button:has-text("插入示例")').first().click(); await sleep(400);
    await page.locator('button:has-text("数字钟")').first().click(); await sleep(1500);

    const r = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const bus = p.model.getCells().find(c => c.get('type') === 'BusGroup');
      const out = {};
      out.busIns = (() => { const s = bus?.get('inputSignals') || {}; return Object.entries(s).map(([k, v]) => k + '=' + String(v).replace('Vector3vl ', '')).join(','); })();
      out.busOut = String(bus?.get('outputSignals')?.out ?? 'n/a').replace('Vector3vl ', '');
      out.groupsKind = bus?.get('groups') instanceof Map ? 'Map(' + bus.get('groups').size + ')' : typeof bus?.get('groups');
      out.memAddr = (() => {
        const mem = p.model.getCells().find(c => c.get('type') === 'Memory');
        const v = mem?.get('inputSignals')?.rd0addr;
        return v ? v.toString().replace('Vector3vl ', '') : 'n/a';
      })();
      // exp1: 手动调 operation
      try {
        const res = bus.operation(bus.get('inputSignals'));
        out.manualOpKeys = Object.keys(res || {});
        out.manualOpOut = res?.out ? String(res.out).replace('Vector3vl ', '') : String(res);
      } catch (e) { out.manualOpErr = String(e).slice(0, 150); }
      out.propagation = String(bus.get('propagation'));
      out.outputSignalsNow = (() => { const s = bus.get('outputSignals') || {}; return Object.entries(s).map(([k, v]) => k + '=' + String(v).replace('Vector3vl ', '')).join(','); })();
      // 决定性实验：手动驱动 engine 消费队列
      const engx = window.__sandboxCircuit._engine;
      out.pqPeek = engx._pq.peek ? String(engx._pq.peek()) : 'n/a';
      try { engx.updateGatesNext(); } catch (e) { out.updErr1 = String(e).slice(0, 80); }
      out.afterUpd1 = String(bus.get('outputSignals')?.out ?? 'n/a').replace('Vector3vl ', '');
      try { engx.updateGatesNext(); } catch (e) { out.updErr2 = String(e).slice(0, 80); }
      out.afterUpd2 = String(bus.get('outputSignals')?.out ?? 'n/a').replace('Vector3vl ', '');
      try { engx.updateGatesNext(); } catch (e) { out.updErr3 = String(e).slice(0, 80); }
      out.afterUpd3 = String(bus.get('outputSignals')?.out ?? 'n/a').replace('Vector3vl ', '');
      // 再强制 enqueue bus 并手动消费
      bus.trigger('change:inputSignals', bus, bus.get('inputSignals'));
      try { engx.updateGatesNext(); } catch (e) { out.updErr4 = String(e).slice(0, 80); }
      out.afterEnq = String(bus.get('outputSignals')?.out ?? 'n/a').replace('Vector3vl ', '');
      // exp2: engine 状态
      const c = window.__sandboxCircuit;
      const eng = c?._engine;
      out.engineTick = eng ? eng._tick : null;
      out.engineIdle = eng ? eng._idle : null;
      out.busInEngine = (() => {
        try {
          // engine._cells 是类型表；找 gate：graph（circuit._graph）上每个 element 即 gate（gate==cell 前提）
          const el = eng._graph.getCell(bus.id);
          return el ? { found: true, sameAsCell: el === bus, hasMemdataLike: typeof el.memdata } : { found: false };
        } catch (e) { return { err: String(e).slice(0, 80) }; }
      })();
      return out;
    });
    console.log('exp1/2:', JSON.stringify(r, null, 1));

    // exp3：拨 mA（Input 点击）看灯
    const mA = await page.evaluate(() => window.__sandboxPaper.model.getCells().find(c => c.get('id') === 'mA')?.id || 'mA');
    const pt = await page.evaluate((id) => {
      const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
      const r = v.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, 'mA');
    await page.mouse.click(pt.x, pt.y); await sleep(900);
    const lamp = await page.evaluate(() => {
      const l = window.__sandboxPaper.model.getCells().find(c => c.get('type') === 'Lamp');
      const v = l?.get('inputSignals')?.in;
      return v ? v.toString().replace('Vector3vl ', '') : 'n/a';
    });
    console.log('exp3: 拨 mA 后 Lamp =', lamp, '（若为 1 → loadCells 场景 BusGroup 正常；若 x → 通病复现）');
  } catch (e) { console.log('FATAL', e); }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(0); }
})();
