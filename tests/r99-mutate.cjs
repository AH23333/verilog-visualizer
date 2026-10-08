// R99 反向探针（harness 形状照 r95-mutate.cjs）：**每格都不带重编**（闸门自己起 vite 读 src）。
//   MA 多选旋转改回各绕自身中心（钉 [1]）: 各自 rotate(deg) 后位置原地不动，
//      闸门期望「绕选区包围盒中心公转」的坐标对不上 ⇒ 只红 [1]（角度仍 90 不背锅）
//   MB flipCell 调用摘除（钉 [3]）: mirror 状态永远不落 ⇒ body 无 scaleX、端口不对调 ⇒ 只红 [3]
//   MC 「绑定...」action 置空（钉 [5]）: 菜单项保留（流程不中断），但对话框不再弹 ⇒ 只红 [5]，
//      [5c]（真换绑）在 if(dlg.open) 里随跳 ⇒ 声明为未验，不许读成绿
//   MD 高亮退回旧特异度（钉 [2]）: 去掉 [data-theme] 前缀后 (0,2,0) 输给 index.css 主题灰
//      (0,4,0) ⇒ .body stroke 回到灰色 ⇒ 只红 [2]
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

// MD 用整块样式做锚点（唯一），把 [data-theme] .joint-paper 前缀整体摘掉
const HL_BLOCK = [
  '        [data-theme] .joint-paper .sm-selected .body, [data-theme] .joint-paper .sm-selected .gate,',
  '        [data-theme] .joint-paper .sm-selected .btnface, [data-theme] .joint-paper .sm-selected .led,',
  '        [data-theme] .joint-paper .sm-selected path.decor,',
  '        [data-theme] .joint-paper .sm-selected .joint-port-body {',
  '          stroke: var(--accent-hover) !important;',
  '          stroke-width: 2.5 !important;',
  '        }',
  '        [data-theme] .joint-paper .sm-selected .connection {',
  '          stroke: var(--accent-hover) !important;',
  '          stroke-width: 3 !important;',
  '        }',
  '        /* 端口圆点与位宽/引脚小字也跟随主题紫，整颗器件一眼可辨 */',
  '        [data-theme] .joint-paper .sm-selected circle.port {',
  '          fill: var(--accent-hover) !important;',
  '        }',
].join('\n');

const MUTS = [
  { id: 'MA-多选旋转改回各绕自身（钉 [1]）',
    why: 'R100 手工轨道被摘（去掉 c.position 公转行）＝各绕自身中心自旋 ⇒ 位置原地不动，闸门期望的「绕选区包围盒中心公转」坐标全对不上 ⇒ 只红 [1]',
    apply: () => replaceOnce(F_SB,
      'c.position(nx - s.width / 2, ny - s.height / 2); // 公转到新中心',
      '/* 公转摘除（变异）：各绕自身 */'),
    red: ['1'], green: ['2', '3', '4', '5', '5c'], unver: [] },
  { id: 'MB-flipCell 调用摘除（钉 [3]）',
    why: '镜像唯一主人在 cellMirror.flipCell；摘掉调用后 mirror 状态不落、body 无 scaleX、端口不对调 ⇒ 只红 [3]',
    apply: () => replaceOnce(F_SB,
      'try { flipCell(c, dir, paper); } catch { /* unsupported */ }',
      'try { /* flipCell 摘除（变异） */ } catch { /* unsupported */ }'),
    red: ['3'], green: ['1', '2', '4', '5', '5c'], unver: [] },
  { id: 'MC-「绑定...」action 置空（钉 [5]，[5c] 随跳）',
    why: '菜单项保留（点得动、流程不中断），但 setRebindDlg 不再调 ⇒ 对话框不弹 ⇒ 只红 [5]；[5c] 在 if(dlg.open) 里随跳＝未验，不许读成绿',
    apply: () => replaceOnce(F_SB,
      "setRebindDlg({ cellId, cur: String(cell.get('celltype') || '') });",
      '/* 绑定对话框摘除（变异） */;'),
    red: ['5'], green: ['1', '2', '3', '4'], unver: ['5c'] },
  { id: 'MD-高亮退回旧特异度（钉 [2]）',
    why: '去掉 [data-theme] 前缀后 .sm-selected 规则降到 (0,2,0)，输给 index.css 主题灰 (0,4,0) ⇒ .body stroke 回灰 ⇒ 只红 [2]',
    apply: () => replaceOnce(F_SB,
      HL_BLOCK,
      HL_BLOCK.split('[data-theme] .joint-paper ').join('')),
    red: ['2'], green: ['1', '3', '4', '5', '5c'], unver: [] },
];

// r99 闸门断言行有两种形状：「  PASS  [2] …」与「[1] PASS … / [1] ★FAIL …」，都收
const parse = (out) => {
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    let m = /^\s*(PASS|FAIL|UNVERIFIED)\s+\[([\w.]+)\]/.exec(line);
    if (!m) {
      m = /^\[1\] (PASS|\u2605FAIL)/.exec(line);
      if (m) { if (!map['1']) map['1'] = m[1] === 'PASS' ? 'PASS' : 'FAIL'; continue; }
      continue;
    }
    if (!map[m[2]]) map[m[2]] = m[1];
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
    const r = spawnSync('node', ['tests/r99-ui-unify-gate.cjs'], { cwd: ROOT, encoding: 'utf8', timeout: 540000, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    const map0 = parse(out);
    // 声明为未验的臂若随跳（如 [5c] 在 if(dlg.open) 里）缺席，记 UNVERIFIED——缺席≠没咬住
    for (const k of (m.unver || [])) if (!(k in map0)) map0[k] = 'UNVERIFIED';
    const map = map0;
    const keys = Object.keys(map).sort();
    if (keys.length === 0) {
      console.log('  ★没读到逐臂判定 ⇒ 不作数（不是绿）\n' + out.split(/\r?\n/).slice(-10).map((l) => '    |' + l).join('\n'));
      verdict = 1; continue;
    }
    const red = keys.filter((k) => map[k] === 'FAIL');
    const green = keys.filter((k) => map[k] === 'PASS');
    const unver = keys.filter((k) => map[k] === 'UNVERIFIED');
    const absent = ['1', '2', '3', '4', '5', '5c'].filter((k) => !keys.includes(k));   // 断言臂缺席＝没判成
    const want = (a) => (a || []).slice().sort();
    const hit = !absent.length && want(m.red).every((k) => map[k] === 'FAIL') && want(m.green).every((k) => map[k] === 'PASS')
      && J(unver) === J(want(m.unver))
      && m.red.concat(m.green, want(m.unver)).length === keys.length;
    console.log(`  逐格 ${keys.map((k) => `${k}:${{ PASS: '绿', FAIL: '红', UNVERIFIED: '未验' }[map[k]] || map[k]}`).join(' ')}${absent.length ? '｜缺席臂 ' + J(absent) : ''}`);
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
