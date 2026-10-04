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
import { resolveDefCells } from './gateSystem';

export interface LoadCellsOptions {
  /** 绑定作用域：本画布文件所在文件夹（部件解析优先同文件夹，R39） */
  scope?: string;
  /** id 重映射：oldId → newId（粘贴/多次插入防 id 冲突） */
  idMap?: Map<string, string>;
  /** 位置偏移（模型坐标） */
  dx?: number;
  dy?: number;
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
    if (c.isLink) continue;
    const pos = c.position || { x: 50, y: 50 };
    const px = (pos.x || 50) + dx;
    const py = (pos.y || 50) + dy;
    const cid = mapId(c.id);
    if (c.type === 'Subcircuit') {
      // R39 绑定加载：优先内嵌快照（旧档/未迁移），否则按 celltype 解析部件文件
      // （resolveDefCells 递归物化嵌套 → 自足 cells，buildInnerGraph 可直接消费）
      let innerSrc = c.subcircuitGraph || c.graph;
      if (!innerSrc?.cells?.length) {
        innerSrc = resolveDefCells(String(c.celltype || ''), scope) || undefined;
      }
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
    const cellExtra: Record<string, any> = {};
    if (c.type === 'Dff' && c.polarity) cellExtra.polarity = c.polarity;
    if (c.type === 'Dff' && c.initial != null) cellExtra.initial = c.initial;
    if (c.type === 'Constant' && c.constant) cellExtra.constant = c.constant;
    if ((c.type === 'BusGroup' || c.type === 'BusUngroup') && Array.isArray(c.groups)) cellExtra.groups = new Map(c.groups);
    if (c.type === 'BusSlice' && c.slice) cellExtra.slice = c.slice;
    if (c.type === 'Memory') {
      // 端口由 rdports/wrports 生成，必须构造时给出（事后 set 不重建端口）；
      // bits 同理决定 data 端口位宽，一并构造时传入
      if (c.bits != null) cellExtra.bits = c.bits;
      if (c.abits != null) cellExtra.abits = c.abits;
      if (Array.isArray(c.rdports)) cellExtra.rdports = c.rdports;
      if (Array.isArray(c.wrports)) cellExtra.wrports = c.wrports;
      if (c.memdataInit) {
        // digitaljs 的 Memory.prepare() 只认构造属性 memdata（Mem3vl.fromJSON）——
        // 只带 memdataInit 的话 memdata 全 x 初始化，组合读（rdports 无 clock_polarity）
        // 永远读出 x（R28 根因）。memdataInit 快照字段保留给 serializePaper/内存编辑器。
        cellExtra.memdata = c.memdataInit;
        cellExtra.memdataInit = c.memdataInit; // restoreMemoryData 回写用
      }
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
      cellMap.set(cid ?? cell.id, cell);
    }
  }
  let wireTotal = 0, wireSkipNoSrc = 0, wireSkipNoTgt = 0, wireOk = 0;
  for (const c of saved.cells || []) {
    if (!c.isLink) continue;
    wireTotal++;
    try {
      const srcCell = cellMap.get(mapId(c.source?.id));
      const tgtCell = cellMap.get(mapId(c.target?.id));
      if (!srcCell) wireSkipNoSrc++;
      if (!tgtCell) wireSkipNoTgt++;
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
      wireOk++;
    } catch { /* skip broken link */ }
  }
  console.log('[loadCells] wire stats:', { wireTotal, wireOk, wireSkipNoSrc, wireSkipNoTgt, cellsInMap: cellMap.size, sampleCellIds: [...cellMap.keys()].slice(0,3), sampleWireSrc: saved.cells.filter(c=>c.isLink).slice(0,3).map(c=>c.source?.id) });
}
