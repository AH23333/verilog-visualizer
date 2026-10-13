<div align="center">

# Verilog Visualizer

**Verilog 编译 + 可交互电路图 + 自由逻辑沙盒 —— VS Code 里的本地桌面工具**
**Verilog compilation, interactive circuit diagrams & a free-form logic sandbox — as a VS Code extension**

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#-快速开始--quick-start)
[![License MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![VS Code](https://img.shields.io/badge/host-VS%20Code%20extension-007acc)](./docs/MIGRATION_VSCODE.md)
[![React 19](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![Gates](https://img.shields.io/badge/regression%20gates-70%2B-brightgreen)](./docs/DEVELOPMENT.md)

中文 · [English](#introduction-english) ｜ 📚 全部文档见 [docs/README.md](./docs/README.md)

</div>

---

## 宿主 / Host（2026-10-13 定形）

**目标形态＝自带 VS Code 源码分支、出独立二进制**（Cursor / Windsurf 同族做法）：整体 UI 就是 VS Code 的
workbench，我们的东西住进它的原生位置（Explorer / 编辑器标签 / Output / Problems / Settings），
用户⛔ 需要另外装 VS Code。分期与实测前置见 [studio/README.md](./studio/README.md)。

诚实版进度：
- ✅ **Tauri 那条线整条已拆**（`src-tauri/`、Rust 后端 14 颗命令、`tauriHost`、自绘标题栏 `WindowControls.tsx`；
  要找回那一版走 git，账本卷四十三末尾有提交号）。
- ✅ **宿主中立层已跑通**：`pnpm app` 能起一个挂了本扩展的开发窗口。⚠ 它是**开发用入口，⛔ 产品本身**，
  而且此刻界面仍是我们自绘的那套（还没换成 workbench 原生）——这一点上一批我写成"唯一宿主＝扩展壳"，方向报错了。
- ⬜ **基座已就位并跑通过一次**（仓库外 `D:\vv-studio\vscode`，Code - OSS 1.143.0）：`pnpm studio:brand` 把品牌
  合进基座 `product.json` 并把我们的扩展装成它的内置扩展；基座 `npm install` + `compile-client` + `electron`
  本轮真跑通，起的是**我们自己的二进制**（`.build/electron/Verilog Visualizer.exe`，239,129,088 字节），
  内置扩展在里头激活并自动把画布弹出来。**还没做的是把界面换成 workbench 原生位置**（片 3b/4）。
- ⬜ **片 3a 已落**：项目根＝**打开的那个文件夹**（⛔ 文件夹时退回旧家），原生 Explorer 从此看得见工程文件；
  工程配置留在应用级（⛔ 往用户仓库里扔配置文件）；并给 Extension Host 建起一面无头网
  （`tests/unit/vscodeApiStub.ts` + `tests/unit/extensionHost.test.ts` 25 格，vitest 97/97）。
- 前端⛔ 直连宿主 API：文件/配置/另存为/剪贴板全部从 `src/lib/host/` 进出，按运行时探测 `vscodeHost` / `browserHost`。

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
# 前置 Prerequisites: Node.js ≥ 18, pnpm ≥ 8, VS Code
pnpm install                    # 包管理是 pnpm（有 pnpm-lock.yaml；⛔ 别混用 npm/yarn 生成第二把锁）
pnpm app                        # ← 就这一条：缺产物就编，找到 VS Code 就开窗口，画布自己弹出来
```

`pnpm app` 干三件事（`scripts/run-in-vscode.mjs`）：① `dist/` 缺、或 `src/` 里有比它新的文件 ⇒ 先 `pnpm build`；
② 编 Extension Host（`extension/dist/extension.cjs`）；③ 用 `--extensionDevelopmentPath` 起一个 VS Code 窗口——
扩展在开发宿主模式下**自己把画布面板弹出来**，⛔ 要你按 F5、⛔ 要你去命令面板找命令。
找不到 `code` 命令行时，它会列出试过的位置并给一条 `VSCODE_BIN=<路径> pnpm app` 的退路。
只想看它打算干什么（⛔ 真开窗口）：`pnpm app:check`。

**装进你自己的 VS Code（一次装好，之后从侧栏点开即可）**

```bash
pnpm ext:package                                    # 产 extension/verilog-visualizer-vscode-<版本>.vsix
code --install-extension extension\verilog-visualizer-vscode-0.0.1.vsix
```

**另两条入口**

```bash
pnpm dev                 # 纯浏览器预览 → http://localhost:1420（⛔ 宿主落盘，导出退化为 <a download>）
node tests/run-all.cjs   # 全量回归闸门（headless Edge，73 格）
```

改前端后的回路是「`pnpm build` → 重载那个窗口」；只有 `extension/src/**` 改了才需要重编扩展（或 `pnpm ext:watch`）。

## 文档 / Documentation

| 文档 Doc | 内容 |
|----------|------|
| [📖 文档地图 Docs Index](./docs/README.md) | 全部文档导航（diátaxis 分区） |
| [🚀 入门指南 Getting Started](./docs/GETTING_STARTED.md) | 第一个电路 → 沙盒 → 部件（双语教程） |
| [📖 用户指南 User Guide](./docs/USER_GUIDE.md) | 两模式全部操作（双语 how-to） |
| [🏗 架构 Architecture](./docs/ARCHITECTURE.md) | 模块图、数据流、关键决策（双语） |
| [🧪 开发与测试 Development](./docs/DEVELOPMENT.md) | 环境、闸门体系、提交规范（双语） |
| [📜 变更日志 CHANGELOG](./docs/CHANGELOG.md) | R37 → R139 里程碑（keep-a-changelog） |
| [🔌 VS Code 套壳迁移台账](./docs/MIGRATION_VSCODE.md) | 宿主真值：已落地层、CSP 实测结论、步骤射程、**真机点验单** |
| [⚖️ 第三方许可 Third-Party Notices](./docs/THIRD_PARTY_NOTICES.md) | MPL-2.0 / BSD-2 / EPL-2.0 等义务声明 |
| [🔧 沙盒实现细节 SANDBOX_DEV](./docs/SANDBOX_DEV.md) | 活文档：沙盒管线与探针教训 |
| [🗂 历史归档 Archive](./docs/archive/) | 评审/交接/可行性等历史快照 |

## 回归闸门 / Regression Gates

`tests/` 内是 Playwright 驱动的验收闸门（headless Edge 对本地 Vite 服务）。

```bash
pnpm test                         # lib 层单测（vitest，tests/unit/**：解析/冲突分级/电路后处理/宿主调用层的实测行为）
node tests/run-all.cjs              # 全量跑批：三态判定 pass / fail / 未验证
node tests/r84-binding-gate.cjs     # 单跑一个闸门
node tests/r84-mutate.cjs --check   # 变异台架：验证闸门在功能坏掉时确实会红
```

约定：**新能力必配新闸门**，闸门先过变异检查才计入覆盖面。详见 [DEVELOPMENT.md](./docs/DEVELOPMENT.md)。
宿主能力（文件/配置/另存为/剪贴板）只从 `src/lib/host/` 进出——UI 里 ⛔ 直连任何宿主 API；VS Code 套壳迁移的执行台账见 [MIGRATION_VSCODE.md](./docs/MIGRATION_VSCODE.md)。
导出面：两个模式各给 **SVG / 电路 JSON / 综合网表**（PNG 已按裁决全线砍掉）；沙盒导出的 SVG 是
自包含图形（计算样式内联、底色跟随主题、按模型包围盒取景），编译模式走同一份构建器。

## 技术栈 / Tech Stack

VS Code 扩展壳（WebviewPanel + esbuild）· React 19 · TypeScript (strict) · Vite 7 · DigitalJS · Yosys WASM · yosys2digitaljs · JointJS(@joint/core) · elkjs · CodeMirror 6

## 许可 / License

本项目源码以 **MIT** 许可发布（见 [LICENSE](./LICENSE)）。捆绑的第三方运行时（JointJS **MPL-2.0**、DigitalJS/yosys2digitaljs/3vl **BSD-2-Clause**、elkjs **EPL-2.0** 等）各自保留其许可义务，全文清单见 [docs/THIRD_PARTY_NOTICES.md](./docs/THIRD_PARTY_NOTICES.md)。

## 致谢 / Acknowledgments

[DigitalJS](https://github.com/tilk/digitaljs) · [Yosys](https://github.com/YosysHQ/yosys) · [yosys2digitaljs](https://github.com/tilk/yosys2digitaljs) · [JointJS](https://www.jointjs.com/) · [VS Code Extension API](https://code.visualstudio.com/api)
