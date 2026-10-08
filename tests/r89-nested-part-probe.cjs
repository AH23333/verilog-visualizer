// R89 只读探针（#29 的前置读数，不判定）：把"引用了 Q 的部件 P"单独移进另一个文件夹之后，
// P 体内那颗 Q 到底还能不能解析——以及**用户看得见的那一屏**到底坏没坏。
//
// 为什么要先量：#29 是从代码里读出来的怀疑（`carryPartDefsAfterMove` 跳过 `role:'part'`），
// 但有两件事决定它是不是真缺陷：① `resolvePartRef` 最后一级是"全库兜底"，Q 在别的文件夹也可能被找到；
// ② P 的存档里若还留着 Q 的**内嵌快照**（`subcircuitGraph`），展开照样有图 —— 那就是假症状（记忆里 VR/UN 那一族：
//   怀疑成立≠症状存在，量出来再说）。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1589; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };
const ST = Date.now() % 100000;
const Q = 'RqQ' + ST, P = 'RqP' + ST;

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    const out = await page.evaluate(async ({ q, p }) => {
      const m = await import('/src/store/sandboxStore.ts');
      const g = await import('/src/lib/gateSystem.ts');
      const { sandboxStore } = m;
      const io = { cells: [
        { id: 'qi', type: 'Input', position: { x: 40, y: 40 }, bits: 1 },
        { id: 'qo', type: 'Output', position: { x: 260, y: 40 }, bits: 1 },
        { isLink: true, source: { id: 'qi', port: 'out' }, target: { id: 'qo', port: 'in' }, netname: 'N1' },
      ] };
      // Q 只住在 g1
      const qf = sandboxStore.create(`g1/${q}.djs`, 'part'); sandboxStore.save(qf.id, JSON.stringify(io));
      // P 住在 g1，里面一颗 Q 实例（**不带内嵌快照**＝绑定式实例，R39 之后的常态）
      const pCells = { cells: [
        { id: 'pi', type: 'Input', position: { x: 40, y: 40 }, bits: 1 },
        { id: 'po', type: 'Output', position: { x: 460, y: 40 }, bits: 1 },
        { id: 'pq', type: 'Subcircuit', celltype: q, position: { x: 220, y: 40 } },
      ] };
      const pf = sandboxStore.create(`g1/${p}.djs`, 'part'); sandboxStore.save(pf.id, JSON.stringify(pCells));
      const rd = (s) => { try { return JSON.parse(s); } catch { return null; } };
      const nestedOf = (def) => ((def && def.cells) || []).filter((c) => c && c.type === 'Subcircuit')
        .map((c) => ({ celltype: c.celltype, 有内嵌快照: !!(c.subcircuitGraph && (c.subcircuitGraph.cells || []).length) }));
      const show = (scope) => ({
        P解析: (() => { const r = g.resolvePartRef(p, scope); return r ? r.file.name : null; })(),
        P定义: (() => { const d = g.resolveDefCells(p, scope); return { 有: !!d?.cells?.length, 嵌套: nestedOf(d) }; })(),
        Q解析: (() => { const r = g.resolvePartRef(q, scope); return r ? r.file.name : null; })(),
        Q存在: g.partExists(q, scope),
      });
      const before = show('g1');
      // 只把 P 移进 g2（这就是 carryPartDefsAfterMove 该出手而没出手的那一步）
      const files = sandboxStore.list(); const p2 = files.find((f) => f.id === pf.id);
      sandboxStore.rename(pf.id, `g2/${p}.djs`);
      const after = show('g2');
      const carried = (() => {
        // 现算一遍 carryPartDefsAfterMove 的等价逻辑（它就是 ensureDefsFromCells(移动文件的 cells, 新文件夹)）
        const obj = rd(sandboxStore.get(pf.id).graphJson);
        const before2 = new Set(sandboxStore.list().map((f) => f.name));
        g.ensureDefsFromCells(obj.cells || [], 'g2');
        return sandboxStore.list().map((f) => f.name).filter((n) => !before2.has(n));
      })();
      const afterEnsure = show('g2');
      return {
        移动前_g1视野: before, 移动后_g2视野: after,
        ensureDefsFromCells新建: carried, ensure之后: afterEnsure,
        库清单: sandboxStore.list().map((f) => `${f.name}|${f.role ?? ''}`),
      };
    }, { q: Q, p: P });
    console.log(J(out));
    console.log('\n读法：若「移动后_g2视野.P定义.嵌套」那颗 Q 的 `有内嵌快照` 为 false 且 `Q解析` 仍指到 g1 的 Q ⇒ 靠全库兜底解析（症状轻，但文件夹不自治）；'
      + '若 `Q解析` 为 null 且没有内嵌快照 ⇒ 真的"绑定失效"（#29 成立，须改 carry 的跳过）。');
  } catch (e) {
    console.log('FATAL', String(e && e.stack || e).slice(0, 400));
  } finally {
    try { await browser?.close(); } catch { }
    try { server?.kill('SIGKILL'); } catch { }
    UI.freePort(PORT);
    console.log('DONE');
  }
})();
