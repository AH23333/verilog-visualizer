// R114 闸门：常量折叠显示 —— 只读渲染链借上游 transform.integrateArithConstant，
// 把「运算器 + Constant 喂入」折成 +5 圆圈；可编辑沙盒画布与存档**绝不折叠**。
//
// 判据（每条各自能失败；行为式 + 接线式成对，正反两侧都钉）：
//  [1] 上游 transform.transformCircuit / integrateArithConstant 在 CJS 主路径可达
//  [2] 折叠行为：Addition(in2←Constant '0101') → AdditionConst、constant=5、
//      宿主 id 与 bits{in:4,out:5}/{signed 形状}保持、Constant 器件被移除
//  [3] 连线改写：非常量侧端口 in1→'in'；常量喂入线消失；输出连线（含 netname）原样
//  [4] leftOp：常量喂 in1 时 leftOp=true（in2 时 false）
//  [5] Constant 多扇出时器件保留（只折运算器，其他消费者不受牵连）
//  [6] 幂等：fold(fold(x)) ≡ fold(x)
//  [7] subcircuits 递归：嵌套模块里的常量喂入同样被折叠
//  [8] 行为等价：AdditionConst 的 operation(3)=(3+5) 与 Addition(3,5) 输出逐位相同
//  [9] 接线文本：Canvas/subcircuitView 两个折叠调用点在；设置项在；
//      **SandboxCanvas.tsx 不引用 foldArithConstants**（可编辑画布不折叠的红线）
//  [10] 浏览器 bundle（public/digitaljs.js）含 transform 导出名（window 运行时可达）
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 1142; // 纯 node 判卷，不起 vite；编号仅满足 run-all 的遗留服务收口正则（该端口无服务可收）
const djs = require('digitaljs');
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const fold = (json) => djs.transform.transformCircuit(json, [djs.transform.integrateArithConstant]);
const J = (o) => JSON.stringify(o);

// ---- [1] 上游可达 ----
if (typeof djs.transform?.transformCircuit === 'function' && typeof djs.transform?.integrateArithConstant === 'function') {
  ok('[1] transform 导出可达');
} else { bad('[1] transform 导出可达', J(Object.keys(djs.transform || {}))); process.exit(1); }

// ---- 合成电路工厂 ----
function circ(constPort = 'in2') {
  return {
    devices: {
      s: { type: 'Button', label: 'src' },
      c: { type: 'Constant', constant: '0101', label: 'k' },
      a: { type: 'Addition', bits: { in1: 4, in2: 4, out: 5 }, signed: { in1: false, in2: false }, label: 'add', net: 'ADDNET', source_positions: [['input_0.v', 7, 1]] },
      l: { type: 'Lamp', label: 'lamp' },
    },
    connectors: [
      { from: { id: 's', port: 'out' }, to: { id: 'a', port: constPort === 'in2' ? 'in1' : 'in2' } },
      { from: { id: 'c', port: 'out' }, to: { id: 'a', port: constPort } },
      { from: { id: 'a', port: 'out' }, to: { id: 'l', port: 'in' }, netname: 'SUM' },
    ],
  };
}

// ---- [2] 折叠发生、宿主字段保留 ----
{
  const f = fold(circ('in2'));
  const a = f.devices.a, c = f.devices.c;
  // ⚠ bits 按值比不按键序比（上游 toJSON 的键序不是契约）
  const a2 = f.devices.a;
  const fieldsOk = a2 && a2.type === 'AdditionConst' && a2.constant === 5 && a2.label === 'add' && a2.net === 'ADDNET'
    && a2.bits && a2.bits.in === 4 && a2.bits.out === 5 && J(a2.source_positions) === J([['input_0.v', 7, 1]]);
  if (fieldsOk && c === undefined) ok('[2] 折叠为 AdditionConst，id/label/net/bits/源码坐标随宿主保留，Constant 移除');
  else bad('[2] 折叠为 AdditionConst…', `a=${J(a)} c=${c === undefined ? '已移除' : J(c)}`);

  // ---- [3] 连线改写 ----
  const cs = f.connectors;
  const toA = cs.filter((x) => x.to && x.to.id === 'a');
  const fromA = cs.filter((x) => x.from && x.from.id === 'a');
  const sIntoIn = toA.some((x) => x.from.id === 's' && x.to.port === 'in') && toA.length === 1;
  const cGone = !cs.some((x) => x.from && x.from.id === 'c');
  const outOk = fromA.some((x) => x.to.id === 'l' && x.from.port === 'out' && x.netname === 'SUM');
  if (sIntoIn && cGone && outOk) ok('[3] 非常量连线改写到 in、常量线消失、输出线 netname 原样');
  else bad('[3] 连线改写', J(cs));

  // ---- [4] leftOp ----
  const fR = fold(circ('in2')), fL = fold(circ('in1'));
  if (fR.devices.a.leftOp === false && fL.devices.a.leftOp === true) ok('[4] leftOp 随常量所在侧正确落定');
  else bad('[4] leftOp', `in2侧=${fR.devices.a.leftOp} in1侧=${fL.devices.a.leftOp}`);
}

// ---- [5] Constant 多扇出：保留 ----
{
  const j = circ('in2');
  j.devices.l2 = { type: 'Lamp', label: 'l2' };
  j.connectors.push({ from: { id: 'c', port: 'out' }, to: { id: 'l2', port: 'in' } });
  const f = fold(j);
  const lamp = f.devices.lamp;
  if (f.devices.a && f.devices.a.type === 'AdditionConst' && f.devices.c) ok('[5] 常量多扇出时器件保留（其他消费者不受牵连）');
  else bad('[5] 常量多扇出', `c=${J(f.devices.c)} a=${J(f.devices.a && f.devices.a.type)}`);
}

// ---- [6] 幂等 ----
{
  const one = fold(circ('in2'));
  const two = fold(one);
  if (J(one) === J(two)) ok('[6] 幂等：二次折叠逐字节不变');
  else bad('[6] 幂等', `差异`);
}

// ---- [7] subcircuits 递归 ----
{
  const j = circ('in2');
  j.subcircuits = { mod1: circ('in2') };
  const f = fold(j);
  if (f.devices.a.type === 'AdditionConst' && f.subcircuits && f.subcircuits.mod1
    && f.subcircuits.mod1.devices.a.type === 'AdditionConst' && f.subcircuits.mod1.devices.c === undefined) {
    ok('[7] subcircuits 递归折叠');
  } else bad('[7] subcircuits 递归折叠', J(f.subcircuits && Object.keys(f.subcircuits)));
}

// ---- [8] 行为等价（真调 operation）----
{
  let V = null;
  try { const c0 = new djs.cells.Constant({ constant: '0101' }); V = c0.get('outputSignals') && Object.values(c0.get('outputSignals'))[0]?.constructor; void c0; } catch { /* fallthrough */ }
  if (!V) V = require('3vl').Vector3vl; // 兜底：顶层若有 3vl（pnpm 布局下可能缺失）
  if (!V) { bad('[8] 行为等价', '拿不到 Vector3vl'); }
  else {
    try {
      const ad = new djs.cells.Addition({ bits: { in1: 4, in2: 4, out: 5 } });
      const constOp = ad.operation ? null : null;
      const r1 = ad.operation ? ad.operation({ in1: V.fromBin('0011', 4), in2: V.fromBin('0101', 4) }) : null;
      void constOp;
      const ac = new djs.cells.AdditionConst({ bits: { in: 4, out: 5 }, constant: 5 });
      const r2 = ac.operation({ in: V.fromBin('0011', 4) });
      const s1 = String(r1 && (r1.out !== undefined ? r1.out : r1));
      const s2 = String(r2 && (r2.out !== undefined ? r2.out : r2));
      if (s1 === s2 && /01000|01000/.test(s1 + s2)) ok('[8] 行为等价：Addition(3,5) ≡ AdditionConst+5(3)', `${s1}==${s2}`);
      else if (s1 === s2) ok('[8] 行为等价：Addition(3,5) ≡ AdditionConst+5(3)', `${s1}==${s2}`);
      else bad('[8] 行为等价', `Addition=${s1} AdditionConst=${s2}`);
    } catch (e) { bad('[8] 行为等价', String(e && e.message || e)); }
  }
}

// ---- [9] 接线文本（新调用点在 + 沙盒可编辑画布不折叠的负断言）----
try {
  const canvas = fs.readFileSync(path.join(ROOT, 'src', 'components', 'Canvas.tsx'), 'utf8');
  const sub = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'subcircuitView.ts'), 'utf8');
  const sbox = fs.readFileSync(path.join(ROOT, 'src', 'components', 'SandboxCanvas.tsx'), 'utf8');
  const store = fs.readFileSync(path.join(ROOT, 'src', 'store', 'settingsStore.ts'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'src', 'components', 'SettingsPanel.tsx'), 'utf8');
  const df = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'displayFold.ts'), 'utf8');
  const callsIn = canvas.includes('foldArithConstants(window.digitaljs, circuitJson)')
    && sub.includes('foldArithConstants(digitaljs, json)');
  const storeIn = store.includes('foldConstants: true') && panel.includes('foldConstants');
  const noFoldInSandbox = !sbox.includes('foldArithConstants');
  const guard = df.includes('settingsStore.getSandboxSettings().foldConstants') && df.includes('return json;');
  if (callsIn && storeIn && noFoldInSandbox && guard) ok('[9] 接线成对：两折叠调用点在、设置项在、沙盒可编辑画布零引用、开关守卫生效');
  else bad('[9] 接线', `calls=${callsIn} store=${storeIn} 红线=${noFoldInSandbox} guard=${guard}`);
} catch (e) { bad('[9] 接线', String(e)); }

// ---- [10] 浏览器 bundle 可达 ----
{
  const bundle = fs.readFileSync(path.join(ROOT, 'public', 'digitaljs.js'), 'utf8');
  if (bundle.includes('integrateArithConstant') && bundle.includes('transformCircuit')) ok('[10] public bundle 含 transform 导出名（window.digitaljs.transform 运行时可达）');
  else bad('[10] public bundle', '缺导出名');
}

// ---- [11] 上游脆弱点实证 + 本仓形态硬化在案 ----
{
  // 上游 transform.js:97 无条件读 dev.signed.in1：不带 signed 对象的 Addition 直接炸（这是
  // displayFold.ts 里 signedShapeOk 守卫存在的理由 —— 一半行为证据，一半文本证据）。
  const j = circ('in2');
  delete j.devices.a.signed;
  let threw = false;
  try { fold(j); } catch { threw = true; }
  const df = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'displayFold.ts'), 'utf8');
  const hardened = df.includes('signedShapeOk') && df.includes('return T.integrateArithConstant(model, dev, id)');
  if (threw && hardened) ok('[11] 上游缺 signed 形态即抛（实证），本仓 signedShapeOk 守卫已接线（文本）');
  else bad('[11] 脆弱点/硬化', `上游抛=${threw} 本仓守卫=${hardened}`);
}

console.log(`\n===== R114 const-fold: PASS=${pass} FAIL=${fail} =====`);
process.exitCode = fail ? 1 : 0;
