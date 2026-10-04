// 部件（自定义门 / 编译子模块）绑定系统 —— 编译模式文件系统语义在沙盒的落地。
//
// 编译模式的架构（fileStore.ts / App.resolveDependencies / buildViewJson）：
//   - 每个模块是一个文件（definedModules），实例按「模块名」绑定定义文件；
//   - 编译产物 circuitJson.subcircuits[名] 自带全部子级模块体（层级化）；
//   - 钻取 = 提升子模块体 → 编译渲染管线，从不反向转换。
//
// R37 曾把门定义做成只读 kind:'gate'（编译格式 circuitJson）文件，展开图直渲
// 零反向转换。但用户要求（2026-10-04）：**复制到沙盒的所有电路（含递归复制的
// 子部件）都要可编辑**，而不是点开只有只读渲染的展开图；且要用**文件夹**收纳
// 一个电路的全部子部件，防止文件树被摊平搞乱。
//
// R39 终态模型 —— 「一切皆可编辑 .djs 文件 + 文件夹作用域绑定」：
//   - 部件真身 = 沙盒文件系统里 role:'part' 的 .djs 画布文件（cells 格式），
//     既是独立可编辑画布（可摆器件/连线/仿真/再保存为门），又能被实例绑定；
//   - 绑定：画布 Subcircuit 实例按 celltype 名 = 「文件名去扩展名」绑定定义，
//     **同文件夹优先 → 根目录 → 全库**（对齐编译模式模块作用域，且支持
//     「复制到沙盒」按文件夹隔离同名子部件）；
//   - 递归复制迁移：「复制到沙盒」把编译结果的子级部件**递归复制**成同文件夹
//     下的可编辑 .djs 部件文件并按名绑定（collectToFolder）；
//   - 解析（resolveDefCells）返回**自足 cells 树**：绑定式嵌套实例在解析时
//     递归物化出各层 subcircuitGraph，下游 buildInnerGraph（放置/装载）、
//     cellsToCircuitJson→renderCircuitView（展开图）共用这一份表示；
//   - 兼容：旧 kind:'gate'（编译格式 circuitJson）与旧档内嵌 subcircuitGraph
//     仍可读，并由 migrateLegacy 一次性迁移。
//
// 单一真源：部件文件里的实例只存 celltype（不内联子图），编辑部件文件即改
// 定义，所有绑定实例随之生效（编译模式 moduleBindings 语义）。

import { sandboxStore, baseName, type SandboxFile } from '../store/sandboxStore';
import { cellsToCircuitJson, circuitJsonToCells } from './subcircuitView';

/** 绑定名 → 定义文件。scope = 实例所在画布文件的文件夹（优先作用域）。 */
export interface PartRef { file: SandboxFile; legacy: boolean; }

const dirOf = (f: SandboxFile) => (f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/')) : '');

/**
 * 按绑定名 + 作用域查找部件定义文件。
 * 顺序（打分升序）：scope 内 role:'part' → scope 内任意 .djs → 根 role:'part'
 * → scope 内 .gate → 根 .djs → 根 .gate → 全库兜底。
 */
export function resolvePartRef(name: string, scope = ''): PartRef | null {
  if (!name) return null;
  const files = sandboxStore.list();
  const byBase = (f: SandboxFile) => baseName(f.name).replace(/\.(djs|gate|json)$/i, '') === name;
  const score = (f: SandboxFile): number => {
    const dir = dirOf(f);
    const inScope = !!scope && dir === scope;
    const atRoot = dir === '';
    if (f.kind === 'gate') return inScope ? 3 : atRoot ? 5 : 8;
    if (f.role === 'part') return inScope ? 0 : atRoot ? 2 : 6;
    return inScope ? 1 : atRoot ? 4 : 9; // 任意 .djs 兜底
  };
  const cands = files.filter(byBase).sort((a, b) => score(a) - score(b));
  if (!cands.length) return null;
  const f = cands[0];
  return { file: f, legacy: f.kind === 'gate' };
}

/** 定义文件里，一个绑定名对应的 cells（未物化嵌套）。 */
function partCellsRaw(name: string, scope: string): { cells: any[] } | null {
  const ref = resolvePartRef(name, scope);
  if (!ref) return null;
  if (ref.legacy && ref.file.circuitJson) {
    // 旧 kind:'gate'：编译格式 → cells（可编辑表示）
    try { return circuitJsonToCells(JSON.parse(ref.file.circuitJson)); } catch { return null; }
  }
  try {
    const g = JSON.parse(ref.file.graphJson || '{}');
    return Array.isArray(g?.cells) ? { cells: g.cells } : null;
  } catch { return null; }
}

/** 部件定义是否存在（用于「剥离内嵌快照」判定） */
export function partExists(name: string, scope = ''): boolean {
  return !!resolvePartRef(name, scope);
}

/**
 * 解析绑定名 → **自足 cells 树**（下游 buildInnerGraph / cellsToCircuitJson
 * 均可直接消费）。绑定式嵌套实例在解析时递归物化各层 subcircuitGraph：
 * 遇到 celltype 命中定义、但无内嵌子图的 Subcircuit，就地展开该部件的 cells。
 *
 * 这是「可编辑部件」模型能复用展开渲染管线的前提：cellsToCircuitJson 依赖
 * subcircuitGraph 生成层级 subcircuits，而绑定式存档刻意不内联子图。
 */
export function resolveDefCells(name: string, scope = '', seen = new Set<string>()): { cells: any[] } | null {
  if (seen.has(name)) return null;
  seen.add(name);
  const raw = partCellsRaw(name, scope);
  if (!raw || !raw.cells.length) return null;
  const out: any[] = [];
  for (const c of raw.cells) {
    if (c?.type === 'Subcircuit' && !c.subcircuitGraph?.cells?.length && c.celltype) {
      const nested = resolveDefCells(String(c.celltype), scope, seen);
      if (nested?.cells?.length) out.push({ ...c, subcircuitGraph: { cells: nested.cells } });
      else out.push(c);
    } else out.push(c);
  }
  return { cells: out };
}

/**
 * 解析绑定名 → 编译格式电路 JSON（展开图 renderCircuitView 用）。
 * 内部：自足 cells → cellsToCircuitJson（层级 subcircuits 由已物化的
 * subcircuitGraph 生成）。旧 .gate 有原生 circuitJson 时直接用（零转换）。
 */
export function resolveDefCircuit(name: string, scope = ''): any | null {
  const ref = resolvePartRef(name, scope);
  if (!ref) return null;
  if (ref.legacy && ref.file.circuitJson) {
    try {
      const mod = JSON.parse(ref.file.circuitJson);
      if (mod?.devices) return mod;
    } catch { /* fall through */ }
  }
  const cells = resolveDefCells(name, scope);
  if (!cells?.cells?.length) return null;
  const circuit = cellsToCircuitJson(cells);
  if (!Object.keys(circuit.devices || {}).length) return null;
  return circuit;
}

// ============ 部件文件写入（可编辑 .djs）============

/** 唯一 .djs 文件名（store 层去重） */
function uniqueDjsName(files: SandboxFile[], name: string): string {
  if (!files.some((f) => f.name === name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 1;
  while (files.some((f) => f.name === `${stem}_${n}${ext}`)) n++;
  return `${stem}_${n}${ext}`;
}

/**
 * 在 folder 下写入/覆盖一个可编辑部件文件（role:'part'，cells 画布格式）。
 * 绑定名 = 文件名去扩展名。返回落盘文件。
 */
export function savePartFile(name: string, cellsJson: any, folder = ''): SandboxFile {
  const files = sandboxStore.list();
  const fname = (folder ? folder + '/' : '') + name + '.djs';
  const target = uniqueDjsName(files, fname);
  const cellsText = typeof cellsJson === 'string' ? cellsJson : JSON.stringify(cellsJson);
  const existing = files.find((f) => f.name === target);
  if (existing) {
    sandboxStore.save(existing.id, cellsText);
    sandboxStore.setRole(existing.id, 'part');
    return sandboxStore.get(existing.id)!;
  }
  const created = sandboxStore.create(target, 'part');
  sandboxStore.save(created.id, cellsText);
  return sandboxStore.get(created.id)!;
}

// ============ 重命名（改名 = 重绑定）============

/**
 * 重绑定**画布上的活实例**（含内嵌子图里的嵌套实例）。改名只重写了存储，
 * 打开中的画布仍持有旧 celltype 的活 cell，任何一次画布持久化都会用旧名
 * 把存储盖回去，所以改名时必须同步活图。
 * 注意：digitaljs 对 Subcircuit 的 celltype 变更有回滚监听，必须带
 * {init:true} 选项绕过（digitaljs 预留的初始化通道）。
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
 * 部件文件改名 = 全库重绑定：扫描所有画布文件与部件文件里的 celltype
 * 引用（以及符号标签 attrs.type.text），把旧名改写为新名，再改文件名。
 * 这是「实例按模块名绑定定义」语义下重命名的配套动作。
 * 返回被改写的存储引用数。
 */
export function renamePartDef(id: string, newName: string): number {
  const target = sandboxStore.get(id);
  if (!target) return 0;
  newName = newName.trim().replace(/\.(djs|gate|json)$/i, '');
  if (!newName) return 0;
  const oldName = baseName(target.name).replace(/\.(djs|gate|json)$/i, '');
  if (!oldName || newName === oldName) return 0;
  let changed = 0;
  const rebindCells = (cells: any[]) => {
    let hit = false;
    const walk = (j: any, depth = 0) => {
      if (!j || depth > 16) return;
      for (const c of j?.cells || []) {
        if (c?.type !== 'Subcircuit') continue;
        if (String(c.celltype || '') === oldName) { c.celltype = newName; hit = true; }
        try {
          const t = c?.attrs?.type?.text;
          if (String(t || '') === oldName) { c.attrs.type.text = newName; hit = true; }
        } catch { /* ignore */ }
        if (c.subcircuitGraph) walk(c.subcircuitGraph, depth + 1);
      }
    };
    walk({ cells });
    return hit;
  };
  for (const f of sandboxStore.list()) {
    if (f.id === id || !f.graphJson) continue;
    try {
      const obj = JSON.parse(f.graphJson);
      if (Array.isArray(obj?.cells) && rebindCells(obj.cells)) {
        sandboxStore.save(f.id, JSON.stringify(obj));
        changed++;
      }
    } catch { /* 坏档跳过 */ }
  }
  // 部件文件改名（保持 role，扩展名 .djs）
  const dir = dirOf(target);
  const fname = (dir ? dir + '/' : '') + newName + '.djs';
  const files = sandboxStore.list();
  if (!files.some((o) => o.id !== id && o.name === fname)) {
    sandboxStore.rename(id, fname);
  }
  return changed;
}

// ============ 递归复制迁移（编译结果 → 文件夹内可编辑部件）============

/**
 * 把编译结果 circuitJson 里的全部子级模块**递归复制**为 folder 下的可编辑
 * .djs 部件文件（cells 格式，子级嵌套仍按 celltype 绑定到各自文件）。
 * 逐字保留编译产物的位置（elk 布局），打开即可编辑。
 * 返回入库的部件数。
 */
export function collectToFolder(circuitJson: any, folder: string): number {
  let n = 0;
  const harvest = (mod: any, seen = new Set<object>()) => {
    if (!mod || seen.has(mod)) return;
    seen.add(mod);
    for (const [name, sub] of Object.entries<any>(mod.subcircuits || {})) {
      if (!sub?.devices) continue;
      savePartFile(name, circuitJsonToCells(sub), folder);
      n++;
      harvest(sub, seen);
    }
  };
  harvest(circuitJson);
  return n;
}

// ============ 「保存为自定义门」（画布 → 可编辑部件文件）============

/**
 * 当前画布存为可编辑部件文件；画布上已放置的绑定式子部件递归入库为同文件夹
 * 部件文件并按名绑定。返回入库的嵌套子部件数。
 */
export function saveGateFromCellsToFolder(name: string, cellsJson: any, folder = ''): { nested: number } {
  savePartFile(name, cellsJson, folder); // 存画布原样（cells），可编辑
  let nested = 0;
  const walk = (cells: any[], depth = 0) => {
    if (!cells || depth > 16) return;
    for (const c of cells) {
      if (c?.type !== 'Subcircuit' || !c.celltype) continue;
      const sub = String(c.celltype);
      if (sub.startsWith('__sub')) continue; // 匿名内联，跳过
      if (!resolvePartRef(sub, folder)) {
        savePartFile(sub, c.subcircuitGraph || { cells: [] }, folder);
        nested++;
      }
      if (c.subcircuitGraph?.cells) walk(c.subcircuitGraph.cells, depth + 1);
    }
  };
  walk(cellsJson?.cells || []);
  return { nested };
}

// ============ 内嵌快照剥离（持久化层）============

/**
 * 剥离已绑定实例的内嵌 subcircuitGraph（持久化瘦身 + 单一真源）。
 * 只处理顶层 cells；解析失败原样返回。
 */
export function stripBoundInlineJson(graphJsonText: string, scope = ''): string {
  try {
    const obj = JSON.parse(graphJsonText);
    if (!Array.isArray(obj?.cells)) return graphJsonText;
    let touched = false;
    for (const c of obj.cells) {
      if (c?.type !== 'Subcircuit') continue;
      const name = String(c.celltype || '');
      if (name && partExists(name, scope) && c.subcircuitGraph) {
        delete c.subcircuitGraph;
        touched = true;
      }
    }
    return touched ? JSON.stringify(obj) : graphJsonText;
  } catch { return graphJsonText; }
}

// ============ 迁移（旧数据 → 可编辑部件文件）============

/** 把一段 cells 快照里引用的门递归抽取为部件文件（仅补缺失，幂等） */
export function ensureDefsFromCells(cells: any[], scope = ''): void {
  if (!Array.isArray(cells)) return;
  const walk = (j: any, depth = 0) => {
    if (!j || depth > 16) return;
    for (const c of j?.cells || []) {
      if (c?.type !== 'Subcircuit') continue;
      const name = String(c.celltype || '');
      if (c.subcircuitGraph?.cells?.length) {
        if (name && !resolvePartRef(name, scope)) {
          try { savePartFile(name, c.subcircuitGraph, scope); } catch { /* ignore */ }
        }
        walk(c.subcircuitGraph, depth + 1);
      }
    }
  };
  walk({ cells });
}

/**
 * 一次性迁移（幂等）：
 *  1) 旧 GATES_KEY 存档 → 可编辑部件文件；
 *  2) 存量文件内嵌 subcircuitGraph → 抽取部件 + 剥离内嵌；
 *  3) 旧 kind:'gate' 文件 → 转成可编辑 role:'part' .djs（circuitJson→cells）。
 * 返回迁移计数（文件数）。
 */
export function migrateLegacy(): number {
  const MIGRATED_GATES = 'verilog-viz-gates-migrated';
  const MIGRATED_INLINE = 'verilog-viz-inline-migrated';
  const MIGRATED_GATEFILES = 'verilog-viz-gatefiles-migrated';
  let n = 0;
  // 1) 旧门存档（localStorage 数组，内嵌 cells）
  if (!localStorage.getItem(MIGRATED_GATES)) {
    try {
      const arr = JSON.parse(localStorage.getItem('verilog-viz-sandbox-gates') || '[]');
      for (const g of Array.isArray(arr) ? arr : []) {
        if (!g?.name || !g?.graphJson) continue;
        const name = String(g.name);
        if (resolvePartRef(name)) continue;
        try { savePartFile(name, JSON.parse(String(g.graphJson))); } catch { /* 坏档跳过 */ }
      }
    } catch { /* ignore */ }
    localStorage.setItem(MIGRATED_GATES, '1');
  }
  // 2) 存量画布文件内嵌快照 → 部件文件 + 剥离
  if (!localStorage.getItem(MIGRATED_INLINE)) {
    for (const f of sandboxStore.list()) {
      if (f.kind === 'gate' || !f.graphJson) continue;
      const dir = dirOf(f);
      try {
        const obj = JSON.parse(f.graphJson);
        if (!Array.isArray(obj?.cells)) continue;
        ensureDefsFromCells(obj.cells, dir);
        const stripped = stripBoundInlineJson(f.graphJson, dir);
        if (stripped !== f.graphJson) { sandboxStore.save(f.id, stripped); n++; }
      } catch { /* ignore */ }
    }
    localStorage.setItem(MIGRATED_INLINE, '1');
  }
  // 3) 旧 kind:'gate'（编译格式）→ 可编辑 role:'part' .djs
  if (!localStorage.getItem(MIGRATED_GATEFILES)) {
    for (const f of sandboxStore.list()) {
      if (f.kind !== 'gate' || !f.circuitJson) continue;
      try {
        const dir = dirOf(f);
        const name = baseName(f.name).replace(/\.gate$/i, '');
        const cells = circuitJsonToCells(JSON.parse(f.circuitJson));
        if (cells.cells.length) {
          savePartFile(name, cells, dir);
          sandboxStore.remove(f.id); // 删旧 .gate
          n++;
        }
      } catch { /* ignore */ }
    }
    localStorage.setItem(MIGRATED_GATEFILES, '1');
  }
  return n;
}
