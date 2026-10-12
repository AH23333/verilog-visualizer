// R121/R123 反向探针（变异验证）：逐颗把注释/循环依赖功能的实现改坏，看对应闸门
// **该红的那几格有没有红**、别的格有没有保持绿。判据只认闸门汇总的逐格三态
// （PASS / FAIL / UNVERIFIED），每轮跑完先还原文件，最后原样重跑一遍确认基线。
//
// ⚠ 跑台架期间不要碰被变异的源文件（还原会把文件贴回快照那一版）。
// 用法：node tests/r121-mutate.cjs            全量 4 颗
//       node tests/r121-mutate.cjs --check    只验锚点唯一性（不改文件）
//       node tests/r121-mutate.cjs --only M1  只跑指定变异
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ORIG = {
  'annotationCell': fs.readFileSync(path.join(ROOT, 'src/lib/annotationCell.ts'), 'utf8'),
  'SandboxCanvas': fs.readFileSync(path.join(ROOT, 'src/components/SandboxCanvas.tsx'), 'utf8'),
  'subcircuitView': fs.readFileSync(path.join(ROOT, 'src/lib/subcircuitView.ts'), 'utf8'),
  'sandboxLoad': fs.readFileSync(path.join(ROOT, 'src/lib/sandboxLoad.ts'), 'utf8'),
};
const PATHS = {
  annotationCell: path.join(ROOT, 'src/lib/annotationCell.ts'),
  SandboxCanvas: path.join(ROOT, 'src/components/SandboxCanvas.tsx'),
  subcircuitView: path.join(ROOT, 'src/lib/subcircuitView.ts'),
  sandboxLoad: path.join(ROOT, 'src/lib/sandboxLoad.ts'),
};

const MUTS = [
  {
    id: 'M1-换行被砍', file: 'annotationCell',
    why: '便签文本不再按盒宽折行（wrapNoteText 被绕开）——[4] 自动换行必须红',
    from: "const lines = text ? wrapNoteText(text, w - pad * 2, renderedPx) : [];",
    to: "const lines = text ? [text] : [];",
    gate: 'r121-annotation-gate', expect: { red: ['4'], green: ['1', '2', '3'] },
  },
  {
    id: 'M2-自嵌套拦截全断', file: 'SandboxCanvas',
    why: '自嵌套有双防线（显式拦截 + findPartCycle 兜底）——两层的组合变异都断，[2][3] 必须红',
    from: "if (gate.name === curPartName) {",
    to: "if (false && gate.name === curPartName) {",
    extra: { from: "if (cyc && cyc.includes(curPartName)) {", to: "if (false && cyc && cyc.includes(curPartName)) {" },
    gate: 'r123-cycle-gate', expect: { red: ['2', '3'], green: ['1', '4', '5', '6'] },
  },
  {
    id: 'M3-展开断环全断', file: 'subcircuitView',
    why: '断环同样是双防线（回边改名 + 空壳占位）——两层的组合变异都断 ⇒ 平铺表缺项，[1] 必须红',
    from: 'const cyclic = chain.has(name);',
    to: 'const cyclic = false && chain.has(name);',
    extra: { from: '} else if (!flat[defName]) {', to: '} else if (false) {' },
    gate: 'r123-cycle-gate', expect: { red: ['1'], green: ['4', '5', '6'] },
  },
  {
    id: 'M4-存档丢注释文字', file: 'sandboxLoad',
    why: 'label 回读是撤销与重开的共用链路：重开内容全空 **且** 撤销恢复为空——[2][9] 必须红',
    from: "if (c.label != null) try { cell.set('label', c.label); } catch {}",
    to: 'if (false && c.label != null) try { cell.set(\'label\', c.label); } catch {}',
    gate: 'r121-annotation-gate', expect: { red: ['2', '9'], green: ['1', '5', '6'] },
  },
];

/** 组合变异：主替换 + 可选 extra 第二替换（对同一文件先后应用，双防线一起断） */
function apply(m) {
  const segs = [m, ...(m.extra ? [m.extra] : [])];
  let cur = ORIG[m.file];
  for (const seg of segs) {
    const parts = cur.split(seg.from);
    if (parts.length !== 2) throw new Error(`锚点 ${parts.length - 1} 次（要恰好 1 次）：${m.id} ⟵ ${seg.from.slice(0, 50)}`);
    cur = parts.join(seg.to);
  }
  fs.writeFileSync(PATHS[m.file], cur);
}
const restoreAll = () => { for (const k of Object.keys(ORIG)) fs.writeFileSync(PATHS[k], ORIG[k]); };

/** 读闸门逐格三态 */
function parse(out) {
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(PASS|FAIL|UNVERIFIED)\s+\[([\w]+)\]\s*(.*)$/.exec(line);
    if (m && !map[m[2]]) map[m[2]] = { verdict: m[1], detail: m[3].slice(0, 120) };
  }
  return { map, fatal: /FATAL/.test(out), summary: (/=====\s*结果[^\n]*/.exec(out) || [''])[0] };
}

let bad = 0;
const checkOnly = process.argv.includes('--check');
const onlyArg = (/--only[= ]([\w,]+)/.exec(process.argv.join(' ')) || [])[1];
const RUN = onlyArg ? MUTS.filter((m) => onlyArg.split(',').some((k) => m.id.startsWith(k))) : MUTS;

if (checkOnly) {
  for (const m of RUN) {
    // --check：模拟整条替换链（主 + extra），验每一段锚点在"前序替换后的文本"里恰好一次
    let cur = ORIG[m.file];
    const segs = [m, ...(m.extra ? [m.extra] : [])];
    let ok = true;
    for (const seg of segs) {
      const n = cur.split(seg.from).length - 1;
      console.log(n === 1 ? `  锚点 OK 唯一  ${m.id} ⟵ ${seg.from.slice(0, 46)}` : `  ★锚点 ${n} 次  ${m.id} ⟵ ${seg.from.slice(0, 46)}`);
      if (n !== 1) ok = false;
      cur = cur.split(seg.from).join(seg.to);
    }
    if (!ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}

const runGate = (gate) => {
  try {
    return execFileSync('node', [path.join(__dirname, gate + '.cjs')], { encoding: 'utf8', timeout: 600000 });
  } catch (e) { return String(e.stdout || '') + '\n[exit!=0]'; }
};

let reds = 0;
try {
  for (const m of RUN) {
    restoreAll();
    apply(m);
    console.log(`\n########## ${m.id} —— ${m.why}`);
    const out = runGate(m.gate);
    const { map } = parse(out);
    const redOk = (m.expect.red || []).every((s) => map[s] && map[s].verdict === 'FAIL');
    const greenOk = (m.expect.green || []).every((s) => map[s] && map[s].verdict === 'PASS');
    if (redOk && greenOk) console.log(`  证人成立：红 [${m.expect.red}] 绿 [${m.expect.green}]`);
    else { reds++; console.log(`  证人不成立！读数：` + JSON.stringify(map).slice(0, 600)); }
  }
  restoreAll();
  console.log('\n########## 还原后基线复跑（应全绿）');
  const baseOut = runGate('r121-annotation-gate');
  const baseGreen = !/\bFAIL\b/.test(baseOut) && /结果: \d+ pass, 0 fail/.test(baseOut);
  console.log(baseGreen ? '  基线复绿 ✓' : '  ★基线没有复绿——还原不完整或还原后还有别的问题！');
  if (!baseGreen) reds++;
} finally {
  restoreAll();
}
console.log(`\n===== 变异台架结果：${RUN.length - reds}/${RUN.length} 证人成立 =====`);
process.exit(reds > 0 ? 1 : 0);
