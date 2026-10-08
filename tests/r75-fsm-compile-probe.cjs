// R75 探针（只打读数）：yosys-wasm 能不能把状态机**留成 $fsm** 交出去。
//
// 为什么要先量这个：本仓的合成脚本写的是裸 `fsm`（`src/lib/verilog.ts:826-834`：
// proc/opt/**fsm**/opt/memory/opt/techmap/opt/write_json+write_verilog），
// 裸 fsm 会把状态机当场打散成触发器＋门 ⇒ digitaljs 那颗 FSM 器件（状态图、init_state、
// trans_table）在**编译模式**永远拿不到货。想留就得 `fsm -nomap`（可能还要 `-expand`），
// 而留下来的是个 yosys 内部单元：
//  · `techmap` 认不认它（不认是留着还是报错）；
//  · `write_verilog` 遇到未映射的 `$fsm` 会不会整个 abort；
//  · yosys-wasm 里这些 pass 有没有被裁掉（裁掉会直接抛）。
// 三条都是"崩了才看得见"的事，所以先在浏览器里拿真 yosys 跑一遍，不碰生产脚本。
//
// 打的是每个变体一张表：{ aborted, $fsm 颗数, 单元总数, 日志尾部 }
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1751; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

const SOURCE = fs.readFileSync(path.join(ROOT, 'test_files', 'r51_fsm.v'), 'utf8');
console.log('[夹具] r51_fsm.v 前 6 行：', JSON.stringify(SOURCE.split('\n').slice(0, 6).join(' ⏎ ')));

const RUN = (src) => `(async () => {
  const { initYosys } = await import('/src/lib/verilog.ts');
  let mod;
  try { mod = await initYosys(); } catch (e) { return { noYosys: String(e).slice(0, 160) }; }
  const out = [];
  mod.print = (s) => { if (s) out.push(String(s)); };
  mod.printErr = (s) => { if (s) out.push(String(s)); };
  const variants = ${JSON.stringify(src.variants)};
  const res = [];
  for (const v of variants) {
    const log = [];
    mod.print = (s) => { if (s) log.push(String(s)); };
    mod.printErr = (s) => { if (s) log.push(String(s)); };
    let aborted = null, fsm = null, cells = null, mods = null, trans = null, hist = null, fsmish = null;
    try {
      mod.FS.writeFile('/top.v', v.body);
      mod.FS.writeFile('/s.ys', v.script);
      mod.callMain(['/s.ys']);
      const j = JSON.parse(mod.FS.readFile('/o.json', { encoding: 'utf8' }));
      mods = Object.keys(j.modules || {});
      const all = [];
      for (const m of Object.values(j.modules || {})) for (const c of Object.values(m.cells || {})) all.push(c.type);
      cells = all.length;
      fsm = all.filter((t) => t === '$fsm').length;
      // 类型名里带 fsm 的都算（有的版本会叫 $fsm$... 或改名），别只认字面 '$fsm'
      fsmish = Array.from(new Set(all.filter((t) => /fsm/i.test(String(t))))).slice(0, 6);
      const h = {}; for (const t of all) h[t] = (h[t] || 0) + 1;
      hist = Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 8);
      trans = all.filter((t) => String(t).startsWith('$_')).length;
    } catch (e) {
      aborted = String(e && e.message || e).slice(0, 200);
    }
    const tail = log.slice(-6).join(' | ').slice(0, 700);
    res.push({ name: v.name, aborted, fsm, fsmish, gateCells: trans, cells, mods, hist, tail });
  }
  return res;
})()`;

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    try { server.unref(); } catch { }
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    const head = `design -reset
read_verilog /top.v
hierarchy -auto-top
proc
opt`;
    const tailJson = `write_json /o.json`;
    const variants = [
      { name: 'A 今天这条（裸 fsm + techmap + write_verilog）', body: SOURCE, script: `${head}
fsm
opt
memory
opt
techmap
opt
${tailJson}
write_verilog /n.v` },
      { name: 'B fsm -nomap（留 $fsm，仍走 techmap）', body: SOURCE, script: `${head}
fsm -nomap
opt
memory
opt
techmap
opt
${tailJson}
write_verilog /n.v` },
      { name: 'C fsm -nomap -expand', body: SOURCE, script: `${head}
fsm -nomap -expand
opt
memory
opt
techmap
opt
${tailJson}
write_verilog /n.v` },
      { name: 'D fsm -nomap 且不跑 write_verilog（只 write_json）', body: SOURCE, script: `${head}
fsm -nomap
opt
memory
opt
techmap
opt
${tailJson}` },
      { name: 'E fsm -nomap 后 fsmmap（把 $fsm 收尾映射掉，看看 write_verilog 是否才安全）', body: SOURCE, script: `${head}
fsm -nomap
opt
memory
opt
techmap
opt
fsmmap
${tailJson}
write_verilog /n.v` },
    // F/G：不跑 techmap —— 分清「fsm 根本没建出 $fsm」与「techmap 把它打散了」这两种下落
    { name: 'F fsm -nomap 后直接 write_json（不跑 techmap/memory）', body: SOURCE, script: `${head}
fsm -nomap
${tailJson}` },
    { name: 'G fsm（裸）后直接 write_json（不跑 techmap）', body: SOURCE, script: `${head}
fsm
${tailJson}` },
    ];
    const res = await page.evaluate(RUN({ variants }));
    if (res && res.noYosys) console.log('FATAL yosys 起不来：', res.noYosys);
    else for (const r of res) {
      console.log(`\n### ${r.name}`);
      console.log('    aborted =', J(r.aborted), ' $fsm 颗数 =', r.fsm, ' 名字带 fsm 的类型 =', J(r.fsmish), ' 门级单元数 =', r.gateCells, ' 总单元 =', r.cells, ' 模块 =', J(r.mods));
      console.log('    类型分布(前 8) =', J(r.hist));
      console.log('    日志尾部 =', J(r.tail));
    }
    console.log('\n[E] 页面异常 =', J(perr.slice(0, 3)));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 500));
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
