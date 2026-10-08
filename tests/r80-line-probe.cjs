// R80 取证探针（不是闸门）：把 `validateModuleInterfaces` 现在**到底报第几行**读出来。
//
// 为什么要先跑探针再写判据：卷五实测说 test_counter.v 的四条「模块 dff 未定义」行号**全显示 :8**，
// 而 d0-d3 实际在 8/9/10/11 行。要钉"行号必须是 8/9/10/11"这一格，我得先亲眼看见今天的读数
// （含 `line` 字段存不存在），不能把预期写在没见过的形状上。
//
// 根因位置：verilog.ts 的 parseInstantiations 在**折叠过空白**的 cleaned 串上 exec()，
// 于是 match.index 回不到源码，只能 `source.indexOf(moduleName)` 估行 ⇒ 同模块的多个实例必然同一个行号。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1580; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;

/** 从磁盘取真夹具（不用玩具输入） */
const readFixture = (n, opts = {}) => {
  let s = fs.readFileSync(path.join(ROOT, 'test_files', n), 'utf8');
  if (opts.bom) s = '﻿' + s;
  return s;
};

// 跨行实例：模块名单占一行、实例名在下一行（parseInstantiations 的 Step 4 专门处理这种）
const CROSSLINE = [
  'module top(input a, output y);',
  '',
  '  sub',
  '    i1 (.x(a), .z(y));',
  '  sub i2',
  '    (.x(a), .z(y));',
  'endmodule',
].join('\n');

// ⚠ 用**真函数**传给 page.evaluate，不要传字符串：Playwright 对"字符串箭头函数 + 参数"这一形态
// 会把返回值吞成 undefined（实测 `res is not iterable`），探针就白跑一场。
async function PROBE(files) {
  const m = await import('/src/lib/verilog.ts');
  const out = [];
  for (const f of files) {
    let errs = null, threw = null;
    try { errs = m.validateModuleInterfaces([{ name: f.name, content: f.content }]); }
    catch (e) { threw = String((e && e.message) || e).slice(0, 160); }
    out.push({
      name: f.name,
      threw,
      n: errs ? errs.length : null,
      // 结构化字段今天到底有没有（V1 要新增的就是它）
      hasLineField: errs && errs.length ? Object.prototype.hasOwnProperty.call(errs[0], 'line') : null,
      keys: errs && errs.length ? Object.keys(errs[0]) : [],
      errors: (errs || []).map((e) => ({
        instanceName: e.instanceName, moduleName: e.moduleName,
        line: e.line === undefined ? null : e.line,
        detail: String(e.detail || '').slice(0, 120),
      })),
    });
  }
  return out;
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
    page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 180)));
    await UI.boot(page, URL);

    const files = [
      { name: 'test_counter.v', content: readFixture('test_counter.v') },
      { name: 'test_counter.v+BOM', content: readFixture('test_counter.v', { bom: true }) },
      { name: 'crossline.v', content: CROSSLINE },
      { name: 'r56_conflict_named.v', content: readFixture('r56_conflict_named.v') },
    ];
    // 先把夹具里"实例真身在第几行"算出来当对照表（判据要有独立证据，不能只信产品自己的数）
    for (const f of files) {
      const truth = f.content.split('\n')
        .map((l, i) => ({ i: i + 1, l }))
        .filter((x) => /^\s*\w+\s+\w+\s*\(/.test(x.l) || /^\s*\w+\s*$/.test(x.l))
        .slice(0, 40);
      console.log(`\n### ${f.name} 源码里像实例的前几行:`, JSON.stringify(truth.slice(0, 14)));
    }

    const res = await page.evaluate(PROBE, files);
    for (const r of res) {
      console.log(`\n===== ${r.name} =====`);
      console.log('  threw=', r.threw, ' 错误数=', r.n, ' 首条字段=', JSON.stringify(r.keys), ' 有 line 字段=', r.hasLineField);
      for (const e of r.errors) console.log(`   · ${e.moduleName} ${e.instanceName} line=${e.line}  detail=${e.detail}`);
    }
    await browser.close();
    console.log('\nEXIT 0');
    process.exit(0);
  } catch (e) {
    console.log('FATAL', String(e).slice(0, 400));
    try { await browser?.close(); } catch { }
    process.exit(2);
  } finally {
    try { server?.kill('SIGKILL'); } catch { }
  }
})();
