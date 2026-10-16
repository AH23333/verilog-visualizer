// Built-in example circuits — single source (like OpenCircuits' SideNav Examples).
// Keep sources minimal and *known-good* against the Yosys WASM pipeline:
// every example here compiles and its inputs render as clickable switches.

export interface VerilogExample {
  /** file name created in the project workspace */
  fileName: string;
  title: string;
  description: string;
  source: string;
}

export const VERILOG_EXAMPLES: VerilogExample[] = [
  {
    fileName: 'example_and.v',
    title: '与门（门级）',
    description: '原始门实例化 —— 最小的设计。点击 a、b 切换电平。',
    source: `module example_and (
    input a,
    input b,
    output y
);
    and u1 (y, a, b);
endmodule
`,
  },
  {
    fileName: 'example_half_adder.v',
    title: '半加器（行为级）',
    description: 'assign 与门电路：由两个输入得到和与进位。非常适合作为第一个组合逻辑示例。',
    source: `module example_half_adder (
    input  a,
    input  b,
    output sum,
    output carry
);
    assign sum   = a ^ b;
    assign carry = a & b;
endmodule
`,
  },
  {
    fileName: 'example_mux2.v',
    title: '二选一多路选择器',
    description: '带选择条件赋值。可观察 Yosys 如何把它映射为门电路。',
    source: `module example_mux2 (
    input  a,
    input  b,
    input  sel,
    output y
);
    assign y = sel ? b : a;
endmodule
`,
  },
  {
    fileName: 'example_counter4.v',
    title: '4 位计数器（行为级，带时钟）',
    description: '带异步复位的行为级 always 块。寄存器上电为 x —— 点一次「复位」清零，再点一次释放，自由运行的 clk 即开始计数。',
    source: `module example_counter4 (
    input clk,
    input reset,
    output reg [3:0] count = 4'b0000
);
    always @(posedge clk or posedge reset) begin
        if (reset)
            count <= 4'b0000;
        else
            count <= count + 1;
    end
endmodule
`,
  },
  {
    fileName: 'example_full_adder.v',
    title: '全加器（层次化）',
    description: '两个半加器实例加一个或门 —— 展示模块实例化与网表形式的层次结构。',
    source: `module example_full_adder (
    input  a,
    input  b,
    input  cin,
    output sum,
    output cout
);
    wire s1, c1, c2;
    half_adder ha1 (a, b, s1, c1);
    half_adder ha2 (s1, cin, sum, c2);
    or  or1  (cout, c1, c2);
endmodule

module half_adder (
    input  a,
    input  b,
    output sum,
    output carry
);
    xor  xor1 (sum, a, b);
    and  and1 (carry, a, b);
endmodule
`,
  },
];
