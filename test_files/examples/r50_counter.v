// R50 判据夹具：最小可观察时序电路 —— 一个时钟沿就该让 q 变、rst 拉高就该让 q 归零。
// 用它给「单步」和「输入切换」两颗按钮当行为证人（点了必须有看得见的变化）。
module r50_counter(
  input  wire clk,
  input  wire rst,
  output reg  [3:0] q
);
  always @(posedge clk) begin
    if (rst) q <= 4'd0;
    else     q <= q + 4'd1;
  end
endmodule
