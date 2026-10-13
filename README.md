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
- ✅ **产品入口已能一条命令跑起来**：`pnpm studio:run`（编前端 → 编扩展 → 装进基座 → 起我们自己的二进制），
  本轮真跑过全链路（窗口标题 `Verilog Visualizer - demo - Verilog Visualizer Dev`）。
  一次性前置＝基座那份 checkout 要先 `npm install` + `compile-client` 编过——缺哪一步脚本会把整条命令打印给你。
- ✅ **Tauri 那条线整条已拆**（`src-tauri/`、Rust 后端 14 颗命令、`tauriHost`、自绘标题栏 `WindowControls.tsx`；
  要找回那一版走 git，账本卷四十三末尾有提交号）。
- ✅ **宿主中立层已跑通**：`pnpm app` 能起一个挂了本扩展的开发窗口。⚠ 它是**开发用入口，⛔ 产品本身**，
  而且此刻界面仍是我们自绘的那套（还没换成 workbench 原生）——这一点上一批我写成"唯一宿主＝扩展壳"，方向报错了。
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

**产品形态＝我们自己的二进制**（自带 Code - OSS 分支，⛔ 要你另外装 VS Code）。一条命令：

```bash
pnpm install                    # 包管理是 pnpm（有 pnpm-lock.yaml；⛔ 别混用 npm/yarn 生成第二把锁）
pnpm studio:run                 # ← 就这一条：编前端 → 编 Extension Host → 装进基座 → 起我们自己的二进制
pnpm studio:run D:\我的工程目录   # 带一个文件夹参数＝让它打开那个工程（原生 Explorer 与画布都从那儿取文件）
```

`pnpm studio:run`（`scripts/run-studio.mjs`）替你排四步，每步只在缺的时候才跑：① `dist/` 缺或 `src/` 更新 ⇒ `pnpm build`；
② `extension/dist/extension.cjs` 缺 ⇒ 编扩展；③ 把品牌与内置扩展装进基座（`pnpm studio:brand`）；
④ 起基座那份 `scripts/code.bat`，并**显式给一个与基座同级的 `--user-data-dir`**——
⛔ 动你日常 VS Code 的配置。只想看它打算干什么（⛔ 构建、⛔ 起窗口）：`pnpm studio:run --check`。

**唯一一次性的前置**：基座那份 checkout 得先装好依赖并编过一次（那是 1590 颗包 / 几分钟到几十分钟 / 几 GB，
`studio:run` 会**把整条命令打印出来给你**，⛔ 替你默默发起这种量级的动作）：

```bash
# ⚠ 路径⛔ 含空格：上游 preinstall spawn 时⛔ 给路径加引号，带空格会在第一个空格处炸（实测跑满四分钟才报错）
git clone --depth 1 --filter=blob:none https://github.com/microsoft/vscode.git D:\vv-studio\vscode
cd D:\vv-studio\vscode && npm install && npm run compile-client && npm run electron
```

基座这一条要 **node 24.18.0**（`.nvmrc` 写死，`preinstall` 是硬拒），另需 VS 2022 的 C++ 工具链**含 Spectre 缓解库**
（缺它会撞 MSB8040）。逐条实测前置与踩坑记录＝[studio/README.md](./studio/README.md) §4。
指路退路：基座⛔ 放在默认位置时用 `VERILOG_STUDIO_FORK=<路径> pnpm studio:run`。

**开发用回路（在我们自己的二进制里调试才需要）**

```bash
pnpm app                 # 起一个"挂了本扩展的开发宿主"窗口（用你日常装的那份 VS Code），画布自己弹出来
pnpm app:check           # 只报现场：找到哪颗 CLI／产物新不新／打算跑什么命令
pnpm dev                 # 纯浏览器预览 → http://localhost:1420（⛔ 宿主落盘，导出退化为 <a download>）
node tests/run-all.cjs   # 全量回归闸门（headless Edge，73 格）
```

`pnpm app` 那两条⛔ 是交付物——它们是调试入口；产品入口只有 `pnpm studio:run`。
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
