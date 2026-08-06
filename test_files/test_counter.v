// Quartus Gate-Level Netlist: 4-bit Counter
// Generated for testing the Verilog Visualizer
module counter(input clk, input reset, output [3:0] count);

  wire n0, n1, n2, n3;

  dff d0 (.clk(clk), .d(n0), .q(count[0]));
  dff d1 (.clk(clk), .d(n1), .q(count[1]));
  dff d2 (.clk(clk), .d(n2), .q(count[2]));
  dff d3 (.clk(clk), .d(n3), .q(count[3]));

  not n0 (.in(count[0]), .out(n0));
  xor x1 (.a(count[0]), .b(count[1]), .out(n1));
  and a1 (.a(count[0]), .b(count[1]), .out(w1));
  xor x2 (.a(w1), .b(count[2]), .out(n2));
  and a2 (.a(w1), .b(count[2]), .out(w2));
  xor x3 (.a(w2), .b(count[3]), .out(n3));

endmodule