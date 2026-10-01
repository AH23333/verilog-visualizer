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
| Quartus 风格渲染 | cell body 浅灰 #f4f4f5、文字始终黑色 #18181b |
| InputPanel 自研 | 集中信号输入面板，替代原生 IO 按钮 |
| wire 值标签 | 常亮显示信号值（0/1/x/z） |
| 编译进度反馈 | 状态栏显示 yosys 编译进度 |
| auto-save | 代码编辑自动保存 + mtime 比对 |
| Problems 页签 | 编译错误跳行 |
| 命令面板 | Ctrl+Shift+P |
| Onboarding 首启引导 | 首次打开弹窗引导 |
