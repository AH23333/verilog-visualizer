// 只读探针：浏览器闸门各自 boot 的是哪一颗入口、谁还带着已删活动栏的死锚点。
// 读数进 docs/GATE_LAYERS.md 第 ⑤ 节（⛔ 拿它冒充跑批判定——红不红以 run-all 三态为准）。
const fs = require('fs');
const path = require('path');
const T = path.resolve(__dirname, '..', '..', 'tests');
const files = fs.readdirSync(T).filter((f) => f.endsWith('.cjs'));
// 名册以 run-all 的 GATES 数组为准（⛔ 自己按文件名猜一批，猜出来的名单会跟跑批对不上）
const runAll = fs.readFileSync(path.join(T, 'run-all.cjs'), 'utf8');
const ROSTER = [...(/const GATES = \[([\s\S]*?)\];/.exec(runAll)[1].matchAll(/'([^']+)'/g)).map((m) => m[1])];
const notFound = ROSTER.filter((g) => !fs.existsSync(path.join(T, g + '.cjs')));
console.log(`GATES 名册 = ${ROSTER.length} 颗，清单里缺件 ${notFound.length}${notFound.length ? '：' + notFound.join(' ') : ''}`);
const out = { gatesHtml: [], rootUrl: [], noBrowser: [], activityBtnDead: [], indexHtmlExplicit: [], notInRoster: [] };
for (const f of files) {
  const stem = f.replace(/\.cjs$/, '');
  const s = fs.readFileSync(path.join(T, f), 'utf8');
  const browser = /playwright|chromium\.launch/i.test(s);
  if (!ROSTER.includes(stem)) {
    // 不在名册里但确实会开浏览器的，单列一颗——它们⛔ 进跑批，混进读数会污染颗数
    if (browser) out.notInRoster.push(stem);
    continue;
  }
  if (!browser) { out.noBrowser.push(stem); continue; }
  if (/gates\.html/.test(s)) out.gatesHtml.push(stem);
  else if (/index\.html/.test(s)) out.indexHtmlExplicit.push(stem);
  else if (/localhost/.test(s)) out.rootUrl.push(stem);
  if (/activity-btn/.test(s)) out.activityBtnDead.push(stem);
}
for (const [k, v] of Object.entries(out)) console.log(`${k} = ${v.length} : ${v.join(' ')}`);
const overlap = out.gatesHtml.filter((x) => out.activityBtnDead.includes(x));
console.log(`既走 gates.html 又留 activity-btn = ${overlap.length} : ${overlap.join(' ')}`);
console.log(`合计浏览器闸门 = ${out.gatesHtml.length + out.indexHtmlExplicit.length + out.rootUrl.length}，⛔ 浏览器 = ${out.noBrowser.length}`);

// 工作清单：走根路径的 58 颗里，哪一些其实只要把入口换成 gates.html 就有活动栏可用
// （判据＝那颗档里出现沙盒侧主人/锚点），哪一些是编译画布侧（要换 pushCompile 喂宿主推送单）。
const sand = [], comp = [], neither = [];
for (const stem of out.rootUrl) {
  const s = fs.readFileSync(path.join(T, stem + '.cjs'), 'utf8');
  const sandboxSide = /enterSandbox|newSandboxFile|__sandboxPaper|verilog-viz-sandbox|clickActivity|activity-btn/.test(s);
  const compileSide = /fileStore|__djsDebug|waitCompiled|compileVerilog|编译/.test(s);
  if (sandboxSide && !compileSide) sand.push(stem);
  else if (compileSide && !sandboxSide) comp.push(stem);
  else if (sandboxSide && compileSide) sand.push(stem), comp.push(stem);
  else neither.push(stem);
}
console.log(`\n走根路径 58 颗的分工（两边都沾的会同时出现在两行，颗数⛔ 相加等于 58）：`);
console.log(`  沙盒侧签名命中（一行入口换 gates.html 即复活的候选）= ${sand.length} : ${sand.join(' ')}`);
console.log(`  编译侧签名命中（要 pushCompile 仿真宿主推送单）= ${comp.length} : ${comp.join(' ')}`);
console.log(`  两边都读不到签名（要逐颗人工认）= ${neither.length} : ${neither.join(' ')}`);
const counted = new Set([...sand, ...comp]);
console.log(`  对账：签名命中 ${counted.size} + 无签名 ${neither.length} = ${counted.size + neither.length}（应等于 58）`);
