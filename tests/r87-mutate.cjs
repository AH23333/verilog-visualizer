// R87 反向探针（静态形状闸门，**不带重编**——不起 vite、不碰 dist）。
// 四颗变异各钉一臂，"专钉某条臂的那格要让别的臂保持绿"：
//   MA 把依赖表退回父组件现建的回调      → [1] 红（这一族的真缺陷）＋[4] 红（那处从"已收口"变成"违规"，
//      点名表对不上是**设计如此**，不是串味）；[2]/[3] 必须绿
//   MB 直接删掉一颗 Esc 监听             → 只有 [4] 必须红：总数 12→11 仍在下界之上，
//      旧的"总数下界"抓不到删一颗，这一格就是为此加的（跳过≠通过：抓不到就是判据真有洞）
//   MC 改掉一层遮罩的 DOM 锚点           → [2] 红（反向臂不许靠拆弹窗变绿）；其余必须绿
//   MD 把"从自己写的文案里认事"加回来    → [3] 红；其余必须绿
// ⚠ 仓库是 CRLF：锚点一律**按整行**比对、按文件自己的 EOL 写回，别拿多行字符串去 match。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const F_CD = path.join(ROOT, 'src', 'components', 'ConfirmDialog.tsx');
const F_SD = path.join(ROOT, 'src', 'components', 'SearchDialog.tsx');
const F_SC = path.join(ROOT, 'src', 'components', 'SandboxCanvas.tsx');
const F_AP = path.join(ROOT, 'src', 'App.tsx');
const SNAP = new Map([F_CD, F_SD, F_SC, F_AP].map((f) => [f, fs.readFileSync(f, 'utf8')]));
const J = (o) => JSON.stringify(o);
const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');

/** 找到"整行等于 anchor"的那一行（必须全文件唯一），把它**下一行**换成 newLine */
function replaceNextLine(file, anchor, newLine) {
  const src = fs.readFileSync(file, 'utf8');
  const L = src.split(/\r\n|\n/);
  const hits = L.map((l, i) => (l === anchor ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) return `锚点行在 ${path.basename(file)} 命中 ${hits.length} 次（要恰好 1）⇒ 不动文件`;
  L[hits[0] + 1] = newLine;
  fs.writeFileSync(file, L.join(eolOf(src)));
  return null;
}
/** 在唯一锚点行**之后插一行**（原有的下一行原样保留） */
function insertAfterLine(file, anchor, addLine) {
  const src = fs.readFileSync(file, 'utf8');
  const L = src.split(/\r\n|\n/);
  const hits = L.map((l, i) => (l === anchor ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) return `锚点行在 ${path.basename(file)} 命中 ${hits.length} 次（要恰好 1）⇒ 不动文件`;
  L.splice(hits[0] + 1, 0, addLine);
  fs.writeFileSync(file, L.join(eolOf(src)));
  return null;
}
/** 单行内的唯一子串替换（跨行不碰） */
function replaceOnce(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) return `锚点 ${path.basename(file)} 命中 ${n} 次（要恰好 1）⇒ 不动文件`;
  fs.writeFileSync(file, src.split(from).join(to));
  return null;
}

const ANCHOR_CD = '    return () => { clearTimeout(t); window.removeEventListener(\'keydown\', key); };';
const ANCHOR_SD = '    window.addEventListener(\'keydown\', handleKey);';
const ANCHOR_AP = '  const [simBlocked, setSimBlocked] = useState(false);';

const MUTS = [
  { id: 'MA-依赖表退回父组件现建的 onCancel', apply: () => replaceNextLine(F_CD, ANCHOR_CD, '  }, [onCancel]);'),
    why: '这一族的原始缺陷：依赖表里放父组件每渲染都新建的回调 ⇒ 挂没挂上是运气 ⇒ [1] 必须红（[4] 同红＝点名表发现那处不再是"已收口"）',
    red: ['1', '4'], green: ['2', '3'] },
  { id: 'MB-删掉一颗 Esc 监听（SearchDialog）', apply: () => replaceOnce(F_SD, ANCHOR_SD, '    // 变异：这一族的监听被拆掉了一处'),
    why: '"把监听删了冒充修好"是总数下界抓不到的那种（12→11 仍过线）⇒ 新加的点名臂 [4] 必须红，[1] 保持绿（如实报"抓不到"）',
    red: ['4'], green: ['1', '2', '3'] },
  { id: 'MC-改掉位宽遮罩的 DOM 锚点', apply: () => replaceOnce(F_SC, 'data-bus-width-dialog', 'data-buswidth-dialog'),
    why: '不许靠拆弹窗让静态判据变绿 ⇒ [2] 必须红；这一颗不动监听 ⇒ [1]/[4] 必须绿',
    red: ['2'], green: ['1', '3', '4'] },
  { id: 'MD-把"从自己写的文案里认事"加回来', apply: () => insertAfterLine(F_AP, ANCHOR_AP, '  const _r87md = (message: string) => /floating|looped/.test(message);   // 变异：反向认事'),
    why: '状态栏那句话又被拿来当事实来源 ⇒ [3] 必须红；不动 Esc 族与遮罩 ⇒ [1]/[2]/[4] 必须绿',
    red: ['3'], green: ['1', '2', '4'] },
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
    if (err) { console.log(`  ★${err} —— 这颗变异不作数（跳过≠通过）`); verdict = 1; continue; }
    const r = spawnSync('node', ['tests/r87-esc-shape-gate.cjs'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const map = parse(out);
    const keys = Object.keys(map).sort();
    if (keys.length === 0) {
      console.log('  ★没读到汇总行 ⇒ 不作数（不是绿）\n' + out.split(/\r?\n/).slice(0, 14).map((l) => '    |' + l).join('\n'));
      verdict = 1; continue;
    }
    const red = keys.filter((k) => map[k] === 'FAIL'), green = keys.filter((k) => map[k] === 'PASS');
    const hit = m.red.every((k) => map[k] === 'FAIL') && m.green.every((k) => map[k] === 'PASS')
      && m.red.concat(m.green).length === keys.length;
    console.log(`  逐格 ${keys.map((k) => `${k}:${{ PASS: '绿', FAIL: '红', UNVERIFIED: '未验' }[map[k]] || map[k]}`).join(' ')} | ${(/=====\s*结果:[^=]*=====/ .exec(out) || [''])[0].trim()}`);
    console.log(`  ${hit ? '咬住' : '★没咬住'}：该红 ${J(m.red)} 实际红 ${J(red)}｜该绿 ${J(m.green)} 实际绿 ${J(green)}`);
    if (!hit) { for (const line of out.split(/\r?\n/)) if (/^\s*(FAIL|UNVERIFIED|\[现场|\s+★)/.test(line)) console.log('    ' + line.trim().slice(0, 200)); verdict = 1; }
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
