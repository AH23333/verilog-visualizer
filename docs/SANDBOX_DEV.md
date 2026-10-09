# Sandbox Mode — 功能开发文档

> 入口：左侧 ActivityBar 的「沙盒」（`button[data-activity="sandbox"]`）。
> 定位：独立于「Verilog 编译 → 电路图」主流程的**自由逻辑设计沙盒**，
> 文件存在浏览器 localStorage 里（`.djs`），与编译模式的 `.v` 工程互不干扰，
> 但可以双向走动（「复制到沙盒」把编译结果连参数一起搬进来）。
>
> ⚠ 这份文档曾经停在 P0（"连线未实现 / 无缩放 / 7 种门"）好几十轮，读之前先看这一行：
> **下面第 1～5 节是今天的实现，第 6～7 节才是 P0 时期的历史**（保留下来是因为那几条
> jointjs/digitaljs 的坑今天仍然咬人）。

---

## 1. 今天的样子（架构）

```
App.tsx（主壳）
├── ViewMode = 'circuit' | 'code' | 'split' | 'sandbox'
└── ActivityBar：Files / Modules（元件库）/ Sandbox / 主题 …（`data-activity` 是验收锚点）

SandboxCanvas.tsx（沙盒一屏）
├── 左侧栏（活动栏换面板，不是一次性三列表）
│   ├── 文件面板：<SandboxFileTree>（文件夹 + `.djs`，右键＝IDE 那套文件系统菜单）
│   ├── 元件面板：分组元件库（见 §3.1），部件单独一栏「放置部件 X」
│   └── 沙盒面板：保存 / 保存为自定义门 / **部件绑定**（开总览弹窗）/ 设置 / 运行·暂停 / SPEED 滑条 / 撤销重做
└── 右侧画布：<div data-sandbox-wrapper> 承载 jointjs paper（digitaljs.Circuit.displayOn）

src/lib/*（沙盒与编译模式共用的唯一出处）
├── gateSystem.ts    部件解析：resolvePartRef / resolveDefCells / savePartFile /
│                    stripBoundInlineJson / ensureDefsFromCells / carry 一族
├── deviceParams.ts  器件参数清单：构造期参数必须在「编译 JSON ↔ 存档 ↔ 模型」三处对称往返
├── subcircuitView.ts 展开图渲染（沙盒放大镜与编译模式钻取同一份实现）
├── simClock.ts      仿真节拍（两种模式同一 5–200 ms 量纲）
└── verilog.ts / sandboxLoad.ts 「复制到沙盒」的入站管线
```

存档键（localStorage）：`verilog-viz-sandbox-files`（文件表）、`verilog-viz-sandbox-active`
（当前文件 id）、`verilog-viz-sandbox-folders`（单独跟踪的文件夹）、
`verilog-viz-sandbox-gates`（旧版门存档，R37 起只作迁移源，只读）。
**文件夹的唯一真相是文件名里的 `/`**（`dirOf`），`SandboxFile` 没有维护 `folder` 字段。

---

## 2. 部件（自定义门）与绑定系统

这是沙盒与"贴图工具"的分水岭：部件**真身就是一张可编辑的 `.djs` 画布文件**（`role:'part'`），
不是一段内嵌 JSON 快照。

| 事项 | 实现 |
|---|---|
| 存部件 | 沙盒面板「保存为自定义门」→ `saveGateFromCellsToFolder(name, cells, scope)`：落在**当前文件所在文件夹**，画布上已放置的绑定式子部件递归入库并按名绑定 |
| 放部件 | 元件面板「自定义部件」栏逐行 `button[title^="放置部件"]`，放在视口中心 |
| 解析优先级 | `resolvePartRef(name, scope)` 打分升序：scope 内 `role:'part'` → scope 内任意 `.djs` → 根 `role:'part'` → …（`gateSystem.ts:46`）。**同名部件分散在多个文件夹时，行为只由这个打分决定** |
| 内嵌快照 | 存档里可以带 `subcircuitGraph`（内嵌定义）当兜底；`stripBoundInlineJson` 只在**部件文件确实存在**时才把它抹掉，避免"删了文件连带定义也没了" |
| 跨文件夹搬家 | 拖拽移动与「剪切→粘贴到文件夹」两条臂都会 `carryPartDefsAfterMove`：解析被移动文件里的实例，缺的部件定义**就地补到目标文件夹**，提示条尾巴塞一句「，随行补齐 N 个部件定义」（用户裁决 R-B） |
| 删部件 | 删的就是那个文件；画布上已放置的同名实例变成"挂着名字但没有定义" ⇒ 展开/仿真不可用，但内嵌快照仍能兜底显示 |

### 2.1 部件绑定总览（用户裁决 R-A：「要添加入口」）

换绑原本只能一颗一颗实例地操作，而他要看的是一句话：**"这张图里谁绑到哪儿了、哪个已经失效"**。
所以入口是一棵表，不是再多几颗右键项（左侧栏「设置」下方的 `button[data-sandbox-bindings]`）。

弹窗 `BindingDialog`（住在 `SandboxCanvas.tsx` 内，**与编译模式的 `components/BindingDialog.tsx`
是两回事**——后者是 Verilog 模块 ↔ 文件的绑定）每行＝画布上一颗子电路实例：

| 列 | 内容 |
|---|---|
| 实例 | 标签 + 「定位」（选中并居中那颗；不缓存坐标） |
| 状态 | `未绑定`（没名字）/ `绑定失效`（有名字但按作用域解析不到定义）/ `已绑定`；库里同名部件不止一颗时追加 `⟡` |
| 绑定到 | 实例的 `celltype`（＝部件名） |
| 实际解析 | `resolvePartRef` **按打分实际选中**的那一颗所在文件夹（`根目录` / `sub/`）——同名遮蔽时这是唯一能解释"为什么展开的是这一份"的字段 |
| 换绑 | 下拉选另一颗 ⇒ `rebindSubcircuitCell`：重建实例（端口表按新定义重算），已接连线按端口 id 接回，接不上的按条数报出 |

要点：换绑必须**重建**而不是就地 `set`——digitaljs 的 `Subcircuit.initialize` 只在构造期按内图
的 Input/Output 生成端口表。所以这棵树里没有第二套绑定逻辑，也就没有"弹窗算一套、真解析另一套"
的飘掉空间；「重新扫描」与打开弹窗都是现扫画布，不留旧快照。遮罩是 `inset:0`，Esc 必须关得掉
（依赖表写 `[]` + ref，理由见源码注释）。

---

## 3. 元件库与器件参数

### 3.1 分组（`PALETTE`）

逻辑门（含缓冲器/反相器带）、输入 / 输出（Clock、Lamp、Input、Output、Constant、各类 Source）、
时序（Dff、`寄存器 EN/RST` 变体、状态机 FSM）、运算、比较、选择 / 移位（含 **MuxSparse 稀疏选择器**、
**Repeater 缓冲器**）、总线（零/符号扩展、合线器 / 分线器 / 总线切片、六种归约）、
存储（Memory）、显示（七段数码管、数值显示 / 输入）。

位宽敏感器件的名字旁会标当前位宽（`bitsSuffix`）；「按钮」已从库里撤下（功能与「输入引脚」重叠，
但 `IO_TYPES` 仍认识它，历史存档要继续能渲染）。

### 3.2 右键＝按器件给参数（不是一个大表单）

选中一颗再右键，菜单按类型长出来（`SandboxCanvas.tsx` ~1300–1600）：

- 通用：标签、旋转 90°（Ctrl+R / Shift+Ctrl+R；**多选＝绕选区包围盒中心整体旋转**（R99）——
  ⚠ R100 实测推翻了 R99 的实现注记：joint `rotate(angle, absolute, origin)` 的 origin 分支
  对**已带角度**的元素轨道量退化（源码 `center.rotate(origin, this.get('angle') - angle)`，
  angle=90 时轨道量＝0 变原地自旋）⇒ R100 改手工轨道：先算各件中心绕包围盒中心公转的新位置、
  再 `c.rotate(deg)` 自旋、再 `position(新中心 - 半宽高)`，
  变异锚点在 `tests/r99-mutate.cjs` MA）、
  **水平 / 垂直镜像**（R99；R100 重写为**模型级**）——`mirror` 状态存 cell 属性随存档走，落地在
  `cellMirror.ts` 单一主人。R100 版翻三层：①端口锚点（函数/命名布局求值后按轴取反 x 或 w-x，
  digitaljs 标准门的端口是**命名布局对象** `{name:'left',args:{...}}` 而非函数，R99 只包函数路径
  对它们静默跳过＝"滑稽"的根因）；②端口 attrs 数值路径取反（`wire/x1`、`port/refX`…）；③body
  前置居中镜像组合 transform。另在视图层把 body 子树文本反翻（joint DOM 的 selector 节点标
  `joint-selector` 属性，**不是** `data-selector`）。⚠ root 级 CSS 会覆盖 joint 的 translate/rotate
  让门跳到画布原点、portProp 会压过 group 堆叠位置——两条路都探针实证堵死，别再试；
  多选＝每颗**原地**翻（镜像没有公共轴心语义）、复制粘贴、删除、对齐、时钟周期 / 传播延迟
- 门族：**输入引脚数 2–16**（扇入可编辑，`inputs` 是构造期参数）
- IO / 端口：引脚名、位宽、初始值（0/1/x）、常量值（二进制）
- 多路选择：**数据位宽 / 选择位宽**；MuxSparse 另有**分支取值表**
- 扩展：输入位宽 / 输出位宽
- 总线：合线器·分线器放下即弹**位宽方案**对话框（N 位 ↔ 若干组 1/2/4/8 位，`[data-bus-width-dialog]`），
  也可填**分组配置**（`4` 或 `2,2,4`）；总线切片的**切片配置**用「起始位:结束位」**含两端**
  （`0:3` = 取 0-3 位共 4 位、`1:1` = 只取第 1 位；降幂 `3:0` 等价，兼容 Verilog 记法；
  内部仍是 digitaljs 的 `{first, count, total}`，2026-10-10 用户定案由旧「起始:位数」改为此记法）
  ＋**总线总位宽**（收缩时 first/count 联动钳制，防切片越界）
- 存储：**端口配置…**（`MemPortsModal`）、查看 / 编辑内存、内存清零、内存全部置 1
- 时序：**端口与极性…**（`DffPortsModal`）—— digitaljs 的 Dff 有 7 个控制脚（clock/enable/arst/srst/set/clr/aload）
  ＋ enable_srst / no_data / arst_value / srst_value，这里一颗窗全改完；三条只读上游源码才看得见的形状：
  ①端口按 `polarity` **键在不在**生成（"取消这一脚"必须删键，留 `键: undefined` 等于还在）；
  ②低有效必须写 `false`（引擎 `0`/`false` 都认，但 base.mjs:139 要 `=== false` 才画横线 ⇒ 写 0 的低有效脚看不出来）；
  ③set/clr 是**与数据同宽**的端口。⚠ 刚勾上的脚默认**高有效**（下拉里留着上次算出的 `!!undefined===false`
  等于"勾一个静默低有效的复位脚"，r94 首跑真踩过）
- 运算／比较／移位：位宽；**有符号**（R95）——右键「操作数 A／B 有符号」（移位多一颗「输出 有符号」），
  √ 前缀反映打开那一刻的现态，点击经重建生效。⚠ 三条只读上游源码才看得见的规则：
  ①二元运算与比较器按 `sgn.in1 && sgn.in2` 解释——**两脚全开才按有符号算**（arith.mjs:95/186，
  与 Verilog"有一边无符号则整式无符号"的晋升规则一致），只开一脚电平无观感差（toast 会提示）；
  ②取负/一元加是**布尔**形状（UnaryPlus 错给成对象会因恒真被读成有符号）；
  ③移位逐脚独立（shiftHelp 的进位扩展看 in1、移位量正负看 in2、out 只有 $sshl/$sshr 参与）；
  ④**移出空隙补 x**（fillx，R96）——`Vector3vl.make` 的初值语义（dist/index.js:197-221）：
  `0`＝补 x、`-1`＝补 0、`signbit`＝补符号；$shiftx 那一族（右移出界/负移量左移出界）靠它把
  结果变 x 而不是错的 0（电学对：1000 右移 3 位，关＝0001、开＝xxx1）
- 状态机：**转移表…**（`FsmTableModal`，改完重建状态图圈与弧线）
- 子电路：查看内部电路（双击）、**绑定...**（R99 起右键直开 `RebindDialog.tsx` 对话框，
  与编译模式 BindingDialog 同款形状：列出作用域内全部部件文件、点行即经
  `rebindSubcircuitCell` 真换绑并重建实例；取代旧的下拉式「换绑部件定义」）、
  保存为部件（可编辑电路）
  ⚠ R101：菜单项文案改为编译同款——「重命名」「新建文件」「新建文件夹」「删除文件夹」，
  点后弹窗；**改菜单文案必须同步 grep tests/**（r33/r34 都靠文案定位，本轮又踩）
- **文件系统照抄编译模式**（R101）：①顶部按钮组＝导入文件 / 新建文件 / 新建文件夹 /
  刷新 / 收起侧栏（与 `Sidebar.tsx` 同序同图标同 hover）；②**重命名 / 新建一律弹窗**
  （`PromptDialog`），菜单里不再内联输入、树里也不再行内新建（只保留 hover 铅笔的
  行内重命名，与编译 Sidebar 一致）；③**删除文件夹＝连同内部文件一起删**，删前弹
  `ConfirmDialog` 并写明"会一并删除其中的 N 个文件"（旧实现是"文件移回根目录"）；
  ④同名去重改成编译模式的 `name (1).djs` 格式（`sandboxStore.getUniqueName`，旧为 `_1`）。
  ⚠ `button[title="新建文件"]` 是 `tests/_ui.cjs#newSandboxFile` 的夹具锚点：点完就
  要有文件，所以顶部这颗**不走弹窗**（弹窗版在右键菜单里）。
- **输入 / 输出面板**（R101）：与编译模式共用 `components/IOPanel.tsx` —— 输入段列出
  全部 `Input/Button/Clock/NumEntry` 并可点击切换，输出段列出 `Lamp/Display7/NumDisplay`
  等且**只读**（值由电路算出，用户不能直接改）。200ms 轮询，沙盒用画布内浮层承载。
  编译侧 `Canvas.tsx` 新增 `listOutputs()`，`InputPanel` 改为 IOPanel 的薄封装。
- **侧栏底部按钮上移**（R101）：撤销 / 重做 / 旋转 / 保存 / 自定义门 / 导出 SVG /
  导出 Verilog / 部件绑定 / 设置 / 输入·输出 全部挪到画布上方一排按钮栏
  （`data-sandbox-topbar`），与右侧调试条同款令牌；title 与 `data-*` 锚点全部保留。
- **文件级绑定**（R100）：侧栏**文件**右键「绑定...」开 `SandboxFileBindingDialog.tsx`
  （样式与编译 BindingDialog 完全同款令牌），把绑定名 → 部件**文件 id** 写进
  `sandboxStore.partBindings`（随存档走）；`gateSystem` 的单例 `setActivePartBindings`
  在活动文件切换时注入，`resolvePartRef` 里**显式绑定最高优先**、命中即返回，
  之后才走作用域打分；`sandboxLoad.ts` 的 Subcircuit 加载因此先 `resolveDefCells(celltype, scope)`
  再退回内嵌图。层级：文件级绑定 ≻ 作用域打分。

位宽类改动会重算端口，所以走"就地重建"而不是 `set`。

### 3.3 参数往返（`deviceParams.ts`）

`CTOR_PARAM_KEYS` 是一份**清单**：polarity / initial / arst_value / srst_value / enable_srst /
no_data / constant / extend / groups / slice / abits / rdports / wrports / signed / fillx /
**mirror（R99：水平/垂直镜像，随存档走，载入后 `applyMirror` 重挂）** /
words / offset / **numbase（进制显示）** / states / init_state / trans_table / **inputs** /
**bits（r94 起：Dff/Mux 这一族把它列在 `_unsupportedPropChanges` 里，事后 `set` 被回滚，
现场读数＝4 位寄存器存盘重开变 1 位、`srst_value="0101"` 配着 1 位的 Q）** / angle …
它们要么被 digitaljs 列进 `_unsupportedPropChanges`（事后 `set` 会回滚），要么在 `initialize()`
里读走（丢了端口/盒体就按默认建）。历史上这三处各写一条 if 链、靠人手对齐，症状正是
"器件数与连线数都没变，仿真却和编译模式不一样"。`groups` 还额外被 `normalizeGroups` 统一成
digitaljs 原生的**位宽数组**（Map 形状会让高度变 NaN）。

---

## 4. 与编译模式对齐的几件事（他清单里的原话）

| 原话 | 落点 |
|---|---|
| 「连线走线设置应该是全局走线方式」+「改了要立刻变」 | `wireStyle` 一份设置（`metro/orthogonal/straight`），**两个模式的 paper 都读它**（`Canvas.tsx:193/594`、`SandboxCanvas.tsx:1813/1892`），设置面板改完当场重贴 |
| 「滚轮缩放部件放大镜展开图会丢失电路图画面，应该是缩放中心不对」 | 缩放以光标为锚点（`paper.scale(k)` 后补平移），与展开图同一份实现；主画布另有一处 `render:done` 自动适应窗口抹掉锚点的问题，用 `userViewRef` 认领画面解决。**R100 定版滚轮语义**（用户裁决"交互逻辑错误"后改）：普通滚轮＝上下平移、Shift+滚轮＝左右平移、**只有 Ctrl+滚轮＝以光标为锚缩放**（`subcircuitView.ts` 一处 switch；`r57` [2] 随之改发 Ctrl 滚轮、[2b] 正向钉平移语义） |
| 「部件放大镜展开图与部件编译渲染图不一致（放置位置）」 | 展开图管线只有一份（`subcircuitView.ts`），位置从存档现取不缓存 |
| 「复制编译后的电路图位置极其混乱」 | 「复制到沙盒」按模块逐颗摆位并带上构造期参数（`sandboxLoad.ts`） |
| 「深色主题下所有部件/线路命名仍然为黑色」 | 文字颜色跟随主题变量，不再写死 `#18181b` |
| 「波形调试要和编译模式一样可调速」 | 沙盒面板 SPEED 滑条（5–200 ms，右滑更快）＋ `simClock.ts` 重起表；上游 `setInterval` 只在 `start()` 读一次 `_interval_ms`，所以只写 `circuit.interval` 不改档＝假滑条 |
| 「右键菜单栏以及侧边栏统一为编译模式的样式」 | 裁决为**只做增量**：不搬现有面板，新增入口（部件绑定总览即由此而来）。R99/R100 逐步落齐：菜单去标题头、lucide 图标＋同款 hover、状态圆点、文件/文件夹/根菜单同观感；R100 给文件右键加「绑定...」（文件级绑定），调试工具条迁到画布右上、令牌与编译 TabBar rightSlot 同款（surface 胶囊＋lucide＋速度滑条 5–200） |

---

## 5. 验收闸门（改沙盒前先跑对应的这几颗）

跑批：`node tests/run-all.cjs`（三态判定：绿 / 红 / 未验证，环境红单独归类）。
本文件描述的东西各自的闸门：

- `r81-line-gate` — 错误行号结构化（`ValidationError.line`）
- `r82-move-def-gate` — 跨文件夹移动随行补齐部件定义（拖拽臂 + 剪切粘贴臂）
- `r83-errorcopy-gate` — 门级网表拒编译：屏幕上那句话与结构化读数同源；[6]/[7]/[7b] 是状态栏反馈语的**句式**判据
  （反向探针 `r83-mutate.cjs`：把一句改回英文 ⇒ 那三格同时红、其余绿）
- `r84-binding-gate` — 部件绑定总览五格（入口 / 行数对账 / 状态列说实话 / 换绑真生效 / 实际解析列＝`resolvePartRef` 现算），
  反向探针 `r84-mutate.cjs`（5 颗变异各只红该红的一臂；`--check` 只验锚点、`--only M4` 只跑指定变异）
- `r85-posfidelity-gate` — 位置保真**逐 id 对账**：A 编译画布 vs B 复制后顶层、C elk 展开图 vs D dagre 部件文件画布，
  判据是"消掉共同原点差后 ≤1 px"（整体平移不算缺陷），反向探针 `r85-mutate.cjs`
- `r86-msg-inventory.cjs` — 静态清单（不起浏览器）：`setMessage` 实参里还有几句整句英文；自带"三元的两个分支各算一条"的自证
- **进程卫生（R96 起）**：每颗会 spawn vite 的闸门都注入了
  `try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(PORT)); } catch { }` ——
  `server.kill()` 只杀得到 shell 包装、node 孙进程会一直监听（R95 全量现场清出 6 颗遗留）。
  收尸实现唯一主人在 `_ui.cjs`（run-all 每格收尾也走它）；新闸门照抄这一行。
- `r90-single-owner-gate` — 「取所在文件夹」只有一个主人（两种拼法各扫一遍 + 反向臂不许删消费者），反向探针 `r90-mutate.cjs`（MA/MB 甲乙各咬、MC 主人掏空、MD 入口不转发，四颗全咬住）
- `r91-palette-coverage-gate` — **元件库 ⊇ yosys2digitaljs 映射表的目标类**：两边都从现场算（A＝依赖源码里 `gate_subst` 的值侧，B＝`SandboxCanvas` 那批 `*_TYPES` ∪ `P('X')`），差集必须为空；
  依赖读不到／锚点飘了／数量低于下界一律 **UNVERIFIED**，⛔ 不许把"没扫到"读成"没差集"。反向探针 `r91-mutate.cjs`（MA 摘掉那颗＝两臂同红、MB 只拆展开＝只有点名臂红、MC 改表名＝落未验）。
  现场读数：A 48 种、B 补 `UnaryPlus` 之前 49 种且差集恰好一颗（`$pos`，`assign y = +a;`）⇒ 已补进 `ARITH_TYPES`；
  B 比 A 多的 `Display7`/`MuxSparse` 是沙盒自备；`Button` 在 `IO_TYPES` 里继续能渲染但刻意不在元件库（与「输入引脚」功能重叠，理由写在源码注释）。
  ⚠ 补完做过**成对**真机核对（Clock→Lamp 对照 vs Clock→UnaryPlus→Lamp）：两相的灯都跟着时钟变色 ⇒ 信号能穿过那颗；
  ⛔ 这只证到"穿过"，`+a` 的恒等语义没单独验。
- `r92-routing-gate` — **走线方式是全局一份**（[1] 沙盒改档当场重排、[2] 切回编译模式同一份档、[3] 三档形状互异且可逆、[4] 两个画布都只读 `settingsStore` 那份 `wireStyle` 的静态臂），
  反向探针 `r92-mutate.cjs`（MA 摘编译画布两处 applyWireStyle＝只有 [2] 红；MB 依赖表去掉 wireStyle＝[1][3] 红、[2] 绿）
- `r94-dff-polarity-gate` — **寄存器端口／极性编辑窗**（[1][1b] 入口与两次回显、[2] 端口按勾选长出且没勾的键真删、[3] 低有效＝写 `false`＋横线、翻面两者一起没、
  [4] **同一对接线只翻极性 ⇒ Q 两次读数整体反过来**（电学证人，读不到 x 一律落未验）、[5] 重建不搬家、[6] 菜单改位宽不抹掉弹窗配的参数（重建先并 `ctorParams`）、
  [7] 存盘重开整套回来（含 bits）、[8][9] 静态句式臂）。
  反向探针 `r94-mutate.cjs` 七格：MA 回显失效（[1][1b] 红、翻不了面的格子落未验——闸门对"翻不了面"按三态处理，不许 FATAL）、
  MB/MG 留键 undefined 两种措辞（[2][3][6][7] 红 + [4] 未验：未连的 set/clr 脚把 x 串进 Q）、
  MC 数值极性（[3][7][8] 红、**[4] 必须绿**＝字形与语义两条臂各有射程）、MD 重建不接线（[5] 红、[4] 未验）、
  ME 重建不做 merge（[6][7] 红）、MF 名单去掉 bits（[7][9] 红）
- `r60` 部件绑定、`r61` 深色文字（配对）、`r62` 可调速（数 `postUpdateGates` 而非信号翻转）
- 夹具约定见 `tests/_ui.cjs`：`boot` 不用 `networkidle`（37 个脚本 + HMR WebSocket 永远不空闲）、
  落点一律现取坐标、位宽对话框会拦住后续点击（Esc 关）、`isLink` 是**方法**不是布尔。
  ⚠ 三条本轮新增：**`loadCells` 只有一份、四条调用路共用**，但按 `type === 'Input'` 过滤的变异只砍得动部件文件那一侧
  ——真因是**类型名不同**（顶层快照过了 `io_ui` 之后 IO 早已是 Button/Lamp/NumDisplay，部件文件在落盘前才映射回
  Input/Output）⇒ 别把这条读成"顶层不走 loadCells"；
  **「放置部件 X」只在沙盒/元件面板的 DOM 里**，切到「文件」栏后那颗按钮不存在 ⇒ 多步夹具换栏后要重新拿面板。
  ⚠ 两条 R90 新增：**放大镜 `a.zoom` 只能用 `UI.clickZoomInto`**（等坐标连着两次不变 ⇒ 现量现点 ⇒ 验目标出现），
  ⛔ 不许改成 `locator.click()` —— 放大镜住在 joint 工具层里、computed `visibility:hidden`，Playwright 的动作性
  检查对它**永远**判 `element is not visible`（实测 4/4 超时，而同一个坐标用真鼠标一点就起窗）；缓存 rect 再点则是
  另一种点空：`render:done` 之后画布还要适应窗口一次，量到的是 _fit 前的位置（r40 [4] 就因此同一颗夹具两次两种脸）。
  ⚠ **「取所在文件夹」全仓只有一个主人 `src/lib/vpath.ts` 的 `parentDir`**（沙盒侧的 `dirOfName`/`dirOf` 是它的别名），
  两种历史拼法（`slice(0, lastIndexOf('/'))` 与 `split('/').slice(0,-1).join('/')`）都由 `r90-single-owner-gate` 拦，
  只认一种会被"换个词"绕过（初版就漏掉了 fileStore/Sidebar 那 6 处）；反向探针 `r90-mutate.cjs`（甲/乙各咬一次）。
  ⚠ 变异台架每跑之前要冷却几秒，连跑会在第一颗点击上超时；没跑完（FATAL）要单独归类，不许读成"这一格没红"。
  ⚠ 改 `tests/_ui.cjs` 之后要 `node --check` 一遍再跑闸门：它是所有 UI 闸门的公共底座，一处语法错 = 整族全红，
  而那种红看起来像产品坏了（本轮就自己踩过：`const opened` 声明了两次）。

---

## 6. 附录：P0 时期的技术要点（仍是读代码的地图）

### 6.1 为什么不用 jointjs 内置 drag？

digitaljs 的 gate cell view **重写了 pointerdown**，默认行为是"从 port 连线"而不是"拖动 cell"。
设 `paper.options.interactive = true` 会触发 jointjs 内置 drag，但与 digitaljs 的连线逻辑冲突
——pointerdown 触发后 cell 不动。解决：`interactive = false` + 手动监听 `cell:pointerdown`，
mousemove 期间只改 `<g transform>`，mouseup 才 `model.set('position')`（否则会被渲染循环覆盖）。

### 6.2 为什么 wrapper 用 `document.querySelector('[data-sandbox-wrapper]')` 而不是 ref？

条件渲染会让 ref 指向**已卸载的 detached DOM 节点**：`activeFile` 从 null → 有值时 wrapper 被
卸载重建。今天仍成立（画布换文件＝重建 paper）。

### 6.3 wrapper 为什么要 `position: absolute`？

block div + `width:100%` 在 `displayOn` 后会被 shrink-to-fit（paper 初始 166×92）。
配套 CSS：`[data-sandbox-wrapper] .joint-paper, svg { width:100% !important; height:100% !important }`。

### 6.4 cell 构造参数

```
new digitaljs.cells[type]({ type, position: {x,y}, bits: 1, size: {width:60,height:32} })
```
不能只传 `{bits:1}` 再 `setLayoutPosition()`——后者不生效。构造期参数丢了就是 §3.3 那一族。

---

## 7. 附录：P0 踩坑表（原文保留）

| # | 坑 | 现象 | 修复 |
|---|---|---|---|
| 1 | `window.prompt()` 在 Tauri WebView 不弹框 | 点 + 没反应 | 自动命名 |
| 2 | useEffect 在 activeFile=null 时建 paper | paper 挂到 detached 节点 | `if (!activeFile) return` |
| 3 | `cellView.model.isLink` 是函数不是布尔 | `if (isLink) return` 永远 truthy，drag 不启动 | `if (typeof isLink === 'function' && isLink())` |
| 4 | `paper.interaction()` 不是 jointjs API | TypeError | 删掉 |
| 5 | `paper.scale()/translate()` 返回 NaN | cell 加到 (NaN,NaN) | 固定坐标 |
| 6 | wrapper 被 shrink-to-fit 到 166×92 | paper 只有左上角一小块可见 | `position:absolute` + 用 parent 尺寸 |
| 7 | `el.setAttributes('transform')` 被渲染循环覆盖 | drag 时 cell 弹回原位 | 只在 mousemove 改 DOM，up 时才 set position |
| 8 | forwardRef 间接调用 addCell 不工作 | 按钮点了没反应 | 普通函数组件 + useCallback |
| 9 | `paper.options.interactive = true` 导致 drag 冲突 | pointerdown 触发但 cell 不动 | 设 `false` + 手动 mousemove |
| 10 | digitaljs 自动 fit-to-content 缩放 | cell 在画布极小区域 | `paper.scale(1); paper.translate(0,0)` |
| 11 | wrapper 尺寸链断裂（`.joint-paper` 不继承父宽） | paper 偏右 / 留白 | CSS `!important` 兜住宽高 |

> 表里 #3 这一族**今天还会再咬一次**：闸门里 `filter(c => !c.isLink)` 会把**所有** cell 过滤掉
> （方法是 truthy），于是"画布上有 0 颗"这种假读数一路绿到判定里（r82 实测）。

### 状态机（FSM）在沙盒里怎么才动得起来（2026-10-06 实测，`r53` [6] 的成因）

FSM 器件有四个端口 `in / clk / arst / out`。**`arst` 悬空时机器不跑**：现场读数是
`engineRunning=true`、`circuitRunning=true`、`tick=791~799`、`transitions=2`、`out` 也有值，
但 `current_state` 全程停在 `init_state`。把 `arst` 接上一颗**没按下的 Input**（引擎读到 `arst=Vector3vl 0`）
之后，状态就按转移表推进：实测采样 `[["1","x"],["0","1"],["1","x"],["0","1"]…]`（`out` 跟着 `ctrl_out` 变），
`unconnectedIn` 从 1 变 0。⇒ 这是 digitaljs 的 x 语义（异步复位读 x 就不许动），**不是本仓的缺陷**，
但用户那边的症状是"状态机放着不动、又没有任何话说明原因"。
所以 `r53` 的 [6] 从此必须把四口都接上确定来源（那一格已连跑两跑 11 pass / 0 fail / 0 未验证；
此前它以"未验证"挂了四批，原因就是夹具只接了三口）。
⚠ 待办（不做不算缺陷）：给沙盒加一句"有器件的复位／使能端悬空 ⇒ 仿真可能不动"的提示——
要先把 `_warnings` 与未接端口的对应关系量清楚再写文案，⛔ 不许凭猜写。
- `r46-menu-parity` 加了 [G]/[H] 两臂（2026-10-06，#33）：**[G]** 视图那一组两边齐且同序（放大→缩小→适应窗口→重置缩放，从 DOM 现读 label 序列）；
  **[H]** 编译模式那颗「放大」不是死菜单 —— 点下去 wrapper 的 `scale()` 真的变大（读数 `0.9836 → 1.1803`）。
  产品侧：`Canvas.tsx` 把 Ctrl+滚轮的锚点缩放数学抽成一颗 `zoomAt(factor, mx, my)`，`handleWheel` 与新的 `zoomBy`（视口中心为锚）都走它，
  ⛔ 不许有第二份缩放实现；`zoomAt` 里必置 `userViewRef`（R59：否则 `render:done` 的自动适应窗口把用户调的缩放抹掉）。
  反向探针 `r46-mutate.cjs` 三颗全咬：MA 摘掉放大/缩小 ⇒ [G][H] 同红；MB **只换顺序** ⇒ 只 [G] 红（[H] 保持绿）；MC 让 `zoomBy` 空转 ⇒ 只 [H] 红。
  ⚠ hint 只写了界面上真存在的（`Ctrl+滚轮`、`Shift+F`＝`canvas.fit`）；沙盒那颗「重置缩放」带 `Ctrl+0` 而编译模式没带，
  是因为 `shortcuts.ts` 的 `editor.zoomReset` 是 `editorOnly`（那是编辑器字号），⛔ 不许为了词面对齐把假提示抄过去。
