# Changelog / 变更日志

本项目所有值得注意的变更都记录于此。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
版本以开发批次 `R<n>` 为主键（首个正式 release 前）。

本项目变更以开发批次 `R<n>` 为主键；条目按批次倒序。

---
## [未发布 Unreleased] — R140：版本分线（main＝无 agent 版）+ 方向第二次纠正（2026-10-13）

> 他这次说了两件事，逐字。分线：**「当前项目我要另起一个版本，建议推送819563d5ecb7deff50f9da26176d3561348986b3，
> 往后的提交使用新的分支"agent版"提交（可先只推几个提交，但不要全部推送），我要根据是否含有agent功能分为两个版本」**；
> 纠正：**「当前套壳vscode不是让你在vscode的壳内打开一个网页作为我的项目，
> 而是应该将绑定系统移植到当前vscode壳已有的文件系统上，以及移植模块、层次结构两个板块，以及沙盒系统」**。

### 版本线（本轮真跑过的推送）
- `origin/main` **快进到 `819563d`**（`54ce537..819563d`＝**5 笔**，R135 那批：自包含 SVG 导出 + 证人 + 账本）。
  推送前查过三件事：**是 fast-forward**（⛔ force）、`git diff --name-only` 只有 **15** 颗源码/文档/测试、
  凭证形状 grep **0** 命中（唯一 `token` 那句是 `getComputedStyle` 的 CSS 变量名）。
  ⚠ 用的是 `git push origin <sha>:refs/heads/main` 这种**指名 refspec**，⛔ `git push origin main`——后者会把全部 23 笔一起推上去，
  正是他那句"不要全部推送"要挡掉的。
- 新建本地分支指向 `f050d56`（R139 片 3a 收口那颗）并切过去，**往后的提交都落这条线**；
  ⚠ 同批按他的令把分支名改成英文（**「分支名称不要带有中文，改成英文，然后继续逐步推进」**）⇒ `agent版` → **`agent`**
  （`git branch -m agent版 agent`：纯本地改名，`origin` 那侧还⛔ 有这条引用，故⛔ 需要删远端旧名）。
  这条分支本轮**⛔ 推**（等他逐次点头）。⚠ 分线⛔ 等于"agent 功能已存在"：到 `f050d56` 为止 agent 面仍是 **0 行代码**，
  分的是**发布口径**（无 agent 那份停在成熟骨架，迁移与新功能都在 `agent` 上走）。

### 方向第二次纠正：⛔"在壳里打开一个网页"，而是要**移植**
我这轮交的是"一整块 `WebviewPanel` 装下整个 React SPA"＋"画布以后变成 custom editor"——按他这句话，
前者⛔ 是产品，后者还不够：要把**三块东西搬到宿主已有的原语上**。工单落进 `studio/README.md` §0b/§3（各带"判定搬完了的样子"一列）：

| 板 | 现在的住法（行数现读） | 搬到哪 |
|---|---|---|
| **A 绑定系统** | `src/lib/gateSystem.ts` 578 行：`activePartBindings`（名→文件）存在 **localStorage**，解析靠 `sandboxStore` 那份内存文件表 | **壳已有的文件系统**：部件＝工作区里的真文件，绑定＝相对路径解析；改名/删除由 workbench 发事件，我们只跟着重绑 |
| **B 模块 + 层次结构** | `ModulePanel.tsx` 456 行、`HierarchyViewer.tsx` 301 行（自绘 React 侧栏） | 模块 ⇒ `DocumentSymbolProvider`（进原生 **Outline**/面包屑）；层次结构 ⇒ `contributes.views` 的 **`TreeView`**；顺带结掉在册 **T-3** |
| **C 沙盒系统** | `SandboxCanvas.tsx` 3798 行 + `sandboxStore.ts` 449 行（`.djs` 正文**只在 webview localStorage**）+ `App.tsx` 1786 行的模式编排 | `.djs` ⇒ **`customEditors` + `TextDocument`**（脏标记/保存/关闭归 workbench）；器件库与配置 ⇒ 命令 + QuickPick/原生视图；**只有 joint 画布与仿真留在 webview** |

⇒ 顺序被依赖钉死：**C 的文件那半（片 4-C1）→ A → B → C 的 UI 那半（片 4-C2）**，最后那颗装 SPA 的面板删掉。
⚠ A⛔ 先动：绑定解析的 substrate 就是"部件＝文件"，而这件事要 C1 落地才成立。

### Changed
- `README.md`「宿主」一节改成二次定形（含版本线与"⛔ 是网页壳"这句），`studio/README.md` 顶部决策块追记第二次纠正、
  §0 重写成 §0b 三块板 + §0c chrome 表、新增 **§3b 版本线**（两条线的落点与推送读数都写进去）。

### 本轮⛔ 动的代码
片 3a 之后的 97 格判据一字未改（vitest 97/97 仍绿），这一轮是**分线＋工单重写**——工单写歪比代码写歪更贵，
因为它决定下一批往哪儿落刀。

---
## [未发布 Unreleased] — R139：方向纠正——自带 VS Code 源码分支出独立二进制（2026-10-13）

> **我连续两轮把方向理解错了**，先记这句。他要的是「**UI 风格直接套壳 vscode**」：workbench 本身就是产品界面，
> 我们做"把我们的界面装进 VS Code 的一个标签页"，还写了一颗脚本帮他打开——他那句
> 「更没叫你自己写运行脚本」就是对这两轮的判决。**目标形态＝Cursor / Windsurf 同族：自带 Code - OSS 分支，出我们自己的二进制。**

### Added
- **`studio/`：基座脚手架**（片 1）。`product.overrides.json` 只放"我们改哪几颗品牌键"，
  合并与内置扩展安装在 `studio/apply-brand.mjs`，分期与实测前置写在 `studio/README.md`。
- `pnpm studio:brand`（本轮真跑通）：① 把覆盖层合进基座 `product.json`，合并后**自检关心键真落到位置**；
  ② 把 `extension/` 的产物装成基座的内置扩展 `extensions/verilog-visualizer/`。
- `tests/unit/studioBrand.test.mjs` 14 格（vitest **72/72**）：基座其余键一颗都⛔ 丢、嵌套对象深合、
  数组整体替换、`_comment` ⛔ 进产物、**覆盖层⛔ 出现基座读不到的键**、漏合要能红、
  "写回时保住基座自己的缩进与行尾"、**默认基座位置自己就得通过空格检查**。

### Fixed
- **覆盖层里三颗我脑补的键**（`win32x64UpdateId` / `quality` / `win32Arm64AppId`）：
  现读结果——`win32x64UpdateId` 在整个 checkout 里被读 **0** 次且 Code - OSS 的 `resources/win32` **一颗 `.iss` 都⛔**；
  `quality` 基座⛔ 有这颗键而我们⛔ 更新服务。加了没人读的键＝假装那是个决定，删。
- **`product.json` 被整档重排**：第一版按 2 空格写回，"只改 17 颗键"在 `git diff` 里是 **253 增 / 248 删**
  的缩进噪声；改成从原文认缩进后是 **21 增 / 16 删**，且再跑一次数字不变（幂等）。

### Changed
- README 的「宿主」一节改成**诚实版进度**：上一批写的是"唯一宿主＝VS Code 扩展壳"，方向错；
  `pnpm app`（R138）降级为**开发用入口**，⛔ 再当交付物——片 2 之后由基座产物取代，这件事现在**成立**。

### 片 2：基座在这台机器上真的编出来、也真的起来了（他点头后跑的）

授权逐字：**「跑，你直接帮我装node，node use允许修改到更新的版本，可跑基座，顺便把缓存清空」**。

| 步骤 | 读数 |
|---|---|
| `npm install` | `added 1590 packages in 6m`，日志 `npm error` **0 行** |
| `npm run compile-client` | `out/` **12,160 文件**；`Finished compilation with 0 errors after 37397 ms` |
| `npm run electron` | `.build/electron/`**`Verilog Visualizer.exe` = 239,129,088 字节**（名字来自我们合进去的 `product.json` ⇒ branding 当场可见） |
| 起窗口（`--user-data-dir=D:\vv-studio\profile`，⛔ 碰他日常 VS Code 配置） | 6 颗自有进程；标题 `Verilog Visualizer - Verilog Visualizer Dev` |
| 内置扩展 | exthost：`_doActivateExtension local.verilog-visualizer-vscode`（`onStartupFinished`）；exthost/main/renderer 三份日志 `[error]` **0 行** |
| 画布像素 | **UNVERIFIED**——取这一格要把窗口从最小化激活，而他此刻在用这台电脑（抢焦点＝要用户多做一步，按本仓判据⛔ 做）。点验一行写在 `studio/README.md` §4b |

清缓存那一刀：删的是 `src-tauri/target`（**9.0 GB**，R138 拆完 Tauri 后它就是纯产物）。⛔ 动任何源码。

### 实测前置（每条都对应一次真失败，⛔ 是抄来的说明书）
1. **node 24.18.0**：`.nvmrc` 硬门槛 + `preinstall` 硬拒；本机 nvm 只有 18/20/22 ⇒ 按许可装了 24.18.0 并 `nvm use`（nvm-windows 根在 `D:\NVM\nvm`，满足"D 盘"）。
2. **MSB8040（Spectre 缓解库）**：`node-pty` 一类原生模块编不过。组件 id 现读 catalog 才对——
   先按社区流传的 `…VC.Lts.Spectre` 试，报 `Cannot find package in product graph`；真 id
   `Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64.Spectre`。
   ⚠ 另一条：**非管理员跑 Installer 的 `--passive/--quiet` 直接 exit 5007** ⇒ 必须一开始就提权（`Start-Process -Verb RunAs`）。
3. **`@vscode/ripgrep` 打 api.github.com 得 403**（本机未认证）⇒ 先把那份 zip 塞进它的下载缓存，命中就⛔ 打网络。
4. **checkout 路径⛔ 含空格**：上游 `build/npm/preinstall.ts:143` spawn 时**⛔ 加引号**，
   实测 `'D:\Visual' is not recognized as …`（跑满四分钟才炸）。我们仓库自己就住在 `D:\Visual Studio Code\` 下面 ⇒
   `DEFAULT_FORK` 改成从仓库相对位置推**会掉回同一个坑**，现在钉成 `D:/vv-studio/vscode` 并在 `apply-brand.mjs` 里**早退**（含空格就三秒内说清＋给替代命令，⛔ 让人等一次长安装再失败）。
5. `node-gyp` 的 Electron headers 落 `C:\Users\…\AppData\Local\node-gyp\Cache\43.7.7\`（日志现读）、
   共享存储落 `c:\Users\34697\.verilog-visualizer-shared\`——两处都⛔ 由我们的脚本决定，按"D 盘"这条口径**在册待处理**（片 5）。

### 片 2 露出来的一颗真缺陷：我们自己的二进制启动后只剩一颗 Welcome 页
旧规则是 `extensionMode === Development` 才自动弹面板。源码现读 `src/vs/platform/environment/common/environmentService.ts:105`
⇒ `isExtensionDevelopment` **只在传了 `--extensionDevelopmentPath` 时为真**，所以我们编进自家产品的内置扩展是 **Production**，
旧规则永不触发。修法：判据搬进 `extension/src/startupPolicy.ts`（⛔ import vscode，纯函数、可无头判）——
环境变量 `=1` / 开发宿主 / **扩展编在 `appRoot` 里（＝这就是我们的产品）** 三种来路各开一次，其余⛔ 开。
按**位置**判内置⛔ 按 `env.appName` 字符串判（后者把行为押在品牌文案上，改一次名字就静默失效）。
新增判据 `tests/unit/startupPolicy.test.ts` **12 格**（含"归一那一步是必要的"那颗变异证人、
"两边都空⛔ 算内置"、三档输入穷举）；台架 `bin/R139/bench_139_startup.py` **4 臂全部有红**。
vitest **72/72**（60→72）。

### 片 3a：项目根换成"打开的那个文件夹" + Extension Host 的一面无头网

| 项 | 读数 |
|---|---|
| `projectRoot()` | 开了文件夹就用它；⛔ 文件夹时退回旧家 `globalStorageUri/project_files`（⛔ 一升级就"我的文件全没了"）；多根取第一颗（在册取舍） |
| `configRoot()` | 单独一颗、**始终**应用级：⛔ 往用户仓库里扔 `verilog-viz.config.json`（那会让他的 `git status` 当场脏） |
| `ProjectStore` | 扫描跳过 `node_modules` 与任何点开头目录——⚠ 这条⛔ 是 Rust 版老规矩照抄，是"根＝整仓代码"这个新形态带来的 |
| 真机（自有二进制 + `--user-data-dir=D:\vv-studio\profile`） | 打开 `D:\vv-studio\demo`（8 位总线计数器 + 一层实例化）⇒ `code --status`：`Folder (demo): 2 files / File types: v(2)`；跑完那目录里仍只有我放的 2 颗 `.v` |
| 无头网 | `tests/unit/vscodeApiStub.ts`（**回 `Thenable`、⛔ Promise** 的假宿主）＋ `vitest.config.ts` alias ＋ `tsconfig.json` 的 `paths`（只配一处＝"tsc 过、跑起来找不到模块"那种红）；`tests/unit/extensionHost.test.ts` **25 格**走真 req/res 通道；台架 `bin/R139/bench_139_hostnet.py` **8 臂全部有红** |
| 判据合计 | vitest **97/97**（72→97）；根 tsc / extension typecheck / eslint / `pnpm build` 各 0 错 |

**抓到的那颗只有真机能发现的问题**（记法：症状 → 对照实验 → 归责）：打开一个**从没信任过**的文件夹后，
exthost 日志里连 `_doActivateExtension local.verilog-visualizer-vscode` 都⛔ 出现、`[error]` 0 行、
窗口只剩一颗 Welcome（受限模式）页——⛔ 报错、⛔ 有日志，正是"点了没反应"那一族最坏的形状。
同一份产物加 `--disable-workspace-trust` 再跑 ⇒ 激活行当场回来 ⇒ 归责钉死在清单缺 `capabilities.untrustedWorkspaces`。
补上（并带 `description`：受限模式里那句话是给**用户**读的，⛔ 让用户在⛔ 知道为什么放行的地方点放行），
再跑**不带**那颗旗标：激活 + 标题 `Verilog Visualizer - demo - Verilog Visualizer Dev`、`[error]` 0 行。
取舍＝**声明支持未信任工作区**而⛔"整产品关掉 Workspace Trust"（安全 > 稳定；这份 fork 自带 js-debug 与 agent host，
那颗边界要留着）：我们的东西⛔ 起进程、⛔ 执行工作区带来的可执行文件（WASM 打进包、工作区内容只当文本读；
前端两处 `innerHTML` 都只赋空串）。⚠ 残留：新开文件夹仍会看到宿主的信任提示，那是宿主自己的安全 UI，⛔ 我在这一层替它消。

顺带：`apply-brand.mjs` 那句"下一步见 §3 片 2（要先装 node 24.18.0）"讲的是**已经历过的事**，改成真的下一步（起窗口那条命令）。

### 那颗挂了三轮的开放项（webview `localStorage` 持不持久）拿到半份读数——用**读盘**，⛔ 抢屏幕

R136 起它一直挂着，因为取读数那一格在他的屏幕上。这一轮翻 profile 的 Chromium 存储层：

| 读的东西 | 读数 |
|---|---|
| `src/` 的 `localStorage` 射程（重新数） | 59 行（含注释）／真调用点 **47** 处（⚠ 旧口径 45 已过时）／**12** 个文件／**20** 颗键名 |
| `<profile>/Local Storage/leveldb/000003.log`（2,040 字节，自 21:06 未压实） | **有**我们的键：`verilog-viz-files`、`verilog-viz-folders`、`verilog-viz-onboarded` |
| 同一份存储里的 webview origin | **只有 1 颗**（`vscode-webview://1jljhded…48ut`），而这份 profile 起过 **5 次** ⇒ origin 跨启动不漂（若漂就该有 5 颗） |

⇒ 能判的那半：在"我们自己的二进制 + 固定 `--user-data-dir`"这一档，webview 的 localStorage 确实落进用户数据目录且 origin 稳定
⇒ "给 `ProjectHost` 加 `storageRead/storageWrite` + 注入 bootstrap、把 47 处同步读改异步"这条最贵的重构**⛔ 是为了持久而必须付**。
⇒ 判不了的那半（在册，一格点验）：**用户画的电路正文**跨重启还在吗（那个 profile 里没人画过电路，读盘只能看到空结构）。
⚠ 取这一格**⛔ 用 F5 的开发宿主**——那是临时 profile，读数⛔ 代表产品；这条前提已写进 `MIGRATION_VSCODE.md` §5A 第 5 格。
⇒ 片 3b 的动机因此改写：`.djs` 搬成工作区里的真文件⛔ 是为了防丢，而是**数据该是文件**（进 git、进 Explorer、能被另存为带走）。

### 台架自己红过的两处（⛔ 写进注释就当它对了）

1. `resetMachine()` 会连内存盘一起清，上一版把它留在 seed **之后** ⇒ 每个"先 seed 再 boot"的用例都在断言一颗
   被自己抹掉的文件，症状长得像产品缺陷（"找不到前端构建产物"）。现在"清场→铺盘→activate"的顺序由 `boot()` 独占。
2. 桩里 `registerWebviewPanelSerializer(_, _serializer: any)` 让被测文件的参数掉成隐式 any（根 tsc TS7006）——
   **桩⛔ 让被测代码变红，且那红⛔ 是它自己想问的事**；补了 `WebviewPanelSerializer` 接口把上下文类型还回去。

## [未发布 Unreleased] — R138：一条命令起壳 + Tauri 整条拆除（2026-10-13）

> 触发是他这两句：「我想要的效果是直接改成 vscode 套壳，但是当前启动方式还是原来的 tauri，
> 你给的 `pnpm -C extension build` 非常麻烦，应该是直接一行代码运行的，而不是你文档里那么麻烦还要 F5」
> ＋「当前项目要完全转向 vscode 类的 electron，要清理 tauri」。
> 上一批我把"能跑"写成"按 F5 → 再按 Ctrl+Shift+P → 再找那条命令"＝把三步手工动作留给用户，按本项目判据是缺陷。

### Added
- **`pnpm app`**（`scripts/run-in-vscode.mjs`）：缺产物就编（`dist/` 不存在、或 `src`/`public`/`index.html`/
  `vite.config.ts`/`package.json` 里有比它新的）→ 编 Extension Host → 找到 VS Code CLI →
  起一个挂了本扩展的窗口。`VSCODE_BIN=<路径> pnpm app` 是指路退路；`pnpm app:check` 只报现场、⛔ 真开窗口。
- `pnpm app:check` 这一颗存在的理由：**"找得到 CLI / 参数拼得对 / 该不该重编"本来可以无头判**，
  没它就只能真开一个 GUI 窗口才知道（既打扰用户，也把纯逻辑判据错登记成真机项）。
- `@vscode/vsce` 装成 `extension/` 的 devDependency ⇒ **`.vsix` 那条路由"⛔ 实测"变成跑过**：
  `pnpm ext:package` 产出 21 个文件 / 7.03 MB 的 `.vsix`（含 15.66 MB `yosys.wasm`）。
- `tests/unit/launcher.test.mjs` 9 格（新）：Windows 那条命令**每个含空格的参数各自带引号**、
  非 Windows 保持参数数组原样、CLI 查找三级优先（`VSCODE_BIN` → PATH（要 `--version` 真跑得通）→ 常见安装位置）、
  候选表按平台给、`needsBuild` 三臂（缺产物／src 更新／⛔ 白编）。

### Changed
- **宿主从三档收成两档**：`ProjectHost` 现在只有 `vscodeHost` / `browserHost`；
  `hostId()` 的 `'tauri'`、`isTauri`、五颗窗口控制方法与 `hasWindowControls` 一并离开接口。
- **开发宿主模式下扩展自己弹面板**（`extensionMode === Development` ⇒ `activate` 里直接 `openPanel()`），
  所以 F5 那条路也一起变短了；配套 `activationEvents: ["onStartupFinished"]`（⛔ 它，没人调命令就不会激活）。
- `r12-export` 的 [F] 三格改注 `acquireVsCodeApi` 桩（原来注 `__TAURI_INTERNALS__` 验 Rust 的 `save_export_file`）：
  验的还是**同一件事**——"点击前注入桩 ⇒ 探测每次现读"这条不变量，只是宿主换成了当前主宿主；
  [F2] 载荷判据因此从 `content[]` 数组改成 `args.base64`。

### Removed（Tauri 整条）
- `src-tauri/`（24 颗 tracked 文件：Rust 14 颗命令 / 402 行、`tauri.conf.json`、capabilities、icons）、
  `src/lib/host/tauriHost.ts`、`src/components/WindowControls.tsx`、`public/tauri.svg`；
  `App.tsx` 两处 `data-tauri-drag-region`；`@tauri-apps/api` + `plugin-opener` + `cli`（`pnpm install` 读数 **−4 个包**）；
  `pnpm tauri` 脚本、`vite.config.ts` 里 `TAURI_DEV_HOST`/hmr/`watch.ignored`、eslint 的 `src-tauri/**` 忽略项。
- ⚠ 回退方案改了口径：**⛔ 再"两条宿主并排维护"**，要找回那一版走 git（架构文档 §9.7 已改口）。
- 盘上留着⛔ 我删的：`src-tauri/target/`（9.0 GB Rust 缓存，gitignore 内）。删之前查过
  `src-tauri/project_files/` 是**空目录**（0 个文件 ⇒ 没人的电路住在那儿）。

### Fixed
- **启动器在 Windows 上会把命令拼断**（这颗是我自己写的，被单测当场抓住）：`code` 其实是 `code.cmd`
  ⇒ 必须走 shell；而 Node 的 shell 模式是**把参数用空格拼成一条串**交给 `cmd.exe` 的，⛔ 替含空格那段加引号
  ⇒ `--extensionDevelopmentPath=` 会断在 `D:\Visual Studio Code` 的第一个空格处指到 `D:\Visual`。
  这是 StarMark #261（`Start-Process -ArgumentList` 不引含空格元素）那一族的翻版，判据里还专门
  **先断"裸拼那种写法不等于我们的输出"**（⛔ 让两种写法都能通过 ⇒ 那颗闸门永远绿）。
- `pnpm-workspace.yaml` 里第二颗 `allowBuilds` **占位文本**（`@vscode/vsce-sign: set this to true or false`）：
  留着它 pnpm 会每条命令都报错。已明确写 `false` 并记理由（只本地打包⛔ 上架市场，签名用不上）——
  同一族坑 R137 已在 esbuild 上踩过一次。

### Known
- `.vsix` 装到用户机器上那一步（`code --install-extension`）**我没执行**——那是改他的编辑器状态，等他点头。
- 上一批的两条仍欠：扩展端到端台架（真开 EPH 驱动 webview）、webview `localStorage` 持久性读数。

---
## [未发布 Unreleased] — R136 → R137：VS Code 壳落地（2026-10-13）

### Added
- **`extension/`：VS Code 壳（Extension Host 半段）**，基座照微软官方 `webview-sample` + `esbuild-sample`，
  ⛔ 自己发明轮子（候选件维护读数记在 `docs/MIGRATION_VSCODE.md` §3；`webview-ui-toolkit-samples` 已归档、
  `githubnext/vscode-react-webviews` 停在 2021）。四颗新文件：
  `html.ts`（**纯函数**：改写 Vite 产出的 `dist/index.html` —— 资产→`asWebviewUri`、注入 CSP + `<base>`、
  给每颗 `<script>` 挂 nonce）、`projectStore.ts`（`sanitizeRel` + 文件/文件夹 CRUD + 树 + 配置，
  语义逐条对齐 Rust `lib.rs`）、`extension.ts`（面板装载 + **15 方法**消息路由 + `showSaveDialog` 另存为，
  取消＝`false` 不是 error）、`esbuild.js` / `sync-webview.js`（打包，external 只留 `vscode`）。
- **命令「打开项目文件所在文件夹」**：`revealFileInOS` + 路径抄进剪贴板。⛔ 让人去猜 globalStorage 的拼法
  才能核对落盘＝那是缺陷，不是"使用文档问题"。
- `tests/r137-webview-csp-gate.cjs`（11 PASS / 0 FAIL / 1 UNVERIFIED）：**在真浏览器里按壳那份 CSP 跑这张画布**。
  三份页面分开（固定份 / 带"无 nonce 靶子"那份 / 摘掉 `script-src` origin 的变异份），
  CSP 与改写器**从 `extension/src/html.ts` 现读**（esbuild 就地编 CJS），⛔ 在闸门里抄第二份。
- `.vscode/{launch,tasks}.json` 入库（F5＝「运行 扩展开发宿主」），根 `package.json` 加 `ext:build|watch|check|package`，
  `pnpm-workspace.yaml` 接 `extension` 包（并把 `allowBuilds.esbuild` 那颗占位串改成 `true`——占位文本会让 pnpm 静默跳过 esbuild 的 postinstall）。
- `tests/unit/vscodeShell.test.ts` 由 8 格加到 **11 格**（vitest **39/39**）：
  **RPC 两张表对账**（前端 `vscodeHost` 调的 15 颗 ⇔ 宿主 `dispatch()` 认的 15 个分支，双向差集都要空，
  并先断"两边都抽到了 ≥15 颗"——⛔ 让"两边都空 ⇒ 相等 ⇒ 绿"那种假绿灯存在）；
  **面板释放登记只一处且住在两条装载路共用的 `wirePanel` 里**。
- 跑批收口读数：**`RED=0 ENVRED=0 GREEN=73 NOVERDICT=0 共 73 格`**（本轮零红，无需归因）。

### Fixed
- **面板释放登记只挂在"按命令新开"那一条路上**：`extension.ts` 里 `onDidDispose` 原先写在 `openPanel` 内，
  而面板还有第二个来路——窗口重启时 `registerWebviewPanelSerializer` 恢复出来的那颗。
  恢复 → 关掉 → `currentPanel` 仍指着已释放的面板 ⇒ 再按命令走 `reveal()`＝**点了没反应**。
  现在登记收进两条路共用的 `wirePanel`（一处主人），并加 `currentPanel === panel` 守卫
  （⛔ 旧面板的 dispose 抹掉新面板的登记）。证人：`tests/unit/vscodeShell.test.ts` 钉"全文件只有一颗 `onDidDispose`，且住在 `wirePanel` 里"。
- **CSP 少了 Prism 那张 CDN 样式表的放行**：`style-src` 原先只收 `cspSource` + `'unsafe-inline'`，
  而 `index.html` 里 Prism 主题走 `https://cdnjs…/prism-tomorrow.min.css` ⇒ R137 首跑实测报
  `…prism-tomorrow.min.css|style-src-elem`。症状是**代码编辑器没了配色，且只在壳里发生**（dev 不带 CSP）。
- `vite.config.ts`：`base` 改成"构建走 `./`、dev 走 `/`"。webview 与 `file://` 拿不到绝对根路径，
  这是壳能装载资产的前提；四处跑 dist 的闸门（`qc-preview`/`qc-paused`/`qc-realuser`/`r23-verify`）
  单跑复核 **2 / 6 / 4 / 12 全绿**（＝改产物基址没碰坏生产包那一档）。

### Known（⛔ 已修，⛔ 已测出）
- `script-src` 里加的 `cspSource` **⛔ 不是"已测缺陷的修法"**：我原先的判断是"`import()` 出来的分块带不上 nonce
  ⇒ 宿主层那三颗分块会被 CSP 拒"，但变异臂把 origin 摘掉后**内联探针与外联 chunk 两条 `import()` 路都仍放行**
  ⇒ 本机 Chromium 把调用方 script 的 nonce 传给了 `import()`。那一格如实记 **UNVERIFIED**；
  保留 origin 只是⛔ 对"nonce 到底传不传递"这件事不做赌注（放行面收在 `localResourceRoots` 内我们自己的 dist）。
- **唯一的大开放项＝webview 的 `localStorage` 持不持久**：`src/` 里 45 处真调用点，其中**沙盒电路文件正文**
  （`verilog-viz-sandbox-files`）**完全不经过宿主**（`sandboxStore.ts` 里 `getHost|hostFire|saveProjectFile` 计数 **0**）。
  VS Code 官方对 webview 的建议是 `getState`/`setState`，⛔ 认可 `localStorage`。这一轮**⛔ 先动代码**：
  两种下落要两种修法，先按 `docs/MIGRATION_VSCODE.md` §5A 第 5 格取真机读数（关面板→关窗口→重开→电路还在吗）。

## [未发布 Unreleased] — R136（2026-10-13）

### Changed
- **前端调用层中立化（VS Code 套壳迁移第一步）**：新增 `src/lib/host/`——一份 `ProjectHost` 接口 +
  三档实现（`tauriHost` 等价搬运 / `vscodeHost` Webview 侧带 id 配对与超时的 JSON-RPC / `browserHost`
  给 dev 与无头闸门）。原先散在 5 颗文件里的 **20 处** Tauri 直连（`exportUtils` 1、`fileStore` 14、
  `projectConfigStore` 2、`CodeEditor` 3 处剪贴板）与 `WindowControls` 自带的运行时探测全部收口；
  现在 `src/` 里除 host 目录外 `@tauri-apps` 引用为 **0**。UI 行为与文案**逐点保持原样**
  （fire-and-forget 的 `Failed to …` 前缀一字未改）。
- 三条不变量：宿主探测**每次调用现读**（否则 `r12-export` 验原生保存路径的三格会变假绿灯）；
  `browserHost` 的文件类方法**必须 reject**，不许返回空表（`fileStore.refresh()` 会把空表当
  "磁盘上文件已删"，从而抹掉 localStorage 里用户的全部文件）；VS Code 那档消息按 JSON 序列化，
  导出字节走 **base64**、一问一答按 id 配对（⛔ 拿"最后一条回复"当结果）。

### Added
- `tests/unit/host.test.ts` 13 格（node 环境，无需浏览器）：探测换档、reject 形状、base64 分块、
  并发 id 不串号、超时、`hostFire` 留痕。首跑即抓到一颗真形状错——"不支持"那几颗原本 `throw`
  （同步炸）却声明成 `Promise`，`h.x().catch()` 会在调用点炸开 ⇒ 全改 reject。
- `docs/MIGRATION_VSCODE.md`：迁移执行台账（实测耦合面 / 已落地层 / 套壳基座选型 / 步骤射程 / **点验单**）。

### Fixed
- 两颗被 R132 hooks 化搬空的生产侧证人（产品没坏、锚点漂了）：`r81-line-gate` [6] 与
  `r83-errorcopy-gate` [7]/[7b] 原先只读 `src/App.tsx`，而 `line: err.line` 与「正在编译…」
  已搬进 `hooks/useCompilePipeline.ts` ⇒ [7] 变成**看不见 hook 的假绿灯**、[7b] 误红。
  现在扫"生产侧文件集合"（App + 组件 + `src/hooks/*`）并在读数里报告扫过哪几颗文件。

## [未发布 Unreleased] — R134 → R135（2026-10-13）

### Fixed
- **编译模式「导出 SVG」打开是纯黑矩形、文字看不见**（用户 2026-10-13 报）：深色主题的器件填充本就是
  近黑的 `rgb(35,40,48)`，构建器却写死 `#ffffff` 白底 ⇒ 黑块压白底、浅色字压白底。现在导出底色
  ＝**屏幕上那张画布的颜色**（容器链向上取第一颗不透明背景，退回主题令牌 `--canvas-bg`）。
- **导出的图整块被挪出画面**：克隆里摘掉「视口层」平移/缩放后，viewBox 仍按**带平移**的
  `svg.getBBox()` 开 ⇒ 内容与框错开（实测 18px，滚过/缩放过更离谱）。现在取景与内容用同一坐标系。
- **导出可能导出成图标**：`querySelector('svg')` 在钻进子模块（面包屑箭头图标）或开着输入面板浮层时
  取到的是 24×19 的 lucide 图标。现在走 `pickPaperSvg()`（先认 `.joint-paper svg`，退化取面积最大的一颗）。
- 内联样式补齐 `marker-*`/`visibility`/`display`/`color`/`dominant-baseline`（连线箭头是 marker 画的，
  漏一项就"少画一样东西"），并去掉导出里的 joint 工具/手柄层。

### Changed
- **自包含 SVG 收成一份主人**：`exportUtils.buildStandaloneSvg()` 供编译模式与沙盒共用，
  `utils/sandboxExport.ts` 不再各自克隆/铺底/取景（两模式从此不会再各自漂）。
- 证人同步：`r12-export` 里"文件含 `#ffffff`"换成**成对判据**（文件底色 == 屏幕画布底色）。

### Added
- `tests/r135-svg-export-gate.cjs`（7 格，已进 `run-all.cjs`）：判据读**下载下来的字节**并与 live paper 配对
  ——选对 svg／网络名在文件里／文字与底色亮度差≥60／取景同一坐标系／电路 JSON devices 与 paper 器件成对／
  综合网表三层 module 全在册＋带名连接实例／底色跟随主题。首跑 **7 pass / 0 fail**。
- `pnpm test`（vitest，`tests/unit/lib.test.ts` 15 格）：锁定 lib 层纯函数当前实测行为，
  为「UI 改 VS Code 套壳、lib 不变」的迁移准备安全网；`tests/unit` 已纳入 `tsconfig.include`。

---


## [未发布 Unreleased] — R121 → R123（2026-10-10/11）

### Added
- **R121 沙盒画布注释（便签）**：双击空白建签即输入、`Esc` 提交、二次编辑、自动换行贴字、
  边拖改比例 / 角拖等比缩放（文字随缩放）、旋转/镜像与部件同通道、编辑时正向文字、
  展开图同坐标原位叠加。闸门 17 格 + 全量回归。
- **R123 部件循环依赖检测与断环**：放置自嵌套/互嵌当场拒绝并展示环路径；存量环档案
  展开图渲染 ⟲ 空壳不崩；画布顶部常驻警告条点名环。闸门 6 格。
- **R122 沙盒自动保存**（设置面板三态：关/开+间隔/防抖落盘）与 **Tauri 原生导出对话框**统一路径。
- **Ctrl+F 焦点分流**：编辑器内=查找替换；画布上=部件搜索（两模式）。
- 部件绑定入口统一为文件级「部件绑定」弹窗；综合网表 / 电路 JSON 导出。

### Changed
- 导出收口：两模式统一走 `saveExport` 单一真源（Tauri 原生对话框 / 浏览器回退）；
  SVG 改深度重绘（计算样式内联，无 foreignObject）。**PNG 导出下线**（用户侧确认中）。
- BusSlice 切片配置记法定案：`起始位:结束位` **含两端**（`0:3` 取 4 位、`1:1` 取 1 位，
  兼容 Verilog 降幂 `3:0`）；总线总位宽收缩钳制修复。
- 编译模式点击连线改为**高亮连线本身**（原误映射为两端器件）。
- SandboxCanvas 前言区抽出 `sandboxCatalog.ts`（拆分第一步）。

### Fixed
- 切档重建读 store 最新实体（修「切回文件编辑显丢失」回归，r122 闸门 9/9）。
- 注释三处视觉缺陷（文字与框分离 / 继承描边 / 拉伸缩放文字）。
- 嵌套模块展开图「内部电路渲染失败」（上游 cloneDeep 拷死内嵌 graph，卷十九全案）。

## [R113-R120] — 2026-10-08/09

- **Added**：表达式生成器（R117 布尔式→电路；R118 多语句+CSE+直接存部件；
  R119 多位总线与切片 `a[msb:lsb]`；R120 `{A,B}` 拼接/常量/级联）；
  两模式左栏视觉统一（R115）；常量折叠显示（R114）；综合脚本双流化（R116）。
- **Fixed**：镜像/旋转组合操作根因修复（R113 模型级镜像重写）。

## [R99-R112] — 2026-10-07

- **Added**：模型级镜像随存档往返、文件级部件绑定（对齐编译模式 moduleBindings）、
  FSM/存储器端口配置器、走线全局化、深色主题标注全链路、仿真速度双模式统一。

## [R37-R40] — 2026-10-05（仓库重建基线）

- **Changed**：`.git` 元数据损坏 → 工作树重建（R33-R36 提交对象丢失，`8b75165` 全量检查点起步）。
- **Added**：部件 = 可编辑 `.djs` 文件 + 作用域感知绑定（R39）；展开图完整交互
  （光标锚定缩放/平移/递归钻取，R38/R40）；复制到沙盒递归迁移子模块。
- **Fixed**：`paper.model.toJSON()` 挂死 → 白名单序列化体系；`found id duplicities in ports`
  → IO net 唯一化；net 高亮/点击语义修复。

---

> 更早历史（R1-R36）因仓库重建丢失提交对象；过程与决策全链见
> [审查账本](./PROJECT_DEEP_REVIEW_2026-10-05.md)（卷一起）与 [archive/](./archive/)。
