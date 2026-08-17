// 1-bit full adder — leaf module (no dependencies)
// This is the deepest leaf in the hierarchy

module full_adder (
    input a,
    input b,
    input cin,
    output sum,
    output cout
);

    wire xor_ab;
    wire and_ab;
    wire and_xc;

    assign xor_ab = a ^ b;
    assign sum = xor_ab ^ cin;
    assign and_ab = a & b;
    assign and_xc = xor_ab & cin;
    assign cout = and_ab | and_xc;

endmodule