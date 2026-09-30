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
    title: 'AND Gate (gate-level)',
    description: 'Primitive gate instantiation — the smallest possible design. Click a, b to toggle.',
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
    title: 'Half Adder (behavioral)',
    description: 'assign + gates: sum and carry from two inputs. Great first combinational example.',
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
    title: '2-to-1 Multiplexer',
    description: 'Conditional assign with a select line. Inspect how Yosys maps it to gates.',
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
    title: '4-bit Counter (behavioral, clocked)',
    description: 'Behavioral always block with async reset. Registers power up as x — click "reset" once to clear, once more to release, and the free-running clk starts counting.',
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
    title: 'Full Adder (hierarchical)',
    description: 'Two half-adder instances + OR — shows module instantiation and the hierarchy in netlist form.',
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
