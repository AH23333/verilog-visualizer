import * as vscode from 'vscode';
import { projectRoot } from './dispatch';
import { vscodeFs } from './dispatch';
import { bindingsForFile, setBinding, META_FILE, openBindingConfig, collectInstanceHits, relFrom } from './sandboxFiles';
import { closureOf, scanDefs } from './compilePanel';
import { parseVerilogInstances, parseVerilogModules } from './verilogParseLite';
import { ProjectStore } from './projectStore';
import { isBindingTargetValue, isVerilogPath, rootRel } from './verilogDomain';

const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

// 根相对名转交一颗主人（R153 深度自检：本仓曾有六份各自实现，其中三份截前缀＝盘符大小写一漂就交坏值）
function rel(root: vscode.Uri, uri: vscode.Uri): string { return rootRel(root, uri); }

function basename(rel: string): string {
  const parts = rel.split('/');
  return parts[parts.length - 1];
}

export interface BindingInstance {
  name: string;
  count?: number;
  auto: string | null;
  recorded: string | null;
  /** 2026-10-18 多层点名：深层行的宿主文件（根相对）；顶层行不带＝形状向后兼容 */
  ctx?: string;
  /** 写回/选中主键：顶层＝裸 name；深层＝`宿主::实例` 前缀键（表语义同一把尺） */
  key?: string;
}
export interface BindingData {
  docRel: string;
  docName: string;
  mode: 'djs' | 'verilog';
  instances: BindingInstance[];
  parts: string[];
  meta: string;
}

export async function bindingDataFor(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<BindingData> {
  const root = projectRoot(context);
  const docRel = rel(root, uri);
  const dir = docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : '';
  const recorded = await bindingsForFile(context, docRel);
  const store = new ProjectStore(vscodeFs(root), '@root');

  if (/\.djs$/i.test(uri.fsPath)) {
    const content = new TextDecoder().decode(await then(vscode.workspace.fs.readFile(uri)));
    const tally = new Map<string, number>();
    const cells = JSON.parse(content)?.cells;
    if (Array.isArray(cells)) {
      for (const c of cells as Array<{ type?: string; celltype?: string }>) {
        if (c?.type === 'Subcircuit' && c.celltype) {
          tally.set(String(c.celltype), (tally.get(String(c.celltype)) || 0) + 1);
        }
      }
    }
    const sandbox = await store.listSandboxTree();
    const sandboxFiles = sandbox.files.map((f) => f.name);
    const parts = sandboxFiles
      .filter((n) => n.toLowerCase() !== docRel.toLowerCase())
      .sort((a, b) => a.localeCompare(b));
    const instances: BindingInstance[] = [...tally].map(([name, count]) => {
      const recKey1 = `${docRel}::${name}`;
      const rec = recorded[recKey1] || recorded[name] || null;
      let auto: string | null = null;
      if (sandboxFiles.includes(`${dir}/${name}.djs`)) auto = `${dir}/${name}.djs`;
      else if (dir && sandboxFiles.includes(`${name}.djs`)) auto = `${name}.djs`;
      else if (sandboxFiles.includes(`${name}.djs`)) auto = `${name}.djs`;
      return { name, count, auto, recorded: rec };
    });
    // 多层点名（2026-10-18）：顶层⛔ 是画布的全部——部件文件的**内部实例**同样要录、要能在这张面板改。
    //   行数据直接吃 `collectInstanceHits({all:true})`（宿主模拟画布解析链的**同一颗主人**，⛔ 第二份打分表）。
    try {
      const deep = await collectInstanceHits(context, docRel, { all: true });
      const seenKey = new Set<string>();
      for (const h of deep) {
        if (h.ctx === docRel) continue;                                    // 顶层行 tally 已聚合
        const key = `${h.ctx}::${h.name}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        const rec = recorded[key] || null;
        instances.push({ name: h.name, ctx: h.ctx, key,
          auto: rec ? null : (h.file || null), recorded: rec });
      }
    } catch { /* 深层读不到盘＝只展顶层，⛔ 整颗面板挂掉 */ }
    return {
      docRel,
      docName: docRel,
      mode: 'djs',
      instances,
      parts,
      meta: `${dir ? dir + '/' : ''}${META_FILE}`,
    };
  } else {
    const job = await closureOf(context, uri);
    const tally = new Map<string, number>();
    for (const f of job.files) {
      for (const i of parseVerilogInstances(f.content)) {
        if (i !== job.topModule) tally.set(i, (tally.get(i) || 0) + 1);
      }
    }
    const tree = await store.listTree();
    const sandbox = await store.listSandboxTree();
    const vparts = tree.files.map((f) => f.name);
    const sparts = sandbox.files.map((f) => f.name);
    const parts = [...vparts, ...sparts]
      .filter((n, idx, arr) => arr.findIndex((x) => x === n) === idx)
      .filter((n) => n.toLowerCase() !== docRel.toLowerCase())
      .sort((a, b) => a.localeCompare(b));
    // 「自动同名」的一颗主人＝`scanDefs`（模块名 → **真定义它的文件**，全工作区扫，与「写全配置」同源）。
    // 修前这里拿闭包 `job.files` 建索引：闭包只含**已录入绑定**的文件，而这一栏是给**未录入**实例看的
    // ⇒ 按构造永远命不中（面板对每个未录入实例一直报"未绑定"，盘上明明有那颗实现文件看不见）。
    const defRel = new Map<string, string>();
    for (const [mod, defUri] of await scanDefs()) defRel.set(mod, rel(root, defUri));
    const instances: BindingInstance[] = [...tally].map(([name, count]) => {
      const recKey1 = `${docRel}::${name}`;
      const recRaw = recorded[recKey1] || recorded[name] || null;
      // recorded 值的合法性问一颗主人（原来这里把同一串正则写了两遍，而名单与编译侧已经分岔）
      const rec = recRaw && isBindingTargetValue(recRaw) ? recRaw : null;
      let auto: string | null = defRel.get(name) ?? null;
      if (auto === docRel) auto = null;                     // ⛔ 把自己录成部件
      if (!auto) {
        if (sparts.includes(`${dir}/${name}.djs`)) auto = `${dir}/${name}.djs`;
        else if (sparts.includes(`${name}.djs`)) auto = `${name}.djs`;
      }
      return { name, count, auto, recorded: recRaw && !auto && !rec ? recRaw : (rec || null) };
    });
    return {
      docRel,
      docName: docRel,
      mode: 'verilog',
      instances,
      parts,
      meta: `${dir ? dir + '/' : ''}${META_FILE}`,
    };
  }
}

/* ============ R157⑥ 弹窗会话（用户裁决：⛔ 标签页内部页面） ============ */
// 基座**没有** modal WebviewPanel API（vscode.d.ts/实现层双查无——上游公开 API 至今没有这颗），
// "像加文件一样的页签"改不掉；原生弹窗里能承载"实例清单→部件清单→写表→回清单"完整闭环的
// 只有 QuickInput（VS Code 设置/齿轮菜单同款弹层）。WebviewPanel 壳（binding.html）就此退役。
// 语义全保留：一级逐项标注当前生效解析（已录/自动同名/未绑定）、深层行（宿主::前缀键）、
// 写前校验（同一把尺）、表层相对折键、聚焦行（activeItems）、singleton（新会话顶掉旧会话）。

interface BindingPick extends vscode.QuickPickItem {
  key?: string;
  cfg?: boolean;
  clear?: boolean;
}

/** 会话主人（singleton）：新开的弹窗先 dispose 上一颗——⛔ 叠第二颗让人 Esc 两次才退净。 */
let currentQp: vscode.QuickPick<BindingPick> | undefined;

/** 写前校验的一颗主人（原面板 save 路的语义原样搬）：
 *  编译域目标（.v/.sv/.vh）必须真定义该模块、部件域（.djs/.gate）必须存在——违规⛔ 落表。 */
async function validateBindingTarget(context: vscode.ExtensionContext, instName: string, value: string): Promise<string[]> {
  const absOf = (s: string): vscode.Uri => vscode.Uri.joinPath(projectRoot(context), ...s.split('/'));
  if (isVerilogPath(value)) {
    let mods: string[] | null = null;
    try {
      mods = parseVerilogModules(new TextDecoder().decode(await then(vscode.workspace.fs.readFile(absOf(value)))));
    } catch { /* 读失败也要报 */ }
    if (!mods) return [`「${instName}」→ ${value}：文件读取失败，先确认路径存在。`];
    if (!mods.includes(instName)) return [`「${instName}」→ ${value}：该文件里没有名为「${instName}」的模块（它定义的是：${mods.slice(0, 4).join('、') || '无'}${mods.length > 4 ? '…' : ''}）。`];
  } else if (/\.(djs|gate)$/i.test(value)) {
    try { await then(vscode.workspace.fs.stat(absOf(value))); }
    catch { return [`「${instName}」→ ${value}：部件文件不存在。`]; }
  }
  return [];
}

export async function openBindingPicker(context: vscode.ExtensionContext, uri: vscode.Uri, focus?: string): Promise<void> {
  let data = await bindingDataFor(context, uri);
  // 面板深层行的 key＝根相对前缀（`sub/ctrl.djs::adder`，读侧折叠后的形状）；**进表必须换成
  //   表层目录相对**（`ctrl.djs::adder`）——bindingsForFile 折叠语义按层相对写，两把尺⛔ 混。
  const dirNow = data.docRel.includes('/') ? data.docRel.slice(0, data.docRel.lastIndexOf('/')) : '';
  const tableKey = (k: string): string =>
    k.includes('::') ? `${relFrom(dirNow, k.slice(0, k.lastIndexOf('::')))}${k.slice(k.lastIndexOf('::'))}` : k;

  currentQp?.dispose();
  const qp = vscode.window.createQuickPick<BindingPick>();
  currentQp = qp;
  qp.title = `部件绑定：${basename(data.docRel)}`;
  qp.placeholder = '选实例改绑定；Esc＝完成';
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  const fill = (): void => {
    qp.items = [
      ...data.instances.map((i): BindingPick => ({
        label: i.name,
        description: i.ctx ? `在 ${basename(i.ctx)} 内` : (typeof i.count === 'number' ? `×${i.count}` : ''),
        detail: i.recorded ? `已录 → ${i.recorded}`
          : i.auto ? `自动同名 → ${i.auto}（未录入；选部件即固化）`
          : '未绑定——选一个部件文件写入绑定表',
        key: i.key ?? i.name,
      })),
      { label: '$(gear) 打开绑定配置（.verilogviz.json 手改）', detail: data.meta, cfg: true },
    ];
  };
  fill();

  qp.onDidAccept(() => {
    const sel = qp.activeItems[0];
    if (!sel) return;
    if (sel.cfg) { void openBindingConfig(context, uri); return; }
    const key = sel.key!;
    const inst = data.instances.find((i) => (i.key ?? i.name) === key);
    const cur = inst?.recorded || inst?.auto || '';
    const partQp = vscode.window.createQuickPick<BindingPick>();
    partQp.title = `「${sel.label}」绑定到部件`;
    partQp.placeholder = cur ? `当前生效：${cur}；Esc 返回实例清单` : '选部件文件；Esc 返回实例清单';
    partQp.matchOnDescription = true;
    partQp.matchOnDetail = true;
    partQp.items = [
      ...(inst?.recorded
        ? [{ label: '$(trash) 清除绑定', detail: `删掉记录「${inst.recorded}」（回落同名兜底/未绑定）`, clear: true } as BindingPick]
        : []),
      ...data.parts.map((p): BindingPick => ({ label: p, description: p === cur ? '当前生效' : '' })),
    ];
    if (cur) partQp.activeItems = partQp.items.filter((it) => it.label === cur);
    partQp.onDidAccept(async () => {
      const s = partQp.activeItems[0];
      partQp.hide();
      if (!s) return;
      const value = s.clear ? null : s.label;
      if (value) {
        const errs = await validateBindingTarget(context, sel.label, value);
        if (errs.length) { void vscode.window.showErrorMessage(`绑定未写入：${errs.join('；')}`); return; }
      }
      await setBinding(context, tableKey(key), value, uri);
      data = await bindingDataFor(context, uri);
      fill();
      qp.activeItems = qp.items.filter((it) => it.key === key);   // 编辑中的那颗行保持选中
    });
    partQp.onDidHide(() => partQp.dispose());
    partQp.show();
  });
  qp.onDidHide(() => { if (currentQp === qp) currentQp = undefined; qp.dispose(); });
  // 聚焦行（层次树点进来）：resolve 到写回主键口径——顶层＝裸名；深层＝`宿主::实例`
  if (focus) qp.activeItems = qp.items.filter((it) => it.key === focus || it.label === focus);
  qp.show();
}
