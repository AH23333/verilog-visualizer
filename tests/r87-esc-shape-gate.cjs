// R87 静态形状闸门：**"按 Esc 关窗"的监听不许依赖父组件现建的回调**。
//
// 真因（批次 R84 实测，不是审美问题）：`BindingDialog` 原来写成 useEffect(..., [onClose])，
//   而 `onClose={() => setBindingRows(null)}` 是父组件**每次渲染新建**的箭头函数
//   ⇒ 每渲染一次就"摘掉旧的、挂上新的"一轮；沙盒在仿真跑动时渲染很密，Esc 那一刻挂没挂上是运气。
//   现场读数：{ reached: 1, dlgStill: true } —— 事件到了 document，弹窗却没关。
//   同一个缺陷当时在 `BusWidthDialog` 里也有一份，两处都已按"回调塞进 ref ＋ 依赖表 []"修掉。
//
// 射程（这一族只有一条判据，别的都不算）：
//   同一个 useEffect 里既 `addEventListener('keydown'`、又按 `'Escape'`，
//   而**依赖表里出现 onClose / onCancel**（＝拿父组件现建的回调当依赖）⇒ 违规。
//   依赖表是 `[]` 的算"已收口"；既不含这两个回调、又不是 `[]` 的（如画布生命周期效果里注册的一批监听，
//   它们本来就该随 paper 重建）算射程外，只报数不判定。
//
// ⚠ 上一版这颗闸门把"所有 keydown 注册"都算违规（12 处），连 `Ctrl+R 旋转` 那种全局快捷键都被点名——
//   那是判据的名字没说出自己的射程（记忆里同一族教训）。这一版只按"依赖表带回调"划线。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const TOTAL_FLOOR = 13;   // 现场读数（2026-10-06，批次 R93 加了 DffPortsModal 之后）：Esc 族一共 13 处
                          // （11 处弹窗＋2 处射程外：随 paper 重建那颗、MemoryViewModal 那颗）；
                          // 低于这个数就是"把监听删了冒充修好"，不许静默变绿。

const files = fs.readdirSync(path.join(ROOT, 'src/components')).filter((f) => f.endsWith('.tsx')).map((f) => `src/components/${f}`);
function effectBlocks(src) {
  const out = [];
  for (let i = src.indexOf('useEffect('); i >= 0; i = src.indexOf('useEffect(', i + 1)) {
    let d = 0, j = i + 'useEffect'.length, inStr = null;
    for (; j < src.length; j++) {
      const c = src[j], p = src[j - 1];
      if (inStr) { if (c === inStr && p !== '\\') inStr = null; continue; }
      if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) break; }
    }
    out.push({ body: src.slice(i, j + 1), line: src.slice(0, i).split('\n').length });
  }
  return out;
}
// 依赖表＝效果体最后那段 `}, [xxx]);`
const depsOf = (body) => {
  const lines = body.replace(/\s+$/, '').split('\n');
  for (let k = lines.length - 1; k >= 0 && k >= lines.length - 4; k--) {
    const m = /^\s*\}\s*,\s*\[([^\]]*)\]\s*\)\s*;?\s*$/.exec(lines[k]);
    if (m) return m[1].trim();
  }
  return null;   // 没有依赖表（每次渲染都重挂）
};

const viol = [], fixed = [], out = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const b of effectBlocks(src)) {
    if (!/addEventListener\(\s*['"]keydown['"]/.test(b.body)) continue;
    if (!/['"]Escape['"]/.test(b.body)) continue;
    const dep = depsOf(b.body);
    const site = `${path.basename(f)}:${b.line}`;
    if (dep === null) out.push({ site, dep: '（无依赖表）' });
    else if (/onClose|onCancel/.test(dep)) viol.push({ site, dep });
    else if (dep === '') fixed.push({ site, dep: '[]' });
    else out.push({ site, dep });
  }
}
const total = viol.length + fixed.length + out.length;
console.log(`  [现场] Esc 关窗族共 ${total} 处：违规 ${viol.length}／已收口 ${fixed.length}／射程外 ${out.length}`);
for (const v of viol) console.log(`    ★违规 ${v.site} 依赖表=${J(v.dep)}`);
for (const v of fixed) console.log(`    已收口 ${v.site}`);
for (const v of out) console.log(`    射程外 ${v.site} 依赖表=${J(v.dep)}`);

(total < TOTAL_FLOOR ? bad : viol.length === 0 ? ok : bad)(
  '[1] 没有一处"按 Esc 关窗"的效果拿父组件现建的 onClose/onCancel 当依赖',
  total < TOTAL_FLOOR ? `★只扫到 ${total} 处（下界 ${TOTAL_FLOOR}）——要么锚点变了要么监听被删了，不作数`
    : viol.length ? `${viol.length} 处违规：${J(viol.map((v) => `${v.site}[${v.dep}]`))}`
      : `全部收口（已收口 ${fixed.length} 处，射程外 ${out.length} 处）`);

const sb = fs.readFileSync(path.join(ROOT, 'src/components/SandboxCanvas.tsx'), 'utf8');
(sb.includes('data-binding-dialog') && sb.includes('data-sandbox-bindings') && sb.includes('data-bus-width-dialog') ? ok : bad)(
  '[2] 反向臂：两层遮罩的 DOM 锚点都还在（不许靠删掉弹窗让静态判据变绿）',
  `绑定总览=${sb.includes('data-binding-dialog')} 入口=${sb.includes('data-sandbox-bindings')} 位宽=${sb.includes('data-bus-width-dialog')}`);

// ---- [3] 同一族第二病：⛔ 不许从自己写的文案里"认事" ----
// 现场读数（2026-10-06）：本批 V2b 中文化之前全仓**只有 1 处**——
//   `App.tsx` 里 `if (status === 'error' && /floating|looped|not started/i.test(message))`，
//   它靠英文单词认出"上一句是仿真未启动"才好清那格残留错误态。把那句翻成中文后它**永远不命中**
//   ⇒ 一格静默失效的死代码（引擎后来跑起来了，状态条还停在"未启动仿真"）。已改成 `simBlocked` 状态位。
// 射程＝对**状态栏那句 message** 做正则/子串判定；日志与 yosys 输出不算（那是原文，不是我们写的文案）。
const proseHits = [];
const walkDir = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walkDir(path.join(d, e.name)) : (/\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
for (const rel of walkDir('src')) {
  fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((l, i) => {
    if (/\btest\(\s*(message|msg|statusText)\s*\)/.test(l) || /\b(message|msg|statusText)\.includes\(/.test(l)) {
      proseHits.push(`${rel}:${i + 1}  ${l.trim().slice(0, 76)}`);
    }
  });
}
(proseHits.length === 0 ? ok : bad)(
  '[3] 状态栏那句话不许被正则/子串反过来认事（要认事请用状态位）',
  proseHits.length ? `${proseHits.length} 处：${J(proseHits.slice(0, 4))}` : 'src 下 0 处（本批修掉的那处就是唯一一处）');

// ---- [4] 反向臂之二：这一族**不许靠删监听**变绿（下界只管总数，删一颗不痛不痒）----
// 现场读数（2026-10-06，批次 R93 之后）：已收口的 11 处分布在 10 个文件里
// （SandboxCanvas 有 2 处：绑定总览＋位宽对话框；R93 新增的 DffPortsModal 一颗）。
// 按"哪个文件该有几处"逐颗点名 —— ⛔ 不钉行号（搬动就漂），也不钉那颗效果的变量名。
const ROSTER = {
  'ConfirmDialog.tsx': 1, 'ContextMenu.tsx': 1, 'DffPortsModal.tsx': 1, 'ExamplesDialog.tsx': 1,
  'FsmTableModal.tsx': 1, 'MemPortsModal.tsx': 1, 'SandboxCanvas.tsx': 2, 'SearchDialog.tsx': 1,
  'SettingsPanel.tsx': 1, 'ShortcutsHelpDialog.tsx': 1,
};
const fixedByFile = {};
for (const v of fixed) fixedByFile[v.site.split(':')[0]] = (fixedByFile[v.site.split(':')[0]] || 0) + 1;
const rosterBad = Object.entries(ROSTER).filter(([f, n]) => (fixedByFile[f] || 0) !== n)
  .map(([f, n]) => `${f} 该 ${n} 处、实扫 ${fixedByFile[f] || 0}`);
(rosterBad.length === 0 ? ok : bad)(
  '[4] 已收口的 Esc 监听按文件点名对得上（删掉一颗就红，不许只靠总数下界）',
  rosterBad.length ? J(rosterBad) : `${Object.keys(ROSTER).length} 个文件 ${Object.values(ROSTER).reduce((a, b) => a + b, 0)} 处逐一对上`);

console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
process.exit(fail > 0 ? 1 : 0);
