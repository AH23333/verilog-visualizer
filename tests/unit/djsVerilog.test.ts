// `.djs` → Verilog 转换器（R152 / M2）单元闸：纯函数，无 vscode/DOM 依赖。
import { describe, it, expect } from 'vitest';
import { djsToVerilog } from '../../extension/src/djsVerilog';

const wire = (id: string, sId: string, sPort: string, tId: string, tPort: string, bits = 1) =>
  ({ id, isLink: true, bits, source: { id: sId, port: sPort }, target: { id: tId, port: tPort } });

describe('djsToVerilog：基础组合电路', () => {
  it('Input/Output + 与门 ⇒ module 端口 + and 例化', () => {
    const cells = [
      { id: 'i1', type: 'Input', net: 'a' },
      { id: 'i2', type: 'Input', net: 'b' },
      { id: 'o1', type: 'Output', net: 'y' },
      { id: 'g', type: 'And' },
      wire('w1', 'i1', 'out', 'g', 'in1'),
      wire('w2', 'i2', 'out', 'g', 'in2'),
      wire('w3', 'g', 'out', 'o1', 'in'),
    ];
    const r = djsToVerilog(cells as never, 'adder');
    expect(r.errors).toEqual([]);
    expect(r.verilog).toContain('module adder (');
    expect(r.verilog).toContain('input  a');
    expect(r.verilog).toContain('input  b');
    expect(r.verilog).toContain('output y');
    expect(r.verilog).toContain('and g1 (y, a, b);');
    expect(r.verilog.trimEnd().endsWith('endmodule')).toBe(true);
  });

  it('中间 net（无 IO/无名）⇒ 声明 wire net_N 并连起来', () => {
    const cells = [
      { id: 'i1', type: 'Input', net: 'a' },
      { id: 'i2', type: 'Input', net: 'b' },
      { id: 'g1', type: 'And' },
      { id: 'g2', type: 'Not' },
      { id: 'o1', type: 'Output', net: 'y' },
      wire('w1', 'i1', 'out', 'g1', 'in1'),
      wire('w2', 'i2', 'out', 'g1', 'in2'),
      wire('w3', 'g1', 'out', 'g2', 'in'),
      wire('w4', 'g2', 'out', 'o1', 'in'),
    ];
    const r = djsToVerilog(cells as never, 'm');
    expect(r.errors).toEqual([]);
    expect(r.verilog).toMatch(/wire net_\d+;/);
    expect(r.verilog).toContain('not g2 (y, net_');
  });

  it('多位总线按 bits 出 range', () => {
    const cells = [
      { id: 'i1', type: 'Input', net: 'a', bits: 8 },
      { id: 'o1', type: 'Output', net: 'y', bits: 8 },
      { id: 'g', type: 'And' },
      wire('w1', 'i1', 'out', 'g', 'in1', 8),
      wire('w2', 'g', 'out', 'o1', 'in', 8),
    ];
    const r = djsToVerilog(cells as never, 'm');
    expect(r.verilog).toContain('input  [7:0] a');
    expect(r.verilog).toContain('output [7:0] y');
  });

  it('D 触发器 ⇒ initial + always @(posedge)', () => {
    const cells = [
      { id: 'i1', type: 'Input', net: 'd' },
      { id: 'i2', type: 'Input', net: 'clk' },
      { id: 'o1', type: 'Output', net: 'q' },
      { id: 'ff', type: 'Dff', initial: '0' },
      wire('w1', 'i1', 'out', 'ff', 'in'),
      wire('w2', 'i2', 'out', 'ff', 'clk'),
      wire('w3', 'ff', 'out', 'o1', 'in'),
    ];
    const r = djsToVerilog(cells as never, 'm');
    expect(r.errors).toEqual([]);
    expect(r.verilog).toContain("initial q = 1'b0;");
    expect(r.verilog).toContain('always @(posedge clk) q <= d;');
  });
});

describe('djsToVerilog：子电路与硬报错', () => {
  it('Subcircuit ⇒ 例化 celltype，端口取内部图 IO net', () => {
    const cells = [
      { id: 'i1', type: 'Input', net: 'a' },
      { id: 'i2', type: 'Input', net: 'b' },
      { id: 'o1', type: 'Output', net: 'y' },
      { id: 'sc', type: 'Subcircuit', celltype: 'mux', subcircuitGraph: { cells: [
        { type: 'Input', net: 'sel' }, { type: 'Input', net: 'd' }, { type: 'Output', net: 'o' },
      ] } },
      wire('w1', 'i1', 'out', 'sc', 'sel'),
      wire('w2', 'i2', 'out', 'sc', 'd'),
      wire('w3', 'sc', 'o', 'o1', 'in'),
    ];
    const r = djsToVerilog(cells as never, 'm');
    expect(r.errors).toEqual([]);
    expect(r.verilog).toContain('mux sub1 (');
    expect(r.verilog).toContain('.sel(a)');
    expect(r.verilog).toContain('.d(b)');
    expect(r.verilog).toContain('.o(y)');
  });

  it('不支持器件（Memory）⇒ 硬报错，⛔ 出 Verilog', () => {
    const cells = [
      { id: 'i1', type: 'Input', net: 'a' },
      { id: 'o1', type: 'Output', net: 'y' },
      { id: 'mem', type: 'Memory' },
    ];
    const r = djsToVerilog(cells as never, 'm');
    expect(r.verilog).toBe('');
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toContain('Memory');
  });

  it('Subcircuit 缺内部图 ⇒ 硬报错', () => {
    const cells = [
      { id: 'i1', type: 'Input', net: 'a' },
      { id: 'o1', type: 'Output', net: 'y' },
      { id: 'sc', type: 'Subcircuit', celltype: 'mux' },
      wire('w1', 'i1', 'out', 'sc', 'sel'),
    ];
    const r = djsToVerilog(cells as never, 'm');
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toContain('mux');
  });
});
