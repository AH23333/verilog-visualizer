// 沙盒 Webview 面板：加载现有 React 构建（主仓 dist 的沙盒精简包），并把
// sandboxStore 的文件 API 桥接到 **VS Code 壳的文件系统**（用户裁决 R134：
// 沙盒 .djs 就是工作区 sandbox/ 目录下的真实文件，用户在资源管理器里可见可编辑）。
//
// 消息协议（webview ⇄ extension）：
//   { cmd: 'fsList',  dir }                       → { files: [{name, graphJson, updatedAt}], folders: [] }
//   { cmd: 'fsGet',   path }                      → { content }
//   { cmd: 'fsSave',  path, content }             → { ok: true }
//   { cmd: 'fsRemove', path }                     → { ok: true }
//   { cmd: 'fsRename', from, to }                 → { ok: true }
//   { cmd: 'compile', files: [{name, content}], top } → { circuitJson } | { error }
// 骨架期先落扩展侧的 fs 处理与协议常量；webview 侧适配器（VSCodeFsBackend）
// 在主仓后续批次接入（sandboxStore 换后端，API 面不变）。
import * as vscode from 'vscode';
import * as path from 'path';

const WEBVIEW_ORIGIN = 'sandboxWebview';

export class SandboxPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'verilogViz.sandbox';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    view.webview.html = this._html(view.webview);
    view.webview.onDidReceiveMessage((msg) => this._onMessage(msg, view.webview));
  }

  private _html(webview: vscode.Webview): string {
    // 生产：webview 加载主仓构建产物的沙盒入口（bundle 由主仓构建流程拷到 media/）。
    // 骨架期：占位页 + 协议自检按钮（验证 fs 桥已通——真机验收点）。
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'sandbox.js'));
    return `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline';">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px}
button{font-family:inherit}</style></head>
<body>
  <h3>沙盒 Sandbox（骨架）</h3>
  <p>Webview 文件桥协议已就绪。React 画布接入由主仓构建流程提供（media/sandbox.js）。</p>
  <button id="probe">fs 桥自检</button>
  <pre id="out"></pre>
  <script src="${scriptUri}"></script>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('probe').addEventListener('click', () => {
      vscode.postMessage({ cmd: 'fsList', dir: '' });
    });
    window.addEventListener('message', (e) => {
      document.getElementById('out').textContent = JSON.stringify(e.data, null, 2);
    });
  </script>
</body></html>`;
  }

  private async _onMessage(msg: any, webview: vscode.Webview): Promise<void> {
    try {
      switch (msg?.cmd) {
        case 'fsList': return void this._post(webview, await this._list(msg.dir || ''));
        case 'fsGet': return void this._post(webview, await this._get(msg.path));
        case 'fsSave': return void this._post(webview, await this._save(msg.path, msg.content));
        case 'fsRemove': return void this._post(webview, await this._remove(msg.path));
        case 'fsRename': return void this._post(webview, await this._rename(msg.from, msg.to));
        default: return void this._post(webview, { error: 'unknown cmd: ' + String(msg?.cmd) });
      }
    } catch (e: any) {
      this._post(webview, { error: String(e?.message || e) });
    }
  }

  private _post(webview: vscode.Webview, data: any): void {
    void webview.postMessage({ origin: WEBVIEW_ORIGIN, ...data });
  }

  private _sandboxDir(): vscode.Uri {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error('无工作区（sandbox 需要 workspace folder）');
    const rel = vscode.workspace.getConfiguration('verilogViz').get<string>('sandboxDir') || 'sandbox';
    return vscode.Uri.joinPath(root, rel);
  }

  private _safeJoin(dir: vscode.Uri, rel: string): vscode.Uri {
    const target = vscode.Uri.joinPath(dir, rel);
    if (!target.fsPath.startsWith(dir.fsPath)) throw new Error('路径越界：' + rel);
    return target;
  }

  private async _list(dir: string) {
    const base = this._sandboxDir();
    const dirUri = dir ? this._safeJoin(base, dir) : base;
    const entries = await vscode.workspace.fs.readDirectory(dirUri);
    const files: any[] = [];
    const folders: string[] = [];
    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory) { folders.push(name); continue; }
      if (!name.endsWith('.djs')) continue;
      const data = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dirUri, name));
      files.push({ name, graphJson: Buffer.from(data).toString('utf8'), updatedAt: 0 });
    }
    return { files, folders };
  }

  private async _get(rel: string) {
    const data = await vscode.workspace.fs.readFile(this._safeJoin(this._sandboxDir(), rel));
    return { content: Buffer.from(data).toString('utf8') };
  }

  private async _save(rel: string, content: string) {
    const uri = this._safeJoin(this._sandboxDir(), rel);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this._sandboxDir(), path.posix.dirname(rel).replace(/^\.$/, '')));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    return { ok: true };
  }

  private async _remove(rel: string) {
    await vscode.workspace.fs.delete(this._safeJoin(this._sandboxDir(), rel));
    return { ok: true };
  }

  private async _rename(from: string, to: string) {
    await vscode.workspace.fs.rename(this._safeJoin(this._sandboxDir(), from), this._safeJoin(this._sandboxDir(), to));
    return { ok: true };
  }
}
