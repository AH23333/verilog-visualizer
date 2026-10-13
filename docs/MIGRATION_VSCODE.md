# VS Code 套壳迁移（进行中）

> 决策出处：`docs/AGENT_PRODUCT_ARCHITECTURE.md` §1.1 / §9（2026-10-12 由备选升为主方案）。
> 本文件是**执行台账**：记录已实测的事实、已落地的层、下一步与点验单。⛔ 拿架构文档里的
> 估算数字当现状（那几处旧口径本轮已按实测更正，见 §1）。

## 0. 一句话进度

前端调用层已中立化（`src/lib/host/`，提交 `4ef5860`）⇒ 换宿主不再需要挨处改 UI；
套壳基座选定**微软官方 sample**（已拉取，不自己写）；Extension Host 侧的消息路由与
webview 装载**尚未开始**（按用户令：先确保重构完成再走下一步）。

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

验收读数：`pnpm test` **28/28**（含 `tests/unit/host.test.ts` 13 格：探测换档、reject 形状、
base64、id 不串号、超时、hostFire 留痕）、`tsc --noEmit` 0 错、`eslint src --quiet` 0 error、
`grep -rn "@tauri-apps" src | grep -v src/lib/host/` **0 行**。
全量跑批（71 格）见 `docs/PROJECT_DEEP_REVIEW_2026-10-05.md` 卷四十二 §三。

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

## 4. 迁移步骤台账（对 §9.6 的射程兑现）

| §9.6 步骤 | 状态 |
|---|---|
| 2/3 后端胶水 + 消息总线（**前端半段**） | ✅ 本轮：调用层收成一份，`src` 内零直连 |
| 3 消息总线（**宿主半段**：Extension Host handler） | ⬜ 未做（等本轮重构验收后开工） |
| 1 脚手架（`extension/` 包 + 打包配置） | ⬜ 未做（基座已选定并拉取） |
| 4 L1（`SecretStorage` / provider 列表） | ⛔ 本期不做（用户令：先不要搭 agent 功能） |
| 5 路径语义迁移（`get_project_dir` → `Uri`） | ⬜ 随宿主半段一起做；实测 `partBindings` 存的是**文件名/相对路径**还是绝对路径，那一步现场量 |
| 7 删 `WindowControls.tsx` / 清 `isTauri` 守卫 | ⬜ 到壳内可用后再删（现在它们由 `hasWindowControls` 驱动，Tauri 路径仍可跑＝**回退方案**，§9.7） |
| 8 回归 | 部分：全量跑批已把"前端调用层改造"这一变更验在 Tauri/浏览器两档；VS Code 档需扩展端到端台架（新能力，未建） |

## 5. 点验单（真机，交给他）

改造后的**现有 Tauri 路径**必须处处与改前一致（这是回归面，不是新功能）：

1. **文件树**：新建/重命名/移动/复制/删除文件与文件夹 ⇒ 磁盘上真的动了；重命名后引用仍解得到（R-A/r82 那族）。
2. **另存为**：任一导出（SVG / 电路 JSON / 综合网表 / .djs）⇒ 弹**系统保存对话框**，
   取消时提示"导出已取消"而不是报错、更不是静默；确认时文件落在所选路径且内容非空。
3. **代码编辑器剪贴板**：在代码页 Ctrl+C / Ctrl-X / Ctrl-V ⇒ 与系统剪贴板互通（Tauri 档走插件；
   若哪天插件不可用，DOM textarea 兜底必须还能复制成功）。
4. **标题栏三颗**：最小化／最大化切换（图标随真实状态变）／关闭仍有效；
   非 Tauri 窗口里那颗组件**整块不渲染**（不占位、不留空白）。
5. **工程配置**：改设置项后重开窗口仍在（`read_project_config` / `save_project_config` 走的是新通道）。
6. 深色/浅色主题各导一张 SVG：打开文件应看到**与屏幕一致**的底与字（R135 那三项观感）。
