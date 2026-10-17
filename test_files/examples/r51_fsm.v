// R51 判据用设计：分层状态机（Moore + Mealy 混合），专门用来验证 yosys
// `fsm -nomap -expand` 出来的 $fsm 单元能不能变成 digitaljs 的 FSM 器件。
// 覆盖面：
//  - 异步低有效复位（digitaljs FSM 的 arst 极性）
//  - 4 bit 状态编码、5 个状态（STATE_NUM / STATE_NUM_LOG2）
//  - 条件输入 go/hit 进 CTRL_IN，led/busy/done 进 CTRL_OUT
//  - 同一段 case 里既有 Mealy 输出（ack）又有 Moore 输出（led）
//  - 子模块（计数器）与 FSM 混排：验证 flatten 后 FSM 不丢
module r51_fsm (
  input  wire       clk,
  input  wire       rst_n,
  input  wire       go,
  input  wire       hit,
  output reg  [3:0] led,
  output reg        busy,
  output reg        done,
  output reg        ack
);
  localparam S_IDLE = 4'd0, S_RUN = 4'd1, S_WAIT = 4'd2, S_DONE = 4'd3, S_ERR = 4'd4;

  reg [3:0] state, next;
  reg [7:0] cnt;

  always @(posedge clk or negedge rst_n)
    if (!rst_n) state <= S_IDLE;
    else        state <= next;

  always @(*) begin
    next = state;
    case (state)
      S_IDLE: if (go)  next = S_RUN;
      S_RUN:  if (hit) next = S_WAIT;
              else if (!go) next = S_IDLE;
      S_WAIT: next = S_DONE;
      S_DONE: next = S_ERR;
      default: next = S_IDLE;
    endcase
  end

  always @(*) begin
    led   = 4'b0000;
    busy  = 1'b0;
    done  = 1'b0;
    ack   = 1'b0;
    case (state)
      S_IDLE: led = 4'b0001;
      S_RUN:  begin led = 4'b0010; busy = 1'b1; ack = hit; end
      S_WAIT: begin led = 4'b0100; busy = 1'b1; end
      S_DONE: begin led = 4'b1000; done = 1'b1; end
      default: led = 4'b1111;
    endcase
  end

  always @(posedge clk or negedge rst_n)
    if (!rst_n)     cnt <= 8'd0;
    else if (busy)  cnt <= cnt + 8'd1;
endmodule
