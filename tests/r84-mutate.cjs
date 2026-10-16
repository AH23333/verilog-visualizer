// R84 反向探针（变异验证）：逐颗把源码改坏，看 r84 闸门**该红的那一格有没有红**、
// 别的格有没有保持绿。判据只认闸门汇总里的逐格三态（PASS / FAIL / UNVERIFIED），
// 跑完先还原，再原样重跑一次确认基线全绿。
//
// ⚠ 这台架跑的时候别碰被改的文件（还原会把它们贴回拍快照那一版）。
// Phase C 把沙盒工具栏抽成 SandboxToolbar.tsx 之后，入口变异臂不再落在 SandboxCanvas.tsx ——
// 每颗变异各自声明 `file`，apply/restore 按文件快照。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SC = path.join(ROOT, 'src', 'components', 'SandboxCanvas.tsx');
const TB = path.join(ROOT, 'src', 'components', 'SandboxToolbar.tsx');
const ARMS = ['1', '2', '3', '4'];

const MUTS = [
  {
    id: 'M1-入口属性改名', file: TB,
    why: '工具栏那颗按钮没了（裁决 R-B 的"统一入口"没落地）',
    from: `data-sandbox-bindings`,
    to: `data-sandbox-bindinx`,
    expect: { red: ['1'] },
  },
  {
    id: 'M2-入口点了不开', file: TB,
    why: '按钮还挂着但 onClick 是空转，弹窗永远不开（入口是死的）',
    from: `onClick={() => activeFile && setFileBindingId(activeFile.id)} data-sandbox-bindings`,
    to: `onClick={() => { /* 空转 */ }} data-sandbox-bindings`,
    expect: { red: ['1'] },
  },
  {
    id: 'M3-确定不写库', file: SC,
    why: '弹窗里选完点确定，file.partBindings 一个字都不写（绑定只在内存里）',
    from: `sandboxStore.setPartBindings(fb.id, bindings);`,
    to: `if (bindings === null) sandboxStore.setPartBindings(fb.id, bindings);`,
    expect: { red: ['3'], green: ['1', '2', '4'] },
  },
  {
    id: 'M4-×count 假对齐', file: SC,
    why: '聚合次数被改坏（×0），行数与"实例颗数"不再逐一对上',
    from: `counts.set(String(c.celltype), (counts.get(String(c.celltype)) || 0) + 1);`,
    to: `counts.set(String(c.celltype), (counts.get(String(c.celltype)) || 0) + 0);`,
    expect: { red: ['2'], green: ['1', '3', '4'] },
  },
  {
    id: 'M5-放置不写绑定', file: SC,
    why: 'M4 回归：放置部件不再自动写 partBindings（用部件≠写配置）',
    from: `recordPartBinding(gate.name, gate.id);`,
    to: `void recordPartBinding;`,
    expect: { red: ['4'], green: ['1', '2', '3'] },
  },
];

// 快照所有会被改到的文件（去重）
const FILES = Array.from(new Set(MUTS.map((m) => m.file)));
const SNAP = new Map(FILES.map((f) => [f, fs.readFileSync(f, 'utf8')]));

function apply(m) {
  const orig = SNAP.get(m.file);
  if (orig == null) throw new Error(`没有 ${m.file} 的快照`);
  const parts = orig.split(m.from);
  if (parts.length !== 2) throw new Error(`锚点${parts.length - 1} 次（要恰好 1 次）：${m.id}`);
  fs.writeFileSync(m.file, parts.join(m.to));
}
const restore = () => { for (const [f, s] of SNAP) fs.writeFileSync(f, s); };

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
    const orig = SNAP.get(m.file) ?? '';
    const n = orig.split(m.from).length - 1;
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
    const r = spawnSync('node', [path.join('tests', 'r84-binding-gate.cjs')], { windowsHide: true, cwd: ROOT, encoding: 'utf8', timeout: 420000 });
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
  for (const f of FILES) {
    const back = fs.readFileSync(f, 'utf8');
    if (back !== SNAP.get(f)) { console.log(`★还原后内容与快照不一致 —— 先手工核对 ${path.relative(ROOT, f)}`); bad++; }
  }
  if (!bad) console.log('  已还原并逐字节比对一致');
  console.log('\n########## 还原后基线重跑');
  const r = spawnSync('node', [path.join('tests', 'r84-binding-gate.cjs')], { windowsHide: true, cwd: ROOT, encoding: 'utf8', timeout: 420000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const p = parse(out);
  console.log('  逐格', ARMS.map((a) => `${a}:${p.map[a] ? p.map[a].verdict : '无判定'}`).join(' '), '|', p.summary);
  const n = ARMS.filter((a) => !p.map[a] || p.map[a].verdict !== 'PASS').length;
  if (n || r.status !== 0) { bad++; console.log('  ★基线不干净（还原后仍有非绿格或退出码非 0）'); }
  else console.log('  基线全绿，退出码 0');
  console.log('\n===== 反向探针：', bad ? `${bad} 处不合格` : '全部咬住', '=====');
  process.exit(bad ? 1 : 0);
}
