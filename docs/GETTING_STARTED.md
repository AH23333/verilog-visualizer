### 0. Install

The product form is **our own fork of the VS Code sources, shipped as a standalone binary** (the Cursor /
Windsurf pattern, decided by the user on 2026-10-13). Day to day it is **one command** (the Tauri line was
fully removed in R138 — `MIGRATION_VSCODE.md` §8):

```bash
pnpm install         # once for this repo
pnpm app             # ← one command: build web + build extension + launch OUR OWN binary via the base's official script
```

`pnpm app` is an **npm script** (npm's own official composition mechanism — ⛔ a hand-written `.mjs` wrapper),
and every command inside it is official: `pnpm build` → `pnpm -C extension build` →
`<base>\scripts\code.bat --extensionDevelopmentPath=<repo>\extension --user-data-dir=<profile next to the base>`.
The one-time heavy lifting is also official: `code.bat` runs `build/lib/preLaunch.ts`, which does `npm ci`,
`npm run electron` and `npm run compile` when those are missing (first run takes tens of minutes). The only
prerequisite is the checkout itself:

```bash
git clone --depth 1 --filter=blob:none https://github.com/microsoft/vscode.git D:\vv-studio\vscode
# ⚠ the path MUST NOT contain spaces; needs node 24.18.0 + a C++ toolchain with Spectre libraries (studio/README.md §4)
```

To open a specific project, append it as a positional argument to that `code.bat` line, or use `File → Open Folder`.

**Other entry points**

```bash
pnpm dev                 # browser preview → http://localhost:1420 (same features; export dialogs fall back to downloads)
node tests/run-all.cjs   # full regression gates (headless Edge)
pnpm ext:package         # optional .vsix for your own VS Code: code --install-extension extension\verilog-visualizer-vscode-0.0.1.vsix
```

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
Windsurf pattern, decided by the user on 2026-10-13). Launching it uses the **base's own official command** —
since R141 there is no wrapper script of ours (`pnpm studio:run` / `pnpm app:check` were self-written
launchers and are gone; `MIGRATION_VSCODE.md` §8, `studio/README.md` §1d):

```bash
pnpm install
pnpm build                       # webview 产物（tsc + vite）
pnpm ext:build                   # extension host 产物（esbuild）
cd /d D:\vv-studio\vscode
call scripts\code.bat --user-data-dir=D:\vv-studio\profile            # 空窗口起来
call scripts\code.bat --user-data-dir=D:\vv-studio\profile D:\my\project   # 或直接开某个工程文件夹
```

> ⚠ **One-time prerequisite**: the base checkout must have been installed and compiled once
> (`npm install` + `npm run compile-client` + `npm run electron` — minutes to tens of minutes, several GB).
> Those are the base's own scripts; nothing here runs them for you. The checkout path
> must contain **no spaces**, and the base needs node 24.18.0 plus a C++ toolchain **with Spectre-mitigated
> libraries** — every prerequisite is a measured finding in [`studio/README.md`](../studio/README.md) §4.

**Development loops** (⛔ not the deliverable)

```bash
pnpm app             # package.json 里那条 npm script：跑上面三步的组合，最后用官方 --extensionDevelopmentPath
                     # 把本扩展装进你已装好的 VS Code。⛔ 自写 .mjs 启动器（R141 删的就是那种）
pnpm dev             # 浏览器预览 → http://localhost:1420（同一套画布代码；宿主 RPC 那几颗会明确报"宿主不支持"）
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
