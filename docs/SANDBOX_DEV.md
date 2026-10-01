# Sandbox Mode — 功能开发文档

> 状态：P0 已落地，P1/P2 规划中
> 入口：左侧 ActivityBar 立方体图标（Box）
> 设计目标：独立于 "Verilog 编译→电路图" 主流程的
>
> **自由逻辑设计沙盒**
>
> ，用户可在独立文件系统中放置门 / IO、连线、实时仿真、保存为 
>
> `.djs`
>
>  文件。



***

## 1. 架构概览



```
App.tsx (主壳)
├── ViewMode = 'sandbox' 时渲染 <SandboxCanvas>
├── ActivityBar 四按钮单选互斥：Files / Modules / Hierarchy / Sandbox
└── 保留 MenuBar + ActivityBar（可切回主模式）

SandboxCanvas.tsx
├── 左侧 180px 面板：FILES 列表 + GATES/IO 元件库 + Save 按钮
└── 右侧画布：<div data-sandbox-wrapper> 承载 jointjs paper
    └── digitaljs.Circuit → displayOn(wrapper) → jointjs.dia.Paper

sandboxStore.ts (localStorage)
├── key: verilog-viz-sandbox-files  — 文件列表 [{id, name, graphJson, updatedAt}]
├── key: verilog-viz-sandbox-active — 当前激活文件 id
└── CRUD: create / list / get / save / remove / setActiveId / getActiveId
```



***

## 2. 已实现功能（P0）



| 功能     | 说明                                                                             |
| ------ | ------------------------------------------------------------------------------ |
| 独立模式入口 | ActivityBar 立方体图标，与主模式互斥切换                                                     |
| 文件系统   | localStorage CRUD，自动命名 `circuit_N.djs`                                         |
| 元件库    | 7 种门（And/Or/Not/Xor/Nand/Nor/Xnor）+ 3 种 IO（Button/Clock/Lamp） |
| 放置元件   | 点击左侧按钮，在画布 (100+jitter, 100+jitter) 处生成 cell                                   |
| 拖动元件   | 手动 mousemove 改 `<g transform>`（绕过 digitaljs 的 pointerdown 拦截），onUp 同步 model 位置 |
| 保存     | `paper.model.toJSON()` → localStorage                                          |
| 加载     | 逐 cell `new digitaljs.cells[type]` + `addCell`（不裸调 fromJSON，保证 view/model 同步） |
| 删除文件   | 两步确认（点 × → 变 ? → 再点确认），不触发 window.confirm                              |
| 深色模式   | wrapper 背景跟随 `var(--surface)`                                                  |



***

## 3. 技术要点

### 3.1 为什么不用 jointjs 内置 drag？

digitaljs 的 gate cell view **重写了 pointerdown**，默认行为是启动 "从 port 连线" 而不是 "拖动 cell"。

设 `paper.options.interactive = true` 会触发 jointjs 内置 drag，但与 digitaljs 的连线逻辑冲突 ——pointerdown 触发后 cell 不动。

**解决方案**：



```
paper.options.interactive = false;  // 禁用 jointjs 自动处理
// 手动监听 cell:pointerdown，document mousemove 直接改 <g transform>
```

### 3.2 为什么用 `document.querySelector('[data-sandbox-wrapper]')` 而不是 ref？

React 18 + conditional rendering 会导致 **ref 指向已卸载的 detached DOM 节点**。

当 `activeFile` 从 null → 有值时，overlay 条件渲染触发 DOM diff，wrapper 被卸载重建，但 ref 还指向旧节点。

**解决方案**：useEffect 里直接 `document.querySelector` 拿最新 wrapper。

### 3.3 为什么 wrapper 要 `position: absolute`？

block div + `width:100%` 在 digitaljs `displayOn` 后会被 shrink-to-fit（paper 初始 166×92）。

absolute 定位让 wrapper 始终占满父容器，不被子元素尺寸影响。

### 3.4 cell 构造参数



```
new digitaljs.cells[type]({
  type: type,
  position: { x: cx, y: cy },
  bits: 1,
  size: { width: 60, height: 32 },
})
```

不能只传 `{ bits: 1 }` 再 `setLayoutPosition()`—— 后者不生效。



***

## 4. 踩过的坑（按时间顺序）



| #  | 坑                                                | 现象                                      | 修复                                                     |
| -- | ------------------------------------------------ | --------------------------------------- | ------------------------------------------------------ |
| 1  | `window.prompt()` 在 Tauri WebView 不弹框            | 点 + 没反应                                 | 自动命名 `circuit_N.djs`                                   |
| 2  | useEffect 在 activeFile=null 时建 paper             | activeFile 变化后 paper 挂到 detached 节点     | `if (!activeFile) return`                              |
| 3  | `cellView.model.isLink` 是函数不是布尔                  | `if (isLink) return` 永远 truthy，drag 不启动 | `if (typeof isLink === 'function' && isLink())`        |
| 4  | `paper.interaction()` 不是 jointjs API             | TypeError                               | 删掉                                                     |
| 5  | `paper.scale()/translate()` 返回 NaN               | cell 加到 (NaN,NaN)                       | 固定坐标 (100+jitter, 100+jitter)                          |
| 6  | wrapper 被 shrink-to-fit 到 166×92                 | paper 只有左上角一小块可见                        | `position:absolute` + resize 用 parent 尺寸               |
| 7  | `el.setAttributes('transform')` 被 jointjs 渲染循环覆盖 | drag 时 cell 弹回原位                        | 只在 mousemove 里改 DOM，mouseup 时才 `model.set('position')` |
| 8  | forwardRef 间接调用 addCell 不工作                      | 按钮点了没反应                                 | 改普通函数组件 + 本地 useCallback                               |
| 9  | `paper.options.interactive = true` 导致 drag 冲突    | pointerdown 触发但 cell 不动                 | 设 `false` + 手动 mousemove                               |
| 10 | digitaljs 自动 fit-to-content 缩放                   | cell 在画布极小区域                            | `paper.scale(1); paper.translate(0,0)`                 |



***

## 5. 当前已知限制



1. **连线未实现**：port 拖线功能因 `interactive=false` 被禁用，需要后续手动实现 link 创建

2. **无网格背景**：画布纯黑，没有网格

3. **无仿真控制**：没有 step/run/reset 按钮

4. **无删除 cell**：只能删除文件，不能删单个 cell

5. **无缩放 / 平移**：paper 固定 1:1，不能滚轮缩放

6. **保存后 cell 位置丢失**：mouseup 时 `model.set('position')` 可能未被 view 同步（DOM transform 改了但 model 没存对）



***

## 6. P1 规划（自定义门 + 导入）



| 功能      | 说明                                     |
| ------- | -------------------------------------- |
| 自定义门定义  | 用户在文件中绘制子电路，保存为 `.djs` 后可作为新 cell 类型导入 |
| 元件库导入   | 左侧面板新增 "USER" 分类，列出用户自定义门              |
| 连线功能    | 从 port 拖线到另一个门的 port，创建 link           |
| 删除 cell | 选中 cell 后按 Delete 键删除                  |

## 7. P2 规划（高级）



| 功能         | 说明                                    |
| ---------- | ------------------------------------- |
| 总线 / 位宽参数化 | cell 支持 bits>1，连线变粗                   |
| 仿真控制       | step/run/reset 按钮，与主电路 SynchEngine 对接 |
| 网格背景       | SVG pattern 画 20px 网格                 |
| 滚轮缩放 / 平移  | Ctrl + 滚轮缩放，右键拖拽平移                    |
| 导出图片       | 电路导出 PNG/SVG                          |