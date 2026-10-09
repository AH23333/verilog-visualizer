# Features Beyond Original Plan

> 本文档记录交接文档（HANDOVER_P1_P2.md）契约范围之外、后续迭代中落地的功能。
> 质检前必读——无文档功能不纳入正式质检。

---

## 1. 分屏视图（ViewMode = 'split'）

**状态**：已上线
**入口**：左侧 ActivityBar 切分屏按钮，或快捷键
**实现**：
- `settingsStore.ts` ViewMode 扩展为 `'circuit' | 'code' | 'split' | 'sandbox'`
- 左右两个独立 pane，中间 splitter 可拖拽调节宽度
- 代码 pane 内嵌 CodeEditor，电路 pane 内嵌 Canvas
- **cross-highlight**：光标停在代码某行 → 电路中对应模块/线路高亮；反之电路中点击 cell → 代码编辑器跳行

**边界**：splitter 最小宽度 200px，窗口缩小时分屏仍保持比例。

---

## 2. 单步仿真（F7 / delta-cycle）

**状态**：已上线
**入口**：菜单栏 Run → Step Once，或 F7
**实现**：
- `Canvas.tsx` 中 `stepOnce()`：每次推进一步 delta cycle，激活当前 tick 的元件
- tick counter 显示在状态栏
- 与原波模拟（wave simulation）并存——单步模式下暂停连续仿真，逐拍推进
- 信号值实时更新：wire 常亮值标签、IO 按钮状态

**边界**：单步不改变电路结构，只推进时间；Reset 按钮回到 t=0。

---

## 3. 连线路由改造（manhattan → orthogonal）

**状态**：已上线
**背景**：原生 digitaljs 用 elkjs 自动布局，线路多弯曲、端点重叠
**改造**：
- 后处理合并间距 <25px 的点对为中点（消除 elkjs 给 joint 画圆角留的多余点）
- CSS `stroke-linejoin: miter` 强制直角
- 保留 elkjs vertices（清空 vertices 会导致线路大量重叠）
- 总线（bits>1）粗线视觉区分

**边界**：路由仍是正交直角，但端点过多问题已缓解；线路重叠仍偶发（P2 优化）。

---

## 4. 其他已上线功能

| 功能 | 说明 |
|---|---|
| 深色模式子电路修复 | 下钻子电路时背景跟随主题（CSS !important 兜底） |
| 滚轮交互 | 滚轮平移 / Ctrl+滚轮缩放 / 右键拖拽平移 |
| Quartus 风格渲染 | cell body 浅灰 #f4f4f5；⚠ 文字**不再**写死 #18181b——深色主题下部件/线路命名曾整片看不见，现在跟随主题变量（见 §5） |
| InputPanel 自研 | 集中信号输入面板，替代原生 IO 按钮 |
| wire 值标签 | 常亮显示信号值（0/1/x/z） |
| 编译进度反馈 | 状态栏显示 yosys 编译进度 |
| auto-save | 代码编辑自动保存 + mtime 比对 |
| Problems 页签 | 编译错误跳行 |
| 命令面板 | Ctrl+Shift+P |
| Onboarding 首启引导 | 首次打开弹窗引导 |
| 左栏视觉统一（R115） | 两模式三面板头共用一套令牌（10/14 padding、`--fs-xs`+0.08em、`--border` 外沿、默认宽 240、区间 180–500）；IDE 面板头中文化收口（Modules→模块 / Hierarchy→层次结构）；Tailwind `text-[var(--fs-xs)]` 死类改 `text-[length:]` 真修 |

---

## 5. 沙盒部件系统与「部件绑定总览」（R39 → R84）

**状态**：已上线
**入口**：沙盒左侧栏 → 「部件绑定」（`button[data-sandbox-bindings]`，在「设置」下方）
**详述**：`docs/SANDBOX_DEV.md` §2

- 部件真身＝可编辑的 `role:'part'` `.djs` 画布文件；绑定名＝文件名去扩展名
- 解析按**作用域打分**（`resolvePartRef`）：本文件夹部件 → 本文件夹任意 `.djs` → 根部件 → …
  同名部件分散在多处时，弹窗的「实际解析」列直接回答"这一颗到底展开了谁"
- 弹窗每行＝画布上一颗子电路实例：`未绑定 / 绑定失效 / 已绑定`（＋同名 `⟡`），
  换绑走 `rebindSubcircuitCell`（重建实例、按端口 id 接回连线、接不上的报条数）
- 跨文件夹移动文件会**随行补齐**缺失的部件定义（拖拽与剪切粘贴两条臂都算）
- 删掉部件文件不再留下"能看见却放不出来"的幽灵项：文件树与「自定义部件」栏同源，
  删除即时生效，画布上已放置的实例在总览里显式报「绑定失效」

**边界**：同名遮蔽的**优先级规则**没有 UI 可改（只有解析函数那一份打分表）；总览是**当前文件**的
视图，不做跨文件全库扫描。

---

## 6. 上游器件与参数编辑器补齐

| 器件 | 编辑入口 |
|---|---|
| MuxSparse 稀疏选择器 | 右键「分支取值表」（非负十进制列表）＋ 数据/选择位宽 |
| Repeater 缓冲器 | 逻辑门分组内 |
| BusGroup / BusUngroup | 放下即弹「位宽方案」对话框（`[data-bus-width-dialog]`，Esc 关）＋ 右键分组配置 |
| BusSlice | 切片配置 `起始:位数` ＋ 总线总位宽 |
| Memory | 右键「端口配置…」（`MemPortsModal`）＋ 查看/编辑内存/清零/全 1 |
| FSM 状态机 | 右键「转移表…」（`FsmTableModal`）重建状态图与弧线 |
| n 元门（And/Or/Nand/Nor/Xor/Xnor） | 右键「输入引脚数 2–16」（`inputs` 是构造期参数，改完重建端口） |
| NumDisplay / NumEntry | 画布内原生 `<select>` 改进制；`numbase` 已进序列化清单（存盘重开不丢） |
| 常量折叠显示（R114） | 只读渲染链借上游 `transform.integrateArithConstant`：运算器+Constant 喂入 → `+5` 圆圈（宿主 id/连线/源码跳行保留；沙盒编辑画布与存档**不折叠**；设置可关） |

**边界**：`signed / fillx / words / offset` 四项与上游清单对齐，但本仓**现场没能复现**其丢失后果
（裸 `techmap` 会把 `$mul/$div` 打散成门），不算"已修掉的可见缺陷"。

---

## 7. 错误与反馈文案（V1 / V2）

- 接口校验错误带**结构化行号**（`ValidationError.line`），状态栏那句话与 PROBLEMS 每一行同源；
  文件级"模块重复"没有单一行，就写 `未定位到行`而不是猜一行
- 空态与错误态文案中文化：`尚未编译。按 F5 开始编译。` / `还没有输出。按 F5 开始编译。` /
  `没有问题。代码是干净的。`
- 状态栏仍有一批英文反馈语未中文化（登记为待办 V2b），**不属于**本文档已上线范围

---

## 8. 布尔表达式 → 电路图（R117，借鉴 OpenCircuits ExprToCircuitPopup）

- 沙盒顶栏「表达式生成」→ 弹窗输入布尔表达式（`a & b | !c`、`&&/||`、`*`、`AND/OR/XOR/NOT` 关键字、
  `+` 或 `|` 均可），实时预览拓扑摘要（输入数/门数/线数），一键生成到画布中心。
- 算法移植上游 ExpressionParser（优先级递归下降）并保留其全部结构语义：
  同型并多输入门（`a|b|c|d` → 一颗 4 输入 Or）、括号 final 不并（`(a|b)|(c|d)` → 三颗二输入 Or）、
  反相融合（`!(a&b)` → 单颗 Nand）、扇入 >8 自动嵌套分桶。
- 生成物走既有 `insertCellsAt` 管线：id 批号重映射、可撤销、仿真即跑、可存自定义门、可导出 Verilog
  （Input/Output 的 net=变量名/输出名）。
- 错误体验：词法/语法错误实时中文提示（括号不匹配、缺操作数、撇号取反指引），生成按钮禁用。
- 判据吸取卷十九教训：**真机消费链全走**——8 组真值表由 digitaljs 引擎实跑与表达式引擎对拍
  （`tests/r117-expr-gate.cjs` 8/8）。
- 未做（登记）：多输出（`y=..; z=..` 一次生成）、IC 封装形态生成（上游 isIC）、Clock/Oscilloscope 输出选项。
