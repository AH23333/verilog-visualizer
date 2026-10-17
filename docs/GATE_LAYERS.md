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




## ⑥ 挂账

- **X18**：`src/canvas/legacyMigration.ts` 迁移时只带走 `name` + 正文，**丢了 `role:'part'` 与
  `partBindings`**（旧 `.djs` 里的部件身份与文件级绑定）。工作区形态里"部件身份"归目录绑定表，
  所以补法是按半颗分别落表：迁完把 `role:'part'` 的那些名字录进所在目录的 `.verilogviz.json`，
  `partBindings` 的键值逐个改名后落表。这颗属于"完善系统"，不属于闸门。
- `.vh`/`.sv` 那半颗（X8/X17 的续集）：编译入口已三通，`examples/` 里仍⛔ 一颗 `.sv/.vh` 样例，
  所以域判定的正件靠 X 层的合成夹具——真机点验时要看两块板（模块/层次）真的列得出来。
- 6 颗"只剩死代码"的幽灵引用清理（第 ④ 节），一次提交带过。
