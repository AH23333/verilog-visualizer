# 闸门分层账（GATE LAYERS）

> 这颗文件回答一句话：**一条判据现在该在哪一层里判**。
> 迁移（片 3a→C4：拆 Tauri → 旧 React 单页退役 → `.djs` 归工作区真文档 → 编译归宿主推送）
> 把好几颗"浏览器里的主人"删掉了。主人的位置一变，闸门只有三种正当下落：
> **换层重锚 / 就地删除并说明 / 登记未验证**。⛔ 第四种：把已删的主人复活一次只为了让老锚点继续绿。

---

## ① 为什么要有这份账

旧形态里，浏览器页（`index.html`）自己管文件：`src/store/fileStore.ts` 存 `.v` 源码库
（localStorage 键 `verilog-viz-files`），点一下「编译」在页内跑 yosys，结果写回同一颗 store。
于是 `tests/` 下大批闸门把这三件事当成空气：

1. `page.evaluate(() => import('/src/store/fileStore.ts'))` 塞源码文件；
2. 读 `status === 'compiled'` 当判定；
3. 点 `button[title*="复制到沙盒"]`，然后回头读 `localStorage['verilog-viz-sandbox-files']`。

现在这三件事的主人分别变成了：

| 旧主人（已删/已迁） | 现主人 | 证据 |
|---|---|---|
| `src/store/fileStore.ts`（浏览器 `.v` 库） | 工作区真文件 + 宿主算闭包 | `extension/src/compilePanel.ts` 推 `{vvh:'push',op:'compile',files,topModule,…}` |
| 页内编译按钮 | 宿主命令 Ctrl+F5 / 编辑器标题栏 | `extension/package.json` 的 keybinding + menus |
| 复制到沙盒 = 写 localStorage | `host.copyToSandbox` → 工作区 `.djs` | `extension/src/dispatch.ts` 的 `copyToSandbox` 分支 |

⇒ 第 1、2 条是**换层**问题（编译本来就还在 webview 里跑，只是喂法变了）；
第 3 条是**分层**问题（落盘归宿主，渲染归沙盒画布，一条老判据里其实混了两层）。

## ② 五层与各自的驱动配方

| 层 | 判的是谁 | 怎么驱动 | 判定读什么 | 现用证人 |
|---|---|---|---|---|
| **U** vitest 无头 | 纯函数（lib / extension 侧算法） | `pnpm test`（`tests/unit/*.test.ts`） | 断言返回值 | 域界主人 `verilogDomain`、`rootRel`、`legacyMigration`、宿主桩 `extensionHost.test.ts` |
| **X** 扩展宿主仿真 | `dispatch` 的 RPC、命令、TreeView、自定义编辑器 | `tests/unit/extensionHost.test.ts` 里的 `vscode` 桩 + `boot({folders,seed})` | 桩上的 `vscode.state`（文件表、诊断、输出） | X8/C2/X19/X20 那一族 |
| **W** 编译画布（浏览器 `index.html`） | `CanvasApp` + `useHostCompile` 的真渲染 | `pushCompile(page, job)` 发宿主那份推送单 | **屏幕**：`__djsDebug` 器件数、`[data-canvas-notice]` 文字 | r42 L1 |
| **H** 宿主 RPC 截获 | 「点按钮到底交出去什么载荷」 | 点击**前**注入 `window.acquireVsCodeApi` 桩：`copyToSandboxCapture(page)` | 桩记到的 `req.method/args`（字节级）+ 告示条 | r42 L2、r12-export [F] |
| **S** 沙盒画布（浏览器 `gates.html`） | `SandboxCanvas` / 展开弹窗的真渲染 | `seedSandboxStore(page, files)` 播种后 `boot(page, '/gates.html')` | `__sandboxPaper` / `__innerPaper` / DOM | r42 L3＋r60/r68/r84/r122/r123 那一族 |

三条硬规矩（都是这轮踩出来的）：

- **W 层判定只许读屏幕**。⛔ 读 store 的状态字段——用户看得见的就是画布和告示条，
  store 绿而画布空白正是这批缺陷的原形。
- **H 层的桩必须点击前注入**。`getHost()` 的宿主探测**每次现读** `window.acquireVsCodeApi`
  （`src/lib/host/host.ts` 文件头形状 1）；模块加载期求值会把判据变成永远测不到 vscode 分支。
- **S 层的播种只当"宿主已落盘"的替身**，并且要在判据注释里写明白：字节来自 H 层的真截获，
  夹具⛔ 自己算第二遍。宿主那一步（写文件、重名 `(n)`、建目录表）另有 X 层的证人。

## ③ 一条老判据混了两层时怎么拆（r42 的样板）

`tests/r42-verify.cjs` 原来的「复制到沙盒」那一段同时判：字节对不对（载荷层）+ 画布画得好不好（渲染层）。
拆完是四段，22 PASS / 0 FAIL，读数 `.tmpbuild/r42_R154.log`：

| 段 | 层 | 判据 | 备注 |
|---|---|---|---|
| [A] [4a] [B] [6] [6b] [9a] | W | 编译出图 / 编译模式展开 / 三层钻取 | 推送单仿真，`topModule` 由夹具定根 |
| [P] [1] [2] [3a] [5a] | H | 点一次＝一次 `copyToSandbox`；载荷里每颗 part 有真坐标、无叠放、引脚形态/`groups`/`order` 随行 | **[P] 是新加的**：⛔ 让这一族静默空转 |
| [3a0] [4c0] [3b] [4b] [4c] [5b] [2b] [7] | S | 部件能打开、同名多实例都有内图、沙盒展开==编译模式展开、盒体宽高比、缩放三按钮 | [3a0]/[4c0] 也是新加的（"打不开"不能糊在"画错了"里） |
| [8] [9b] [10] | S+U 同页 | 跨文件绑定逐颗可解析 / 缺模块走 `MissingModulesError` / 无 pageerror、无 NaN | |

新增三颗证人不是为了凑数：老的那一段一旦"点不到按钮"就直接 FATAL，整条闸门读不到任何判定；
现在 [P] 会红名点出"没走宿主 RPC"，[3a0]/[4c0] 会红名点出"沙盒库里没这颗部件"，
后面的渲染判据才有意义。

## ④ 名册：73 颗闸门里谁还引用已删的 store

现读口径（脚本 `node -e` 直接扫 `tests/run-all.cjs` 的 `GATES` 数组 + 各 `.cjs` 原文）：

- `GATES` 总颗数 = **73**，清单里文件全部存在（缺件 0 颗）。
- 文中提到 `store/fileStore.ts` 的 = **23** 颗。
- 其中**真会炸**的 = **17** 颗：既有 `const { fileStore } = await import('/src/store/fileStore.ts')`
  的解构，又有点号成员调用 ⇒ 模块 404 时 `page.evaluate` 当场抛 ⇒ 整颗 FATAL。
- **只剩死代码**的 = **6** 颗：`r60-part-binding-gate` `r65-numbase-gate` `r68-fanin-gate`
  `r71-abort-port-gate` `r76-sparse-mux-gate` `r90-single-owner-gate`。
  前 5 颗的那一行长这样：`await import('/src/store/fileStore.ts').then(() => 1).catch(() => 0)`
  —— 当年为 vite 依赖预热写的，`.catch` 把 404 吞了 ⇒ 闸门照旧跑，但**这颗死引用会骗下一个
  读代码的人**（"原来 fileStore 还在"）；`r90` 的第 10 行是注释里点了已删文件的行号。
  ⇒ 待办：摘掉这 5 行预热 + 改掉 r90 那条注释（不改判据，只清幽灵）。

> ⚠ 上一轮我说过「24 of 73」——那是把 `tests/**` 全树（47 处引用）和 `GATES` 清单混了。
> 现读以本节的 23/17/6 为准。

### 17 颗真炸的按"该搬去哪一层"分类

| 目标层 | 闸门 | 它拿 fileStore 干什么 | 重锚配方 |
|---|---|---|---|
| **W**（推送单） | r37-verify r40-verify r43e-verify r44-verify r46-menu-parity r50-ui-sim r83-errorcopy-gate r92-routing-gate r99-ui-unify-gate r115-sidebar-align-gate selfaudit2-sandbox | 塞 `.v` + 读 `status==='compiled'` | `startDesign()`/`pushCompile()` + `waitCompiled()` 读屏幕；r42 已有样板 |
| **W+S**（塞 `.v` 只为造出绑定式子部件） | r57-zoom-anchor-gate r61-dark-label-gate r62-sandbox-speed-gate r85-posfidelity-gate r135-svg-export-gate r135-part-search-gate | `createFile` + `setModuleBinding(...)` ⇒ 量的是子部件展开后的画布 | 编译走 W；子部件改由 H 截载荷 + S 播种（r42 L2→L3 那一段就是这条路） |

颗数对账：11 + 6 = 17。⛔ 把这张表读成"17 颗都红"——红不红以本轮跑批读数为准（第 ⑤ 节）。
分类用的是机械尺而非目测：那颗档里出现 `setModuleBinding` ⇒ 归「W+S」（它塞 `.v` 只是造出绑定式
子部件，量的仍是画布），否则归「W」。两族名单（现读，按那颗尺重跑一遍可复现）：
 · W（11）：r37-verify r40-verify r43e-verify r44-verify r46-menu-parity r50-ui-sim
   r83-errorcopy-gate r92-routing-gate r99-ui-unify-gate r115-sidebar-align-gate selfaudit2-sandbox
 · W+S（6）：r57-zoom-anchor-gate r61-dark-label-gate r62-sandbox-speed-gate r85-posfidelity-gate
   r135-svg-export-gate r135-part-search-gate

## ⑤ 本轮全量跑批读数（`node tests/run-all.cjs`，2026-10-18 03:46–04:12 UTC+8）

三态汇总：**73 格 ＝ GREEN 12 / RED 61 / ENVRED 0 / NOVERDICT 0**。
原始逐格输出在 `.tmpbuild/gates/`，父档汇总 `.tmpbuild/RUNALL_R154.log`；族谱由
`bin/C4/probe_gate_urls.cjs` 的入口分工 + 这份日志的第一条 FATAL/FAIL 行归族（脚本现读，⛔ 手点）。

GREEN 名单（12 颗）：`r12-export` `r13-custom-gate` `r42-verify` `r48-verify` `r49-parity`
`r56-conflict-gate` `r60-part-binding-gate` `r68-fanin-gate` `r90-single-owner-gate`
`r91-palette-coverage-gate` `r122-persist-gate` `r123-cycle-gate`。
⚠ 这 12 颗里只有 5 颗（r12/r13/r60/r68/r122/r123 那一族）本来就是走 `gates.html` 的夹具档，
`r42` 是本轮重锚的那颗——**其余红⛔ 是产品坏，而是"主人搬家后闸门还站在旧门口"**（下面四族）。

| 族 | 颗数 | 第一条读数形状 | 归责 | 下一步（每族一颗配方，⛔ 逐颗另写） |
|---|---|---|---|---|
| **C 等锚点超时** | 25 | `FATAL TimeoutError: page.waitForFunction: Timeout 30000ms` | 夹具 | 入口 `/` → `/gates.html`（`bin/C5/patch_gate_entry_wave1.py`，DRY 现读 31 颗候选，其中含本族 20 颗）；本族里 `qc-paused`/`qc-preview`/`qc-realuser` 三颗跑的是 **dist**，⛔ 换 gates.html（产物里没那颗入口）——它们要的是"生产构建 + 保存重开"，落点＝假宿主 + `doc.html`（见 ⑥） |
| **D 点不到锚点** | 13 | `FATAL locator.click: Timeout 30000ms` | 夹具 | 同一入口问题的另一半：换完入口后仍红的，就是它自己的私有死锚点（r30 那颗 `button.activity-btn[title=…]` 是已删活动栏的形状），逐颗改走 `tests/_ui.cjs` 的共用锚点 |
| **A fileStore 404** | 10 | `FATAL … Failed to fetch dynamically imported module: /src/store/fileStore.ts` | 夹具 | 编译侧改 `pushCompile` 仿真宿主推送单（r42 的 L1 就是样板）；为"造出绑定式子部件"而塞 `.v` 的那 6 颗（名册见 ④）改走 H 截载荷 + S 播种 |
| **B 活动栏⛔ 这一页** | 9 | `FATAL Error: newSandboxFile: 等不到活动栏「沙盒」按钮；当前可见的 data-activity = [(空)]` | 夹具 | 最干净的一族：那颗诊断句已经自报家门——换入口即可（`_ui.cjs` 无需改动） |
| **其它（逐颗）** | 4 | 各不重叠 | 见下 | |

四颗"其它"各自都要单独定案，⛔ 混进族谱里一键处理：

- `r87-esc-shape-gate`：`只扫到 10 处（下界 13）` + 点名册四颗文件已随旧 React 单页删除——
  **夹具烂⛔ 产品坏**（现读 `SandboxCanvas` 的 Esc 监听仍在，挂在
  `src/components/SandboxCanvas.tsx:2259`、卸于 `:2330`）。名册要按今天的扫描现读重写（工单已开）。
- `r114-const-fold-gate`：`ENOENT: no such file or directory` 且 `pass=11 fail=1`——
  11 格真绿、唯读文件那一格红，⛔ 是产品常量折叠坏；要先看它开的是哪颗档（多半是被搬走的夹具）。
- `r137-webview-csp-gate`：`[0] CSP 之下应用挂载 — 没挂载 ⇒ 整页判据作废`（`pass=5 fail=2 fatal=1`）。
  ⚠ **这颗要当回事**：它判的是"构建产物在真 CSP 里挂不挂得上"，而产品今天真发的就是那颗产物。
  红因两种可能：R153 之后 `dist` 的入口形状变了（旧探针找的是退役单页的标记），
  或者挂载在 CSP 下真坏了。下一批第一件事＝在 pristine HEAD 与本档各跑一次分清归责（记忆里的
  「闸门变红先跑 pristine」）。
- `r35-verify`：日志里 `pass=0 fail=0` 而抓不到 FATAL/FAIL 行——**跑批自己那把"取第一条判定行"的尺瞎了**，
  不等于这格没判定。要么它打的是别的字样（判据行格式漂了），要么它静默退出。这颗先取原始档
  `.tmpbuild/gates/r35-verify.log` 定性，再决定归族。

> 口径提醒（写给自己）：以上 61 颗红里，**目前没有一颗被证实是产品缺陷**；同样，⛔ 有 61 颗"安全"。
> 每换一次入口/锚点都要重跑那颗闸门拿新读数，⛔ 用这张族谱替读数背书。

### ⑤-补 这一跑之后入册的一颗新证人


`tests/r154-dochost-persist-gate.cjs`（**7 格全绿**，`tests/run-all.cjs` 的 `GATES` 现读 **74** 颗＝73+1）。
它补的是这批迁移里最大的一块**覆盖真空**：`.djs` 成为工作区真文档后，
"编辑 → 保存 → 刷新 → 重开不丢"这条用户承诺在自动化里一度⛔ 任何一层覆盖
（`qc-realuser`/`qc-paused` 那一族量的是已退役的旧单页 + localStorage 沙盒库，真机点验我又⛔ 逐格替用户打勾）。
落点＝`tests/_dochost.cjs` 那颗假宿主（照 `dispatch.ts` 的 9 颗 `req` 与 `customEditors.ts` 的
`{vvh:'doc'}` init/revert ⇄ ready/edit 说话，文件表落 `localStorage['vv-fake-fs']` 跨 reload 存活）
＋被测的**产品本体两颗**：`src/doc/DocApp.tsx` 与 `src/components/SandboxCanvas.tsx`。
七格：挂载 / 点部件库真放置 / commit 走 `doc/edit` 且落盘正文含那颗 / 正文是 `{cells:[]}` 形状 /
刷新重开还在 / **反向臂**（盘上正文换回空档 ⇒ 画布跟着变空，这颗专门防"同页内存冒充磁盘"的假绿）/ 无 pageerror。
⚠ 一颗假宿主⛔ 等于真宿主：`fs.delete`、watcher 自刷、真 Uri、回收站那几处仍归 `pnpm test:real` 与 X 层。

### ⑤-补2 那三颗 `vite preview` 档的裁决（qc-paused / qc-preview / qc-realuser）

它们⛔ 能像其余 32 颗那样一行换入口：跑的是 **dist 产物**，而 `gates.html` 有意⛔ 进构建输入
（`src/gates/main.tsx` 文件头那句"⛔ 不进构建产物"），换过去当场 404。三档今天真正剩下的意图是两条：

- **产物挂载/CSP 能跑** → 主人是 `r137-webview-csp-gate`（它本轮也红，见 ⑤ 的"逐颗"表；先定它，⛔ 让两条路各修各的）；
- **生产构建上的「保存→刷新→重开」** → 这条⛔ 退役：假宿主那颗（`tests/_dochost.cjs`）用的是 `addInitScript`，
  同一招在 `vite preview` 下同样成立，把 `r154-dochost-persist-gate` 的入口从 dev 换成 dist 就是它的**升级版**
  （今天测的是源码，换过去测的是发出去的那份）。裁决＝**做**，排在 `r137` 定案之后，⛔ 之前先把这三档
  从名册里静默删掉（今天它们＝三颗"地板已拆"的红，删掉＝丢覆盖）。

### ⑤-补3 波次一之后的第二次全量跑批（同 74 格名册，`node tests/run-all.cjs`，2026-10-18 04:35–05:16 UTC+8）

**成对读数（这一句是本节的目的）**：波次一把 35 颗沙盒侧档的入口从 `/` 一行换到 `/gates.html`，
换之前 73 格＝**GREEN 12 / RED 61**，换之后 74 格＝**GREEN 30 / RED 44 / ENVRED 0 / NOVERDICT 0**。
净进 18 颗绿＝**19 颗红转绿**减**2 颗绿转红**（`r42-verify`、`r48-verify`——现读两份日志的集合差，
⚠ 我第一版在这里写的是"⛔ 一颗由绿转红"，那是没算集合差就发的榜）。两颗都要单跑定案：

- `r42-verify`：**本轮已单跑过＝22 PASS / 0 FAIL**（它正是波次一里被重写成四层的那颗）
  ⇒ 批跑那发的 `[4a] 展开图=null` + `locator.click 超时`属**跑批时序**（同批 8 个 node 进程抢 CPU，
  而它的等待上限是 30s），⛔ 产品红。
- `r48-verify`：批跑读数是 `FATAL Execution context was destroyed, most likely because of a navigation`
  ⇒ 页面导航与 `page.evaluate` 抢拍。**这颗⛔ 单跑过**（R48/R49 那一族从 R1 起就没判成过），
  列入波次三第一格。

红的 44 格按**原因**分族（分类⛔ 按记账写：每颗都回到它自己那行日志或它自己的源码）：

| 族 | 颗数 | 名单 | 这一族的真值 |
|---|---|---|---|
| 编译侧种子死了（源码里仍 `import('/src/store/fileStore.ts')`） | **17** | r37 r40 r43e r44 r46 r50 r57 r61 r62 r83 r85 r92 r99 r115 r135-svg r135-part selfaudit2 | 那颗 store 随旧 React UI 整颗删除 ⇒ 浏览器侧 404、闸门 FATAL 早退。**波次二**逐颗换 `tests/_ui.cjs` 的 `pushCompile/waitCompiled/canvasReadout`（编译本来就跑在 webview 里）。⚠ 只死这一颗平面：`localStorage['verilog-viz-sandbox-files']`（`src/store/sandboxStore.ts`）**仍是活的**，沙盒侧断言⛔ 跟着改。 |
| 等锚点/条件超时（`waitForFunction` 20–30s） | 7 | r76 r81 r113 r121 qc-paused qc-preview qc-realuser | 单跑判：见下面"单跑对照"那一格 |
| 点不到锚点（`locator.click` 超时） | 5 | r18 r30 r32 r34 r42 | 同上 |
| 活动栏⛔这一页（`data-activity` 空） | 2 | r23 r137 | 入口页换了但那颗闸门自己还在按"编译域活动栏"走 `newSandboxFile`（波次一的射程⛔ 盖到它） |
| 沙盒工具条锚点（`setSandboxToggle` 找不到「打开设置面板」） | 2 | qc-audit qc-audit2 | 工具条那颗钮改名/移位过一次，harness 的锚点没跟上 |
| 静态形状档读到已删组件（`ENOENT …/SettingsPanel.tsx`） | 1 | r114 | 与 `r87` 同族（档的名册还停在被删的那批组件上）＝任务 #69 |
| 读不到画布 `model`（`reading 'model'`） | 2 | r17 r120 | `window.__djsDebug` 那颗调试出口在编译模式下没挂上／或页面根本没挂载 |
| 执行上下文被导航打掉 | 1 | r48 | 页面导航与 `page.evaluate` 抢拍（老账：R48/R49 至今仍未判成） |
| 其余逐颗（内容级红，⛔ 归入环境） | 7 | r14 r19 r21 r31 r35 r87 r118 | 每颗都要单独定案：r19＝汉化漏网（8 颗器件名 + 命令面板）⚠**此判已改，见 ⑤-补4 的"r19 改判"**／r21＝移位输出 `Vector3vl xxxx`／r31＝沙盒"退出"那颗钮⛔ 在／r87＝Esc 名册下界／r14·r118＝画布读数分岔 |

**单跑对照（跑批刚结束就逐颗单跑，2026-10-18 05:17–05:21 UTC+8）——这一格推翻了我自己的假设**：
我原本打算把"等锚点/点不到锚点"这 12 颗归给**跑批超载**（批跑时机器上同时挂着 8 个 node 进程，
而超时上限只有 20–30s）。挑 4 颗单跑之后读数如下，⇒ **这族⛔ 能整体归环境**：

| 颗 | 批跑 | 单跑 | 单跑读数给的定性 |
|---|---|---|---|
| r76-sparse-mux | FATAL `waitForFunction` 超时（0 格跑完） | **7 PASS / 1 FAIL** | 部分复元＝批跑确实慢；但剩下那 1 格是真红（不是超载） |
| r81-line | FATAL `waitForFunction` 30s | **照样 FATAL 30s** | 真红：等的条件今天⛔ 会出现 |
| r30-verify | `locator.click` 30s | **照样超时** | 真红：死锚点 |
| r18-verify | `locator.click` 30s（`[7] 设置面板打开`） | **照样红** | 真红且已归责到底：它等 `input[data-setting="网格间距"]`，而 `data-setting` 这个属性在 `src/` 里**现读 0 处**，「网格间距」只剩 `settingsStore.ts:13` 那句注释——设置 UI 早已换成原生 `contributes.configuration` |

⇒ 结论改写：**"等锚点/点不到锚点"这 12 颗＝波次三的死锚点名册**（与第 ④ 节的已删 store 名册并列，
每颗都要按"现在用户看得见什么"重写锚点），⛔ 写进"环境红"里放过；
唯一带超载色彩的是 r76 那一格（0 格跑完 → 7 格跑完），那颗归到"跑批时序"另议。
⚠ 这条自我更正值得留着：假设（超载）比真相（死锚点）省一半工，所以我差点按它发榜。

**这一跑学到的一条台架教训（判"红名册"的读法）**：按**日志文本**给红归族会把族归错——
我这把尺取的是"表头之后固定四行"，而 `r42` 那格的红只有两行（`[4a] 展开图=null` + `locator.click 超时`），
第三、四行吃进了**下一颗档** `r43e` 的 `fileStore 404` ⇒ `r42` 被错归进编译侧那一族（17 颗写成 18 个名字，
颗数与名单当场对不上，这也是同一把尺自己暴露的）。现读核对：`tests/r42-verify.cjs` 里 `fileStore` 出现 **0 次**，
它的日志块（转储第 39–41 行）里也⛔ 那颗字样。
⇒ 归族一律**回到那颗档自己的源码**判（`src.includes("'/src/store/fileStore.ts'")`），
日志只当**症状**看且窗口按"到下一颗表头为止"切；这与名册 341（可重入守卫查的那颗串⛔ 进正文）是同一颗坑的两面：
**尺读的层错了**。⚠ 顺带一条自我更正：我第一版把原因写成"把转储贴进了 CHANGELOG"——那是⛔ 查过的猜测，
现读之后改成上面那句（预写诊断的代价在自家台架也一样贵）。




### ⑤-补4 波次二（17 颗编译侧档削皮）之后的第三次全量跑批（74 格，2026-10-18 05:20–07:07 UTC+8）

**差集读数（按 ⑤-补3 那条教训：方向性断言只认集合差，⛔ 由总量倒推）**：
GREEN 30 → **54**，RED 44 → **20**，ENVRED 0。逐颗比 = **24 颗红转绿、0 颗绿转红**。
24 颗的来历分三档，⛔ 混成一句"削皮见效"：

| 档 | 颗数 | 名单 | 这一档说的是谁 |
|---|---|---|---|
| 波次二削皮（fileStore 播种 → 宿主推送单） | **17** | r37 r40 r43e r44 r46 r50 r57 r61 r62 r83 r85 r92 r99 r115 r135-svg r135-part selfaudit2 | 这一批的账 |
| 波次一之后重写的四层版 | 1 | r42 | 上一节那批（本轮第一次在**跑批**里绿，此前只单跑绿过） |
| 本轮没动它而自己绿的 | 6 | r21 r48 r76 r118 r120 r121 | ⚠ **flaky 嫌疑**：同一份源码，批 2 红、批 3 绿。要么承认它们是时序判据（等 `model`/等展开图那一族），要么连跑两遍定族——已列进波次三，⛔ 把"自己好了"记成收益 |

**其中 r135-part-search-gate 的绿⛔ 是削皮给的**：削完仍 0 pass / 2 fail，真因是一颗产品缺陷
（`PartSearchDialog` 整颗没被挂载，Ctrl+F 两台画布都"按了没反应"）⇒ 见 `8c114a7` 与下面的 X24。

**剩下的 20 颗红按症状分族**（每颗都回到自己那行日志；⛔ 再按日志窗口归族）：

| 族 | 颗数 | 名单 |
|---|---|---|
| 点不到锚点（`locator.click` 30s） | 5 | r17 r18 r30 r32 r34 |
| 等锚点/条件超时（`waitForFunction`） | 5 | r81 r113 qc-paused qc-preview qc-realuser |
| 沙盒工具条锚点（`setSandboxToggle` 找不到「打开设置面板」） | 2 | qc-audit qc-audit2 |
| 静态形状档读到已删组件（`ENOENT …/SettingsPanel.tsx`） | 1 | r114 |
| ⚠ 汉化漏网（快捷键面板 8 颗器件名 + 命令面板）——**此族名已改判，见下面"r19 改判"** | 1 | r19 |
| 逐颗内容级（⛔ 归环境） | 6 | r14（缩放位移）r23（活动栏空）r31（沙盒退出钮）r35（提取器疑盲）r87（Esc 名册下界）r137（CSP 挂载） |

**r19 改判（波次三的第一颗，2026-10-18 现读）**：上表把 r19 归成"汉化漏网"⛔ 成立——那两格读的是**已删表面**。
`ShortcutsHelpDialog.tsx` 随旧 React 应用一起删除（`git log --diff-filter=D -- '*ShortcutsHelpDialog*'` → `95df75d`），
Ctrl+/ 与 Ctrl+Shift+P 在今天的 webview 里⛔ 有主人 ⇒ 批跑日志（`.tmpbuild/gates/r19-verify.log` 第 7–10 行）
真实读数是 `hasTitle:false` + `placeholder:null`＝**面板根本不存在**；而那 8 个字样
（Nand/Xnor/Repeater/Clock/Lamp/Input/Output/Constant）来自"找不到面板就退到 `document.body`"的兜底尺，
它们在调色板里本就是「与非门 / Nand」这种**双语行的副标签**。⇒ 旧判据把"锚点没了"与"文案没汉化"混进了同一格，
红得不带信息量。重写后判两块**活面**：
`[2a]` 原生命令面（`extension/package.json` 的 `contributes.commands` 31 颗标题全含中文 + 2 条 `keybindings` 都指向在册命令，
现读 `badTitles=[]` / `orphanKeys=[]`）；`[2b]` 画布调色板每一行（每颗 `button[data-gate]` 的整行文本必须含中文）。
⇒ **`[2b]` 第一跑就抓到一颗真产品缺口**：`UnaryPlus` 整行裸英文——`src/lib/sandboxCatalog.ts` 的 `CN_NAME`
里有 `Negation: '取负'` 却⛔ `UnaryPlus` ⇒ 补 `UnaryPlus: '正号器'`。现读 `node tests/r19-verify.cjs` =
**11 pass / 0 fail / 0 unverified**（`裸英文行: []`／`50 行`）。
⇒ 台架教训（与⑤-补3"尺读的层错了"同族）：**判据报红先问"它读的那块表面今天还在不在"**——
`hasTitle:false`、`placeholder:null` 这类"锚点为空"的读数⛔ 不能证明文案缺，它只证明尺够不着；
且**按行判（整行裸英文）优于按词判**（`[A-Za-z]{4,}`），后者天然把双语行的副标签算成缺陷。

**波次二的 UNVERIFIED 清单（16 格，各档都按"够不着就单列，⛔ 拿假对照充绿"登记）**：
r92 [1][2][3][4] ／ r83 [2b][4b][6][7][7b] ／ r115 [setup][1][3][4][6][7] ／ r135-part [5]。
逐颗三选一（换宿主侧真判据／退役留话／登记成产品缺口）写在任务 #74；
其中 r92 的"全局一份设置"那一格已核实＝**R150 路标③ 的既定裁定**
（`src/store/settingsStore.ts:1-6`：真源在宿主 `contributes.configuration`，片 5 起不再持久化），⛔ 再当缺陷挂着。

## ⑥ 挂账


- ~~**X18**：`src/canvas/legacyMigration.ts` 迁移时只带走 `name` + 正文，**丢了 `role:'part'` 与
  `partBindings`**~~ → **已闭（R154，两半各配证人）**：迁移现在交出 `key/role/bindings` 三颗，
  宿主按**同一颗批内 key** 连到落盘名并逐颗写进所在目录的 `.verilogviz.json`（解不到＝只记 Output，
  ⛔ 落一条悬空绑定）。证人＝`extensionHost.test` 的「X18 两半接得上」＋`legacyMigration.test.ts` 名册，
  台架＝`bin/C4` 之外另加的 seam 臂（见 CHANGELOG R154）。
- `.vh`/`.sv` 那半颗（X8/X17 的续集）：编译入口已三通，`examples/` 里仍⛔ 一颗 `.sv/.vh` 样例，
  所以域判定的正件靠 X 层的合成夹具——真机点验时要看两块板（模块/层次）真的列得出来。
- 6 颗"只剩死代码"的幽灵引用清理（第 ④ 节），一次提交带过。
