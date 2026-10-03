// Shared sandbox graph serialization.
//
// WHY NOT paper.model.toJSON(): digitaljs cells carry runtime objects in their
// attrs (Vector3vl `signal` instances, nested Subcircuit `graph` Graphs). joint's
// toJSON deep-clones attributes and HANGS on those cyclic/prototype-heavy values.
// serializePaper builds a WHITELIST cell shape instead — the same shape the
// sandbox's own save/load pipeline (and loadCells) consumes.

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
      propagation: c.get('propagation'),
      angle: c.get('angle'),
      constant: c.get('constant'),
      polarity: c.get('polarity'),
      initial: c.get('initial'),
      groups: c.get('groups') instanceof Map ? Array.from(c.get('groups').entries()) : undefined,
      slice: c.get('slice'),
      abits: c.get('abits'),
      rdports: c.get('rdports'),
      wrports: c.get('wrports'),
      memdataInit: c.get('memdataInit'),
    };
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
    if (c.isLink()) {
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
