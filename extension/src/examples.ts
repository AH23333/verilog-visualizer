// 示例与新建文件（片 5-A6）：ExamplesDialog/新建模板菜单随旧 UI 退役，
// 落成两颗命令——QuickPick 选示例写入工作区 examples/，输入框建 .v 模板。
import * as vscode from 'vscode';
import { projectRoot } from './dispatch';
import { ensureDirMeta } from './sandboxFiles';
import { VERILOG_EXAMPLES } from '../../shared/examples';

const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

/** root 相对posix路径（目录表定位用） */
function relOfRoot(root: vscode.Uri, uri: vscode.Uri): string {
  const rootFs = root.fsPath.replace(/[\\/]+$/, '');
  return uri.fsPath.slice(rootFs.length + 1).replace(/\\/g, '/');
}

/** 重名自动 `(n)`（语义照抄 fileStore.getUniqueName）：stat 到＝已占用 */
async function uniqueName(dir: vscode.Uri, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let i = 2; await then(vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, candidate))).then(() => true, () => false); i++) {
    candidate = `${stem} (${i})${ext}`;
  }
  return candidate;
}

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

/** 新建沙盒电路（.djs）：输入框拿名字（自动补后缀），落一张空画布（`{"cells":[]}`，与新建沙盒同构）并直接进画布。
 *  dirUri（R144 目录右键「在此新建」）＝落进该目录；不给＝项目根。 */
export async function newSandboxFile(context: vscode.ExtensionContext, openDoc: (uri: vscode.Uri) => void, dirUri?: vscode.Uri): Promise<void> {
  const raw = await vscode.window.showInputBox({
    prompt: '新沙盒电路名（自动补 .djs 后缀）',
    value: '电路.djs',
    placeHolder: 'adder.djs',
  });
  if (!raw) return;                                     // 取消＝正常下落（⛔ 报错）
  const name = /\.djs$/i.test(raw) ? raw : `${raw}.djs`;
  const root = projectRoot(context);
  const base = dirUri ?? root;
  const finalName = await uniqueName(base, name);       // (n) 去重对**目标目录**判定
  const uri = vscode.Uri.joinPath(base, ...finalName.split('/'));
  await then(vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('{"cells":[]}')));
  await ensureDirMeta(context, relOfRoot(root, vscode.Uri.joinPath(uri, '..')));   // 新电路即部件 ⇒「目录有部件就有表」
  openDoc(uri);                                          // 沙盒的一切编辑都在画布里：建完就开
}

/** 新建沙盒文件夹：输入框拿名字（可含子路径），递归建目录（目录树里立刻可见）。dirUri＝建在它下面。 */
export async function newSandboxFolder(context: vscode.ExtensionContext, dirUri?: vscode.Uri): Promise<void> {
  const raw = await vscode.window.showInputBox({
    prompt: '新文件夹名（可含子路径）',
    value: '新文件夹',
    placeHolder: 'parts/gates',
  });
  if (!raw) return;
  const parts = raw.replace(/\\/g, '/').split('/').map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')        // ⛔ 目录逃逸；段内非法字符消毒（与 dispatch 同款口径）
    .map((p) => p.replace(/[\\/:*?"<>|]/g, '_'));
  if (!parts.length) return;
  const base = dirUri ?? projectRoot(context);
  await then(vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(base, ...parts)));
}

/** 新建 .v：输入框拿名字（自动补后缀），落一个能编译的最小模板并打开。dirUri＝落进该目录（R144 目录右键）。 */
export async function newVerilogFile(context: vscode.ExtensionContext, dirUri?: vscode.Uri): Promise<void> {
  const raw = await vscode.window.showInputBox({
    prompt: '新 Verilog 文件名（自动补 .v 后缀）',
    value: 'top.v',
    placeHolder: 'top.v',
  });
  if (!raw) return;                                     // 取消＝正常下落（⛔ 报错）
  const name = /\.v$/i.test(raw) ? raw : `${raw}.v`;
  const stem = name.replace(/\.v$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  const base = dirUri ?? projectRoot(context);
  if (name.includes('/')) {
    await then(vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(base, ...name.slice(0, name.lastIndexOf('/')).split('/'))));
  }
  const finalName = await uniqueName(base, name);
  const uri = vscode.Uri.joinPath(base, ...finalName.split('/'));
  const template = `module ${stem.replace(/^.*\//, '')} (\n    // input  a,\n    // output y\n);\n\nendmodule\n`;
  await then(vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(template)));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
}
