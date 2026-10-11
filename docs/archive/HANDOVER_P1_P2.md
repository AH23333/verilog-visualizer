# HANDOVER — verilog-visualizer P1/P2 阶段交接文档

> 读者假设：你是接手的 AI 编码助手，拥有与本仓库相同的完全访问环境。本文档自包含，读完即可开工，无需回溯历史会话。
> 最后更新：2026-10-01。所有改动**未提交**（`git status` 见 §13），建议接手后第一步按 §13 建议先做逻辑单元提交。

---

## 0. TL;DR

- 项目：Verilog → 可交互电路的 Tauri v2 桌面应用（Yosys WASM 综合 + digitaljs 渲染仿真）
- 当前状态：功能波次（仿真控制/示例库/双向跳转/层次下钻/tooltip/波形）+ UI P0（去廉价）+ VS Code 式两行标题栏 + 无边框窗口**全部完成并回归通过**，tsc/build 双绿
- 你的任务：P1（字号/密度/命名收敛）与 P2（面板 splitter/命令面板/Problems 跳行/onboarding），详见 §7/§8
- 铁律：**任何改动必须过 §4 的验收方法**，视觉类改动必须截图人眼复核（历史教训：纯功能断言漏掉了 fit 裁切 bug 整整两个波次）

---

## 1. 项目概览

| 项 | 值 |
|---|---|
| 仓库根 | `D:\Visual Studio Code\Something\verilog-visualizer`（git 仓库，工作区根为 `D:\Visual Studio Code\Something`） |
| 技术栈 | React 19 + TypeScript + Vite 6 + Tailwind v4（`@tailwindcss/vite`）+ Tauri v2 |
| 核心链路 | `src/lib/verilog.ts`：Yosys WASM（`public/yosys/yosys.wasm`，版本 0.30）→ `yosys2digitaljs@0.10.3` → `io_ui` → `renameAutoCells` → `src/components/Canvas.tsx` 用 `window.digitaljs.Circuit`（`public/digitaljs.js` UMD，digitaljs 0.14.2 + elkjs 布局）渲染 |
| 对标库 | `D:\Visual Studio Code\Something\OpenCircuits`（GPL-3.0，**只可借鉴设计思想，禁止拷贝代码**，详见 `OPEN_CIRCUITS_FEASIBILITY_ANALYSIS.md` §R9） |
| 决策文档 | `OPEN_CIRCUITS_FEASIBILITY_ANALYSIS.md`（可行性分析 + §10 实测记录 + §10.2 已实现清单——**开工前先读 §10**） |
| 包管理 | pnpm 11。命令：`pnpm dev`（vite, 端口 **1420 固定 strictPort**）/ `pnpm exec tsc --noEmit` / `pnpm exec vite build` / `pnpm tauri dev`（真机） |

### 关键文件地图

```
src/
  App.tsx                  # 主组件：状态机、标题栏融合行、TabBar rightSlot、对话框接线、下钻路径 viewPath
  index.css                # 设计 token（[data-theme=dark]/[data-theme=light] 双块 + :root 合并块）
  lib/
    verilog.ts             # 编译管线：compileVerilog / normalizeStdDffCells / buildViewJson / validateModuleInterfaces
    examples.ts            # 5 个内置示例（单一真源）
    shortcuts.ts           # 快捷键注册表（单一真源，App 派发与帮助弹窗共用）
    exportUtils.ts         # SVG/PNG/JSON/Verilog/Netlist 导出（Tauri save_export_file）
    digitaljs.d.ts         # window.digitaljs 类型声明
  components/
    Canvas.tsx             # digitaljs 宿主：fit/zoom/pan、锁定、暂停、速度、tooltip、双击跳源码、高亮、下钻探测、波形采样
    TabBar.tsx             # 标签行 + rightSlot（工具组，sticky）
    MenuBar.tsx            # 内联菜单（融合进标题栏，不再是独立条）
    Sidebar.tsx            # 文件树（含列宽拖拽 handleSidebarDragStart 在 App）
    ModulePanel.tsx / HierarchyViewer.tsx / OutputPanel.tsx / CodeEditor.tsx
    PromptDialog.tsx / ConfirmDialog.tsx   # 应用内对话框（Promise 化，替代原生 prompt/confirm）
    ExamplesDialog.tsx / ShortcutsHelpDialog.tsx / WaveformPanel.tsx / WindowControls.tsx
    ContextMenu.tsx        # 右键菜单（'---' 渲染为 role=separator）
src-tauri/
  tauri.conf.json          # windows[0].decorations=false（无边框）
  capabilities/default.json # 含 7 个 core:window:allow-*（已对照 gen/schemas 验证合法）
  gen/schemas/desktop-schema.json  # 上次构建生成的权限枚举（离线核验权限标识的权威来源）
```

---

## 2. 环境事实与限制（实测确认，别浪费时间重探）

1. **本机无 Chrome / 无 Playwright 浏览器内核**，`playwright-browser` MCP 起不来。UI 走查方案：**Playwright core + 系统 Edge headless**：
   ```js
   const pw = require('playwright-core'); // 已装于 Something/.tmpbuild/node_modules（若无则 npm i playwright-core --no-save）
   await pw.chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
   ```
2. **无 Rust toolchain**（`rustup toolchain list` → none）→ `cargo check`/`pnpm tauri dev` 在本环境**跑不了**。Tauri 侧改动的验证上限 = tsc + vite build + 浏览器 fallback 截图 + `gen/schemas` 离线核验权限标识。真机行为（拖拽/最大化/关闭）**留给用户在 VS Code 环境验收**。
3. **PowerShell 5.1 陷阱**（反复踩过）：
   - 内嵌 `node -e "..."` 带 `${}`/引号嵌套**必炸** → 一律落盘 `.cjs` 脚本再执行
   - `>` 重定向输出 **UTF-16LE** → 读取时检测 BOM `0xFF 0xFE` 并用 `buf.toString('utf16le', 2)`
   - `&&` 不可用 → `; if ($?) {}`
4. **持久 shell 的 cwd 会漂移** → 所有文件操作用绝对路径。
5. dev server 用 `Start-Process node -ArgumentList "node_modules\vite\bin\vite.js","--port","1420" -WindowStyle Hidden` 脱离会话启动；用完 `Get-NetTCPConnection -LocalPort 1420` 找 PID 杀掉。

---

## 3. 当前 UI 架构（P0 + 融合 + 无边框后）

```mermaid
graph TB
  subgraph 窗口 [Tauri 无边框窗口 decorations:false]
    subgraph 标题栏行 [标题栏行 h40 · toolbar-bg · data-tauri-drag-region]
      AB[活动栏 48px 通顶<br/>Files/Boxes/Network/Moon] --- MENU[菜单 File Edit Export View Settings Help] --- IDT[● 状态点 + 文件名 + 消息] --- SPACER[拖拽 spacer] --- WC[WindowControls<br/>最小化/最大化/关闭<br/>非 Tauri 环境返回 null]
    end
    subgraph Tab行 [TabBar h40 · overflowX auto]
      TABS[标签页×N] --- SLOT[rightSlot sticky<br/>Simulate/⏸/SPEED/Wave<br/>Examples/Save/Compile<br/>Circuit|Code 分段]
    end
    BODY[内容区：Canvas 或 CodeEditor + 面包屑浮层 + WaveformPanel]
    OUT[OutputPanel 可折叠] --- SB[StatusBar]
  end
```

- **设计 token**：`index.css` 双主题块（49 dark / 41 light 颜色 token + `:root` 合并块内 radius/transition）。**禁止组件内硬编码颜色**（浅色主题的坑全来自这，见 §10-7）。
- **对话框体系**：`askPrompt()/askConfirm()`（App.tsx，Promise 化）→ `PromptDialog/ConfirmDialog`。新增交互一律走它，**禁用 window.prompt/alert/confirm**（验收脚本会监听 `page.on('dialog')` 断言为 0）。
- **图标**：统一 `lucide-react`（单色描线，size 12-19）。**禁用 emoji/彩色字符**做图标。
- **快捷键**：`src/lib/shortcuts.ts` 注册表单一真源——新增动作必须同时加注册表条目 + App dispatch case，`Ctrl+/` 弹窗自动同步。

---

## 4. 验收方法论（铁律，每次改动后执行）

### 4.1 静态
```
pnpm exec tsc --noEmit          # 必须零错误
pnpm exec vite build            # 必须成功
```

### 4.2 Yosys/数据链路改动 → Node 取证模板（无需浏览器）
```js
// 浏览器同款 shell + 同款 wasm（SHA 一致），复刻 verilog.ts 管线
const InitYosys = require('yosys/dist/yosys.browser.js');   // 不要用 require('yosys')——node 版有 hostcwd mount 炸点
const mod = await InitYosys({ noInitialRun: true, wasmBinary: fs.readFileSync('node_modules/yosys/dist/yosys.wasm') });
// Node 下中和 ASM_CONSTS 的 hostcwd/hostfs mount（浏览器运行时不会执行这段，shim 忠实于 app 行为）：
// FS.mkdir 对 /hostcwd|/hostfs 吞异常；FS.mount 对二者 try/catch 返回 null
mod.print = () => {}; mod.printErr = () => {};
mod.callMain(['/script.ys']);
```
参考已验证脚本形态：`normalizeStdDffCells`、`buildViewJson`、子模块 io_ui 可行性，全部先经此法取证再写产品码。

### 4.3 UI 改动 → Playwright 走查模板
```js
await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);            // 教训：cargo/重编译抢 CPU 时 vite 冷启动慢，
// 断言前先等 root 就绪（首轮白屏误报的教训）：
await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000);
```
- 每个用例独立 `step(name, fn)` 收集 pass/fail，结尾打印 `PASS n / FAIL m` + pageErrors（过滤 `save_export_file|invoke|__TAURI`——headless 无 Tauri 时导出 invoke 必抛，属预期）
- **必须截图 + 人眼（多模态）复核**：功能断言测不出"裁切/重叠/对比度"

### 4.4 调试钩子（DEV-only，prod 构建自动剥离）
`window.__djsDebug`（Canvas 暴露）：
- `getSignals()` → `{ running, warnings, tick, cells:[{id,type,label,net,out,ins}] }`（仿真断言核心）
- `getLinks()` / `getPaper()`（joint paper 实例）
- 稳定选择器：`[data-testid="sim-lock-toggle"]`、`[data-testid="wave-toggle"]`、`button[title="Back to top module"]`、`button[title*="imulation"]`（暂停）、`.net-tip`（tooltip）、`.src-highlight`（高亮）、`[role=separator]`、`[role=dialog]`、`.btnface`（digitaljs 开关）、`[model-id]`（joint 单元 DOM）

### 4.5 标准回归清单（改动后至少过一遍，全绿才算完成）
1. 5 个示例逐个编译成功且 svg 渲染
2. 标题栏 File 菜单展开/收起；`Ctrl+/` 弹窗
3. `Ctrl+N` → PromptDialog（内联校验 `foo.txt` 报错、Esc 取消、成功创建）
4. 双击 Subcircuit 单元 → 跳源码（`Jumped to example_full_adder.v:N`）
5. 光标停 ha1 行 → 点 Circuit → `.src-highlight` ≥1
6. 右键 Subcircuit → `Enter half_adder` → 面包屑 + 内部可交互 → 返回
7. counter：reset 双点 → bus 递增 → 暂停冻结 → 恢复
8. Wave 面板 → canvas 有色像素 >500 → 关闭
9. 锁定后 `.btnface` 点击无效
10. `page.on('dialog')` 全程 0 次原生弹窗

---

## 5. 已完成工作（时间线，供追溯）

| 波次 | 内容 | 关键实现点 |
|---|---|---|
| W1 | 仿真控制（锁定/暂停/速度）、Examples 画廊（5 例）、快捷键注册表+弹窗、MenuBar 空实现补全 | `paper.fixed` + **pointerEvents 双保险**（见 §10-4）；示例同名复用+内容刷新 |
| W1.5 | `$_DFF_P_` 编译崩溃修复 | `normalizeStdDffCells()`：yosys2digitaljs@0.10.3 的 techmap_dff_kinds Map 重复键 bug → json 预处理回 `$dff/$dffe`（参数须**字符串** + 32 位 `WIDTH`，已对齐金标准） |
| W2 | 综合网表导出（write_verilog）、双击跳源码、代码→电路发光 | `CompileResult.netlistVerilog/srcFileMap`（会话级，localStorage 持久化时剥离）；`jumpToLine` 利用子先父后 effect 顺序 |
| W2 | 层次下钻 | `buildViewJson(rootJson, path)`（clone→io_ui→renameAutoCells，从 root 幂等派生）；右键 `probeCellAt`（遍历 Subcircuit 取包围点者，**勿用 elementFromPoint**，见 §10-9）；viewPath 状态 + 面包屑 |
| W2 | 信号值 tooltip | `.net-tip` DOM 直驱；link 有 `signal/netname/bits` 属性，cell 有 `outputSignals.out` |
| W2 | 波形查看器 | **自绘 canvas**（未用 digitaljs Monitor，规避 joint 坐标系耦合）；轮询 `getWaveSample()`，transition 环形缓冲 |
| W3 | fit-to-window 修复 | `getContentBBox()` 替代 width 属性（见 §10-1） |
| P0 | 去廉价 | lucide 图标全站、PromptDialog/ConfirmDialog 替换 11 处原生弹窗、分隔符/重叠/黑方块/kbd 4 bug、**删除未分层 `*{padding:0}` 重置**（§10-2） |
| P0+ | 标题栏融合 | 三行→两行（VS Code 式）；TabBar `rightSlot`（sticky）；活动栏通顶 |
| P0+ | 无边框 | decorations:false + 7 权限 + WindowControls + 拖拽区（§10-10/11） |

---

## 6. 已知遗留（P0 内未做，非阻塞）

- 全局仍有 ~80 处内联 style 与 Tailwind 混用（P1-2 收敛）
- `TabBar.tsx` 关闭按钮仍是文本 `×`、`Sidebar` 展开按钮 `▸` 等零星符号残留（P1 顺路清）
- 状态栏/Output 字号未收敛（属 P1-1 范围）

---

## 7. P1 待办（设计系统收敛）

### P1-1 字号/密度体系 ⭐ 最高优先
- **现状**：基准 16px（VS Code 是 13px），DOM 实测 10 档字号（11.2–18.4px），整体"放大网页"感
- **方案**：
  1. `index.css` 定 4 档 token：`--fs-xs:11px / --fs-sm:12px / --fs-md:13px / --fs-lg:15px`
  2. `html { font-size: 13.5px }`（或保持 16px 但把各 `text-[0.x rem]` 全映射到 token——**推荐后者**，风险低：改 html 基准会连带 digitaljs/joint 内部 em 计算，务必小步试）
  3. 逐组件替换：菜单栏 0.8rem、正文 0.85rem、状态栏 0.75rem、tooltip 已 0.72rem 保留
- **验收**：audit 脚本（§11 模板）统计 `textFontSizes` ≤ 6 档；截图对比无裁切
- **风险**：字号变小 → 行高/按钮高度联动检查（按钮高度已有 9 档，顺路收敛到 24/30 两档）

### P1-2 内联样式收敛
- 高价值目标不是全部清零，而是**抽出重复模式**：`toolbarBtnStyle`、图标按钮 hover 三件套（onMouseEnter/Leave 手写 style 的有 ~30 处）→ 做成 CSS class（`.icon-btn`、`.text-btn`）放 index.css，用 `:hover` 替代 JS
- 验收：grep `onMouseEnter={(e) =>` 数量显著下降；视觉回归截图 diff

### P1-3 图内机内名 → 人类名
- **现象**：电路图上 `dev0/dev1/dev13`（io cell 与 BusGroup 显示 id）、`AUTO_1..10`
- **根因**：digitaljs 的 Input/Button/Lamp/BusGroup 视图默认 `label` 回退到 id；`renameAutoCells` 已把门单元改成 `AND_1` 等，但 io cell 的 `label` 未设
- **方案**（显示层，安全）：在 `verilog.ts` 的 `io_ui` 之后补一步：对 `type==='Button'|'Clock'|'Lamp'|'NumDisplay'` 且 label 为 devX 的 device，`device.label = device.net || device.name`（net 即端口名 clk/reset/count）；BusGroup 同理用 `connectors[i].name` 反查
- **注意**：`renameAutoCells` 的 label 是**显示层**，`source_positions`/`getLabelIndex` 用的是原 key——改名不影响跳转链（已验证），但**不要动 device 的 key**
- 验收：counter 截图上应显示 clk/reset/count 而非 dev0/dev1/dev13；回归 §4.5 全过

---

## 8. P2 待办（IDE 体验）

### P2-1 面板 splitter
- 侧栏宽度拖拽**已存在**（App `handleSidebarDragStart`），抄它的模式给 **OutputPanel/波形面板做高度拖拽**（OutputPanel 目前固定高度，一行日志也占 ~200px）
- 模式：flex 列 + `onMouseDown` 记录 startY → window mousemove 改 height state → mouseup 清理；hover 时 1px 线变 accent

### P2-2 命令面板（Ctrl+Shift+P）
- 地基已 90% 就绪：`shortcuts.ts` 注册表（id+label+combo）+ App dispatch 的 id→handler switch
- 做法：把 dispatch 里的 `run()` switch 抽成 `Map<string, {label, run}>`，注册表与命令面板共用；模糊匹配用子序列匹配即可（无依赖）
- 验收：Ctrl+Shift+P → 输入 "comp" → 回车执行编译

### P2-3 Problems/Output 页签 + 错误跳行
- OutputPanel 改双页签（Output 日志 / Problems 错误列表）；`YosysCompileError.fullLog` 与 `validateModuleInterfaces` 的错误已有文件+行号信息，解析成结构化列表
- 点击错误 → `openFileInTab + setViewMode('code') + setPendingJump({fileId,line})`——**跳行机制已存在**（P0 前批次实现），直接复用

### P2-4 Onboarding（对标 OpenCircuits QuickStartPopup）
- 首启（localStorage flag）弹 3 步引导：选示例 → 看电路 → 点开关仿真。纯静态组件，无新依赖

---

## 9. 待用户决策项（**不要擅自开工**）

| 项 | 背景 | 建议 |
|---|---|---|
| 单步仿真 | S0.3 已验证技术路径（stop + toggleInput + updateGates settle 循环），但 digitaljs 是异步引擎，"步进"语义与 EDA 仿真器不同；且 `io_ui` 会把名为 clk/clock 的输入**自动转自走 Clock**（propagation=100，实测 ~2s/递增），步进需先降级 Clock→Button | 语义有产品争议，先问用户要不要做"演示级步进" |
| 波形增强（通道勾选/时标/VCD 导出） | 波形 MVP 已上线（自动全通道） | 等 P1/P2 做完再评估 |
| Tauri 真机验收 | 无边框窗口行为（拖拽/双击最大化/按钮）在本环境**无法验证** | 提醒用户跑 `pnpm tauri dev`（需其本机 Rust toolchain） |

---

## 10. 坑清单（全部实测踩过的，别再踩）

1. **fit/尺寸测量**：digitaljs 的 svg `width="100%"` → `parseFloat` 得 100。测量内容尺寸**只用 `paper.getContentBBox()`**（含 x/y 原点偏移）。
2. **Tailwind v4 间距全局失效**：未分层的 `* { margin:0; padding:0 }` 会压死所有 `@layer utilities`（CSS 层叠规则：无层级 > 任何层）。已删除；**永远不要在 layer 外加通用重置**。怀疑样式不生效时，先用 `getComputedStyle` 实测（本项目"廉价感"根因即此）。
3. **joint findView 不可靠**：digitaljs 设的 `cell.get('id')='dev6'` 与 joint 内部 UUID 键不一致，`paper.findView(...)` 各种入参都可能 undefined。**DOM 路径可靠**：`querySelectorAll('[model-id]')` + `paper.model.getCell(id)`。
4. **digitaljs ButtonView 用 jQuery DOM 委托绑 `click .btnface`**，绕过 joint `setInteractivity` → 锁定必须**双保险**：`paper.fixed(true)` + paper 元素 `style.pointerEvents='none'`（Canvas `applyFixed` 已实现）。
5. **React StrictMode 双挂载**：cleanup 的 `stop()` 会异步触发 `changeRunning(false)` → 同步读 `circuit.running` 上报会误报"仿真未启动"。规则：**只信 `hasWarnings()` 同步判定**，`changeRunning` 只在变 true 时上报。
6. **yosys2digitaljs 不识别 `$_DFF_P_`/`$_DFFE_P*_`**（上游 Map 重复键 bug）→ `normalizeStdDffCells` 已修，新代码若绕过 compileVerilog 直接转换 json 必须记得先调它。多 bit 寄存器 init 上游不支持（`$adff` techmap 后 Q 单 bit 匹配不到 4-bit netname）——示例文案引导 reset 脉冲是有意为之，勿当 bug 删。
7. **浅色主题问题都在组件硬编码**（token 结构本身完整）。新样式一律 `var(--token)`，主题色判断一律 `data-theme` CSS，禁止 `theme === 'dark' ? '#xxx' : '#yyy'`。
8. **向宿主组件挂新 slot 要检查 early return 连坐**：TabBar `if (openFiles.length===0) return null` 曾把 rightSlot 一起吞掉。
9. **elementFromPoint 命中可能是压在单元上的连线**（link 也有 model-id）→ 需要"命中某类 cell"时主动遍历候选取包围盒（`probeCellAt` 模式）。
10. **`data-tauri-drag-region` 判断存在性**：`="false"` 字符串仍生效且吞按钮点击。交互元素上**不要加**该属性。
11. **capabilities**：Tauri v2 `core:default` **不含**窗口动作权限；close/minimize/toggle-maximize 等要显式加（本项目已加 7 个，对照 `gen/schemas/desktop-schema.json` 核验）。
12. **PowerShell**：见 §2-3；另外 `edit` 工具锚点若含 `${}` 会被 shell 层吃掉——含 CJK/特殊字符的批量替换用落盘 `.cjs` 脚本（含锚点存在性检查 + MISS 打印）。
13. **回归 FAIL 先核对断言语义**：曾把"无文件时 Save/Compile 隐藏"（原有设计）当 bug 报。改断言前先确认被测行为是不是 by design。
14. **探针时序**：重负载（cargo/构建并行）时 vite 冷启动慢，断言前等 `#root` 内容就绪，别信 800ms 固定等待。

---

## 11. 审计脚本模板（放 `Something/.tmpbuild/`，用完即删）

```js
// DOM 计算样式审计：字号/圆角/控件高度档位数（P1 验收基线工具）
const info = await page.evaluate(() => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width && r.height; };
  const tally = a => a.reduce((m, x) => (m[x] = (m[x]||0)+1, m), {});
  return {
    buttonHeights: tally([...document.querySelectorAll('button')].filter(vis).map(b => Math.round(b.getBoundingClientRect().height))),
    textFontSizes: tally([...document.querySelectorAll('span,div,button,label')].filter(vis).map(e => getComputedStyle(e).fontSize)),
    inlineStyledEls: document.querySelectorAll('[style]').length,
  };
});
// 当前基线（P0 后实测）：buttonHeights 9 档 / textFontSizes 10 档 / inline ~89 处
// P1 目标：buttonHeights ≤3 档 / textFontSizes ≤6 档
```

---

## 12. 不可验证项（诚实边界）

- 真机窗口行为（拖拽、双击最大化、按钮、阴影、Win11 圆角）——本环境无 Rust，只能靠用户 `pnpm tauri dev` 验收
- Tauri 文件对话框/导出落盘（headless 下 invoke 必抛，回归脚本已过滤该错误）
- 若未来需要：装 Rust toolchain 后 `cargo check` 一次即可闭环权限验证

---

## 13. 工作树状态与建议第一步

未提交改动（相对 `main` 最后一次 UI 提交之后）：
```
M  package.json / pnpm-lock.yaml          （+lucide-react 1.48.0）
M  src-tauri/tauri.conf.json              （decorations:false）
M  src-tauri/capabilities/default.json    （+7 窗口权限）
M  src/App.tsx 及 16 个 src 文件
?? src/components/{PromptDialog,ConfirmDialog,WindowControls,ExamplesDialog,ShortcutsHelpDialog,WaveformPanel}.tsx
?? src/lib/{examples,shortcuts}.ts
?? OPEN_CIRCUITS_FEASIBILITY_ANALYSIS.md
```
建议接手第一步：按逻辑单元提交（① 功能波次 ② P0 去廉价 ③ 标题栏融合+无边框 ④ 文档），再开 P1。提交前跑一遍 §4.5 回归清单。
