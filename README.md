<div align="center">

# Verilog Visualizer

**Verilog 编译 + 可交互电路图 + 自由逻辑沙盒 —— 自带 VS Code 骨架的离线桌面应用（迁移中）**
**Verilog compilation, interactive circuit diagrams & a free-form logic sandbox — a standalone VS Code–based app (migration in progress)**

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#-快速开始--quick-start)
[![License MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Host](https://img.shields.io/badge/host-our%20own%20Code%20--%20OSS%20build-007acc)](./studio/README.md)
[![React 19](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![Gates](https://img.shields.io/badge/regression%20gates-70%2B-brightgreen)](./docs/DEVELOPMENT.md)

中文 · [English](#introduction-english) ｜ 📚 全部文档见 [docs/README.md](./docs/README.md)

</div>

---

## 宿主 / Host（2026-10-13 二次定形）

**目标形态＝自带 VS Code 源码分支、出独立二进制**（Cursor / Windsurf 同族做法），且**⛔ 是"在壳里打开一个网页"**：
要做的是把三块东西**移植到宿主已有的原语上**——**绑定系统 → 壳的文件系统**、**模块／层次结构两个板块 → 原生 Outline 与 TreeView**、
**沙盒系统 → `.djs` 成为工作区里的真文档**；搬完那颗装整套 SPA 的面板就退役。工单与实测前置见 [studio/README.md](./studio/README.md)（§0b/§3）。

**版本线**（同日裁定）：`main` ＝ **无 agent 功能**那份，已推到 `819563d`（R135）；往后的提交都走**新分支 `agent`**（本地，⛔ 未推；他令分支名⛔ 带中文 ⇒ 口径名「agent版」落到 ref 上叫 `agent`）。

诚实版进度：
- ✅ **我们自己的二进制跑得起来**：基座官方启动脚本 `scripts/code.bat --user-data-dir=<独立目录> <工程文件夹>`
  已在 2026-10-13 真跑通（窗口标题 `Verilog Visualizer - demo - Verilog Visualizer Dev`）。
  ⚠ 删掉的是**自写的启动程序**（R138–R140 那两颗 `pnpm studio:run` / `pnpm app:check` 的 .mjs 包装，
  按用户令在 R141 整颗删除；找回走 git）。⚠ 今天仍在的 `pnpm app` **是 package.json 里的一条 npm script**，
  内容＝`pnpm build` + `pnpm -C extension build` + 基座官方 `scripts\code.bat --extensionDevelopmentPath`，
  也就是"官方框架自己的生命周期命令"，⛔ 第三种自造 CLI——这条界线是 9214fc7 当时定的，本行把两边都说清，
  ⛔ 再出现"pnpm app 已删除"那种过时表述（上一版这句在这里躺了几批，与 package.json 相反）。
- ✅ **Tauri 那条线整条已拆**（`src-tauri/`、Rust 后端 14 颗命令、`tauriHost`、自绘标题栏 `WindowControls.tsx`；
  要找回那一版走 git，账本卷四十三末尾有提交号）。
- ✅ **宿主中立层已跑通**：官方 flag `--extensionDevelopmentPath` 能把本扩展挂到任意一份 VS Code / 我们自己的二进制上。
  ⚠ 那是**开发用入口，⛔ 产品本身**，而且此刻界面仍是我们自绘的那套（还没换成 workbench 原生）——
  这一点上一批我写成"唯一宿主＝扩展壳"，方向报错了。
- ⬜ **基座已就位并跑通过一次**（仓库外 `D:\vv-studio\vscode`，Code - OSS 1.143.0）：`pnpm studio:brand` 把品牌
  合进基座 `product.json` 并把我们的扩展装成它的内置扩展；基座 `npm install` + `compile-client` + `electron`
  本轮真跑通，起的是**我们自己的二进制**（`.build/electron/Verilog Visualizer.exe`，239,129,088 字节），
  内置扩展在里头激活并自动把画布弹出来（含在**未信任的工作区**里——那颗坑见 `studio/README.md` §1c）。
- ⬜ **片 3a 已落**：项目根＝**打开的那个文件夹**（⛔ 文件夹时退回旧家），原生 Explorer 从此看得见工程文件；
  工程配置留在应用级（⛔ 往用户仓库里扔配置文件）；并给 Extension Host 建起一面无头网
  （`tests/unit/vscodeApiStub.ts` + `tests/unit/extensionHost.test.ts` 25 格，vitest 97/97）。
  ⬜ **下一刀＝片 4-C1**：`.djs` 注册成 `customEditors`、正文进宿主文件系统（绑定系统那板依赖它）。
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

**一条命令**：

```bash
pnpm install         # 只有本仓库这一次（pnpm 是包管理器，⛔ 混用 npm/yarn 会生成第二把锁）
pnpm app             # ← 编前端 + 编扩展 + 用基座官方脚本起我们自己的二进制，画布自己弹出来
```

`pnpm app` 就是一条 npm script（npm 官方的组合机制，⛔ 我们自写的 `.mjs` 包装），内容全是官方命令：

```
pnpm build && pnpm -C extension build && <基座>\scripts\code.bat "--extensionDevelopmentPath=%CD%\extension" "--user-data-dir=<与基座同级的 profile>"
```

- `<基座>` 默认 `D:\vv-studio\vscode`（⚠ 路径⛔ 含空格；换位置就改 `package.json` 里这一行）。
  拉它只要一次：`git clone --depth 1 --filter=blob:none https://github.com/microsoft/vscode.git D:\vv-studio\vscode`
- **基座那"一次性的一大堆"不用你敲**：官方 `code.bat` 自己会跑 `build/lib/preLaunch.ts`
  ⇒ 缺 `node_modules` 就 `npm ci`、缺 Electron 就 `npm run electron`、缺 `out/` 就 `npm run compile`，
  还会把基座需要的内置扩展拉下来（首次几十分钟，之后直接就开）。
- 要打开某个工程：那条命令后面补一个位置参数即可（`scripts\code.bat … "…profile" D:\我的工程目录`），
  或者起来之后 `File → Open Folder`。跑起来只用官方命令这件事没变，变的只是把它们串成一条 npm script。

**别的入口**

```bash
pnpm dev                 # 纯浏览器预览 → http://localhost:1420（⛔ 宿主落盘，导出退化为 <a download>）
pnpm -C extension check  # tsc + esbuild（改 extension/src/** 后先看它）
node tests/run-all.cjs   # 全量回归闸门（headless Edge）
# 打包安装物＝官方 gulp 目标：cd <基座> && npm run gulp vscode-win32-x64-min（⚠ 本轮⛔ 跑过＝UNVERIFIED，归片 5）
```

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
