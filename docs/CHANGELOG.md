# Changelog / 变更日志

本项目所有值得注意的变更都记录于此。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
版本以开发批次 `R<n>` 为主键（首个正式 release 前）。

本项目变更以开发批次 `R<n>` 为主键；条目按批次倒序。

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
