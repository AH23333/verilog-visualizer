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
   *  - kind='gate' = 旧版门定义文件（编译格式 circuitJson，只读），R39 起
   *    迁移为可编辑的 role='part' .djs，此字段仅作兼容读取。
   */
  kind?: 'gate';
  circuitJson?: string;
  /**
   * R39 部件语义（对齐编译模式「每个模块一个文件、实例按模块名绑定」）：
   *  - 缺省/'circuit' = 普通可编辑电路文件；
   *  - 'part' = **可编辑部件文件**（.djs，画布格式）—— 复制到沙盒的子部件、
   *    「保存为自定义门」产出的自定义部件都落成这种：既是独立可编辑画布，
   *    又可被同文件夹（优先）/全局的实例按「文件名（去扩展名）」绑定引用。
   */
  role?: 'circuit' | 'part';
}

// 一个「部件」（自定义门 / 编译子模块）。R39 起部件真身是可编辑的 role='part'
// .djs 画布文件；folder 记录它所在的沙盒文件夹（绑定解析的优先作用域）。
export interface CustomGate {
  id: string;
  name: string;   // 绑定名（= 文件名去扩展名）
  folder: string; // 所在文件夹路径（'' = 根目录）
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

  create(name: string, role?: 'circuit' | 'part'): SandboxFile {
    const files = loadAll();
    const id = 'sb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const file: SandboxFile = {
      id,
      name: name.endsWith('.djs') ? name : name + '.djs',
      graphJson: JSON.stringify({ cells: [] }),
      updatedAt: Date.now(),
      ...(role ? { role } : {}),
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

  /** 标记/取消部件角色（role:'part'）—— store 无通用 patch，读写全表 */
  setRole(id: string, role?: 'circuit' | 'part') {
    const files = loadAll();
    if (!files[id]) return;
    if (role) files[id].role = role; else delete files[id].role;
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

  // ============ 部件文件（R39：可编辑 .djs 部件）============
  // 部件 = role:'part' 的 .djs 画布文件。绑定名 = 文件名去扩展名。
  // 旧 kind:'gate'（编译格式 circuitJson）仅作读取兼容，迁移见 gateSystem.migrateLegacy。

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
 * 部件（自定义门 / 编译子模块）注册表 —— role:'part' 的 .djs 文件 + 旧 .gate。
 * 真身住在沙盒文件系统；绑定解析与递归物化在 lib/gateSystem.ts。
 */
export const customGateStore = {
  list(): CustomGate[] {
    const out: CustomGate[] = [];
    const seen = new Set<string>();
    for (const f of sandboxStore.list()) {
      const isPart = f.role === 'part';
      const isGate = f.kind === 'gate';
      if (!isPart && !isGate) continue;
      const name = baseName(f.name).replace(/\.(djs|gate|json)$/i, '');
      const dir = f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/')) : '';
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ id: f.id, name, folder: dir });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },

  get(id: string): CustomGate | null {
    const f = loadAll()[id];
    if (!f) return null;
    if (f.role !== 'part' && f.kind !== 'gate') return null;
    return {
      id: f.id,
      name: baseName(f.name).replace(/\.(djs|gate|json)$/i, ''),
      folder: f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/')) : '',
    };
  },

  remove(id: string) {
    sandboxStore.remove(id);
  },
};
