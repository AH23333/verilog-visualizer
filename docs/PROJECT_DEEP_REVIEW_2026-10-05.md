
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

## 五、跑批收口读数（72 格，`tests/.out-runall-r136.txt`）

**`RED=4 ENVRED=0 GREEN=68 NOVERDICT=0 共 72 格`** —— 四颗红全部归因完，两颗是真凶、两颗是我自己造的：

| 红格 | 归因 | 单跑复验 |
|---|---|---|
| r81 [6] | 证人指错文件（R132 hooks 化搬走 `line: err.line`） | `9 pass / 0 fail` ✓（修后） |
| r83 [7][7b] | 同一因，且**双向坏**：只扫 App.tsx ⇒ [7] 看不见 hook 里的英文（假绿灯）、[7b] 反向误红 | `9 pass / 0 fail` ✓（修后） |
| r95（pass=0，`locator.waitFor` 8s 超时） | **环境争用**：我在跑批未完时并跑了另两颗复验 ⇒ CPU 抢不动 | `10 pass / 0 fail` ✓ |
| r117（pass=0，`locator.click` 30s 超时） | 同上 | `8 pass / 0 fail` ✓ |

⛔ 把 `pass=0 + 交互超时` 读成产品红，也 ⛔ 把它当"反正会自己好"——唯一出路是**单独重跑**再定性。
⛔ 更不该造它：跑批窗口内不并跑第二颗闸门（本卷第三节那句是我自己违反的，两次）。

回归面读数（本轮改造最该看的几颗）：`r12-export 28/0`（Tauri 原生保存路径 + 三种导出）、
`r37-verify`、`r26-verify`、`r82-move-def-gate`、`r84-binding-gate`、`r121-annotation-gate 17/0`、
`r135-svg-export-gate 7/0`、`r135-part-search-gate 9/0` 全绿 ⇒ **调用层改造在 Tauri/浏览器两档无回归**。

*（卷四十二完 · R136：统一调用层进仓并全量复验，套壳基座选定微软官方 sample；真机点验单在 `docs/MIGRATION_VSCODE.md` §5）*

---

# 卷四十三 · R137：VS Code 壳装到位 + 那份 CSP 的真浏览器判据（2026-10-13）

> 触发这句话的是用户：**「当前难道还是使用 Tauri 吗，不是应该迁移到 vscode 套壳了吗，为什么 readme 还是 tauri 的启动方式」**
> ——上一卷我只把"前端调用层"中立化了，README 里连一行 F5 都没有。口径：**壳⛔ 存在＝壳能跑**；
> README 的启动方式⛔ 是宿主真值的复印件。

## 一、落地（基座⛔ 自己写，照官方 sample 两处适配）

`extension/{package.json,tsconfig.json,esbuild.js,sync-webview.js,src/html.ts,src/projectStore.ts,src/extension.ts}`
＋ `.vscode/{launch,tasks}.json`（**入库**：`.gitignore` 原先 `.vscode/*` 把 F5 那两颗挡在外面，加了 `!` 两行）。
`pnpm-workspace.yaml` 接 `extension` 包——顺带抓到一颗静默坑：那文件里 `allowBuilds: { esbuild: set this to true or false }`
是**占位文本**，pnpm 因此跳过 esbuild 的 postinstall ⇒ `pnpm install` 在 `extension/` 里"成功但什么都没装"。

**宿主半段 15 方法**逐条对上 `vscodeHost`，语义按 Rust `lib.rs` 抄（`deleteFile` 不存在＝静默成功、
`saveExportFile` 取消＝`false` ⛔ error、`sanitizeRel` 拒绝对路径与 `..`）。项目根定 `globalStorageUri/project_files`
（⛔ workspace 文件夹——那会让"打开哪个工程"决定文件可见性，而现有实现的工程集合与工作区无关）。

## 二、新增判据与读数

| 项 | 读数 |
|---|---|
| `tests/r137-webview-csp-gate.cjs`（PORT 1803，静态服务器 + **壳那份 CSP** + headless Edge） | **11 PASS / 0 FAIL / 1 UNVERIFIED** |
| `pnpm test`（vitest，`tests/unit/vscodeShell.test.ts` 由 8 格加到 **11 格**） | **39/39** |
| `pnpm -C extension typecheck` / 根 `tsc --noEmit` / `eslint src extension/src --quiet` | 0 错 / 0 错 / 0 error |
| `base:'./'` 影响的四颗跑 dist 闸门（⛔ 并跑，逐颗单跑） | `qc-preview 2/0`、`qc-paused 6/0`、`qc-realuser 4/0`、`r23-verify 12/0` |
| **全量跑批收口**（`tests/.out-runall-r137.txt`） | **`RED=0 ENVRED=0 GREEN=73 NOVERDICT=0 共 73 格`** ⇒ 本轮零红，无需归因 |

## 二b、本轮另外抓到的一颗是**壳自己的**（⛔ 产品回归，是迁移代码）

`extension.ts` 的 `panel.onDidDispose(...)` 原先只挂在 `openPanel` 里，而面板还有**第二条来路**：
窗口重启时 `registerWebviewPanelSerializer` 恢复出来的那颗⛔ 走 `openPanel`。
⇒ 下落是「重启恢复 → 关掉面板 → 再按命令」，`currentPanel` 仍指着已释放的面板，`reveal()` 打空炮，
症状＝**点了没反应**（本仓"点开没反应"那一族的新成员，账本 VQ 节同族）。
修法＝登记搬进两条路共用的 `wirePanel`（**一颗主人**），并加 `currentPanel === panel` 守卫
（⛔ 旧面板的 dispose 抹掉新面板的登记）。证人两颗：`onDidDispose` 全文件只许一颗，且它⛔ 在 `wirePanel` 之前。

同批补的一颗对账：**前端 `vscodeHost` 的 RPC 方法名表 ⇔ 宿主 `dispatch()` 的 `case` 分支表**，
两张表读的是**源码文本**，双向差集都要空（客户端 15 ⇔ 宿主 15）。
为什么值这两格：加一颗宿主能力时**只改一边**是静默失败——前端 `rpc('newMethod')` 发出去，
宿主落进 `default:` 抛"不认识的调用"，屏幕上的样子是"这个功能按了没反应"。
两颗各自都带一颗"⛔ 两边都空也算绿"的守卫（先断 `length >= 15` 再断相等）。


这颗闸门有两条**设计上的**讲究（都是本账本早先那几刀的口径）：
1. CSP 与改写器**从 `extension/src/html.ts` 现读**（esbuild 就地编 CJS 再 require），⛔ 在闸门里抄一份 CSP——
   抄的那份红了只能证明抄本有问题，证明不了壳里那份；
2. 三份页面分开（固定份 / 带"无 nonce 靶子"那份 / 摘掉 `script-src` origin 的变异份）。
   第一版我把靶子和"零 violation"塞在同一颗页面上 ⇒ [7] 永远红（那颗就是设计来被拦的）。

## 三、一处⛔ 我判错了（被自己的变异臂否掉）

我先写的结论是"`script-src` 只有 nonce ⇒ `import()` 出来的分块带不上 nonce ⇒ 宿主层三颗分块全被拒 ⇒
`getHost()` 每次静默失败"，还把它当**实测缺陷**写进了 `html.ts` 的文件头。变异臂的读数：
**摘掉 origin 后，内联探针与外联 chunk 两条 `import()` 路都仍放行，violations=0，挂载正常**
⇒ 本机 Chromium 把调用方 script 的 nonce 传给了 `import()`。
⇒ 那一格如实记 **UNVERIFIED**；`html.ts` 里那段"实测拒绝取同源分块"的字已改成"⛔ 已测，保留 origin＝对这件事不做赌注"。
**这就是"没读数之前别写失败原因"那一族的又一个样本**，而且这次的"读数"是我自己那颗闸门给的。

**反过来，`style-src` 那颗是真漏口**：首跑实测
`https://cdnjs.cloudflare.com/…prism-tomorrow.min.css|style-src-elem` ⇒ 代码编辑器没了配色，
且**只在壳里发生**（dev 不带 CSP）。已补进 `style-src`，现在 [6] 绿、violations=0。

其余放行面读数（一次拿全）：`WebAssembly.compile(yosys.wasm)` 成功（**16 416 382 B**，验 `'wasm-unsafe-eval'`）；
`typeof window.digitaljs === 'object'`（bundle 里那两处 `new Function("return this")` 是死支 ⇒ ⛔ 需要 `'unsafe-eval'`）；
CSP 下进沙盒放 Input×2+And+Lamp → 三根连线 → 拨输入 → 灯 `rgb(3, 192, 60)`。

## 四、⛔ 先动代码的那一颗：webview 的 `localStorage` 持不持久

这是本卷留下的唯一大开放项，**因为它要先有读数才知道怎么修**：
`src/` 里 `localStorage` **59 行 / 真调用点 45 处 / 12 个文件**，其中**沙盒电路文件正文**
（`verilog-viz-sandbox-files`）走的是纯 localStorage——实测 `grep -c "getHost\|hostFire\|saveProjectFile" src/store/sandboxStore.ts` ＝ **0**
（`.v` 文件经 `host.saveProjectFile` 落盘，`.djs` 电路⛔ 不经）。
VS Code 官方对 webview 持久化的建议是 `getState`/`setState` + serializer，⛔ 认可 localStorage；
扩展开发宿主的 profile 还是临时目录。⇒ 两种下落两种修法，先按 `MIGRATION_VSCODE.md` §5A 第 5 格取读数
（关面板→关窗口→重开 F5→电路还在吗），⛔ 在拿到那三个"在/没了"之前把 45 处调用点改成异步。

顺带记一颗**为点验加的按钮**：命令「打开项目文件所在文件夹」＝ `revealFileInOS` + 路径抄进剪贴板。
⛔ 让人去猜 globalStorage 的拼法才能核对落盘＝那是缺陷，⛔ 是"文档问题"。

## 五、文档口径同步（用户令：同步更新文档，我要进行测试）

- **README**：新增「宿主」一节；快速开始改成 **① VS Code 壳（F5）② 纯浏览器 ③ Tauri（历史/回退）**；
  徽章与"技术栈"行把 VS Code 放前面；CHANGELOG 范围 `R37→R123` 已过期 ⇒ 改 `R37 → R137`。
- `MIGRATION_VSCODE.md`：§0 进度、新增 §3.5（Extension Host 落地 + CSP 两条实测结论）、
  §4 射程表把步骤 1/3 改 ✅、§5 点验单拆成 **5A 壳（7 格）／5B 旧 Tauri（6 格）**、新增 §6 持久化开放项。
- `DEVELOPMENT.md`：新增「VS Code 壳的开发回路」（含"改前端只需 `pnpm build` + 重载面板"、
  "加一颗宿主方法＝四处一起改"）。
- ⛔ `launch.json` 原先那句"前置：两个终端 `pnpm dev` + `pnpm -C extension watch`"——壳读的是
  **文件系统里的 `dist/index.html`**，连不到 Vite dev server；那句会让人以为不起 dev 就白屏。已改成一条前置。

## 六、还欠着的

1. `pnpm -C extension package` 要 `@vscode/vsce`（本机未装）⇒ **`.vsix` 那条路本轮⛔ 没实测**，README 里也这么写的。
2. 扩展端到端台架（真起 Extension Development Host 判壳）没建；R137 那颗是把 CSP/装载面搬到 headless 浏览器判，
   ⛔ 等于"点过 F5"。
3. Prism 两颗 CDN 引用 ⇒ 落到 `public/` 才是离线正解（`connect-src`/`script-src`/`style-src` 三处才⛔ 需要收 cdnjs）。
4. 上一卷的 T-3（`HierarchyViewer`/`ModulePanel` 用错 `parseVerilogInstances` 的返回值）、
   #5 编译模式 FSM、#8 显示归一化仍在册。

*（卷四十三完 · R137：壳进仓、README 改主路径、那份 CSP 有了真浏览器判据；一处我自己的假"实测缺陷"被变异臂当场否掉，改记 UNVERIFIED）*


---

# 卷四十四 · R138：一条命令起壳 + Tauri 整条拆除（2026-10-13）

> 两句触发，逐字：**「我想要的效果是直接改成vscode套壳，但是当前启动方式还是原来的tauri，你给的pnpm -C extension build非常麻烦，
> 应该是直接一行代码运行的，而不是你文档里那么麻烦还要F5」**＋**「当前项目要完全转向vscode类的electron，要清理tauri」**。
> 上一卷我把"壳能跑"交付成"按 F5 → 再 Ctrl+Shift+P → 再找那条命令"＝把三步手工动作留给用户。
> 本仓自己的判据早就写死了：任何"请重启/请改键/请手动确认外部程序"都算缺陷——**手工启动步骤同样算**。

## 一、`pnpm app`（`scripts/run-in-vscode.mjs`）

四步：① `dist/` 缺、或 `src`/`public`/`index.html`/`vite.config.ts`/`package.json` 里有比它新的 ⇒ 先 `pnpm build`
（同 `ensureFreshDist` 那条纪律：读旧产物会把已修好的东西判成没修）；② 编 Extension Host；
③ 找 CLI：`VSCODE_BIN` → PATH 上 `code`/`code-insiders`/`codium`（**要 `--version` 真跑得通才算数**）→ 各平台常见安装位置；
④ `--extensionDevelopmentPath=<绝对 extension 目录> --new-window <仓库根>` 起窗口。
面板**由扩展自己弹**：`activate` 里 `extensionMode === Development`（或 `VERILOG_VIZ_AUTOOPEN=1`）就直接 `openPanel()`，
配套加 `activationEvents: ["onStartupFinished"]`——⛔ 它，开发模式下没人调命令，扩展根本不激活。
正式安装的扩展⛔ 抢着开（那是别人的编辑器，一启动就弹面板是骚扰）。

**为什么留一颗 `pnpm app:check`**：「找不找得到 CLI、参数拼得对不对、该不该重编」这三件本来**无头就能判**。
没这颗的话它们会被错登记成"必须真机"，而真机那一遍是用户的注意力。`check()` 只报现场、⛔ 构建、⛔ 开窗口。

⚠ **最险的一处是拼给 `cmd.exe` 的那条命令**：`code` 其实是 `code.cmd` ⇒ Windows 上必须 `shell: true`，
而 Node 的 shell 模式是**把参数用空格拼成一条串**交出去的，⛔ 替含空格那段加引号 ⇒
本仓库路径正是 `D:\Visual Studio Code\...`，`--extensionDevelopmentPath=` 会断在第一个空格处指到 `D:\Visual`。
这是 StarMark 那边 #261（`Start-Process -ArgumentList` 不引含空格元素，安装器去建 `D:\Visual`）那一族的 JS 翻版。
判据里除了断"每段各自带引号"，还**先断"裸拼那种写法不等于我们的输出"**——
⛔ 那样写的话两种实现都能通过，这颗闸门就永远是绿的。

## 二、Tauri 拆除清单（每一项都做了"删完⛔ 没人再引用"的现读核对）

| 删掉 | 读数 |
|---|---|
| `src-tauri/`（24 颗 tracked：Rust `lib.rs` 402 行/14 命令、`tauri.conf.json`、capabilities、icons） | `git ls-files src-tauri` ⇒ **0** |
| `src/lib/host/tauriHost.ts`、`ProjectHost` 上五颗窗口方法 + `hasWindowControls`、`exportUtils.isTauri` | `hostId()` 只剩 `'vscode' \| 'browser'` |
| `src/components/WindowControls.tsx` + `App.tsx` 两处 `data-tauri-drag-region` | 顶栏那颗 div 只剩弹性占位（⛔ 再自绘标题栏） |
| `@tauri-apps/{api,plugin-opener,cli}`、`pnpm tauri` 脚本 | `pnpm install` 读数 **−4 个包**；`grep -c tauri pnpm-lock.yaml` ⇒ **0** |
| `vite.config.ts` 的 `TAURI_DEV_HOST`/hmr/`watch.ignored`、eslint 的 `src-tauri/**`、`public/tauri.svg` | 后两条是顺手清的尾巴——**`tauri.svg` 是打包 `.vsix` 时才发现被一起塞进了包里**（这颗只有真打一次包才看得见） |

**回退口径改了**：⛔ 再"两条宿主并排维护"。要那一版就 `git revert`/`checkout` 到删除前那笔
（本卷落笔时 HEAD 三连的最后一笔之前那份树就是完整可跑的 Tauri 版）。并排维护的代价正是这批文档反复漂、
启动方式反复要重写、`isTauri` 守卫到处补的根源。

**盘上留着⛔ 我删的**：`src-tauri/target/`（**9.0 GB** Rust 缓存，gitignore 内、⛔ tracked）。
删之前先查了 `src-tauri/project_files/` ⇒ **0 个文件**（确认没人的电路住在那儿才动手）；
`rm -rf` ⛔ 可逆，而删 tracked 文件能 `git checkout` 回来，所以只做了后者。

## 三、`.vsix` 那条路由"⛔ 实测"变成跑过

装上 `@vscode/vsce`（devDependency）后 `pnpm ext:package` 真产出
`extension/verilog-visualizer-vscode-0.0.1.vsix`：**21 个文件 / 7.03 MB**（含 15.66 MB `yosys.wasm`、1.03 MB 主 chunk）。
⚠ 这里踩到**第二颗 `allowBuilds` 占位文本**：pnpm 自动写进 `@vscode/vsce-sign: set this to true or false`，
于是**每条 pnpm 命令都报错**。已明确写 `false` 并记理由（只本地打包⛔ 上架市场 ⇒ 签名辅助用不上）。
同一族坑 R137 在 esbuild 上踩过一次（那次症状是"install 成功但什么都没装"）——**两次都是占位文本被当成决定**。

`code --install-extension <vsix>` 那一步我**没在他机器上执行**：那是改他的编辑器状态，等他点头。

## 四、闸门跟着改的两处（⛔ 改产品行为）

- `r12-export` [F] 三格：原先注入 `__TAURI_INTERNALS__` 验 Rust 那条 `save_export_file`；
  现在注入 `acquireVsCodeApi` 桩，验**当前主宿主**那条同名通路。
  **不变量一字没动**——"点击前注入桩 ⇒ 探测每次现读"仍然是这颗判据的本体，只是标的换了；
  [F2] 载荷判据随形状从 `content[]` 数组改成 `args.base64`。读数 **28 pass / 0 fail**。
- `r13-custom-gate`／`r12-export` 的 boot 从 `{ waitUntil: 'networkidle' }` 改成 `UI.boot`（见第六节，那一节才是本卷的方法学收获）。

## 五、读数

**静态与单元（全绿）**

| 判据 | 读数 |
|---|---|
| `pnpm build`（根 `tsc && vite build`） | 0 错；`dist/assets` 从 **5 颗 chunk 收成 3 颗**（`tauriHost-*.js`、`window-*.js` 随 Tauri 一起没了） |
| `pnpm -C extension check`（tsc + esbuild） | 0 错 |
| `eslint src extension/src --quiet` | 0 error |
| `pnpm test`（vitest 四档） | **46/46**（`host` 11／`lib` 15／`vscodeShell` 11／`launcher` 9） |
| `grep -rn "@tauri-apps\|__TAURI" src/ extension/ tests/` | **2 行**：一颗是 gitignore 掉的旧跑批输出，一颗是我写的"这里原来注入的是 `__TAURI_INTERNALS__`"注释 ⇒ **活代码 0** |
| `pnpm install` | **−4 个包**；`grep -c tauri pnpm-lock.yaml` ⇒ **0** |

**直接受本轮改动影响的闸门（逐颗单跑）**

| 闸门 | 读数 | 备注 |
|---|---|---|
| `r12-export` | **28 pass / 0 fail** | [F] 三格标的已换成 VS Code 桩（[F2] 载荷 `args.base64`）；boot 已从 `networkidle` 改 `UI.boot` |
| `r13-custom-gate` | **15 pass / 0 fail** | 同上改锚点（第六节） |
| `r137-webview-csp-gate` | **11 pass / 0 fail / 1 UNVERIFIED** | 变异臂那颗 UNVERIFIED 是 R137 的既有结论，本轮未动 |
| `pnpm app:check` | CLI 找到（PATH 上 `code`）；`needsBuild` 正确报"package.json 比 dist 新"；命令串每个含空格参数各自带引号 | ⛔ 开窗口 |
| `pnpm ext:package` | 产出 `.vsix`：**21 个文件 / 7.03 MB** | 这条从"⛔ 实测"变跑过 |

**全量跑批：今天⛔ 收不了口，且这条结论本身是量出来的**

两次全量都跑到中途开始**成块**掉格：第一次（`tests/.out-runall-r138.txt`）到 24 格时非绿 9 颗
（r13 r17 r18 r25 r26 r34 r35 r37 r40），第二次（`tests/.out-runall-r138b.txt`）到 28 格时非绿 11 颗
（r20 r21 r22 r23 r24 r32 r33 r34 r35 r37 r40）——**两次掉的不是同一批**，且都停在 24～28 格附近。

把所有掉出的 **16 颗逐颗单跑**（⛔ 并跑）后：
r13 15/0、r17 10/0、r18 11/0、r20 5/0、r21 6/0、r22 4/0、r23 12/0、r24 5/0、r25 4/0、r26 12/0、
r32 14/0、r33 8/0、r34 9/0、r35 8/0、r37 14/0、r40 7/0 ⇒ **16 颗全绿，0 fail**。
另外把第二次成块失败的 r20～r24 **连着再跑一遍**也全绿（5/6/4/12/5，0 fail）⇒ 死因⛔ 在这几颗身上，
是长跑到中途的机器资源窗口。

所以本轮的收口口径写成两句，⛔ 混成一句：**产品面**——受影响的三颗闸门与 46 格单测全绿，
16 颗掉出闸门逐颗复验全绿，**没发现任何一颗是真红**；**跑批面**——这台机器今天**没能一次跑完 73 格**，
ENVRED 按定义⛔ 算通过，全量绿要在机器安静时再跑一遍。
（名册 241 那条"⛔ 跑批未完就并跑复验"我这轮守住了：所有复验都在停批之后逐颗做。）


## 六、方法学：怎么把"机器忙"和"锚点死了"分开

第一次跑批（`tests/.out-runall-r138.txt`）在 24 格里红/未判成 9 颗，症状全是 `page.goto: Timeout 30000ms exceeded`。
我差点把它写成"拆了依赖导致 Vite 重预打包 ⇒ 首页变慢"——**那句话在当时⛔ 有读数**。
先打现场，三条测量把归责钉住：

1. **进程侧**：`Get-CimInstance Win32_Process` 里命令行含 `vite` 的 node 进程 **0 颗** ⇒ "闸门跑完把 dev server 留下了"那条假设当场作废
   （这条要是成立，后面所有红都得重跑）；
2. **内存侧**：`FreePhysicalMemory` 6.3 GB / 总 16 GB，而 msedge 16 颗只占 0.83 GB、node 4 颗占 0.15 GB
   ⇒ 压力⛔ 测试进程泄漏造成，是这台机器别的东西在用。**⛔ 为了跑批去杀不属于我的进程**（用户可能在用电脑）；
3. **判决会不会移动**：把那 9 颗**逐颗单独重跑**（⛔ 并跑，名册 241 那条），
   r17/r18/r25/r26/r34/r35/r37/r40 **全翻绿**（10/11/4/12/9/8/14/7 全 0 fail），
   只有 r13 **连红三次**。⇒ 同一段时间、同一份代码、判决会动的那些＝**环境**；判决不动的那一颗＝**锚点**。

于是 r13 才轮到"死锚点"这个结论，并且它有独立佐证：`{ waitUntil: 'networkidle' }` 在这台 dev 服务器上
本来就要等 8 MB 阻塞式 classic script（`/digitaljs.js` + `/yosys/yosys.browser.js`）加一条不会闲下来的 HMR WebSocket，
`_ui.cjs` 的 boot 早就为这件事改成"等应用真挂载"，r12/r13 是最后两颗没改的。改完 r13 **15 pass / 0 fail**。

**记下来的规矩**：`pass=0 + goto 超时` 这种形状，先问"**重跑一次判决会不会变**"，⛔ 先问"是不是我改坏了"。
两者都⛔ 靠猜——测一次就有答案，而且测法是逐颗单跑（并跑会自己造出第二轮噪声，名册 241 已经为这件事红过一次）。


---

# 卷四十五 · R139：方向纠正 + 基座真的编出来了（片 1–2，2026-10-13）

> 两句触发，逐字。纠正方向那句：**「你完全没明白我的意思，我是说UI风格直接套壳vscode，而不是叫你在vscode打开，
> 更没叫你自己写运行脚本，当前只是要你进行框架的迁移，整体UI使用vscode套壳，类似当前各大厂商的agent/IDE产品」**；
> 授权动手那句：**「跑，你直接帮我装node，node use允许修改到更新的版本，可跑基座，顺便把缓存清空」**。
> 前一句判掉我连着两轮的两件事：① 把"套壳"做成"装进**他的** VS Code 一个标签页"，② 为此另写一颗 `pnpm app` 脚本。
> 形态他选项里选的是**自带 VS Code 源码分支、出独立二进制**（Cursor / Windsurf 同族）——用户⛔ 需要另外装 VS Code。

## 一、量差距：我们自绘的那套该换成哪个原生位置

`studio/README.md` §0 那张表是这一片的准绳（逐行）：`MenuBar.tsx` 183 行 → 命令面板/原生菜单；
`Sidebar.tsx` + `ProjectStore` → **原生 Explorer**（项目根改成"打开的那个文件夹"）；
整块 `WebviewPanel` → **`customEditors`**；`OutputPanel.tsx` 238 行 → Output 通道；
自绘 PROBLEMS（V1 那颗行号缺陷的主人）→ `DiagnosticCollection`；`SettingsPanel.tsx` → `contributes.configuration`。
拆完的收益⛔ 只是"少写点代码"：V1／V2b 那一族自绘缺陷会随宿主接管而**消失**，中文／主题／快捷键／无障碍一并继承。

## 二、片 1（脚手架）与片 2（基座真跑通）的读数

| 项 | 读数 |
|---|---|
| 基座 | `D:\vv-studio\vscode`，`code-oss-dev` **1.143.0**，浅克隆 + `blob:none`（⛔ 在仓库里，那份是 1 GB 上游源码） |
| `pnpm studio:brand` | 覆盖 **17 颗**品牌键 + 内置扩展装到 `extensions/verilog-visualizer/`；幂等（diff 稳定 **21 增 / 16 删**） |
| `npm install` | `added 1590 packages in 6m`，`npm error` **0 行** |
| `npm run compile-client` | `out/` **12,160 文件**；`Finished compilation with 0 errors after 37397 ms` |
| `npm run electron` | `.build/electron/Verilog Visualizer.exe` = **239,129,088 字节**（文件名就是我们合进去的 `nameShort` ⇒ branding 当场可见） |
| 起窗口 | `scripts/code.bat --user-data-dir=D:\vv-studio\profile`（⛔ 碰他日常 VS Code 配置）⇒ 6 颗自有进程，标题 `Verilog Visualizer - Verilog Visualizer Dev` |
| 内置扩展装载 | exthost：`_doActivateExtension local.verilog-visualizer-vscode`（`onStartupFinished`）；exthost/main/renderer 三份日志 `[error]` **0 行** |
| 画布像素 | **UNVERIFIED**：取这一格要把最小化的窗口激活，而他此刻在用这台电脑 ⇒ 抢焦点＝"程序要用户多做一步"，按本仓判据⛔ 做。点验一行在 `studio/README.md` §4b |
| 清缓存 | 删 `src-tauri/target`（**9.0 GB**，R138 拆完 Tauri 后它就是纯产物），⛔ 动源码 |
| 判据 | vitest **72/72**（60→72：`studioBrand` 14 格、新增 `startupPolicy` 12 格）；`pnpm -C extension check` 0 错 |

## 三、四条**测出来**的前置（每条都对应一次真失败，⛔ 是抄来的说明书）

1. **node 24.18.0**：`.nvmrc` 硬门槛 + `preinstall` 硬拒（⛔ 绕过，绕过去的产物⛔ 可信）。
2. **MSB8040＝Spectre 缓解库缺失**：`node-pty` 一类编不过。组件 id 要从
   `C:\ProgramData\Microsoft\VisualStudio\Packages\_Channels\f40d10d6\catalog.json` 现读——我先按社区流传的
   `…VC.Lts.Spectre` 试，报 `Cannot find package in product graph`；真 id `Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64.Spectre`。
   ⚠ 且**非管理员跑 Installer 的 `--passive/--quiet` 直接 exit 5007** ⇒ 必须一开始就提权（`Start-Process -Verb RunAs`），
   ⛔ 指望"失败后再以管理员重试"——那是把一步手工动作留给用户。
3. **`@vscode/ripgrep` 打 api.github.com 得 403**（本机未认证）⇒ 把那份 zip 预塞进它的下载缓存，命中就⛔ 打网络。
4. **checkout 路径⛔ 含空格**：上游 `build/npm/preinstall.ts:143` spawn 时**⛔ 给路径加引号**，
   实测 `D:Visual is not recognized as an internal or external command`，**跑满四分钟才炸**。
   我们仓库自己就住在 `D:\Visual Studio Code\` 下面 ⇒ `DEFAULT_FORK` **⛔ 从仓库相对位置推**（那会掉回同一个坑），
   钉成 `D:/vv-studio/vscode` 并在 `apply-brand.mjs` 里早退：含空格就三秒内说清＋给替代命令。

## 四、片 2 露出来的一颗真产品缺陷：我们自己的二进制启动后只剩一颗 Welcome 页

自动弹面板的旧规则是 `extensionMode === Development`。源码现读
`src/vs/platform/environment/common/environmentService.ts:105`：`isExtensionDevelopment`
**只在传了 `--extensionDevelopmentPath` 时为真** ⇒ 我们编进自家产品的内置扩展是 **Production**，旧规则永不触发。
判据搬进 `extension/src/startupPolicy.ts`（⛔ `import "vscode"`，纯函数、可无头判）：
`VERILOG_VIZ_AUTOOPEN=1` / 开发宿主 / **扩展编在 `appRoot` 里（＝这就是我们的产品）** 三种来路各开一次，其余⛔ 开。
⚠ 按**位置**判内置，⛔ 按 `vscode.env.appName` 字符串判——后者把行为押在品牌文案上，改一次名字就静默失效；
⚠ 归一（反斜杠／大小写／尾斜杠）是必要的：Windows 上裸 `startsWith` 在我们自己的二进制上判 false ⇒ 症状与原缺陷一模一样，
所以那一臂写成"归一这一步⛔ 是装饰"的变异证人（`extPath.startsWith(appRoot)` 现场为 false，函数为 true）。

## 五、这一轮我自己的三处（都改在这一批里）

1. **`tests/unit/vscodeShell.test.ts` 里残留着一句假"实测缺陷"**——"R137：`import()` 出来的分块**带不上 nonce**"。
   那句在 R137 就被我自己的变异臂当场否掉（本机 Chromium 会把 nonce 传给 `import()`），可它作为**注释**活到了这一批。
   同一条教训第二次落地：⛔ 只有代码里的"实测"两个字要证据，**注释与测试里的"实测／带不上"一样要证据**。已改成"⛔ 押 nonce 传不传得过去"的口径。
2. **判据自己也会被硬钉坑**：`studioBrand` 里那份基座 `product.json` 路径是手打的相对位置，基座搬过一次家 ⇒
   查不到文件就**静默退回小样本**，把 10 颗合法键全报成"我发明的字段"。红是红了，红的⛔ 它想问的事。
   现改成跟 `DEFAULT_FORK` 走（主人只有一处）。
3. **台架崩在还原之前＝源码带着变异活下去**：`bin/R139/bench_139_startup.py` 第一版把 `print(out)` 放在
   `restore()` 前面，控制台 gbk 编不了 `⛔` 当场抛异常 ⇒ M1 那颗变异留在 `startupPolicy.ts` 里。
   下一轮"**基线就红**"才把它抓出来。改法：还原一律走 `finally`，收尾再自检一次"还原后 0 红"。
   （台架读数：**4 臂全部有红**，M1/M2 各红 2 格、M3/M4 各红 1 格。）

## 六、还欠着的（下一片从这里切）

1. **片 3（下一刀）**：`.djs` / `.viz` 注册成 `customEditors`——画布从"一个装满 SPA 的 panel"变成"编辑器标签里的那份文档"，
   脏标记/保存/关闭交给 workbench；项目根从 `globalStorageUri/project_files` 改成**打开的工作区文件夹**
   （顺带解掉 R136 那颗"工程集合与工作区无关"的取舍，也让原生 Explorer 直接可用）。
2. ⚠ 卷四十四那句"面板由扩展自己弹：`activate` 里 `extensionMode === Development`（或 `VERILOG_VIZ_AUTOOPEN=1`）"**已被本卷取代**
   （原文⛔ 删，只追记这一行——那条规则在自家二进制里是漏的）。
3. 画布在我们二进制里的**像素级观感**＝UNVERIFIED（见 §2 末行）。
4. 上一卷的四条还挂着：`.vsix` 已跑过但 `code --install-extension` 仍要他点头；扩展端到端台架（真开 EPH 驱动 webview）⛔ 建；
   Prism 两颗 CDN 引用未落 `public/`；T-3（`parseVerilogInstances` 返回外部模块名）、#5 编译模式 FSM、#8 显示归一化仍在册。
5. ⚠ 两处落盘在 C 盘：`node-gyp` 的 Electron headers（`%LOCALAPPDATA%\node-gyp\Cache\43.7.7\`）、
   共享存储 `c:\Users\34697\.verilog-visualizer-shared\`——都⛔ 由我们的脚本决定，按"D 盘"这条硬约束**在册待处理**（片 5）。

## 七、追加（同一轮 R139）：片 3a 落地 + 一颗只有真机能发现的问题

§六 第 1 条那一刀（片 3）现在拆成两片，**3a 已落**：

| 项 | 落点 / 读数 |
|---|---|
| 项目根 | `projectRoot()`＝**打开的工作区文件夹**；⛔ 文件夹时退回旧家 `globalStorageUri/project_files`；多根取第一颗（在册取舍）。⚠ 这一条**反转**了 R136/R137 那句"⛔ 用 workspace 文件夹"（理由：文件树的主人要交给原生 Explorer，而 Explorer 只看得到工作区里的真文件） |
| 工程配置 | 另起一颗 `configRoot()`，**始终**应用级——⛔ 往用户仓库里扔 `verilog-viz.config.json`（那会让他的 `git status` 当场脏） |
| 扫描跳过 | `node_modules` 与任何点开头目录。⚠ 这条⛔ 是 Rust 版老规矩照抄：旧家目录里根本⛔ 会有这两类，是"根＝整仓代码"这个新形态带来的 |
| 无头网 | `tests/unit/vscodeApiStub.ts`（**回 Thenable、⛔ Promise** 的假宿主，故意保留那颗 `then()` 助手能被打到的形状）＋ `vitest.config.ts` 的 alias ＋ `tsconfig.json` 的 `paths` ＋ `tests/unit/extensionHost.test.ts` **25 格**（走真 req/res 通道）＋ 台架 `bin/R139/bench_139_hostnet.py` **8 臂全部有红**；vitest **97/97**、根 tsc / extension typecheck / eslint / `pnpm build` 各 0 错 |
| 真机（自有二进制） | `code --status` 的 Workspace Stats：`Folder (demo): 2 files / File types: v(2)`（原生那侧真看见了我们的 `.v`）；跑完 `D:\vv-studio\demo` 里仍只有我放的 2 颗文件（"⛔ 往用户仓库扔配置"在真机上成立） |

**那颗只有真机能发现的缺陷**（症状 → 对照实验 → 归责）：打开一个**从没信任过**的文件夹后，exthost 里
连 `_doActivateExtension local.verilog-visualizer-vscode` 都⛔ 出现、`[error]` **0 行**、窗口只剩一颗
Welcome（受限模式）页。⛔ 报错、⛔ 日志——"点了没反应"那一族里最难查的形状。
同一份产物加 `--disable-workspace-trust` 再跑 ⇒ 激活行当场回来 ⇒ 归责钉死在清单缺 `capabilities.untrustedWorkspaces`。
补上并带 `description`（受限模式里那句话是给**用户**读的，⛔ 让用户在⛔ 知道为什么放行的地方点放行），
再跑**不带**那颗旗标：`_doActivateExtension local.verilog-visualizer-vscode` ＋ 标题
`Verilog Visualizer - demo - Verilog Visualizer Dev`、`[error]` 0 行。
取舍＝**声明支持未信任工作区**，而⛔"整产品关掉 Workspace Trust"（安全 > 稳定：这份 fork 自带 js-debug 与 agent host，
那颗边界要留着）；根据是我们⛔ 起进程、⛔ 执行工作区带来的可执行文件——WASM 打进包，工作区内容只当文本读，
前端 `innerHTML` 只有两处且都只赋空串（现读 `Canvas.tsx:593`、`SandboxExpandModal.tsx:122`）。
⚠ 残留：新开文件夹仍会看到宿主的信任提示——那是宿主自己的安全 UI，⛔ 我在这一层替它消；真要动它归片 5 按产品口径决定。

**台架自己红过的三处**（都改在这一批，⛔ 记在注释里就当它对了）：
① `resetMachine()` 连内存盘一起清，上一版把它留在 seed **之后** ⇒ 每个"先 seed 再 boot"的用例
都在断言一颗被自己抹掉的文件，症状长得像产品缺陷（"找不到前端构建产物"）；现在"清场→铺盘→activate"由 `boot()` 独占。
② 桩里 `registerWebviewPanelSerializer(_, _: any)` 让**被测文件**的参数掉成隐式 any（根 tsc TS7006）——
台架⛔ 让产品变红，且那红⛔ 是它自己想问的事；补了 `WebviewPanelSerializer` 接口把上下文类型还回去。
③ 顺带又踩一次自己写过的坑：用 python heredoc 往文档里写 `D:\vv-studio\...`，`\\v` 被吃成**垂直制表符**
（与 `studioBrand` 那两格的教训同一颗字），CHANGELOG 一行了断两处；本轮起先按字节扫 `\x0b` 再收口（现读：全仓只剩那一处，已修）。

**片 3b（下一刀）**：`.djs` / `.viz` 注册成 `customEditors`。⚠ 它必须与"沙盒电路正文从 webview `localStorage`
搬进宿主文件"**同批**落（§6 那颗未预见的层、`MIGRATION_VSCODE.md` §6 的持久性读数）——`.djs` 一旦成为真文件就出现在树里，
两套主人并存（磁盘一份 + localStorage 一份）就是让用户分不清哪份生效。

## 八、追加：那颗"最大的开放项"用**读盘**拿到了半份答案（⛔ 抢他的屏幕）

R136 起挂着的那颗：webview 里的 `localStorage` 到底持不持久（沙盒电路正文全住在那儿，`sandboxStore.ts` 里
`getHost|hostFire|saveProjectFile` 计数 **0**）。它一直挂着是因为取读数那格**在他的屏幕上**。
这一轮换了一条只读盘的路：把 `--user-data-dir=D:\vv-studio\profile` 这份 profile 的 Chromium 存储层翻出来看。

| 读的东西 | 读数 |
|---|---|
| `src/` 里 `localStorage` 的射程（重新数，旧口径已过期） | 59 行（含注释）／真调用点 **47** 处（⚠ 文档原来写 45）／**12** 个文件／**20** 颗键名 |
| `<profile>/Local Storage/leveldb/000003.log`（2,040 字节，自 21:06 起未压实） | 里面**有**我们的键：`verilog-viz-files`、`verilog-viz-folders`、`verilog-viz-onboarded` |
| 同一份存储里的 webview origin | **只有 1 颗** `vscode-webview://1jljhded…48ut`——这份 profile 起过 **5 次**（21:06/21:17/21:43/21:46/21:48）；⚠ 若 origin 每次漂，这里就该有 5 颗 ⇒ "origin 不漂"是被这颗计数判出来的，⛔ 是推测 |

**能判的半份**：在"我们自己的二进制 + 固定 user-data-dir"这一档，webview 的 localStorage **写进了用户数据目录，
且 origin 跨启动稳定** ⇒ §6 里那条最贵的重构（加 `storageRead/storageWrite` + 把状态注入 HTML，
让 47 处同步读改异步）**⛔ 是为了"持久"而必须付的代价**。
**判不了的半份**：用户**画的电路正文**跨重启还在吗——那格真的要画一个电路（读数档里已按动作序列写好，`MIGRATION_VSCODE.md` §5A 第 5 格），
⚠ 并加了一条前提：**⛔ 用 F5 的开发宿主取这一格**（那是临时 profile，读数⛔ 代表产品）。

**这一颗改变下一刀的动机**：`.djs` 搬成工作区里的真文件（片 3b）**⛔ 是为了防丢**，
而是**数据该是文件**——进 git、进 Explorer、能被原生另存为带走；换机/清 profile 时 localStorage 那一份仍会没，
那是**已知局限**，⛔ 靠注入 bootstrap 解决（写进 `studio/README.md` §3 与 `MIGRATION_VSCODE.md` §6b，两处口径一致）。

*（卷四十五完 · R139 片 1–2–3a：方向改成"自带 Code - OSS 分支出独立二进制"，基座真编出来并真起过窗口，
 开局判据从 `extensionMode` 搬到"扩展在不在 appRoot 里"，项目根换成打开的文件夹并建起 Extension Host 的无头网；
 真机另抓到一颗"受限模式下宿主根本不激活我们"，已按清单声明修好；vitest 97/97，画布观感仍记 UNVERIFIED）*



---

# 卷四十六 · R140：版本分线（main＝无 agent 版）+ 方向**第二次**纠正（2026-10-13）

> 两句都逐字。分线：**「当前项目我要另起一个版本，建议推送819563d5ecb7deff50f9da26176d3561348986b3，
> 往后的提交使用新的分支"agent版"提交（可先只推几个提交，但不要全部推送），我要根据是否含有agent功能分为两个版本」**；
> 纠正：**「当前套壳vscode不是让你在vscode的壳内打开一个网页作为我的项目，
> 而是应该将绑定系统移植到当前vscode壳已有的文件系统上，以及移植模块、层次结构两个板块，以及沙盒系统」**。

## 一、分线：推送只推"指名那几笔"

| 项 | 读数 |
|---|---|
| 那颗 sha 是什么 | `819563d`＝`docs(R135): 账本卷四十一补记八~十节`，**是 HEAD 的祖先**（不是分叉、⛔ 新提交） |
| `origin/main` 推前在哪 | `54ce537`（代收 Agent 架构文档那笔） |
| 这段范围 | `54ce537..819563d`＝**5 笔**（R135：自包含 SVG 导出 + 证人 + 账本），**fast-forward ⇒ ⛔ force** |
| 推前查秘密 | `git diff --name-only` 只有 **15** 颗源码/文档/测试；凭证形状 grep **0** 命中（唯一 `token` 那句是 `getComputedStyle(...)` 的 CSS 变量名） |
| 用的命令 | `git push origin 819563d5...:refs/heads/main`——**指名 refspec**。⛔ `git push origin main`：那会把本地 23 笔全推上去，正是他那句"不要全部推送"要挡掉的形状 |
| 新分支 | 先 `git branch agent版 f050d56` 建出来，**同批按他的令改名成英文**：`git branch -m agent版 agent` ⇒ 现在的分支是 **`agent`**（纯本地改名，`origin` 那侧⛔ 有旧引用要删）；`origin/agent` **⛔ 建**（推不推仍一事一授权） |

⚠ **分线⛔ 等于"agent 功能已经写了"**：到 `f050d56` 为止 agent 面是 **0 行代码**（`MIGRATION_VSCODE.md` §4 状态表里 L1/工具门面两步＝⛔ 未开工，
他另有令：先⛔ 搭 agent 功能）。分的是**发布口径**：无 agent 那份停在 R135 的成熟骨架，迁移与新功能都在 `agent版` 上走。

## 二、方向第二次纠正：⛔"在壳里打开一个网页"，而是要**移植**

我这两轮（R136–R139）的交付形状是"一整块 `WebviewPanel` 装下整个 React SPA"，加上"以后把画布变成 custom editor"。
按他这句话，前者⛔ 是产品形态（workbench 沦为浏览器），后者还不够——**要搬的是三块功能，⛔ 是一块面板**：

| 板 | 现在的住法（行数现读，⛔ 猜） | 搬到宿主的哪个原语 | 判定"搬完了"的样子 |
|---|---|---|---|
| **A 绑定系统** | `src/lib/gateSystem.ts` **578** 行：`setActivePartBindings/getActivePartBindings` 那把**名→文件**的表存在 localStorage，`resolvePartRef`/`partExists`/`resolveDefCells`/`findPartCycle`/`rebindLiveGraph`/`ensureDefsFromCells` 全靠 `sandboxStore` 那份**内存文件表** | **壳已有的文件系统**：部件＝工作区里的真文件，绑定＝相对路径解析；改名/删除由 workbench 发事件，我们只跟着重绑 | 重命名 Explorer 里那颗文件 ⇒ 所有引用它的画布自己更新；`activePartBindings` 那把 localStorage 表失去存在必要 |
| **B 模块 + 层次结构** | `ModulePanel.tsx` **456** 行、`HierarchyViewer.tsx` **301** 行（都是自绘 React 侧栏） | 模块 ⇒ `DocumentSymbolProvider`（进原生 **Outline** 与面包屑）；层次结构 ⇒ `contributes.views` 的 **`TreeView`** | 那两块树是宿主画的：主题/折叠/搜索/快捷键/无障碍全继承；⚠ 顺带结掉在册 **T-3**（`parseVerilogInstances` 回**外部模块名**⛔ 实例名，`HierarchyViewer` 用错过） |
| **C 沙盒系统** | `SandboxCanvas.tsx` **3798** 行 + `sandboxStore.ts` **449** 行（`.djs` 正文**只在 webview localStorage**，宿主调用计数 0）+ `App.tsx` **1786** 行的模式编排 | `.djs` ⇒ **`customEditors` + `TextDocument`**（脏标记/保存/关闭/撤销归 workbench）；器件库与逐器件配置 ⇒ 命令 + QuickPick/原生视图；**只有 joint 画布与仿真时钟留在 webview**（那⛔ 能用原生 UI 画） | Explorer 点 `.djs` ⇒ 编辑器标签里开出画布，标题栏有脏点、Ctrl+S 保存、关闭询问都由宿主给 |

**顺序被依赖钉死**：A 的解析 substrate 就是"部件＝文件"，而"文件"这件事要 C 的文件那半落地才成立 ⇒
**片 4-C1（`.djs` 成文档）→ 4-A（绑定搬过去）→ 4-B（两块树）→ 4-C2（沙盒其余 UI，最后删掉那颗装 SPA 的面板）**；
B 独立，随时可切。工单已写进 `studio/README.md` §0b/§0c/§3（每块板都带"判定搬完了的样子"那一列，⛔ 让下一批自己解释）。

## 三b、追记一笔：分支名改成英文（同轮，他逐字）

**「分支名称不要带有中文，改成英文，然后继续逐步推进」** ⇒ `git branch -m agent版 agent`（纯本地改名：
`origin` 那侧从⛔ 建过这条引用，所以⛔ 需要删远端旧名，也⛔ 有历史要重写）。
⚠ 文档里他那句原话「往后的提交使用新的分支"agent版"提交」**照字留着**——那是**口径名**；
落到 ref 上叫 `agent`。往后所有提交都落 `agent`（"继续逐步推进"＝下一刀＝片 4-C1）。

## 三、这一轮⛔ 动的代码，与为什么值得单独一笔

判据一字未改（vitest **97/97** 仍绿、台架 4+8 臂不变）。分线与方向这两件事都⛔ 靠代码表达：
分线落在 git 结构上（`main`/`agent` 两条线＋一条指名 refspec），纠正落在**工单**上（§0b 那张表决定下一批往哪儿落刀）。
**工单写歪比代码写歪更贵**——代码写歪下一批能测出来，工单写歪会让接下来几批都在⛔ 该做的面上做得很对。

## 四、追加：片 4-C1 的**宿主半颗**落地（第 16 颗 RPC），与一颗藏了两轮的假 fs

他令「继续逐步推进」，第一刀落在 §0b 板 C 的前半：**让 `.djs` 先有磁盘这一份**。

| 项 | 读数 |
|---|---|
| 新增 RPC | `listSandboxTree` ⇒ 方法表 **15 → 16**（`host.ts` 接口、`vscodeHost.ts`、`browserHost`（**reject**）、宿主 `dispatch` 四处同一批；对账判据的计数下限同步提到 16） |
| 为什么⛔ 合并进 `listProjectTree` | **源码现读**（派子代理 map 出锚点，⛔ 猜）：`src/store/fileStore.ts:473-544` 的 `refresh()` 把回的每一颗都 `readProjectFile` + `parseVerilogModules`（:507）当 Verilog 导入，另有一条"磁盘上没了就从状态删"（:482-485）⇒ `.djs` 混进那颗表＝电路 JSON 被当模块解析＋沙盒那侧被牵动 |
| 两颗表的实现形状 | `ProjectStore.collect(exts)` **共用一次 walk**（跳过规则／"相对根、`/` 分隔"／空文件夹上报三件事同源）；台架 **M9**＝"沙盒那颗表把 `.v` 也收了" ⇒ 红 2 格 |
| 前端接缝（下一批要动的） | `src/store/sandboxStore.ts`：`verilog-viz-sandbox-files` 是 `Record<id, SandboxFile>`（`graphJson` 正文 + `partBindings` 都**在同一份 JSON 里**，:32），`list/create/save/rename/remove/move/copy/duplicate` **全同步**（:153-:405），**宿主调用 0 次**；UI 侧靠手工 `refreshList()`（`SandboxCanvas.tsx:185/:246`）而⛔ pub/sub ⇒ 所以 C1 剩下那半颗的形状是"开机一次性 hydrate（异步一次）＋运行时同步内存表＋改动 write-through"，⛔ 把 45 个调用点改成异步 |
| 真机 | brand 后起自有二进制开 demo ⇒ 标题 `Verilog Visualizer - demo - Verilog Visualizer Dev`、exthost 激活行在、`[error]` 0 行；demo 目录仍只有那 2 颗 `.v`（前端还⛔ 调这颗新方法，符合预期——**"新方法已存在"与"用户已经看得见"是两件事，⛔ 混着报**） |
| 判据 | vitest **99/99**（97→99）、台架 **9 臂全部有红**（还原后自检 0 红）、根 tsc / extension typecheck / eslint / `pnpm build` 各 0 错 |

**一颗藏了两轮的假 fs**：`tests/unit/vscodeShell.test.ts` 里那份内存 `memFs.readDirectory` 把根 `@root` 自己也当一颗子目录上报。
旧断言是 `expect(tree.folders).toContain('sub')` ⇒ 多出来的 `@root` 从没露头；这一批新增的 `expect(folders).toEqual([])` 当场逼出它。
**记下的规矩**：列表类判据⛔ 停在 `toContain`——松断言既放过分母，也放过**测试双自己的错**。修法是改假 fs（⛔ 把断言改宽去迁就它），
并把那一格升成 `toEqual`。

⚠ 第三次踩同一颗字：往文档里写盘符路径时反斜杠 + `v` 又被吃成垂直制表符（同一坑 R139 踩过、`studioBrand` 那格也写过）。
本轮起固化成收口动作：**写完先按字节扫 `0x0B`/`0x0C`**（这一批扫出 1 处，已修）。

## 五、追加：一条命令起我们自己的二进制——这颗 bug 只有"真跑一遍"抓得到，而判据当时全绿

他先要能测 ⇒ 产品入口收成 `pnpm studio:run`（`scripts/run-studio.mjs`：编缺的 → 编扩展 → 装进基座 →
起基座的 `code.bat`，`--user-data-dir` 显式给到与基座同级的 `profile`）。⚠ 一次性那步（基座 `npm install` /
`compile-client`，几 GB、几十分钟）**⛔ 代跑**，只把整条命令打印出来——替用户默默发起这种量级的动作是鲁莽。

**第一版这颗脚本是坏的，而 18 格判据全绿**：构建步骤与起窗口**共用了同一个 `cwd`（＝基座目录）**，
于是 `pnpm build` 在 Code - OSS 那份 checkout 里执行：

```
[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "build" not found
Did you mean "pnpm build-fast"?
```

症状看着像"本仓的 build 脚本坏了"，⛔ 是启动器把 cwd 传错了。判据测不到它的原因很具体：
注入的假 `spawn` 只记 `file/args`，**⛔ 记 `cwd`** ⇒ 补上"构建那颗的 cwd 必须等于仓库根、
只有起窗口那颗在基座"这两条断言，这一族才第一次有臂。

**规矩（本卷最值的一条）**：新写一颗会 `spawn` 的启动器时，判据至少要记**四件事**——`file`、`args`、`options`、**`cwd`**；
只记前三件的判据可以让"在⛔ 该跑的目录里跑"整族静默通过。而且这类"编排外部命令"的脚本，
**收口前必须真跑一次全链路**（这次就是真跑炸出来的：`› pnpm build` 2073 modules → `› 装进基座` 17 颗键 →
`› 起我们自己的二进制` ⇒ 窗口标题 `Verilog Visualizer - demo - Verilog Visualizer Dev`，10 颗自有进程）。

另外两处自己造的坑（都在同一批修掉）：
① 测试里 `process.env.X = saved` 在 `saved === undefined` 时会写成字符串 `"undefined"`
   ⇒ 后面每一格读到那颗 undefined，症状是"main 全部报基座还⛔ 就绪"（看着像产品逻辑错，其实是台架污染）；
   改成分路还原（原来没有就 `delete`）并加一格 `toBeUndefined()` 自证。
② `path.join('a','b').replace(/\/g, ...)` 这类"在 python heredoc 里写正则反斜杠"的操作第三次翻车
   （escape 被吃掉，测试文件直接语法错）⇒ 改成 `expect(calls[0].split(' @ ')[1]).toBe(ROOT)` ——**能比原值就⛔ 自己再规范化一遍**。

判据：vitest **117/117**（99→117，新增 `tests/unit/studioLauncher.test.mjs` 18 格）。
文档同批改口径：`README.md` 快速开始、`docs/GETTING_STARTED.md`（中英两处）、`docs/DEVELOPMENT.md`（脚本表 + 基座回路收成一行）、`studio/README.md` §2。

*（卷四十六完 · R140：`origin/main` 快进 5 笔到 `819563d`＝无 agent 那份；新分支 `agent`（他令：⛔ 中文分支名，建出来当轮就由 `agent版` 改名）从 `f050d56` 起接后续提交；
 套壳的定义改成"把绑定系统／模块／层次结构／沙盒搬到宿主已有的文件系统与原生视图上"，四刀顺序按依赖钉死；
 分支名按他后一句改成英文 `agent`）*
