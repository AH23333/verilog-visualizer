
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

---

# 卷四十七 · R141：⛔ 自写启动脚本——跑起来只用官方框架的命令（2026-10-14）

> 触发逐字：**「不要使用你自己编写的命令脚本，尽可能使用官方框架的运行命令」**。

## 一、这一句判掉的是我连做三批的东西

R138 我写了 `scripts/run-in-vscode.mjs`（`pnpm app`），R140 又写了 `scripts/run-studio.mjs`（`pnpm studio:run`）——
两批都是"把起一颗编辑器包装成我们自己的 CLI"。可基座本身就是 Code - OSS：
**`scripts/code.bat` 就是那个框架自带的启动脚本**，`--user-data-dir` 与位置参数就是它的官方 CLI 参数，
`--extensionDevelopmentPath` 是官方调试入口，`npm run gulp vscode-win32-x64-min` 是官方打包任务
（任务名按平台/架构在 `build/gulpfile.vscode.ts:610` 生成，聚合任务在 :626）。我⛔ 该再造一层。

同批删掉：两个 npm 别名组（`app` / `app:check` / `studio:run` / `studio:run:check`）＋两份专用判据
（`tests/unit/launcher.test.mjs` 9 格、`tests/unit/studioLauncher.test.mjs` 18 格）。⚠ **删的是包装，⛔ 是结论**：
"Windows 上 `.cmd` 必须走 shell 且每个含空格参数要各自带引号"、"一条命令起产品真跑通过全链路"
这些读数仍留在卷四十五/卷四十六里，回退代码走 git 历史。

## 二、顺手把最后一处"我自己发明的手工委"去了

`apply-brand.mjs` 里 webview 的来源改成**优先用 Vite 的 `dist/`** ⇒ 内置装载这条路不再需要
`pnpm -C extension webview:sync`（那一步真正服务的只有 `vsce` 打包，因为 vsce 只收 `extension/` 目录；
内置装载走基座官方那条 `extensions/<id>/package.json` 扫描）。本目录唯一剩下的自写脚本就是
`apply-brand.mjs` 本身，而它只做"把产物放进官方位置 + 合并官方 `product.json` 的几颗键"。
判据同批改：`builtinExtFiles` 现在收 `(extSrc, repoDist, fs)`，
新增"来源优先 dist/""两处都⛔ 有 webview 要报出来"两格——并特意⛔ 用原来那颗按 `endsWith` 匹配的假 fs
（两条候选都以 `index.html` 结尾，后缀匹配分不出来源，优先级那半句等于没判 ⇒ 换成精确集合比对）。

## 三、读数

| 项 | 读数 |
|---|---|
| 官方起窗口命令**真跑** | `scripts/code.bat --user-data-dir=D:\vv-studio\profile D:\vv-studio\demo` ⇒ 标题 `Verilog Visualizer - demo - Verilog Visualizer Dev`；exthost 里 `_doActivateExtension local.verilog-visualizer-vscode` **1 行**、`[error]` **0 行** |
| 装进基座 | `pnpm studio:brand` 输出"webview 取自 <仓库>\dist"，`extensions/verilog-visualizer/webview` 里 **9 颗文件**（assets/ + digitaljs.js + yosys/ + index.html） |
| 判据 | vitest **91/91**（117−27＝两份启动器判据随脚本一起撤）；根 tsc / `pnpm -C extension typecheck` / eslint / `pnpm build` 各 0 错 |
| ⬜ 打包那条官方命令 | `npm run gulp vscode-win32-x64-min` **本轮⛔ 跑过** ⇒ 记 UNVERIFIED，归片 5 |

## 四、本轮自己造的两处新类型自伤（都当场修，形状值得记）

1. **块注释里写 glob 会自杀**：我在 `apply-brand.mjs` 的块注释里写了 `` `extensions/*/package.json` ``——
   那串里的 `*/` 直接**关掉了注释块**，文件当场语法错（`node --check` 报 Unexpected strict mode reserved word）。
   症状很怪（报错位置在注释行），而 `npx vitest` 只回一句"invalid JS syntax"。⇒ 文档与注释里的 glob 一律写成 `<id>` 形式。
2. **第四次栽在同一颗转义上**：用 heredoc 里的 python 字符串往文档写盘符路径，反斜杠被吃掉、
   `\v` 变成垂直制表符（README 10 处、迁移台账 1 处、CHANGELOG 2 处，全靠按字节扫 `0x0B` 抓回）。
   ⇒ 固化成两条：**含反斜杠的正文改用 raw 字符串或直接 `cat` 写文件**；收口必扫 `0x0B`/`0x0C`。

*（卷四十七完 · R141：启动脚本两颗整颗删除，跑产品回到基座官方的 `scripts/code.bat` + 官方参数；
 `webview:sync` 那一步从内置装载路上去掉；vitest 91/91，打包命令记 UNVERIFIED）*

## 五、同日追加：他一句"太多了"，把官方命令收成**一条 npm script**

逐字：**「改成我只需要敲一条的」**。我上一条把三种计数（一次性 4 条 / 日常 2 条 / 交付 0 条）混成一段写，
读起来像"官方路线要敲一串"——表述错，形状也错：既然他要不敲第二下，那就该有一条入口，
而**入口可以不是自写脚本**：npm 官方就提供 `package.json` 的 scripts 组合机制。
于是 `pnpm app` ＝ `pnpm build && pnpm -C extension build && <基座>\scripts\code.bat "--extensionDevelopmentPath=%CD%\extension" "--user-data-dir=<与基座同级的 profile>"`。

两条实测细节值得记（都是老坑换了一副脸再来）：

1. **含空格的参数要各自带引号**：`%CD%\extension` 展出来就是 `D:\Visual Studio Code\...\extension`。
   R138 我为这事写过一整颗 `buildSpawn` 加 9 格判据；这次一行引号就够——**先去框架机制里找，⛔ 先写代码**。
2. **基座那次性的 heavyweight 根本⛔ 需要人敲**：官方 `code.bat` 第一步就是
   `node build/lib/preLaunch.ts`（缺 `node_modules` ⇒ `npm ci`；缺 Electron ⇒ `npm run electron`；
   缺 `out/` ⇒ `npm run compile`；再拉基座要的内置扩展）。我前面把它当成"用户要跑的四条命令"写进 README，
   是⛔ 读源码的后果——文档里那 4 条其实只有 `git clone` 一条是真的。

读数：`pnpm app` 整条真跑 ⇒ 标题 `[Extension Development Host] Verilog Visualizer - demo - Verilog Visualizer Dev`、
exthost 激活行 1、`[error]` 0 行；`--extensionDevelopmentPath` 直载仓库那份扩展 ⇒ 日常⛔ 再 `pnpm studio:brand`。
文档四处同批改（README 快速开始、GETTING_STARTED 中英、DEVELOPMENT 脚本表、studio/README §5）。

*（卷四十七补完 · R141：删自写启动器之后并没有退回"一堆手工命令"，而是用官方 npm script 收成一条；
 教训是"官方机制里已有组合与预装的入口，先读它们，⛔ 先自己写、也⛔ 先把它们摊给用户"）*

---

# 卷四十三 · 账本恢复记录（2026-10-12，双分支事故修复）

## 事故
e6e33d3（我的 docs 提交）把账本从 **833 行（卷一~四十二完整）** 提交成了 **31 行截断版**——根因：并行代理在其工作区把账本截断为"仅卷四十二"（或从旧快照恢复），我的提交把该截断版入了库。**卷一~四十一的历史在 main 分支（f050d56）完好无损**，无真丢失。

## 恢复
从 `1bd13bc`（我的 vscode-ext 提交，其树含 833 行完整版）取回，覆盖 agent 工作区。验证：833 行、卷一/三十九/四十二锚点全在。

## 双分支现状（**重要**，交用户裁决协作方式）
- **main**：verilog-visualizer 主线（本会话全部工作 + Tauri/WebUI），已推送至远端，账本 831 行版完好。
- **agent**：并行代理的 **VS Code 壳基座线**（`pnpm app` 启动链、`listSandboxTree` RPC、基座 scripts/code.bat）——用户裁决的 VS Code 形态承接线。我的 R134 两笔（vscode-ext 骨架 + 账本）**误落此分支**——但 vscode-ext 骨架与该线（基座集成）正好协同，建议**保留在 agent 分支**（是否 cherry-pick/merge 到 main 由用户裁决）。
- agent 分支此后由代理自己管理（分支/账本/提交节奏）；**我停止对该分支的一切写操作**。

## 未闭移交清单
1. vscode-ext 真机验收（扩展装载/三视图/fs 桥落盘）——agent 线
2. A3/S3 Rust 导出链路（需 cargo）
3. ESLint 648 warnings 渐进治理（tests/ 不在 lint 范围）
4. lib 单测安全网：tests/unit/lib.test.ts 13 格全绿（已由代理 R135 收口入库）

*（卷四十三完 · 恢复后本会话停止 git 写操作）*

---

# 卷四十五 · R136 验收清单核对：五项 UX 缺口逐项状态 + grammar 补齐（2026-10-12）

> 用户五项缺口清单（VS Code 形态）逐项对照在途代理与本人的最新产出。**实测方式**：contributes/grammars 源文件直读 + JSON 解析验证 + vitest 120/120。

| # | 缺口 | 状态 | 证据 |
|---|------|------|------|
| 1 | 右键菜单功能过少 | ✅ 已达丰富态 | `view/item/context` **22 项**：编译并查看/打开画布/打开模块项/重命名/复制/绑定部件（6 个视图面全覆盖）/部件角色切换/删除——contextValue 全配齐（codeFile/module/moduleFile/hierarchyItem/sandboxFile/sandboxDir/sandboxParts/sandboxHierarchy） |
| 2 | 顶部新建/刷新按钮 | ✅ 已实现（折叠=原生） | `view/title`：codeFiles→新建 Verilog 文件；sandboxFiles→新建电路文件/新建文件夹（navigation@1/@2）；refreshTrees 挂全部 6 视图（@8）。**"折叠文件夹"**：VS Code workbench 对 tree 视图自动提供 Collapse All 按钮（聚焦视图即出现），无需 contribute |
| 3 | 侧边栏空白处右键 | ⚠ 平台限制 | VS Code 原生 TreeView 的空白右键是 workbench 内置菜单（扩展无法自定义）——**等价物已就位**：标题栏按钮组（上格）+ `explorer/context` 右键（资源管理器里对 .v/.djs 右键同样可新建/编译/绑定） |
| 4 | Verilog 高亮不完备 | ✅ 已补齐 | 双 grammar（verilog/systemverilog）+ languages 声明；**官方关键字全集核对**：`end*` 家族/原语门/存储类型/修饰符/方向/强度均在册——实测仅缺 5 颗 specify 域小关键字（ifnone/pulsestyle_ondetect/pulsestyle_onevent/showcancelled/noshowcancelled）**本轮已补进 keywords**（JSON 有效复验） |
| 5 | 绑定入口单一 | ✅ 已多入口 | bindParts 六面右键（codeFiles/sandboxFiles/modules/moduleFile/hierarchy/sandboxParts）+ `explorer/context`（.djs 右键绑定）+ 模块树绑定描述回显 |

## 附加确认
- **双容器布局**：代码编译（codeFiles/modules/hierarchy）/ 沙盒编辑（sandboxFiles/sandboxParts/sandboxHierarchy）两容器各三视图，图标已配。
- **customEditors**：`verilogViz.doc` 接管 `*.djs` 双击（priority: default）——点沙盒文件直接开画布而非文本。
- **vitest 120/120**（在途代理 R142+ 新增测试并入：trees/customEditors/dispatch 等——本批 menus/grammar 变更零破坏）。
- **extension build**（esbuild）通过。

## 本卷改动
- `extension/grammars/verilog.tmLanguage.json`：keywords 补 5 颗 specify 域小关键字。
- （其余五项为在途代理已交付的验收确认，本卷不重复记改动。）

## 未闭（移交）
- A3/S3 Rust→已随 Tauri 拆除**整体消失**（R138 拆掉 src-tauri，导出走 VS Code 原生 showSaveDialog——**卷一 A3/S3 两条随宿主更替自然消亡** ✓ 账本闭环）。
- ESLint 648 warnings 渐进治理（下批）。

*（卷四十五完 · 五项缺口四项已实现、一项平台限制如实说明）*

---

# 卷四十八 · R137-B 目录级显式绑定：`.verilogviz.json` 上盘、分层合并、手改即生效（2026-10-15）

> 用户三轮验收的残余不满聚焦一颗：**绑定仍是隐式的**——看不见文件、不能手改、"改了没反应"。裁决落地："绑定关系必须像 `.vscode/settings.json` 一样：目录里有部件，目录里就有它的 `.verilogviz.json`。"

## 一、设计兑现（四刀）

| 刀 | 内容 | 落点 |
|---|---|---|
| 1 | **目录链读写**：`readMetaAt/writeMeta(dirRel)` + `dirChain`（文档目录→…→根）+ `bindingsForFile` 远→近合并、各层值按本层目录相对解析（`resolveLayerValue` 折 `../`）；`setBinding(docUri?)` 写文档所在目录表；`setDocBindings` 同层整表替换；`ensureDirMeta/ensureDirsMeta`（目录有 .djs 缺表⇒建模板，**⛔ 覆盖手编内容**）；`openBindingConfig`（ensure+原生编辑器直开+指路 toast） | `extension/src/sandboxFiles.ts` |
| 2 | **RPC 升级语义、方法名不变**：`getAllBindings` 带 `args.doc` 走链（不带＝根表，兼容旧调用与测试对账表）；新增 `broadcastBindingsChanged`→ sinks 推 `{vvh:'push',op:'bindingsChanged'}`；`setDocBindings` 落盘后广播；`copyToSandbox/importLegacyData` 落盘批次 `ensureDirsMeta` | `extension/src/dispatch.ts` |
| 3 | **宿主接线**：`bindParts` 二级 QuickPick 选完即写目录表 + 刷新两树 + 广播 + 「打开绑定配置」动作钮；`**/.verilogviz.json` 第三颗 watcher（改⇒广播、删⇒刷树）；`renameFile` **各层绑定+circuits 同步迁移**、`deleteFile` **悬空绑定逐层清除**（改名/删除命令调用侧统一 broadcast+refresh）；`openBindingConfig` 命令注册 | `extension/src/extension.ts` |
| 4 | **webview 消费面**：`host.getAllBindings(doc?)` 签名贯通（browserHost 空档零参兼容）；DocApp init 按文档链取绑定 + `bindingsChanged` 推送**重读链重挂部件源**（siblingsRef 镜像）；`customEditors._siblings` 装载时 ensure 文档目录表；contributes：`openBindingConfig` 命令 + `view/item/context` 五面 + `explorer/context` 两面（`.djs`/`.v|.sv`） | `src/lib/host/*`、`src/doc/DocApp.tsx`、`extension/package.json` |

**normalizePartName 红线**（一颗函数拆两半的教训）：`.djs` 双后缀剥成单尾（`test_files/.verilogviz.json` 的 `fsm_controller.djs.djs` 实证），但**已有 `.v`/`.gate` 扩展的原样保留**——第一版无脑强加 `.djs` 把 `.v` 闭包部件写成 `adder.v.djs`＝`resolvePartRef` 永久解不到＝用户体感"绑了没反应"的**机制本身**；新用例专门钉死这条。

## 二、闸门（+7 格，先红后绿的完整链）

`tests/unit/extensionHost.test.ts` 专块「R137 目录级显式绑定」7 格：目录写层（⛔ 污染根表）/链合并近层胜/`setDocBindings` 值相对化 round-trip/归一四态/直开⛔ 覆盖+缺表先建/**重命名各层迁移**/**删除清绑**；watcher 格升为"三颗 watcher+`bindingsChanged` 广播接线+`.v` 那颗⛔ 混线"。四颗旧红的收口全部**改信号不动实现语义**：命令清单加 `openBindingConfig`、queue 喂真实列表形状（根相对带扩展名全路径）：
- 用例 1 我喂裸名 `'full.djs'`（真实二级选项是 `lib/full.djs` 根相对全路径）⇒ 值落成 `../full.djs`——**实现是对的，我的 fixture 错**；
- 用例 2/3 忘扒 rpc 返回包（`.data`）——helper 返回整颗 res 不是 data；
- 用例 4 抓到**两个真 bug**：桩 `joinPath(uri,'..')` 不折叠 ⇒ `newFull` 带 `../` 脏形（实现层 `resolveLayerValue` 折死双保险）；`circuits` 迁移错去文档层表查找（它是**根表语义**，与 `getCircuitsSet` 同层）。

`tests/unit/vscodeApiStub.ts` 两颗纯签名拓宽（`showTextDocument(_, _o?)`、`showInformationMessage(m, ...items)`），返回行为一字未动——真实 vscode 类型本就接受这些实参。

## 三、验证读数（全部本轮实测）

| 判据 | 读数 |
|---|---|
| 根 `tsc --noEmit`（paths 把 `vscode` 指测试桩的那张配置） | **0 错** |
| `vite build`（双入口 canvas.html/doc.html 链过 DocApp/host 改动） | **✓ built in 3.88s** |
| `extension` 自有 `tsc -p ./` + `esbuild.js`（真构建判卷人） | **0 错 / 0 错** |
| `vitest run tests/unit` **全量** | **127/127**（原 120 格 + 净增 7，无一颗旧格被放宽） |

期间自我纠正一颗流程错：首跑 vitest 挂 `--reporter=basic`（v5 已移除）⇒ 进程启动即亡、日志 0 字节——**ENV 自伤不是产品**，去参重跑即好。

## 四、未闭/移交
1. **真机点验**（用户）：树右键「打开绑定配置…」直开 `.verilogviz.json`→手改绑定值→保存→活画布部件源即换——本机无 GUI 壳实测条件，留验收。
2. **手编值无扩展且实际文件是 `.v`** 时的解析层猜扩展——当前 bindParts 写的值恒带真扩展不受影响，纯手编体验项，不抢做。
3. 并行代理在场：本卷改动**全部留在工作区⛔ 提交⛔ push**（卷四十三收口纪律维持），由代理/用户自行收编入库。

*（卷四十八完 · 绑定系统的"看得见、改得动、改完就生效"三件事闭环，127 格全绿）*

---

# 卷四十九 · R144 质检轮：「记录即权威 + 自动兜底显形」+ 右键全家桶 + 台架三处假绿根除（2026-10-15）

> 用户质检意见四条：①配置文件没内容却能正常编译/查看绑定＝不合理；②编译侧边栏缺「新建文件夹」钮；③两模式右键功能过少＋空白处右键仍缺；④深度自检——要的不是"能运行"，是**全流程无差错**。

## 一、先取证：「空文件一切正常」底下是三套表外机制

| # | 机制 | 定性 |
|---|------|------|
| 1 | .djs 画布：表空时 resolvePartRef 自动同名兜底渲染 | 旧项目行为，但 UI 把"自动"与"录入"混显＝显示撒谎 |
| 2 | .v 编译：闭包全工作区同名扫描，**根本不消费绑定表**；bindParts 二级清单又只列 .djs ⇒ 录进表的值永远被 override 判定跳过（只认 .v/.sv） | **死配置**——用户观察 100% 成立的机制根因 |
| 3 | copyToSandbox (n) 改名时旧实现靠"自动补录"写全局表（R136 后写表面没启用）⇒ 撞名子部件的实例回头命中**旧定义**（sandbox-copy-name-binding-pitfall 在册坑复活） | 静默错位 |

**用户裁决（question 工具）**：「记录即权威 + 自动兜底显形」——录了名＝照表办事（解不到报错⛔ 回落）；没录＝自动兜底但界面上标明"自动·未录入"，一键固化。

## 二、实施（七刀）

1. **compilePanel.ts**：closureOf 读绑定链，.v/.sv 值＝权威覆盖；文件缺失/不含模块 ⇒ job.bindingErrors＋红字 toast（相邻同签名去重防 save 刷屏）；未录入仍走同名扫描。
2. **extension.ts bindParts**：一级 QuickPick 逐项标「已录入 → x」「自动同名 → y（未录入·可固化）」「⚠ 无来源」；**二级清单按模式分家**（.v⇒listTree 的 .v/.sv/.vh，.djs⇒listSandboxTree）——断链修复；成功 toast 带「打开绑定配置」动作。
3. **materializeBindings（新命令）**：自动命中且未录入的当场写进目录表；已录入⛔ 覆写。挂两模式文件/模块面右键＋部件面。
4. **copyToSandbox 撞名即固化**：本批第一颗（主电路）外的子部件改名 ⇒ 原裸名→新名写目标目录表；主电路改名⛔ 进表（死条目）。
5. **右键全家桶**（照旧 UI 盘点：App.tsx 文件/文件夹/空白根＋SandboxCanvas 画布三族）：新命令 duplicateFolder（含 .djs 才建表）、importFiles（多选→(n) 让位→ensureDirsMeta）；sandboxDir 补 新建电路/新建 .v/新建子文件夹/导入/复制文件夹；两模式文件＋部件面补 vscode.open（用文本编辑器打开）；**编译侧标题栏补「新建文件夹」钮**（用户点名）＋两侧导入钮；**四视图 viewsWelcome** 空态引导（新建/导入/示例可点链）——空白处右键＝VS Code 平台⛔ 扩展自定义（卷四十五在册），替代面做到顶。
6. **手编 json 编译侧同权**：recompileOnSave 认 .verilogviz.json（画布 bindingsChanged 即时、编译侧⛔ 要重按 F5 的两面终结）。
7. **rename 的 circuits 迁移改回根表**（层错位修正，接上卷四十八第④条遗留）。

## 三、台架深自检（三处"假绿温床"连根拔）

台架查案的收获比功能本身大——**三处桩在撒谎，旧用例全靠它们才绿**：

| 桩缺陷 | 真相 | 收紧后爆出的问题 |
|---|---|---|
| Uri.joinPath＝纯串接⛔ 折 .. （原注释明写"射程声明"） | 真宿主会折；台架不折＝**教产品代码写错用法** | duplicateFolder/importFiles/new 族靠 joinPath(uri, '..') 取父目录，桩下键名畸形（红×3）→ 修桩＋ **key 层同步折叠**（磁盘等价：a/../b≡b） |
| fs.copy **删源**（rename 的形状混进了 copy） | 真 copy 不删源 ⇒ duplicateFile 在桩里会静默毁原文件 | 桩修"复制不删源"＋用例钉（⛔ 删源回归） |
| showQuickPick 队列⛔ 验成员（列表外也能"选中"） | 真宿主只能点列表里的项 | 揪出两处**假 fixture**：bindParts .v 用例二级选 'parts/adder.v'（SEED 里根本没有这文件）、.djs 用例选不存在的 counter.djs——**断链 bug #2 全靠它才从没爆红**；openExamples 无 label 伪造对象同现形。全部换真实成员——**收紧判据不是放宽** |
| （附）缺 showOpenDialog/openDialogResult；showInformationMessage 单参签名与真宿主漂移 | — | 补齐（...items 兼容拓宽，行为不变） |

用例同步收口：SEED 部件名必须真实存在；manifest 命令清单＋3；copyToSandbox 双钉（子部件撞名写表/主电路撞名不进表＋未撞名⛔ 乱写）。

## 四、验证读数（全部本轮实测）

| 判据 | 读数 |
|---|---|
| 根 tsc / vite build / extension check（tsc+esbuild） | 0 / ✓3.7s / 0 / 0 |
| vitest 全量 | **137/137**（128→137：R144 专块 9 格＝编译权威×2、固化×1、目录右键×1、复制文件夹×1、导入×1、端到端绑定全链×1、固化双钉×1、手编 json 编译同权×1；零旧格放宽） |
| eslint --quiet | 0 错 |

## 五、未闭
1. **真机点验**（用户）：bindParts 一级来源描述肉眼对一眼；固化后表内容当场可见；手编 .v 表保存→编译面板自动重推；`.djs` 部件右键「用文本编辑器打开」看到 JSON 源。
2. .v materialize 的 resolver＝闭包同名（scope/root 近似）——全库深同名不固化（保守正确，文档口径 §3.6）。
3. 并行代理在场：本轮全部改动**⛔ 提交⛔ push**（卷四十三收口纪律），工作区交用户/代理收编。

*（卷四十九完 · 用户四条质检意见逐条闭环＋台架三处撒谎根除，137/137 全绿）*

---

# 卷五十 · R145：多层电路绑定前缀键 + `_siblings` 跨目录断链 + 空白根右键换等价落法（2026-10-16）

> 用户两点：①侧边栏空白处右键仍然无内容；②「继续分析 json 文件，做出裁决——当前 json 似乎只针对一个文件的电路内部件绑定，**没考虑多层级的电路情况**」。

## 一、②多层级模型裁决（用户点破的缺口，取证后成立）

现有 `{celltype: 部件文件}` 是"整表一张纸"：`ctrl` 层与 `top` 层各例化同名 `adder` 却想要不同实现 ⇒ **无法表达**。裁决 = **前缀键**（JSON 侧新增表达通道，UI 面不动）：

- 键两形态：`adder`（裸，全局兜底）与 `sub/ctrl.djs::adder`（前缀＝宿主文档根相对名，只约束那**一层**的 adder 实例）。
- 解析优先：前缀（当前宿主层）> 裸键（录入）> 自动同名 > 无——`resolvePartRef(name, scope, ctxDoc)` 第三参；`resolveDefCells`/`findPartCycle` 递归逐层携带宿主名（`partCellsRaw` 返回 `{cells, host}`）；顶层上下文＝活动文档（`setActiveCtxDoc`，SandboxCanvas 换档 effect 同点喂）。
- `.v` 编译闭包同规则（按当前展开文件 `f.name` 试 `${f.name}::inst` 再试裸）——两层世界一视同仁。
- 链合并输出把**层表里按本层目录书写的前缀**折回根相对（`bindingsForFile`）；`renameFile` 宿主改名 ⇒ 前缀键随迁；`deleteFile` 宿主删除 ⇒ 随清。
- **前缀键＝手编专属**（bindParts/materialize 只写裸键）——表达力在文件里，常用面留在 UI；与 `.verilogviz.json` 的"可见可手改"哲学同轴。

## 二、取证连环揪出的两颗真雷

| # | 雷 | 修复 |
|---|---|---|
| 1 | `customEditors._siblings` 只装"同级+根"的 `.djs`——绑定值 `alt/impl.djs` 这类越层路径**在画布候选集里根本没那颗文件** ⇒ "录了没生效"的结构性断链（与 R144 的死配置链不同层，这轮才现形）| 全工作区 `.djs` 全量（数组序同级→根→其他稳垫底，打分语义⛔ 变；lib/r121 等旧行为零回归）|
| 2 | `settingsStore` 顶层 `applyFontSize` 摸 `document`——gateSystem→sandboxStore→settingsStore import 链让**纯逻辑单测在 node 环境直接炸**（extensionHost 之外新增 lib 侧前缀用例时现形）| 无 DOM 守卫（懒约定的存储层同款；老坑在册未穷尽的一族）|

## 三、①空白处右键：平台实证复核 + 等价物换形

官方渠道复核（vscode-discussions 2025-02，扩展作者请愿答复）：**常规 TreeView 的 context menu 只支持挂在 TreeItem 上，空白区无扩展贡献入口**（webview view 的 webview/context 是另一条重路线，⛔ 六树整体翻筑）。据此放弃"给空白区硬挂菜单"的执念，换**常驻虚拟动作节点**：codeFiles/sandboxFiles 首行「⋯ 文件操作（右键：新建 / 导入 / 刷新）」（contextValue＝vvRoot；六连菜单=新建电路/新建 .v/新建文件夹/导入…/打开绑定配置/refresh；点击＝直发主动作新建档）——旧 UI onRootContextMenu 的**能力面**（不是鼠标坐标学）全数可达。viewsWelcome 空态/标题钮继续垫底。真机验收点：树首行可见、右键六项齐、点击建文件落根。

## 四、验证读数（全部本轮实测）

| 判据 | 读数 |
|---|---|
| 根 tsc / vite build / extension check | 0 / ✓（11.4s，webview+host 两侧改动过链）/ 0 / 0 |
| vitest 全量 | **141/141**（137→141：R145 专块 3 格——编译前缀只管那层（ctrl.v::adder 赢、顶层裸扫描⛔ 顶包）/链前缀折根相对/宿主改名迁移+删除随清；lib.test resolvePartRef 前缀格 1（含"无 ctx＝旧世界"零回归断言））|
| eslint --quiet | 0 错 |
| codeFiles 树形状格 | 升级"rootAction 首节点 + contextValue=vvRoot + 其余文件列表"三段断言 |

自我纠一处台架操作错：给 R144 块尾部追加 R145 时 newString/oldString 锚点失配导致 describe 提前闭合、`.v 绑定全链`格掉到顶层（esbuild Unexpected "}"现形）——按行号读实况后一步归位并给 R145 域自带 compile helper；教训登记：**跨 describe 追加必须锚"块内最后一格尾+块尾"两段并全文重读，⛔ 拿中间某格当锚还期待别处括号自动平衡**。

## 五、未闭
1. 真机点验：vvRoot 首行右键六连菜单肉眼过；前缀键手编保存后嵌套画布分层显形（bindingsChanged 重灌吃新键形）。
2. 前缀键 UI 化（bindParts 写 `${doc}::` 精控入口）——刻意暂缓，等用户手编流程跑顺再评。
3. `_siblings` 全量化后深目录大仓的记忆体积/装载耗时——量级（工作区 .djs 计数）无实测数据前不做预防性优化。
4. 并行代理在场：本轮改动照旧⛔ 提交⛔ push，工作区交用户/代理收编。

*（卷五十完 · 多层电路的表达缺口按裁决补平，取证顺带拔掉两颗跨目录断链/顶层 DOM 的雷，空白右键换成可验收的等价形，141/141 全绿）*

---

# 卷五十一 · R146/R147：绑定完整性（不齐＝可见+一键写全+可严格拦截）与「真·空白右键」webview 通道（2026-10-16）

> 用户两点：①虚拟"文件操作"节点方案被否（"不符合预期"）——空白处右键要的是**真的右键就有菜单**；②绑定配置依旧不完善——**没配完所有子部件依旧可编译**，且沙盒模式也要这套功能。

## 一、①撤掉丑方案 + 走平台正规的 webview/context 通道

根Action 虚拟节点整族拆除（树节点、menus、类型）。查证（官方讨论区 2025-02 请愿答复在册）：常规 TreeView 空白区**没有任何**扩展自定义右键入口；平台给的正道是 **WebviewView + webview/context**——webview 里空白＝我们自己的 DOM：行元素带 `data-vscode-context` JSON（键注入 when 上下文、值同时作为命令实参），右键落行=>项菜单、落空白=>只剩不带行级键的"根菜单"。**旧 UI 三级右键（空白/文件夹/文件）在此形态下原样复活。**

- 新视图 `verilogViz.projectFilesCode` / `verilogViz.projectFilesSandbox`（两容器各一，标题「文件（右键可用）」，type webview），与 six 原生树**并存**⛔ 替换（零回归策略，验收满意后原生树可关）。
- `extension/src/filesWebview.ts`：ProjectStore 同款根扫描 + 拍平行列表（目录行/文件行/circuits 圈标签）；行点击 postMessage→宿主 executeCommand（**复用既有命令族不复制业务**）；行右键/webview/context 菜单 4 档：空白根菜单（新建/新建夹/导入/绑定配置/刷新）、文件行（打开/编译、改名/副本/删除、绑定四件套）、目录行（在此新建/副本文件夹/删除/导入）。CSP nonce 内联脚本。
- `menus.explorer/context` 另补 `!resourceScheme` 空白族（资源管理器空白右键＝Native 新建/文件夹 + 我们的导入/刷新）——两入口都真。
- 台架：stub 补 `registerWebviewViewProvider`（缺之 activate 即炸——注册类 API 补桩纪律再犯一次登记）；WebviewView/WebviewViewProvider 类型形状；`menuUri` 宽容第三形状（webview/context 实参 {vvPath}）。
- 调试两课：render 里 `rel.slice(dir.length+1)` 在 dir 空时吃首字母（top.djs→op.djs，测试 html 肉眼抓的）；根前缀折叠改 posix path + 大小写不敏感比较（盘符两处宿主形状不一）。

## 二、②绑定完整性：「没配完依旧能编译」终结

在 R144"记录即权威+自动兜底显形"骨架上补全**完整度**维度（三面同权）：

1. **可见**：画布 doc 模式顶部提示条（`data-sb-bind-audit`，紧挨 cycleWarn 条）——列"靠同名兜底、未录入配置"的实例数与前 4 个名字＋「写全配置」按钮；数据源＝gateSystem autoHits（partCellsRaw 在**打分兜底命中**处记账、录入命中处销账——画布实解真相，⛔ 宿主再模拟一层口径）。
2. **一键写全（三层落点）**：
   - 画布按钮→`op:completeBindings`→customEditors completeFromHits→目录层表→回执 `bindingsWritten`→webview `clearAutoHits`（⛔ remount 重载——会吞未保存编辑；写前实解＝写后记录，视觉零变化故无需重画，下次装载自然重新审计）。
   - 右键命令 `verilogViz.completeBindings`（不打开画布也可用）：`collectInstanceHits` 宿主 BFS（.djs 逐层读 cells 复刻 scope 打分含 circuits role；.v 闭包+scanDefs；环/预算护栏 300）。
   - 右键核查 `verilogViz.auditBindings`：warning 点名未录数与样本，动作钮「写全配置/打开绑定配置」直达。
   - **裸/前缀规则**（completeFromHits）：同 celltype 跨层命中**不同**文件 ⇒ 全部前缀键（裸键是整表级语义会越权顶别层）；唯一宿主+唯一文件才裸；ctx≠本文档层的单条也强制前缀。**已录入（裸/前缀）⛔ 覆写**。UI 侧仍只产裸值（bindParts/materialize），前缀键归写全/手编——"完整但可读"的平衡。
3. **可拦截**：新设置 `verilogViz.bindings.policy`＝auto（默认，兜底+提示）| **strict**（未录入⇒编译红字拒绝、画布不吃兜底）：closureOf 在 strict 下把未录同名命中判错（⛔ 兜底继续糊弄），gateSystem.setBindingPolicy 同语义（resolvePartRef 打分链 strict 短路）；配置经 `getConfig.bindings.policy` 注入 DocApp/CanvasApp（configChanged 刷新）。默认 auto＝尊重既有工程（空表项目瞬间全红这颗雷 R144 选型时已排过），用户要"必须配全才编译"切 setting 即得。**沙盒模式同样吃这三面**（提示条/写全/策略）。

## 三、闸门与读数

| 判据 | 读数 |
|---|---|
| 根 tsc / vite build / extension check / eslint | 0 / ✓6.5s / 0 / 0 |
| vitest 全量 | **147/147**（+6：R146/R147 专块＝audit 点名+写全落表面、全层 BFS、裸/前缀冲突规则、strict 编译门、webview 视图装载+两档菜单在册、画布按钮回执⛔ remount；升级 2 旧格＝manifest 命令表+views 四列含 webview 与 provider 装载断言；codeFiles 格含"⛔ 回潮"钉）|

## 四、未闭
1. 真机点验：webview 文件视图**空白处右键**弹出根菜单（这是本轮判决性体验，台架只能证"数据通道全对"）；画布提示条出现/写全即隐；strict 切换即拦。
2. 验收满意后原生 codeFiles/sandboxFiles 树去留（两全其美并排 vs 下线原生）——用户拍板。
3. 并行代理在场：改动全部留工作区⛔ 提交⛔ push。

*（卷五十一完 · "空白右键"从解释平台限制升级为走通平台正规通道，"配置不齐也能跑"升级为"可见-可写全-可拦截"三面闭环，147/147 全绿）*

---

# 卷五十二 · R147-R150：被否两次的"新区方案"到原位 webview 迁移——空白右键的功能形态终定（2026-10-16）

> 用户三连否决的记录（每一票都改了设计）：①"专门的『文件（右键可用）』区域是我叫做的预期吗？"——否**并排新区**；②此前否**虚拟动作节点**；③最早否**"平台限制"的解释**。终形态＝用户原话的方向：**原来那颗「文件」视图本身，空白处右键就能用**。

## 一、终形态（原位替换，⛔ 新范式⛔ 新区⛔ 假节点）

两张「文件」视图（codeFiles/sandboxFiles）**id 与位置不变、type 换 webview**（WebviewView + webview/context）——重构前那本来就是 webview 自绘的 React 树，右键空白出菜单是它的原生形态；本次＝功能对等回归。行＝目录分组折叠（state 记忆）+ 文件行（大小/圈标注）；点击走既有命令族（executeCommand 转接）。原生侧 createTreeView 从六颗减为四颗（modules/hierarchy/parts/sandboxHierarchy）；「层次（沙盒）」视图整颗删除（R149 用户裁定：子电路信息看画布即可，树是冗余层——trees.ts SandboxHierarchyTree 整类拆除、菜单/欢迎语/RPC 同步收）。

菜单账本：webview/context 三档×两视图（空白根菜单 5 条：新建电路/新建 .v/新建文件夹/导入/绑定配置/刷新；文件行 9 条：打开/编译、改名/副本/删除、部件角色、绑定四件套；目录行 6 条）＝37 条；view/item/context 迁走 9 条原生家拆净（"⛔ 双轨残留"钉子）；两轨合计 ≥50（口径从 20 收紧，搬家不是裁剪）。manifest 六视图格、createTreeView 格、codeFiles 形状格、R146 格全部按新形状**改写判据**（⛔ 放宽）。

## 二、"绑定配置必须配完"的三面收口（R147-R150 合并观）

| 面 | 现状 |
|---|---|
| 实时可见 | gateSystem.getBindingAudit(rootCells)：不靠展开记账、对**当前画布逐层递归 cells**（环/深度护栏；strict 被拦的也点名），未录入即亮画布提示条——"开文档没编译就显示空账"那一族根除 |
| 一键写全 | 提示条「写全配置」（审计真相→宿主表）＋右键命令「写全绑定配置/检查绑定完整性」两轨（⛔ 打开画布可用，collectInstanceHits 盘上 BFS）；裸/前缀规则防跨层越权；customEditors 消息通道 + .verilogviz.json watcher 双保险回灌 |
| 可拦截 | bindings.policy=strict：.v 编译红字拒收、.djs 画布未录部件按 ⛔ 兜底解析＝空壳⟲渲染＋提示条——不配完就"用不了"的体感两面一致；默认 auto 留兜底＋引导（老项目不瞬间全红） |
| 沙盒模式 | 提示条与写全在 doc 画布（沙盒编辑＝同一张 .djs 视图）原生可用；「部件角色/绑定四件套」全迁 webview 行菜单 |

## 三、台架与流程自查（本轮自我纠登记）

- **参数名连环错**：edit 工具 snake_case/camelCase 混用触发 invalid_type 两次——按 schema 原文重发，不猜别名。
- **误删相邻行**：给"主电路改名"格加内容时 oldString 多带一行导致删除孤儿——恢复后教训：锚必须带足前后上下文成对出现，追加类改动用"锚内重发全文"⛔ "锚行截断"。
- **探针 console.log 混进用例**：临时调试输出判卷前清掉（测试文件⛔ 留噪音）。
- **stub 双注册防错**：createTreeView 与 registerWebviewViewProvider 同 id 双注册＝"两轨残留"断言直接判红（本轮加钉）。
- getBindingAudit 的 covered 判定与展开判定**同口径**（裸键或该层前缀键任一在册）——两处口径不同＝"条说没配全、画布明明按记录走"的新谎言，代码注释钉死。

## 四、验证读数（全部本轮实测）

| 判据 | 读数 |
|---|---|
| 根 tsc / vite build / extension check / eslint --quiet | 0 / ✓11.1s / 0 / 0 |
| vitest 全量 | **147/147**（六视图格改写为"4 原生+2 原位 webview+⛔ 新区回潮"；菜单口径 50；KINDS 双轨钉；codeFiles 形状格含 webviewId 根菜单/文件行钉；R146 格换新 id）|

## 五、未闭（真机点验＝这轮的判决项）
1. 「文件」视图**空白处右键**＝原生观感的根菜单（新建/导入/刷新…）；文件夹/文件行右键＝项菜单；这是三轮否决后的终验收点。
2. 提示条：strict 下空壳显示+条点名；「写全配置」点击后表内容即时可读、条即隐。
3. webview 文件视图的折叠记忆在视图隐藏/重开后仍在（getState 通道真机复核）。
4. 并行代理在场：本轮改动照旧留工作区⛔ 提交⛔ push。

*（卷五十二完 · 两次被否换来的终形态：原位替换、菜单总数不缩、绑定三面闭环，147/147 全绿）*

---

# 卷五十三 · R150 续：webview 模板串里的 TypeScript as 断掉了左键（右键好使≠通路全好）（2026-10-16）

> 用户一句话点破：「你做好了右键，却无法左键点击了」——右键＝VS Code 平台层机制（不依赖注入脚本），左键＝全靠注入脚本活着。**模板串里 e.target as HTMLElement 一行 TS 语法＝整段浏览器脚本 SyntaxError 罢工**：折叠/点击/选中全灭，列表照常显示——tsc/esbuild 都看不见字符串内部，四道编译闸集体失明。

- 修复：脚本改纯 JS；顺带清掉死行（.row[dir] 查询/无意义 toString）与 dir 行 nm 防御（改 dir 行整行点击=折叠）；沙盒左键路由从 builtin vscode.openWith 改自家 verilogViz.openDoc（少一处平台形状依赖）。
- 新闸两张（R150 补）：**纯 JS 编译闸**——抽出视图内联脚本喂 new vm.Script（语法不过＝浏览器罢工，与运行时同判据）；**左键端到端**——向 view 的消息通道打 open 报文，code 路 assert showTextDocument 流水账、sandbox 路 assert openWith(doc 编辑器) 流水账（盘符大小写两处宿主不一，断言判低形）。
- 流程账：本轮又踩 PowerShell 内嵌引号炸一次（探针脚本转义死）——按在册纪律一次炸即落差盘 .cjs；edit 参数名 snake/camel 混错两次——invalid_type 即按 schema 原文重发不猜别名。
- 读数：149/147→**149/149** 全绿，验证链/ESLint 0；「右键能用」与「左键能用」从此在同一张闸门名单里。

*（卷五十三完 · 一条 as 的学费：webview 注入物＝浏览器地盘，编译闸照不到，必须专闸）*

> **R150b 续案（同日 15:10 收口——用户一句"仍未修复，且文件夹的展开显示有问题"）**：上一格修完 `as` 后真机照旧断，因为还有一颗**同族更毒**的雷——HTML 大模板串的**注释里写了反引号**（`` `as` `` 这种写法），esbuild 把外层模板从中间撕成两截：撕剩的 bundle 只有半句脚本（折叠逻辑与左键绑定整段蒸发），而 tsc ✓ esbuild ✓（它自己"合法地"截断）vm 闸 ✗ 恰好截断片段自洽能编译＝**三重失明假绿**（上一卷刚立的 vm 格被同一个字符串形态骗过）。同时坐实：bundle grep `ancestorsOf` 假阴性差点把我引向"用户没重载"的甩锅——**判卷判产物、不判记忆**的 bundle 闸（r150-bundle-gate：构建后核脚本完整性骨件+窗口右缘）从此在册。
> 修复：模板内反引号清零＋注释自我警告；vm 格升级**内容完整性断言**（acquireVsCodeApi/applyFold/postMessage 必须同框，语法自洽但缺骨＝红）；切片 off-by-one（`</script>` 尖括多吞）当场由新格逮住——**新闸当天就立了功**。文件夹显示顺手校正：双箭头图标（▾+⏷）拆剩单一 ▾随折叠旋转、目录/文件按层级真缩进（padding 深×14px）、折叠隐藏逻辑重写（file 与 dir 行同走祖链）。左键若再断流：宿主侧改为**大声报错**（⛔ 可选链静默吞）。
> 终读数：149/149、四重终验全绿（tsc/build/check/ESLint）+ bundle 闸 OK。

---

# 卷五十四 · CONFIG_PROTOCOL v0.1→v0.2：拆平行体系之雷、立 agent 地基（纯设计文档，动码为零）（2026-10-16）

> 用户令：协议关系 LangGraph agent 大量增长的地基，慎重评审、按评审方案修订 docs/CONFIG_PROTOCOL.md。

- **评审定性**：v0.1 骨架正确（schemaVersion/原子写/密钥隔离/诊断指针全是该反哺现状的好东西），但绑定与编译两章是「给另一个项目做的提案」——project.json 里再造带 scope 键层的对象式 bindings，与刚落定的目录级 .verilogviz.json 链（裸/前缀键、policy auto|strict、固化审计、多轮裁决 + 149 格闸门钉死的唯一真源）正面双轨；nextpnr/bitstream/pcf/openocd 全链当前管线（yosys→write_json→网表画布）无消费方；user/workspace.json 与 VS Code 原生双 settings 三轨；旧映射表还停在 localStorage 时代（partBindings/fileStore 行已过时一代）。
- **v0.2 落笔**：三配置域定界（A=contributes.configuration 标量、B=.vv/ 结构化共识、C=目录级 .verilogviz.json 权威链），域间冲突 CONFIG_DOMAIN_CONFLICT＝诊断不是行为；绑定章整节改写「现状协议化」（链合并/前缀语法/normalizePartName 进 schema pattern、审计三轨/撞名固化/迁移随迁入册）；编译分「现状对位表（零新账）+ 二期最小档案」；agent 升一等七小节：engine 缺位即未激活、graph 注册表（task 引用校验）、providers+secretRef 命名规范与缺值引导、tools 清单（权限枚举 fs-read/fs-write/spawn/net + sideEffects + requiresApproval + uiCommand 锚回命令面板）与 agent.profiles 授权两本账分立、checkpointer（sqlite/TTL/onGraphChanged）、audit JSONL+traceId+storeArgs 脱敏+⛔ 写 git commit、运行预算与 runtime 一次性覆盖分离、configHash 快照入审计首行。
- **新增纪律条款**：schemaVersion 演化铁律（major 必带迁移器、读到更高版本＝硬红）、写权限矩阵 + .lock + expectedSchemaVersion、.vv/.gitignore 契约（graphs 提交、checkpoints/audit/env 不提交）、迁移器重入检测且迁移前先 commit；「协议描述现实⛔ 发明现实」——每字段先答「现在谁消费」，无消费方进二期清单（废除单：workspace/user.json、project.bindings、meta 时间戳、telemetry/performance 全家、external:/integrity 挪二期）。
- 后续实现顺序（§14）：vv-bind.schema + jsonValidation 挂载（纯描述零行为改动）→ bindingErrors 归一诊断码 → 写矩阵 → 分域合并策略 → LangGraph 立项随 engine 裁决。

*（卷五十四完 · 协议从「绿野设计」对表回现实：绑定红线拆除、agent 地基立起、现状/前瞻分档记账）*

---

# 卷五十五 · CONFIG_PROTOCOL v0.3.0：按「迁移→统一 API 层→agent（宿主或自建，未定）」路线重分层（2026-10-16）

> 用户给出真实开发路线并点破：流程中涉及**多种不同层级的配置文件**，不是所有配置都塞一个 json——要求再次斟酌协议。

- **v0.2 的病（对表新信息后现形，且是自查式打脸）**：①只按“空间”分了三域，没按“时间”分——把第三期才定形的 agent 字段（providers 明细、checkpointer TTL、预算数值、graph 全格式）写成第一期入库样，与自定「协议描述现实⛔ 发明现实」铁律和 §12.2 废除单**自相矛盾**；②路线的承重墙「第二阶段·统一 API 层」整整缺席；③engine 未定（vscode 或自建两条路配置形状差异巨大），v0.2 字段形状偏 langgraph 自建世界——宿主路线里模型/密钥/prompt 全归 VS Code 治理，我们连引用都不该建。
- **v0.3 落笔**：四域（+域 D＝宿主原生扩展机制 mcp.json/.github prompt 文件——**只对齐不收纳**，防与宿主真值漂移）；§3 文件×阶段表（`.vv/` 骨架只物化当前阶段文件，超前出现报 `CONFIG_STAGE_SKIPPED`）；新增 **§9 API 层枢纽章**——dispatch RPC 与 contributes 命令面定性为「三面收敛的雏形与漂移风险」而非既有架构供人抄：`.vv/api.json` 工具注册表（`<domain>.<verb>` 词表封闭、perm/sideEffects/requiresApproval/ioSchema 四问必答、`apiVersion` 与 `schemaVersion` 两轴独立演化、授权三闸=全局开关∧工具 surfaces∧profile 收窄、审计通道与 configHash 快照**与引擎无关**自阶段二生根）；**§10 agent 两分支中立**——分支 A（VS Code：密钥/模型全宿主治理，工具=api.json 的 mcp 真子集做 MCP server，注册在域 D 的 mcp.json）、分支 B（自建：providers/checkpointer/graph 细节全落「占位说明、立项定稿」档，登记 §13.3 挂起清单）；§15 实施路线（schema 挂载→诊断归一→**api.json 三面同源**→审计→分岔），§16 变更摘要。
  
- 结构自检：284 行/32 标题/交叉引用零悬空；13.3 跳号与 §10.2 遗留词（adapters）两处手改收口（本轮 edit 参数 snake/camel 又混错一次，按在册纪律原 schema 重发）。
  
- 三轮协议的共同教训（入长期纪律）：**凡“将来可能需要”的字段，先登记到挂起清单（§13.3），⛔ 直接写进 schema/示例**——v0.1 平行绑定、v0.2 提前 agent、都是同一种病的不同皮肤。

*（卷五十五完 · 协议从“空间三分”进化到“三域+时间轴”，API 层立宪，engine 分岔留白不押注）*

---

# 卷五十六 · 代理交接与 M5–M7 收尾：绑定清理战役全线合拢 + 协议 v0.3.1（2026-10-17）

> 用户令：前序代理中断，凭 docs/current.txt + docs/mem.txt 接手，并质检其工作。

## 一、交接代理质量判定（实测背书，非采信文档）
- **诚实可靠**：M1（closureOf 去同名兜底）/M2（djsToVerilog：.djs 部件入编译、不支持器件硬错）/M3（binding.html 独立面板三入口）/M4（放置即写绑定，沙盒 merge store、doc onBind 落表）/Phase C（SandboxCanvas 3913→3377，三组件 verbatim 抽取锚点全存）逐项核过文件落地。**mem 自述的读数全部复现**：根+extension tsc 0、vitest 161/161 基线真、r12/r68/r84/r122 四组五十二格 GREEN。
- **M5 状态修正**：mem.txt 截断快照标「未动工」，实况**已完成**（dispatch L190-199 泛化为「每子部件逐条显式绑定，主电路不进表」+ M5 专格 + test 1050 反转断言）——压缩时机早于收尾，属账实差不是谎报。
- **current.txt 的 M6/M7 悬而未决处，质检判定为真缺口**（非误报）：①`bindingsChanged` 重读链只刷 bindMapRef/部件源，⛔ 同步伪 activeFile.partBindings → gateSystem `activePartBindings` 单例吃 init 旧表（显式 -1 优先与审计 covered 双失真）；②盘名 `x.djs.djs` 残留与表值脏形无清扫通道（读侧折叠≠盘上干净）。

## 二、本轮补完
- **M6（两处接线）**：DocApp `bindingsChanged` handler 补 `setDoc initialBindings`（单行补齐 init 已有语义的对账）；SandboxCanvas 拆**独立绑定 useEffect**（`[doc?.initialBindings]` → 只刷 partBindings ⛔ setResetNonce——换绑不重置画布、换内容才重置的语义分离）。链上三轨（init/手编/写全面板回执）自此同源。
- **M7（normalizeBindingsDisk，activate fire-and-forget、幂等双格钉死）**：盘名 `x.djs.djs` 裁尾（冲突自动 (n) ⛔ 覆盖）+ 所有层 `.verilogviz.json` 值按「normalize+本层重相对化」归一写回 + `宿主::实例` 前缀键随裁尾迁移；有改动才广播+轻报，第二遍零输出。新格 2 颗（裁尾+前缀随迁、幂等静默）。
- **自查两雷**：M7 首稿把孤儿尾巴留在上个函数区（tsc 现形，即删）；前缀键大小写查找漏 `.toLowerCase()`（复核现文逮回）。**闸 4 组 + vitest 162 + tsc×2 + build + bundle 闸 + lint 全绿收口**。
- **协议 v0.3.1 补丁**（含交接代理已录的 §9.4 审批语义/审计落点两处——本次对账发现我的冗余段与之相左，删除让正本独存）：perm 词表与 sideEffects 合一（勘误旧 read/write/fs-write 混粒度）、`API_SURFACE_DENIED` 判点唯一化、§13.3 登记分支 B 立项必答清单（state reducer/interruptBefore/After/handoff 防环/条件边参数化 stale=快照对比/engine 拆 mode×transport）。

## 三、遗留（如实，⛔ 冒充完成）
- **pre-existing 红闸四组**（交接代理正确挂账，非其引入）：r13/r60/r123 用旧 root-app boot（应迁 gates.html——URL+enterSandbox 改法 medium）；r90-[1] 命中 gateSystem 手写 `dirOfCtx`/`dirOf`（应归 vpath 单一主人。**本轮自查发现同类手抄在扩散**：customEditors/compilePanel/sandboxFiles 内联 dirOf ≈5 处，列下一步专项：vpath.parentDir 统一收编 + 四闸迁移修）。
- 工作区照旧不提交（M1–M7 累积改动体积已成山，建议用户尽快自提一版防并行覆写）。

*（卷五十六完 · M1–M7 全线合拢：绑定从「放置/复制/手编/清理」全周期都有显式账，交接方与接刀方读数互验通过）*

---

# 卷五十七 · 落袋：绑定战役五批提交 + 预存在红闸清零（r90 违例归位，三兄弟一组 URL 救活）（2026-10-17）

## 一、五批提交账（本地 agent 分支，5 ahead of origin/agent，未 push 待令）

| 批 | 提交 | 内容 | 提交前自证 |
|---|------|------|-----------|
| 1 | d6943f5 docs(绑定战役) | 账本卷四十六~五十六 + CONFIG_PROTOCOL v0.3.1 + MIGRATION | —（纯文档）|
| 2 | 95df75d feat(webview) | doc/canvas/gates/binding 四入口 + 旧 React 面拆除（-7705 行）+ gateSystem R145/146 + M4/M6 双通道 + SandboxCanvas 913→3377 + vite 配置 | vite build ✓ |
| 3 | 06cfc13 feat(扩展) | sandboxFiles 全链 / compilePanel 权威+strict+M2 闭包 / filesWebview / bindingPanel / djsVerilog / M3-M7 命令面 / grammar-media 收尾 | ext tsc + esbuild ✓（bundle 闸同-build 过）|
| 4 | 886e03f test(闸门) | unit 162 全账（R137/144/145/146/M5/M7 专块）+ stub 贴真宿主 + 绿集四组重指 + r150-bundle-gate + djsVerilog.test | vitest 162/162 ✓ |
| 5 | 97dfc6b test(闸门·红闸清零) | r13/r60/r123 boot URL 迁 gates.html；gateSystem dirOfCtx → vpath.parentDir | 五连绿+三兄弟 3/3（28 格）+ unit/tsc/lint ✓ |

## 二、预存在红闸结案
- **r13/r60/r123（28 格）**：根因只有一处——boot URL 还指 root-app（`/`），R150 换轨后该入口不存在。迁 `gates.html` 后**零断言改动直接全绿**——交接代理"非我引入、挂账待裁"的定性正确，但低估了修复成本（一行）。
- **r90-[1]**：唯一违例是我在 R150 写 getBindingAudit 时手抄的 dirOfCtx（甲型拼法）；改引 vpath.parentDir 主人后 3/3，且 [3] 反向臂（共现 20，⛔ 删消费者变绿）同时过——**闸的设计救了自己**：它同时防"手写漂移"和"为绿而删"。
- blocked 区自此清零；浏览器闸在册八组全绿（r13 15 / r60 7 / r68 8 / r84 7 / r90 3 / r122 9 / r123 6 / r12 28 格）。

## 三、交接与质检补记（流程账）
- 交接代理读数全复现（诚实），唯一账实差=M5 标记滞后（实际完成）；本轮按 mem/current 断点接完 M6 双通道、M7 清扫、协议 v0.3.1 三补丁，并把它的 §9.4 与我后补的重复段对账去重（正本独存）。
- 本轮自查两错入册：node -e 内嵌 `${PORT}` 被 PowerShell 吞（一次失败即落差盘 .cjs，在册纪律第 N 次验证）；spawnSync 首参必须为 string（把整命令 split 传 array 即 ERR_INVALID_ARG_TYPE，工具脚本一次写对复用四批）。

*（卷五十七 · 战役落袋为安：五批四十七文件级账目清晰可回滚，红闸归零，push 与否待令）*

---

# 卷五十八 · 协议落地六步：契约层从纸面走进产物（勤提交原则生效，本地 14 连，push 待令）（2026-10-17）

> 用户改则：小步完成即提交，不必等令；push 仍挂起。本轮全部按此执行。

## 提交账（承卷五十七的 6 颗，新增 8 颗，共 14 ahead）

| 步 | 提交 | 一句话 |
|---|------|--------|
| 协议① | 6387afb | vv-bind schema 挂 jsonValidation——绑定文件自此编辑器实时挑形状；锁格反吃 schema 正则双向对账 |
| 协议②(回环) | 479c18b | `_extra` 字段透传：手编 $schema/meta/私货在任何写通道往返后原样在（键序契约顺手钉） |
| 协议③ | b04dda1 | vv-api.defaults 工具账 + apiSurface 读侧 + 三面一致性对账锁（首稿埋的 PLACEHOLDER 被新锁当场咬出——锁当日立功） |
| 协议④ | 3e9134a | dispatch RPC 入口先过账：未登记=API_NOT_REGISTERED、关端点=SURFACE_DENIED、requiresApproval=宿主 modal 审批桥（importLegacyData 正/负双臂） |
| 协议⑤ | 3ac4c2d | .vv/api.json 工程覆盖合流：只收窄（交集/只关不开/审批只加严/取 min），固有属性越权整份拒不作半采纳 |
| 协议⑥ | b64690e | initProject：.vv/project.json+规则表幂等骨架（maxDepth 唯一出处=8、$schema 头在前、已有文件一字不碰） |
| 协议⑦ | b0478ae | bindingErrors 文案簇归一 §8 错误码（码名前缀进消息，人读原文零删改＝断言零碎） |

## 台架两笔新账（诚实记）
- **格内多 boot 踩模块级 currentPanel 旧尸**：resetModules 只在 beforeEach，一格三 boot 时第二次 reveal 死尸面板——协议⑤拆成三个单 boot 臂格（台架边界入册：新格「一 boot 一格」）。
- **PowerShell 内嵌 node -e 带引号/反引号/$ 三连炸**（本轮第 3、4、5 次）：全部按在册纪律转落差盘 .cjs；`\n` 在模板串里被展开成真实换行把测试文件咬穿一次（esbuild Unterminated string 现形，fix_line 缝合）——落盘脚本内也⛔ 嵌套模板串造字面量。

## 协议 §14 现况
- ①schema②诊断归一③骨架④契约⑤工程覆盖⑥执行钩子：全数落地（顺序按风险重排为 ①→②回环→③→④→⑤→⑥→②码名，每步自带判据）。
- 待立项（非今日账）：§9.5 完整审计通道（JSONL+configHash+redact）、§9.4 闸3 profile 授权（api.grants.json，接 MCP/CLI 端点时才有真消费者）、分支 A/B 选型（§10）、webview 旧设置面退役（R150 路标 ③）。
- 验证读数（终态）：unit **171/171** · 根+ext tsc 0 · vite build ✓ · esbuild+bundle 闸 OK · lint 0 · 浏览器绿集在册 8 组（本日步⑤⑥未触 webview/编译面，r84/r122 在步④后跑绿过，步⑤⑥仅 extension/ts 面＋两新格，全量含它们）。

*（卷五十八完 · 协议不再是文档——schema 挂上、账立起来、闸跑起来、工程收进来，十四连提交笔笔带判据）*

---

# 卷五十九 · QC 交接（协议⑧四雷整修）→ ⑨授权闸③ → ⑩设置面退役 → 预存在红闸定性（r44/r62 幽灵 fileStore）（2026-10-17）
> 承卷五十八：QC 交接代理成果后按序落刀① grants ② settingsStore 退役。残留垃圾清（test_files 十八颗重复 .v + 代理私账 current.txt/mem.txt + 杂目录，22 项 git clean 全净）。push 仍挂起（本地 17 连）。

## 一、QC 账：交接代理的协议⑧ WIP 整修（9de36a7）
`apiAudit.ts` 四处实雷当场落地（交接方读写数诚实但代码在册伪绿）：
1. **审计臂①一格双 boot**：panels 抹账→`panel.fired` TypeError——按在册「一 boot 一格」纪律拆 -a/-b 两格；
2. **argsDigest 记原参前缀**（160 字符半截电路进账本）→ 改只记形状（键名+类型+字节数，`…NB` 收尾 ≤260，加 `原参不入账` 断言臂）；
3. **configHash 冻结缺陷**：sha1 length 哨兵恒 20→hash 永不更新——改每调重算（sha256 当前值），加臂④回归钉住；
4. **fire-and-forget 记账无脚缝**→加 5ms 时距收口验证。
HEAD 02b56e3 经 `git stash -u` 实测 171/171+tsc 0——**移交良好、WIP 是败笔**，定性有据。

## 二、提交账（承 14 连，新增 3 颗，现 17 ahead）
| 笔 | 提交 | 内容 | 判据 |
|---|------|------|------|
| 协议⑧ | 9de36a7 | 审计通道（§9.5）：外层壳 dispatch/dispatchCore 分离、七 verdict、JSONL 落 .vv/audit（批量 30 行/5 秒、日滚动 500 行上限）、argsDigest 脱敏、configHash 每调重算 | 审计五臂全绿 |
| 协议⑨ | cd9db31 | 授权闸③（§9.4）：apiGrants.ts + vv-grants.schema.json + jsonValidation 第 4 条；dispatchCore 闸序 NOT_REGISTERED→canSurface→checkGrant('ui')→审批；profile fail-closed、哨兵 warn-not-fail；profile 集合 {circuit,project,bindings,compile,host}，⛔ config.* | 6 臂全绿 |
| 协议⑩ | 13d0bc0 | settingsStore 退役（R150 路标③）：ViewMode/defaultViewMode、fontSize 读写面、autosave 全套、resetSandboxSettings 全删；SandboxCanvas/Toolbar 死 onOpenSettings prop 链+死 Settings 图标拆除；活面（get/setSandboxSettings/applyHostConfig/subscribe）不动，160行→92行 | tsc×2 0 · unit 182/182 · build ✓ · lint 0 err · r13 15/15 |

## 三、预存在红闸定性（本轮自查发现，如实挂账）
- **r44-verify / r62-sandbox-speed-gate FATAL**（`Failed to fetch dynamically imported module: /src/store/fileStore.ts`）：**根因非本轮、非协议战役**——`src/store/fileStore.ts` 模块已不存在（历次重构改名/收编进 sandboxStore 等），两闸 page 端 import 幽灵模块。验证链：① pre-⑩ 文件原样 checkout 复跑同 FATAL（排除我的刀）；② 裸 vite 起服 curl `/src/store/fileStore.ts` 返 **text/html**（fallback，非 500）；③ r13-custom-gate 15/15 全绿（服务、页面、boot 三者健康，锁死根因在闸脚本自身）。两闸均不在卷五十八维护绿集，属**死锚遗留红闸**——判据：定时迁移或改锚（fileStore 语义现居 sandboxStore/store 层），非急务。
- **遗留后果（债）**：simSpeed 滑条（SandboxToolbar）与 wireStyle 判据自 r44/r62 腐烂后**无在岗浏览器闸**——列下轮闸门卫生专项（与 §13.1:478 设置面退役收尾合并处理）。

## 四、settingsStore 退役调研定案（残尸何处何留）
- 设置弹窗组件已不存在（无 SettingsDialog；两宿主 DocApp.tsx:159 / GateHarness.tsx:39 均不传 onOpenSettings）→ 按钮早已不渲染，死代码零行为，拆除纯减重；
- `_ui.cjs setSandboxToggle`（r14/r18/qc-audit 系消费）本来就点空（`?.click()` 空转），本次不动 qc-audit 死格——遗留债同上 第四节闸门卫生；
- localStorage 旧部残点（SandboxCanvas `verilog-viz-sandbox-w` 侧栏宽 + `verilog-viz-import-clipboard` 剪贴板暂存）：侧栏宽属 UI 会话态非配置语义——保留；import-clipboard 流程已走审批链，其残留 key 列下轮清理。

*（卷五十九完 · QC 四雷整修+两刀落袋：审计通道全线在岗、grants 闸③备装、设置面尸骨清干净；17 连 push 待令）*

---

# 卷六十 · 用户验收五连投诉：绑定链三修 + 文件系统原生树化整刀（2026-10-17）

> 承卷五十九。用户真机验收报五连投诉：①`verilogViz.bindParts` 报 "Webview is disposed"；②绑定完成后仍 `[BINDING_UNRESOLVED_RECORD]`（counter 键到 r50_counter.v 假成功绑定）；③诊断全锚入口文件第 1 行而不锚部件例化行；④⑤两模式「文件」区域必须是完整资源管理器（可新建文件夹、样式符合 Explorer、作为两模式入口）。①②③一根线（绑定报错链），④⑤一根线（文件系统形态）——分两提交落袋（现 21 连 push 待令）。

## 一、绑定链三修（de87cc7，Wave 1）
1. **诊断锚点**：`CompileJob.bindingAnchors` 逐条平行数组（⛔ 平行不变量=每条 bindingErrors 配一条锚点）；`verilogParseLite.parseVerilogInstancesWithLines`（注释等长掩码防行号漂移，1-based）；compilePanel closureOf 每 push 配对记锚＋UNRESOLVED_RECORD 文案补「该文件内定义的是：…」（报错不说人话那一族）；useHostCompile 消费锚点→ProblemItem 真实 file/line→publishProblems 落 Problems 真行（`dispatch.ts:195` `p.line ?? 1` 语义已兼容）。
2. **假成功绑定拦下（写前校验）**：bindingPanel save 落表前校验目标：.v/.sv 须真的定义该模块、.djs/.gate 须存在——违规整批 saveError 拒写（⛔ 再往表里塞注定解不到的记录），前端红块展示原因、data/saved 时清空（真机惨案=counter 键到 r50_counter.v，模块名根本对不上）。
3. **面板生命周期加固**：bindingPanel `livePanel()` 探尸（读 webview.html 探位）+ `pushSafe()` 收拢一切触碰（复用/notify/ready 全路过）——“运行命令 verilogViz.bindParts 错误: Webview is disposed”根除。
- **自查假锚雷**：首刀把 `anchorOf` 定义在 for 循环外、闭包引用循环内 `inst`——句法过而全 suite ReferenceError（4 格红）——**块作用域闭包陷阱**：外层函数看不见 for 头里声明的变量；改参数化 `anchorOf(inst)` 归位。调试链留存：4 格红线全同根，非四雷。
- 判据：专 suite 108/108（诊断四格+校验三格新钉）+ 全链 186/186 + tsc×2 + build ✓。

## 二、文件系统原生树化（3cc619f，Wave 2；R148 webview 形态退役，R151 上位裁决）
- **trees.ts**：CodeFilesTree 层级化（storeFactory→ProjectStore.listTree；目录**全量上报**＝真资源管理器语义、.v/.sv 文件分域）；`childrenOfLayer` 嵌套助手（目录在前、只给直属孩子、localeCompare）；SandboxTree 同款收编；`dirItemOf` 目录节点统一挂 resourceUri（「在此新建」族 menuUri 的命脉）+ SandboxTree 文件叶子自 `n.name` 解 uri（childrenOfLayer 产物无 uri 字段，自称命门）。
- **package.json**：双 demo views `type: webview→tree`；`webview/context` 整档退役；新 view/item/context 27 条（codeFile×8/codeDir×5/sandboxFile×9/sandboxDir×5），when 全部单条件 `view == X && viewItem == Y`。
- **extension.ts**：vvViewOf/VvFilesWebviewProvider 谢幕，六树全走 `createTreeView(showCollapseAll:true)`；refreshAllTrees 去 webview 化；menuUri 的 `{vvPath}` 死分支拆净。
- **filesWebview.ts 删除**。
- **台架改账**：六树注册账、codeFiles/sandboxFiles 结构+菜单在册、webview/context 反在册（`toBeUndefined`）、filesWebview 幽灵 import 钉、watcher 增删⇒树实时张榜；菜单总量阈值 R152 口径=44（HEAD 原生 17 + 文件树新 27）。
- **踩坑登记（同雷三响，勿再犯）**：package.json 手术一刀曾把 parse 玩炸四轮——总根源=注入吞掉 view/item/context 数组尾 `],` 再叠加**V8 对「对象成员末尾残逗号」的报错文案是 "Expected double-quoted property name"**（语义与症状严重误导，排查绕了数组闭包/字符串跨行/BOM 三个假方向）。解法：从 `git cat-file` 纯净 HEAD 文本起步、node 单脚本三刀+每刀 JSON.parse 断言+锚注入后末成员去残留逗号。**教训：VS Code manifest 大改一律「node 文本手术 + 每刀断言」，⛔ PowerShell 缓冲区索引码刀（off-by-one 连响两次）**。
- 判据：专 suite 107/107 + 全量 185/185 + tsc×2 0 + vite build ✓ + extension esbuild ✓。

## 三、未闭
1. r44/r62 幽灵 fileStore 迁移与 simSpeed/wireStyle 浏览器闸补岗（卷五十九§3 债，闸门卫生专项）。
2. 分支 A（MCP server+`.vscode/mcp.json`）/ 分支 B（`.vv/agent/` LangGraph）立项拍板（协议§10/§13.3 材料齐）。
3. push 21 连待用户一句话。
4. 真机点验（两 Wave 落地后肉眼过）：Problems 跳行准头、绑定面板重开不尸解、两「文件」树右键与 Explorer 手感一致。

*（卷六十完 · 绑定报错链三雷根除、假成功绑定拦下、文件系统归真资源管理器形态；agent 21 连未推）*

# 卷六十一 · 文件系统战役收口：批次A/B + 深度审查六缺陷 + F 族拖拽落地（2026-10-17）

> 承卷六十。上一代理在「批次B 中途」断线（工作树半成品：G1 引擎半截、C9/C10/C11 命令+菜单已挂、台架注册表钉没跟上=基线 188/189 一红）。本卷：全量深度审查（不可信任前人质量为前提）→ 修六缺陷 → 续完批次B → 全绿 200/200。

## 一、深度审查战果（「不可完全相信之前的工作质量」的实证）
1. **#12 跨表漏迁（最重要）**：文件改名/删除的绑定迁移只扫 `dirChain(oldFull)` 祖先链——任何目录的表用 `../` 相对写法指到这颗文件就漏（lib 表值 `../fsm.djs`）。⇒ 新增 **migrateFileRef**（全表层精确身份扫），与 migratePrefix 共用 tableDirsOf，**G1 三路（文件/目录/移动）真正共源**。
2. **#10/#11 G7 逃逸**：renameFile 与 newVerilogFile/newSandboxFile 裸收输入框文本，`../` 可把文件写出工作区 ⇒ naming.ts 增 **sanitizeNameInput**（段级消毒，single=改名单段语义），三处接上。
3. **#13 空态崩**：CodeFilesTree 的 hint 节点走 `uriOfRel(n.name!)`，undefined.split 当场 TypeError ⇒ 早退守卫。
4. **#14 原地白跑**：moveToFile 同目录"移动"会 (n) 顺延改名（parts→parts (2)）⇒ destRel===srcDir 短路。
5. **#15 深度不一**：collectTableDirs depth=8 vs A12 口径 16 ⇒ 统一 16。
6. **台架两雷**：注册表钉没跟新命令（188/189 假红根因之一）；performRename 用改名后 target stat 判目录——桩 rename 不回填 dirs 表 ⇒ 判成文件走错迁移路。修法：**动手前先 stat 源**（真宿主也更稳）。

## 二、批次B 落地清单
- **G1 引擎**：migratePrefix（目录前缀族群：值/`宿主::`前缀键/根表 circuits；随盘搬走的表跳过）+ migrateFileRef（文件精确身份）+ deleteFile 双路接通（D4/D5/C9 共源）。
- **C9/C10/C11/D7**：moveTo（QuickPick scanDirChoices→(n) 去重→performRename）、copyPath（绝对路径进剪贴板+根相对告示）、revealInOS（平台 revealFileInOS）；12 条菜单两树×文件/目录。
- **F 族拖拽**：FileTreeDragAndDrop（trees.ts）——树内多选移动（moveToFile 共源）、域 MIME 圈死（F3）、OS DataTransferFile 拖入（F4，落盘 (n)+域过滤+E6 同口径）、自环拒；G3/G4 完成后统一刷树+广播。⚠ 本仓 @types/vscode(1.140) 拖拽 API 是 **TreeViewOptions.dragAndDropController 构造参数**（⛔ TreeView 可写属性，TS2339 实测）。
- **H1（Q4 默认裁决：做）**：SandboxTree circuits 项挂 circuit-board ThemeIcon。
- **台架**：+11 钉（G1 三路/自环/原地/消毒×2/菜单 12 条/C10C11/拖拽语义×2/H1）；桩增补 ThemeIcon/DataTransfer 家族/createTreeView 台账/TreeItem.iconPath。**200/200 + root build + extension tsc/esbuild 全绿**。

## 三、裁决与遗留
- **Q1–Q5 默认裁决**（代理代定、可推翻）：Q1 维持单击打开 / Q2 F5 暂缓挂账 / Q3 目录迁移+多选并入（已做）/ Q4 角标做（已做）/ Q5 维持不承诺多根。全部在 FILESYSTEM_CHECKLIST.md v2 补记④。
- 遗留：X8（.vh 编译入口）车载测试；F5 挂账；真机点验单待用户；r44/r62 幽灵 fileStore 债未动；push 21+3 连待令。

## 四、方向（用户 2026-10-17 问）：统一 API 层 + 规范 API 文档
- 用户判断「系统过于混乱」，问是否直接开建统一调用层（同时解决 VS Code 解耦与 agent 调用前提），并要求**规范的 API 文档**。
- 代理初步意见（待专项展开）：**是的，但形态是「收编」不是「另起」**——现有 dispatch(RPC)+apiSurface(契约)+apiGrants(授权)+apiAudit(审计) 已是半个调用层；乱源=树命令直插 sandboxFiles 绕过该边界。统一=建 toolRegistry（schema+域+审批半径）+ executeTool 单执行器，树命令与 webview RPC 与未来 agent 同走一道门；API 文档从 registry **生成**（单一真源），⛔ 手写文档与实现漂移。文件系统九工具（刚 stabilized 的这批）就是第一组 tool。

*（卷六十一完 · 文件系统全绿收口、审查六缺陷闭账、F 族拖拽+G1 三路共源在岗；API 层立项待用户拍板）*

# 卷六十二 · 统一调用层批次一：单执行器落地 + API 文档生成（2026-10-17）

> 承卷六十一方向议题。用户拍板「开工」+ 要求规范 API 文档。批次一交付：**toolRegistry 单执行器 + fs.* 十工具上账 + 全部文件命令薄壳化 + API 文档从双真源生成**。原则=**收编而非另起**。

## 一、落地清单
- **`toolRegistry.ts`**：`ToolDef`（title/description/参数 JSON Schema/handler）+ `registerTool/listTools` + **`executeTool`**——闸序与 dispatch 逐字同硬序（①registry∧契约双查→②surfaces→③grants→④requiresApproval∧非交互⇒HITL 弹窗），错误标签 `[API_*]` 四种、verdict 七值、审计 args 形状摘要**一锅同账**（`.vv/audit/`）。`ToolCaller{surface,subject,interactive}`：ui 命令=interactive（弹窗归命令，⛔ 二次弹）；agent=非交互→执行器弹（§11 HITL 首落点）。`onToolExecuted` 事件⇒extension 订阅刷树（sideEffects≠none）。
- **`toolsFs.ts`**：fs.rename/move/delete/duplicateFile/duplicateFolder/import/copyPath/revealInOS/createFile/createFolder 十工具——handler 全指向本日拆出的 headless 机械体（renameEntry/deleteEntry/importFromUris/createVerilogFile/createSandboxFile/createFolder）；对话框/编辑器打开归命令壳。
- **薄壳化**：renameFile/deleteFile/duplicate×2/moveTo/import×3/copyPath/revealInOS/newFile×2/newFolder 共 13 颗命令改「UI+executeTool」；广播移入 handler、刷树移入订阅——命令层⛔ 各自为政。
- **契约**：`vv-api.defaults.json` +10 行 fs.*（0.2.0；fs.delete requiresApproval=true）。**apiDoc.test 钉死 registry∧契约孤儿双查**。
- **API 文档**：`apiDoc.ts` 渲染器 + `pnpm api:doc`（vitest -t 过滤）+ **漂移钉**（docs/API_REFERENCE.md 与双真源不一致=再生成落盘+当场红）——手写文档漂移问题根治。
- **台架**：+8 钉=208/208（孤儿双查/闸①②③④/agent 字符串实参 headless 全链/审计落账/api:doc 漂移）。

## 二、批次一实战教训（在册）
1. **argUri 的 scheme 宽正则炸 18 红**：`/^[a-zA-Z][…]*:/` 把 Windows 盘符 `D:\p` 误判成 scheme（`D:` 命中）→ 栽在桩没有的 `Uri.parse` → 被命令层 `.catch` 吞成全静默。修=**只认 `file://` 前缀，其余一律 fsPath**。教训：uri 归一化函数的判定词表必须白名单，⛔ 宽正则猜 scheme。
2. 审计成功路径漏传 tool id（fail 路径传了）→ 账行 tool=null 被钉住。教训：审计助手的多参签名（verdict,note,toolId）易漏尾参——考虑下批改对象参数。
3. tests 直 import 的 `importFiles` 已改名 `importFromUris`（机械体上账后旧名退役）——测试随 API 改名同步是纪律。

## 三、未闭（第二、三批）
1. dispatch 6 颗 RPC 迁 executeTool（闸已在跑，换执行器不改语义）。
2. 绑定族/compile 族命令上账；OS 拖入字节流写盘收编。
3. 分支 A（MCP server）/ 分支 B（LangGraph）立项——工具面已就绪，**放开 agent 调用=改契约 surfaces 一行**（mcp=false→true）+ grants 档案。
4. push 24+2 连待令；真机点验单持续有效。

*（卷六十二完 · 统一调用层单执行器在岗、fs 十工具上账、API 文档生成防漂移；agent 三方同门只剩传输层选型）*

## 卷六十二补记 · 深度自检（用户令「先深度自检」，同标准：不可信任自己刚写的代码）

以攻击者视角重审批次一全部新面，**5 项发现、全数修复**，台架 +5 钉=212/212：

1. **HITL 可伪造（信任模型洞，最重）**：审批豁免原只看 `caller.interactive`——调用方自造 `{surface:'ui', interactive:true}` 即可绕过 fs.delete 的审批。修=豁免**三条件齐验**（surface==='ui' ∧ subject==='ui' ∧ interactive）；并立传输层纪律：批次二 MCP/LangGraph 接线时 subject/surface 由传输固化，业务代码⛔ 自造身份。钉：伪造交互身份的 fs.delete 仍被 NOT_APPROVED 拦、盘上不动。
2. **argUri 空实参**：`Uri.file('')` 宿主/桩两界形状都不可靠 ⇒ 空串当场抛（verdict=error），⛔ 静默吞。
3. **fs.rename 静默 ok:false 骗 agent**：失败（同名/无效名/占用）改显式抛错——调用方统一 try/catch 口径，审计落 error。钉：同名 rename rejects。
4. **fs.import exts 单形态**：只收 csv 串；改双形态（JSON 数组=agent 正形态 / csv 容错）。
5. **死代码 + 覆盖缺口**：`renameFile/deleteFile` 弹框壳成死导出（删除，逻辑已在命令层+机械体）；import 命令级链路（对话框→工具→告示）在薄壳化时丢了覆盖 ⇒ 补回，且当场抓到**桩 fidelity 缺口**：stub 的 `copy` 对不存在源静默 no-op（旧格子只断言返回值所以从没暴露）——真宿主会 throw→error verdict，属测试桩债（记此，批次二修桩）。

流程验证：api:doc 漂移自愈按设计工作（改 fs.rename 描述→doc 再生成落盘+当轮红→次轮绿）。全绿 212/212 + 双 build。
