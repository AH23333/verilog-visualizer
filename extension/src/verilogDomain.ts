// ============================================================================
// 「哪些文件算编译域（Verilog 源码）、哪些算沙盒域（电路文档）」——片 C2 收到的**一颗主人**。
//
// 为什么单独立一颗：同一条规则在扩展里写过六遍，而三处答案⛔ 一致——
//  · `ProjectStore` 的两颗表 = `.v/.sv/.vh` / `.djs`（两颗原生文件树、`res.listProject` 吃它）；
//  · 模块树（trees.ts）、层次树的定义索引（trees.ts）、编译侧 `scanDefs`（compilePanel.ts）
//    各自写死 `**/*.v`；
//  · 层次树的活动编辑器门槛写死 `path.extname(...) !== '.v'`。
// 症状＝用户把模块定义写在 `.sv`/`.vh` 里：『文件』树看得见它，『模块』『层次结构』两块板
// 看不见、编译闭包也扫不到（验收表挂账 **X8** 与这一族同根）。修一行数字⛔ 够——要的是
// 只剩一处能决定这件事，将来加 `.svh` 就改 `projectStore` 那一行，六处一起跟上。
// ============================================================================
import * as vscode from 'vscode';
import * as path from 'path';
import { VERILOG_EXT, SANDBOX_EXT, extOf } from './projectStore';

/**
 * 逐扩展各扫一遍再并集。⛔ 把三颗合成一颗花括号写法的 glob：花括号方言在真宿主上本仓⛔ 验过
 * （桩吃两种形状，真宿主没跑过），而"少收一颗扩展"正是这次要修的病——宁可多两趟文件索引扫描
 * （只走文件树，⛔ 读正文；正文仍由调用方按需读）。
 */
async function findByExts(exts: string[]): Promise<vscode.Uri[]> {
  const seen = new Map<string, vscode.Uri>();
  for (const ext of exts) {
    const found = await vscode.workspace.findFiles(`**/*.${ext}`, '**/node_modules/**');
    for (const uri of found) if (!seen.has(uri.fsPath.toLowerCase())) seen.set(uri.fsPath.toLowerCase(), uri);
  }
  return [...seen.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

/**
 * Uri → 项目根相对名（'/' 分隔）。R153 深度自检新增：**根相对名只许有一份实现**。
 * 此前本仓写了七份，其中三份是"按根串长度切前缀"（`pathRel`／`examples.relOfRoot`／
 * `extension.ts` 的 `rel`）——
 * 盘符大小写一漂（`D:/p` ↔ `d:/p/lib/x.v`）就交出半截或整颗绝对路径；`path.relative`
 * 在 win32 上对盘符大小写不敏感（现读过），且根外的 Uri 会给出 `..` 开头 ⇒ 这里折回绝对路径
 * （与 `customEditors.relName` 同口径：工作区外的文档按绝对路径认，⛔ 混进相对名里）。
 */
export function rootRel(root: vscode.Uri, uri: vscode.Uri): string {
  const rel = path.relative(root.fsPath, uri.fsPath).replace(/\\/g, '/');
  return rel.startsWith('..') || path.isAbsolute(rel) ? uri.fsPath.replace(/\\/g, '/') : rel;
}

/** 编译域的全部源码文件（模块树/层次树/编译闭包扫描的唯一数据源） */
export function findVerilogUris(): Promise<vscode.Uri[]> { return findByExts(VERILOG_EXT); }

/** 沙盒域的电路文档（绑定候选、盘名裁尾等"整仓 .djs"扫描的唯一数据源） */
export function findSandboxUris(): Promise<vscode.Uri[]> { return findByExts(SANDBOX_EXT); }

/** 这条路径是不是编译域的文件（层次树的活动编辑器门槛、编译入口门槛吃它）。
 *  fsPath 带反斜杠 ⇒ 先归一分隔符再问扩展名（`extOf` 按 '/' 切末段）。 */
export function isVerilogPath(fsPath: string): boolean {
  return VERILOG_EXT.includes(extOf(String(fsPath || '').replace(/\\/g, '/')));
}

/** 这条路径是不是沙盒域的电路文档（`.djs`） */
export function isSandboxPath(fsPath: string): boolean {
  return SANDBOX_EXT.includes(extOf(String(fsPath || '').replace(/\\/g, '/')));
}

/**
 * 能不能承载绑定（三处右键门槛、保存重编译、绑定面板入口都问这一颗）。
 * ⚠ 原来是三处各写一遍 `/\.(v|sv|djs)$/i`：域界加一颗 `.vh` 就要改三遍，少改一遍＝同一个动作
 *   在三种入口上有三种答案（`.vh` 进得了树、编得动，右键却挡回来）。
 */
export function isBindablePath(fsPath: string): boolean { return isVerilogPath(fsPath) || isSandboxPath(fsPath); }

/** 合法的**绑定目标值**：可绑定文件 ∪ 旧版 `.gate` 部件档（R37 起只读，但表里的旧值⛔ 判废） */
export function isBindingTargetValue(value: string): boolean {
  return isBindablePath(value) || extOf(String(value || '').replace(/\\/g, '/')) === 'gate';
}

/**
 * 剥掉编译域扩展名：`adder.v`/`adder.sv`/`adder.vh` → `adder`；无域扩展原名返回。
 * ⚠ 这里曾经是两处手写的 `/\.sv?$/`——那颗**读反了**（`.` + `s` + 可选 `v`）：只剥得掉 `.sv`
 *   （连 `.s` 都剥），对 `.v` 原样返回。后果两处都实测过：
 *    · `compilePanel` 的 topModule 兜底名给成 `top.v`（yosys 报"找不到顶层"）；
 *    · `bindings.complete` 的同名查表键带着 `.v` ⇒ 对 `.v` 工程**一颗也撞不上**（静默零补全）。
 */
export function stripVerilogExt(name: string): string {
  const norm = String(name || '').replace(/\\/g, '/');
  const ext = extOf(norm);
  return ext && VERILOG_EXT.includes(ext) ? norm.slice(0, norm.lastIndexOf('.')) : norm;
}

/** watcher 的那一排 glob 由这一颗主人生成（extension.ts 的域 watcher ⛔ 再自己列扩展名） */
export function watcherGlobs(extra: string[] = []): string[] {
  return [...VERILOG_EXT, ...SANDBOX_EXT].map((e) => `**/*.${e}`).concat(extra);
}
