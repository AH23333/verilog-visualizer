// Shared sandbox graph serialization.
//
// WHY NOT paper.model.toJSON(): digitaljs cells carry runtime objects in their
// attrs (Vector3vl `signal` instances, nested Subcircuit `graph` Graphs). joint's
// toJSON deep-clones attributes and HANGS on those cyclic/prototype-heavy values.
// serializePaper builds a WHITELIST cell shape instead — the same shape the
// sandbox's own save/load pipeline (and loadCells) consumes.

import { DEVICE_PARAM_KEYS, paramValue } from './deviceParams';
import { MIRROR_VER_LOCAL } from './cellMirror';

/**
 * Whitelist-serialize a live Graph (R34: graph-level variant).
 *
 * Used both by serializePaperCells (paper wrapper) and directly for
 * Subcircuit cells whose `graph` is a live joint.dia.Graph but which lack a
 * serializable `subcircuitGraph` attr — exactly the case for COMPILE-MODE
 * subcircuits (Circuit._makeGraph only sets `graph`), whose loss made
 * 「复制到沙盒」drop every module instance and its wires (R34 用户报告).
 */
export function serializeGraphCells(graph: any): { cells: any[] } {
  return { cells: serializeCellsOf(() => graph.getCells()) };
}

function serializeCellsOf(getCells: () => any[]): any[] {
  return getCells().map((c: any) => {
    const type = c.get('type');
    const cell: any = {
      id: c.id,
      type,
      position: c.get('position'),
      attrs: c.get('attrs'),
      size: c.get('size'),
      bits: c.get('bits'),
      net: c.get('net'),
      celltype: c.get('celltype'),
      label: c.get('label'),
      // IO 引脚排序键：yosys2digitaljs 给每个 Input/Output 写 order，digitaljs 的
      // Subcircuit.initialize 有 order 时按它排端口，没有就退回按 net 名字母序。
      // 不带上它，部件文件的引脚顺序就和编译模式对不上（sum/cout 上下颠倒）。
      order: c.get('order'),
      memdataInit: c.get('memdataInit'),
    };
    // 器件参数一律按 deviceParams 的清单整体带上：以往这里、sandboxLoad、
    // subcircuitView 两个方向各写一份字段链，清单靠人手对齐，digitaljs 构造期
    // 读走的 extend/arst_value/srst_value 就是这么被静默吞掉的。
    for (const k of DEVICE_PARAM_KEYS) {
      const v = paramValue(k, c);
      if (v != null) cell[k] = v;
    }
    // R113：mirror 语义版本标记。新语义＝器件**本地轴**（mirrorVer 2）；
    // 旧存档没有这个字段，sandboxLoad 的 migrateMirror 会按旧屏幕语义换算过来。
    // 不写标记的话，每次存盘重开都会把已迁移的器件再迁移一次（h/v 又对调回去）。
    if (cell.mirror && (cell.mirror.h || cell.mirror.v)) cell.mirrorVer = MIRROR_VER_LOCAL;
    if (type === 'Subcircuit') {
      cell.subcircuitGraph = c.get('subcircuitGraph');
      // 编译模式的 Subcircuit 只有活 `graph`（joint.dia.Graph），没有可序列化的
      // subcircuitGraph 属性 —— 这里兜底白名单序列化，模块实例才能原样进沙盒。
      if (!cell.subcircuitGraph) {
        const liveGraph = c.get('graph');
        if (liveGraph && typeof liveGraph.getCells === 'function') {
          // 必须包成 {cells:[...]}：loadCells / buildInnerGraph 都按 json.cells 消费
          cell.subcircuitGraph = { cells: serializeCellsOf(() => liveGraph.getCells()) };
        }
      }
    }
    if (type === 'Memory' && c.memdata) {
      try {
        const mem: any = c.memdata;
        const nWords = Math.min(1 << (Number(c.get('abits')) || 2), 256);
        cell.memdataInit = Array.from({ length: nWords }, (_, a) => {
          const v = mem.get(a);
          return v ? String(v).replace(/^Vector3vl\s+/, '') : 'x';
        });
      } catch { /* ignore */ }
    }
    const isLink = (typeof c.isLink === 'function' && c.isLink()) || /^(link|wire|djs\.wire)$/i.test(String(type));
    if (isLink) {
      cell.isLink = true;
      cell.source = c.get('source');
      cell.target = c.get('target');
      cell.netname = c.get('netname');
      cell.vertices = c.get('vertices');
      cell.bits = c.get('bits');
    }
    Object.keys(cell).forEach((k) => cell[k] === undefined && delete cell[k]);
    return cell;
  });
}

export function serializePaperCells(paper: any): { cells: any[] } {
  return { cells: serializeCellsOf(() => paper.model.getCells()) };
}

export function serializePaperJson(paper: any): string {
  return JSON.stringify(serializePaperCells(paper));
}
