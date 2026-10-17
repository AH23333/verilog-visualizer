// 命名去重的唯一口径（X9 双轨合一裁决）：所有「同类名占用即顺延」的落点都从这取算法，
// 避免 duplicateFolder/examples/importFiles 各写一套 `(n)` 循环后悄悄分岔。
import * as vscode from 'vscode';

const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

const occupied = (uri: vscode.Uri) =>
  then(vscode.workspace.fs.stat(uri)).then(() => true, () => false);

/** 文件名去重：`name` → `stem (2).ext` → `stem (3).ext`……（不存在为止） */
export async function uniqueName(dir: vscode.Uri, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let i = 2; await occupied(vscode.Uri.joinPath(dir, candidate)); i++) {
    candidate = `${stem} (${i})${ext}`;
  }
  return candidate;
}

/** 文件夹名去重：`name 副本` → `name 副本 (2)`……（旧 UI「复制文件夹」的口语形态原样保留） */
export async function uniqueFolderName(dir: vscode.Uri, name: string): Promise<string> {
  let candidate = `${name} 副本`;
  for (let i = 2; await occupied(vscode.Uri.joinPath(dir, candidate)); i++) {
    candidate = `${name} 副本 (${i})`;
  }
  return candidate;
}

/**
 * 用户输入名的消毒（G7 统一口径，2026-10-17 审查补）：新建/重命名这些**输入框直连盘上路径**的落点
 * 此前只有 dispatch RPC 侧有 `sanitizeRelName`、newSandboxFolder 有内联版——renameFile 与
 * newVerilogFile/newSandboxFile 都是裸收，`../` 能把文件写到工作区外（审查缺陷 #2/#3）。
 *  - 段级：丢 `.`/`..`/空段（目录逃逸在此死掉）；Windows 非法字符 `\ / : * ? " < > |` 替成 `_`；
 *  - `single`＝重命名单段语义：`../evil` 这类输入按段过滤后只剩 `evil`（slash 视作分隔丢掉，
 *    改名进子目录是 C9「移动到」的职责，不在改名里夹带）。
 * 返回 ''＝输入被消毒干净（调用侧当取消处理）。
 */
export function sanitizeNameInput(raw: string, opts?: { single?: boolean }): string {
  let s = String(raw ?? '').replace(/\\/g, '/').trim();
  if (opts?.single) s = s.split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
  const segs = s.split('/')
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => p.replace(/[*?"<>|:]/g, '_'));
  return segs.join('/');
}
