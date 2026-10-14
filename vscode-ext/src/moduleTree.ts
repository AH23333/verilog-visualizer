// 「模块 Modules」板块：工作区全部 .v 文件 → 其定义的模块清单（TreeView）。
// 点击模块 → 打开定义文件并跳到 `module <名>` 行（与编译模式的跳转语义一致）。
import * as vscode from 'vscode';
import * as path from 'path';
import { parseVerilogModules } from './verilogParseLite';
import { relKey, readBindings } from './bindings';

export class ModuleTreeProvider implements vscode.TreeDataProvider<ModuleNode> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void { this._onDidChange.fire(); }

  getTreeItem(el: ModuleNode): vscode.TreeItem {
    const item = new vscode.TreeItem(el.label, vscode.TreeItemCollapsibleState.None);
    item.description = el.fileKey;
    item.tooltip = `模块 ${el.module} — ${el.fileKey}`;
    item.command = {
      command: 'verilogViz.openAtModule',
      title: '打开定义',
      arguments: [el],
    };
    item.contextValue = 'module';
    return item;
  }

  async getChildren(el?: ModuleNode): Promise<ModuleNode[]> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root || el) return [];
    const files = await vscode.workspace.findFiles('**/*.v', '**/node_modules/**');
    const bindings = await readBindings(root);
    const nodes: ModuleNode[] = [];
    for (const f of files.sort((a, b) => a.fsPath.localeCompare(b.fsPath))) {
      try {
        const data = await vscode.workspace.fs.readFile(f);
        const src = Buffer.from(data).toString('utf8');
        for (const mod of parseVerilogModules(src)) {
          // 绑定信息进描述：该模块被哪个文件绑定（与主仓 moduleBindings 语义对齐）
          const boundBy = Object.entries(bindings)
            .filter(([, m]) => Object.values(m).includes(mod))
            .map(([k]) => k);
          nodes.push({
            module: mod,
            label: mod,
            fileKey: relKey(root, f) + (boundBy.length ? `  ⟵ 绑定: ${boundBy.join(', ')}` : ''),
            uri: f,
          });
        }
      } catch { /* 读取失败的文件跳过，不阻塞整树 */ }
    }
    return nodes;
  }
}

export interface ModuleNode {
  module: string;
  label: string;
  fileKey: string;
  uri: vscode.Uri;
}

/** 打开模块定义文件并跳到 `module <名>` 行 */
export async function openAtModule(node: ModuleNode): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(node.uri);
  const editor = await vscode.window.showTextDocument(doc);
  const idx = doc.getText().indexOf('module ' + node.module);
  if (idx >= 0) {
    const line = doc.positionAt(idx).line;
    editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
  } else {
    void path; // 骨架期保留 import 位；未来按 fileKey 定位跨文件模块
  }
}
