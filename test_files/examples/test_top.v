// Top-level module that instantiates a sub-module
module top_module(
    input clk,
    input rst,
    input a,
    input b,
    output reg q
);

    wire sub_out;

    // Instantiate sub-module (defined in test_submod.v)
    sub_module u_sub (
        .a(a),
        .b(b),
        .out(sub_out)
    );

    always @(posedge clk or posedge rst) begin
        if (rst)
            q <= 1'b0;
        else
            q <= sub_out;
    end

endmodule