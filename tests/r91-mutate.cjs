// R91 反向探针（静态对账闸门，**不带重编**：不起 vite，只动一颗 src 文件与一份临时副本）。
//   MA 把刚补的 UnaryPlus 从 ARITH_TYPES 摘掉     → [1] 必须红（差集又出现一颗）；[2] 同红（那句"在数组里"也不成立）＝设计如此
//   MB 只拆掉 PALETTE 对 ARITH_TYPES 的展开        → [2] 必须红而 [1] 必须绿 —— 这一对就是"数组里加了、界面没展出来"那种假绿
//   MC 上游那张表改了名（用临时副本演）            → [1] 必须落 **UNVERIFIED**（"扫不到"永远不许读成"没差集"）；[2] 仍绿
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const F_SB = path.join(ROOT, 'src', 'components', 'SandboxCanvas.tsx');
const SNAP = new Map([[F_SB, fs.readFileSync(F_SB, 'utf8')]]);
const J = (o) => JSON.stringify(o);
const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');
const TMP_CORE = path.join(os.tmpdir(), 'r91-core-renamed.ts');

function replaceOnce(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) return `锚点在 ${path.basename(file)} 命中 ${n} 次（要恰好 1）⇒ 不动文件`;
  fs.writeFileSync(file, src.split(from).join(to));
  return null;
}

const run = (env) => {
  const r = spawnSync('node', ['tests/r91-palette-coverage-gate.cjs'],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
  const out = (r.stdout || '') + (r.stderr || '');
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(PASS|FAIL|UNVERIFIED)\s+\[([\w.]+)\]/.exec(line);
    if (m && !map[m[2]]) map[m[2]] = m[1];
  }
  return { out, map };
};

const MUTS = [
  { id: 'MA-摘掉 UnaryPlus（回到"编译能产出、元件库放不出"）',
    why: '[1] 必须红：映射表的 `$pos → UnaryPlus` 又没人接；[2] **同红**＝"它在 ARITH_TYPES 里"这一半也不成立（设计如此，不是串味）',
    apply: () => replaceOnce(F_SB, `'Power', 'Negation', 'UnaryPlus'];`, `'Power', 'Negation'];`),
    red: ['1', '2'], unver: [], green: [] },
  { id: 'MB-元件库不再展开运算那一组',
    why: '[2] 必须红、[1] 必须绿：数组里还在 ⇒ 对账臂看不见这件事，只有"展没展出来"那臂抓得到 ⇒ 这一对不许互相代替',
    apply: () => replaceOnce(F_SB, `items: ARITH_TYPES.map(t => P(t))`, `items: []`),
    red: ['2'], unver: [], green: ['1'] },
  { id: 'MC-上游那张表改了名（临时副本演）',
    why: '扫描面少一处的 0 里没有任何信息 ⇒ [1] 只能落 UNVERIFIED（不作数），⛔ 不许读成"没差集所以绿"',
    apply: () => {
      const core = fs.readFileSync(path.join(ROOT, 'node_modules/yosys2digitaljs/src/core.ts'), 'utf8');
      const n = core.split('const gate_subst').length - 1;
      if (n !== 1) return `上游表名在 core.ts 命中 ${n} 次（要恰好 1）`;
      // ⚠ 这颗变异第一版改成 `gate_subst_改名为` —— `indexOf('const gate_subst')` **照样命中**
      //   （前缀还在），于是闸门算出 48 种、打了绿，看着像"三态那一臂没证人"，其实是变异没造出那个形状。
      //   要让锚点真的不在，得换成完全不含这几个字的表名。
      fs.writeFileSync(TMP_CORE, core.replace('const gate_subst', 'const upstream_table_renamed'));
      return null;
    }, env: () => ({ R91_CORE_TS: TMP_CORE }),
    red: [], unver: ['1'], green: ['2'] },
];

let verdict = 0;
const only = (() => { const i = process.argv.indexOf('--only'); return i < 0 ? null : process.argv[i + 1]; })();
try {
  for (const m of MUTS) {
    if (only && !m.id.startsWith(only)) continue;
    for (const [f] of SNAP) fs.writeFileSync(f, SNAP.get(f));      // ⚠ 每格开头先还原
    console.log(`\n########## ${m.id}\n  ${m.why}`);
    const err = m.apply();
    if (err) { console.log(`  ★${err} —— 这颗不作数（跳过≠通过）`); verdict = 1; continue; }
    const { out, map } = run(m.env ? m.env() : {});
    const keys = Object.keys(map).sort();
    if (keys.length === 0) {
      console.log('  ★没读到汇总行 ⇒ 不作数（不是绿）\n' + out.split(/\r?\n/).slice(0, 14).map((l) => '    |' + l).join('\n'));
      verdict = 1; continue;
    }
    const red = keys.filter((k) => map[k] === 'FAIL'), unver = keys.filter((k) => map[k] === 'UNVERIFIED');
    const green = keys.filter((k) => map[k] === 'PASS');
    const hit = m.red.every((k) => map[k] === 'FAIL') && m.green.every((k) => map[k] === 'PASS')
      && m.unver.every((k) => map[k] === 'UNVERIFIED')
      && m.red.concat(m.green, m.unver).length === keys.length;
    console.log(`  逐格 ${keys.map((k) => `${k}:${{ PASS: '绿', FAIL: '红', UNVERIFIED: '未验' }[map[k]] || map[k]}`).join(' ')} | ${(/=====\s*结果:[^=]*=====/ .exec(out) || [''])[0].trim()}`);
    console.log(`  ${hit ? '咬住' : '★没咬住'}：该红 ${J(m.red)} 实际红 ${J(red)}｜该未验 ${J(m.unver)} 实际未验 ${J(unver)}｜该绿 ${J(m.green)} 实际绿 ${J(green)}`);
    if (!hit) { for (const line of out.split(/\r?\n/)) if (/^\s*(FAIL|UNVERIFIED|\s+★|\[现场)/.test(line)) console.log('    ' + line.trim().slice(0, 220)); verdict = 1; }
  }
  console.log('\n===== 反向探针汇总 =====');
  if (!verdict) console.log('  全部咬住');
} finally {
  let drift = 0;
  for (const [f, orig] of SNAP) {
    fs.writeFileSync(f, orig);
    if (fs.readFileSync(f, 'utf8') !== orig) { console.log(`  ★还原后仍不一致：${f}`); drift++; }
  }
  try { fs.existsSync(TMP_CORE) && fs.unlinkSync(TMP_CORE); } catch { }
  console.log(drift ? `  ★有 ${drift} 个文件还原失败，src 现在是脏的` : `  已还原并逐字节比对一致（${SNAP.size} 个文件，临时副本已删）`);
  if (drift) verdict = 1;
  process.exit(verdict);
}
