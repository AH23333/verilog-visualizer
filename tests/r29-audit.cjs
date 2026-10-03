// R29 器件审计：按 spawnCell 的构造参数实例化每个器件，dump 真实端口（id/dir/bits）
// 目的：查清「时序/运算/比较/多路选择移位/总线/存储/显示」各部件的 I/O 是否专业
const d = require('digitaljs');

const NATIVE_SIZE_TYPES = ['Dff', 'Display7', 'Addition', 'Subtraction', 'Multiplication', 'Constant',
  'Mux', 'Eq', 'Lt', 'Gt', 'ShiftLeft', 'ShiftRight', 'Negation', 'BusGroup', 'BusSlice', 'BusUngroup', 'Memory'];
const PORT_TYPES = ['Input', 'Output'];
const ARITH_TYPES = ['Addition', 'Subtraction', 'Multiplication'];
const COMPARE_TYPES = ['Eq', 'Lt', 'Gt'];
const SHIFT_TYPES = ['ShiftLeft', 'ShiftRight'];

// 镜像 SandboxCanvas.spawnCell 的构造参数
function spawnArgs(type, bits, extra) {
  const args = { type, position: { x: 0, y: 0 } };
  if (type === 'Dff') { args.bits = bits; args.polarity = { clock: 1 }; }
  else if (type === 'Display7') args.bits = 8;
  else if (ARITH_TYPES.includes(type)) args.bits = { in1: bits, in2: bits, out: bits };
  else if (type === 'Mux') args.bits = { in: bits, sel: 1 };
  else if (COMPARE_TYPES.includes(type)) args.bits = { in1: bits, in2: bits };
  else if (SHIFT_TYPES.includes(type)) args.bits = { in1: bits, in2: Math.max(1, Math.ceil(Math.log2(Math.max(2, bits)))), out: bits };
  else if (type === 'Negation') args.bits = { in: bits, out: bits };
  else if (type === 'BusGroup' || type === 'BusUngroup') {
    args.groups = extra?.groups ?? new Map([[0, 1], [1, 1], [2, 1], [3, 1]]);
    args.size = { width: 40, height: 16 * 4 + 8 };
  } else if (type === 'BusSlice') { args.slice = extra?.slice ?? { first: 0, count: 4, total: 8 }; args.size = { width: 40, height: 24 }; }
  else if (type === 'Memory') {
    const nBits = extra?.bits ?? bits, abits = extra?.abits ?? 2;
    args.bits = nBits; args.abits = abits;
    args.rdports = extra?.rdports ?? [{ clock_polarity: 1 }];
    args.wrports = extra?.wrports ?? [{ clock_polarity: 1 }];
    args.size = { width: 88, height: 16 * (args.rdports.length * 3 + args.wrports.length * 3) + 8 };
  } else if (type === 'Constant') args.constant = '0'.repeat(Math.max(1, bits));
  else args.bits = bits;
  if (extra) Object.assign(args, extra);
  if (!NATIVE_SIZE_TYPES.includes(type)) args.size = PORT_TYPES.includes(type) ? { width: 30, height: 30 } : { width: 60, height: 32 };
  return args;
}

function portsOf(cell) {
  const items = cell.get('ports')?.items || [];
  return items.map(p => `${p.dir === 'in' ? '◀' : '▶'}${p.id}${p.bits != null ? '[' + (typeof p.bits === 'object' ? JSON.stringify(p.bits) : p.bits) + ']' : ''}`);
}

const PALETTE = [
  ['时序', ['Dff']],
  ['运算', ARITH_TYPES],
  ['比较', COMPARE_TYPES],
  ['多路选择/移位', ['Mux', ...SHIFT_TYPES, 'Negation']],
  ['总线', ['BusGroup', 'BusSlice', 'BusUngroup']],
  ['存储', ['Memory']],
  ['显示', ['Display7']],
];

for (const bits of [1, 4]) {
  console.log(`\n===== defaultBits = ${bits} =====`);
  for (const [group, types] of PALETTE) {
    console.log(`\n-- ${group} --`);
    for (const t of types) {
      const C = d.cells[t];
      if (!C) { console.log(`  ${t.padEnd(14)} 类不存在`); continue; }
      try {
        const cell = new C(spawnArgs(t, bits));
        const sz = cell.get('size');
        console.log(`  ${t.padEnd(14)} size=${Math.round(sz.width)}x${Math.round(sz.height) || 'NaN'}  ${portsOf(cell).join(' ')}`);
      } catch (e) { console.log(`  ${t.padEnd(14)} 构造失败: ${e.message}`); }
    }
  }
}

// 未接入但 digitaljs 内置的候选器件
console.log('\n===== 未接入的候选器件（按 4 位实例化） =====');
const CANDIDATES = ['Division', 'Modulo', 'Power', 'Ne', 'Le', 'Ge', 'ZeroExtend', 'SignExtend', 'Repeater',
  'NumDisplay', 'NumEntry', 'Mux1Hot', 'AndReduce', 'OrReduce', 'XorReduce', 'NandReduce', 'NorReduce', 'XnorReduce', 'UnaryPlus', 'FSM'];
for (const t of CANDIDATES) {
  const C = d.cells[t];
  if (!C) { console.log(`  ${t.padEnd(13)} 类不存在`); continue; }
  const attempts = [
    { bits: 4 },
    { bits: { in1: 4, in2: 4, out: 4 } },
    { bits: 4, extend: { input: 1, output: 4 } },
    { bits: { in: 4, sel: 2 } },
  ];
  let done = false;
  for (const a of attempts) {
    try {
      const cell = new C(Object.assign({ type: t, position: { x: 0, y: 0 } }, a));
      const sz = cell.get('size');
      console.log(`  ${t.padEnd(13)} args=${JSON.stringify(a)} size=${Math.round(sz.width)}x${Math.round(sz.height) || 'NaN'}  ${portsOf(cell).join(' ')}`);
      done = true; break;
    } catch (e) { /* try next */ }
  }
  if (!done) console.log(`  ${t.padEnd(13)} 所有参数组合构造失败`);
}
