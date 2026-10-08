// R95 反向探针：**每格都不带重编**（闸门自己起 vite 读 src）。
//   MA 开关改走 setProp('signed')（钉 [7]+[3][4][5]）: signed 在 _unsupportedPropChanges ⇒ set 被回滚
//      ⇒ 三段读数全失败；静态臂当场红（"用 set 冒充修好"正是它存在的意义）
//   MB UnaryPlus 掉进 {in1,in2} 分支（钉 [6]）: 对象恒真 ⇒ 菜单出两颗操作数项
//   MC 恒写 A+B（不区分点的是哪颗）（钉 [3][4]）: AND 规则的**负读数**专咬它——
//      "只开 A"那一步就该仍是 0/仍 0100，恒开两脚会让负读数先红
//   （MD「摘掉重建后的 _changeSignal 重播」曾入表单跑：摘掉后 8 格全绿 ⇒ 那行是基于
//     "引擎不重评"误诊加的死代码——真因是 AND 规则，out=0 本来就对 ⇒ 行已从 src 删除，
//     这一格的证伪记录保留在台账；单跑证据：2026-10-06 r95-mutate --only MD）
//   ME 菜单标签不带现态（√ 恒无）（钉 [1b]）: 标签每次打开从器件现读才叫"反映现态"
// ⚠ 每格开头先还原；跑完逐字节比对；判定在 finally 里才 exit；锚点不唯一就拒绝动手。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const F_SB = path.join(ROOT, 'src', 'components', 'SandboxCanvas.tsx');
const SNAP = new Map([[F_SB, fs.readFileSync(F_SB, 'utf8')]]);
const J = (o) => JSON.stringify(o);

function replaceOnce(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) return `锚点在 ${path.basename(file)} 命中 ${n} 次（要恰好 1）⇒ 不动文件`;
  fs.writeFileSync(file, src.split(from).join(to));
  return null;
}

const MUTS = [
  { id: 'MA-开关改走 setProp（钉 [7]+[3][4][5]，[1b] 随红）',
    why: 'signed 列在 _unsupportedPropChanges（arith.mjs:39）⇒ 事后 set 被 digitaljs 回滚 ⇒ 三段读数全失败；静态臂当场红；[1b] 随红＝同一桩罪的第二个后果（现态没变，√ 自然不出）',
    apply: () => replaceOnce(F_SB,
      'reconfigureCell(cellId, { signed: next });\n            showToast(`${sgnName}',
      'setProp(cellId, \'signed\', next);\n            showToast(`${sgnName}'),
    red: ['1b', '3', '4', '5', '7'], green: ['1', '2', '6', '6b', '6c'], unver: [] },
  { id: 'MB-UnaryPlus 掉进对象分支（钉 [6]）',
    why: 'Arith11 的 signed 是布尔；给成 {in1,in2} 后菜单出两颗操作数项，且对象恒真会被 toBigInt 读成有符号（形状即语义）',
    apply: () => replaceOnce(F_SB,
      "if (type === 'Negation' || type === 'UnaryPlus') {",
      "if (type === 'Negation') {"),
    red: ['6'], green: ['1', '1b', '2', '3', '4', '5', '6b', '6c', '7'], unver: [] },
  { id: 'MC-恒写 A+B（钉 [3][4]）',
    why: '不区分点的是哪颗、两脚一起写 ⇒ AND 规则的负读数先红：只开 A 那一步就该仍是 0/0100',
    apply: () => replaceOnce(F_SB,
      '            next[k] = !next[k];\n            reconfigureCell(cellId, { signed: next });',
      '            next.in1 = true; next.in2 = true;\n            reconfigureCell(cellId, { signed: next });'),
    red: ['3', '4'], green: ['1', '1b', '2', '5', '6', '6b', '6c', '7'], unver: [] },
  { id: 'MF-fillx 开关改走 setProp（钉 [7]+[6b][6c]）',
    why: 'fillx 同在 _unsupportedPropChanges ⇒ set 被回滚 ⇒ √ 不出、电平不翻；静态臂当场红',
    apply: () => replaceOnce(F_SB,
      'reconfigureCell(cellId, { fillx: next });',
      "setProp(cellId, 'fillx', next);"),
    red: ['6b', '6c', '7'], green: ['1', '1b', '2', '3', '4', '5', '6'], unver: [] },
  { id: 'ME-标签恒不带 √（钉 [1b]）',
    why: '标签每次打开从器件现读才叫"反映现态"；写成恒空后 [1b] 当场红（[1] 的初始形状仍绿）',
    apply: () => replaceOnce(F_SB,
      "items.push({ label: `${sgnOf(k) ? '√ ' : ''}${sgnLabel[k]} 有符号`, action: () => {",
      "items.push({ label: `${sgnLabel[k]} 有符号`, action: () => {"),
    red: ['1b'], green: ['1', '2', '3', '4', '5', '6', '6b', '6c', '7'], unver: [] },
];

const parse = (out) => {
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(PASS|FAIL|UNVERIFIED)\s+\[([\w.]+)\]/.exec(line);
    if (m && !map[m[2]]) map[m[2]] = m[1];
  }
  return map;
};

let verdict = 0;
const only = (() => { const i = process.argv.indexOf('--only'); return i < 0 ? null : process.argv[i + 1]; })();
try {
  for (const m of MUTS) {
    if (only && !m.id.startsWith(only)) continue;
    for (const [f] of SNAP) fs.writeFileSync(f, SNAP.get(f));      // ⚠ 每格开头先还原
    console.log(`\n########## ${m.id}\n  ${m.why}`);
    const err = m.apply();
    if (err) { console.log(`  ★${err} —— 不作数（跳过≠通过）`); verdict = 1; continue; }
    const r = spawnSync('node', ['tests/r95-signed-toggle-gate.cjs'], { cwd: ROOT, encoding: 'utf8', timeout: 540000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const map = parse(out);
    const keys = Object.keys(map).sort();
    if (keys.length === 0) {
      console.log('  ★没读到逐臂判定 ⇒ 不作数（不是绿）\n' + out.split(/\r?\n/).slice(-10).map((l) => '    |' + l).join('\n'));
      verdict = 1; continue;
    }
    const red = keys.filter((k) => map[k] === 'FAIL');
    const green = keys.filter((k) => map[k] === 'PASS');
    const unver = keys.filter((k) => map[k] === 'UNVERIFIED');
    const want = (a) => (a || []).slice().sort();
    const hit = want(m.red).every((k) => map[k] === 'FAIL') && want(m.green).every((k) => map[k] === 'PASS')
      && J(unver) === J(want(m.unver)) && m.red.concat(m.green).concat(want(m.unver)).length === keys.length;
    console.log(`  逐格 ${keys.map((k) => `${k}:${{ PASS: '绿', FAIL: '红', UNVERIFIED: '未验' }[map[k]] || map[k]}`).join(' ')}`);
    console.log(`  ${hit ? '咬住' : '★没咬住'}：该红 ${J(want(m.red))} 实际红 ${J(red)}｜该未验 ${J(want(m.unver))} 实际未验 ${J(unver)}｜该绿 ${J(want(m.green))} 实际绿 ${J(green)}`);
    if (!hit) { for (const line of out.split(/\r?\n/)) if (/^\s*(FAIL|UNVERIFIED|\[现场|FATAL)/.test(line)) console.log('    ' + line.trim().slice(0, 220)); verdict = 1; }
  }
  console.log('\n===== 反向探针汇总 =====');
  if (!verdict) console.log('  全部咬住');
} finally {
  let drift = 0;
  for (const [f, orig] of SNAP) {
    fs.writeFileSync(f, orig);
    if (fs.readFileSync(f, 'utf8') !== orig) { console.log(`  ★还原后仍不一致：${f}`); drift++; }
  }
  console.log(drift ? `  ★有 ${drift} 个文件还原失败，src 现在是脏的` : `  已还原并逐字节比对一致（${SNAP.size} 个文件）`);
  if (drift) verdict = 1;
  process.exit(verdict);
}
