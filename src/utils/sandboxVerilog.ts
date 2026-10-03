// 沙盒电路 → Verilog 导出：把图形电路转成结构化 Verilog module。
// 覆盖：输入/输出引脚、7 种逻辑门、D 触发器（always 块）、时钟（initial 振荡）、
// 常量（assign / wire）。多位器件（总线/存储器/数码管等）生成注释占位。
//
// 信号合并（电气正确性的关键）：一个驱动端口（source id:port）拉出的所有连线
// 在 Verilog 里必须是**同一个 net**——否则同名节点分叉后其余 wire 无驱动悬空。

const GATE_MAP: Record<string, string> = {
  And: 'and', Or: 'or', Not: 'not', Xor: 'xor', Nand: 'nand', Nor: 'nor', Xnor: 'xnor',
};

export function generateVerilog(paper: any, moduleName = 'sandbox_circuit'): string {
  const cells: any[] = paper.model.getCells();
  const gates = cells.filter((c) => !(typeof c.isLink === 'function' && c.isLink()));
  const links = paper.model.getLinks().map((l: any) => ({
    source: l.get('source') || {},
    target: l.get('target') || {},
    netname: l.get('netname') ? String(l.get('netname')) : null,
    bits: Number(l.get('bits')) || 1,
  }));

  // ---- 第一遍：net 合并。key = 驱动端口 'cellId:port'，net 名取该组第一条连线的 netname ----
  const driveNet = new Map<string, { name: string; bits: number }>();
  for (const lk of links) {
    if (!lk.source.id) continue;
    const key = `${lk.source.id}:${lk.source.port}`;
    if (!driveNet.has(key)) driveNet.set(key, { name: lk.netname || `net_${driveNet.size + 1}`, bits: lk.bits });
  }
  // 端口 → net 名（驱动端口直接取；负载端口沿其连线找到源 net）
  const netOfPort = (id: string, port: string): { name: string; bits: number } | null => {
    const k = `${id}:${port}`;
    if (driveNet.has(k)) return driveNet.get(k)!;
    const lk = links.find((l: any) => l.target && l.target.id === id && l.target.port === port);
    if (lk && lk.source.id) {
      const sk = `${lk.source.id}:${lk.source.port}`;
      return driveNet.get(sk) ?? { name: lk.netname || 'unnamed', bits: lk.bits };
    }
    return null;
  };

  // ---- 第二遍：声明与实例 ----
  const inputs = gates.filter((c) => c.get('type') === 'Input');
  const outputs = gates.filter((c) => c.get('type') === 'Output');
  const range = (bits: number) => (bits > 1 ? `[${bits - 1}:0] ` : '');

  const header: string[] = [`module ${moduleName}(`];
  const ports: string[] = [];
  for (const c of inputs) {
    const net = netOfPort(c.id, 'out');
    if (net) ports.push(`  input  ${range(net.bits)}${net.name}`);
  }
  for (const c of outputs) {
    const net = netOfPort(c.id, 'in');
    if (net) ports.push(`  output ${range(net.bits)}${net.name}`);
  }
  header.push(ports.join(',\n'));
  header.push(');');

  const body: string[] = [];
  // 逻辑门
  let gateIdx = 0;
  for (const c of gates) {
    const type = String(c.get('type'));
    const vOp = GATE_MAP[type];
    if (!vOp) continue;
    const inNets: string[] = [];
    const inPorts = type === 'Not' ? ['in'] : ['in1', 'in2'];
    for (const p of inPorts) {
      const net = netOfPort(c.id, p);
      inNets.push(net ? net.name : 'x');
    }
    const outNet = netOfPort(c.id, 'out');
    const outName = outNet ? outNet.name : `g${++gateIdx}_out`;
    body.push(`  ${vOp} g${++gateIdx}(${outName}, ${inNets.join(', ')});`);
  }
  // 常量：assign（有负载连线）或独立 wire 声明（无负载）
  let constIdx = 0;
  for (const c of gates) {
    if (c.get('type') !== 'Constant') continue;
    const cv = String(c.get('constant') || '0');
    const outNet = netOfPort(c.id, 'out');
    if (outNet && links.some((lk: any) => lk.source.id === c.id)) {
      body.push(`  assign ${outNet.name} = ${cv.length}'b${cv};`);
    } else {
      body.push(`  wire ${range(cv.length)}const_${++constIdx} = ${cv.length}'b${cv};`);
    }
  }
  // D 触发器
  for (const c of gates) {
    if (c.get('type') !== 'Dff') continue;
    const f = (port: string) => {
      const net = netOfPort(c.id, port);
      return net ? net.name : `dff_${String(c.id).slice(0, 4)}_${port}`;
    };
    const d = f('in'), q = f('out'), clk = f('clk');
    const init = String(c.get('initial') ?? 'x');
    const initRe = init === 'x' ? '' : `  initial ${q} = 1'b${init};\n`;
    body.push(`${initRe}  always @(posedge ${clk}) ${q} <= ${d};`);
  }
  // 时钟
  for (const c of gates) {
    if (c.get('type') !== 'Clock') continue;
    const outNet = netOfPort(c.id, 'out');
    if (!outNet) continue;
    const half = Number(c.get('propagation')) || 100;
    body.push(`  // 时钟：半周期 ${half} tick（沙盒内 1 tick ≈ 10ms，仿真时可自行调整延时）`);
    body.push(`  initial begin ${outNet.name} = 0; forever #${Math.max(1, Math.round(half / 2))} ${outNet.name} = ~${outNet.name}; end`);
  }
  // 未支持器件占位
  for (const c of gates) {
    const type = String(c.get('type'));
    if (['Input', 'Output', 'Lamp', ...Object.keys(GATE_MAP), 'Constant', 'Dff', 'Clock'].includes(type)) continue;
    body.push(`  // ${type}（${String(c.get('celltype') || c.get('net') || c.id).slice(0, 12)}）暂不支持导出，请手工补全`);
  }
  // 灯注释（观察点）
  for (const c of gates) {
    if (c.get('type') !== 'Lamp') continue;
    const net = netOfPort(c.id, 'in');
    if (net) body.push(`  // 指示灯 ← ${net.name}`);
  }

  body.push('endmodule');
  return [...header, ...body].join('\n');
}
