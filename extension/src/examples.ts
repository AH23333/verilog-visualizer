// 示例与新建文件（片 5-A6）：ExamplesDialog/新建模板菜单随旧 UI 退役，
// 落成两颗命令——QuickPick 选示例写入工作区 examples/，输入框建 .v 模板。
import * as vscode from 'vscode';
import { projectRoot } from './dispatch';
import { ensureDirMeta } from './sandboxFiles';
import { uniqueName, sanitizeNameInput } from './naming';
import { rootRel } from './verilogDomain';
import { executeTool, CALLER_UI } from './toolRegistry';
import { VERILOG_EXAMPLES } from '../../shared/examples';

const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

/** root 相对posix路径（目录表定位用） */
// 根相对名转交一颗主人（这颗原是"截前缀"的一份：盘符大小写一漂就交半截路径）
function relOfRoot(root: vscode.Uri, uri: vscode.Uri): string { return rootRel(root, uri); }

/** QuickPick 选示例 → 写入 examples/<名> → 开文本编辑器 → 自动编译出电路 */
export async function openExamples(context: vscode.ExtensionContext, compileAndShow: (uri: vscode.Uri) => Promise<void>): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    VERILOG_EXAMPLES.map((e) => ({ label: e.title, description: e.fileName, detail: e.description, example: e })),
    { placeHolder: '选择示例电路（写入工作区 examples/ 并打开）' },
  );
  if (!picked) return;
  const root = projectRoot(context);
  const dir = vscode.Uri.joinPath(root, 'examples');
  await then(vscode.workspace.fs.createDirectory(dir));
  const name = await uniqueName(dir, picked.example.fileName);
  const uri = vscode.Uri.joinPath(dir, ...name.split('/'));
  await then(vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(picked.example.source)));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  await compileAndShow(uri);
}

/** fs.createFile(kind=sandbox) 的 headless 机械体：消毒+ (n) 去重+空画布落盘+「目录有部件就有表」。返回终 uri。 */
export async function createSandboxFile(context: vscode.ExtensionContext, dirUri: vscode.Uri, rawName: string): Promise<vscode.Uri> {
  const cleaned = sanitizeNameInput(rawName);
  if (!cleaned) throw new Error('沙盒电路名为空（消毒后无有效段）');
  const name = /\.djs$/i.test(cleaned) ? cleaned : `${cleaned}.djs`;
  const root = projectRoot(context);
  const finalName = await uniqueName(dirUri, name);       // (n) 去重对**目标目录**判定
  const uri = vscode.Uri.joinPath(dirUri, ...finalName.split('/'));
  await then(vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('{"cells":[]}')));
  await ensureDirMeta(context, relOfRoot(root, vscode.Uri.joinPath(uri, '..')));   // 新电路即部件 ⇒「目录有部件就有表」
  return uri;
}

/** fs.createFile(kind=verilog) 的 headless 机械体：消毒+ (n) 去重+子目录创建+最小模板。返回终 uri。 */
export async function createVerilogFile(_context: vscode.ExtensionContext, dirUri: vscode.Uri, rawName: string): Promise<vscode.Uri> {
  const cleaned = sanitizeNameInput(rawName);
  if (!cleaned) throw new Error('Verilog 文件名为空（消毒后无有效段）');
  const name = /\.v$/i.test(cleaned) ? cleaned : `${cleaned}.v`;
  const stem = name.replace(/\.v$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  if (name.includes('/')) {
    await then(vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dirUri, ...name.slice(0, name.lastIndexOf('/')).split('/'))));
  }
  const finalName = await uniqueName(dirUri, name);
  const uri = vscode.Uri.joinPath(dirUri, ...finalName.split('/'));
  const template = `module ${stem.replace(/^.*\//, '')} (\n    // input  a,\n    // output y\n);\n\nendmodule\n`;
  await then(vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(template)));
  return uri;
}

/** fs.createFolder 的 headless 机械体：消毒（可含子路径）+递归建目录。返回终目录 uri。 */
export async function createFolder(_context: vscode.ExtensionContext, dirUri: vscode.Uri, rawName: string): Promise<vscode.Uri> {
  const parts = String(rawName ?? '').replace(/\\/g, '/').split('/').map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')        // ⛔ 目录逃逸；段内非法字符消毒（与 dispatch 同款口径）
    .map((p) => p.replace(/[*?"<>|:]/g, '_'));
  if (!parts.length) throw new Error('文件夹名为空（消毒后无有效段）');
  const uri = vscode.Uri.joinPath(dirUri, ...parts);
  await then(vscode.workspace.fs.createDirectory(uri));
  return uri;
}

/** 新建沙盒电路（.djs）：输入框拿名字（自动补后缀）→ **fs.createFile 工具**落盘 → 直接进画布。
 *  dirUri（R144 目录右键「在此新建」）＝落进该目录；不给＝项目根。 */
export async function newSandboxFile(context: vscode.ExtensionContext, openDoc: (uri: vscode.Uri) => void, dirUri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  const raw = await vscode.window.showInputBox({
    prompt: '新沙盒电路名（自动补 .djs 后缀）',
    value: '电路.djs',
    placeHolder: 'adder.djs',
  });
  if (!raw) return undefined;                           // 取消＝正常下落（⛔ 报错）
  const r = await executeTool(context, CALLER_UI, 'fs.createFile', { dir: (dirUri ?? projectRoot(context)).fsPath, name: raw, kind: 'sandbox' }).catch(() => undefined) as { uri: string } | undefined;
  if (!r) return undefined;
  const uri = vscode.Uri.file(r.uri);
  openDoc(uri);                                          // 沙盒的一切编辑都在画布里：建完就开
  return uri;
}

/** 新建沙盒文件夹：输入框拿名字（可含子路径）→ **fs.createFolder 工具**递归建目录。dirUri＝建在它下面。 */
export async function newSandboxFolder(context: vscode.ExtensionContext, dirUri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  const raw = await vscode.window.showInputBox({
    prompt: '新文件夹名（可含子路径）',
    value: '新文件夹',
    placeHolder: 'parts/gates',
  });
  if (!raw) return undefined;
  const r = await executeTool(context, CALLER_UI, 'fs.createFolder', { dir: (dirUri ?? projectRoot(context)).fsPath, name: raw }).catch(() => undefined) as { uri: string } | undefined;
  return r ? vscode.Uri.file(r.uri) : undefined;
}

/** 新建 .v：输入框拿名字（自动补后缀）→ **fs.createFile 工具**落模板 → 打开编辑器。dirUri＝落进该目录（R144 目录右键）。 */
export async function newVerilogFile(context: vscode.ExtensionContext, dirUri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  const raw = await vscode.window.showInputBox({
    prompt: '新 Verilog 文件名（自动补 .v 后缀）',
    value: 'top.v',
    placeHolder: 'top.v',
  });
  if (!raw) return undefined;                           // 取消＝正常下落（⛔ 报错）
  const r = await executeTool(context, CALLER_UI, 'fs.createFile', { dir: (dirUri ?? projectRoot(context)).fsPath, name: raw, kind: 'verilog' }).catch(() => undefined) as { uri: string } | undefined;
  if (!r) return undefined;
  const uri = vscode.Uri.file(r.uri);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  return uri;
}
