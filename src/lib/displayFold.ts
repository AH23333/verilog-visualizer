// R114 常量折叠显示 —— 借用 digitaljs 自家的展示变换（transform.integrateArithConstant）
// 把「二元运算 + Constant 喂入」折叠成融合常量运算器（`+5`、`==10` 圆圈符号），与 OpenCircuits 观感对齐。
//
// 安全边界（加法式设计：开关关闭 / 上游缺失时**原样返回输入对象**，逐字节回归现状）：
//  - 只作用在「只读渲染 JSON」：编译主视图（Canvas）与展开图/子模块钻取（subcircuitView）；
//  - 沙盒**可编辑画布从不经过这里**（走 spawnCell/loadCells 的 joint cells，R37 可编辑红线不破）；
//  - 上游折叠保持宿主器件 id 与全部自有参数（cloneDeep），另一操作数连线改写到端口 'in'
//    ⇒ 点选跳源码、代码行高亮（source_positions 按 id）不受伤害；
//  - 任何一环异常 → 放弃折叠渲染原图，绝不因折叠失败白屏。
import { settingsStore } from '../store/settingsStore';

/** 上游 arith_constant 表的定义域（transform.js:56）——决定「值不值得跑一次折叠」的前置快扫 */
const FOLDABLE = new Set(['Addition', 'Subtraction', 'Multiplication', 'Division', 'Modulo', 'Power', 'ShiftLeft', 'ShiftRight', 'Lt', 'Le', 'Gt', 'Ge', 'Eq', 'Ne']);

/** 上游 transform.js:97 **无条件**读 `dev.signed.in1`；编译产物带 signed 对象，但手绘电路
 *  反向导出的 circuit JSON 可能没有 —— 一颗炸会拖垮整个模块的折叠，这里按形态逐个放行。 */
function signedShapeOk(dev: any): boolean {
  const s = dev?.signed;
  return !!s && typeof s === 'object' && s.in1 != null && s.in2 != null;
}

/** R114 热修 v2（2026-10-08 用户报「内部电路渲染错误」，首版守卫只查顶层被推翻）：
 * 上游 CircuitModel 的器件表只存 cloneDeep(dev)——**Subcircuit 实例的内嵌 graph 进不了
 * 模型**，toJSON 往返后该实例只剩 celltype 空壳；嵌套模块一旦过 fold 链，钻取第二层起
 * 报「该子部件没有可渲染的内部电路」。且 renderCircuitView 的 fold 只作用顶层，
 * subcircuits 深处若还有 Subcircuit 实例，同样会在再下钻时丢 body。
 * 守卫因此**递归全层级**：任何一层存在子模块结构 → 整棵电路不折叠（宁可少圆圈观感）。 */
function hasSubcircuitLayer(mod: any, seen = new Set<object>()): boolean {
  if (!mod || typeof mod !== 'object' || seen.has(mod)) return false;
  seen.add(mod);
  for (const d of Object.values<any>(mod.devices || {})) {
    if (String(d?.type || '') === 'Subcircuit') return true;
    if (d?.graph?.cells || d?.subcircuitGraph?.cells) return true; // 内嵌快照式实例
  }
  for (const s of Object.values<any>(mod.subcircuits || {})) {
    if (hasSubcircuitLayer(s, seen)) return true;
  }
  return false;
}

/** 全层级（含 subcircuits）找「Constant + 可折运算」对；没有就直接跳过上游变换 */
function scan(mod: any, st: { hasConst: boolean; hasOp: boolean }): void {
  const devs = mod?.devices;
  if (devs && typeof devs === 'object') {
    for (const d of Object.values(devs) as any[]) {
      if (d?.type === 'Constant') st.hasConst = true;
      else if (d?.type && FOLDABLE.has(String(d.type)) && signedShapeOk(d)) st.hasOp = true;
      if (st.hasConst && st.hasOp) return;
    }
  }
  const subs = mod?.subcircuits;
  if (subs && typeof subs === 'object') {
    for (const s of Object.values(subs) as any[]) { scan(s, st); if (st.hasConst && st.hasOp) return; }
  }
}

/** 只读渲染入口统一调用：返回折叠后的**新对象**；不需要折叠时返回原引用 */
export function foldArithConstants(digitaljs: any, json: any): any {
  if (!json || typeof json !== 'object' || !json.devices) return json;
  if (!settingsStore.getSandboxSettings().foldConstants) return json;
  const st = { hasConst: false, hasOp: false };
  scan(json, st);
  if (!st.hasConst || !st.hasOp) return json;
  if (hasSubcircuitLayer(json)) return json; // 热修：带子模块的电路不折叠（模块体会被上游 toJSON 拍平丢失）
  const T = digitaljs?.transform;
  if (!T || typeof T.transformCircuit !== 'function' || typeof T.integrateArithConstant !== 'function') return json;
  try {
    const foldOne = (model: any, dev: any, id: string): boolean => {
      if (FOLDABLE.has(String(dev?.type)) && !signedShapeOk(dev)) return false; // 形态缺 signed 对象：跳过这颗，别拖垮整模块
      return T.integrateArithConstant(model, dev, id);
    };
    const folded = T.transformCircuit(json, [foldOne]);
    if (!folded || typeof folded !== 'object' || !folded.devices) return json;
    return folded;
  } catch { return json; }
}

// DEV 暴露（真机取证用，与 __sandboxPaper 系同性质）：浏览器里可拿真实电路 JSON 直接验折叠
try {
  if (typeof import.meta === 'object' && (import.meta as any).env?.DEV && typeof window !== 'undefined') {
    (window as any).__foldArithConstants = foldArithConstants;
  }
} catch { /* 构建环境不暴露则跳过 */ }
