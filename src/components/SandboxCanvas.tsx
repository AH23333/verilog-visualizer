import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { serializePaperCells, serializeGraphCells } from '../lib/sandboxSerialize';
import { buildInnerGraph } from '../lib/subcircuit';
import { circuitJsonToCells } from '../lib/subcircuitView';
import { loadCells } from '../lib/sandboxLoad';
import SandboxExpandModal from './SandboxExpandModal';
import { sandboxStore, customGateStore, baseName, type SandboxFile, type CustomGate } from '../store/sandboxStore';
import {
  saveGateFromCellsToFolder, ensureDefsFromCells, stripBoundInlineJson, migrateLegacy,
  resolveDefCells, savePartFile, renamePartDef, rebindLiveGraph,
} from '../lib/gateSystem';
import SandboxFileTree, { type RenameTarget, type CreateTarget } from './SandboxFileTree';
import { settingsStore, type SandboxSettings } from '../store/settingsStore';
import { exportPng, exportSvg, exportPngDataUrl, exportSvgString } from '../utils/sandboxExport';
import { generateVerilog } from '../utils/sandboxVerilog';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import WaveformPanel from './WaveformPanel';
import { MemoryViewModal } from './MemoryViewModal';

interface Props {
  theme: 'dark' | 'light';
  onOpenSettings?: () => void;
  /** 左栏当前视图（由 App 活动栏的 文件 / 模块 / 层次结构 三个按钮驱动） */
  leftPanel?: 'files' | 'modules' | 'hierarchy';
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** 退出沙盒、回到 IDE（电路 / 代码）视图 */
  onExitSandbox?: () => void;
}

/** 左栏视图标题（与 App 活动栏的三个按钮一一对应） */
const SANDBOX_PANEL_TITLE: Record<string, string> = {
  files: '文件',
  modules: '部件',
  hierarchy: '层次结构',
};

const GATE_TYPES = ['And', 'Or', 'Not', 'Xor', 'Nand', 'Nor', 'Xnor'];
const IO_TYPES = ['Button', 'Clock', 'Lamp'];
// Interface ports — placed to define a custom gate's input/output pins.
const PORT_TYPES = ['Input', 'Output'];
// 新增器件库（digitaljs 内置但此前未接入沙盒）：时序 / 运算 / 显示 / 常量。
// 有了 D 触发器才能搭真正的时序电路（此前只能拿或非门硬凑），
// 七段数码管让计数器/加法器的结果可直接读数。
const SEQ_TYPES = ['Dff'];
// 运算：补齐除法 / 取模 / 幂 / 取负（Negation 原先被错放进「多路选择 / 移位」组）
const ARITH_TYPES = ['Addition', 'Subtraction', 'Multiplication', 'Division', 'Modulo', 'Power', 'Negation'];
// 显示：Display7 只能吃 8 位段码；NumDisplay 可直接读任意位宽总线的数值
const DISPLAY_TYPES = ['Display7', 'NumDisplay'];
const MUX_TYPES = ['Mux', 'Mux1Hot'];
// 比较：补齐不等于 / 小于等于 / 大于等于
const COMPARE_TYPES = ['Eq', 'Ne', 'Lt', 'Le', 'Gt', 'Ge'];
const SHIFT_TYPES = ['ShiftLeft', 'ShiftRight'];
// 总线族：合线 / 分线 / 切片 + 位扩展（单线 → 总线的标准转换）
const BUS_TYPES = ['BusGroup', 'BusSlice', 'BusUngroup'];
const EXTEND_TYPES = ['ZeroExtend', 'SignExtend'];
// 归约门：总线 → 1 位（与位扩展互为逆操作，总线/单线体系闭合）
const REDUCE_TYPES = ['AndReduce', 'OrReduce', 'XorReduce', 'NandReduce', 'NorReduce', 'XnorReduce'];
const MEM_TYPES = ['Memory'];
// 数值输入：可点击设定总线数值（总线的激励源）
const SOURCE_TYPES = ['NumEntry'];
// 注：digitaljs 把 bits / initial / groups / slice / extend 等列为「暂不支持运行时修改」
// （直接 set 会被回滚并 console.warn）—— 这些只能靠 reconfigureCell 重建器件来改。
// 这些器件有更合适的自带尺寸（Dff 80×40、Display7 77×110、运算/比较/移位 40×40、常量 80×30），
// 不能套用 60×32 的通用尺寸，否则会被压扁。Memory 同样：端口按读/写口分组堆叠，需显式钉高度。
const NATIVE_SIZE_TYPES = ['Dff', 'Display7', 'Addition', 'Subtraction', 'Multiplication', 'Constant',
  'Mux', 'Eq', 'Lt', 'Gt', 'ShiftLeft', 'ShiftRight', 'Negation', ...BUS_TYPES, ...MEM_TYPES,
  // 新增器件：都有各自的原生尺寸（运算 40×40、数值/扩展 80×30），套 60×32 会被压扁或拉歪
  'Division', 'Modulo', 'Power', 'Ne', 'Le', 'Ge', 'Mux1Hot',
  'NumDisplay', 'NumEntry', ...EXTEND_TYPES];

/** 运算器位宽：输入 N 位，输出按运算规则加宽（乘法 2N、加减 N+1 含进位/借位）防溢出 */
function arithBits(type: string, n: number) {
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
function collectPortDots(paper: any, onlyCellId?: string) {
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
function nearestPortDot(paper: any, dots: any[], clientX: number, clientY: number,
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
function memPortRows(args: any) {
  const rowsOf = (p: any) => 2 + ['clock_polarity', 'enable_polarity', 'arst_polarity', 'srst_polarity']
    .filter(k => k in p).length;
  return (args.rdports || []).reduce((n: number, p: any) => n + rowsOf(p), 0)
       + (args.wrports || []).reduce((n: number, p: any) => n + rowsOf(p), 0);
}

/** 部件中文名（侧栏显示用，模型 type 仍为英文） */
const CN_NAME: Record<string, string> = {
  And: '与门', Or: '或门', Not: '非门', Xor: '异或门', Nand: '与非门', Nor: '或非门', Xnor: '同或门',
  Button: '按钮', Clock: '时钟', Lamp: '指示灯', Input: '输入引脚', Output: '输出引脚',
  Subcircuit: '自定义门',
  Dff: 'D 触发器', Constant: '常量',
  Addition: '加法器', Subtraction: '减法器', Multiplication: '乘法器',
  Division: '除法器', Modulo: '取模', Power: '幂运算',
  Display7: '七段数码管', NumDisplay: '数值显示', NumEntry: '数值输入',
  Mux: '多路选择器', Mux1Hot: '独热选择器',
  Eq: '相等比较', Ne: '不等比较', Lt: '小于比较', Le: '小于等于', Gt: '大于比较', Ge: '大于等于',
  ShiftLeft: '左移', ShiftRight: '右移', Negation: '取负',
  BusGroup: '合线器', BusSlice: '总线切片', BusUngroup: '分线器',
  ZeroExtend: '零扩展', SignExtend: '符号扩展',
  AndReduce: '与归约', OrReduce: '或归约', XorReduce: '异或归约',
  NandReduce: '与非归约', NorReduce: '或非归约', XnorReduce: '同或归约',
  Memory: '存储器 (RAM)',
};

// 位宽敏感器件的显示后缀（部件名旁标注当前位宽，专业且不占版面）
const bitsSuffix = (cell: any) => {
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
type PaletteItem = { type: string; label?: string; extra?: Record<string, any> };
const P = (type: string, extra?: Record<string, any>, label?: string): PaletteItem => ({ type, extra, label });
const PALETTE: { group: string; items: PaletteItem[] }[] = [
  { group: '逻辑门', items: GATE_TYPES.map(t => P(t)) },
  { group: '输入 / 输出', items: ['Clock', 'Lamp', ...PORT_TYPES, 'Constant', ...SOURCE_TYPES].map(t => P(t)) },
  // 时序：基础 D 触发器 + 带使能/异步复位的寄存器（真做时序电路离不开 EN/ARST）
  { group: '时序', items: [...SEQ_TYPES.map(t => P(t)), P('Dff', { polarity: { clock: 1, enable: 1, arst: 1 } }, '寄存器 EN/RST')] },
  { group: '运算', items: ARITH_TYPES.map(t => P(t)) },
  { group: '比较', items: COMPARE_TYPES.map(t => P(t)) },
  { group: '选择 / 移位', items: [...MUX_TYPES, ...SHIFT_TYPES].map(t => P(t)) },
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
const SANDBOX_EXAMPLES: { name: string; cells: any[] }[] = [
  { name: '半加器', cells: HALF_ADDER_CELLS },
  { name: '4 位二进制计数器', cells: COUNTER_CELLS },
  { name: '数字钟（计数器 + 译码 + 数码管）', cells: SEVEN_SEG_CELLS },
];
// 数字钟（SEVEN_SEG_CELLS）R28 已修复上线：根因是 Memory 构造属性必须叫 memdata
// （不是自造的 memdataInit），否则 Mem3vl 全 x 初始化、组合读恒 x。BusGroup 引擎调度
// 经 headless 双场景验证无罪（r28-headless.cjs）。诊断史见 memory 2026-10-02 第 19 轮。
// 插入示例的批号计数器（id 后缀：exA_1、exA_2…）
let EXAMPLE_SEQ = 0;


const ROUTERS: Record<string, any> = {
  metro: { name: 'metro', args: { startDirections: ['right'], endDirections: ['left'], maximumLoops: 200, step: 2.5 } },
  orthogonal: { name: 'orthogonal', args: { elementPadding: 8 } },
  straight: null,
};

interface DrcIssue { linkId: string; msg: string }

// buildInnerGraph 在 src/lib/subcircuit.ts（R34）；loadCells 在 src/lib/sandboxLoad.ts；
// 展开图渲染管线在 src/lib/subcircuitView.ts（R35，与编译模式钻取同源）。
/**
 * 取一个「确定值」向量（非 x）用作播种。digitaljs 没有导出 Vector3vl，无法直接构造，
 * 所以复用电路中已有的确定输出（Button 默认输出 0），必要时临时造一个 Button 取值。
 */
/**
 * Input/Output 引脚位宽变化后，digitaljs 的 change:bits 处理器会把输出重置为 x 向量，
 * 而多位 x 向量无法通过点击解出（toggleInput 对 x 向量点击无效，实测 2 位 Input
 * 点击三次仍是 xx）——引脚从此变成「死引脚」。这里把输出重置为 n 位 0，
 * 让点击循环从 0 开始（0→1→2→…→2^n-1→x→0）。
 */
function resetIoOutput(cell: any) {
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
function restoreMemoryData(getPaper: () => any, attempt = 0) {
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
function flushStaleQueue(getCircuit: () => any, guard = 0) {
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

function pickDefinedVector(digitaljs: any, paper: any) {
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
function seedGateOutputs(digitaljs: any, paper: any) {
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
function serializePaper(paper: any) {
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

function SandboxCanvas({ theme, onOpenSettings, leftPanel = 'files', sidebarCollapsed = false, onToggleSidebar, onExitSandbox }: Props) {
  const circuitRef = useRef<any>(null);
  const paperRef = useRef<any>(null);
  const selectionRef = useRef<Set<string>>(new Set());
  const setSelectionRef = useRef<(ids: string[]) => void>(() => {});
  const scheduleDrcRef = useRef<() => void>(() => {});
  const commitRef = useRef<() => void>(() => {});
  const clipboardRef = useRef<{ cells: any[]; links: any[] } | null>(null);
  const historyRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  const wireCountRef = useRef(0);
  const [files, setFiles] = useState<SandboxFile[]>([]);
  const [activeFile, setActiveFile] = useState<SandboxFile | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [running, setRunning] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pendingResetJsonRef = useRef<string | null>(null);
  const runningRef = useRef(true);
  const [, forceUpdate] = useState(0);
  const [gates, setGates] = useState<CustomGate[]>([]);
  // gates 的镜像 ref：菜单回调读它，避免 gates 进 useCallback 依赖。
  // 为什么不能直接依赖 gates：customGateStore.list() 每次返回新数组，refreshGates()
  // （R37 起插入示例 / 粘贴时都会调用）会让依赖 openBlankMenu 的画布重建 effect
  // 重跑 —— 刚插入的器件会被旧档 graphJson 整体冲掉（r27 回归根因）。
  const gatesRef = useRef<CustomGate[]>([]);
  gatesRef.current = gates;
  // activeFile 的镜像 ref：commit 落盘要拿当前文件 id，但不能把它进依赖
  // （否则每次切文件都换 commit 身份 → 画布重建 effect 重跑）。
  const activeFileRef = useRef<SandboxFile | null>(null);
  activeFileRef.current = activeFile;
  // 当前画布文件所在文件夹 = 部件绑定的优先作用域（R39 文件夹组织）
  const scope = useMemo(() => {
    const n = activeFile?.name || '';
    const i = n.indexOf('/');
    return i >= 0 ? n.slice(0, i) : '';
  }, [activeFile?.name]);
  const scopeRef = useRef<string>('');
  scopeRef.current = scope;
  const [savingGate, setSavingGate] = useState(false);
  const [gateName, setGateName] = useState('');
  const [gateError, setGateError] = useState<string | null>(null);
  const [deleteGateId, setDeleteGateId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; title: string; items: ContextMenuItem[] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [drc, setDrc] = useState<DrcIssue[]>([]);
  const [settings, setSettings] = useState<SandboxSettings>(() => settingsStore.getSandboxSettings());
  const [innerCell, setInnerCell] = useState<any>(null);
  // 层次结构面板里展开的自定义门 id
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  // 起线函数缓存：空白处靠近端口按下时也要能起线（见 blank:pointerdown 处理）
  const wireDragStarterRef = useRef<((cell: any, port: string, evt: any) => void) | null>(null);
  // 总线转换器「位宽方案」对话框：{ cellId, type: 'BusGroup' | 'BusUngroup' }
  const [busDlg, setBusDlg] = useState<{ cellId: string; type: string } | null>(null);
  const [busTotal, setBusTotal] = useState(8);
  const [busGroupW, setBusGroupW] = useState(1);

  const refreshList = useCallback(() => setFiles(sandboxStore.list()), []);
  const refreshGates = useCallback(() => setGates(customGateStore.list()), []);
  const showToast = useCallback((msg: string) => setToast(msg), []);

  // ---- 文件管理（与 IDE 文件系统对齐）：多选 / 剪贴板 / 重命名 / 新建 / 文件夹 ----
  const [folders, setFolders] = useState<string[]>([]);
  const [fileSelIds, setFileSelIds] = useState<Set<string>>(new Set());
  const [fileClipboard, setFileClipboard] = useState<{ ids: string[]; cut: boolean } | null>(null);
  const [fileRenaming, setFileRenaming] = useState<RenameTarget | null>(null);
  const [fileCreating, setFileCreating] = useState<CreateTarget | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const refreshFolders = useCallback(() => setFolders(sandboxStore.getFolders()), []);

  // ---- 波形监视器：与 Verilog 电路视图共用 WaveformPanel，通道 = 连线 netname ----
  const [waveOpen, setWaveOpen] = useState(false);
  const [memViewCell, setMemViewCell] = useState<any>(null);
  const waveTickRef = useRef(0);
  // 沙盒左栏可调宽度（问题 1）：160–420px，持久化到 localStorage
  const [sidebarW, setSidebarW] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem('verilog-viz-sandbox-w') || ''); return isNaN(v) ? 200 : Math.min(420, Math.max(160, v)); } catch { return 200; }
  });
  const onSidebarWDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = (document.querySelector('[data-sandbox-sidebar]') as HTMLElement | null)?.getBoundingClientRect().width ?? 200;
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(420, Math.max(160, startW + (ev.clientX - startX)));
      setSidebarW(w);
      try { localStorage.setItem('verilog-viz-sandbox-w', String(w)); } catch {}
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }, []);
  // palette 分组折叠（问题 4）：默认全部收起，点组头展开——部件太多时不再无限滚动
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(['逻辑门']));
  const toggleGroup = useCallback((name: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);
  const waveGetChannels = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return [];
    const seen = new Map<string, number>();
    try {
      for (const lk of paper.model.getLinks()) {
        const net = lk.get('netname');
        if (!net || seen.has(String(net))) continue;
        seen.set(String(net), Number(lk.get('bits')) || 1);
        if (seen.size >= 24) break;
      }
    } catch { /* ignore */ }
    return Array.from(seen.entries()).map(([name, bits]) => ({ name, bits }));
  }, []);
  const waveGetSample = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return null;
    const values: Record<string, string> = {};
    const seen = new Set<string>();
    try {
      for (const lk of paper.model.getLinks()) {
        const net = lk.get('netname');
        if (!net || seen.has(String(net))) continue;
        seen.add(String(net));
        const sig = lk.get('signal');
        values[String(net)] = sig != null ? String(sig).replace(/^Vector3vl\s+/, '') : 'x';
        if (seen.size >= 24) break;
      }
    } catch { /* ignore */ }
    // 采样序号自增：固定 60ms 间隔下即为真实时间轴
    return { tick: waveTickRef.current++, values };
  }, []);

  /**
   * 确保仿真在运行。用户与电路交互（点击输入引脚、完成连线）即意味着想看到它工作；
   * 若此时引擎处于停止状态（autoStartSim 被关掉、或误触过「运行/暂停」），
   * 电路会完全冻结 —— 门全部无输出、输入不传播，看起来就像所有逻辑门坏了。
   * 这里自动恢复运行并给出提示，避免这种「死电路」陷阱。
   */
  const ensureSimRunning = useCallback(() => {
    const circuit = circuitRef.current;
    // 用户意图是运行中，但引擎实际已停（digitaljs 在连线 warning 时会 stop 整个引擎，
    // warning 消除后无人重启 —— 表现为整个电路冻结、所有门无输出）→ 拉起来
    if (runningRef.current) {
      if (circuit?._engine && !circuit._engine.running && !(paperRef.current?.model?._warnings > 0)) {
        try { circuit.start(); } catch { /* ignore */ }
        showToast('引擎此前被连线告警停止，已自动恢复运行');
      }
      return;
    }
    runningRef.current = true;
    setRunning(true);
    try { circuitRef.current?.start(); } catch { /* ignore */ }
    showToast('仿真此前处于暂停状态，已自动恢复运行');
  }, [showToast]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => settingsStore.subscribe(() => setSettings(settingsStore.getSandboxSettings())), []);

  const gridSize = Math.max(1, settings.gridSize || 16);
  // MUST be stable: it is a dependency of the align/distribute/nudge callbacks, which are in
  // turn dependencies of the paper-building effect. Recreating it on every render makes that
  // effect re-run constantly and wipe whatever was just added.
  const snapVal = useCallback((v: number) => {
    const s = settingsStore.getSandboxSettings();
    const g = Math.max(1, s.gridSize || 16);
    return s.snapToGrid ? Math.round(v / g) * g : Math.round(v);
  }, [gridSize]);

  // Create a cell by type at given position. `id` must be supplied at construction when
  // restoring a saved graph (see loadCells).
  const spawnCell = useCallback((type: string, x: number, y: number, id?: string, extra?: Record<string, any>) => {
    const paper = paperRef.current;
    if (!paper) return null;
    const digitaljs = (window as any).digitaljs;
    const CellClass = digitaljs?.cells?.[type];
    if (!CellClass) return null;
    try {
      const bits = settingsStore.getSandboxSettings().defaultBits || 1;
      const args: any = { type, position: { x, y } };
      if (type === 'Dff') {
        // D 触发器：必须带 polarity.clock，否则没有 clk 引脚，做不了时序电路
        args.bits = bits;
        args.polarity = { clock: 1 };
      } else if (type === 'Display7') {
        args.bits = 8; // 七段数码管固定 8 位段码（a–g + dp）
      } else if (ARITH_TYPES.includes(type)) {
        // 加减乘（Arith21）的 bits 必须是 {in1,in2,out} 对象 —— 端口按 t.in1 逐位取宽，
        // 传数字会让端口位宽变成 undefined（0 位），输入成为空向量、输出恒为 0。
        // 输出位宽按运算规则加宽，避免静默溢出（乘法 2N 位、加减含进位/借位 N+1 位）。
        args.bits = type === 'Negation' ? { in: bits, out: bits } : arithBits(type, bits);
      } else if (MUX_TYPES.includes(type)) {
        // 选择器：默认 2 位 sel = 4 路输入（1 位 sel 只有 2 路，做不了像样的多路复用）
        args.bits = type === 'Mux1Hot' ? { in: bits, sel: Math.max(2, bits) } : { in: bits, sel: 2 };
      } else if (COMPARE_TYPES.includes(type)) {
        args.bits = { in1: bits, in2: bits }; // 比较器输出固定 1 位
      } else if (SHIFT_TYPES.includes(type)) {
        // 移位量端口位宽 = ceil(log2(位宽))
        args.bits = { in1: bits, in2: Math.max(1, Math.ceil(Math.log2(Math.max(2, bits)))), out: bits };
      } else if (EXTEND_TYPES.includes(type)) {
        // 位扩展：单线（1 位）→ 总线的标准转换；零扩展补 0、符号扩展补符号位
        args.extend = extra?.extend ?? { input: 1, output: Math.max(4, bits) };
      } else if (REDUCE_TYPES.includes(type)) {
        // 归约门：总线 → 1 位（与位扩展互逆）
        args.bits = Math.max(2, bits);
      } else if (type === 'NumDisplay' || type === 'NumEntry') {
        // 总线终端：直接显示/输入总线数值，位宽至少 4（1 位没意义）
        args.bits = Math.max(4, bits);
      } else if (type === 'BusGroup' || type === 'BusUngroup') {
        // 总线合/拆：端口由 groups（索引→位宽 的 Map）生成，默认 N×1 位（N = 位宽设置）。
        // 这些器件的原生 size.height 是 NaN（基类不算），必须显式给尺寸。
        const n = extra?.groups?.size ?? Math.max(4, bits);
        args.groups = extra?.groups ?? new Map(Array.from({ length: n }, (_, i) => [i, 1]));
        args.size = { width: 40, height: 16 * n + 8 };
      } else if (type === 'BusSlice') {
        // 切总线：从 total 位总线里取 [first, first+count) 一段。
        // 默认取 1 位（总线 → 单线），这是分线体系最常用的方向；total 跟随位宽设置。
        args.slice = extra?.slice ?? { first: 0, count: 1, total: Math.max(4, bits) };
        args.size = { width: 40, height: 24 };
      } else if (type === 'Memory') {
        // 存储器（RAM）：端口由 rdports/wrports 数组生成——元素含 clock_polarity 才有 clk
        // 引脚（否则写入永远不发生）。默认 8 位数据 × 3 位地址（8 字），读/写口各一带时钟。
        // （此前 bits 跟随 defaultBits=1，放出来只有 1 位数据宽，基本没法用）
        const nBits = extra?.bits ?? Math.max(8, bits);
        const abits = extra?.abits ?? 3;
        args.bits = nBits;
        args.abits = abits;
        args.rdports = extra?.rdports ?? [{ clock_polarity: 1 }];
        args.wrports = extra?.wrports ?? [{ clock_polarity: 1 }];
        // 行数按端口实际生成数算（无 clk / en / rst 的口只有 addr+data 两行）——
        // 之前一律按 3 行算，无时钟的读口（组合 ROM）会多出一行空白。
        args.size = { width: 88, height: 16 * memPortRows(args) + 8 };
      } else if (type === 'Constant') {
        args.constant = '0'.repeat(Math.max(1, bits)); // 常量的位数 = 常量字符串长度
      } else {
        args.bits = bits;
      }
      // 存档恢复：器件特有配置以存档为准（放在默认值之后合并）
      if (extra) Object.assign(args, extra);
      if (id) args.id = id;
      if (!NATIVE_SIZE_TYPES.includes(type)) {
        args.size = PORT_TYPES.includes(type) ? { width: 30, height: 30 } : { width: 60, height: 32 };
      }
      const cell = new CellClass(args);
      paper.model.addCell(cell);
      if (type === 'BusGroup' || type === 'BusUngroup') {
        // 总线合/拆的基类不算高度（原生 NaN），渲染出来只有十几像素，
        // 多个端口叠在一起 —— 拖线会落到错误端口被「单驱动」规则拒绝。
        // 按组数钉高度（16×n+8，与 BusRegroup 同式）并重排端口。
        try {
          const gn = cell.get('groups')?.size ?? 4;
          cell.prop('size/height', 16 * gn + 8);
          const ports = cell.get('ports');
          if (ports) cell.set('ports', { ...ports });
        } catch { /* ignore */ }
      }
      // digitaljs "Box" cells (Button/Lamp/Clock) and Subcircuit auto-resize themselves on
      // first render, but the port layout is computed at the ORIGINAL width and never
      // re-laid-out — leaving the port dots floating away from the (now resized) body.
      // Pin the width and force one port re-layout so body and pins finally agree.
      if (IO_TYPES.includes(type)) {
        try {
          cell.set('box_resized', true);
          if (cell.size().width !== 60) cell.prop('size/width', 60);
        } catch { /* non-box cell */ }
      }
      if (IO_TYPES.includes(type) || type === 'Subcircuit') {
        try {
          const ports = cell.get('ports');
          if (ports) cell.set('ports', { ...ports });
        } catch { /* ignore */ }
      }
      return cell;
    } catch { return null; }
  }, []);

  /** 新增部件落在当前视口中心（缩放/平移后也不会跑出视野） */
  const viewportCenter = useCallback(() => {
    const paper = paperRef.current;
    if (!paper?.el) return { x: 120, y: 120 };
    const r = paper.el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // 确定性错开，取代原先的随机抖动（Math.random()*80-40）。
    // 随机抖动最大只错开 80px，而部件模型宽度约 60px，无法保证分离 —— 连续放置的部件
    // 时好时坏地重叠，导致新部件盖住旧部件、端口拖拽落空且结果不可复现。
    // 这里按「屏幕像素」固定步长依次尝试槽位：屏幕步长恒定，所以放大时偏移量不会
    // 被缩放放大而把部件顶出可视区，同时步长(150px)恒大于部件屏幕尺寸从而避免重叠。
    const stepX = 150, stepY = 110, cols = 3;
    const occupied = (p: { x: number, y: number }) => paper.model.getCells().some((cell: any) => {
      if (typeof cell.isLink === 'function' && cell.isLink()) return false;
      const q = cell.position();
      return Math.abs(q.x - p.x) < 70 && Math.abs(q.y - p.y) < 44;
    });
    let last = { x: 120, y: 120 };
    for (let i = 0; i < cols * 2; i++) {
      const mp = paper.clientToLocalPoint(cx + (i % cols) * stepX, cy + Math.floor(i / cols) * stepY);
      const cand = { x: Math.round(mp.x), y: Math.round(mp.y) };
      if (!occupied(cand)) return cand;
      last = cand;
    }
    return last;
  }, []);

  const commit = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    // 每次改动后都尝试播种：用户边搭边连出的反馈环（或非门锁存器 / D 触发器）
    // 同样会锁在 x，只靠重建时播种一次救不了。只播种输出仍为 x 的门，安全无副作用。
    try { seedGateOutputs((window as any).digitaljs, paper); } catch { /* best effort */ }
    // 引擎自愈：digitaljs 在连线 warning 时 stop 整个引擎且永不自启。用户修好坏线
    // （warning 归零）后的任意操作都会走 commit —— 此时若运行开关仍是「开」就把引擎拉起
    try {
      const circuit = circuitRef.current;
      if (runningRef.current && circuit?._engine && !circuit._engine.running && !(paper.model._warnings > 0)) {
        circuit.start();
        showToast('引擎此前被连线告警停止，已自动恢复运行');
      }
    } catch { /* best effort */ }
    const h = historyRef.current;
    try {
      const snap = JSON.stringify(serializePaper(paper));
      if (h.stack[h.idx] !== snap) {
        h.stack = h.stack.slice(0, h.idx + 1);
        h.stack.push(snap);
        if (h.stack.length > 80) h.stack.shift();
        h.idx = h.stack.length - 1;
        forceUpdate(n => n + 1);
        // R37b：每次变更即刻落盘（此前只进撤销栈，画布内容要等切文件/切面板/
        // 卸载才持久化 —— reload 直接丢掉未切换过的内容，r34[8] 回归根因）。
        if (activeFileRef.current && activeFileRef.current.kind !== 'gate') {
          try { sandboxStore.save(activeFileRef.current.id, stripBoundInlineJson(snap, scopeRef.current)); } catch { /* best effort */ }
        }
      }
    } catch { /* ignore */ }
  }, [showToast]);

  const rebuildFromJson = useCallback((json: string) => {
    const paper = paperRef.current;
    if (!paper) return;
    const digitaljs = (window as any).digitaljs;
    setSelectionRef.current([]);
    try {
      [...paper.model.getCells()].forEach((c: any) => { try { c.remove(); } catch {} });
      loadCells(paper, digitaljs, json, spawnCell, wireCountRef, { scope: scopeRef.current });
    } catch { /* corrupted snapshot — ignore */ }
    scheduleDrcRef.current();
  }, [spawnCell]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx <= 0) { showToast('没有更早的操作了'); return; }
    h.idx -= 1;
    rebuildFromJson(h.stack[h.idx]);
    forceUpdate(n => n + 1);
  }, [rebuildFromJson, showToast]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx >= h.stack.length - 1) { showToast('没有可重做的操作'); return; }
    h.idx += 1;
    rebuildFromJson(h.stack[h.idx]);
    forceUpdate(n => n + 1);
  }, [rebuildFromJson, showToast]);

  const doAddCell = useCallback((item: PaletteItem | string) => {
    const type = typeof item === 'string' ? item : item.type;
    const extra = typeof item === 'string' ? undefined : item.extra;
    const c = viewportCenter();
    const cell = spawnCell(type, snapVal(c.x), snapVal(c.y), undefined, extra);
    void 0;
    if (cell && PORT_TYPES.includes(type)) {
      const paper = paperRef.current;
      const same = paper ? paper.model.getCells().filter((x: any) => x.get('type') === type).length : 1;
      const prefix = type === 'Input' ? 'in' : 'out';
      try { cell.set('net', `${prefix}${same}`); } catch {}
    }
    if (cell) {
      setSelectionRef.current([cell.id]);
      commitRef.current();
      // 合线器 / 分线器一放下就问位宽方案：1/2/4/8 位分组互转是它们的主用途，
      // 默认 4×1 位对多数场景都不对，放完再让用户去菜单里翻配置等于没给功能。
      if (type === 'BusGroup' || type === 'BusUngroup') {
        const groups: any = cell.get('groups');
        const widths = groups ? Array.from(groups.values()) as number[] : [1, 1, 1, 1];
        setBusTotal(widths.reduce((a, b) => a + Number(b), 0) || 4);
        setBusGroupW(Number(widths[0]) || 1);
        setBusDlg({ cellId: String(cell.id), type });
      }
    }
  }, [spawnCell, viewportCenter]);

  /** 在指定屏幕坐标处放置部件（右键菜单「放置部件」用），而不是视口中心 */
  const placeAt = useCallback((item: PaletteItem | string, clientX: number, clientY: number) => {
    const paper = paperRef.current;
    if (!paper) return;
    const type = typeof item === 'string' ? item : item.type;
    const extra = typeof item === 'string' ? undefined : item.extra;
    const p = paper.clientToLocalPoint(clientX, clientY);
    // 减去半个器件尺寸，让部件以点击点为中心
    const cell = spawnCell(type, snapVal(p.x - 30), snapVal(p.y - 16), undefined, extra);
    if (!cell) return;
    if (PORT_TYPES.includes(type)) {
      const same = paper.model.getCells().filter((x: any) => x.get('type') === type).length;
      const prefix = type === 'Input' ? 'in' : 'out';
      try { cell.set('net', `${prefix}${same}`); } catch {}
    }
    setSelectionRef.current([cell.id]);
    commitRef.current();
  }, [spawnCell, snapVal]);

  // ---- selection / clipboard / transform helpers ----

  const deleteSelection = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    const ids = [...selectionRef.current];
    if (!ids.length) return;
    for (const id of ids) {
      const c = paper.model.getCell(id);
      if (c) { try { c.remove(); } catch {} }
    }
    setSelectionRef.current([]);
    scheduleDrcRef.current();
    commitRef.current();
  }, []);

  const copySelection = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    const ids = selectionRef.current;
    if (!ids.size) return;
    const all = paper.model.getCells().filter((c: any) => !c.isLink());
    const idxOf = new Map<string, number>();
    all.forEach((c: any, i: number) => idxOf.set(c.id, i));
    const cells = all.filter((c: any) => ids.has(c.id)).map((c: any) => ({
      idx: idxOf.get(c.id),
      type: c.get('type'),
      position: c.get('position'),
      bits: c.get('bits'),
      net: c.get('net'),
      label: c.get('label'),
      celltype: c.get('celltype'),
      propagation: c.get('propagation'),
      size: c.get('size'),
      angle: c.get('angle'),
      subcircuitGraph: c.get('type') === 'Subcircuit' ? c.get('subcircuitGraph') : undefined,
    }));
    const links = paper.model.getLinks()
      .filter((l: any) => ids.has(l.get('source')?.id) && ids.has(l.get('target')?.id))
      .map((l: any) => ({
        from: idxOf.get(l.get('source').id),
        to: idxOf.get(l.get('target').id),
        fromPort: l.get('source').port,
        toPort: l.get('target').port,
      }));
    clipboardRef.current = { cells, links };
  }, []);

  const pasteClipboard = useCallback(() => {
    const paper = paperRef.current;
    const clip = clipboardRef.current;
    const digitaljs = (window as any).digitaljs;
    if (!paper || !clip || !clip.cells.length) return;
    const idMap = new Map<number, string>();
    const newIds: string[] = [];
    for (const c of clip.cells) {
      const pos = c.position || { x: 50, y: 50 };
      let cell: any = null;
      if (c.type === 'Subcircuit') {
        const Graph = (paper.model as any).constructor;
        const inner = buildInnerGraph(digitaljs, Graph, c.subcircuitGraph, paper.model._display3vl);
        cell = new digitaljs.cells.Subcircuit({
          type: 'Subcircuit', graph: inner, subcircuitGraph: serializeGraphCells(inner),
          celltype: c.celltype || '',
          position: { x: snapVal((pos.x || 50) + gridSize), y: snapVal((pos.y || 50) + gridSize) },
        });
        paper.model.addCell(cell);
        try {
          const ports = cell.get('ports');
          if (ports) cell.set('ports', { ...ports });
        } catch {}
      } else {
        cell = spawnCell(c.type, snapVal((pos.x || 50) + gridSize), snapVal((pos.y || 50) + gridSize));
      }
      if (!cell) continue;
      try { if (c.bits != null) cell.set('bits', c.bits); } catch {}
      try { if (c.net != null) cell.set('net', c.net); } catch {}
      try { if (c.label != null) cell.set('label', c.label); } catch {}
      try { if (c.propagation != null) cell.set('propagation', c.propagation); } catch {}
      try { if (c.angle) cell.set('angle', c.angle); } catch {}
      if (c.idx != null) idMap.set(c.idx, cell.id);
      newIds.push(cell.id);
    }
    for (const l of clip.links) {
      const sid = idMap.get(l.from as number);
      const tid = idMap.get(l.to as number);
      if (!sid || !tid) continue;
      try {
        paper.model.addCell(new digitaljs.cells.Wire({
          source: { id: sid, port: l.fromPort },
          target: { id: tid, port: l.toPort },
          signal: 'x', netname: `N${++wireCountRef.current}`,
        }));
      } catch { /* skip */ }
    }
    setSelectionRef.current(newIds);
    scheduleDrcRef.current();
    commitRef.current();
  }, [spawnCell, gridSize]);

  const duplicateSelection = useCallback(() => { copySelection(); pasteClipboard(); }, [copySelection, pasteClipboard]);

  const selectAll = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    setSelectionRef.current(paper.model.getCells().filter((c: any) => !c.isLink()).map((c: any) => c.id));
  }, []);

  const rotateSelection = useCallback((deg: number) => {
    const paper = paperRef.current;
    if (!paper) return;
    const ids = [...selectionRef.current].filter(id => {
      const c = paper.model.getCell(id);
      return c && !c.isLink();
    });
    if (!ids.length) return;
    for (const id of ids) {
      const c = paper.model.getCell(id);
      try { c.rotate(deg); } catch { /* unsupported */ }
    }
    commitRef.current();
  }, []);

  /** 多选对齐：left/right/hcenter/top/bottom/vcenter */
  const alignSelection = useCallback((mode: string) => {
    const paper = paperRef.current;
    if (!paper) return;
    const cells = [...selectionRef.current].map(id => paper.model.getCell(id)).filter((c: any) => c && !c.isLink());
    if (cells.length < 2) return;
    const bb = cells.map((c: any) => c.getBBox());
    const minX = Math.min(...bb.map(b => b.x));
    const maxX = Math.max(...bb.map(b => b.x + b.width));
    const minY = Math.min(...bb.map(b => b.y));
    const maxY = Math.max(...bb.map(b => b.y + b.height));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    cells.forEach((c: any) => {
      const b = c.getBBox();
      const p = c.position();
      let nx = p.x, ny = p.y;
      if (mode === 'left') nx = p.x + (minX - b.x);
      else if (mode === 'right') nx = p.x + (maxX - (b.x + b.width));
      else if (mode === 'hcenter') nx = p.x + (cx - (b.x + b.width / 2));
      else if (mode === 'top') ny = p.y + (minY - b.y);
      else if (mode === 'bottom') ny = p.y + (maxY - (b.y + b.height));
      else if (mode === 'vcenter') ny = p.y + (cy - (b.y + b.height / 2));
      try { c.set('position', { x: snapVal(nx), y: snapVal(ny) }); } catch {}
    });
    commitRef.current();
  }, [snapVal]);

  /** 多选等距分布：horizontal / vertical */
  const distributeSelection = useCallback((axis: 'h' | 'v') => {
    const paper = paperRef.current;
    if (!paper) return;
    const cells = [...selectionRef.current].map(id => paper.model.getCell(id)).filter((c: any) => c && !c.isLink());
    if (cells.length < 3) return;
    const sorted = [...cells].sort((a: any, b: any) => {
      const ba = a.getBBox(), bb = b.getBBox();
      return axis === 'h' ? (ba.x + ba.width / 2) - (bb.x + bb.width / 2) : (ba.y + ba.height / 2) - (bb.y + bb.height / 2);
    });
    const first = sorted[0].getBBox();
    const last = sorted[sorted.length - 1].getBBox();
    const startC = axis === 'h' ? first.x + first.width / 2 : first.y + first.height / 2;
    const endC = axis === 'h' ? last.x + last.width / 2 : last.y + last.height / 2;
    const step = (endC - startC) / (sorted.length - 1);
    sorted.forEach((c: any, i: number) => {
      if (i === 0 || i === sorted.length - 1) return;
      const b = c.getBBox();
      const p = c.position();
      const target = startC + step * i;
      if (axis === 'h') c.set('position', { x: snapVal(p.x + (target - (b.x + b.width / 2))), y: p.y });
      else c.set('position', { x: p.x, y: snapVal(p.y + (target - (b.y + b.height / 2))) });
    });
    commitRef.current();
  }, [snapVal]);

  const nudgeSelection = useCallback((dx: number, dy: number) => {
    const paper = paperRef.current;
    if (!paper) return;
    const ids = [...selectionRef.current];
    if (!ids.length) return;
    for (const id of ids) {
      const c = paper.model.getCell(id);
      if (!c || c.isLink()) continue;
      const p = c.position();
      try { c.set('position', { x: snapVal(p.x + dx), y: snapVal(p.y + dy) }); } catch {}
    }
  }, [snapVal]);

  const zoomBy = useCallback((factor: number) => {
    const paper = paperRef.current;
    if (!paper) return;
    const cur = paper.scale().sx || 1;
    paper.scale(Math.max(0.3, Math.min(3, cur * factor)));
  }, []);

  const resetView = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    paper.scale(1);
    paper.translate(0, 0);
  }, []);

  const zoomToFit = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    try { paper.scaleContentToFit({ padding: 40, maxScale: 1.5, minScale: 0.3 }); } catch {}
  }, []);

  const bringToFront = useCallback((front: boolean) => {
    const paper = paperRef.current;
    if (!paper) return;
    for (const id of selectionRef.current) {
      const c = paper.model.getCell(id);
      if (!c) continue;
      try { front ? c.toFront() : c.toBack(); } catch {}
    }
  }, []);

  const setProp = useCallback((id: string, prop: string, value: any) => {
    const paper = paperRef.current;
    if (!paper) return;
    const cell = paper.model.getCell(id);
    if (!cell) return;
    try { cell.set(prop, value); } catch {}
    scheduleDrcRef.current();
    commitRef.current();
  }, []);

  /**
   * 重建器件：digitaljs 把 groups / slice / extend / bits(部分器件) / initial 等列为
   * 「暂不支持运行时修改」——直接 set 会被回滚并告警。改这些只能重建器件。
   * 重建会保留 id / 位置 / 标签，并按 port id 逐个接回原连线（端口不存在的连线丢弃）。
   */
  const reconfigureCell = useCallback((id: string, extra: Record<string, any>) => {
    const paper = paperRef.current;
    if (!paper) return null;
    const old = paper.model.getCell(id);
    if (!old) return null;
    const digitaljs = (window as any).digitaljs;
    const type = String(old.get('type') || '');
    // 记录两侧连线：本器件作为 source / target 的端点信息
    const linkSpecs: any[] = [];
    for (const link of paper.model.getConnectedLinks(old)) {
      const s = link.get('source'), t = link.get('target');
      const isSrc = s?.id === old.id;
      const other = isSrc ? t : s;
      linkSpecs.push({
        isSrc, otherId: other?.id, otherPort: other?.port,
        port: (isSrc ? s : t)?.port,
        netname: link.get('netname'), vertices: link.get('vertices'),
      });
    }
    const pos = old.get('position') || { x: 0, y: 0 };
    const snapshot = {
      id: old.id, angle: old.get('angle'), label: old.get('label'), net: old.get('net'),
      size: old.get('size'),
    };
    // 先摘掉连线再删器件：Wire.remove() 会把目标端口清成 x，避免残留电平
    try { paper.model.getConnectedLinks(old).forEach((l: any) => l.remove()); } catch {}
    try { old.remove(); } catch {}
    const cell = spawnCell(type, pos.x, pos.y, String(snapshot.id), extra);
    if (!cell) return null;
    try {
      if (snapshot.angle) cell.set('angle', snapshot.angle);
      if (snapshot.label != null) cell.set('label', snapshot.label);
      if (snapshot.net != null) cell.set('net', snapshot.net);
    } catch { /* ignore */ }
    for (const spec of linkSpecs) {
      if (!spec.otherId || !spec.port) continue;
      // 新器件上不存在该端口（例如组数变少）→ 丢弃这条线
      let ok = true;
      try { ok = !!cell.getPort?.(spec.port); } catch { ok = false; }
      if (!ok) continue;
      try {
        const wireArgs: any = {
          source: spec.isSrc ? { id: cell.id, port: spec.port } : { id: spec.otherId, port: spec.otherPort },
          target: spec.isSrc ? { id: spec.otherId, port: spec.otherPort } : { id: cell.id, port: spec.port },
          signal: 'x', netname: spec.netname,
        };
        if (spec.vertices) wireArgs.vertices = spec.vertices;
        digitaljs && paper.model.addCell(new digitaljs.cells.Wire(wireArgs));
      } catch { /* ignore */ }
    }
    scheduleDrcRef.current();
    commitRef.current();
    setSelectionRef.current([cell.id]);
    return cell;
  }, [spawnCell]);

  /** 应用位宽方案：N 位总线 ↔ 若干组（每组 1/2/4/8 位） */
  const applyBusDialog = useCallback(() => {
    if (!busDlg) return;
    const n = Math.max(1, Math.floor(busTotal / Math.max(1, busGroupW)));
    const groups = new Map(Array.from({ length: n }, (_, i) => [i, busGroupW]));
    reconfigureCell(busDlg.cellId, { groups });
    setBusDlg(null);
    showToast(`${busDlg.type === 'BusGroup' ? '合线器' : '分线器'}：${n} 组 × ${busGroupW} 位 = ${n * busGroupW} 位`);
  }, [busDlg, busTotal, busGroupW, reconfigureCell, showToast]);

  const openMenuAt = useCallback((x: number, y: number, title: string, items: ContextMenuItem[]) => {
    setMenu({ x, y, title, items });
  }, []);

  const openCellMenu = useCallback((x: number, y: number, cellId: string) => {
    const paper = paperRef.current;
    if (!paper) return;
    const cell = paper.model.getCell(cellId);
    if (!cell) return;
    const type = String(cell.get('type') || '');
    const name = CN_NAME[type] || type;
    const selCount = selectionRef.current.size;
    const multi = selCount > 1 && selectionRef.current.has(cellId);
    const scopeToClicked = () => { if (!multi) setSelectionRef.current([cellId]); };
    const suffix = multi ? `（${selCount} 项）` : '';

    const items: ContextMenuItem[] = [];
    items.push({ label: `删除${suffix}`, hint: 'Delete', danger: true, action: () => { scopeToClicked(); deleteSelection(); } });
    items.push({ label: `复制${suffix}`, hint: 'Ctrl+C', action: () => { scopeToClicked(); copySelection(); } });
    items.push({ label: `剪切${suffix}`, hint: 'Ctrl+X', action: () => { scopeToClicked(); copySelection(); deleteSelection(); } });
    items.push({ label: `创建副本${suffix}`, hint: 'Ctrl+D', action: () => { scopeToClicked(); duplicateSelection(); } });
    items.push({ label: '---' });
    items.push({ label: '顺时针旋转 90°', hint: 'Ctrl+R', action: () => { scopeToClicked(); rotateSelection(90); } });
    items.push({ label: '逆时针旋转 90°', hint: 'Shift+Ctrl+R', action: () => { scopeToClicked(); rotateSelection(-90); } });
    items.push({ label: '---' });
    if (type === 'Clock') {
      items.push({ label: '时钟周期', input: { value: String(cell.get('propagation') ?? ''), placeholder: '周期', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1) { showToast('时钟周期必须是 ≥1 的数字'); return; }
        setProp(cellId, 'propagation', Math.floor(n));
      } } });
    }
    if (GATE_TYPES.includes(type)) {
      items.push({ label: '传播延迟', input: { value: String(cell.get('propagation') ?? ''), placeholder: '延迟', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) { showToast('传播延迟必须是 ≥0 的数字'); return; }
        setProp(cellId, 'propagation', Math.floor(n));
      } } });
      items.push({ label: '标签', input: { value: String(cell.get('label') ?? ''), placeholder: '标签', onCommit: (v) => setProp(cellId, 'label', v) } });
    }
    if (PORT_TYPES.includes(type)) {
      items.push({ label: '引脚名', input: { value: String(cell.get('net') ?? ''), placeholder: 'net', onCommit: (v) => setProp(cellId, 'net', v) } });
      items.push({ label: '位宽', input: { value: String(cell.get('bits') ?? ''), placeholder: 'bits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1) { showToast('位宽必须是 ≥1 的数字'); return; }
        setProp(cellId, 'bits', Math.floor(n));
        resetIoOutput(cell);
      } } });
    }
    if (IO_TYPES.includes(type) && type !== 'Clock') {
      items.push({ label: '位宽', input: { value: String(cell.get('bits') ?? ''), placeholder: 'bits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1) { showToast('位宽必须是 ≥1 的数字'); return; }
        setProp(cellId, 'bits', Math.floor(n));
        resetIoOutput(cell);
      } } });
    }
    if (type === 'Constant') {
      // digitaljs 的 Constant 监听 change:constant，会自动更新位宽与端口
      items.push({ label: '常量值', input: { value: String(cell.get('constant') ?? ''), placeholder: '二进制，如 1010', onCommit: (v) => {
        const s = String(v).trim();
        if (!/^[01x]{1,32}$/.test(s)) { showToast('常量值只能是 0/1/x 组成的 1–32 位串'); return; }
        setProp(cellId, 'constant', s);
      } } });
    }
    if (type === 'Dff') {
      // initial / bits 都在 digitaljs 的「不支持运行时修改」名单里 —— 必须重建器件
      const bitsNow = Number(cell.get('bits')) || 1;
      items.push({ label: '位宽', input: { value: String(bitsNow), placeholder: 'bits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 32) { showToast('位宽必须是 1–32 的数字'); return; }
        reconfigureCell(cellId, { bits: Math.floor(n), polarity: cell.get('polarity') });
        showToast(`触发器已重建为 ${Math.floor(n)} 位`);
      } } });
      items.push({ label: '初始值', input: { value: String(cell.get('initial') ?? 'x'), placeholder: '0/1/x', onCommit: (v) => {
        const s = String(v).trim();
        if (!/^[01x]+$/.test(s)) { showToast('初始值只能由 0/1/x 组成'); return; }
        reconfigureCell(cellId, { bits: bitsNow, initial: s, polarity: cell.get('polarity') });
        showToast(`初始值已设为 ${s}（器件已重建）`);
      } } });
    }
    if (MUX_TYPES.includes(type)) {
      // Mux 的 bits 同样不可运行时修改 → 重建
      const b = cell.get('bits') || { in: 1, sel: 1 };
      items.push({ label: '数据位宽', input: { value: String(b.in ?? 1), placeholder: 'bits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 32) { showToast('数据位宽必须是 1–32 的数字'); return; }
        reconfigureCell(cellId, { bits: { in: Math.floor(n), sel: b.sel ?? 1 } });
        showToast(`数据位宽 ${Math.floor(n)} 位（${type === 'Mux' ? 1 << (b.sel ?? 1) : (b.sel ?? 1)} 路）`);
      } } });
      items.push({ label: '选择位宽', input: { value: String(b.sel ?? 1), placeholder: 'sel bits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 5) { showToast('选择位宽必须是 1–5（最多 32 路）'); return; }
        reconfigureCell(cellId, { bits: { in: b.in ?? 1, sel: Math.floor(n) } });
        showToast(`选择位宽 ${Math.floor(n)} 位 → ${1 << Math.floor(n)} 路输入`);
      } } });
    }
    if (EXTEND_TYPES.includes(type)) {
      // 位扩展：单线 → 总线（或窄总线 → 宽总线）
      const ext = cell.get('extend') || { input: 1, output: 4 };
      items.push({ label: '输入位宽', input: { value: String(ext.input), placeholder: 'input bits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 32) { showToast('输入位宽必须是 1–32 的数字'); return; }
        reconfigureCell(cellId, { extend: { input: Math.floor(n), output: Math.max(Math.floor(n), ext.output ?? 1) } });
      } } });
      items.push({ label: '输出位宽', input: { value: String(ext.output), placeholder: 'output bits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 32) { showToast('输出位宽必须是 1–32 的数字'); return; }
        reconfigureCell(cellId, { extend: { input: ext.input ?? 1, output: Math.max(ext.input ?? 1, Math.floor(n)) } });
        showToast(`已改为 ${ext.input} → ${Math.max(ext.input ?? 1, Math.floor(n))} 位扩展`);
      } } });
    }
    if (type === 'BusGroup' || type === 'BusUngroup') {
      items.push({ label: '位宽方案…', hint: '▶', action: () => {
        const groups: any = cell.get('groups');
        const widths = groups ? Array.from(groups.values()) as number[] : [1, 1, 1, 1];
        setBusTotal(widths.reduce((a, b) => a + Number(b), 0) || 4);
        setBusGroupW(Number(widths[0]) || 1);
        setBusDlg({ cellId, type });
      } });
      // 分组配置：填「4」= 4 组各 1 位；填「2,2,4」= 三组，位宽分别 2/2/4
      const groups: any = cell.get('groups');
      const cur = groups ? Array.from(groups.values()).join(',') : '1,1,1,1';
      items.push({ label: '分组配置', input: { value: cur, placeholder: '4 或 2,2,4', onCommit: (v) => {
        const s = String(v).trim();
        const widths = /^\d+$/.test(s) ? Array.from({ length: Number(s) }, () => 1) : s.split(',').map(x => Number(x.trim()));
        if (!widths.length || widths.some(x => !Number.isFinite(x) || x < 1 || x > 32)) {
          showToast('请填组数（如 4）或各组位宽（如 2,2,4），单组 1–32 位'); return;
        }
        reconfigureCell(cellId, { groups: new Map(widths.map((w, i) => [i, w])) });
        showToast(`已重建为 ${widths.length} 组（共 ${widths.reduce((a, b) => a + b, 0)} 位）`);
      } } });
    }
    if (type === 'BusSlice') {
      const sl = cell.get('slice') || { first: 0, count: 1, total: 4 };
      items.push({ label: '切片配置', input: { value: `${sl.first}:${sl.count}`, placeholder: '起始:位数', onCommit: (v) => {
        const m = /^(\d+)\s*[:：]\s*(\d+)$/.exec(String(v).trim());
        if (!m) { showToast('格式：起始位:位数（如 2:4）'); return; }
        const first = Number(m[1]), count = Number(m[2]);
        if (count < 1 || first < 0 || first + count > 64) { showToast('切片范围非法（起始 ≥0、位数 ≥1、合计 ≤64）'); return; }
        reconfigureCell(cellId, { slice: { first, count, total: Math.max(sl.total ?? 4, first + count) } });
        showToast(`已取 [${first}, ${first + count}) 共 ${count} 位`);
      } } });
      items.push({ label: '总线总位宽', input: { value: String(sl.total ?? 4), placeholder: 'total bits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 64) { showToast('总线总位宽必须是 1–64 的数字'); return; }
        reconfigureCell(cellId, { slice: { first: Math.min(sl.first ?? 0, n - 1), count: Math.min(sl.count ?? 1, n), total: Math.floor(n) } });
      } } });
    }
    // Display7 固定 8 位段码（改位宽会让段码错乱），故不列入
    if (REDUCE_TYPES.includes(type) || type === 'NumDisplay' || SOURCE_TYPES.includes(type)) {
      const b = Number(cell.get('bits')) || 1;
      items.push({ label: '位宽', input: { value: String(b), placeholder: 'bits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 32) { showToast('位宽必须是 1–32 的数字'); return; }
        setProp(cellId, 'bits', Math.floor(n)); // IO / Gate 的 bits 支持运行时修改
      } } });
    }
    if (type === 'Memory') {
      // 批量填充：直接改 cell.memdata 实例并触发 manualMemChange（与内存编辑器同通路）
      const fillMem = (bit: '0' | '1') => {
        ensureSimRunning();
        const mem = (cell as any).memdata;
        if (!mem) { showToast('引擎尚未就绪，请稍后再试'); return; }
        try {
          const v0 = mem.get(0);
          const Ctor = v0.constructor;
          const nBits = Number(cell.get('bits')) || 1;
          const vec = bit === '1' ? Ctor.fromBin('1'.repeat(nBits), nBits) : Ctor.zeros(nBits);
          const words = Math.min(1 << (Number(cell.get('abits')) || 2), 256);
          for (let a = 0; a < words; a++) mem.set(a, vec);
          cell.trigger('manualMemChange', cell);
          commit();
          showToast(bit === '1' ? '内存已全部置 1' : '内存已清零');
        } catch { showToast('填充失败'); }
      };
      items.push({ label: '查看 / 编辑内存', hint: '▶', action: () => {
        // 编辑内存是有意义交互：引擎若冻结先自动恢复（gate 即 cell，prepare 后才有 memdata）
        ensureSimRunning();
        setTimeout(() => setMemViewCell(cell), 300);
      } });
      items.push({ label: '内存清零', action: () => fillMem('0') });
      items.push({ label: '内存全部置 1', action: () => fillMem('1') });
    }
    if (ARITH_TYPES.includes(type) || COMPARE_TYPES.includes(type) || SHIFT_TYPES.includes(type)) {
      items.push({ label: '位宽', input: { value: String(cell.get('bits')?.in1 ?? cell.get('bits')?.in ?? ''), placeholder: 'bits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 32) { showToast('位宽必须是 1–32 的数字'); return; }
        const b = Math.floor(n);
        // 运算器按类型加宽输出位（乘法 2N、加减 N+1 含进位），比较器输出恒 1 位，
        // 移位量端口 = ceil(log2 N)
        setProp(cellId, 'bits', COMPARE_TYPES.includes(type) ? { in1: b, in2: b }
          : SHIFT_TYPES.includes(type) ? { in1: b, in2: Math.max(1, Math.ceil(Math.log2(Math.max(2, b)))), out: b }
          : type === 'Negation' ? { in: b, out: b }
          : arithBits(type, b));
      } } });
    }
    if (type === 'Memory') {
      // Memory 的 bits/abits 同样在「不支持运行时修改」名单 → 重建（端口 id 不变，连线自动接回）
      const nBits = Number(cell.get('bits')) || 8;
      const abits = Number(cell.get('abits')) || 3;
      items.push({ label: '数据位宽', input: { value: String(nBits), placeholder: 'bits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 32) { showToast('数据位宽必须是 1–32 的数字'); return; }
        reconfigureCell(cellId, { bits: Math.floor(n), abits, rdports: cell.get('rdports'), wrports: cell.get('wrports') });
        showToast(`存储器已重建为 ${Math.floor(n)} 位数据宽`);
      } } });
      items.push({ label: '地址位宽', input: { value: String(abits), placeholder: 'abits', onCommit: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 12) { showToast('地址位宽必须是 1–12（最多 4096 字）'); return; }
        reconfigureCell(cellId, { bits: nBits, abits: Math.floor(n), rdports: cell.get('rdports'), wrports: cell.get('wrports') });
        showToast(`存储器已重建为 ${1 << Math.floor(n)} 字`);
      } } });
    }
    if (type === 'Subcircuit') {
      items.push({ label: '查看内部电路', hint: '双击', action: () => setInnerCell(cell) });
      // 绑定闭环（R39）：把该子电路存为**可编辑部件文件**（.djs，同文件夹）——
      // 内部嵌套的绑定式子部件递归入库并按名绑定。导出 .djs 时闭包自动随行。
      items.push({ label: '保存为部件（可编辑电路）', input: {
        value: String(cell.get('celltype') || cell.get('label') || ''),
        placeholder: '部件名',
        onCommit: (v: string) => {
          const name = String(v).trim();
          if (!name) { showToast('请输入部件名称'); return; }
          let cells: any;
          try {
            const sg = cell.get('subcircuitGraph');
            cells = (sg?.cells?.length) ? sg : serializeGraphCells(cell.get('graph'));
          } catch (e) {
            showToast('保存失败：内部电路无法序列化'); return;
          }
          if (!cells?.cells?.some((c: any) => !c.isLink)) { showToast('内部电路为空，无法保存'); return; }
          const r = saveGateFromCellsToFolder(name, cells, scopeRef.current);
          refreshGates();
          showToast(`已保存部件「${name}」为可编辑电路${r.nested ? `，${r.nested} 个子部件已递归入库绑定` : ''}，可在部件面板与右键菜单中放置`);
        },
      } });
    }
    if (multi) {
      items.push({ label: '---' });
      items.push({ label: '左对齐', action: () => alignSelection('left') });
      items.push({ label: '水平居中', action: () => alignSelection('hcenter') });
      items.push({ label: '右对齐', action: () => alignSelection('right') });
      items.push({ label: '顶对齐', action: () => alignSelection('top') });
      items.push({ label: '垂直居中', action: () => alignSelection('vcenter') });
      items.push({ label: '底对齐', action: () => alignSelection('bottom') });
      items.push({ label: '水平等距分布', action: () => distributeSelection('h') });
      items.push({ label: '垂直等距分布', action: () => distributeSelection('v') });
    }
    items.push({ label: '---' });
    items.push({ label: '置于顶层', action: () => { scopeToClicked(); bringToFront(true); } });
    items.push({ label: '置于底层', action: () => { scopeToClicked(); bringToFront(false); } });
    items.push({ label: '---' });
    items.push({ label: '全选', hint: 'Ctrl+A', action: selectAll });
    openMenuAt(x, y, multi ? `${name} +${selCount - 1}` : name, items);
  }, [alignSelection, bringToFront, copySelection, deleteSelection, distributeSelection,
      duplicateSelection, openMenuAt, rotateSelection, selectAll, setProp, showToast, refreshGates]);

  const openLinkMenu = useCallback((x: number, y: number, linkId: string) => {
    const paper = paperRef.current;
    if (!paper) return;
    const link = paper.model.getCell(linkId);
    if (!link) return;
    openMenuAt(x, y, '连线', [
      { label: '删除连线', hint: 'Delete', danger: true, action: () => { setSelectionRef.current([linkId]); deleteSelection(); } },
      { label: '网络名', input: { value: String(link.get('netname') || ''), placeholder: 'net name', onCommit: (v) => {
        try { link.set('netname', v); link.label(0, { attrs: { label: { text: v } } }); } catch {}
        commitRef.current();
      } } },
    ]);
  }, [deleteSelection, openMenuAt]);

  /** 把 cells JSON（沙盒白名单格式）以 id 重映射 + 中心平移的方式插入画布。
   *  示例插入与「粘贴复制的电路」共用（多次插入防 id 冲突）。 */
  const insertCellsAt = useCallback((cells: any[], mx: number, my: number, tag: string): boolean => {
    const paper = paperRef.current;
    const digitaljs = (window as any).digitaljs;
    if (!paper || !digitaljs || !cells.length) return false;
    // R39：插入内容里若带内嵌门快照，先递归补齐缺失部件（绑定入库，幂等）
    try { ensureDefsFromCells(cells, scopeRef.current); refreshGates(); } catch { /* ignore */ }
    // 示例 JSON 用固定 id（exA、exD0…）——同一画布插入两次会 id 冲突：
    // 器件被 addCell 静默丢弃、连线却全部建立并挂到旧器件上（单驱动混乱）。
    // 深拷贝 + 重新生成 id，并把示例中心平移到右键点击处。
    const data = JSON.parse(JSON.stringify({ cells })) as { cells: any[] };
    const nodes = data.cells.filter((c) => !c.isLink);
    if (!nodes.length) return false;
    const xs = nodes.map((c) => c.position?.x ?? 0);
    const ys = nodes.map((c) => c.position?.y ?? 0);
    const local = paper.clientToLocalPoint(mx, my);
    const dx = Math.round(local.x - (Math.min(...xs) + Math.max(...xs)) / 2);
    const dy = Math.round(local.y - (Math.min(...ys) + Math.max(...ys)) / 2);
    const idMap = new Map<string, string>();
    let seq = ++EXAMPLE_SEQ; // 每次插入一个批号，id 可预测（exA_1、exA_2…），便于定位
    // 页面重载后计数器归零，但存档里已有 exA_1 等批号 —— 必须跳过画布上已存在的
    const existing = new Set(paper.model.getCells().map((c: any) => String(c.id)));
    const nidOf = (id: string) => {
      let nid = `${id}_${seq}`;
      while (existing.has(nid)) { seq = ++EXAMPLE_SEQ; nid = `${id}_${seq}`; }
      existing.add(nid);
      return nid;
    };
    nodes.forEach((c) => {
      const nid = nidOf(String(c.id));
      idMap.set(c.id, nid);
      c.id = nid;
      c.position.x += dx;
      c.position.y += dy;
    });
    data.cells.forEach((c) => {
      if (c.isLink) { c.source.id = idMap.get(c.source.id); c.target.id = idMap.get(c.target.id); }
    });
    // id 已在上方内联重映射完毕，这里只传绑定作用域
    loadCells(paper, digitaljs, JSON.stringify(data), spawnCell, wireCountRef, { scope: scopeRef.current });
    seedGateOutputs(digitaljs, paper); // 反馈环（T 触发器）自举，避免 x 锁定
    // 内存快照回写（数字钟示例的段码 ROM 走这里）——commit 不触发 rebuild，须显式调用
    try { restoreMemoryData(() => paperRef.current); } catch { /* best effort */ }
    try { flushStaleQueue(() => circuitRef.current); } catch { /* best effort */ }
    ensureSimRunning(); // 示例里有时钟，若引擎冻结则自动恢复，插入即可见计数翻转
    commit();
    showToast(tag);
    return true;
  }, [spawnCell, commit, showToast, ensureSimRunning, refreshGates]);

  const openBlankMenu = useCallback((x: number, y: number) => {
    const hasClip = !!clipboardRef.current?.cells?.length;
    // 主模式「复制到沙盒」暂存的整图（App 写入 localStorage）：在任何沙盒文件里
    // 原样粘贴 —— 用户工作流：点复制按钮 → 进沙盒 → 右键粘贴（或自动打开的新文件）。
    let importClip: { cells?: any[] } | null = null;
    try {
      const raw = localStorage.getItem('verilog-viz-import-clipboard');
      if (raw) importClip = JSON.parse(raw);
    } catch { /* ignore */ }
    openMenuAt(x, y, '画布', [
      {
        label: '放置部件', hint: '▶', action: () => {
          // 延后一帧：ContextMenu 点击项后会立即 onClose()，同步 setMenu 会被它覆盖掉，
          // 所以放到下一个宏任务里再打开二级菜单。
          // 问题 4/5：两级分组导航（分组 → 组内部件），并纳入「自定义门」组。
          setTimeout(() => {
            const goto = (title: string, items: ContextMenuItem[]) =>
              setTimeout(() => openMenuAt(x, y, title, items), 0);
            const backItem: ContextMenuItem = { label: '← 返回分类', action: () => goto('放置部件', catItems) };
            const catItems: ContextMenuItem[] = PALETTE.map((g) => ({
              label: g.group, hint: '▶',
              action: () => goto(g.group, [
                backItem,
                { label: '---' },
                ...g.items.map((it) => ({
                  label: it.label || CN_NAME[it.type] || it.type,
                  hint: it.type,
                  action: () => placeAt(it, x, y),
                })),
              ]),
            }));
            if (gatesRef.current.length) {
              catItems.push({
                label: '自定义门', hint: '▶',
                action: () => goto('自定义门', [
                  backItem,
                  { label: '---' },
                  ...gatesRef.current.map((g) => ({ label: g.name, hint: '自定义', action: () => placeCustomGateAt(g, { x, y }) })),
                ]),
              });
            }
            openMenuAt(x, y, '放置部件', catItems);
          }, 0);
        },
      },
      {
        label: '插入示例', hint: '▶', action: () => {
          setTimeout(() => {
            openMenuAt(x, y, '插入示例', SANDBOX_EXAMPLES.map((e) => ({
              label: e.name,
              action: () => { insertCellsAt(e.cells, x, y, `已插入示例：${e.name}`); setTimeout(() => zoomToFit(), 60); },
            })));
          }, 0);
        },
      },
      ...(importClip && importClip.cells && importClip.cells.length ? [{
        label: '粘贴复制的电路', hint: '复制到沙盒', action: () => {
          const cells = importClip!.cells as any[];
          // R37：粘贴前先按内嵌快照补齐缺失的门定义（递归入库绑定），
          // 之后 loadCells / 持久化剥离都能走绑定路径
          try { ensureDefsFromCells(cells); refreshGates(); } catch { /* ignore */ }
          insertCellsAt(cells, x, y, '已粘贴复制的电路');
          try { localStorage.removeItem('verilog-viz-import-clipboard'); } catch { /* ignore */ }
          setTimeout(() => zoomToFit(), 80);
        },
      }] : []),
      { label: '粘贴', hint: 'Ctrl+V', disabled: !hasClip, action: pasteClipboard },
      { label: '全选', hint: 'Ctrl+A', action: selectAll },
      { label: '---' },
      { label: '撤销', hint: 'Ctrl+Z', action: undo },
      { label: '重做', hint: 'Ctrl+Shift+Z', action: redo },
      { label: '---' },
      { label: '放大', hint: 'Ctrl+滚轮', action: () => zoomBy(1.2) },
      { label: '缩小', action: () => zoomBy(1 / 1.2) },
      { label: '缩放至适应', hint: 'Shift+F', action: zoomToFit },
      { label: '重置视图', hint: 'Ctrl+0', action: resetView },
      { label: '---' },
      { label: '清除选择', action: () => setSelectionRef.current([]) },
    ]);
  }, [openMenuAt, pasteClipboard, placeAt, redo, resetView, selectAll, undo, zoomBy, zoomToFit, spawnCell, commit, showToast, ensureSimRunning,
      // gates 不能进依赖（见 gatesRef 注释）：自定义门列表经 gatesRef.current 读取，
      // 既保证菜单最新（ref 每次渲染同步），又不搅动画布重建 effect 的身份依赖。
      insertCellsAt]);

  useEffect(() => {
    // R37 迁移：旧 GATES_KEY 门存档 + 存量文件内嵌 subcircuitGraph →
    // 门定义文件（kind:'gate'）+ 绑定剥离。一次性、幂等。
    try {
      const moved = migrateLegacy();
      if (moved) { refreshList(); refreshFolders(); }
      refreshGates();
    } catch { /* ignore */ }
    refreshList();
    refreshGates();
    refreshFolders();
    const activeId = sandboxStore.getActiveId();
    if (activeId) {
      const f = sandboxStore.get(activeId);
      if (f) setActiveFile(f);
    }
  }, [refreshList, refreshGates, refreshFolders]);

  // (Grid) Repaint the mesh on theme / settings change WITHOUT rebuilding the paper.
  useEffect(() => {
    const root = wrapperRef.current;
    if (!root) return;
    const gridColor = theme === 'dark' ? '#2b3140' : '#c9d2e0';
    root.style.backgroundColor = theme === 'dark' ? 'var(--surface)' : '#ffffff';
    root.querySelectorAll('[data-sandbox-grid]').forEach((el) => {
      const d = el as HTMLElement;
      d.style.display = settings.showGrid ? 'block' : 'none';
      d.style.backgroundColor = theme === 'dark' ? 'var(--surface)' : '#ffffff';
      d.style.backgroundImage =
        `linear-gradient(to right, ${gridColor} 1px, transparent 1px), ` +
        `linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`;
      d.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    });
  }, [theme, activeFile?.id, resetNonce, gridSize, settings.showGrid]);

  // Apply wire-routing style without rebuilding the circuit.
  useEffect(() => {
    const paper = paperRef.current;
    if (!paper) return;
    try {
      paper.options.defaultRouter = ROUTERS[settings.wireStyle] ?? ROUTERS.metro;
      paper.updateViews();
    } catch { /* ignore */ }
  }, [settings.wireStyle, activeFile?.id, resetNonce]);

  // (Re)build paper when active file changes
  useEffect(() => {
    if (!activeFile) return;
    const root = wrapperRef.current;
    if (!root) return;
    const digitaljs = (window as any).digitaljs;

    root.querySelectorAll('[data-sandbox-grid], [data-sandbox-paper-host], [data-sandbox-marquee]')
      .forEach(el => el.remove());

    if (circuitRef.current) {
      try { circuitRef.current.stop(); } catch {}
      paperRef.current?.remove();
    }

    const circuit = new digitaljs.Circuit({ devices: {}, connectors: [], subcircuits: {} }, { layoutEngine: false });
    circuitRef.current = circuit;
    const gridColor = theme === 'dark' ? '#2b3140' : '#c9d2e0';
    const gridLayer = document.createElement('div');
    gridLayer.setAttribute('data-sandbox-grid', '');
    gridLayer.style.position = 'absolute';
    gridLayer.style.inset = '0';
    gridLayer.style.zIndex = '0';
    gridLayer.style.pointerEvents = 'none';
    gridLayer.style.display = settings.showGrid ? 'block' : 'none';
    gridLayer.style.backgroundColor = theme === 'dark' ? 'var(--surface)' : '#ffffff';
    gridLayer.style.backgroundImage =
      `linear-gradient(to right, ${gridColor} 1px, transparent 1px), ` +
      `linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`;
    gridLayer.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    root.appendChild(gridLayer);

    const host = document.createElement('div');
    host.setAttribute('data-sandbox-paper-host', '');
    host.style.position = 'absolute';
    host.style.inset = '0';
    host.style.zIndex = '1';
    root.appendChild(host);
    const paper = circuit.displayOn(host);
    paperRef.current = paper;
    (window as any).__sandboxPaper = paper;
    (window as any).__sandboxCircuit = circuit;
    (window as any).__sandboxExport = {
      svgString: () => exportSvgString(paperRef.current),
      pngDataUrl: (scale = 2) => exportPngDataUrl(paperRef.current, scale),
    };
    (window as any).__sandboxGates = {
      list: () => customGateStore.list(),
      place: (id: string) => { const g = customGateStore.get(id); if (g) placeCustomGate(g); },
      saveCurrentAs: (name: string) => {
        const p = paperRef.current;
        if (!p) return false;
        const cells = p.model.getCells();
        if (!cells.some((c: any) => c.get('type') === 'Input') || !cells.some((c: any) => c.get('type') === 'Output')) return false;
        savePartFile(name, serializePaper(p), scopeRef.current);
        refreshGates();
        return true;
      },
    };
    paper.options.interactive = false;
    paper.options.async = false;
    try {
      const u = (paper as any)._updates;
      if (u && u.id) { const fid = u.id; u.id = 0; cancelAnimationFrame(fid); }
      paper.updateViews();
    } catch { /* best effort */ }
    paper.options.defaultRouter = ROUTERS[settings.wireStyle] ?? ROUTERS.metro;
    paper.off('render:done');
    paper.scale(1);
    paper.translate(0, 0);

    // Anchor wires on the port magnet CIRCLE, not the port group (whose bbox also covers the
    // stub wire) — otherwise every endpoint lands ~11px away from the dot the user sees.
    paper.options.defaultAnchor = function (view: any, magnet: any) {
      try {
        let el = magnet;
        if (el && String(el.tagName || '').toLowerCase() !== 'circle') {
          const c = el.querySelector && el.querySelector('circle.port, circle');
          if (c) el = c;
        }
        if (el && typeof el.getBoundingClientRect === 'function') {
          const r = el.getBoundingClientRect();
          if (r.width || r.height) {
            return paper.clientToLocalPoint(r.left + r.width / 2, r.top + r.height / 2);
          }
        }
      } catch { /* fall through */ }
      return view.model.getBBox().center();
    };

    if (settings.autoStartSim && runningRef.current) {
      circuit.start();
    } else {
      // 如实反映引擎状态：autoStartSim 关闭（或用户曾暂停）时电路并没有启动。
      // 若不纠正，runningRef 会一直是 true —— 界面显示「暂停」、ensureSimRunning
      // 误判为已在运行，用户面对一个冻结的电路，看起来就像所有逻辑门都坏了。
      runningRef.current = false;
      setRunning(false);
    }
    try { restoreMemoryData(() => paperRef.current); } catch { /* best effort */ }
    try { flushStaleQueue(() => circuitRef.current); } catch { /* best effort */ }

    const viewOf = (id: string) => {
      const c = paper.model.getCell(id);
      return c ? c.findView(paper) : null;
    };
    const mark = (id: string, on: boolean) => {
      const v = viewOf(id);
      v?.el?.classList?.[on ? 'add' : 'remove']('sm-selected');
    };
    const setSelection = (ids: string[]) => {
      const next = new Set(ids.filter(Boolean));
      selectionRef.current.forEach(id => { if (!next.has(id)) mark(id, false); });
      selectionRef.current = next;
      next.forEach(id => mark(id, true));
      forceUpdate(n => n + 1);
    };
    setSelectionRef.current = setSelection;
    commitRef.current = commit;
    (window as any).__sandboxSelection = () => [...selectionRef.current];

    // ---- design-rule check (illegal connections) ----
    let drcIssues: DrcIssue[] = [];
    (window as any).__sandboxDrc = () => drcIssues;
    let drcTimer: any = null;
    const runDrc = () => {
      const issues: DrcIssue[] = [];
      const links = paper.model.getLinks();
      const byTarget = new Map<string, string[]>();
      for (const l of links) {
        const s = l.get('source') || {};
        const t = l.get('target') || {};
        if (!s.id || !s.port || !t.id || !t.port) { issues.push({ linkId: l.id, msg: '悬空连线：端点未接在端口上' }); continue; }
        const sc = paper.model.getCell(s.id);
        const tc = paper.model.getCell(t.id);
        if (!sc || !tc) { issues.push({ linkId: l.id, msg: '连线指向已删除的部件' }); continue; }
        const sp = typeof sc.getPort === 'function' ? sc.getPort(s.port) : null;
        const tp = typeof tc.getPort === 'function' ? tc.getPort(t.port) : null;
        if (!sp || !tp) { issues.push({ linkId: l.id, msg: `连线端口不存在：${s.port} → ${t.port}` }); continue; }
        if (s.id === t.id) issues.push({ linkId: l.id, msg: '自环连线（部件连到自己）' });
        if (sp.dir !== 'out' || tp.dir !== 'in') {
          issues.push({ linkId: l.id, msg: `方向非法：${sp.dir} → ${tp.dir}（必须 输出 → 输入）` });
        }
        if (sp.bits !== tp.bits) issues.push({ linkId: l.id, msg: `位宽不匹配：${sp.bits} → ${tp.bits}` });
        const key = `${t.id}:${t.port}`;
        if (!byTarget.has(key)) byTarget.set(key, []);
        byTarget.get(key)!.push(l.id);
      }
      for (const ids of byTarget.values()) {
        if (ids.length > 1) {
          for (const id of ids) issues.push({ linkId: id, msg: `多驱动冲突：同一输入被 ${ids.length} 条线同时驱动` });
        }
      }
      const bad = new Set(issues.map(i => i.linkId));
      for (const l of links) {
        const v = l.findView(paper);
        if (v?.el?.classList) v.el.classList[bad.has(l.id) ? 'add' : 'remove']('sm-illegal');
      }
      drcIssues = issues;
      setDrc(issues);
      return issues;
    };
    const scheduleDrc = () => {
      if (drcTimer) clearTimeout(drcTimer);
      drcTimer = setTimeout(() => { drcTimer = null; runDrc(); }, 120);
    };
    scheduleDrcRef.current = scheduleDrc;

    const validateConnection = (srcId: string, srcPort: string, tgtId: string, tgtPort: string, ignoreId?: string) => {
      if (!srcId || !tgtId || !srcPort || !tgtPort) return '连线不完整：两端都必须落在端口上';
      if (srcId === tgtId) return '不能把部件连到它自己';
      const sc = paper.model.getCell(srcId);
      const tc = paper.model.getCell(tgtId);
      if (!sc || !tc) return '部件不存在';
      const sp = typeof sc.getPort === 'function' ? sc.getPort(srcPort) : null;
      const tp = typeof tc.getPort === 'function' ? tc.getPort(tgtPort) : null;
      if (!sp || !tp) return '端口不存在';
      if (sp.dir !== 'out') return `起点必须是输出端口（${CN_NAME[sc.get('type')] || sc.get('type')}.${srcPort} 是${sp.dir === 'in' ? '输入' : sp.dir}）`;
      if (tp.dir !== 'in') return `终点必须是输入端口（${CN_NAME[tc.get('type')] || tc.get('type')}.${tgtPort} 是${tp.dir === 'out' ? '输出' : tp.dir}）`;
      if (sp.bits !== tp.bits) return `位宽不匹配（${sp.bits} 位 vs ${tp.bits} 位）`;
      const occupied = paper.model.getLinks().find((l: any) =>
        l.id !== ignoreId && l.get('target')?.id === tgtId && l.get('target')?.port === tgtPort);
      if (occupied) return `输入 ${CN_NAME[tc.get('type')] || tc.get('type')}.${tgtPort} 已被占用：一个输入只能有一个驱动源`;
      const dup = paper.model.getLinks().find((l: any) =>
        l.id !== ignoreId && l.get('source')?.id === srcId && l.get('source')?.port === srcPort &&
        l.get('target')?.id === tgtId && l.get('target')?.port === tgtPort);
      if (dup) return '这两个端口之间已经有连线了';
      return null;
    };

    const portBitsOf = (cell: any, port: string) => {
      const b = cell?.getPort?.(port)?.bits;
      if (typeof b === 'number') return b;
      const n = Number(b?.in ?? b?.out ?? b);
      return Number.isFinite(n) && n > 0 ? n : 1;
    };

    const finalizeWire = (tempLink: any, sId: string, sPort: string, tId: string, tPort: string) => {
      const srcCell = paper.model.getCell(sId);
      tempLink.set('bits', portBitsOf(srcCell, sPort));
      tempLink.set('source', { id: sId, port: sPort });
      tempLink.set('target', { id: tId, port: tPort });
      try { tempLink.findView(paper).el.style.pointerEvents = ''; } catch { /* ignore */ }
      ensureSimRunning();
      scheduleDrc();
      commit();
    };

    const mkWire = (a: string, ap: string, b: string, bp: string) => {
      const srcCell = paper.model.getCell(a);
      const w = new digitaljs.cells.Wire({
        source: { id: a, port: ap }, target: { id: b, port: bp },
        signal: 'x', bits: portBitsOf(srcCell, ap), netname: `N${++wireCountRef.current}`,
      });
      paper.model.addCell(w);
      return w;
    };

    /**
     * 位宽不匹配时自动插入转换器：
     *   窄 → 宽：ZeroExtend（高位补 0）
     *   宽 → 窄：BusSlice 取低位 [0, tBits)
     * 多组拆分（4 位 → 两条 2 位）不是单线能表达的，走「分线器 / 合线器」的位宽方案对话框。
     */
    const connectWithAutoConvert = (sId: string, sPort: string, tId: string, tPort: string, tempLink: any) => {
      const sc = paper.model.getCell(sId);
      const tc = paper.model.getCell(tId);
      if (!sc || !tc) { tempLink.remove(); return; }
      const sBits = portBitsOf(sc, sPort);
      const tBits = portBitsOf(tc, tPort);
      const sp = sc.position?.() || { x: 0, y: 0 };
      const tp = tc.position?.() || { x: 0, y: 0 };
      const mid = snapVal((sp.x + tp.x) / 2 + 120);
      const midY = snapVal((sp.y + tp.y) / 2);
      const conv = sBits < tBits
        ? spawnCell('ZeroExtend', mid, midY, undefined, { extend: { input: sBits, output: tBits } })
        : spawnCell('BusSlice', mid, midY, undefined, { slice: { first: 0, count: tBits, total: sBits } });
      if (!conv) {
        tempLink.remove();
        showToast(`位宽不匹配（${sBits} vs ${tBits}）：自动插入转换器失败`);
        return;
      }
      tempLink.remove();
      mkWire(sId, sPort, String(conv.id), sBits < tBits ? 'in' : 'in');
      mkWire(String(conv.id), 'out', tId, tPort);
      showToast(`位宽 ${sBits} → ${tBits}：已自动插入${sBits < tBits ? '零扩展' : '总线切片'}`);
      ensureSimRunning();
      scheduleDrc();
      commit();
    };

    // Load cells + links
    const sourceJson = pendingResetJsonRef.current ?? activeFile.graphJson ?? null;
    pendingResetJsonRef.current = null;
    if (sourceJson && sourceJson !== JSON.stringify({ cells: [] })) {
      try { loadCells(paper, digitaljs, sourceJson, spawnCell, wireCountRef, { scope: scopeRef.current }); } catch { /* corrupted */ }
    }
    // 播种：让交叉耦合的门（锁存器 / 触发器）摆脱 x 锁定，详见 seedGateOutputs
    try { seedGateOutputs(digitaljs, paper); } catch { /* best effort */ }
    // 冲刷过期传播片（loadCells 批量建线的事件可能排到已消费的 tick 上）——
    // 不冲刷则 BusGroup 等多输入器件的 operation 永不执行，输出恒 x
    try { flushStaleQueue(() => circuitRef.current); } catch { /* best effort */ }
    // 内存快照回写：必须在此处（loadCells 之后）——restore 的 effect 早于本 effect 执行时
    // memdataInit 还未恢复到 cell。带重试机制，engine prepare 晚于本点也能写上。
    try { restoreMemoryData(() => paperRef.current); } catch { /* best effort */ }
    try { flushStaleQueue(() => circuitRef.current); } catch { /* best effort */ }
    historyRef.current = { stack: [JSON.stringify(serializePaper(paper))], idx: 0 };
    scheduleDrc();

    // 展开自定义门内部电路
    // digitaljs 自身也监听 open:subcircuit，并往 <body> 直接插一个它自己的裸弹窗
    // （无样式、位置与内容都不对）。这正是「展开图出现两个、其中一个是错的」的原因：
    // 先 off 掉 digitaljs 自带的处理器，再挂我们自己的统一模态框。
    paper.off('open:subcircuit');
    paper.on('open:subcircuit', (model: any) => setInnerCell(model));

    // 放大镜最可靠的入口：直接在 document 上捕获 a.zoom 的原生 click。
    // jointjs 对该点击的路由不稳定（有时是 cell:pointerdown、有时被判成 blank），
    // 而原生 click 一定能到达（Button/Input 的点击切换都是这么生效的）。
    // 放大镜是 foreignObject 里的 <a class="zoom">🔍</a>：浏览器命中测试解析不到它
    // （elementFromPoint 和 click 的 target 都只给到外层 <svg>），所以任何基于
    // target/closest 的方案都不可靠。这里在 document 捕获阶段用「点击坐标 vs a.zoom 矩形」
    // 做几何判定，既不依赖 jointjs 路由，也不依赖命中测试。
    const hitZoom = (clientX: number, clientY: number) => {
      for (const sc of paper.model.getCells()) {
        if (sc.get('type') !== 'Subcircuit') continue;
        const sv = sc.findView(paper);
        const za = sv?.el?.querySelector?.('a.zoom');
        if (!za || typeof za.getBoundingClientRect !== 'function') continue;
        const r = za.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return sc;
      }
      return null;
    };
    const onDocZoomDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const sc = hitZoom(e.clientX, e.clientY);
      if (!sc) return;
      e.stopPropagation();
      e.preventDefault();
      setInnerCell(sc);
    };
    document.addEventListener('mousedown', onDocZoomDown, true);

    // Box (rubber-band) selection on blank canvas drag
    paper.on('blank:pointerdown', (evt: any) => {
      if (evt.button === 2) return;
      // 起手磁吸（补充）：端口圆点只有几像素，点在它旁边几像素处常常落在器件之外，
      // 此时 joint 走的是 blank 而不是 cell:pointerdown —— 以前这种情况根本拉不出线。
      // 这里按距离找最近的端口，命中就从该端口起线（半径 16px 屏幕像素）。
      if (evt.clientX != null) {
        const dots = collectPortDots(paper);
        const near = nearestPortDot(paper, dots, evt.clientX, evt.clientY, 16);
        if (near) {
          const cell = paper.model.getCell(near.cellId);
          if (cell && wireDragStarterRef.current) {
            try { evt.stopPropagation?.(); evt.preventDefault?.(); } catch { /* ignore */ }
            wireDragStarterRef.current(cell, near.portId, evt);
            return;
          }
        }
      }
      // 放大镜有时会被命中测试判成「点在 svg 上」，从而走进 blank 而不是 cell:pointerdown。
      // 这里用同样的几何判定兜底，保证点放大镜一定能展开。
      if (evt.clientX != null) {
        for (const sc of paper.model.getCells()) {
          if (sc.get('type') !== 'Subcircuit') continue;
          const sv = sc.findView(paper);
          const za = sv?.el?.querySelector?.('a.zoom');
          if (!za || typeof za.getBoundingClientRect !== 'function') continue;
          const zr = za.getBoundingClientRect();
          if (evt.clientX >= zr.left && evt.clientX <= zr.right
              && evt.clientY >= zr.top && evt.clientY <= zr.bottom) {
            setInnerCell(sc);
            return;
          }
        }
      }
      setSelection([]);
      if (evt.button !== 0) return;
      const start = { x: evt.clientX, y: evt.clientY };
      const hostRect = root.getBoundingClientRect();
      const marquee = document.createElement('div');
      marquee.setAttribute('data-sandbox-marquee', '');
      marquee.style.position = 'absolute';
      marquee.style.zIndex = '3';
      marquee.style.pointerEvents = 'none';
      marquee.style.border = '1px dashed var(--accent)';
      marquee.style.background = 'rgba(99,102,241,0.10)';
      marquee.style.borderRadius = '2px';
      root.appendChild(marquee);
      let moved = false;
      const paint = (a: { x: number, y: number }, b: { x: number, y: number }) => {
        marquee.style.left = `${Math.min(a.x, b.x) - hostRect.left}px`;
        marquee.style.top = `${Math.min(a.y, b.y) - hostRect.top}px`;
        marquee.style.width = `${Math.abs(a.x - b.x)}px`;
        marquee.style.height = `${Math.abs(a.y - b.y)}px`;
      };
      paint(start, start);
      const onMove = (e: MouseEvent) => {
        if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 3) moved = true;
        paint(start, { x: e.clientX, y: e.clientY });
      };
      const onUp = (e: MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        marquee.remove();
        if (!moved) return;
        const p1 = paper.clientToLocalPoint(start.x, start.y);
        const p2 = paper.clientToLocalPoint(e.clientX, e.clientY);
        const box = {
          x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
          width: Math.abs(p1.x - p2.x), height: Math.abs(p1.y - p2.y),
        };
        const hits = paper.model.getCells()
          .filter((c: any) => !c.isLink())
          .filter((c: any) => {
            const b = c.getBBox();
            return !(b.x + b.width < box.x || b.x > box.x + box.width ||
                     b.y + b.height < box.y || b.y > box.y + box.height);
          })
          .map((c: any) => c.id);
        setSelection(hits);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    paper.on('link:pointerdown', (linkView: any, evt: any) => {
      evt.stopPropagation();
      const id = linkView.model.id;
      const additive = evt.shiftKey || evt.ctrlKey || evt.metaKey;
      let ids: string[];
      if (additive) {
        const cur = new Set(selectionRef.current);
        cur.has(id) ? cur.delete(id) : cur.add(id);
        ids = [...cur];
      } else ids = [id];
      setSelection(ids);
    });

    // Double-click a custom gate to inspect its inner circuit. jointjs' `cell:pointerdblclick`
    // never arrives because our pointerdown handler calls preventDefault(), so detect it here.
    let lastClickId: string | null = null;
    let lastClickAt = 0;

    // 起线逻辑（磁吸 + 位宽自动转换）抽成函数并缓存到 ref：
    // 「空白区靠近端口按下」也要能起线（端口圆点只有几像素，精准对准很难受）
    const startWireDrag = (sourceCell: any, sourcePort: string, evt: any) => {
      evt.stopPropagation?.();
      evt.preventDefault?.();
      if (!sourcePort) return;
      // Dragging may start from an INPUT port too (reverse wiring). A digitaljs Wire
      // always stores (source=out, target=in), so the loose end of the temp wire must be
      // placed on the side matching the port we grabbed — otherwise `_changeSource` reads
      // a non-existent output signal and the wire dies immediately.
      const srcPortObj = sourceCell.getPort?.(sourcePort);
      const startIsInput = srcPortObj?.dir === 'in';
      const startLocal = paper.clientToLocalPoint(evt.clientX, evt.clientY);
      const tempArgs: any = startIsInput
        ? { source: { x: startLocal.x, y: startLocal.y }, target: { id: sourceCell.id, port: sourcePort }, signal: 'x' }
        : { source: { id: sourceCell.id, port: sourcePort }, target: { x: startLocal.x, y: startLocal.y }, signal: 'x' };
      // 线宽必须跟住源端口：Wire 默认 bits=1，多位信号（常量/运算器/数码管）会在线上
      // 被截坏 —— 实测加法器输入变成空向量、输出退化为 1 位 0。
      tempArgs.bits = portBitsOf(sourceCell, sourcePort);
      tempArgs.netname = `N${++wireCountRef.current}`;
      const tempLink = new digitaljs.cells.Wire(tempArgs);
      paper.model.addCell(tempLink);
      tempLink.findView(paper).el.style.pointerEvents = 'none';
      // 磁吸：落点端在 SNAP_PX 内自动吸附到最近的同向端口（起线时缓存端口坐标，
      // 拖拽过程中器件不动，无需每次重算）
      const dots = collectPortDots(paper);
      const SNAP_PX = 26;
      let snapped: any = null;
      let snappedBody: any = null;
      const clearSnapMark = () => {
        try { snappedBody?.classList?.remove('sm-port-snap'); } catch { /* ignore */ }
        snappedBody = null;
      };
      const markSnap = (body: any) => {
        clearSnapMark();
        snappedBody = body;
        try { body?.classList?.add('sm-port-snap'); } catch { /* ignore */ }
      };
      const onMove = (e: MouseEvent) => {
        const snap = nearestPortDot(paper, dots, e.clientX, e.clientY, SNAP_PX,
          (d) => d.cellId !== String(sourceCell.id) && (startIsInput ? d.dir === 'out' : d.dir === 'in'));
        if (snap) {
          snapped = snap;
          markSnap(snap.body);
          const end = { id: snap.cellId, port: snap.portId };
          if (startIsInput) tempLink.set('source', end);
          else tempLink.set('target', end);
        } else {
          snapped = null;
          clearSnapMark();
          const p = paper.clientToLocalPoint(e.clientX, e.clientY);
          if (startIsInput) tempLink.set('source', { x: p.x, y: p.y });
          else tempLink.set('target', { x: p.x, y: p.y });
        }
      };
      const onUp = (e: MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        clearSnapMark();
        // 优先用磁吸命中的端口；没吸上再退回 DOM 命中测试（精确落在圆点上的情况）
        let targetId: string | null = snapped?.cellId ?? null;
        let targetPort: string | null = snapped?.portId ?? null;
        if (!targetId) {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const targetMagnet = el?.closest?.('[magnet]');
          const tMagnetVal = targetMagnet?.getAttribute('magnet');
          if (targetMagnet && tMagnetVal && tMagnetVal !== 'false') {
            targetPort = targetMagnet.closest('.joint-port-body')?.getAttribute('port') ?? null;
            targetId = targetMagnet.closest('[model-id]')?.getAttribute('model-id') ?? null;
          }
        }
        if (targetId && targetId !== String(sourceCell.id) && targetPort) {
          // Grabbing from an input means the OTHER end is the driver.
          let sId = String(sourceCell.id), sPort = sourcePort, tId = targetId, tPort = targetPort;
          if (startIsInput) { sId = targetId; sPort = targetPort; tId = String(sourceCell.id); tPort = sourcePort; }
          const err = validateConnection(sId, sPort, tId, tPort, tempLink.id);
          // 位宽不一致不再直接拒绝 —— 自动插入转换器（窄→宽零扩展，宽→窄取低位切片）
          if (err && /位宽不匹配/.test(err)) {
            connectWithAutoConvert(sId, sPort, tId, tPort, tempLink);
            return;
          }
          if (err) {
            tempLink.remove();
            showToast(`连接被拒绝：${err}`);
            return;
          }
          // 最终源端确定后（反向起线时源在另一端），按真实源端口重设线宽
          finalizeWire(tempLink, sId, sPort, tId, tPort);
          return;
        }
        tempLink.remove();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    wireDragStarterRef.current = startWireDrag;
    paper.on('cell:pointerdown', (cellView: any, evt: any) => {
      if (typeof cellView.model.isLink === 'function' && cellView.model.isLink()) return;
      const magnet = evt.target?.closest?.('[magnet]');
      const magnetVal = magnet?.getAttribute('magnet');
      const isMagnet = magnetVal && magnetVal !== 'false';

      // ---- 起手端磁吸：端口圆点只有几像素，要求精准命中很难拉出线 ----
      // 未命中圆点、但落在本器件某个端口 START_SNAP_PX 以内时，同样从该端口起线。
      let startPort: string | null = isMagnet ? (magnet?.closest('.joint-port-body')?.getAttribute('port') ?? null) : null;
      if (!startPort && evt.clientX != null) {
        const own = collectPortDots(paper, String(cellView.model.id));
        const near = nearestPortDot(paper, own, evt.clientX, evt.clientY, 14);
        if (near) startPort = near.portId;
      }

      if (startPort) { startWireDrag(cellView.model, startPort, evt); return; }

      // 放大镜图标（digitaljs 渲染为 a.zoom，事件 click a.zoom -> zoomInCircuit）：
      // 单击就展开内部电路。原先这里统一 preventDefault，把 a.zoom 的 click 也挡掉了，
      // 只能退化成「400ms 内双击」兜底，于是表现为要点两次。
      // 判定是否点在放大镜上。不能用 evt.target / elementFromPoint：
      // 放大镜是 foreignObject 里的 <a class="zoom">🔍</a>，浏览器命中测试常常只给到外层
      // <svg>，两者都拿不到 a.zoom，于是下面的 preventDefault 会把 digitaljs 的
      // `click a.zoom` 一起掐掉（时好时坏）。改用几何判定：看点击坐标是否落在其矩形内。
      let onZoom = false;
      const zoomEl = cellView.el?.querySelector?.('a.zoom');
      if (zoomEl && evt.clientX != null && typeof zoomEl.getBoundingClientRect === 'function') {
        const zr = zoomEl.getBoundingClientRect();
        onZoom = evt.clientX >= zr.left && evt.clientX <= zr.right
              && evt.clientY >= zr.top && evt.clientY <= zr.bottom;
      }
      if (!onZoom) {
        const hit = document.elementFromPoint(evt.clientX, evt.clientY);
        onZoom = !!(hit?.closest?.('a.zoom'));
      }
      if (onZoom && cellView.model.get('type') === 'Subcircuit') {
        evt.stopPropagation();
        evt.preventDefault();
        setInnerCell(cellView.model);
        return;
      }

      evt.stopPropagation();
      evt.preventDefault();

      const id = cellView.model.id;
      const now = Date.now();
      if (lastClickId === id && now - lastClickAt < 400) {
        lastClickId = null;
        if (cellView.model.get('type') === 'Subcircuit') { setInnerCell(cellView.model); return; }
      }
      lastClickId = id;
      lastClickAt = now;
      const additive = evt.shiftKey || evt.ctrlKey || evt.metaKey;
      let ids: string[];
      if (additive) {
        const cur = new Set(selectionRef.current);
        cur.has(id) ? cur.delete(id) : cur.add(id);
        ids = [...cur];
      } else {
        ids = selectionRef.current.has(id) ? [...selectionRef.current] : [id];
      }
      setSelection(ids);
      if (additive) return;

      const startLocal = paper.clientToLocalPoint(evt.clientX, evt.clientY);
      const orig = new Map<string, any>();
      selectionRef.current.forEach(sid => {
        const c = paper.model.getCell(sid);
        if (c && !c.isLink()) orig.set(sid, c.position());
      });
      let dragged = false;
      const onMove = (e: MouseEvent) => {
        const p = paper.clientToLocalPoint(e.clientX, e.clientY);
        const dx = p.x - startLocal.x, dy = p.y - startLocal.y;
        if (Math.abs(dx) + Math.abs(dy) > 1) dragged = true;
        orig.forEach((pos, sid) => {
          const c = paper.model.getCell(sid);
          if (c) c.set('position', { x: snapVal(pos.x + dx), y: snapVal(pos.y + dy) });
        });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // 单击（未拖动）输入引脚即切换电平。digitaljs 自带的可点区域只是中心 60% 的
        // btnface，在 30×30 的引脚上仅约 18px，极难点中，用户往往据此认为
        // 「逻辑门接了输入却算不出输出」。这里让整个引脚都可点击。
        if (!dragged && cellView.model.get('type') === 'Input') {
          try {
            ensureSimRunning();
            (cellView.model as any).toggleInput?.();
            scheduleDrc();
            commit();
            return;
          } catch { /* ignore */ }
        }
        if (dragged) commit();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    const onGraphChange = () => scheduleDrc();
    paper.model.on('add', onGraphChange);
    paper.model.on('remove', onGraphChange);
    paper.model.on('change:source', onGraphChange);
    paper.model.on('change:target', onGraphChange);
    paper.model.on('change:bits', onGraphChange);

    // Keyboard
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
      if (mod && k === 'c') { copySelection(); return; }
      if (mod && k === 'x') { copySelection(); deleteSelection(); return; }
      if (mod && k === 'v') { pasteClipboard(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (mod && k === 's') { e.preventDefault(); handleSave(); return; }
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'r') { e.preventDefault(); rotateSelection(e.shiftKey ? -90 : 90); return; }
      if (mod && (k === '0' || e.key === ')')) { e.preventDefault(); resetView(); return; }
      if (e.key === 'Escape') { setSelection([]); setMenu(null); setInnerCell(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectionRef.current.size) return;
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key.startsWith('Arrow')) {
        if (!selectionRef.current.size) return;
        e.preventDefault();
        const step = e.shiftKey ? gridSize * 4 : gridSize;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]!;
        nudgeSelection(d[0], d[1]);
        commit();
      }
    };
    document.addEventListener('keydown', onKey);

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const cur = paper.scale().sx || 1;
        paper.scale(Math.max(0.3, Math.min(3, cur * (e.deltaY > 0 ? 0.9 : 1.1))));
      } else {
        e.preventDefault();
        const t = paper.translate();
        paper.translate(t.tx - e.deltaX, t.ty - e.deltaY);
      }
    };
    root.addEventListener('wheel', onWheel, { passive: false });

    let panning = false, panStartX = 0, panStartY = 0, origTx = 0, origTy = 0, panMoved = false;
    const onPanDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      panning = true; panMoved = false;
      panStartX = e.clientX; panStartY = e.clientY;
      const t = paper.translate();
      origTx = t.tx; origTy = t.ty;
      e.preventDefault();
    };
    const onPanMove = (e: MouseEvent) => {
      if (!panning) return;
      if (Math.abs(e.clientX - panStartX) + Math.abs(e.clientY - panStartY) > 4) panMoved = true;
      paper.translate(origTx + (e.clientX - panStartX), origTy + (e.clientY - panStartY));
    };
    const onPanUp = (e: MouseEvent) => {
      // 必须先确认这次右键按下确实发生在画布上（onPanDown 置位 panning）。
      // 监听器挂在 document mouseup 上：若用户在侧边栏右键，panning=false，
      // 但旧的 panMoved=false 残留会让这里继续执行 —— elementFromPoint 落在
      // 侧栏元素上就弹出画布菜单盖在侧栏上（R34 用户报告「侧栏右键弹的是画布菜单」）。
      const startedOnCanvas = panning;
      panning = false;
      if (!startedOnCanvas || e.button !== 2 || panMoved) return;
      panMoved = false;
      const x = e.clientX, y = e.clientY;
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const modelEl = el?.closest?.('[model-id]');
      const id = modelEl?.getAttribute('model-id') || null;
      const cell = id ? paper.model.getCell(id) : null;
      if (cell && !selectionRef.current.has(id as string)) setSelection([id as string]);
      if (cell && typeof cell.isLink === 'function' && cell.isLink()) openLinkMenu(x, y, id as string);
      else if (cell) openCellMenu(x, y, id as string);
      else openBlankMenu(x, y);
    };
    root.addEventListener('mousedown', onPanDown);
    document.addEventListener('mousemove', onPanMove);
    document.addEventListener('mouseup', onPanUp);

    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
    root.addEventListener('contextmenu', onContextMenu);

    const resize = () => {
      const parent = root.parentElement!;
      paper.setDimensions(parent.clientWidth, parent.clientHeight);
    };
    resize();
    requestAnimationFrame(resize);
    const ro = new ResizeObserver(resize);
    ro.observe(root.parentElement!);

    return () => {
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('mousedown', onPanDown);
      root.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('mousemove', onPanMove);
      document.removeEventListener('mouseup', onPanUp);
      document.removeEventListener('mousedown', onDocZoomDown, true);
      ro.disconnect();
      if (drcTimer) clearTimeout(drcTimer);
      // Persist the LIVE topology: switching panels unmounts this component.
      try {
        if (activeFile && paper.model.getCells().length) {
          sandboxStore.save(activeFile.id, JSON.stringify(serializePaper(paper)));
        }
      } catch { /* ignore */ }
      try { circuit.stop(); } catch {}
      paper.remove();
    };
  }, [activeFile?.id, spawnCell, resetNonce, selectAll, copySelection, deleteSelection,
      pasteClipboard, duplicateSelection, rotateSelection, alignSelection, distributeSelection,
      nudgeSelection, undo, redo, resetView, commit, rebuildFromJson, zoomBy, zoomToFit,
      openCellMenu, openLinkMenu, openBlankMenu, showToast, ensureSimRunning]);

  const handleNew = () => {
    let n = files.length + 1;
    let name = `电路_${n}.djs`;
    while (files.some(f => f.name === name)) { n++; name = `电路_${n}.djs`; }
    const f = sandboxStore.create(name);
    sandboxStore.setActiveId(f.id);
    setActiveFile(f);
    refreshList();
  };

  const handleOpen = (f: SandboxFile) => {
    if (activeFile && paperRef.current) {
      sandboxStore.save(activeFile.id, stripBoundInlineJson(JSON.stringify(serializePaper(paperRef.current)), scopeRef.current));
    }
    sandboxStore.setActiveId(f.id);
    setActiveFile(f);
  };

  const handleSave = () => {
    if (!activeFile || !paperRef.current) return;
    const snap = JSON.stringify(serializePaper(paperRef.current));
    if (activeFile.kind === 'gate') {
      // 旧 .gate（迁移前遗留）：保存时同步为同文件夹的可编辑部件，实例随之生效
      try { savePartFile(baseName(activeFile.name).replace(/\.gate$/i, ''), JSON.parse(snap), scopeRef.current); } catch { /* ignore */ }
    } else {
      sandboxStore.save(activeFile.id, stripBoundInlineJson(snap, scopeRef.current));
    }
    refreshList();
    forceUpdate(n => n + 1);
  };
  (window as any).__sandboxSave = handleSave;

  const handleStep = () => {
    const circuit = circuitRef.current;
    if (!circuit) return;
    try { circuit.updateGatesNext?.(); } catch {}
  };

  const handleReset = () => {
    const live = paperRef.current ? serializePaper(paperRef.current) : null;
    pendingResetJsonRef.current = live ? JSON.stringify(live) : (activeFile?.graphJson ?? null);
    try { circuitRef.current?.stop(); } catch {}
    setResetNonce(n => n + 1);
  };

  const handlePlayPause = () => {
    const c = circuitRef.current;
    if (!c) return;
    const next = !running;
    runningRef.current = next;
    setRunning(next);
    try { if (next) c.start(); else c.stop(); } catch {}
  };

  const clearSelectionForExport = useCallback(() => setSelectionRef.current([]), []);

  const handleExportPng = () => {
    if (!paperRef.current) return;
    clearSelectionForExport();
    const name = activeFile ? activeFile.name.replace(/\.djs$/i, '') : '电路';
    exportPng(paperRef.current, `${name}.png`, 2).catch((e) => {
      console.error('PNG 导出失败', e);
      showToast('PNG 导出失败：' + String(e?.message || e).slice(0, 60));
    });
  };

  const handleExportSvg = () => {
    if (!paperRef.current) return;
    clearSelectionForExport();
    const name = activeFile ? activeFile.name.replace(/\.djs$/i, '') : '电路';
    exportSvg(paperRef.current, `${name}.svg`).catch((e) => {
      console.error('SVG 导出失败', e);
      showToast('SVG 导出失败：' + String(e?.message || e).slice(0, 60));
    });
  };

  const handleExportVerilog = () => {
    if (!paperRef.current || !activeFile) return;
    try {
      const name = activeFile.name.replace(/\.djs$/i, '').replace(/[^\w]/g, '_') || 'sandbox_circuit';
      const v = generateVerilog(paperRef.current, name);
      const blob = new Blob([v], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${name}.v`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Verilog 已导出：' + name + '.v');
    } catch (e: any) {
      showToast('Verilog 导出失败：' + String(e?.message || e).slice(0, 60));
    }
  };

  /** 在指定屏幕坐标处放置自定义门（右键菜单二级导航用）；placeCustomGate 走视口中心。
   *  R39 绑定放置：部件文件（可编辑 .djs）→ resolveDefCells（自足 cells）→
   *  buildInnerGraph 合成活图 → 实例按 celltype 名绑定。 */
  const placeCustomGateAt = useCallback((gate: CustomGate, pos: { x: number; y: number }) => {
    const paper = paperRef.current;
    const digitaljs = (window as any).digitaljs;
    if (!paper || !digitaljs) { showToast('画布尚未就绪，无法放置自定义门'); return; }
    const cellsSnap = resolveDefCells(gate.name, scopeRef.current);
    if (!cellsSnap?.cells?.length) {
      showToast(`部件「${gate.name}」内容为空或已损坏，请打开编辑后重新保存`);
      return;
    }
    try {
      const Graph = (paper.model as any).constructor;
      const inner = buildInnerGraph(digitaljs, Graph, cellsSnap, paper.model._display3vl);
      // R40 修复「found id duplicities in ports」：digitaljs 的 Subcircuit.initialize
      // 用 IO cell 的 `net` 属性作为 port id（subcircuit.mjs L50/L53）—— 门定义里两个
      // 引脚同名（默认都未命名）时 ports id 重复，放置直接失败。这里在构建 inner 后
      // 对 IO 引脚做唯一化命名（in1/in2…、out1/out2…）。
      try {
        const ioCells = inner.getCells().filter((c: any) => ['Input', 'Output'].includes(c.get('type')));
        const used = new Set<string>();
        let inN = 0, outN = 0;
        for (const c of ioCells) {
          const isInput = c.get('type') === 'Input';
          let net = String(c.get('net') || '').trim();
          if (!net || used.has(net)) {
            net = (isInput ? `in${++inN}` : `out${++outN}`);
            while (used.has(net)) net += '_';
            c.set('net', net);
            // 同步 ioname（digitaljs IO cell 的显示/端口名来源）
            try { c.attr('ioname/text', net); c.set('ioname', net); } catch { /* older builds */ }
          }
          used.add(net);
        }
      } catch { /* best effort — dedup is defensive */ }
      const sub = new digitaljs.cells.Subcircuit({
        type: 'Subcircuit',
        graph: inner,
        subcircuitGraph: cellsSnap,
        celltype: gate.name,
        position: { x: snapVal(pos.x), y: snapVal(pos.y) },
      });
      paper.model.addCell(sub);
      try {
        const ports = sub.get('ports');
        if (ports) sub.set('ports', { ...ports });
      } catch {}
      setSelectionRef.current([sub.id]);
      commitRef.current();
    } catch (e) {
      console.warn('[自定义门] 放置失败:', e);
      showToast(`自定义门「${gate.name}」放置失败：${String((e as any)?.message || e).slice(0, 80)}`);
    }
  }, [snapVal, showToast]);

  const placeCustomGate = useCallback((gate: CustomGate) => {
    placeCustomGateAt(gate, viewportCenter());
  }, [placeCustomGateAt, viewportCenter]);

  const handleSaveGate = () => {
    const paper = paperRef.current;
    if (!paper || !activeFile) return;
    const cells = paper.model.getCells();
    const hasIn = cells.some((c: any) => c.get('type') === 'Input');
    const hasOut = cells.some((c: any) => c.get('type') === 'Output');
    if (!hasIn || !hasOut) {
      setGateError('至少需要 1 个输入引脚和 1 个输出引脚');
      return;
    }
    const name = gateName.trim();
    if (!name) { setGateError('请输入自定义门名称'); return; }
    // R39 绑定入库：整图存为**可编辑部件文件**（.djs，同文件夹）；画布上已放置的
    // 绑定式子部件递归入库并按名绑定 —— 与「复制到沙盒」递归迁移同语义。
    const r = saveGateFromCellsToFolder(name, serializePaper(paper), scopeRef.current);
    refreshGates();
    setSavingGate(false);
    setGateName('');
    setGateError(null);
    showToast(`已保存部件「${name}」为可编辑电路${r.nested ? `（${r.nested} 个子部件已递归入库绑定）` : ''}`);
    forceUpdate(n => 1 + n);
  };

  const handleDeleteGate = (g: CustomGate) => {
    if (deleteGateId !== g.id) { setDeleteGateId(g.id); return; }
    customGateStore.remove(g.id);
    setDeleteGateId(null);
    refreshGates();
    refreshList();
    showToast(`已删除部件「${g.name}」；画布上已放置的同名实例将无法展开（内嵌快照可兜底显示）`);
  };

  // 删除确认改由右键菜单直接执行（与 IDE 文件系统一致），旧的 × 两步确认已移除

  // ============ 文件管理：右键菜单 / 重命名 / 新建 / 粘贴 / 导入导出（对齐 IDE 文件系统） ============

  const syncAfterFsOp = () => { refreshList(); refreshFolders(); };

  // R39：部件是可编辑 .djs 画布文件，与普通电路文件一样单击即打开编辑。
  // 旧 kind:'gate'（迁移前的只读定义）仍走内部查看器兜底。
  const handleFileOpen = (f: SandboxFile) => {
    if (f.kind === 'gate') {
      const name = baseName(f.name).replace(/\.gate$/i, '');
      setInnerCell({ get: (k: string) => (k === 'celltype' ? name : undefined) });
      return;
    }
    handleOpen(f);
    setFileSelIds(new Set([f.id]));
  };

  const handleFileSelectToggle = (id: string) => {
    setFileSelIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleDeleteFiles = (ids: string[]) => {
    for (const id of ids) sandboxStore.remove(id);
    if (activeFile && ids.includes(activeFile.id)) setActiveFile(null);
    setFileSelIds(new Set());
    syncAfterFsOp();
    showToast(`已删除 ${ids.length} 个文件`);
  };

  /** 扫描电路 JSON 里引用的自定义门（Subcircuit.celltype）名称集合（顶层扫描；
   *  嵌套依赖由门定义闭包 walkGateClosure 递归补齐 —— R37 绑定式存档内嵌
   *  快照已被剥离，嵌套引用住在定义文件里）。 */
  const gateNamesInJson = (text: string): Set<string> => {
    const s = new Set<string>();
    const walk = (j: any, depth = 0) => {
      if (!j || depth > 16) return; // 防御性深度上限（自引用坏档）
      for (const c of j?.cells || []) {
        if (c?.type !== 'Subcircuit') continue;
        if (c.celltype) s.add(String(c.celltype));
        if (c.subcircuitGraph) walk(c.subcircuitGraph, depth + 1);
      }
    };
    try { walk(JSON.parse(text)); } catch { /* ignore */ }
    return s;
  };

  /** 部件依赖闭包：从种子名出发，沿部件文件里 Subcircuit.celltype 引用递归
   *  收集（与编译模式 resolveDependencies 同语义），供 .djs 导出随行。
   *  返回每个部件的 {name, cells}（cells = 该部件文件的可编辑画布内容）。 */
  const walkGateClosure = (seeds: Set<string>, scope: string): { name: string; cells: any }[] => {
    const out: { name: string; cells: any }[] = [];
    const seen = new Set<string>();
    const queue = [...seeds];
    while (queue.length) {
      const name = queue.shift()!;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const cells = resolveDefCells(name, scope);
      if (!cells) continue;
      out.push({ name, cells });
      const collect = (cs: any[], depth = 0) => {
        if (!cs || depth > 16) return;
        for (const c of cs) {
          if (c?.type !== 'Subcircuit' || !c.celltype) continue;
          if (!seen.has(String(c.celltype))) queue.push(String(c.celltype));
        }
      };
      collect(cells.cells);
    }
    return out;
  };

  const handleExportDjs = (f: SandboxFile) => {
    const cur = sandboxStore.get(f.id) ?? f;
    // 部件随文件走（R39）：把电路引用到的部件**依赖闭包**一并发出（cells 画布
    // 格式），外部共享时打开即自动补注册为可编辑部件，不依赖本机定义。
    const dir = cur.name.includes('/') ? cur.name.slice(0, cur.name.lastIndexOf('/')) : '';
    let payload: string;
    let carried = 0;
    if (cur.kind === 'gate' && cur.circuitJson) {
      // 旧 .gate 定义文件本身导出：直接导出定义内容
      payload = cur.circuitJson;
    } else {
      payload = cur.graphJson;
      try {
        const obj = JSON.parse(cur.graphJson);
        const used = gateNamesInJson(cur.graphJson);
        const defs = walkGateClosure(used, dir);
        if (defs.length) {
          obj.customParts = defs;
          payload = JSON.stringify(obj);
          carried = defs.length;
        }
      } catch { /* 解析失败则原样导出 */ }
    }
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = baseName(cur.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast(carried ? `已导出 ${baseName(cur.name)}（含 ${carried} 个部件定义）` : `已导出 ${baseName(cur.name)}`);
  };

  const handlePasteInto = (folder: string) => {
    const cb = fileClipboard;
    if (!cb || !cb.ids.length) return;
    if (cb.cut) {
      sandboxStore.moveFilesToFolder(cb.ids, folder);
      setFileClipboard(null);
      showToast(`已移动 ${cb.ids.length} 个文件`);
    } else {
      for (const id of cb.ids) sandboxStore.copyFile(id, folder);
      showToast(`已粘贴 ${cb.ids.length} 个文件`);
    }
    if (activeFile?.id) setActiveFile(sandboxStore.get(activeFile.id));
    syncAfterFsOp();
  };

  const uniqueDjsName = (list: SandboxFile[], name: string) => {
    let n = name.endsWith('.djs') ? name : name + '.djs';
    let i = 1;
    const stem = n.replace(/\.djs$/, '');
    while (list.some((f) => f.name === n)) { n = `${stem}_${i}.djs`; i++; }
    return n;
  };

  const handleFileRenameCommit = (t: RenameTarget, name: string) => {
    setFileRenaming(null);
    name = name.trim();
    if (!name) return;
    const f = sandboxStore.get(t.key);
    if (!f) return;
    const isPart = f.role === 'part';
    if (isPart || f.kind === 'gate') {
      // 部件改名 = 重绑定：实例按 celltype 名称绑定部件文件（编译模式语义），
      // 改名后全库扫描改写引用，展开/放置继续命中新部件。
      const base = name.replace(/\.(djs|gate|json)$/i, '');
      const oldName = baseName(f.name).replace(/\.(djs|gate|json)$/i, '');
      const n = renamePartDef(t.key, base);
      // 必须在 refreshGates（会触发画布 effect 重建 → cleanup 持久化）之前
      // 同步活画布：否则画布上仍是旧 celltype 的活实例会把存储盖回去。
      let live = 0;
      try { live = rebindLiveGraph(paperRef.current?.model, oldName, base); } catch { /* ignore */ }
      // 活画布引用的文件实体也要刷新：effect 重建时读 activeFile.graphJson，
      // 若是改名前的旧快照，重建会把旧 celltype 带回来（实测踩坑）。
      if (activeFile) {
        const fresh = sandboxStore.get(activeFile.id);
        if (fresh) setActiveFile(fresh);
      }
      refreshGates();
      syncAfterFsOp();
      showToast(`已重命名为「${base}」${n || live ? `，${n} 处存储引用 + ${live} 个画布实例已重绑定` : ''}`);
      return;
    }
    const dir = f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/')) : '';
    const target = uniqueDjsName(files.filter((x) => x.id !== t.key), dir ? dir + '/' + name : name);
    sandboxStore.rename(t.key, target);
    if (activeFile?.id === t.key) setActiveFile(sandboxStore.get(t.key));
    syncAfterFsOp();
  };

  const handleFolderRenameCommit = (t: RenameTarget, name: string) => {
    setFileRenaming(null);
    name = name.trim();
    if (!name) return;
    sandboxStore.renameFolder(t.key, name);
    if (activeFile?.id) setActiveFile(sandboxStore.get(activeFile.id));
    syncAfterFsOp();
  };

  const handleCreateCommit = (t: CreateTarget, name: string) => {
    setFileCreating(null);
    name = name.trim();
    if (!name) return;
    if (t.kind === 'folder') {
      const base = t.folder ? t.folder + '/' + name : name;
      sandboxStore.createFolder(base);
      showToast(`已创建文件夹 ${base}`);
    } else {
      const fullName = uniqueDjsName(files, t.folder ? t.folder + '/' + name : name);
      const f = sandboxStore.create(fullName);
      sandboxStore.setActiveId(f.id);
      setActiveFile(f);
      showToast(`已创建 ${fullName}`);
    }
    syncAfterFsOp();
  };

  const handleMoveFiles = (ids: string[], folder: string) => {
    sandboxStore.moveFilesToFolder(ids, folder);
    if (activeFile?.id && ids.includes(activeFile.id)) setActiveFile(sandboxStore.get(activeFile.id));
    syncAfterFsOp();
    showToast(`已移动 ${ids.length} 个文件${folder ? ' 到 ' + folder : ' 到根目录'}`);
  };

  const handleImportDjsFiles = async (list: FileList | null) => {
    if (!list || !list.length) return;
    let imported = 0;
    let partsCarried = 0;
    for (const file of Array.from(list)) {
      try {
        const text = await file.text();
        const obj = JSON.parse(text);
        // 目标文件：与源文件同名（保留文件夹结构由用户后续移动）
        const name = uniqueDjsName(sandboxStore.list(), file.name.replace(/\.(json|djs)$/i, '') + '.djs');
        const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
        // R39：.djs 内嵌的 customParts（cells）自动注册为同文件夹的可编辑部件；
        // 兼容旧 customGates（circuitJson / graphJson）。
        if (Array.isArray(obj.customParts)) {
          for (const p of obj.customParts) {
            if (!p?.name) continue;
            const cells = p.cells || (p.graphJson ? tryParse(p.graphJson) : null);
            if (cells) { savePartFile(String(p.name), cells, dir); partsCarried++; }
          }
          delete obj.customParts; // 仅作传输载体，落库不重复存储（绑定式存档）
        }
        if (Array.isArray(obj.customGates)) {
          for (const g of obj.customGates) {
            if (!g?.name) continue;
            if (g.circuitJson) {
              try { savePartFile(String(g.name), circuitJsonToCells(JSON.parse(String(g.circuitJson))), dir); partsCarried++; } catch { /* ignore */ }
            } else if (g.graphJson) {
              const cj = tryParse(String(g.graphJson));
              if (cj) { savePartFile(String(g.name), cj, dir); partsCarried++; }
            }
          }
          delete obj.customGates;
        }
        if (!Array.isArray(obj?.cells)) {
          // 旧 .gate 定义文件（编译格式）也直接导入为可编辑部件
          const gname = file.name.replace(/\.(gate\.json|gate|json)$/i, '');
          if (obj?.devices) {
            savePartFile(gname, circuitJsonToCells(obj), dir);
            partsCarried++;
            continue;
          }
          throw new Error('not a circuit');
        }
        // 内嵌快照里引用的定义先补齐（仅补缺失），再落库（save 走绑定剥离）
        ensureDefsFromCells(obj.cells, dir);
        const f = sandboxStore.create(name);
        sandboxStore.save(f.id, stripBoundInlineJson(JSON.stringify(obj), dir));
        imported++;
      } catch {
        showToast(`导入失败：${file.name} 不是有效的电路文件`);
      }
    }
    if (partsCarried) { refreshGates(); showToast(`已从文件导入 ${partsCarried} 个部件定义`); }
    if (imported) showToast(`已导入 ${imported} 个电路文件`);
    syncAfterFsOp();
  };

  const tryParse = (s: string): any | null => { try { return JSON.parse(s); } catch { return null; } };

  const handleFileCtx = (e: React.MouseEvent, f: SandboxFile) => {
    e.preventDefault();
    const inSel = fileSelIds.has(f.id);
    if (!inSel) setFileSelIds(new Set([f.id]));
    const multi = inSel && fileSelIds.size > 1;
    const ids = multi ? Array.from(fileSelIds) : [f.id];
    // 门定义文件（R37）：不是画布，菜单收敛为重命名（=重绑定）/导出/删除
    if (f.kind === 'gate' && !multi) {
      openMenuAt(e.clientX, e.clientY, baseName(f.name), [
        { label: '重命名（引用将重绑定）', input: { value: baseName(f.name).replace(/\.gate$/i, ''), onCommit: (v: string) => handleFileRenameCommit({ kind: 'file', key: f.id }, v) } },
        { label: '导出 JSON', action: () => handleExportDjs(f) },
        { label: '---' },
        { label: '删除门定义', danger: true, action: () => handleDeleteFiles([f.id]) },
      ]);
      return;
    }
    const items: ContextMenuItem[] = multi ? [
      { label: '复制', action: () => { setFileClipboard({ ids, cut: false }); showToast(`已复制 ${ids.length} 个文件`); } },
      { label: '剪切', action: () => { setFileClipboard({ ids, cut: true }); showToast(`已剪切 ${ids.length} 个文件`); } },
      { label: `删除 ${ids.length} 个文件`, danger: true, action: () => handleDeleteFiles(ids) },
    ] : [
      { label: '打开', action: () => { const cur = sandboxStore.get(f.id); if (cur) handleFileOpen(cur); } },
      { label: '重命名', input: { value: baseName(f.name), onCommit: (v: string) => handleFileRenameCommit({ kind: 'file', key: f.id }, v) } },
      { label: '创建副本', action: () => { const c = sandboxStore.duplicate(f.id); syncAfterFsOp(); if (c) showToast(`已创建副本 ${baseName(c.name)}`); } },
      { label: '复制', action: () => { setFileClipboard({ ids, cut: false }); showToast('已复制到剪贴板'); } },
      { label: '剪切', action: () => { setFileClipboard({ ids, cut: true }); showToast('已剪切到剪贴板'); } },
      { label: '---' },
      { label: '导出 JSON', action: () => handleExportDjs(f) },
      { label: '删除', danger: true, action: () => handleDeleteFiles(ids) },
    ];
    openMenuAt(e.clientX, e.clientY, baseName(f.name), items);
  };

  const handleFolderCtx = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      { label: '新建文件', input: { value: '', placeholder: '新文件名.djs', onCommit: (v: string) => handleCreateCommit({ kind: 'file', folder: path }, v) } },
      { label: '新建文件夹', input: { value: '', placeholder: '子文件夹名', onCommit: (v: string) => handleCreateCommit({ kind: 'folder', folder: path }, v) } },
      { label: '---' },
      { label: '粘贴', disabled: !fileClipboard, action: () => handlePasteInto(path) },
      { label: '---' },
      { label: '重命名文件夹', input: { value: baseName(path), onCommit: (v: string) => handleFolderRenameCommit({ kind: 'folder', key: path }, v) } },
      { label: '删除文件夹（文件移至根目录）', danger: true, action: () => {
        sandboxStore.removeFolder(path);
        if (activeFile?.id) setActiveFile(sandboxStore.get(activeFile.id));
        syncAfterFsOp();
        showToast(`已删除文件夹 ${path}，其中文件已移至根目录`);
      } },
    ];
    openMenuAt(e.clientX, e.clientY, baseName(path), items);
  };

  const handleRootCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    // 面板容器也挂了 root 菜单（R34）：树容器冒泡上来的事件在此拦住，避免双重打开
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      { label: '新建文件', input: { value: '', placeholder: '新文件名.djs', onCommit: (v: string) => handleCreateCommit({ kind: 'file', folder: '' }, v) } },
      { label: '新建文件夹', input: { value: '', placeholder: '文件夹名', onCommit: (v: string) => handleCreateCommit({ kind: 'folder', folder: '' }, v) } },
      { label: '导入文件...', action: () => importInputRef.current?.click() },
      { label: '---' },
      { label: '粘贴', disabled: !fileClipboard, action: () => handlePasteInto('') },
    ];
    openMenuAt(e.clientX, e.clientY, '沙盒文件', items);
  };

  // —— R35：部件 / 层次结构面板右键菜单（此前只有文件面板有，其余面板右键
  //    被 App 的全局 contextmenu preventDefault 吞掉，什么也不弹）——
  const handleModulesCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.clientX, e.clientY, '部件', [
      { label: '展开全部分组', action: () => setOpenGroups(new Set(PALETTE.map(g => g.group))) },
      { label: '折叠全部分组', action: () => setOpenGroups(new Set()) },
      { label: '---' },
      { label: '新建部件（保存当前电路）', action: () => setSavingGate(true) },
      { label: '放置部件', hint: '▶', action: () => {
        setTimeout(() => openMenuAt(e.clientX, e.clientY, '放置部件', gates.length
          ? gates.map(g => ({ label: g.name, hint: '部件', action: () => placeCustomGate(g) }))
          : [{ label: '（暂无自定义门）', disabled: true }]), 0);
      } },
    ]);
  };

  const handleHierarchyCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const subIds = (() => {
      const paper = paperRef.current;
      if (!paper) return [] as string[];
      return paper.model.getCells()
        .filter((c: any) => !c.isLink() && c.get('type') === 'Subcircuit')
        .map((c: any) => String(c.id));
    })();
    openMenuAt(e.clientX, e.clientY, '层次结构', [
      { label: '展开全部子电路', disabled: !subIds.length, action: () => setExpandedSubs(new Set(subIds)) },
      { label: '收起全部子电路', disabled: !subIds.length, action: () => setExpandedSubs(new Set()) },
      { label: '---' },
      { label: '刷新', action: () => forceUpdate(n => n + 1) },
    ]);
  };

  /** 侧栏容器右键分发：按当前面板弹各自的菜单（行级菜单会 stopPropagation 优先） */
  const handlePanelCtx = (e: React.MouseEvent) => {
    if (leftPanel === 'files') handleRootCtx(e);
    else if (leftPanel === 'modules') handleModulesCtx(e);
    else if (leftPanel === 'hierarchy') handleHierarchyCtx(e);
  };

  const canUndo = historyRef.current.idx > 0;
  const canRedo = historyRef.current.idx < historyRef.current.stack.length - 1;
  const selCount = selectionRef.current.size;

  // ---- 层次结构面板：选中并居中到指定器件（点击层级节点 / DRC 定位都用它） ----
  const focusCell = useCallback((cellId: string) => {
    const paper = paperRef.current;
    if (!paper) return;
    setSelectionRef.current([cellId]);
    try {
      const cell = paper.model.getCell(cellId);
      if (!cell) return;
      const pos = cell.get('position') || { x: 0, y: 0 };
      const sz = cell.size ? cell.size() : { width: 60, height: 32 };
      const sc = paper.scale().sx || 1;
      const r = paper.el.getBoundingClientRect();
      paper.translate(
        r.width / 2 - (pos.x + sz.width / 2) * sc,
        r.height / 2 - (pos.y + sz.height / 2) * sc,
      );
    } catch { /* ignore */ }
  }, []);

  /** 层次结构数据：画布器件按类型分组；自定义门（Subcircuit）可展开其内部电路 */
  const hierarchyTree = (() => {
    const paper = paperRef.current;
    const byType = new Map<string, any[]>();
    let links = 0;
    if (paper) {
      for (const c of paper.model.getCells()) {
        if (typeof c.isLink === 'function' && c.isLink()) { links++; continue; }
        const t = String(c.get('type') || '?');
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t)!.push(c);
      }
    }
    return {
      links,
      groups: Array.from(byType.entries())
        .map(([type, list]) => ({ type, label: CN_NAME[type] || type, list }))
        .sort((a, b) => b.list.length - a.list.length),
    };
  })();

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      <style>{`
        .sm-selected .body, .sm-selected .gate,
        .sm-selected .btnface, .sm-selected .led {
          stroke: var(--accent) !important;
          stroke-width: 2.5 !important;
        }
        .sm-selected .connection { stroke: var(--accent) !important; stroke-width: 3 !important; }
        .sm-illegal .connection {
          stroke: #ef4444 !important;
          stroke-width: 3 !important;
          stroke-dasharray: 7 4 !important;
        }
        /* 连线磁吸：吸附中的目标端口高亮，让用户看清会连到哪 */
        .sm-port-snap circle.port {
          stroke: var(--accent) !important;
          stroke-width: 3 !important;
          fill: var(--accent) !important;
        }
        .sm-port-snap text.iolabel, .sm-port-snap text.bits {
          fill: var(--accent) !important;
          font-weight: 600;
        }
      `}</style>
      {sidebarCollapsed ? (
        <div style={{
          width: 36, borderRight: '1px solid var(--border-subtle)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0,
          background: 'var(--surface)', paddingTop: 8,
        }}>
          <button onClick={onToggleSidebar} title={`展开${SANDBOX_PANEL_TITLE[leftPanel] || '侧栏'}`}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: '1rem', padding: 4, lineHeight: 1 }}>›</button>
        </div>
      ) : (
      <div data-sandbox-sidebar style={{
        width: sidebarW, borderRight: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        // zIndex:2 —— 把整个侧栏（含右缘 3px 拖拽手柄）抬到画布 wrapper 之上，
        // 否则外露的手柄条被后渲染的绝对定位画布盖住，拖不动；侧栏内部
        // 局部层级仍由内容容器 zIndex:1 > 手柄 决定，按钮点击不受影响。
        background: 'var(--surface)', position: 'relative', zIndex: 2,
      }}>
        {/* 右缘拖拽手柄（问题 1）：悬停变色，拖动调宽 160–420px。
            下方两个内容容器带 position:relative + zIndex:1 —— 盖在手柄之上，
            按钮点击不被拦截；手柄只在未被内容盖住的右缘空隙接收事件。 */}
        <div
          onMouseDown={onSidebarWDragStart}
          title="拖动调整宽度"
          style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%',
            cursor: 'col-resize' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        />
        {/* 面板标题栏：与 App 活动栏的 文件 / 模块 / 层次结构 三个按钮对应 */}
        <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'relative', zIndex: 1 }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontWeight: 600 }}>
            {SANDBOX_PANEL_TITLE[leftPanel] || '文件'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {onExitSandbox && (
              <button onClick={onExitSandbox} data-sandbox-exit title="退出沙盒，返回电路 / 代码视图"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '0.8125rem', padding: '0 3px', lineHeight: 1 }}>⤺</button>
            )}
            {/* 新建文件常驻标题栏：任何面板下都能直接开新电路，不必先切到「文件」 */}
            <button onClick={handleNew} title="新建文件"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 3,
                width: 20, height: 20, cursor: 'pointer', fontSize: '0.875rem', lineHeight: 1 }}>+</button>
            <button onClick={onToggleSidebar} title="收起侧栏"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.875rem', padding: '0 2px', lineHeight: 1 }}>‹</button>
          </div>
        </div>

        {/* 整个文件面板都响应「右键空白」：标题栏/滚动留白/树容器外的任意位置
            都能新建 / 导入 / 粘贴（行元素会 stopPropagation，优先弹自己的菜单）。
            仅文件面板挂载；部件 / 层次结构面板不弹文件菜单。 */}
        <div
          onContextMenu={handlePanelCtx}
          style={{ padding: 8, overflowY: 'auto', flex: 1, position: 'relative', zIndex: 1 }}>
          {leftPanel === 'files' && (
            <>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 6 }}>
                沙盒电路文件
                <span style={{ marginLeft: 6, opacity: 0.75 }}>（右键空白处可新建 / 导入，右键文件可重命名 / 副本 / 删除）</span>
              </div>
              <SandboxFileTree
                files={files}
                folders={folders}
                activeId={activeFile?.id ?? null}
                selectedIds={fileSelIds}
                renaming={fileRenaming}
                creating={fileCreating}
                onOpen={handleFileOpen}
                onSelectToggle={(id) => handleFileSelectToggle(id)}
                onFileContextMenu={handleFileCtx}
                onFolderContextMenu={handleFolderCtx}
                onRootContextMenu={handleRootCtx}
                onMoveFiles={handleMoveFiles}
                onMoveFolder={(path, newPath) => {
                  sandboxStore.moveFolder(path, newPath);
                  if (activeFile?.id) setActiveFile(sandboxStore.get(activeFile.id));
                  syncAfterFsOp();
                  showToast(`已移动文件夹 ${path} → ${newPath}`);
                }}
                onRenameCommit={(t, name) => t.kind === 'file'
                  ? handleFileRenameCommit(t, name)
                  : handleFolderRenameCommit(t, name)}
                onRenameCancel={() => setFileRenaming(null)}
                onCreateCommit={handleCreateCommit}
                onCreateCancel={() => setFileCreating(null)}
              />
              <input ref={importInputRef} type="file" accept=".djs,.json" multiple
                style={{ display: 'none' }}
                onChange={(e) => { handleImportDjsFiles(e.target.files); e.target.value = ''; }} />
            </>
          )}

          {leftPanel === 'hierarchy' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                  当前电路（{hierarchyTree.groups.reduce((n, g) => n + g.list.length, 0)} 器件 / {hierarchyTree.links} 连线）
                </span>
                <button onClick={() => forceUpdate(n => n + 1)} title="刷新层次结构"
                  style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 3,
                    color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--fs-xs)', padding: '0 4px' }}>⟳</button>
              </div>
              {hierarchyTree.groups.length === 0 && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>画布为空</div>
              )}
              {hierarchyTree.groups.map(grp => (
                <div key={grp.type} style={{ marginBottom: 5 }}>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 2 }}>
                    {grp.label} <span style={{ opacity: .7 }}>×{grp.list.length}</span>
                  </div>
                  {grp.list.map((c: any) => {
                    const isSub = c.get('type') === 'Subcircuit';
                    const open = expandedSubs.has(String(c.id));
                    const inner = isSub && open ? (c.get('graph')?.getCells?.() || []).filter((x: any) => !(typeof x.isLink === 'function' && x.isLink())) : [];
                    return (
                      <div key={c.id}>
                        <div onClick={() => focusCell(String(c.id))}
                          title={`定位「${c.get('label') || c.get('celltype') || grp.label}」`}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 3,
                            cursor: 'pointer', fontSize: 'var(--fs-xs)', color: 'var(--text)' }}>
                          {isSub ? (
                            <span onClick={(e) => { e.stopPropagation(); setExpandedSubs(prev => {
                              const n = new Set(prev);
                              n.has(String(c.id)) ? n.delete(String(c.id)) : n.add(String(c.id));
                              return n;
                            }); }} style={{ color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
                          ) : <span style={{ width: 8 }} />}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.get('label') || c.get('celltype') || grp.label}
                          </span>
                          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.5625rem' }}>
                            {bitsSuffix(c)}
                          </span>
                        </div>
                        {isSub && open && (
                          <div style={{ marginLeft: 14, borderLeft: '1px solid var(--border-subtle)', paddingLeft: 6 }}>
                            {inner.length === 0 && (
                              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>（空）</div>
                            )}
                            {inner.map((x: any) => (
                              <div key={x.id} style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {CN_NAME[x.get('type')] || x.get('type')}
                              </div>
                            ))}
                            <div onClick={() => setInnerCell(c)} title="查看内部电路"
                              style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)', cursor: 'pointer' }}>
                              查看内部电路…
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}

          {leftPanel === 'modules' && (<>
          {PALETTE.map(group => {
            const open = openGroups.has(group.group);
            return (
            <div key={group.group} style={{ marginBottom: 4 }}>
              <div
                onClick={() => toggleGroup(group.group)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 'var(--fs-xs)', color: open ? 'var(--text)' : 'var(--text-muted)',
                  marginBottom: open ? 4 : 2, fontWeight: 600, cursor: 'pointer',
                  padding: '2px 4px', borderRadius: 3, background: open ? 'var(--surface-hover)' : 'transparent' }}
                title={open ? '收起分组' : '展开分组'}
              >
                <span>{group.group}</span>
                <span style={{ fontSize: '0.625rem', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
              </div>
              {open && group.items.map(it => (
                <button key={it.label || it.type} onClick={() => doAddCell(it)} data-gate={it.type}
                  title={`放置${it.label || CN_NAME[it.type] || it.type}（${it.type}）`}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                    gap: 4, padding: '3px 6px', marginBottom: 1, fontSize: 'var(--fs-xs)', background: 'transparent',
                    border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
                  <span>{it.label || CN_NAME[it.type] || it.type}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.5625rem' }}>{it.type}</span>
                </button>
              ))}
            </div>
            );
          })}

          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '8px 0 4px', fontWeight: 600 }}>部件（可编辑电路）</div>
          {gates.map(g => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 1, fontSize: 'var(--fs-xs)' }}>
              <button onClick={() => placeCustomGate(g)} title={`放置部件“${g.name}”（点击也可在文件面板打开编辑）`}
                style={{ flex: 1, textAlign: 'left', padding: '3px 6px', background: 'transparent',
                  border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
                {g.name}
                {g.folder ? <span style={{ color: 'var(--text-muted)', marginLeft: 4, fontSize: '0.5625rem' }}>{g.folder}/</span> : null}
              </button>
              <span onClick={(e) => { e.stopPropagation(); handleDeleteGate(g); }} title="删除部件"
                style={{ cursor: 'pointer', marginLeft: 4,
                  color: deleteGateId === g.id ? 'var(--error, #ef4444)' : 'var(--text-muted)',
                  fontWeight: deleteGateId === g.id ? 700 : 400 }}>
                {deleteGateId === g.id ? '?' : '×'}
              </span>
            </div>
          ))}
          {gates.length === 0 && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>把当前电路保存为部件后可复用；「复制到沙盒」的子部件也在此列出，均可打开编辑</div>
          )}
          </>)}

          {/* DRC 与操作提示属于「电路」信息，归到层次结构面板 */}
          {leftPanel === 'hierarchy' && (<>
          {drc.length > 0 && (
            <div style={{ marginTop: 8, border: '1px solid #ef4444', borderRadius: 4, padding: 6 }}>
              <div style={{ fontSize: 'var(--fs-xs)', color: '#ef4444', fontWeight: 700, marginBottom: 3 }}>
                ⚠ {drc.length} 处非法连接
              </div>
              {drc.slice(0, 4).map((iss, i) => (
                <div key={i} onClick={() => { setSelectionRef.current([iss.linkId]); focusCell(iss.linkId); }}
                  title="点击定位该连线"
                  style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', cursor: 'pointer',
                    lineHeight: 1.35, marginBottom: 2 }}>
                  · {iss.msg}
                </div>
              ))}
              {drc.length > 4 && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>…还有 {drc.length - 4} 处</div>
              )}
            </div>
          )}

          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '8px 0 4px', fontWeight: 600 }}>操作提示</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            · 拖端口连线：靠近端口自动吸附，不必精准对准<br/>
            · 位宽不同的两端相连会自动插入转换器<br/>
            · 分线器 / 合线器放下即选位宽方案（1/2/4/8 位互转）<br/>
            · 空白拖拽 = 框选<br/>
            · 右键部件 = 菜单（含位宽 / 旋转）<br/>
            · Shift/Ctrl 点击 = 多选<br/>
            · 双击自定义门 = 查看内部<br/>
            · Ctrl+Z/Y 撤销重做，Ctrl+R 旋转<br/>
            · 方向键微移，Ctrl+0 复位视图
          </div>
          </>)}
        </div>

        <div style={{ padding: 8, borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button onClick={handleStep} disabled={!activeFile} title="单步执行"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
              单步
            </button>
            <button onClick={handleReset} disabled={!activeFile} title="复位仿真"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
              复位
            </button>
            <button onClick={handlePlayPause} disabled={!activeFile} title="运行 / 暂停仿真"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
              {running ? '暂停' : '运行'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)"
              style={{ flex: 1, padding: '4px', background: canUndo ? 'var(--surface)' : 'var(--border)',
                color: canUndo ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: canUndo ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>撤销</button>
            <button onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)"
              style={{ flex: 1, padding: '4px', background: canRedo ? 'var(--surface)' : 'var(--border)',
                color: canRedo ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: canRedo ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>重做</button>
            <button onClick={() => rotateSelection(90)} disabled={!selCount} title="旋转 90° (Ctrl+R)"
              style={{ flex: 1, padding: '4px', background: selCount ? 'var(--surface)' : 'var(--border)',
                color: selCount ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: selCount ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>旋转</button>
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button onClick={() => zoomBy(1 / 1.2)} disabled={!activeFile} title="缩小"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>−</button>
            <button onClick={() => zoomBy(1.2)} disabled={!activeFile} title="放大"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>+</button>
            <button onClick={zoomToFit} disabled={!activeFile} title="缩放至适应"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>适应</button>
            <button onClick={resetView} disabled={!activeFile} title="重置视图 (Ctrl+0)"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>1:1</button>
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button onClick={() => setWaveOpen(w => !w)} title="波形监视器：实时查看连线电平时序"
              style={{ flex: 1, padding: '4px', background: waveOpen ? 'var(--accent)' : 'var(--surface)',
                color: waveOpen ? '#fff' : 'var(--text)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>
              波形
            </button>
            <button onClick={handleExportPng} disabled={!activeFile} title="导出 PNG"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
              导出 PNG
            </button>
            <button onClick={handleExportSvg} disabled={!activeFile} title="导出 SVG"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
              导出 SVG
            </button>
          </div>
          <button onClick={handleExportVerilog} disabled={!activeFile} title="导出 Verilog（.v）：门/触发器/常量转结构化代码"
            style={{ width: '100%', marginBottom: 6, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
              color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
              borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
            导出 Verilog (.v)
          </button>
          <button onClick={handleSave} disabled={!activeFile} title="保存当前沙盒文件 (Ctrl+S)"
            style={{ width: '100%', padding: '6px', background: activeFile ? 'var(--accent)' : 'var(--border)',
              color: activeFile ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 4,
              cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)', fontWeight: 600 }}>
            {activeFile ? `保存 ${activeFile.name}` : '请先新建文件'}
          </button>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6, marginTop: 6 }}>
            {savingGate ? (
              <>
                <input autoFocus value={gateName} onChange={(e) => setGateName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGate(); if (e.key === 'Escape') { setSavingGate(false); setGateName(''); setGateError(null); } }}
                  placeholder="自定义门名称" disabled={!activeFile}
                  style={{ flex: 1, padding: '4px', fontSize: 'var(--fs-xs)', background: 'var(--surface)',
                    color: 'var(--text)', border: '1px solid var(--border-subtle)', borderRadius: 3 }} />
                <button onClick={handleSaveGate} title="确认保存为自定义门"
                  style={{ padding: '4px 8px', background: 'var(--accent)', color: '#fff', border: 'none',
                    borderRadius: 3, cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>确定</button>
                <button onClick={() => { setSavingGate(false); setGateName(''); setGateError(null); }} title="取消"
                  style={{ padding: '4px 8px', background: 'var(--surface)', color: 'var(--text)',
                    border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>×</button>
              </>
            ) : (
              <button onClick={() => setSavingGate(true)} disabled={!activeFile} title="将当前电路保存为自定义门"
                style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                  color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                  borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
                保存为自定义门
              </button>
            )}
          </div>
          {gateError && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #ef4444)', marginTop: 2, marginBottom: 4 }}>{gateError}</div>
          )}
          {onOpenSettings && (
            <button onClick={onOpenSettings} data-sandbox-settings title="打开设置面板"
              style={{ width: '100%', padding: '5px', background: 'var(--surface)', color: 'var(--text)',
                border: '1px solid var(--border-subtle)', borderRadius: 4, cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>
              设置
            </button>
          )}
        </div>
      </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div ref={wrapperRef} data-sandbox-wrapper style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
        {!activeFile && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
            点击 + 新建沙盒文件
          </div>
        )}
        {toast && (
          <div data-sandbox-toast style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)',
            background: 'rgba(239,68,68,0.95)', color: '#fff', padding: '7px 14px', borderRadius: 6,
            fontSize: 'var(--fs-xs)', zIndex: 30, maxWidth: '80%', boxShadow: '0 6px 18px rgba(0,0,0,.28)' }}>
            {toast}
          </div>
        )}
        {innerCell && (
          <SandboxExpandModal
            cell={innerCell}
            theme={theme}
            scope={scope}
            onClose={() => setInnerCell(null)}
          />
        )}
        {waveOpen && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40 }}>
            <WaveformPanel
              getChannels={waveGetChannels}
              getSample={waveGetSample}
              resetKey={activeFile?.id ?? ''}
              onClose={() => setWaveOpen(false)}
            />
          </div>
        )}
        {memViewCell && (
          <MemoryViewModal
            cell={memViewCell}
            circuitRef={circuitRef}
            onClose={() => { setMemViewCell(null); commit(); }}
          />
        )}
        {busDlg && (
          <BusWidthDialog
            mode={busDlg.type === 'BusGroup' ? '合线器' : '分线器'}
            total={busTotal} groupWidth={busGroupW}
            onTotal={setBusTotal} onGroupWidth={setBusGroupW}
            onApply={applyBusDialog}
            onClose={() => setBusDlg(null)}
          />
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} title={menu.title} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

/**
 * 总线转换器「位宽方案」对话框：一条 N 位总线 ↔ 若干组（每组 1/2/4/8 位）。
 * 分线器 = 总线 → 多组（8 位拆成 8×1、4×2、2×4 都在这里选）；
 * 合线器 = 多组 → 总线。这是 1/2/4/8 位分线之间互转的入口。
 */
function BusWidthDialog({ mode, total, groupWidth, onTotal, onGroupWidth, onApply, onClose }: {
  mode: string; total: number; groupWidth: number;
  onTotal: (n: number) => void; onGroupWidth: (n: number) => void;
  onApply: () => void; onClose: () => void;
}) {
  const TOTALS = [1, 2, 4, 8, 16, 32];
  const widths = [1, 2, 4, 8].filter(w => total % w === 0);
  const n = Math.floor(total / Math.max(1, groupWidth));
  const btn = (active: boolean): React.CSSProperties => ({
    padding: '5px 10px', fontSize: 'var(--fs-sm)', cursor: 'pointer', borderRadius: 4,
    background: active ? 'var(--accent)' : 'var(--surface)',
    color: active ? '#fff' : 'var(--text)',
    border: '1px solid var(--border-subtle)',
  });
  return (
    <div data-bus-width-dialog onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 2200,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        padding: 18, minWidth: 340, boxShadow: '0 12px 32px rgba(0,0,0,.32)' }}>
        <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
          {mode}位宽方案
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          {mode === '分线器' ? '一条总线拆成若干组（每组可取 1/2/4/8 位）' : '若干组合成一条总线'}
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 6 }}>总线位宽</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {TOTALS.map(t => (
            <button key={t} onClick={() => { onTotal(t); if (t % groupWidth !== 0) onGroupWidth(1); }} style={btn(t === total)}>{t} 位</button>
          ))}
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 6 }}>每组位宽</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {widths.map(w => (
            <button key={w} onClick={() => onGroupWidth(w)} style={btn(w === groupWidth)}>{w} 位 ×{Math.floor(total / w)}</button>
          ))}
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 14,
          background: 'var(--surface-hover)', borderRadius: 6, padding: '6px 10px' }}>
          结果：{n} 组 × {groupWidth} 位 = {n * groupWidth} 位
          <span style={{ opacity: .8 }}>（端口 {mode === '分线器' ? `out0…out${n - 1} / in` : `in0…in${n - 1} / out`}）</span>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 14px', fontSize: 'var(--fs-sm)', cursor: 'pointer',
            background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-subtle)', borderRadius: 4 }}>取消</button>
          <button onClick={onApply} style={{ padding: '6px 14px', fontSize: 'var(--fs-sm)', cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4 }}>应用</button>
        </div>
      </div>
    </div>
  );
}

export default SandboxCanvas;
