/**
 * 项目目录的后端（Extension Host 侧），与当年 Rust 后端那 14 颗命令**逐条对齐**
 * （`src-tauri/` 已于 R138 整条删除，那套语义靠本文件的单测守住）。
 *
 * 为什么写成"只依赖一个注入的 fs 接口"：这样路径规则与目录树扫描这两件最容易出事的事
 * 能在无头单测里判（`tests/unit/vscodeShell.test.ts` 的「项目目录后端」那一组拿一份内存假 fs），
 * ⛔ 只在真实 VS Code 里手点一遍——那等于把安全边界交给手感。
 *
 * 三条与 Rust 版一致的形状（改了任何一条，两个宿主的文件行为就会分岔）：
 *  1. `sanitizeRel` 拒绝对对路径与 `..` 段（防穿越）；
 *  2. 目录树**按扩展名分两颗**：Verilog 那份只上报 `.v/.sv/.vh`（`listTree`），沙盒 `.djs` 走 `listSandboxTree`
 *     ——合并不了：前端 `fileStore.refresh()` 会把 Verilog 那颗表的每一颗都当源码解析；
 *     名字都是**相对项目根、用 '/' 分隔**（R140 片 4-C1 起 `.djs` 开始有了磁盘这份，沙盒那侧仍以 localStorage 为运行时主人）；
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
  /** 真宿主的 readDirectory 带 SymbolicLink 位 ⇒ 适配层把它折成 'link'（collect 对目录软链整支跳过防环） */
  readDir(path: string): Promise<Array<{ name: string; type: 'file' | 'dir' | 'link' }>>;
}

const VERILOG_EXT = ['v', 'sv', 'vh'];
/** 沙盒电路文档的扩展名（片 4-C1：`.djs` 开始成为工作区里的真文件） */
const SANDBOX_EXT = ['djs'];
export const CONFIG_FILE = 'verilog-viz.config.json';

/**
 * 目录树扫描⛔ 进这两类目录：`node_modules`（依赖树里那颗 `.v` 是别人的东西）与**任何点开头目录**
 * （`.git`、`.vscode`、`.venv`……）。
 * 这条规则是**片 3 换轨带来的**：项目根从"我们自己的 `project_files` 目录"变成"用户打开的那个文件夹"，
 * 一次 `refresh()` 就可能落在一整仓代码上；旧家⛔ 会有这问题 ⇒ ⛔ 把它当成 Rust 版的老规矩照抄。
 * 判据在 `tests/unit/vscodeShell.test.ts`「项目目录后端」那一组（同名但⛔ 点开头的目录必须仍上报）。
 */
const shouldSkipDir = (name: string) => name === 'node_modules' || name.startsWith('.');

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

  /**
   * 一次遍历、按扩展名收表。⚠ 两颗列表**共用这一颗 walk**：跳过规则（`node_modules`/点开头目录）、
   * "相对根、'/' 分隔"的名字形状、空文件夹也上报这几条，两份列表必须同源——
   * 复制一份 walk 出去，将来只改一边就会分岔（而分岔的表现是"沙盒里看不见那颗文件"）。
   */
  private async collect(exts: string[]): Promise<{ files: Array<{ name: string, size: number, modified: number }>, folders: string[] }> {
    const files: Array<{ name: string, size: number, modified: number }> = [];
    const folders: string[] = [];
    // X4（2026-10-17）：深度 16 护栏 + 目录软链（'link'）整支跳过——循环 symlink 会把 walk
    // 打成死循环（hasDjsUnder 早就有 depth=8 的同类护栏，collect 这边反倒没有 ⇒ 补齐同门）。
    const DEPTH = 16;
    const walk = async (dirRel: string, depth: number) => {
      if (depth > DEPTH) return;
      const abs = dirRel ? this.abs(dirRel) : this.root;
      let entries;
      try { entries = await this.fs.readDir(abs); } catch { return; }
      for (const e of entries) {
        if (e.type === 'link') continue;            // 软链一律不走进也不上报（目录环/外锚都对树构成噪声）
        const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
        if (e.type === 'dir') {
          if (shouldSkipDir(e.name)) continue;      // ⛔ 走进去，也⛔ 把它当空文件夹上报
          await walk(rel, depth + 1);
          folders.push(rel);
          continue;
        }
        if (!exts.includes(extOf(rel))) continue;
        const st = await this.fs.stat(this.abs(rel));
        if (!st) continue;
        files.push({ name: rel, size: st.size, modified: st.mtimeMs });
      }
    };
    await walk('', 1);
    return { files, folders };
  }

  /** 与 Rust `scan_tree_recursive` 同形：files 只含 Verilog 三扩展，folders 含空文件夹 */
  async listTree() { return this.collect(VERILOG_EXT); }

  /**
   * 沙盒电路文件（`.djs`）的那份表——**与 Verilog 那份分开**上报。
   * 分开的理由⛔ 是"分类好看"：`src/store/fileStore.ts` 的 `refresh()` 会把 `listProjectTree`
   * 回的**每一颗**都当 Verilog 源码读进并 `parseVerilogModules`，还有一条"磁盘上没了就从状态里删"的分支
   * ⇒ `.djs` 混进那颗表＝电路 JSON 被当 Verilog 导入（模块名一片垃圾）＋沙盒列表被那边牵动。
   */
  async listSandboxTree() { return this.collect(SANDBOX_EXT); }

  async readConfig(): Promise<string> {
    const abs = this.abs(CONFIG_FILE);
    if (!(await this.fs.stat(abs))) throw new Error('Config file not found');
    return new TextDecoder().decode(await this.fs.readFile(abs));
  }

  async saveConfig(content: string): Promise<void> {
    await this.fs.writeFile(this.abs(CONFIG_FILE), new TextEncoder().encode(content));
  }
}
