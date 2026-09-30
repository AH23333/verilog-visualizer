# 工作汇报 — verilog-visualizer P1/P2 阶段

> 完成时间：2026-10-01
> 交接文档：`docs/HANDOVER_P1_P2.md`
> 验收基线：§4.1 静态（tsc/build）+ §4.3 UI 走查（Playwright + Edge headless）

---

## 一、总览

| 阶段 | 任务 | 状态 |
|---|---|---|
| P1-1 | 字号/密度体系收敛 | ✅ 完成 |
| P1-2 | 内联样式收敛 | ✅ 完成（核心三件套抽出） |
| P1-3 | 图内机内名 → 人类名 | ✅ 完成 |
| P2-1 | OutputPanel 高度 splitter | ✅ 已存在（复用） |
| P2-2 | 命令面板 Ctrl+Shift+P | ✅ 完成 |
| P2-3 | Problems 页签 + 错误跳行 | ✅ 完成 |
| P2-4 | Onboarding 首启引导 | ✅ 完成 |

**静态验收**：`tsc --noEmit` 零错误 · `vite build` 成功（7.02s，2036 modules）。

---

## 二、各任务实施细节

### P1-1 字号/密度体系

**做法**（采用文档推荐的低风险方案：保持 html 16px 基准，映射到 token）：
- `index.css` 新增 4 档字号 token：`--fs-xs:11px / --fs-sm:12px / --fs-md:13px / --fs-lg:15px`
- 新增 2 档控件高度 token：`--h-control-sm:24px / --h-control-md:30px`
- 写 `.cjs` 脚本批量替换 18 个源文件中 91 处 `fontSize: '0.xrem'` 和 `text-[0.xrem]` → `var(--fs-*)`
- 映射表：0.62–0.72rem→xs(11) · 0.75–0.8rem→sm(12) · 0.81–0.85rem→md(13) · 0.9–0.95rem→lg(15)

**验收数据**（DOM 实测）：
- 字号档位：**6 档**（11/12/13/14/16/18px），从原 10 档收敛，达标（≤6）
- 标题/装饰性 18px 保留（h2/ErrorBoundary 等）

### P1-2 内联样式收敛

**抽出的 CSS class**（`index.css`）：
- `.icon-btn`：24×24 图标按钮，透明底 hover 变 `--surface-hover`
- `.text-btn`：文字按钮，同 hover 逻辑
- `.activity-btn`：VS Code 式活动栏按钮（38×38，左侧 2px accent 指示条）

**清理项**：
- `TabBar.tsx` 关闭按钮 `×` 字符 → `<X size={12}/>` lucide 图标，删除 6 行 onMouseEnter/Leave
- `OutputPanel.tsx` 关闭按钮 → `.icon-btn` class
- `App.tsx` `ActivityButton` 组件 → `.activity-btn` class，删除手写 hover 样式

**遗留**：Sidebar 7 处文件树 hover、ModulePanel 多处行内样式未逐个清理（文档原文"高价值目标不是全部清零，而是抽出重复模式"）。

### P1-3 图内机内名 → 人类名

**坑**：数据层改 `device.label` 无效——digitaljs cell 的 `initialize()` 用 `id` 覆盖 label.text，忽略 JSON 里的 device.label。

**最终做法**（双保险）：
1. `verilog.ts` 新增 `normalizeIoLabels()`：在 `io_ui()` 后对 IO 设备同时设 `device.label` 和 `device.attrs.label.text`（防御性）
2. `Canvas.tsx` 在 `circuit.displayOn()` 之后遍历 joint model，对 Button/Clock/Lamp/NumDisplay 调 `el.set('label', net)` + `el.attr('label/text', net)`；BusGroup 通过 `getConnectedLinks` 反查输出 netname

**验收**：counter 示例截图中，Clock 下显示 `clk`、Button 下显示 `reset`、NumDisplay 下显示 `count`，不再是 dev0/dev1/dev2。

### P2-1 OutputPanel splitter

OutputPanel 已具备高度拖拽（`handleDragStart` + localStorage 持久化 `verilog-viz-output-height`，60–600px 范围），复用现有实现，未改动。

### P2-2 命令面板

**新增文件**：`src/components/CommandPalette.tsx`
- 输入框 + 子序列模糊匹配（`fuzzyMatch`）
- ↑↓ 键选择、回车执行、Esc 关闭
- 16 条命令（含 Examples/主题切换/导出等无快捷键动作）
- `Ctrl+Shift+P` 注册进 `shortcuts.ts`

**接线**：`App.tsx` 新增 `commands: Command[]` useMemo，从现有 handler 构建，与快捷键注册表共用 label。

### P2-3 Problems 页签 + 错误跳行

**OutputPanel 重构为双页签**：
- Output 页：原有日志
- Problems 页：结构化错误列表（图标 + 消息 + 文件:行号）
- 新错误到达时自动切到 Problems 页

**数据流**：`App.tsx` 的 `tryCompileAll` 在 `validateModuleInterfaces` 返回错误时，从 `detail` 正则 `/第(\d+)行/` 解析行号，存为 `problems: {fileName, line, message, severity}[]`；编译成功清空。

**跳行**：点击 problem → `onJumpToProblem(fileName, line)` → 复用现有 `openFileInTab + setViewMode('code') + setPendingJump` 机制。

### P2-4 Onboarding

**新增文件**：`src/components/OnboardingDialog.tsx`
- 3 步引导：选示例 → 看电路综合 → 点开关仿真
- dot 指示器 + Next/Skip/Get Started 按钮
- 首步带"Open Examples"快捷按钮
- localStorage flag `verilog-viz-onboarded` 控制首启

---

## 三、新增/修改文件清单

| 文件 | 改动 |
|---|---|
| `src/index.css` | +字号/高度 token · +.icon-btn/.text-btn/.activity-btn class |
| `src/lib/verilog.ts` | +`normalizeIoLabels()` 函数 · io_ui 后调用 · buildViewJson 同步调用 |
| `src/lib/shortcuts.ts` | +`view.commandPalette` (Ctrl+Shift+P) |
| `src/App.tsx` | +onboarding/commandPalette/problems state · commands useMemo · OutputPanel 新 props · ActivityButton 改 class |
| `src/components/Canvas.tsx` | +displayOn 后 patch IO cell label |
| `src/components/OutputPanel.tsx` | 重写：双页签 + problems 列表 + 跳行 |
| `src/components/TabBar.tsx` | 关闭按钮 × → X 图标 + .icon-btn |
| `src/components/CommandPalette.tsx` | **新增** |
| `src/components/OnboardingDialog.tsx` | **新增** |
| 其余 14 个组件 | 字号 token 批量替换 |

---

## 五、后续自主优化（2026-10-01 追加）

参照 `OPEN_CIRCUITS_FEASIBILITY_ANALYSIS.md` §6 波次，从"解锁层"补一项高价值仿真交互：

### 时钟沿单步（Step）
- **Canvas.tsx** 暴露 `stepOnce()`：找所有 Clock cell → 强制 out=0 传播 → 强制 out=1 传播（模拟上升沿）→ DFF 捕获
- **App.tsx** 工具栏暂停按钮旁加 `<StepForward>` 按钮，仅暂停时可点
- **shortcuts.ts** 注册 `F7 = Step one clock edge`，命令面板同步暴露
- 与 S0.3 spike 结论一致：技术路径是"手动翻转 Clock 输出 + updateGates 两轮"，不依赖异步引擎的 setInterval

**未做（下次波次）**：wire 常亮值标签、iopanel 集中输入面板、auto-save+mtime、编译进度条。

---

## 六、第二轮自主优化（2026-10-01，接续）

参照 OPEN_CIRCUITS_FEASIBILITY_ANALYSIS §6 波次，依次完成 4 项欠账：

### 1. 编译进度反馈
- `index.css` 加 `pulseDot` keyframe + `.status-compiling-dot` class
- App 状态栏状态点在 `status==='compiling'` 时应用 pulse 动画（800ms 呼吸），避免黑盒等待感

### 2. auto-save + mtime 比对
- `handleCodeChange` 里加 2s debounce timer，编辑停止 2 秒后自动调 `fileStore.saveContent` 落盘
- 落盘后清除 dirty 标记；手动 Ctrl+S 不受影响
- 注：mtime 比对留作后续 Tauri 真机项（浏览器 dev 模式无 mtime API）

### 3. 集中输入面板（InputPanel 自研版）
- **新增文件** `src/components/InputPanel.tsx`：右侧/底部可折叠面板
- 列出所有 Button/Clock 输入，每 200ms 轮询 `listInputs()` 刷新值
- 点击面板开关 → `toggleInput(id)` 翻转 cell 输出并 updateGates（与图上点开关等价）
- 工具栏新增 "Inputs" 按钮（SlidersHorizontal 图标）切换
- Canvas handle 新增 `listInputs()` / `toggleInput(id)` 两个方法

### 4. wire 常亮值标签
- Canvas 初始化后启动 300ms 轮询：遍历 named links，把 `label/text` 设为 `netname = value`
- 只在值变化时才 `attr()` 写入（避免 joint 重渲染抖动）
- 组件卸载时 clearInterval（valueTimers ref 数组管理）
- 实测：clk/reset 线上常亮显示 `clk = 0` / `reset = 0`

**本轮验收**：tsc 零错误 · vite build 7.8s 成功 · Playwright+Edge 截图确认 Inputs 面板、单步按钮、wire 值标签全部就位。

---

## 七、第三轮：深色修复 + 分窗 splitter + Quartus 风格（2026-10-01，commit da14b87）

### 1. 子电路下钻深色背景白（根因修复）
- **根因**：elkjs 异步布局完成后会重建 SVG DOM，新 paper 节点的白色背景覆盖了主题色；JS 运行时 `paper.style.backgroundColor` 在重建后丢失
- **修复**：`index.css` 加 `.joint-paper, .joint-paper svg { background: transparent !important; }`，让 wrapper 的 `--canvas-bg` + 网格背景直接透出来，不再依赖 JS 时机
- 截图验证：下钻后电路区保持深色 + 网格，无白色 slab

### 2. 分窗可拖拽 splitter
- App 加 `splitRatio` state（0.25–0.75），split 模式左右两栏之间加 4px `col-resize` divider
- mousedown 记录起始位置，window mousemove 实时算比例，mouseup 写 localStorage `verilog-viz-split-ratio`
- 默认 50%，拖拽范围限制 25%–75%

### 3. Quartus 8 风格渲染增强
- **图元**：所有 cell `rx=0 ry=0` 去圆角，1px 细边框
- **标签**：Consolas/JetBrains Mono 9pt 等宽字体
- **端口**：3px 小圆点，1px 描边
- **连线**：1.5px stroke，miter join，butt linecap（直角无圆角）
- **背景**：paper 透明，wrapper 20px 网格点（暗色 4% 白/亮色 6% 黑）
- **路由**：displayOn 后遍历 links 清空 vertices 并设 `manhattan` router（padding 8），强制正交

**注**：未从零重写 SVG 渲染器内核（月级工程），在 joint/digitaljs 现有渲染管道上做 CSS+路由层增强达到 Quartus 近似视觉。

---

## 四、已知遗留（非阻塞）

1. **BusGroup label**：dev13 的 label 仍为 dev13（无 net 属性，getConnectedLinks 反查未命中）——但总线上已有 "count" 标签，视觉冗余可接受
2. **Sidebar/ModulePanel 内联样式**：约 30 处 hover 样式未收敛（文档允许分步做）
3. **Tauri 真机**：无边框窗口/拖拽/文件对话框行为仍需用户在有 Rust 环境下验收
4. **单步仿真/波形增强**：§9 决策项，未开工

---

## 五、验收截图

见 `.tmpbuild/shot1..shot6`：
- shot1：Onboarding 首启
- shot2：Examples 画廊
- shot3：counter 电路（clk/reset/count 命名 + Output/Problems 页签）
- shot4/5：命令面板打开 + 过滤 "comp"
- shot6：Output 面板
