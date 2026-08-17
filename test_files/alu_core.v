// ALU core — instantiates adder and multiplier
// Hierarchy: alu_core → adder → full_adder (3 levels)
//            alu_core → multiplier → adder → full_adder (4 levels)

module alu_core (
    input clk,
    input rst_n,
    input [3:0] op_a,
    input [3:0] op_b,
    input [1:0] opcode,
    input enable,
    output reg [3:0] result,
    output reg carry,
    output reg done
);

    wire [3:0] add_result;
    wire add_carry;
    wire [3:0] mul_result;

    // Instantiate 4-bit adder (defined in adder.v)
    adder u_adder (
        .a(op_a),
        .b(op_b),
        .cin(1'b0),
        .sum(add_result),
        .cout(add_carry)
    );

    // Instantiate 4-bit multiplier (defined in multiplier.v)
    multiplier u_multiplier (
        .a(op_a),
        .b(op_b),
        .product(mul_result)
    );

    // Opcode: 00 = ADD, 01 = SUB, 10 = MUL, 11 = PASS_A
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            result <= 4'b0;
            carry <= 1'b0;
            done <= 1'b0;
        end else if (enable) begin
            case (opcode)
                2'b00: begin
                    result <= add_result;
                    carry <= add_carry;
                end
                2'b01: begin
                    result <= op_a - op_b;
                    carry <= 1'b0;
                end
                2'b10: begin
                    result <= mul_result;
                    carry <= 1'b0;
                end
                2'b11: begin
                    result <= op_a;
                    carry <= 1'b0;
                end
                default: begin
                    result <= 4'b0;
                    carry <= 1'b0;
                end
            endcase
            done <= 1'b1;
        end else begin
            done <= 1'b0;
        end
    end

endmodule