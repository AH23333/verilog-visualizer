// Verilog Visualizer — VS Code 扩展入口（R134 骨架）。
//
// 用户裁决（R134）：套壳形态 = **VS Code 扩展**——文件系统直接用壳的（.v/.djs 是
// 工作区真实文件），侧边栏移植「模块/层次结构」两板块，沙盒进 Webview 面板。
// 现有 Tauri/WebUI 冻结（UI 不再投入测试），lib 层单测（tests/unit）为迁移安全网。
import * as vscode from 'vscode';
import * as path from 'path';
import { ModuleTreeProvider, openAtModule } from './moduleTree';
import { HierarchyTreeProvider } from './hierarchyTree';
import { SandboxPanelProvider } from './sandboxPanel';
import { validateModuleInterfacesLite } from './verilogParseLite';

export function activate(context: vscode.ExtensionContext): void {
  const moduleTree = new ModuleTreeProvider();
  const hierarchyTree = new HierarchyTreeProvider();
  const sandboxPanel = new SandboxPanelProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('verilogViz.modules', moduleTree),
    vscode.window.registerTreeDataProvider('verilogViz.hierarchy', hierarchyTree),
    vscode.window.registerWebviewViewProvider(SandboxPanelProvider.viewId, sandboxPanel),

    // 文件变更 → 两棵树刷新（.v 内容/增删都影响模块与层次清单）
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.fileName.endsWith('.v')) { moduleTree.refresh(); hierarchyTree.refresh(); }
    }),
    vscode.workspace.onDidCreateFiles((e) => {
      if (e.files.some((f) => f.fsPath.endsWith('.v'))) { moduleTree.refresh(); hierarchyTree.refresh(); }
    }),
    vscode.workspace.onDidDeleteFiles((e) => {
      if (e.files.some((f) => f.fsPath.endsWith('.v'))) { moduleTree.refresh(); hierarchyTree.refresh(); }
    }),

    vscode.commands.registerCommand('verilogViz.refreshTrees', () => {
      moduleTree.refresh();
      hierarchyTree.refresh();
    }),
    vscode.commands.registerCommand('verilogViz.openAtModule', openAtModule),
    vscode.commands.registerCommand('verilogViz.openSandbox', async () => {
      await vscode.commands.executeCommand('verilogViz.sandbox.focus');
    }),

    // 编译命令（骨架期）：接口校验先行 + 明确提示 yosys 综合在 Webview 侧运行（主仓管线复用）。
    // 完整编译链复用由 webview 适配器批次接入（compileVerilog 是浏览器 JS，天然跑在 webview）。
    vscode.commands.registerCommand('verilogViz.compile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || path.extname(editor.document.fileName) !== '.v') {
        void vscode.window.showInformationMessage('打开一个 .v 文件后再编译。');
        return;
      }
      const errors = validateModuleInterfacesLite(editor.document.getText());
      if (errors.length) {
        void vscode.window.showErrorMessage(
          `接口校验未通过：${errors.length} 处错误`,
          errors[0]?.message || '',
        );
      } else {
        void vscode.window.showInformationMessage('接口校验通过。yosys 综合将在 Webview 编译器接入后运行。');
      }
    }),
  );

  // 有 .v 文件的工作区才显示视图（空目录不闪空树）——setContext 返回 Thenable，
  // 单独 await，不塞进 subscriptions（其项须可 dispose）。
  void vscode.commands.executeCommand('setContext', 'verilogViz.hasWorkspace',
    !!(vscode.workspace.workspaceFolders?.length));
}

export function deactivate(): void { /* 无常驻资源 */ }
