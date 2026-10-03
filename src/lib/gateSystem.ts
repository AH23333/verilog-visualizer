// 门定义文件系统 + 部件绑定系统（R37）—— 把编译模式的架构语义迁移到沙盒。
//
// 编译模式的架构（fileStore.ts / App.resolveDependencies / buildViewJson）：
//   - 每个模块是一个文件（definedModules），实例按「模块名」绑定定义文件；
//   - 编译产物 circuitJson.subcircuits[名] 自带全部子级模块体（层级化）；
//   - 钻取 = buildViewJson 提升子模块体 → io_ui → Circuit 渲染，从不反向转换。
//
// 沙盒旧架构的病根（历次「渲染失败」的结构性原因）：门定义内嵌在每个实例的
// subcircuitGraph（joint cells 快照）里，渲染前必须 cells→circuit **反向转换**，
// 任何属性缺失/坏线都会在转换或构造期炸掉。R35/R35b/R36 的净化兜底治标不治本。
//
// 迁移后（用户方案）：
//   1. 门定义 = 沙盒文件系统里 kind:'gate' 的一等文件（文件树显示 <名>.gate），
//      内容是编译格式 circuit JSON —— 定义即编译管线原生数据；
//   2. 绑定：画布 Subcircuit 实例按 celltype 名称绑定定义（同编译模式
//      moduleBindings 语义）；重命名定义 → 全库重绑定；
//   3. 递归复制迁移：「复制到沙盒」把编译结果里的子级部件**递归复制**成
//      门定义文件并绑定（collectFromCircuit）；「保存为自定义门」同样递归入库
//      嵌套子级（saveGateFromCells）；
//   4. 展开图 = resolveDefCircuit(名) 合并依赖定义 → renderCircuitView
//      直接走编译模式钻取管线（零反向转换）；
//   5. 旧数据迁移：migrateLegacy 把旧 GATES_KEY 存档与文件内嵌 subcircuitGraph
//      一次性抽取为门定义文件，并在持久化时剥离已绑定的内嵌快照。

import { sandboxStore, customGateStore, baseName, type SandboxFile } from '../store/sandboxStore';
import { cellsToCircuitJson } from './subcircuitView';

export interface GateDefView { id: string; name: string; circuitJson: string; }

// ============ 门定义文件 CRUD（文件系统层）============

/** 门名 → 门定义文件（沙盒文件系统里 kind:'gate'） */
export function getGateDefByName(name: string): GateDefView | null {
  return customGateStore.getByName(name);
}

/** upsert 门定义：同名覆盖（绑定语义 —— 定义更新，所有同名实例一同生效） */
export function upsertGateDef(name: string, circuitJson: string): SandboxFile {
  return sandboxStore.saveGate(name, circuitJson);
}

/**
 * 重命名门定义并**全库重绑定**：扫描所有画布文件（含内嵌子图）与所有门定义
 * （devices 的 celltype、subcircuits 键名），把旧名引用改写为新名。
 * 这是编译模式「模块名即绑定键」语义下重命名的配套动作。
 * 返回被改写的文件数。
 */
export function renameGateDef(id: string, newName: string): number {
  const gate = customGateStore.get(id);
  if (!gate || !newName.trim() || newName === gate.name) return 0;
  const oldName = gate.name;
  const files = sandboxStore.list();
  let changed = 0;
  const rebindCells = (cells: any[]) => {
    let hit = false;
    const walk = (j: any, depth = 0) => {
      if (!j || depth > 16) return;
      for (const c of j?.cells || []) {
        if (c?.type !== 'Subcircuit') continue;
        if (String(c.celltype || '') === oldName) { c.celltype = newName; hit = true; }
        if (c.subcircuitGraph) walk(c.subcircuitGraph, depth + 1);
      }
    };
    walk({ cells });
    return hit;
  };
  const rebindCircuit = (mod: any, seen = new Set<object>()) => {
    let hit = false;
    if (!mod || seen.has(mod)) return hit;
    seen.add(mod);
    for (const dev of Object.values<any>(mod.devices || {})) {
      if (dev?.type === 'Subcircuit' && String(dev.celltype || '') === oldName) {
        dev.celltype = newName; hit = true;
      }
    }
    const subs = mod.subcircuits || {};
    if (oldName in subs) { subs[newName] = subs[oldName]; delete subs[oldName]; hit = true; }
    for (const sub of Object.values<any>(subs)) {
      if (rebindCircuit(sub, seen)) hit = true;
    }
    return hit;
  };
  // 1) 画布文件里的实例引用
  for (const f of files) {
    if (f.kind === 'gate' || !f.graphJson) continue;
    try {
      const obj = JSON.parse(f.graphJson);
      if (Array.isArray(obj?.cells) && rebindCells(obj.cells)) {
        sandboxStore.save(f.id, JSON.stringify(obj));
        changed++;
      }
    } catch { /* 坏档跳过 */ }
  }
  // 2) 其他门定义里的引用（嵌套绑定）
  for (const g of customGateStore.list()) {
    if (g.name === oldName) continue;
    try {
      const mod = JSON.parse(g.circuitJson);
      if (rebindCircuit(mod)) {
        upsertGateDef(g.name, JSON.stringify(mod));
        changed++;
      }
    } catch { /* ignore */ }
  }
  // 3) 门定义文件本身改名
  sandboxStore.renameGateFile(id, newName);
  return changed;
}

// ============ 绑定解析（同 App.resolveDependencies 语义）============

/**
 * 重绑定**画布上的活实例**（含内嵌子图里的嵌套实例）。
 * 为什么必须做：改名只重写了存储 —— 打开中的画布仍持有旧 celltype 的活 cell，
 * 任何一次画布持久化（面板切换 / effect 重建的 cleanup）都会用旧名把存储盖回去。
 * 注意：digitaljs 对 Subcircuit 的 celltype 变更有回滚监听（Beta property
 * change support 警告），必须带 {init:true} 选项绕过 —— 这是 digitaljs
 * 预留的初始化通道，普通 set 会被静默还原。
 * 返回改写的实例数。
 */
export function rebindLiveGraph(graph: any, oldName: string, newName: string, depth = 0): number {
  if (!graph || typeof graph.getCells !== 'function' || depth > 16) return 0;
  let n = 0;
  for (const c of graph.getCells()) {
    if (c.get?.('type') !== 'Subcircuit') continue;
    if (String(c.get('celltype') || '') === oldName) {
      try {
        c.set('celltype', newName, { init: true });
        // attrs.type.text 是符号上方的显示标签，同步改掉
        try { c.attr('type/text', newName); } catch { /* ignore */ }
        n++;
      } catch { /* ignore */ }
    }
    const inner = c.get('graph');
    if (inner) n += rebindLiveGraph(inner, oldName, newName, depth + 1);
  }
  return n;
}

/**
 * 解析门定义 → 自足的 circuit JSON：定义里 Subcircuit 器件引用的嵌套门名
 * 若不在自身 subcircuits 里，从门定义库递归拉取合并（依赖闭包）。
 * 编译产物派生的定义本就自足，此处是无防御性的幂等补全；
 * 手绘门嵌套手绘门的场景靠它把整条依赖链拼齐。
 */
export function resolveDefCircuit(name: string, seen = new Set<string>()): any | null {
  if (seen.has(name)) return null;
  seen.add(name);
  const def = getGateDefByName(name);
  if (!def) return null;
  let mod: any;
  try { mod = JSON.parse(def.circuitJson); } catch { return null; }
  if (!mod?.devices) return null;
  mod.subcircuits = mod.subcircuits || {};
  const mergeInto = (m: any) => {
    for (const dev of Object.values<any>(m.devices || {})) {
      if (dev?.type !== 'Subcircuit') continue;
      const ref = String(dev.celltype || '');
      if (ref && !m.subcircuits[ref]) {
        const sub = resolveDefCircuit(ref, seen);
        if (sub) m.subcircuits[ref] = sub;
      }
    }
    for (const sub of Object.values<any>(m.subcircuits)) mergeInto(sub);
  };
  mergeInto(mod);
  return mod;
}

// ============ 递归复制迁移（编译结果 → 门定义文件）============

/**
 * 把编译结果 circuitJson 里的全部子级模块**递归复制**为门定义文件。
 * 内容逐字复制（编译格式，零转换）—— 与编译模式子模块体完全一致，
 * 展开图渲染走同一条 buildViewJson 管线。
 * 返回入库的定义数（同名定义覆盖为编译产物内容）。
 */
export function collectFromCircuit(circuitJson: any): number {
  let n = 0;
  const harvest = (mod: any, seen = new Set<object>()) => {
    if (!mod || seen.has(mod)) return;
    seen.add(mod);
    for (const [name, sub] of Object.entries<any>(mod.subcircuits || {})) {
      if (!sub?.devices) continue;
      upsertGateDef(name, JSON.stringify({
        devices: sub.devices,
        connectors: sub.connectors ?? [],
        subcircuits: sub.subcircuits ?? {},
      }));
      n++;
      harvest(sub, seen);
    }
  };
  harvest(circuitJson);
  return n;
}

/**
 * 「保存为自定义门」：cells 快照 → 编译格式定义入库，嵌套子级定义
 * **递归入库并按名绑定**。返回入库的嵌套子级定义数。
 */
export function saveGateFromCells(name: string, cellsJson: any): { nested: number } {
  const circuit = cellsToCircuitJson(cellsJson);
  upsertGateDef(name, JSON.stringify(circuit));
  let nested = 0;
  const harvest = (mod: any, seen = new Set<object>()) => {
    if (!mod || seen.has(mod)) return;
    seen.add(mod);
    for (const [sub, body] of Object.entries<any>(mod.subcircuits || {})) {
      if (!body?.devices) continue;
      // 匿名嵌套（无 celltype 合成名 __subN）保持内联 —— 没有绑定键
      if (!sub.startsWith('__sub')) {
        upsertGateDef(sub, JSON.stringify(body));
        nested++;
      }
      harvest(body, seen);
    }
  };
  harvest(circuit);
  return { nested };
}

// ============ 内嵌快照剥离（持久化层）============

/**
 * 剥离已绑定实例的内嵌 subcircuitGraph（持久化瘦身 + 单一真源）。
 * 只处理顶层 cells —— 内嵌子图整体属于未绑定实例时原样保留（旧档兼容）。
 * 输入/输出均为 JSON 文本；解析失败原样返回。
 */
export function stripBoundInlineJson(graphJsonText: string): string {
  try {
    const obj = JSON.parse(graphJsonText);
    if (!Array.isArray(obj?.cells)) return graphJsonText;
    let touched = false;
    for (const c of obj.cells) {
      if (c?.type !== 'Subcircuit') continue;
      const name = String(c.celltype || '');
      if (name && customGateStore.getByName(name) && c.subcircuitGraph) {
        delete c.subcircuitGraph;
        touched = true;
      }
    }
    return touched ? JSON.stringify(obj) : graphJsonText;
  } catch { return graphJsonText; }
}

// ============ 迁移（旧数据 → 门定义文件系统）============

/** 把一段 cells 快照里引用的门定义递归抽取入库（仅补缺失的定义，不覆盖） */
export function ensureDefsFromCells(cells: any[]): void {
  if (!Array.isArray(cells)) return;
  const walk = (j: any, depth = 0) => {
    if (!j || depth > 16) return;
    for (const c of j?.cells || []) {
      if (c?.type !== 'Subcircuit') continue;
      const name = String(c.celltype || '');
      if (c.subcircuitGraph?.cells?.length) {
        if (name && !getGateDefByName(name)) {
          try { saveGateFromCells(name, c.subcircuitGraph); } catch { /* ignore */ }
        }
        walk(c.subcircuitGraph, depth + 1);
      } else if (name && !getGateDefByName(name)) {
        // 只有名字没有内嵌图（新格式存档）—— 定义缺失时无从恢复，跳过
      }
    }
  };
  walk({ cells });
}

/**
 * 一次性迁移：
 *  1) 旧 GATES_KEY 存档（内嵌 cells 格式）→ 门定义文件；
 *  2) 存量画布文件里的内嵌 subcircuitGraph → 抽取门定义 + 剥离内嵌。
 * 幂等（迁移标记位）；返回迁移的画布文件数。
 */
export function migrateLegacy(): number {
  const MIGRATED_GATES = 'verilog-viz-gates-migrated';
  const MIGRATED_INLINE = 'verilog-viz-inline-migrated';
  let filesMigrated = 0;
  // 1) 旧门存档
  if (!localStorage.getItem(MIGRATED_GATES)) {
    try {
      const arr = JSON.parse(localStorage.getItem('verilog-viz-sandbox-gates') || '[]');
      for (const g of Array.isArray(arr) ? arr : []) {
        if (!g?.name || !g?.graphJson || getGateDefByName(String(g.name))) continue;
        try { saveGateFromCells(String(g.name), JSON.parse(String(g.graphJson))); } catch { /* 坏档跳过 */ }
      }
    } catch { /* ignore */ }
    localStorage.setItem(MIGRATED_GATES, '1');
  }
  // 2) 存量文件内嵌快照 → 定义入库 + 剥离
  if (!localStorage.getItem(MIGRATED_INLINE)) {
    for (const f of sandboxStore.list()) {
      if (f.kind === 'gate' || !f.graphJson) continue;
      try {
        const obj = JSON.parse(f.graphJson);
        if (!Array.isArray(obj?.cells)) continue;
        // 先补定义（缺失才补，不覆盖已有定义）
        const walk = (j: any, depth = 0) => {
          if (!j || depth > 16) return;
          for (const c of j?.cells || []) {
            if (c?.type !== 'Subcircuit') continue;
            const name = String(c.celltype || '');
            if (c.subcircuitGraph?.cells?.length) {
              if (name && !getGateDefByName(name)) {
                try { saveGateFromCells(name, c.subcircuitGraph); } catch { /* ignore */ }
              }
              walk(c.subcircuitGraph, depth + 1);
            }
          }
        };
        walk(obj);
        // 再剥离已绑定的顶层内嵌
        let touched = false;
        for (const c of obj.cells) {
          if (c?.type !== 'Subcircuit') continue;
          const name = String(c.celltype || '');
          if (name && getGateDefByName(name) && c.subcircuitGraph) {
            delete c.subcircuitGraph;
            touched = true;
          }
        }
        if (touched) { sandboxStore.save(f.id, JSON.stringify(obj)); filesMigrated++; }
      } catch { /* ignore */ }
    }
    localStorage.setItem(MIGRATED_INLINE, '1');
  }
  return filesMigrated;
}

/** 门定义文件显示名（剥 .gate 后缀） */
export function gateDisplay(file: SandboxFile): string {
  return baseName(file.name).replace(/\.gate$/i, '');
}
