// 片 4（R135）：workbench 原生侧边栏三板块——模块 / 层次结构 / 沙盒文件。
// 这是用户裁决「把模块、层次结构整合进 VS Code 壳侧边栏」的落地层。
//
// 数据源：
//  · 模块树     —— 工作区 **/*.v 扫描 → definedModules（verilogParseLite，主仓同款正则），文件→模块两级
//  · 层次树     —— 活动编辑器（.v）的实例清单 → 定义文件扫描 → 逐层递归展开（链上已出现过的实例⛔ 再展开＝环守卫）
//  · 沙盒文件树 —— ProjectStore.listSandboxTree()（片 4-C1 的第 16 颗 RPC 同源）
// 刷新时机：.v/.djs 增删改 + 工作区切换 + 活动编辑器变化（extension.ts 的监听）+ 命令 verilogVisualizer.refreshTrees。
import * as vscode from 'vscode';
import * as path from 'path';
import { parseVerilogModules, parseVerilogInstances } from './verilogParseLite';
import { ProjectStore } from './projectStore';

type Node = {
  label: string;
  desc: string;
  /** 关联文件：文件节点＝它自己；模块/实例节点＝定义所在文件（给点击跳转用） */
  uri?: vscode.Uri | null;
  /** 沙盒树的目录节点（'/' 相对项目根） */
  dir?: string;
  /** 层次树的展开链（'/' 分隔的模块名）：链上出现过的实例⛔ 再展开＝环守卫（A⇄B 互相例化别死循环） */
  chain?: string;
  kind?: 'file' | 'module' | 'instance' | 'hint';
  collapsible?: vscode.TreeItemCollapsibleState;
};

function makeItem(n: Node, cmd?: vscode.Command): vscode.TreeItem {
  const item = new vscode.TreeItem(n.label, n.collapsible ?? vscode.TreeItemCollapsibleState.None);
  if (n.desc) item.description = n.desc;
  if (n.uri) item.resourceUri = n.uri;
  if (cmd) item.command = cmd;
  return item;
}

/** 打开文件并把视口滚到 `module <名>` 行（与主仓 openAtModule 同语义） */
export async function openAtModule(uri: vscode.Uri, module: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  const idx = doc.getText().indexOf('module ' + module);
  if (idx >= 0) {
    const line = doc.positionAt(idx).line;
    editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
  }
}

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

/* ============ 模块 Modules ============ */
/** 文件→模块两级：根列出含模块定义的 .v 文件，展开一颗文件看到它定义的模块（点击跳到 `module <名>` 行）。 */
export class ModuleTree implements vscode.TreeDataProvider<Node> {
  private _change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._change.event;
  refresh(): void { this._change.fire(); }

  getTreeItem(n: Node): vscode.TreeItem {
    const cmd = !n.uri ? undefined
      : n.kind === 'module' ? {
        command: 'verilogViz.openModuleAt', title: '打开定义', arguments: [n.uri, n.label],
      } : {
        command: 'verilogViz.openFile', title: '打开文件', arguments: [n.uri],
      };
    const item = makeItem(n, cmd);
    // 右键菜单（view/item/context）的 when 依赖 contextValue：模块树项=module、文件项=moduleFile
    item.contextValue = n.kind === 'module' ? 'module' : n.uri ? 'moduleFile' : undefined;
    return item;
  }

  async getChildren(el?: Node): Promise<Node[]> {
    if (el?.uri) {
      // 文件展开：里面的模块定义（叶子）
      try {
        return parseVerilogModules(await readText(el.uri)).map((mod) => ({
          label: mod, desc: path.basename(el.uri!.fsPath), uri: el.uri, kind: 'module' as const,
        }));
      } catch { return []; }
    }
    const files = (await vscode.workspace.findFiles('**/*.v', '**/node_modules/**'))
      .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const out: Node[] = [];
    for (const uri of files) {
      try {
        const mods = parseVerilogModules(await readText(uri));
        if (!mods.length) continue;                        // ⛔ 空文件也占一行——模块树只收真定义了模块的
        const relDir = root ? path.relative(root.fsPath, path.dirname(uri.fsPath)) : '';
        out.push({
          label: path.basename(uri.fsPath), desc: relDir === '' ? '' : relDir,
          uri, kind: 'file' as const, collapsible: vscode.TreeItemCollapsibleState.Collapsed,
        });
      } catch { /* 读不到的文件跳过 */ }
    }
    return out;
  }
}

/* ============ 层次结构 Hierarchy ============ */
/** 从活动编辑器的 .v 出发逐层下钻：实例 → 定义文件 → 该文件的实例……（环守卫见 `Node.chain`）。 */
export class HierarchyTree implements vscode.TreeDataProvider<Node> {
  private _change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._change.event;
  /** 模块名 → 定义文件（refresh 时作废；约定"模块名=文件名"只是兜底，现在以真扫描为准） */
  private _defMap: Map<string, vscode.Uri> | null = null;
  refresh(): void { this._defMap = null; this._change.fire(); }

  getTreeItem(n: Node): vscode.TreeItem {
    const item = makeItem(n, n.uri ? {
      command: 'verilogViz.openModuleAt', title: '打开定义', arguments: [n.uri, n.label],
    } : undefined);
    // 右键菜单（view/item/context）的 when 靠它点亮：找到定义的实例才给菜单（提示节点/找不到定义的⛔ 冒充）
    item.contextValue = n.uri ? 'hierarchyItem' : undefined;
    return item;
  }

  async getChildren(el?: Node): Promise<Node[]> {
    if (!el) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || path.extname(editor.document.fileName) !== '.v') {
        return [{ label: '打开一个 .v 文件以查看层次结构', desc: '', kind: 'hint' }];
      }
      return this._instancesOf(editor.document.uri, '');
    }
    if (el.uri) return this._instancesOf(el.uri, el.chain ?? el.label);
    return [];
  }

  /** 某文件里例化的模块 → 子节点（跳过链上已有的＝环守卫） */
  private async _instancesOf(file: vscode.Uri, chain: string): Promise<Node[]> {
    await this.rebuildDefIndex();
    const seen = new Set(chain.split('/').filter(Boolean));
    const src = await readText(file);
    return parseVerilogInstances(src)
      .filter((mod) => !seen.has(mod))
      .map((mod) => {
        const uri = this._defMap?.get(mod) ?? null;
        return {
          label: mod,
          desc: uri ? path.basename(uri.fsPath) : '未找到定义',
          uri,
          chain: chain ? `${chain}/${mod}` : mod,
          kind: 'instance' as const,
          collapsible: uri ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        };
      });
  }

  /** 全工作区扫一遍 .v 建模块名→文件的索引（refresh 作废；`getChildren` 异步，正好每次展开前确保就绪） */
  private async rebuildDefIndex(): Promise<void> {
    if (this._defMap) return;
    const map = new Map<string, vscode.Uri>();
    for (const uri of await vscode.workspace.findFiles('**/*.v', '**/node_modules/**')) {
      try {
        for (const mod of parseVerilogModules(await readText(uri))) if (!map.has(mod)) map.set(mod, uri);
      } catch { /* 读不到的文件跳过 */ }
    }
    this._defMap = map;
  }
}

/* ============ 编译模式：文件（代码容器「文件」视图） ============ */
/** 工作区 .v/.sv 文件列表（右键：编译/重命名/副本/删除/部件绑定）。 */
export class CodeFilesTree implements vscode.TreeDataProvider<Node> {
  private _change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._change.event;
  refresh(): void { this._change.fire(); }

  getTreeItem(n: Node): vscode.TreeItem {
    const item = makeItem(n, n.uri ? {
      command: 'verilogViz.openFile', title: '打开文件', arguments: [n.uri],
    } : undefined);
    item.contextValue = n.uri ? 'codeFile' : undefined;
    return item;
  }
  async getChildren(): Promise<Node[]> {
    const files = (await vscode.workspace.findFiles('**/*.{v,sv}', '**/node_modules/**'))
      .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return files.map((uri) => {
      const rel = root ? path.relative(root.fsPath, uri.fsPath).replace(/\\/g, '/') : uri.fsPath;
      return { label: path.basename(uri.fsPath), desc: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', uri, kind: 'file' as const };
    });
  }
}

/* ============ 沙盒模式：部件（ circuits 名单之外的全部 .djs） ============ */
/** 「部件」视图＝可放置部件清单（`.verilogviz.json` circuits 名单之外的全部 .djs，
 *  与 SandboxCanvas refreshGates 的口径一致）。 */
export class SandboxPartsTree implements vscode.TreeDataProvider<Node> {
  private _change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._change.event;
  constructor(private readonly _store: () => ProjectStore, private readonly _circuits: () => Promise<Set<string>>) { }
  refresh(): void { this._change.fire(); }

  getTreeItem(n: Node): vscode.TreeItem {
    const item = makeItem(n, n.uri ? {
      command: 'vscode.openWith', title: '打开电路画布', arguments: [n.uri, 'verilogViz.doc'],
    } : undefined);
    // 右键菜单的 when 靠它点亮；提示节点（沙盒目录还没建）⛔ 顶名——顶了菜单就会把 TreeItem 当 Uri 传进命令
    item.contextValue = n.uri ? 'sandboxFile' : undefined;
    return item;
  }

  async getChildren(): Promise<Node[]> {
    let tree;
    try { tree = await this._store().listSandboxTree(); }
    catch { return [{ label: '沙盒目录尚未创建', desc: '进沙盒保存一个电路即可', kind: 'hint' }]; }
    const circuits = await this._circuits();
    return tree.files
      .filter((f) => !circuits.has(f.name))
      .map((f) => ({
        label: f.name.split('/').pop() || f.name,
        desc: f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/')) : '',
        uri: this._uri(f.name), kind: 'file' as const,
      }));
  }

  private _uri(name: string): vscode.Uri {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return vscode.Uri.joinPath(root ?? vscode.Uri.file('.'), name);
  }
}

/* ============ 沙盒模式：层次结构（活动电路文档的子电路实例） ============ */
/** 活动沙盒文档（customEditors 在 init/edit 时更新）：层次树的数据源。 */
const activeSandboxDoc: { name: string; instances: string[] } = { name: '', instances: [] };
let activeSandboxDocListener: (() => void) | null = null;
export function setActiveSandboxDoc(name: string, instances: string[]): void {
  const changed = name !== activeSandboxDoc.name || instances.join() !== activeSandboxDoc.instances.join();
  activeSandboxDoc.name = name;
  activeSandboxDoc.instances = instances;
  if (changed) activeSandboxDocListener?.();
}
export function onActiveSandboxDocChange(fn: () => void): { dispose(): void } {
  activeSandboxDocListener = fn;
  return { dispose() { if (activeSandboxDocListener === fn) activeSandboxDocListener = null; } };
}

/** 右键菜单的兜底：view/item/context 传来的 TreeItem 没有 resourceUri（层次树实例没挂文件）⇒ 用活动文档补 */
export function getActiveSandboxDocUri(): vscode.Uri | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  return activeSandboxDoc.name && root
    ? vscode.Uri.joinPath(root, ...activeSandboxDoc.name.split('/'))
    : undefined;
}

/** 沙盒「层次结构」：活动电路文档里例化的子电路（celltype 名单，去重）。 */
export class SandboxHierarchyTree implements vscode.TreeDataProvider<Node> {
  private _change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._change.event;
  refresh(): void { this._change.fire(); }

  getTreeItem(n: Node): vscode.TreeItem {
    // 点层次树项 = 直奔该子电路的部件绑定（QuickPick 选部件文件）
    const cmd = n.kind === 'instance' && activeSandboxDoc.name ? {
      command: 'verilogViz.bindParts', title: '部件绑定',
      arguments: [vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('.'),
        ...activeSandboxDoc.name.split('/'))],
    } : undefined;
    const item = makeItem(n, cmd);
    item.contextValue = n.kind === 'instance' ? 'sandboxHierarchyItem' : undefined;
    return item;
  }

  async getChildren(): Promise<Node[]> {
    if (!activeSandboxDoc.name) {
      return [{ label: '打开一个 .djs 电路画布以查看层次结构', desc: '', kind: 'hint' }];
    }
    return activeSandboxDoc.instances.map((celltype) => ({
      label: celltype, desc: activeSandboxDoc.name, kind: 'instance' as const,
    }));
  }
}

export class SandboxTree implements vscode.TreeDataProvider<Node> {
  private _change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._change.event;
  constructor(private readonly _store: () => ProjectStore) { }
  refresh(): void { this._change.fire(); }

  getTreeItem(n: Node): vscode.TreeItem {
    const item = makeItem(n, n.uri ? {
      // ⛔ 用 openFile（文本）：`.djs` 的主人是电路画布 custom editor——树点与双击同进画布
      command: 'vscode.openWith', title: '打开电路画布', arguments: [n.uri, 'verilogViz.doc'],
    } : undefined);
    // 右键菜单（view/item/context）按节点种类分流：文件=重命名/删除/副本/部件角色；目录=重命名/删除
    item.contextValue = n.dir !== undefined ? 'sandboxDir' : n.uri ? 'sandboxFile' : undefined;
    return item;
  }

  async getChildren(el?: Node): Promise<Node[]> {
    let tree;
    try { tree = await this._store().listSandboxTree(); }
    catch { return [{ label: '沙盒目录尚未创建', desc: '进沙盒保存一个电路即可', kind: 'hint' }]; }
    if (el?.dir) {
      // 文件夹展开：按前缀过滤（ProjectTree 的 name 相对项目根、'/' 分隔）
      const prefix = el.dir + '/';
      return [
        ...tree.folders.filter((f) => f.startsWith(prefix)).map((f) => ({
          label: f.slice(prefix.length), desc: '', dir: f,
          collapsible: vscode.TreeItemCollapsibleState.Collapsed,
        })),
        ...tree.files.filter((f) => f.name.startsWith(prefix)).map((f) => ({
          label: f.name.slice(prefix.length), desc: Math.round(f.size / 102.4) / 10 + ' KB',
          uri: this._uri(f.name),
        })),
      ];
    }
    return [
      ...tree.folders.map((f) => ({
        label: f, desc: '', dir: f,
        collapsible: vscode.TreeItemCollapsibleState.Collapsed,
      })),
      ...tree.files.filter((f) => !f.name.includes('/')).map((f) => ({
        label: f.name, desc: Math.round(f.size / 102.4) / 10 + ' KB',
        uri: this._uri(f.name),
      })),
    ];
  }

  private _uri(name: string): vscode.Uri {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return vscode.Uri.joinPath(root ?? vscode.Uri.file('.'), name);
  }
}
