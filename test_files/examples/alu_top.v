// Top-level ALU module — instantiates alu_core and fsm_controller
// Hierarchy: alu_top → alu_core → adder → full_adder (4 levels deep)
//            alu_top → alu_core → multiplier → adder → full_adder (5 levels deep)
//            alu_top → fsm_controller → counter (3 levels, cross-dependency)

module alu_top (
    input clk,
    input rst_n,
    input [3:0] op_a,
    input [3:0] op_b,
    input [1:0] opcode,
    output reg [3:0] result,
    output reg carry_out,
    output reg done
);

    wire [3:0] core_result;
    wire core_carry;
    wire core_done;

    wire [3:0] fsm_count;
    wire fsm_enable;

    // Instantiate the ALU core (defined in alu_core.v)
    alu_core u_alu_core (
        .clk(clk),
        .rst_n(rst_n),
        .op_a(op_a),
        .op_b(op_b),
        .opcode(opcode),
        .enable(fsm_enable),
        .result(core_result),
        .carry(core_carry),
        .done(core_done)
    );

    // Instantiate the FSM controller (defined in fsm_controller.v)
    fsm_controller u_fsm (
        .clk(clk),
        .rst_n(rst_n),
        .count(fsm_count),
        .enable(fsm_enable)
    );

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            result <= 4'b0;
            carry_out <= 1'b0;
            done <= 1'b0;
        end else begin
            result <= core_result;
            carry_out <= core_carry;
            done <= core_done;
        end
    end

endmodule