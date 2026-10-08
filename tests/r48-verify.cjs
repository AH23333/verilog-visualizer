// R48 验收：器件参数在「编译 JSON ⇄ 沙盒 cells ⇄ 画布模型」之间对称往返
//  [A] 两个方向共用同一份清单（读**生产**的 DEVICE_PARAM_KEYS，不在测试里抄一份）
//  [B] 真实编译产物里出现的器件字段，过 compile→cells→JSON 之后不许莫名消失
//  [C] 后果级判据：ZeroExtend 的 extend、Dff 的 arst_value、同步复位的 srst_value
//      过完往返，**建出来的模型值**必须和原样编译一致（丢了＝1→1 位、复位值归 0）
//  [D] 沙盒里旋转过（Ctrl+R）的器件，angle 要能进展开图/导出的电路 JSON
//  [E] 全程不掉器件、不掉线、无页面异常
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1586;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1586)); } catch { } const URL = `http://localhost:${PORT}/`;
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

// 刻意不带进沙盒的字段：源码跳转位置（只有编译模式用）、hide_label（digitaljs 与本项目都不读）
const ALLOW_DROP = ['source_positions', 'hide_label'];

const GROUPS = [
  { top: 'multiplier', files: ['multiplier.v', 'adder.v', 'full_adder.v'], watch: ['extend'] },
  { top: 'r48_exotic', files: ['r48_exotic.v'], watch: ['arst_value'] },
  { top: 'r48_sync', files: ['r48_sync.v'], watch: ['srst_value'] },
];

(async () => {
  let server, browser;
  try {
    freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    // ⚠ stdio 必须是 ignore 而且要 unref：用 'pipe' 时这颗 npx 的孙进程（真正的 vite）攥着父进程的
    //   标准流不放 —— 判据全打完、汇总行也印了，进程却永不退出 ⇒ run-all 只读到 ETIMEDOUT/ENVRED，
    //   看起来像『产品跑不完』，其实是这一格的收尾没做完（r48/r49/r50 三格同时中过这一次）。
    try { server.unref(); } catch { }
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务未起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    // ===== [A] 两个方向对称（清单从生产模块读，不抄） =====
    const A = await page.evaluate(async () => {
      const dp = await import('/src/lib/deviceParams.ts');
      const sv = await import('/src/lib/subcircuitView.ts');
      const keys = dp.DEVICE_PARAM_KEYS;
      const rich = { id: 'd1', type: 'Or', position: { x: 10, y: 20 } };
      for (const k of keys) rich[k] = k === 'groups' ? [2, 3] : k === 'polarity' ? { clock: 1 }
        : k === 'slice' ? { start: 0, width: 2 } : k === 'extend' ? { input: 3, output: 4 }
          : k === 'angle' ? 90 : k === 'enable_srst' || k === 'no_data' ? true : 1;
      const fwd = sv.cellsToCircuitJson({ cells: [structuredClone(rich)] }).devices.d1 || {};
      const back = sv.circuitJsonToCells({ devices: { d1: structuredClone(fwd) }, connectors: [] }).cells[0] || {};
      const lostFwd = keys.filter((k) => JSON.stringify(fwd[k]) !== JSON.stringify(rich[k]));
      const lostBack = keys.filter((k) => JSON.stringify(back[k]) !== JSON.stringify(rich[k]));
      return { nKeys: keys.length, lostFwd, lostBack, hasAngle: keys.includes('angle') };
    });
    (!A.lostFwd.length && !A.lostBack.length)
      ? ok('[A] 生产清单里的每个器件参数两个方向都对称往返', `keys=${A.nKeys}`)
      : bad('[A] 器件参数在某次转换中被静默丢掉', JSON.stringify(A));

    // ===== [B][C][E] 真实编译产物：字段不许莫名消失 + 建出的模型值要一致 =====
    const B = [];
    for (const g of GROUPS) {
      B.push(await page.evaluate(async (a) => {
        const dp = await import('/src/lib/deviceParams.ts');
        const sv = await import('/src/lib/subcircuitView.ts');
        const { compileVerilog } = await import('/src/lib/verilog.ts');
        const djs = window.digitaljs;
        let json;
        try { json = (await compileVerilog(a.srcs, a.top)).circuitJson; }
        catch (e) { return { top: a.top, compileErr: String(e.message).slice(0, 100) }; }

        // 只看**顶层模块**：嵌套模块体在 cells 里刻意不内联（按 celltype 绑定到
        // 各自的文件，单一真源），那部分由 R42 的 [8] 覆盖，不在这里判。
        const carriers = {};
        const keysByType = {};
        for (const [k, d0] of Object.entries(json.devices || {})) {
          const d = d0 || {}; const t = String(d.type || '?');
          (keysByType[t] = keysByType[t] || new Set());
          for (const key of Object.keys(d)) keysByType[t].add(key);
          const id = String(d.id || k);
          for (const f of a.watch) if (d[f] !== undefined) (carriers[f] = carriers[f] || []).push({ id, v: d[f] });
        }

        // 过往返
        const cells = sv.circuitJsonToCells(json);
        const back = sv.cellsToCircuitJson(cells);
        const flatCells = {}; for (const c of cells.cells || []) if (!c.isLink) flatCells[String(c.id)] = c;
        const flatBack = { ...(back.devices || {}) };
        for (const m of Object.values(back.subcircuits || {})) Object.assign(flatBack, m.devices || {});
        const missing = [];
        for (const [k, d] of Object.entries(json.devices || {})) {
          const id = String((d && d.id) || k); const c = flatCells[id]; const b = flatBack[id];
          for (const key of Object.keys(d || {})) {
            if (a.drop.includes(key) || key === 'position') continue;
            if (!c || c[key] === undefined) { missing.push(`${d.type}.${key}→cells`); continue; }
            if (!b || b[key] === undefined) missing.push(`${d.type}.${key}→JSON`);
          }
        }

        // 后果级：直接按 Circuit._makeGraph 的方式**构造那颗载体器件**（临时图 + new cellType({...dev})），
        // 比渲染整张 2307 器件的图快两个数量级，而且量的正是「构造期读走的值」这一步。
        const GraphCtor = new djs.Circuit({ devices: {}, connectors: [] })._graph.constructor;
        const constructRead = (srcJson, ids) => {
          const flatMods = [srcJson, ...Object.values(srcJson.subcircuits || {})];
          const out = {};
          for (const id of ids) {
            const dev = flatMods.map((m) => (m.devices || {})[id]).find((d) => !!d);
            if (!dev) { out[id] = '器件不在这份 JSON 里'; continue; }
            try {
              const g = new GraphCtor();
              const C = djs.cells[String(dev.type)];
              g.addCell(new C({ ...structuredClone(dev), id }));
              out[id] = a.watch.map((f) => `${f}=${JSON.stringify(g.getCell(id).get(f))}`).join(' ');
            } catch (e) { out[id] = `构造失败:${String((e && e.message) || e).slice(0, 50)}`; }
          }
          return out;
        };
        // 顶层模块的拓扑：器件数、连线数、悬空线（嵌套模块体按名绑定，不在这里判）
        const topo = (m) => {
          const ids = new Set(); let devs = 0, conns = 0, dangling = 0;
          for (const [k, d] of Object.entries(m.devices || {})) { ids.add(String((d && d.id) || k)); devs++; }
          for (const c of m.connectors || []) {
            conns++;
            if (!ids.has(String(c.from && c.from.id)) || !ids.has(String(c.to && c.to.id))) dangling++;
          }
          return { devs, conns, dangling };
        };
        const watchIds = [];
        // 先自证两候选真的不同：优先挑「值不是 digitaljs 默认（全 0）」的载体，
        // 否则删掉字段前后都是 "0"，[C] 这一格咬不住（变异台架实测过这个洞）。
        const nonDefault = (v) => {
          if (v && typeof v === 'object') return true;
          return /1|true|[1-9]/.test(String(v));
        };
        for (const f of a.watch) {
          const list = (carriers[f] || []).slice();
          list.sort((x, y) => Number(nonDefault(y.v)) - Number(nonDefault(x.v)));
          for (const x of list.slice(0, 3)) watchIds.push(x.id);
        }
        const before = constructRead(json, watchIds);
        const after = constructRead(back, watchIds);
        return {
          top: a.top, nDev: Object.keys(flatCells).length,
          missing: Array.from(new Set(missing)).slice(0, 8),
          carriers: Object.fromEntries(Object.entries(carriers).map(([f, v]) => [f, v.length])),
          watch: watchIds.map((id) => ({ id, before: before[id], after: after[id] })),
          counts: { before: topo(json), after: topo(back) },
        };
      }, { top: g.top, srcs: g.files.map((f) => ({ name: f, content: rd(f) })), watch: g.watch, drop: ALLOW_DROP }));
    }

    for (const r of B) {
      if (r.compileErr) { bad(`[B] ${r.top} 编译失败`, r.compileErr); continue; }
      r.missing.length === 0
        ? ok(`[B] ${r.top}：顶层编译产物字段过往返无莫名消失（器件 ${r.nDev} 颗，载体 ${JSON.stringify(r.carriers)}）`)
        : bad(`[B] ${r.top}：顶层往返后字段消失`, JSON.stringify(r.missing));
      // 「没测到」不算通过：载体器件必须真的被构造出来两边都比过
      const unmeasured = (r.watch || []).filter((w) => !w.before || !w.after
        || /不在|构造失败/.test(String(w.before)) || /不在|构造失败/.test(String(w.after)));
      const diff = (r.watch || []).filter((w) => w.before !== w.after);
      if (!(r.watch || []).length) bad(`[C] ${r.top}：没有任何器件带 ${JSON.stringify(r.counts && r.watch)} 判据字段，本轮未验证`);
      else if (unmeasured.length) bad(`[C] ${r.top}：载体未能构造，未验证`, JSON.stringify(unmeasured));
      else if (diff.length) bad(`[C] ${r.top}：往返后构造期模型值变了`, JSON.stringify({ diff, all: r.watch }));
      else ok(`[C] ${r.top}：构造期读走的值原样/往返后一致`, r.watch.map((w) => `${w.id}[${w.before}]`).join(' ').slice(0, 150));
      const cb = r.counts.before, ca = r.counts.after;
      (cb.devs === ca.devs && cb.conns === ca.conns && ca.dangling === 0)
        ? ok(`[E] ${r.top}：顶层器件/连线数不变、无悬空线`, `器件 ${cb.devs}→${ca.devs}，线 ${cb.conns}→${ca.conns}`)
        : bad(`[E] ${r.top}：往返后拓扑变化`, JSON.stringify(r.counts));
    }

    // ===== [D] 沙盒旋转的器件：angle 要进得了电路 JSON（展开图/导出/存部件都用它） =====
    const D = await page.evaluate(async () => {
      const sv = await import('/src/lib/subcircuitView.ts');
      const j = sv.cellsToCircuitJson({ cells: [
        { id: 'a1', type: 'And', position: { x: 10, y: 10 }, angle: 90 },
        { id: 'b1', type: 'Subcircuit', celltype: 'AA', position: { x: 90, y: 90 }, angle: 180, subcircuitGraph: { cells: [] } },
      ] });
      return { gate: j.devices.a1.angle, sub: j.devices.b1.angle };
    });
    (D.gate === 90 && D.sub === 180)
      ? ok('[D] 旋转过的器件/模块实例 angle 进入电路 JSON（展开图与编译渲染同形）', JSON.stringify(D))
      : bad('[D] 旋转角度在转换中丢失', JSON.stringify(D));

    perr.length === 0 ? ok('[F] 全程无页面异常') : bad('[F] 页面异常', JSON.stringify(perr.slice(0, 3)));
    console.log(`\n== R48: ${pass} PASS / ${fail} FAIL ==`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 400));
    process.exitCode = 1;
  } finally {
    try { server && server.kill(); } catch { }
    try { browser && await browser.close(); } catch { }
  }
})();
