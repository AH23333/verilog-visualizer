// R48 判据夹具第二颗：**同步复位** + **非零复位值**（ FSM 状态寄存器极常见）。
// 目的：让编译产物真的带上 srst_value / enable_srst / 非零 arst_value，
// 才能测出「复制/展开时把这些字段丢了」会不会把复位值悄悄改成 0。
module r48_sync(
  input  wire clk,
  input  wire rst,
  input  wire [7:0] d,
  output reg  [7:0] q,
  output reg  [2:0] state
);
  // 同步复位，且复位值非零（state 复位到 3'b101，q 复位到 8'hA5）
  always @(posedge clk) begin
    if (rst) begin
      state <= 3'b101;
      q     <= 8'hA5;
    end else begin
      state <= state + 2'd1;
      q     <= d;
    end
  end
endmodule
