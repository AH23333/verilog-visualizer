// R116 夹具：行为级 RAM —— 官方流（memory -nomap）应折成 Memory 器件（带 words/offset 属性），
// 旧流（memory 直映射 + techmap）会炸成一堆触发器。断言「devices 里有 Memory、无 $_DFF_ 海」。
module ram_r116(
  input  [3:0] addr,
  input  [7:0] din,
  input  we, clk,
  output [7:0] dout
);
  reg [7:0] mem [0:15];
  always @(posedge clk) begin
    if (we) mem[addr] <= din;
    dout <= mem[addr];
  end
endmodule
