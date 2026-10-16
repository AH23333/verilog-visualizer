// ============================================================================
// 协议 v0.3.1 §3/§12.5 · .vv/ 工程骨架初始化（命令 `verilogViz.initProject`）
// 幂等：已存在的文件一颗不覆（手编内容神圣）；只补缺。生成三件：
//   .vv/project.json（阶段一尾最小面：paths + bindings.defaults，maxDepth 唯一出处=8 对齐实现）
//   .vv/.gitignore（§12.5 规则表：本机/易失不提交，结构化共识提交）
// 后续阶段文件（env.json/api.grants.json/branch-B 目录）⛔ 提前创建——出现即 CONFIG_STAGE_SKIPPED 的思路，
// 在这里的等价物就是"不生成"。
// ============================================================================
import * as vscode from 'vscode';
import { projectRoot } from './dispatch';

const PROJECT_JSON = {
  schemaVersion: '0.3.1',
  kind: 'project',
  $schema: '../schemas/vv-project.schema.json',
  meta: { name: '', description: '' },
  paths: { outDir: 'build', cacheDir: '.vv/cache' },
  bindings: { defaults: { resolution: { searchOrder: ['sameFolder', 'root', 'global'], maxDepth: 8, allowSelfReference: false } } },
};
const GITIGNORE = [
  '# verilog-visualizer 本机/易失配置（CONFIG_PROTOCOL §12.5）——结构化共识保持提交',
  'env.json',
  'runtime.json',
  'cache/',
  'agent/',
  'audit/',
  '',
].join('\n');

function then<T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> {
  return new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  return then(vscode.workspace.fs.stat(uri)).then(() => true, () => false);
}

/**
 * 初始化 .vv/ 骨架。返回 { created: [...], kept: [...] }（幂等报告）。
 */
export async function initProject(context: vscode.ExtensionContext): Promise<{ created: string[]; kept: string[] }> {
  const root = projectRoot(context);
  const vv = vscode.Uri.joinPath(root, '.vv');
  const targets: Array<[vscode.Uri, string]> = [
    [vscode.Uri.joinPath(vv, 'project.json'), JSON.stringify(PROJECT_JSON, null, 2) + '\n'],
    [vscode.Uri.joinPath(vv, '.gitignore'), GITIGNORE],
  ];
  const created: string[] = []; const kept: string[] = [];
  await then(vscode.workspace.fs.createDirectory(vv)).catch(() => undefined);
  for (const [uri, text] of targets) {
    if (await exists(uri)) { kept.push(uri.path); continue; }
    await then(vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text)));
    created.push(uri.path);
  }
  return { created, kept };
}
