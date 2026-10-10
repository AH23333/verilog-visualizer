// 沙盒画布「器件目录 / 示例 / 引擎辅助」纯函数与常量域 —— 从 SandboxCanvas.tsx 顶部分离出来，
// 只含数据表与无副作用辅助（不做任何 React / store 依赖），供组件按名导入。

import { ANNOTATION_TYPE } from './annotationCell';
import { serializePaperCells } from './sandboxSerialize';

/** 文件/文件夹名校验（与编译模式同名：`V_NAME_VALIDATE` 那一条规则，禁非法字符与空名） */
export const V_SB_NAME = (v: string): string | null =>
  !v.trim() ? '名称不能为空。'
    : /[\\/:*?"<>|]/.test(v.replace(/^\/+|\/+$/g, '')) ? '名称不能包含 \\ / : * ? " < > |'
    : null;

/** 左栏视图标题（与 App 活动栏的三个按钮一一对应） */
export const SANDBOX_PANEL_TITLE: Record<string, string> = {
  files: '文件',
  modules: '部件',
  hierarchy: '层次结构',
};

export const GATE_TYPES = ['And', 'Or', 'Not', 'Xor', 'Nand', 'Nor', 'Xnor'];
// 上游 GateX1 族（bundle @2304533..2305112）：initialize 按 `inputs` 生成 in1..inN 端口
// 并把盒体设成 60*(n/2)×32*(n/2)，而 `inputs` 在 `_unsupportedPropChanges` 名单里
// ⇒ 改扇入只能重建器件。Not 由另一个基类定义（bundle @2304405），不在这族里，也就没有扇入可改。
export const NARY_GATE_TYPES = ['And', 'Or', 'Nand', 'Nor', 'Xor', 'Xnor'];
export const IO_TYPES = ['Button', 'Clock', 'Lamp'];
// Interface ports — placed to define a custom gate's input/output pins.
export const PORT_TYPES = ['Input', 'Output'];
// 新增器件库（digitaljs 内置但此前未接入沙盒）：时序 / 运算 / 显示 / 常量。
// 有了 D 触发器才能搭真正的时序电路（此前只能拿或非门硬凑），
// 七段数码管让计数器/加法器的结果可直接读数。
export const SEQ_TYPES = ['Dff'];
// 运算：补齐除法 / 取模 / 幂 / 取负（Negation 原先被错放进「多路选择 / 移位」组）
// `UnaryPlus` 是 yosys 的 `$pos`（`assign y = +a;`）在 yosys2digitaljs 映射表里的目标类，
// 补这颗之前它是**唯一**「编译产物能出现、元件库却放不出来」的器件（对账见 r91）。
export const ARITH_TYPES = ['Addition', 'Subtraction', 'Multiplication', 'Division', 'Modulo', 'Power', 'Negation', 'UnaryPlus'];
// 显示：Display7 只能吃 8 位段码；NumDisplay 可直接读任意位宽总线的数值
export const DISPLAY_TYPES = ['Display7', 'NumDisplay'];
export const MUX_TYPES = ['Mux', 'Mux1Hot'];
// 稀疏多路选择：digitaljs 的 MuxSparse 按 `inputs`（案件值列表）＋ `default_input`
// 在构造期建出行数（r69 现场读数：inputs=['0','1','3']＋default_input=true ⇒ sel,out,in0..in3）。
// 它与 Mux/Mux1Hot 不同：**分支数由取值表决定，不由 2^sel 决定**，所以译码器/ROM 式逻辑
// 只有它能省端口（yosys2digitaljs 的 $pmux 走 Mux1Hot，铺不开稀疏案件）。
export const SPARSE_MUX_TYPES = ['MuxSparse'];
/**
 * 稀疏选择器 sel 的位宽：必须能**表示最大的那个案件值**，不是"够数行数"就行。
 * 上游 `MuxSparse.muxInput` 拿 sel 的整数去 `inputs.indexOf(...)`（bundle @2324173）
 * ⇒ 案件表 {0,2,5} 只给 2 位 sel（0..3）时，sel 根本表达不出 5，那一路永远选不中
 * （r76 第一跑就是这么红的：in2 上明明是 1100，sel 读 x、out 恒 x）。
 */
export function sparseSelBits(cases: unknown[], rows = 0): number {
  let max = 0;
  for (const c of cases || []) {
    const n = Number(typeof c === 'bigint' ? c.toString() : c);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, max + 1, rows))));
}
// 缓冲/中继：digitaljs 的 Repeater（in/out，一位默认），带 propagation 就是可见的时延元件
export const BUFFER_TYPES = ['Repeater'];
// 比较：补齐不等于 / 小于等于 / 大于等于
export const COMPARE_TYPES = ['Eq', 'Ne', 'Lt', 'Le', 'Gt', 'Ge'];
export const SHIFT_TYPES = ['ShiftLeft', 'ShiftRight'];
// 总线族：合线 / 分线 / 切片 + 位扩展（单线 → 总线的标准转换）
export const BUS_TYPES = ['BusGroup', 'BusSlice', 'BusUngroup'];
export const EXTEND_TYPES = ['ZeroExtend', 'SignExtend'];
// 归约门：总线 → 1 位（与位扩展互为逆操作，总线/单线体系闭合）
export const REDUCE_TYPES = ['AndReduce', 'OrReduce', 'XorReduce', 'NandReduce', 'NorReduce', 'XnorReduce'];
export const MEM_TYPES = ['Memory'];
// 状态机：digitaljs 的 FSM 器件（in/clk/arst/out 四端口 + 转移表 + 状态图弹窗）
export const FSM_TYPES = ['FSM'];
// 数值输入：可点击设定总线数值（总线的激励源）
export const SOURCE_TYPES = ['NumEntry'];
// 注：digitaljs 把 bits / initial / groups / slice / extend 等列为「暂不支持运行时修改」
// （直接 set 会被回滚并 console.warn）—— 这些只能靠 reconfigureCell 重建器件来改。
// 这些器件有更合适的自带尺寸（Dff 80×40、Display7 77×110、运算/比较/移位 40×40、常量 80×30），
// 不能套用 60×32 的通用尺寸，否则会被压扁。Memory 同样：端口按读/写口分组堆叠，需显式钉高度。
export const NATIVE_SIZE_TYPES = ['Dff', 'Display7', 'Addition', 'Subtraction', 'Multiplication', 'Constant',
  'Mux', 'Eq', 'Lt', 'Gt', 'ShiftLeft', 'ShiftRight', 'Negation', ...BUS_TYPES, ...MEM_TYPES,
  // 新增器件：都有各自的原生尺寸（运算 40×40、数值/扩展 80×30），套 60×32 会被压扁或拉歪
  'Division', 'Modulo', 'Power', 'Ne', 'Le', 'Ge', 'Mux1Hot',
  'NumDisplay', 'NumEntry', ...EXTEND_TYPES, 'FSM', ...FSM_TYPES,
  // 稀疏选择器：40 宽、高度按分支行数堆（与合线器同式 16*n+8），套 60×32 会把端口叠住
  ...SPARSE_MUX_TYPES,
  // 注释便签：尺寸完全由用户拖拽决定（180×76 起步），不能被通用 60×32 钳掉
  ANNOTATION_TYPE];

/** 运算器位宽：输入 N 位，输出按运算规则加宽（乘法 2N、加减 N+1 含进位/借位）防溢出 */
export function arithBits(type: string, n: number) {
  const out = type === 'Multiplication' ? n * 2
    : (type === 'Addition' || type === 'Subtraction') ? n + 1
    : type === 'Power' ? Math.min(32, n * 2)
    : n;
  return { in1: n, in2: n, out: Math.min(32, Math.max(1, out)) };
}

/**
 * 收集画布上所有端口圆点的中心（本地坐标）—— 连线磁吸用。
 * digitaljs 的端口渲染为 <g class="joint-port-body" port="..."> 内含 <circle class="port">，
 * 圆点本身只有几像素，直接用 DOM 命中测试要求鼠标非常精准，磁吸就是要摆脱这个。
 */
export function collectPortDots(paper: any, onlyCellId?: string) {
  const dots: any[] = [];
  for (const el of paper.model.getElements()) {
    if (onlyCellId && String(el.id) !== onlyCellId) continue;
    const view = paper.findViewByModel(el);
    if (!view?.el) continue;
    const bodies = view.el.querySelectorAll('.joint-port-body');
    for (const body of Array.from(bodies) as any[]) {
      const portId = body.getAttribute?.('port');
      if (!portId) continue;
      const dot = body.querySelector('circle.port') || body;
      const r = dot.getBoundingClientRect?.();
      if (!r || (!r.width && !r.height)) continue;
      const c = paper.clientToLocalPoint(r.left + r.width / 2, r.top + r.height / 2);
      const p = typeof el.getPort === 'function' ? el.getPort(portId) : null;
      dots.push({ cellId: String(el.id), portId, x: c.x, y: c.y, dir: p?.dir, bits: p?.bits, body });
    }
  }
  return dots;
}

/** 在屏幕坐标附近找最近的端口（radiusPx 是屏幕像素，按缩放换算到本地坐标） */
export function nearestPortDot(paper: any, dots: any[], clientX: number, clientY: number,
  radiusPx: number, accept?: (d: any) => boolean) {
  const local = paper.clientToLocalPoint(clientX, clientY);
  const scale = paper.scale().sx || 1;
  const rLocal = radiusPx / scale;
  let best: any = null;
  let bestD = rLocal;
  for (const d of dots) {
    if (accept && !accept(d)) continue;
    const dist = Math.hypot(d.x - local.x, d.y - local.y);
    if (dist <= bestD) { bestD = dist; best = d; }
  }
  return best;
}

/** Memory 端口行数：每个读/写口 2 行（addr+data），带 clk/en/arst/srst 的再加一行 */
export function memPortRows(args: any) {
  const rowsOf = (p: any) => 2 + ['clock_polarity', 'enable_polarity', 'arst_polarity', 'srst_polarity']
    .filter(k => k in p).length;
  return (args.rdports || []).reduce((n: number, p: any) => n + rowsOf(p), 0)
       + (args.wrports || []).reduce((n: number, p: any) => n + rowsOf(p), 0);
}

/** 部件中文名（侧栏显示用，模型 type 仍为英文） */
export const CN_NAME: Record<string, string> = {
  And: '与门', Or: '或门', Not: '非门', Xor: '异或门', Nand: '与非门', Nor: '或非门', Xnor: '同或门',
  Button: '按钮', Clock: '时钟', Lamp: '指示灯', Input: '输入引脚', Output: '输出引脚',
  Subcircuit: '自定义门',
  Dff: 'D 触发器', Constant: '常量',
  Addition: '加法器', Subtraction: '减法器', Multiplication: '乘法器',
  Division: '除法器', Modulo: '取模', Power: '幂运算',
  Display7: '七段数码管', NumDisplay: '数值显示', NumEntry: '数值输入',
  Mux: '多路选择器', Mux1Hot: '独热选择器', MuxSparse: '稀疏选择器', Repeater: '缓冲器',
  Eq: '相等比较', Ne: '不等比较', Lt: '小于比较', Le: '小于等于', Gt: '大于比较', Ge: '大于等于',
  ShiftLeft: '左移', ShiftRight: '右移', Negation: '取负',
  BusGroup: '合线器', BusSlice: '总线切片', BusUngroup: '分线器',
  ZeroExtend: '零扩展', SignExtend: '符号扩展',
  AndReduce: '与归约', OrReduce: '或归约', XorReduce: '异或归约',
  NandReduce: '与非归约', NorReduce: '或非归约', XnorReduce: '同或归约',
  Memory: '存储器 (RAM)', FSM: '状态机',
};

// 位宽敏感器件的显示后缀（部件名旁标注当前位宽，专业且不占版面）
export const bitsSuffix = (cell: any) => {
  const b = cell?.get?.('bits');
  if (b == null) return '';
  if (typeof b === 'number') return `[${b}]`;
  const ext = cell?.get?.('extend');
  if (ext) return `[${ext.input}→${ext.output}]`;
  return '';
};

// 「输入 / 输出」与「端口」合并为一组；并移除「按钮」——它的功能与「输入引脚」完全重叠
// （都是可点击切换的电平源），输入引脚还能直接作为自定义门端口，保留按钮只会造成困惑。
// 注意两点：
//  1) IO_TYPES 仍保留 Button：它还承担 spawnCell 里的尺寸/自动缩放逻辑，且历史存档里
//     可能仍有 Button 器件，需要继续能正确渲染。调色板只是不再提供它。
//  2) Input/Output 必须保持 30×30 端口尺寸，因此不能并入 IO_TYPES。
// 器件库条目：type 决定实例化哪个 digitaljs 类，extra 是构造期参数（用于同一类的不同变体）
export type PaletteItem = { type: string; label?: string; extra?: Record<string, any> };
const P = (type: string, extra?: Record<string, any>, label?: string): PaletteItem => ({ type, extra, label });
export const PALETTE: { group: string; items: PaletteItem[] }[] = [
  { group: '逻辑门', items: [...GATE_TYPES.map(t => P(t)), ...BUFFER_TYPES.map(t => P(t))] },
  { group: '输入 / 输出', items: ['Clock', 'Lamp', ...PORT_TYPES, 'Constant', ...SOURCE_TYPES].map(t => P(t)) },
  // 时序：基础 D 触发器 + 带使能/异步复位的寄存器（真做时序电路离不开 EN/ARST）
  { group: '时序', items: [...SEQ_TYPES.map(t => P(t)), P('Dff', { polarity: { clock: 1, enable: 1, arst: 1 } }, '寄存器 EN/RST'), ...FSM_TYPES.map(t => P(t))] },
  { group: '运算', items: ARITH_TYPES.map(t => P(t)) },
  { group: '比较', items: COMPARE_TYPES.map(t => P(t)) },
  { group: '选择 / 移位', items: [...MUX_TYPES.map(t => P(t)), P('MuxSparse', { inputs: ['0', '1'], default_input: false, bits: { in: 4, sel: 1 } }), ...SHIFT_TYPES.map(t => P(t))] },
  // 总线：位扩展（单线→总线）+ 合/分线 + 切片（总线→单线）+ 归约（总线→1 位）
  { group: '总线', items: [...EXTEND_TYPES, ...BUS_TYPES, ...REDUCE_TYPES].map(t => P(t)) },
  { group: '存储', items: MEM_TYPES.map(t => P(t)) },
  { group: '显示', items: DISPLAY_TYPES.map(t => P(t)) },
];

// 内置示例电路（教学演示）。JSON 与 serializePaper 输出同构，直接走 loadCells 管线
// （追加进当前画布，不覆盖已有内容）。端口 id 已按 digitaljs 实测：
// 门 in1/in2/out、Dff in/out/clk、Not in/out、Lamp in、Clock out。
const g = (id: string, type: string, x: number, y: number, extra?: Record<string, any>) =>
  ({ id, type, position: { x, y }, bits: 1, ...extra });
const w = (src: string, sp: string, tgt: string, tp: string, n: number) =>
  ({ isLink: true, source: { id: src, port: sp }, target: { id: tgt, port: tp }, netname: `N${n}` });

/** 半加器：A⊕B=和 S，A·B=进位 C */
const HALF_ADDER_CELLS = [
  g('exA', 'Input', 120, 140), g('exB', 'Input', 120, 280),
  g('exXor', 'Xor', 340, 150), g('exAnd', 'And', 340, 310),
  g('exLs', 'Lamp', 560, 150), g('exLc', 'Lamp', 560, 310),
  w('exA', 'out', 'exXor', 'in1', 1), w('exB', 'out', 'exXor', 'in2', 2),
  w('exA', 'out', 'exAnd', 'in1', 3), w('exB', 'out', 'exAnd', 'in2', 4),
  w('exXor', 'out', 'exLs', 'in', 5), w('exAnd', 'out', 'exLc', 'in', 6),
];

/** 4 位二进制纹波计数器：每级 D 触发器接成 T 触发器（\bar{Q}→D），Q 作为下级时钟。
 *  Dff 必须带 initial:'0'：initial 默认 x，而 D = Not(Q)=Not(x)=x，反馈环含存储元件时
 *  组合播种无法自举，输出会永远锁死在 x。 */
const COUNTER_CELLS = [
  // Clock 默认 propagation=100（半周期约 1 秒）→ 计数器 2 秒才走一格，演示太慢；
  // 25 ≈ 0.25 秒半周期，肉眼可见地连续计数。
  g('exClk', 'Clock', 60, 320, { propagation: 25 }),
  ...[0, 1, 2, 3].flatMap((i) => [
    g(`exD${i}`, 'Dff', 300, 120 + i * 150, { initial: '0' }),
    g(`exN${i}`, 'Not', 500, 60 + i * 150),
    g(`exL${i}`, 'Lamp', 680, 120 + i * 150),
  ]),
  w('exClk', 'out', 'exD0', 'clk', 1),
  w('exD0', 'out', 'exN0', 'in', 2), w('exN0', 'out', 'exD0', 'in', 3),
  w('exD0', 'out', 'exD1', 'clk', 4),
  w('exD1', 'out', 'exN1', 'in', 5), w('exN1', 'out', 'exD1', 'in', 6),
  w('exD1', 'out', 'exD2', 'clk', 7),
  w('exD2', 'out', 'exN2', 'in', 8), w('exN2', 'out', 'exD2', 'in', 9),
  w('exD2', 'out', 'exD3', 'clk', 10),
  w('exD3', 'out', 'exN3', 'in', 11), w('exN3', 'out', 'exD3', 'in', 12),
  w('exD0', 'out', 'exL0', 'in', 13), w('exD1', 'out', 'exL1', 'in', 14),
  w('exD2', 'out', 'exL2', 'in', 15), w('exD3', 'out', 'exL3', 'in', 16),
];

// BCD→七段译码表：Display7 位序实测为 bit7=dp, bit6=a … bit0=g（MSB 在前）。
// 0-9 的段码（dp=0），10-15 显示熄灭（全 0）。存进 Memory 组合读 —— 比门阵列译码优雅得多。
const SEVEN_SEG_TABLE: string[] = [
  '01111110', '00110000', '01101101', '01111001', '00110011',
  '01011011', '01011111', '01110000', '01111111', '01111011',
  '00000000', '00000000', '00000000', '00000000', '00000000', '00000000',
];

/** 数字钟：时钟 → 4 级 T 触发器计数 → 合总线 → Memory 组合读（段码表）→ 七段数码管 */
const SEVEN_SEG_CELLS: any[] = (() => {
  const cells: any[] = [
    g('exClk', 'Clock', 40, 420, { propagation: 25 }),
    // 组合读 ROM：4 位地址（计数值）→ 8 位段码。rdports 元素不含 clock_polarity 即异步读，无写口。
    g('exMem', 'Memory', 760, 200, { bits: 8, abits: 4, rdports: [{}], wrports: [], memdataInit: SEVEN_SEG_TABLE }),
    g('exDisp', 'Display7', 980, 180, { bits: 8 }), // 必须显式 8：g() 默认 bits:1 会被 loadCells 事后 set('bits') 重建端口成 1 位 → 连线位宽 warning → digitaljs 停整个引擎（R28）
    g('exBus', 'BusGroup', 620, 240, { size: { width: 40, height: 16 * 4 + 8 } }),
  ];
  for (let i = 0; i < 4; i++) {
    cells.push(
      g(`exD${i}`, 'Dff', 280, 120 + i * 150, { initial: '0' }),
      g(`exN${i}`, 'Not', 460, 60 + i * 150),
    );
  }
  const wires: any[] = [
    w('exClk', 'out', 'exD0', 'clk', 1),
  ];
  for (let i = 0; i < 4; i++) {
    wires.push(
      w(`exD${i}`, 'out', `exN${i}`, 'in', 2 + i * 3),
      w(`exN${i}`, 'out', `exD${i}`, 'in', 3 + i * 3),
      w(`exD${i}`, 'out', `exBus`, `in${i}`, 4 + i),
    );
    if (i < 3) wires.push(w(`exD${i}`, 'out', `exD${i + 1}`, 'clk', 16 + i));
  }
  wires.push(w('exBus', 'out', 'exMem', 'rd0addr', 20));
  wires.push(w('exMem', 'rd0data', 'exDisp', 'in', 21));
  return [...cells, ...wires];
})();
export const SANDBOX_EXAMPLES: { name: string; cells: any[] }[] = [
  { name: '半加器', cells: HALF_ADDER_CELLS },
  { name: '4 位二进制计数器', cells: COUNTER_CELLS },
  { name: '数字钟（计数器 + 译码 + 数码管）', cells: SEVEN_SEG_CELLS },
];
// 数字钟（SEVEN_SEG_CELLS）R28 已修复上线：根因是 Memory 构造属性必须叫 memdata
// （不是自造的 memdataInit），否则 Mem3vl 全 x 初始化、组合读恒 x。BusGroup 引擎调度
// 经 headless 双场景验证无罪（r28-headless.cjs）。诊断史见 memory 2026-10-02 第 19 轮。
// 插入示例的批号计数器（id 后缀：exA_1、exA_2…）
export let EXAMPLE_SEQ = 0;

export interface DrcIssue { linkId: string; msg: string }

// buildInnerGraph 在 src/lib/subcircuit.ts（R34）；loadCells 在 src/lib/sandboxLoad.ts；
// 展开图渲染管线在 src/lib/subcircuitView.ts（R35，与编译模式钻取同源）。
/**
 * Input/Output 引脚位宽变化后，digitaljs 的 change:bits 处理器会把输出重置为 x 向量，
 * 而多位 x 向量无法通过点击解出（toggleInput 对 x 向量点击无效，实测 2 位 Input
 * 点击三次仍是 xx）——引脚从此变成「死引脚」。这里把输出重置为 n 位 0，
 * 让点击循环从 0 开始（0→1→2→…→2^n-1→x→0）。
 */
export function resetIoOutput(cell: any) {
  const o = cell.get && cell.get('outputSignals');
  const v = o && (o.out ?? Object.values(o)[0]);
  if (!v || typeof v !== 'object') return;
  const V = v.constructor;
  const bits = Number(cell.get('bits')) || 1;
  try {
    if (typeof V.zeros === 'function') cell.set('outputSignals', { out: V.zeros(bits) });
  } catch { /* ignore */ }
}

/**
 * 把存档里的内存快照（memdataInit：每字一个二进制串）回写到运行中的 Memory gate。
 * digitaljs 的 cell 即 gate（cell.memdata 是 Mem3vl 实例），逐字 set 即生效；
 * 不能走 memdata 属性 —— initialize 会 removeProp('memdata')，prepare 也读不到。
 */
export function restoreMemoryData(getPaper: () => any, attempt = 0) {
  const paper = getPaper();
  if (!paper) return;
  let pending = false;
  const log: any = (window as any).__restoreLog = (window as any).__restoreLog || [];
  for (const c of paper.model.getCells()) {
    if (c.get?.('type') !== 'Memory') continue;
    const init = c.get('memdataInit');
    if (!init) continue;
    const mem = c.memdata;
    // circuit.start() 返回时 gate 的 prepare 可能尚未跑（memdata 未建）—— 安排延迟重试。
    // 闭包持 getPaper 而非 paper：重试时永远写「当前」paper（重建会换新 paper，旧引用已废弃）。
    if (!mem) { pending = true; log.push({ attempt, pending: 'no-memdata' }); continue; }
    try {
      const v0 = mem.get(0);
      const Ctor = v0.constructor; // Vector3vl（未导出，从实例取）
      const nBits = Number(c.get('bits')) || 1;
      // 单字粒度 try：一个坏字（如 'x' 传入 fromBin 抛错）不能中断整块回写
      init.forEach((bin: string, addr: number) => {
        if (typeof bin !== 'string') return;
        try {
          if (/x/i.test(bin)) {
            if (typeof Ctor.xes === 'function') mem.set(addr, Ctor.xes(nBits));
            return;
          }
          mem.set(addr, Ctor.fromBin(bin, nBits));
        } catch (e: any) { log.push({ attempt, addr, err: String(e).slice(0, 60) }); }
      });
      c.trigger('manualMemChange', c);
      log.push({ attempt, word1: String(mem.get(1)).replace('Vector3vl ', '') });
    } catch (e: any) { log.push({ attempt, outerErr: String(e).slice(0, 80) }); }
  }
  if (pending && attempt < 10) {
    setTimeout(() => { try { restoreMemoryData(getPaper, attempt + 1); } catch { /* ignore */ } }, 300);
  }
}

/**
 * 冲刷 digitaljs 引擎里「过期」的传播事件片。
 * digitaljs 的 updateGates() 只在 _pq.peek() === _tick 精确相等时消费队列；
 * loadCells / 插入示例会在**同一次 tick 处理期间**批量添加器件与连线，
 * 由此产生的传播事件被 _enqueue 排到「刚被 poll 掉的旧时间片」上 ——
 * tick 单调递增后这些片永久滞留，gate 的 operation 永不执行，
 * 表现为「输入有信号、输出恒 x」（数字钟示例的 BusGroup 即此症状）。
 * updateGatesNext() 会 poll 最小片并处理（对过期片仅 console.assert 警告，不中断），
 * 循环调用直到队列回到当前 tick。
 */
export function flushStaleQueue(getCircuit: () => any, guard = 0) {
  const circuit = getCircuit();
  const eng = circuit?._engine;
  if (!eng?._pq || typeof eng._pq.peek !== 'function' || typeof eng.updateGatesNext !== 'function') return;
  const log: any[] = (window as any).__flushLog = (window as any).__flushLog || [];
  try {
    const peek = eng._pq.peek();
    if (peek == null || peek >= eng._tick || guard > 60) {
      log.push({ guard, peek: String(peek), tick: eng._tick, action: 'return' });
      return;
    }
    log.push({ guard, peek: String(peek), tick: eng._tick, action: 'flush' });
    eng.updateGatesNext();
    flushStaleQueue(getCircuit, guard + 1);
  } catch (e: any) { log.push({ err: String(e).slice(0, 80) }); }
}

export function pickDefinedVector(digitaljs: any, paper: any) {
  for (const c of paper.model.getCells()) {
    if (typeof c.isLink === 'function' && c.isLink()) continue;
    const o = c.get('outputSignals');
    if (!o) continue;
    const v = o.out ?? Object.values(o)[0];
    if (v && typeof v === 'object' && String(v).indexOf('x') === -1) return v;
  }
    try {
      const tmp = new digitaljs.cells.Input({ bits: 1 });
      const v = tmp.get('outputSignals')?.out;
      if (v && String(v).indexOf('x') === -1) return v;
    } catch { /* ignore */ }
  // 兜底：电路里可能全是 x（例如只有交叉耦合的门），此时拿任意一个向量对象的
  // 构造函数（Vector3vl）自己造一个 0 —— digitaljs 并没有导出 Vector3vl，
  // 但实例上有 constructor，配合 zeros/fromNumber 即可构造。
  for (const c of paper.model.getCells()) {
    const o = c.get && c.get('outputSignals');
    const v = o && (o.out ?? Object.values(o)[0]);
    if (!v || typeof v !== 'object') continue;
    const V = v.constructor;
    try {
      if (typeof V.zeros === 'function') return V.zeros(1);
      if (typeof V.fromNumber === 'function') return V.fromNumber(0, 1);
      if (typeof V.make === 'function') return V.make(1, 0);
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * 给逻辑门输出播种确定值 0。
 * 三值逻辑下，交叉耦合的门（用或非门搭锁存器 / D 触发器）初始输入全是 x，
 * NOR(x,x)=x，反馈环会永远锁在「未定义」，灯一直是灰的、电路像没跑起来。
 * 播种后：(n1,n2) 从 (0,0) 出发会收敛到稳定的 (1,0)，反馈环得以自举。
 * 对普通组合逻辑无副作用——引擎会立刻按真实输入重算输出。
 */
export function seedGateOutputs(digitaljs: any, paper: any) {
  const zero = pickDefinedVector(digitaljs, paper);
  if (!zero) return;
  // 被连线驱动的输入端口集合
  const driven = new Set<string>();
  paper.model.getLinks().forEach((l: any) => {
    const t = l.get('target');
    if (t && t.id) driven.add(`${t.id}|${t.port}`);
  });
  paper.model.getCells().forEach((c: any) => {
    if (typeof c.isLink === 'function' && c.isLink()) return;
    if (!GATE_TYPES.includes(c.get('type'))) return;
    const o = c.get('outputSignals');
    const v = o && (o.out ?? Object.values(o)[0]);
    // 只给输出仍为「未定义 x」的门播种，绝不覆盖已经锁存下来的确定状态，
    // 否则每次提交都会把正在保持的锁存值冲掉。
    if (!v || String(v).indexOf('x') !== -1) {
      try { c.set('outputSignals', { out: zero }); } catch { /* ignore */ }
    }
    // 悬空（未连线）输入默认为 0。否则 NOR(悬空=x, 另一路=0) 仍是 x，
    // 交叉反馈环依旧解不开——用户只把两个或非门互连时正是这种情况。
    try {
      const ports = (c.getPorts?.() || []).filter((p: any) => p.dir === 'in' || p.group === 'in');
      if (!ports.length) return;
      const ins = { ...(c.get('inputSignals') || {}) };
      let changed = false;
      ports.forEach((p: any) => {
        if (driven.has(`${c.id}|${p.id}`)) return;
        const cur = ins[p.id];
        if (!cur || String(cur).indexOf('x') !== -1) { ins[p.id] = zero; changed = true; }
      });
      if (changed) c.set('inputSignals', ins);
    } catch { /* ignore */ }
  });
}

// (R13) Serialize the paper to a clean JSON. The live Subcircuit `graph` is a circular
// joint.dia.Graph that breaks JSON.stringify, so we drop it and keep only the serializable
// `subcircuitGraph` copy.
export function serializePaper(paper: any) {
  // delegates to the shared whitelist builder (src/lib/sandboxSerialize.ts)
  return serializePaperCells(paper);
}

/**
 * Restore a serialized graph into a paper. `id` MUST be passed at construction time:
 * mutating `cell.set('id', …)` afterwards leaves the already-rendered view carrying the
 * OLD `model-id`, which silently breaks findView() and hit-testing.
 */
// loadCells 已抽至 src/lib/sandboxLoad.ts（R35）：文件装载 / 示例插入 /
// 粘贴复制电路三个消费方共用一条实现，并支持 id 重映射与位置偏移。