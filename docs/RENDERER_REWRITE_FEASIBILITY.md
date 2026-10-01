# 渲染器重写可行性分析（不乐观版）

> 日期：2026-10-01
> 触发：用户要求 Quartus 8 风格渲染（直角、不重叠、网格、方框图元），现有 CSS 层增强未达标
> 口径：**不乐观**——先列成本和失败模式，再谈收益

---

## 一、现状盘点

| 层 | 当前方案 | 代码量 | 黑盒程度 |
|---|---|---|---|
| 布局 | elkjs（异步 worker，hierarchical layered） | 2.3MB bundle 黑盒 | 🔴 极黑 |
| 图元/连线渲染 | joint.js（SVG MVC，cell/link/port 体系） | 黑盒 | 🔴 极黑 |
| 仿真引擎 | digitaljs HeadlessCircuit + 3vl | 黑盒 | 🔴 极黑 |
| 我们的封装 | Canvas.tsx | 726 行 | 🟢 完全可控 |
| 总 src | — | 8167 行 | — |

**关键事实**：我们对渲染的控制只到 726 行 Canvas.tsx。背后 2.3MB 的 joint+digitaljs+elkjs 是我们无法修改的黑盒。

---

## 二、"重写渲染器"到底要重写什么

假设我们从零写一个 Quartus 风格 SVG 渲染器，需要实现的完整清单：

### 2.1 必须自己造的轮子

| # | 模块 | 为什么不能省 | 粗估代码 |
|---|---|---|---|
| 1 | **布局引擎** | elkjs 输出的顶点坐标是曲线/重叠的源头；自己写 = 实现正交路由 + 防重叠 + 端口对齐 | 2000-4000 行 |
| 2 | **SVG 图元渲染** | AND/OR/XOR/DFF/Latch/Button/Clock/Lamp/NumDisplay/BusGroup，每个都要画 port + body + label | 800-1500 行 |
| 3 | **连线路由** | manhattan/orthogonal 路由算法（含碰撞避让），Quartus 的总线分叉、跨层跳线 | 1500-3000 行 |
| 4 | **缩放/平移视口** | wheel zoom（光标处缩放）、右键拖拽 pan、fit-to-window、minimap | 300-600 行 |
| 5 | **选中/hover 交互** | 命中测试、hover tooltip、click toggle、右键菜单、双击跳行 | 400-800 行 |
| 6 | **仿真值驱动** | 3vl 值→线颜色（0蓝/1红/X灰/Z黄）、cell 高亮、bus 总线段绘制 | 300-600 行 |
| 7 | **下钻/面包屑** | 子模块视图切换、viewPath 状态、io_ui 重建 | 已在我们这边 |
| 8 | **导出 SVG/PNG** | 序列化 SVG、栅格化 | 已在我们这边 |
| 9 | **波形面板对接** | 已自绘，不依赖 joint | 已在我们这边 |
| 10 | **性能** | 500+ cell 时的视口剔除、dirty region、事件委托 | 500-1000 行 |

**合计新写代码**：~6000-12000 行，相当于当前整个项目（8167 行）的规模。

### 2.2 不能丢的已有能力

重写后必须重新对接：
- yosys2digitaljs JSON 格式解析（devices/connectors/subcircuits）
- 3vl 仿真引擎（digitaljs 的 HeadlessCircuit——这个不能重写，要保留）
- source_positions 双向跳转
- 单步/暂停/速度控制
- Monitor/轮询信号值

**结论**：重写只换"渲染层"（#1-6），仿真引擎和数据格式保留。但即使这样，也是 6000+ 行新代码。

---

## 三、不乐观的成本估算

### 3.1 编码时间（1 人 × AI 结对）

| 阶段 | 内容 | 粗估编码 | 粗估调试 |
|---|---|---|---|
| P0 | 设计：SVG 坐标系、cell 模型、link 模型 | 2 天 | — |
| P1 | 最小闭环：画 5 个门 + 直线连线 + 缩放平移 | 3 天 | 2 天 |
| P2 | 正交路由（无碰撞避让） | 3 天 | 3 天 |
| P3 | 碰撞避让（Quartus 不重叠） | 5 天 | 5 天 |
| P4 | 全部图元（DFF/Latch/BusGroup/NumDisplay...） | 3 天 | 2 天 |
| P5 | 仿真值着色 + hover tooltip + 右键菜单 | 3 天 | 2 天 |
| P6 | 下钻 + 面包屑 + fit-to-window | 2 天 | 2 天 |
| P7 | 性能优化（500 cell 流畅） | 3 天 | 5 天 |
| P8 | 回归测试（12 个已有用例全过） | 2 天 | 3 天 |
| **合计** | | **~26 天编码** | **~24 天调试** |

**总计约 50 个工作日 ≈ 2.5 个月**（1 人全职）。

### 3.2 被严重低估的点

1. **正交路由碰撞避让**是 NP-hard 级别的图布局问题。Quartus/ISE 用了几十年的专用算法。我们写一个"差不多"的路由，3 周；写一个"不重叠、不绕远、端口对齐"的，3 个月。
2. **elkjs 已经做了 P3 的工作**，但它输出曲线/重叠是因为 yosys2digitaljs 的 cell 尺寸/端口位置没对齐 elk 期望的格式。调 elk 参数可能比重写路由更便宜。
3. **joint.js 已经做了 P4-P6**。重写 = 把 joint 10 年的工程重新做一遍。
4. **边界情况**：多 bit 总线分叉、subcircuit 端口对齐、X 态/Z 态线色、cell 重叠时的 z-order、label 碰撞避让——每个都是坑。

---

## 四、风险清单（按严重度）

### 🔴 R1：重写后体验不如 joint/digitaljs
joint.js 是成熟的 SVG 图编辑库，有 10 年迭代。我们重写的第一版必然在交互流畅度、边界处理、性能上都不如它。**用户从 joint 切换到自研渲染器，体验是降级的**，除非我们做到 Quartus 原生级别的渲染质量——那是 6 个月以上的工程。

### 🔴 R2：正交路由做不出"不重叠"
Quartus 的不重叠布线是专用算法（基于 Steiner tree + 通道分配 + 层分配）。我们手写的 manhattan router 大概率会出现：
- 线交叉但不立交（没有跨线跳隙符号）
- 线紧贴 cell 边缘（内折凹陷，当前问题的根源）
- 长总线绕远路
- 端口对不齐

**这是当前 CSS 改不好、路由算法也未必能解决的问题。**

### 🟠 R3：维护成本翻倍
现在 Canvas.tsx 726 行 + 2.3MB 黑盒。重写后变成 8000 行自己写的渲染代码。每加一个 cell 类型、每修一个布局 bug，都是自己的活。joint/digitaljs 的升级红利（性能优化、新 cell 类型）全部放弃。

### 🟠 R4：仿真引擎对接风险
digitaljs 的仿真引擎（HeadlessCircuit）是黑盒，它内部持有自己的 cell/link 模型。我们重写渲染层后，要把仿真引擎的状态变化映射到我们自己的 SVG 上——这层映射是新写的，容易和仿真引擎的事件时序不同步。

### 🟡 R5：用户感知收益有限
用户要的是"Quartus 风格"。当前 CSS 增强已经做到了：网格背景、直角连线、方框图元、等宽字体。剩下的"不重叠"和"连线凹陷"是路由算法问题，**重写渲染器不解决这个——路由算法是独立的难题**。

---

## 五、不重写的替代方案（按性价比排序）

### 方案 A：调 elkjs 参数（0.5 天，最推荐）
elkjs 的 layered 布局有大量参数：
- `layered.spacing.nodeNode`：cell 间距（当前可能太小导致线挤在一起）
- `layered.nodePlacement.strategy`：BRANDES_KOEPF vs NETWORK_SIMPLEX（影响交叉数）
- `elk.direction`：DIR_RIGHT vs DOWN
- `elk.layered.edgeRouting`：POLYLINE vs ORTHOGONAL（**关键**——强制正交路由）

**行动**：给 digitaljs Circuit 构造传 elkjs 配置参数（如果支持），或在 displayOn 后手动调 elk 布局。先试 `edgeRouting: 'ORTHOGONAL'`。

### 方案 B：后处理 elk 输出（1-2 天）
elk 输出顶点坐标后，我们后处理：
- 遍历所有 link 的 vertices，把斜线段改成直角段
- 增加 cell 间距（在 elk 输出后平移）
- 手动修正明显的重叠

这比重写路由便宜得多。

### 方案 C：换布局引擎（3-5 天）
用 [dagre](https://github.com/dagrejs/dagre)（轻量、确定性、正交输出）替代 elkjs。dagre 专门画有向图，输出就是直角分层布局，天然适合电路图。

### 方案 D：接受现状（0 天）
当前 CSS 增强已经达到 80% 的 Quartus 视觉。连线凹陷/重叠是小问题，不影响功能。

---

## 六、结论

**重写渲染器内核 = 2.5 个月全职工程，且大概率做不出 Quartus 原生级别的布线质量。**

**建议路径**：
1. 先花 0.5 天试方案 A（elkjs `edgeRouting: ORTHOGONAL` 参数）——这是当前凹陷问题的最直接解
2. 如果 A 无效，花 1-2 天试方案 B（后处理 vertices）
3. 如果 B 也不行，花 3-5 天试方案 C（dagre）
4. **不要重写渲染器**——除非我们愿意投入 2.5 个月并且接受第一版体验降级

**重写的唯一合理理由**：产品方向从"Verilog 可视化工具"变成"Quartus 克隆"——那是产品级决策，不是技术债。
