// ============================================================================
// 统一调用层·文件系统工具族（批次一，2026-10-17）：把刚 stabilized 的文件系统机械体
// 以 headless handler 形态上账。对话框/编辑器打开等 UI 归命令层（shell），工具层⛔ 弹 UI
// （唯一例外：requiresApproval 的 HITL 弹窗在 executeTool，非交互调用方才见）。
// registry（本文件：title/description/schema/handler）与契约 JSON（perm/sideEffects/surfaces/
// ref/requiresApproval）一一对齐——apiDoc.test 钉死孤儿，docs/API_REFERENCE.md 生成防漂移。
// ============================================================================
import * as vscode from 'vscode';
import { registerTool, argUri } from './toolRegistry';
import { broadcastBindingsChanged, projectRoot } from './dispatch';
import {
  moveToFile, renameEntry, deleteEntry, importFromUris, duplicateFile, duplicateFolder,
} from './sandboxFiles';
import { createVerilogFile, createSandboxFile, createFolder } from './examples';

let registered = false;

const uriOut = (u: vscode.Uri): { uri: string } => ({ uri: u.fsPath.replace(/\\/g, '/') });

/** 上账入口（activate 调一次；重复调用幂等跳过）。 */
export function registerFilesystemTools(): void {
  if (registered) return;
  registered = true;

  registerTool({
    id: 'fs.rename', title: '重命名', description: '重命名文件或目录；绑定值/`宿主::`前缀键/根表 circuits 随迁（G1）。输入经单段消毒（`../` 无法逃出工作区）。名字无效/与现名相同/目标被占用 ⇒ 报错（⛔ 静默 ok:false）。',
    schema: { type: 'object', properties: { uri: { type: 'string', description: '目标文件/目录（fsPath 或 file: uri）' }, newName: { type: 'string', description: '新名字（单段）' } }, required: ['uri', 'newName'] },
    handler: async (ctx, a) => {
      const ok = await renameEntry(ctx, argUri(a.uri), String(a.newName ?? ''));
      if (!ok) throw new Error('重命名未执行：名字无效（消毒后为空/与现名相同）或目标被占用（详情见错误告示）');
      broadcastBindingsChanged();
      return { ok: true };
    },
  });

  registerTool({
    id: 'fs.move', title: '移动', description: '移动文件/目录到目标目录；(n) 去重、自环拒、原地 no-op；绑定记录随迁（G1）。',
    schema: { type: 'object', properties: { src: { type: 'string', description: '源文件/目录' }, destDir: { type: 'string', description: '目标目录' } }, required: ['src', 'destDir'] },
    handler: async (ctx, a) => {
      const target = await moveToFile(ctx, argUri(a.src), argUri(a.destDir));
      if (!target) throw new Error('移动失败（目标占用/自环/原地）；详情见错误告示');
      broadcastBindingsChanged();
      return uriOut(target);
    },
  });

  registerTool({
    id: 'fs.delete', title: '删除', description: '删除文件/目录（进回收站）；指向被删内容的绑定/电路名单随清（G1 双路）。requiresApproval：非交互调用方（agent）须 HITL 批准。',
    schema: { type: 'object', properties: { uri: { type: 'string', description: '待删除的文件/目录' } }, required: ['uri'] },
    handler: async (ctx, a) => {
      await deleteEntry(ctx, argUri(a.uri));
      broadcastBindingsChanged();
      return { ok: true };
    },
  });

  registerTool({
    id: 'fs.duplicateFile', title: '创建文件副本', description: '同目录 (n) 序号复制；副本角色不随（默认 circuit）。',
    schema: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] },
    handler: async (ctx, a) => { await duplicateFile(ctx, argUri(a.uri)); return { ok: true }; },
  });

  registerTool({
    id: 'fs.duplicateFolder', title: '复制文件夹', description: '递归复制 `x`→`x 副本 (n)`；副本含 .djs 时自动配绑定表。',
    schema: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] },
    handler: async (ctx, a) => { await duplicateFolder(ctx, argUri(a.uri)); return { ok: true }; },
  });

  registerTool({
    id: 'fs.import', title: '导入文件', description: '把给定的外部文件复制进目标目录：域过滤（exts）+ (n) 去重 + `.djs` 落表。文件选择对话框在调用方（agent 直接给 sources）。',
    schema: {
      type: 'object',
      properties: {
        destDir: { type: 'string', description: '落盘目录' },
        sources: { type: 'array', items: { type: 'string' }, description: '源文件（fsPath/file: uri）列表' },
        exts: { type: 'array', items: { type: 'string' }, description: '放行扩展（缺省 v/sv/djs）' },
      },
      required: ['destDir', 'sources'],
    },
    handler: async (ctx, a) => {
      const sources = (Array.isArray(a.sources) ? a.sources : []).map((s) => argUri(s));
      // exts 双形态收货：JSON 数组（agent 正形态）或 csv 串（容错）
      const exts = Array.isArray(a.exts) ? a.exts.map(String) : (a.exts ? String(a.exts).split(',') : undefined);
      const r = await importFromUris(ctx, argUri(a.destDir), sources, exts);
      if (r.written.length) broadcastBindingsChanged();
      return r;
    },
  });

  registerTool({
    id: 'fs.copyPath', title: '复制路径', description: '绝对路径进剪贴板（幂等、无副作用）。',
    schema: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] },
    handler: async (_ctx, a) => {
      const uri = argUri(a.uri);
      await vscode.env.clipboard.writeText(uri.fsPath);
      return { path: uri.fsPath.replace(/\\/g, '/') };
    },
  });

  registerTool({
    id: 'fs.revealInOS', title: '在磁盘显示', description: '调用工作台 revealFileInOS 定位文件/目录（幂等）。',
    schema: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] },
    handler: async (_ctx, a) => {
      await vscode.commands.executeCommand('revealFileInOS', argUri(a.uri));
      return { ok: true };
    },
  });

  registerTool({
    id: 'fs.createFile', title: '新建文件', description: 'kind=verilog：最小可编译模板；kind=sandbox：空画布 `{"cells":[]}` 并落「目录有部件就有表」。编辑器打开归调用方。',
    schema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '落盘目录（缺省=项目根）' },
        name: { type: 'string', description: '文件名（可含子路径；后缀自动补）' },
        kind: { type: 'string', enum: ['verilog', 'sandbox'], description: '缺省 verilog' },
      },
      required: ['name'],
    },
    handler: async (ctx, a) => {
      const dir = a.dir ? argUri(a.dir) : projectRoot(ctx);
      const uri = a.kind === 'sandbox'
        ? await createSandboxFile(ctx, dir, String(a.name ?? ''))
        : await createVerilogFile(ctx, dir, String(a.name ?? ''));
      if (a.kind === 'sandbox') broadcastBindingsChanged();
      return uriOut(uri);
    },
  });

  registerTool({
    id: 'fs.createFolder', title: '新建文件夹', description: '段级消毒（`..` 逃逸死掉）+递归建目录（可含子路径）。',
    schema: { type: 'object', properties: { dir: { type: 'string' }, name: { type: 'string', description: '可含子路径' } }, required: ['name'] },
    handler: async (ctx, a) => {
      const dir = a.dir ? argUri(a.dir) : projectRoot(ctx);
      return uriOut(await createFolder(ctx, dir, String(a.name ?? '')));
    },
  });
}
