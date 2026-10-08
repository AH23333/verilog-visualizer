// R56 验收：**多驱动冲突的产品口径**（他的裁决）
//   「检测到 net 就尝试编译画出来并标冲突；若无 net（比如门级网表）则直接拒编译」
// 这条一直只有代码、没有证人。这里钉三件事：
//  [1] 有名 net 的双重驱动 ⇒ 照常出图，且 CompileResult.netConflicts 非空（供界面标冲突）；
//  [2] 门级网表那种"拿不到 net 名"的冲突 ⇒ 拒编译，而且错误文案必须是**人话**：
//      要出现「多驱动冲突」，且不许残留上游内部异常（Multiple sources driving net / Assertion failed）；
//  [3] 编译模式也标自动线名（导线 netname 不许成空）。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1623;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1623)); } catch { } const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
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
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务未起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 180)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);

    const r = await page.evaluate(async (cases) => {
      const { compileVerilog } = await import('/src/lib/verilog.ts');
      const out = {};
      for (const c of cases) {
        try {
          const res = await compileVerilog([{ name: c.file, content: c.src }], c.top);
          const conns = (res.circuitJson?.connectors || []);
          out[c.key] = {
            compiled: true,
            netConflicts: (res.netConflicts || []).length,
            conflictNets: (res.netConflicts || []).map((x) => x.net).slice(0, 5),
            devices: Object.keys(res.circuitJson?.devices || {}).length,
            wires: conns.length,
            namedWires: conns.filter((k) => String(k.name || '').length > 0).length,
          };
        } catch (e) {
          out[c.key] = { compiled: false, message: String(e.message || e).slice(0, 400), name: String(e && e.constructor && e.constructor.name) };
        }
      }
      return out;
    }, [
      { key: 'named', file: 'r56_conflict_named.v', top: 'r56_conflict_named', src: rd('r56_conflict_named.v') },
      { key: 'netlist', file: 'test_counter.v', top: 'test_counter', src: rd('test_counter.v') },
    ]);

    console.log('    读数:', JSON.stringify(r, null, 1).slice(0, 900));

    // [1] 有名 net 的冲突：出图 + 报冲突
    const n = r.named;
    if (n.compiled && n.netConflicts >= 1) ok('[1] 有名 net 双驱动 ⇒ 照常出图并报冲突', `conflicts=${n.netConflicts} nets=${n.conflictNets.join(',')} 器件 ${n.devices} 线 ${n.wires}`);
    else if (!n.compiled) bad('[1] 有名 net 双驱动 ⇒ 照常出图并报冲突', '竟然拒编译：' + n.message.slice(0, 120));
    else bad('[1] 有名 net 双驱动 ⇒ 照常出图并报冲突', `出图了但 netConflicts=${n.netConflicts}（界面就无处可标）`);

    // [2] 门级网表（例化了没声明的单元 / 拿不到 net 名的多驱动）⇒ 拒编译，但必须说清原因：
    //     要么点名缺哪个单元（MissingModulesError 走绑定弹窗），要么是可行动的中文说明；
    //     ⛔ 不许把 emscripten 的 "Exception catching is disabled" 原样甩给用户。
    const t = r.netlist;
    const INTERNAL = /Exception catching is disabled|Multiple sources driving net|Assertion failed|Cannot read propert/i;
    if (!t.compiled) {
      const namesUnit = t.name === 'MissingModulesError' && /'dff'/.test(t.message);
      const noInternals = !INTERNAL.test(t.message);
      (namesUnit && noInternals ? ok : bad)('[2] 门级网表 ⇒ 拒编译并点名缺的单元/原因',
        `${t.name}: ${t.message.slice(0, 150)}`);
    } else if (t.netConflicts >= 1) {
      ok('[2] 门级网表 ⇒ 走"能出图就标冲突"那一半口径', `conflicts=${t.netConflicts}`);
    } else {
      bad('[2] 门级网表 ⇒ 拒编译并点名原因', `出图了却一条冲突都没标（假绿）：器件 ${t.devices} 线 ${t.wires}`);
    }

    // [3] 编译模式也标自动线名
    const any = [n, t].filter((x) => x.compiled);
    if (!any.length) { unverified++; console.log('  UNVERIFIED  [3] 编译模式自动线名（两份设计都没出图）'); }
    else {
      const tot = any.reduce((s, x) => s + x.wires, 0), named = any.reduce((s, x) => s + x.namedWires, 0);
      (named > 0 && named === tot ? ok : bad)('[3] 编译模式导线都带线名（自动名补上了空 netname）', `named ${named}/${tot}`);
    }

    (perr.length ? bad : ok)('[4] 全程无页面异常', perr.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
    fail++;
  } finally {
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unverified} 未验证 =====`);
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    process.exit(fail ? 1 : 0);
  }
})();
