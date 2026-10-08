// R49 验收：同一份设计在「编译模式电路」与「过往返（→cells→回 JSON）重建的电路」上
// 必须**逐拍输出一致**。以前只比过几何与拓扑（器件数/连线数/位置），逻辑等价没测过；
// R48 抓到 extend / arst_value / srst_value 在往返中被静默丢掉，正是「拓扑没变、仿真变了」这一族。
//
// 激励配方（r49c 实测）：digitaljs 把信号挂在 **attributes** 上（cell.get('outputSignals')），
// 直接读属性恒 undefined；写值用现成向量的构造器 Ctor.fromBin(bin, bits) 再 set 回去。
// 引擎先 stop，再手动造时钟沿 + 反复 updateGatesNext 沉降 —— 两侧同一串，结果才可比。
//
// ⚠ 防空转：若 A 侧读数几乎全是 x，或整条 trace 一个值都没变，判「未验证」＝红，
//   不比两串 x（r49 第一版就是这么假通过的）。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1587;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1587)); } catch { } const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const freePort = (p) => {
  try {
    require('child_process').execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' });
  } catch { }
};

const CASES = [
  { top: 'r48_sync', files: ['r48_sync.v'], note: '同步复位值非零（state→101, q→A5）' },
  { top: 'r48_exotic', files: ['r48_exotic.v'], note: '异步复位 + 算术/多路/移位' },
];

(async () => {
  let server, browser;
  try {
    freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    // ⚠ stdio 必须是 ignore 而且要 unref：用 'pipe' 时这颗 npx 的孙进程（真正的 vite）攥着父进程的
    //   标准流不放 ⇒ 汇总行印了进程却不退出，run-all 只读到 ETIMEDOUT/ENVRED（与 r48 同一因）。
    try { server.unref(); } catch { }
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务未起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    for (const c of CASES) {
      const r = await page.evaluate(async (a) => {
        const djs = window.digitaljs;
        const sv = await import('/src/lib/subcircuitView.ts');
        const { compileVerilog } = await import('/src/lib/verilog.ts');
        let json;
        try { json = (await compileVerilog(a.srcs, a.top)).circuitJson; }
        catch (e) { return { compileErr: String(e.message).slice(0, 120) }; }
        // B 侧 = 编译 JSON 过往返（复制到沙盒 / 展开图 / 导出 .djs 都走这一对函数）
        const back = sv.cellsToCircuitJson(sv.circuitJsonToCells(json));

        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-12000px;top:0;width:2400px;height:1600px';
        document.body.appendChild(host);
        const build = (src) => sv.renderCircuitView(djs, host, structuredClone(src), { autoLayout: false });
        const hA = build(json), hB = build(back);
        if (!hA || !hB) return { err: `建图失败 A=${!!hA} B=${!!hB}` };

        const sigOf = (el) => { const o = (el.get && el.get('outputSignals')) || el.outputSignals || {}; return o.out || Object.values(o)[0]; };
        const drive = (el, bin) => {
          try {
            const bits = Number(el.get('bits')) || 1;
            const cur = sigOf(el); if (!cur || !cur.constructor) return false;
            const C = cur.constructor;
            const want = String(bin).padStart(bits, '0').slice(-bits);
            const vec = C.fromBin ? C.fromBin(want, bits) : C.zeros(bits);
            const o = el.get('outputSignals') || {};
            el.set('outputSignals', { ...o, out: vec });
            return true;
          } catch { return false; }
        };
        const settle = (circuit, n) => { for (let i = 0; i < n; i++) { try { circuit._engine.updateGatesNext(); } catch { } } };
        const readNets = (paper) => {
          const seen = new Set(); const out = [];
          for (const lk of paper.model.getLinks()) {
            const net = String(lk.get('netname') || ''); if (!net || seen.has(net)) continue; seen.add(net);
            const s = lk.get('signal');
            out.push([net, s != null ? String(s).replace(/^Vector3vl\s+/, '') : 'x']);
            if (out.length >= 80) break;
          }
          return out;
        };

        const run = (h) => {
          const circuit = h.circuit, paper = h.paper;
          try { circuit.stop(); } catch { }
          const els = paper.model.getElements();
          const clks = els.filter((e) => String(e.get('type')) === 'Clock');
          const ins = els.filter((e) => ['Button', 'NumEntry'].includes(String(e.get('type'))));
          const trace = [];
          let droveOk = 0;
          for (let k = 0; k < 8; k++) {
            for (let i = 0; i < ins.length; i++) {
              const bits = Number(ins[i].get('bits')) || 1;
              const pat = bits === 1 ? String((k >> i) & 1) : ['0', '1', 'a5', '5a', 'ff', '0f', 'f0', 'cc'][k].replace(/./g, (ch) => {
                const v = parseInt(ch, 16); return Number.isFinite(v) ? v.toString(2).padStart(4, '0') : ch;
              }).padStart(bits, '0').slice(-bits);
              if (drive(ins[i], pat)) droveOk++;
            }
            // 一个完整时钟沿（低→沉降→高→沉降）
            for (const c of clks) drive(c, '0');
            settle(circuit, 24);
            for (const c of clks) drive(c, '1');
            settle(circuit, 24);
            trace.push(readNets(paper));
          }
          return { trace, nClk: clks.length, nIn: ins.length, droveOk };
        };
        const A = run(hA), B = run(hB);
        host.remove();

        const isX = (s) => /^x+$|^z*$/.test(String(s));
        const nonX = A.trace.reduce((n, t) => n + t.filter(([, v]) => !isX(v)).length, 0);
        const total = A.trace.reduce((n, t) => n + t.length, 0);
        // 激励真的起作用了吗：A 侧至少要有一个 net 在 8 拍里变过值
        const names = new Set(); A.trace[0].forEach(([n2]) => names.add(n2));
        let changed = 0;
        for (const nm of names) {
          const vals = new Set(A.trace.map((t) => (t.find((x) => x[0] === nm) || [, 'x'])[1]));
          if (vals.size > 1) changed++;
        }
        const diffs = [];
        for (let k = 0; k < Math.min(A.trace.length, B.trace.length) && diffs.length < 4; k++) {
          const mapB = new Map(B.trace[k]);
          for (const [net, v] of A.trace[k]) {
            if (!mapB.has(net)) { diffs.push(`拍${k} net「${net}」B 侧不存在`); break; }
            const w = mapB.get(net);
            if (w !== v) { diffs.push(`拍${k} net「${net}」 A=${v} B=${w}`); break; }
          }
        }
        return {
          diffs, ticks: A.trace.length, nNet: names.size, nonX, total, changed,
          nClk: A.nClk, nIn: A.nIn, droveA: A.droveOk, droveB: B.droveOk,
          skippedB: hB.skippedWires + hB.skippedDevices,
          sample: A.trace[A.trace.length - 1].slice(0, 8).map(([n3, v]) => `${n3}=${v}`).join(','),
        };
      }, { top: c.top, srcs: c.files.map((f) => ({ name: f, content: rd(f) })) });

      if (r.compileErr) { bad(`${c.top} 编译失败`, r.compileErr); continue; }
      if (r.err) { bad(`${c.top} 建图失败`, r.err); continue; }
      const vacuous = !(r.nClk > 0 && r.nIn > 0 && r.droveA > 0 && r.droveB > 0
        && r.total > 0 && r.nonX / r.total > 0.5 && r.changed >= 2 && r.skippedB === 0);
      if (vacuous) {
        bad(`${c.top} 逐拍比对未成立（激励或覆盖不足＝不作数）`, JSON.stringify(r));
      } else if (r.diffs.length) {
        bad(`${c.top} 编译电路与往返重建电路逐拍输出一致`, JSON.stringify({ diffs: r.diffs, nNet: r.nNet }));
      } else {
        ok(`${c.top}：逐拍输出一致（${c.note}）`,
          `${r.nNet} 根 net × ${r.ticks} 拍，非x ${r.nonX}/${r.total}，会变的 net ${r.changed} 个，B 侧降级 0`);
      }
    }

    perr.length === 0 ? ok('全程无页面异常') : bad('页面异常', JSON.stringify(perr.slice(0, 3)));
    console.log(`\n== R49: ${pass} PASS / ${fail} FAIL ==`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 400));
    process.exitCode = 1;
  } finally {
    try { server && server.kill(); } catch { }
    try { browser && await browser.close(); } catch { }
  }
})();
