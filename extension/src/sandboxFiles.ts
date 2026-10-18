// 沙盒文件的树右键操作（片 5-B：文件右键/绑定系统的原生落点）。
// 旧 UI 的文件右键在 SandboxFileTree（localStorage 沙盒库）里；工作区真文件形态下
// 这组操作归**侧边栏沙盒树**（view/item/context）+ VS Code 原生对话框。
//
// 部件角色（role）的持久化：旧版存 sandboxStore（localStorage）。工作区形态下用
// 项目根的 `.verilogviz.json`（{ "parts": ["名.djs", ...] }）——⛔ 塞进 .djs 本身
// （那是 digitaljs 文档格式，混入宿主元数据会脏了文档）；单文件、git 可见、用户可手改。
// role 的消费方：customEditors._siblings（init 带 role）→ DocApp → gateSystem 部件打分。
import * as vscode from 'vscode';
import { projectRoot } from './dispatch';
import { uniqueName, uniqueFolderName, sanitizeNameInput } from './naming';
import { findSandboxUris, isSandboxPath, rootRel } from './verilogDomain';

export const META_FILE = '.verilogviz.json';

const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

/**
 * 部件角色语义（回摆裁决 2026-10-15）：**兄弟 .djs 缺省全是部件**（与旧 doc 模式行为一致
 * ——refreshGates/绑定解析都靠它），`.verilogviz.json` 的 `circuits` 名单是**显式取消**表
 * （「取消部件」往里加，「设为部件」从里删）。⛔ 用 parts 正向名单：空名单＝全不是部件＝
 * 沙盒画布右键无一件可放（真机踩过）。
 */
interface VvMeta {
  circuits: string[];
  bindings: Record<string, string>;
  /** 协议头与用户私货（$schema/schemaVersion/kind/meta/…）透传袋——读进写回⛔ 吞
   *（「手编内容绝不覆盖」承诺的下半句：不只值不覆，**别层的字段也不能被抹**）。 */
  _extra?: Record<string, unknown>;
}

const HEAD_KEYS = ['$schema', 'schemaVersion', 'kind', 'meta'];

/** 目录级 `.verilogviz.json` 的uri（dirRel=''＝项目根）。裁决（R137 用户）：
 *  **目录里 json 表示该目录部件的绑定关系**（仿 .vscode/settings.json），
 *  解析按目录链**由根向文档目录**逐级合并（近层覆盖远层）。 */
function metaUri(context: vscode.ExtensionContext, dirRel = ''): vscode.Uri {
  const root = projectRoot(context);
  const segs = dirRel.split('/').filter(Boolean);
  return vscode.Uri.joinPath(root, ...(segs.length ? [...segs, META_FILE] : [META_FILE]));
}

async function readMetaAt(context: vscode.ExtensionContext, dirRel: string): Promise<VvMeta | null> {
  try {
    const raw = await then(vscode.workspace.fs.readFile(metaUri(context, dirRel)));
    const meta = JSON.parse(new TextDecoder().decode(raw));
    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(meta || {})) if (k !== 'circuits' && k !== 'bindings') extra[k] = (meta || {})[k];
    return {
      circuits: Array.isArray(meta?.circuits) ? meta.circuits.map(String) : [],
      bindings: meta?.bindings && typeof meta.bindings === 'object' ? meta.bindings : {},
      _extra: Object.keys(extra).length ? extra : undefined,
    };
  } catch { return null; }
}

async function readMeta(context: vscode.ExtensionContext): Promise<VvMeta> {
  return (await readMetaAt(context, '')) || { circuits: [], bindings: {} };
}

async function writeMeta(context: vscode.ExtensionContext, meta: VvMeta, dirRel = ''): Promise<void> {
  const uri = metaUri(context, dirRel);
  const ex = meta._extra || {};
  const out: Record<string, unknown> = {};
  for (const k of HEAD_KEYS) if (ex[k] !== undefined) out[k] = ex[k];          // 协议头按惯例顺序置前
  out.circuits = meta.circuits || [];
  out.bindings = meta.bindings || {};
  for (const k of Object.keys(ex)) if (!HEAD_KEYS.includes(k)) out[k] = ex[k]; // 其余私货殿后保序
  await then(vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..')));
  await then(vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(out, null, 2) + '\n')));
}

/**
 * 部件文件路径归一（R137）：
 *  - `fsm_controller.djs.djs`（test_files/.verilogviz.json 实证的写入侧残留）⇒ 剥重复 `.djs` 只留一条；
 *  - 无任何扩展名 ⇒ 补 `.djs`（沙盒部件主形）；
 *  - **已有别的扩展（.v/.gate/.json）⇒ 原样保留**⛔ 再套 `.djs` 尾巴
 *    （`.v` 闭包部件被归成 `adder.v.djs`＝resolvePartRef 永久解不到＝"绑了没反应"）。
 */
export function normalizePartName(part: string): string {
  const segs = String(part || '').split('/').filter(Boolean);
  if (!segs.length) return part;
  let last = segs[segs.length - 1].replace(/(\.djs)+$/i, '.djs');
  if (!/\.[a-z0-9]+$/i.test(last)) last = `${last}.djs`;
  segs[segs.length - 1] = last;
  return segs.join('/');
}

/** 目录链（文档目录 → … → 根），如 'a/b/x.djs' ⇒ ['a/b', 'a', ''] */
function dirChain(relName: string): string[] {

  const dir = relName.includes('/') ? relName.slice(0, relName.lastIndexOf('/')) : '';
  const out: string[] = [];
  let cur = dir;
  while (cur) { out.push(cur); const cut = cur.lastIndexOf('/'); cur = cut >= 0 ? cur.slice(0, cut) : ''; }
  out.push('');
  return out;
}

/**
 * 某文档视角的生效绑定（链合并 + 值解析回根相对）：
 * 远层先、近层覆盖；每一层的 value 按**那一层目录**相对解析。
 */
export async function bindingsForFile(context: vscode.ExtensionContext, docRel: string): Promise<Record<string, string>> {
  const chain = dirChain(docRel);
  const merged: Record<string, string> = {};
  for (const dir of [...chain].reverse()) {          // 根 → 文档目录（近层覆盖）
    const meta = await readMetaAt(context, dir);
    if (!meta) continue;
    for (const [k, v] of Object.entries(meta.bindings)) {
      const val = normalizePartName(String(v || ''));
      // R145 多层精控：`宿主文档::实例名` 前缀键——宿主写的是相对本层的，输出折回**根相对**
      // （webview gateSystem 按 raw.host／activeCtxDoc＝根相对名匹配前缀）。裸键语义不变。
      const outKey = k.includes('::') ? `${resolveLayerValue(dir, normalizePartName(k.slice(0, k.lastIndexOf('::'))))}${k.slice(k.lastIndexOf('::'))}` : k;
      if (!val) { delete merged[outKey]; continue; }
      merged[outKey] = resolveLayerValue(dir, val);        // 本层目录 + 可能含 ../ 的相对值 → 根相对
    }
  }
  return merged;
}

/** 显式「取消部件」名单：保持**项目根表**（取消部件是显式动作，全局唯一最不易误解；
 *  circuits 目录化刻意保守不做）。customEditors 的 siblings role 消费。 */
export async function getCircuitsSet(context: vscode.ExtensionContext): Promise<Set<string>> {
  const meta = await readMeta(context);
  return new Set(meta.circuits);
}

/** 绑定关系（B3 → R137 目录级）：getAllBindings 带 doc 走链合并，不带＝根表（兼容）。 */
export async function getAllBindings(context: vscode.ExtensionContext, docRel?: string): Promise<Record<string, string>> {
  if (docRel) return bindingsForFile(context, docRel);
  return (await readMeta(context)).bindings;
}

/**
 * 写一条绑定：目标=**文档所在目录**的表（无则创建——用户裁决「目录内有部件则新建该目录 json」）。
 * part/root 相对路径 → 存为**相对该目录**（链上其它目录的部件用 ../ 相对——normalizePartName 保证单 .djs）。
 */
export async function setBinding(context: vscode.ExtensionContext, celltype: string, partName: string | null, docUri?: vscode.Uri): Promise<void> {
  const root = projectRoot(context);
  const docRel = docUri ? pathRel(root, docUri) : '';
  await setBindingInDir(context, docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : '', celltype, partName);
}

/** 直写某目录层表的绑定（固化/materialize 用；dirRel=''＝根表）。见 setBinding 头注的语义。 */
export async function setBindingInDir(context: vscode.ExtensionContext, dirRel: string, celltype: string, partName: string | null): Promise<void> {
  const dir = dirRel.split('/').filter(Boolean).join('/');
  const meta = (await readMetaAt(context, dir)) || { circuits: [], bindings: {} };
  if (partName) {
    const full = normalizePartName(partName);
    meta.bindings[celltype] = dir && full.startsWith(`${dir}/`) ? full.slice(dir.length + 1) : relFrom(dir, full);
  } else {
    delete meta.bindings[celltype];
  }
  await writeMeta(context, meta, dir);
}

/** 同目录表内相对化：'../sub/x.djs' 形态（部件不在文档目录时用相对跳转；链解析侧按层目录回根相对）。
 *  2026-10-18 导出：绑定面板深层行写回也要同一把尺（前缀键的宿主段必须按**表层目录**相对）。 */
export function relFrom(dir: string, rootRel: string): string {
  const dsegs = dir.split('/').filter(Boolean);
  const fsegs = rootRel.split('/').filter(Boolean);
  let i = 0;
  while (i < dsegs.length && i < fsegs.length - 1 && dsegs[i] === fsegs[i]) i++;
  const ups = dsegs.length - i;
  return [...Array(ups).fill('..'), ...fsegs.slice(i)].join('/');
}

/** 链解析把各层 value（含 ../）折算成根相对路径 */
function resolveLayerValue(dir: string, value: string): string {
  const segs = (dir ? `${dir}/` : '').split('/').concat(value.split('/')).filter(Boolean);
  const out: string[] = [];
  for (const s of segs) {
    if (s === '.') continue;
    else if (s === '..') out.pop();
    else out.push(s);
  }
  return out.join('/');
}

/** 兼容旧 RPC 形状：docName 的目录表整表替换 bindings（map 值＝根相对 → 相对化写入）。 */
export async function setDocBindings(context: vscode.ExtensionContext, docName: string, bindings: Record<string, string>): Promise<void> {
  const root = projectRoot(context);
  const docRel = docName ? (pathRel(root, vscode.Uri.joinPath(root, docName)) || docName) : '';
  const dir = docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : '';
  const meta = (await readMetaAt(context, dir)) || { circuits: [], bindings: {} };
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(bindings || {})) {
    const full = normalizePartName(String(v || ''));
    if (full) next[k] = dir && full.startsWith(`${dir}/`) ? full.slice(dir.length + 1) : relFrom(dir, full);
  }
  meta.bindings = next;
  await writeMeta(context, meta, dir);
}

/**
 * 「入目录就有表」：文档目录存在 .djs 部件而缺 `.verilogviz.json` ⇒ 建空模板
 * （用户裁决：绑定关系显式落在目录里，看得见才能手改）。
 */
export async function ensureDirMeta(context: vscode.ExtensionContext, dirRel: string): Promise<vscode.Uri | null> {
  const uri = metaUri(context, dirRel);
  try { await then(vscode.workspace.fs.stat(uri)); return null;           // 已有＝不覆盖（手编内容珍贵）
  } catch { /* 缺失才建 */ }
  await writeMeta(context, { circuits: [], bindings: {} }, dirRel);
  return uri;
}

/** 「打开绑定配置」：定位文档目录表（无则**建表即写全**）→ 原生编辑器直开（可手改，保存即生效）。
 *  R137-B「目录有部件即自动建表」的兑现（2026-10-18 用户实锤：新建只给空壳＝"打开一看什么都没有"）——
 *  首次建档顺手把该文档各层实例的现解析落进去（collect→complete，值按层相对）；**已有表一个字不碰**
 *  （手编内容珍贵，⛔ 覆盖——这条纪律不变）。 */
export async function openBindingConfig(context: vscode.ExtensionContext, docUri: vscode.Uri | null): Promise<void> {
  const root = projectRoot(context);
  const dirRel = docUri ? (pathRel(root, docUri).split('/').filter((_seg, i, a) => i < a.length - 1).join('/')) : '';
  const uri = metaUri(context, dirRel);
  try { await then(vscode.workspace.fs.stat(uri)); }
  catch {
    if (docUri) {
      try {
        const docRel = pathRel(root, docUri);
        const hits = await collectInstanceHits(context, docRel);
        await completeFromHits(context, docRel, hits);                        // 有实例可写 ⇒ setBindingInDir 已建表
      } catch { /* 模拟失败退空壳——⛔ 让"打开配置"整颗命令挂掉 */ }
    }
    try { await then(vscode.workspace.fs.stat(uri)); }
    catch { await writeMeta(context, { circuits: [], bindings: {} }, dirRel); }
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  void vscode.window.showInformationMessage(`绑定配置＝「${dirRel || '项目根'}」目录的 ${META_FILE}（改完保存即生效；部件文件路径写该目录内或 ../ 相对）。`);
}

/** 一批落盘名（根相对）里 .djs 所在的各目录 ensure 配置表——「目录有部件就有表」。 */
export async function ensureDirsMeta(context: vscode.ExtensionContext, rootRelNames: string[]): Promise<void> {
  const dirs = new Set<string>();
  for (const n of rootRelNames) {
    if (!n.toLowerCase().endsWith('.djs')) continue;
    dirs.add(n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : '');
  }
  for (const d of dirs) await ensureDirMeta(context, d);
}

/** 「设为部件/取消部件」＝从显式 circuits 名单里删/加 */
export async function setPartRole(context: vscode.ExtensionContext, uri: vscode.Uri, isPart: boolean): Promise<void> {
  const meta = await readMeta(context);
  const name = pathRel(projectRoot(context), uri);
  if (isPart) meta.circuits = meta.circuits.filter((n) => n !== name);
  else if (!meta.circuits.includes(name)) meta.circuits.push(name);
  await writeMeta(context, meta);
}

/** 「切换部件角色」：circuits 名单里有＝当前 circuit → 翻回 part；否则标为 circuit。
 *  合并成一颗命令是为了树右键菜单固定一项（⛔ 互斥两颗都常驻菜单的观测歧义）。 */
export async function togglePartRole(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  const meta = await readMeta(context);
  const name = pathRel(projectRoot(context), uri);
  if (meta.circuits.includes(name)) meta.circuits = meta.circuits.filter((n) => n !== name);
  else meta.circuits.push(name);
  await writeMeta(context, meta);
}

/** 根相对 posix 名（绑定链/目录表的定位键）——toolsDomain 等外层也要用，导出。
 *  R153 深度自检：这颗原本自己按根串长度切前缀，盘符大小写一漂
 *  （`D:/p` ↔ `d:/p/lib/x.v`）就交出半截或整颗绝对路径 ⇒ 转交主人 `rootRel`（path.relative 口径）。 */
export function pathRel(root: vscode.Uri, uri: vscode.Uri): string { return rootRel(root, uri); }

// naming.ts 的 uniqueName 顶掉本文件内部的 `(n)` 循环（X9 双轨合一）

/** 打开电路画布（树项菜单与双击同语义；⛔ showTextDocument） */
export async function openDoc(uri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', uri, 'verilogViz.doc');
}

/** fs.rename 工具的 headless 机械体（统一调用层批次一）：消毒 + performRename。返回 ok（失败已当面告示）。
 *  （原 renameFile 弹框壳已上移 extension.ts 命令层——UI+executeTool 薄壳纪律。） */
export async function renameEntry(context: vscode.ExtensionContext, uri: vscode.Uri, newName: string): Promise<boolean> {
  const name = uri.path.split('/').pop() || uri.fsPath;
  // G7：输入框直连盘上路径，裸收 `../` 能把文件改名出工作区——单段消毒
  const clean = sanitizeNameInput(newName, { single: true });
  if (!clean || clean === name) return false;
  return performRename(context, uri, vscode.Uri.joinPath(vscode.Uri.joinPath(uri, '..'), clean));
}

/** renameFile/moveToFile 共源：盘上搬家 → 按对象形态迁绑定（文件＝精确身份；目录＝前缀族群 G1）。 */
async function performRename(context: vscode.ExtensionContext, uri: vscode.Uri, target: vscode.Uri): Promise<boolean> {
  const root = projectRoot(context);
  const oldFull = pathRel(root, uri);
  // 目录判定＝**动手前先看源**（⛔ 改名后再 stat target：盘上顺序、宿主实现、测试桩三方都更稳——
  // 万一 rename 失败也早知道动了什么形状；2026-10-17 批次B 实测修正）
  let isDir = false;
  try { isDir = (await then(vscode.workspace.fs.stat(uri)) as any).type === 2; } catch { /* 文件走 false */ }
  // 目标占用与重名顺延：overwrite:false 语义（重名会失败并具体告知——G8）
  try { await then(vscode.workspace.fs.rename(uri, target, { overwrite: false })); }
  catch (e) {
    void vscode.window.showErrorMessage(`重命名失败：${String(e instanceof Error ? e.message : e)}`);
    return false;
  }
  // target 串可能带未折的 `../`（桩/极端 joinPath 形状；真宿主会归一）——过 resolveLayerValue 折死，双保险
  const newFull = resolveLayerValue('', pathRel(root, target));
  if (isDir) {
    // G1（X3/D5/C9 共源）：目录改名 ⇒ 值/`宿主::`前缀键/根表 circuits 全族随迁
    await migratePrefix(context, oldFull, newFull);
    return true;
  }
  // —— 文件级迁移：全表层精确身份扫（G1 三路共源的文件路）——
  // 2026-10-17 审查补：旧实现只扫 `dirChain(oldFull)`（祖先链），但任何目录的表都可能用 `../`
  // 相对写法指到这颗文件 ⇒ 跨目录引用全漏。收口进 migrateFileRef（与 migratePrefix 同一把扫法）。
  await migrateFileRef(context, oldFull, newFull);
  return true;
}

/** C9「移动到」的机械体：dest 目录内 (n) 去重 → performRename（迁移语义同源）。返回终 uri（失败 null）。 */
export async function moveToFile(context: vscode.ExtensionContext, srcUri: vscode.Uri, destDirUri: vscode.Uri): Promise<vscode.Uri | null> {
  const root = projectRoot(context);
  const srcFull = pathRel(root, srcUri);
  const destRel = pathRel(root, destDirUri);
  const name = srcUri.path.split('/').filter(Boolean).pop() || 'entry';
  let isDir = false;
  try { isDir = (await then(vscode.workspace.fs.stat(srcUri)) as any).type === 2; } catch { /* 少见；当文件处理 */ }
  if (isDir && (destRel === srcFull || destRel.startsWith(`${srcFull}/`))) {
    void vscode.window.showErrorMessage(`不能把目录「${name}」移动到它自己或它的子目录里。`);
    return null;
  }
  // 原地"移动"＝no-op（⛔ 白跑 (n) 顺延把 parts 改成「parts (2)」——审查缺陷 #5，2026-10-17）
  const srcDir = srcFull.includes('/') ? srcFull.slice(0, srcFull.lastIndexOf('/')) : '';
  if (destRel === srcDir) return srcUri;
  const next = await uniqueName(destDirUri, name);
  const target = vscode.Uri.joinPath(destDirUri, next);
  const ok = await performRename(context, srcUri, target);
  return ok ? target : null;
}

/** 递归数目录下的文件个数（确认弹窗用；深度 10 护栏挡软链环） */
async function countFilesUnder(dir: vscode.Uri, depth = 10): Promise<number> {
  if (depth <= 0) return 0;
  let n = 0;
  try {
    for (const [name, type] of await then(vscode.workspace.fs.readDirectory(dir))) {
      if (type === 2) n += await countFilesUnder(vscode.Uri.joinPath(dir, name), depth - 1);
      else n++;
    }
  } catch { /* 读不到计 0 */ }
  return n;
}

/** 删除确认的规模账（G6/X7）：目录回子文件数；文件回 1。命令层弹窗用（⛔ 工具层不弹）。 */
export async function describeDeletion(_context: vscode.ExtensionContext, uri: vscode.Uri): Promise<{ isDir: boolean; files: number }> {
  const isDir = await then(vscode.workspace.fs.stat(uri)).then((s) => (s as any).type === 2, () => false);
  return { isDir, files: isDir ? await countFilesUnder(uri) : 1 };
}

/** fs.delete 工具的 headless 机械体（统一调用层批次一）：回收站删除 + 绑定/电路名单随清（G1 双路）。
 *  （原 deleteFile 弹框壳已上移 extension.ts 命令层——确认弹窗在 UI，⛔ 工具层二次弹。） */
export async function deleteEntry(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  const isDir = await then(vscode.workspace.fs.stat(uri)).then((s) => (s as any).type === 2, () => false);
  await then(vscode.workspace.fs.delete(uri, { useTrash: true, recursive: true }));
  const deletedFull = pathRel(projectRoot(context), uri);
  if (isDir) await migratePrefix(context, deletedFull, null);   // G1：前缀族群值/键/circuits 清
  else await migrateFileRef(context, deletedFull, null);        // G1：跨表精确身份清（审查 #12）
}

export async function duplicateFile(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  const dir = vscode.Uri.joinPath(uri, '..');
  const name = uri.path.split('/').pop() || 'copy.djs';
  const target = await uniqueName(dir, name);
  await then(vscode.workspace.fs.copy(uri, vscode.Uri.joinPath(dir, target), { overwrite: false }));
  void context; // role 不随副本（新副本默认 circuit）
}

/** 复制文件夹（旧 UI「复制文件夹」的原生落点）：`x` → `x 副本 (n)`，fs.copy 递归（X9：出名单一算法 uniqueFolderName）。 */
export async function duplicateFolder(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  const dir = vscode.Uri.joinPath(uri, '..');
  const name = uri.path.split('/').filter(Boolean).pop() || 'folder';
  const candidate = await uniqueFolderName(dir, name);
  await then(vscode.workspace.fs.copy(uri, vscode.Uri.joinPath(dir, candidate), { overwrite: false }));
  // 副本里有 .djs（部件目录）才配得上「目录有部件就有表」——真扫一层，⛔ 空目录也建表
  const root = projectRoot(context);
  const targetRel = `${pathRel(root, vscode.Uri.joinPath(dir, candidate))}`;
  if (await hasDjsUnder(vscode.Uri.joinPath(dir, candidate))) await ensureDirMeta(context, targetRel);
}

/**
 * 递归探测目录下是否存在**沙盒域文件**（`.djs`；逐层 readDirectory，深度 8 护栏挡软链环）。
 * X19（R153 裁决）：判据从前收 `.v|.djs` ⇒ 复制一个只有 Verilog 源码的目录，副本里会凭空多出
 * 一张空 `.verilogviz.json`（在用户的仓库里造没人要求的文件）。目录真需要表的时刻是"有绑定要
 * 落到这一层"，那时 `setBindingInDir` 自己会建；这里⛔ 预铺。域界问一颗主人（`isSandboxPath`）。
 */
async function hasDjsUnder(dir: vscode.Uri, depth = 8): Promise<boolean> {
  if (depth <= 0) return false;
  try {
    for (const [name, type] of await then(vscode.workspace.fs.readDirectory(dir))) {
      if (isSandboxPath(name)) return true;
      if (type === 2 && await hasDjsUnder(vscode.Uri.joinPath(dir, name), depth - 1)) return true;
    }
  } catch { /* 读不到＝当作没有 */ }
  return false;
}

/** 导入对话框的域过滤器（X6 三分域：编译 v/sv/vh、沙盒 djs、通用三档）——命令层弹窗用。 */
export function importFilters(exts: string[]): Record<string, string[]> {
  if (exts.every((e) => e === 'djs')) return { '沙盒电路文件': ['djs'] };
  if (exts.every((e) => e !== 'djs')) return { 'Verilog 源文件': exts };
  return { 'Verilog / 电路文件': exts };
}

/**
 * fs.import 工具的 headless 机械体（统一调用层批次一）：把给定外部文件复制进目标目录。
 * X6 域设防在机械体里（agent 调用无对话框可倚）：域外不落盘、计 skipped；`.djs` 触发落表。
 * 对话框在命令层；取消/无源＝返回空账。返回 {written(根相对), skipped}。
 */
export async function importFromUris(
  context: vscode.ExtensionContext,
  dirUri: vscode.Uri,
  sources: vscode.Uri[],
  exts?: string[],
): Promise<{ written: string[]; skipped: number }> {
  const allowed = exts ?? ['v', 'sv', 'djs'];
  const root = projectRoot(context);
  const written: string[] = [];
  let skipped = 0;
  for (const src of sources) {
    const base = src.path.split('/').filter(Boolean).pop() || 'imported.v';
    const ext = (base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '').toLowerCase();
    if (!allowed.includes(ext)) { skipped++; continue; }   // 双保险：文件管理器放行也会拦这里
    const final = await uniqueName(dirUri, base);
    await then(vscode.workspace.fs.copy(src, vscode.Uri.joinPath(dirUri, final), { overwrite: false }));
    written.push(pathRel(root, vscode.Uri.joinPath(dirUri, final)));
  }
  await ensureDirsMeta(context, written);
  return { written, skipped };
}

/**
 * R144「自动兜底显形 → 一键固化」：把 instances 里**未录入且能自动命中**的解析结果写进
 * 文档目录表（记录即权威的正方向）。resolver 由调用侧给（`.djs` 用同目录/根同名，
 * `.v` 用工作区模块扫描）；已记录的⛔ 动。返回固化条数。
 */
export async function materializeBindings(
  context: vscode.ExtensionContext,
  docRel: string,
  instances: string[],
  resolver: (name: string) => Promise<string | null>,
): Promise<string[]> {
  const root = projectRoot(context);
  const dir = docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : '';
  const recorded = await bindingsForFile(context, docRel);
  const done: string[] = [];
  for (const name of instances) {
    if (recorded[name] || recorded[`${docRel}::${name}`]) continue;   // 已录入（裸或本层前缀精控）⇒ ⛔ 覆写
    const hit = await resolver(name);
    if (!hit) continue;                                      // 自动也解不到＝没什么可固化
    await setBindingInDir(context, dir, name, hit);
    done.push(`${name} → ${hit.replace(/^.*\//, '')}`);
  }
  void root;
  return done;
}

/* ================= R146 绑定完整性（配置不齐 ⇒ 可见、可一键写全、可按策略阻断） ================= */

export type BindingHit = { ctx: string; name: string; file: string };

/**
 * 「写全配置」的落表面：pairs＝(宿主文档, 实例名, 命中文件)（画布实解真相或宿主模拟）。
 * 裸/前缀规则（保守且语义精确）：
 *  - 顶层（ctx＝本文档或''）且该 celltype **各层命中同一文件** ⇒ 裸键（全局兜底一条足矣）；
 *  - 深层宿主（ctx≠本文档）⇒ 必前缀（裸键是整表级语义，会越权顶掉别层同名解析）；
 *  - 同 celltype 不同层命中不同文件 ⇒ 逐条前缀。
 * 入文档目录层表；键/值按层目录相对化（读侧 bindingsForFile 折回根相对）。
 */
export async function completeFromHits(
  context: vscode.ExtensionContext,
  docRel: string,
  pairs: BindingHit[],
): Promise<string[]> {
  const dir = docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : '';
  const recorded = await bindingsForFile(context, docRel);
  const byName = new Map<string, BindingHit[]>();
  for (const h of pairs) {
    const ctx = h.ctx === '' ? docRel : h.ctx;
    if (recorded[`${ctx}::${h.name}`] || (ctx === docRel && recorded[h.name])) continue;   // 该层已精控/顶层已录入 ⇒ ⛔ 覆写
    const list = byName.get(h.name) || [];
    if (!list.some((x) => x.ctx === ctx)) list.push({ ctx, name: h.name, file: h.file });
    byName.set(h.name, list);
  }
  const done: string[] = [];
  for (const [name, hits] of byName) {
    const files = [...new Set(hits.map((h) => h.file))];
    const topOnly = hits.every((h) => h.ctx === docRel);
    if (files.length === 1 && topOnly) {
      await setBindingInDir(context, dir, name, files[0]);
      done.push(`${name} → ${files[0]}`);
    } else {
      for (const h of hits) {
        await setBindingInDir(context, dir, `${relFrom(dir, h.ctx)}::${name}`, h.file);
        done.push(`${h.ctx}::${name} → ${h.file}`);
      }
    }
  }
  return done;
}

/** 宿主侧「实例树全层枚举」：按盘上内容模拟画布解析链（BFS，环/预算护栏），
 *  产出 (宿主,实例名,命中文件) 对——⛔ 打开画布也能审计/写全（右键命令路）。
 *  `.djs`：cells 逐层展开，打分复刻 gateSystem（同目录 part0→同目录1→根 part2→根3→其他）。
 *  opts.all（2026-10-18 绑定面板多层点名）：**已录入的深层实例也进账**（file=表值）——
 *  面板⛔ 只列"未配置"那半，用户要看的是全 picture；写全/审计调用⛔ 传，行为零变化。 */
export async function collectInstanceHits(
  context: vscode.ExtensionContext,
  docRel: string,
  opts?: { all?: boolean },
): Promise<BindingHit[]> {
  const all = !!opts?.all;
  const root = projectRoot(context);
  const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const recorded = await bindingsForFile(context, docRel);
  const hits: BindingHit[] = [];
  let budget = 300;
  if (/\.djs$/i.test(docRel)) {
    const [uris, circuits] = await Promise.all([
      findSandboxUris(),
      getCircuitsSet(context),
    ]);
    const files = uris.map((u) => pathRel(root, u));
    const base = (n: string) => n.replace(/^.*\//, '').replace(/\.(djs|gate|json)$/i, '');
    const readCells = async (name: string): Promise<string[]> => {
      try {
        const txt = new TextDecoder().decode(await then(vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...name.split('/')))));
        const pj = JSON.parse(txt);
        return [...new Set(((pj?.cells || []) as Array<{ type?: string; celltype?: string }>)
          .filter((c) => c?.type === 'Subcircuit' && c.celltype).map((c) => String(c.celltype)))];
      } catch { return []; }
    };
    const resolve = (scope: string, inst: string): string | null => {
      const cand = files.filter((f) => base(f) === inst);
      if (!cand.length) return null;
      const score = (f: string) => {
        const d = dirOf(f);
        const part = !circuits.has(f);
        if (d === scope) return part ? 0 : 1;
        if (d === '') return part ? 2 : 3;
        return part ? 4 : 5;
      };
      return cand.sort((a, b) => score(a) - score(b) || a.localeCompare(b))[0] || null;
    };
    const queue: string[] = [docRel];
    const visited = new Set<string>([docRel.toLowerCase()]);
    while (queue.length && (budget--) > 0) {
      const doc = queue.shift()!;
      for (const inst of await readCells(doc)) {
        const rec = recorded[`${doc}::${inst}`] ?? recorded[inst];            // 已录入（本层精控优先，回落裸键）
        if (rec && !all) continue;                                            // 审计/写全口径：表说了算，⛔ 进 hits
        const f = rec || resolve(dirOf(doc), inst);                           // all：已录的直接报表值，未录走兜底真相
        if (f) {
          hits.push({ ctx: doc, name: inst, file: f });
          if (/\.(djs|gate|json)$/i.test(f) && !visited.has(f.toLowerCase())) { visited.add(f.toLowerCase()); queue.push(f); }
        }
      }
    }
  } else {
    const [{ scanDefs, closureOf }, { parseVerilogInstances }] = await Promise.all([import('./compilePanel'), import('./verilogParseLite')]);
    const [defs, job] = await Promise.all([scanDefs(), closureOf(context, vscode.Uri.joinPath(root, ...docRel.split('/')))]);
    for (const f of job.files) {
      for (const inst of [...new Set(parseVerilogInstances(f.content))]) {
        if (inst === job.topModule) continue;
        const rec = recorded[`${f.name}::${inst}`] ?? recorded[inst];           // 该层已精控/全局已录
        if (rec && !all) continue;                                              // 审计口径：⛔ 不算未配置
        const def = rec || (defs.get(inst) ? pathRel(root, defs.get(inst)!) : undefined);
        if (def) hits.push({ ctx: f.name, name: inst, file: def });
      }
    }
  }
  return hits;
}

/* ================= G1 引擎（2026-10-17 批次B）：全工作区表层的**前缀级**迁移/清空 ================= */

/** 全工作区所有带配置表的目录层（''＝根；跳过 node_modules/点开头——与 normalizeBindingsDisk 同源）。 */
async function tableDirsOf(context: vscode.ExtensionContext): Promise<string[]> {
  const root = projectRoot(context);
  const rootPathL = root.fsPath.replace(/[\\/]+$/, '').toLowerCase();
  return ['', ...await collectTableDirs(root, rootPathL)];
}

/**
 * G1 引擎：把根相对前缀 `oldPrefix/` 下的盘上身份迁到 `newPrefix`（null＝删除 ⇒ 悬空清空）。
 * 一把扫全表层，三层语义同源：
 *  ① 绑定值——根相对解析后落在前缀内的 ⇒ 重映射（或删）
 *  ② `宿主::`前缀键——宿主落在前缀内的 ⇒ 键迁移（或整键删）
 *  ③ 根表 circuits——名单连同整条前缀族群走
 * ⛔ 动改名后**已随盘搬家**的目录内表（fs.rename 连孩子连表一起走，其相对书写天然仍指向族内，
 *   位置＝newPrefix ⇒ 跳过）。⚠ 这是"目录改名/删除什么都不迁"的根因修复：旧里逐层扫只按
 *   `resolved === oldFull` 精确相等判，目录路径永不出现在值的解析位上 ⇒ 全军经过也不动。
 */
export async function migratePrefix(
  context: vscode.ExtensionContext,
  oldPrefix: string,
  newPrefix: string | null,
): Promise<void> {
  if (!oldPrefix) return;                                    // 根整个没有"改名"语义
  const pre = `${oldPrefix}/`;
  for (const dir of await tableDirsOf(context)) {
    // 已搬家的表：位置在 newPrefix 内 ⇒ 跳过（相对书写天然正确；extra/协议头不被二次改写）
    if (newPrefix !== null && (dir === newPrefix || dir.startsWith(`${newPrefix}/`))) continue;
    const m = await readMetaAt(context, dir);
    if (!m) continue;
    const out: Record<string, string> = {};
    let touched = false;
    for (const [k, raw] of Object.entries(m.bindings)) {
      if (typeof raw !== 'string') { out[k] = raw as string; continue; }
      let dropped = false;
      let newKey = k;
      let newVal = raw;
      if (k.includes('::')) {
        const sep = k.lastIndexOf('::');
        const hostFull = resolveLayerValue(dir, normalizePartName(k.slice(0, sep)));
        if (hostFull.startsWith(pre)) {
          if (!newPrefix) dropped = true;                     // 删除 ⇒ 宿主没了，整键清
          else newKey = `${relFrom(dir, newPrefix + hostFull.slice(oldPrefix.length))}::${k.slice(sep + 2)}`;
        }
      }
      if (!dropped) {
        const full = resolveLayerValue(dir, normalizePartName(raw));
        if (full.startsWith(pre)) {
          if (!newPrefix) dropped = true;                     // 删除 ⇒ 值断了，清
          else {
            const nf = newPrefix + full.slice(oldPrefix.length);
            newVal = dir && nf.startsWith(`${dir}/`) ? nf.slice(dir.length + 1) : relFrom(dir, nf);
          }
        }
      }
      if (!dropped) out[newKey] = newVal;
    }
    if (JSON.stringify(out) !== JSON.stringify(m.bindings)) {
      await writeMeta(context, { circuits: m.circuits || [], bindings: out, _extra: m._extra }, dir);
      touched = true;
    }
    void touched;
  }
  // 根表 circuits 的族群迁移/清除（显式取消名单的语义在根——与 getCircuitsSet 同层）
  const rootMeta = await readMeta(context);
  if (rootMeta.circuits.some((n) => n === oldPrefix || n.startsWith(pre))) {
    rootMeta.circuits = newPrefix
      ? rootMeta.circuits.map((n) => (n === oldPrefix || n.startsWith(pre) ? newPrefix + n.slice(oldPrefix.length) : n))
      : rootMeta.circuits.filter((n) => !n.startsWith(pre));
    await writeMeta(context, rootMeta, '');
  }
}

/**
 * 文件身份的全表层迁移/清空（G1 三路共源的**文件路**，2026-10-17 审查补）：
 * 旧实现（改名/删除）只扫 `dirChain(oldFull)`——被改名文件的**祖先链**。但任何目录的表都可能用
 * `../` 相对写法指到这颗文件（如 lib 表值 `../fsm.djs`）：祖先链扫不到 ⇒ 引用悬空＝"绑了却没生效"。
 * 与 migratePrefix 同一把 `tableDirsOf` 全表层扫法，匹配从 startsWith 收紧为**精确身份**：
 *  ① 绑定值解析后 === oldFull ⇒ 重映射（newFull=null＝删除 ⇒ 清）
 *  ② `宿主::`前缀键的宿主 === oldFull ⇒ 键随迁（或整键清）
 *  ③ 根表 circuits 精确名单随迁/清除
 */
export async function migrateFileRef(
  context: vscode.ExtensionContext,
  oldFull: string,
  newFull: string | null,
): Promise<void> {
  for (const dir of await tableDirsOf(context)) {
    const m = await readMetaAt(context, dir);
    if (!m) continue;
    const rewrite = (t: string): string =>
      dir && t.startsWith(`${dir}/`) ? t.slice(dir.length + 1) : relFrom(dir, t);
    const out: Record<string, string> = {};
    for (const [k, raw] of Object.entries(m.bindings)) {
      if (typeof raw !== 'string') { out[k] = raw as string; continue; }
      let dropped = false;
      let newKey = k;
      let newVal = raw;
      if (k.includes('::')) {
        const sep = k.lastIndexOf('::');
        const hostFull = resolveLayerValue(dir, normalizePartName(k.slice(0, sep)));
        if (hostFull === oldFull) {
          if (!newFull) dropped = true;                     // 删除 ⇒ 宿主没了，整键清
          else newKey = `${rewrite(newFull)}::${k.slice(sep + 2)}`;
        }
      }
      if (!dropped) {
        const full = resolveLayerValue(dir, normalizePartName(raw));
        if (full === oldFull) {
          if (!newFull) dropped = true;                     // 删除 ⇒ 值断了，清
          else newVal = rewrite(newFull);
        }
      }
      if (!dropped) out[newKey] = newVal;
    }
    if (JSON.stringify(out) !== JSON.stringify(m.bindings)) {
      await writeMeta(context, { circuits: m.circuits || [], bindings: out, _extra: m._extra }, dir);
    }
  }
  // 根表 circuits 精确名单（显式取消语义在根——与 getCircuitsSet 同层）
  const rootMeta = await readMeta(context);
  if (rootMeta.circuits.includes(oldFull)) {
    rootMeta.circuits = newFull
      ? rootMeta.circuits.map((n) => (n === oldFull ? newFull : n))
      : rootMeta.circuits.filter((n) => n !== oldFull);
    await writeMeta(context, rootMeta, '');
  }
}

/* ================= 右键三件套（C9/C10/C11）：移动到 / 复制路径 / 在磁盘显示 ================= */

/** 扫全工作区的目录清单（QuickPick「移动到」用；跳过 node_modules/点开头，深度 16 护栏）。 */
export async function scanDirChoices(context: vscode.ExtensionContext): Promise<Array<{ rel: string; uri: vscode.Uri }>> {
  const root = projectRoot(context);
  const out: Array<{ rel: string; uri: vscode.Uri }> = [{ rel: '', uri: root }];
  const walk = async (dirRel: string, depth: number): Promise<void> => {
    if (depth > 16) return;
    let entries: Array<[string, number]>;
    try { entries = await then(vscode.workspace.fs.readDirectory(dirRel ? vscode.Uri.joinPath(root, ...dirRel.split('/')) : root)); }
    catch { return; }
    for (const [name, type] of entries) {
      if (type !== 2 || name === 'node_modules' || name.startsWith('.')) continue;
      const rel = dirRel ? `${dirRel}/${name}` : name;
      out.push({ rel, uri: vscode.Uri.joinPath(root, ...rel.split('/')) });
      await walk(rel, depth + 1);
    }
  };
  await walk('', 1);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/* ================= M7 一次性归一清扫（幂等）：盘名 `x.djs.djs` 裁尾 + 各层表值归一写回 ================= */

/** 收集 root 下所有目录（含根的 ''）：跳过 node_modules 与点开头目录（配置表所在目录必含部件或用户手放过）。 */
async function collectTableDirs(dir: vscode.Uri, rootPathL: string, depth = 16, acc: string[] = []): Promise<string[]> {
  if (depth <= 0) return acc;
  let entries: Array<[string, number]> = [];
  try { entries = await then(vscode.workspace.fs.readDirectory(dir)); } catch { return acc; }
  for (const [name, type] of entries) {
    if (type !== 2 || name === 'node_modules' || name.startsWith('.')) continue;
    const child = vscode.Uri.joinPath(dir, name);
    // ⚠ 第七份"按根串长度切"（R153 深度自检在册）：两侧都在调用方统一 toLowerCase＋去尾分隔符，
    //    所以那颗盘符大小写的雷在这一条上不成形；改成 rootRel 要换递归签名的入参形状，
    //    不在自检批里动热路。判它安全的尺＝rootPathL 与 child.fsPath 必须同源归一。
    acc.push(child.fsPath.slice(rootPathL.length).replace(/^[\\/]/, '').replace(/\\/g, '/'));
    await collectTableDirs(child, rootPathL, depth - 1, acc);
  }
  return acc;
}

/**
 * M7 归一清扫（activate fire-and-forget，幂等——第二遍零输出）：
 * 1. 盘上文件名 `x.djs.djs`（旧双后缀写入缺陷的残留）⇒ 裁成 `x.djs`（冲突跳过并记录，⛔ 覆盖）；
 * 2. 扫每张 `.verilogviz.json`：bindings 值按「normalizePartName 折叠后按本层重新相对化」写回；
 *    含 `::` 前缀键 ⇒ 前缀同样归一，且**宿主被本趟改名时前缀随迁**（复用 rename 迁移语义的键形版）。
 * 返回 {files, tables}＝被改动的盘名/表清单，调用侧据此广播。
 */
export async function normalizeBindingsDisk(context: vscode.ExtensionContext): Promise<{ files: string[]; tables: string[] }> {
  const root = projectRoot(context);
  const files: string[] = [];
  const renamed = new Map<string, string>();               // old root-rel → new root-rel
  // —— 1. 盘名裁尾 ——
  const djs = await findSandboxUris();
  for (const u of djs) {
    if (!/(\.djs){2,}$/i.test(u.path)) continue;
    const parent = vscode.Uri.joinPath(u, '..');
    const base = (u.path.split('/').pop() || '').replace(/(\.djs)+$/i, '.djs');
    let target = vscode.Uri.joinPath(parent, base);
    const occupied = await then(vscode.workspace.fs.stat(target)).then(() => true, () => false);
    if (occupied) {
      let i = 2;
      let cand = base.replace(/\.djs$/i, ` (${i}).djs`);
      while (await then(vscode.workspace.fs.stat(vscode.Uri.joinPath(parent, cand))).then(() => true, () => false)) cand = base.replace(/\.djs$/i, ` (${++i}).djs`);
      target = vscode.Uri.joinPath(parent, cand);
    }
    try {
      await then(vscode.workspace.fs.rename(u, target, { overwrite: false }));
      files.push(pathRel(root, u));
      renamed.set(pathRel(root, u).toLowerCase(), pathRel(root, target));
    } catch { /* 单颗失败不拦全局 */ }
  }
  // —— 2. 表值/前缀键归一写回 ——
  const tables: string[] = [];
  const rootPathL = root.fsPath.replace(/[\\/]+$/, '').toLowerCase();
  const dirs = ['', ...await collectTableDirs(root, rootPathL)];
  for (const dir of dirs) {
    const m = await readMetaAt(context, dir);
    if (!m) continue;
    let touched = false;
    for (const [k, raw] of Object.entries(m.bindings || {})) {
      let newKey = k;
      let newVal: unknown = raw;
      if (k.includes('::')) {
        // 前缀键：宿主归一（裁双尾）＋若宿主被本趟裁尾改名 ⇒ 前缀随迁；键与值的相对书写统一重算
        const sep = k.lastIndexOf('::');
        const host = k.slice(0, sep); const inst = k.slice(sep + 2);
        const hostFull = resolveLayerValue(dir, normalizePartName(host));
        const hostFinal = renamed.get(hostFull.toLowerCase()) || hostFull;
        const wantHost = relFrom(dir, hostFinal);
        if (wantHost !== host) newKey = `${wantHost}::${inst}`;
      }
      if (typeof raw === 'string') {
        const norm = relFrom(dir, resolveLayerValue(dir, normalizePartName(raw)));
        if (norm !== raw) newVal = norm;
      }
      if (newKey !== k) { delete m.bindings[k]; m.bindings[newKey] = newVal as string; touched = true; }
      else if (newVal !== raw) { m.bindings[k] = newVal as string; touched = true; }
    }
    if (touched) { await writeMeta(context, { circuits: m.circuits || [], bindings: m.bindings, _extra: m._extra }, dir); tables.push(dir || '/'); }
  }
  return { files, tables };
}
