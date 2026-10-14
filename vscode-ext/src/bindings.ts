// 模块绑定 sidecar（绑定系统移植到 VS Code 壳的文件系统——用户裁决 R134）：
// `verilog-viz.bindings.json`（工作区根）＝ { "<.v 文件相对路径>": { "<模块名>": "<.v 相对路径>" } }
// 与主仓 moduleBindings 语义一致：实例按模块名 → 定义文件。sidecar 是普通 JSON，
// 用户可在 VS Code 资源管理器里看到/编辑/进 git。
import * as vscode from 'vscode';
import * as path from 'path';

const SIDECAR = 'verilog-viz.bindings.json';

export type BindingMap = Record<string, Record<string, string>>;

export function sidecarUri(root: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(root, SIDECAR);
}

export async function readBindings(root: vscode.Uri): Promise<BindingMap> {
  try {
    const data = await vscode.workspace.fs.readFile(sidecarUri(root));
    return JSON.parse(Buffer.from(data).toString('utf8'));
  } catch {
    return {};
  }
}

export async function writeBindings(root: vscode.Uri, map: BindingMap): Promise<void> {
  const json = JSON.stringify(map, null, 2) + '\n';
  await vscode.workspace.fs.writeFile(sidecarUri(root), Buffer.from(json, 'utf8'));
}

/** 相对工作区根的 POSIX 风格路径（sidecar 与树节点统一用它做 key） */
export function relKey(root: vscode.Uri, uri: vscode.Uri): string {
  return path.posix.normalize(
    path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/'),
  );
}
