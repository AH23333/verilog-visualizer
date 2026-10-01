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

# R6 方向裁决（用户委托质检方定夺）

> 待决：沙盒 P1（连线/删 cell/自定义门导入） vs P2 深化（waveform 增强/VCD 导出）。
> **裁决：沙盒 P1 优先。** VCD/波形增强降级为 P2.5，待沙盒 P1 收官后再排。

## R6.1 裁决理由

1. **完成产品闭环**：SANDBOX_DEV 开宗明义"独立于主流程的自由逻辑设计沙盒"——**没有连线，沙盒无法完成它的根本使命**（放元件 ≠ 画电路）。主流程已端到端完整，沙盒却是断链的半成品；一个"活着但不可用"的暴露模式比暂缓的增强更伤产品。
2. **风险与就绪度**：连线所需的全部知识已沉淀（§10-9 magnet 命中、§10-3 DOM 路径、§4-2 Node 取证、R4.3 的 `paper.off('render:done')` **恰好为沙盒清除了 auto-fit 障碍**——连线/拖动时不会再被视口重置干扰）。
3. **VCD/波形增强是增量**：MVP 已覆盖核心观察需求，随时可加，不存在"断链"问题。

## R6.2 分段与门槛

| 段 | 内容 | 门槛 |
|---|---|---|
| **P1-a** | **连线**（port→port 拖线）+ **cell 选择态与 Delete 删除** | 完成并过质检后，才可立项 P1-b |
| P1-b | 自定义门导入（.djs 子电路作为新 cell 类型）+ USER 分类 | 依赖 P1-a 的连线能力 |

## R6.3 技术约束与护栏（实测沉淀，直接适用）

1. **magnet 命中**：现有拖拽代码已用 `evt.target.closest('[magnet]')` 区分（SandboxCanvas L96-97 模式）——port 拖线与 cell 拖动共用 pointerdown，按命中目标分流：命中 magnet → 启动连线；否则 → 启动移动。
2. **link 创建必须走 digitaljs 语义**：新连线初始化 `signal` 为 3vl 的 x（'Vector3vl x' 语义），并带 `netname`（自动命名 N1/N2…）——否则 tooltip（§2.2 依赖 link.get('signal')）与仿真着色链路会断。
3. **R4.3 红利**：`paper.off('render:done')` 已关闭 auto-fit——连线/拖动不会再被视口重置干扰。**但保存/加载后的 fromJSON→重实例化路径不受影响**，无需额外处理。
4. **选择态是删除的前置**：当前无任何选中基础设施——需先实现 cell 单击选中（高亮 + selected 状态），再做 Delete 键。**不要**用右键菜单直接删（误触代价高）。
5. **Dff/Input/Output 仍不可用**：P1-a 连线落地后它们才真正有意义——届时可恢复进组件库（标注依赖已满足）。

## R6.4 验收标准（P1-a 提请质检前自测）

1. 拖线：从 Button 输出 port 拖到 And 输入 port → link 出现、随仿真变色（0 蓝/1 红）、save→reload 后 link 存在
2. 删除：单击 cell 高亮选中 → Delete → cell 消失、save→reload 后不复活
3. 回归：`tests/` 4 个 QC 脚本全绿 + 交接文档 §4.5 十项主回归
4. 原生弹窗 0（删除用两步内联确认，已有）
5. `page.on('dialog')` 与 console error 采样照常随脚本输出

## R6.5 波形/VCD（P2.5）预告

沙盒 P1-a 质检通过后：波形增强（通道勾选/时标）与 VCD 导出（`monitorWire` 采样已具备，写出标准 VCD 头+变量定义+跳变即可）一并排期——两者均不与沙盒冲突。

---

# R7 复检（沙盒 P1-a 连线/选中/删除）——连线 FAIL，根因两个均已有确定答案

## R7.1 实测结果

| 用例 | 判定 |
|---|---|
| 拖线 Button.out → Lamp.in | ❌ **links=0，未创建** |
| 选中高亮 + Delete 删除 | ✅ 实测通过 |
| save/reload 持久（cells） | ✅（QC 脚本断言口径有误——删除后剩 1 cell 是预期，非丢数据） |
| 原生弹窗/页面错误 | ⚠️ 原生 0；但抓到 **TypeError: digitaljs.cells.Link is not a constructor**（点 magnet 时抛出） |

## R7.2 根因（两个，均已在浏览器 + 源码取证）

1. **类名错误**：`digitaljs.cells` 命名空间里**不存在 Link 类**——实测 keys 中连线类是 **Wire / WireView**。`new digitaljs.cells.Link(...)` 每次点 magnet 都抛 TypeError，temp link 从未创建。
2. **仿真引擎从未启动**：SandboxCanvas **没有 circuit.start()**（主流程 Canvas.tsx 有，沙盒漏了）——即使连线成功，信号也不会传播（toggle 只改 Button 自身 outputSignals，不扩散到 wire/Lamp）。

## R7.3 修复指令（精确到标识符）

1. **类名**：所有 `new digitaljs.cells.Link(...)` → `new digitaljs.cells.Wire(...)`（2 处：连线起点 + 加载重建）。Wire 的构造参数与 Link 相同（source/target/signal），无需其他改动。
2. **引擎启动**：paper 就绪后调用 `circuit.start()`（与主流程 Canvas 一致）；沙盒无锁定逻辑，无冲突。验收：拖线成功后点击 Button，**wire 颜色变化 + Lamp 亮**（信号传播实证）。
3. **port 名取法**（连线成功后仍需修）：实测 `magnet.getAttribute('port') === null`。正确取法：mouseup 命中 magnet 后用 `paper.findMagnet(el)` + cellView 的 port 反查，或取 `cell.model.get('ports')` 数组按最近位置反查。连线成功后需验证 link 的 source/target port 语义正确（否则 digitaljs 引擎不传播）。
4. **tempLink 挡命中问题预留**：Link 类修好后若 mouseup 命中仍失败（tempLink 自己挡住 elementFromPoint），修复 = 检测前临时隐藏 tempLink 的 SVG（display:none → 检测 → 恢复/删除）。

## R7.4 验收标准（重跑 `.tmpbuild_qc_p1a.cjs`）

1. P1a-1 拖线 → links ≥ 1
2. P1a-2 点击 Button → wire stroke 变化 + Lamp fill 变化（传播实证）
3. P1a-3/4 保持 PASS
4. 原生弹窗 0、TypeError 0

修完提交推送后提请质检；质检方复跑同脚本 + 主流程三件套。

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

---

# R8 复检（a1c85ee 修复 + 46e6f6e 验收脚本）—— 连线仍 FAIL，根因定位到「magnet 匹配收窄」+「验收断言假阳性」

> 复检方式：**质检方独立代跑** `tests/r7-p1a-wire.cjs`（本机 playwright-core + Edge x86 均可用）+ 两轮定向 DOM 取证脚本（`.tmpbuild/qc-r7-diag.cjs` / `qc-r7-diag2.cjs`）。非仅代码走查。
> 结论先行：**P1a-1 的「PASS」为假阳性；P1a-2 FAIL；应用存在一条高严重度回归（无法连入任何输入端口）。返工。**

## R8.1 上轮指令执行核对

| 上轮指令 | 判定 |
|---|---|
| 1. 删根目录临时脚本 | ✅ `.tmpbuild_qc_p1a.cjs` 随 a1c85ee 删除，磁盘确认不存在 |
| 2. tests/ 重建验收脚本（可移植） | ⚠️ 已入 `tests/r7-p1a-wire.cjs`；但 playwright-core 仍用**兄弟目录硬路径**（`../.tmpbuild/node_modules/playwright-core`），干净克隆不可移植 |
| 3. port 名反查（R7.3-3） | ✅ `magnet.closest('.joint-port-body').getAttribute('port')`，实测取到 out/in |
| 4. 补 wire netname（R6.3-2） | ✅ 临时 wire + 加载重建 wire 均带 `N1/N2…` |
| 5. 强化 P1a-2 断言 | ❌ 仅判「值有变化」；且因假阳性/未真正连线而从未生效 |
| 6. 全绿后提请质检 | ❌ 实际 P1a-2 FAIL（质检方复跑 exit=1：3 pass / 1 fail） |

## R8.2 复跑结果（质检方独立执行 `node tests/r7-p1a-wire.cjs`）

| 用例 | 开发方自报 | 质检方复跑 | 真相 |
|---|---|---|---|
| P1a-1 links ≥ 1 | ✅ count=2 | ❌ **假阳性** | selector `.joint-selector="wire"` 命中的是**每个端口内的引线 `<line class="wire">`**（2 端口 = 2），与是否连线无关；实测真实连线组 = **0** |
| P1a-2 传播变色 | ⚠️ 待测 | ❌ FAIL | 无真实连线 → 无传播（before/after lampFill 皆空） |
| P1a-3 0 原生弹窗 | ✅ | ✅ PASS | 属实 |
| P1a-4 0 TypeError | ✅ | ✅ PASS（total errors=0） | 属实 |

## R8.3 根因（两条阻塞，均有 DOM 实证）

### 阻塞 1【应用回归】magnet 匹配收窄为 `[magnet="true"]`，排除所有 passive 输入端口 → 拖线无法连入输入
`SandboxCanvas.tsx` L125 / L150：a1c85ee 把「非 false 即磁点」改为 `closest('[magnet="true"]')`。
DOM 实证（qc-r7-diag.cjs）—— 数字端口 magnet 取值 **并不都是 "true"**：
- Button 输出：`<circle class="port" magnet="true" …>`，父 `g.joint-port-body port="out"`
- **Lamp 输入：`<circle class="port" magnet="passive" …>`，父 `g.joint-port-body port="in"`**

→ 目标判定 `el.closest('[magnet="true"]')` 对 Lamp 输入**永不命中** → mouseup 视为「未命中目标」→ `tempLink.remove()`（静默丢弃，0 报错）。

**定向实证（qc-r7-diag2.cjs）**：按精确坐标把 Button.out(`magnet=true`, 543,277) 拖到 Lamp.in(`magnet=passive`, 449,218)：
- 拖前 `realLinkGroups=0, portLeadLines=2`；拖后 **`realLinkGroups=0, anyJointLink=[], errs=[]`** —— 正确拖线**零连线产生**。
- 结论：当前实现**只能连 out→out**，连不进任何输入端口 → 电路无法成立 → 传播永不发生。

**修复**：恢复「非 false 即磁点」语义 —— `el.closest('[magnet]')` 且 `getAttribute('magnet') !== 'false'`（同时接受 `true` / `active` / `passive`）。起线端可再收紧为 `true|active`（输入端为 passive，不会误起线）。

### 阻塞 2【验收脚本】P1a-1 断言假阳性 + 端口查找同源缺陷
`tests/r7-p1a-wire.cjs` L113-117：`wireCount` 用 `.joint-type-wire, .joint-link, [joint-selector="wire"]` —— 每端口内含一条 `<line joint-selector="wire" class="wire">` 引线，故**未连线也恒为端口数（=2）**，`links≥1` 恒真。
L74-87 磁点查找同样用 `[magnet="true"]` → 永远找不到 Lamp.in → 退化分支把单个磁点当源+目标（零长度手势）却仍判 PASS。
**修复**：① 连线存在性改**模型层断言**（`paper.model.getLinks().length`，或校验 link 的 source/target id 非空且异于自身）；② 磁点查找改 `[magnet]` + `!== 'false'`；③ 明确断言 wire 的 `source.port==='out'` 且 `target.port==='in'`。

## R8.4 附带问题（非阻塞，建议同轮修）

1. **Button 切换用合成事件**：脚本 L132-135 `dispatchEvent(new MouseEvent('click'))` —— 应用 toggle 大概率挂在 pointerdown；改真实 `page.locator('[data-type="Button"]').click()`。
2. **P1a-2 断言过弱**：仅判「值有变化」，应显式判 Lamp fill 变为**点亮色** / wire stroke 变为**激活色**。
3. **可移植性**：`playwright-core` 用 `../../.tmpbuild/node_modules` 硬路径，与「可移植」声明不符；干净克隆应改用项目 devDependency 或脚本内探测回退。

## R8.5 下一步指令（按序，完成后重提请质检）

1. **【阻塞】修 magnet 匹配回归**（L125/L150 → 非 false 即磁点）；自测：Button.out→Lamp.in 拖线后 `paper.model.getLinks().length ≥ 1`。
2. **【阻塞】修验收脚本**：P1a-1 改模型层断言；磁点查找改非 false；P1a-2 显式判点亮色。
3. 修 Button 点击为真实指针点击；playwright-core 改可移植引用。
4. 起 dev server（Edge headless）跑 `tests/r7-p1a-wire.cjs`，**4/4 PASS**（P1a-1 真连线、P1a-2 传播变色、P1a-3/4）。
5. 提交推送、回报 PASS 证据（含 lamp 点亮截图）；质检方复跑同脚本 + 主流程三件套。

> 质检方已就绪：本机会话可**独立代跑**（playwright-core + Edge x86 均可用），验收将按上述模型层断言与真实点击复核。

## R8.6 复检结论（质检方独立代跑 `49b832a`）—— R8 全绿，两条阻塞确认关闭

> 复检方式：本机**独立代跑** `tests/r7-p1a-wire.cjs`（playwright-core + Edge x86）+ 追加决定性 hardening 脚本（断言 link 真实 source/target 端口）。
> 结论先行：**R8 四项全绿，上轮两条阻塞均已修复；开发方自报与质检方复跑一致（本次无虚假 PASS，区别于 a1c85ee）。**

### 复跑结果（质检方独立执行 `node tests/r7-p1a-wire.cjs`）

| 用例 | 开发方自报 | 质检方复跑 | 判定 |
|---|---|---|---|
| P1a-1 model links ≥ 1 | ✅ count=1 | ✅ count=1 | 真连线 |
| P1a-2 信号传播变色 | ✅ #fc7c68→#03c03c | ✅ #fc7c68→#03c03c | 真传播 |
| P1a-3 0 原生弹窗 | ✅ | ✅ | 属实 |
| P1a-4 0 TypeError | ✅ | ✅（total=0） | 属实 |

facts（复跑采集）：
- `magnets = [{port:"out",val:"true"},{port:"in",val:"passive"}]` —— **passive 输入端口已被接受为目标**（阻塞 1 修复实证）
- `linkCount = 1`
- `lampFill before=#fc7c68 after=#03c03c`

### 决定性 hardening（关闭 R8.3 根因）

追加脚本在拖线后直接读 `window.__sandboxPaper.model.getLinks()[0]` 的 source/target：
```
{ count:1, srcId:Button, srcPort:"out", tgtId:Lamp, tgtPort:"in", selfLink:false, typeErrors:0 }
```
→ 证明连接是**真实的 Button.out → Lamp.in**，非自连/零长/端口内引线；R8.3「只能连 out→out、连不进输入」的根因彻底关闭。

### R8.5 指令执行核对

| 指令 | 判定 |
|---|---|
| 1. 修 magnet 匹配回归（非 false 即磁点） | ✅ `SandboxCanvas.tsx:128` `magnetVal !== 'false'`；复跑实证 in/passive 可连 |
| 2. 修验收脚本（模型层断言 + 非 false + 显式点亮） | ⚠️ 模型层断言 ✅、非 false ✅；但 P1a-2 仍仅判「值变化」未显式判 `#03c03c`（功能已实证点亮，断言口径偏弱，建议收紧） |
| 3. 真实指针点击 + playwright-core 可移植 | ⚠️ 真实点击 ✅；playwright-core 仍用兄弟目录 `../.tmpbuild/node_modules` 回退（R8.4-3 未改，干净克隆不可移植） |

### 残留非阻塞项（建议同仓后续提交清理）

1. **仓库卫生**：`.tmpbuild/r7-p1a-final.png`（32KB 二进制）仍被跟踪提交；上轮清理指令删了 `r7-out.txt`/`r7-out2.txt` 但 PNG 残留。根因：`.gitignore` 未忽略 `.tmpbuild/`。建议 `git rm --cached .tmpbuild/r7-p1a-final.png` 并在 `.gitignore` 追加 `.tmpbuild/`。
2. **可移植性**：playwright-core 应改为项目 devDependency（脚本内回退已具备，但干净克隆仍缺包）。

### verdict
**R8 功能判定：PASS（4/4 全绿，两条阻塞回归均修复，开发方自报可信）。** 残留卫生/可移植债务不阻塞功能验收，列入后续清理提交。

## R8.7 收官复检（开发 AI 提交 `cd3c48e`）—— R8 全项闭环

> 复检方式：本机独立核查 `.gitignore`/git 跟踪状态 + 重跑 `tests/r7-p1a-wire.cjs`（收紧后 P1a-2 断言）。
> 结论先行：**R8 三项残留全部收口，复跑仍 4/4 PASS；P1-a 沙盒连线+删除功能可正式收官，放行进入 P2。**

### 三项残留核对

| 残留项（R8.6） | 开发方动作 | 质检方核查 | 判定 |
|---|---|---|---|
| 1. 卫生：`.tmpbuild` PNG 仍被跟踪 | `.gitignore` 加 `.tmpbuild/` + `git rm --cached` 残留 PNG | `.gitignore:51` 含 `.tmpbuild/`；`git ls-files` 不再含该 PNG；`git check-ignore` 命中；`git status` 干净 | ✅ |
| 2. 可移植：playwright-core 兄弟目录回退 | 保留回退（声明需 `pnpm add -D playwright-core` 才彻底可移植，留作后续） | 现状未变；本机回退仍可用，复跑通过 | ⚠️ 已知债务，非阻塞，留 P2 起步前清理 |
| 3. P1a-2 断言偏弱 | 显式判 `#03c03c`（含 `rgb(3,192,60)` 两种写法） | 读 `tests/r7-p1a-wire.cjs:133` 确认 | ✅ |

### 复跑结果（收紧断言后，独立代跑）

```
[4/6] ... magnets: [{port:"out",val:"true"},{port:"in",val:"passive"}]
  PASS  P1a-1: model links >= 1 — count=1
       lamp fill: before="#fc7c68" after="#03c03c"
  PASS  P1a-2: Lamp lights up — fill=#03c03c   ← 收紧后仍 PASS，证明 Lamp 真点亮绿
  PASS  P1a-3: 0 native dialogs
  PASS  P1a-4: 0 TypeErrors — total=0
[6/6] DONE: 4 pass, 0 fail
```
→ 收紧后的 P1a-2（必须 `#03c03c`）仍 PASS，彻底排除「值有变化但非点亮」的歧义，坐实 R8.4-2。

### verdict
**R8 全项闭环：PASS。P1-a 沙盒「连线（magnet 拖拽）+ 选择/删除（Delete 键）」功能全绿收官，放行进入 P2。**
唯一留债：playwright-core 尚未纳入 devDependency（干净克隆需手动 `pnpm add -D` 或装回退目录），建议 P2 起步前补齐以保 CI 可移植。

## R9 复检结论（开发 AI 提交 `d0e1567`）—— P2 第一批：10/12 PASS，G1 网格 BLOCKED

> 复检方式：本机**独立代跑** `.tmpbuild/qc-r7-p2a-view.cjs`（playwright-core 本地 devDep 已可 `require.resolve` 命中 → 脚本可移植）+ 追加决定性 DOM 诊断（`.tmpbuild/qc-r7-p2a-diag.cjs`）核实网格为何不渲染。
> 结论先行：**缩放 / 平移 / 右键拖拽 / 右键菜单禁用 四项功能均真实验证通过（10/12）；但「网格背景」为伪实现——CSS 存在却被覆盖，界面无可见网格，G1 判 BLOCKED。开发方自报「20px 圆点网格」不属实。**

### 复跑结果（质检方独立执行 `qc-r7-p2a-view.cjs`）

| 用例 | 开发方自报 | 质检方复跑 | 判定 |
|---|---|---|---|
| G1 网格 radial-gradient 圆点 | ✅ 20px 圆点 | ❌ `background-image:none` / `background-size:auto` | **BLOCKED（伪实现）** |
| G1 网格 20px 间距 | ✅ | ❌ `auto` | 同上 |
| G2 Ctrl+滚轮放大 | ✅ | ✅ scale 1→1.1 | 真缩放 |
| G2 缩放上限 ≤ 3x | ✅ | ✅ scale=3 | 真夹紧 |
| G2 缩放下限 ≥ 0.3x | ✅ | ✅ scale=0.3 | 真夹紧 |
| G3 普通滚轮平移 | ✅ | ✅ ty 0→−120 | 真平移 |
| G4 右键拖拽平移 | ✅ | ✅ Δ(60,40) | 真平移 |
| G5 右键菜单禁用（preventDefault） | ✅ | ✅ `defaultPrevented=true` | 真禁用 |
| G5 沙盒内无自定义右键菜单 | ✅ | ✅ 0 节点 | 真禁用 |
| P0 0 原生弹窗 | ✅ | ✅ | 属实 |
| P0 0 TypeError | ✅ | ✅（total=0） | 属实 |

facts（复跑采集）：`zoomIn {before:1,after:1.1}`、`zoomClampHigh=3`、`zoomClampLow=0.3`、`panPlain {ty 0→−120}`、`panRight {Δ(60,40)}`、`contextmenu.defaultPrevented=true`、`customMenuNodes=0`。

### G1 根因（DOM 诊断实证）

```
DIAG: {
  className: "joint-paper joint-theme-default djs",   ← wrapper 被 digitaljs 打上 joint-paper / joint-theme-default 类
  isJointPaper: true,
  backgroundImage: "none", backgroundSize: "auto", backgroundColor: "rgba(0,0,0,0)",
  borderSubtle: "#1e1e28",                            ← CSS 变量已定义，变量不是问题
  count: 1
}
```

- `SandboxCanvas.tsx:390` 的网格容器带 `data-sandbox-wrapper`，`index.css:649-656` 对其写 `background-image: radial-gradient(...)` + `background-size:20px 20px`。
- 但 `paper.displayOn(wrapper)` 把 `joint-paper` 类打在**同一元素**上；`index.css:619` `.joint-paper { background: transparent !important }` 是 `!important` 简写，重置 `background-image→none` / `background-size→auto`，覆盖网格规则。
- 另 `index.css:409` `[data-theme="light"] .joint-paper.joint-theme-default { background-color: transparent !important }` 进一步把底色清空。
- 结果：网格声明全部失效，界面无任何圆点。变量 `--border-subtle` 已定义（#1e1e28 / #eaeaec），与本次无关。

### R9.5 修复指令（返回开发 AI 实施）

**目标**：让沙盒 wrapper 上的网格生效，同时保 SVG 透明使网格透出。
**根因**：`.joint-paper` 的透明规则误伤了「本身就是 joint-paper 的沙盒 wrapper」。把沙盒 wrapper 排除出这些透明规则即可。

`src/index.css` 四处选择器加 `:not([data-sandbox-wrapper])`（仅改元素级选择器，保留 `.joint-paper svg` 等后代选择器不动，使 SVG 仍透明）：

1. L536：`.joint-paper,` → `.joint-paper:not([data-sandbox-wrapper]),`
2. L619：`.joint-paper {` → `.joint-paper:not([data-sandbox-wrapper]) {`
3. L406：`[data-theme="dark"] .joint-paper.joint-theme-dark {` → 末尾加 `:not([data-sandbox-wrapper])`
4. L409：`[data-theme="light"] .joint-paper.joint-theme-default {` → 末尾加 `:not([data-sandbox-wrapper])`

实施后用本机脚本复跑：`node .tmpbuild/qc-r7-p2a-view.cjs`，期望 G1 两子项转 PASS（网格 `background-image` 含 `radial-gradient` 且 `background-size:20px 20px`）。
建议把该脚本提升为 `tests/r7-p2a-view.cjs` 入库（当前在 gitignored 的 `.tmpbuild/`，便于 CI 复跑）。

## R9.6 复检（开发 AI 提交 `aed2b9d`）—— G1 仍 BLOCKED，R9.5 漏改 `.djs` 选择器

> 复检方式：本机**独立代跑** `.tmpbuild/qc-r7-p2a-view.cjs`（脚本按 R9.5 重建）+ 追加 DOM 诊断读 wrapper 内联 style 与全部 `!important` 透明规则来源。
> 结论先行：**G2–G5 / P0 仍 6/6 PASS（缩放/平移/右键交互稳定）；但 G1 网格依旧 `background-image=none`，`aed2b9d` 的修复无效——R9.5 只改了 `.joint-paper` 选择器，漏掉了 digitaljs 同步打在 wrapper 上的 `.djs` 类对应的透明规则。G1 维持 BLOCKED。**

### 复跑结果（质检方独立执行 `qc-r7-p2a-view.cjs`）
```
  FAIL  G1: dot grid visible — bgImage=none size=auto
  PASS  G2: zoom + clamps — after=1.10 max=3.00 min=0.300
  PASS  G3: plain wheel pan — ty 0.0→-120.0
  PASS  G4: right-drag pan — Δ(60,40)
  PASS  G5: contextmenu suppressed — defaultPrevented=true
  PASS  P0: 0 native dialogs
  PASS  P0: 0 TypeErrors — total=0
[DONE] 6 pass, 1 fail
```
→ 缩放/平移/右键交互全部真实通过，与 `d0e1567` 结论一致、无回归；唯独 G1 仍未转绿。

### G1 根因（二阶定位，DOM 诊断实证）
```
DIAG2: {
  wrapperInlineStyle: "position: relative; top:0; left:0; width:1212px; height:804px; background-color: var(--surface);",
  wrapperBgInline: "",                       ← 无内联 background 简写（digitaljs 未注入）
  computedBgImage: "none", computedBgSize: "auto", computedBgColor: "rgba(0,0,0,0)"
}
```
- wrapper 内联 style **只设了 `background-color: var(--surface)`，没有 `background` 简写** → 排除「digitaljs 内联覆盖」假设。
- 那为何 `background-image` 仍被清空？因为 `index.css:538` 的 `**`.djs`** { background: transparent !important }`（属于 L536–542 选择器组）命中 wrapper——`displayOn` 给 wrapper 打的 class 是 `joint-paper joint-theme-default **djs**`，`.djs` 不在 R9.5 的 `:not([data-sandbox-wrapper])` 排除名单里，故该 `!important` 简写照常把 `background-image→none` / `background-color→transparent`。
- 其余透明规则核对：`L406/L409`（`.joint-paper.joint-theme-*`）已排除、`L619`（`.joint-paper`）已排除、`L428`（Prism `pre/code`）不命中 wrapper、`L536` 组内 `.joint-paper:not(...)` 已排除；**唯 `.djs`（L538）漏网**。
- 结论：R9.5 修的是 `.joint-paper` 系，但 wrapper 还带着 `.djs` 类，透明规则从 `.djs` 这条路径依然生效，网格声明被覆盖 → G1 仍伪实现。

### R9.7 修正指令（替代 R9.5 未覆盖处，返回开发 AI 实施）
在 R9.5 四处基础上，**再补一处 `.djs` 排除**（仅改元素级，保留 `.djs svg` / `.joint-paper svg` 等后代透明不动）：

`src/index.css` L538（选择器组 `.joint-paper:not([data-sandbox-wrapper]), .joint-paper svg, **.djs**, .djs svg, ...`）：
- `.djs,` → `.djs:not([data-sandbox-wrapper]),`

（`.djs svg` 与 `.joint-paper svg` 保留为透明，使纸张 SVG 透明、网格透出。）

可选加固：把 G1 网格的 `background-image` / `background-size` 也加上 `!important`（防任何未来内联/简写覆盖）：
```
[data-sandbox-wrapper] { background-image: radial-gradient(...) !important; background-size: 20px 20px !important; }
```

实施后复跑 `.tmpbuild/qc-r7-p2a-view.cjs`，期望 G1 转 PASS：`computedBgImage` 含 `radial-gradient` 且 `computedBgSize = 20px 20px`。

### verdict
**R9（P2 第一批）维持：G1 BLOCKED；G2–G5 / P0 六项 PASS 稳定无回归。** `aed2b9d` 自报「网格透出」不属实——R9.5 漏改 `.djs` 透明规则，网格仍被覆盖。请按 R9.7 补 `.djs` 排除后重提，质检方复跑确认 G1 转绿即收官。

### 非阻塞项
- playwright-core 已入 devDep（`package.json:40 ^1.63.0`），`node_modules` 本地命中，脚本 `require.resolve` 通过 → R8 留债已清，可移植性达成 ✅。

### verdict
**P2 第一批：BLOCKED（G1 网格为伪实现）。** 缩放/平移/右键交互/右键菜单禁用 4 项功能均真实通过、可接收；唯「网格背景」CSS 存在但被 `.joint-paper` 透明规则覆盖，界面无可见网格。请开发 AI 按 R9.5 排除沙盒 wrapper 后重提，质检方复跑确认 G1 转绿。
G2–G5 已验收通过，本次无需返工。
