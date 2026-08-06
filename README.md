# Verilog Visualizer

A desktop application that compiles Verilog code and renders interactive circuit diagrams using [DigitalJS](https://github.com/tilk/digitaljs) and [Yosys](https://github.com/YosysHQ/yosys).

## Features

- **Verilog Compilation** — Compile `.v` files to circuit netlists in the browser using Yosys WASM
- **Interactive Circuit Visualization** — Explore and interact with the rendered circuit (click switches, observe signal propagation)
- **Gate-Level & Behavioral Support** — Supports both gate-level netlists and behavioral Verilog (synthesizable subset)
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

1. Launch the application
2. Click **"Select .v File"** to import a Verilog source file
3. The circuit will be compiled and rendered interactively
4. Click on switches and observe signal propagation in real-time

### Test Files

Sample Verilog files are included in the `test_files/` directory:

- `test_and.v` — Simple AND gate
- `test_counter_behavioral.v` — 4-bit counter (behavioral, Yosys-compatible)
- `test_counter.v` — 4-bit counter (gate-level netlist)

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
│   ├── App.tsx                 # Main application component
│   ├── index.css               # Global styles
│   ├── components/
│   │   └── Canvas.tsx          # DigitalJS circuit renderer
│   └── lib/
│       ├── verilog.ts          # Yosys compilation & DigitalJS conversion
│       └── digitaljs.d.ts      # TypeScript type declarations
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