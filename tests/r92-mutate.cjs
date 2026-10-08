// R92 反向探针：两臂各有自己的变异，"专钉某条臂的那格要让别的臂保持绿"。
//   MA 摘掉**编译画布**订阅设置后那一次重排  → [2] 必须红；[1]/[3]（沙盒）必须绿；[4] 静态臂仍绿（剩下的调用行都带 wireStyle）
//   MB 把**沙盒画布**效应依赖表里的 wireStyle 摘掉 → [1] 必须红（改档不动），[3] 同红（三档读数会塌成一种＝设计如此），
//      [2] 必须绿（编译那条路没被碰）—— ⚠ 这一格红了不止一臂，是"同一桩罪的两种后果"，不是判据串味。
// ⚠ 每格开头先还原；跑完逐字节比对；判定在 finally 里才 exit。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const F_CV = path.join(ROOT, 'src', 'components', 'Canvas.tsx');
const F_SB = path.join(ROOT, 'src', 'components', 'SandboxCanvas.tsx');
const SNAP = new Map([[F_CV, fs.readFileSync(F_CV, 'utf8')], [F_SB, fs.readFileSync(F_SB, 'utf8')]]);
const J = (o) => JSON.stringify(o);

function replaceOnce(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) return `锚点在 ${path.basename(file)} 命中 ${n} 次（要恰好 1）⇒ 不动文件`;
  fs.writeFileSync(file, src.split(from).join(to));
  return null;
}

/** 按**整行**锚点定位（必须唯一），把紧随其后的 count 行换成 lines。
 *  ⚠ MA 第一版拿单行 `try { applyWireStyle(...) }` 当锚点，结果在 Canvas.tsx 命中 2 次
 *    （订阅效应里一次、建图时一次）——打在错的那一处会被读成"判据有洞"，所以台架拒绝动手是对的。 */
function replaceAfterLine(file, anchor, count, lines) {
  const src = fs.readFileSync(file, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const L = src.split(/\r?\n/);
  const hits = L.map((l, i) => (l === anchor ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) return `锚点行在 ${path.basename(file)} 命中 ${hits.length} 次（要恰好 1）⇒ 不动文件`;
  L.splice(hits[0] + 1, count, ...lines);
  fs.writeFileSync(file, L.join(eol));
  return null;
}

const MUTS = [
  { id: 'MA-编译画布两处 applyWireStyle 全摘（钉 [2]）',
    // ⚠ 关键读数：MA 第一版只摘**订阅**那一处，[2] 仍旧绿——因为回编译视图时画布是**重建**的，
    //   建图那次 applyWireStyle（Canvas.tsx:594）已经把档用上了。也就是说今天界面上**观察不到**
    //   "编译画布活着的时候改档"（设置面板唯一入口在沙盒），那条订阅是防御性的、不是已验证行为。
    //   所以这颗变异把 Canvas 里两处一起摘掉，才真的造出 [2] 定义的那个形状。
    why: '编译模式那张画布两处都不按全局档重排 ⇒ [2] 必须红；[1]/[3]（沙盒）与 [4]（剩下的调用行仍带 wireStyle）必须绿',
    apply: () => {
      const src = fs.readFileSync(F_CV, 'utf8');
      const n = src.split('try { applyWireStyle(paper, settingsStore.getSandboxSettings().wireStyle); } catch { /* ignore */ }').length - 1;
      if (n !== 2) return `Canvas.tsx 里这一句命中 ${n} 次（要恰好 2：订阅一处＋建图一处）⇒ 不动文件`;
      fs.writeFileSync(F_CV, src.split('try { applyWireStyle(paper, settingsStore.getSandboxSettings().wireStyle); } catch { /* ignore */ }')
        .join('// 变异：这一版编译画布不按全局档重排'));
      return null;
    },
    red: ['2'], green: ['1', '3', '4', '5'], unver: [] },
  { id: 'MB-沙盒画布的效应不再监听 wireStyle（钉 [1]+[3]）',
    why: '依赖表里摘掉 wireStyle ⇒ 改档时沙盒不重排 ⇒ [1] 红、[3] 也红（三档读数塌成一种，同一桩罪的第二个后果）；编译那条路没动 ⇒ [2] 必须绿',
    apply: () => replaceOnce(F_SB,
      '  }, [settings.wireStyle, activeFile?.id, resetNonce]);',
      '  }, [activeFile?.id, resetNonce]);'),
    red: ['1', '3'], green: ['2', '4', '5'], unver: [] },
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
    const r = spawnSync('node', ['tests/r92-routing-gate.cjs'], { cwd: ROOT, encoding: 'utf8', timeout: 420000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const map = parse(out);
    const keys = Object.keys(map).sort();
    if (keys.length === 0) {
      console.log('  ★没读到逐臂判定 ⇒ 不作数（不是绿）\n' + out.split(/\r?\n/).slice(-8).map((l) => '    |' + l).join('\n'));
      verdict = 1; continue;
    }
    const red = keys.filter((k) => map[k] === 'FAIL'), green = keys.filter((k) => map[k] === 'PASS');
    const unver = keys.filter((k) => map[k] === 'UNVERIFIED');
    const hit = m.red.every((k) => map[k] === 'FAIL') && m.green.every((k) => map[k] === 'PASS') && !unver.length
      && m.red.concat(m.green).length === keys.length;
    console.log(`  逐格 ${keys.map((k) => `${k}:${{ PASS: '绿', FAIL: '红', UNVERIFIED: '未验' }[map[k]] || map[k]}`).join(' ')}`);
    console.log(`  ${hit ? '咬住' : '★没咬住'}：该红 ${J(m.red)} 实际红 ${J(red)}｜该未验 ${J(m.unver)} 实际未验 ${J(unver)}｜该绿 ${J(m.green)} 实际绿 ${J(green)}`);
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
