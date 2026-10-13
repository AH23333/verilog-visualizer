# studio/ —— 自带 VS Code 源码分支，出独立二进制

> 决策（2026-10-13 用户裁定，逐字）：**「我是说UI风格直接套壳vscode，而不是叫你在vscode打开…
> 当前只是要你进行框架的迁移，整体UI使用vscode套壳，类似当前各大厂商的agent/IDE产品」**，
> 形态选项里他选的是**「自带 VS Code 源码分支，出独立二进制」**（Cursor / Windsurf 同族做法）。
>
> 这句话纠正了我两轮的答非所问：R136–R138 做的是"把我们那套**自绘的**假 VS Code 界面塞进用户的 VS Code 标签页，
> 再写一颗脚本帮他打开"。⛔ 产品该长这样。真正的方向是：**workbench 本身就是 UI**，
> 我们的东西住进它的原生位置，产品是自己的一颗二进制，用户⛔ 需要另外装 VS Code。

## 0. 现状与目标的差距（先量，再改）

| 位置 | 现在 | 目标 |
|---|---|---|
| 窗口/标题栏 | 我们自绘（`App.tsx` 顶栏 + 曾经自绘的窗口三颗） | 基座原生 |
| 菜单 | `components/MenuBar.tsx` 183 行自绘下拉 | `menus.commandPalette` + 编辑器标题栏动作 + 原生菜单 |
| 文件树 | `components/Sidebar.tsx` + 我们的 `ProjectStore` 扫 `globalStorageUri/project_files` | **原生 Explorer**：项目根改成"打开的那个文件夹"（✅ 片 3a 已换轨），文件/重命名/拖拽/右键全交给 workbench（⬜ 树的主人还在我们手里，片 4 交出去） |
| 画布 | 一整块 `WebviewPanel`（一个标签页里装整个 SPA） | **custom editor**（`.djs` / `.viz` 文档 → 编辑器标签，脏标记/保存/关闭由 VS Code 管） |
| 层级／绑定／器件表 | 我们的 React 侧栏与弹窗 | `viewsContainers.activityBar` + `views`（`TreeDataProvider` / `WebviewView`） |
| 日志 | `components/OutputPanel.tsx` 238 行自绘 | `Output` 通道 + `window.createOutputChannel({ log: true })` |
| 问题列表 | 我们自绘 PROBLEMS 面板（含 V1 那颗行号缺陷） | `DiagnosticCollection` → 原生 Problems，行号/跳转/多文件都由 workbench 给 |
| 状态提示 | 我们的状态栏组件 | `window.setStatusBarMessage` / 自定义 `StatusBarItem` |
| 设置 | `components/SettingsPanel.tsx` + `projectConfigStore` | `contributes.configuration`（能进 Settings UI、可按工作区覆盖） |

⇒ 拆完的收益⛔ 只是"少写点代码"：V1（问题面板行号恒等）、V2b（状态栏反馈语）那一族自绘缺陷会随宿主接管而**消失**，
中文／主题／快捷键／无障碍也一并继承。

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
- **片 3b（下一片）**：`.djs` / `.viz` 注册成 `customEditors`——画布从"一个装满 SPA 的 panel"
  变成"编辑器标签里的那份文档"，脏标记、保存、关闭交给 VS Code。
  ⚠ 这一片必须与"沙盒电路正文从 webview `localStorage` 搬进宿主文件"同批落：`.djs` 一旦成为真文件就出现在树里，
  ⛔ 两套主人并存（磁盘一份 + localStorage 一份）让用户分不清哪份生效。
  ⚠ **动机已按读数改写**（见 `MIGRATION_VSCODE.md` §6b）：webview 的 `localStorage` 在我们自己的二进制里
  **确实跨启动稳定**（profile 的 `Local Storage/leveldb` 里读到 `verilog-viz-files` / `-folders` / `-onboarded`，
  5 次启动只有 1 颗 origin）⇒ 这一片⛔ 是为了"防丢"，而是**数据该是文件**（进 git、进 Explorer、能被另存为带走）。
- **片 4**：把 §0 表里"我们自绘"那几行逐个换成原生（文件树 → Explorer；日志 → Output；
  问题 → `DiagnosticCollection`；设置 → `contributes.configuration`；状态 → StatusBarItem），
  **换一颗删一颗**，⛔ 两套并存让人分不清哪个生效。
- **片 5**：branding 收尾（图标、`startupEditor`、精简掉⛔ 用的内置扩展与菜单）、Windows 打包脚本、
  独立 `--user-data-dir`（产品 behave 得像自己的 App，⛔ 污染他日常 VS Code 配置）；
  §1b 记的那条"共享存储落在 C 盘家目录"也在这一片按 D 盘口径处理。

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
- `extension/src/{html,projectStore}.ts` 与那 15 方法消息路由：继续用，只是**宿主从"用户的 VS Code"变成"我们这份二进制"**，
  内置扩展读得到基座的 `resources/`，CSP/装载逻辑一字⛔ 改（判据 `r137-webview-csp-gate` 也继续有效）。
- `pnpm app` 那颗启动脚本（R138）：降级为**开发用**入口，⛔ 再当成交付物；片 2 之后由基座产物取代
  （取代这件事现在**成立**：`scripts/code.bat --user-data-dir=D:\vv-studio\profile` 起的就是我们自己的二进制）。
