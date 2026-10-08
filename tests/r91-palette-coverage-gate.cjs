// R91 静态对账闸门：**元件库必须覆盖 yosys2digitaljs 映射表能产出的每一种器件类型**。
//
// 为什么钉这个（不是清单洁癖）：编译出来的电路一旦含某颗"元件库没接"的器件，症状是
// 「复制到沙盒后画布上有这颗，但用户右键/面板里根本放不出来、也没法新建同类实例」——
// 这正是用户清单里"尽可能发挥 digitaljs 全部功能"那一格的反面。
//
// 判据不手数清单，两边都从现场算：
//   A ＝ `node_modules/yosys2digitaljs/src/core.ts` 里 `gate_subst` 这张表的**值侧**（映射目标）
//   B ＝ `src/components/SandboxCanvas.tsx` 里那批 `*_TYPES` 数组 ∪ `P('X')` 直列项
//   断言 A \ B ＝ ∅。
// ⇒ 以后升 yosys2digitaljs 若多出一颗新目标类，这颗闸门会自己红，而不是等用户撞上去。
//
// 现场读数（2026-10-06，批次 R91 之前）：A 48 种、B 49 种，差集**恰好一颗** `UnaryPlus`
// （yosys 的 `$pos`，`assign y = +a;`）⇒ 已补进 `ARITH_TYPES`。
// B \ A ＝ {Display7, MuxSparse}（沙盒自备、编译不产出，刻意的）；
// `Button` 在 `IO_TYPES` 里继续能**渲染**（历史存档），但刻意不放进元件库——理由写在源码注释：
// 它的功能与「输入引脚」完全重叠。
//
// ⛔ 三态：依赖源码读不到／锚点找不到／两侧数量低于下界 ⇒ [1] 一律 **UNVERIFIED**，
//   不许把"没扫到"读成"没差集"（扫描面少一处的 0 里没有任何信息）。
//   想验这一格：`R91_CORE_TS=不存在的路径 node tests/r91-palette-coverage-gate.cjs`。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CORE = process.env.R91_CORE_TS || path.join(ROOT, 'node_modules/yosys2digitaljs/src/core.ts');
const SBX = path.join(ROOT, 'src/components/SandboxCanvas.tsx');
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const unverdict = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n}${d ? ' — ' + d : ''}`); };

// ---- A：映射表的目标类型（从依赖的源码现场算，不抄清单）----
let targets = null, whyA = '';
const coreSrc = fs.existsSync(CORE) ? fs.readFileSync(CORE, 'utf8') : null;
if (!coreSrc) whyA = `依赖源码不在盘上：${CORE}`;
else {
  const a = coreSrc.indexOf('const gate_subst');
  const b = coreSrc.indexOf('const techmap_dff_kinds');
  if (a < 0 || b < 0 || b <= a) whyA = `找不到 gate_subst 那张表（a=${a} b=${b}）——上游形状变了`;
  else {
    targets = new Set();
    for (const m of coreSrc.slice(a, b).matchAll(/,\s*'([A-Za-z_0-9]+)'\]/g)) targets.add(m[1]);
    if (targets.size < 40) whyA = `只算出 ${targets.size} 种目标类（下界 40）——正则或表名飘了`;
  }
}

// ---- B：元件库的 type（*_TYPES 数组 ∪ P('X') 直列）----
let pal = null, whyB = '', declCount = 0;
const sbSrc = fs.existsSync(SBX) ? fs.readFileSync(SBX, 'utf8') : null;
if (!sbSrc) whyB = '读不到 SandboxCanvas.tsx';
else {
  pal = new Set();
  const declRe = /const ([A-Z_]+_TYPES)\s*(?::[^=]+)?=\s*\[([\s\S]*?)\];/g;
  let m;
  while ((m = declRe.exec(sbSrc))) { declCount++; for (const q of m[2].matchAll(/'([A-Za-z0-9]+)'/g)) pal.add(q[1]); }
  for (const q of sbSrc.matchAll(/P\('([A-Za-z0-9]+)'/g)) pal.add(q[1]);
  if (declCount < 10) whyB = `只扫到 ${declCount} 颗 *_TYPES 数组（下界 10）——声明形状变了`;
  else if (pal.size < 40) whyB = `元件库只算出 ${pal.size} 种 type（下界 40）`;
}

if (whyA || whyB) {
  unverdict('[1] 元件库覆盖 yosys2digitaljs 映射表的每一种目标类',
    `不作数：${[whyA && `A侧: ${whyA}`, whyB && `B侧: ${whyB}`].filter(Boolean).join(' ｜ ')}`
    + (targets && pal ? `（当时的差集=${J([...targets].filter((t) => !pal.has(t)))}）` : ''));
} else {
  const gap = [...targets].filter((t) => !pal.has(t)).sort();
  const extra = [...pal].filter((t) => !targets.has(t)).sort();
  console.log(`  [现场] A 映射表目标 ${targets.size} 种 ｜ B 元件库 type ${pal.size} 种（来自 ${declCount} 颗数组＋P() 直列）`);
  (gap.length === 0 ? ok : bad)(
    '[1] 元件库覆盖 yosys2digitaljs 映射表的每一种目标类',
    gap.length ? `编译能产出、元件库放不出：${J(gap)}` : `全部覆盖（B 比 A 多 ${extra.length} 颗＝沙盒自备：${J(extra)}）`);
}

// ---- [2] 反向臂：补进数组的那颗要真的被元件库**展出来** ----
// 只把它塞进某个 `*_TYPES` 数组而 PALETTE 不展开那个数组 ＝ 用户依然看不见，[1] 却是绿的。
if (!sbSrc) unverdict('[2] 反向臂：运算那一组确实展开了 ARITH_TYPES（不是只加进一个没人用的数组）', '读不到 SandboxCanvas.tsx');
else {
  const inArith = /const ARITH_TYPES[^=]*=\s*\[[^\]]*'UnaryPlus'[^\]]*\]/.test(sbSrc);
  const spread = /ARITH_TYPES\.map\(\s*t\s*=>\s*P\(\s*t\s*\)\s*\)/.test(sbSrc);
  (inArith && spread ? ok : bad)(
    '[2] 反向臂：运算那一组确实展开了 ARITH_TYPES（不是只加进一个没人用的数组）',
    `UnaryPlus 在 ARITH_TYPES=${inArith} ｜ PALETTE 展开 ARITH_TYPES=${spread}`);
}

console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unver} 未验证 =====`);
process.exit(fail > 0 ? 1 : 0);
