# Changelog / 变更日志

本项目所有值得注意的变更都记录于此。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
版本以开发批次 `R<n>` 为主键（首个正式 release 前）。

本项目变更以开发批次 `R<n>` 为主键；条目按批次倒序。

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
- `tests/unit/studioBrand.test.mjs` 12 格（vitest **58/58**）：基座其余键一颗都⛔ 丢、嵌套对象深合、
  数组整体替换、`_comment` ⛔ 进产物、**覆盖层⛔ 出现基座读不到的键**、漏合要能红、
  以及"写回时保住基座自己的缩进与行尾"。

### Fixed
- **覆盖层里三颗我脑补的键**（`win32x64UpdateId` / `quality` / `win32Arm64AppId`）：
  现读结果——`win32x64UpdateId` 在整个 checkout 里被读 **0** 次且 Code - OSS 的 `resources/win32` **一颗 `.iss` 都⛔**；
  `quality` 基座⛔ 有这颗键而我们⛔ 更新服务。加了没人读的键＝假装那是个决定，删。
- **`product.json` 被整档重排**：第一版按 2 空格写回，"只改 17 颗键"在 `git diff` 里是 **253 增 / 248 删**
  的缩进噪声；改成从原文认缩进后是 **21 增 / 16 删**，且再跑一次数字不变（幂等）。

### Changed
- README 的「宿主」一节改成**诚实版进度**：上一批写的是"唯一宿主＝VS Code 扩展壳"，方向错；
  `pnpm app`（R138）降级为**开发用入口**，⛔ 再当交付物。

### 实测前置（决定后面两片能不能跑）
`.nvmrc` 要 node **24.18.0**，本机 nvm 只有 18.20.8 / 20.19.5 / 22.20.0，且 `preinstall` 是硬拒；
C++ 工具链与 Python 齐（VS 2022 Community + BuildTools 的 `vcvars64.bat`、Python 3.13.0）；D 盘空闲 63.6 GB。
⇒ 装 node 24.18.0 与跑基座 `npm install` + `compile-client` 都要他点头（动他的机器状态、且会占住机器几十分钟）。

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
