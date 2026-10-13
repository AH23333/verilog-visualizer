/**
 * VS Code 壳（Extension Host 侧）。骨架照微软官方 sample `webview-sample`
 * （`createWebviewPanel` + `localResourceRoots` + `asWebviewUri` + `cspSource` + nonce +
 * `onDidReceiveMessage`），差别只有两处：
 *   · HTML 不自己写，而是**改写 Vite 产出的 index.html**（`./html.ts`，纯函数、有单测）；
 *   · 消息不是示例里那三颗 command，而是与 `src/lib/host/vscodeHost.ts` **一一对应的 15 个方法**
 *     （文件/配置/另存为/剪贴板），语义逐条对齐 `src-tauri/src/lib.rs`（见 `./projectStore.ts`）。
 */
import * as vscode from 'vscode';
import { rewriteWebviewHtml } from './html';
import { ProjectStore, type FsLike } from './projectStore';

const VIEW_TYPE = 'verilogVisualizer';

/** `workspace.fs` 的各方法回的是 `Thenable`（不是 Promise）⇒ 必须 await 一次再回，
 *  ⛔ 用 `as any`/`as unknown as Promise` 把类型糊过去（那会让 ProjectStore 里的 try/catch 收不到 rejection） */
const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('verilogVisualizer.open', () => openPanel(context)),
  );
  // ⛔ 让人去猜"文件落在哪"：这颗命令直接开那个目录，并把路径抄进剪贴板（真机点验第 4 格要用）
  context.subscriptions.push(
    vscode.commands.registerCommand('verilogVisualizer.revealProjectDir', async () => {
      const root = projectRoot(context);
      try { await then(vscode.workspace.fs.createDirectory(root)); } catch { /* 已存在也算成功 */ }
      try { await vscode.commands.executeCommand('revealFileInOS', root); } catch { /* 某些平台不支持 ⇒ 下面仍给路径 */ }
      await vscode.env.clipboard.writeText(root.fsPath);
      void vscode.window.showInformationMessage(`项目文件目录：${root.fsPath}（路径已复制）`);
    }),
  );
  if (vscode.window.registerWebviewPanelSerializer) {
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel) {
        currentPanel = panel;
        wirePanel(context, panel);
      },
    });
  }
}

export function deactivate() { }

function openPanel(context: vscode.ExtensionContext) {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
  if (currentPanel) { currentPanel.reveal(column); return; }
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    'Verilog Visualizer',
    { viewColumn: column, preserveFocus: false },
    {
      enableScripts: true,
      // 画布与仿真循环在后台：切到别的编辑器⛔ 停表（retainContext 一关，回来就是重新加载、电路没了）
      retainContextWhenHidden: true,
      localResourceRoots: webviewRoots(context),
    },
  );
  currentPanel = panel;
  wirePanel(context, panel);
}

/** 打包态在 `extension/webview/`，仓库内开发态直接用 Vite 的 `../dist/`（两处都认，⛔ 让 dev 必须打包才能跑） */
function webviewRoots(context: vscode.ExtensionContext): vscode.Uri[] {
  return [vscode.Uri.joinPath(context.extensionUri, 'webview'), vscode.Uri.joinPath(context.extensionUri, '..', 'dist')];
}

async function findIndexHtml(context: vscode.ExtensionContext): Promise<{ uri: vscode.Uri, root: vscode.Uri } | null> {
  for (const root of webviewRoots(context)) {
    const uri = vscode.Uri.joinPath(root, 'index.html');
    try {
      await vscode.workspace.fs.stat(uri);
      return { uri, root };
    } catch { /* 换下一处候选 */ }
  }
  return null;
}

/**
 * 项目根：`context.globalStorageUri/project_files`，与 Tauri 的
 * `app_data_dir()/project_files` 一一对应（⛔ 用 workspace 文件夹——那会让"打开哪个工程"
 * 决定文件可见性，而现有实现的工程集合是与工作区无关的单一目录）。
 */
function projectRoot(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, 'project_files');
}

/** `workspace.fs` → 我们的 `FsLike`（字符串路径以 `@root` 打头，落回 Uri） */
function vscodeFs(rootUri: vscode.Uri): FsLike {
  const toUri = (abs: string) => {
    const rel = abs.startsWith('@root') ? abs.slice('@root'.length).replace(/^\/+/, '') : abs;
    return rel ? vscode.Uri.joinPath(rootUri, ...rel.split('/')) : rootUri;
  };
  // Thenable → Promise 的转换统一用文件顶那把 `then`（⛔ 在这里再写一份）
  return {
    readFile: (p) => then(vscode.workspace.fs.readFile(toUri(p))),
    writeFile: async (p, d) => { await then(vscode.workspace.fs.writeFile(toUri(p), d)); },
    createDir: async (p) => { await then(vscode.workspace.fs.createDirectory(toUri(p))); },
    remove: async (p, recursive) => { await then(vscode.workspace.fs.delete(toUri(p), { recursive, useTrash: false })); },
    rename: async (from, to) => { await then(vscode.workspace.fs.rename(toUri(from), toUri(to), { overwrite: false })); },
    copy: async (from, to) => { await then(vscode.workspace.fs.copy(toUri(from), toUri(to), { overwrite: true })); },
    stat: async (p) => {
      try {
        const s = await vscode.workspace.fs.stat(toUri(p));
        return { type: s.type === vscode.FileType.Directory ? 'dir' : 'file', size: s.size, mtimeMs: s.mtime };
      } catch { return null; }
    },
    readDir: async (p) => {
      try {
        const entries = await vscode.workspace.fs.readDirectory(toUri(p));
        return entries.map(([name, type]) => ({ name, type: type === vscode.FileType.Directory ? 'dir' as const : 'file' as const }));
      } catch { return []; }
    },
  };
}

function wirePanel(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
  const webview = panel.webview;

  // 释放登记**必须两条装载路都做**（新开 = openPanel，窗口重启 = serializer）。
  // 只挂在 openPanel 上时：重启恢复出面板 → 关掉 → `currentPanel` 还指着那颗已释放的
  // ⇒ 再按命令走 `reveal()` = "点了没反应"。加 `=== panel` 守卫：旧面板的 dispose ⛔ 抹掉新面板的登记。
  panel.onDidDispose(() => { if (currentPanel === panel) currentPanel = undefined; }, null, context.subscriptions);

  (async () => {
    const found = await findIndexHtml(context);
    if (!found) {
      panel.webview.html = `<!DOCTYPE html><html lang="zh-CN"><body style="font-family:var(--vscode-font-family);padding:2em">
        找不到前端构建产物。<br><br>
        先跑 <code>pnpm build</code>（产出 <code>dist/</code>），开发态即可直接打开；
        打包分发时再跑 <code>pnpm webview:sync</code> 把产物复制进 <code>extension/webview/</code>。
      </body></html>`;
      return;
    }
    const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(found.uri));
    const nonce = Array.from({ length: 32 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
    panel.webview.html = rewriteWebviewHtml({
      rawHtml: raw,
      assetUri: (rel) => webview.asWebviewUri(rel ? vscode.Uri.joinPath(found.root, ...rel.split('/')) : found.root).toString(),
      cspSource: webview.cspSource,
      nonce,
    });
  })().catch((e) => void vscode.window.showErrorMessage(`打不开 Verilog 可视化窗口：${String(e instanceof Error ? e.message : e)}`));

  panel.webview.onDidReceiveMessage(async (msg: any) => {
    if (!msg || msg.vvh !== 'req' || typeof msg.id !== 'string') return;
    const reply = (ok: boolean, data?: unknown, error?: string) =>
      void webview.postMessage({ vvh: 'res', id: msg.id, ok, data, error });
    try {
      reply(true, await dispatch(context, msg.method, msg.args || {}));
    } catch (e) {
      reply(false, undefined, String(e instanceof Error ? e.message : e));
    }
  }, null, context.subscriptions);
}

async function dispatch(context: vscode.ExtensionContext, method: string, args: any): Promise<unknown> {
  const store = new ProjectStore(vscodeFs(projectRoot(context)), '@root');
  switch (method) {
    case 'saveProjectFile': return store.saveFile(args.name, args.content);
    case 'listProjectTree': return store.listTree();
    case 'readProjectFile': return store.readFile(args.name);
    case 'deleteProjectFile': return store.deleteFile(args.name);
    case 'createProjectFolder': return store.createFolder(args.name);
    case 'deleteProjectFolder': return store.deleteFolder(args.name);
    case 'moveProjectFile': return store.moveFile(args.oldName, args.newName);
    case 'moveProjectFolder': return store.moveFolder(args.oldName, args.newName);
    case 'copyProjectFile': return store.copyFile(args.source, args.dest);
    case 'copyProjectFolder': return store.copyFolder(args.source, args.dest);
    case 'readProjectConfig': return store.readConfig();
    case 'saveProjectConfig': return store.saveConfig(args.content);

    case 'saveExportFile': {
      // 与 Rust 那颗同语义：取消＝返回 false（⛔ 报错，前端把 false 显示成"导出已取消"）
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(
          vscode.workspace.workspaceFolders?.[0]?.uri ?? projectRoot(context), args.defaultName),
        filters: filtersFor(args.defaultName),
      });
      if (!target) return false;
      const bytes = Uint8Array.from(Buffer.from(String(args.base64 || ''), 'base64'));
      await vscode.workspace.fs.writeFile(target, bytes);
      return true;
    }
    case 'clipboardWrite': return vscode.env.clipboard.writeText(String(args.text ?? ''));
    case 'clipboardRead': return vscode.env.clipboard.readText();

    default: throw new Error(`Extension Host 不认识的调用：${method}`);
  }
}

/** 按后缀给对话框配过滤器（Tauri 侧同一件事是按 defaultName 后缀做的） */
function filtersFor(name: string): Record<string, string[]> | undefined {
  const ext = String(name).split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  const map: Record<string, string> = { svg: 'SVG 图片', json: 'JSON', v: 'Verilog', djs: 'Verilog 电路文档' };
  return { [map[ext] || ext.toUpperCase()]: [ext] };
}
