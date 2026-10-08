// R56 判据设计（多驱动冲突的两条脸，对应他定的产品口径）：
//   ① 同名 net 上挂了两个驱动（assign 两次）—— net 名拿得到 ⇒ 照常出图 + 报冲突告警；
//   ② 手工门级网表里两个例化驱动同一根线，且 yosys 优化后 net 名是 undefined ⇒ 直接拒编译，
//      错误里要说清"这是门级网表的形状"，不许甩 yosys2digitaljs 的内部异常。
module r56_conflict_named (
  input  wire a,
  input  wire b,
  output wire y,
  output wire z
);
  wire dup;              // 故意让两个驱动挂同一根有名字的线
  assign dup = a & b;
  assign dup = a | b;
  assign y   = dup;
  assign z   = a ^ b;
endmodule
