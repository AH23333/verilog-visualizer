// 4-bit combinational multiplier using adder
// Hierarchy: multiplier → adder → full_adder (3 levels)

module multiplier (
    input [3:0] a,
    input [3:0] b,
    output [7:0] product
);

    wire [3:0] partial_0;
    wire [3:0] partial_1;
    wire [3:0] partial_2;
    wire [3:0] partial_3;

    wire [3:0] sum_0;
    wire cout_0;
    wire [3:0] sum_1;
    wire cout_1;
    wire [3:0] sum_2;
    wire cout_2;

    // Partial products
    assign partial_0 = a & {4{b[0]}};
    assign partial_1 = a & {4{b[1]}};
    assign partial_2 = a & {4{b[2]}};
    assign partial_3 = a & {4{b[3]}};

    // Add partial products using adder (defined in adder.v)
    adder add_0 (
        .a({1'b0, partial_0[3:1]}),
        .b(partial_1),
        .cin(1'b0),
        .sum(sum_0),
        .cout(cout_0)
    );

    adder add_1 (
        .a({cout_0, sum_0[3:1]}),
        .b(partial_2),
        .cin(1'b0),
        .sum(sum_1),
        .cout(cout_1)
    );

    adder add_2 (
        .a({cout_1, sum_1[3:1]}),
        .b(partial_3),
        .cin(1'b0),
        .sum(sum_2),
        .cout(cout_2)
    );

    assign product = {cout_2, sum_2, sum_1[0], sum_0[0], partial_0[0]};

endmodule