/**
 * `vscode` API 的**最小桩**，只为把 `extension/src/extension.ts` 拉进无头环境跑
 * （运行时靠 `vitest.config.ts` 的 alias，类型靠 `tsconfig.json` 的 paths——两处都⛔ 漏，
 * 漏一处就是"编辑器里 import 得到、跑起来找不到模块"那种红）。
 *
 * 为什么要有这颗桩：R139 之后每往 workbench 原生位置搬一层（片 3/4/5），改的都是
 * "宿主调用 ↔ 磁盘 ↔ webview 装载"这条链，而这条链原先**只有真开一颗 Extension Host 才看得见**
 * ⇒ 判据全被登记成"真机项"，用户的注意力成了测试台架。有了它，六件事变无头可判：
 * 项目根选哪颗、RPC 落不落对盘、webview HTML 装没装上、面板该不该自己弹、
 * 侧边栏三棵树长没长对、Problems/Output 落没落到 workbench。
 *
 * ⚠ 诚实的射程（**宽容度就是判据的射程**）：
 *  · `Uri` 只认 file scheme；`joinPath` **会**折叠 `..`（真宿主语义），⛔ 处理 query/fragment；
 *  · `workspace.fs` 是内存表，⛔ 权限、⛔ 编码猜谜（读回的就是写进去的那串字节）；
 *  · `window.createWebviewPanel` 回的是哑对象，`webview.html` 赋值**只记账、⛔ 渲染**；
 *  · `findFiles` 是"后缀匹配 + 排除 node_modules"的土实现，⛔ 真 glob 语义。
 * 所以这颗桩证明的是"我们这边的接线对"，⛔ 证明"VS Code 那边会这么干"——后者仍归
 * `tests/r137-webview-csp-gate.cjs`（真浏览器 + 真 CSP）与真机点验。
 *
 * `workspace.fs` 各方法**故意回 Thenable（⛔ Promise）**：真宿主就回 Thenable，而 extension.ts
 * 顶部那颗 `then()` 助手是**已知缺陷的修法**（拿 `as any` 糊过去时 ProjectStore 的 try/catch 收不到
 * rejection）。桩要是回 Promise，那颗助手就永远测不到。
 */

/** 与 vscode.FileType 同值（1＝File，2＝Directory）：数值对上才有意义，⛔ 我们自创一套 */
export const FileType = { Unknown: 0, File: 1, Directory: 2 } as const;
export const ViewColumn = { One: 1, Two: 2, Active: -1, Beside: -2 } as const;
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 } as const;
/** 与 vscode.TreeItemCollapsibleState 同值（类型面也合并：trees.ts 把它当类型标注用） */
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;
export type TreeItemCollapsibleState = 0 | 1 | 2;
/** 与 vscode.TextEditorRevealType 同值（只列 trees.ts 用得到的那族） */
export const TextEditorRevealType = { Auto: 0, AtTop: 1, InCenter: 2, InCenterIfOutsideViewport: 3 } as const;
/** 与 vscode.DiagnosticSeverity 同值 */
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;

/** 真宿主的 `Thenable` 更宽（onRejected 可选、回值可为 Thenable）；收成一种形状是为了让桩自己过 strict。
 *  ⚠ 这里的 cast 只住桩；被测代码那条通道由 `then()` 助手与它自己的判据守着。 */
type ThenableLike<T> = { then: (onOk: (v: T) => void, onErr?: (e: unknown) => void) => void };

/** 扩展源码里写的是真宿主的 `Thenable<T>`（@types/vscode），根程序里由这颗别名接住 */
export type Thenable<T> = ThenableLike<T>;

/** 真宿主把 `Thenable` 声明成**全局**类型（extension 源码里裸写 `Thenable<boolean>` 不带前缀），
 *  根程序里得由桩补上同一颗全局名——否则源码在两份 tsc 下形状不一致。 */
declare global {
  // eslint-disable-next-line no-var
  type Thenable<T> = ThenableLike<T>;
}

const settled = <T>(v: T): ThenableLike<T> => ({ then: (cb) => cb(v) });
const failed = (e: unknown): ThenableLike<any> => ({ then: (_cb?, err?) => { if (err) err(e); } });

/** 路径归一：反斜杠→正斜杠、压掉重复斜杠（与真宿主的 `uri.path` 同形：`/d:/x/y`） */
const normPath = (p: string) => '/' + String(p).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
/** 折叠 `.`/`..`（真磁盘路径解析语义：key 层折了，seed 里写 `a/../b` 与 `b` 才是同一颗文件） */
const foldRel = (p: string): string => {
  const out: string[] = [];
  for (const s of p.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') { if (out.length > 1) out.pop(); continue; }    // 过根护栏
    out.push(s);
  }
  return `/${out.join('/')}`;
};

export class Uri {
  private constructor(readonly scheme: string, readonly path: string) { }
  static file(fsPath: string): Uri { return new Uri('file', normPath(fsPath)); }
  static joinPath(base: Uri, ...segs: string[]): Uri {
    const raw = [base.path.replace(/\/+$/, ''), ...segs.map((s) => s.replace(/^\/+/, ''))].join('/');
    // **规范化折叠 `..`**（真 Uri.joinPath 的语义）。上一版只做字符串拼接，害得
    // `Uri.joinPath(uri, '..')` 取父目录的规范写法在台架上连环踩雷（副本/导入/新建族）。
    return new Uri(base.scheme, foldRel(raw));
  }
  /** 真宿主在 Windows 上给的是反斜杠（`d:\x\y`）：`revealProjectDir` 抄进剪贴板的就是它 */
  get fsPath(): string { return this.path.replace(/^\/([a-zA-Z]:)/, '$1').replace(/\//g, '\\'); }
  toString(): string { return `${this.scheme}://${this.path.replace(/^\//, '')}`; }
  with(change: { scheme?: string, path?: string }): Uri {
    return new Uri(change.scheme ?? this.scheme, change.path ?? this.path);
  }
}

/* ================= 树（片 4：侧边栏三板块） ================= */

export type Event<T> = (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => Disposable;
export type ProviderResult<T> = T | undefined | null | ThenableLike<T>;

export interface Command { readonly title: string; readonly command: string; readonly arguments?: any[] }

/** R147：webview view 的类型形状（registerWebviewViewProvider 用）——台架只跑最小面 */
export interface WebviewView {
  viewType: string;
  name: string;
  visible: boolean;
  title?: string;
  description?: string;
  webview: {
    options: any;
    html: string;
    cspSource: string;
    asWebviewUri(u: Uri): Uri;
    postMessage(m: any): ThenableLike<boolean>;
    onDidReceiveMessage(fn: (m: any) => any): Disposable;
  };
  show?(preserveFocus?: boolean): void;
}
export interface WebviewViewProvider {
  resolveWebviewView(webviewView: WebviewView, context?: unknown, token?: unknown): void | Promise<void>;
}

export class TreeItem {
  readonly label: string;
  readonly collapsibleState: number;
  description?: string | boolean;
  resourceUri?: Uri;
  command?: Command;
  /** 右键菜单分流（contributes.menus view/item/context 的 when 子句读它） */
  contextValue?: string;
  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState ?? TreeItemCollapsibleState.None;
  }
}

export interface TreeDataProvider<T> {
  /** 与 @types/vscode 逐字同形：`T | T[] | undefined | null | void` 这个放宽正是为了
   *  `EventEmitter<void>.event`（Event<void>）能落进来——Event 的参数逆变要靠它兜住。 */
  onDidChangeTreeData?: Event<T | T[] | undefined | null | void>;
  getTreeItem(element: T): TreeItem | ThenableLike<TreeItem>;
  getChildren?(element?: T): ProviderResult<T[]>;
}

/** 事件源：真宿主同名 API 的最小形状——fire 顺序调用在册监听器（树刷新判据靠它） */
export class EventEmitter<T> {
  private _listeners: Array<(e: T) => any> = [];
  readonly event: Event<T> = (listener) => {
    this._listeners.push(listener);
    return { dispose: () => { this._listeners = this._listeners.filter((f) => f !== listener); } };
  };
  fire(e: T): void { for (const fn of [...this._listeners]) fn(e); }
  dispose(): void { this._listeners = []; }
}

export interface FileSystemWatcher {
  readonly onDidCreate: Event<Uri>;
  readonly onDidChange: Event<Uri>;
  readonly onDidDelete: Event<Uri>;
  dispose(): void;
}

/** 流水账里的那颗监听器（真宿主没这些，测试靠 `fireCreate` 等触发"树该刷新了"） */
export interface FakeWatcher {
  glob: string;
  fireCreate: (u: Uri) => void;
  fireChange: (u: Uri) => void;
  fireDelete: (u: Uri) => void;
}

/* ================= Problems / Output（片 4：workbench 接管） ================= */

export class Range {
  constructor(readonly startLine: number, readonly startCharacter: number, readonly endLine: number, readonly endCharacter: number) { }
}

export class Diagnostic {
  source?: string;
  constructor(readonly range: Range, readonly message: string, readonly severity: number) { }
}

export interface DiagnosticCollection {
  readonly name: string;
  set(uri: Uri, diagnostics: Diagnostic[]): void;
  get(uri: Uri): Diagnostic[] | undefined;
  delete(uri: Uri): void;
  clear(): void;
  dispose(): void;
}

export interface OutputChannel {
  readonly name: string;
  append(value: string): void;
  appendLine(value: string): void;
  show(): void;
  dispose(): void;
}

/* ================= 编辑器（层次树的根、模块树的跳转落点） ================= */

export interface TextDocumentLike {
  readonly uri: Uri;
  readonly fileName: string;
  getText(): string;
  positionAt(offset: number): { line: number; character: number };
}

/** 扩展源码里的 `vscode.TextDocument`（桩里与 TextDocumentLike 同一颗） */
export type TextDocument = TextDocumentLike;

export interface TextEditorLike {
  readonly document: TextDocumentLike;
  readonly viewColumn?: number;
  /** dispatch.jumpToSource 会写它（真宿主是 Selection；桩里只当值收着） */
  selection?: unknown;
  revealRange(range: Range, revealType?: number): void;
}

/* ================= Custom Editor（片 5：.djs 电路文档） ================= */

export interface CancellationToken { readonly isCancellationRequested: boolean }
export const CancellationToken = { None: { isCancellationRequested: false } as CancellationToken };

export interface CustomDocument {
  readonly uri: Uri;
  dispose(): void;
}

export interface CustomDocumentEditEvent<T extends CustomDocument = CustomDocument> {
  readonly document: T;
  readonly label?: string;
  undo(): void | ThenableLike<void>;
  redo(): void | ThenableLike<void>;
}

export interface CustomDocumentBackupContext { readonly destination: Uri }
export interface CustomDocumentBackup { readonly id: string, delete(): void | ThenableLike<void> }

export interface Webview {
  options: { enableScripts?: boolean, localResourceRoots?: Uri[] };
  html: string;
  cspSource: string;
  asWebviewUri(uri: Uri): { toString(): string };
  onDidReceiveMessage(handler: (message: any) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
  postMessage(message: any): ThenableLike<boolean>;
}

export interface CustomEditorProvider<T extends CustomDocument = CustomDocument> {
  onDidChangeCustomDocument?: Event<CustomDocumentEditEvent<T>>;
  resolveCustomEditor(document: T, webviewPanel: WebviewPanel, token?: CancellationToken): void | ThenableLike<void>;
  openCustomDocument(uri: Uri, openContext?: unknown, token?: CancellationToken): T | ThenableLike<T>;
  saveCustomDocument(document: T, token?: CancellationToken): ThenableLike<void> | void;
  saveCustomDocumentAs(document: T, destination: Uri, token?: CancellationToken): ThenableLike<void> | void;
  revertCustomDocument(document: T, token?: CancellationToken): ThenableLike<void> | void;
  backupCustomDocument(document: T, context: CustomDocumentBackupContext, token?: CancellationToken): ThenableLike<CustomDocumentBackup> | CustomDocumentBackup;
}

/** 资源管理器双击 `.djs` 时活动 Tab 的形状（compilePanel 退路用的那颗判别） */
export class TabInputText {
  constructor(readonly uri: Uri, readonly viewId?: string) { }
}

export class Selection {
  constructor(readonly anchorLine: number, readonly anchorCharacter: number, readonly activeLine: number, readonly activeCharacter: number) { }
}

export interface FakePanel {
  viewType: string; title: string; html: string; disposed: boolean; revealCount: number;
  roots: Uri[]; messageLog: any[]; fired: Array<(m: any) => void>;
  webview: {
    cspSource: string; asWebviewUri: (u: Uri) => string; html: string;
    onDidReceiveMessage: (fn: (m: any) => void) => { dispose: () => void };
    postMessage: (m: any) => ThenableLike<boolean>;
  };
  onDidDispose: (fn: () => void) => { dispose: () => void };
  reveal: () => void; dispose: () => void;
}

/** 桩自己的类型面（`extension.ts` 里那些 `vscode.X` 标注要靠它过 tsc；成员只列我们用到的那些） */
export interface Disposable { dispose(): any }
export interface ExtensionContext {
  subscriptions: Array<Disposable>;
  extensionUri: Uri;
  globalStorageUri: Uri;
  extensionMode: number;
}
export interface WebviewPanel {
  readonly webview: {
    options: { enableScripts?: boolean, localResourceRoots?: Uri[] };
    html: string;
    cspSource: string;
    asWebviewUri(uri: Uri): { toString(): string };
    onDidReceiveMessage(handler: (message: any) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
    postMessage(message: any): ThenableLike<boolean>;
  };
  readonly viewType: string;
  title: string;
  readonly viewColumn: number;
  reveal(viewColumn?: number, preserveFocus?: boolean): void;
  onDidDispose(listener: () => void, thisArgs?: any, disposables?: Disposable[]): Disposable;
  dispose(): void;
}
/** 窗口重启恢复面板那一档（真宿主同名）：**这颗接口是⛔ 省的一半**——
 *  写成 `_serializer: any` 时 `deserializeWebviewPanel(panel)` 的参数就没上下文类型，
 *  根 tsc 在 strict 下当场报 TS7006（这颗桩⛔ 让被测文件变红，红得⛔ 是它自己的错）。 */
export interface WebviewPanelSerializer {
  deserializeWebviewPanel(webviewPanel: WebviewPanel, state?: any): Promise<void> | ThenableLike<void>;
}

/** 流水账字段（真宿主没这些，测试靠它们看"到底发生了什么"）——用交叉类型接上 */
export type PanelWithLedger = WebviewPanel & FakePanel;

/** TreeDataProvider 的流水账形状：**独立类型**（⛔ 与 TreeDataProvider 交叉——那边 getChildren 可选，
 *  交叉回来返回值并进 undefined，测试侧全变"possibly null"；侧边栏三棵树都实现完整，按这个事实收窄） */
export type TreeProviderLike = {
  onDidChangeTreeData?: Event<any>;
  getTreeItem(el: any): any;
  getChildren(el?: any): Promise<any[]> | any[];
};

/** 一次测试里的"这台机器"：内存盘 + 面板/消息/对话框/树/诊断的流水账 */
export interface FakeMachine {
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
  treeViews: Array<{ id: string; showCollapseAll: boolean }>;
  workspaceFolders: Array<{ uri: Uri, name: string, index: number }> | undefined;
  appRoot: string;
  panels: Array<PanelWithLedger>;
  infoMessages: string[];
  errorMessages: string[];
  clipboard: string;
  commands: Map<string, (...a: any[]) => any>;
  serializerViewTypes: string[];
  /** ⛔ 给就当作"用户按了取消"（`saveExportFile` 那一档必须回 false，⛔ 报错） */
  saveDialogResult: Uri | undefined;
  /** R144：showOpenDialog（导入文件）的预设答案（undefined/[]＝取消） */
  openDialogResult: Uri[] | undefined;
  /** 片 4：侧边栏三板块的注册流水账（id → provider） */
  treeProviders: Record<string, TreeProviderLike>;
  /** R147：registerWebviewViewProvider 的流水账（viewId → {provider, view}，测试拿 view 判装载/发消息） */
  webviewViews: Record<string, { provider: any; view: any }>;
  /** 片 4：createFileSystemWatcher 的流水账（测试拿它 fire 增删改） */
  watchers: FakeWatcher[];
  /** 片 4：DiagnosticCollection 的落盘（uri.path → 那一组诊断；collection 全局只有一颗） */
  diagnostics: Map<string, Diagnostic[]>;
  /** 片 4：OutputChannel 的落盘（append 的累计文本） */
  outputText: string;
  /** 片 4：showTextDocument 的流水账（层次树/模块树点击跳转判据） */
  editors: TextEditorLike[];
  /** R150：executeCommand('vscode.openWith') 流水账（左键开画布判据） */
  openWithCalls: string[][];
  /** 片 4：活动编辑器（层次树的根跟随它；测试直接赋值） */
  activeEditor: TextEditorLike | undefined;
  /** 片 4：两颗变化事件的监听器流水账（测试 fire 用） */
  workspaceFolderListeners: Array<(e: any) => void>;
  activeEditorListeners: Array<(e: any) => void>;
  /** 片 5：配置仓库（键＝`section.key` 全名；getConfiguration().get 读这里） */
  configValues: Record<string, unknown>;
  /** 片 5：onDidChangeConfiguration 的监听器流水账（update() 会 fire 一颗 affectsConfiguration=>true） */
  configListeners: Array<(e: any) => void>;
  /** 片 5：onDidSaveTextDocument 的监听器流水账 */
  saveListeners: Array<(doc: TextDocumentLike) => void>;
  /** 片 5：registerCustomEditorProvider 的流水账（viewType → provider + 注册选项） */
  customEditorProviders: Record<string, { provider: CustomEditorProvider<any>, options: any }>;
  /** 片 5：showQuickPick / showInputBox 的预设答案（undefined＝用户取消）。
   *  ⚠ 多级 QuickPick（bindParts：选实例 → 选部件）用 **队列**：shift 逐个消费，空了回落 quickPickResult */
  quickPickResult: any;
  quickPickQueue: any[];
  inputBoxResult: string | undefined;
  /** 片 5-B：showWarningMessage 模态确认的预设答案（undefined＝关掉） */
    /** 模态确认（showWarningMessage）的预设答案：非模态用法（audit 的三钮）也从这颗拿；undefined＝关掉 */
  modalChoice: string | undefined;
  /** R146：showWarningMessage 的流水账（audit 提示语的判据面） */
  warnMessages: string[];
  /** 片 5：活动 Tab（compilePanel 的退路判别用） */
  activeTab: { input: any } | undefined;
}

export const state: FakeMachine = {
  files: new Map(), dirs: new Set(), treeViews: [], workspaceFolders: undefined, appRoot: '', panels: [],
  infoMessages: [], errorMessages: [], clipboard: '', commands: new Map(),
  serializerViewTypes: [], saveDialogResult: undefined, openDialogResult: undefined,
  treeProviders: {}, webviewViews: {}, watchers: [], diagnostics: new Map(), outputText: '',
  editors: [], openWithCalls: [], activeEditor: undefined, workspaceFolderListeners: [], activeEditorListeners: [],
  configValues: {}, configListeners: [], saveListeners: [], customEditorProviders: {},
  quickPickResult: undefined, quickPickQueue: [], inputBoxResult: undefined, modalChoice: undefined, warnMessages: [], activeTab: undefined,
};

export function resetMachine(patch: Partial<FakeMachine> = {}) {
  state.files = new Map();
  state.dirs = new Set('/');
  state.treeViews = [];
  state.workspaceFolders = undefined;
  state.appRoot = 'D:\\vv-studio\\vscode';
  state.panels = [];
  state.infoMessages = [];
  state.errorMessages = [];
  state.clipboard = '';
  state.commands = new Map();
  state.serializerViewTypes = [];
  state.saveDialogResult = undefined;
  state.openDialogResult = undefined;
  state.treeProviders = {};
  state.webviewViews = {};
  state.watchers = [];
  state.diagnostics = new Map();
  state.outputText = '';
  state.editors = [];
  state.openWithCalls = [];
  state.activeEditor = undefined;
  state.workspaceFolderListeners = [];
  state.activeEditorListeners = [];
  state.configValues = {};
  state.configListeners = [];
  state.saveListeners = [];
  state.customEditorProviders = {};
  state.quickPickResult = undefined;
  state.quickPickQueue = [];
  state.inputBoxResult = undefined;
  state.modalChoice = undefined;
  state.warnMessages = [];
  state.activeTab = undefined;
  Object.assign(state, patch);
}

  const key = (u: Uri) => foldRel(u.path.toLowerCase().replace(/\/+$/, ''));

/** 写盘时把父目录全登记上（真宿主的 createDirectory 是递归的；ProjectStore 也自己补，两处都对才长得起来） */
function markParents(k: string) {
  let p = k.replace(/\/[^/]+$/, '');
  while (p && !state.dirs.has(p)) { state.dirs.add(p); p = p.replace(/\/[^/]+$/, ''); }
}

export const workspace = {
  get workspaceFolders() { return state.workspaceFolders; },
  /** 每一颗都回 Thenable；失败走 rejection 通道（⛔ 回 `{ error }` 那种假形状） */
  fs: {
    readFile: (u: Uri): ThenableLike<Uint8Array> => {
      const k = key(u);
      return state.files.has(k) ? settled(state.files.get(k)!) : failed(new Error(`ENOENT ${u.path}`));
    },
    writeFile: (u: Uri, d: Uint8Array): ThenableLike<void> => {
      state.files.set(key(u), d); markParents(key(u));
      return settled(undefined);
    },
    createDirectory: (u: Uri): ThenableLike<void> => { state.dirs.add(key(u)); return settled(undefined); },
    delete: (u: Uri, o?: { recursive?: boolean, useTrash?: boolean }): ThenableLike<void> => {
      const k = key(u);
      if (state.files.has(k)) state.files.delete(k);
      if (o?.recursive) for (const f of [...state.files.keys()]) if (f.startsWith(`${k}/`)) state.files.delete(f);
      for (const d of [...state.dirs]) if (d === k || d.startsWith(`${k}/`)) state.dirs.delete(d);
      return settled(undefined);
    },
    rename: (from: Uri, to: Uri, _o?: { overwrite?: boolean }): ThenableLike<void> => {
      const f = key(from), t = key(to);
      if (state.files.has(f)) { state.files.set(t, state.files.get(f)!); state.files.delete(f); }
      else for (const k of [...state.files.keys()]) if (k === f || k.startsWith(`${f}/`)) { state.files.set(t + k.slice(f.length), state.files.get(k)!); state.files.delete(k); }
      return settled(undefined);
    },
    /** ⚠ copy＝**复制不删源**（真宿主语义）；上一版这里删了源——那是 rename 的形状混进来的 */
    copy: (from: Uri, to: Uri, _o?: { overwrite?: boolean }): ThenableLike<void> => {
      const f = key(from), t = key(to);
      if (state.files.has(f)) state.files.set(t, state.files.get(f)!);
      else for (const k of [...state.files.keys()]) if (k === f || k.startsWith(`${f}/`)) state.files.set(t + k.slice(f.length), state.files.get(k)!);
      for (const d of [...state.dirs]) if (d === f || d.startsWith(`${f}/`)) { const nd = t + d.slice(f.length); state.dirs.add(nd); markParents(nd); }
      return settled(undefined);
    },
    stat: (u: Uri): ThenableLike<{ type: number, size: number, mtime: number }> => {
      const k = key(u);
      if (state.files.has(k)) return settled({ type: FileType.File, size: state.files.get(k)!.length, mtime: 1700000000000 });
      if (state.dirs.has(k) || k === '') return settled({ type: FileType.Directory, size: 0, mtime: 0 });
      return failed(new Error(`ENOENT ${u.path}`));
    },
    readDirectory: (u: Uri): ThenableLike<Array<[string, number]>> => {
      const k = key(u), prefix = k ? `${k}/` : '';
      const out: Array<[string, number]> = [];
      for (const f of state.files.keys()) if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) out.push([f.slice(prefix.length), FileType.File]);
      for (const d of state.dirs) {
        if (!d.startsWith(prefix) || d === k) continue;
        const rest = d.slice(prefix.length);
        if (rest && !rest.includes('/')) out.push([rest, FileType.Directory]);
      }
      return settled(out);
    },
  },
  /** 土 glob：后缀匹配 + 排除 node_modules（树的数据源形状：星星斜杠星点v、星星斜杠星点花括号v,sv 这两种，够判） */
  findFiles: (include: string, exclude?: string): ThenableLike<Uri[]> => {
    const m = /^\*\*\/\*\.\{?([A-Za-z0-9,]+)\}?$/.exec(include);
    const exts = m ? m[1].split(',').map((e) => '.' + e) : [];
    const skip = exclude ? exclude.replace(/\*\*\//g, '').replace(/\*\*/g, '') : '';
    const out: Uri[] = [];
    for (const k of state.files.keys()) {
      if (!exts.some((e) => k.toLowerCase().endsWith(e))) continue;
      if (skip && k.includes(skip)) continue;
      out.push(Uri.file(k.slice(1)));                       // 键是 `/d:/...`，还原成可 `Uri.file` 的 `d:/...`
    }
    return settled(out);
  },
  /** 监听器收进流水账（`state.watchers`），测试拿 `fireCreate/fireChange/fireDelete` 触发 */
  createFileSystemWatcher: (glob: string): FileSystemWatcher => {
    const created = new EventEmitter<Uri>();
    const changed = new EventEmitter<Uri>();
    const deleted = new EventEmitter<Uri>();
    state.watchers.push({
      glob,
      fireCreate: (u) => created.fire(u),
      fireChange: (u) => changed.fire(u),
      fireDelete: (u) => deleted.fire(u),
    });
    return {
      onDidCreate: created.event,
      onDidChange: changed.event,
      onDidDelete: deleted.event,
      dispose: () => { created.dispose(); changed.dispose(); deleted.dispose(); },
    };
  },
  onDidChangeWorkspaceFolders: (fn: (e: any) => any): Disposable => {
    state.workspaceFolderListeners.push(fn);
    return { dispose: () => { state.workspaceFolderListeners = state.workspaceFolderListeners.filter((f) => f !== fn); } };
  },
  openTextDocument: (u: Uri): ThenableLike<TextDocumentLike> => {
    const doc = makeDoc(u);
    return doc ? settled(doc) : failed(new Error(`ENOENT ${u.path}`));
  },
  /** 配置仓库：键＝`section.key` 全名；update() 存进去并 fire 一颗 affectsConfiguration=>true */
  getConfiguration: (section?: string) => ({
    get: <T>(key: string): T | undefined => state.configValues[`${section ?? ''}.${key}`] as T | undefined,
    update: async (key: string, value: unknown) => {
      state.configValues[`${section ?? ''}.${key}`] = value;
      for (const fn of [...state.configListeners]) fn({ affectsConfiguration: () => true });
    },
  }),
  onDidChangeConfiguration: (fn: (e: any) => any): Disposable => {
    state.configListeners.push(fn);
    return { dispose: () => { state.configListeners = state.configListeners.filter((f) => f !== fn); } };
  },
  onDidSaveTextDocument: (fn: (doc: TextDocumentLike) => any): Disposable => {
    state.saveListeners.push(fn);
    return { dispose: () => { state.saveListeners = state.saveListeners.filter((f) => f !== fn); } };
  },
};

/** 放一份文本进内存盘（测试的 Arrange） */
export function seedText(absPath: string, text: string) { workspace.fs.writeFile(Uri.file(absPath), new TextEncoder().encode(text)); }

/** 内存盘里那份文本 → 文档形状（openTextDocument / showTextDocument(Uri) 共用） */
function makeDoc(u: Uri): TextDocumentLike | null {
  const f = state.files.get(key(u));
  if (!f) return null;
  const text = new TextDecoder().decode(f);
  return {
    uri: u, fileName: u.fsPath,
    getText: () => text,
    positionAt: (offset: number) => {
      const before = text.slice(0, offset);
      return { line: before.split('\n').length - 1, character: 0 };
    },
  };
}

function pushEditor(doc: TextDocumentLike): ThenableLike<TextEditorLike> {
  const editor: TextEditorLike = {
    document: doc, viewColumn: 1,
    revealRange: (range) => { (editor as any).revealed = [...((editor as any).revealed ?? []), range]; },
  };
  state.editors.push(editor);
  return settled(editor);
}

export const window = {
  get activeTextEditor() { return state.activeEditor; },
  createWebviewPanel(viewType: string, title: string, _opts: any, wvOpts: any): PanelWithLedger {
    const panel: any = {
      viewType, title, html: '', disposed: false, revealCount: 0,
      roots: (wvOpts?.localResourceRoots ?? []) as Uri[], messageLog: [] as any[], fired: [] as Array<(m: any) => void>,
      webview: {
        options: {},
        cspSource: 'vscode-webview://fake',
        asWebviewUri: (u: Uri) => `vscode-webview://fake${u.path}`,
        onDidReceiveMessage: (fn: (m: any) => void) => { panel.fired.push(fn); return { dispose() { } }; },
        postMessage: (m: any) => { panel.messageLog.push(m); return settled(true); },
        get html() { return panel.html; },
        set html(v: string) { panel.html = v; },
      },
      onDidDispose: (fn: () => void) => { panel.disposeFn = fn; return { dispose() { } }; },
      reveal() { panel.revealCount++; },
      dispose() { panel.disposed = true; panel.disposeFn?.(); },
      viewColumn: 1,
    };
    state.panels.push(panel);
    return panel as PanelWithLedger;
  },
  registerWebviewPanelSerializer(viewType: string, _serializer: WebviewPanelSerializer) {
    state.serializerViewTypes.push(viewType);
    return { dispose() { } };
  },
  /** 片 4：三板块的注册流水账（测试直接从 `state.treeProviders` 拿 provider 驱动 getChildren） */
  registerTreeDataProvider: (id: string, provider: TreeDataProvider<any>): Disposable => {
    state.treeProviders[id] = provider as unknown as TreeProviderLike;
    return { dispose() { } };
  },
  /** 树视图的**真 API**（registerTreeDataProvider 是它的缩水形）：台账记 showCollapseAll——
   *  基座 TreeViewPane 自带的「折叠全部」标题按钮就靠这颗开关点亮（⛔ 给了＝按钮永不出）。 */
  createTreeView: (viewId: string, options: { treeDataProvider: TreeDataProvider<any>; showCollapseAll?: boolean }): any => {
    state.treeViews.push({ id: viewId, showCollapseAll: !!options.showCollapseAll });
    state.treeProviders[viewId] = options.treeDataProvider as unknown as TreeProviderLike;   // 树驱动格子照旧从这取
    return { dispose() { } };
  },
  /** R147：webview view 的注册流水账——立即 resolve（台架把"视图显示"这一步压成同步，测试直接拿 view 判 html/发消息） */
  registerWebviewViewProvider: (viewId: string, provider: any, _o?: any): any => {
    const view: any = {
      viewId, name: viewId, visible: true,
      webview: {
        options: {}, html: '', _out: [] as any[], _msg: [] as Array<(m: any) => any>,
        postMessage: (m: any) => { view.webview._out.push(m); return Promise.resolve(true); },
        onDidReceiveMessage: (fn: (m: any) => any) => { view.webview._msg.push(fn); return { dispose() { } }; },
        asWebviewUri: (u: Uri) => u, cspSource: 'vscode-webview:',
      },
    };
    state.webviewViews[viewId] = { provider, view };
    provider.resolveWebviewView(view);
    return { dispose() { } };
  },
  /** 片 5：custom editor 的注册流水账（测试从 state.customEditorProviders 拿 provider 驱动全生命周期） */
  registerCustomEditorProvider: (viewType: string, provider: CustomEditorProvider<any>, options?: any): Disposable => {
    state.customEditorProviders[viewType] = { provider, options };
    return { dispose() { } };
  },
  /** 片 5：QuickPick/输入框/模态确认的预设答案（undefined＝用户取消/关闭）。
   *  R144 收紧：**队列值必须是 items 的成员**（真宿主⛔ 允许选中列表外的东西——
   *  bindParts 的部件清单按模式分家后，非成员 fixture 会假绿放过断链回归）。 */
  showQuickPick: (items: any, _o?: any): Promise<any> => {
    const queued = state.quickPickQueue.shift();
    const sel = queued !== undefined ? queued : state.quickPickResult;
    if (sel === undefined) return Promise.resolve(undefined);
    const members = new Set(((items || []) as any[]).map((it) => (typeof it === 'string' ? it : it?.label)));
    const want = typeof sel === 'string' ? sel : (sel?.label ?? sel);
    return Promise.resolve(members.has(want) ? sel : undefined);
  },
  /** 活动标签（compilePanel 的退路判别；测试直接赋 state.activeTab） */
  get tabGroups() { return { activeTabGroup: { activeTab: state.activeTab } }; },
  showTextDocument: (docOrUri: TextDocumentLike | Uri, _o?: any): ThenableLike<TextEditorLike> => {
    if (docOrUri instanceof Uri) {
      const doc = makeDoc(docOrUri);
      return doc ? pushEditor(doc) : failed(new Error(`ENOENT ${docOrUri.path}`));
    }
    return pushEditor(docOrUri);
  },
  onDidChangeActiveTextEditor: (fn: (e: any) => any): Disposable => {
    state.activeEditorListeners.push(fn);
    return { dispose: () => { state.activeEditorListeners = state.activeEditorListeners.filter((f) => f !== fn); } };
  },
  createOutputChannel: (name: string): OutputChannel => ({
    name,
    append: (v: string) => { state.outputText += v; },
    appendLine: (v: string) => { state.outputText += v + '\n'; },
    show: () => { },
    dispose: () => { },
  }),
  showSaveDialog: (_o: any): Promise<Uri | undefined> => Promise.resolve(state.saveDialogResult),
  /** R144 导入文件：state.openDialogResult 预设多选结果（undefined/空＝取消） */
  showOpenDialog: (_o?: any): Promise<Uri[] | undefined> => Promise.resolve(state.openDialogResult && state.openDialogResult.length ? state.openDialogResult : undefined),
  showInformationMessage: (m: string, ..._items: string[]) => { state.infoMessages.push(m); return Promise.resolve(undefined as any); },
  showErrorMessage: (m: string) => { state.errorMessages.push(m); return Promise.resolve(undefined as any); },
  /** 模态确认（sandboxFiles.deleteFile）：state.modalChoice 预设答案（undefined＝关掉）；R146 起顺手记流水账 */
  showWarningMessage: (m: string, _o?: any, ..._items: string[]) => { state.warnMessages.push(m); return Promise.resolve(state.modalChoice); },
  showInputBox: (_o?: any): Promise<string | undefined> => Promise.resolve(state.inputBoxResult),
};

export const languages = {
  createDiagnosticCollection: (name: string): DiagnosticCollection => ({
    name,
    set: (uri: Uri, diags: Diagnostic[]) => { state.diagnostics.set(key(uri), diags); },
    get: (uri: Uri) => state.diagnostics.get(key(uri)),
    delete: (uri: Uri) => { state.diagnostics.delete(key(uri)); },
    clear: () => { state.diagnostics.clear(); },
    dispose: () => { state.diagnostics.clear(); },
  }),
};

export const commands = {
  registerCommand: (id: string, fn: (...a: any[]) => any) => { state.commands.set(id, fn); return { dispose() { } }; },
  executeCommand: (id: string, ...a: any[]): any => {
    // 真宿主里 `revealFileInOS` 归工作台自己，桩里直接放过（扩展那侧本来就 try/catch 兜着）
    if (id === 'revealFileInOS') return Promise.resolve(undefined);
    // 同族：`vscode.openWith` 也是工作台的内置命令（按贡献表选编辑器开文件）；桩里没有编辑器选择器——
    // R150 起记流水账（行为不变，左键开画布判据可见）
    if (id === 'vscode.openWith') { state.openWithCalls.push(a.map((x) => (x && typeof x === 'object' && 'path' in x ? String((x as Uri).path) : String(x)))); return Promise.resolve(undefined); }
    const fn = state.commands.get(id);
    return fn ? fn(...a) : Promise.reject(new Error(`command not found: ${id}`));
  },
};

export const env = {
  get appRoot() { return state.appRoot; },
  clipboard: {
    writeText: (t: string) => { state.clipboard = t; return Promise.resolve(); },
    readText: () => Promise.resolve(state.clipboard),
  },
};

export const Disposable = { from: (..._d: any[]) => ({ dispose() { } }) };
