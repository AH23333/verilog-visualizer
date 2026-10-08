// R84 反向探针（变异验证）：逐颗把 `SandboxCanvas.tsx` 改坏，看 r84 闸门**该红的那一格有没有红**、
// 别的格有没有保持绿。判据只认闸门汇总里的逐格三态（PASS / FAIL / UNVERIFIED），
// 跑完先还原，再原样重跑一次确认基线 5/5。
//
// ⚠ 这台架跑的时候别碰 src/components/SandboxCanvas.tsx（还原会把文件贴回它拍快照那一版）。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'src', 'components', 'SandboxCanvas.tsx');
const ORIG = fs.readFileSync(FILE, 'utf8');
const ARMS = ['1', '2', '3', '4', '5'];

const MUTS = [
  {
    id: 'M1-入口属性改名', why: '那颗按钮不存在了（R-A 的"入口"没加上）',
    from: `<button onClick={() => setBindingRows(collectBindings())} data-sandbox-bindings disabled={!activeFile}`,
    to: `<button onClick={() => setBindingRows(collectBindings())} data-sandbox-bindinx disabled={!activeFile}`,
    expect: { red: ['1'] },
  },
  {
    id: 'M2-状态列永不报失效', why: '删掉部件文件后那一行还写「已绑定」＝替用户撒谎',
    from: `state: !name ? '未绑定' : (!ref || !def?.cells?.length ? '绑定失效' : '已绑定'),`,
    to: `state: !name ? '未绑定' : '已绑定',`,
    expect: { red: ['3'], green: ['1', '2', '4'] },
  },
  {
    id: 'M3-换绑按钮不做事', why: '弹窗里的下拉只是个摆设，画布一颗都不动',
    from: `onRebind={(cellId, newName) => {
              rebindSubcircuitCell(cellId, newName);`,
    to: `onRebind={(cellId, newName) => {
              if (newName === '\\u0000never') rebindSubcircuitCell(cellId, newName);`,
    expect: { red: ['4'], green: ['1', '2', '3'] },
  },
  {
    id: 'M4-实际解析列无视作用域', why: '那一列改成"库里有同名就报它"，作用域打分被绕开',
    from: `{r.state === '已绑定' ? (r.folder ? \`\${r.folder}/\` : '根目录') : '—'}`,
    to: `{r.state === '已绑定' ? (() => { const q = parts.find((p) => p.name === r.celltype && p.folder); return q ? \`\${q.folder}/\` : '根目录'; })() : '—'}`,
    expect: { red: ['5'], green: ['1', '2', '3', '4'] },
  },
  {
    id: 'M5-弹窗少报一行', why: '表格漏掉实例（行数与画布不再逐一对上）',
    from: `rows={bindingRows} parts={gates} scope={scope}`,
    to: `rows={(bindingRows || []).slice(1)} parts={gates} scope={scope}`,
    expect: { red: ['2'] },
  },
];

function apply(m) {
  const parts = ORIG.split(m.from);
  if (parts.length !== 2) throw new Error(`锚点${parts.length - 1} 次（要恰好 1 次）：${m.id}`);
  fs.writeFileSync(FILE, parts.join(m.to));
}
const restore = () => fs.writeFileSync(FILE, ORIG);

/** 从闸门输出里读逐格三态：`PASS [n] …` / `FAIL [n] …` / `UNVERIFIED [n] …`（还可能是 FATAL） */
function parse(out) {
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(PASS|FAIL|UNVERIFIED)\s+\[(\w)\]\s*(.*)$/.exec(line);
    if (m && !map[m[2]]) map[m[2]] = { verdict: m[1], detail: m[3].slice(0, 150) };
  }
  return { map, fatal: /FATAL/.test(out), summary: (/=====\s*结果[^\n]*/.exec(out) || [''])[0] };
}

let bad = 0;
const checkOnly = process.argv.includes('--check');
// `--only M4,M5` 只重跑指定变异（配合 `--check` 用；一条批次只由一条前台跑负责）
const onlyArg = (/--only[= ]([\w,]+)/.exec(process.argv.join(' ')) || [])[1];
const RUN = onlyArg ? MUTS.filter((m) => onlyArg.split(',').some((k) => m.id.startsWith(k))) : MUTS;
// 上一跑的浏览器/服务收尾要一点时间；连着跑下一跑会在第一颗点击上超时（M5 实测就是这样空的）
const cooldown = () => { const t = Date.now() + 4000; while (Date.now() < t) { } };
if (checkOnly) {
  // 只验锚点：`node tests/r84-mutate.cjs --check`（不改文件、不跑闸门）
  for (const m of RUN) {
    const n = ORIG.split(m.from).length - 1;
    console.log(n === 1 ? `  锚点 OK 唯一  ${m.id}` : `  ★锚点 ${n} 次  ${m.id}`);
    if (n !== 1) bad++;
  }
  process.exit(bad ? 1 : 0);
}
try {
  for (const m of RUN) {
    restore();
    apply(m);
    console.log(`\n########## ${m.id} —— ${m.why}`);
    cooldown();
    const r = spawnSync('node', [path.join('tests', 'r84-binding-gate.cjs')], { cwd: ROOT, encoding: 'utf8', timeout: 420000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const p = parse(out);
    if (p.fatal) {
      console.log('  [闸门 FATAL 全文]', (out.split(/\r?\n/).filter((l) => /FATAL|Timeout|Call log|waiting for/.test(l)).join(' ⏎ ').slice(0, 700)));
      console.log('  ★这跑没跑完（环境或崩溃），不许当成"这一格没红"');
      bad++;
      continue;
    }
    const got = ARMS.map((a) => `${a}:${p.map[a] ? (p.map[a].verdict === 'PASS' ? '绿' : p.map[a].verdict === 'FAIL' ? '红' : '未验') : '无判定'}`).join(' ');
    console.log('  逐格', got, '|', p.summary);
    const reds = ARMS.filter((a) => p.map[a] && p.map[a].verdict === 'FAIL');
    const greens = ARMS.filter((a) => p.map[a] && p.map[a].verdict === 'PASS');
    const wantRed = m.expect.red || [];
    const wantGreen = m.expect.green || [];
    const hit = wantRed.every((a) => reds.includes(a));
    const kept = wantGreen.every((a) => greens.includes(a));
    (hit && kept ? console.log : (s) => { bad++; console.log(s); })(
      `  ${hit && kept ? '咬住' : '★没咬住'}：该红 ${JSON.stringify(wantRed)} 实际红 ${JSON.stringify(reds)}｜该绿 ${JSON.stringify(wantGreen)} 实际绿 ${JSON.stringify(greens)}`);
    // 每一个非绿格都要打出理由（上一版只打"该红"那一格，M4 顺带红了 [4] 却看不见原因）
    for (const a of ARMS) if (p.map[a] && p.map[a].verdict !== 'PASS') console.log(`    ${a}=${p.map[a].verdict}`, p.map[a].detail);
  }
} finally {
  restore();
  // 还原必须**重读比对**：只写不算（另一颗台架就因为 try 里 exit 把还原跳过了，英文留在源码上）
  const back = fs.readFileSync(FILE, 'utf8');
  if (back !== ORIG) { console.log('★还原后内容与快照不一致 —— 先手工核对 src/components/SandboxCanvas.tsx'); bad++; }
  else console.log('  已还原并逐字节比对一致');
  console.log('\n########## 还原后基线重跑');
  const r = spawnSync('node', [path.join('tests', 'r84-binding-gate.cjs')], { cwd: ROOT, encoding: 'utf8', timeout: 420000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const p = parse(out);
  console.log('  逐格', ARMS.map((a) => `${a}:${p.map[a] ? p.map[a].verdict : '无判定'}`).join(' '), '|', p.summary);
  const n = ARMS.filter((a) => !p.map[a] || p.map[a].verdict !== 'PASS').length;
  if (n || r.status !== 0) { bad++; console.log('  ★基线不干净（还原后仍有非绿格或退出码非 0）'); }
  else console.log('  基线 5/5 绿，退出码 0');
  console.log('\n===== 反向探针：', bad ? `${bad} 处不合格` : '全部咬住', '=====');
  process.exit(bad ? 1 : 0);
}
