<div align="center">

# Verilog Visualizer

**Verilog 编译 + 可交互电路图 + 自由逻辑沙盒 —— 本地桌面应用**
**Verilog compilation, interactive circuit diagrams & a free-form logic sandbox — as a local desktop app**

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#-快速开始--quick-start)
[![License MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-blue)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![Gates](https://img.shields.io/badge/regression%20gates-70%2B-brightgreen)](./docs/DEVELOPMENT.md)

中文 · [English](#introduction-english) ｜ 📚 全部文档见 [docs/README.md](./docs/README.md)

</div>

---

## 简介

**Verilog Visualizer** 是一个完全离线运行的数字逻辑桌面工具，把两条工作流合于一窗：

- **编译模式** — 打开 `.v` 文件，Yosys（WASM）现场综合，电路图交互式渲染：点开关、看信号传播、悬停读线值、双击子模块钻取；代码 ↔ 电路双向高亮联动，接口预检把问题逐条钉在源码行上。
- **沙盒模式** — 自由画布逻辑设计器：自带 `.djs` 文件系统（含文件夹）、9 组器件库、逐器件右键配置器、表达式生成器（布尔式 → 电路，支持多位总线/切片/拼接/常量）、波形调试、画布注释便签。任何画布可「保存为部件」被实例化复用，部件文件之间按名绑定、自动检测循环依赖。

两种模式可互通：编译出的电路一键「复制到沙盒」（含构造期参数与递归部件迁移），沙盒仿真行为与编译模式对齐。

## Introduction (English)

**Verilog Visualizer** is a fully offline digital-logic desktop tool that unifies two workflows in one window:

- **Compile mode** — open a `.v` file, synthesize on the fly with Yosys (WASM), and explore the rendered circuit interactively: click switches, watch signals propagate, hover wires for values, double-click subcircuits to drill in. Code ↔ circuit cross-highlighting, and an interface pre-check that pins every problem to a real source line in the Problems panel.
- **Sandbox mode** — a free-form logic designer: its own `.djs` file system (folders included), a 9-family device library, per-device right-click reconfiguration, an expression generator (Boolean equations → circuit, with multi-bit buses / slices / concatenation / constants), a waveform debug panel, and sticky notes. Any canvas can be saved as a reusable *part*; parts bind to files by name with automatic circular-dependency detection.

The two modes interoperate: one click copies a compiled circuit (constructor-time parameters and recursive parts included) into the sandbox, where it simulates identically.

## 核心特性 / Key Features

| 领域 Area | 能力 Capability |
|-----------|-----------------|
| 综合 Synthesis | Yosys WASM 双流（默认流 + 实验流）；接口预检分级：无名冲突拒编、具名冲突出图标红 |
| 渲染 Rendering | DigitalJS 交互电路；深浅主题全链路（器件/线名/注释随主题，非刷黑） |
| 沙盒 Sandbox | `.djs` 文件树 + 文件夹；9 组器件；逐器件右键重建式配置（端口表/极性/位宽/分组/转移表…） |
| 部件 Parts | 画布 → 可编辑部件文件；作用域感知绑定 + 文件级换绑；循环依赖检测与断环渲染 |
| 表达式 Expr | 多语句布尔式 → 电路；`a[3:0]` 切片、`{A,B}` 拼接、常量、CSE 共享、直接存部件 |
| 调试 Debug | 波形面板（通道/缩放/跟随仿真速度）；单步；输入面板；PROBLEMS 跳转 |
| 注释 Notes | 双击空白建便签（正向编辑、旋转/镜像保持）；自动换行贴字；边/角手柄缩放；展开图原位叠加 |
| 导出 Export | SVG（深度重绘无 foreignObject）/ 电路 JSON / 综合网表 / `.djs`（含部件闭包） |
| 质量 Quality | 70+ Playwright 验收闸门 + 变异台架；三态判定（pass/fail/未验证）；每能力必配闸门 |

## 快速开始 / Quick Start

```bash
# 前置 Prerequisites: Node.js ≥ 18, pnpm ≥ 8, Rust（Tauri 构建用）
pnpm install

# 桌面开发（需 Rust 工具链）Desktop dev (needs Rust toolchain)
pnpm tauri dev

# 纯前端预览（无需 Rust）Browser-only preview (no Rust needed)
pnpm dev          # → http://localhost:1420
```

发布构建 Release build: `pnpm tauri build`。

## 文档 / Documentation

| 文档 Doc | 内容 |
|----------|------|
| [📖 文档地图 Docs Index](./docs/README.md) | 全部文档导航（diátaxis 分区） |
| [🚀 入门指南 Getting Started](./docs/GETTING_STARTED.md) | 第一个电路 → 沙盒 → 部件（双语教程） |
| [📖 用户指南 User Guide](./docs/USER_GUIDE.md) | 两模式全部操作（双语 how-to） |
| [🏗 架构 Architecture](./docs/ARCHITECTURE.md) | 模块图、数据流、关键决策（双语） |
| [🧪 开发与测试 Development](./docs/DEVELOPMENT.md) | 环境、闸门体系、提交规范（双语） |
| [📜 变更日志 CHANGELOG](./docs/CHANGELOG.md) | R37 → R123 里程碑（keep-a-changelog） |
| [⚖️ 第三方许可 Third-Party Notices](./docs/THIRD_PARTY_NOTICES.md) | MPL-2.0 / BSD-2 / EPL-2.0 等义务声明 |
| [🔧 沙盒实现细节 SANDBOX_DEV](./docs/SANDBOX_DEV.md) | 活文档：沙盒管线与探针教训 |
| [🗂 历史归档 Archive](./docs/archive/) | 评审/交接/可行性等历史快照 |

## 回归闸门 / Regression Gates

`tests/` 内是 Playwright 驱动的验收闸门（headless Edge 对本地 Vite 服务）。

```bash
node tests/run-all.cjs              # 全量跑批：三态判定 pass / fail / 未验证
node tests/r84-binding-gate.cjs     # 单跑一个闸门
node tests/r84-mutate.cjs --check   # 变异台架：验证闸门在功能坏掉时确实会红
```

约定：**新能力必配新闸门**，闸门先过变异检查才计入覆盖面。详见 [DEVELOPMENT.md](./docs/DEVELOPMENT.md)。

## 技术栈 / Tech Stack

Tauri 2 · React 19 · TypeScript (strict) · Vite 7 · DigitalJS · Yosys WASM · yosys2digitaljs · JointJS(@joint/core) · elkjs · CodeMirror 6

## 许可 / License

本项目源码以 **MIT** 许可发布（见 [LICENSE](./LICENSE)）。捆绑的第三方运行时（JointJS **MPL-2.0**、DigitalJS/yosys2digitaljs/3vl **BSD-2-Clause**、elkjs **EPL-2.0** 等）各自保留其许可义务，全文清单见 [docs/THIRD_PARTY_NOTICES.md](./docs/THIRD_PARTY_NOTICES.md)。

## 致谢 / Acknowledgments

[DigitalJS](https://github.com/tilk/digitaljs) · [Yosys](https://github.com/YosysHQ/yosys) · [yosys2digitaljs](https://github.com/tilk/yosys2digitaljs) · [Tauri](https://tauri.app/) · [JointJS](https://www.jointjs.com/)
