# studio/ —— 自带 VS Code 源码分支，出独立二进制

> 决策（2026-10-13 用户裁定，逐字）：**「我是说UI风格直接套壳vscode，而不是叫你在vscode打开…
> 当前只是要你进行框架的迁移，整体UI使用vscode套壳，类似当前各大厂商的agent/IDE产品」**，
> 形态选项里他选的是**「自带 VS Code 源码分支，出独立二进制」**（Cursor / Windsurf 同族做法）。
>
> 这句话纠正了我两轮的答非所问：R136–R138 做的是"把我们那套**自绘的**假 VS Code 界面塞进用户的 VS Code 标签页，
> 再写一颗脚本帮他打开"。⛔ 产品该长这样。真正的方向是：**workbench 本身就是 UI**，
> 我们的东西住进它的原生位置，产品是自己的一颗二进制，用户⛔ 需要另外装 VS Code。
>
> ⚠ **同日第二次纠正（写在 §0b，那是本轮的工单）**：光"workbench 是壳"还不够——
> 「不是让你在vscode的壳内打开一个网页作为我的项目，而是应该将**绑定系统**移植到当前vscode壳**已有的文件系统**上，
> 以及移植**模块、层次结构**两个板块，以及**沙盒系统**」。⇒ 装整套 SPA 的那颗 `WebviewPanel`⛔ 是终态，它按 §3 的片 4 逐块退役。

## 0. 目标形态（2026-10-13 用户**第二次**定形，逐字）

> **「当前套壳vscode不是让你在vscode的壳内打开一个网页作为我的项目，
> 而是应该将绑定系统移植到当前vscode壳已有的文件系统上，以及移植模块、层次结构两个板块，以及沙盒系统」**

这句话判掉的是我这轮的做法：**把整套 React SPA 塞进一颗 `WebviewPanel` 里当产品**——那还是"在壳内打开一个网页"，
workbench 只是浏览器。真正的意思是**三块东西搬到宿主已有的原语上**（下表 §0b 的 A/B/C），
搬完之后那颗装 SPA 的面板就该退役（画布本身留在编辑器里，见 C）。

### 0b. 三块移植面（按他点名的顺序）

| 板 | 现在住在哪（行数现读） | 搬到宿主的哪个原语上 | 判定"搬完了"的样子 |
|---|---|---|---|
| **A 绑定系统** | `src/lib/gateSystem.ts` 578 行：`activePartBindings`（名字→文件名的映射）**存在 localStorage 里**，解析靠 `sandboxStore` 那份内存文件表（`resolvePartRef`/`partExists`/`resolveDefCells`/`findPartCycle`/`rebindLiveGraph`/`ensureDefsFromCells`） | **壳已有的文件系统**：部件＝工作区里的真文件，绑定＝**相对路径的解析**（`workspace.fs` + 原生 Explorer 的文件/文件夹），改名/删除由 workbench 发事件，我们只跟着重绑 | 沙盒里实例化一个部件 ⇒ 磁盘上就是一颗 `.djs`；重命名那颗文件 ⇒ 所有引用它的画布自己更新（原生 Explorer 里做，⛔ 我们的弹窗）；`partBindings` 那把 localStorage 表**没有存在必要** |
| **B 模块 + 层次结构两个板块** | `src/components/ModulePanel.tsx` 456 行、`src/components/HierarchyViewer.tsx` 301 行（都是自绘 React 侧栏） | **原生两棵树**：模块 ⇒ `DocumentSymbolProvider`（进 workbench 的 **Outline** 与面包屑，⛔ 我们再造一棵树）；层次结构 ⇒ `TreeView`（`contributes.views`，实例展开、双击钻取走 `openEditor`） | 侧栏里那两块是 workbench 画的树：跟随主题、能折叠、能搜索、F1/F2 快捷键与无障碍都由宿主给；⚠ 顺带结掉在册 **T-3**（`parseVerilogInstances` 回的是**外部模块名**⛔ 实例名，`HierarchyViewer` 用错过） |
| **C 沙盒系统** | `src/components/SandboxCanvas.tsx` 3798 行 + `src/store/sandboxStore.ts` 449 行（`.djs` 正文**只在 webview localStorage**，宿主调用计数 0）+ `src/App.tsx` 1786 行的模式编排 | **文档 = 真文件**：`.djs` 注册成 `customEditors`，正文走 `TextDocument`（脏标记/保存/关闭/撤销都由 workbench）；器件库与逐器件配置 ⇒ 命令 + QuickPick/原生视图；**只有 joint 画布与仿真时钟留在 webview**（那是⛔ 能用原生 UI 画的） | 打开一个文件夹 ⇒ Explorer 里点 `.djs` 就在编辑器标签里开出画布；标题栏有脏点、Ctrl+S 保存、关闭询问都归 workbench；换机/清 profile⛔ 丢电路（§6b 那条"数据该是文件"的理由） |

⚠ **A 与 C 必须同一批落**：绑定解析的 substrate 就是"部件＝文件"，而文件这件事只有等 `.djs` 进宿主文件系统才成立。
所以顺序是 **C 的文件那半 → A → B → C 的 UI 那半**（B 独立，随时可切）。

### 0c. 其余自绘 chrome 的去向（换一颗删一颗，⛔ 两套并存）

| 位置 | 现在 | 目标 |
|---|---|---|
| 窗口/标题栏 | `App.tsx` 顶栏（窗口三颗已于 R138 删） | 基座原生 |
| 菜单 | `components/MenuBar.tsx` 183 行自绘下拉 | `menus.commandPalette` + 编辑器标题栏动作 + 原生菜单 |
| 文件树 | `components/Sidebar.tsx` 604 行 + 我们的 `ProjectStore` 扫描 | **原生 Explorer**（根已于片 3a 换成打开的文件夹） |
| 日志 | `components/OutputPanel.tsx` 238 行自绘 | `Output` 通道（`createOutputChannel({ log: true })`） |
| 问题列表 | 自绘 PROBLEMS 面板（V1 那颗行号缺陷的主人） | `DiagnosticCollection` → 原生 Problems |
| 状态提示 | 我们的状态栏组件（V2b 那 50 处反馈语） | `StatusBarItem` / `setStatusBarMessage` |
| 设置 | `components/SettingsPanel.tsx` + `projectConfigStore` | `contributes.configuration`（进 Settings UI、可按工作区覆盖） |

⇒ 拆完的收益⛔ 只是"少写点代码"：V1／V2b 那一族自绘缺陷会随宿主接管而**消失**，中文／主题／快捷键／无障碍一并继承。


## 1. 基座怎么拿（这份 checkout 的事实，全部现读）

```
位置：D:\vv-studio\vscode                              # 仓库**外**，⛔ 把 1 GB 上游源码塞进我们的 git
                                                       # ⚠ 这一条路径是**测出来的**：见下方"路径⛔ 含空格"
git clone --depth 1 --filter=blob:none https://github.com/microsoft/vscode.git D:\vv-studio\vscode
```

| 量到的事实 | 值 | 对计划的影响 |
|---|---|---|
| 上游版本 / 名称 | `code-oss-dev` **1.143.0** | 我们的是 Code - OSS（MIT），⛔ 微软那份带商标的二进制 |
| `.nvmrc` | **24.18.0** | 本机 nvm 只有 18.20.8 / 20.19.5 / 22.20.0 ⇒ **要先装 24.18.0**（已装，见 §4） |
| `preinstall` | `node build/npm/preinstall.ts` | 版本不对是**硬拒**（⛔ 绕过；绕过去的构建结果⛔ 可信） |
| **路径⛔ 含空格** | 上游 `build/npm/preinstall.ts:143` spawn 时**⛔ 给路径加引号** | checkout 只要落在带空格的路径上，cmd 就在第一个空格切开：实测 `'D:\Visual' is not recognized as …`，**跑满四分钟才炸**。我们仓库自己就住在 `D:\Visual Studio Code\` 下面 ⇒ 基座**必须**放在仓库外（`apply-brand.mjs` 现在就检查，三秒内说清并给出替代命令） |
| C++ 工具链 | VS 2022 Community + BuildTools 都有 `vcvars64.bat`；Python 3.13.0 | `node-pty` 等原生模块**编得动**，但要 **Spectre 缓解库**（MSB8040，见 §4） |
| D 盘空闲 | 63.6 GB（装完 node_modules+Electron 后再量） | 装得下（量级 15–20 GB） |
| `resources/win32/*.iss` | **0 颗** | Inno 安装器脚本⛔ 在 OSS 树里 ⇒ `win32x64UpdateId` 这类键全 checkout 被读 **0** 次（我第一版的覆盖层里写了三颗这种"看着像配置"的键，已删，见 `product.overrides.json` 的 `_comment`） |
| 基座有没有内置市场 | `extensionsGallery` 基座⛔ 有，但 `build/lib/builtInExtensions.ts`、`build/hygiene.ts` 读它 | 要装扩展得指 **open-vsx**：微软 Marketplace 的条款⛔ 允许非 VS Code 产品调用（VSCodium 同理）——这条是法律边界⛔ 偏好 |
| `isExtensionDevelopment` 的真义 | `src/vs/platform/environment/common/environmentService.ts:105` ⇒ **只在传了 `--extensionDevelopmentPath` 时为真** | 我们编进自己产品的内置扩展是 **Production**：任何按 `extensionMode === Development` 写的"开发态才做"的逻辑，在我们自己的二进制里**永不触发**（片 2 的自动弹窗口就栽过这一条，已改，见 §4b） |

## 1b. 片 2 的实测读数（这一段⛔ 计划，是跑完抄回来的）

| 步骤 | 读数 |
|---|---|
| `npm install`（在 `D:\vv-studio\vscode`） | `added 1590 packages in 6m`，日志里 `npm error` **0 行** |
| `npm run compile-client` | `out/` **12,160 个文件**；`Finished compilation with 0 errors after 37397 ms`；`Finished 'compile' after 1.18 min` |
| `npm run electron` | 产出 `.build/electron/Verilog Visualizer.exe` = **239,129,088 字节** —— 文件名来自我们合进去的 `product.json` ⇒ **branding 当场可见** |
| 起窗口 `scripts/code.bat --user-data-dir=D:\vv-studio\profile` | 6 颗 `Verilog Visualizer.exe` 进程；窗口标题 `Verilog Visualizer - Verilog Visualizer Dev` |
| 内置扩展装载 | exthost 日志：`ExtensionService#_doActivateExtension local.verilog-visualizer-vscode, activationEvent: 'onStartupFinished'`，该日志 `[error]` **0 行**；main/window1 两份日志 `[error]` **0 行** |
| 共享存储落点 | `[shared storage] Creating shared storage database at 'c:\Users\34697\.verilog-visualizer-shared\...'` ⇒ 目录名走我们的 `dataFolderName`，但**家目录在 C 盘**——片 5 打包时要按"D 盘"这条硬约束处理（⚠ 在册，尚未改） |
| 画布像素 | **UNVERIFIED**：取这一格要把窗口从最小化激活，而他此刻正在用这台电脑 ⇒ 抢焦点⛔ 算"程序要用户多做一步"。点验单见 §4b 末 |

## 1c. 片 3a 的实测读数（项目根换轨 + 一颗只有真机能发现的问题）

| 项 | 读数 |
|---|---|
| 项目根 | `projectRoot()`＝**打开的工作区文件夹**；没开文件夹退回 `globalStorageUri/project_files`（旧家的东西还在那儿）；多根取第一颗（在册取舍） |
| 工程配置 | 单独一颗 `configRoot()`，**始终**应用级：⛔ 往用户仓库里扔 `verilog-viz.config.json`（那会让他的 `git status` 当场脏） |
| 扫描跳过 | `node_modules` 与任何点开头目录（根＝整仓代码后，一次 refresh 会走尽上万颗目录） |
| 真机 | 打开 `D:\vv-studio\demo`（8 位总线计数器 + 一层实例化）⇒ `code --status` 的 Workspace Stats：`Folder (demo): 2 files / File types: v(2)`；跑完那个目录里仍只有我放的 2 颗 `.v` |
| 无头网 | `tests/unit/vscodeApiStub.ts`（回 `Thenable` 的假宿主）+ `vitest.config.ts` alias + `tsconfig.json` paths；`tests/unit/extensionHost.test.ts` **25 格**走真 req/res 通道；台架 `bin/R139/bench_139_hostnet.py` **8 臂全部有红**；vitest **97/97** |
| ⚠ **只有真机能发现的问题** | 打开一个**从没信任过**的文件夹 ⇒ exthost 里连 `_doActivateExtension local.verilog-visualizer-vscode` 都⛔ 出现、`[error]` 0 行、窗口只剩 Welcome（受限模式）页；同一份产物加 `--disable-workspace-trust` 再跑，激活行当场回来 ⇒ 归责钉在清单缺 `capabilities.untrustedWorkspaces`。补上后**不带**那颗旗标再跑：激活 + 标题 `Verilog Visualizer - demo - Verilog Visualizer Dev`、`[error]` 0 行 |

**为什么选"声明支持未信任工作区"而⛔"整产品关掉 Workspace Trust"**（安全 > 稳定）：这份 fork 自带 js-debug 与 agent host，
那颗安全边界要留着；而我们⛔ 起进程、⛔ 执行工作区带来的可执行文件（Yosys/DigitalJS 是打进包的 WASM，
工作区内容只当文本读、当图渲染；前端两处 `innerHTML` 都只赋空串，webview 的 `script-src` 只有 nonce + origin）。
⚠ 残留：新开文件夹时用户仍会看到那颗"信任工作区"提示——那是宿主自己的安全 UI，⛔ 我这一层替它消掉（要消也得在片 5 按产品口径整颗决定）。

## 2. 本目录的东西

- **启动⛔ 我们自己的脚本（R141 起）**：跑产品＝基座官方 `scripts/code.bat --user-data-dir=<与基座同级的 profile> [<工程文件夹>]`；
  调试本扩展＝官方 `--extensionDevelopmentPath`；打包＝官方 `npm run gulp vscode-win32-x64-min`
  （任务名按平台/架构在 `build/gulpfile.vscode.ts:610` 生成，聚合任务在 :626；⚠ 这条⛔ 跑过＝UNVERIFIED，归片 5）。
  本目录唯一留下的自写脚本是 `apply-brand.mjs`——它只做"把产物放进官方位置"这一件事。
  ⚠ 被删掉的两颗包装（`scripts/run-in-vscode.mjs`、`scripts/run-studio.mjs`）连同它们 27 格判据都能走 git 历史找回；
  删的是包装，⛔ 是那段历史里"一条命令起产品"的真跑读数（§1d 那张表照留）。
- `product.overrides.json` —— 覆盖层。每颗键都对照过基座：要么基座本来有，要么构建脚本确认读它。⛔ 整份覆盖 product.json。
- `apply-brand.mjs` —— ① 合并覆盖层进 `<fork>/product.json`（幂等，合并后**自检那几颗键真的落到位置**）；
  ② 把 `extension/` 的产物（`package.json` + `dist/extension.cjs` + `webview/**`）装成基座的内置扩展
  `extensions/verilog-visualizer/`。缺产物就报错并说清先跑哪条命令；
  ③ 基座路径**含空格就早退**（`pathLooksBuildable`，带实测证据与替代命令，⛔ 让人等一次长安装再失败）。
  默认位置 `DEFAULT_FORK = 'D:/vv-studio/vscode'`，可用 `--fork=` 或 `VERILOG_STUDIO_FORK` 改指。
- 判据：`tests/unit/studioBrand.test.mjs`（**14 格**，含"基座其余键一颗都⛔ 丢"“数组整体替换”“`_comment` ⛔ 进产物”
  "覆盖层⛔ 出现基座读不到的键"“自检能抓到漏合”“默认位置自己就得通过空格检查”）。跑法 `pnpm test`。
- 开局判据：`extension/src/startupPolicy.ts`（⛔ import vscode，纯函数）＋ `tests/unit/startupPolicy.test.ts` 12 格；
  变异台架 `bin/R139/bench_139_startup.py`（4 臂，臂臂有红）。


## 3. 分期（每片都⛔ 破坏现有 73 格闸门能跑的那条路）

- **片 1（本目录，已完成）**：基座 checkout + 覆盖层 + 内置扩展安装脚本 + 无头判据。
- **片 2（已完成，读数见 §1b）**：基座 `npm install` + `compile-client` + `electron` 在这台机器上真跑通，
  产物能起一个窗口，我们的扩展作为**内置扩展**在那份产物里激活（⛔ 靠 `--extensionDevelopmentPath`）。
  ⚠ 一处真缺陷在这一片露出来并被修掉：自动弹窗口原规则只看 `extensionMode === Development`，
  而内置扩展在自家二进制里是 Production ⇒ 启动后只剩一颗 Welcome 页。判据搬到 `extension/src/startupPolicy.ts`。
- **片 3a（已完成，读数见 §1c）**：项目根从 `globalStorageUri/project_files` 换成**打开的工作区文件夹**
  （配置留在应用级，两颗根分开），并给 Extension Host 建起一面无头网（假宿主 + 25 格 + 8 臂台架）。
  这一步顺带解掉 R136 那颗"工程集合与工作区无关"的取舍，也让原生 Explorer 直接可用。
- **片 4＝§0b 那三块板搬到宿主原语上（下一批起一笔一块；顺序 C 的文件那半 → A → B → C 的 UI 那半）**：
  - **片 4-C1（进行中：宿主那半颗已落，见 §1d）**：`.djs` 注册成 `customEditors` + 正文走 `TextDocument`——沙盒电路**成为工作区里的真文件**，
    脏标记/保存/关闭/撤销交给 workbench。⚠ 与"正文搬出 webview `localStorage`"同批落（⛔ 两套主人并存，
    磁盘一份 + localStorage 一份，用户分不清哪份生效）；⚠ 动机已按 §6b 的读数改写：⛔ 是为了"防丢"
    （localStorage 在我们自己的二进制里跨启动稳定、5 次启动只有 1 颗 origin），而是**数据该是文件**
    （进 git、进 Explorer、能被原生另存为带走）。
  - **片 4-A**：绑定系统搬到那片文件系统上（`gateSystem` 的解析改走相对路径 + `workspace.fs`，
    `activePartBindings` 那把 localStorage 表随之失去存在必要）。⇒ **A 依赖 C1**，⛔ 先动 A。
  - **片 4-B**：模块 ⇒ `DocumentSymbolProvider`（进原生 Outline/面包屑）、层次结构 ⇒ `contributes.views` 的 `TreeView`；
    这两块独立、随时可切，顺带结掉在册 **T-3**（`parseVerilogInstances` 回的是**外部模块名**⛔ 实例名）。
  - **片 4-C2**：沙盒剩下的 UI 逐块搬（器件库/逐器件配置/波形…），**只有 joint 画布与仿真时钟留在 webview**；
    `App.tsx`（1786 行）那层"模式编排 + 顶栏 + 状态栏"随 §0c 逐行退役，
    最后**那颗装整个 SPA 的 `WebviewPanel` 删掉**——它就是这次被判掉的东西。
  - **片 4-chrome**：日志 → Output、问题 → `DiagnosticCollection`、设置 → `contributes.configuration`、状态 → StatusBarItem，
    **换一颗删一颗**，⛔ 两套并存让人分不清哪个生效。
- **片 5**：branding 收尾（图标、`startupEditor`、精简掉⛔ 用的内置扩展与菜单）、Windows 打包脚本、
  独立 `--user-data-dir`（产品 behave 得像自己的 App，⛔ 污染他日常 VS Code 配置）；
  §1b 记的那条"共享存储落在 C 盘家目录"也在这一片按 D 盘口径处理。

## 1d. 片 4-C1 的宿主半颗（R140 已落地；下表全是跑完抄回来的读数）

| 项 | 读数 |
|---|---|
| 一颗新 RPC | `listSandboxTree` ⇒ 方法表从 **15 → 16** 颗（前端 `vscodeHost.ts` ↔ 宿主 `extension.ts` 的对账判据下限同步提到 16，⛔ 改小） |
| 为什么另起一颗而⛔ 合并进 `listProjectTree` | 现读 `src/store/fileStore.ts:473-544`：`refresh()` 把回的**每一颗**都 `readProjectFile` + `parseVerilogModules` 当 Verilog 源码导入（:507），还带一条"磁盘上没了就从状态删"（:482-485）⇒ `.djs` 混进去＝电路 JSON 被当模块解析（模块名一片垃圾）＋沙盒列表被那边牵动 |
| 两颗表的实现 | `ProjectStore.collect(exts)` **共用一次 walk**（跳过规则、"相对根 / 分隔"、空文件夹上报三件事同源；复制两份 walk 将来只改一边就分岔）⇒ 台架 **M9** 就是"把 `.v` 也收进沙盒那颗表"，红了 2 格 |
| 浏览器档 | `browserHost.listSandboxTree()` ＝ **reject**（⛔ 返回空表：调用方把空表当"磁盘上没了"就会删用户电路，这条不变量由 `tests/unit/host.test.ts` 钉） |
| 真机 | 重新 `pnpm studio:brand` 后起自有二进制开 `D:\vv-studio\demo` ⇒ 标题 `Verilog Visualizer - demo - Verilog Visualizer Dev`、exthost 激活行在、`[error]` 0 行；demo 目录仍只有 2 颗 `.v`（前端尚未调用这颗新方法，符合预期） |
| 判据 | vitest **99/99**（97→99：新增两颗表的对账格 ×2）、台架 **9 臂全部有红**、根 tsc / extension typecheck / eslint / `pnpm build` 各 0 错 |

⚠ 顺手抓到的一颗**假 fs 的毛病**：`vscodeShell.test.ts` 里那份内存 `memFs.readDirectory` 把根自己（`@root`）也当一颗子目录上报，
旧的断言用的是 `toContain` 所以一直没露头；这一批新增的 `expect(folders).toEqual([])` 当场把它逼出来 ⇒ 修假 fs + 把那一格升成 `toEqual`。
**规矩**：列表类判据⛔ 停在 `toContain`——松断言既放过分母也放过测试双的错。

⬜ 剩下的半颗（下一批）：前端 `sandboxStore`（449 行、全同步、0 次宿主调用）接上这条通道——
开机时一次性从磁盘 hydrate（异步一次），运行时仍走同步内存表，改动走 write-through `hostFire`；
然后再谈 `customEditors` 把 `.djs` 变成编辑器标签里的那份文档。

## 3b. 版本线（2026-10-13 用户裁定，逐字）

**按"含⛔ 含 agent 功能"分两个版本**：**「当前项目我要另起一个版本，建议推送819563d5ecb7deff50f9da26176d3561348986b3，
往后的提交使用新的分支"agent版"提交（可先只推几个提交，但不要全部推送），我要根据是否含有agent功能分为两个版本」**。

| 线 | 落点 | 本轮读数 |
|---|---|---|
| `main`＝**无 agent 版** | 已推到 **`819563d`**（R135 那批：自包含 SVG 导出 + 证人 + 账本） | `git push origin 819563d…:refs/heads/main` ⇒ `54ce537..819563d`＝**5 笔**，fast-forward、⛔ force、`git diff --name-only` 15 颗文件里⛔ 敏感命名/无凭证串（唯一 `token` 命中的是 CSS 变量名） |
| **`agent`**＝往后所有提交 | 本地分支，指向 `f050d56`（R139 片 3a 收口那颗），建出来当轮就按他的令从 `agent版` **改名成英文**（`git branch -m`，纯本地操作，`origin` 那侧⛔ 有引用要跟着动）；**本轮⛔ 推这条分支**（他那句"不要全部推送"） | `git rev-parse --abbrev-ref HEAD` ＝ `agent`；`origin/agent` ⛔ 存在 |

⚠ 这条分线⛔ 表示"agent 功能已经写了"：到 `f050d56` 为止 agent 面仍是 **0 行代码**
（`docs/MIGRATION_VSCODE.md` §4 状态表里第 4/6 步＝⛔ 未开工；他另有一条令：先⛔ 搭 agent 功能）。
分线的意义在**发布口径**：无 agent 那份停在成熟骨架上，迁移（与新功能）都在 `agent` 上走（他原话里的「agent版」是**口径名**，落到 ref 上按他的令用英文）。
推 `agent` 与推 main 一样，**一事一授权**。

## 4. 装基座的实测前置（这一节是**跑过之后**写的，每条都对应一次真失败）

他这一批的原话授权：**「跑，你直接帮我装node，node use允许修改到更新的版本，可跑基座，顺便把缓存清空」**。

1. **node 24.18.0**：`preinstall` 硬拒低版本 ⇒ 装 24.18.0。本机是 nvm-windows（根 `D:\NVM\nvm`，
   满足"外部工具在 D 盘"），按许可 `nvm use` 切了全局默认。
2. **MSB8040 = Spectre 缓解库缺失**：`node-pty` 一类原生模块编不过。VS Installer 加组件
   `Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64.Spectre`（⚠ 这个 id 是从
   `C:\ProgramData\Microsoft\VisualStudio\Packages\_Channels\f40d10d6\catalog.json` 现读的；
   我先按社区流传的 `…VC.Lts.Spectre` 试，报 `Cannot find package in product graph`）。
   ⚠ 另一条：**非管理员跑 Installer 的 `--passive/--quiet` 直接 exit 5007** ⇒ 必须一开始就提权
   （`Start-Process -Verb RunAs`），⛔ 指望"失败后再以管理员重试"——那是把一步手工动作留给用户。
3. **`@vscode/ripgrep` 走 api.github.com 会 403**（本机 IP 未认证）：先把那份 zip 塞进它的下载缓存
   （`%LOCALAPPDATA%\@vscode\ripgrep\...`）⇒ 命中缓存就⛔ 打网络。这是网络边界，⛔ 产品缺陷。
4. **checkout 路径⛔ 含空格**（见 §1 那行实测）：`apply-brand.mjs` 现在会早退并给替代命令。
5. `node-gyp` 的 Electron headers 会落在 `C:\Users\…\AppData\Local\node-gyp\Cache\43.7.7\`（日志现读）——
   这一处⛔ 我们的脚本能改，属上游默认；片 5 打包时若要统一落 D 盘再一起处理（在册）。

### 4b. 开局窗口那颗判据（片 2 露出来的真缺陷）

旧规则 `extensionMode === Development` 在我们自己的二进制里**永不成立**（源码现读 `environmentService.ts:105`）。
新规则在 `extension/src/startupPolicy.ts`：环境变量 `VERILOG_VIZ_AUTOOPEN=1` ⇒ 开；开发宿主 ⇒ 开；
**扩展编在 `appRoot` 里（＝这就是我们的产品）** ⇒ 开；其余（我们被装进别人的编辑器）⇒ ⛔ 开。
按位置判⛔ 按 `env.appName` 字符串判——那是把行为押在品牌文案上，改一次名字就静默失效。

**⛔ 能自动化测的**（已按"他此刻在用电脑"处理，记 UNVERIFIED）：把最小化的 `Verilog Visualizer - Verilog Visualizer Dev`
窗口点回来，看编辑区是不是那张画布（有 `编译模式 / 沙盒模式` 那颗切换、⛔ 白屏、DevTools Console 0 错）。


## 5. 与既有几层的关系（⛔ 白扔）

- `src/lib/host/` 统一调用层：⛔ 白做——片 3/4 之后所有宿主调用都走 `vscodeHost` 那条 RPC，接口⛔ 改。
- `extension/src/{html,projectStore}.ts` 与那 16 方法消息路由：继续用，只是**宿主从"用户的 VS Code"变成"我们这份二进制"**，
  内置扩展读得到基座的 `resources/`，CSP/装载逻辑一字⛔ 改（判据 `r137-webview-csp-gate` 也继续有效）。
- 启动脚本：R138 的 `scripts/run-in-vscode.mjs` 与 R140 的 `scripts/run-studio.mjs` **R141 整颗删除**
  （他令「不要使用你自己编写的命令脚本，尽可能使用官方框架的运行命令」）。现在 `pnpm app` 是一条 **npm script**：
  里面全是官方命令（`pnpm build` / `pnpm -C extension build` / 基座 `scripts\code.bat` + 官方 flag），
  组合用的是 npm 自己的机制，⛔ 我们又写一颗 `.mjs` 去"聪明地"包装
  （`scripts/code.bat --user-data-dir=D:\vv-studio\profile [<工程文件夹>]` 起的就是我们自己的二进制）。
  准绳是他这一句：**「不要使用你自己编写的命令脚本，尽可能使用官方框架的运行命令」**。
