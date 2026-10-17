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
