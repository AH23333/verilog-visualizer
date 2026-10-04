// 子电路「展开图」渲染库 —— 与编译模式钻取视图 100% 同管线（R35）。
//
// 用户报告（R34 遗留）：自定义部件展开图「无法百分百做到和编译模式下的部件
// 展开图渲染样式一致」。逆向定位的根因：编译模式的钻取（App.buildViewJson）
// 把子模块 JSON **提升为顶层电路**渲染 —— 顶层 Input/Output 经 io_ui 转成
// Button/Lamp/NumDisplay（30×30 + iolabel 外置标签），连线走 elk 自动布线；
// 而旧展开弹窗用 buildInnerGraph 在「子电路图」里重建（IO mode 0 + ioname
// 内嵌标签 + 手工钉尺寸），两种 markup 天然长不了样。
//
// 对齐方案：把 subcircuitGraph（cells 白名单格式）**反向转换**为 circuit JSON
// （devices/connectors/subcircuits），再走编译模式一模一样的
// io_ui → normalizeIoLabels → renameAutoCells → new Circuit({layoutEngine:
// 'elkjs'}) → displayOn 管线。渲染差异从此只剩窗口尺寸。
//
// R35b 健壮化（用户报告「展开图加载卡顿且无内容」）：
//  - 一条坏连线（端口不存在/器件缺失）就会让 `new digitaljs.Circuit` 抛
//    TypeError（Wire._changeSource 读 `getPort(...).bits`），此前整个弹窗
//    永久白屏。现在 ctor 失败自动降级：剔线重建 + 逐条补线（坏线 skip 并
//    计数），再失败剔除子电路器件重试 —— 任何输入都有渲染产出。
//  - 卡顿主源是 elk 布局同步算（实测 148 器件单长任务 2.3s）。调用方用
//    shouldAutoLayout 判定默认值：快照自带位置（编译产物/复制电路）就不跑
//    elk，与编译模式钻取一致且零开销；只有手绘图才需要自动整理。

import { io_ui } from 'yosys2digitaljs/core';
import { normalizeIoLabels, renameAutoCells } from './verilog';

type AnyCell = any;

/**
 * cells 白名单 JSON（{cells:[...]}，沙盒序列化格式）→ digitaljs circuit JSON。
 *
 * 与 buildInnerGraph 互为对偶：那边重建 joint Graph（仿真/交互用），
 * 这边产出纯数据 circuit JSON（渲染管线用）。
 *
 * R37 绑定语义：嵌套 Subcircuit 不再每实例合成一个 __subN 条目，而是
 * **按 celltype 名称分组**（与编译模式 subcircuits[模块名] 同构）——
 * 同名实例共享同一定义条目，这正是「实例绑定定义」的数据形态。
 * 没有 celltype 的匿名嵌套才退化成 __subN 内联条目。
 */
export function cellsToCircuitJson(json: { cells?: AnyCell[] } | null | undefined): any {
  const devices: Record<string, any> = {};
  const connectors: any[] = [];
  const subcircuits: Record<string, any> = {};
  let subSeq = 0;
  let wireSeq = 0;
  for (const c of json?.cells || []) {
    if (c.isLink) {
      connectors.push({
        from: { id: c.source?.id, port: c.source?.port },
        to: { id: c.target?.id, port: c.target?.port },
        name: c.netname || `N${++wireSeq}`,
        ...(c.vertices?.length ? { vertices: c.vertices } : {}),
      });
      continue;
    }
    if (c.type === 'Subcircuit') {
      const name = c.celltype ? String(c.celltype) : `__sub${++subSeq}`;
      // 同名实例共享一条定义（绑定）；内容以第一份非空内嵌图为准
      if (!subcircuits[name]) {
        subcircuits[name] = cellsToCircuitJson(c.subcircuitGraph || c.graph);
      }
      devices[c.id] = {
        id: c.id,
        type: 'Subcircuit',
        celltype: name,
        label: c.label || c.celltype || name,
        ...(c.position ? { position: c.position } : {}),
      };
      continue;
    }
    devices[c.id] = {
      id: c.id,
      type: c.type,
      // celltype 是器件符号标识（& / ≥1 / Dff 变体），漏了会渲染成裸框
      ...(c.celltype ? { celltype: c.celltype } : {}),
      ...(c.label ? { label: c.label } : {}),
      ...(c.bits != null ? { bits: c.bits } : {}),
      ...(c.net ? { net: c.net } : {}),
      ...(c.position ? { position: c.position } : {}),
      ...(c.size ? { size: c.size } : {}),
      ...(c.propagation != null ? { propagation: c.propagation } : {}),
      ...(c.constant != null ? { constant: c.constant } : {}),
      ...(c.polarity ? { polarity: c.polarity } : {}),
      ...(c.initial != null ? { initial: c.initial } : {}),
      ...(Array.isArray(c.groups) ? { groups: c.groups } : {}),
      ...(c.slice ? { slice: c.slice } : {}),
      ...(c.abits != null ? { abits: c.abits } : {}),
      ...(Array.isArray(c.rdports) ? { rdports: c.rdports } : {}),
      ...(Array.isArray(c.wrports) ? { wrports: c.wrports } : {}),
    };
  }
  return { devices, connectors, subcircuits };
}

/**
 * cellsToCircuitJson 的**逆运算**：编译格式电路 JSON → cells 白名单快照。
 *
 * R39「复制到沙盒的子部件也要可编辑」：递归复制进来的子模块体是编译格式
 * （{devices, connectors, subcircuits}），要落成沙盒里**可编辑的 .djs 画布
 * 文件**，必须先转成 cells 快照（沙盒唯一的一等公民格式）。转换后该子模块
 * 就是普通沙盒文件，可打开、可摆放器件、可连线、可仿真、可再保存为门。
 *
 * 语义对齐：
 *  - device 字段按 cellsToCircuitJson 的正向映射逐字段回填（子集对称）；
 *  - connectors → isLink 单元格（netname 保留，vertices 保留布局拐点）；
 *  - **嵌套 Subcircuit device 不内联 subcircuitGraph** —— 它们按 celltype
 *    名称绑定到各自的文件（与顶层实例同语义），内联会与「单一真源」打架；
 *    加载时由 loadCells 的绑定分支按 celltype 解析。
 */
export function circuitJsonToCells(mod: any): { cells: AnyCell[] } {
  const cells: AnyCell[] = [];
  for (const [key, dev0] of Object.entries<any>(mod?.devices || {})) {
    const dev: any = dev0 || {};
    // 器件 id：优先 dev.id，否则用 devices 的键（yosys2digitaljs 产物两者等价，
    // 但不少子模块体只在键上带 id —— 只认 dev.id 会把整个子模块丢空）
    const id = dev.id || key;
    if (!id) continue;
    const c: any = { id, type: dev.type };
    if (dev.type === 'Subcircuit') {
      // 只保留绑定名（celltype），内图由文件解析（单一真源）
      c.celltype = dev.celltype || '';
    } else if (dev.celltype) {
      c.celltype = dev.celltype;
    }
    if (dev.label != null) c.label = dev.label;
    if (dev.bits != null) c.bits = dev.bits;
    if (dev.net != null) c.net = dev.net;
    if (dev.position) c.position = dev.position;
    if (dev.size) c.size = dev.size;
    if (dev.propagation != null) c.propagation = dev.propagation;
    if (dev.angle != null) c.angle = dev.angle;
    if (dev.constant != null) c.constant = dev.constant;
    if (dev.polarity != null) c.polarity = dev.polarity;
    if (dev.initial != null) c.initial = dev.initial;
    if (Array.isArray(dev.groups)) c.groups = dev.groups;
    if (dev.slice) c.slice = dev.slice;
    if (dev.abits != null) c.abits = dev.abits;
    if (Array.isArray(dev.rdports)) c.rdports = dev.rdports;
    if (Array.isArray(dev.wrports)) c.wrports = dev.wrports;
    cells.push(c);
  }
  for (const conn of mod?.connectors || []) {
    if (!conn?.from?.id || !conn?.to?.id) continue;
    const l: any = {
      isLink: true,
      source: { id: conn.from.id, port: conn.from.port },
      target: { id: conn.to.id, port: conn.to.port },
      netname: conn.name || 'N',
    };
    if (Array.isArray(conn.vertices) && conn.vertices.length) l.vertices = conn.vertices;
    cells.push(l);
  }
  return { cells };
}


/**
 * 展开图默认是否该自动整理布局：
 *  - 编译产物 / 复制到沙盒的电路：elk 布局位置被快照携带，x 值多样 → 保留
 *    原位（零 elk 开销，与编译模式钻取一致）。
 *  - 手绘图：器件在沙盒里是整图平移放置的，x 值单一（同列堆叠）→ 需要 elk。
 * 判据 = 器件 x 坐标的多样性（≥3 个不同列视为有真实布局）。
 */
export function shouldAutoLayout(cellsJson: { cells?: AnyCell[] } | null | undefined): boolean {
  const nodes = (cellsJson?.cells || []).filter((c) => !c.isLink);
  if (!nodes.length) return true;
  const xs = new Set(nodes.map((c) => Math.round(c.position?.x ?? 0)));
  return xs.size < Math.min(nodes.length, 3);
}

/** 同 shouldAutoLayout，但输入是编译格式 circuit JSON（R37 门定义路径用） */
export function shouldAutoLayoutCircuit(circuitJson: any): boolean {
  const nodes = Object.values<any>(circuitJson?.devices || {});
  if (!nodes.length) return true;
  const xs = new Set(nodes.map((d: any) => Math.round(d.position?.x ?? 0)));
  return xs.size < Math.min(nodes.length, 3);
}

/**
 * 复用 Canvas.tsx 编译视图的后处理：digitaljs 的 from_elkjs 把每个拐点拆成
 * 相距 10px 的两段（给 joint 圆角留空间），合并 <25px 的点对为单一直角拐点。
 */
function mergeWireVertices(paper: any) {
  try {
    for (const lk of paper.model.getLinks()) {
      try {
        const verts = lk.get('vertices') || [];
        if (!verts.length) continue;
        const merged = [verts[0]];
        for (let i = 1; i < verts.length; i++) {
          const prev = merged[merged.length - 1];
          const cur = verts[i];
          const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
          if (dist < 25) merged[merged.length - 1] = { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 };
          else merged.push(cur);
        }
        lk.set('vertices', merged);
      } catch { /* per-link best effort */ }
    }
  } catch { /* cosmetic */ }
}

export interface SubcircuitViewHandle {
  circuit: any;
  paper: any;
  /** 降级渲染时无法还原的连线数（0 = 完整还原） */
  skippedWires: number;
  /** 净化阶段被丢弃的器件数（类型未知/构造失败） */
  skippedDevices: number;
}

interface SanitizeStats { skippedWires: number; skippedDevices: number; }

/**
 * 构造前净化（R36）：对 top + 所有嵌套 subcircuits 做**后序**遍历 ——
 * 先净化最深层模块，再用临时 Graph 试建每个器件、每条连线，坏的丢弃并计数。
 *
 * 为什么必须这么做：Circuit._makeGraph 对 Subcircuit 器件会先建内图（内图的
 * 连线在**器件构造期**就 addCell），内图里一条坏线（引用不存在的端口，如
 * Dff 未带 polarity.clock 时没有 clk 脚）会让 ctor 抛 TypeError —— 而
 * 「剔线重建」兜底会原样重跑同样的器件构造，同样炸，异常直接漏成
 * 「渲染失败」。只有构造前把坏数据剥掉才能根治。
 */
export function sanitizeModule(
  mod: { devices: Record<string, any>; connectors: any[]; subcircuits: Record<string, any> },
  digitaljs: any,
  GraphCtor: any,
  seen = new Set<object>(),
): SanitizeStats {
  const stats: SanitizeStats = { skippedWires: 0, skippedDevices: 0 };
  if (seen.has(mod)) return stats; // 防御：病态数据自引用
  seen.add(mod);
  // 1. 后序：先净化嵌套模块（父层试建 Subcircuit 器件时要给它们建内图）
  for (const key of Object.keys(mod.subcircuits || {})) {
    const sub = mod.subcircuits[key];
    if (!sub?.devices) continue;
    const r = sanitizeModule(sub, digitaljs, GraphCtor, seen);
    stats.skippedWires += r.skippedWires;
    stats.skippedDevices += r.skippedDevices;
  }
  // 2. 由（已净化的）模块定义构建临时图试建 —— 与 Circuit._makeGraph 同序
  const buildGraph = (m: { devices: Record<string, any>; connectors: any[]; subcircuits?: Record<string, any> }): any => {
    const g = new GraphCtor();
    for (const [id, dev] of Object.entries<any>(m.devices)) {
      const cellType = (dev.type in digitaljs.cells) ? digitaljs.cells[dev.type] : null;
      if (!cellType) { stats.skippedDevices++; delete m.devices[id]; continue; }
      try {
        const args: any = { ...dev, id };
        if (cellType === digitaljs.cells.Subcircuit) {
          // Subcircuit.initialize 强制要求 graph 属性 —— 附上（已净化的）内图
          args.graph = buildGraph(m.subcircuits?.[dev.celltype] || { devices: {}, connectors: [] });
        }
        g.addCell(new cellType(args));
      } catch {
        stats.skippedDevices++;
        delete m.devices[id];
      }
    }
    for (const conn of m.connectors || []) {
      try {
        g.addCell(new digitaljs.cells.Wire({
          source: { id: conn.from.id, port: conn.from.port, magnet: 'port' },
          target: { id: conn.to.id, port: conn.to.port, magnet: 'port' },
          netname: conn.name,
          vertices: conn.vertices || [],
          source_positions: conn.source_positions || [],
        }));
      } catch {
        stats.skippedWires++;
        conn.__bad = true;
      }
    }
    m.connectors = (m.connectors || []).filter((c) => !c.__bad);
    return g;
  };
  buildGraph(mod);
  return stats;
}

/**
 * 与编译模式钻取同管线渲染子电路展开图（只读）—— 旧入口（cells 快照）。
 * R37 起主体逻辑移入 renderCircuitView（编译格式 circuit JSON 入口），
 * 这里只做 cells→circuit 反向转换后委托。绑定门定义的新代码请直接用
 * renderCircuitView（零反向转换，定义即编译格式）。
 */
export function renderSubcircuitView(
  digitaljs: any,
  mount: HTMLElement,
  cellsJson: { cells?: AnyCell[] } | null | undefined,
  opts: { autoLayout?: boolean } = {},
): SubcircuitViewHandle | null {
  if (!cellsJson?.cells?.length) return null;
  const json = cellsToCircuitJson(cellsJson);
  if (!Object.keys(json.devices).length) return null;
  return renderCircuitView(digitaljs, mount, json, opts);
}

/** 递归剥掉（嵌套模块里的）器件位置，交给 elk 重新布局 */
function stripPositions(mod: any, seen = new Set<object>()) {
  if (!mod || seen.has(mod)) return;
  seen.add(mod);
  for (const d of Object.values<any>(mod.devices || {})) delete d.position;
  for (const s of Object.values<any>(mod.subcircuits || {})) stripPositions(s, seen);
}

/**
 * 渲染「编译格式 circuit JSON」视图（R37 主入口）—— 与编译模式钻取
 * （App.buildViewJson → io_ui → normalizeIoLabels → renameAutoCells →
 * new Circuit({elkjs}) → displayOn）100% 同管线，且**零反向转换**：
 * 输入就是编译格式，不再从内嵌 cells 快照逆向重建。
 *
 * autoLayout=true 时剥位置走 elk；false 保留原位（编译产物自带 elk 布局）。
 * 失败兜底与旧版一致（净化 + 剥线重建 + 逐条补线）。
 */
export function renderCircuitView(
  digitaljs: any,
  mount: HTMLElement,
  circuitJson: any,
  opts: { autoLayout?: boolean } = {},
): SubcircuitViewHandle | null {
  if (!circuitJson?.devices || !Object.keys(circuitJson.devices).length) return null;
  // 诊断钩子：各阶段耗时时间线（tests 探针读取；window.__expandStages）
  const T0 = performance.now();
  const stages: string[] = [];
  const mark = (s: string) => stages.push(`${s}:${Math.round(performance.now() - T0)}ms`);
  (window as any).__expandStages = stages;
  mark('entry');
  const json = structuredClone(circuitJson);
  // 防御性归一化：yosys2digitaljs 的子模块体可能只有 {devices, connectors}，
  // 缺 connectors/subcircuits；下游 io_ui / digitaljs ctor 会直接读
  // `json.subcircuits[x].devices` 而抛 "Cannot read properties of undefined"。
  if (!Array.isArray(json.connectors)) json.connectors = [];
  if (!json.subcircuits || typeof json.subcircuits !== 'object') json.subcircuits = {};
  mark('clone');
  // 与 buildViewJson 完全一致的三步后处理 —— IO 变 Button/Lamp、标签换成端口名
  try { io_ui(json); } catch { /* keep raw IO */ }
  mark('io_ui');
  try { normalizeIoLabels(json as any); } catch { /* optional */ }
  try { renameAutoCells(json as any); } catch { /* optional */ }
  mark('postprocess');
  if (opts.autoLayout) stripPositions(json);
  let circuit: any;
  let skippedWires = 0;
  let skippedDevices = 0;
  mark('ctor-begin');
  const built = constructCircuit(digitaljs, json);
  circuit = built.circuit;
  skippedWires = built.skippedWires;
  skippedDevices = built.skippedDevices;
  mark('ctor-done');
  const paper = circuit.displayOn(mount);
  mark('displayOn-done');
  mergeWireVertices(paper);
  // 诊断：打印渲染结果（开发期定位「只渲染器件不渲染连线」用）
  const linkCount = paper.model.getLinks().length;
  const elementCount = paper.model.getElements().length;
  console.log(`[renderCircuitView] devices=${Object.keys(json.devices).length} connectors=${json.connectors.length} rendered_elements=${elementCount} rendered_links=${linkCount} skippedWires=${skippedWires} skippedDevices=${skippedDevices}`);
  mark('done');
  // R35：digitaljs 的 cell 构造把 label 文本硬设为器件 id（dev0/dev13…），
  // JSON 里的 label 不生效 —— 编译视图（Canvas.tsx）在 displayOn 后对 IO/总线
  // 器件补写标签，这里必须做同样的后处理，否则展开图端口没有名字（R33 报告）。
  try {
    const IO_TYPES = new Set(['Button', 'Clock', 'Lamp', 'NumDisplay', 'Display7']);
    for (const el of paper.model.getElements()) {
      const type = el.get('type');
      if (!type) continue;
      if (IO_TYPES.has(type)) {
        const net = el.get('net');
        if (net) { el.set('label', net); el.attr('label/text', net); }
      } else if (type === 'BusGroup') {
        // 合线器标签 = 触碰它的第一条有名连线（与 Canvas 同策略）
        const conn = (json.connectors || []).find((c: any) =>
          c?.from?.id === el.id || c?.to?.id === el.id);
        const name = conn?.name;
        if (name) { el.set('label', String(name)); el.attr('label/text', String(name)); }
      }
    }
  } catch { /* cosmetic */ }
  return { circuit, paper, skippedWires, skippedDevices };
}

/**
 * Circuit 构造兜底链（R36 引入，R37 抽出供 renderCircuitView 复用）。
 * 坏连线的特殊性 —— joint 在 addCell 时**先插入图、后触发 `_changeSource`
 * 读 `getPort(...).bits`** 才抛（plain Graph 不抛、Circuit 活图才抛），且嵌套
 * 模块的坏线会在 Subcircuit **器件构造期**炸掉整个 ctor。所以：先试完整
 * ctor（正常路径零开销）；失败则净化器件 + 剥掉全层级连线重建，再在真实
 * Circuit 图里逐模块补线（失败时移除「已插入但抛错」的僵尸线）。
 * 全部兜底仍失败时抛出真实原因。
 */
export function constructCircuit(digitaljs: any, json: any): {
  circuit: any; skippedWires: number; skippedDevices: number;
} {
  let skippedWires = 0;
  let skippedDevices = 0;
  try {
    return { circuit: new digitaljs.Circuit(json, { layoutEngine: 'elkjs' }), skippedWires, skippedDevices };
  } catch (e) {
    console.error('[constructCircuit] 正常路径失败，进入降级:', e);
    console.error('[constructCircuit] 失败的 json keys:', Object.keys(json.devices || {}), 'connectors:', (json.connectors || []).length);
    for (const conn of json.connectors || []) {
      console.error('[constructCircuit] connector:', JSON.stringify(conn));
    }
    // 降级 1：器件级净化（类型未知/构造即炸的器件剔除；嵌套模块后序净化）
    try {
      const GraphCtor = new digitaljs.Circuit({ devices: {}, connectors: [] })._graph.constructor;
      const stats = sanitizeModule(json, digitaljs, GraphCtor);
      skippedWires += stats.skippedWires;
      skippedDevices += stats.skippedDevices;
    } catch { /* 净化失败则交给下一步 */ }
    // 降级 2：剥掉全层级连线重建 —— 嵌套模块的坏线在器件构造期就炸，
    // 只剥顶层是不够的（这正是「渲染失败」的根因）
    const strip = (m: any): any => ({
      devices: m.devices, connectors: [],
      subcircuits: Object.fromEntries(Object.entries(m.subcircuits || {}).map(([k, v]: [string, any]) => [k, strip(v)])),
    });
    let circuit: any;
    try {
      circuit = new digitaljs.Circuit(strip(json), { layoutEngine: 'elkjs' });
    } catch (e2) {
      // 器件级异常连净化都拦不住 —— 把真实原因交给弹窗提示
      throw new Error(String((e2 as Error)?.message || e2));
    }
    // 降级 3：逐模块补线（真实 Circuit 图环境）。注意坏线在 addCell 时会
    // 「先插入图、后抛异常」，所以补线前先做端口存在性预检（与 joint 的
    // _changeSource/_checkConnection 同判据），坏线根本不入图；万一仍抛，
    // 再把僵尸线从图里清掉，避免污染渲染与仿真。
    const reAdd = (graph: any, m: any): number => {
      let skipped = 0;
      for (const conn of m.connectors || []) {
        const srcCell = graph.getCell ? graph.getCell(conn.from?.id) : null;
        const tgtCell = graph.getCell ? graph.getCell(conn.to?.id) : null;
        if (!srcCell || !tgtCell
          || typeof srcCell.getPort !== 'function' || typeof tgtCell.getPort !== 'function'
          || !srcCell.getPort(conn.from?.port) || !tgtCell.getPort(conn.to?.port)) {
          skipped++;
          continue;
        }
        let w: any = null;
        try {
          w = new digitaljs.cells.Wire({
            source: { id: conn.from.id, port: conn.from.port, magnet: 'port' },
            target: { id: conn.to.id, port: conn.to.port, magnet: 'port' },
            netname: conn.name,
            vertices: conn.vertices || [],
            source_positions: conn.source_positions || [],
          });
          graph.addCell(w);
        } catch {
          skipped++;
          try { if (w && graph.getCell(w.id)) graph.removeCell(w); } catch { /* ignore */ }
        }
      }
      for (const el of graph.getElements()) {
        if (el.get('type') !== 'Subcircuit') continue;
        const sub = (m.subcircuits || {})[el.get('celltype')];
        const g = el.get('graph');
        if (sub && g) skipped += reAdd(g, sub);
      }
      return skipped;
    };
    skippedWires += reAdd(circuit._graph, json);
    return { circuit, skippedWires, skippedDevices };
  }
}
