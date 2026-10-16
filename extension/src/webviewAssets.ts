// webview 资产装载：Panel 与 custom editor 两条线共用的"找到入口 HTML → 改写成壳能吃的"。
// 打包态在 `extension/webview/`，仓库内开发态直接用 Vite 的 `../dist/`（两处都认，⛔ 让 dev 必须打包才能跑）。
import * as vscode from 'vscode';
import { rewriteWebviewHtml } from './html';

/** webview 能读到的最大范围：只给 webview 产物与 dist 两处（⛔ 把整个 appRoot 交出去） */
export function webviewRoots(context: vscode.ExtensionContext): vscode.Uri[] {
  return [vscode.Uri.joinPath(context.extensionUri, 'webview'), vscode.Uri.joinPath(context.extensionUri, '..', 'dist')];
}

/** 在两处候选根里找指定入口（`index.html`＝编译画布，`doc.html`＝.djs custom editor） */
export async function findEntryHtml(context: vscode.ExtensionContext, entry: string): Promise<{ uri: vscode.Uri, root: vscode.Uri } | null> {
  for (const root of webviewRoots(context)) {
    const uri = vscode.Uri.joinPath(root, entry);
    try {
      await vscode.workspace.fs.stat(uri);
      return { uri, root };
    } catch { /* 换下一处候选 */ }
  }
  return null;
}

/** 读入口 HTML → CSP/nonce/资产改写（两颗宿主线共用；读不到回 null，调用方给补救话） */
export async function loadWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview, entry: string): Promise<string | null> {
  const found = await findEntryHtml(context, entry);
  if (!found) return null;
  const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(found.uri));
  const nonce = Array.from({ length: 32 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
  return rewriteWebviewHtml({
    rawHtml: raw,
    assetUri: (rel) => webview.asWebviewUri(rel ? vscode.Uri.joinPath(found.root, ...rel.split('/')) : found.root).toString(),
    cspSource: webview.cspSource,
    nonce,
  });
}
