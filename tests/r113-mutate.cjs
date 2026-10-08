// R113 变异台架：把修复逐条摘掉，确认 r113 闸门**真的**会红。
// 纪律：闸门「绿」只有在「缺陷在场时红」面前才算数。
// 每条变异独立 spawn、独立端口，跑完按端口回收 vite。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const UI = require('./_ui.cjs');
const J = (o) => JSON.stringify(o);

const MIRROR = path.join(ROOT, 'src/lib/cellMirror.ts');
const CANVAS = path.join(ROOT, 'src/components/SandboxCanvas.tsx');

/** 每条变异：id / 为什么这么改 / 期望咬住的判据 */
const MUTANTS = [
  {
    id: 'M1 applyMirror 恢复 swap 换轴（旧实现原样）',
    file: MIRROR,
    from: `  const sx = m?.h ? -1 : 1;
  const sy = m?.v ? -1 : 1;`,
    to: `  const __a = (((c.get('angle') || 0) % 360) + 360) % 360;
  const __sw = __a === 90 || __a === 270;
  const sx = (__sw ? !!m?.v : !!m?.h) ? -1 : 1;
  const sy = (__sw ? !!m?.h : !!m?.v) ? -1 : 1;`,
    why: '把「不读 angle」改回按角度换轴 ⇒ 旋转不再是纯角度变更，镜像轴被二次旋转',
    expect: ['[2]', '[4]', '[5]', '[6]'],
  },
  {
    id: 'M2 flipCell 不做角度取反',
    file: MIRROR,
    from: `  const a = Number(c.get('angle') || 0) || 0;
  if (a) { try { c.rotate(-2 * a); } catch { /* 器件不支持旋转就只翻形状 */ } }`,
    to: `  // （变异：不做角度取反）`,
    why: '屏幕镜像必须伴随 R(θ)→R(−θ)，少了它组合律 M∘R(θ)=R(−θ)∘M 就不成立',
    expect: ['[3]', '[4]'],
  },
  {
    id: 'M3 多选镜像的 flipCell 重复调用（角度取反两遍）',
    file: CANVAS,
    from: `        flipCell(c, dir, paper);              // 形状镜像 + 角度取反（都在 flipCell 内）`,
    to: `        { const _a = Number(c.get('angle') || 0) || 0; if (_a) c.rotate(-2 * _a); }
        flipCell(c, dir, paper);`,
    why: 'R102 的旧写法：多选再 rotate(-2a)，而 flipCell 内部已经取反过一次 ⇒ 取反两遍等于没取反',
    expect: ['[7]'],
  },
  {
    id: 'M4 rotateSelection 恢复「转完重挂镜像」',
    file: CANVAS,
    from: `        c.rotate(deg);
      } catch { /* unsupported */ }`,
    to: `        c.rotate(deg);
        if (c.get('mirror')) applyMirror(c, paper);
      } catch { /* unsupported */ }`,
    why: '旋转后重挂 ⇒ 镜像轴按新 angle 被重新解释（旧实现的坑）',
    expect: ['[2]', '[5]', '[6]'],
    // ⚠ 这条是**等价变异（equivalent mutant）**，闸门咬不住是**设计使然**，不是漏网：
    //   旧实现的病根在 applyMirror 里的 `swap` 换轴（已由 M1 覆盖并被咬住）。
    //   R113 把 applyMirror 改成**完全不读 angle**、只按 mirrorBase 重写几何，
    //   于是「转完再挂一次」= 幂等地把同一份形状再写一遍 —— 行为上与不挂完全一致。
    //   换句话说，M4 已被 M1 的修复**顺带消解**了：它只在换轴还在的时候才有病。
    //   留着它是为了记录这个推理，不是期待它变红。equivalent=true ⇒ 不计入存活。
    equivalent: true,
  },
];

function runGate(port) {
  const r = spawnSync('node', [path.join(ROOT, 'tests/r113-mirror-rotate-gate.cjs')], {
    cwd: ROOT, encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024,
  });
  UI.reapViteByPort(port);
  const out = (r.stdout || '') + '\n' + (r.stderr || '');
  const failed = out.split('\n').filter((l) => /^\s*FAIL\b/.test(l)).map((l) => (l.match(/\[(\d)\]/) || [])[1]);
  return { exit: r.status, failed, out };
}

let allGood = true;
let nEquivalent = 0;
for (const mu of MUTANTS) {
  if (!fs.readFileSync(mu.file, 'utf8').includes(mu.from)) {
    console.log(`SKIP  ${mu.id} — 锚点没命中（源码已变，跳过这条变异）`);
    allGood = false;
    continue;
  }
  const orig = fs.readFileSync(mu.file, 'utf8');
  const port = String(4830 + MUTANTS.indexOf(mu));
  fs.writeFileSync(mu.file, orig.replace(mu.from, mu.to), 'utf8');
  console.log(`\n=== 变异：${mu.id}`);
  console.log(`    理由：${mu.why}`);
  if (mu.equivalent) console.log('    ⚠ 本条标记为等价变异：不期望变红（原因见源码注释）');
  console.log(`    期望咬住：${mu.expect.join(' ')}`);
  let res;
  try { res = runGate(port); }
  finally { fs.writeFileSync(mu.file, orig, 'utf8'); }
  const hit = [...new Set(res.failed)].sort();
  const caught = res.exit !== 0 && hit.length > 0;
  const matched = mu.expect.some((e) => hit.includes(e.replace(/[[\]]/g, '')));
  const verdict = caught ? (matched ? '✓ 被咬住' : '✓ 被咬住（但不在期望的判据上）')
    : (mu.equivalent ? '≡ 等价变异，按预期存活' : '✗ 没咬住');
  console.log(`    结果：exit=${res.exit} 红判据=[${hit.join(',')}] ${verdict}`);
  if (!caught && !mu.equivalent) allGood = false;
  if (mu.equivalent && caught) {
    console.log('    ⚠ 标成等价的变异却变红了 —— 说明它其实不等价，标注需要重新评估。');
    allGood = false;
  }
  if (mu.equivalent && !caught) nEquivalent += 1;
}
console.log(`\n===== 变异台架：${allGood ? '全部被咬住 ✓' : '有变异存活 ✗'}${nEquivalent ? `（另有 ${nEquivalent} 条等价变异按预期存活）` : ''} =====`);
process.exitCode = allGood ? 0 : 1;