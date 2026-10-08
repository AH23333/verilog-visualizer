// R51 只读探针（打现场读数，不作判定）：
//  A. 编译产物里到底出现哪些「器件参数」—— signed / fillx / words / offset / numbase /
//     constant / leftOp / states / init_state / trans_table；
//  B. 这些参数过「编译 JSON → cells → 回 JSON」（= 复制到沙盒 / 展开图 / 存部件 走的那一对函数）
//     之后还在不在；
//  C. 两侧的**逐拍仿真**读数是否一致（拓扑一样但仿得不一样才是真事故）。
// 判据设计：r51_signed（有符号乘除 + 移位 + 128×8 存储器）、r51_fsm（5 状态机）。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1633; const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
const KEYS = ['signed', 'fillx', 'words', 'offset', 'numbase', 'constant', 'leftOp',
  'states', 'init_state', 'trans_table', 'extend', 'arst_value', 'srst_value', 'groups', 'slice'];
const freePort = (p) => {
  try {
    require('child_process').execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' });
  } catch { }
};

const CASES = [
  { top: 'r51_signed', files: ['r51_signed.v'] },
  { top: 'r51_fsm', files: ['r51_fsm.v'] },
];

(async () => {
  let server, browser;
  try {
    freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
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
        let json, compileErr = '';
        try { json = (await compileVerilog(a.srcs, a.top)).circuitJson; }
        catch (e) { return { compileErr: String(e.message).slice(0, 300) }; }

        // ---- A. 类型直方图 + 参数出现情况（含子电路） ----
        const allDevs = [];
        const walk = (src, tag) => {
          const dv = (src && src.devices) || {};
          for (const k of Object.keys(dv)) allDevs.push({ tag, id: k, dev: dv[k] });
          const subs = (src && src.subcircuits) || {};
          for (const n of Object.keys(subs)) walk(subs[n], 'sub:' + n);
        };
        walk(json, 'top');
        const hist = {};
        for (const d of allDevs) hist[String(d.dev.type)] = (hist[String(d.dev.type)] || 0) + 1;
        const keyReport = {};
        for (const k of a.keys) {
          const hits = allDevs.filter((d) => d.dev[k] !== undefined && d.dev[k] !== null);
          if (hits.length) keyReport[k] = { n: hits.length, sample: JSON.stringify(hits[0].dev[k]).slice(0, 90), type: hits[0].dev.type };
        }

        // ---- B. 往返后哪些参数消失 ----
        const back = sv.cellsToCircuitJson(sv.circuitJsonToCells(json));
        const backDevs = [];
        const walk2 = (src) => {
          const dv = (src && src.devices) || {};
          for (const k of Object.keys(dv)) backDevs.push(dv[k]);
          const subs = (src && src.subcircuits) || {};
          for (const n of Object.keys(subs)) walk2(subs[n]);
        };
        walk2(back);
        const lost = {};
        for (const k of a.keys) {
          const before = allDevs.filter((d) => d.dev[k] != null);
          if (!before.length) continue;
          // 按 id 对：原器件 → 往返后的同 id 器件
          const after = new Map(backDevs.map((d) => [String(d.id ?? d.label ?? ''), d]));
          const gone = [];
          for (const d of before) {
            const b = backDevs.find((x) => String(x.id ?? '') === String(d.id ?? ''));
            if (!b || b[k] === undefined || b[k] === null) gone.push(d.id + ':' + JSON.stringify(d.dev[k]).slice(0, 40));
          }
          if (gone.length) lost[k] = { n: gone.length, eg: gone.slice(0, 3) };
        }

        // ---- C. 逐拍仿真一致性（r49 的激励配方） ----
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-12000px;top:0;width:2400px;height:1600px';
        document.body.appendChild(host);
        const build = (src) => sv.renderCircuitView(djs, host, structuredClone(src), { autoLayout: false });
        const hA = build(json), hB = build(back);
        if (!hA || !hB) return { compileErr, hist, keyReport, lost, buildErr: `A=${!!hA} B=${!!hB}` };

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
            if (out.length >= 120) break;
          }
          return out;
        };
        const run = (h) => {
          const circuit = h.circuit, paper = h.paper;
          try { circuit.stop(); } catch { }
          const els = paper.model.getElements();
          const clks = els.filter((e) => String(e.get('type')) === 'Clock');
          const ins = els.filter((e) => ['Button', 'NumEntry'].includes(String(e.get('type'))));
          const trace = []; let droveOk = 0;
          for (let k = 0; k < 8; k++) {
            for (let i = 0; i < ins.length; i++) {
              const bits = Number(ins[i].get('bits')) || 1;
              const pat = bits === 1 ? String((k >> i) & 1) : ['0', '1', 'a5', '5a', 'ff', '0f', 'f0', 'cc'][k]
                .replace(/./g, (ch) => { const v = parseInt(ch, 16); return Number.isFinite(v) ? v.toString(2).padStart(4, '0') : ch; })
                .padStart(bits, '0').slice(-bits);
              if (drive(ins[i], pat)) droveOk++;
            }
            for (const cc of clks) drive(cc, '0'); settle(circuit, 24);
            for (const cc of clks) drive(cc, '1'); settle(circuit, 24);
            trace.push(readNets(paper));
          }
          return { trace, nClk: clks.length, nIn: ins.length, droveOk };
        };
        const A = run(hA), B = run(hB);
        const names = new Set();
        for (const t of A.trace) for (const [n] of t) names.add(n);
        let total = 0, nonX = 0, changed = 0, diffs = [];
        for (const n of names) {
          let prev = null;
          for (let t = 0; t < A.trace.length; t++) {
            const av = (A.trace[t].find((x) => x[0] === n) || [])[1];
            const bv = (B.trace[t].find((x) => x[0] === n) || [])[1];
            total++;
            if (av && av !== 'x' && !/^[x]+$/.test(av)) nonX++;
            if (av != null && prev !== null && av !== prev) changed++;
            prev = av;
            if (av !== bv && diffs.length < 8) diffs.push(`${n}@t${t}: A=${av} B=${bv}`);
          }
        }
        host.remove();
        return { compileErr, hist, keyReport, lost, nDev: allDevs.length, nDevBack: backDevs.length,
          nConn: (json.connectors || []).length, nConnBack: (back.connectors || []).length,
          ticks: A.trace.length, nNet: names.size, nonX, changed, diffs, droveOk: A.droveOk + B.droveOk };
      }, { srcs: c.files.map((f) => ({ name: f, content: rd(f) })), top: c.top, keys: KEYS });

      console.log(`\n########## ${c.top}`);
      if (r.compileErr) { console.log('COMPILE ERR: ' + r.compileErr); continue; }
      console.log('器件类型:', JSON.stringify(r.hist));
      console.log('参数出现:', JSON.stringify(r.keyReport, null, 1));
      console.log('往返丢失:', JSON.stringify(r.lost, null, 1));
      console.log(`器件 ${r.nDev}→${r.nDevBack} 连线 ${r.nConn}→${r.nConnBack} net ${r.nNet} 拍 ${r.ticks} 非x ${r.nonX}/${r.total || 0} 会变 ${r.changed} droveOk ${r.droveOk}`);
      if (r.buildErr) console.log('建图: ' + r.buildErr);
      if (r.diffs && r.diffs.length) { console.log('仿真分岔样本:'); for (const d of r.diffs) console.log('   ' + d); }
      else console.log('仿真分岔: 无');
    }
    if (perr.length) console.log('\n页面异常: ' + perr.slice(0, 5).join(' | '));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 500));
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
  }
})();
