// Shared subcircuit (custom gate / compiled module) inner-graph helpers.
//
// Extracted from SandboxCanvas.tsx (R34 refactor) so that placement, expand
// view and loadCells all consume ONE implementation. Also hosts the
// compile-mode-parity paper factory used by the expand modal.
//
// WHY NOT paper.model.toJSON(): digitaljs cells carry runtime objects in their
// attrs (Vector3vl `signal`, nested `graph` Graphs) — see sandboxSerialize.ts.

import { serializeGraphCells } from './sandboxSerialize';
import { ctorParams } from './deviceParams';

/**
 * Rebuild a live inner Graph from a whitelisted cells JSON snapshot.
 *
 * Used by:
 *  - placing a custom gate (Subcircuit cell needs a live `graph`),
 *  - the expand modal (fresh copy so layout/dragging never mutates the cell),
 *  - sandbox file loadCells (restore Subcircuit cells from disk).
 *
 * R34: inner IO `net` names are now DEDUPED. digitaljs's Subcircuit.initialize
 * builds port ids from `io.get('net')` — two IOs sharing a net (possible via
 * copy-paste of renamed IOs or legacy saves) made joint.js throw
 * "Element: found id duplicities in ports", which surfaced as
 * 「放置失败：Element: found id duplicities in ports」on every placement.
 */
export function buildInnerGraph(digitaljs: any, Graph: any, json: any, display3vl?: any) {
  const inner = new Graph();
  inner._display3vl = display3vl;
  inner._warnings = 0;
  inner.set('subcircuit', true);
  const innerMap = new Map<string, any>();
  const innerInputs: any[] = [];
  const innerOutputs: any[] = [];
  let wn = 0;
  for (const cc of json?.cells || []) {
    if (cc.isLink) continue;
    const C = digitaljs.cells?.[cc.type];
    if (!C) continue;
    try {
      const isPort = cc.type === 'Input' || cc.type === 'Output';
      // 嵌套自定义门：递归重建其内部电路（否则内层 Subcircuit 缺 graph 构造参数
      // 直接抛错被跳过，展开图里出现空壳）
      if (cc.type === 'Subcircuit') {
        const nested = cc.subcircuitGraph || cc.graph;
        const innerArgs: any = { type: 'Subcircuit', position: cc.position || { x: 50, y: 50 }, celltype: cc.celltype || '' };
        if (nested) {
          const innerGraph = buildInnerGraph(digitaljs, Graph, nested, display3vl);
          innerArgs.graph = innerGraph;
          // 白名单序列化（不用 toJSON：内部图 cell.attrs 上挂着运行时对象）
          innerArgs.subcircuitGraph = serializeGraphCells(innerGraph);
        } else {
          // 缺内部图（旧存档/外部导入）：给空图兜底，至少让外壳渲染出来，
          // 不至于在 addCell 时抛错把整个器件丢掉
          innerArgs.graph = new Graph();
          innerArgs.graph._display3vl = display3vl;
          innerArgs.graph._warnings = 0;
        }
        const subCell = new C(innerArgs);
        if (cc.id) subCell.set('id', cc.id);
        inner.addCell(subCell);
        if (cc.id) innerMap.set(cc.id, subCell);
        continue;
      }
      // 器件特有配置必须构造时传入（事后 set 不重建端口/不生效）——与 loadCells 共用
      // deviceParams 的清单。缺失会导致：Constant 值归零、Dff 丢 clk 引脚、
      // BusGroup/Slice 端口错乱、Memory 丢端口配置、ZeroExtend 位宽退回默认 1→1。
      const extra: any = ctorParams(cc);
      if (cc.type === 'Memory' && cc.memdata) extra.memdata = cc.memdata; // 内存内容随子电路保留
      const extraSize =
        cc.type === 'Memory'
          ? { width: 88, height: 16 * (((cc.rdports || []).length + (cc.wrports || []).length) * 3 || 6) + 8 }
          : (cc.type === 'BusGroup' || cc.type === 'BusUngroup')
            ? { width: 40, height: 16 * ((cc.groups || [[], [], [], []]).length || 4) + 8 }
            : undefined;
      // 必须显式带 size：否则内部图的 Input/Output 会用默认宽度，并被端口标签（in1/out1）
      // 自动撑成横向长条。端口保持 30×30，其余器件沿用主画布的 60×32。
      const cell = new C({
        type: cc.type,
        position: cc.position || { x: 50, y: 50 },
        bits: cc.bits || 1,
        net: cc.net || '',
        // 器件标识：celltype 决定门符号（& / ≥1 / =1…）与 Dff/Lamp 等的渲染变体，
        // label 是用户重命名。漏传 → 展开图里全是无标识的裸框（R33 用户报告）。
        celltype: cc.celltype,
        label: cc.label,
        // 引脚顺序键（见 sandboxSerialize 的说明）：漏了会让部件的端口按字母序重排
        order: cc.order,
        size: isPort ? { width: 30, height: 30 } : (extraSize || cc.size || { width: 60, height: 32 }),
        // 必须带上 attrs：内部图是「序列化 → 重建」的，若不带，之前为消除横向拉伸而设的
        // ioname/display:none 会在重建时丢失，端口又变回按标签加宽的横条。
        attrs: cc.attrs,
        ...extra,
      });
      if (cc.id) cell.set('id', cc.id);
      if (isPort) {
        try { cell.set('mode', 0); } catch { /* non-subcircuit IO */ }
      }
      inner.addCell(cell);
      // 必须在 addCell 之后锁定：IO 的 onAdd → _checkMode() 会把 box_resized 重置为 false，
      // 于是端口又按 ioname 标签自动加宽（渲染成约 58×30 的横条）。这里在加入图之后再
      // 锁死盒体并钉住 30×30，才能真正消除横向拉伸。
      if (isPort) {
        try { cell.set('box_resized', true); } catch { /* 不支持该属性的器件 */ }
        try {
          if (cell.prop('size/width') !== 30) cell.prop('size/width', 30);
          if (cell.prop('size/height') !== 30) cell.prop('size/height', 30);
        } catch { /* ignore */ }
        // 真正的拉伸来源：digitaljs 的 _calculateBoxWidth() 在 mode 0（子电路内）时
        // 返回「ioname 标签宽度 + 10」，宽度随标签变长（约 58），于是端口被拉成横条；
        // 而顶层 mode 1 固定返回 30，所以只有展开图会变形。
        // R30 用 display:none 一刀切隐藏，导致展开图里 IO 端口没有任何标识
        // （R33 用户报告「没有部件标识」）。现改为保留 ioname 显示，靠上面
        // box_resized=true + 显式 size/width 钉死盒体防拉伸。
        // 另：_checkMode 的 markup 切换实测未生效（markup 停留为空），这里显式
        // 换成 markupInSubcircuit，才会有 ioname 文本元素、端口名才显示得出来。
        try {
          const proto: any = cell.constructor.prototype;
          const mk = proto.markupInSubcircuit;
          if (Array.isArray(mk)) cell.set('markup', mk);
        } catch { /* ignore */ }
      }
      if (cc.id) innerMap.set(cc.id, cell);
      // 收集 IO 引脚：展开图要显示端口名（digitaljs 的 ioname 文本绑定到 net 属性，
      // 沙盒 IO 的 net 为空 → iolabel 一直是空白，R33 用户报告「没有部件标识」）
      if (isPort) (cc.type === 'Input' ? innerInputs : innerOutputs).push(cell);
    } catch { /* skip bad inner cell */ }
  }
  dedupeIoNets(innerInputs, innerOutputs);
  for (const cc of json?.cells || []) {
    if (!cc.isLink) continue;
    try {
      const sCell = innerMap.get(cc.source?.id);
      const tCell = innerMap.get(cc.target?.id);
      if (!sCell || !tCell) continue;
      const link = new digitaljs.cells.Wire({
        source: { id: sCell.id, port: cc.source?.port },
        target: { id: tCell.id, port: cc.target?.port },
        netname: `N${++wn}`,
        // 线宽跟住源端口（Wire 默认 1 位，多位信号会断）
        bits: (() => { if (typeof cc.bits === 'number') return cc.bits; const b = sCell.getPort?.(cc.source?.port)?.bits; if (typeof b === 'number') return b; const n = Number(b?.in ?? b?.out ?? b); return Number.isFinite(n) && n > 0 ? n : 1; })(),
        // 用户拉线时的手动拐点必须保留，否则展开图里连线走默认路径
        ...(cc.vertices ? { vertices: cc.vertices } : {}),
      });
      inner.addCell(link);
    } catch { /* skip broken inner link */ }
  }
  // Mirror circuit.js's wiring so the inner graph actually propagates signals.
  inner.listenTo(inner, 'change:outputSignals', (gate: any, sigs: any) => {
    if (gate && typeof gate._changeOutputSignals === 'function') gate._changeOutputSignals(sigs);
  });
  inner.listenTo(inner, 'change:signal', (wire: any, signal: any) => {
    if (wire && typeof wire._changeSignal === 'function') wire._changeSignal(signal);
  });
  return inner;
}

/**
 * R34: make sure every inner IO has a UNIQUE net name.
 *
 * digitaljs 的 Subcircuit.initialize 用 `io.get('net')` 当端口 id —— 空网名或
 * 重复网名（复制带 net 的 IO、历史存档）都会让 joint 抛
 * 「found id duplicities in ports」，自定义门从此放不进去。
 * 规则：先按画布位置（上→下、左→右）排序；已有唯一网名的保留，
 * 空名/重名的自动编 inN / outN。
 */
function dedupeIoNets(innerInputs: any[], innerOutputs: any[]) {
  const byPos = (a: any, b: any) => {
    const pa = a.position() || { x: 0, y: 0 }, pb = b.position() || { x: 0, y: 0 };
    return (pa.y - pb.y) || (pa.x - pb.x);
  };
  const ios = [...innerInputs.sort(byPos), ...innerOutputs.sort(byPos)];
  const netCount = new Map<string, number>();
  for (const c of ios) {
    const n = String(c.get('net') || '').trim();
    netCount.set(n, (netCount.get(n) || 0) + 1);
  }
  const used = new Set<string>([...netCount.keys()].filter(Boolean));
  const nextName = (prefix: string) => {
    let i = 1;
    while (used.has(prefix + i)) i++;
    const name = prefix + i;
    used.add(name);
    return name;
  };
  for (const c of ios) {
    const isInput = innerInputs.includes(c);
    const raw = String(c.get('net') || '').trim();
    // 空名，或与其他 IO 撞名 → 自动编号（保留唯一的具体名，如编译产物的 a/b/c）
    if (!raw || (netCount.get(raw) || 0) > 1) {
      const name = nextName(isInput ? 'in' : 'out');
      try { c.set('net', name); c.attr('ioname/text', name); } catch { /* ignore */ }
    }
  }
}

// R35：createSubcircuitPaper（_makePaper 直连工厂）已删除 —— 展开图改走
// src/lib/subcircuitView.ts 的「提升为顶层」管线，与编译模式钻取完全同源，
// 手搓 paper options 的近似路线废弃。
