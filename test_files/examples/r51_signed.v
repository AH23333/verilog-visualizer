// R51 判据用设计：signed 运算 / $shiftx / 大容量存储器 —— 专门用来抓
// 「编译 → 沙盒 → 展开」往返里被静默丢掉的器件参数（signed / fillx / words / offset）。
// 这些参数一丢，拓扑与器件数都不变，但**逐拍仿真结果会变**（R48/R49 那一族）。
// 判据必须拿「有符号」这一半来比：a*b 在 signed 下是 -3*5=-15，unsigned 下变成巨大的正数。
module r51_signed (
  input  wire        clk,
  input  wire [7:0]  a,       // 当作有符号数用
  input  wire [7:0]  b,
  input  wire [3:0]  sh,
  input  wire [7:0]  waddr,
  input  wire [7:0]  wdata,
  input  wire        we,
  output wire [15:0] prod,    // 有符号乘
  output wire [7:0]  quot,    // 有符号除
  output wire [15:0] shifted, // 逻辑右移：移位量取不出时补 x
  output wire [15:0] ashift,  // 有符号算术右移（$sshr / $shiftx 的 fillx）
  output wire [7:0]  rdata
);
  wire signed [7:0]  sa = a;
  wire signed [7:0]  sb = b;
  wire signed [15:0] sp;
  wire signed [15:0] sq;

  assign sp = sa * sb;          // $mul + A_SIGNED/B_SIGNED
  assign sq = sp / 8'sd3;       // $div + signed
  assign prod = sp;
  assign quot = sq[7:0];

  reg [15:0] acc = 16'd0;
  always @(posedge clk) acc <= (acc >> sh);   // $shr / $sshr 走 shiftx 路径
  assign shifted = acc;

  // 有符号算术右移：yosys 走 $sshr/$shiftx，digitaljs 的 Shift 器件靠 fillx 决定
  // 「移位量取不出时补 x 还是补 0」—— 丢掉 fillx 后仿真行为会变。
  reg signed [15:0] sacc = 16'sd0;
  wire [15:0] ashifted;
  always @(posedge clk) sacc <= (sacc >>> sh);
  assign ashift = ashifted;

  // 128×8 的存储器：words(SIZE) 与 offset 只在 yosys2digitaljs 的 device 上，
  // 往返丢掉后 digitaljs 会按默认行数建，写进高位地址的数据直接不见。
  reg [7:0] mem [0:127];
  integer i;
  initial for (i = 0; i < 128; i = i + 1) mem[i] = i[7:0] ^ 8'h5A;
  always @(posedge clk) if (we) mem[waddr] <= wdata;
  assign rdata = mem[waddr];
endmodule
