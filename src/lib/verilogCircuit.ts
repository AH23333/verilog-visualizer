// verilog 合成产物的**电路 JSON 后处理**域（卷三十二从 verilog.ts 分离，纯搬家零改语义）。
// 三个函数都只操作 yosys2digitaljs 输出的 {devices,connectors,subcircuits} 结构，
// 不依赖 yosys 运行时——verilog.ts 经 import+re-export 保持外部路径兼容。

/**
 * After io_ui(), top-level Input/Output ports become interactive cells
 * (Button/Clock for inputs, Lamp/NumDisplay for outputs) but their `label`
 * falls back to the auto-generated device key (`dev0`, `dev13`, …), which is
 * meaningless on the canvas. This pass rewrites those labels to the actual
 * port/net name (clk, reset, count) so the diagram reads like a real schematic.
 *
 * BusGroup devices (multi-bit output aggregates) get their label from the
 * first named connector touching them. Display-only: device keys and the
 * source-position jump chain are untouched.
 */
export function normalizeIoLabels(circuit: any): void {
  if (!circuit) return;

  const IO_TYPES = new Set(['Button', 'Clock', 'Lamp', 'NumDisplay', 'Input', 'Output']);

  // Build a lookup: which connector names touch each device id (for BusGroup).
  const connNameByDevId: Record<string, string> = {};
  if (Array.isArray(circuit.connectors)) {
    for (const conn of circuit.connectors) {
      const name = conn?.name || conn?.netname;
      if (!name) continue;
      for (const end of [conn?.from, conn?.to]) {
        const id = end?.id;
        if (id && !connNameByDevId[id]) connNameByDevId[id] = String(name);
      }
    }
  }

  if (circuit.devices && typeof circuit.devices === 'object') {
    for (const [devKey, device] of Object.entries<any>(circuit.devices)) {
      const d: any = device;
      const type = d?.type;
      if (!type) continue;

      // 1) Single-bit IO cells: the SVG `<text>` under the cell defaults to the
      // auto id (dev0/dev1). Rewrite it to the port/net name so the schematic
      // reads clk/reset instead of dev0. device.label alone is ignored by
      // digitaljs's cell fromJSON — must patch attrs.label.text directly.
      if (IO_TYPES.has(type)) {
        const human = d.net || d.name || connNameByDevId[devKey];
        if (human) {
          d.label = String(human);
          if (d.attrs?.label?.text !== undefined) d.attrs.label.text = String(human);
        }
        continue;
      }

      // 2) BusGroup (multi-bit display): rewrite the auto-id label to the net name.
      if (type === 'BusGroup' || type === 'bus') {
        const human = d.net || connNameByDevId[devKey];
        if (human) {
          d.label = String(human);
          if (d.attrs?.label?.text !== undefined) d.attrs.label.text = String(human);
        }
      }
    }
  }

  // Recurse into subcircuits (drill-down views re-run io_ui themselves).
  if (circuit.subcircuits) {
    for (const sub of Object.values(circuit.subcircuits)) {
      normalizeIoLabels(sub);
    }
  }
}

/**
 * Rename auto-generated Yosys cells (e.g. "$auto$ff.cc:266:slice$781")
 * to clean, human-readable names based on cell type.
 * Preserves user-defined names (those not starting with $).
 */
export function renameAutoCells(circuit: any): void {
  if (!circuit) return;

  // Map Yosys cell type prefixes to clean display names
  const typeNameMap: Record<string, string> = {
    // Combinational
    '$and':   'AND',
    '$or':    'OR',
    '$xor':   'XOR',
    '$not':   'NOT',
    '$nand':  'NAND',
    '$nor':   'NOR',
    '$xnor':  'XNOR',
    '$mux':   'MUX',
    '$pmux':  'PMUX',
    '$tribuf': 'TRI',
    '$lut':   'LUT',
    // Arithmetic
    '$add':   'ADDER',
    '$sub':   'SUB',
    '$mul':   'MUL',
    '$div':   'DIV',
    '$mod':   'MOD',
    '$eq':    'EQ',
    '$ne':    'NE',
    '$lt':    'LT',
    '$le':    'LE',
    '$gt':    'GT',
    '$ge':    'GE',
    '$shl':   'SHL',
    '$shr':   'SHR',
    '$sshl':  'SSHL',
    '$sshr':  'SSHR',
    '$neg':   'NEG',
    '$pos':   'POS',
    '$reduce_and': 'RAND',
    '$reduce_or':  'ROR',
    '$reduce_xor': 'RXOR',
    '$reduce_bool': 'RBOOL',
    '$logic_and': 'LAND',
    '$logic_or':  'LOR',
    '$logic_not': 'LNOT',
    // Sequential
    '$dff':   'DFF',
    '$dffe':  'DFFE',
    '$dffsr': 'DFFSR',
    '$sdff':  'SDFF',
    '$dlatch': 'DLATCH',
    '$adff':  'ADFF',
    '$dlatchsr': 'DSR',
    '$sr':    'SR',
    // Memory
    '$mem':   'MEM',
    '$memrd': 'MRD',
    '$memwr': 'MWR',
    // Misc
    '$slice': 'SLICE',
    '$concat': 'CONCAT',
    '$shift': 'SHIFT',
    '$shiftx': 'SHIFTX',
    '$alu':   'ALU',
    '$fa':    'FA',
    '$lcu':   'LCU',
    '$macc':  'MACC',
    '$fsm':   'FSM',
    '$assert': 'ASSERT',
    '$assume': 'ASSUME',
    '$cover':  'COVER',
    '$specify2': 'SPEC2',
    '$specify3': 'SPEC3',
    '$specrule': 'SPECRULE',
    '$initstate': 'INIT',
    '$anyconst': 'ANYC',
    '$anyseq':   'ANYSEQ',
    '$allconst': 'ALLCONST',
    '$allseq':   'ALLSEQ',
    '$equiv':  'EQUIV',
    '$pow':    'POW',
    '$bwmux':  'BWMUX',
    '$bweqx':  'BWEQ',
    '$bwnot':  'BWNOT',
    '$bwand':  'BWAND',
    '$bwor':   'BWOR',
    // Designs
    '$paramod': 'PARAM',
    '$abstract': 'ABS',
    '$techmap':  'TECHMAP',
    '$scopeinfo': 'SCOPE',
  };

  function getBaseFromName(name: string): string {
    // Try to find a known $type within the name
    for (const prefix of Object.keys(typeNameMap)) {
      if (name.includes(prefix)) {
        return prefix;
      }
    }
    // Fallback: try to match generic $xxx pattern
    const match = name.match(/\$(\w+)/);
    return match ? `$${match[1]}` : 'CELL';
  }

  // Process this circuit's devices
  if (circuit.devices && Object.keys(circuit.devices).length > 0) {
    const counters: Record<string, number> = {};
    const renameMap: Record<string, string> = {};

    function makeCleanName(baseType: string): string {
      const display = typeNameMap[baseType] || baseType.replace(/^\$/, '').toUpperCase();
      if (!counters[display]) {
        counters[display] = 0;
      }
      counters[display]++;
      return `${display}_${counters[display]}`;
    }

    // Collect all devices that need renaming by checking device.label
    // (the device key in DigitalJS is generated from the cell TYPE, not the cell name;
    //  the Yosys auto-generated name is stored in device.label)
    for (const [devKey, device] of Object.entries(circuit.devices)) {
      const label = (device as any).label || '';
      // Only rename devices whose label contains Yosys auto-generated patterns
      if (label.includes('$auto') || label.includes('$abc') || label.includes('$techmap')) {
        const baseType = getBaseFromName(label);
        renameMap[devKey] = makeCleanName(baseType);
      }
    }

    if (Object.keys(renameMap).length > 0) {
      // Rename device keys and update labels
      const newDevices: Record<string, any> = {};
      for (const [oldKey, device] of Object.entries(circuit.devices)) {
        const newKey = renameMap[oldKey] || oldKey;
        newDevices[newKey] = device;
        // Always update the label to the new clean name
        (device as any).label = newKey;
      }
      circuit.devices = newDevices;

      // Rename references in connectors
      if (circuit.connectors) {
        for (const conn of circuit.connectors) {
          if (conn.from && renameMap[conn.from.id]) {
            conn.from.id = renameMap[conn.from.id];
          }
          if (conn.to && renameMap[conn.to.id]) {
            conn.to.id = renameMap[conn.to.id];
          }
        }
      }
    }
  }

  // Always recurse into subcircuits (this is where most devices live in DigitalJS)
  if (circuit.subcircuits) {
    for (const sub of Object.values(circuit.subcircuits)) {
      renameAutoCells(sub as any);
    }
  }

  // Also recurse into cells (nested IO cells)
  if (circuit.cells) {
    for (const cell of Object.values(circuit.cells) as any[]) {
      if (cell && typeof cell === 'object') {
        renameAutoCells(cell);
      }
    }
  }
}

/**
 * 给没有名字的连线补一个自动名（N1、N2…），逐层递归到所有子模块体。
 *
 * 为什么必须在编译产物阶段做：digitaljs 的 Wire 只在 `initialize()` 里
 * 判断 `has('netname')` 来决定要不要建标签节点（cells/base.mjs），事后
 * set('netname') 不会凭空长出标签。
 * 沙盒画布之所以每条线都有名字，是因为 loadCells 给无名线补了 N 序号；
 * 编译模式此前不补 ⇒ 内部连线一片空白，两个模式对不上（用户裁决：编译模式
 * 也标自动名）。
 */
export function assignAutoNetNames(circuit: any, counter = { n: 0 }): void {
  if (!circuit || typeof circuit !== 'object') return;
  for (const conn of circuit.connectors || []) {
    if (!conn || typeof conn !== 'object') continue;
    if (!conn.name || !String(conn.name).trim()) conn.name = `N${++counter.n}`;
  }
  for (const sub of Object.values<any>(circuit.subcircuits || {})) assignAutoNetNames(sub, counter);
}