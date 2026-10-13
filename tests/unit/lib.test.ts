// lib 层单测安全网（R134）：为 VS Code 套壳迁移做准备——UI 层重写时 lib 不变，
// 这批单测锁定解析/冲突分级/电路后处理的**当前实测行为**（R134 诊断脚本逐个固化，
// 非凭印象：and/dff 在原语跳过名单、$auto→AUTO_1 命名、空串也补名、$_DFF_P_→$dff 值归一）。
// 输入形状 = yosys write_json 标准。UI 层行为由 Playwright 闸门覆盖（r121 等）。
import { describe, it, expect } from 'vitest';
import { parseVerilogModules, parseVerilogInstances, parseInstantiations, stripBom } from '../../src/lib/verilogParse';
import { findNetConflicts, stripExtraDrivers, normalizeStdDffCells } from '../../src/lib/verilogConflicts';
import { normalizeIoLabels, renameAutoCells, assignAutoNetNames } from '../../src/lib/verilogCircuit';

describe('verilogParse', () => {
  it('parseVerilogModules：多模块按序提取，注释/空白不干扰', () => {
    const src = `// comment module fake;
module half_adder (input a, input b, output s);
endmodule
/* block module comment; */
module full_adder(a, b, cin);
endmodule`;
    expect(parseVerilogModules(src)).toEqual(['half_adder', 'full_adder']);
  });
  it('parseVerilogModules：无模块返回空数组', () => {
    expect(parseVerilogModules('wire x;')).toEqual([]);
  });
  it('parseVerilogInstances：返回**被实例化的外部模块名**（不是实例名），本文件已定义的模块与原语都排除', () => {
    // 名字是历史误导：函数体 push 的是 match[1]（moduleName），语义＝"这个文件引用了哪些
    // 还没在自己里面定义的模块"，消费方 useCompilePipeline 拿它做缺模块判错。
    // 要实例名请走 parseInstantiations()（返回 {module,name,line}）。
    const src = 'module t; my_and g1 (o, a, b); my_dff d0 (.q(q), .d(d), .clk(c)); and g2 (x, y); endmodule';
    expect(parseVerilogInstances(src)).toEqual(['my_and', 'my_dff']);
    // 同文件里定义过的模块不算"外部引用"（这一臂钉住 definedModules 那道过滤）
    const withLocal = 'module sub; endmodule\nmodule top; sub u0 (.a(a)); other u1 (.b(b)); endmodule';
    expect(parseVerilogInstances(withLocal)).toEqual(['other']);
  });
  it('parseInstantiations：同一份源码给出实例名（与上面的模块名口径刻意不同）', () => {
    const src = 'module t; my_and g1 (o, a, b); my_dff d0 (.q(q), .d(d), .clk(c)); endmodule';
    expect(parseInstantiations(src).map((i) => i.instanceName)).toEqual(['g1', 'd0']);
    expect(parseInstantiations(src).map((i) => i.moduleName)).toEqual(['my_and', 'my_dff']);
  });
  it('stripBom：剥 UTF-8 BOM 并归一 CRLF', () => {
    expect(stripBom('\uFEFFa\r\nb\r')).toBe('a\nb\n');
  });
});

describe('verilogConflicts 冲突分级', () => {
  const mod = (ports: any, cells: any, netnames: any): any => ({
    modules: { top: { ports, cells, netnames } },
  });

  it('具名冲突：两位驱动同一 net → 返回 NetConflict（可出图标冲突）；input 端口也是驱动者', () => {
    const out = mod(
      { a: { direction: 'input', bits: [0] } },
      { g1: { port_directions: { y: 'output' }, connections: { y: [0] } },
        g2: { port_directions: { y: 'output' }, connections: { y: [0] } } },
      { w1: { bits: [0] } },
    );
    const conflicts = findNetConflicts(out);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ net: 'w1', module: 'top', drivers: ['端口 a', 'g1.y', 'g2.y'] });
  });

  it('无名冲突：netnames 缺失 → net=null（拒编译分支的输入）', () => {
    const out = mod(
      {},
      { g1: { port_directions: { y: 'output' }, connections: { y: [3] } },
        g2: { port_directions: { y: 'output' }, connections: { y: [3] } } },
      {},
    );
    const conflicts = findNetConflicts(out);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].net).toBeNull();
  });

  it('无冲突：每位单驱动 → 空数组且不注入 side-channel', () => {
    const out = mod(
      {},
      { g1: { port_directions: { y: 'output' }, connections: { y: [0] } } },
      { w1: { bits: [0] } },
    );
    expect(findNetConflicts(out)).toEqual([]);
    expect(out.modules.top.__conflictedBits).toBeUndefined();
  });

  it('stripExtraDrivers：具名冲突剥多余驱动（保留首位）——输入端口驱动不可剥', () => {
    const out = mod(
      { a: { direction: 'input', bits: [1] } },
      { g1: { port_directions: { y: 'output' }, connections: { y: [0] } },
        g2: { port_directions: { y: 'output' }, connections: { y: [0] } } },
      { w1: { bits: [0, 1] } },
    );
    findNetConflicts(out);
    const stripped = stripExtraDrivers(out);
    expect(stripped).toBeGreaterThanOrEqual(1);
    expect(out.modules.top.cells.g2).toBeUndefined(); // g2 全位多余 → 整颗剥
    expect(out.modules.top.cells.g1).toBeDefined();   // 首驱动保留
  });
});

describe('verilogConflicts normalizeStdDffCells（值归一：$_DFF_x_ → $dff + 极性/位宽参数）', () => {
  it('$_DFF_P_ → $dff + CLK_POLARITY=1/WIDTH=1，连接键改名 C/D/Q → CLK/D/Q', () => {
    const out = { modules: { m: { cells: {
      ff1: { type: '$_DFF_P_', connections: { C: [0], D: [1], Q: [2] } },
      ok:  { type: '$_NOT_', connections: {} },
    } } } };
    normalizeStdDffCells(out as any);
    const cells = (out as any).modules.m.cells;
    expect(cells.ff1.type).toBe('$dff');
    expect(cells.ff1.parameters).toMatchObject({ CLK_POLARITY: '1', WIDTH: '00000000000000000000000000000001' });
    expect(cells.ff1.connections).toEqual({ CLK: [0], D: [1], Q: [2] });
    expect(cells.ok.type).toBe('$_NOT_'); // 非目标键不动
  });
});

describe('verilogCircuit 电路后处理', () => {
  it('normalizeIoLabels：IO 的 dev 标签改写为 net 名；attrs 只在**本来就有** text 槽时同步（不凭空造 attrs）', () => {
    const circuit: any = {
      devices: {
        // 真机形状：digitaljs 的 cell 由 yosys2digitaljs 产出时带 attrs.label.text，
        // 图上的 <text> 读的是它 ⇒ 这一路必须同步（实现里那句 `!== undefined` 守卫）。
        d0: { type: 'Input', net: 'clk', attrs: { label: { text: 'dev0' } } },
        // 没有 attrs 槽的器件：只写 label prop，⛔ 不许给它造一个 attrs 出来（造了会盖住
        // digitaljs 自己按 label prop 走 bindAttrToProp 的那条路）。
        d1: { type: 'Output', net: 'q' },
        d2: { type: 'BusGroup', net: 'bus1' },
        d3: { type: 'And' },
      },
      connectors: [{ from: { id: 'd3' }, name: 'and_out' }],
      subcircuits: {},
    };
    normalizeIoLabels(circuit as any);
    expect(circuit.devices.d0.label).toBe('clk');
    expect((circuit.devices.d0 as any).attrs.label.text).toBe('clk');
    expect(circuit.devices.d1.label).toBe('q');
    expect((circuit.devices.d1 as any).attrs).toBeUndefined();
    expect(circuit.devices.d2.label).toBe('bus1');
    expect(circuit.devices.d3.label).toBeUndefined(); // 非 IO/Bus 不动
  });
  it('normalizeIoLabels：没有 net 名时退回连线名（connNameByDevId），再没有就不动标签', () => {
    const circuit: any = {
      devices: { d0: { type: 'Input', attrs: { label: { text: 'dev0' } } }, d1: { type: 'Input' } },
      connectors: [{ from: { id: 'd0' }, name: 'from_wire' }],
      subcircuits: {},
    };
    normalizeIoLabels(circuit as any);
    expect(circuit.devices.d0.label).toBe('from_wire'); // 配对：只有连线名可用时用它
    expect((circuit.devices.d0 as any).attrs.label.text).toBe('from_wire');
    expect(circuit.devices.d1.label).toBeUndefined();   // 什么名都取不到 ⇒ 不写空标签
  });

  it('normalizeIoLabels：递归 subcircuits', () => {
    const circuit: any = { devices: {}, connectors: [], subcircuits: {
      sub: { devices: { x: { type: 'Input', net: 'inner_clk' } }, connectors: [] },
    } };
    normalizeIoLabels(circuit as any);
    expect((circuit.subcircuits as any).sub.devices.x.label).toBe('inner_clk');
  });

  it('renameAutoCells：$auto 前缀清洗为 AUTO_N（通用 fallback 命名），连线引用跟随，用户名保留', () => {
    const circuit: any = {
      devices: {
        '$auto$ff.cc:266:slice$781': { type: 'Dff', label: '$auto$ff.cc:266:slice$781' },
        user_named: { type: 'Dff', label: 'user_named' },
      },
      connectors: [{ from: { id: '$auto$ff.cc:266:slice$781' }, to: { id: 'user_named' } }],
      subcircuits: {},
    };
    renameAutoCells(circuit as any);
    const keys = Object.keys(circuit.devices);
    expect(keys).toContain('user_named');
    const renamed = keys.find((k) => k !== 'user_named');
    expect(renamed).toMatch(/^AUTO_\d+$/);
    expect((circuit.devices as any)[renamed!].label).toBe(renamed);
    expect(circuit.connectors[0].from.id).toBe(renamed); // 连线引用跟随新 key
  });

  it('assignAutoNetNames：无名连线（缺 name/空串）补 N 序号（跨 subcircuits 连续计数），有名不动', () => {
    const circuit: any = {
      connectors: [{ name: 'clk' }, {}],
      subcircuits: { sub: { connectors: [{ name: '' }, {}] } },
    };
    assignAutoNetNames(circuit as any);
    expect(circuit.connectors[0].name).toBe('clk');
    expect(circuit.connectors[1].name).toMatch(/^N\d+$/);
    const subNames = (circuit.subcircuits as any).sub.connectors.map((c: any) => c.name);
    expect(subNames[0]).toMatch(/^N\d+$/); // 空串也视为无名 → 补名（实测语义）
    expect(subNames[1]).toMatch(/^N\d+$/);
    // 计数连续：N1（顶层第二根）→ N2/N3（子模块两根）
    expect(subNames[0]).toBe('N2');
    expect(subNames[1]).toBe('N3');
  });
});
