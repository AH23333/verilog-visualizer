# 渲染组件样式定制可行性分析

> 日期：2026-10-01
> 前提：不重写渲染器内核，只改图元/连线的 CSS 和 joint attr

---

## 一、能改什么（边界）

### 1.1 完全可控（CSS / joint attr 层）

| 维度 | 当前状态 | 还能改到什么程度 |
|---|---|---|
| cell 圆角 | rx=0 直角 ✓ | 已到底 |
| cell 边框粗细 | 1px ✓ | 可调 0.5-2px |
| cell 背景色 | joint 默认 | 可按 celltype 分色（AND 灰、DFF 蓝、MUX 黄…） |
| cell 标签字体 | 9pt monospace ✓ | 可调字号/颜色/字重 |
| 端口圆点大小 | 3px ✓ | 可调 2-5px |
| 连线粗细 | 1.5px（bus 2.5px）✓ | 可调 |
| 连线颜色 | 0蓝/1红（digitaljs 默认） | 可改 Quartus 风格（0黑/1蓝/X灰/Z黄） |
| 连线线型 | 实线 ✓ | 可加 dash-dot 表示总线 |
| 网格背景 | 20px 点阵 ✓ | 可改网格大小/颜色/线型 |
| hover 高亮 | CSS drop-shadow ✓ | 可调 |
| 选中高亮 | — | 可加 |

### 1.2 部分可控（digitaljs cell 类型限制）

| 项 | 现状 | 限制 |
|---|---|---|
| cell 图标形状 | AND=D 形、OR=尖弧、XOR=双线 | digitaljs cell 类型固定，不能改成 Quartus 的矩形+文字标签 |
| DFF 形状 | 矩形+三角时钟 | 已接近 Quartus |
| MUX/DEMUX | 梯形 | Quartus 是矩形+sel 标签 |
| Button/Clock/Lamp | 自定义符号 | digitaljs 固定 |

**关键限制**：digitaljs 的 cell SVG 是它自己画的（`src/cells.js`），我们只能通过 CSS 调样式，不能改 cell 的几何形状。要 AND 门从 D 形变成 Quartus 的矩形框，必须改 digitaljs 源码——那已经是"半重写"了。

---

## 二、不能靠改样式解决的问题

| 问题 | 根因 | 改样式能解决吗 |
|---|---|---|
| 连线重叠 | elkjs 布局算法 | ❌ 必须改布局/路由 |
| 连线内折凹陷 | manhattan router padding 太小 | 🟡 可调 padding，但不根治 |
| cell 位置不合理 | elkjs layered 算法 | ❌ 必须调 elk 参数 |
| 端口对不齐 | yosys2digitaljs 端口位置 | ❌ 数据层问题 |
| 总线分叉不明显 | 渲染层无总线符号 | 🟡 可加 CSS 但定位不准 |

---

## 三、还能做的样式增强（按性价比排序）

### P0：连线颜色 Quartus 化（0.5 天）
当前 digitaljs 默认：0=蓝、1=红。Quartus 是：0=黑/暗、1=蓝、X=灰、Z=黄。
- 改 CSS：`.joint-paper .connection[stroke="#0000ff"]` → 深蓝色
- 或在 Canvas 轮询信号值时按值改 stroke 颜色

### P1：cell 按类型分色（1 天）
Quartus 的 cell 有语义色：
- 组合逻辑门（AND/OR/XOR）：白底黑边
- DFF/寄存器：浅蓝底
- MUX/DEMUX：浅黄底
- 输入/输出：灰底
- 总线：加粗边框

实现：CSS 按 `[model-type]` 选择器分组上色。

### P2：连线 dash 区分总线（0.5 天）
多 bit 总线用 `stroke-dasharray: 4 2` 点划线，1-bit 用实线。Quartus 风格。

### P3：hover 时整条 net 高亮（1 天）
hover cell/wire 时，把同一 net 的所有连线和相关 cell 一起高亮（亮边+发光）。当前只有 cell 本身高亮。

### P4：Quartus 风格标题栏/状态栏（0.5 天）
电路区左上角加 "module_name" 标题，右下角加缩放比例显示。

---

## 四、结论

**改样式能把视觉做到 Quartus 风格的 85%**：
- ✅ 网格背景、直角、方框图元、等宽字体、总线粗线——已完成
- 🟡 cell 分色、连线颜色 Quartus 化、dash 总线——1-2 天可做
- ❌ AND 门从 D 形变矩形框——必须改 digitaljs cell 源码（半重写）
- ❌ 连线重叠/凹陷——必须改布局/路由算法（与样式无关）

**建议**：先做 P0-P2（2 天），把视觉打磨到 90%。连线重叠问题单独走 elkjs 参数调优路线，不要试图靠 CSS 解决。
