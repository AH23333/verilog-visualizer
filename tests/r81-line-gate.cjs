// R81 验收（深度自检卷五新增缺陷 V1）：**PROBLEMS 的行号必须是每一条各自的真行号**。
//
// 修前的现场读数（tests/r80-line-probe.cjs，我在动手改之前先跑的）：
//   test_counter.v 四条「模块 dff 未定义」全部显示 `第8行`，而 d0/d1/d2/d3 真身在 8/9/10/11 行；
//   跨行夹具 crossline 两条全显示 `第3行`，真身是 3 和 5；错误对象里**根本没有 line 字段**
//   （keys = message/fileName/moduleName/instanceName/detail）。
// 根因：实例正则跑在**折叠过空白**的文本上，`match.index` 回不到源码，旧实现只能
//   `source.indexOf(moduleName)` 估行 ⇒ 同一个模块的多个实例必然撞成同一个行号。
//   更糟的是行号只活在 `detail` 那句人话里，App 再用 `/第(\d+)行/` 回捞。
//
// 判据射程（说清各臂钉哪一层，别把"文案对"读成"字段对"）：
//   [1][2][3][4] 钉 `validateModuleInterfaces` 的结构化 `line` 真值（含 BOM、含跨行实例）；
//   [5] 钉结构化值与 `detail` 那句「第 N 行」逐条相等（两栏互证，防"改了字段没改文案"）；
//   [6] 钉**生产侧形状**：App 不再从文案回捞、改读 `err.line`，且不许再塞 `line: 1`；
//   [7] 文件级错误（重复定义）行号必须是 `null`，不许塞 1 冒充"就在第一行"；
//   [8] 控制组：全模块都有定义的文件 ⇒ 0 条错误（防"谁都报错"这种假绿）。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1581;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1581)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unverified++; console.log(`  UNVERIFIED  ${n}（${d}）`); };

const fx = (n, opt = {}) => {
  let s = fs.readFileSync(path.join(ROOT, 'test_files', n), 'utf8');
  if (opt.bom) s = '﻿' + s;
  return s;
};
// 跨行实例：模块名单占一行（第 3 行）、实例名在下一行；第二个实例起于第 5 行
const CROSSLINE = [
  'module top(input a, output y);',
  '',
  '  sub',
  '    i1 (.x(a), .z(y));',
  '  sub i2',
  '    (.x(a), .z(y));',
  'endmodule',
].join('\n');
// 重复定义：两个文件都定义 dup_mod ⇒ 这是"文件级"错误，产品不该假装知道行号
const DUP_A = 'module dup_mod(input a, output y); assign y = a; endmodule\n';
const DUP_B = 'module dup_mod(input a, output b); assign b = a; endmodule\n';

/** 一次调用把整组文件交给 validator（错误自带 fileName，判据按文件分组去读） */
async function validate(page, files) {
  return page.evaluate(async (list) => {
    const m = await import('/src/lib/verilog.ts');
    try {
      const errs = m.validateModuleInterfaces(list);
      return {
        threw: null,
        keys: errs.length ? Object.keys(errs[0]) : [],
        errors: errs.map((e) => ({
          file: e.fileName, inst: e.instanceName, mod: e.moduleName,
          line: e.line === undefined ? '__缺字段__' : e.line,
          detail: String(e.detail || ''),
        })),
      };
    } catch (e) { return { threw: String((e && e.message) || e).slice(0, 200), keys: [], errors: [] }; }
  }, files);
}

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await UI.boot(page, URL);

    const all = await validate(page, [
      { name: 'test_counter.v', content: fx('test_counter.v') },
      { name: 'crossline.v', content: CROSSLINE },
      { name: 'dup_a.v', content: DUP_A },
      { name: 'dup_b.v', content: DUP_B },
      { name: 'r56_conflict_named.v', content: fx('r56_conflict_named.v') },
    ]);
    if (all.threw) { console.log('FATAL validator 抛错：', all.threw); process.exit(1); }
    const forFile = (n) => all.errors.filter((e) => e.file === n);
    const linesOf = (n) => forFile(n).map((e) => e.line);
    console.log('  错误对象字段：', J(all.keys));

    // ===== [1] 四条 missing-module 的行号＝实例各自的真行号 =====
    const t1 = forFile('test_counter.v');
    const got = t1.filter((e) => e.mod === 'dff').map((e) => e.line);
    console.log('  [test_counter 读数]', J(t1.map((e) => `${e.inst}=${e.line}`)));
    (J(got) === J([8, 9, 10, 11]) ? ok : bad)('[1] test_counter.v 四条「模块 dff 未定义」的行号分别＝8/9/10/11', `实读=${J(got)}`);

    // ===== [2] 钉住原缺陷形状：不许再"全等于第一条" =====
    const l1 = linesOf('test_counter.v');
    (l1.length >= 2 && new Set(l1).size === l1.length ? ok : bad)('[2] 同模块的多个实例行号互不相同（修前四条全是 8）', `${J(l1)}：集合大小=${new Set(l1).size}`);

    // ===== [3] 结构化字段真的存在（不是只有文案里有行号）=====
    (!all.keys.includes('line') ? bad : forFile('test_counter.v').every((e) => typeof e.line === 'number')
      ? ok : bad)('[3] ValidationError 带结构化 line 字段，且四条都是数字', `keys=${J(all.keys)} 实读=${J(linesOf('test_counter.v'))}`);

    // ===== [4] 跨行实例：模块名在哪一行就报哪一行 =====
    const l4 = Object.fromEntries(forFile('crossline.v').map((e) => [e.inst, e.line]));
    console.log('  [跨行读数]', J(l4));
    (l4.i1 === 3 && l4.i2 === 5 ? ok : bad)('[4] 跨行写法的两个实例：i1→第 3 行、i2→第 5 行', J(l4));

    // ===== [5] 结构化 line 与 detail 那句「第 N 行」逐条一致 =====
    const mism = all.errors.filter((e) => {
      const m = e.detail.match(/第(\d+)行/);
      return m && Number(m[1]) !== e.line;
    });
    (mism.length === 0 && all.errors.length > 0 ? ok : bad)('[5] 结构化 line 与 detail 里的「第 N 行」逐条相等（两栏互证）', mism.length ? J(mism.map((e) => `${e.inst}:${J(e.line)} vs ${e.detail.slice(0, 40)}`)) : `${all.errors.length} 条都对得上`);

    // ===== [6] 生产侧形状：App 读字段，不再从文案回捞、也不塞假行号 =====
    const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'App.tsx'), 'utf8').replace(/^\uFEFF/, '');
    const noComment = appSrc.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    const grabsBack = /第\((?:\\d|\[0-9\])\)\+行/.test(noComment) || /detail\s*\.match\s*\(/.test(noComment);
    const fakesLine = /line:\s*1\b/.test(noComment);
    const readsField = /line:\s*err\.line\b/.test(noComment);
    (grabsBack ? bad : fakesLine ? bad : readsField ? ok : bad)(
      '[6] App.tsx 不回去文案里捞行号：改读结构化 err.line（三种罪状三种措辞）',
      grabsBack ? '仍在捞 `/第(\\d+)行/` 或 `detail.match(...)`' : fakesLine ? '还在塞 `line: 1`' : `读字段=${readsField}`);

    // ===== [7] 文件级错误（重复定义）行号＝ null =====
    const dupErr = all.errors.find((e) => /重复定义/.test(e.detail));
    if (!dupErr) skip('[7] 文件级错误（重复定义）的行号必须是 null', `夹具没造出重复定义错误：${J(all.errors.map((e) => e.detail.slice(0, 24)))}`);
    else (dupErr.line === null ? ok : bad)('[7] 文件级错误（重复定义）行号明确 null，不塞 1 冒充第一行', `实读=${J(dupErr.line)} detail=${dupErr.detail.slice(0, 56)}`);

    // ===== [8] 控制组 =====
    const n8 = forFile('r56_conflict_named.v').length;
    (n8 === 0 ? ok : bad)('[8] 控制组：模块都有定义的那份文件一条「未定义」都不报', `条数=${n8}`);

    // ===== [9] BOM 夹具另跑一发：行号不许漂 =====
    const withBom = await validate(page, [{ name: 'bom.v', content: fx('test_counter.v', { bom: true }) }]);
    const l9 = withBom.errors.map((e) => e.line);
    console.log('  [BOM 读数]', J(l9));
    (J(l9) === J([8, 9, 10, 11]) ? ok : bad)('[9] 同一份文件带 BOM 时行号仍是 8/9/10/11', `实读=${J(l9)}`);

    console.log('  PAGEERR:', J(perr.slice(0, 3)));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unverified} 未验证 =====`);
    await browser.close();
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    fail++;
    console.log('FATAL', String(e).slice(0, 300));
    console.log(`===== 结果: ${pass} pass, ${fail} fail, ${unverified} 未验证 =====`);
    try { await browser?.close(); } catch { }
    process.exit(1);
  } finally {
    try { server?.kill('SIGKILL'); } catch { }
  }
})();
