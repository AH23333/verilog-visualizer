/**
 * `vscode` API 的**最小桩**，只为把 `extension/src/extension.ts` 拉进无头环境跑
 * （运行时靠 `vitest.config.ts` 的 alias，类型靠 `tsconfig.json` 的 paths——两处都⛔ 漏，
 * 漏一处就是"编辑器里 import 得到、跑起来找不到模块"那种红）。
 *
 * 为什么要有这颗桩：R139 之后每往 workbench 原生位置搬一层（片 3/4/5），改的都是
 * "宿主调用 ↔ 磁盘 ↔ webview 装载"这条链，而这条链原先**只有真开一颗 Extension Host 才看得见**
 * ⇒ 判据全被登记成"真机项"，用户的注意力成了测试台架。有了它，四件事变无头可判：
 * 项目根选哪颗、RPC 落不落对盘、webview HTML 装没装上、面板该不该自己弹。
 *
 * ⚠ 诚实的射程（**宽容度就是判据的射程**）：
 *  · `Uri` 只认 file scheme，`joinPath` 只做字符串拼接（⛔ 规范化 `..`、⛔ 处理 query/fragment）；
 *  · `workspace.fs` 是内存表，⛔ 权限、⛔ 编码猜谜（读回的就是写进去的那串字节）；
 *  · `window.createWebviewPanel` 回的是哑对象，`webview.html` 赋值**只记账、⛔ 渲染**。
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

/** 真宿主的 `Thenable` 更宽（onRejected 可选、回值可为 Thenable）；收成一种形状是为了让桩自己过 strict。
 *  ⚠ 这里的 cast 只住桩；被测代码那条通道由 `then()` 助手与它自己的判据守着。 */
type ThenableLike<T> = { then: (onOk: (v: T) => void, onErr?: (e: unknown) => void) => void };

const settled = <T>(v: T): ThenableLike<T> => ({ then: (cb) => cb(v) });
const failed = (e: unknown): ThenableLike<any> => ({ then: (_cb?, err?) => { if (err) err(e); } });

/** 路径归一：反斜杠→正斜杠、压掉重复斜杠（与真宿主的 `uri.path` 同形：`/d:/x/y`） */
const normPath = (p: string) => '/' + String(p).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');

export class Uri {
  private constructor(readonly scheme: string, readonly path: string) { }
  static file(fsPath: string): Uri { return new Uri('file', normPath(fsPath)); }
  static joinPath(base: Uri, ...segs: string[]): Uri {
    return new Uri(base.scheme, [base.path.replace(/\/+$/, ''), ...segs.map((s) => s.replace(/^\/+/, ''))].join('/'));
  }
  /** 真宿主在 Windows 上给的是反斜杠（`d:\x\y`）：`revealProjectDir` 抄进剪贴板的就是它 */
  get fsPath(): string { return this.path.replace(/^\/([a-zA-Z]:)/, '$1').replace(/\//g, '\\'); }
  toString(): string { return `${this.scheme}://${this.path.replace(/^\//, '')}`; }
  with(change: { scheme?: string, path?: string }): Uri {
    return new Uri(change.scheme ?? this.scheme, change.path ?? this.path);
  }
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


/** 一次测试里的"这台机器"：内存盘 + 面板/消息/对话框的流水账 */
export interface FakeMachine {
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
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
}

export const state: FakeMachine = {
  files: new Map(), dirs: new Set(), workspaceFolders: undefined, appRoot: '', panels: [],
  infoMessages: [], errorMessages: [], clipboard: '', commands: new Map(),
  serializerViewTypes: [], saveDialogResult: undefined,
};

export function resetMachine(patch: Partial<FakeMachine> = {}) {
  state.files = new Map();
  state.dirs = new Set(['/']);
  state.workspaceFolders = undefined;
  state.appRoot = 'D:\\vv-studio\\vscode';
  state.panels = [];
  state.infoMessages = [];
  state.errorMessages = [];
  state.clipboard = '';
  state.commands = new Map();
  state.serializerViewTypes = [];
  state.saveDialogResult = undefined;
  Object.assign(state, patch);
}

const key = (u: Uri) => u.path.toLowerCase().replace(/\/+$/, '');

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
    copy: (from: Uri, to: Uri, _o?: { overwrite?: boolean }): ThenableLike<void> => {
      const f = key(from), t = key(to);
      if (state.files.has(f)) state.files.set(t, state.files.get(f)!);
      else for (const k of [...state.files.keys()]) if (k === f || k.startsWith(`${f}/`)) state.files.set(t + k.slice(f.length), state.files.get(k)!);
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
};

/** 放一份文本进内存盘（测试的 Arrange） */
export function seedText(absPath: string, text: string) { workspace.fs.writeFile(Uri.file(absPath), new TextEncoder().encode(text)); }

export const window = {
  get activeTextEditor() { return undefined as { viewColumn: number } | undefined; },
  createWebviewPanel(viewType: string, title: string, _opts: any, wvOpts: any): PanelWithLedger {
    const panel: any = {
      viewType, title, html: '', disposed: false, revealCount: 0,
      roots: (wvOpts?.localResourceRoots ?? []) as Uri[], messageLog: [] as any[], fired: [] as Array<(m: any) => void>,
      webview: {
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
  showSaveDialog: (_o: any): Promise<Uri | undefined> => Promise.resolve(state.saveDialogResult),
  showInformationMessage: (m: string) => { state.infoMessages.push(m); return Promise.resolve(undefined as any); },
  showErrorMessage: (m: string) => { state.errorMessages.push(m); return Promise.resolve(undefined as any); },
};

export const commands = {
  registerCommand: (id: string, fn: (...a: any[]) => any) => { state.commands.set(id, fn); return { dispose() { } }; },
  executeCommand: (id: string, ...a: any[]): any => {
    // 真宿主里 `revealFileInOS` 归工作台自己，桩里直接放过（扩展那侧本来就 try/catch 兜着）
    if (id === 'revealFileInOS') return Promise.resolve(undefined);
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
