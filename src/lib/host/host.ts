/**
 * 宿主中立调用层。
 *
 * ── 为什么要有这一层 ──────────────────────────────────────────────
 * 电路画布（digitaljs/joint）与全部 React 渲染代码在 Tauri 与 VS Code 里跑的是同一个 Webview，
 * 换宿主⛔ 要重写它们。真正要换的只有"谁提供文件、剪贴板、保存对话框"。
 * 这些能力此前是从 4 个文件里 `invoke('...')` 直接打洞到 Rust 后端，换宿主就得一处一处改；
 * 收成**一份接口**后，宿主差异只剩这一目录里的文件差异。
 *   · `vscodeHost`   Webview 里经 `postMessage` 走 Extension Host（**当前主宿主**）
 *   · `browserHost`  浏览器（dev / 无头闸门）——**必须"抛错"而不是返回空结果**，见下
 *
 * ── Tauri 那一档已于 R138 整条拆除 ────────────────────────────────
 * `src-tauri/`（Rust 14 颗命令 / 402 行）、`tauriHost.ts`、自绘标题栏 `WindowControls.tsx`
 * 与接口上那五颗窗口控制方法一起删掉了。要找回那一版：`git revert` 到最后一笔还带着它们的提交
 * （账本卷四十三末尾记着那颗提交号），digitaljs 画布与渲染代码没动过，回退成本同样封顶。
 *
 * ── 三条不能错的形状（都是读代码/实测确认的，⛔ 猜的）────────────
 * 1. **探测必须每次现读**：`r12-export` 的 [F] 三格是在**点击前**往 window 上注入
 *    `acquireVsCodeApi` 桩，用来验证"生产路径走宿主原生另存为、⛔ `<a download>`"。
 *    模块加载期求值会把那三格变成永远测不到 vscode 分支。
 * 2. **browserHost 的文件类方法要 reject，⛔ 返回空表**：`fileStore.refresh()` 拿到
 *    空 `tree.files` 时会把 localStorage 里的文件**全过滤掉**（`files.filter(在磁盘上)`），
 *    浏览器里"磁盘"永远是空 ⇒ 空表＝抹掉用户的全部文件。
 * 3. **剪贴板失败要有 DOM 兜底**：`CodeEditor.tsx` 的形状是"先试宿主、失败退回 textarea 选中复制"。
 *    宿主层只负责"试一次"，兜底留在调用方。
 */

export type HostId = 'vscode' | 'browser';

/** 项目根里的一行文件信息（与当年 Rust `ProjectFileInfo` 同形） */
export interface ProjectFileInfo { name: string, size: number, modified: number }
/** 与当年 Rust `ProjectTree` 同形 */
export interface ProjectTree { files: ProjectFileInfo[], folders: string[] }

/** 宿主不支持某个能力时抛这一颗：调用方现有的 `.catch(console.warn)` 全部照旧生效。 */
export class HostUnsupported extends Error {
  constructor(method: string, host: HostId) {
    super(`宿主 ${host} 不支持 ${method}`);
    this.name = 'HostUnsupported';
  }
}

/**
 * 统一调用层的接口面（按"能力"分组）。
 * 所有方法都是"尽力而为"：失败要么抛 `HostUnsupported`，要么抛宿主原始错误，
 * 由调用方决定吞掉还是提示——今天各处就是吞成 `console.warn` 的。
 */
export interface ProjectHost {
  readonly id: HostId;

  /* 项目目录里的文件与文件夹（name 是相对项目根的路径，可含 '/'） */
  saveProjectFile(name: string, content: string): Promise<void>;
  listProjectTree(): Promise<ProjectTree>;
  /** 沙盒电路文件（`.djs`）那份表，⛔ 与上面那颗合并：`fileStore.refresh()` 会把 `listProjectTree`
   *  回的每一颗都当 Verilog 源码解析，`.djs` 混进去＝电路 JSON 被当模块导入。浏览器档⛔ 支持（沙盒正文住 localStorage）。 */
  listSandboxTree(): Promise<ProjectTree>;
  readProjectFile(name: string): Promise<string>;
  deleteProjectFile(name: string): Promise<void>;
  createProjectFolder(name: string): Promise<void>;
  deleteProjectFolder(name: string): Promise<void>;
  moveProjectFile(oldName: string, newName: string): Promise<void>;
  moveProjectFolder(oldName: string, newName: string): Promise<void>;
  copyProjectFile(source: string, dest: string): Promise<void>;
  copyProjectFolder(source: string, dest: string): Promise<void>;

  /* 工程级配置（与文件目录分开的单份 JSON） */
  readProjectConfig(): Promise<string>;
  saveProjectConfig(content: string): Promise<void>;

  /* "另存为"式导出：用户取消返回 false（⛔ 抛错——取消是正常下落）。
     mime 是给浏览器 `<a download>` 的 Blob 类型用的（调用方就传 image/svg+xml 等，
     ⛔ 在宿主层丢掉它——文件类型与某些浏览器的另存行为靠它）。 */
  saveExportFile(bytes: Uint8Array, defaultName: string, mime: string): Promise<boolean>;

  /* 编辑器剪贴板（跨宿主都可能有权限限制，失败就抛，调用方留 DOM 兜底） */
  clipboardWrite(text: string): Promise<void>;
  clipboardRead(): Promise<string>;
}

/** VS Code Webview 里注入的取桥函数（一个会话只允许调用一次，见 vscodeHost 的缓存） */
const vscodeBridgeMarker = (): boolean =>
  typeof window !== 'undefined' && typeof (window as any).acquireVsCodeApi === 'function';

/**
 * 当前该用哪个宿主。**每次调用现读**（见文件头形状 1）。
 * 两个实现各自惰性 import：浏览器与测试环境里不许把宿主代码强推进主包。
 */
let cached: { id: HostId, host: ProjectHost } | null = null;
export async function getHost(): Promise<ProjectHost> {
  const id: HostId = vscodeBridgeMarker() ? 'vscode' : 'browser';
  if (cached && cached.id === id) return cached.host;
  const host: ProjectHost = id === 'vscode'
    ? (await import('./vscodeHost')).vscodeHost
    : (await import('./browserHost')).browserHost;
  cached = { id, host };
  return host;
}

/** 同步版：只回答"这是什么宿主"（同样每次现读）。 */
export function hostId(): HostId {
  return vscodeBridgeMarker() ? 'vscode' : 'browser';
}

/**
 * 后台尽力而为（fire-and-forget）——这些写盘点全是这个形状：不等结果、失败 `console.warn`。
 * 收成一颗 helper 是为了让"换宿主"这件事在各文件里只剩方法名差异，
 * ⛔ 顺手改成 await/加提示（那会改 `fileStore` 的时序行为，闸门里"存盘立刻可见"那几格会变）。
 * 第一个参数原样当 warn 的前缀文本用：那些 `'Failed to ...'` 语句是有人在读的，⛔ 换措辞。
 */
export function hostFire(warnPrefix: string, run: (h: ProjectHost) => Promise<unknown>): void {
  getHost()
    .then(run)
    .catch((err) => console.warn(warnPrefix, err));
}
