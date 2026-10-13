// R135 反向探针（导出成品的变异验证）：逐颗把 `buildStandaloneSvg` 的实现改坏，看 r135 闸门
// **该红的那几格有没有红**、别的格有没有保持绿。判据只认闸门逐格三态（PASS/FAIL/UNVERIFIED），
// 每轮开头先还原（⚠ 跑台架期间不要碰 src/lib/exportUtils.ts，还原会把文件贴回快照那一版）。
//
// 用法：node tests/r135-mutate.cjs            全量 4 颗
//       node tests/r135-mutate.cjs --check    只验锚点唯一性（不改文件）
//       node tests/r135-mutate.cjs --only MA  只跑指定变异
//
// 四颗变异都造的是**判据定义的那个形状**（⛔ 摘消费者制造空转）：
//   MA 底色退回写死 #ffffff        → [7] 底色不再与屏幕配对；[3] 浅色字压白底亮度差只剩 24
//   MB 取景退回带平移的包围盒      → [4] 原点与模型坐标系错开；[1] 缩放态下宽高也对不上
//   MC 不内联计算样式              → [3] 文件里没有文字颜色（读回默认），配对失败
//   MD 不写 viewBox                → [1] 没有可配对的框；[4] 原点判据无从成立
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const F = path.join(ROOT, 'src/lib/exportUtils.ts');
const ORIG = fs.readFileSync(F, 'utf8');

const MUTS = [
  {
    id: 'MA-底色退回写死白',
    why: '深色主题的器件填充本就是近黑的 rgb(35,40,48)：底色写死 #ffffff ⇒ [7]（底色==屏幕）必须红，'
      + '而浅色文字 rgb(228,228,236) 压白底亮度差只剩 24 ⇒ [3] 也必须红',
    from: "  bg.setAttribute('fill', exportBackground(svgEl));   // ⛔ 写死 #ffffff：深色主题下＝黑块压白底",
    to: "  bg.setAttribute('fill', '#ffffff'); // 变异 MA：底色退回写死白",
    expect: { red: ['3', '7'], green: ['1', '2', '4', '5', '6'] },
  },
  {
    id: 'MB-取景退回带平移的包围盒',
    why: '摘掉视口层 transform 却用 svg.getBBox()（**含视口平移**）开 viewBox ⇒ [4] 的原点配对必须红。'
      + '⚠ [1] 该绿：那一格只比**宽高**，而实测两种包围盒的宽高相同（差 40px 的 pad 落在 ±35% 内），'
      + '只有原点差 18px ⇒ 尺寸归 [1]、原点归 [4]，两颗证人分工不同，⛔ 把 [1] 也写成"该红"是我猜错（读数：viewBox=[10,10,…] 而模型原点 12−20=−8）',
    from: '  const b = box && box.w > 0 && box.h > 0 ? box : modelContentBox(svgEl);',
    to: '  let b: { x: number, y: number, w: number, h: number } | null = null;'
      + ' try { const bb0 = svgEl.getBBox(); b = { x: bb0.x, y: bb0.y, w: bb0.width, h: bb0.height }; } catch { b = null; } // 变异 MB：混用坐标系',
    expect: { red: ['4'], green: ['1', '2', '3', '5', '6', '7'] },
  },
  {
    id: 'MC-不内联计算样式',
    why: '文件里没有颜色（回到"脱离本仓样式表就一片黑"那一版）⇒ [3] 的文字颜色配对必须红；'
      + '底色仍由 exportBackground 给出 ⇒ [7] 仍该绿（这格不是靠 [3] 陪跑的）',
    from: "      if (v && d.tagName.toLowerCase() !== 'style') { try { d.style.setProperty(p, v); } catch { /* 个别属性不接受则跳过 */ } }",
    to: '      if (false && v) { try { d.style.setProperty(p, v); } catch { /* 变异 MC：不内联 */ } }',
    expect: { red: ['3'], green: ['1', '2', '4', '5', '6', '7'] },
  },
  {
    id: 'MD-不写 viewBox',
    why: '不按内容取景 ⇒ [1]（viewBox 与 paper 包围盒成对）与 [4]（原点＝模型原点−pad）都必须红；'
      + '文字/底色/JSON/网表四格与取景无关 ⇒ 全该绿',
    from: "    clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);",
    to: '    /* 变异 MD：不写 viewBox（宽高也随之失去意义） */',
    expect: { red: ['1', '4'], green: ['2', '3', '5', '6', '7'] },
  },
];

function apply(m) {
  const parts = ORIG.split(m.from);
  if (parts.length !== 2) throw new Error(`锚点 ${parts.length - 1} 次（要恰好 1 次）：${m.id} ⟵ ${m.from.slice(0, 46)}`);
  fs.writeFileSync(F, parts.join(m.to));
}
const restore = () => fs.writeFileSync(F, ORIG);

function parse(out) {
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(PASS|FAIL|UNVERIFIED)\s+\[([\w]+)\]\s*(.*)$/.exec(line);
    if (m && !map[m[2]]) map[m[2]] = { verdict: m[1], detail: m[3].slice(0, 110) };
  }
  return { map, fatal: /FATAL/.test(out), summary: (/=====\s*结果[^\n]*/.exec(out) || [''])[0] };
}

const checkOnly = process.argv.includes('--check');
const onlyArg = (/--only[= ]([\w,]+)/.exec(process.argv.join(' ')) || [])[1];
const RUN = onlyArg ? MUTS.filter((m) => onlyArg.split(',').some((k) => m.id.startsWith(k))) : MUTS;

if (checkOnly) {
  let bad = 0;
  for (const m of RUN) {
    const n = ORIG.split(m.from).length - 1;
    console.log(n === 1 ? `  锚点 OK 唯一  ${m.id} ⟵ ${m.from.slice(0, 46)}` : `  ★锚点 ${n} 次  ${m.id} ⟵ ${m.from.slice(0, 46)}`);
    if (n !== 1) bad++;
  }
  process.exit(bad ? 1 : 0);
}

const runGate = () => {
  try {
    return execFileSync('node', [path.join(__dirname, 'r135-svg-export-gate.cjs')],
      { windowsHide: true, encoding: 'utf8', timeout: 600000 });
  } catch (e) { return String(e.stdout || '') + '\n[exit!=0]'; }
};

let misses = 0;
try {
  for (const m of RUN) {
    restore();
    apply(m);
    console.log(`\n########## ${m.id} —— ${m.why}`);
    const out = runGate();
    const { map, fatal, summary } = parse(out);
    console.log(`  闸门汇总：${summary || '(没读到汇总)'}${fatal ? ' ｜含 FATAL' : ''}`);
    const redOk = m.expect.red.every((s) => map[s] && map[s].verdict === 'FAIL');
    const greenOk = m.expect.green.every((s) => map[s] && map[s].verdict === 'PASS');
    if (redOk && greenOk) console.log(`  证人成立：红 [${m.expect.red}] 绿 [${m.expect.green}]`);
    else {
      misses++;
      console.log('  ★证人不成立，逐格读数：' + JSON.stringify(map).slice(0, 900));
    }
  }
  restore();
  console.log('\n########## 还原后基线复跑（应全绿）');
  const base = runGate();
  const { summary } = parse(base);
  const green = !/\bFAIL\b/.test(base) && /结果: \d+ pass, 0 fail/.test(base);
  console.log(green ? `  基线复绿 ✓ ${summary}` : `  ★基线没有复绿（还原不完整或另有问题）${summary}`);
  if (!green) misses++;
} finally {
  restore();
  const drift = fs.readFileSync(F, 'utf8') !== ORIG;
  console.log(drift ? '  ★还原后字节不一致：exportUtils.ts 现在是脏的' : '  已还原并逐字节比对一致（exportUtils.ts）');
  if (drift) misses++;
}
console.log(`\n===== 变异台架结果：${RUN.length - misses}/${RUN.length} 证人成立 =====`);
process.exit(misses > 0 ? 1 : 0);
