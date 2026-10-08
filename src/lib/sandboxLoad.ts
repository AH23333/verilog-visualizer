// 沙盒画布装载库：把白名单 cells JSON 恢复到 paper 上。
//
// 从 SandboxCanvas.tsx 抽出（R35 架构拆分），三个消费方共用同一条实现：
//  - 打开/重建沙盒文件（rebuildFromJson）
//  - 插入内置示例（id 重映射 + 平移）
//  - 「粘贴复制的电路」（主模式复制 → 沙盒任意文件中原样粘贴）
//
// Subcircuit 内部图经 buildInnerGraph 重建（含 IO net 去重，防
// "found id duplicities in ports"），其余器件走 spawnCell 统一路径。

import { buildInnerGraph } from './subcircuit';
import { serializeGraphCells } from './sandboxSerialize';
import { ctorParams } from './deviceParams';
import { resolveDefCells } from './gateSystem';
import { applyMirror, MIRROR_VER_LOCAL } from './cellMirror';

export interface LoadCellsOptions {
  /** 绑定作用域：本画布文件所在文件夹（部件解析优先同文件夹，R39） */
  scope?: string;
  /** id 重映射：oldId → newId（粘贴/多次插入防 id 冲突） */
  idMap?: Map<string, string>;
  /** 位置偏移（模型坐标） */
  dx?: number;
  dy?: number;
}

/**
 * R113 存档迁移：mirror 从**屏幕语义**换成**器件本地语义**（见 cellMirror 文件头）。
 * 旧存档没有版本标记，按下面的规则还原成新语义：
 *   旧语义下用户点的轴会按当时的 angle 换算成本地轴落地：
 *     angle ∈ {90,270} ⇒ 用户点的 h 落到本地 v、反之亦然；
 *     其它角度 ⇒ 用户点的 h 落到本地 h。
 *   反推即：**带角度的旧器件，h/v 对调**；angle 为 0/180 的不动。
 * 新写出的存档一律带 `mirrorVer: 2`，不再迁移（幂等：迁移只认没有标记的）。
 * ⚠ 版本常量从 cellMirror 导入，序列化侧（sandboxSerialize）也用同一个 ——
 *   两处各写一个数字早晚会对不上。
 */

function migrateMirror(saved: any, cell: any): boolean {
  const m = saved?.mirror;
  if (!m || typeof m !== 'object') return false;
  const ver = Number(saved?.mirrorVer || 0);
  if (ver >= MIRROR_VER_LOCAL) return !!(m.h || m.v);
  // 旧屏幕语义 → 新本地语义
  let local: { h?: boolean; v?: boolean } | null = null;
  if (m.h || m.v) {
    const a = ((Number(cell?.get?.('angle') || 0) % 360) + 360) % 360;
    const swap = a === 90 || a === 270;
    local = swap ? { h: !!m.v, v: !!m.h } : { h: !!m.h, v: !!m.v };
    if (!local.h && !local.v) local = null;
  }
  try { cell?.prop?.('mirror', local); } catch { /* ignore */ }
  return !!local;
}

export function loadCells(
  paper: any,
  digitaljs: any,
  json: string,
  spawnCell: (type: string, x: number, y: number, id?: string, extra?: Record<string, any>) => any,
  wireCountRef: { current: number },
  opts: LoadCellsOptions = {},
) {
  const saved = JSON.parse(json);
  const Graph = (paper.model as any).constructor;
  const { idMap, dx = 0, dy = 0, scope = '' } = opts;
  const mapId = (id: any) => (idMap && id != null && idMap.has(String(id))) ? idMap.get(String(id)) : id;
  const cellMap = new Map<string, any>();
  for (const c of saved.cells || []) {
    // 兼容旧格式：有 source+target 的是 wire，跳过
    if (c.isLink || (c.source && c.target && c.source.id && c.target.id)) continue;
    const pos = c.position || { x: 50, y: 50 };
    const px = (pos.x || 50) + dx;
    const py = (pos.y || 50) + dy;
    const cid = mapId(c.id);
    if (c.type === 'Subcircuit') {
      // R39 绑定加载 → R100 调整优先级：**按 celltype 解析部件定义优先**（文件级
      // partBindings 最高 → 文件夹作用域打分），解析不到再退回内嵌快照（旧档/部件
      // 已删）。这样「绑定...」改绑后重开文件即生效（与编译模式 moduleBindings 同语义），
      // 部件文件的原地编辑也能随重开落到实例上。
      const defCells = c.celltype ? resolveDefCells(String(c.celltype), scope) : null;
      let innerSrc = (defCells?.cells?.length ? defCells : null)
        || c.subcircuitGraph || c.graph;
      const GraphCtor2 = Graph;
      const inner = innerSrc
        ? buildInnerGraph(digitaljs, GraphCtor2, innerSrc, paper.model._display3vl)
        : (() => { const g = new GraphCtor2(); g._display3vl = paper.model._display3vl; g._warnings = 0; g.set('subcircuit', true); return g; })();
      const subArgs: any = {
        type: 'Subcircuit',
        graph: inner,
        subcircuitGraph: serializeGraphCells(inner),
        celltype: c.celltype || '',
        position: { x: px, y: py },
      };
      if (cid) subArgs.id = cid;
      const sub = new digitaljs.cells.Subcircuit(subArgs);
      paper.model.addCell(sub);
      if (c.angle) try { sub.set('angle', c.angle); } catch {}
      if (cid) cellMap.set(cid, sub);
      continue;
    }
    // 构造期参数按 deviceParams 的清单整体传入：这些字段 digitaljs 在
    // initialize()/构造期读走，事后 set 会被列进「不支持运行时修改」。
    const cellExtra: Record<string, any> = ctorParams(c);
    if (c.type === 'Memory' && c.memdataInit) {
      // digitaljs 的 Memory.prepare() 只认构造属性 memdata（Mem3vl.fromJSON）——
      // 只带 memdataInit 的话 memdata 全 x 初始化，组合读（rdports 无 clock_polarity）
      // 永远读出 x（R28 根因）。memdataInit 快照字段保留给 serializePaper/内存编辑器。
      cellExtra.memdata = c.memdataInit;
      cellExtra.memdataInit = c.memdataInit; // restoreMemoryData 回写用
    }
    const cell = spawnCell(c.type, px, py, cid, cellExtra);
    if (cell) {
      // 端口自管理类：bits 由构造参数（groups/slice/rdports）或类型本身决定，事后 set('bits')
      // 会触发 change:bits 重建端口（如 Display7 8位→1位），连线随之位宽 warning，
      // 而 digitaljs 在 warning 时会 stop 整个引擎（R28 根因链最后一环）
      const portManaged = ['Display7', 'Memory', 'BusGroup', 'BusUngroup', 'BusSlice'].includes(c.type);
      if (c.bits != null && !portManaged) try { cell.set('bits', c.bits); } catch {}
      if (c.net != null) try { cell.set('net', c.net); } catch {}
      if (c.label != null) try { cell.set('label', c.label); } catch {}
      if (c.celltype != null) try { cell.set('celltype', c.celltype); } catch {}
      if (c.propagation != null) try { cell.set('propagation', c.propagation); } catch {}
      if (c.size) try { cell.set('size', c.size); } catch {}
      if (c.angle) try { cell.set('angle', c.angle); } catch {}
      if (c.initial != null) try { cell.set('initial', c.initial); } catch {}
      if (c.order != null) try { cell.set('order', c.order); } catch {}
      cellMap.set(cid ?? cell.id, cell);
      // 镜像翻转（R99→R100 模型级镜像）：mirror 在构造期名单里（ctorParams 已带上），
      // 但锚点/attrs/图形体的落地要靠 applyMirror 重挂——这里必须调，否则存盘重开镜像消失。
      // paper 传下去做 body 内文本的字形回正。
      const mirrored = migrateMirror(c, cell);
      if (mirrored) { try { applyMirror(cell, paper); } catch { /* ignore */ } }
    }
  }
  for (const c of saved.cells || []) {
    // 兼容旧格式：isLink 标记缺失但有 source+target 的也当 wire 处理
    const isWire = c.isLink || (c.source && c.target && c.source.id && c.target.id);
    if (!isWire) continue;
    try {
      const srcCell = cellMap.get(mapId(c.source?.id));
      const tgtCell = cellMap.get(mapId(c.target?.id));
      if (!srcCell || !tgtCell) continue;
      const srcPort = c.source?.port;
      const tgtPort = c.target?.port;
      const linkArgs: any = {
        source: { id: srcCell.id, port: srcPort },
        target: { id: tgtCell.id, port: tgtPort },
        signal: 'x',
        // 线宽跟住源端口（否则多位信号在恢复的连线上被截坏）
        bits: (() => { const b = srcCell.getPort?.(srcPort)?.bits; if (typeof b === 'number') return b; const n = Number(b?.in ?? b?.out ?? b); return Number.isFinite(n) && n > 0 ? n : 1; })(),
        netname: c.netname || `N${++wireCountRef.current}`,
      };
      if (c.vertices) linkArgs.vertices = c.vertices;
      const link = new digitaljs.cells.Wire(linkArgs);
      paper.model.addCell(link);
    } catch { /* skip broken link */ }
  }
}
