
---

# 卷三十八 · R130 收尾：ESLint 立项完成 + PNG 裁决入账 + 跑批中断归因（2026-10-11 深夜，用户令停机）

## 一、PNG 导出下线 —— **用户裁决确认**（卷三十六待确认项闭环）
账本与 CHANGELOG 保持「已下线」记述，不再标待确认。r12-export 闸门绿（下线后的导出面覆盖）。

## 二、ESLint 立项完成（卷一 S1 清偿，卷三十六登记项闭环）
- eslint 10 + @eslint/js + typescript-eslint 8 + globals + eslint-plugin-react-hooks（CodeEditor 的行内 disable 注释需要插件可解析——未装插件时 ESLint 10 会把 disable 注释本身报成 error，R130 实测）。
- `eslint.config.js`（flat config）：**0 error 基线达成**（LINT=0 error / 648 warnings 留档分级）。关键裁决与坑全部注释在 config 内：
  - **no-undef: off**（TS 项目由 tsc 管未定义；本仓 new JSX transform 下 `React.MouseEvent` 类型引用不 import React，55 个误报全源于此）；
  - **配置必须落在 `@typescript-eslint/no-unused-expressions`**（tseslint recommended 启用 TS 版规则覆盖 core 版——core 版的 allowTernary 配置不生效，R130 实测 4 处 `cond ? a() : b()` 惯用法被误报）；
  - `no-useless-assignment`（ESLint 10 新规则）降 warn：对 try/catch 防御性初始化有误报面（11 处），留档下轮甄别；
  - react-hooks/exhaustive-deps: warn（真规则真提示，Canvas 一处 useImperativeHandle 依赖提示已现）。
- 两处小修（语义等价）：subcircuitView 降级抛错补 `cause: e2`（ESLint preserve-caught-error；tsconfig lib 随之 ES2022）；annotationCell 三处 `arguments` 转发改 rest 参数。
- `package.json`：`pnpm lint` / `pnpm lint:fix`。tests/ 暂不纳入（另立项）。

## 三、r130 统一批中断归因（**ENVRED 成片=环境损伤，非代码回归**，结果作废）
- 形态：第 1 格（r7）起 **FATAL page.goto 30s 超时**，51 格 ENVRED 后被用户令停。
- 根因链：`pnpm add`（装 ESLint）变更 package.json/lockfile → vite 的 optimizeDeps 预构建缓存（`node_modules/.vite`，其 hash 含 lockfile）**全体失效** → 每个 gate 冷启动都要全量预构建，30s 内起不来 → 全体 goto 超时。与代码无关（tsc 0 错、vite build 10.05s 过、build 是完整产物链验证）。
- **下轮开工第一件事**：`pnpm dev` 预热一次（等 optimizeDeps 预构建完成）再跑 `run-all`——一次预热全批复用。

## 四、工作区快照（下轮交接）
- 未提交（待统一批绿后一并入库）：`eslint.config.js`、`package.json`/`pnpm-lock.yaml`、`tsconfig.json`、`src/lib/subcircuitView.ts`、`src/lib/annotationCell.ts`、`src/components/{Canvas,FsmTableModal,IOPanel,WaveformPanel}.tsx`（R127 轮询门——r128c 批 70/70 已验证过一次，但按纪律随本批一起提交）。
- 本卷账本先单独提交（文档无需闸门）。
- 深水区/小刀清单：见卷三十五（Canvas probe 已做✓、App 对话框已弃✓）与卷三十六（余 AppDialogs 弃刀已记）。

*（卷三十八 · 阶段收尾，机器休息）*

## 卷三十八补记 · 并行现场盘点（账本提交后复查发现代理恢复活跃）

1. **轮询门 4 文件已被在途代理提交**（`514a1fc` R127 收口——即我昨夜"留待验"的那批，代理已接手提交，且 r128b/r128c 两个全量批（70/70 绿）运行时代码已含轮询门 ⇒ **已验证**。我昨夜"未提交"的判断已过时）。
2. **代理正在做同方向黑窗修复**（`tests/_ui.cjs` 的 reapViteByPort execSync 加 windowsHide）——与我的 131+12 文件补丁方向一致、文件零交集，无冲突。
3. **代理未提交的活跃工作**（我方不碰）：`docs/AGENT_ARCH_DECISION.md`（+226 行）、`docs/AGENT_PRODUCT_ARCHITECTURE.md`（新建）、`tests/_ui.cjs`（windowsHide）。
4. **我方未提交的待验变更**（与代理文件集零交集）：`eslint.config.js`（新）、`package.json`/`pnpm-lock.yaml`、`tsconfig.json`（lib ES2022）、`src/lib/subcircuitView.ts`（cause）、`src/lib/annotationCell.ts`（args 转发）、`tests/run-all.cjs` + 12 个 mutate 台架（spawnSync windowsHide）。
   下轮（代理或我）跑批绿后一并入库；r130 批的 ENVRED 归因维持（vite 预构建缓存失效链），另补观察项：r130 批运行窗口与代理活跃窗口重叠，代理若在批中改 tests/ 会触发 vite 依赖图重扫——**并行开发期间跑批前先确认对方空闲**。
5. 裁决闭环：PNG 导出下线经用户确认（本卷首节）。

*（卷三十八补记完 · 双代理协同，文件级分工无冲突）*

---

# 卷三十九 · R131 收口：ESLint 批与黑窗补漏验证入库 + 批完成信号机制（2026-10-12）

## 一、验证与入库
- 统一批 r131：**`RED=0 ENVRED=0 GREEN=70 NOVERDICT=0 共 70 格`** ✓（覆盖待验全集：ESLint 工具链、tsconfig lib ES2022、subcircuitView cause、annotationCell args 转发、run-all+12 mutate 的 spawnSync windowsHide）。
- 逐文件归属提交（在途代理的 AGENT docs/_ui.cjs **不碰**，留其自提）。

## 二、批完成信号机制（用户需求："跑测试要有输出信号标志"）
- 新增 `tests/notify_done.cjs`：轮询批日志 → 汇总出现即弹 **Windows toast 通知**（✅ 全绿 / ⚠️ 有红，含红格名单）。
- **新惯例**：起跑批后必须随手 `node tests/notify_done.cjs <log> <批名>` 挂信号器——用户不再需要盯进度或猜何时叫继续。已对 R131 批实践生效。

## 三、r130 超时根因的修正补记
- `vite optimize` 实测输出 **"Hash is consistent. Skipping."** —— pnpm install 后预构建缓存并未失效（卷三十八第三节推断被修正）。r130 ENVRED 的真因收敛为卷三十八补记第 4 条观察项：**批运行窗口与在途代理改 tests/ 文件重叠**，触发 vite 依赖图重扫/重编译，冷启动超时。惯例补充：**跑批前确认并行代理空闲**，或批内日志出现连续 goto 超时即判定"并行污染"，作废重跑。

*（卷三十九完 · 待验集清零）*

---

# 卷四十 · R132 瘦身第四刀：App 编译管线 hooks 化（1928→1788）（2026-10-12）

- **迁出**：`hooks/useCompilePipeline.ts`——7 个管线状态（status/message/yosysLog/outputPanelVisible/problems/missingModules/simPaused）+ resolveDependencies（依赖闭包 BFS）+ tryCompileAll（编译编排：接口预检分级 → yosys → 冲突分级 → 状态机），**逐字随迁**（含 V1 行号结构化、冲突 line:null 不冒充等裁决注释）。
- **App 侧同名解构接回** ⇒ ~40 处 setMessage/setStatus 消费点与 12+ 处 handleCompile/tryCompileAll 引用**零改动**（hook 返回同名符号）。
- **App.tsx 1928 → 1788（-140）**；连带清出 App 的 verilog import 面只剩 buildViewJson。
- **小步测试（新节奏）**：tsc 0 错、build 19.22s、编译族三闸 **r37 14/14、r42 9/9、r56 4/4 全绿**——不跑全量批（用户指令）。
- 弃刀记录：App 对话框 JSX 抽取（卷三十七已弃）、simPaused 归 hook 的理由=fresh build 强制起跑属管线语义。

## 瘦身线四卷累计（R124→R132）
| 文件 | 起点 | 现在 | Δ |
|------|------|------|---|
| SandboxCanvas.tsx | 4631 | 3776 | -855（主 effect ~820 行维持，侦察结论=不动） |
| verilog.ts | 1298 | 387 | -911 |
| App.tsx | 1928 | 1788 | -140 |
| 新增单一真源 lib/hook | — | sandboxDrc/sandboxWaveBridge/sandboxCellMenu/verilogCircuit/verilogParse/verilogConflicts/canvasProbe/useCompilePipeline | 8 个 |
- 剩余大文件均为**状态机深水区**（SandboxCanvas 主 effect / App 其余 30+ useState），机械搬家线已到边际，后续拆分需逐个专项设计 + 闸门补强（在册）。

*（卷四十完 · R132 小步测试通过）*

---

# 卷四十一 · R135：导出成品深度实现（自包含 SVG 收成一份主人）＋ lib 单测安全网收口（2026-10-13）

用户令：**UI 冻结**（后期改 VS Code 套壳，当前 UI 不必再测）＋ AGENT 文档一并提交（已由 `54ce537` 入库）
＋ 四条功能请求。本轮只做"不需要真机验收"的部分，判定全部走无头读数（闸门/单测/字节）。

## 一、四条请求的现状核对（先查再动手，别把已做的重做一遍）
| 请求 | 现状 | 出处 |
|---|---|---|
| Ctrl+F 部件搜索（两模式，输入名→定位＋高亮） | **已落地**（不是我做的）：`lib/partSearch.ts` 一份总线＋`PartSearchDialog`，编译 `Canvas.tsx:1000` 与沙盒 `SandboxCanvas.tsx:1472` 各注册一份 `list/locate`，`shortcuts.ts:34` 按焦点分流（编辑器→查找替换，画布→部件搜索） | `32d3633` |
| 沙盒顶部「部件绑定」与右键「绑定」弹窗不统一 | **沙盒内两个入口早已同源**（顶部按钮与文件树右键都 `setFileBindingId` → 同一颗 `SandboxFileBindingDialog`）；剩下的差异是**跨模式**那对：编译模式 `BindingDialog`（Verilog 模块名→文件）与沙盒 `SandboxFileBindingDialog`（celltype→部件文件），两棵表数据域不同 ⇒ 合并要造抽象、砍一侧又丢语义，**归他裁决**（问题已提出，⛔ 我替他定） | `29428a3` |
| 两模式砍 PNG／编译 SVG 太简陋／沙盒补网表+JSON 导出 | PNG 全线已下线（r12 [E] 三处反证、r46 [E2]）；沙盒「综合网表 / JSON」两颗按钮在位 `SandboxCanvas.tsx:3435-3436`；**编译 SVG 的真病见下节**（本轮修） | 本卷二 |
| 三个导出"深度实现" | 新增 `r135` 内容级证人后：SVG 7 格全绿，JSON `devices=45` 与 paper `cells=45` 配对，网表三层 module 全在册＋35 处带名连接实例 | 本卷四 |

## 二、编译模式 SVG「部件全为纯黑色矩形」的三条成因（读数定的案，⛔ 猜的）
1. **底色与主题不配对**（主因）：`exportSVG` 把计算样式内联进克隆，深色主题的器件填充本就
   是近黑的 `rgb(35,40,48)`（index.css:400 那条 `!important`），却又**写死 `#ffffff` 白底** ⇒
   黑块压白底＝"纯黑色矩形"；同一句 `[data-theme=dark] svg text` 的浅色字（`rgb(228,228,236)`）
   压白底几乎看不见＝"绘制过于简陋"的另一半。
2. **取景混了两套坐标系**：克隆里摘掉「视口层」`<svg> 直接 <g>` 的 transform（模型坐标），
    viewBox 却用 `svg.getBBox()`（**含**视口平移）⇒ 内容与框错开（本夹具实测差 18px，
   用户滚过/缩放过就更离谱 ⇒ 打开像"空图/半张图"）。
3. **选 svg 那句有雷**：`canvasContainer.querySelector('svg')` —— 容器里在 `<Canvas>` **之前**
   挂着输入面板浮层与面包屑的 lucide 图标（`App.tsx:1422/1438`，实测 19-24px），钻进子模块或
   开着输入面板时导出的"电路图"就是一枚图标。⚠ 本夹具默认视图下第一颗恰好是 paper 的 svg，
   ⇒ 这条**不是本次症状的成因**（[1] 当时是绿的），但它是同一句代码的另一种下落，一并换成
   `pickPaperSvg()`（先 `.joint-paper svg`，退化取面积最大的一颗）。

## 三、落地形状（一处主人，两模式不再各自漂）
- `exportUtils.buildStandaloneSvg()`＝自包含 SVG 的**唯一主人**：内联样式表补 `marker-*`／
  `visibility`／`display`／`color`／`dominant-baseline`（少一项就"少画一样东西"，箭头是 marker 画的），
  且**不给 `<style>` 元素自己刷样式**（第一版冒出过 `style[style=…]`）；去 `foreignObject` 与
  joint 工具/手柄层；摘视口层变换；底色＝**屏幕上那张画布**（容器链上第一颗不透明背景，
  退回 `--canvas-bg`）；viewBox 与"摘掉变换后的内容"同一坐标系（视口层自身 `getBBox()` 并集，
  沙盒传 `paper.model.getBBox()`）。
- `sandboxExport.buildSvgString()` 删掉自己那套克隆/白底/取景逻辑，改为委托 ⇒ 两条轨道合一。
- ⚠ **改语义必须同批回写证人**：`r12-export` 那句 `svgStr.includes('#ffffff')` 换成成对判据
  （文件底色 == 屏幕画布底色）。留着它＝把被改掉的错钉成契约。

## 四、读数
- 新闸门 `tests/r135-svg-export-gate.cjs`（PORT 1801，已进 `run-all.cjs` GATES）：**7 pass / 0 fail / 0 unverified**。
  夹具＝三层真路径 multiplier→adder→full_adder（`multiplier.v`/`adder.v`/`full_adder.v` 跨文件绑定，
  live `cells=45 texts=510 shapes=458`）。⚠ 玩具夹具在这条链上会被拒编译（r61 同话）。
- 修前后对照：修后文件底色 `rgb(13,13,19)`==屏幕，viewBox 原点 −8（==12−20），文字 `rgb(228,228,236)`==屏幕；
  修前那版是白底＋同一批深色器件（`.tmpbuild/r135-compile-export.svg` 留着当证据）。
- `r12-export` 28 pass / 0 fail（沙盒导出面没因委托而退）；`vitest run` **15 pass / 15**；
  `tsc --noEmit` **0 错**；`eslint src --quiet` **0 error**。

## 五、lib 单测安全网收口（中断代理留下的两格红）
- `parseVerilogInstances` 实测返回**被实例化的外部模块名**（函数体内 push 的是 `match[1]`，
  且同文件已定义的模块被 `definedModules` 排除）⇒ 消费方 `useCompilePipeline` 用它做缺模块判错是对的；
  ⚠ **`HierarchyViewer.tsx:48` 拿它当"实例清单"用** ⇒ 层级树显示的是模块名，且同文件内的实例根本不上树
  （要实例名该走 `parseInstantiations()`）。UI 冻结期⛔ 不动面板，登记为 T-3。单测把两棵函数的口径钉死。
- `normalizeIoLabels` 只**在 `attrs.label.text` 已存在时**同步，⛔ 不凭空造 attrs（写死白底那版同理：
  契约要按实现的真形状写）。两格补齐＝"有 attrs 槽同步／无 attrs 槽只写 label／取不到名字不动标签"。
- `tests/unit` 已加进 `tsconfig.include` ⇒ 单测文件不再游离在类型检查外（`npm run build` 会查它）。
- ⚠ 仓内**没有 vitest 配置**：`vite.config.ts` 无 `test` 块，默认 include 恰好只命中 `tests/unit/**.test.ts`；
  将来 `src` 下放 `*.test.ts` 会被一起收进 `pnpm test`（要隔离就得先加配置，别到时无处解释）。

## 六、我自己这轮犯的四处判据错（都是"把测试写坏"，不是产品坏）
1. 把导出**注回本页面**量它：那棵子树里 `getComputedStyle(el).fill` 读**空串**、`getBBox()` 恒 0
   ⇒ 好文件被读成"全坏"（[3][4] 双误红）。改成**只解析文件字节**。
2. 顶栏 `MenuBar` 下拉连点三次在"开→点空→再点＝关"上打转 ⇒ 6 格全 UNVERIFIED。改用 r46 现役配方
   （右键 `.joint-paper` 的 62%/60%，读 `[data-context-menu]`）。
3. `page.waitForEvent('download')` 点击失败时留下**没人 catch 的 promise**，20s 后以 unhandled
   rejection **打死整个闸门进程**（第一版只留下一段 FATAL，读起来像产品崩了）。当场 `dlP.catch(()=>{})`。
4. 网表判据连钉错两次（先"必须 `module multiplier`"，再 `adder \u0(`）⇒ 现场是 3 颗 module 全在
   ＋**35 处带名连接**、0 处门级原语行。计数/形状型期望必须从现场读数来，⛔ 凭 yosys 的印象写。
   另：`sed -i` 改测试文件那次是文本级补丁，改完必须回读确认（本轮命中 1 处，已核对）。

## 七、欠账登记（下批接手的清单）
- **T-1** Ctrl+F 部件搜索**没有闸门证人**（`locate`/高亮/回车换下一处在两模式都未被断言过）。
- ~~T-2~~ **已闭**：`tests/r135-mutate.cjs` 四颗（MA 底色退回写死白→[3][7] 红／MB 取景退回带平移的
  包围盒→[4] 红／MC 不内联计算样式→[3] 红／MD 不写 viewBox→[1][4] 红），首跑 3/4 成立——
  MB 我把 [1] 也写成"该红"是**猜错**：[1] 只比宽高，两种包围盒的宽高相同（只有原点差 18px），
  ⇒ 尺寸归 [1]、原点归 [4]，两颗证人分工不同。改正期望后单跑 MB（本卷末记读数）。
- **T-3** `HierarchyViewer`/`ModulePanel` 把"外部模块清单"当"实例清单"用（见本卷五）。
- **T-4** 跨模式绑定弹窗（`BindingDialog` vs `SandboxFileBindingDialog`）**等他裁决**。
- **T-5** 本轮未跑全量跑批（只跑 r12/r135 两格相关面＋单测/tsc/lint）；导出底色"所见即所导"的
  **观感**也等他：若要"永远白底浅器件"用于贴文档，得再加一层调色映射（未做）。

## 八、T-1 已闭：`tests/r135-part-search-gate.cjs`（PORT 1802，已进 run-all）九格 **9 pass / 0 fail / 0 unverified**
两模式各四格（Ctrl+F 开框且**输入框已聚焦**／命中行数与模型颗数**配对**／点击落点⇒点亮＋进入可视区／
键盘 Enter 换**另一种 type**再落一颗）＋代码视图反向对照一格（编辑器聚焦时 Ctrl+F 不弹部件搜索）。
三条只有读数才给得出的现场形状：
1. **两模式的"高亮"是两条不同通道**：沙盒 `locate` 走选择态 `.sm-selected`（`SandboxCanvas.tsx:1472`），
   编译 `locate` 走 `src-highlight` 发光＋把 wrapper 的 pan 平移居中（`Canvas.tsx:1010-1035`，与
   「代码↔电路溯源」同一条通道）。判据⛔ 只认一种＝另一侧误红（我这轮就先误红了一次）。
   ⚠ 要不要统一成一条：把搜索落点写成"选中态"会让人以为可以直接 Delete/翻转那颗——**故意保留分岔**，
   统一与否归他裁（记 T-6）。
2. **Enter 的语义＝跳第一条命中**（`PartSearchDialog.tsx:81-85` 取 `hits[0]`），⛔ 我第一版按"下一条"
   写期望，当场被读数打回。
3. 密电路里 `UI.blankCanvasPoint` 会**抛**「找不到空白点」（`_ui.cjs:328`）⇒ 不许当可空返回值用；
   而且判据不该依赖"点空白取消高亮"这一前置（改成换一种 type 换落点，路径更短也更快）。
4. 查询词⛔ 写死 `'And'`：从模型现取"当前最多那种 type"（编译图里实测 `BusSlice`/`Subcircuit`），
   器件表一改不会误红（r32「逻辑门=7 项」那一族的教训）。

## 九、T-2 已闭：`tests/r135-mutate.cjs` 四颗变异 **4/4 证人成立**（首跑 3/4，改期望后单跑补齐）
- MA 底色退回写死白 → [3][7] 红／MB 取景退回带平移的包围盒 → **只 [4]** 红／MC 不内联计算样式 → [3] 红／
  MD 不写 viewBox → [1][4] 红；每轮开头先还原，末了基线复跑 **7 pass / 0 fail**，还原后逐字节比对一致。
- MB 那格我把 [1] 也写成"该红"是**猜错**：[1] 只比宽高，两种包围盒的宽高相同（差 40px 的 pad 落在 ±35% 内），
  只有**原点**差 18px ⇒ 尺寸归 [1]、原点归 [4]。改正期望后单跑 --only MB 通过。⛔ 悄悄放宽成"该红就行"。

## 十、本轮读数汇总
| 项 | 读数 |
|---|---|
| `r135-svg-export-gate` | 7 pass / 0 fail / 0 unver（修前 6/1，[3][4][7] 红） |
| `r135-part-search-gate` | 9 pass / 0 fail / 0 unver |
| `r135-mutate` | 4/4 证人成立＋基线复绿 |
| `r12-export`（改语义同批回写） | 28 pass / 0 fail |
| `pnpm test`（vitest） | 15 pass / 15 |
| `tsc --noEmit` / `eslint src --quiet` | 0 错 / 0 error |
| 新增在册欠账 | **T-6** 两模式高亮通道是否统一（归他裁）；T-3/T-4/T-5 见本卷七 |

*（卷四十一完 · R135：UI 冻结期用字节与单测把导出面与搜索面都钉了证人，真机观感项留给他）*

---

# 卷四十二 · R136：统一调用层落地（VS Code 套壳迁移第一步）（2026-10-13）

用户令：**先确保重构完成**才允许走后续步骤；套壳部分⛔ 自己写，用已有项目（可直接拉取）；
三项建议按我的推荐闭合（T-4 弹窗不合并／T-5 底色保持"所见即所导"／T-6 两模式高亮通道不统一）。

## 一、实测耦合面（⛔ 照架构文档写"5 文件 / 16 处 invoke"就动手）
| 事实 | 实测 |
|---|---|
| 前端直连 Tauri 的文件 | **5 颗**：`lib/exportUtils.ts`(1)、`store/fileStore.ts`(**14**)、`store/projectConfigStore.ts`(2)、`components/CodeEditor.tsx`(3)、`components/WindowControls.tsx`(0 处 invoke，但自带 `__TAURI_INTERNALS__` 探测 + 直接 `import('@tauri-apps/api/window')`) |
| 直连调用点合计 | **20 处**（文档写 16 处，差 4：漏数了 CodeEditor 的三处动态 import 与 exportUtils 那颗） |
| Rust 侧 | `src-tauri/src/lib.rs` **402 行**（文档写 ≈385），14 颗 `#[tauri::command]` |
| 事件 `listen(...)` | **0 处** ⇒ 架构文档 §9.6 第 3 步"事件改 webview 消息"这一整条本期不存在 |

## 二、落地形状（`src/lib/host/`，提交 `4ef5860`）
- 一份 `ProjectHost` 接口（文件 10 颗 + 配置 2 + 导出 1 + 剪贴板 2 + 窗口 5）＋三档实现：
  `tauriHost`＝现有实现**等价搬运**；`browserHost`＝dev/无头闸门那档；`vscodeHost`＝Webview 侧带序号 RPC。
- 迁移后 `src/` 里除 host 目录外 **`@tauri-apps` 引用 0**（grep 实测）；三档实现惰性 import
  ⇒ 浏览器与测试环境不会把 Tauri 代码推进主包。
- 三条刻意形状（都写进 `host.ts` 文件头，⛔ 下次再靠记忆动手）：
  1. 宿主探测**每次现读**：`r12-export` 的 [F1]-[F3] 靠在点击前注入 `__TAURI_INTERNALS__` 验原生保存路径，
     模块加载期求值＝那三格永远测不到 Tauri 分支的假绿灯；
  2. `browserHost` 的文件类方法**必须 reject**、不许返回空表：`fileStore.refresh()` 拿到空
     `tree.files` 会把 localStorage 里的用户文件当"磁盘已删"全过滤掉（⛔"不支持"做成"空结果"）；
  3. `hostFire` 原样保留 `'Failed to …'` 前缀文本并继续 fire-and-forget（改 await 会动 fileStore 时序）。
- VS Code 那档三条协议形状：`acquireVsCodeApi()` 一个会话只准调一次（缓存）；消息是 JSON 序列化的
  ⇒ 导出字节走 **base64**（分块 `String.fromCharCode`，直发 40000 字节的 Uint8Array 会退化/栈溢出）；
  每问每答按自增 id 配对 + 超时（普通 20s、`saveExportFile` 5 分钟——等用户点"另存为"），
  对话框取消回 `data:false` 是正常下落 ⛔ 回 error。

## 三、读数
- 新单测 `tests/unit/host.test.ts` **13 格**（node 环境，无头）：**首跑就抓到一颗真形状错**——
  "宿主不支持"那几颗原本 `throw`（同步炸）却声明成 `Promise` ⇒ `h.x().catch()` 会在**调用点**炸开
  而不是进它自己的 catch；全改成 reject。（⛔ 只测"能跑通的路径"，新写的一层没有reject/超时臂＝没证人）
- `pnpm test` 28/28、`tsc --noEmit` 0 错、`eslint src --quiet` 0 error。
- 全量跑批 `node tests/run-all.cjs`（71 格，日志 `tests/.out-runall-r136.txt`，逐格日志 `.tmpbuild/gates/`）：
  43 格已判 **42 GREEN / 1 RED**，含关键回归证人 `r12-export 28/0`（Tauri 路径＋三种导出全在里头）。
- 那颗红是 **r81 [6] 证人自己指错了文件**，不是产品回归：R132 编译管线 hooks 化
  （commit `2ed2db1`，App 1928→1788）把 PROBLEMS 那条 `line: err.line` 从 `App.tsx` 搬进
  `hooks/useCompilePipeline.ts:98`，而证人只 grep `App.tsx` ⇒ 产品没坏、锚点漂了。
  本轮修法：把"生产侧"定义成**编译链上的源文件集合**（App + hooks）并报告读到的落在哪颗文件里
  （⛔ 把断言放宽成"看不见就算了"）。**改完尚未复跑**（跑批窗口内不并跑第二颗，避免把 CPU 争用读成红）。

## 四、套壳基座（用户令：⛔ 自己写）
- 已拉官方件：`microsoft/vscode-extension-samples`（浅克隆＋sparse，只取 `webview-sample`＋`esbuild-sample`），
  落在仓外 `D:\Visual Studio Code\Something\.tmp-vsc-samples`（MIT，含 LICENSE，vendoring 时保留出处）。
  可复用的形状都是现成的：`createWebviewPanel` + `localResourceRoots` + `asWebviewUri` +
  `cspSource`/nonce + `onDidReceiveMessage` + `registerWebviewPanelSerializer`（revive 时重置 options）。
- 另两颗候选的维护状态读数（⛔ 拿归档件当基座）：`githubnext/vscode-react-webviews` 最后提交停在 2021、
  `microsoft/vscode-webview-ui-toolkit-samples` **2024-08-02 已归档**；官方 samples 活跃（`engines.vscode ^1.100.0`）。
- 下一期只做两件事：把 panel 的 HTML 指向我们已构建的 Vite SPA（需 `base: './'` 与 CSP 放行 wasm/worker）；
  在 Extension Host 侧把消息路由接上那 14 颗宿主能力（`workspace.fs` / `showSaveDialog` / `env.clipboard`）。
  ⛔ 重写 digitaljs 画布与 `SandboxCanvas`（架构文档 §9.3：那是两种宿主都不省的最贵部分）。

*（卷四十二完 · R136：调用层与三档宿主已进仓，套壳基座选定官方件；跑批余量与 r81 复跑待收口）*
