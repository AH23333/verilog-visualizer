// R28 headless 复现：BusGroup 传播休眠
// 场景 A：先建完整电路再驱动（HeadlessCircuit 构造路径）
// 场景 B：空电路先"启动"（空转若干 tick），再模拟 loadCells 增量 addCell（sandbox 实际路径）
const d = require('digitaljs');

const SEG_TABLE = [
  '01111110', '00110000', '01101101', '01111001', '00110011',
  '01011011', '01011111', '01110000', '01111111', '01111011',
];

function mkCells(prefix) {
  const gates = [];
  gates.push(new d.cells.Clock({ id: `${prefix}Clk`, propagation: 25 }));
  gates.push(new d.cells.Memory({
    id: `${prefix}Mem`, bits: 8, abits: 4,
    rdports: [{}], wrports: [], memdata: SEG_TABLE,
  }));
  gates.push(new d.cells.Display7({ id: `${prefix}Disp`, bits: 8 }));
  gates.push(new d.cells.BusGroup({
    id: `${prefix}Bus`,
    groups: new Map([[0, 1], [1, 1], [2, 1], [3, 1]]),
    size: { width: 40, height: 16 * 4 + 8 },
  }));
  for (let i = 0; i < 4; i++) {
    gates.push(new d.cells.Dff({ id: `${prefix}D${i}`, polarity: { clock: 1 }, initial: '0' }));
    gates.push(new d.cells.Not({ id: `${prefix}N${i}` }));
  }
  const wires = [];
  const w = (s, sp, t, tp) => new d.cells.Wire({
    source: { id: `${prefix}${s}`, port: sp, magnet: 'port' },
    target: { id: `${prefix}${t}`, port: tp, magnet: 'port' },
    signal: 'x', bits: 1,
  });
  wires.push(w('Clk', 'out', 'D0', 'clk'));
  for (let i = 0; i < 4; i++) {
    wires.push(w(`D${i}`, 'out', `N${i}`, 'in'));
    wires.push(w(`N${i}`, 'out', `D${i}`, 'in'));
    wires.push(w(`D${i}`, 'out', 'Bus', `in${i}`));
    if (i < 3) wires.push(w(`D${i}`, 'out', `D${i + 1}`, 'clk'));
  }
  wires.push(w('Bus', 'out', 'Mem', 'rd0addr'));
  wires.push(w('Mem', 'rd0data', 'Disp', 'in'));
  return { gates, wires };
}

const fmt = (v) => { try { return String(v); } catch { return "<err>"; } };
function report(tag, circuit, prefix) {
  const graph = circuit._graph;
  const bus = graph.getCell(`${prefix}Bus`);
  const mem = graph.getCell(`${prefix}Mem`);
  const disp = graph.getCell(`${prefix}Disp`);
  const ins = {};
  for (let i = 0; i < 4; i++) ins[`in${i}`] = fmt(bus.get('inputSignals')?.[`in${i}`]);
  console.log(`[${tag}] tick=${circuit._engine._tick} busIn=${JSON.stringify(ins)} busOut=${fmt(bus.get('outputSignals')?.out)} memData=${fmt(mem.get('outputSignals')?.rd0data)} dispIn=${fmt(disp.get('inputSignals')?.in)}`);
}

function pump(circuit, n) {
  for (let i = 0; i < n; i++) circuit.updateGates();
}

function instrument(circuit) {
  const eng = circuit._engine;
  eng._enqueue = ((orig) => function (gate) {
    if (gate.get('type') === 'BusGroup') {
      eng.__busLog.push(`enqueue@${eng._tick} ins=${JSON.stringify(gate.get('inputSignals'))}`);
    }
    return orig.call(this, gate);
  })(eng._enqueue);
  const origNext = eng.updateGatesNext.bind(eng);
  eng.updateGatesNext = function () {
    const peek = eng._pq.peek();
    const r = origNext();
    eng.__busLog.push(`tick->${eng._tick - 1} peekWas=${peek} count=${r}`);
    return r;
  };
  eng.__busLog = [];
}

function run(tag, startBeforeLoad) {
  const prefix = startBeforeLoad ? 'b' : 'a';
  const circuit = new d.HeadlessCircuit({ devices: {}, connectors: [], subcircuits: {} });
  const graph = circuit._graph;
  instrument(circuit);
  const { gates, wires } = mkCells(prefix);

  if (startBeforeLoad) pump(circuit, 40); // 空转 40 tick（≈ start 后到用户点示例之间）
  for (const gate of gates) graph.addCell(gate);
  for (const wire of wires) graph.addCell(wire);

  pump(circuit, 200);
  report(tag, circuit, prefix);
  console.log(`[${tag}] busLog(尾部):`, circuit._engine.__busLog.slice(0, 30).join(' | '));
  return circuit;
}

console.log('=== 场景 A：先建后跑 ===');
run('A', false);
console.log('=== 场景 B：先跑(40 tick)后加载 ===');
run('B', true);
