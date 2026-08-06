import { useState, useCallback } from "react";
import Canvas from "./components/Canvas";
import { compileVerilog } from "./lib/verilog";

type Status = "idle" | "compiling" | "done" | "error";

export default function App() {
  const [circuitJson, setCircuitJson] = useState<any>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");

  const handleFileSelect = useCallback(async () => {
    try {
      setStatus("idle");
      setMessage("");

      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".v,.sv,.vh";

      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        setFileName(file.name);
        setStatus("compiling");
        setMessage("Compiling Verilog...");

        try {
          const text = await file.text();
          const json = await compileVerilog(text);
          setCircuitJson(json);
          setStatus("done");
          setMessage("Done! Click switches to interact.");
        } catch (err: any) {
          setStatus("error");
          setMessage(err.message || "Compilation failed");
          console.error(err);
        }
      };

      input.click();
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message);
    }
  }, []);

  const handleError = useCallback((msg: string) => {
    setStatus("error");
    setMessage(msg);
  }, []);

  const statusColor =
    status === "error" ? "#f44336" :
    status === "done" ? "#4caf50" :
    status === "compiling" ? "#ff9800" : "#ccc";

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          background: "#2d2d2d",
          borderBottom: "1px solid #444",
          flexShrink: 0,
        }}
      >
        <button
          onClick={handleFileSelect}
          disabled={status === "compiling"}
          style={{
            padding: "8px 20px",
            background: status === "compiling" ? "#555" : "#4caf50",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: status === "compiling" ? "not-allowed" : "pointer",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {status === "compiling" ? "Compiling..." : "Select .v File"}
        </button>
        <span style={{ color: statusColor, fontSize: 13 }}>
          {fileName ? fileName + " \u2014 " + message : message || "Select a Verilog file to begin"}
        </span>
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        {circuitJson ? (
          <Canvas circuitJson={circuitJson} onError={handleError} />
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
              color: "#666",
              fontSize: 18,
              userSelect: "none",
            }}
          >
            Click &quot;Select .v File&quot; to import Verilog code
          </div>
        )}
      </div>
    </div>
  );
}
