
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
