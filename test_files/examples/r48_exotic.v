// R48 判据夹具：把 yosys2digitaljs 会产出的「非常规器件」一次凑齐
// 算术（+、*）、比较（<、==）、归约（&a、|b）、移位、宽多路选择（case）、
// 存储器（reg 数组）、带初值与异步复位的触发器。
// 这些都是以往闸门（And/Or/multiplier→adder→full_adder）从没碰到过的类型。
module r48_exotic(
  input  wire clk,
  input  wire rst,
  input  wire [7:0] a,
  input  wire [7:0] b,
  input  wire [3:0] sel,
  input  wire [5:0] addr,
  output reg  [7:0] y,
  output reg  [7:0] q,
  output reg        flag,
  output reg  [7:0] rd
);
  reg [7:0] mem [0:63];

  wire [8:0]  sum   = a + b;
  wire [15:0] prod  = a * b;
  wire        lt    = a < b;
  wire        eq    = a == b;
  wire [7:0]  shr   = a >> sel;
  wire [7:0]  shl   = a << sel;
  wire        r_and = &a;
  wire        r_or  = |b;

  reg [7:0] muxout;
  always @(*) begin
    case (sel)
      4'd0: muxout = a;
      4'd1: muxout = b;
      4'd2: muxout = shr;
      default: muxout = shl;
    endcase
  end

  always @(posedge clk or posedge rst) begin
    if (rst) begin
      y    <= 8'd0;
      q    <= 8'd0;
      flag <= 1'b0;
      rd   <= 8'd255;
    end else begin
      y    <= sum[7:0] ^ muxout;
      q    <= prod[7:0];
      flag <= (lt & eq) | r_and | r_or;
      mem[addr] <= a;
      rd   <= mem[addr];
    end
  end
endmodule
