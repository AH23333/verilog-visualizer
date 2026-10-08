// R46 反向探针（[G]/[H] 两颗新臂各配自己的变异；这一族是**浏览器闸门** ⇒ 每格都要起 vite＋Edge，约 70 秒一格）。
//   MA 把「放大/缩小」从编译模式菜单里摘掉     → [G] 红（四颗不齐）＋[H] 红（找不到那颗可点）＝同一桩罪的两种后果
//   MB 只把顺序换成"重置缩放在前、适应窗口在后" → [G] 必须红，而 [H] 必须绿（放大还在也还能用）⇒ 顺序那一半真有证人
//   MC 让 zoomBy 变成空转                       → [H] 必须红，[G] 必须绿（菜单文字没动）⇒ "不是死菜单"那一臂不是装饰
// ⚠ 每格开头先还原；跑完逐字节比对；判定在 finally 里才 exit。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const F_AP = path.join(ROOT, 'src', 'App.tsx');
const F_CV = path.join(ROOT, 'src', 'components', 'Canvas.tsx');
const SNAP = new Map([[F_AP, fs.readFileSync(F_AP, 'utf8')], [F_CV, fs.readFileSync(F_CV, 'utf8')]]);
const J = (o) => JSON.stringify(o);
const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');

function replaceOnce(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) return `锚点在 ${path.basename(file)} 命中 ${n} 次（要恰好 1）⇒ 不动文件`;
  fs.writeFileSync(file, src.split(from).join(to));
  return null;
}

const VIEW_LINES = [
  "        { label: '放大', hint: 'Ctrl+滚轮', action: () => canvasRef.current?.zoomBy(1.2) },",
  "        { label: '缩小', hint: 'Ctrl+滚轮', action: () => canvasRef.current?.zoomBy(1 / 1.2) },",
].join(eolOf(SNAP.get(F_AP)));

const MUTS = [
  { id: 'MA-编译模式菜单没有放大/缩小',
    why: '[G] 与 [H] 必须一起红：四颗不齐＋那颗点不到（这是设计如此，两臂红同一桩罪）',
    apply: () => replaceOnce(F_AP, VIEW_LINES + eolOf(SNAP.get(F_AP)), ''),
    red: ['G', 'H'], green: ['A', 'B', 'C', 'D', 'E', 'F'], unver: [] },
  { id: 'MB-只把顺序换成"重置缩放…适应窗口"',
    why: '[G] 必须红（顺序是这一臂的一半），[H] 必须绿（放大还在、也还改得动画面）⇒ 不许拿 [H] 的红/绿当 [G] 的证人',
    apply: () => replaceOnce(F_AP,
      VIEW_LINES + eolOf(SNAP.get(F_AP))
      + "        { label: '适应窗口', hint: 'Shift+F', action: () => canvasRef.current?.fitToWindow() },"
      + eolOf(SNAP.get(F_AP))
      + "        { label: '重置缩放', action: () => canvasRef.current?.resetZoom() },",
      "        { label: '重置缩放', action: () => canvasRef.current?.resetZoom() },"
      + eolOf(SNAP.get(F_AP))
      + "        { label: '适应窗口', hint: 'Shift+F', action: () => canvasRef.current?.fitToWindow() },"
      + eolOf(SNAP.get(F_AP))
      + VIEW_LINES),
    red: ['G'], green: ['A', 'B', 'C', 'D', 'E', 'F', 'H'], unver: [] },
  { id: 'MC-zoomBy 变成空转（死菜单）',
    why: '[H] 必须红（点了 scale 不变），[G] 必须绿（菜单词面完全没动）⇒ "从 DOM 现读的那颗 scale"才是这一臂的凭据',
    apply: () => replaceOnce(F_CV,
      '    zoomAt(factor, cr.left + cr.width / 2 - (wr.left - panRef.current.x), cr.top + cr.height / 2 - (wr.top - panRef.current.y));',
      '    void wr; void factor;   // 变异：什么都不做'),
    red: ['H'], green: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], unver: [] },
];

const parse = (out) => {
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(PASS|FAIL|UNVERIFIED)\s+\[([A-Z0-9]+)\]/.exec(line);
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
    const r = spawnSync('node', ['tests/r46-menu-parity.cjs'], { cwd: ROOT, encoding: 'utf8', timeout: 420000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const map = parse(out);
    const keys = Object.keys(map).sort();
    if (keys.length === 0) {
      console.log('  ★没读到逐臂判定 ⇒ 不作数（不是绿）\n' + out.split(/\r?\n/).slice(-8).map((l) => '    |' + l).join('\n'));
      verdict = 1; continue;
    }
    const red = keys.filter((k) => map[k] === 'FAIL'), green = keys.filter((k) => map[k] === 'PASS');
    const hit = m.red.every((k) => map[k] === 'FAIL') && m.green.every((k) => map[k] === 'PASS')
      && m.red.concat(m.green).length === keys.length;
    console.log(`  逐格 ${keys.map((k) => `${k}:${map[k] === 'PASS' ? '绿' : map[k] === 'FAIL' ? '红' : '未验'}`).join(' ')}`);
    console.log(`  ${hit ? '咬住' : '★没咬住'}：该红 ${J(m.red)} 实际红 ${J(red)}｜该绿 ${J(m.green)} 实际绿 ${J(green)}`);
    if (!hit) { for (const line of out.split(/\r?\n/)) if (/^\s*FAIL|\[G\]|\[H\]/.test(line)) console.log('    ' + line.trim().slice(0, 200)); verdict = 1; }
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
