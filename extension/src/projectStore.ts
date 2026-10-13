/**
 * 项目目录的后端（Extension Host 侧），与 `src-tauri/src/lib.rs` 的 14 颗命令**逐条对齐**。
 *
 * 为什么写成"只依赖一个注入的 fs 接口"：这样路径规则与目录树扫描这两件最容易出事的事
 * 能在无头单测里判（`tests/unit/projectStore.test.ts` 拿一份内存假 fs），
 * ⛔ 只在真实 VS Code 里手点一遍——那等于把安全边界交给手感。
 *
 * 三条与 Rust 版一致的形状（改了任何一条，两个宿主的文件行为就会分岔）：
 *  1. `sanitizeRel` 拒绝对对路径与 `..` 段（防穿越）；
 *  2. 目录树只上报 `.v/.sv/.vh`，名字是**相对项目根、用 '/' 分隔**（沙盒 `.djs` 走 localStorage，不在这条链上）；
 *  3. 配置文件缺失＝抛错（前端 `projectConfigStore` 靠这颗抛错走默认值分支），⛔ 返回空串。
 */

export interface FsLike {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** 目录不存在则逐级创建 */
  createDir(path: string): Promise<void>;
  /** recursive=true 时连子树一起删 */
  remove(path: string, recursive: boolean): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  stat(path: string): Promise<{ type: 'file' | 'dir'; size: number; mtimeMs: number } | null>;
  readDir(path: string): Promise<Array<{ name: string; type: 'file' | 'dir' }>>;
}

const VERILOG_EXT = ['v', 'sv', 'vh'];
export const CONFIG_FILE = 'verilog-viz.config.json';

/** 相对路径 → 分隔符归一；绝对路径或含 `..` 一律拒（对齐 Rust `sanitize_path`） */
export function sanitizeRel(name: string): string {
  const rel = String(name || '').replace(/\\/g, '/');
  if (!rel) throw new Error('路径为空');
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) throw new Error('Absolute paths are not allowed');
  if (rel.split('/').some((seg) => seg === '..')) throw new Error('Parent directory traversal is not allowed');
  return rel;
}

const join = (root: string, rel: string) => `${root.replace(/\/+$/, '')}/${rel}`;
const parentOf = (rel: string) => {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
};
const baseName = (rel: string) => {
  const i = rel.lastIndexOf('/');
  return i < 0 ? rel : rel.slice(i + 1);
};
const extOf = (rel: string) => {
  const b = baseName(rel);
  const i = b.lastIndexOf('.');
  return i < 0 ? '' : b.slice(i + 1).toLowerCase();
};

export class ProjectStore {
  constructor(private fs: FsLike, private root: string) { }

  private abs(rel: string) { return join(this.root, rel); }

  private async ensureParent(rel: string) {
    const p = parentOf(rel);
    if (p) await this.fs.createDir(this.abs(p));
  }

  async saveFile(name: string, content: string): Promise<void> {
    const rel = sanitizeRel(name);
    await this.ensureParent(rel);
    await this.fs.writeFile(this.abs(rel), new TextEncoder().encode(content));
  }

  async readFile(name: string): Promise<string> {
    const rel = sanitizeRel(name);
    try {
      return new TextDecoder().decode(await this.fs.readFile(this.abs(rel)));
    } catch (e) {
      throw new Error(`Failed to read file '${name}': ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }

  /** 不存在时静默成功（与 Rust `if path.exists()` 那支一致：删不在的文件不是错误） */
  async deleteFile(name: string): Promise<void> {
    const rel = sanitizeRel(name);
    if (await this.fs.stat(this.abs(rel))) await this.fs.remove(this.abs(rel), false);
  }

  async createFolder(name: string): Promise<void> {
    await this.fs.createDir(this.abs(sanitizeRel(name)));
  }

  async deleteFolder(name: string): Promise<void> {
    const rel = sanitizeRel(name);
    if (await this.fs.stat(this.abs(rel))) await this.fs.remove(this.abs(rel), true);
  }

  async moveFile(oldName: string, newName: string): Promise<void> {
    const from = sanitizeRel(oldName), to = sanitizeRel(newName);
    await this.ensureParent(to);
    await this.fs.rename(this.abs(from), this.abs(to));
  }

  async moveFolder(oldName: string, newName: string): Promise<void> {
    await this.fs.rename(this.abs(sanitizeRel(oldName)), this.abs(sanitizeRel(newName)));
  }

  async copyFile(source: string, dest: string): Promise<void> {
    const from = sanitizeRel(source), to = sanitizeRel(dest);
    await this.ensureParent(to);
    await this.fs.copy(this.abs(from), this.abs(to));
  }

  async copyFolder(source: string, dest: string): Promise<void> {
    const from = sanitizeRel(source), to = sanitizeRel(dest);
    await this.fs.createDir(this.abs(to));
    for (const e of await this.fs.readDir(this.abs(from))) {
      if (e.type === 'dir') await this.copyFolder(`${from}/${e.name}`, `${to}/${e.name}`);
      else await this.fs.copy(this.abs(`${from}/${e.name}`), this.abs(`${to}/${e.name}`));
    }
  }

  /** 与 Rust `scan_tree_recursive` 同形：files 只含 Verilog 三扩展，folders 含空文件夹 */
  async listTree(): Promise<{ files: Array<{ name: string, size: number, modified: number }>, folders: string[] }> {
    const files: Array<{ name: string, size: number, modified: number }> = [];
    const folders: string[] = [];
    const walk = async (dirRel: string) => {
      const abs = dirRel ? this.abs(dirRel) : this.root;
      let entries;
      try { entries = await this.fs.readDir(abs); } catch { return; }
      for (const e of entries) {
        const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
        if (e.type === 'dir') {
          await walk(rel);
          folders.push(rel);
          continue;
        }
        if (!VERILOG_EXT.includes(extOf(rel))) continue;
        const st = await this.fs.stat(this.abs(rel));
        if (!st) continue;
        files.push({ name: rel, size: st.size, modified: st.mtimeMs });
      }
    };
    await walk('');
    return { files, folders };
  }

  async readConfig(): Promise<string> {
    const abs = this.abs(CONFIG_FILE);
    if (!(await this.fs.stat(abs))) throw new Error('Config file not found');
    return new TextDecoder().decode(await this.fs.readFile(abs));
  }

  async saveConfig(content: string): Promise<void> {
    await this.fs.writeFile(this.abs(CONFIG_FILE), new TextEncoder().encode(content));
  }
}
