// Sandbox file system — independent from .v verilog files.
// Each .djs file stores a digitaljs circuit graph as JSON.

export interface SandboxFile {
  id: string;
  name: string;
  graphJson: string;  // serialized joint graph（普通画布文件用）
  updatedAt: number;
  /**
   * R37 门定义文件系统（迁移编译模式文件系统语义）：
   *  - kind 缺省 = 'circuit'（普通 .djs 画布文件）；
   *  - kind='gate' = 门定义文件（文件树显示为 <名>.gate），circuitJson 存
   *    编译格式电路 JSON {devices, connectors, subcircuits}，子级部件以
   *    celltype 名称绑定（与编译模式 subcircuits[name] 同构）。
   */
  kind?: 'gate';
  circuitJson?: string;
}

// A user-defined gate: 门定义（R37 起为编译格式 circuit JSON，不再是内嵌
// joint cells）。customGateStore 是「门定义文件」的薄门面 —— 真身住在
// 沙盒文件系统里（kind:'gate' 文件），与编译模式「每个模块一个文件」对齐。
export interface CustomGate {
  id: string;
  name: string;
  circuitJson: string;  // 编译格式 circuit JSON
}

const SANDBOX_KEY = 'verilog-viz-sandbox-files';
const SANDBOX_ACTIVE = 'verilog-viz-sandbox-active';
const SANDBOX_FOLDERS = 'verilog-viz-sandbox-folders';
const GATES_KEY = 'verilog-viz-sandbox-gates'; // 旧版门存档（迁移源，R37 起只读）
export const GATES_LEGACY_KEY = GATES_KEY;

function loadAll(): Record<string, SandboxFile> {
  try {
    const raw = localStorage.getItem(SANDBOX_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveAll(files: Record<string, SandboxFile>) {
  localStorage.setItem(SANDBOX_KEY, JSON.stringify(files));
}

function loadFolders(): string[] {
  try {
    const raw = localStorage.getItem(SANDBOX_FOLDERS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveFolders(folders: string[]) {
  localStorage.setItem(SANDBOX_FOLDERS, JSON.stringify(folders));
}

/** 取路径的最后一段（文件或文件夹的显示名） */
export function baseName(path: string): string {
  return path.split('/').pop() || path;
}

export const sandboxStore = {
  list(): SandboxFile[] {
    const files = loadAll();
    return Object.values(files).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  get(id: string): SandboxFile | null {
    return loadAll()[id] ?? null;
  },

  getActiveId(): string | null {
    return localStorage.getItem(SANDBOX_ACTIVE);
  },

  setActiveId(id: string | null) {
    if (id) localStorage.setItem(SANDBOX_ACTIVE, id);
    else localStorage.removeItem(SANDBOX_ACTIVE);
  },

  create(name: string): SandboxFile {
    const files = loadAll();
    const id = 'sb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const file: SandboxFile = {
      id,
      name: name.endsWith('.djs') ? name : name + '.djs',
      graphJson: JSON.stringify({ cells: [] }),
      updatedAt: Date.now(),
    };
    files[id] = file;
    saveAll(files);
    return file;
  },

  save(id: string, graphJson: string) {
    const files = loadAll();
    if (!files[id]) return;
    files[id].graphJson = graphJson;
    files[id].updatedAt = Date.now();
    saveAll(files);
  },

  rename(id: string, name: string) {
    const files = loadAll();
    if (!files[id]) return;
    files[id].name = name.endsWith('.djs') ? name : name + '.djs';
    saveAll(files);
  },

  remove(id: string) {
    const files = loadAll();
    delete files[id];
    saveAll(files);
    if (localStorage.getItem(SANDBOX_ACTIVE) === id) localStorage.removeItem(SANDBOX_ACTIVE);
  },

  // ============ 文件夹体系（与 IDE fileStore 语义对齐）============

  /** 全部文件夹路径：单独跟踪的 + 从文件名路径推断的，去重排序 */
  getFolders(): string[] {
    const files = loadAll();
    const inferred = new Set<string>();
    for (const f of Object.values(files)) {
      const parts = f.name.split('/');
      parts.pop();
      let cur = '';
      for (const seg of parts) {
        cur = cur ? cur + '/' + seg : seg;
        inferred.add(cur);
      }
    }
    return Array.from(new Set([...loadFolders(), ...inferred])).sort();
  },

  createFolder(path: string) {
    path = path.replace(/^\/+|\/+$/g, '');
    if (!path) return;
    const folders = loadFolders();
    if (folders.includes(path)) return;
    folders.push(path);
    saveFolders(folders);
  },

  /** 重命名最后一段；子文件夹与其中文件路径同步更新 */
  renameFolder(oldPath: string, newName: string) {
    newName = newName.trim().replace(/^\/+|\/+$/g, '');
    if (!oldPath || !newName || oldPath === newName) return;
    const parts = oldPath.split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');
    if (loadFolders().includes(newPath)) return; // 目标已存在，拒绝
    const files = loadAll();
    const prefix = oldPath + '/';
    for (const f of Object.values(files)) {
      if (f.name.startsWith(prefix)) f.name = newPath + '/' + f.name.slice(prefix.length);
    }
    saveAll(files);
    const folders = loadFolders().map((p) => {
      if (p === oldPath) return newPath;
      if (p.startsWith(prefix)) return newPath + '/' + p.slice(prefix.length);
      return p;
    });
    saveFolders(folders);
  },

  /** 删除文件夹：取消跟踪（含子文件夹），其下文件移回根目录（重名自动加 _1 后缀） */
  removeFolder(path: string) {
    const prefix = path + '/';
    const files = loadAll();
    const taken = new Set(Object.values(files).map((f) => f.name));
    const rename = (f: SandboxFile, base: string) => {
      if (!taken.has(base)) { f.name = base; taken.add(base); return; }
      const dot = base.lastIndexOf('.');
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : '';
      let n = 1;
      while (taken.has(`${stem}_${n}${ext}`)) n++;
      f.name = `${stem}_${n}${ext}`;
      taken.add(f.name);
    };
    for (const f of Object.values(files)) {
      if (f.name === path) rename(f, baseName(f.name));
      else if (f.name.startsWith(prefix)) rename(f, f.name.slice(prefix.length));
    }
    saveAll(files);
    saveFolders(loadFolders().filter((p) => p !== path && !p.startsWith(prefix)));
  },

  /** 把文件移动到 folder（'' = 根目录），重名自动加 _1 后缀 */
  moveFilesToFolder(ids: string[], folder: string) {
    const files = loadAll();
    for (const id of ids) {
      const f = files[id];
      if (!f) continue;
      const base = baseName(f.name);
      let target = folder ? folder + '/' + base : base;
      // 同名冲突 → _1、_2…
      let n = 1;
      while (Object.values(files).some((o) => o.id !== id && o.name === target)) {
        const dot = base.lastIndexOf('.');
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const ext = dot > 0 ? base.slice(dot) : '';
        target = (folder ? folder + '/' + stem : stem) + `_${n}` + ext;
        n++;
      }
      f.name = target;
    }
    saveAll(files);
  },

  /** 移动整个文件夹（含子文件夹与其下文件） */
  moveFolder(oldPath: string, newPath: string) {
    if (!oldPath || !newPath || oldPath === newPath || newPath.startsWith(oldPath + '/')) return;
    const files = loadAll();
    const prefix = oldPath + '/';
    for (const f of Object.values(files)) {
      if (f.name.startsWith(prefix)) f.name = newPath + '/' + f.name.slice(prefix.length);
    }
    saveAll(files);
    saveFolders(loadFolders().map((p) => (p === oldPath ? newPath : p.startsWith(prefix) ? newPath + '/' + p.slice(prefix.length) : p)));
  },

  /** 把某个文件复制一份到 folder（'' = 根目录），返回新文件 */
  copyFile(id: string, folder = ''): SandboxFile | null {
    const files = loadAll();
    const src = files[id];
    if (!src) return null;
    const base = baseName(src.name).replace(/\.djs$/i, '');
    let name = (folder ? folder + '/' + base : base) + '.djs';
    let n = 1;
    while (Object.values(files).some((o) => o.name === name)) {
      name = (folder ? folder + '/' + base : base) + `_${n}.djs`;
      n++;
    }
    const copy: SandboxFile = {
      id: 'sb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      graphJson: src.graphJson,
      updatedAt: Date.now(),
    };
    files[copy.id] = copy;
    saveAll(files);
    return copy;
  },

  // ============ 门定义文件（R37：编译模式文件系统语义迁移）============

  /** 新建门定义文件（<名>.gate）；同名定义已存在时返回 null（由调用方 upsert） */
  createGate(name: string, circuitJson: string): SandboxFile | null {
    const files = loadAll();
    const fileName = name + '.gate';
    if (Object.values(files).some((f) => f.name === fileName)) return null;
    const file: SandboxFile = {
      id: 'sb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: fileName,
      graphJson: '',
      updatedAt: Date.now(),
      kind: 'gate',
      circuitJson,
    };
    files[file.id] = file;
    saveAll(files);
    return file;
  },

  /** 按「门名」（非文件名）找门定义文件 */
  getGateFile(name: string): SandboxFile | null {
    const fileName = name + '.gate';
    return Object.values(loadAll()).find((f) => f.kind === 'gate' && f.name === fileName) ?? null;
  },

  /** 写入门定义内容（文件已存在则覆盖） */
  saveGate(name: string, circuitJson: string): SandboxFile {
    const existing = this.getGateFile(name);
    if (existing) {
      const files = loadAll();
      files[existing.id].circuitJson = circuitJson;
      files[existing.id].updatedAt = Date.now();
      saveAll(files);
      return files[existing.id];
    }
    const f = this.createGate(name, circuitJson);
    return f!;
  },

  /** 门定义文件改名（保持 kind:'gate' 与 .gate 后缀；目标重名返回 null） */
  renameGateFile(id: string, newName: string): SandboxFile | null {
    newName = newName.trim().replace(/\.gate$/i, '');
    if (!newName) return null;
    const files = loadAll();
    const f = files[id];
    if (!f || f.kind !== 'gate') return null;
    const fileName = newName + '.gate';
    if (f.name === fileName) return f;
    if (Object.values(files).some((o) => o.id !== id && o.name === fileName)) return null;
    f.name = fileName;
    f.updatedAt = Date.now();
    saveAll(files);
    return f;
  },

  /** 同目录创建副本（右键「创建副本」），返回新文件 */
  duplicate(id: string): SandboxFile | null {
    const files = loadAll();
    const src = files[id];
    if (!src) return null;
    const dir = src.name.includes('/') ? src.name.slice(0, src.name.lastIndexOf('/')) : '';
    return this.copyFile(id, dir);
  },
};

/**
 * 自定义门注册表（R37 起为「门定义文件」的薄门面）。
 *
 * 旧版把门定义存成独立 localStorage 数组（GATES_KEY，内嵌 joint cells），
 * 与沙盒文件系统完全脱节。现在门定义 = kind:'gate' 的沙盒文件，与编译模式
 * 「每个模块一个文件、实例按模块名绑定」同构；旧存档由 gateSystem.migrateLegacy
 * 一次性迁移成门定义文件（本门面只读写新格式）。
 */
export const customGateStore = {
  list(): CustomGate[] {
    return Object.values(loadAll())
      .filter((f) => f.kind === 'gate' && f.circuitJson)
      .map((f) => ({ id: f.id, name: baseName(f.name).replace(/\.gate$/i, ''), circuitJson: f.circuitJson! }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  get(id: string): CustomGate | null {
    const f = loadAll()[id];
    if (!f || f.kind !== 'gate' || !f.circuitJson) return null;
    return { id: f.id, name: baseName(f.name).replace(/\.gate$/i, ''), circuitJson: f.circuitJson };
  },

  getByName(name: string): CustomGate | null {
    const f = sandboxStore.getGateFile(name);
    if (!f || !f.circuitJson) return null;
    return { id: f.id, name, circuitJson: f.circuitJson };
  },

  /** 保存/覆盖同名门定义（绑定语义：定义内容变了，所有同名实例一同更新） */
  save(name: string, circuitJson: string): CustomGate {
    const f = sandboxStore.saveGate(name, circuitJson);
    return { id: f.id, name, circuitJson: f.circuitJson! };
  },

  remove(id: string) {
    const files = loadAll();
    const f = files[id];
    if (f && f.kind === 'gate') delete files[id];
    saveAll(files);
  },
};
