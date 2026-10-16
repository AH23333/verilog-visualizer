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

export const META_FILE = '.verilogviz.json';

const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

/**
 * 部件角色语义（回摆裁决 2026-10-15）：**兄弟 .djs 缺省全是部件**（与旧 doc 模式行为一致
 * ——refreshGates/绑定解析都靠它），`.verilogviz.json` 的 `circuits` 名单是**显式取消**表
 * （「取消部件」往里加，「设为部件」从里删）。⛔ 用 parts 正向名单：空名单＝全不是部件＝
 * 沙盒画布右键无一件可放（真机踩过）。
 */
interface VvMeta { circuits: string[]; bindings: Record<string, string> }

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
    return {
      circuits: Array.isArray(meta?.circuits) ? meta.circuits.map(String) : [],
      bindings: meta?.bindings && typeof meta.bindings === 'object' ? meta.bindings : {},
    };
  } catch { return null; }
}

async function readMeta(context: vscode.ExtensionContext): Promise<VvMeta> {
  return (await readMetaAt(context, '')) || { circuits: [], bindings: {} };
}

async function writeMeta(context: vscode.ExtensionContext, meta: VvMeta, dirRel = ''): Promise<void> {
  const uri = metaUri(context, dirRel);
  await then(vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..')));
  await then(vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(meta, null, 2) + '\n')));
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

/** 同目录表内相对化：'../sub/x.djs' 形态（部件不在文档目录时用相对跳转；链解析侧按层目录回根相对）。 */
function relFrom(dir: string, rootRel: string): string {
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

/** 「打开绑定配置」：定位文档目录表（无则 ensure 建）→ 原生编辑器直开（可手改，保存即生效）。 */
export async function openBindingConfig(context: vscode.ExtensionContext, docUri: vscode.Uri | null): Promise<void> {
  const root = projectRoot(context);
  const dirRel = docUri ? (pathRel(root, docUri).split('/').filter((_seg, i, a) => i < a.length - 1).join('/')) : '';
  const uri = metaUri(context, dirRel);
  try { await then(vscode.workspace.fs.stat(uri)); }
  catch { await writeMeta(context, { circuits: [], bindings: {} }, dirRel); }
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

function pathRel(root: vscode.Uri, uri: vscode.Uri): string {
  const rootFs = root.fsPath.replace(/[\\/]+$/, '');
  return uri.fsPath.slice(rootFs.length + 1).replace(/\\/g, '/');
}

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

/** 打开电路画布（树项菜单与双击同语义；⛔ showTextDocument） */
export async function openDoc(uri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', uri, 'verilogViz.doc');
}

export async function renameFile(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  const name = uri.path.split('/').pop() || uri.fsPath;
  const next = await vscode.window.showInputBox({ prompt: '重命名', value: name });
  if (!next || next === name) return;
  try {
    const target = vscode.Uri.joinPath(vscode.Uri.joinPath(uri, '..'), next);
    await then(vscode.workspace.fs.rename(uri, target, { overwrite: false }));
    // role 跟随改名（⛔ 改名后部件身份丢失）
    const root = projectRoot(context);
    const oldFull = pathRel(root, uri);
    // target 串可能带未折的 `../`（桩/极端 joinPath 形状；真宿主会归一）——过 resolveLayerValue 折死，双保险
    const newFull = resolveLayerValue('', pathRel(root, target));
    // circuits 是**根表**语义（与 getCircuitsSet 同层），迁移也必须在根表做（⛔ 去文档层表找它）
    const rootMeta = await readMeta(context);
    let touched = false;
    if (rootMeta.circuits.includes(oldFull)) {
      rootMeta.circuits = rootMeta.circuits.map((n) => (n === oldFull ? newFull : n));
      await writeMeta(context, rootMeta, '');
      touched = true;
    }
    // R137：绑定值也迁移（旧路径改名 ⇒ 引用悬空＝"绑了却没生效"；值可能写在祖先层表里，逐层扫）
    for (const chainDir of dirChain(oldFull)) {
      const m = await readMetaAt(context, chainDir);
      if (!m) continue;
      let hit = false;
      for (const [k, v] of Object.entries(m.bindings)) {
        // R145：`宿主::实例` 前缀键的宿主被改名 ⇒ 键迁移（指旧文档的精控⛔ 悬空）
        if (k.includes('::')) {
          const hostRel = resolveLayerValue(chainDir, normalizePartName(k.slice(0, k.lastIndexOf('::'))));
          if (hostRel === oldFull) {
            const nh = chainDir && newFull.startsWith(`${chainDir}/`) ? newFull.slice(chainDir.length + 1) : relFrom(chainDir, newFull);
            m.bindings[`${nh}${k.slice(k.lastIndexOf('::'))}`] = v; delete m.bindings[k]; hit = true; continue;
          }
        }
        const resolved = resolveLayerValue(chainDir, normalizePartName(String(v || '')));
        if (resolved === oldFull) {
          m.bindings[k] = chainDir && newFull.startsWith(`${chainDir}/`) ? newFull.slice(chainDir.length + 1) : relFrom(chainDir, newFull);
          hit = true;
        }
      }
      if (hit) { await writeMeta(context, m, chainDir); touched = true; }
    }
    void touched; // 广播由调用侧（extension.ts 命令层）统一处理：避免 dispatch↔sandboxFiles 循环依赖
  } catch (e) {
    void vscode.window.showErrorMessage(`重命名失败：${String(e instanceof Error ? e.message : e)}`);
  }
}

export async function deleteFile(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  const name = uri.path.split('/').pop() || uri.fsPath;
  const pick = await vscode.window.showWarningMessage(`删除「${name}」？`, { modal: true }, '删除');
  if (pick !== '删除') return;
  await then(vscode.workspace.fs.delete(uri, { useTrash: true }));
  const root = projectRoot(context);
  const deletedFull = pathRel(root, uri);
  // circuits 清理（根表）
  const meta = await readMeta(context);
  let changed = false;
  if (meta.circuits.includes(deletedFull)) {
    meta.circuits = meta.circuits.filter((n) => n !== deletedFull);
    await writeMeta(context, meta, '');
    changed = true;
  }
  // R137：指向被删部件的绑定逐层清除（悬空绑定=渲染失败无提示的另一来源）
  for (const chainDir of dirChain(deletedFull)) {
    const m = await readMetaAt(context, chainDir);
    if (!m) continue;
    let hit = false;
    for (const [k, v] of Object.entries(m.bindings)) {
      if (k.includes('::') && resolveLayerValue(chainDir, normalizePartName(k.slice(0, k.lastIndexOf('::')))) === deletedFull) { delete m.bindings[k]; hit = true; continue; }   // R145 前缀键宿主删除
      if (resolveLayerValue(chainDir, normalizePartName(String(v || ''))) === deletedFull) { delete m.bindings[k]; hit = true; }
    }
    if (hit) { await writeMeta(context, m, chainDir); changed = true; }
  }
  void changed;
}

export async function duplicateFile(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  const dir = vscode.Uri.joinPath(uri, '..');
  const name = uri.path.split('/').pop() || 'copy.djs';
  const target = await uniqueName(dir, name);
  await then(vscode.workspace.fs.copy(uri, vscode.Uri.joinPath(dir, target), { overwrite: false }));
  void context; // role 不随副本（新副本默认 circuit）
}

/** 复制文件夹（旧 UI「复制文件夹」的原生落点）：`x` → `x 副本 (n)`，fs.copy 递归。 */
export async function duplicateFolder(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  const dir = vscode.Uri.joinPath(uri, '..');
  const name = uri.path.split('/').filter(Boolean).pop() || 'folder';
  let candidate = `${name} 副本`;
  for (let i = 2; await then(vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, candidate))).then(() => true, () => false); i++) {
    candidate = `${name} 副本 (${i})`;
  }
  await then(vscode.workspace.fs.copy(uri, vscode.Uri.joinPath(dir, candidate), { overwrite: false }));
  // 副本里有 .djs（部件目录）才配得上「目录有部件就有表」——真扫一层，⛔ 空目录也建表
  const root = projectRoot(context);
  const targetRel = `${pathRel(root, vscode.Uri.joinPath(dir, candidate))}`;
  if (await hasDjsUnder(vscode.Uri.joinPath(dir, candidate))) await ensureDirMeta(context, targetRel);
}

/** 递归探测目录下是否存在 `.djs`（一层层 readDirectory；深度 8 护栏挡软链环） */
async function hasDjsUnder(dir: vscode.Uri, depth = 8): Promise<boolean> {
  if (depth <= 0) return false;
  try {
    for (const [name, type] of await then(vscode.workspace.fs.readDirectory(dir))) {
      if (/\.(v|djs)$/i.test(name)) return true;
      if (type === 2 && await hasDjsUnder(vscode.Uri.joinPath(dir, name), depth - 1)) return true;
    }
  } catch { /* 读不到＝当作没有 */ }
  return false;
}

/**
 * 导入外部文件进工作区（旧 UI「导入文件…」）：原生多选 `.v/.sv/.djs` → 落右击目录（⛔ 同名覆盖，自动 (n)）
 * → `.djs` 触发「目录有部件就有表」。返回全部落盘名（取消＝undefined）。
 */
export async function importFiles(context: vscode.ExtensionContext, dirUri?: vscode.Uri): Promise<string[] | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: true,
    openLabel: '导入',
    filters: { 'Verilog / 电路文件': ['v', 'sv', 'djs'] } as any,
  });
  if (!picked || !picked.length) return undefined;
  const root = projectRoot(context);
  const dir = dirUri ?? root;
  const written: string[] = [];
  for (const src of picked) {
    const base = src.path.split('/').filter(Boolean).pop() || 'imported.v';
    const withExt = /\.(v|sv|djs)$/i.test(base) ? base : `${base}.v`;
    const final = await uniqueName(dir, withExt);
    await then(vscode.workspace.fs.copy(src, vscode.Uri.joinPath(dir, final), { overwrite: false }));
    written.push(pathRel(root, vscode.Uri.joinPath(dir, final)));
  }
  await ensureDirsMeta(context, written);
  return written;
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
 *  `.djs`：cells 逐层展开，打分复刻 gateSystem（同目录 part0→同目录1→根 part2→根3→其他）。 */
export async function collectInstanceHits(context: vscode.ExtensionContext, docRel: string): Promise<BindingHit[]> {
  const root = projectRoot(context);
  const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const recorded = await bindingsForFile(context, docRel);
  const hits: BindingHit[] = [];
  let budget = 300;
  if (/\.djs$/i.test(docRel)) {
    const [uris, circuits] = await Promise.all([
      vscode.workspace.findFiles('**/*.djs', '**/node_modules/**'),
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
        if (recorded[`${doc}::${inst}`] || recorded[inst]) continue;          // 已录入＝表说了算，⛔ 进 hits
        const f = resolve(dirOf(doc), inst);
        if (f) { hits.push({ ctx: doc, name: inst, file: f }); if (!visited.has(f.toLowerCase())) { visited.add(f.toLowerCase()); queue.push(f); } }
      }
    }
  } else {
    const [{ scanDefs, closureOf }, { parseVerilogInstances }] = await Promise.all([import('./compilePanel'), import('./verilogParseLite')]);
    const [defs, job] = await Promise.all([scanDefs(), closureOf(context, vscode.Uri.joinPath(root, ...docRel.split('/')))]);
    for (const f of job.files) {
      for (const inst of [...new Set(parseVerilogInstances(f.content))]) {
        if (inst === job.topModule) continue;
        if (recorded[`${f.name}::${inst}`] || recorded[inst]) continue;       // 该层已精控/全局已录 ⇒ 不算未配置
        const def = defs.get(inst);
        if (def) hits.push({ ctx: f.name, name: inst, file: pathRel(root, def) });
      }
    }
  }
  return hits;
}

/* ================= M7 一次性归一清扫（幂等）：盘名 `x.djs.djs` 裁尾 + 各层表值归一写回 ================= */

/** 收集 root 下所有目录（含根的 ''）：跳过 node_modules 与点开头目录（配置表所在目录必含部件或用户手放过）。 */
async function collectTableDirs(dir: vscode.Uri, rootPathL: string, depth = 8, acc: string[] = []): Promise<string[]> {
  if (depth <= 0) return acc;
  let entries: Array<[string, number]> = [];
  try { entries = await then(vscode.workspace.fs.readDirectory(dir)); } catch { return acc; }
  for (const [name, type] of entries) {
    if (type !== 2 || name === 'node_modules' || name.startsWith('.')) continue;
    const child = vscode.Uri.joinPath(dir, name);
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
  const djs = await vscode.workspace.findFiles('**/*.djs', '**/node_modules/**');
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
    if (touched) { await writeMeta(context, { circuits: m.circuits || [], bindings: m.bindings }, dir); tables.push(dir || '/'); }
  }
  return { files, tables };
}
