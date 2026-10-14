// 「层次结构 Hierarchy」板块：活动编辑器（.v）的实例树 —— 顶层实例 → 定义文件。
// 骨架版只做一层展开（实例 → 定义它的文件），与编译模式的层次钻取语义对齐；
// 深层展开（点开子文件再列其实例）为下一批。
import * as vscode from 'vscode';
import * as path from 'path';
import { parseVerilogInstances } from './verilogParseLite';

export class HierarchyTreeProvider implements vscode.TreeDataProvider<HierNode> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void { this._onDidChange.fire(); }

  getTreeItem(el: HierNode): vscode.TreeItem {
    const item = new vscode.TreeItem(el.label, el.fileUri
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);
    item.description = el.detail;
    item.contextValue = el.fileUri ? 'hierFile' : 'hierInstance';
    if (el.fileUri) {
      item.command = {
        command: 'vscode.open',
        title: '打开定义文件',
        arguments: [el.fileUri],
      };
    }
    return item;
  }

  async getChildren(el?: HierNode): Promise<HierNode[]> {
    const editor = vscode.window.activeTextEditor;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return [];
    // 顶层：活动 .v 文件的实例清单；展开实例节点 → 打开其定义文件（同工作区同名 .v）
    if (!el) {
      if (!editor || path.extname(editor.document.fileName) !== '.v') {
        return [{ label: '打开一个 .v 文件以查看层次结构', detail: '', fileUri: null }];
      }
      const instances = parseVerilogInstances(editor.document.getText());
      return instances.map((mod) => ({
        label: mod,
        detail: '模块定义',
        fileUri: findDefiningFile(root, mod),
      }));
    }
    // 实例节点展开 → 定义文件的实例（一层递归）
    if (el.fileUri) {
      const doc = await vscode.workspace.openTextDocument(el.fileUri);
      return parseVerilogInstances(doc.getText()).map((mod) => ({
        label: mod,
        detail: path.basename(el.fileUri!.fsPath),
        fileUri: findDefiningFile(root, mod),
      }));
    }
    return [];
  }
}

export interface HierNode {
  label: string;
  detail: string;
  fileUri: vscode.Uri | null;
}

/** 在工作区里找定义了该模块的 .v 文件（同名优先 → 全文搜索兜底由下一批做） */
function findDefiningFile(root: vscode.Uri, mod: string): vscode.Uri | null {
  // 骨架版：约定「模块名 = 文件名」（verilog 常见组织方式）；全文搜索兜底下一批
  return vscode.Uri.joinPath(root, mod + '.v');
}
