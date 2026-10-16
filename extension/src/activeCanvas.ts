// 画布 webview 的"当前焦点"登记：标题栏命令（仿真控制/导出）要打进**正在看**的那颗 webview，
// 但 Panel（verilogVisualizer）与 custom editor（verilogViz.doc）是两条装载线，各自 dispose 时机不同。
// 收成一个小登记处：两条线各自 setActive/Clear，命令侧只管 push。
import * as vscode from 'vscode';

export type CanvasKind = 'panel' | 'doc';

let current: { webview: vscode.Webview, kind: CanvasKind } | undefined;

export function setActiveCanvas(webview: vscode.Webview, kind: CanvasKind): void {
  current = { webview, kind };
}

export function clearActiveCanvas(webview: vscode.Webview): void {
  if (current?.webview === webview) current = undefined;
}

/** 标题栏按钮/快捷键 → 画布内部（sim/export 等单向推；没人听就静默落空） */
export function pushToActiveCanvas(msg: unknown): Thenable<boolean> {
  return current ? current.webview.postMessage(msg) : Promise.resolve(false);
}
