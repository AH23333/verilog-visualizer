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

---

# R2 复检（P0 hardening 提交 2bd0c2c 之后）

> 复检方式：14 步综合实测（沙盒修复验证 + 主流程回归 + DOM 字号审计）。

## R2.1 上轮指令执行核对

| 指令 | 判定 |
|---|---|
| 1. 修加载（弃裸 fromJSON） | ✅ 逐 cell 重实例化（createCellByType 与放置同源），save→整页 reload→cells persist 实测通过 |
| 2. 拖拽模型同步（latest 闭包） | ✅ 代码落地；但见 R2.2 |
| 3. 删除两步内联确认（×→?→再点） | ✅ 实测通过，全程原生 dialog = 0 |
| 4. IO 库降级为 3 项 | ✅ Input/Output/Dff 已移出面板（实测断言） |
| 5. 卫生清理 | ✅ console 遗留清零、硬编码改 token（残余见 R2.3） |
| 6. 文档对齐 + 提交 | ✅ SANDBOX_DEV.md 重写入库、推送属实（origin/main..main=0） |

## R2.2 新发现问题（返工）

**SB-BUG：wrapper shrink-to-fit 回归（拖拽 delta off 的根因）**
- 实测：放置单门后 `[data-sandbox-wrapper]` 的 getBoundingClientRect().width = **166px**（应为画布区 ~1200px），paper viewport 出现负偏移 translate(-183,-170)——fitToContent 异常未被 scale(1)/translate(0,0) 完全压制，或 setDimensions 链路在新构造路径下未执行。
- 衍生：拖拽 delta 断言失败（拖动屏幕 150px，cell 位移不等于 150）。
- 修复方向：检查 SandboxCanvas 尺寸链——L242 wrapper 的 width:100% 为何未生效（父容器塌陷？svg 尺寸回写？），resize()/paper.setDimensions 调用时机；修后拖拽 delta 复测（预期自动通过）。
- 影响面：仅沙盒模式；主流程回归全绿（5 编译/跳转/发光/下钻/tooltip/命令面板）。

**字号档位实测 9 档（报告称 6 档）**
- 实测含 rem→px 亚像素档（12.8/14.4/16.8 等）。主要档位已收敛，但 6 档声称未达。修正口径后继续收敛（P1-1 收尾）。

## R2.3 下一步指令（按序）

1. 修 SB-BUG（wrapper 尺寸链），验收 = wrapper 宽 ≈ 画布区宽（±4px）且拖拽 delta 断言通过。
2. 字号档位按 §11 审计脚本收敛到 ≤6 档（合并亚像素档：统一用 px 整数 token）。
3. 完成后：SANDBOX_DEV.md 更新坑清单（新增 wrapper 回归条目）、全部工作提交推送、重新提请质检。
4. 完成后提交推送并提请质检；质检方复跑沙盒 strict + 主流程 + 字号审计三件套。

---

# R4 复检（da8a1ff 之后）——拖拽回归根因已定位到行号

## R4.1 执行核对

| 指令 | 判定 |
|---|---|
| 拖拽改 model.position() 驱动 | ✅ 代码落地（实现方式符合声明） |
| rem 清零 6 档 token（含新增 --fs-xl/xxl） | ✅ 落地（DOM 档位复测归入下轮） |
| SandboxHandle/sandboxRef 死代码清理 | ✅ |
| tsc + 提交推送 da8a1ff | ✅ |

## R4.2 但拖拽**仍然失败**（strict 复跑：dx=0, dy=0；reload 后 x 回原值）——两轮两种实现失败模式一致，指向更高层机制。**QC 方已定位根因**：

`digitaljs/src/index.mjs` **L189-191**：
```js
this.listenTo(paper, 'render:done', () => {
    paper.fitToContent({ padding: 30, allowNewOrigin: 'any' });
});
```
`model.set('position')` → cell 重绘 → `render:done` → **fitToContent(allowNewOrigin:'any') 重算视口** → 刚写入的位移被视口平移抵消（诊断数据：mid-drag 跟手，after-up viewport 平移恰好 -150/-80）。

## R4.3 修复指令（一行级）

在 SandboxCanvas 的 paper 创建后加一行：
```js
paper.off('render:done');   // sandbox 不需要 digitaljs 的 auto-fit；主 Canvas 的 paper 是独立实例，不受影响
```
（备选：保留监听但拖拽期间置标志位——不推荐，多余状态。）

验收（strict 脚本原样复跑）：DRAG delta ±8px ✅ + SAVE/RELOAD 位置一致 ✅。若仍失败，用 `paper.on('render:done', ...)` 打印调用栈回报。

## R4.4 字号验收归入下轮

--fs-xl/xxl 新增后 DOM 实际档位未复测（本轮聚焦拖拽）。下轮质检三件套含字号审计（口径 ≤6 档）。

---

# R5 补充指令（基于 HEAD f42f903 的仓库核对）

## R5.1 【阻塞·第一优先】R4.3 尚未执行

仓库核对（HEAD=f42f903）：`SandboxCanvas.tsx` 中 **`paper.off('render:done')` 仍不存在**。拖拽回归的修复一行（R4.3）至今未落地——**这是当前唯一阻塞项，先于一切新工作执行**：
```js
// SandboxCanvas.tsx，paper 创建后：
paper.off('render:done');
```
自测：复跑 `.tmpbuild_qc_strict.cjs`，DRAG delta ±8px 与 SAVE/RELOAD 两项必须 PASS，然后提交推送。

## R5.2 【文档债】三个超范围交付缺功能文档

`d502174..HEAD` 共 52+ 提交，其中三个功能**超出 P1/P2 契约且无任何文档**：
1. **分屏视图**（ViewMode='split'、splitRatio 0.25–0.75 可拖拽+localStorage 持久化、光标行→电路 cross-highlight）——实测确认存在，但用法/边界/限制无文档
2. **单步仿真**（`sim.stepOnce` F7、Canvas.stepOnce 组合逻辑 delta-cycle 推进、debug tick counter）——S0.3 决策项被实现，实现方向正确（stop + 单 delta-cycle），但语义边界（异步引擎 vs EDA 步进）未文档化
3. **连线路由改造**（manhattan→orthogonal、顶点合并阈值 25px、总线加粗 2.5px、link magnifier 隐藏）

指令：新建 `docs/FEATURES_BEYOND_PLAN.md`，三个功能各一节（现状/用法/已知限制），中文，与 WORK_REPORT 风格一致。

## R5.3 【卫生】

1. `Canvas.tsx` stepOnce 的 `console.log('[stepOnce] ...')` 清理（产品代码禁止调试日志）
2. 仓库根的 `.tmpbuild_qc*.cjs` 三个 QC 脚本挪至 `tests/`（它们已是受控回归资产，放根目录不规范；挪动后确认 QC_REVIEW §6 的引用路径同步更新）
3. 推送未推的 `f42f903`（QC R4 评审）

## R5.4 【并行·P1-2 收尾】（与 R5.1 无文件冲突，可同轮做）

- Sidebar 文件树 7 处手写 hover、ModulePanel ~30 处行内样式 → `.icon-btn`/`.text-btn` class（交接文档 P1-2 允许分步，此为剩余大头）

## R5.5 【质检预告】

R5.1 完成提请质检时，质检方将首次把**分屏视图与单步仿真纳入正式质检范围**（新增用例：分屏拖拽 splitter 边界、cross-highlight 双向、F7 步进的 tick 计数验证），请确保 R5.2 文档先行——无文档的功能不质检。

---

# R5 复检（675b845 之后）——全部通过，P1-1 达标

## R5.6 复检结果

| 项 | 判定 |
|---|---|
| R5.1 拖拽修复（paper.off） | ✅ **strict 复跑：DRAG delta 精确命中（150/80）+ SAVE/RELOAD 位置一致**——拖拽回归彻底修复 |
| R5.2 FEATURES_BEYOND_PLAN.md | ✅ 已创建（63 行，三分册） |
| R5.3 卫生 | ✅ stepOnce console.log 已删、4 个 QC 脚本挪 tests/ |
| 主流程 14 项 | ✅ 全绿（5 编译/IO 降级/拖拽/两步确认/跳转/发光/下钻/tooltip/命令面板） |
| **字号档位** | ✅ **实测 5 档 ≤ 6**——P1-1 达标（R4 的 rem 清零生效） |
| 原生弹窗 / 页面错误 | ✅ 0 / 0 |

**strict 脚本第三项 FAIL 为断言语义过时**（该断言检测旧 fromJSON 错误是否出现；R4.3 修复后 fromJSON 已移除，不再报错——FAIL 恰是修复成功的证据）。脚本断言需更新为反向断言（无该错误 = PASS），归入下轮。

## R5.7 状态与下一步

- **P0/P1 全部达标**。P1-2 残余（Sidebar/ModulePanel ~30 处 hover）与 P2 剩余项见 HANDOVER §8。
- 沙盒 P1（连线/删除 cell/自定义门导入）规划于 SANDBOX_DEV §6，**待用户放行**。
- 分屏视图/单步仿真首次纳入质检范围的用例编写由质检方完成（R5.5 预告），时间待定。
- 建议接手 AI 下一步：更新 WORK_REPORT 增补 R5 收官节 → 提交推送 → 等待用户验收真机（Tauri 无边框窗口行为）。

---

# R3 复检（05dac2b 之后）

## R3.1 上轮指令执行核对

| 指令 | 判定 |
|---|---|
| 1. wrapper 尺寸链 | ✅ CSS 强制 `.joint-paper`/`svg` 100% 后，wrapper 宽 1212 = 画布 1212（±0） |
| 2. 字号档位 ≤6 | ❌ **实测 8 档**：16px(46)/14.4px(23)/15px(9)/13px(7)/12.8px(8)/12px(5)/11px(5)/11.2px(1)。根因：**rem 遗留与 px token 双体系混用**（如 0.9rem→14.4px 与 --fs-md:13px 并存）。P1-1 未完成 |
| 3. 坑清单 #11 | ✅ 已追加 |
| 4. 提交推送 | ✅ 05dac2b 已推送 |

## R3.2 新回归：拖拽完全失效（delta 0,0）

**诊断数据（mid-drag / after-up 对比）**：
- 拖拽中：cell transform `translate(257,152)→(407,232)`，屏幕位置 258,70→408,150 —— **跟手** ✓
- mouseup 后：cell transform 保持 (407,232)（**模型正确**），但 **viewport 从 translate(-204,-122) 跳变为 (-354,-202)** —— 恰好 -150/-80，把 cell 的屏幕位置**弹回原点**。

**根因**：mouseup 后某个监听者自动平移 viewport（候选：digitaljs 对 position-change 的 auto-fit/pan、或 SandboxCanvas 自身监听链）。定位方法建议：临时 `paper.on('translate', ...)` 打印调用栈，或二分移除 SandboxCanvas 的 ResizeObserver/resize 监听验证。

**注意**：这正是"手动 DOM transform + 模型 set 双轨"方案的固有脆弱性——若修复成本高，可考虑整体切回 `interactive: true` 并用 joint 原生 cellMove（digitaljs 的连线拦截可改在其 ToolView 层条件化），一次性消除双轨。

## R3.3 质检方脚本勘误

R3 首轮 M1 失败为**质检脚本自身错误**（Node 上下文误用 document），已修正重跑；M2/M3/M4 结论有效。

## R3.4 下一步指令（按序）

1. **修拖拽 viewport 回归**（R3.2）：定位 mouseup 后平移 viewport 的监听者并移除/条件化；或评估切换 joint 原生 cellMove 方案。验收 = 拖拽 delta ±8px 断言通过 + 保存/reload 位置一致（沿用 strict 脚本）。
2. **P1-1 收尾**：消灭 rem 遗留（0.9rem→--fs-lg 等），验收 = 字号桶 ≤6（按 QC 脚本口径）。
3. 主流程 fit 项请一并复测（R3 首轮 M1 因脚本错误未取得有效数据；M2 跳转+发光已确认无恙）。
4. 完成后提交推送并提请质检；质检方复跑沙盒 strict + 主流程 + 字号审计三件套。
