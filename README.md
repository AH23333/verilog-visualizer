# Verilog Visualizer

A desktop application that compiles Verilog code and renders interactive circuit diagrams using [DigitalJS](https://github.com/tilk/digitaljs) and [Yosys](https://github.com/YosysHQ/yosys).

## Features

- **Verilog Compilation** — Compile `.v` files to circuit netlists in the browser using Yosys WASM
- **Interactive Circuit Visualization** — Explore and interact with the rendered circuit (click switches, observe signal propagation)
- **Gate-Level & Behavioral Support** — Supports both gate-level netlists and behavioral Verilog (synthesizable subset)
- **Interface Check before Rendering** — Module-interface problems (ports driven by expressions of the wrong width, nets that don't exist) are validated up front and reported one line per entry, with the real source line attached and clickable in the Problems panel. `test_files/test_counter.v` is refused this way (it is a gate-level netlist whose wires are never declared). When a netlist *does* compile but has multi-driver conflicts, the circuit is still drawn and the conflicts are listed as problems instead of silently mis-simulating.
- **Sandbox Mode** — A free-form logic designer beside the compile flow: its own `.djs` file system (folders included), 9 grouped device families (arithmetic, comparators, mux families, bus regroup/slice, RAM, FSM, displays), per-device right-click editors, live simulation with a **waveform panel and a 5–200 ms speed slider**
- **Parts and Bindings** — Any canvas can be saved as an editable part (`.djs`, `role:'part'`) and placed as a subcircuit; instances bind to part **files** through scope-aware resolution, and a **part-binding overview** (left panel → 部件绑定) lists every instance on the canvas with its state (`未绑定 / 绑定失效 / 已绑定`), the folder the name actually resolves to, and one-click rebind
- **Compile → Sandbox round-trip** — "复制到沙盒" carries the netlist together with its constructor-time parameters, so the sandbox circuit simulates the same as the compiled one
- **Split View & Cross-highlight** — Code and circuit side by side; cursor position ↔ cell selection
- **Theme-aware rendering** — Light/dark, with device and wire labels following the theme instead of being painted black
- **Cross-Platform Desktop App** — Built with Tauri for Windows, macOS, and Linux

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | [Tauri 2](https://tauri.app/) |
| Frontend | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| Build Tool | [Vite 7](https://vitejs.dev/) |
| Circuit Simulator | [DigitalJS](https://github.com/tilk/digitaljs) |
| Verilog Compiler | [Yosys (WASM)](https://github.com/YosysHQ/yosys) |
| Yosys to DigitalJS Bridge | [yosys2digitaljs](https://github.com/tilk/yosys2digitaljs) |

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8
- [Rust](https://www.rust-lang.org/) (for Tauri)
- Platform-specific Tauri dependencies (see [Tauri Prerequisites](https://tauri.app/start/prerequisites/))

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/verilog-visualizer.git
cd verilog-visualizer

# Install dependencies
pnpm install
```

## Development

```bash
# Start the Tauri development server (opens the desktop app)
pnpm tauri dev
```

The Vite dev server runs at `http://localhost:1420` and the Tauri app window will open automatically.

## Usage

Compile flow:

1. Launch the application
2. Open or paste a `.v` file (the editor is a real CodeEditor; `F5` compiles)
3. The circuit renders interactively — click inputs / clocks, hover a wire for its value,
   double-click a subcircuit (or its 🔍) to drill in
4. `PROBLEMS` lists interface / compile errors with the source line; click one to jump
5. 「复制到沙盒」 hands the same circuit (with its parameters) to the sandbox for free-form editing

Sandbox flow: left ActivityBar → 沙盒 / 文件 / 部件. New canvas from the tree, place devices from
the grouped library, drag wires between ports, run / pause with the SPEED slider, open the
waveform panel to watch channels, save a selection as a part (「保存为自定义门」) and place it
again as a single instance. 部件绑定 in the same panel shows which instance resolves to which
part file — and which ones are broken.

Right-click a device to reconfigure it — everything that digitaljs only accepts at
construction time goes through a rebuild that keeps id, position, label and wires:

- 存储器: 端口配置… (read/write ports, clocks, enables, reset values, mem init)
- 状态机: 转移表… (states, transitions, init state)
- 寄存器 (D 触发器): 端口与极性… — per-control-pin clock/enable/async-reset/sync-reset/
  set/clr/async-load, each high- or low-active (低有效 pins draw an overline), plus
  arst/srst values, enable-vs-reset semantics, and a "no D port" set/reset-latch mode
- 算术 / 比较器 / 移位: 位宽, 有符号 per operand (signed only takes effect when **both**
  operands are signed — same rule as Verilog), and 移出空隙补 x for shifts
- 变换: 旋转 90° (multi-select rotates around the selection's bounding-box center,
  not per-part), plus 水平 / 垂直镜像 (mirror state persists with the save via
  `cellMirror.ts`; multi-select flips each part in place)
- 门族: 输入引脚数 2–16; 总线: 位宽方案 / 分组; IO: 名称 / 位宽 / 初值 / 进制
- 子电路: 绑定… opens a part-rebind dialog (same shape as the compile-mode one) that
  lists every part file in scope and rebinds the instance through a rebuild; sidebar
  **file** context menu also has 绑定… (R100) for file-level binding — a binding-name →
  part-file map stored with the save that takes priority over scope-based resolution
- 展开图 (drill-in) wheel semantics (R100): plain wheel pans vertically, Shift+wheel pans
  horizontally, only Ctrl+wheel zooms anchored at the cursor

### Test Files

Sample Verilog files are included in the `test_files/` directory:

- `test_and.v` — Simple AND gate
- `test_counter_behavioral.v` — 4-bit counter (behavioral, Yosys-compatible)
- `test_counter.v` — 4-bit counter (gate-level netlist whose wires are never declared —
  intentionally refused by the interface check, with one problem per offending line)

## Regression gates

`tests/` holds Playwright-driven acceptance gates (headless Edge against a local Vite server).

```bash
node tests/run-all.cjs        # full batch, three-state verdicts (pass / fail / not-verified)
node tests/r84-binding-gate.cjs   # a single gate
node tests/r84-mutate.cjs --check # mutation-probe a gate: does it actually go red when the feature breaks?
```

Every gate prints per-arm verdicts and an exit code; `tests/_ui.cjs` holds the shared fixtures
(boot without `networkidle`, palette/expander handling, overlay-safe clicks). New capability ⇒
new gate, and the gate gets mutation-checked before it is counted as coverage.

## Project Structure

```
verilog-visualizer/
├── index.html                  # Entry HTML
├── package.json                # Node dependencies
├── vite.config.ts              # Vite configuration
├── tsconfig.json               # TypeScript config
├── public/
│   ├── digitaljs.js            # DigitalJS UMD bundle
│   └── yosys/
│       ├── yosys.browser.js    # Yosys WASM JS wrapper
│       └── yosys.wasm          # Yosys WebAssembly (~16 MB)
├── src/
│   ├── main.tsx                # React entry point
│   ├── App.tsx                 # Shell: views, compile pipeline, status/problems
│   ├── index.css               # Global styles (theme variables)
│   ├── components/
│   │   ├── Canvas.tsx          # Compile-mode circuit renderer
│   │   ├── SandboxCanvas.tsx   # Sandbox: paper, palette, right-click editors, parts
│   │   ├── SandboxFileTree.tsx # Sandbox file system (folders, drag-move, context menu)
│   │   ├── WaveformPanel.tsx   # Channel / waveform debug
│   │   ├── OutputPanel.tsx     # PROBLEMS list (jump-to-line)
│   │   └── …                   # SettingsPanel, MenuBar, modals (FSM / memory / expand …)
│   ├── lib/
│   │   ├── verilog.ts          # Yosys compile + interface validation
│   │   ├── gateSystem.ts       # Part files: resolve / save / strip / carry definitions
│   │   ├── deviceParams.ts     # Constructor-time parameter round-trip
│   │   ├── subcircuitView.ts   # Drill-down rendering (shared by both modes)
│   │   ├── simClock.ts         # Simulation tick (speed-controllable, both modes)
│   │   └── digitaljs.d.ts      # TypeScript type declarations
│   └── store/                  # settingsStore / fileStore / sandboxStore …
├── tests/                      # Playwright acceptance gates + shared fixtures (`_ui.cjs`)
├── docs/                       # SANDBOX_DEV.md（沙盒实现细节）/ FEATURES_BEYOND_PLAN.md / 评审记录
├── src-tauri/
│   ├── Cargo.toml              # Rust dependencies
│   ├── tauri.conf.json         # Tauri configuration
│   ├── src/
│   │   ├── main.rs             # Rust entry point
│   │   └── lib.rs              # Tauri app setup
│   └── icons/                  # Application icons
└── test_files/                 # Sample Verilog test files
```

## How It Works

1. User selects a `.v` file via the file dialog
2. The Verilog source is written to the Yosys WASM virtual filesystem
3. Yosys compiles the Verilog into a JSON netlist
4. [yosys2digitaljs](https://github.com/tilk/yosys2digitaljs) converts the Yosys JSON to DigitalJS circuit format
5. DigitalJS renders the interactive circuit diagram on an SVG canvas

## License

MIT

## Acknowledgments

- [DigitalJS](https://github.com/tilk/digitaljs) — Digital circuit simulator in JavaScript
- [Yosys](https://github.com/YosysHQ/yosys) — Open-source Verilog synthesis framework
- [yosys2digitaljs](https://github.com/tilk/yosys2digitaljs) — Yosys to DigitalJS converter
- [Tauri](https://tauri.app/) — Cross-platform desktop app framework