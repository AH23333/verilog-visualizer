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
| 文件树 | `components/Sidebar.tsx` + 我们的 `ProjectStore` 扫 `globalStorageUri/project_files` | **原生 Explorer**：项目根改成"打开的那个文件夹"，文件/重命名/拖拽/右键全交给 workbench |
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
位置：D:\Visual Studio Code\Something\vv-studio\vscode      # 仓库**外**，⛔ 把 1 GB 上游源码塞进我们的 git
git clone --depth 1 --filter=blob:none https://github.com/microsoft/vscode.git
```

| 量到的事实 | 值 | 对计划的影响 |
|---|---|---|
| 上游版本 / 名称 | `code-oss-dev` **1.143.0** | 我们的是 Code - OSS（MIT），⛔ 微软那份带商标的二进制 |
| `.nvmrc` | **24.18.0** | 本机 nvm 只有 18.20.8 / 20.19.5 / 22.20.0 ⇒ **要先装 24.18.0** |
| `preinstall` | `node build/npm/preinstall.ts` | 版本不对是**硬拒**（⛔ 绕过；绕过去的构建结果⛔ 可信） |
| C++ 工具链 | VS 2022 Community + BuildTools 都有 `vcvars64.bat`；Python 3.13.0 | `node-pty` 等原生模块**编得动** |
| D 盘空闲 | 63.6 GB | 装得下 node_modules + Electron（量级 15–20 GB） |
| `resources/win32/*.iss` | **0 颗** | Inno 安装器脚本⛔ 在 OSS 树里 ⇒ `win32x64UpdateId` 这类键全 checkout 被读 **0** 次（我第一版的覆盖层里写了三颗这种"看着像配置"的键，已删，见 `product.overrides.json` 的 `_comment`） |
| 基座有没有内置市场 | `extensionsGallery` 基座⛔ 有，但 `build/lib/builtInExtensions.ts`、`build/hygiene.ts` 读它 | 要装扩展得指 **open-vsx**：微软 Marketplace 的条款⛔ 允许非 VS Code 产品调用（VSCodium 同理）——这条是法律边界⛔ 偏好 |

## 2. 本目录的东西

- `product.overrides.json` —— 覆盖层。每颗键都对照过基座：要么基座本来有，要么构建脚本确认读它。⛔ 整份覆盖 product.json。
- `apply-brand.mjs` —— ① 合并覆盖层进 `<fork>/product.json`（幂等，合并后**自检那几颗键真的落到位置**）；
  ② 把 `extension/` 的产物（`package.json` + `dist/extension.cjs` + `webview/**`）装成基座的内置扩展
  `extensions/verilog-visualizer/`。缺产物就报错并说清先跑哪条命令。
- 判据：`tests/unit/studioBrand.test.mjs`（9 格，含"基座其余键一颗都⛔ 丢"“数组整体替换”“`_comment` ⛔ 进产物”
  "覆盖层⛔ 出现基座读不到的键"“自检能抓到漏合”）。跑法 `pnpm test`。

## 3. 分期（每片都⛔ 破坏现有 73 格闸门能跑的那条路）

- **片 1（本目录，已完成）**：基座 checkout + 覆盖层 + 内置扩展安装脚本 + 无头判据。
- **片 2（⛔ 本目录脚本，要用户点头才跑）**：`npm install` 与 `compile-client` 在这台机器上真跑通（要先装 node 24.18.0，见 §4），
  产物能起一个 Code - OSS 窗口；把我们的内置扩展在**那份产物**里跑起来（现在扩展只能靠 `--extensionDevelopmentPath`）。
- **片 3**：文档模型换轨 —— `.djs` / `.viz` 注册成 `customEditors`，画布从"一个装满 SPA 的 panel"
  变成"编辑器标签里的那份文档"；脏标记、保存、关闭交给 VS Code。项目根从 `globalStorageUri`
  改成**打开的工作区文件夹**（这一步顺带解掉 R136 那颗"工程集合与工作区无关"的取舍，也让原生 Explorer 直接可用）。
- **片 4**：把 §0 表里"我们自绘"那几行逐个换成原生（文件树 → Explorer；日志 → Output；
  问题 → `DiagnosticCollection`；设置 → `contributes.configuration`；状态 → StatusBarItem），
  **换一颗删一颗**，⛔ 两套并存让人分不清哪个生效。
- **片 5**：branding 收尾（图标、`startupEditor`、精简掉⛔ 用的内置扩展与菜单）、Windows 打包脚本、
  独立 `--user-data-dir`（产品 behave 得像自己的 App，⛔ 污染他日常 VS Code 配置）。

## 4. 要用户点头才做的两件事（都动到他的机器状态）

1. **装 node 24.18.0**（`nvm install 24.18.0`，落在 `D:\NVM\nvm\v24.18.0`，满足"外部工具在 D 盘"）。
   我们的脚本会把该版本目录**只加进自己的 PATH**，⛔ 执行 `nvm use` 切他的全局默认。
2. **跑一次基座安装/编译**：`npm install`（数 GB、几十分钟）+ `compile-client`（更久）。
   这段时间机器会被占住，所以我⛔ 自己开着跑——上一批已经量到这台机器在中途会被别的东西挤到闸门超时。

## 5. 与既有几层的关系（⛔ 白扔）

- `src/lib/host/` 统一调用层：⛔ 白做——片 3/4 之后所有宿主调用都走 `vscodeHost` 那条 RPC，接口⛔ 改。
- `extension/src/{html,projectStore}.ts` 与那 15 方法消息路由：继续用，只是**宿主从"用户的 VS Code"变成"我们这份二进制"**，
  内置扩展读得到基座的 `resources/`，CSP/装载逻辑一字⛔ 改（判据 `r137-webview-csp-gate` 也继续有效）。
- `pnpm app` 那颗启动脚本（R138）：降级为**开发用**入口，⛔ 再当成交付物；片 2 之后由基座产物取代。
