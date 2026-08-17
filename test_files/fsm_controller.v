// FSM controller — instantiates a counter (cross-dependency)
// Hierarchy: fsm_controller → counter (2 levels)

module fsm_controller (
    input clk,
    input rst_n,
    output reg [3:0] count,
    output reg enable
);

    wire [3:0] counter_value;

    // Instantiate counter (defined in test_counter_behavioral.v)
    counter u_counter (
        .clk(clk),
        .reset(~rst_n),
        .count(counter_value)
    );

    // FSM: enable signal based on counter value
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            count <= 4'b0;
            enable <= 1'b0;
        end else begin
            count <= counter_value;
            // Enable ALU when counter is in range [2, 13]
            if (counter_value >= 4'd2 && counter_value <= 4'd13)
                enable <= 1'b1;
            else
                enable <= 1'b0;
        end
    end

endmodule