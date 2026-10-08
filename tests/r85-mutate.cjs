// R85 反向探针（变异验证）：逐颗把"位置怎么落"的三条臂改坏，看 r85 该红的那一格有没有红、
// 别的格有没有保持绿。跑完还原，再原样重跑一次确认基线全绿。
// 用法：`node tests/r85-mutate.cjs --check` 只验锚点；`--only M2,M3` 只跑指定变异。
// ⚠ 这台架跑的时候别碰 src/lib/sandboxLoad.ts 与 src/lib/subcircuitView.ts（还原会贴回拍快照那一版）。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILES = {
  load: path.join(ROOT, 'src', 'lib', 'sandboxLoad.ts'),
  view: path.join(ROOT, 'src', 'lib', 'subcircuitView.ts'),
  sb: path.join(ROOT, 'src', 'components', 'SandboxCanvas.tsx'),
  gate: path.join(ROOT, 'src', 'lib', 'gateSystem.ts'),
};
const ORIG = {};
for (const k of Object.keys(FILES)) ORIG[k] = fs.readFileSync(FILES[k], 'utf8');
const ARMS = ['0a', '1', '2', '3', '4', '5'];

// 第一版三颗变异的现场（都记下来，因为"没咬住"分两种：判据有洞 vs 我的预期钉错了臂）：
//   M1（沙盒装载时跳过 Input 一类）⇒ 红的是 [4]、[3] 落到"未验证"，而 [1]/[2] 依旧绿
//     ⇒ 真因**不是"有两条装载路"**（`loadCells` 只有一份，四条调用路共用），而是**类型名不同**：
//       顶层快照过了 `io_ui` 之后 IO 已是 Button/Lamp/NumDisplay，部件文件在落盘前才映射回 Input/Output，
//       所以按 `type === 'Input'` 过滤只砍得动部件文件那一侧。[1]/[2] 的射程只有"编译画布 vs 复制后的顶层"。
//   M2（同一处逐颗加抖动）⇒ 沙盒根本没装载出来（C/B/D 有 null）⇒ 闸门如实报"未验证"，没有假绿。
//   M3（`subcircuitView` 落位置那一行改掉）⇒ 六格全绿 ⇒ 那一行不管展开图的坐标来源，
//     真正的主人在这颗里换成了 M3'（部件文件落盘前的布局固化）。
const MUTS = [
  {
    id: 'M1-装载时整类器件不见', file: 'load', why: '部件文件那一侧少一类器件 ⇒ [4] 要红、[3] 要落到"未验证"，[1]/[2] 不该被牵连',
    from: `    if (c.isLink || (c.source && c.target && c.source.id && c.target.id)) continue;`,
    to: `    if (c.isLink || (c.source && c.target && c.source.id && c.target.id)) continue;\n    if (c.type === 'Input') continue;`,
    expect: { red: ['4'], unver: ['3'], green: ['1', '2'] },
  },
  {
    id: 'M2-沙盒装载时逐颗加抖动', file: 'sb', why: '打开存档时给每颗一个不共同的偏移 ⇒ 复制后的排布与编译结果不再一致',
    from: `      const args: any = { type, position: { x, y } };`,
    to: `      const args: any = { type, position: { x: x + Math.round(y / 200) * 11, y: y + Math.round(x / 260) * 7 } };`,
    expect: { red: ['2'], green: ['1'] },
  },
  {
    id: 'M3-部件文件落盘前不固化布局', file: 'gate', why: '回到"全部堆在原点"的老缺陷（用户原话的根因），[3] 与 [4] 都必须有反应',
    from: `  if (!djs || !mod?.devices) return cellsFallback();`,
    to: `  if (true) return cellsFallback();`,
    expect: { red: ['4'], noGreen: ['3'] },
  },
  {
    id: 'M4-装载时给所有 id 换命名', file: 'load', why: '坐标一颗没动、连线照样接得上，但两端 id 不再逐一对应（[1] 专管这件事）',
    from: `  const mapId = (id: any) => (idMap && id != null && idMap.has(String(id))) ? idMap.get(String(id)) : id;`,
    to: `  const mapId = (id: any) => String((idMap && id != null && idMap.has(String(id))) ? idMap.get(String(id)) : id) + '_x';`,
    // 这一颗还专门用来顶 [2]/[3] 的"分母洞"：id 全换掉之后共同集合是空的，
    // 只看"最大偏移 ≤1 px"会**空过**（空集合的 max 是 0）⇒ 那两格现在自带 matched 等式。
    expect: { red: ['1'], unver: ['3'], green: ['4'] },
  },
];

function apply(m) {
  const src = ORIG[m.file];
  const parts = src.split(m.from);
  if (parts.length !== 2) throw new Error(`锚点 ${parts.length - 1} 次（要恰好 1 次）：${m.id} @ ${m.file}`);
  fs.writeFileSync(FILES[m.file], parts.join(m.to));
}
const restore = () => { for (const k of Object.keys(FILES)) fs.writeFileSync(FILES[k], ORIG[k]); };
const cooldown = () => { const t = Date.now() + 4000; while (Date.now() < t) { } };

function parse(out) {
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(PASS|FAIL|UNVERIFIED)\s+\[([\w.]+)\]/.exec(line);
    if (m && !map[m[2]]) map[m[2]] = { verdict: m[1], detail: m[2] + ':' + line.trim().slice(0, 160) };
  }
  return { map, fatal: /FATAL/.test(out), summary: (/=====\s*结果[^\n]*/.exec(out) || [''])[0] };
}

let bad = 0;
const argv = process.argv.join(' ');
const RUN = /--only=([\w,]+)/.test(argv)
  ? MUTS.filter((m) => new RegExp('--only=([\\w,]+)').exec(argv)[1].split(',').some((k) => m.id.startsWith(k)))
  : MUTS;
if (argv.includes('--check')) {
  for (const m of MUTS) {
    const n = ORIG[m.file].split(m.from).length - 1;
    console.log(n === 1 ? `  锚点 OK 唯一  ${m.id} @ ${m.file}` : `  ★锚点 ${n} 次  ${m.id} @ ${m.file}`);
    if (n !== 1) bad++;
  }
  process.exit(bad ? 1 : 0);
}
try {
  for (const m of RUN) {
    restore(); apply(m);
    console.log(`\n########## ${m.id} —— ${m.why}`);
    cooldown();
    const r = spawnSync('node', ['tests/r85-posfidelity-gate.cjs'], { cwd: ROOT, encoding: 'utf8', timeout: 560000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const p = parse(out);
    if (p.fatal) {
      console.log('  [闸门 FATAL 全文]', (out.split(/\r?\n/).filter((l) => /FATAL|Timeout|waiting for/.test(l)).join(' ⏎ ').slice(0, 600)));
      console.log('  ★这跑没跑完（环境或崩溃），不许读成"这一格没红"'); bad++; continue;
    }
    console.log('  逐格', ARMS.map((a) => `${a}:${p.map[a] ? (p.map[a].verdict === 'PASS' ? '绿' : p.map[a].verdict === 'FAIL' ? '红' : '未验') : '无判定'}`).join(' '), '|', p.summary);
    const reds = ARMS.filter((a) => p.map[a] && p.map[a].verdict === 'FAIL');
    const greens = ARMS.filter((a) => p.map[a] && p.map[a].verdict === 'PASS');
    const unvers = ARMS.filter((a) => p.map[a] && p.map[a].verdict === 'UNVERIFIED');
    const hit = (m.expect.red || []).every((a) => reds.includes(a));
    const kept = (m.expect.green || []).every((a) => greens.includes(a));
    const uOk = (m.expect.unver || []).every((a) => unvers.includes(a));
    // `noGreen`：这一臂**必须有反应**（红或未验证都行），但不许"看过就算绿"
    const ngOk = (m.expect.noGreen || []).every((a) => !greens.includes(a));
    const good = hit && kept && uOk && ngOk;
    (good ? console.log : (s) => { bad++; console.log(s); })(
      `  ${good ? '咬住' : '★没咬住'}：该红 ${JSON.stringify(m.expect.red || [])} 实际红 ${JSON.stringify(reds)}`
      + `｜该未验 ${JSON.stringify(m.expect.unver || [])} 实际未验 ${JSON.stringify(unvers)}`
      + `｜该绿 ${JSON.stringify(m.expect.green || [])} 实际绿 ${JSON.stringify(greens)}`
      + `｜不许绿 ${JSON.stringify(m.expect.noGreen || [])}`);
    for (const a of ARMS) if (p.map[a] && p.map[a].verdict !== 'PASS') console.log('   ', p.map[a].detail);
  }
} catch (e) {
  bad++; console.log('★台架自己出错：', String(e && e.message || e).slice(0, 200));
} finally {
  restore();
  // 还原要**重读比对**，只写不算（r83-mutate 就在 try 里 exit 过，英文留在源码上）
  for (const k of Object.keys(FILES)) {
    if (fs.readFileSync(FILES[k], 'utf8') !== ORIG[k]) { console.log(`★还原后不一致：${k}`); bad++; }
  }
  console.log(bad ? '  ★源码没回到快照' : '  已还原并逐字节比对一致（4 个文件）');
  console.log('\n########## 还原后基线重跑');
  cooldown();
  const r = spawnSync('node', ['tests/r85-posfidelity-gate.cjs'], { cwd: ROOT, encoding: 'utf8', timeout: 560000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const p = parse(out);
  console.log('  逐格', ARMS.map((a) => `${a}:${p.map[a] ? p.map[a].verdict : '无判定'}`).join(' '), '|', p.summary);
  if (r.status !== 0 || ARMS.some((a) => !p.map[a] || p.map[a].verdict !== 'PASS')) { bad++; console.log('  ★基线不干净'); }
  else console.log('  基线全绿，退出码 0');
  console.log(`\n===== 反向探针：${bad ? bad + ' 处不合格' : '全部咬住'} =====`);
  process.exit(bad ? 1 : 0);
}
