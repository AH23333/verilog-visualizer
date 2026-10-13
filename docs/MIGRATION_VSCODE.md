# VS Code 套壳迁移（进行中）

> 决策出处：`docs/AGENT_PRODUCT_ARCHITECTURE.md` §1.1 / §9（2026-10-12 由备选升为主方案）。
> 本文件是**执行台账**：记录已实测的事实、已落地的层、下一步与点验单。⛔ 拿架构文档里的
> 估算数字当现状（那几处旧口径本轮已按实测更正，见 §1）。

## 0. 一句话进度
> ⚠ **2026-10-13 R139 方向纠正**：本文件记的"VS Code 扩展壳"两段（调用层、Extension Host 与 CSP 判据）都继续有效，
> 但它⛔ 是终点。用户裁定的形态是**自带 VS Code 源码分支、出独立二进制**（整体 UI＝workbench，⛔ 我们自绘一套假的），
> 分期与实测前置在 **[studio/README.md](../studio/README.md)**；本文件里的"回退方案／点验单"以那份为准。


前端调用层已中立化（`src/lib/host/`，提交 `4ef5860`）⇒ 换宿主不再需要挨处改 UI；
套壳基座选定**微软官方 sample**（已拉取，不自己写）；**Extension Host 侧已落地**（`extension/`：
面板装载 + 15 方法消息路由 + `workspace.fs` 项目目录 + `showSaveDialog` 另存为），
且那份 CSP 与资产改写**已过真浏览器判据**（`tests/r137-webview-csp-gate.cjs`，见 §3.5）。
⇒ **宿主＝VS Code 这一族**（R136–R138 落的中立层与壳都继续有效），但**交付形态已改**：
最终宿主是**我们自己的 Code - OSS 分支二进制**（`studio/`，片 2 已实测跑通编译并起过窗口，读数在
[studio/README.md](../studio/README.md) §1b），`pnpm app` 那一颗**降级为开发用入口**（⛔ F5、⛔ 命令面板），
Tauri 那条线整条删除（§8）。
剩下的真开放项有两颗大的：① **webview 里的 `localStorage` 到底持不持久**（§6，未实测）；
② **界面还没换成 workbench 原生位置**（片 3/4：`customEditors` + Explorer/Output/Problems/Settings 接管）。

## 1. 耦合面实测（2026-10-13）

| 项 | 文档旧口径 | 实测 |
|---|---|---|
| 前端直连 Tauri 的文件 | 5 个 | **5 个** ✓（`lib/exportUtils.ts`、`store/fileStore.ts`、`store/projectConfigStore.ts`、`components/CodeEditor.tsx`、`components/WindowControls.tsx`） |
| `invoke` 调用点 | 16 处 | **20 处**（1 + 14 + 2 + 3；旧口径漏数 CodeEditor 的三处动态 import 与 exportUtils 那颗） |
| `listen(...)` 事件 | 需改 webview 消息 | **0 处** ⇒ 该条工作量本期不存在 |
| Rust `lib.rs` | ≈385 行 | **402 行 / 14 颗 `#[tauri::command]`** |
| 自绘标题栏 | 整文件删除 | `WindowControls.tsx` 仍在，但已改成认 `host.hasWindowControls`（VS Code 下自然不渲染，⛔ 再自带一份探测） |

## 2. 已落地：`src/lib/host/`（统一调用层）

```
host.ts          ProjectHost 接口 + 现读探测 + hostFire（fire-and-forget 留痕）
tauriHost.ts     现有实现的等价搬运（14 命令 + 窗口 API + 剪贴板插件）
browserHost.ts   dev / 无头闸门那一档：文件与配置一律 reject（⛔ 返回空表）、导出走 <a download>
vscodeHost.ts    Webview 侧带序号 RPC：acquireVsCodeApi 缓存、base64 传字节、超时与 id 配对
```

三条不变量（写进 `host.ts` 文件头，改这层前先读）：
1. **探测每次现读**——`r12-export` [F1]-[F3] 在点击前注入 `__TAURI_INTERNALS__` 验原生保存路径，
   模块加载期求值会把那三格变成假绿灯；
2. **`browserHost` 必须 reject**——`fileStore.refresh()` 拿到空 `tree.files` 会把 localStorage 里
   用户的全部文件当"磁盘已删"过滤掉；
3. **VS Code 消息是 JSON 序列化的**——字节走 base64（分块 `String.fromCharCode`），
   每问每答按自增 id 配对 + 超时（普通 20s、另存为 5 分钟），取消＝`false` 不是 error。

验收读数（R136 落这一层时）：`pnpm test` 当时 **28/28**（含 `tests/unit/host.test.ts` 13 格：探测换档、reject 形状、
base64、id 不串号、超时、hostFire 留痕）、`tsc --noEmit` 0 错、`eslint src --quiet` 0 error、
`grep -rn "@tauri-apps" src | grep -v src/lib/host/` **0 行**。
全量跑批（71 格）见 `docs/PROJECT_DEEP_REVIEW_2026-10-05.md` 卷四十二 §三。
（**当前**读数在上一节末与 §7：vitest 39/39、跑批 73/73 GREEN。）

## 3. 套壳基座：拉已有项目，⛔ 自己写

已拉（浅克隆 + sparse checkout，落在仓外工作目录 `D:\Visual Studio Code\Something\.tmp-vsc-samples`，MIT 含 LICENSE）：

- `microsoft/vscode-extension-samples` → **`webview-sample`**（`createWebviewPanel` +
  `localResourceRoots` + `asWebviewUri` + `cspSource`/nonce + `onDidReceiveMessage` +
  `registerWebviewPanelSerializer`，revive 时重置 options）与 **`esbuild-sample`**（扩展侧打包）。
  维护状态：活跃（`engines.vscode ^1.100.0`、TS 5.9、eslint 9）。

候选但⛔ 不用（维护状态读数）：`githubnext/vscode-react-webviews` 最后提交停在 2021；
`microsoft/vscode-webview-ui-toolkit-samples`（`frameworks/hello-world-react-vite`）**2024-08-02 已归档**。

我们要做的只有两处适配（其余照官方件）：
1. panel 的 HTML 指向**我们已构建的 Vite SPA**（`dist/`）：需 `base: './'`、
  CSP 放行 wasm/worker（yosys-wasm 是 `fetch`+`WebAssembly`，digitaljs 走 `<script>`），
  并把 `webview-sample` 的 `media/` 换成 `dist/`；开发期保留"刷新即重灌 HTML"的路子（官方 sample 无 HMR）。
2. Extension Host 侧加一颗**消息路由**：把 `vscodeHost` 的 14 个方法接到
   `workspace.fs` / `window.showSaveDocument`（`Uri` + filter）/ `env.clipboard` /
   `SecretStorage`（后续 L1 才用）——路径根用 `workspace` 文件夹或 `context.globalStorageUri`，
   取代 Rust 的 `get_project_dir`。

## 3.5 Extension Host 侧已落地（R136/R137）

```
extension/package.json      命令「打开 Verilog 可视化窗口」+ retainContextWhenHidden
extension/src/html.ts       **纯函数**：改写 Vite 产出的 dist/index.html（资产→asWebviewUri、注入 CSP + <base>、给每颗 <script> 挂 nonce）
extension/src/projectStore.ts  sanitizeRel + 文件/文件夹 CRUD + 树 + 配置，语义逐条对齐 Rust `lib.rs`
extension/src/extension.ts    面板装载 + 15 方法消息路由（saveExportFile 走 showSaveDialog，取消＝false）
extension/{esbuild,sync-webview}.js  打包（external: vscode）／产物复制进 extension/webview 供 vsce
```

**CSP 的两条实测结论**（`tests/r137-webview-csp-gate.cjs`：静态服务器 + 壳那份 CSP + headless Edge，
CSP 与改写器**从 `extension/src/html.ts` 现读**，⛔ 闸门里抄第二份）：

| # | 结论 | 性质 |
|---|---|---|
| 1 | `style-src` 里**必须有 cdnjs**：`index.html` 的 Prism 主题那张 `<link rel=stylesheet>` 第一版被拒（`…prism-tomorrow.min.css\|style-src-elem`），代码编辑器会没了配色且**只在壳里** | ✅ 已测缺陷，已修 |
| 2 | `script-src` 里加 `cspSource`（webview origin）**不是**已测缺陷的修法：变异臂把 origin 摘掉后，内联探针与**外联 chunk** 两条 `import()` 路**仍放行** ⇒ 本机 Chromium 把调用方 script 的 nonce 传给了 `import()` | ⚠ 判不了 ⇒ 该格记 **UNVERIFIED**；保留 origin 是⛔ 对"nonce 是否传递"这件事不做赌注，放行面收在 `localResourceRoots` 内我们自己的 dist |

其余读数（同一颗闸门，11 PASS / 0 FAIL / 1 UNVERIFIED）：CSP 下应用挂载、`<base>` 与 7/7 脚本带 nonce、
`WebAssembly.compile(yosys.wasm)` 通过（16 416 382 B，验 `'wasm-unsafe-eval'`）、`window.digitaljs` 可用
（bundle 里那两处 `new Function("return this")` 是死支，⛔ 因此⛔ 需要 `'unsafe-eval'`）、
进沙盒放 Input×2+And+Lamp→三根连线→拨输入→灯 `rgb(3, 192, 60)`、**首屏＋全流程零 violation 零 CSP 拒绝信息**、
无 nonce 的内联脚本被拦（＝CSP 真在生效，⛔ 只是"没测到"）。

## 4. 迁移步骤台账（对 §9.6 的射程兑现）

| §9.6 步骤 | 状态 |
|---|---|
| 2/3 后端胶水 + 消息总线（**前端半段**） | ✅ `4ef5860`：调用层收成一份，`src` 内零直连 |
| 3 消息总线（**宿主半段**：Extension Host handler） | ✅ R136：15 方法逐条对上 `vscodeHost`；CSP/装载过 R137 真浏览器判据 |
| 1 脚手架（`extension/` 包 + 打包配置） | ✅ R136 建、**R138 补全**：pnpm workspace + `.vscode/{launch,tasks}.json` + `pnpm app` 启动器 + vsce 已装且真跑出过 `.vsix` |
| 4 L1（`SecretStorage` / provider 列表） | ⛔ 本期不做（用户令：先不要搭 agent 功能） |
| 5 路径语义迁移（`get_project_dir` → `Uri`） | 半：项目根已定 `globalStorageUri/project_files`；`partBindings` 存的是文件名还是绝对路径**还没现场量** |
| 6 agent 子系统 | ⛔ 未开工（同上令） |
| 7 删 `WindowControls.tsx` / 清 `isTauri` 守卫 | ✅ **R138**：`WindowControls.tsx`、`tauriHost.ts`、接口上那五颗窗口控制方法与 `hasWindowControls`、`exportUtils.isTauri`、两处 `data-tauri-drag-region` 全部拔掉（回退方案改为"走 git 历史"，§8） |
| 8 回归 | 部分：浏览器档 + 壳的 CSP/装载档各有闸门（R138 全量 73 格，见 §7）；**扩展端到端台架（真开 EPH 驱动 webview）仍⛔ 建**，`pnpm app` 那条路本身有 `pnpm app:check` 与 `tests/unit/launcher.test.mjs` 兜住"找到 CLI / 参数带引号 / 该不该重编"，⛔ 等于"点过窗口" |

## 5. 点验单（真机）

### 5A 壳（VS Code，`pnpm app`）——优先打这一组

1. **能开**：`pnpm app` ⇒ 起一个挂了本扩展的 VS Code 窗口，**画布面板自己弹出来**（⛔ 再按 F5、⛔ 再去命令面板找命令）。
   若显示"找不到前端构建产物"那句话＝`dist/` 有问题，程序已把下一步写在页面上（⛔ 让人去猜）。
   想先干跑一遍看它打算干什么：`pnpm app:check`。
2. **能画**：进沙盒 → 放 Input/And/Lamp → 连线 → 点运行 → 灯变色。（这颗 R137 已在无头浏览器里判过，真机那一遍是验 webview 环境差异：`acquireVsCodeApi`、`vscode-webview:` origin、剪贴板。）
3. **能存**：导出任一 SVG/JSON/网表 ⇒ 弹**系统保存对话框**；取消提示"导出已取消"（⛔ 报错、⛔ 静默）。
4. **能落盘**：新建 `.v` 文件/文件夹、重命名、移动、删除 ⇒ 用命令
   **「Verilog Visualizer: 打开项目文件所在文件夹（落盘核对用）」**（Ctrl+Shift+P 搜 `revealProjectDir`）
   直接开那个目录核对，路径同时抄进剪贴板。（⛔ 让人去猜 globalStorage 的拼法——那颗命令就是为这一格加的。）
5. **⛔ 数据还在不在（§6 那颗，这一格是本轮最要紧的一格）**：画一个电路存成沙盒文件 →
   **关掉面板 → 关掉那个 VS Code 窗口 → 重新 `pnpm app` → 再看文件树** ⇒ 那颗还在吗？内容对吗？
   设置项（主题/字号/自动保存）还在吗？—— 三条各自记"在/没了"。
6. **语法高亮**：代码页看一段 Verilog ⇒ 有 Prism 配色（R137 修的那张 CDN 样式表在真 webview 里对不对）。
7. **离线**：断网开面板 ⇒ 除高亮配色外一切正常（Prism 走 CDN，这颗的预期就是"只丢配色"）。

### 5B 壳侧的等价回归面（原 Tauri 那六项搬过来，⛔ 新功能）

R138 删掉 Tauri 之后，"与改前一致"这条基准⛔ 再有第二个宿主可对比——只能对**着功能清单**逐条打：

1. **文件树**：新建/重命名/移动/复制/删除文件与文件夹 ⇒ 磁盘上真的动了（用 §5A 第 4 格那颗命令核对）；
   重命名后引用仍解得到（R-A/r82 那族）。
2. **另存为**：任一导出（SVG / 电路 JSON / 综合网表 / .djs）⇒ 弹**系统保存对话框**，
   取消时提示"导出已取消"而不是报错、更不是静默；确认时文件落在所选路径且内容非空。
3. **代码编辑器剪贴板**：在代码页 Ctrl+C / Ctrl-X / Ctrl-V ⇒ 与系统剪贴板互通
   （VS Code 档走 `env.clipboard`；万一拿不到，DOM textarea 兜底必须还能复制成功）。
4. ~~标题栏三颗~~ ⇒ **R138 已随 Tauri 一起删除**（`WindowControls.tsx` 不在仓里，顶栏那颗 div 只剩占位）。
   窗口按钮由 VS Code 自己给，本项目⛔ 再有自绘标题栏。
5. **工程配置**：改设置项后重开窗口仍在（`readProjectConfig` / `saveProjectConfig` 走消息通道）。
6. 深色/浅色主题各导一张 SVG：打开文件应看到**与屏幕一致**的底与字（R135 那三项观感）。

## 8. R138：一条命令起壳 + Tauri 整条拆除

**触发是他这两句**：「我想要的效果是直接改成 vscode 套壳，但是当前启动方式还是原来的 tauri，
你给的 `pnpm -C extension build` 非常麻烦，应该是直接一行代码运行的，而不是你文档里那么麻烦还要 F5」＋
「当前项目要完全转向 vscode 类的 electron，要清理 tauri」。
上一批我把"能跑"写成了"按 F5，再按 Ctrl+Shift+P，再找那条命令"——那是把三步手工动作留给用户，按本项目判据＝缺陷。

**启动器 `scripts/run-in-vscode.mjs`（`pnpm app`）** 做四件事，每件都可无头判（`tests/unit/launcher.test.mjs` 9 格）：

1. `dist/` 缺、或 `src`/`public`/`index.html`/`vite.config.ts`/`package.json` 里有比它新的 ⇒ 先 `pnpm build`
   （同一族纪律：读旧产物会把已修好的东西判成没修）；
2. 编 Extension Host；
3. 找 CLI：`VSCODE_BIN` → PATH 上的 `code`/`code-insiders`/`codium`（要 `--version` 真跑得通才算数）→
   各平台常见安装位置；全落空时**列出试过的位置**并给 `VSCODE_BIN=<路径> pnpm app` 这条退路（⛔ 一句"请安装 VS Code"）；
4. 起窗口，**面板由扩展自己弹**：`activate` 里 `extensionMode === Development` 就 `openPanel()`，
   所以 F5 那条路也一起变简单了。配套加了 `activationEvents: ["onStartupFinished"]`（⛔ 它，开发模式下没人调命令就不会激活）。

⚠ 这颗启动器上最险的一处是**拼给 cmd.exe 的那条命令**：`code` 其实是 `code.cmd` ⇒ Windows 上必须走 shell，
而 Node 在 shell 模式是把参数**用空格拼成一条串**交给 `cmd.exe` 的，⛔ 替含空格的那一段加引号——
本仓库路径正是 `D:\Visual Studio Code\...` ⇒ `--extensionDevelopmentPath=` 会断在第一个空格处指到 `D:\Visual`。
这是 StarMark 那边 #261（`Start-Process -ArgumentList` 不引含空格元素）那一族的翻版，
所以 `buildSpawn` 自己加引号，并让判据**先断"裸拼那种写法⛔ 等于我们的输出"**（不然这颗闸门会因为"两种写法都通过"而永远绿）。
`pnpm app:check` 就是为这件事留的：⛔ 真开窗口也能看到它到底要跑什么。

**Tauri 拆除清单**（都是"删掉后没人再引用"的现读核对，⛔ 留着当"回退方案"——架构文档 §9.7 已改口）：

| 删的东西 | 说明 |
|---|---|
| `src-tauri/`（24 颗 tracked 文件） | Rust 14 颗命令 / 402 行 + `tauri.conf.json` + capabilities + icons |
| `src/lib/host/tauriHost.ts` | 调用层从三档收成两档（`vscodeHost` / `browserHost`） |
| `ProjectHost` 上五颗窗口控制方法 + `hasWindowControls` | `windowIsMaximized/onWindowResize/windowMinimize/windowToggleMaximize/windowClose` |
| `src/components/WindowControls.tsx` + `App.tsx` 两处 `data-tauri-drag-region` | 自绘标题栏；顶栏那颗 div 只剩弹性占位 |
| `exportUtils.isTauri` | 探测只留在 `host.ts` 一处 |
| `@tauri-apps/api`、`@tauri-apps/plugin-opener`、`@tauri-apps/cli` | `pnpm install` 读数：**−4 个包**，`pnpm-lock.yaml` 里 `tauri` 计数 **0** |
| `pnpm tauri` 脚本、`vite.config.ts` 里 `TAURI_DEV_HOST`/hmr/`watch.ignored`、`eslint` 的 `src-tauri/**` 忽略项、`public/tauri.svg` | 顺手清的尾巴；`tauri.svg` 是打包 `.vsix` 时才发现被一起塞进去了 |

**闸门跟着改的两处**（⛔ 改产品行为）：
`r12-export` 的 [F] 三格原先注入 `__TAURI_INTERNALS__` 验 Rust 那条 `save_export_file`；现在注入
`acquireVsCodeApi` 桩，验**当前主宿主**那条同名通路（点击前注入这件事本身没变——这颗判据的本体就是"探测每次现读"），
[F2] 因此从"载荷是 `content[]` 数组"改成"载荷是 `args.base64`"。读数 **28 pass / 0 fail**。
`tests/unit/host.test.ts` 摘掉 tauri 那一档与窗口控制那两格，探测那一格改成
"browser → vscode → **撤桩后回 browser**"（第三臂是新加的：⛔ 记牢第一次的结果）。

**盘上留着没动的**：`src-tauri/target/`（9.0 GB Rust 缓存，gitignore 里、⛔  tracked）、`src-tauri/gen/`、
空的 `src-tauri/project_files/`（**删之前查过：0 个文件**，⛔ 用户电路住在那儿）。这三个目录要删是他的决定，
我没替我删（`rm -rf` ⛔ 可逆，而 git 历史里那份随时能 `git checkout` 回来）。

**`.vsix` 这条路由"⛔ 实测"变成"跑过"**：装上 `@vscode/vsce` 后 `pnpm ext:package`
产出 `extension/verilog-visualizer-vscode-0.0.1.vsix`（21 个文件 / 7.03 MB，含 `webview/` 里 15.66 MB 的
`yosys.wasm`）。⚠ 这里踩到第二颗 `allowBuilds` 占位文本（`@vscode/vsce-sign`），已在
`pnpm-workspace.yaml` 里**明确写 false** 并说明理由（只本地打包⛔ 上架市场，签名用不上）。
`code --install-extension <vsix>` 那一步我**没在他机器上执行**——那是改他的编辑器状态，等他点头。

## 6. 唯一的大开放项：webview 里的 `localStorage` 持不持久

**事实（源码现读，⛔ 推测）**：`src/` 里 `localStorage` **59 行**（含注释），真调用点 **45 处**，
分布在 12 个文件。其中**用户数据**那一族
（`verilog-viz-sandbox-files` ＝ 沙盒电路文件正文、`-folders`、`-active`、`verilog-viz-files` 索引、
settings/theme）**只写 localStorage，没有任何一份走宿主落盘**——
实测 `grep -c "getHost\|hostFire\|saveProjectFile" src/store/sandboxStore.ts` ＝ **0**
（`.v` 文件走 `host.saveProjectFile`，`.djs` 电路**不走**）。

**为什么这是个问题**：VS Code 官方文档对 webview 持久化的建议是 `getState`/`setState` +
`registerWebviewPanelSerializer`，⛔ 认可 `localStorage`；而扩展开发宿主的 profile 是临时目录。
⇒ 若 webview 的 localStorage 不跨窗口存活，**5A 第 5 格就会看到"电路没了"**，那是数据丢失，
比任何观感缺陷都重。

**这一轮⛔ 先动代码**：动之前要先有读数（5A 第 5 格），因为两种下落要两种修法：

- 若**持久**：只剩"换机/重装扩展就没了"这一档，记为已知局限即可。
- 若**不持久**：给 `ProjectHost` 加一对 `storageRead/storageWrite`，vscode 档背后落
  `context.globalState`，并在建面板时把这份状态**注入 HTML**（`window.__VH_BOOTSTRAP__`），
  这样 `sandboxStore` 那批**同步读**⛔ 需要改成 async——那是本文件里最贵的一处重构，
  值得先用一格真机读数决定要不要付。

**次要项**：Prism 两颗 CDN 引用 ⇒ 长期落到 `public/`（离线打开才不会丢语法高亮）。

## 7. 本轮（R137）收口读数

| 判据 | 读数 |
|---|---|
| `node tests/run-all.cjs` 全量跑批 | **`RED=0 ENVRED=0 GREEN=73 NOVERDICT=0 共 73 格`**（含新落的 `r137-webview-csp-gate` 11 PASS / 0 FAIL / 1 UNVERIFIED） |
| `pnpm test`（vitest） | **39/39**（`vscodeShell.test.ts` 11 格：改写/CSP/base/nonce/`sanitizeRel`/ProjectStore/**RPC 两张表对账**/**面板释放登记只一处**/对真实 dist 也成立） |
| 根 `tsc --noEmit` / `pnpm -C extension typecheck` / `eslint src extension/src --quiet` | 0 / 0 / 0 error |
| 跑 dist 那四颗（`base:'./'` 的影响面，逐颗单跑） | `qc-preview 2/0`、`qc-paused 6/0`、`qc-realuser 4/0`、`r23-verify 12/0` |
| RPC 两张表 | 客户端 15 颗 ⇔ 宿主 `dispatch()` 15 分支，双向差集**均为空** |

本轮另外抓到并修掉的一颗是**壳自己的**（⛔ 产品回归）：`onDidDispose` 原先只挂在 `openPanel`，
而面板还有 serializer 那第二条来路 ⇒ "窗口重启恢复 → 关掉 → 再按命令" 会 `reveal()` 已释放面板，
症状就是**点了没反应**。现在登记住在两条路共用的 `wirePanel` 里，一颗主人，且带 `currentPanel === panel` 守卫。

**本轮没做的**：`vsce` 未装 ⇒ `.vsix` 那条路⛔ 没实测；扩展端到端台架（真开 EPH 驱动 webview）未建；
§6 那颗持久化按自己的规矩等读数。（**R138 更新**：`.vsix` 那条已经跑过了，见 §8 末段；台架与持久化两条仍欠。）

## 7b. R138 收口读数

| 判据 | 读数 |
|---|---|
| `pnpm build` / `pnpm -C extension check` / `eslint src extension/src --quiet` | 0 错 / 0 错 / 0 error（`dist/assets` 从 5 颗 chunk 收成 **3 颗**） |
| `pnpm test` | **46/46**（新增 `tests/unit/launcher.test.mjs` 9 格；`host.test.ts` 随接口收窄 13→11 格） |
| `r12-export`（[F] 三格改 VS Code 桩） | **28 pass / 0 fail** |
| `r13-custom-gate`（boot 改 `UI.boot`） | **15 pass / 0 fail** |
| `r137-webview-csp-gate` | **11 pass / 0 fail / 1 UNVERIFIED**（那颗 UNVERIFIED 是 R137 既有结论） |
| `pnpm app:check` | CLI 走 PATH 命中；`needsBuild` 正确；命令串含空格参数各自带引号 |
| `pnpm ext:package` | `.vsix` 产出：**21 个文件 / 7.03 MB** ⇒ 这条⛔ 再是"没实测" |
| 全量跑批 | **今天没能一次跑完 73 格**：两次分别在第 24／28 格后**成块**掉 ENVRED（掉的⛔ 同一批），
  把 16 颗掉出闸门**逐颗单跑全绿（0 fail）**，r20～r24 连着再跑一遍也全绿 ⇒ 产品面没发现真红，
  跑批面要在机器安静时补一整轮。细节与测法见账本卷四十四 §五、§六。 |
动 webview）未建；
§6 那颗持久化按自己的规矩等读数。

