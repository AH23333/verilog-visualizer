// R94 反向探针：**每格都不带重编**（闸门自己起 vite，直接读 src，不存在旧产物问题）。
//   设计意图（哪一格该红、哪些必须保持绿）：
//   MA 弹窗回显失效（初始档位不看器件）      → 红 [1][1b]；[3][4][5][7] 落「未验」（极性下拉禁用＝翻不了面；[7] 钉的正是翻面之后的存档形状，那个状态不存在）；[2][6][8][9] 绿
//   MB 取消的脚留 `键: undefined`（键还在）    → 红 [2][3][6][7]；[4] 落「未验」——实测（2026-10-06 台架）：七个键全留在档里且被读回成 false，
//      未连的 set/clr 脚把 x 串进 Q（apply_sr 的 mask 变 x），Q 全 x ⇒ 读不到＝不作数，不是绿
//   MC 低有效写成数值 0/1                     → 红 [3][7][8]（字形＋存档形状＋静态句式），**[4] 必须绿**（语义 `? 1 : -1` 没变 ⇒ 证明 [4] 与 [3] 各有射程）
//   MD 重建后不把连线接回去                   → 红 [5]，[4] 落「未验」（激励读不到＝不作数，不是通过）
//   ME reconfigureCell 不做 merge（extra 直传）→ 红 [6][7]（部分参数重建把其余构造期参数抹了）
//   MF deviceParams 名单里去掉 'bits'          → 红 [7] only（事后 set 被 digitaljs 回滚那条路）
//   MG 同 MB 但换一种措辞（Object.assign 留键）→ 红 [2][3][6][7]，**另加 [8]**：赋值处数变成 0，[8] 的非空洞下界当场红（那格判据自己干了活）
// ⚠ 每格开头先还原；跑完逐字节比对；判定在 finally 里才 exit；锚点不唯一就拒绝动手。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const F_MODAL = path.join(ROOT, 'src', 'components', 'DffPortsModal.tsx');
const F_SB = path.join(ROOT, 'src', 'components', 'SandboxCanvas.tsx');
const F_DP = path.join(ROOT, 'src', 'lib', 'deviceParams.ts');
const SNAP = new Map([[F_MODAL, fs.readFileSync(F_MODAL, 'utf8')],
[F_SB, fs.readFileSync(F_SB, 'utf8')],
[F_DP, fs.readFileSync(F_DP, 'utf8')]]);
const J = (o) => JSON.stringify(o);

function replaceOnce(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) return `锚点在 ${path.basename(file)} 命中 ${n} 次（要恰好 1）⇒ 不动文件`;
  fs.writeFileSync(file, src.split(from).join(to));
  return null;
}

const MUTS = [
  { id: 'MA-弹窗初始档位不看器件（钉 [1][1b]）',
    why: '把回显用的 hasKey(pol0, …) 换成恒 false ⇒ 首次打开与二次打开都不回显 ⇒ [1][1b] 红；极性下拉因此保持禁用，翻面做不了 ⇒ [3][4][5] 落「未验」（闸门按三态处理，不再 FATAL）；后面填的都是显式动作 ⇒ [2][6][7][8][9] 绿',
    apply: () => replaceOnce(F_MODAL, '[c.key, hasKey(pol0, c.key)]', '[c.key, false]'),
    red: ['1', '1b'], green: ['2', '6', '8', '9'], unver: ['3', '4', '5', '7'] },
  { id: 'MB-取消的脚留键（值 undefined）（钉 [2][4]）',
    why: 'digitaljs 按「键在不在」建端口（dff.mjs:42-70）⇒ 留 `clock: undefined` 等于 clk 脚还在 ⇒ [2] 红；而 clk 一在，没有边沿就不采样 ⇒ [4] 也红',
    apply: () => replaceOnce(F_MODAL,
      'for (const c of CONTROLS) if (on[c.key]) polarity[c.key] = high[c.key];',
      'for (const c of CONTROLS) polarity[c.key] = on[c.key] ? high[c.key] : undefined;'),
    red: ['2', '3', '6', '7'], green: ['1', '1b', '5', '8', '9'], unver: ['4'] },
  { id: 'MC-低有效写成数值 0／高有效写成 1（钉 [3][7]，[4] 必须绿）',
    why: '引擎 `pol = v ? 1 : -1` 认 0 也认 false ⇒ 电学照旧（[4] 绿）；但 base.mjs:139 要 `=== false` 才画横线、存档形状也不再是布尔 ⇒ [3][7] 红，静态那格 [8] 按句式也红。这一格的存在就是证明"字形"与"语义"两条臂各有射程',
    apply: () => replaceOnce(F_MODAL,
      'if (on[c.key]) polarity[c.key] = high[c.key];',
      'if (on[c.key]) polarity[c.key] = high[c.key] ? 1 : 0;'),
    red: ['3', '7', '8'], green: ['1', '2', '6', '9'], unver: ['4'] },
  { id: 'MD-重建后不把连线接回去（钉 [5]，[4] 应落未验）',
    why: 'id／位置照旧但连线归零 ⇒ [5] 红；[4] 的激励读不到（Q 恒 x）⇒ 必须报「未验」而不是绿。⚠ 锚点要带到下一行：`for (const spec of linkSpecs) {` 在本文件里有两处（另一处是粘贴那条路）',
    apply: () => replaceOnce(F_SB,
      '    for (const spec of linkSpecs) {\n      if (!spec.otherId || !spec.port) continue;',
      '    for (const spec of ([] as any[])) {\n      if (!spec.otherId || !spec.port) continue;'),
    red: ['5'], green: ['1', '1b', '2', '3', '6', '7', '8', '9'], unver: ['4'] },
  { id: 'ME-reconfigureCell 不做 merge（钉 [6][7]）',
    why: '回到"extra 直传"⇒ 菜单改位宽那一步把 initial／srst_value 抹回默认 ⇒ [6] 红，[7] 跟着红（同一桩罪的存档后果）',
    apply: () => replaceOnce(F_SB,
      'const merged: Record<string, any> = { ...ctorParams(old), ...extra };',
      'const merged: Record<string, any> = { ...extra };'),
    red: ['6', '7'], green: ['1', '1b', '2', '3', '4', '5', '8', '9'], unver: [] },
  { id: 'MF-构造期名单里去掉 bits（钉 [7]）',
    why: "bits 不在名单里 ⇒ 载入靠事后 `cell.set('bits')`，而 Dff 把它列进 _unsupportedPropChanges 被回滚 ⇒ 6 位寄存器重开变 1 位 ⇒ [7] 红；[9] 静态名单臂也当场红（bits 恰好不在名单里）—— 同一桩罪的两个后果。⚠ 锚点要带上前导两格缩进的整行：那段说明文字里也引用了 `'bits',`",
    apply: () => replaceOnce(F_DP, "  'bits',\n];", "  'bitts',   // 变异：名单里没带位宽\n];"),
    red: ['7', '9'], green: ['1', '1b', '2', '3', '4', '5', '6', '8'], unver: [] },
  { id: 'MG-换一种措辞留键（Object.assign，钉 [2][4]）',
    why: '与 MB 同一桩罪、不同写法（逐键 `Object.assign(polarity, {键: undefined})`）⇒ 证明 [2] 的判据不靠某一种字面写法',
    apply: () => replaceOnce(F_MODAL,
      'for (const c of CONTROLS) if (on[c.key]) polarity[c.key] = high[c.key];',
      'for (const c of CONTROLS) Object.assign(polarity, { [c.key]: on[c.key] ? high[c.key] : undefined });'),
    red: ['2', '3', '6', '7', '8'], green: ['1', '1b', '5', '9'], unver: ['4'] },
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
    const r = spawnSync('node', ['tests/r94-dff-polarity-gate.cjs'], { cwd: ROOT, encoding: 'utf8', timeout: 540000 });
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
