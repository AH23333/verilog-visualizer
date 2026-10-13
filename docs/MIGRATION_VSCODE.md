# VS Code 套壳迁移（进行中）

> 决策出处：`docs/AGENT_PRODUCT_ARCHITECTURE.md` §1.1 / §9（2026-10-12 由备选升为主方案）。
> 本文件是**执行台账**：记录已实测的事实、已落地的层、下一步与点验单。⛔ 拿架构文档里的
> 估算数字当现状（那几处旧口径本轮已按实测更正，见 §1）。

## 0. 一句话进度

前端调用层已中立化（`src/lib/host/`，提交 `4ef5860`）⇒ 换宿主不再需要挨处改 UI；
套壳基座选定**微软官方 sample**（已拉取，不自己写）；**Extension Host 侧已落地**（`extension/`：
面板装载 + 15 方法消息路由 + `workspace.fs` 项目目录 + `showSaveDialog` 另存为），
且那份 CSP 与资产改写**已过真浏览器判据**（`tests/r137-webview-csp-gate.cjs`，见 §3.5）。
⇒ **VS Code 现在是 README 的第一启动路径**，Tauri 降为回退（§9.7）。
剩下的真开放项只有一颗大的：**webview 里的 `localStorage` 到底持不持久**（§6，未实测）。

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
| 1 脚手架（`extension/` 包 + 打包配置） | ✅ R136：pnpm workspace + `.vscode/{launch,tasks}.json`（F5 即可，⛔ 需要 Rust/vsce） |
| 4 L1（`SecretStorage` / provider 列表） | ⛔ 本期不做（用户令：先不要搭 agent 功能） |
| 5 路径语义迁移（`get_project_dir` → `Uri`） | 半：项目根已定 `globalStorageUri/project_files`；`partBindings` 存的是文件名还是绝对路径**还没现场量** |
| 6 agent 子系统 | ⛔ 未开工（同上令） |
| 7 删 `WindowControls.tsx` / 清 `isTauri` 守卫 | ⬜ 故意留着：现在由 `host.hasWindowControls` 驱动，Tauri 路径仍可跑＝**回退方案**（§9.7） |
| 8 回归 | 部分：Tauri/浏览器两档已过全量跑批；VS Code 档**没有**扩展端到端台架，R137 那颗是把壳的 CSP/装载面搬到 headless 浏览器里判，⛔ 等于"点过 F5" |

## 5. 点验单（真机）

### 5A 壳（VS Code，F5）——本轮新增，优先打这一组

1. **能开**：F5 →「运行 扩展开发宿主」→ 新窗口 Ctrl+Shift+P →「打开 Verilog 可视化窗口」⇒ 出界面（⛔ 白屏）。
   若显示"找不到前端构建产物"那句话＝没跑 `pnpm build`，程序已把下一步写在页面上（⛔ 让人去猜）。
2. **能画**：进沙盒 → 放 Input/And/Lamp → 连线 → 点运行 → 灯变色。（这颗 R137 已在无头浏览器里判过，真机那一遍是验 webview 环境差异：`acquireVsCodeApi`、`vscode-webview:` origin、剪贴板。）
3. **能存**：导出任一 SVG/JSON/网表 ⇒ 弹**系统保存对话框**；取消提示"导出已取消"（⛔ 报错、⛔ 静默）。
4. **能落盘**：新建 `.v` 文件/文件夹、重命名、移动、删除 ⇒ 用命令
   **「Verilog Visualizer: 打开项目文件所在文件夹（落盘核对用）」**（Ctrl+Shift+P 搜 `revealProjectDir`）
   直接开那个目录核对，路径同时抄进剪贴板。（⛔ 让人去猜 globalStorage 的拼法——那颗命令就是为这一格加的。）
5. **⛔ 数据还在不在（§6 那颗，这一格是本轮最要紧的一格）**：画一个电路存成沙盒文件 →
   **关掉面板 → 关掉那个 VS Code 窗口 → 重新 F5 → 再打开面板** ⇒ 文件树里那颗还在吗？内容对吗？
   设置项（主题/字号/自动保存）还在吗？—— 三条各自记"在/没了"。
6. **语法高亮**：代码页看一段 Verilog ⇒ 有 Prism 配色（R137 修的那张 CDN 样式表在真 webview 里对不对）。
7. **离线**：断网开面板 ⇒ 除高亮配色外一切正常（Prism 走 CDN，这颗的预期就是"只丢配色"）。

### 5B 旧 Tauri 路径（回归面，⛔ 新功能）

改造后的**现有 Tauri 路径**必须处处与改前一致：

1. **文件树**：新建/重命名/移动/复制/删除文件与文件夹 ⇒ 磁盘上真的动了；重命名后引用仍解得到（R-A/r82 那族）。
2. **另存为**：任一导出（SVG / 电路 JSON / 综合网表 / .djs）⇒ 弹**系统保存对话框**，
   取消时提示"导出已取消"而不是报错、更不是静默；确认时文件落在所选路径且内容非空。
3. **代码编辑器剪贴板**：在代码页 Ctrl+C / Ctrl-X / Ctrl-V ⇒ 与系统剪贴板互通（Tauri 档走插件；
   若哪天插件不可用，DOM textarea 兜底必须还能复制成功）。
4. **标题栏三颗**：最小化／最大化切换（图标随真实状态变）／关闭仍有效；
   非 Tauri 窗口里那颗组件**整块不渲染**（不占位、不留空白）。
5. **工程配置**：改设置项后重开窗口仍在（`read_project_config` / `save_project_config` 走的是新通道）。
6. 深色/浅色主题各导一张 SVG：打开文件应看到**与屏幕一致**的底与字（R135 那三项观感）。

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
§6 那颗持久化按自己的规矩等读数。

