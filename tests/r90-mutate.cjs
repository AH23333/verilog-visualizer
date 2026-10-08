// R90 反向探针：三种臂各有自己的变异，**两种拼法各咬一次**（同一桩罪不许换个词就绕过）。
//
// 表格先声明：这一族是**静态形状闸门**，不带重编（不跑 vite、不碰 dist），所以格子之间没有
// "谁读了谁的旧产物"这一说；每格开头一律先还原到快照再打变异。
// 期望里刻意写了"该红的不止一格"的情形（MC 会让 [1] 也红——零处命中本来就该"不作数"），
// 那是设计如此，不是判据串味。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const F_SC = path.join(ROOT, 'src', 'components', 'SandboxCanvas.tsx');
const F_VP = path.join(ROOT, 'src', 'lib', 'vpath.ts');
const F_SS = path.join(ROOT, 'src', 'store', 'sandboxStore.ts');
const SNAP = new Map([F_SC, F_VP, F_SS].map((f) => [f, fs.readFileSync(f, 'utf8')]));
const J = (o) => JSON.stringify(o);

// 甲/乙两种手写形状都打在**同一颗锚点**上（`const dir = dirOf(cur);` 全仓唯一），
// 锚点不唯一就拒绝动手——打在错的那一处会被读成"判据有洞"。
const ANCHOR = '    const dir = dirOf(cur);';
const MUTS = [
  { id: 'MA-别的文件再手写一次（拼法甲）',
    why: '导出后又被就地手写 ⇒ [1] 必须红；主人和沙盒入口没动 ⇒ [2]/[3] 必须绿',
    edits: [[F_SC, ANCHOR, '    const dir = cur.name.includes(\'/\') ? cur.name.slice(0, cur.name.lastIndexOf(\'/\')) : \'\';']],
    red: ['1'], green: ['2', '3'], unver: [] },
  { id: 'MB-别的文件再手写一次（换个词：拼法乙）',
    why: '换拼法绕过是这一族真正的风险（初版闸门就只认甲，被乙绕过了 6 处）⇒ [1] 必须红',
    edits: [[F_SC, ANCHOR, '    const dir = cur.name.split(\'/\').slice(0, -1).join(\'/\');']],
    red: ['1'], green: ['2', '3'], unver: [] },
  { id: 'MC-主人不真干活（实现掏空）',
    why: '主人 `return \'\'` ⇒ [2] 必须红；全仓一处形状都扫不到 ⇒ [1] 按"零处不作数"也要红（设计如此）；[3] 只查入口与转发，必须绿',
    edits: [[F_VP, '  return path.includes(\'/\') ? path.slice(0, path.lastIndexOf(\'/\')) : \'\';', '  return \'\';']],
    red: ['1', '2'], green: ['3'], unver: [] },
  { id: 'MD-沙盒入口不再转发给主人',
    why: '`dirOfName` 自己算 ⇒ [3] 的"转发"必须红（这一臂专门拦"把消费者改回就地手写/直接删掉"）；主人没动 ⇒ [2] 绿；[1] 仍只命中主人 ⇒ 绿',
    edits: [[F_SS, '  return parentDir(name);', '  return name.includes(\'/\') ? name.slice(0, name.lastIndexOf(\'/\')) : \'\';']],
    red: ['1', '3'], green: ['2'], unver: [] },
];

const parse = (out) => {
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(PASS|FAIL|UNVERIFIED)\s+\[([\w.]+)\]/.exec(line);
    if (m && !map[m[2]]) map[m[2]] = m[1];
  }
  return map;
};
const summary = (out) => (/=====\s*结果:[^=]*=====/ .exec(out) || [''])[0].trim();

let verdict = 0;
const only = (() => { const i = process.argv.indexOf('--only'); return i < 0 ? null : process.argv[i + 1]; })();
try {
  for (const m of MUTS) {
    if (only && !m.id.startsWith(only)) continue;
    for (const [f] of SNAP) fs.writeFileSync(f, SNAP.get(f));   // ⚠ 每格开头先还原
    console.log(`\n########## ${m.id}\n  ${m.why}`);
    let usable = true;
    for (const [f, from, to] of m.edits) {
      const src = fs.readFileSync(f, 'utf8');
      const n = src.split(from).length - 1;
      if (n !== 1) { console.log(`  ★锚点在 ${path.basename(f)} 里命中 ${n} 次（要恰好 1）⇒ 这颗变异不作数，不动文件`); usable = false; break; }
      fs.writeFileSync(f, src.replace(from, to));
    }
    if (!usable) { console.log('  SKIPPED（锚点不唯一，跳过≠通过，也不计作咬住）'); verdict = 1; continue; }
    const r = spawnSync('node', ['tests/r90-single-owner-gate.cjs'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const map = parse(out);
    const keys = Object.keys(map).sort();
    if (keys.length === 0) {
      console.log('  ★没读到汇总行 ⇒ 不作数（不是绿）\n' + out.split(/\r?\n/).slice(0, 12).map((l) => '    |' + l).join('\n'));
      verdict = 1; continue;
    }
    const red = keys.filter((k) => map[k] === 'FAIL'), green = keys.filter((k) => map[k] === 'PASS');
    const hit = m.red.every((k) => map[k] === 'FAIL') && m.green.every((k) => map[k] === 'PASS')
      && m.red.concat(m.green).length === keys.length;
    console.log(`  逐格 ${keys.map((k) => `${k}:${{ PASS: '绿', FAIL: '红', UNVERIFIED: '未验' }[map[k]] || map[k]}`).join(' ')} | ${summary(out)}`);
    console.log(`  ${hit ? '咬住' : '★没咬住'}：该红 ${J(m.red)} 实际红 ${J(red)}｜该绿 ${J(m.green)} 实际绿 ${J(green)}｜不许绿 ${J(m.red)}`);
    if (!hit) { for (const line of out.split(/\r?\n/)) if (/^\s*(FAIL|UNVERIFIED)/.test(line)) console.log('    ' + line.trim().slice(0, 220)); verdict = 1; }
  }
  console.log('\n===== 反向探针汇总 =====');
  if (!verdict) console.log('  全部咬住');
} finally {
  let drift = 0;
  for (const [f, orig] of SNAP) {
    fs.writeFileSync(f, orig);
    if (fs.readFileSync(f, 'utf8') !== orig) { console.log(`  ★还原后仍不一致：${f}`); drift++; }
  }
  console.log(drift ? `  ★有 ${drift} 个文件还原失败，src 现在是脏的，必须手工核对` : `  已还原并逐字节比对一致（${SNAP.size} 个文件）`);
  if (drift) verdict = 1;
  process.exit(verdict);
}
