// 片 4（R135）：workbench 原生侧边栏三板块——模块 / 层次结构 / 沙盒文件。
// 这是用户裁决「把模块、层次结构整合进 VS Code 壳侧边栏」的落地层。
//
// 数据源：
//  · 模块树     —— 工作区**编译域**文件（.v/.sv/.vh，由一颗主人 `verilogDomain` 给名单）
//    → definedModules（verilogParseLite，主仓同款正则），文件→模块两级
//  · 层次树     —— 活动编辑器（.v）的实例清单 → 定义文件扫描 → 逐层递归展开（链上已出现过的实例⛔ 再展开＝环守卫）
//  · 沙盒文件树 —— ProjectStore.listSandboxTree()（宿主进程内直读：片 5 起这份表⛔ 再走 RPC，
//    前端要正文时由 custom editor 的 init 推 siblings，两侧共用同一把 walk）
// 刷新时机：.v/.djs 增删改 + 工作区切换 + 活动编辑器变化（extension.ts 的监听）+ 命令 verilogVisualizer.refreshTrees。
import * as vscode from 'vscode';
import * as path from 'path';
import { t } from './i18n';   // i18n：中文原文即键（I18N_DESIGN §二）
import { parseVerilogModules, parseVerilogInstances } from './verilogParseLite';
import { ProjectStore } from './projectStore';
import { findVerilogUris, isVerilogPath } from './verilogDomain';

type Node = {
  label: string;
  desc: string;
  /** 关联文件：文件节点＝它自己；模块/实例节点＝定义所在文件（给点击跳转用） */
  uri?: vscode.Uri | null;
  /** 目录树节点的目录（'/' 相对项目根） */
  dir?: string;
  /** 文件树节点的相对路径（'/' 相对项目根；childrenOfLayer 产出的文件叶子专用） */
  name?: string;
  /** 层次树的展开链（'/' 分隔的模块名）：链上出现过的实例⛔ 再展开＝环守卫（A⇄B 互相例化别死循环） */
  chain?: string;
  kind?: 'file' | 'module' | 'instance' | 'hint';
  /** 沙盒树文件叶子的角色角标（H1/Q4）：circuits 名单里的 .djs＝主电路（circuit-board 图标） */
  circuit?: boolean;
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
        command: 'verilogViz.openModuleAt', title: t('打开定义'), arguments: [n.uri, n.label],
      } : {
        command: 'verilogViz.openFile', title: t('打开文件'), arguments: [n.uri],
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
    const files = await findVerilogUris();          // 域界由 verilogDomain 给（⛔ 在这里写死 *.v）
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

/** 全工作区编译域扫一遍建模块名→文件索引（R160 四-3：从 HierarchyTree.rebuildDefIndex **逐字抽出**——
 *  树与 compile.hierarchy 工具同一把尺；调用方自持缓存（树类 refresh 作废、工具每次现建）。 */
export async function buildHierDefIndex(): Promise<Map<string, vscode.Uri>> {
  const map = new Map<string, vscode.Uri>();
  for (const uri of await findVerilogUris()) {
    try {
      for (const mod of parseVerilogModules(await readText(uri))) if (!map.has(mod)) map.set(mod, uri);
    } catch { /* 读不到的文件跳过 */ }
  }
  return map;
}

/** 某文件里例化的模块 → 子节点（跳过链上已有的＝环守卫）。**逐字抽出自 HierarchyTree._instancesOf**，
 *  差别只有 defMap 改为入参（缓存归属上移）；compile.hierarchy 与树共用，⛔ 第二套下钻判据。
 *  ⚠ 2026-10-20 分岔修：`bindingUriOf` 注入**绑定权威**（宿主自身目录链的表值 → 定义文件 Uri）——
 *  R152 起编译内核按表解析，纯同名索引（defMap 首扫命中）会把已绑定的实例解到别的同名文件上，
 *  树/工具与编译单分岔。给了表值命中就⛔ 同名兜底；没给（或表未录）照旧同名索引，行为零变化。 */
export async function hierInstancesOf(
  file: vscode.Uri, chain: string, defMap: Map<string, vscode.Uri>,
  bindingUriOf?: (file: vscode.Uri, mod: string) => Promise<vscode.Uri | null>,
): Promise<Node[]> {
  const seen = new Set(chain.split('/').filter(Boolean));
  const src = await readText(file);
  const mods = parseVerilogInstances(src).filter((mod) => !seen.has(mod));
  const out: Node[] = [];
  for (const mod of mods) {
    const uri = (bindingUriOf ? await bindingUriOf(file, mod) : null) ?? defMap.get(mod) ?? null;
    out.push({
      label: mod,
      desc: uri ? path.basename(uri.fsPath) : t('未找到定义'),
      uri,
      chain: chain ? `${chain}/${mod}` : mod,
      kind: 'instance' as const,
      collapsible: uri ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    });
  }
  return out;
}

export class HierarchyTree implements vscode.TreeDataProvider<Node> {
  private _change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._change.event;
  /** 绑定权威注入（extension.ts 给 makeHierBindingResolver 的产物；缺省＝纯同名索引旧行为） */
  constructor(private readonly _bindingUriOf?: (file: vscode.Uri, mod: string) => Promise<vscode.Uri | null>) { }
  /** 模块名 → 定义文件（refresh 时作废；约定"模块名=文件名"只是兜底，现在以真扫描为准） */
  private _defMap: Map<string, vscode.Uri> | null = null;
  /** R160（批1问题L）：webview/custom editor 激活时 activeTextEditor＝undefined——层次树此前当场
   *  退 welcome（用户看着画布，树却说"没打开文件"）。记一颗最后的 .v uri 作粘滞兜底。
   *  ⚠ 捕获必须在 refresh()（事件驱动）里做，⛔ 只靠 getChildren——视图藏着时 getChildren 根本
   *  不跑（真机实锤：开 top.v→编译画布→切回编译容器，树里没一颗节点＝粘滞从没吃过）。 */
  private _lastVerilogUri: vscode.Uri | null = null;
  refresh(): void {
    const ed = vscode.window.activeTextEditor;
    if (ed && isVerilogPath(ed.document.fileName)) this._lastVerilogUri = ed.document.uri;
    this._defMap = null; this._change.fire();
  }

  getTreeItem(n: Node): vscode.TreeItem {
    const item = makeItem(n, n.uri ? {
      command: 'verilogViz.openModuleAt', title: t('打开定义'), arguments: [n.uri, n.label],
    } : undefined);
    // 右键菜单（view/item/context）的 when 靠它点亮：找到定义的实例才给菜单（提示节点/找不到定义的⛔ 冒充）
    item.contextValue = n.uri ? 'hierarchyItem' : undefined;
    return item;
  }

  async getChildren(el?: Node): Promise<Node[]> {
    if (!el) {
      const editor = vscode.window.activeTextEditor;
      const uri = editor && isVerilogPath(editor.document.fileName)
        ? editor.document.uri
        : (this._lastVerilogUri && isVerilogPath(this._lastVerilogUri.fsPath) ? this._lastVerilogUri : null);
      if (!editor && uri) this._lastVerilogUri = uri;          // 粘滞：只在编辑器活着时更新
      if (editor && isVerilogPath(editor.document.fileName)) this._lastVerilogUri = editor.document.uri;
      if (!uri) {
        return [{ label: t('打开一个 Verilog 源码文件（.v/.sv/.vh）以查看层次结构'), desc: '', kind: 'hint' }];
      }
      return this._instancesOf(uri, '');
    }
    if (el.uri) return this._instancesOf(el.uri, el.chain ?? el.label);
    return [];
  }

  /** 某文件里例化的模块 → 子节点（跳过链上已有的＝环守卫）——委托模块级主人（compile.hierarchy 同尺） */
  private async _instancesOf(file: vscode.Uri, chain: string): Promise<Node[]> {
    await this.rebuildDefIndex();
    return hierInstancesOf(file, chain, this._defMap!, this._bindingUriOf);
  }

  /** 全工作区扫一遍**编译域**文件建模块名→文件的索引（refresh 作废；`getChildren` 异步，正好每次展开前确保就绪） */
  private async rebuildDefIndex(): Promise<void> {
    if (this._defMap) return;
    this._defMap = await buildHierDefIndex();
  }
}

/* ============ 编译模式：文件（代码容器「文件」视图，R152 原生树化） ============ */
/**
 * 文件视图 = **完整资源管理器**（用户裁决 2026-10-17 单刀：树型视图的展开/图标/右键全用
 * workbench 原生渲染，⛔ webview 自绘——「与 VS Code 资源管理器不符」的原罪）。
 * 数据源 ProjectStore（folders 单独成账、空目录也上报）⇒ 真实层级嵌套；
 * 分域靠扩展名：本树 = .v/.sv/.vh（编译域），沙盒树 = .djs（部件域），同一工作区两个视角。
 */
type FileTree = { files: Array<{ name: string; size?: number }>; folders?: string[] };

/** folders(全量平铺) + files → 某一层的子节点（目录在前、localeCompare；只给直属孩子）。 */
function childrenOfLayer(
  tree: FileTree, dir: string, opts: { sizes: boolean },
): Node[] {
  const prefix = dir ? `${dir}/` : '';
  const inLayer = (rel: string) => rel.startsWith(prefix) && !rel.slice(prefix.length).includes('/');
  const dirs = (tree.folders || []).filter(inLayer)
    .map((rel) => rel.slice(prefix.length))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))   // 自检修复：与文件侧同走 numeric（`x 10` 在 `x 2` 后）
    .map((rel): Node => ({ label: rel, desc: '', dir: prefix + rel, collapsible: vscode.TreeItemCollapsibleState.Collapsed }));
  const files = tree.files.filter((f) => inLayer(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((f): Node => ({
      label: f.name.slice(prefix.length),
      desc: opts.sizes ? `${Math.round((f.size ?? 0) / 102.4) / 10} KB` : '',
      // R160 真机实锤（批3问题B）：view/item/context 的命令实参＝**这颗 Node**（⛔ TreeItem），
      //   uri 留 null ⇒ menuUri 三形全空，右键「部件绑定/写全配置」拿错档或哑火。
      uri: uriOfRel(f.name),
      dir: undefined,
      name: f.name,
    }));
  return [...dirs, ...files];
}

/** 文件树/沙盒树共用的目录项 resourceUri：右键命令（menuUri）与「在此新建」的命脉。 */
function uriOfRel(rel: string): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  return vscode.Uri.joinPath(root ?? vscode.Uri.file('.'), ...rel.split('/'));
}

function dirItemOf(n: Node, contextValue: string): vscode.TreeItem {
  const item = makeItem(n);
  item.resourceUri = uriOfRel(n.dir!);          // 目录右键（menuUri）取它
  item.contextValue = contextValue;
  return item;
}

export class CodeFilesTree implements vscode.TreeDataProvider<Node> {
  private _change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._change.event;
  constructor(private readonly _store: () => ProjectStore) { }
  refresh(): void { this._change.fire(); }

  getTreeItem(n: Node): vscode.TreeItem {
    if (n.dir !== undefined) return dirItemOf(n, 'codeDir');
    if (!n.name) return makeItem(n);   // 空态提示节点（审查缺陷 #1：uriOfRel(n.name!) 对 undefined.split 当场崩）
    const uri = uriOfRel(n.name);
    const item = makeItem(n, { command: 'verilogViz.openFile', title: t('打开文件'), arguments: [uri] });
    item.resourceUri = uri;
    item.contextValue = 'codeFile';
    return item;
  }

  async getChildren(el?: Node): Promise<Node[]> {
    let tree;
    try { tree = await this._store().listTree(); }
    catch { return [{ label: t('项目目录还没就绪（先打开一个文件夹）'), desc: '', kind: 'hint' as const }]; }
    return childrenOfLayer(tree, el?.dir ?? '', { sizes: true });
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
      command: 'vscode.openWith', title: t('打开电路画布'), arguments: [n.uri, 'verilogViz.doc'],
    } : undefined);
    // 右键菜单的 when 靠它点亮；提示节点（沙盒目录还没建）⛔ 顶名——顶了菜单就会把 TreeItem 当 Uri 传进命令
    item.contextValue = n.uri ? 'sandboxFile' : undefined;
    return item;
  }

  async getChildren(): Promise<Node[]> {
    let tree;
    try { tree = await this._store().listSandboxTree(); }
    catch { return [{ label: t('沙盒目录尚未创建'), desc: t('进沙盒保存一个电路即可'), kind: 'hint' }]; }
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
    // 点层次树项 = 直奔该子电路的部件绑定（带活动文档 uri + **实例名**：面板打开后聚焦那一行）
    const cmd = n.kind === 'instance' && activeSandboxDoc.name ? {
      command: 'verilogViz.bindParts', title: t('部件绑定'),
      arguments: [vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('.'),
        ...activeSandboxDoc.name.split('/')), n.label],
    } : undefined;
    const item = makeItem(n, cmd);
    item.contextValue = n.kind === 'instance' ? 'sandboxHierarchyItem' : undefined;
    return item;
  }

  async getChildren(): Promise<Node[]> {
    if (!activeSandboxDoc.name) {
      return [{ label: t('打开一个 .djs 电路画布以查看层次结构'), desc: '', kind: 'hint' }];
    }
    return activeSandboxDoc.instances.map((celltype) => ({
      label: celltype, desc: activeSandboxDoc.name, kind: 'instance' as const,
    }));
  }
}

export class SandboxTree implements vscode.TreeDataProvider<Node> {
  private _change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._change.event;
  /** circuits 名单供给（H1/Q4 角标用；不给＝不做角标，老签名兼容） */
  constructor(private readonly _store: () => ProjectStore, private readonly _circuits?: () => Promise<Set<string>>) { }
  refresh(): void { this._change.fire(); }

  getTreeItem(n: Node): vscode.TreeItem {
    if (n.dir !== undefined) return dirItemOf(n, 'sandboxDir');
    const uri = n.uri ?? (n.name ? uriOfRel(n.name) : undefined);   // childrenOfLayer 产的叶子带 name，不带 uri
    const item = makeItem(n, uri ? {
      // ⛔ 用 openFile（文本）：`.djs` 的主人是电路画布 custom editor——树点与双击同进画布
      command: 'vscode.openWith', title: '打开电路画布', arguments: [uri, 'verilogViz.doc'],
    } : undefined);
    // H1（Q4 裁决 2026-10-17 做角标）：circuits 名单里的 .djs＝主电路，circuit-board 图标在列表里一眼可辨
    if (n.circuit) item.iconPath = new vscode.ThemeIcon('circuit-board');
    // 右键菜单（view/item/context）按节点种类分流：文件=重命名/删除/副本/部件角色；目录=重命名/删除
    item.contextValue = uri ? 'sandboxFile' : undefined;
    return item;
  }

  async getChildren(el?: Node): Promise<Node[]> {
    let tree;
    try { tree = await this._store().listSandboxTree(); }
    catch { return [{ label: t('沙盒目录尚未创建'), desc: t('进沙盒保存一个电路即可'), kind: 'hint' }]; }
    const nodes = childrenOfLayer(tree, el?.dir ?? '', { sizes: true });
    if (this._circuits) {
      const circuits = await this._circuits();
      for (const n of nodes) if (n.name && circuits.has(n.name)) n.circuit = true;
    }
    return nodes;
  }
}

/* ============ F 族（F1/F3/F4/F6）：文件树拖拽（树内移动 + OS 拖入），2026-10-17 落地 ============ */
/**
 * 两棵文件树各挂一颗（域由 `_exts` 圈死＝F3）：
 *  · 树内拖（F1/F6）：多选 uri 逐颗走注入的 `_onMove`（extension.ts 里共源 `moveToFile`
 *    ⇒ G1 迁移/自环拒/(n) 去重与 C9 一条路），完成后宿主侧统一刷树+广播；
 *  · OS 拖入（F4，API≥1.83）：`item.file`（DataTransferFile）读字节交 `_onWriteIn`，
 *    落盘去重与域过滤在宿主侧（与 E6 导入同一口径）。
 * 剪贴板 MIME 只挂自己树的那颗（跨树拖动被平台层拒掉＝域限制的第一道闸）。
 */
export class FileTreeDragAndDrop implements vscode.TreeDragAndDropController<vscode.TreeItem> {
  readonly dropMimeTypes: string[];
  readonly dragMimeTypes = ['text/uri-list'];
  constructor(
    private readonly _viewId: string,
    private readonly _exts: string[],
    private readonly _onMove: (srcs: vscode.Uri[], destDir: vscode.Uri, skipped: number) => Promise<void>,
    private readonly _onWriteIn: (files: Array<{ name: string; bytes: Uint8Array }>, destDir: vscode.Uri, skipped: number) => Promise<void>,
  ) {
    this.dropMimeTypes = [`application/vnd.code.tree.${this._viewId.toLowerCase()}`];
  }

  private mime(): string { return `application/vnd.code.tree.${this._viewId.toLowerCase()}`; }
  private extOf(u: vscode.Uri): string {
    const base = u.path.split('/').pop() || '';
    const i = base.lastIndexOf('.');
    return i > 0 ? base.slice(i + 1).toLowerCase() : '';
  }
  /** 松手点的目录语义：落在目录＝它；落在文件＝它所在目录；落空白（树底）＝项目根 */
  private async _destDirOf(target?: vscode.TreeItem): Promise<vscode.Uri> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('.');
    const uri = target?.resourceUri;
    if (!uri) return root;
    let isDir = false;
    try { isDir = (await vscode.workspace.fs.stat(uri) as any).type === 2; } catch { /* 读不到＝按文件处理 */ }
    return isDir ? uri : vscode.Uri.joinPath(uri, '..');
  }

  handleDrag(source: readonly vscode.TreeItem[], dataTransfer: vscode.DataTransfer): void {
    const uris = source.map((t) => t.resourceUri).filter((u): u is vscode.Uri => !!u);
    if (uris.length) dataTransfer.set(this.mime(), new vscode.DataTransferItem(uris));
  }

  async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const dest = await this._destDirOf(target);
    // ① 树内拖移（域过滤后逐颗移动；被域拦下的当面记账）
    const internal = dataTransfer.get(this.mime())?.value as vscode.Uri[] | undefined;
    if (internal?.length) {
      const srcs = internal.filter((u) => this._exts.includes(this.extOf(u)));
      await this._onMove(srcs, dest, internal.length - srcs.length);
      return;
    }
    // ② OS 拖入（F4）：DataTransferFile → 字节交给宿主写盘（去重/域过滤/建表同 E6）
    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    let skipped = 0;
    for (const [, item] of dataTransfer) {
      const f = (item as unknown as { file?: { name?: string; data?: () => Promise<ArrayBuffer> } }).file;
      if (!f?.data || !f.name) continue;
      const i = f.name.lastIndexOf('.');
      const ext = i > 0 ? f.name.slice(i + 1).toLowerCase() : '';
      if (!this._exts.includes(ext)) { skipped++; continue; }
      try { files.push({ name: f.name, bytes: new Uint8Array(await f.data()) }); }
      catch { skipped++; }
    }
    if (files.length || skipped) await this._onWriteIn(files, dest, skipped);
  }
}
