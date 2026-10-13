# 入门指南 / Getting Started

> 30 分钟从安装到第一个可复用部件。
> From install to your first reusable part in ~30 minutes.

---

## 中文

### 0. 安装

**产品形态＝自带 VS Code 源码分支、出独立二进制**（Cursor / Windsurf 同族，用户 2026-10-13 裁定）。
入口是一条命令（Tauri 那条线已于 R138 整条删除，见 `MIGRATION_VSCODE.md` §8）：

```bash
pnpm install
pnpm studio:run      # ← 一条命令起**我们自己的二进制**：编前端 → 编扩展 → 装进基座 → 起窗口（画布自己弹出来）
pnpm studio:run D:\我的工程目录    # 带文件夹参数＝让它打开那个工程
```

> ⚠ **一次性的前置**：基座那份 checkout 要先 `npm install` + `npm run compile-client` + `npm run electron`
> 编过一次（几分钟到几十分钟、几 GB——`studio:run` 会**把整条命令打印出来**，⛔ 替你默默发起这种量级的动作）。
> 路径⛔ 含空格、且需要 node 24.18.0 与含 Spectre 缓解库的 C++ 工具链：逐条实测前置见 [`studio/README.md`](../studio/README.md) §4。
> 基座⛔ 在默认位置时用 `VERILOG_STUDIO_FORK=<路径> pnpm studio:run`。只想看它打算干什么：`pnpm studio:run --check`。

**开发回路**（⛔ 交付物，调试用）

```bash
pnpm app             # 用你日常装的那份 VS Code 起一个挂了本扩展的开发宿主窗口
pnpm app:check       # 只报现场（找到哪颗 CLI／产物新不新／打算跑什么命令）
pnpm dev             # 浏览器预览 → http://localhost:1420（功能一致，导出对话框退化为浏览器下载）
```

> 也可以装进你自己的 VS Code：`pnpm ext:package` 出 `.vsix`（vsce 已是 devDependency），再
> `code --install-extension extension\verilog-visualizer-vscode-0.0.1.vsix`。
> `pnpm app` 找不到 `code` 命令行时，会列出试过的位置并给一条 `VSCODE_BIN=<路径> pnpm app` 的退路。

### 1. 第一个电路（编译模式）

1. 顶部菜单 **文件 → 示例…**（或工具栏「示例」）→ 选「半加器」→ 自动编译并渲染。
2. 画布上直接交互：点 **输入开关** 翻转电平，观察 **输出灯** 变化；悬停连线读网名与数值。
3. 按 **F5** 重新编译；**Ctrl+S** 保存当前文件。
4. 打开自己的设计：**文件 → 导入 Verilog 文件…**，编辑器里改代码，**F5** 即看电路。
5. 看 **PROBLEMS** 面板：接口预检/综合错误逐条列出，**点一条直接跳到源码行**，对应电路单元同步高亮。

> 📌 试一下 `test_files/test_counter.v`：它是未声明 wire 的门级网表——会被接口预检**拒绝编译**并逐行说明原因。这是设计行为，不是 bug。

### 2. 钻进子模块

编译结果里有子模块（如实例化的 `half_adder`）时：双击它、或点右上角 🔍 放大镜 →
**内部电路**弹窗：与编译渲染同管线、同坐标；`Ctrl+滚轮` 以光标为中心缩放、滚轮平移、
`Shift+滚轮` 水平平移、可逐层向下钻取，页脚显示还原度计数。

### 3. 进沙盒自由搭建

1. 左侧竖栏（ActivityBar）点 **沙盒** 图标 → 进入沙盒模式。
2. 左侧文件树 **＋** 新建 `.djs` 电路文件。
3. 左栏 **部件库** 分组放置器件（门/触发器/总线/运算/存储/状态机…9 组）；从端口拖出连线。
4. 顶部胶囊条：**运行/暂停/单步/复位**，**SPEED 滑条**（5–200ms）调仿真速度，**波形** 打开通道调试面板。
5. **Ctrl+R** 旋转选中件；右键 → 水平/垂直镜像；右键器件可对**构造期参数**做重建式修改（位宽、端口表、极性…）。
6. 双击画布空白 → 出现**注释便签**并直接进入输入态；`Esc` 提交；双击便签再次编辑；拖边改比例、拖角等比缩放。

### 4. 把电路变成可复用部件

1. 沙盒画布上放好 **至少一个输入引脚和一个输出引脚** 的电路。
2. 工具栏 **保存为自定义门** → 命名 → 生成一个部件文件（`.djs`，可编辑电路，不是黑盒）。
3. 在**任何**文件（含新画布）的部件面板点它 → 放置为单个实例；双击实例 🔍 可看/可再钻取内部。
4. 编辑部件文件后，引用它的实例在重新打开文件时自动取新定义（单一真源）。
5. 试着把部件放进**它自己**——会被当场拒绝并展示循环路径：循环依赖保护。

### 5. 编译 ⇄ 沙盒 往返

编译模式下工具栏 **复制到沙盒** → 生成的电路（含全部构造期参数与子模块的递归部件文件，
按文件夹收纳）落进沙盒，可继续自由编辑、仿真行为与编译渲染一致。

---

## English

### 0. Install

The product form is **our own fork of the VS Code sources, shipped as a standalone binary** (the Cursor /
Windsurf pattern, decided by the user on 2026-10-13). One command starts it (the Tauri line was fully
removed in R138 — `MIGRATION_VSCODE.md` §8):

```bash
pnpm install
pnpm studio:run      # ← one command for OUR OWN binary: build web → build extension → install into the base → launch (canvas opens itself)
pnpm studio:run D:\my\project      # pass a folder and it opens that project
```

> ⚠ **One-time prerequisite**: the base checkout must have been installed and compiled once
> (`npm install` + `npm run compile-client` + `npm run electron` — minutes to tens of minutes, several GB).
> `studio:run` prints those exact commands instead of silently kicking off work that size. The checkout path
> must contain **no spaces**, and the base needs node 24.18.0 plus a C++ toolchain **with Spectre-mitigated
> libraries** — every prerequisite is a measured finding in [`studio/README.md`](../studio/README.md) §4.
> Base somewhere else? `VERILOG_STUDIO_FORK=<path> pnpm studio:run`. Dry run: `pnpm studio:run --check`.

**Development loops** (⛔ not the deliverable)

```bash
pnpm app             # loads this extension into the VS Code you already installed, via --extensionDevelopmentPath
pnpm app:check       # report only: which CLI was found / is dist fresh / what it would run
pnpm dev             # browser preview → http://localhost:1420 (same features; export dialogs fall back to downloads)
```

> You can also install it into your own VS Code: `pnpm ext:package` builds the `.vsix` (vsce is a devDependency now), then
> `code --install-extension extension\verilog-visualizer-vscode-0.0.1.vsix`.

### 1. Your first circuit (Compile mode)

1. Menu **文件 → 示例…** (Samples) → pick *Half Adder* → it compiles and renders.
2. Interact on the canvas: click **input switches**, watch the **output lamps**; hover a wire for its net name and value.
3. **F5** recompiles; **Ctrl+S** saves the active file.
4. **文件 → 导入 Verilog 文件…** to open your own design; edit and press **F5**.
5. The **PROBLEMS** panel lists interface pre-check / synthesis errors — each one **jumps to the source line** and highlights the matching cell.

> 📌 Try `test_files/test_counter.v`: a gate-level netlist whose wires are never declared. The pre-check **refuses** it with one problem per offending line — by design.

### 2. Drill into a subcircuit

Double-click a subcircuit (or click its 🔍) → the **internal circuit** modal: same pipeline and coordinates as the compiled render; `Ctrl+wheel` zooms at the cursor, wheel pans, `Shift+wheel` pans horizontally, and you can keep drilling down. The footer reports fidelity counters.

### 3. Build freely in the Sandbox

1. Click the **sandbox** icon in the left ActivityBar.
2. **＋** in the file tree creates a `.djs` canvas file.
3. Place devices from the grouped **part library** (9 families); drag wires port-to-port.
4. The pill toolbar runs/pauses/steps/resets the simulation; the **SPEED slider** (5–200 ms) sets the tick; **waveform** opens the channel debug panel.
5. **Ctrl+R** rotates the selection; right-click mirrors; the per-device right-click menu rebuilds constructor-time parameters (widths, port tables, polarities…).
6. Double-click empty canvas → a **sticky note** appears already focused for input; `Esc` commits; double-click to re-edit; drag edges to reshape, drag corners for aspect-locked scaling.

### 4. Turn a circuit into a reusable part

1. On a sandbox canvas with **≥1 input pin and ≥1 output pin**, use **save as custom gate** and name it.
2. You get an **editable part file** (`.djs`) — not an opaque box.
3. Click it in the part panel of **any** file to place it as a single instance; 🔍 shows its internals.
4. Edit the part file and instances pick the new definition up when the referencing file reopens (single source of truth).
5. Try dropping a part into **itself** — placement is refused on the spot and the cycle path is shown: circular-dependency protection.

### 5. Compile ⇄ Sandbox round-trip

**Copy to sandbox** in compile mode moves the circuit — constructor-time parameters and
sub-module parts included (recursively migrated into a folder) — into the sandbox, where it
simulates identically and stays fully editable.

---

➡️ 下一步 Next：[用户指南 USER_GUIDE.md](./USER_GUIDE.md) ｜ [架构 ARCHITECTURE.md](./ARCHITECTURE.md)
