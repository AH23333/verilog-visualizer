# QC 评审 — Sandbox P0（对 docs/SANDBOX_DEV.md 的独立质检）

> 质检方：QC 会话（独立于开发者会话，多模态看图 + Playwright/Edge headless 实测）
> 依据：SANDBOX_DEV.md §2「已实现功能（P0）」逐项实测 + 代码走查（SandboxCanvas.tsx 257 行 / sandboxStore.ts 全文）+ 严格断言复验脚本（拖拽 delta 精确匹配 / reload 完整性 / console 证据）
> 结论先行：**拖动/放置/文件系统/模式切换 为真；「加载」为假（break）、「6 种 IO」为虚标、删除按钮在 Tauri 生产环境静默失效**。修复指令见 §5，按编号执行。

---

## 1. 实测确认有效的声明

| 声明 | 验证方式 | 结果 |
|---|---|---|
| 模式入口 + 互斥切换 | Playwright 点击 Sandbox/Files 图标往返 | ✅ 双向正常 |
| 文件 CRUD（localStorage） | 直读 `verilog-viz-sandbox-files` 键 | ✅ |
| 放置元件（7 门 + Button/Clock/Lamp） | palette 点击后数 `[model-id]` | ✅ |
| **拖动元件** | 严格断言：屏幕位移精确匹配鼠标 delta（dx=150, dy=80, 容差 8px） | ✅ 精确命中——`interactive=false` + 手动 mousemove 方案**有效**（joint v4 的 interactive:false 不阻断 `cell:pointerdown` 事件派发） |
| 深色背景 | 截图 | ✅（但见 §3-5 硬编码问题） |

## 2. 实测证伪的声明

### 2.1 「加载 ✅」→ **实际是坏的（break）**
两组独立证据：
1. 控制台错误：`dia.Graph: Could not find cell constructor for type: 'And'`——`paper.model.fromJSON()` 走的是 joint 默认 graph（**无 cellNamespace**），而数字门类挂在 `digitaljs.cells` 命名空间下。
2. 严格复验：保存含 And 的图 → 整页 reload → 进沙盒 → `[model-id]` 数量 = **0**（模型空）。
影响：`保存` 本身写了 localStorage（有效），但**任何非空图重载后必为空白**——保存/加载闭环断裂。

### 2.2 「6 种 IO」→ 虚标，实际 3 种可用
实测放置 `Input` / `Output` / `Dff`：均无可交互元素（`.btnface` 计数不增长）、无接线能力（P0 未实现连线）、`Dff` 无 clk 输入无意义。**可用集合 = Button / Clock / Lamp**。建议组件库降级为 3 项，或明示"需 P1 连线支持"。

### 2.3 删除文件按钮在 Tauri 生产环境**静默失效**
`handleDelete` 用原生 `confirm()`。SANDBOX_DEV.md 自己的 §4-1 已记录「window.prompt() 在 Tauri WebView 不弹框」——同一机制对 confirm 成立。浏览器实测捕获到 `confirm:Delete circuit_1.djs?`，但 **Tauri 里它永不出现 → 删除功能在生产环境不可用**。且这违反交接文档（HANDOVER §3）「禁用原生对话框」的全局约束——`askPrompt/askConfirm` 基座已经存在，为何不用。

## 3. 代码走查缺陷（静态发现）

| # | 位置 | 问题 |
|---|---|---|
| C1 | SandboxCanvas L106-115 | 拖拽 `onMove` 只改 DOM `transform`，`onUp` 里 `model.set('position')` 引用的是 **pointerdown 闭包的 evt**（恒等于起点）→ 理论上模型位置永远不被更新。实测位置却能保存（joint 内部在 mouseup 的原生处理里可能补偿），**这是靠巧合而非正确性在工作**。正确做法：onMove 里记录最新 nx/ny 到局部变量，onUp 用它 set |
| C2 | SandboxCanvas L47-48 等 | 7 处 `console.log/warn` 调试日志遗留在产品代码 |
| C3 | SandboxCanvas L133 | wrapper 背景 `#1e1e2e` 硬编码——违反交接文档 §10-7（浅色主题会裂） |
| C4 | App.tsx L62 | `sandboxRef = useRef<SandboxHandle>(null)` 是死代码——SandboxCanvas 已改为普通组件，接口没人用 |
| C5 | SandboxCanvas L242 | `wrapperRef` 挂着但从未读取（真正干活的是 L66 的 `document.querySelector`） |
| C6 | §3.2 结论错误 | 「ref 指向 detached 节点」是对 React 的误解——effect cleanup/重跑会重挂 ref。真正的坑多半是 effect 依赖数组漏项。querySelector 能用但是 workaround，且多实例时会抓错节点 |
| C7 | sandboxStore | `circuit_${files.length + 1}` 命名在删除后必然重名；`updatedAt` 排序 OK |

## 4. 流程问题

1. **文档声明与实际不符**：§2 表格把「加载」标 ✅、把「6 种 IO」列为已实现——两条均被实测证伪。声明前应先跑一遍自己的功能（本轮所有证伪都来自一条 Playwright 脚本，成本 <30 分钟）。
2. **`.tmpbuild` 混用**：QC 截图/脚本与 StarMarkDesktop 的构建产物混在同一目录（该目录曾发生归属事故）。建议沙盒相关临时产物改放 `verilog-visualizer/.tmpbuild/`。
3. **未提交**：沙盒 8 个 fix commit 已提交（好），但 P1/P2 的 24 文件改动与本沙盒文档**仍未提交**——docs/ 目录整体 untracked，两个根目录文档处于 `D` 状态（移动未提交）。
4. **HANDOVER 内部引用路径**：文档移动到 docs/ 后，HANDOVER §0/§13 里 `OPEN_CIRCUITS_FEASIBILITY_ANALYSIS.md` 等根路径引用已失效，需同步更新。

## 5. 修复指令（按序执行，全部完成并回归后再次提交质检）

1. **修加载（P0 阻塞项）**：弃用 `fromJSON`，改为遍历 `graphJson.cells` 逐个 `new digitaljs.cells[cell.type](cell)` + `paper.model.addCell`（与放置逻辑同源，绕开 cellNamespace 问题）；或给 fromJSON 传 `{ cellNamespace: window.digitaljs.cells }`（joint v4 支持，二选一，实测哪个生效用哪个）。验收：放 3 门 + 拖动 + 保存 + 整页 reload → 3 个 cell 且位置与拖后一致（delta 容差 12px）。
2. **修拖拽模型同步（C1）**：onMove 记录 `last = {x:nx, y:ny}`，onUp 用 `last` 做 `model.set('position')`。验收：拖后不经过保存，直接 `paper.model.toJSON()` 读 position == 屏幕位移。
3. **删除/重命名走应用内对话框**：SandboxCanvas 需要 ConfirmDialog/PromptDialog——通过 props 从 App 传入 `onConfirmDelete(name): Promise<boolean>` 与 `askPrompt`（App 已有 Promise 基座，加两个 props 即可）。**禁用原生 confirm**。验收：Playwright `page.on('dialog')` 全程 0。
4. **IO 组件库降级为 Button/Clock/Lamp 三项**，Input/Output/Dff 移到 §6 P1（依赖连线）并加注释。
5. **卫生清理**：删 7 处 console.log/warn；`#1e1e2e` 改 `var(--canvas-bg)`；删死代码 `sandboxRef`/`wrapperRef`（或让 querySelector 改回 ref 并写明真实根因）；文件命名改 `circuit_${Date.now().toString(36)}` 防重名。
6. **文档与流程**：SANDBOX_DEV.md §2 表格与实际对齐（加载标 ❌→修复后标 ✅；IO 改 3 种）；HANDOVER 路径引用更新；docs/ 移动与全部工作**一并提交**（沿用作者 AH，用 `-F` 消息文件）。
7. **回归**：修复后跑附录 QC 脚本（本文件 §6）全部 PASS，外加交接文档 §4.5 的 10 项主回归——**两者都绿才算完成**。

## 6. 附录：QC 脚本

本轮使用的两个验证脚本形态（可复用）：
- `.tmpbuild_qc_sb.cjs`——8 步走查（入口/CRUD/放置/拖拽/重载/IO 可用性/confirm 捕获/模式互斥）
- `.tmpbuild_qc_strict.cjs`——严格断言（拖拽 delta 精确匹配、reload 完整性、console 证据采集）
放置于仓库根（`_` 前缀已被 .gitignore 忽略则可保留，否则随 §5-6 一并清理）。
