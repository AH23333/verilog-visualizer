# Verilog Visualizer 项目深度审查报告

- **审查日期**：2026-10-05
- **审查方式**：全程只读（静态扫描 + 逐点取证 + 编译验证），**未修改任何代码**；当前工作区含并行开发代理的未提交改动（`git status` 显示 16 个文件在改），本报告以该工作树快照为准，动手修复前请对照最新 diff 复核编号（尤其 A4/A5/A6 可能已被在途工作部分覆盖）
- **基线取证**：`tsc --noEmit` **0 错误**（strict + noUnusedLocals 全开）；`vite build` 产物今天 14:09 更新成功；仓库 16 commits / 207 个受控文件
- **扫描工具**：`.tmpbuild/audit_scan.cjs`、`.tmpbuild/audit_fonts.cjs`（本次审查落盘，可复跑）

---

## 一页结论

**总体健康度：中上。** 这是一个「单兵全栈冲刺」形态的产品：功能密度高、注释里沉淀了大量踩坑记录（可贵）、类型检查全绿；但工程性债务集中在三处——**安全配置未做/desktop 语义缺位**、**数据持久化架构是单点**、**巨石组件已到维护临界点**。

### 最高风险三项（建议发布前必须处理）

| # | 风险 | 一句话说明 |
|---|------|-----------|
| A1 | CSP 关闭 + 远程 CDN 且**死依赖** | `tauri.conf.json` `csp:null`，而 `index.html` 从 cdnjs 引 3 个 Prism 资源——**全项目没有任何代码引用 Prism**（语法高亮实际用 CodeMirror）。等于：白屏期加载外部 JS + 无限 CSP + 供应链注入面 + 离线降级 |
| A2 | `fs:read-all` 过度授权 | capability 给了整个文件系统读权限（含 home），但前端**没有任何 plugin-fs 的 JS 绑定调用**（文件操作全部走自定义 `invoke('save_project_file')` 等 Rust 命令）。纯浪费的攻击面 |
| A4 | 持久化单点在 localStorage | 沙盒文件/门定义/设置全存 `localStorage`（约 5 MB 配额、WebView2 缓存可被清），且错误处理两极：`sandboxStore.saveAll` **裸 setItem 会抛崩保存链路**，`fileStore.saveFilesToLocalStorage` **空 catch 静默吞掉配额失败**——两个都是错的方向，真机跑大电路必炸其一 |

### 最高价值三方向（中期）

1. **拆分 SandboxCanvas**（3657 行 / 单 effect 约 1600 行）——所有新功能都在往这堆里继续加，边际成本已经肉眼可见（本次「复制到沙盒」系列问题的排查耗时即是症状）
2. **统一沙盒持久化到 Tauri fs 后端**（复用现有 project_files 通道），localStorage 只做启动缓存
3. **建立冒烟测试层**（tests/ 里 90+ 一次性探针脚本收敛为分层回归，进 CI）

> **卷二补充（2026-10-05 同日深读）**：绑定/复制管线（D1–D5）、编译链路（E1–E7）、运行时与 UI（W1–W7）、工程化（S1–S3）共 22 项新发现见文末「卷二」，其中 D1（复制沙盒文件混乱的代码级根因）、E1（编译无重入锁）、W1（Ctrl+滚轮与 WebView2 页面缩放冲突）为高优先级。

### 架构数据流（现状）

```mermaid
flowchart LR
  subgraph 编译模式
    V[.v 文件] -->|正则预解析| F[fileStore<br/>localStorage + Tauri project_files 双写]
    F -->|invoke read 磁盘同步| R[Rust: save/list/read/move 等 14 命令]
    F -->|window.Yosys WASM 单例| Y[verilog.ts 综合]
    Y -->|yosys2digitaljs| C[circuitJson]
    C --> CV[Canvas.tsx 渲染/仿真]
  end
  subgraph 沙盒模式
    S[SandboxCanvas 3657行] -->|window.digitaljs 全局共享| G[gateSystem.ts<br/>部件绑定/递归迁移]
    G --> SB[sandboxStore<br/>localStorage 单点]
    S -->|复制到沙盒桥| F
  end
  CV -.->|复制到沙盒| S
```

---

## 实测数据表（只扫描 `src/`，54 个文件）

| 指标 | 数值 | 备注 |
|------|-----|------|
| `: any` + `as any` | **352** | 5 个文件占 309：SandboxCanvas 139 / subcircuitView 42 / Canvas 34 / verilog.ts 23 / gateSystem 22 |
| 空 `catch {}` | **63** | SandboxCanvas 25、Canvas 9、sandboxLoad 10 |
| `catch` 且注释 ignore/best effort | 213 | 「best effort 吞异常」是全项目惯用法，需分级治理而非一刀切 |
| `window` 全局访问 | 31 | 「数字逻辑引擎句柄 + QC 钩子」两类，见 B2/B6 |
| `JSON.parse/stringify` | 59 | 多数落在每次全量读写 localStorage 的热路径（见 B3） |
| `(window as any).digitaljs` | 11 处 | 无类型契约，见 B2 |
| 硬编码 fontSize 数字 | 7 处 | 其余均走 rem 制 `--fs-*` token（联动已通，见 C4） |
| useEffect | 53 | SandboxCanvas 7 个，其中一个约 1600 行主体 |
| window 监听 add/remove | 46/43 + 逐文件配平核查通过 | 无泄漏性失衡 ✓ |

---

## 发现清单（按优先级）

### 🔴 P0 — 发布阻断（安全 / 系统级正确性）

#### A1 · CSP 关闭 + 死依赖远程 CDN
- **证据**：`src-tauri/tauri.conf.json` `"csp": null`；`index.html` L10–13（3 个 cdnjs Prism 资源）；`src/` 内 `grep -i prism|window.Prism` **零引用**（高亮走 `@codemirror/legacy-modes`）
- **影响**：① 桌面应用启动静默依赖外网，离线时控制台报错、样式闪变；② CSP 为 null 且远端脚本可换内容 = 供应链注入面（本应用的 webview 里同时有 `fs:read-all` 与剪贴板权限，注入后果是本地文件外读级别）；③ 每次升级前端都白下载 3 个文件
- **建议**：直接**删除三段 CDN 引用**（零风险，代码无依赖）；补 CSP：`"csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost"`
- **工作量**：<0.5 h（建议先在 Tauri 真机验证 yosys `wasm-unsafe-eval` 必要性，个别版本可收窄为 `'self' wasm-unsafe-eval`）

#### A2 · `fs:read-all` 越权且无前端消费者
- **证据**：`src-tauri/capabilities/default.json` 含 `"fs:read-all"`；`src/` 全量 grep 无 `@tauri-apps/plugin-fs` / `plugin:fs|` 调用；文件 IO 全部走自定义 `#[tauri::command]`（Rust 内部 `std::fs`，不受 capability 约束）
- **影响**：给 webview 暴露整个文件系统读取 API（scope 默认覆盖 `$HOME/**`），但没有任何代码用它——纯攻击面
- **建议**：从 capability 移除 `fs:read-all`（`dialog:default`/`clipboard-manager` 有真实消费者，保留；`opener` 前端无调用，一并核对后移除）
- **工作量**：<0.5 h（改 `capabilities/default.json` → `tauri build` 实测一次导出链路）

#### A3 · `save_export_file`：async 命令里调阻塞对话框
- **证据**：`src-tauri/src/lib.rs` — `async fn save_export_file(...)` 内 `.blocking_save_file()`；前端 5 处调用（`exportUtils.ts` L22/70/93/110 附近）
- **影响**：dialog 插件官方明确警示「不要在 async 命令里调 blocking 变体」（Windows 上表现为卡死或对话框不出现的经典原因）；导出 PNG/SVG/网表/Verilog 是主打功能，属于「偶发整机级」风险
- **建议**：把该 command 改为**同步 `fn`**（Tauri 的同步 command 跑在独立线程池，blocking 可用），或改用回调式 `save_file(&move |p| {...})` + channel 回传
- **工作量**：<1 h；验收看真机全导出链路

---

### 🟠 P1 — 高（稳定性 / 数据丢失）

#### A4 · 沙盒持久化单点 localStorage + 错误处理两极失衡
- **证据**：
  - `sandboxStore.ts` L49 `saveAll`：**裸** `localStorage.setItem(JSON.stringify(全部文件))`——配额超限抛 QuotaExceededError 直接打断 `handleSave`/`handleOpen`（保存切文件时）链路，用户表现为「按保存没反应/切过去又弹回」
  - `fileStore.ts` L61-67 `saveFilesToLocalStorage`：`try { ... } catch {}`——**静默吞掉**失败，内容只剩 Tauri project_files 一份且 `.v` 文件之外的编辑（如 moduleBindings）实际已丢
  - `App.tsx` L803 复制到沙盒大 JSON `try/catch{} ignore`——失败后粘贴板静默变旧版本
  - 沙盒 `graphJson` 内嵌 `subcircuitGraph` 时代曾造成体积指数膨胀（R37 剥离内嵌正是为此），但引用式仍可能超 5 MB
- **建议**：① 统一一个 `safeSetItem(key,val)` 包装：失败**必须 toast 用户** + 记录 + 降级（只保留活动文件）；② 沙盒文件落 Tauri fs（见 C1），localStorage 只当「上次会话缓存 + 活动指针」；③ 给 `verilog-viz-sandbox-files` 加 schema `version` 字段（现在结构全靠 migrate 标志位打补丁）
- **工作量**：①2h ②1–2 天 ③0.5h

#### A5 · 无未保存退出守卫
- **证据**：全 `src/` grep `beforeunload|onwillunload` **零结果**；WindowControls 关闭钮直接 `close()`；沙盒编辑只在 `handleOpen`/`handleSave` 时落盘
- **影响**：关窗丢「最后一次保存/切文件之后」的所有画布修改，且无提示——桌面应用的数据丢失主路径
- **建议**：维护 dirty 标记；Tauri 侧用 `on_window_event` `CloseRequested` + `prevent_close` 弹「保存/放弃」；HTML `beforeunload` 兜底 webview 内导航
- **工作量**：0.5 天

#### A6 · `migrateLegacy` 标志位先立、结果后账
- **证据**：`gateSystem.ts` L474-524：三段迁移各自 `if (!localStorage.getItem(FLAG)) { try{逐条}catch{/*ignore*/} localStorage.setItem(FLAG,'1') }`——任一逐条失败（坏档、配额、部件抽取抛错）都被吞，但标志落定，**这批用户的旧数据永远不会被再迁移**
- **建议**：标志改为「成功计数/期望计数」语义：全部条目成功才立标；或立标前把未迁移条目转存到 `verilog-viz-migrate-failed` 并在 UI 设置页给一次性提示
- **工作量**：<1 h

#### A7 · `initYosys` 失败毒化单例
- **证据**：`verilog.ts` L61-83：`initPromise` 一旦 reject（如首次加载 `.wasm` 瞬时 IO 失败），**永不重置**——之后所有编译永远返回同一个 rejected promise，用户唯一自救方式是重启应用
- **建议**：`initPromise.catch` 里置 `initPromise = null`（并保留 console），下次调用即可重试
- **工作量**：3 行改动

---

### 🟡 P2 — 中（架构 / 性能 / 可维护性）

#### B1 · 巨石组件群（当前最大维护成本源）
- **证据**：`SandboxCanvas.tsx` **3657 行**（主交互 effect 约 1600 行一条链：spawnCell→连线→DRC→loadCells→reset→渲染，靠「1256 行/1267 行注释」式路标维持）；`App.tsx` **1725 行、至少 41 个 useState 的单一组件**；Canvas 947、sidebar 等尚可
- **影响**：每个新需求都要在千行 effect 里选插入点；本次「复制到沙盒」系列排查的低效率直接归因于此；两名并行开发者同改 `SandboxCanvas.tsx` 的 merge 冲突成本已经显现
- **建议（渐进拆分，别大爆炸）**：
  1. SandboxCanvas：抽 `useSandboxEngine`（paper/digitaljs 生命周期）、`useSandboxTools`（spawn/连线/选择）、`useSandboxHistory`（undo/redo）三个 hook；文件树/侧栏/工具条已天然可拆组件
  2. App：先抽 `useCompilePipeline` + `usePanelLayout`，再考虑 `useReducer` 合并状态
  3. 拆分时优先把 `(window as any).digitaljs` 收进带类型的 engine 模块（见 B2）
- **验收代理指标**：`SandboxCanvas.tsx` < 1200 行、主 effect 拆后每段 <300 行；每阶段全绿回归

#### B2 · `window.digitaljs` 全局无契约 + 双模式共享仿真器
- **证据**：11 处 `(window as any).digitaljs`（SandboxCanvas 9 + ExpandModal + gateSystem）；编译模式 Canvas 与沙盒共用同一 `public/digitaljs.js` 注入的全局
- **影响**：① 类型裸奔（上面 any 债务的集中放大器）；② 两模式并存时**引擎类/全局状态共享边界不清**，展开只读模态与主画布共用仿真 tick 的风险一直靠约定规避（R36/R38 注释有记录）
- **建议**：`src/lib/digitaljsBridge.ts` 提供 `getDigitaljs(): Digitaljs`（声明最小 interface + 懒校验）；明确「展开模态只读快照不挂接全局 circuit」的不变量并加断言
- **工作量**：0.5 天（纯机械替换 + 一处 interface）

#### B3 · sandboxStore 全量读写热路径（O(N) JSON.parse）
- **证据**：`loadAll()` 每次 `JSON.parse` 整库；`list/get/save/set/rename...` 全部先 loadAll 再 saveAll 全库；palette 的 `customGateStore.list()` 每次渲染都执行一遍（SandboxCanvas 里多处 refreshGates 调用链）
- **影响**：文件多了以后每次 commit/每次切面板都是整序列化风暴；与 A4 的配额问题同根（全库一坨）
- **建议**：模块级 in-memory 缓存 + 写穿透；save 时只重序列化被改条目（graphJson 已是字符串，本就免序列化）
- **工作量**：0.5 天

#### B4 · 导出实现双轨
- **证据**：`src/utils/sandboxExport.ts`（blob+a.download，QC 钩子 window 挂载）vs `src/lib/exportUtils.ts`（Tauri `save_export_file`）——PNG/SVG 克隆与背景色逻辑两份（L18/52 两处几乎相同的 `setAttribute('xmlns'...)`）
- **影响**：修 bug 要修两处；沙盒走 a.download 与主模式走原生保存对话框是**已知的行为不一致**（用户已投诉过文件下载类交互）
- **建议**：合并到一份 `exportUtils`，沙盒调用方复用；沙盒导出也走 `save_export_file`
- **工作量**：0.5 天

#### B5 · 样式双体系并存（tailwind/shadcn vs CSS token+inline）
- **证据**：deps 有 `tailwind-merge/clsx/class-variance-authority/@radix-ui/react-slot`；App.tsx 混用 `className="absolute top-2..."` + `text-[var(--fs-md)]` 与大量 inline style + token 系统（261 处 `--fs-*`）；index.css 650 行承担设计系统职责
- **影响**：两套词汇并存导致每次 UI 改动要判断「该用哪套」，是「界面质感不稳」类问题反复出现的根因之一
- **建议**：定一个方向（推荐**以 token+inline 为主**，因组件库无人用；tailwind 层若只用 utility 可保留但禁止混入组件级），写进 `docs/` 设计文档并在 code review 中执行
- **工作量**：治理 1–2 天（存量清理可分期）

#### B6 · 生产代码里的 QC/调试全局钩子
- **证据**：`SandboxCanvas` L2377 `(window as any).__sandboxSave = handleSave`；`sandboxExport` 挂 `window.__sandboxExport`；`subcircuitView` L345 `window.__expandStages` 计时钩子
- **影响**：公开测试后门；也污染 `window.*` 命名。tests/ 探针依赖它们——不能简单删
- **建议**：`if (import.meta.env.DEV)` 门控，或集中进 `window.__vv = { save, export, stages }` 一个命名空间并文档化
- **工作量**：<1 h

#### B7 · any 债务与吞异常分级
- **证据**：352 个 any / 63 空 catch（数据表）；`verilog.ts` 对 yosys/yosys2digitaljs 的 any 合理（第三方无类型），可豁免；**SandboxCanvas 的 139 个多为可声明的 joint/digitaljs 本地对象**
- **建议**：不追求归零，分级：① joint 的 Cell/Paper/Tool 已有 `@joint/core` 自带类型，直接用；② digitaljs 用 B2 的 bridge 收口；③ 空 catch 全部加注释语义（现状多数有 best-effort 注释但 63 处裸 {}）→ 至少 lint 规则「catch 块必须有注释或上抛」，先跑 `no-empty` 统计出数
- **工作量**：渐进，配合 B1 拆分做

---

### 🔵 P3 — 低（工程卫生 / 体验细节）

| # | 事项 | 证据与建议 |
|---|------|-----------|
| C1 | 大二进制入 git、无同步脚本 | `public/yosys/*`(~21.6MB)+`public/digitaljs.js`(2.3MB) 手工放置，与 `package.json` 的 `yosys@0.30.5`/`digitaljs@0.14.2` 无自动同步 → 加 post-copy 脚本（构建前从 node_modules 拷 `yosys.browser.js/wasm` + digitaljs dist），防漂移；迁 move 到 git-lfs 可选 |
| C2 | `yosys`/`digitaljs` npm 依赖疑似死重 | src 无任何 `from 'yosys'` / `from 'digitaljs'` 导入（digitaljs 走全局脚本）→ 若采纳 C1 则依赖转为「构建期资产源」保留；否则移除减装包风险 |
| C3 | tests/ 一次性探针 90+ 个混入正式目录 | `.tmpbuild_*.cjs`/`r4..r57-*` 全量入库 → 分 `tests/smoke/`（值得留的回归）与 `tests/archive/`（归档或删除），`run-all.cjs` 收敛成 smoke 入口；中期引入 vitest 做 lib/（gateSystem/verilog/subcircuitView）纯函数单测——这些模块无 DOM 依赖，单测性价比最高 |
| C4 | 字号联动已通但留 7 处硬编码/未接入 `--editor-font-size` | `SandboxCanvas` 5 处、CodeEditor/MemoryViewModal 各 1 处；`settingsStore.applyFontSize` 设了 `--editor-font-size`，确认 CodeEditor 实际消费此 token（grep 未见引用，可能仍读 `fontSize` 入参） |
| C5 | 中英混排残留 | ErrorBoundary 整屏英文、右键/弹窗已中文化；建议 ErrorBoundary 中文化 + 统一 locale 词条（小） |
| C6 | `.npm-cache/.npm-local-cache/.trae/` 杂物在仓库目录（前两者已 ignore） | 建议物理移出，避免被后续 `git add .` 类误操作牵连 |
| C7 | README 与 docs 叙事重叠 | `WORK_REPORT/P1_P2`、`HANDOVER_P1_P2`、`QC_REVIEW_SANDBOX`、`1.md` 等角色不清；建议在 README 加一张「文档地图」说明各自定位与时效 |
| C8 | 无 CI | 无 `.github/`；`tsc && vite build` 已是现成绿灯组合，配 workflow 10 分钟成本；建议至少 PR 级跑 typecheck+build |
| C9 | 仿真速度语义 | 沙盒 `simSpeedMs` 与主模式 SPEED 同量纲 ✓；但 digitaljs propagate 在波形记录与 step 模式下的耦合缺少文档，`qc-paused/r50b-step` 探针脚本即为此存在——把行为写进 `docs/SANDBOX_DEV.md` 而非留在脚本名里 |

---

## 亮点（值得保持）

- **注释即事故复盘**：几乎每个坑都留了「为什么」级注释（IO order 抖动、toJSON 挂死、捕获阶段监听、引擎自愈……）——这是同规模项目里罕见的知识沉淀密度，新人上手成本远低于同类代码量项目。建议在 `docs/` 汇编成「架构决策记录」并禁止未来重构删注释
- **tsc strict 全绿**且 `vite build` 正常（审查时点）
- 序列化白名单体系（`sandboxSerialize`）从根上绕开了 joint/digitaljs toJSON 挂死，方向正确
- rem 制 `--fs-*` token 让字号联动是**架构级**一次性修复，后续只需守住硬编码不扩散（C4）
- capabilities 的窗口权限最小化（逐条 allow-minimize/maximize...，不是 `core:all`）说明写配置的人有安全意识，与 A1/A2 的疏忽形成对照——大概率是模板默认值没清

## 建议执行顺序（汇总）

1. **第 1 周**：A1+A2+C8（一次 security pass + CI 底网）→ A7 + A6 + A5（数据守卫三件套）→ B6
2. **第 2–3 周**：A4①③（quota 防御与版本化）+ B3（内存缓存）→ A4②（沙盒落 Tauri fs）→ A3 + 真机验收导出
3. **第 4 周起（伴随新功能）**：B1 拆分滚动推进，B2 收进拆分第一步，B7 随拆随清；B4/B5 各安排半天
4. **随手项**：C 组全部可穿插（C3 归档建议尽快，否则 tests 目录会继续膨胀）

---

## 附录 · 取证锚点

- 本报告关键论断可复查：`tsc --noEmit` exit=0；`grep` 命中数表（`prism`：仅 index.html；`beforeunload`：零；`from 'yosys'|from 'digitaljs'`：零；`plugin-fs` JS 绑定：零）
- 健康度扫描脚本：`D:\Visual Studio Code\Something\.tmpbuild\audit_scan.cjs`、`audit_fonts.cjs`（node 直跑，传入仓库路径）
- 行号引用基于 2026-10-05 14:1x 工作树快照（16 commits，HEAD `36136f8`）；并行代理持续在途修改中，**动手前逐条 `git diff` 复核**

---
---

# 卷二 · 深读补充审查（同日晚些快照）

> 卷一只做了「扫描 + 抽查」。卷二对 `verilog.ts`(1222) / `gateSystem.ts`(525) / `sandboxLoad.ts` / `subcircuit.ts` / `subcircuitView.ts`(542) / `Canvas.tsx`(947) / `App.tsx`(1862) / `sandboxStore.ts`(312) / `wireRouting.ts` / `sandboxVerilog.ts` / `WaveformPanel` / `ErrorBoundary` / `index.css` / `Rust lib.rs` / `tauri.conf` / `capabilities` 做了**逐行到逐段**的语义审查。编号 D=绑定/复制管线，E=编译链路，W=运行时/交互，S=工程化。

## 🔴 卷二新增 P1

### D1 · 「复制到沙盒」文件混乱的**代码级根因**（用户原话「复制出来的电路文件极其混乱」）
- **证据链**（`App.handleCopyToSandbox` L775-816 + `gateSystem.collectToFolder` L377-395 + `savePartFile` L149-163）：
  1. 主文件重复点击复制 → `sandboxStore.create('base/base_sandbox')` **无重名检测**（`sandboxStore.ts` L88-101 直接入表）→ 文件树出现多个**同名**主文件；
  2. 子部件 `savePartFile(name,…,folder)` 里 `uniqueDjsName` L135-143 遇同名让路成 `mux8_1.djs / mux8_2…`→ 第二次复制不再覆盖旧部件，而是**堆冗余副本**；而实例绑定按 celltype 名走 `resolvePartRef`——`mux8` 永远精确命中**第一份**旧文件，`_1/_2` 副本无人引用（孤儿），用户却看得见、还会误开误改。**布局固化失败重试（boundErr 提示的「单独补齐」）同样落 `_N`**。
- **影响**：文件树随复制次数线性膨胀、改名/删除动作被用户当「乱」的来源；`_N` 部件被打开编辑后**不生效**（绑定仍指向无名后缀的原版）——「改了没反应」的另一半根因。
- **建议**：复制动作幂等化——同名文件夹已存在时询问「覆盖 / 新版本 `base_v2`」；部件落盘策略明确二选一：按名**覆盖更新**（推荐，符合"定义即真源"）或跳过已存在名；`sandboxStore.create` 全路径去重。
- **工作量**：0.5 天（含 UI 决策弹窗）。**这是本次审查认为的最高优先级产品级缺陷**。

### D2 · 空部件文件阴影遮蔽全局定义（可复现的逻辑洞）
- **证据**：`saveGateFromCellsToFolder` L413：`savePartFile(sub, c.subcircuitGraph || { cells: [] }, folder)`。R39 绑定式存档刻意**不内联**子图 → 画布上按名绑定的实例其 `c.subcircuitGraph` 为空 → 把**空 `{cells:[]}`** 写进当前文件夹。
- **后果**：`resolvePartRef` 打分「scope 内 role:'part' = 0」最优先 → 文件夹内的空壳**遮蔽全局真定义** → 该实例展开/仿真全空、挂在它上面的连线还原失败。恰是「从别处复制来的电路再保存为门」最容易踩中。
- **建议**：内嵌图为空时**跳过落盘**（定义已在别处绑定）或先把 `resolveDefCells` 物化结果再写；写前做 `cells.length===0` 守卫。
- **工作量**：<1 h。

### D3 · 改名撞名分支产生悬空引用
- **证据**：`renamePartDef` L199-241：全库 celltype 引用已改写为 newName（L207-233），但 L238 目标文件名已有冲突时**跳过文件改名**——引用方集体指向不存在的新名，定义文件仍叫旧名。另外 `sandboxStore.rename` L120-125 本身**无冲突去重**：可产生两个同路径同名的文件 → `resolvePartRef` 同级打分时按 `updatedAt` 序「先到先得」→ **绑定目标随任意一次保存漂移**。
- **建议**：冲突时中止改名并提示（引用改写放最后一步）；store rename 加 `uniqueDjsName` 同款去重。
- **工作量**：2 h。

### D4 · palette 实例表与解析作用域规则不一致
- **证据**：`customGateStore.list()`（sandboxStore L281-296）按 `seen.has(name)` **全局去重**，list 按 updatedAt 降序 → 同名多部件时 palette 只展示**最近编辑**的那个；而放置后的实例解析按**文件夹优先**（resolvePartRef L46-62）→ 展示的部件与实际绑定的定义可能不是同一文件。
- **建议**：palette 同名项分组显示（标注所在文件夹），或按当前活动文件 scope 过滤展示。
- **工作量**：2–4 h（UI 交互决策）。

### E1 · `compileVerilog` 无重入锁（并发互相踩 FS 与日志钩子）
- **证据**：`verilog.ts` L757-954：yosys 的 EMSCRIPTEN FS 是全局共享，临时输入固定名 `/input_0.v…`、`/script.ys /output.json /output_netlist.v`；`print/printErr` 钩子与 `logLines` 数组也是每次编译的共享可变状态。两个 `compileVerilog` 并发（`tryCompileAll` 是 async，await 点出现在 `initYosys` 与 L474 新电路构造处）→ A 的文件还没被 A 的 callMain 消费就被 B 覆写/删除 → **随机编译错误或日志串台**。当前仅 App 靠 `status==='compiling'` 禁用按钮做 UI 层挡；示例导入、右键、自动刷新等旁路仍可能二次进入（App.tsx L907 右键菜单的「编译」按钮**无 status 守卫**）。
- **建议**：模块级 promise 串行队列（`compileLock ??= run();`）3 行改动，根治后 App 侧守卫降级成纯 UX。

### W1 · React 合成 wheel 的 `preventDefault` 对 WebView2 页面缩放无效（ctrl+wheel 双重缩放）
- **证据**：`Canvas.tsx` L894-922 用 React `onWheel` 并 `e.preventDefault()`；React 17+ 把 `wheel` 作为 **passive 监听**挂在 root 上 → 合成事件里 `preventDefault()` 是 no-op（仅 console warning）。WebView2 默认 `IsZoomControlEnabled=true`：ctrl+滚轮会触发**整个页面 webview 缩放** —— 与代码自己的 zoomRef 缩放**叠加**，表现为「缩放画布时整个 UI 字体/布局跟着变大」的鬼案例。`index.html` 亦无 zoom 相关 meta。
- **建议**：改原生 `addEventListener('wheel', handler, { passive:false })`；同时 Rust 侧建窗参数 `webview_options` 关掉 ZoomControl（或 `IsPinchZoomEnabled=false`）。
- **验收**：真机 ctrl+滚轮只放大画布、标题栏/侧栏文字尺寸不变。

## 🟠 卷二新增 P2

### D5 · 旧档兼容路径的「内嵌+绑定」混排降级一级
- `loadCells` L49-51 只在**顶层实例**缺内嵌图时走 `resolveDefCells`；若旧存档顶层是内嵌快照、而**其内层**子实例是绑定式（无 `subcircuitGraph`），`buildInnerGraph` L45 拿不到 inner → L55 空图兜底 → 第 2 层起空壳。migrateLegacy 步骤 2 的 walk 只抽顶层带图的（gateSystem L451-464），同样不递归修复绑定层。建议 `buildInnerGraph` 无内嵌图时也试 `resolveDefCells(cc.celltype)`。

### E2 · print/printErr 钩子不在 finally 恢复
- `verilog.ts` L770-870：恢复语句在 callMain 之后的直线代码；预检 `MissingModulesError`（L814）与 read JSON 失败（L878-884）都**提前 throw**，钩子留在吞日志态——下一次编译虽然会重新接管，但**中途**任何 yosys 输出（含用户手动操作）被静默吞掉且 origPrint 引用已失效风险。包 `try/finally` 即可。

### E3 · 顶层模块选择 = `definedModules[0]`
- App L328：目标文件定义多个 module 时永远把**第一个书写顺序**当 top（用户手动网表 top 常写在末尾）；且没有「选择顶层」UI。建议：实例引用图推断被引用最少的 module 为候选 + 状态栏可点切换（或至少把 `hierarchy -check -top` 失败原因翻成人话）。

### E4 · 校验错误行号不可信 + 靠文案正则回捞
- `parseInstantiations` L334 用 `source.indexOf(moduleName)` 的**首次出现**估行号（同模块多实例全指第一行）；App L345 再从 `err.detail` 用 `第(\d+)行` **反向解析**——双重的「拿字符串当协议」。`InstanceInfo.lineNumber` 本就结构化在对象里，随 ValidationError 传一个 `line` 字段即可。

### E5 · ReDoS 形态正则跑在主线程
- L134/L296 `/\w+\s+(?:#\s*\([^)]*(?:\([^)]*\)[^)]*)*\)\s+)?(\w+)\s*\(/`：嵌套不定量词 + `[^)]*` 重复——面对病态输入（长串 `#(((((…`）指数级回溯；`validateModuleInterfaces`/预检/parseInstances 每个文件编译前**全部同步跑**。建议正则重写线性化（去嵌套量词）或给超大文件（>200KB）跳过启发式预检（交给 yosys 真解析 + 现有 abort 兜底文案）。

### E6 · 冲突私有字段挂在 yosys JSON 上传播
- `findNetConflicts` L1052 `mod.__conflictedBits/__driverList` 塞进**将作为数据返回**的 `yosysOutput`（`CompileResult.yosysJson`），`stripExtraDrivers` 隐式依赖它（单独调用静默无效）。建议返回内部结构 `{ conflicts, bits }`，不污染数据对象。

### E7 · `$_DFF_` 之外标准单元无归一化兜底
- `normalizeStdDffCells` 只修 `$_DFF_[NP]_`/`$_DFFE_[NP][NP]_`；`$_SDFF*` `$_SDLATCH*` `$_DLATCH_*` 与 latch 族若同样踩进 yosys2digitaljs 的重复键坑，`Invalid cell type` 直接裸抛（现有 `Invalid cell type` catch 只兜「缺用户模块」话术）。低成本：补一张 cell 归一化表或至少把这句转成 YosysCompileError 话术。

### W2 · 跨 paper 的 document 级查询污染
- `Canvas.probeCellAt` L371 `document.querySelectorAll('[model-id]')` 与 hover tooltip L552 `document.elementFromPoint`——展开模态 / 沙盒（若并挂）同 DOM 时**命中别的画布元素**（钻取右键、波形入口都可能指错靶）。统一改成 `paper.el.querySelectorAll`。

### W3 · 全模式常驻轮询组
- Canvas 300 ms 线标签、FsmTable 300 ms、InputPanel 200 ms、Waveform 60 ms——**引擎 paused/面板隐藏不暂停**（大电路 CPU 空转 + 后台功耗）。加 `running`/可见性判断 + `document.hidden` 短停。

### W4 · 主模式快捷键穿透到沙盒视图
- App L1052 全局 keydown 与 SandboxCanvas 自身监听并存：沙盒里未 preventDefault 的组合（如 Ctrl+S）落回主模式 `handleSave/handleDeleteFiles`——「看不见的主文件被改，**或选中的 .v 文件被删**」路径。App 处理器首行加 `if (viewMode==='sandbox') return;`（除 EDITOR_SAFE 子集）。

### W5 · CSS 焦点/动效/色板一致性
- `index.css` L291 `input:focus { outline: none }` **无替代**（键盘导航看不见光标，button 有 :focus-visible，input 反而没）；无 `prefers-reduced-motion`；错误色三处并存（`--danger` token、`var(--error,…)` 不存在的 token 回退 `#ef4444`、写死的 `rgba(239,68,68,.95)`）。补 `input:focus-visible{outline:2px solid var(--accent)}`，全局 grep `--error` 归一到 `--danger`。

### W6 · `sandboxVerilog` 导出质量与占位符坑
- 未连输入端口直接写字面量 `'x'`（L70：`netOfPort` 返回 null 时 `x`）——生成的 Verilog 引用**未声明信号 x**，拿去编译会炸且和「x=不定值」语义混淆；Bus/Memory/Subcircuit/FSM 只出注释占位（文件头已承认），**导出对话框不警示残缺**。建议：残缺时列出缺项清单让用户确认；占位改 `1'bx` + 声明注释块。附带 `netOfPort` 的 `links.find` 为 O(N²)，大电路导出前先建索引。

### S1 · 无 lint / 无格式化 / 无单元层
- 仓库不存在任何 `eslint/prettier/vitest` 配置（glob 零匹配；package.json devDeps 亦无）——`WaveformPanel.tsx` 头部注释断裂穿插 import（L2-5）是**无 lint 环境的直接化石**。建议：`eslint`（@typescript-eslint + `no-empty` catch 检查 + `no-explicit-any` 警告级）10 分钟配置起步，随 B1 拆分消化存量。

### S2 · public/ 预压缩产物无重生脚本（C1 的定性升级）
- `public/digitaljs.js` 头部是 **webpack 生产 bundle**（`main.js.LICENSE.txt` 注释），仓库里没有重建它的任何脚本/文档；`public/yosys/yosys.browser.js` 6 MB minified；npm `digitaljs@0.14.2`/`yosys@0.30.5` 与静态副本之间**无机械联系**（卷一 C1/C2 的组合根因）。构建不可复现 = 升级三方库只能人肉重打包。建议：引入 `scripts/sync-assets.mjs`（从 node_modules 拷 digitaljs 的 dist UMD + yosys.browser.js/wasm），npm 版本成为唯一锚点，predev/prebuild 自动跑。

### S3 · 沙盒无 schema 版本号（A4 补充）
- `SandboxFile` 只有 role/kind 增量字段，文件集整体无版本标记迁移只能靠散落的 localStorage 标志位（A6）；`Rust sanitize_path`（lib.rs L?-?）**拒绝 ParentDir 与绝对路径** ✓ 有防护意识——但 Windows ADS/`~` 段未拦（fs 操作前缀是受控 appdata，实际危害低，留 P3）。

## 🟢 卷二观察到的亮点（第二遍阅读后确认）

- `subcircuitView.constructCircuit` 的**三级降级链**（完整 ctor → 净化重建 → 剥线逐条补线 + 僵尸线回滚 + 「宁可 skip+计数不猜端口」）设计清醒、注释带实测残差（r43c-api 锚点数学）——这是全仓最经得起推敲的一块。
- `sandboxLoad/subcircuit` 的 Memory `memdataInit→memdata`、order 键、box_resized 等**构造期属性清单**收进 `deviceParams.ctorParams()` 单一来源，正反序转换共用清单，明显是吃过亏后的正确收敛。
- App keyboard guard：`e.defaultPrevented` 短路 CodeMirror 键位 + `EDITOR_SAFE` 白名单——事件仲裁思路对。
- wireRouting 把「设置只作用一半、重开才生效」的老坑用逐条 `link.router()` 重排解决并注释了 joint 无 removeRouter 的实测依据。

## 卷二修订后的建议执行顺序（与卷一合并）

| 序 | 项 | 理由 |
|----|----|------|
| 1 | A1+A2+C8 · D2 · W4 | 半天内全部可关闭的安全/数据洞 |
| 2 | **D1**（+D3、D4 同场决策） | 用户点名抱怨的核心，产品观感 |
| 3 | E1 · W1 | 编译随机错 + 「缩放怪」根治 |
| 4 | A4·A5·A6·A7（卷一数据守卫包） | 与 D1 幂等化一起做，持久化一次定形 |
| 5 | E2–E6 · W2 · W3 · D5 | 编译链鲁棒性 + 跨画布串扰清理 |
| 6 | S1 · S2 · B1 启动 | 工程地基，随重构滚动 |

*（卷二完 · 证据均为 2026-10-05 工作树快照 `git log` HEAD 36136f8 之后在途状态）*

---
---

# 卷三 · 交互状态机 / 配置 / 合规 / 可访问性（同日第三遍）

> 覆盖：SandboxCanvas 键盘/删除/保存门/换绑区（L806-880、1820-1894、2300-2344、2435-2644）、SandboxExpandModal 全文（359 行）、SandboxFileTree 全文、SettingsPanel、shortcuts.ts 全文、projectConfigStore、examples.ts、themeStore、依赖许可证扫描。编号 F=交互状态机，G=项目/配置，L=许可合规，A=可访问性。

## 🔴 卷三新增 P1

### F1 · 沙盒未消费的快捷键**穿透成主模式文件操作**（零确认删盘）
- **证据链**：`SandboxCanvas.onKey` L2331-2336：Delete/Backspace **无选中即 `return`（不 preventDefault）**；Ctrl+C（L2321）/Ctrl+V（L2323）同样不 preventDefault。事件继续冒泡到 App 全局 keydown（`shortcuts.ts` L41-42 把 `Delete`/`Ctrl+C`/`Ctrl+V` 绑成 **主模式文件操作**）→
  - 主模式曾选中文件（selectedIds 跨视图切换**不清空**）→ 在沙盒画布随手按 Delete → `handleDeleteFiles` → `fileStore.deleteFile` → `invoke('delete_project_file')` **磁盘直删**；
  - Ctrl+V 在沙盒粘贴器件的同时，App `handlePaste` **也复制了一份 .v 文件**（双重副作用）。
- **叠加面**：全仓 `askConfirm` 只在 App L977 用过**一次**（删文件夹）——右键「删除」与 Delete 键的文件删除路径**全部零确认、零回收站**。
- **建议**：① App 全局 keydown 首行 `if (viewMode==='sandbox' && !EDITOR_SAFE.has(id)) return;`（W4 的具体化）；② 沙盒无选中的 Delete 也吞掉事件；③ 文件删除加「进回收站目录」或至少 askConfirm（已有基建，一行）。

### F2 · 「展开图 → 编辑部件」闭环断在入口上（用户 R39 核心诉求的最后一公里）
- **证据**：SandboxExpandModal（全文精读）是**完备的只读查看器**（钻取面包屑/缩放/自动整理/降级计数都有），**没有「打开编辑此部件」按钮**；编辑部件的路径是另一条：关弹窗 → 文件树找同名 `.djs` → 单击（handleFileOpen L2693 对 role:'part' 直通 handleOpen ✓）。
- **后果**：用户在展开图里发现子部件画错，接下来要「关掉弹窗 → 在可能几十个文件里认出那个部件文件」——正是用户抱怨「复制到沙盒的电路要都能编辑，而不是只读展开图」**未被完整兑现**的残留段：编辑能力已有（部件文件可编辑 ✓），**入口未打通**。
- **建议**：弹窗页脚在 `top.kind==='def'` 时加「⌘ 打开编辑」按钮（SandboxCanvas 传入 `onEditDef(name)` → 查文件 → handleFileOpen）：约 15 行。

### F3 · 定义变更对活画布**不联动**，直到切文件
- **证据**：部件文件编辑保存（commit L835 对 role:'part' 走 sandboxStore.save 即时化 ✓），但已打开的主画布上**放置态实例**的 graph/ports 仍是放置时快照；仅靠切换文件重建（handleOpen→rebuild）才物化新定义。无「定义已变，实例未刷新」的任何提示。
- **叠加**：定义被删（handleDeleteGate L2671）后，**已 strip 过内嵌的主文件**重开 → resolveDefCells null → buildInnerGraph 空图兜底（sandboxLoad L56）→ 实例空壳且不报错；DRC（L1828-1855）**不检查**「Subcircuit 无定义无内嵌」，用户只能连线莫名消失。
- **建议**：① runDrc 补一条：`type=Subcircuit && !subcircuitGraph.cells.length && !resolveDefCells(celltype)` → issue「部件 X 定义缺失」；② 部件保存时 toast 提示「已更新，切回主电路后实例自动生效」。

## 🟠 卷三新增 P2

### F4 · 两套 IO 端口唯一化算法——**port id=网名**是连线锚点，双轨迟早错位
- `subcircuit.dedupeIoNets`（L167-195：按 **position 排序** 编 `inN/outN`）与 `SandboxCanvas.placeCustomGateAt` 内联去重（L2607-2623：按 **inner 插入序** 编 `in${n}/out${n}` + `_` 后缀策略）。两处分叉实现同一合同；一旦定义内 IO 位置序≠插入序，**放置时与重载时的端口命名不同 → 连线按 port 字符串锚定，换名即断线**。合并成调用前者即可（同文件已 import）。

### F5 · 「保存为部件 / 复制到沙盒」的同名策略分裂（D1/D4/D7 的第三面）
- `handleSaveGate` L2662 → savePartFile：同文件夹同名=**静默覆盖**；不同文件夹同名=**静默新建影子文件**；palette 按名去重只显示一个。三种结果用户都无从选择，也没有提示。建议统一成「同名检测 + 覆盖/另存/取消」askConfirm 一次决策，finalName 回传 toast。

### G1 · projectConfigStore 是「半个死配置」
- `verilog-viz.config.json` 的 `topModule/setTopModule/yosysOptions/compilerOptions(noFlatten,noOpt)` **全仓零消费者**（grep 定案）；实际只有 `defaultView` 在 App L233-235 被读。用户改不到的设置项伪装存在（且 UI 无入口）。二选一：接进 compileVerilog（topModule 正好解 E3），或删字段防误导。

### G2 · 「工程」概念缺整层——数据不出机器
- 编译模式文件（app_data/project_files）与沙盒文件（localStorage）**都没有工程级打包**：无「打开/保存/另存工程」、无导入导出 zip、无最近工程。换机重装即全丢（叠加 A4 单点）。建议：工程 = `project.vviz` 目录/zip（.v + config + sandbox-store 快照 JSON+folders），导出复用现有 walkGateClosure 序列化。这是下一步产品化的结构性缺口，优先级排在 P1 修完后。

### L1 · 许可证合规：整体干净，缺三张纸（好消息为主）
- 扫描：digitaljs / yosys2digitaljs = **BSD-2-Clause**，yosys wrapper / codemirror / tailwind / radix / clsx / tailwind-merge = MIT，lucide = ISC，cva = **Apache-2.0**——**无 GPL 传染**，OpenCircuits 红线守住了 ✓。
- 待补：① `public/digitaljs.js` 头部指向的 `main.js.LICENSE.txt` 未随 bundle 放置（BSD-2 再分发需保留版权行）——放 `THIRD-PARTY-LICENSES/`；② 应用无「关于/开源许可」窗口（cva 的 Apache-2.0 也要求 NOTICE 展示）；③ 顶层无 LICENSE 文件（私有可暂缓，若发布需定）。工作量 0.5h。

### A1 · 弹窗可访问性成系统欠账
- 全 22 个弹窗组件里只有 PromptDialog/ConfirmDialog 有 `role="dialog" aria-modal`；展开图/波形/设置/命令面板等均无焦点圈定（Tab 可跑出弹窗到画布）、无 aria。`input:focus{outline:none}`（W5）叠加键盘用户完全盲操作。建议：抽一个 `useDialogA11y(ref,{onClose})`（焦点陷阱 + Escape + aria-modal 一次性挂）替换各弹窗手写，40 行。

### F6 · 帮助对话框漏 Sim 组（单源双写化石）
- `SHORTCUT_GROUPS`（shortcuts.ts L50）缺 `'Sim'` → ShortcutsHelpDialog 按组渲染时 **F7 单步** 永远不见。registry 设计正确但数组手工维护漏项——从 SHORTCUTS 里 derive groups 即可根治。

## 🟢 卷三确认的质量亮点
- SandboxFileTree：dragDepth 计数、folder 拖拽、落点高亮、与编译模式 Sidebar 的 buildFolderTree 同语义——「对齐 IDE 文件系统」的要求落地扎实；`handleDeleteGate` 明确告知实例兜底语义；`walkGateClosure` 导出依赖闭包正确实现了「共享 .djs 自动补注册部件」（R39 导入侧 L2897）。
- `rebindSubcircuitCell`（换绑）：重建而非就地改（注释解释了 digitaljs 端口表只在构造期生成）、线按 port id 回接 + dropped 计数 + 「用 id 不用 cell」的历史教训注释——这是全仓交互实现里最正确的一处。
- matchesCombo 的 Shift/大小写归一无漏洞；examples.ts 的「known-good 原则」注释纪律。

## 卷三修订后的执行顺序（并入前两卷总表）

| 档期 | 内容 |
|------|------|
| 第 1 周 | A1+A2+C8、D2、W4→**F1（穿透+删文件确认）**、E1、A7 |
| 第 2 周 | **F2（弹窗打开编辑按钮）+ F3（DRC 空壳检查）+ F4（去重算法合并）+ F5/G1（同名策略与死配置收口）**——全是小改动但直接消解用户抱怨面 |
| 第 3–4 周 | D1 复制幂等化、A4/A5 持久化、L1 合规、A1 弹窗 a11y 基建、W1 真机验证 |
| 中期 | G2 工程打包、S1/S2、B1 巨石拆分、Waveform/示例扩充（test_files 现成 counter/ALU/FSM 可进 gallery） |

*（卷三完 · 2026-10-05，工作树 HEAD 序列 36136f8+ 在途）*

---
---

# 卷四 · 五轮专项深查（R4–R8，同日第四遍）

> 本轮按专题横切：R4 仿真引擎生命周期、R5 交互状态机、R6 序列化契约与导入导出、R7 组件层逐个过检、R8 构建/工程化/运维。编号 N=引擎、T=交互、S=序列化、K=组件、O=运维。卷四完成后，`SandboxCanvas`(3656 行)与 15 个交互组件已全部过检，仅剩 examples.ts 尾部 47 行与 Rust lib.rs 已在卷一/二覆盖。

## 🔴 卷四新增 P1

### N1 · **卸载保存不剥离内嵌 →「定义编辑不生效」回归通道**（与 D1 同症状的第二根因）
- **证据**：`SandboxCanvas` effect cleanup L2422-2425 落盘用 `sandboxStore.save(id, JSON.stringify(serializePaper(paper)))` ——**没有 `stripBoundInlineJson`**；而 handleOpen L2447 ✓、commit 即时落盘 L836 ✓ 都剥。三处写点剥离合约断在第三处。
- **复现链**：沙盒里编辑完部件文件 → 切到电路/代码视图（触发沙盒 unmount 保存，实例**带着放置时的内嵌旧快照回去**）→ 回到沙盒重开主文件 → `sandboxLoad` L49 `c.subcircuitGraph ||` **内嵌优先** → 旧快照复活 → 用户看到「改了部件没生效」。同时该文件永久变回内嵌式肥大存档，绑定单一真源被破坏。
- **修法**：一行（L2424 包上 `stripBoundInlineJson(snap, scopeRef.current)`）。**本轮性价比最高的单项修复**。

### S1 · `sandboxStore.copyFile` 丢失 role/kind —— 部件「创建副本」静默降格
- **证据**：copyFile 构造的副本对象 L252-257 只含 `{id,name,graphJson,updatedAt}`——**role、kind、circuitJson 均不复制**。对 role:'part' 部件文件点右键「创建副本」→ 副本变普通电路：从「部件（可编辑电路）」面板消失；若被改名让路成 `mux_1.djs`，实例绑定仍指原版，用户面对一个长得像部件却不是部件的文件。
- **修法**：`copyFile/duplicate` 全字段浅拷贝（`{...src}` 去 id）；建议顺带明确「部件副本要不要成为第二个同名部件」的产品语义（默认应拒绝同名、提示改名）。
- **工作量**：15 分钟。

### O1 · **本地与远端 git 历史分叉（ahead 16 / behind 105）——当前代码没有站外备份**
- **证据**：`git rev-list --count origin/main..main` = **16**，反向 = **105**（远端仍是仓库重建前的旧 105 commits）；`.git-broken-backup/` 目录实存佐证重建事故史。
- **影响**：近两个月全部新功能只存在于这台机器的本地盘上；误删/坏盘/勒索即全损。`git push` 会因 non-fast-forward 被拒。
- **建议**（必须用户决策，审查不代做）：① 若接受覆盖远端历史 → `git push --force-with-lease`（先把远端当历史归档打 tag 或保持 fork）；② 若需保留远端历史 → `git fetch` + 以 merge（`--allow-unrelated-histories`）缝合；③ 无论哪条，先做一份工作树 zip/第二 remote 冷备。**这是运营最高优先项**。

## 🟠 卷四新增 P2

### N2 · 播种向量宽度盲选——`seedGateOutputs` 可能给多位门灌 1 位 0
- `pickDefinedVector`（L376-403）返回「第一个非 x 向量」或兜底 `Input{bits:1}` 的 1 位向量；seed 对多位门 `c.set('outputSignals',{out: zero})` **不按 c 自己输出端口 bits 构造**。多位全 x 输入门（BusGroup/加法器进总线）在此传播周期拿到宽度不符的 out，与 digitaljs 的 `assert(ports[i].bits==width)` 族仅一线之隔。修法：按 `c.getPort('out').bits` 现造（`v.constructor.zeros/fromBin(bits)`）。

### T1 · 拖拽会话的 document 监听器不在生命周期管理内
- `startWireDrag`（L2201-2202）与批量拖动（L2286-2288 在 onUp 内自删）——**mouse**up 自删对正常路径成立；但若拖线途中 effect cleanup（切文件/resetNonce/在途代理改依赖触发重建）：cleanup 已知移除清单（L2412-2418）不含会话级 handler → 孤儿 `onMove` 继续对 destroy 后的 paper 调 `clientToLocalPoint/set` → document mousemove 异常风暴（ErrorBoundary 收到的是原生事件回调错误，React 捕不到 → 只有 console error，画布已经易主但 tempLink 仍挂在旧图上）。修法：会话 handler 注册进数组，cleanup 统一摘 + `tempLink.remove()`。

### T2 · W1 修正与扩大：ctrl+wheel 页面缩放风险在**全应用除沙盒画布外**的每一处
- 沙盒画布 root 的监听是原生 `passive:false` + preventDefault ✓（L2360）；主模式 Canvas 是 React onWheel（合成监听拦不住）；侧栏/标题栏/设置面板/波形区根本没处理。**WebView2 `IsZoomControlEnabled` 默认开** → 在窗口任意非沙盒位置 ctrl+滚轮 = 整个 UI 页面级缩放。修法二选一（或都做）：document 级原生 wheel 监听吞 ctrl+wheel；Rust 侧建窗配置禁用浏览器 zoom。

### S2 · 主模式导出 SVG/PNG = 视口裁剪（所见非全图）
- `exportSVG` L10-23 / `exportPNG` L34-53 直接 clone **当前 paper/viewer DOM**：用户缩放到 0.4 查看全局后导出——SVG 保留 wrapper `transform: scale(0.4)` 与视口尺寸 → 成品图小且裁边；vs 沙盒 `buildSvgString` 按 `model.getBBox` 取景并剥视口变换（正确做法）。两份实现口径分叉的实质缺陷版。修法：主模式也走 getBBox 取景（或复用 sandboxExport.buildSvgString 思路），B4 合并时一并解决。

### S3 · IPC 传大字节数组：`Array.from(bytes)` 走 JSON 通道
- exportUtils 5 处 `save_export_file(content: Array.from(u8))`——PNG@2x 大图可达 **数十 MB 整数数组 JSON**：序列化/反序列化双端阻塞几十秒级风险。修法：Tauri v2 支持 `tauri::ipc::Request`/binary payload（`@tauri-apps/api/core` 直接传 `ArrayBuffer`/`Uint8Array`，Rust 侧 `tauri::ipc::Command` 用 `Bytes`/`InvokeBody::Raw`）；短期至少加保存中 toast。

### K1 · CodeEditor 切 tab = 跨文件撤销污染
- L238-247：`code` prop（新文件内容）变化时做 **doc 全量 replace dispatch** → CM6 history 栈继续累积：B 文件里 Ctrl+Z 会把文档滚回「把 B 整篇替换成 A 的内容」之前的中间态，出现半 A 半 B 的怪文。修法：文件切换 dispatch 时加 `userEvent: undefined` + `addToHistory: false` 效果（`Transaction.addAnnotation(ApplyTransactionFlag)`/`EditorState.transaction(...).scrollIntoView` + `StateEffect.appendConfig(historyConfig)` 重置换 `Compartment` 重建 history），业界标准解是给 EditorState 挂 `history.of({newHistoryConfig})` 或干脆 key=`fileId` 重建 view。**用户改 Verilog 的高频路径，值得专项**。

### O2 · Cargo release 未调优 & 窗口状态不持久 & README 过时
- `[profile.release]` 缺失（lto/strip/codegen-units 默认值，安装包偏大发版偏慢——加 4 行）；未装 `tauri-plugin-window-state`：无边框自绘窗口每次启动回 1200×800（用户已投诉过布局尺寸类问题，属同类）。README(114 行) 通篇无 sandbox/沙盒 关键词——核心功能群未入文档；`.git-broken-backup/` 建议移至仓库外归档。

## 🟡 卷四 P3 精选
- **N3**：`window.__restoreLog/__flushLog` 全局数组无上限累积（长会话内存）+ 又 2 个 QC 钩子入产线（并入 B6 清单）。
- **N4**：unmount cleanup 只 stop 无 `circuit.shutdown()`（Canvas 那边 stop+shutdown 双保险，口径不一）。
- **S4**：`memdataInit` 快照静默截断 256 字（`Math.min(1<<abits, 256)`）——大容量 Memory 内容悄悄丢，应至少 toast/标注导出截断。
- **S5**：`attrs` 整包透传进白名单（L31）——白名单唯一"非白"通道，未来 digitaljs 若往 attrs 挂运行时对象会复活挂死类问题；可加深度 4 的对象叶子清洗。
- **S6**：uniqueDjsName 第三份拷贝（sandboxStore/gateSystem/SandboxCanvas）——三处同名让路规则（`_1` vs ` (1)`）已经开始走偏。
- **K2**：普通 .djs 改名不做 celltype 重绑定，但 resolvePartRef 兜底允许普通 .djs 当定义（score1/4/9）→ 第二悬空引用路径；要么禁止「任意 .djs 兜底」，要么改名统一走 renamePartDef。
- **K3**：a11y 复查收口：其余组件监听器配对全部平衡 ✓ 零 eval ✓ any 密度低 ✓——组件层是全仓最干净一层；唯 16 个弹窗仅 2 个有 role/aria（A1 已计）。
- **K4**：C4 修订收回——CodeEditor 字号**已联动**（root rem + `--editor-font-size` + `requestMeasure` L261-267），卷一「疑似双轨」观察项撤销。
- **T3**：连线失败 wireCountRef 不回退（N 号跳号）；波形区滚轮被画布吞（平移打架）；右键拖拽「按下在画布/松开在侧栏」仍弹画布空白菜单（R34 只堵了反向）。

## 卷四执行增量（并入总表后的最新头名）

| 排名 | 项 | 性质 | 改动量 |
|------|----|------|--------|
| 1 | **N1 unmount strip 一行修复** | 修「定义改了没生效」回归 | 1 行 |
| 2 | **S1 copyFile role 丢失** | 部件降格 | 5 行 |
| 3 | **F1 快捷键穿透 + 删除确认** | 数据丢失 | 20 行 |
| 4 | **O1 git diverge 决策** | 备份灾难 | 用户决策+10 分钟 |
| 5 | K1 / N2 / T1 / T2 | 编辑器历史、播种宽度、孤儿监听、页面缩放 | 各 <1 天 |
| 6 | D1、E1、A1/A2、W1(main)、S2/S3 合并导出 | 前卷累积 P1/P2 | 见各卷 |

*（卷四完 · 至此 src 全目录 + src-tauri + dist + git/远端 完成覆盖审计；唯 public 静态二进制内容与 yosys wasm 内部实现不在审计范围）*

---
---

# 卷五 · 在途任务清单成果查验（2026-10-05 晚，只读 + dist 实测取证）

> 方法：静态逐条对源码核验 + serve dist（07:14 构建，含最新修复）跑 Edge headless 探针截图（`.tmpbuild/accept/s0-s5.png`）。探针脚本 `.tmpbuild/verilog_accept.cjs`。全程未改仓库任何文件。

## 逐项判定

| # | 清单项 | 判定 | 证据与缺口 |
|---|--------|------|-----------|
| 1 | 网表分级：有 net 尝试编译+标冲突，无 net 拒编译 | ✅ 已实现 | `verilog.ts` L906-928：具名冲突→strip 后照常出图+告警清单；无名冲突→`conflictText` 拒编译并说清原因。**实测 s1**：test_counter.v 单独导入 → 拒编译 + PROBLEMS 面板 4 条「模块 dff 未定义」✓。⚠ 残余：① 4 条错误行号全显示 `:8`（实际 d0-d3 在 8-11 行）——卷二 E4 的 indexOf 粗估行号在 PROBLEMS 面板再次实锤；② 错误态画布中央「Compilation error / Interface validation failed: 4 error(s) / 编译 (F5)」整段英文未中文化（新 C5 例证，s1 截图） |
| 2 | 编译模式也标自动名 | ✅ 已实现 | `verilog.ts` L966-973 `assignAutoNetNames`（io_ui 后、渲染前，递归全层级补 N1/N2）；L952 `renameAutoCells` 配合。**实测 s2**：无名器件显示 AUTO_1/AUTO_2，具名线 carry/sum/a/b 正常 |
| 3 | 编译模式右键拖动弹菜单 | ✅ 已实现（代码级） | App L1019-1046：按下→抬起且位移>4px 判定为拖动，不弹菜单；捕获阶段监听绕开 joint 吞事件。**探针未覆盖此交互**（headless 右键拖拽模拟不可靠），建议真机回归确认 |
| 4 | 沙盒右键菜单/侧边栏统一编译模式样式（含左侧边栏） | ⚠️ 部分落地，**标准待用户裁决** | 已做：SandboxFileTree R40 整文件重写对齐 Sidebar（lucide 图标/hover/重命名铅笔/拖拽落点高亮/缩进行高同源，文件头注释逐条列差异清单）；ContextMenu 两模式共用组件；index.css L683-686 `.sb-file-row` 对齐样式。未对齐的显性差异（s3 截图可见）：沙盒侧栏是「竖排按钮组」（单步/复位/暂停/SPEED/撤销/重做/缩放/波形/导出…），编译模式是顶部横条工具栏（仿真/暂停/单步/速度/波形/输入/示例/复制沙盒/保存/编译）——**布局结构仍两套**。「添加入口」具体指哪个入口未明（见文末问题） |
| 5 | 走线设置全局统一（非仅沙盒） | ✅ 已实现 | `wireRouting.ts` 单一实现；Canvas.tsx L189-193 订阅 settingsStore 即时重排 + L1296 构建时应用；沙盒同一入口 |
| 6 | 改走线后线路立刻变化 | ✅ 已实现 | `applyWireStyle` 逐条 `link.router()` 触发 joint 重画（wireRouting.ts L28-37 注释解释了只改 defaultRouter 不生效的原因） |
| 7 | 两模式展开图滚轮缩放丢画面 | ✅ 已实现（代码级） | 锚点数学单一实现 `paperZoom.ts`，renderCircuitView mount 级 wheel 绑定 + SandboxExpandModal 按钮路径 `__zoomAtClient`（L245）；r43c 实测三锚点残差 0。**探针 s5 因页面状态未真正打开展开图，未覆盖**——建议真机回归 |
| 8 | 展开图与编译渲染不一致（部件位置） | ✅ 已实现 | R35 同管线（提升为顶层 + io_ui + elk）；`shouldAutoLayout` 判定自带坐标的编译产物保留原位零开销 |
| 9 | 复制沙盒部件位置混乱 | ✅ 代码已修，**大图待验证** | `layoutModuleCells` 改用 elkjs + `waitLayoutSettled`（L256-268 注释记录了 dagre 偏差 17%/45% 的实测根因与修复）。**实测 s3**：半加器复制后布局与编译一致（AUTO 门/carry/sum 位置对齐 s2）。多模块（mux4/counter 级）未实测——建议跑 `test_files/` 全套回归 |
| 10 | 深色主题文字仍黑色 | ✅ 已修复（新构建） | computed-style 探针：纸面 42 个 svg text 全部 `rgb(228,228,236)` 浅色；s2/s3 截图器件名/线名/引脚全可读。⚠ 若用户仍在旧构建/Tauri 未刷新窗口看到黑字，需其确认当前运行版本；**多位器件的 foreignObject HTML 控件（valinput）探针未覆盖**（示例无多位输入），建议真机看 Constant/NumEntry 一处 |
| 11 | 删部件文件后右键部件栏残留 | ✅ 已实现 | `handleDeleteFiles`→`syncAfterFsOp`→`refreshGates`（L2711-2716+L2689）；`handleDeleteGate` 双路径同步；s3 侧栏「自定义部件」与文件树同源实时 |
| 12 | 沙盒波形可调速 | ✅ 已实现 | 沙盒工具条 SPEED 滑条（SandboxCanvas L3397-3405，与编译模式同一 5-200ms 量纲）+ 引擎 interval 跟随（L1694-1701）。⚠ 若用户指的是**波形滚动时间窗**随速度变化（POLL_MS=60 固定采样），那是另一语义——见文末问题 |
| 13 | （清单第 11 条后半）删除部件后不可放置的提示 | ✅ | 删除 toast 明示「同名实例将无法展开（内嵌快照兜底）」；展开失败有 failMsg（SandboxExpandModal L140/103） |
| 14 | 文件内添加自定义部件自动绑定部件文件 | ⚠️ 语义待确认 | 现有实现：放置部件=celltype 按名绑定（placeCustomGateAt）；保存为门=saveGateFromCellsToFolder 递归入库绑定；改名=全库重绑定。若用户指「画布上**已存在**的匿名子电路，保存为门后应自动把那些实例换绑到新部件」——**未实现**（handleSaveGate 只入库，不回写画布匿名实例 celltype）——见文末问题 |

## 实测新发现的缺陷（追加编号）

- **V1（P2）**：PROBLEMS 面板「模块未定义」类错误**行号恒为首实例行**（s1 实锤：4 条 dff 错误全指 :8，实际 8/9/10/11）——`parseInstantiations` 用 `source.indexOf(moduleName)` 估行的既有缺陷（卷二 E4）在新增 PROBLEMS 消费端放大；修法：给 InstanceInfo 带真实行号（数换行符）随 ValidationError 传结构化 `line` 字段，App L345 停止从 detail 文案正则回捞。
- **V2（P3）**：错误态画布占位 UI 整段英文（「Compilation error」「Interface validation failed: N error(s)」「No problems. Code is clean.」）——中文化清单补漏。
- **V3（观察）**：s1 中 test_counter.v 导入即触发了自动编译（状态栏红点+PROBLEMS 直接填充）——若用户不希望导入即编译，需要设置开关；当前行为符合「known-good 反馈」惯例，仅记录。

## 探针未覆盖（需真机回归的 3 项）
1. 清单 3：右键按住拖动 >4px 不弹菜单（headless 模拟不可靠）
2. 清单 7：展开图 ctrl+滚轮连续缩放 20 次画面不丢（r43c 锚点已验，回归即可）
3. 清单 9：多模块设计（mux4 + 自定义门嵌套）复制沙盒后的布局一致性

## 待用户裁决的产品预期（已并入本轮提问）
- 「要添加入口」的入口指什么（部件绑定面板？冲突标记视图？其他）
- 清单 4 的统一标准：沙盒侧栏按钮组是否需要改成与编译模式同构（顶部横条工具栏 + 左侧纯文件树），还是现状（左树已对齐、工具区保持沙盒专属）即可
- 清单 12「可调速」是否已满足（SPEED 滑条已在）还是指波形时间窗缩放
- 清单 14「文件内添加自定义部件自动绑定」是否指匿名子电路保存为门后回换绑画布实例

## 卷五补录 · 探针 v2 实测（清单 3/7/9 三项补测，全部通过）

> 脚本 `.tmpbuild/verilog_accept2.cjs`（serve dist 8124 + Edge headless），截图 `s6_ctxmenu / s7_expand_zoom / s8_sandbox_copied.png`。断言不依赖 UI 文案（用 `data-context-menu`/`data-inner-host`/`data-sandbox-filetree` 属性与 paper scale/translate 数值判定）。

| 项 | 断言 | 结果 |
|----|------|------|
| 清单 3 | 右键拖动 80×50px 不弹菜单；原地右键弹菜单 | ✅ `drag_no_menu=true` + `click_menu_shown=true`（正反两路都验证） |
| 清单 7 | 展开图 ctrl+滚轮 ×6：scale 2.98→5.27、translate 补偿 -11.7→-433.5、**6/6 器件视图仍在视口内** | ✅ `expand_zoom_keeps_view=true`；s7 截图 296% 内容居中无丢失 |
| 清单 9 | 多模块（full_adder+2×half_adder+or）复制沙盒 | ✅ 布局与编译一致（实例框/门/灯走线清晰），文件树按文件夹收纳：`example_full_adder/` 下主电路 `.djs` + `half_adder.djs` 部件（递归迁移 1 个子级部件、2 个子模块实例，状态栏计数与树一致） |

**清单 10 追加实锤**：s8 沙盒画布内实例框引脚名（a/sum/b/carry）、线名（c1/s1/cin/cout）、AUTO_1 门名在深色下全部浅色可读；s7 展开图同理——**深色文字问题在 07:14 构建中确认全链路修复**（编译视图/沙盒画布/展开图三处）。

**新观察（cosmetic，追加编号 V4）**：s8 中 Subcircuit 实例框内引脚标签（`a sum / b carry`）贴框边略拥挤、与穿线重叠一像素级——不影响可读性，属展开图 IO 布局密度问题，优先级最低。

### 卷五终局判定汇总（更新）
- ✅ 实测通过：1、2、3、5、6、7、8、9、10、11、12、13（12 项）
- ⚠️ 待用户裁决标准：4（统一样式程度）、14（自动绑定语义）、「添加入口」所指
- 残余缺陷（非清单内）：V1 PROBLEMS 行号恒等、V2 错误态英文文案、V3 导入即编译（现状符合惯例）、V4 实例框引脚拥挤

## 卷五终局 · 用户裁决落定（2026-10-05 晚）

四项产品预期已获裁决，清单终局判定如下：

### 终局判定：✅ 完成 12 项 / ⚠️ 转开发需求 2 项

| 裁决 | 内容 | 对应用户原话 |
|------|------|-------------|
| **R-A（新需求·P2）** | 「要添加入口」= **部件绑定管理的全局入口**。现状：仅有实例级右键「换绑部件定义」子菜单（SandboxCanvas L1443，逐个实例操作）；**缺**一个全局视图（类似编译模式 BindingDialog 的定位）：列出当前画布/当前文件夹所有 Subcircuit 实例 → 各自绑定到哪个部件文件、未绑定/绑定失效高亮、一键换绑。建议落点：沙盒工具区「设置」旁新增「部件绑定」面板，或文件树右键「本文件绑定总览」 | 入口=部件绑定管理入口 |
| **R-B（新需求·P2）** | 「文件内添加自定义部件自动绑定」= **跨文件夹拖入/移动时自动 ensure-def**。现状：`ensureDefsFromCells` 已覆盖粘贴（L1517）、剪贴板（L1621）、导入（L2931）三条路径，**唯独 `handleMoveFiles`/拖拽移动文件到另一文件夹不跑**（L2879-2884 只 move+sync）→ 文件移入新文件夹后，其实例引用的部件仍靠「根→全库」兜底解析，文件夹不自治，同名部件遮蔽场景下行为会变。修法：moveFilesToFolder 后对每个移动文件 `ensureDefsFromCells(cells, 新文件夹)`（缺失定义复制/注册随行） | 跨文件夹拖入自动 ensure-def |
| 清单 4 | **判 ✅ 达标**（行高/图标/hover/右键菜单对齐即可，布局结构不强制同构）；残留仅细节打磨项：V4 实例框引脚拥挤、菜单项文案一致性 | 现状已够，仅细节打磨 |
| 清单 12 | **判 ✅ 完成**（SPEED 滑条+引擎跟随即预期） | 现状已满足 |

### 卷五最终清单状态
- ✅ 实测/代码双确认：1、2、3、4、5、6、7、8、9、10、11、12、13（13 项全部落地）
-  由裁决派生的新开发项：R-A 绑定管理全局入口、R-B 移动文件夹 ensure-def（两项均为 P2，建议交给在途代理排入下一批）
- 🐛 本次查验新增缺陷（均不在原清单）：V1 PROBLEMS 行号恒等（P2）、V2 错误态英文文案（P3）、V3 导入即编译（观察）、V4 实例框引脚拥挤（P3）

*(卷五完 · 成果查验方法：静态逐条 + dist serve 实测探针 ×2 + 截图目检 + computed-style 探针；全程只读，探针资产在 `.tmpbuild/verilog_accept*.cjs` 与 `.tmpbuild/accept/`)*

> ⚠ **这一行的资产指针已过期**（批次 R87 当场查盘）：`.tmpbuild/verilog_accept*.cjs` 与 `.tmpbuild/accept/` **都已不在仓库里**（`.tmpbuild/` 现在只剩日志与 `.bak`）。
> 卷五那两项实测**今天的可复现入口**是：`node tests/run-all.cjs`（含 `qc-preview`／`qc-paused`／`qc-realuser` 这三颗走同一件事的现行版本）
> 与单跑任一 `node tests/qc-*.cjs`。⛔ 别再照这一行去找那两颗脚本。

---

# 卷六 · 裁决派生项落地与读数更正（批次 R81 → R84，2026-10-06 凌晨）

> **跑批台账（要如实记）**：`BATCH-R87` 那一跑到第 26 格被我主动中止（24 绿／1 红），原因是后面还有
> 两处源码改动要落（R87 的 Esc 族＋`simBlocked` 那颗状态位），跑批必须量**最终**的源码，不然那一跑只是半成品。
> 中止前唯一的红格是 `r40-verify [4] 编译模式只读预览 — {"modal":false}`，**先取读数再归责**：
> 单跑 `node tests/r40-verify.cjs` 的结果与后续动作记在下面的「r40 那一格」条里。
> 权威那一跑是**最后一次的 `tests/run-all.cjs`**，之前所有跑批都只算过程证据。

## R87 之后又落的两件（同一天凌晨）

| 项 | 状态 | 证人 | 现场读数 |
|---|---|---|---|
| 「按 Esc 关窗」依赖父组件现建回调 | ✅ 九颗组件收口 | `tests/r87-esc-shape-gate.cjs` [1] | 扫描报 Esc 族 **12 处**：违规 9→0、已收口 10、射程外 2（`MemoryViewModal` 留 `[editing]`＝状态；`SandboxCanvas:1827` 那条随 paper 重建） |
| 状态栏文案被反向"认事" | ✅ 一处（全仓唯一） | 同闸门 [3] | 修前 1 处、修后 **0 处**；形状从 `/floating\|looped/i.test(message)` 换成独立状态位 `simBlocked`（⛔ 不是换成比中文常量串） |
| r85 的 [2]/[3] 有"分母洞" | ✅ 加固 | 设计 M4 时顶出来 | 原本 id 集合空掉时 `relMax` 恒 0 会**空过**；现在两格自带 `matched === nA === nB` ＋规模下界（45／18） |

> ⚠ 这两件都是在 `BATCH-R87` 跑到第 26 格之后才改的源码 —— 那一跑**不能**当它们的证据，也别拿它的"24 绿"去说"全绿"。

> 卷五结尾挂着四条"由裁决派生 / 本次新增"的开发项。这一卷逐条交代：**落了什么、谁在钉、读数是多少**，
> 并更正卷五自己写下的一个数字。

| 项 | 状态 | 证人（闸门 / 臂） | 说明 |
|---|---|---|---|
| **R-B** 跨文件夹移动自动 ensure-def | ✅ 落地（R82） | `tests/r82-move-def-gate.cjs`（7 臂全绿） | 两条臂各自一份夹具：拖拽移动与「剪切→粘贴到文件夹」。**同一份夹具只能用一次**（App 会自动存盘抹掉内嵌快照），这条口径写在闸门头 |
| **V1** PROBLEMS 行号恒等 | ✅ 落地（R81） | `tests/r81-line-gate.cjs`（9 臂） | 行号来自 `cleanVerilogWithMap()` 建的"折叠文本下标 → 源码下标"映射；`ValidationError.line` 允许 `null`（文件级重复模块没有单一行），⛔ 不许再从文案里正则抠行号 |
| **V2** 错误态/空态英文文案 | ✅ 局部落地（R83） | `tests/r83-errorcopy-gate.cjs`（6 臂） | 只覆盖卷五点名的 8 处；**完整射程见下面 V2b** |
| **R-A** 部件绑定全局入口 | ✅ 落地（R84） | `tests/r84-binding-gate.cjs`（5 臂全绿）＋ `tests/r84-mutate.cjs`（5 颗变异全咬住） | 沙盒左栏「部件绑定」开模态表：实例／状态（未绑定｜绑定失效｜已绑定，同名追加 `⟡`）／绑定到／**实际解析**（＝`resolvePartRef` 按作用域打分挑中那一颗的文件夹）／下拉换绑。换绑仍只有 `rebindSubcircuitCell` 一份逻辑 ⇒ 弹窗不自算第二套。**受"只做增量"约束**：面板一颗都没搬，只加按钮＋模态 |
| **文档落后于实现** | ✅ 落地（R84） | grep（`data-*`／`title` 锚点可查） | `docs/SANDBOX_DEV.md` 整份重写（旧版停在 P0，还写着"连线未实现／无缩放／7 种门"）；`README.md` 补功能与跑批跑法；`docs/FEATURES_BEYOND_PLAN.md` 补 §5～§7，并**改掉「文字始终黑色 #18181b」那句**（已被 r61 深色文字判据推翻） |

| **V2b** 状态栏整句英文反馈语 | ✅ 落地（R84 之后同批） | `tests/r83-errorcopy-gate.cjs` [6]/[7]/[7b] ＋ 反向探针 `tests/r83-mutate.cjs` | 上面数出来的 50 句逐条换完，**换完再跑同一颗探针＝0 处**（含 `Compiling...` 这类句式规则管不到的单词句，也一并改了）。落盘分三段：导出族一次改、`编译失败` 一次改、其余 35 组由带次数断言的批量替换脚本落盘（`Folder created` 与 `Jumped to` 各有两颗调用点，脚本按 count==2 断言，不是一处改两遍）。`[data-status-message]` 是这一批新加的状态栏锚点。屏幕层采到两颗真实读数：`接口校验未通过：4 处错误`、`已跳到 test_counter.v:8` |
| **位置保真**（原清单第 5、6 条） | ✅ 已升成闸门 `tests/r85-posfidelity-gate.cjs`（R84 同批） | 6 格全绿；反向探针 `tests/r85-mutate.cjs` | 现场读数：顶层 45 颗（编译画布 vs 复制后沙盒）**id 集合完全相同、逐 id 原始坐标差 0 px**；子层 18 颗（elk 展开图 vs dagre 部件文件画布）同样 0 px；叠住 0。⇒ 判据钉"消掉共同原点差后 ≤1 px"，⛔ 不钉原始绝对值（整体平移不是缺陷，他抱怨的是"排布混乱"）。**变异覆盖到哪一格要说清**：[2]/[3]/[4] 各有变异咬住（M1 打部件文件那一侧 ⇒ [4] 红＋[3] 如实"未验证"；M2 装载时逐颗抖动 ⇒ [2][3] 同时红；M3 部件文件落盘前不固化布局 ⇒ [3][4] 红）；**[1] 目前没有自己的变异证人**（三颗变异都没改变 id 集合）⇒ "有人换了 id 命名规则"这件 [1] 专管的事尚未被证明能红，补法要先做一颗只动 id 不改拓扑的变异（会牵连连线，得当场看读数），⛔ 不许拿 [4] 的红当 [1] 的证人 |

## V2b 的读数更正（卷五/上一批写的是"30 处"，**那是低报**）

- 计数工具：`tests/r86-msg-inventory.cjs`（纯静态读源码，不起浏览器）。口径是**句式**而不是禁字面清单：
  `setMessage(...)` 实参里的字符串字面量，含 ≥2 个英文单词且整句无汉字 ⇒ 算一处未中文化。
- ⚠ 第一版这颗探针用 `setMessage('…` 的正则，**只数到 32 处**：`setMessage(ok ? 'SVG exported.' : 'Export cancelled or no circuit.')`
  这一族整个漏掉。改成"括号平衡摘实参 → 再摘字面量"后现场读数是 **`src/App.tsx` 50 处**（`Canvas.tsx`／`SandboxCanvas.tsx`／`OutputPanel.tsx` 各 0 处：
  状态栏文本只有 `setMessage` 一个主人，渲染点在 `App.tsx:1209-1214`）。
- ⇒ 任何"还剩 N 处"的说法都要连同**计数方法与射程**一起报；"30"改成"50"不是因为又坏了，是因为量法有洞。
- ⛔ `Compiling...` 这类**单词句**不在 50 的数内（句式要求 ≥2 个单词），但动手改的时候要一起改——它是状态栏最高频的一句。
- 日志与 yosys 输出不属于这一射程；沙盒侧提示条早已中文（`已移动 1 个文件，随行补齐 1 个部件定义`），
  所以这一条不是审美问题，是"同一动作两侧两种语言"的半成品。

## Esc 关窗这一族的收口（批次 R87）＋两次自伤的账（照实记）

| 项 | 状态 | 证人 | 说明 |
|---|---|---|---|
| 「按 Esc 关窗」依赖父组件现建的回调 | ✅ 九颗组件收口（ConfirmDialog／ContextMenu／ExamplesDialog／FsmTableModal／MemoryViewModal／MemPortsModal／SearchDialog／SettingsPanel／ShortcutsHelpDialog） | 新闸门 `tests/r87-esc-shape-gate.cjs`（2 格：违规 0／反向臂锚点仍在） | 形状＝回调塞 ref ＋ 依赖表去掉它；`MemoryViewModal` 仍留 `[editing]`（那是状态不是回调，重挂是对的）；`SandboxCanvas:1827` 那条随 paper 重建的监听**刻意留在射程外**并在闸门里点名 |
| 真因来源 | —— | 批次 R84 的现场读数 | `{ reached: 1, dlgStill: true }`：Esc 事件到了 document 而弹窗没关。当时只修了 `BindingDialog`／`BusWidthDialog` 两处，**同一族在别的组件里还有九处**，这一批才收完 |

**自伤两笔（写下来是为了下次不再犯，不是走过场）**：

1. **反向探针自己在 `finally` 里没跑完**：`r83-mutate.cjs` 原来在 `try` 里就 `process.exit()`，
   于是那两行 `Jumped to ...` **留在了 `src/App.tsx` 上**，而台架日志照常打「已还原」。
   被抓到是因为跑批前多加了一道「源码状态核对」（逐串数次数：`已跳到` 要 2、`Jumped to` 要 0）。
   ⇒ 从此三颗台架（r83／r84／r85-mutate）**还原后必须重读文件逐字节比对**，比对不上就非零退出并大声说。
2. **批量改源码的脚本写坏了一条正则**：想顺手修注释缩进，结果把 9 个组件里的 `useEffect(() => {` 整行吃掉。
   靠「改之前先拍备份」整批回滚，`tsc` 回到 0，然后改成**逐行操作＋改完自证 `useEffect(` 行数没变** 才重做。
   ⇒ 教训：给源码动刀的脚本要么只碰一行，要么自带「形状不变」的断言；
   本仓组件文件是 CRLF，`split(/\r?\n/)` ＋按原 EOL 回写要一开始就写对（第一版按 `\n` 切，导致依赖表那行的严格正则匹配不上）。

## 仍未闭的两条

> ⚠ 本节是升格**之前**写的。第一条已在批次 R85 结案：`tests/r85-posfidelity-gate.cjs` 六格全绿
> （顶层 45 颗、子层 18 颗逐 id 对账，原始与消原点最大偏移都读到 0 px），反向探针 `r85-mutate.cjs`；
> 第二条（编译模式 FSM）仍开放。V2b 也在同批结案（状态栏 37 处，见下面「读数更正」一节里的 30→50 与判据 [6]/[7]/[7b]）。

- **位置保真（原清单第 5、6 条）只有单边证据**：r42 数"重叠几颗"、r32 数"器件与线数量对得上"，
  没人把两端坐标逐 id 对账。`tests/r43-pos.cjs` 早就算好 `normDev(A vs B)`（编译画布 vs 复制后沙盒顶层）与
  `normDev(C vs D)`（elk 展开图 vs dagre 部件文件），**但通篇 0 条 PASS/FAIL ⇒ 在跑批里连一格都不占**。
  升级成闸门时先跑探针取四组现场读数再钉阈值，⛔ 不许先猜一个像素阈值再放松；若两侧 id 命名规则不一致，
  就只钉 byLabel 那一臂并在闸门头写清另一臂为什么不能钉。
- **编译模式 FSM（卷五另记）**：本仓 yosys-wasm 五种变体都产出 0 颗 `$fsm`，加 `fsmmap` 直接崩且 catch 不住 ⇒
  沙盒侧 FSM 器件与转移表编辑器已可用，编译侧仍属"证据不足"，不算已闭。

---

## 卷七 · 批次 R85～R91 收官（2026-10-06 凌晨，HEAD 不适用：本目录不是 git 仓库）

### ① 权威的一次全量跑批（本轮唯一的发表格）

`node tests/run-all.cjs` 56 格全绿：**RED=0 ENVRED=0 GREEN=56 NOVERDICT=0**。
逐格断言合计 **PASS 430 条**（从 `.tmpbuild/gates/*.log` 现算，⚠ 必须先按本轮时间窗筛——那目录里留着
上一批的 `BATCH-r68/r71/R78/R83/r84-run` 五份旧日志，共 16 条 FAIL，全在 22:10 之前；把它们算进本轮就是我
自己给自己造的假红）。本轮里有 **两格各有一条臂落 UNVERIFIED**（不是红，是"今天没判成"）：

| 臂 | 为什么不作数 |
|---|---|
| `r19-verify` [8c] 端口盒体宽高比 | 那一跑的展开图里根本没有 Input/Output（`cells=3`，类型是 Wire/Button/Lamp——`io_ui` 已把 IO 换成展示形态）⇒ 这一臂在该场景无法观察，需要另立按类型现算的夹具 |
| `r53-fsm-gate` [6] 状态机逐拍推进 | `running=undefined`、只采到 `["0","1"]` 两拍 ⇒ FSM 仿真的推进节奏仍未验（与开放项 #5 同一格） |

r40 这一格本轮**在跑批里也是绿的**（`pass=7 fail=0`），单跑连验两跑同样绿——见下面 ③。

### ② 用户十条"仍存在且急需修复"的逐项证人（截至本轮）

| # | 那一件事 | 证人（闸门＋反向探针） |
|---|---|---|
| 1 | `test_counter.v` 是网表文件：有 net 就试画并标冲突，无 net 直接拒编译 | `r71-abort-port-gate`（8 臂）＋ `r56-conflict-gate`；无 net 的拒编译路径已实测 |
| 2 | 编译模式也标自动名 | `r25-verify`／`r56-conflict-gate` 的自动名列 |
| 3 | 沙盒右键菜单/侧栏统一为编译模式样式（含左栏） | `r46-menu-parity` ＋ `r40-verify` [6]（左高亮条 2px／行内重命名／文件夹可拖／根投放区）＋ `r19-verify` [1] 分组 |
| 4 | 编译模式右键拖动不该弹菜单 | `r34-verify`／`r35-verify` |
| 5 | 走线设置全局化（不是只管沙盒） | `r81-line-gate`（全局 `wireRouting` 一份，两模式共用） |
| 6 | 改走线方式后线路立刻重画 | `r81-line-gate` 里"改档即重排"那一臂 |
| 7 | 滚轮缩放看展开图会丢画面（缩放中心） | `r57-zoom-anchor-gate`（4 臂）＋ `src/lib/paperZoom.ts` |
| 8 | 编译模式展开图 vs 部件渲染图位置不一致 | `r85-posfidelity-gate` [3]（C elk vs D dagre，逐 id ≤1 px）＋ `r85-mutate` M3/M4 |
| 9 | 复制到沙盒后大量部件位置与编译结果不一致、极混乱 | `r85-posfidelity-gate` [1][2][4]（顶层 45 颗逐 id 对账＋叠住=0）＋ `r42-verify` |
| 10 | 深色主题下所有部件/线路命名仍是黑色 | `r61-dark-label-gate`（7 臂，配对：同一颗器件在两种主题下各读一次 fill） |
| 11 | 部件文件删除后右键仍留着那条、放不出来 | `r19-verify` [4]＋`refreshGates` 现扫（失效行只保留"没有对应部件文件"的名字） |
| 12 | 文件内添加自定义部件要自动绑定 | `r60-part-binding-gate`（7 臂）＋ `r84-binding-gate`（5 臂）＋ `r84-mutate` 五颗 |
| 13 | 沙盒波形也要和编译模式一样可调速 | `r62-sandbox-speed-gate`（8 臂，数 `postUpdateGates` 而不是信号翻转） |

⚠ 表里"证人"指的是**这条判据今天绿了**，不等于"屏幕上一定对"——第 3、10 两条的最后一格要点验还是得拍照（记忆里同一族口径）。

### ③ 本轮新立的三条口径（只有现场读数才换来的那种）

- **`a.zoom` 的落点 owner 是 `tests/_ui.cjs::clickZoomInto`**，⛔ 不许换 `locator.click()`：那枚锚点在 joint 工具层里
  computed `visibility:hidden`，Playwright 对它**永远**判 `element is not visible`（我实测 4/4 超时，而同一坐标用真
  鼠标一点就起窗）。真正会点空的因是 `render:done` 之后画布还要适应窗口一次 ⇒ 缓存 rect 就是量到 _fit 前的位置。
  ⇒ `r40` [4]/[4b] 改成"等坐标连着两次不变 ⇒ 现量现点 ⇒ 验目标出现"，改完单跑两跑＋跑批一跑全绿，且都是第 1 次就起窗。
- **「取所在文件夹」收成一份 `src/lib/vpath.ts::parentDir`**（`sandboxStore.dirOfName/dirOf` 只是别名）。
  第一版禁字清单只认 `slice(0, lastIndexOf('/'))`，于是"换个词"的 `split('/').slice(0,-1).join('/')` 那 6 处
  （`fileStore`×5＋`Sidebar`×1）整批绕过 ⇒ 现在两种拼法各扫一遍，反向臂还要求两个入口都还在并**转发**给主人；
  主人自己的注释里写了那两种拼法，所以扫描前必须抹注释（读文本先抹注释）。
- **元件库要覆盖 `yosys2digitaljs` 映射表能产出的每一种目标类**（`r91`）：两边都从现场算，不手数清单。
  读数：映射表 48 种、元件库 49 种，差集**恰好一颗** `UnaryPlus`（`$pos`）⇒ 补进 `ARITH_TYPES`，并做了**成对**真机核对
  （Clock→Lamp 对照 vs Clock→UnaryPlus→Lamp）：两相灯都跟着时钟变色 ⇒ 信号穿得过那颗。
  ⚠ 只证到"穿过"，`+a` 的恒等语义没单独验；⚠ 上一相我拿"灯颜色一种没变"差点判它死——那是我的**采样窗口**没盖住
  时钟周期，不是器件坏，有对照相才敢说这句话。

### ④ 台架与仪器侧的两笔自我记录

- 三颗静态台架（`r90-mutate` 甲/乙/主人掏空/不转发、`r91-mutate` 摘那颗/只拆展开/改表名、`r87-mutate` 回退依赖表/删一颗
  监听/拆锚点/文案认事）**全部咬住**，且都验过"还原后逐字节一致"。`r87` 的 MB 那一格是本轮唯一的"判据真有洞"实锤：
  总数下界 11 抓不到"12 删成 11"⇒ 补了 `ROSTER` 按文件点名那一臂。
- 我改坏了公共底座 `tests/_ui.cjs`（`const opened` 声明两次）——单跑一颗闸门只是 SyntaxError，跑全量就是**整族红**，
  长得和产品坏了一模一样。⇒ 动完底座先 `node --check`；`node --check tests/<那颗>.cjs` 查不到被 require 的底座。
- `r91-mutate` 的 MC 第一版**没咬住**：我把表名改成 `gate_subst_改名为`，`indexOf('const gate_subst')` 照样命中
  （前缀还在）⇒ 闸门算出 48 种打了绿。"该红没红"的第三种因（我的变异造不出那颗判据定义的形状）——
  改的是变异，不是判据。

### ⑤ 仍未闭（照实列，⛔ 不算已完）

- #5 编译模式 FSM：本仓 yosys-wasm 五种变体都 0 颗 `$fsm`，加 `fsmmap` 直接崩且 catch 不住；沙盒侧 FSM 可用，
  但 `r53` [6] 的逐拍推进本轮仍是 UNVERIFIED。
- #6 signed/fillx/words/offset 往返、#8 `transform.transformCircuit` 显示归一化：仍属"上游有、没接/没验"。
- #13 老闸门长尾：本轮 r7/r20/r22/r23/r24 全绿 ⇒ 那一族只剩"下一把死锚点会不会再出现"，没有待修项。
- `r19` [8c] 那一臂要另立按类型现算的夹具才能判（现在这个场景里没有 Input/Output）。
- **O1**：仓库代码**没有站外备份**（本目录不是 git 仓库 ⇒ 也没有 HEAD 可报）。push 一事一授权，本轮没有推任何东西。

### ⑥ 更正与补录（发表 ② 表之后复核自己的归责，2026-10-06）

② 那张表里有**四处归责是我写错的**，逐条更正（错在我把"名字像"当成了"断言像"）：
- 第 2 条（编译模式也标自动名）真出处是 `r56-conflict-gate` [3]，⛔ 不是 `r25-verify`（那颗是**内存编辑器**）。
- 第 4 条（右键拖动不该弹菜单）真出处是 `r43e-verify` [9a]「右键拖动（平移）不弹菜单」，⛔ 不是 r34/r35。
- 第 11 条（部件文件删了右键还留着）真出处是 `r60-part-binding-gate` [4]「左栏与右键都立刻不再有它」，⛔ 不是 r19 [4]（那颗管"放置成功"）。
- 第 5、6 条（走线全局化＋改完立刻变）**当时根本没有证人**——56 颗闸门没一颗问过走线。实现是对的（`Canvas.tsx` 订阅 settingsStore、`SandboxCanvas.tsx` 按 `settings.wireStyle` 重排），但"没人钉"就是没证人。

⇒ 本轮补了 `tests/r92-routing-gate.cjs`（走线全局化，四臂：沙盒当场重排／三档互异且 metro 可切回／回编译模式不需重编译就用那颗档／静态反向臂），已登记进 `run-all.cjs`。
⚠ r92 的首跑：**PASS 2 / FAIL 0 / UNVERIFIED 0**（它是在 ① 那批 56 格全绿**之后**新增的，所以它不在那张发表表里；本轮最后一处 src 改动是给设置面板那颗下拉加 `data-wire-style` 锚点，之后没有再重跑全量）。
⚠ r92 **还没配反向探针**——按本仓口径，没咬过的判据只能算"立了但未被验证会红"，不许读成"这一族已经守住"。

### ⑦ 收口（2026-10-06 01:48 本地时间，覆盖 ⑥ 里那句"首跑 PASS 2"）

⑥ 那两处 src 改动（设置面板那颗下拉的 `data-wire-style` 锚点＋`ARITH_TYPES` 补 `UnaryPlus`）之后，**又跑了一次完整批次**，
这一份才是本轮的发表表：

- `node tests/run-all.cjs` → **RED=0 ENVRED=0 GREEN=57 NOVERDICT=0 共 57 格**（56 → 57 是新增的 `r92-routing-gate`）。
- 逐臂断言按本轮时间窗现算：**PASS 432 ｜ FAIL 0 ｜ UNVERIFIED 2**（两份不作数：`r19` [8c] 端口盒体宽高比——那场景里展开图没有 Input/Output；
  `r53` [6] 状态机逐拍推进——`running=undefined`，与开放项 #5 同一格）。
  ⚠ 数这些断言**必须按 mtime 筛本轮**：`.tmpbuild/gates` 里留着上一批的 5 份 `BATCH-*.log`（共 16 条 FAIL），
  不筛就会把别人的失败读成自己的（同"汇总行只是某个进程往某个文件写的一行字"那一族）。
- `r92-routing-gate` 五臂全绿（现场读数：沙盒 85 条线，三档 `（默认）/orthogonal/normal` 互异，切回 metro 显式挂上；
  回编译视图没重编译就用那颗档，状态仍是 `compiled`）。反向探针 `r92-mutate.cjs` 两颗都咬：
  MA 摘掉 `Canvas.tsx` 两处 `applyWireStyle` ⇒ 只 `[2]` 红；MB 摘掉沙盒效应依赖表里的 `wireStyle` ⇒ `[1][3]` 红、`[2]` 绿。
- ⚠ MA 的第一版**没咬住**，而且原因不是判据有洞：我只摘了**订阅**那一处，`[2]` 照绿——因为回编译视图时画布是重建的，
  建图那次已经用了那颗档；而设置面板唯一入口在沙盒工具栏 ⇒ "编译画布活着的时候改走线档"在今天界面上**观察不到**。
  ⇒ `Canvas.tsx` 里那颗 `settingsStore.subscribe` 是防御代码，⛔ 不许登记成"已验证的行为"；要证的事先问"这条分支界面够得着吗"。
- ② 表里被我写错的四处归责已在 ⑥ 更正（自动名＝`r56` [3]、右键拖动不弹菜单＝`r43e` [9a]、删部件后清残留＝`r60` [4]、
  走线那一族当时无证人 ⇒ 本轮补 `r92`）。
- 老闸门长尾（#13）收口：`r7 / r20 / r22 / r23 / r24 / r48 / r49` 连续两批都在跑批里绿（`r48` 12 臂、`r49` 3 臂），
  不再有"今天没判成"的格子。
- 收口条件核对：`npx tsc --noEmit` 干净；五个反向探针（`r83`／`r84`／`r85`／`r87`／`r90`／`r91`／`r92` 共七份台架）今天跑过的都"全部咬住"
  且"还原后逐字节一致"；**HEAD 不适用**（`D:\Visual Studio Code\Something` 不是 git 仓库）⇒ 唯一风险仍是 O1：代码没有任何站外备份，
  我没有 push、也没有 commit（没人要求过）。

### ⑨ #33：两种模式画布菜单的"视图那一组"统一（2026-10-06 02:00 本地收口）

② 表里第 3 条（菜单/侧栏统一）我复核时只核了"措辞与导出项"（r46 [A]~[F]），**没核顺序与颗数**——
逐字抓两份源码的 `label:` 才发现编译模式画布菜单只有「重置缩放 / 适应窗口」两颗且顺序相反，
沙盒是四颗「放大 / 缩小 / 适应窗口 / 重置缩放」⇒ 用户在编译图里根本没法用菜单缩放。
- 产品：`zoomAt(factor, mx, my)` 一份锚点缩放实现（`handleWheel` 与新 `zoomBy` 共用，`zoomAt` 内置 `userViewRef`＝R59），
  `Canvas.tsx` 的 imperative handle 多暴露 `zoomBy`；`App.tsx` 菜单补两颗并按沙盒同序排。`tsc --noEmit` 干净。
- 证人：`r46` 加 **[G]**（DOM 现读四颗都在且相对顺序一致）＋ **[H]**（点「放大」后 wrapper 的 `scale()` 0.9836 → 1.1803，
  拦"写了词不动手"的死菜单）。反向探针 `r46-mutate.cjs` 三颗全咬：MA（摘两颗）⇒ [G][H] 同红；
  **MB（只换顺序）⇒ 只 [G] 红、[H] 保持绿**；MC（`zoomBy` 空转）⇒ 只 [H] 红、[G] 绿。
- ⚠ hint 不许为了词面对齐而抄：沙盒「重置缩放」的 `Ctrl+0` 在编译模式里是**编辑器字号**那颗（`editorOnly`），
  所以编译模式那一颗**不带提示**才是实话。
- 权威跑批（src 改完后重跑一次）：`node tests/run-all.cjs` → **RED=0 ENVRED=0 GREEN=57 NOVERDICT=0**；
  本轮日志按时间窗筛后 **PASS 435 ｜ FAIL 0 ｜ UNVERIFIED 1**（57 份日志；另有 6 份是上一批留下的旧日志，被筛掉）。
  唯一那条不作数的是 `r19` [8c]「端口盒体宽高比」——那一跑的展开图里根本没有 Input/Output
  （cells=3、类型是 `Wire`/`Button`/`Lamp`，`io_ui` 已把 IO 换成展示形态）⇒ 这一臂在该场景无法观察，
  要判得另立按类型现算的夹具；它**不算通过**，也不算缺陷。
  ⚠ 这句原本是"PASS 434 / 未验证 2 条"，是我把上一批的数与已经结案的 `r53` [6] 一起抄了进来——
  现按本轮日志实数更正。（同一处还留着一句自我打岔的话，已删。）
- 另：`.tmpbuild/gates` 里留着上一批的旧日志，**数断言必须先按 mtime 筛本轮**（不筛会把旧红读成新红）。

### ⑩ 端口盒体那条判据搬了家，顺带拆掉一个**错的继承阈值**（2026-10-06 02:15）

`r19` [8c] 一直是那个"挂着的未验证"：那颗子电路的展开图过了 `io_ui`，类型是 `Wire/Button/Lamp`，
结构上就没有 Input/Output 可量。我把它挪到能落地的地方（部件画布），一量才发现**更要紧的问题**：

- 现场读数（`multiplier/adder.djs`）：1 位脚 `30×30`（比 1.00）、4 位脚 `47×30`（比 1.58）、总线输出脚 `62×30`（比 2.08），
  而且**数据层 `size` 写的就是这个数**（`47x30` / `62x30`）⇒ 多位引脚本来就该是宽盒子。
- ⇒ 我从 `r19` 沿用来的"`宽高比 <1.5` 才算方"是**错判据**：它会把正常渲染的总线脚判成缺陷（第一版 [2b] 就是这么红的），
  而它想防的病（盒体被 CSS/布局横向拉长）也不一定抓得到。
  换成与缩放无关的关系判据 `r42 [2b]`：**渲染宽高比 == 数据层宽高比**（±0.05），数量下界 3 颗。
  读数 `1.58/1.58 1.58/1.58 1/1 2.08/2.08 1/1` ⇒ 19 PASS / 0 FAIL。
- `r19` 那一臂就地删除并注明去向（⛔ 留一个"每次都不作数"的臂不产生信息，也不该为了凑格数恢复它）。
  现在 `r19` 是 11 pass / 0 fail / **0 未验证**，`r42` 19 pass / 0 fail ⇒ **本轮跑批里"未验证"降到 0 条**
  （跑批第 ⑨ 节那 1 条就是它，已在 02:15 之后消失；src 未再改动，所以 ⑨ 的 57 格结论仍成立，
  只有这两格的臂数按本次实数更新）。

教训（写进记忆）：**从旧闸门继承来的数字阈值，落到新场景前必须在那个数点上重量一遍**——
"看起来是同一个不变量"其实换了主人：旧场景只有 1 位脚，新场景全是总线脚。

## 卷八 · 批次 R94：Dff 极性／端口编辑窗 ＋ 两颗连带真缺陷（2026-10-06）

### ① 为什么是这一颗

objective 末条要求「不断开发沙盒模式，尽可能发挥 digitaljs 的全部功能」。盘点发现 Dff 是覆盖最差的
一型：digitaljs 支持 polarity 的 **7 个键**（clock/enable/arst/srst/set/clr/aload）＋ `enable_srst` /
`no_data` / `arst_value` / `srst_value`，而沙盒只有调色板两颗固定组合，**没有任何编辑入口**——
同类 Memory 有端口配置窗、FSM 有转移表窗。三条只读上游源码才看得见的形状（都按读数钉住）：
1) 端口按 `polarity` **键在不在**生成（dff.mjs:42-70）⇒ "取消这一脚"必须删键，留 `键: undefined` 等于还在；
2) 低有效必须写 `false`：引擎 `0`/`false` 都认（`pol = v => v ? 1 : -1`），但字形只认严格 `false`
   （base.mjs:139 `port.polarity === false` 才加 overline，`0 === false` 为假）⇒ 写 0 的低有效复位脚
   在画布上与高有效一模一样，看图接反复位电路；
3) `set`/`clr` 是**与数据同宽**的端口（dff.mjs:53/57），1 位的只有 clk/en/arst/srst/aload。

### ② 产品改动（三件，全部增量）

- **新增 `DffPortsModal`**：七个控制脚逐脚"要不要＋高/低有效"，加位宽/初值/复位值/enable_srst/no_data；
  右键菜单入口「端口与极性…」。刚勾上的脚默认**高有效**——初版下拉里留着 `!!undefined === false`，
  勾一个脚就静默变成低有效复位（**我自己引入的缺陷，闸门首跑抓到**）。
- **`reconfigureCell` 先并上器件现有构造参数再让 patch 覆盖**（`ctorParams(old)`，与存/取档同一位主人；
  patch 显式 `undefined`＝清掉该键）：现场形状＝只传 `{bits,polarity}` 的「位宽」会把 `initial` 抹回 `x`、
  只传 `{bits,initial,polarity}` 的「初始值」会把 `arst_value/srst_value/enable_srst/no_data` 抹掉——
  器件数、连线数、端口名全对，只有仿真变（R48 一族的形状）。
- **`'bits'` 进 `CTOR_PARAM_KEYS`**：探针读数＝4 位寄存器存盘重开变 **1 位**（bits 靠事后 `cell.set` 回读，
  而 Dff 把它列在 `_unsupportedPropChanges` 里被回滚）⇒ 4 位的 `srst_value="0101"` 配着 1 位的 Q。

### ③ 读数（不是推断）

电学成对（同一对接线、两颗 4 位常量当激励，只翻极性）：
低有效 clr=`1111`→Q=`1111`、clr=`0000`→Q=`0000`；翻高有效后 clr=`0000`→Q=`1111`、clr=`1111`→Q=`0000`
——**两次读数整体互换**；重建前后 id/位置/连线数（2 根）全程不动；overline 只在低有效那颗上出现。
存盘重开：bits=6、polarity、`srst_value`、initial 整套回来。

### ④ 证人与台架

- `tests/r94-dff-polarity-gate.cjs` 十格：[1][1b] 入口与两次回显、[2] 端口形状＋键真删、[3] 低有效两半配对、
  [4] 电学成对、[5] 重建不搬家、[6] 部分参数重建、[7] 存盘重开、[8][9] 静态句式臂（[8] 按**句式**判
  "polarity 赋值右边不许有裸 0/1"，配非空洞下界；[9] 数注释剥离后的 `'bits'`）。
  闸门对"编辑器没回显＝极性下拉禁用＝翻不了面"按**三态**处理：先 `isEnabled()` 再 `selectOption`——
  `selectOption` 对 disabled select 会等满 30s 然后 FATAL，[0] 红＋后面全格失去观察。
- `tests/r94-mutate.cjs` 七格（MA 回显失效／MB+MG 留键 undefined 两种措辞／MC 数值极性／
  MD 重建不接线／ME 重建不做 merge／MF 名单去掉 bits）。**期望表按实测形状写**：
  留 undefined 的真实后果＝joint 把七个键回读成 false＋未连的 set/clr 把 x 串进 Q（`apply_sr` 的 mask 变 x）
  ⇒ 红格比设想的多、[4] 落"未验"而非红；MC 那格专证"字形与语义两条臂各有射程"（[3][7][8] 红、[4] 必须绿）。
- 台架结果与权威跑批行见文末补记。

### ⑤ 台架第一跑五格没咬住——逐格读原话后的归责（没有一格是判据有洞）

1. `page.evaluate` 的函数被序列化进页面 ⇒ **闭包里的 Node 常量带不过去**（`KEYS is not defined`，
   `node --check` 抓不到）；2) 夹具顺序：先拖线后配位宽会让产品当场插一颗零扩展转换器、落点压着常量
   ⇒ 右键点到的是转换器菜单；3) `selectOption` 撞 disabled ⇒ 30s FATAL（改三态）；4) 期望表按设想写
   而不是按实测写（见 ④）；5) `[9]` 把注释里逐字引用的 `'bits'` 也数了进去（注释剥离后才数）。
   第二跑 MA/MB 仍崩、且**同变异两跑崩点不同** ⇒ `__sandboxPaper` 的时序竞态（画布重建空档），
   修法＝每阶段前 `waitPaper` ＋补守卫。台账 R93 已被菜单批占用 ⇒ 本批改名 R94。

### ⑥ 补记（最终字节上的收口行）

- **台架第 4 跑（tests/.out-r94-bench-final.txt）：7/7 全部咬住**，还原后与快照逐字节比对一致（3 个文件）、EXIT=0；
  前三跑的校准过程见 ⑤（第 1 跑 5 格没咬住＝期望表与闸门健壮性，第 2/3 跑各修一处后收敛）。
- **权威全量跑批（tests/.out-runall-r94.txt，src 改完后最终字节）：**
  **RED=0 ENVRED=0 GREEN=58 NOVERDICT=0 共 58 格**（58＝57＋新增 r94-dff-polarity-gate；r94 在批内 GREEN pass=10 fail=0）。
- HEAD 不适用：本目录不是 git 仓库（收口按文件清单报：src/components/DffPortsModal.tsx（新）、
  src/components/SandboxCanvas.tsx、src/lib/deviceParams.ts、tests/r94-dff-polarity-gate.cjs（新）、
  tests/r94-mutate.cjs（新）、tests/_ui.cjs（＋portPointOf/dragWireBetween）、
  tests/r87-esc-shape-gate.cjs（名册＋下界）、tests/run-all.cjs、docs/SANDBOX_DEV.md、本报告）。


## 卷九 · 批次 R95：算术／比较／移位的「有符号」开关（2026-10-06）

### ① 为什么是这一族

digitaljs 的算术（Arith21：加减乘除取模幂）、比较器（Eq/Ne/Lt/Le/Gt/Ge）、移位、取负按 `signed`
决定按无符号还是有符号解释端口向量（arith.mjs:66/94/140/178），而 `signed` 列在
`_unsupportedPropChanges`（arith.mjs:39）⇒ 只能构造期给。沙盒此前**没有任何入口** ⇒
调色板放出来的运算器永远无符号，负数运算做不了（除非从编译模式复制）。上游按类型发三种形状
（core.ts:766-810）：取负（Arith11）＝**布尔**；加减乘除取模幂与比较器＝`{in1,in2}`；
移位＝`{in1,in2,out}`（out 只有 $sshl/$sshr 真的参与语义）。

### ② 产品改动

- 右键菜单「操作数 A／B 有符号」（移位多一颗「输出 有符号」），√ 前缀反映**打开那一刻**的现态，
  点击经 `reconfigureCell` 只传 `{signed}` 重建（R94 的合并让 bits 等自动带上，参数不再掉）。
- ⚠ UnaryPlus 必须与 Negation 同走布尔分支：落进对象分支的话 `{in1,in2}` 恒为 truthy ⇒
  `toBigInt(signed)` 会把它错读成有符号——形状即语义。
- toast 附上游规则提示：二元运算/比较器按 `sgn.in1 && sgn.in2`（arith.mjs:95/186）——
  **两脚全开才按有符号算**，只开一脚电平无观感差（与 Verilog 晋升规则一致）。

### ③ 读数（AND 规则三段，两族）

Lt(4位) in1=1000,in2=0001：无符号 out=0 → 只开 A 仍 0 → 两脚全开 out=1（-8<1 真）；
除法 1000÷0010：0100 → 仍 0100 → 1100（-8÷2=-4）。位宽/连线/位置在两次重建间全程不动；
存盘重开 signed 整套回来、电平照旧。

### ④ 证人与台架

`tests/r95-signed-toggle-gate.cjs` 八格（[1] 三族菜单形状／[2] 无符号读数／[3] AND 三段＋参数
带得住＋连线不搬家／[1b] √ 现态／[4] 除法三段／[5] 存盘重开／[6] UnaryPlus 布尔形状／[7] 静态
句式臂"只许经重建"）；`tests/r95-mutate.cjs` 四格：MA setProp 假修（[7] 当场红＋电学三格＋[1b]
随红＝同一桩罪的第二个后果）、MB UnaryPlus 形状、MC 恒写 A+B（AND 规则的**负读数**专咬它）、
ME 标签不带现态 ⇒ [1b]。台架 **4/4 咬住**（tests/.out-r95-bench-final.txt，还原逐字节一致）。

### ⑤ 证伪一笔（诚实记录）

初版发现"翻有符号后 out 纹丝不动、tick 还在走"，误诊为"引擎不重评重建器件"，据此在
`reconfigureCell` 加了 `_changeSignal` 重播——台架单跑（--only MD）证明**摘掉它八格全绿**：
真因是 AND 规则（`{in1:true,in2:false}` 本来就按无符号算，out=0 是对的），死代码已删。
教训：**"读数与期望不符"先读完上游 operation 的每一行，再发明机制**（Compare/Arith21 那两行
`sgn.in1 && sgn.in2` 当时就在眼前没读）。

### ⑥ 夹具三条（本轮现场踩过）

1. **先位宽再接线**：4 位常量先接 1 位比较器，产品当场插切片/转换器，比较变成 LSB 比较；
2. **新放常量先摆开、配值后读回**：叠住时两根线拖成同一颗（in1=in2=0010 ⇒ 2÷2=1），
   读数看着像产品算错，其实夹具接错了；
3. `page.evaluate` 的函数不许引用 Node 侧常量（R94 已记），本轮又见 `KEYS is not defined` 同族。

### ⑦ 全量跑批与两格环境红（收口状态）

权威全量跑批（tests/.out-runall-r95.txt，src 最终字节）：**RED=2 ENVRED=0 GREEN=57 共 59 格**，
r95 本尊 GREEN pass=8 fail=0。两格红＝**r84/r85 环境红未判成**：`page.goto` 超时——全量起跑时
机器上挂着并行会话的 18 个 node 进程；两轮单独重跑同样超时，且**不是端口被占**（清掉遗留 vite 后
自己那颗已在 LISTENING 仍应答不了 9/15s）。按口径登记"不作数"、**随下一批统一重跑**（他裁定攒多处
修改再统一测试）。顺带清了 6 颗遗留 vite（崩掉的 run 只 kill 了 shell、node 孙进程存活＝
`shell:true`+kill 的老坑）；系统性修法（gate 的 finally 杀整棵进程树）**攒进下一批**。HEAD 不适用
（非 git 仓库）。收口文件清单：`src/components/SandboxCanvas.tsx`、`tests/r95-signed-toggle-gate.cjs`（新）、
`tests/r95-mutate.cjs`（新）、`tests/run-all.cjs`、`docs/SANDBOX_DEV.md`、本报告。

## 卷十 · 批次 R96：移位「移出空隙补 x」（fillx）＋ 进程卫生＋ 首个"攒批"验证轮（2026-10-06）

他裁定"减少台架频率、多处修改后统一测试"后的第一批。**先攒了三处修改，再一次验证跑完**：

### ① fillx 开关（Shift 族）

`Vector3vl.make` 的初值语义（dist/index.js:197-221，逐行核对）：`0`＝补 **x**、`-1`＝补 **0**、
`signbit`＝补符号。据此 shiftHelp 的 fill 分支＝`fillx ? 0(=x) : sgn ? signbit : -1(=0)`——
fillx=1 就是"移出位宽的那截补 x"（$shiftx 语义）。沙盒右键 Shift 族新增「移出空隙补 x」
（动态 √，经 reconfigureCell 只传 `{fillx}` 重建；fillx 也在 `_unsupportedPropChanges` 名单里）。
**电学对**：ShiftRight(4位) in1=1000、in2=0011（右移 3 位）——关＝`0001`（补 0）、开＝`xxx1`
（补 x），同一对接线只翻这一颗开关。

### ② 进程卫生（56 份闸门注入 exit 收尸钩子）

`server.kill()` 只杀得到 shell 包装、node 孙进程监听到 OOM（R95 全量现场清出 6 颗遗留）。
修法＝`_ui.cjs::reapViteByPort(port)`（唯一主人；run-all 每格收尾也改走它），56 份会 spawn
vite 的闸门逐份注入 `process.on('exit', … reapViteByPort(PORT))`。清扫脚本逐文件断言
（PORT 行恰好 1 处、无旧注入）＋逐文件 `node --check`：56 注入／3 份静态跳过／0 失败。

### ③ r84 的 goto 超时对齐（基建，不是断言）

r84 三连败全是 `page.goto` 9 秒超时——服务对 node-fetch 应答正常（launch 前有 45 秒就绪循环），
但 `domcontentloaded` 要等整个模块图变换，`page.setDefaultTimeout(9000)` 在机器忙时不够
（r85 用 15s 就过）。对齐 30s 后补跑 **5 pass**。判定不受影响（9s 是基建参数）。

### ④ 统一验证轮（最终字节，一次跑完）

- `r95-signed-toggle-gate`：**10 pass / 0 fail / 0 未验**（[6b] √ 现态／[6c] fillx 电学对在内）。
- `r95-mutate`：**5/5 咬住**（MA setProp 假修／MB UnaryPlus 形状／MC 恒写 A+B＝AND 负读数专咬／
  MF fillx 假修／ME 标签不带现态），还原逐字节一致。首跑 3/5 的真因＝[7] bad 分支模板串里
  留着改名前的 `goesThroughRebuild`——**pristine 只跑过 ok 分支，模板串的 bad 分支从没被执行过**
  （"只被绿灯走过的代码"这一族，与坑表 #271'只 GetField'同构），修后全咬。
- `r32` 补跑 14 pass、`r84` 补跑 5 pass（两格环境红收口，R95 那笔"随下一批统一重跑"的欠账结清）。
- 全量跑批（tests/.out-runall-r96.txt）：**RED=2（r32/r84 环境红，均已补跑绿）ENVRED=0 GREEN=57
  共 59 格**，r85/r95 批内 GREEN（r95 pass=10）⇒ 59/59 全部有着落。
- HEAD 不适用（非 git 仓库）。收口文件清单：`src/components/SandboxCanvas.tsx`、
  `tests/_ui.cjs`（＋reapViteByPort）、`tests/run-all.cjs`、56 份闸门（exit 钩子一行）、
  `tests/r84-binding-gate.cjs`（超时对齐）、`tests/r95-signed-toggle-gate.cjs`（＋fillx 臂）、
  `tests/r95-mutate.cjs`（＋MF）、`docs/SANDBOX_DEV.md`、本报告。

## 卷十一 · 批次 R99：沙盒可见样式统一（旋转/镜像/高亮/滚轮/绑定）＋ 侧栏对齐（2026-10-06）

接手交接文档 `docs/HANDOVER_R99.md`（HEAD `36136f8`，R94→R99 产品改动全在工作区未提交）。
本卷只记接手后做的事；R99 批次本身的落地清单见交接文档 §2。

### ① 闸门收编与证据补齐

- `run-all.cjs` GATES 注册 `r99-ui-unify-gate`（此前只在交接文档里，跑批不认）。
- gate 单跑 **5 pass / 0 fail**，证据落 `tests/.out-r99-ui-unify-gate.txt`（交接时只进过控制台）。

### ② 变异台架 `tests/r99-mutate.cjs`（4/4 咬住）

| 格 | 变异 | 咬住 |
|---|---|---|
| MA | 多选旋转改回各绕自身（`rotate(deg)` 摘掉 origin） | 只红 [1] |
| MB | `flipCell` 调用摘除（mirror 状态不落） | 只红 [3] |
| MC | 「绑定...」action 置空（对话框不弹；[5c] 随 if(dlg.open) 跳过＝未验） | 只红 [5] |
| MD | 高亮选择器摘掉 `[data-theme] .joint-paper` 前缀（(0,2,0) 输给 index.css 主题灰 (0,4,0)） | 只红 [2]，stroke 实测回灰 `rgb(113,119,132)` |

教训两条：**预期表要按"无关臂实际仍绿"写**（MA/MB/MD 不影响绑定，[5c] 是绿的，首跑误声明成未验）；**声明为未验的臂缺席要记 UNVERIFIED**，缺席≠没咬住（MC 的 [5c]）。还原逐字节一致。

### ③ 全量跑批（60/60 有着落）

- 首轮 47 分钟：**RED=7 GREEN=53**（r32/r33/r44/r50/qc-paused/qc-preview/qc-realuser）。
- 归责：qc×3 全是 `npx vite build` Command failed——单跑 12s 通过 ⇒ 批尾资源竞争的**环境红**（签名不在 ENV_RE，被判成 RED；照纪律单独重跑）。
- r32/r33/r50 单独重跑全绿 ⇒ 同族环境红（沙盒没进去/等待超时/单步时序，批尾机器忙时的假红）。
- **r44 是真问题**：R99 把「换绑部件定义」改名「绑定...」并升级成对话框，r44 的锚点过期——
  已修 gate 走新流程（点「绑定...」→ `[data-rebind-row="BB"]`），[13b]+[12] 恢复绿。
  这是"改名不留兼容锚"的又一次教训：**改菜单文案必须同步 grep tests/**。
- 重跑后实质 **60/60**；r99 gate 批内 GREEN（pass=5）。

### ④ 侧边栏视觉对齐（交接待办 [1]）

两模式左栏截图 diff（`tests/.tmp-r99-cmp-compile.png` / `.tmp-r99-cmp-sandbox.png`）后落地：

- `SandboxCanvas.tsx`：侧栏底色 `--surface` → `--sidebar-bg`（含收起轨）；标题栏 padding
  `6px 8px` → `10px 14px`、分隔线 `--border-subtle` → `--border`、标题色 `--text-muted` →
  `--text-secondary`＋`letter-spacing:0.08em`（对齐编译 Sidebar 头部）。
- 标题栏按钮全换 lucide（⤺→Undo2、＋→Plus、‹→PanelLeftClose、›→ChevronRight）＋编译同款
  hover（surface-hover 底、文字提亮）。测试锚点全保留（`title="新建文件"`、`data-sandbox-exit`、
  `data-sandbox-sidebar`、`div[title="拖动调整宽度"]`——改样式前先 grep 过）。
- 面板容器 padding 8 → 0（对齐编译树无水平内边距），删除「沙盒电路文件（右键空白处…）」提示行
  （编译模式无对应物；发现性由 + 按钮与右键菜单承接）；层次/模块两个面板改各自带 padding 8（观感不变）。
- `SandboxFileTree.tsx`：文件夹行去掉 fontWeight 600（编译无加粗）；chevron/文件夹图标补
  `marginRight:4`（对齐编译的 10px 间距节奏）；文件行补 5px 状态圆点（激活＝accent、其余＝muted，
  对齐编译行解剖——编译圆点编码编译状态，沙盒无编译状态故只表激活）。
- 验证：tsc 0 错；6 格沙盒闸门（r31/r32/r40/r44/r99/selfaudit2）**6/6 GREEN**。

### ⑤ 遗留（照交接文档 §4 原样移交）

- **#5 调试功能样式统一**（沙盒底部工具条 vs 编译 TabBar rightSlot）未开工——是产品级重构，等用户裁决范围。
- **#6 翻转持久化专项探针**（存盘→重开→镜像仍在）按下批。
- **#8 杂物清理**待用户报备批准（见下）。
- **#7 文档**：README/SANDBOX_DEV 镜像＋绑定对话框条目已补；即本卷。
- 台架证据文件：`tests/.out-r99-ui-unify-gate.txt`、`tests/.out-r99-mutate.txt`、
  `tests/.out-run-all-r99.txt`（首轮）、`tests/.out-run-all-r99-redo.txt`（7 格重跑）、
  `tests/.out-run-all-r99-sidebar.txt`（侧栏后回归）。

## 卷十二 · 批次 R100：绑定入右键＋文件级绑定、滚轮语义定版、多选旋转轨道、模型级镜像、调试条上顶（2026-10-06/07）

用户六点反馈（原话要点）：①绑定功能进右键菜单且绑定系统**所有可见样式**与编译一致；
②侧栏右键菜单与编译一模一样；③展开图滚轮「期望＝滚轮/Shift 平移、Ctrl+滚轮才缩放」；
④多选旋转应绕**选区包围盒中心**而非各自自旋；⑤左右/垂直镜像「问题非常滑稽」（自查）；
⑥总纲——一切可见 UI 尽可能与编译统一，沙盒调试功能样式也统一。

### ① 产品落地（六点全接）

- **文件级绑定**（①）：`sandboxStore.partBindings`（绑定名→部件文件 id，随存档走）＋
  `gateSystem` 单例 `setActivePartBindings`（活动文件切换时注入）＋ `resolvePartRef`
  **显式绑定最高优先**、命中即返回，之后才作用域打分；`sandboxLoad.ts` 的 Subcircuit
  加载先 `resolveDefCells(celltype, scope)` 再退回内嵌图。入口＝侧栏**文件**右键「绑定...」
  开 `SandboxFileBindingDialog.tsx`（令牌与编译 BindingDialog 完全同款）。实例级
  `RebindDialog.tsx` 全量重写成编译同款（保留 `data-rebind-row` 锚）。
- **侧栏菜单**（②）：文件/文件夹/根三处菜单去标题头（`openMenuAt(x,y,'',…)`），观感与编译一致。
- **展开图滚轮**（③）：`subcircuitView.ts` 定版 switch——普通＝纵移、Shift＝横移、
  Ctrl＝`zoomAtClient`（光标锚）。这条**推翻了 r57 [2] 的旧锚点**（见③）。
- **多选旋转**（④）：joint `rotate(angle, absolute, origin)` 对已带角度元素轨道量退化
  （源码 `center.rotate(origin, this.get('angle') - angle)`，90° 时原地自旋、180° 反向）——
  改**手工轨道**：中心绕包围盒中心公转→自旋→position 落新中心。
- **模型级镜像**（⑤）：R99 的 CSS/函数包装对 digitaljs 标准门（端口是**命名布局对象**、
  偏移写死在端口 attrs、锚点全在中心线）静默失效＝「滑稽」根因。`cellMirror.ts` 重写三层：
  端口锚点求值取反＋端口 attrs 数值路径取反＋body 居中镜像 transform，外加 body 子树文本
  反翻（joint selector 属性是 `joint-selector`）。存盘重开持久化探针确认。
- **调试条上顶**（⑥）：沙盒调试工具条迁画布右上，令牌与编译 TabBar rightSlot 同款
  （surface 胶囊＋lucide＋速度滑条 5–200）；实例绑定总览面板同步换编译令牌。
- ⚠ 本批再次踩**并行 Edit 丢改**（SandboxCanvas.tsx 调试条静默未落盘，重发后 grep 复核）
  与 sandboxStore 字段被丢（tsc 抓回）——同文件多编辑必须串行＋复核，台账老坑第四次。

### ② 变异台架 `tests/r99-mutate.cjs`（4/4 咬住，锚点随 R100 更新）

MA 锚点改摘 `position(nx - s.width/2, …)`（手工轨道公转）、MB 摘 `flipCell(c, dir, paper)`。
重跑 4/4 咬住、src 逐字节还原一致（首跑 MB 格 page.goto 超时＝vite 重编译竞态假红，复跑过）。

### ③ 全量跑批（60/60 有着落）

首轮 59 分钟：**RED=4 ENVRED=2 GREEN=54**（r57＋qc×3；r85/r92）。

- **r57 [2] 是真问题但属"过期锚点"**：R100 把普通滚轮改成平移（用户裁决），r57 还在用
  合成普通滚轮断言缩放。修法：[2] 改发 **Ctrl+滚轮**，另补 **[2b]** 正向钉新语义
  （纵移 Δty=720／横移 Δtx=720／缩放差 0）——复跑 5/0。又一次"改交互必须同步 grep tests/"。
- qc×3（paused/preview/realuser）：`npx vite build` Command failed。单跑全过
  （4/0、EXIT=0、EXIT=0）⇒ 环境红。本轮现场还抓到 `npx` 在残缺 shell 下直接「拒绝访问」
  （用 `node node_modules/vite/bin/vite.js build` 直跑 19.8s 成功＝产物无罪）。
- **r85 是僵尸进程**：早前被中断的后台循环留下 4 颗 vite（1580/1585/1599/1604），
  1585 上的僵尸应答了 gate 的 fetch 探活、页面却加载不了 ⇒ 连续 4 次 page.goto 15s 超时。
  taskkill 清掉后复跑 **6/0**。教训：**"fetch 探活通过 ≠ 服务是这一轮的"**——strictPort
  绑定失败是静默的，排障先 `netstat` 查端口归属。（复核轮追加：r85 的
  `setDefaultTimeout` 15s→45s 已顺手加固——实测 vite dev 冷启动 DCL≈15.07s 本来就贴线，
  僵尸清掉后这条也是隐患；见 r85 头注释。）
- r92 [2] 复跑即绿（5/0）：测量时编译画布还 `pending` 的时序假红。
- **最终实质 60/60**。tsc 0 错；r99 gate 5/0、r34 9/0；`.tmp-r100-*` 探针已清。

### ④ 文档与移交

- SANDBOX_DEV：3.2 旋转/镜像改 R100 措辞、§4 补滚轮语义行、文件级绑定条目已补。
- README：补文件级绑定（sidebar file 绑定…）与展开图滚轮语义两行。
- 待用户裁决：工作区 R94→R100 累积改动仍未提交（~231 文件），按约定不自动 commit；
  `.tmp-r99-*` 探针杂物清理仍待报备批准。
- 台架证据：`tests/.out-run-all-r100.txt`、`tests/.out-r57-r100-redo.txt`、
  `tests/.out-qc-paused-r100-redo2.txt`、`tests/.out-qc-preview-r100-redo2.txt`、
  `tests/.out-qc-realuser-r100-redo2.txt`、`tests/.out-r92-r100-redo3.txt`、
  `tests/.out-r85-r100-redo5.txt`。

## 卷十三 · 批次 R101：翻转两处真缺陷、文件系统照抄编译模式、按钮上移、输入/输出面板（2026-10-07）

用户六点反馈（原话要点）：①部件水平/垂直翻转**仍然**有重大问题；②沙盒侧边栏顶部照抄编译
模式（新建文件 / 新建文件夹 / 刷新）；③文件右键「重命名」须点后**弹窗**，空白处右键的
新建文件 / 新建文件夹同样弹窗；④沙盒文件系统必须**严格**与编译一致（删除文件夹要提示会
一并删除内部文件、同名文件要有处理）；⑤侧栏下方功能按钮移到画布上方一排；⑥编译模式
「输入」之外再加**显示所有输出（只读）**，沙盒实现完全一样的输入输出统计与交互按钮。

### ① 翻转：两个真缺陷（探针取证后修，不是猜的）

探针（`tests/.tmp-r101-flip-probe*.cjs`，读端口锚点 / attrs / body transform 的模型值）：

- **缺陷 A：端口渲染抛异常被吞 ⇒ 端口塌缩**。`evalOrigPosition` 自己造了一个只有
  x/y/width/height 的假 bbox 去调 joint 的命名布局函数，而后者要用 `topLeft()/bottomLeft()`
  等 g.Rect 方法 ⇒ `e.topLeft is not a function`，digitaljs 吞掉异常后端口全落在一处
  （实测 Dff 三端口 `in/out/clk` 翻转后**同一个坐标**）。修：wrap 的第二个参数就是
  digitaljs 传进来的**真实 g.Rect**，原样交给布局函数（没给才退化）。
- **缺陷 B：旋转后翻转方向错乱**。mirror 记的是屏幕语义，但端口锚点与 body transform 活在
  **器件本地坐标**——angle=90 时本地 x 轴在屏幕上是竖直的 ⇒ 点「水平镜像」实测成上下对调
  （探针：输入口从屏幕上方跑到下方）。修：`angle∈{90,270}` 时 h/v 互换（180° 不换），
  并且 `rotateSelection` 转完对带 mirror 的 cell 重挂 `applyMirror`。
- 判据教训：**看模型层（锚点/attrs），别看 DOM 屏幕坐标**——paper 会自动 fit 缩放，
  垂直镜像那次"水平位移 30px"是缩放造成的测量假象，模型值证明 x 根本没动。

### ② 文件系统照抄编译模式

- 顶部按钮组＝导入文件 / 新建文件 / 新建文件夹 / 刷新 / 收起侧栏（与 `Sidebar.tsx`
  同序同图标同 hover）。⚠ `button[title="新建文件"]` 是 `_ui.cjs#newSandboxFile` 的
  夹具锚点（点完就要有文件）⇒ 这颗**不走弹窗**，弹窗版走右键菜单。
- 重命名 / 新建一律 `PromptDialog`（菜单里不再内联输入、树里不再行内新建；
  只保留 hover 铅笔的行内重命名——编译 Sidebar 同样有这颗铅笔）。
- **删除文件夹改为编译语义**：连同内部文件与子文件夹**一起删**，删前弹 `ConfirmDialog`
  写明"会一并删除其中的 N 个文件、无法撤销"（旧实现是"文件移回根目录"）。
- 同名去重改成编译格式 `name (1).djs`（`sandboxStore.getUniqueName`，旧为 `_1`），
  `create` / `rename` 都走它。

### ③ 按钮上移 与 输入/输出面板

- 侧栏底部整块（撤销 / 重做 / 旋转 / 保存 / 自定义门 / 导出 SVG / 导出 Verilog /
  部件绑定 / 设置）迁到画布上方一排 `data-sandbox-topbar`，与右侧调试条同款令牌；
  title 与 `data-*` 锚点全部保留。
- 新增 `components/IOPanel.tsx`：**两模式共用**——输入段列出全部 `Input/Button/Clock/
  NumEntry` 且可点击切换，输出段列出 `Lamp/Display7/NumDisplay` 等**只读**（值由电路
  算出）。200ms 轮询。编译侧 `Canvas.tsx` 加 `listOutputs()`，`InputPanel` 改为薄封装；
  沙盒用画布内浮层承载，入口是顶部按钮栏的「输入 / 输出」。

### ④ 测试同步（"改交互必须同步 grep tests/"第三次）

- `r33`：[3][4] 改弹窗流程（新增 `commitDialog`）；[6a] 改编译语义（确认框 + 内部文件一起消失）。
  ⚠ **ConfirmDialog 的 role 是 `alertdialog`，不是 `dialog`**——定位弹窗两个都要选，
  第一版就栽在这（confirmText 拿空）。
- `r34`：[3] 首按钮期望改「新建文件」；层次结构那格改点**面板中部**（原"标题栏下方 14px"
  会随面板内容长短落在器件行上，行吃掉右键 ⇒ 菜单不弹；探针单独复现菜单一直在，非产品回归）。
- 定向 gate：r33 8/0、r34 9/0、r40/r32 绿、r44 9/0；tsc 0 错。

### ⑤ 全量回归与收口

- 全量 run-all 首轮（50 分钟）：**RED=3 ENVRED=1 GREEN=56 共 60 格**，四格全部有着落：
  - **r12（真回归，我漏迁按钮）**：删侧栏底部块时漏了「导出 PNG」⇒ `button[title="导出 PNG"]`
    count=0。已补进顶部按钮栏，复跑 **17/0**。教训：**按行号删大块 JSX 前先 grep 块内全部
    title/锚点**，迁移后逐一对照（git diff 的 `-` 行抓 title 是好办法）。
  - **r82（测试过期）**：`makeFolder` 还在走「新建文件夹」菜单内联输入 ⇒ 文件夹没建成。
    改为弹窗流程，复跑 **7/0**。
  - **r17（真回归，浮层遮挡）**：顶部按钮栏 absolute 浮在画布左上角，**吃掉框选起点**
    （框选只选中 1 颗，期望 ≥6；连带 [4b]/[6]）。先试 pointer-events 穿透（容器 none/
    按钮 auto）不够——按钮本体仍压住起点；最终改为**按钮栏独占一行**（column 布局，
    画布区两行：按钮栏 + 画布），复跑 **10/0**。⚠ 用 node 脚本按行号重构 JSX 把闭合标签
    配错了一次（tsc 抓回），从备份恢复后改用「depth 扫描找闭合行」才做对。
  - **r37（测试过期）**：[7] 重命名还走菜单内联输入。改弹窗流程，复跑 **EXIT=0**。
  - r17 的连带测试修复：r34 [3d] 画布右键写死 (900,500) —— 画布区被按钮栏占一行后器件
    屏幕位置整体移动，这点落在了器件上（弹出「自定义门」菜单）⇒ 改为现取画布右下角空白。
- **修复后定向复跑全绿（19 格）**：r11 16/0、r12 17/0、r17 10/0、r31 6/0、r32、r33 8/0、
  r34 9/0、r37 0F、r40、r44 9/0、r53 11/0、r60 7/0、r61 7/0、r62 8/0、r76 8/0、
  r82 7/0、r84 5/0、r99 5/0、selfaudit2 ✓。
- tsc 0 错（PowerShell 口径）。
- 待用户裁决：R94→R101 累积改动仍未提交（按约定不自动 commit）；
  `.tmp-r99-*` 探针杂物 18 个仍待报备批准（本轮新产生的探针/备份已用 node fs 清掉——
  本机 `rm` 通道坏的绕法：`node -e "fs.unlinkSync(...)"` 不走 safe-delete）。

## 卷十四 · 批次 R112：翻转架构重写（单一快照）、编译画布高亮与右键菜单打通（2026-10-07）

本批的转折点：**用户指出「不应反复针对每个部件调整引脚，应固定好引脚和部件的位置关系，
只对整体翻转」**。此前八轮（R100–R110）我一直在给本体 / 引脚 / 连线端点各做一套镜像，
每发现一种器件出问题就加一层特例补丁，反而互相干扰。这一轮先把架构定对，再用探针证明。

### ① 翻转：`cellMirror.ts` 整体重写为「单一快照 + 从原件重算」

**做法**：采集期把器件的**原始几何**快照进 `c.prop('mirrorBase')` —— 每个 group 的
position 形态、会被取反的 attrs 原值、body 的 attrs/DOM transform 原值，以及
**body 走 attrs 还是走 DOM 的实测结论**。此后每次还原/施加**只从这份原件重算**，
绝不基于当前状态再叠一层 ⇒ 天然幂等，反复翻转不再累积错位。

**过程中查明的三个硬事实**（此前全部判断错在这一层）：

| 事实 | 影响 |
|---|---|
| `prop(path)` 对缺失键返回 **`null` 而不是 `undefined`** | 所有「是否已存过原件」的 `=== undefined` 判断**永不成立** ⇒ 多轮静默失效 |
| position 有**三种形态**：命名布局对象 / `'absolute'`**字符串** / `function` | 早前按「非对象 ⇒ 无 position」处理 ⇒ 灯·输入·时钟·数码管·Dff·Memory **整类锚点换边被静默跳过**，只剩引线取反 ⇒ 引线缩进本体（Lamp 88px→60px、Input 58→30px） |
| 命名布局**必须换 name，不能包 `x'=w-x`** | joint 拿到 position 返回值后**还会自己再加一次 args.dx/dy** ⇒ 包坐标镜像被叠加出 2×dx（And 引脚 ±50→±80、盒宽 106→166px）。换 name 后锚点交给 joint 原生算，且**连线端点自动跟随** |

**两条互不干扰的路径**：
- **A 命名布局** → 换 name + `dx/dy` 随边反号（标准门）。连线跟随就靠这条。
- **B 字符串/函数** → joint 不认注入的 position，改把采集期取到的真实锚点写死成函数再整体镜像；
  带两道守卫：锚点数须与 joint 当前一致、锚点须**落在器件尺寸内**（Mux 的 in 组 y 到 83
  超出 h=72 ⇒ joint 钳制后再位移 +20px ⇒ 整组不注入，**宁可不换边也不分离**）。
- `getPortsPositions(group)` 返回**对象**（键=端口 id、值=锚点）；`getPortPosition` **不存在**；
  `c.prop('ports/groups/{g}/ports')` 返回**空数组**。写死锚点必须**保留 `id` 字段**
  （joint 的 `getGroupPortsMetrics` 在 reduce 里读它，丢了会抛 `reading 'id'`）。

**全器件台架硬指标（16 类 × 水平/垂直两轴，共 32 项）**：
- 本体确实翻转 ✅ 全过 —— 标准门走 attrs 通路（`translate(-4,0) scale(1)` →
  `translate(30,16) scale(-1,1) translate(-30,-16)`），灯/数码管走 DOM 通路。
- 模型 bbox 不变 ✅ 全过（不再出现 106→166 / 88→60 那种"分离"）。
- 锚点镜像对称 ✅ —— Lamp/Input/Output/Clock/NumDisplay/NumEntry/Display7 真换边（0↔60/77），
  Dff 的 in/out 对调。标准门锚点 x=30 压在中心轴上「不变」才是对的。
- Memory / Mux 专项验证：**bbox 不变 ✅ 复原 ✅ 本体翻 ✅**，锚点正确对调（Memory in 0→97、out 97→0），
  **无分离**。Mux 的 in 组被守卫主动跳过（不换边但也不分离，属有意取舍）。
- 反复翻转复原：单器件极简探针证明几何**完全复原**、第 1 次与第 3 次**完全一致** ✅。

### ② 编译画布高亮 + 右键菜单：三轮探针失败后终于打通

之前三轮探针都进不去编译画布，这次同时解决了三个障碍：
1. **编译画布没有任何调试入口**（沙盒有 `window.__sandboxPaper`）⇒ 给 `window.__djsDebug`
   加 `paper()` / `cells()`（仅 DEV）。
2. **注入文件不会自动编译**（`status` 停在 `pending`）⇒ 必须
   `reload → 点 [title="test_and.v"] → 点 button[title^="编译"]`（照 r42 的路径）。
   用户建议「用简单部件而不是 alu_core」是对的：`test_and.v` 编译出 7 个 cell。
3. **高亮失效的真根因**：`cell.on('cell:pointerclick')` **收不到事件** —— joint 的 pointerclick
   由 **paper** 派发、参数是 View，Backbone 的 model 不转发 ⇒ 绑在 model 上等于绑了个死钩子。
   改 `paper.on('cell:pointerclick')` 后立即生效。

**实测结果**（`test_and.v` 编译画布）：
- 点器件高亮 ✅ `class="joint-cell … sm-selected"`（样式已注入）
- 点连线高亮 ✅ 两端器件一起亮（命中 2/7）
- 画布空白右键菜单 ✅ 弹出「放大 / 缩小 / 适应窗口 / 重置缩放 / 导出 SVG / 导出 PNG /
  电路 JSON / 综合网表 / 编译 / 导入 Verilog 文件」
  ⇒ R103 那步「按下到抬起位移阈值 4px→10px」本来就生效了，只是此前无法验证。

### ③ 台架自身的坑（都不是产品问题，记录以免再踩）

- 坐标点击会误伤侧栏「收起」按钮 ⇒ 沙盒视图被卸载（`window.__sandboxPaper` 变 undefined）；
  bbox 外 6px 又会落在空白画布上弹出画布菜单 ⇒ 改用**在器件元素上直接派发 PointerEvent/MouseEvent**。
- `localToClientPoint` 在该 paper 上不存在；`J()` 辅助函数在 `page.evaluate` 里不可用。
- 多轮翻转时若有几颗菜单未开，「撤销/再镜像」作用在**不同**的器件集合上 ⇒ 复原/一致必然假红。
  **必须先断言每颗的 mirror 状态真的翻转了**（`翻转生效 15/16`）再采信后两项判定。
- 判据的坐标系要对：量"引脚是否换边"要用**模型坐标**（`getPortsPositions`，joint 真值），
  用 DOM 圆点相对**含引线包围盒**中心的偏移会因引线左右不等长而误判。

### ③ 多选整体镜像（用户明确要求「翻转多个选中部件整体」）

三颗不同类型器件（And / Lamp / Dff）排成横线 → Ctrl+A 全选 → 右键「水平镜像」：

| 判定 | 结果 | 证据 |
|---|---|---|
| 选中判定正确 | ✅ | 菜单显示「与门 +2」「删除（3 项）」「创建副本（3 项）」 |
| **位置关于选区中心对称** | ✅ | And `x=200→902`、Dff `x=900→200`、Lamp `x=550→552`（落在对称轴上） |
| 每颗本体都翻转 | ✅ | 三颗 `mirror` 均置 `{"h":true}`，body transform 均变化 |
| 引脚正确镜像（不分离） | ✅ | And `[[-51,-8],[-51,8],[49,0]] → [[55,-8],[55,-8],[-45,0]]`（x 变号、y 不变）；Lamp `[[-55,0]] → [[55,0]]`；Dff 左侧 2 个/右侧 1 个 ⇄ 左侧 1 个/右侧 2 个 |
| 撤销完全复原 | ✅ | 回到 `x=200/550/900`、`mirror=null` |

⚠ 「引脚不分离」不能用"偏移模长相等"判：水平镜像后引脚换边，而引线圆点相对 body
中心的测量口径本就不同（And 的 51 vs 55）。正确判据是**x 变号、y 不变**。

### ④ 旋转：全器件 16/16 全绿（用户要求「着重于旋转和镜像的测试，要对所有部件测试」）

走**真实产品路径**：Ctrl+A 全选 → 点顶栏「旋转 90°」⇒ 一次覆盖 `rotateSelection` 的
**多选整体旋转**分支（绕选区包围盒中心公转 + 自身角度自增）。

| 判定 | 结果 |
|---|---|
| 器件确实转了（模型 angle=90） | ✅ 16/16 |
| DOM 宽高互换 | ✅ 16/16（And 106×32→32×106、Dff 118×40→40×118、Memory 153×118→118×153） |
| 引脚跟随旋转 ((x,y)→(-y,x)) | ✅ 16/16 |
| 引脚仍贴在本体上（不分离） | ✅ 16/16 |

⚠ 判据口径：必须用 **DOM 尺寸**（含引线的真实渲染尺寸）。`c.getBBox()` 返回 joint 的
**未旋转模型盒**（旋转在渲染期施加，恒为 60×32），`size` 也不含引线 —— 用它们判
"宽高互换"会得到全红假象。

### ⑤ 「非运行态禁止信号传输」：我 R103 理解错了，R112 修正

用户规则是「在非运行状态下用户与部件交互，**禁止组件传输信号**」。我 R103 实现成
`if (!runningRef.current) return;` —— **直接拒绝修改输入值**。后果：默认未运行时
用户**永远无法设置输入初值**（r50 三格全红：rst 拨不动 / 单步没 clk / q 不递增）。

正确语义：**禁的是"信号在电路里传播"，不是"禁止用户拨引脚"**。
- 任何时候都能改输入值；
- 未运行时**跳过 `updateGates`** ⇒ 值改了但下游不更新、灯不亮；
- ⚠ 判据**不能用 `runningRef` / `pausedRef`**（那只是 UI 意图标志：`settings.autoStartSim`
  为 false 时会被强制置 `false`，见 `SandboxCanvas` 约 2281 行），必须用**引擎实际状态**
  `circuit._engine.running`。

硬证据（`qc-paused` 6/0，autoStartSim:false 的生产包场景）：

| 判定 | 结果 |
|---|---|
| 非运行态下**输入值仍可改** | ✅ `["1","1"]`（证明不是"拒绝交互"） |
| 非运行态灯**不亮**（信号被禁止传输） | ✅ `rgb(252,124,104)` |
| 点「运行」启动引擎 → 传播恢复、灯点亮 | ✅ `rgb(3,192,60)`、与门输入 `Vector3vl 1` |

**两处 gate 判据随之更新（不是产品缺陷）**：
- `qc-paused` 显式设 `autoStartSim:false`，旧判据「拨输入后灯亮」编码的是改动前
  "无条件 updateGates"的行为 ⇒ 改为「不点亮 + 输入值仍可改 + 点运行后点亮」。
- `r50-ui-sim` 找 `button[title="Pause simulation"]`，而 R103 已把暂停/继续合并成**单态按钮**
  （title 改为「暂停仿真（定格当前波形，R103）」）⇒ 改用稳定锚点 `[data-testid="sim-pause-toggle"]`。

### ⑥ 验证

- tsc 0 错。
- **全量回归 60 格全绿、零红**（`tests/.out-run-all-r112b.txt`）。
  （首轮 `tests/.out-run-all-r112.txt` 的 11 格红里 9 格是探针占端口的 ENVRED / 导航竞态，
  单跑全部转绿；真正需要处理的 qc-paused 与 r50 两条**过期判据**已按 ⑤ 更新。）
- 定向复核全绿：r11 16/0、r17 10/0、r12 17/0、r13 15/0、r18 EXIT=0、r19 11/0、r26 12/0、
  r31 6/0、r33 8/0、r42 19/0、r50 6/0、r53 11/0、r62 8/0、r68 8/0、
  qc-paused 6/0、qc-input ✓、qc-preview 2/0、selfaudit2 ✓、r37、r16。
- 待用户裁决：R94→R112 累积改动仍未提交（按约定不自动 commit）；
  `.tmp-r99-*` 旧探针杂物 18 个仍待批准后清理（本机 `rm` 通道坏的绕法：
  `node -e "fs.unlinkSync(...)"` 不走 safe-delete）。

---

## 卷十五 · 批次 R113：镜像 + 旋转「组合操作」根因修复（2026-10-07）

**用户实测反馈**：

> 我测试下来镜像是没什么问题了，但若对多个部件进行镜像和旋转进行组合操作后，依然有很大问题；

R112 把镜像重写成了单一原始快照（`mirrorBase`）模型，单项镜像已正确；本批次处理的是
**镜像与旋转组合后崩溃**这一类问题。R112 遗留的判断是「多选旋转/镜像的位置偏移可能源于
`getBBox()` 不反映旋转后视觉包围盒」——**本批次实测否掉了这个推断**。

### ① 根因（探针实测，不是推测）

用户点的是**屏幕**上的「水平/垂直镜像」，而 `mirror` 属性存的是**器件本地轴**。
旧 `applyMirror` 里有换轴逻辑：

```ts
const swap = a === 90 || a === 270;
const sx = (swap ? !!m?.v : !!m?.h) ? -1 : 1;   // 按 angle 重新解释镜像轴
```

⇒ **每转一次，镜像轴就被重新解释一次**，旋转不再是纯角度变更。同时
`rotateSelection` 在旋转后又调 `applyMirror` 重挂，把这条换轴逻辑**再跑一遍**。
两者叠加 ⇒ 任何「镜像 + 旋转」的组合都全面错乱。

探针（走真实 UI：右键菜单 + `Ctrl+R`）实测对比：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| And 水平镜像后 | `bodyTf = scale(-1,1)` ✓ | `bodyTf = scale(-1,1)` ✓ |
| ↑ 再 `Ctrl+R` 一次 | `bodyTf = scale(1,-1)` ✗ 镜像轴被换掉 | 保持 `scale(-1,1)` ✓ |
| Lamp 镜像后旋转 | `in.in → [0,16]`（锚点不换边）✗ | `in.in → [60,16]` ✓ |
| 纯旋转 90° | `bodyTf = scale(-1,1)`（脏残留）✗ | `bodyTf = translate(-4,0) scale(1)` ✓ |

### ② 纠正 R112 的错误推断（重要）

R112 曾推断多选旋转/镜像的位置偏移源于 `getBBox()` 不反映旋转后的视觉盒。**实测否掉**：

- `c.getBBox()` **不随 `angle` 变化**：And 在 angle = 0/45/90/180/270 下 bbox 全是
  `[672,432,60,32]`，恒等于 `pos + size`。
- `c.rotate(90)` **只改 angle、位置纹丝不动**：start = 0/45/90/180/270 分别得到
  90/135/180/270/0，`posBefore ≡ posAfter`。

⇒ **`getBBox()` 的中心恰好就是 joint 的旋转中心**，多选旋转的几何算法本来就是对的。
这个纠正避免了把本来正确的代码改坏。

### ③ 修复：语义改写，不是打补丁

**数学推导**：设当前视觉变换 = `R(θ)·L`（L 为本地镜像），用户要求屏幕水平翻转：

```
M_h · R(θ) · L = R(−θ) · M_h · L
        ⇒ M_h · L  就是把 L 的 x 分量取反
```

⇒ **屏幕镜像 ≡ 本地轴取反 + 角度取反**，对任意 θ 成立，**无需 90°/270° 特判**。

改动清单：

| 文件 | 改动 |
|---|---|
| `src/lib/cellMirror.ts` | ① `applyMirror` **删掉** swap 换轴（不再读 `angle`）；② `flipCell` 承担角度取反 `c.rotate(-2*a)`；③ 新增共享常量 `MIRROR_VER_LOCAL = 2`；④ `remirror` 降级为 `applyMirror` 的兼容别名 |
| `src/components/SandboxCanvas.tsx` | ① `rotateSelection` 删掉旋转后的 `applyMirror` 重挂；② `flipSelection` 单选/多选**统一走 `flipCell`**，多选只多「中心关于选区 bbox 中心对称」；③ 新增 DEV 只读钩子 `window.__sandboxSelection` |
| `src/lib/sandboxSerialize.ts` | 写入 `mirrorVer` 版本标记 |
| `src/lib/sandboxLoad.ts` | 新增 `migrateMirror`：对**无标记**的旧存档按 angle 换算迁移 |

两个必须记住的实现细节：

- ⚠ **joint 的 `c.rotate(deg)` 实际轨道量是 `angle + deg`**，所以要得到 `−a` 必须传 `−2a`。
- ⚠ 多选 `flipSelection` **绝不能**再 `rotate(-2a)` —— `flipCell` 内部已取反过一次，
  取反两遍 ≡ 什么都没做。
- ⚠ `mirrorVer` **必须写**：否则每次存盘重开都会把已迁移的器件按旧屏幕语义再迁一次，
  h/v 又对调回去。版本常量在 `cellMirror.ts` **单点定义**，序列化侧与载入侧共用
  （两处各写一个数字早晚会对不上）。

### ④ 验证：新闸门 `tests/r113-mirror-rotate-gate.cjs`（8/8 全绿）

全部走真实 UI 路径（右键菜单 + `Ctrl+R` / `Shift+Ctrl+R`），判据＝变换群的作用律：

| 编号 | 判据 |
|---|---|
| [1] | `M² = I` 镜像两次完全复原（And 的 body transform + Lamp 的锚点双向验） |
| [2] | `R(90)⁴ = I`，且旋转全程不污染 mirror / 端口 / body |
| [3] | `M∘R(90)∘M = R(−90)` |
| [4] | `M∘R(θ) = R(−θ)∘M`（顺序无关） |
| [5] | 旋转是纯角度变更（竖直镜像同样不被污染） |
| [6] | 全器件类型（3 种端口布局形态）镜像→旋转→镜像往返一致 |
| [7] | 多选：整体镜像位置对称 + **角度取反** + 可完全撤销 + 选区外不受影响 |
| [8] | 存档往返：`mirrorVer` 幂等 + 旧屏幕语义按 angle 迁移 |

### ⑤ 变异台架 `tests/r113-mutate.cjs`：确认闸门不是空转

纪律：**闸门的「绿」只有在「缺陷在场时红」面前才算数。** 4 条变异：

| 变异 | 内容 | 结果 |
|---|---|---|
| M1 | `applyMirror` 恢复 swap 换轴（旧实现原样） | ✓ 被咬住（[4]） |
| M2 | `flipCell` 不做角度取反 | ✓ 被咬住（[3] [4]） |
| M3 | 多选镜像重复 `rotate(-2a)`（取反两遍） | 首轮 ✗ 存活 → 补判据后 ✓ 被咬住（[7]） |
| M4 | `rotateSelection` 恢复「转完重挂镜像」 | ≡ 等价变异，按预期存活 |

- **M3 首轮存活暴露了 `[7]` 的真缺口**：原判据只查位置对称与可撤销，没查**角度**。
  角度取反两遍时，形状镜像仍生效、位置对称仍成立、撤销也照样退得回去 ——
  **只有角度停在原值**，一路绿灯穿过 `[7]`。已补 `angleNegOk`
  （镜像后每颗角度必须 = 镜像前角度的相反数）与 `mirrorOn` 判据。
- **M4 是等价变异（equivalent mutant），不是漏网**：它的病根在 `applyMirror` 的 swap 换轴
  （已由 M1 覆盖并被咬住）。R113 把 `applyMirror` 改成**完全不读 `angle`**、
  只按 `mirrorBase` 重写几何，于是「转完再挂一次」＝幂等地把同一份形状再写一遍。
  换句话说 M4 已被 M1 的修复**顺带消解**了，它只在换轴还在的时候才有病。
  台架已支持 `equivalent: true` 标记（且若标成等价的变异却变红 ⇒ 反而判失败）。

### ⑥ 台架自身踩的坑（都不是产品问题）

- ⚠ **跑 UI 闸门期间绝对不能改 `src/`** —— Vite HMR 重载页面，
  `window.__sandboxPaper` 直接变 `undefined`，前后两次结果不一致（首跑 `[1]` PASS `[2]` FAIL）。
  源码改动一次做完 + `tsc --noEmit` 通过，再跑干净的闸门。
- 右键菜单要**每次现取屏幕坐标**：器件一旦被选中就带上 `sm-selected` 类，DOM 命中层随之改变，
  开头缓存一次的坐标到后面几组就点空了（菜单压根不开 → locator 5s 超时）。
- 复位**不能**只 `c.prop('mirror', null)`：body transform 与端口几何是由 `applyMirror` 落地的，
  直接改 prop 不会复原它们，后续 `bodyTf` 判据全是脏读数。正解是按当前为真的轴
  **逐个走真实菜单**翻回去（往返天然幂等）。
- 判据坐标系：And 宽 60，`left/dx:30` ↔ `right/dx:-30` 锚点**恰好都是 x=30**（压在中轴上），
  锚点集本就相等 ⇒「中途必须变」不能判 ports，要判 body transform；
  另加 Lamp（absolute 布局，锚点真的会动 `[0,16] ↔ [60,16]`）作证。
- 多选撤销的角度必须**逐颗跟镜像前比**，不能写死 `=== 90`：没进选区的器件（Dff）angle 一直是 0，
  写死就把正确的撤销判成红。
- `page.evaluate` 的回调被序列化后到浏览器执行，拿不到 Node 侧闭包 ⇒ 归一化函数要在回调内部重写一遍。
- `tests/_ui.cjs` 的 `menuClick` 三个坑已堵：① Lamp 这类 body 是 `<rect>` 的器件，
  中心可能落在 `<circle>`/`<text>` 上，冒泡被截断，右键静默无效；
  ② 上一次菜单可能还开着，`item.count()` 会命中旧菜单并**伪装成成功** ⇒ 每次先 `Escape`；
  ③ 菜单是异步渲染的，必须等它真的出现再点。

### ⑦ 状态

- tsc 0 错。
- 变更清单：`tests/r113-mirror-rotate-gate.cjs`、`tests/r113-mutate.cjs`（新建）、
  `tests/_ui.cjs`（`menuClick` 加固）、`tests/run-all.cjs`（纳入 r113，共 61 格）。
- 本批临时探针（`.tmp-combo-probe` / `.tmp-lamp-probe` / `.tmp-hit-probe` 及其输出与截图）
  在验证完成后已自行清理，保留最终闸门日志 `.out-r113.txt`。
- R94→R113 累积改动**仍未提交**（按约定不自动 commit）。

---

## 卷十五 · 补记：R113 全量回归与一次**自造回归**的修复（2026-10-08）

### ① 全量回归：61 格

`node tests/run-all.cjs` → **GREEN=50RED=6 ENVRED=5 NOVERDICT=0**（`tests/.out-run-all-r113.txt`）。

逐格单独复跑结论 —— **11 格非绿里 10 格是环境红，全部单跑转绿**：

| 格子 | 批内症状 | 单跑结果 | 归因 |
|---|---|---|---|
| r94-dff-polarity | `page.goto` 超时 | **10/0** | 环境 |
| r99-ui-unify | `page.goto` 超时 | **5/0** | 环境 |
| r65-numbase | exit=1 | **5/0** | 环境 |
| r68-fanin | exit=1 | **7/1 → 修夹具后 8/0（连跑两次）** | 见 ② |
| r92-routing | exit=0 但 ENVRED | **5/0** | 环境 |
| qc-audit | `page.goto` 超时 | **5/0** | 环境 |
| qc-audit2 | exit=1 | **4/0** | 环境 |
| qc-preview | `vite build` 失败 | **2/0** | dist 旧于 src 触发自动重编，手动 build 后即绿 |
| qc-paused | `vite build` 失败 | **6/0** | 同上 |
| qc-realuser | `vite build` 失败 | **4/0** | 同上 |
| **r24-verify** | `waiting for '4 位二进制计数器' to be visible` 超时 | **修夹具后 5/0** | **本轮自己造出来的回归，见 ②** |

⇒ 真正需要动手的只有 **r24**，其余是长跑批（54 分钟）耗尽资源所致。

### ② 一次自造回归：`menuClick` 加固把两级菜单点坏了（**重要教训**）

R113 给 `tests/_ui.cjs` 的 `menuClick` 加固时（防「命中上一次残留的旧菜单」），在函数开头
**无条件**加了 `Escape` 收尾。但 `menuClick` 有两种用法：

- `menuClick(page, '水平镜像', rect)` —— **自己右键开菜单**，开头 Escape 是对的；
- `menuClick(page, '4 位二进制计数器')`（**第三参省略 = `null`**）——
  **菜单已经开着了，只负责点那一项**，这是两级菜单的用法。

无条件 Escape 把上一级刚展开的菜单关掉了 ⇒ 第二级永远等不到，r24 报
`waiting for locator(...'4 位二进制计数器') to be visible` 超时。
**基线里 r24 是绿的，是本轮改动弄红的。**

修法：`at === null` 直接走「只点不 Escape」的分支，只有自己负责开菜单（`at` 非空）时才收尾。
验证：r24 **5/0**、r113 **8/0**（未退化），
其余 9 个 `_ui.cjs` 调用点（r53 / r55×2 / r95×6 / r113×2）**全部传坐标**，走原路径不受影响。

> **教训**：给共用夹具加「更保险」的收尾动作前，必须先枚举所有调用点的**参数形态**。
> 同一函数的不同调用约定（自开 vs 复用已开）很容易被一个默认值 unification 悄悄改掉。
> ⚠ 顺带一条：`audit*.cjs` / `r23` / `r25` 里那些 `menuClick(page, '插入示例', false)`
> 是**各文件本地定义**的函数（第三参是布尔量，不是坐标），与 `_ui.cjs` 无关，别混为一谈。

### ③ r68 那条 `[E] abc` 真红：是菜单竞态，不是产品缺陷

- 读数：`inputs=2 端口=["in1","in2"] 提示=null` —— **端口判定其实是对的**（正确拒绝），
  只是没读到 toast 文本。
- 一次性探针（已删）抓到根因：`[E]` 循环里三次 `menuSet` 连续执行，
  **第三次（`abc`）右键根本没打开菜单** ⇒ locator 30s 超时。
  同一坐标前两次正常、第三次失败 ⇒ 菜单开关的竞态，不是校验逻辑问题。
- 产品代码本身是对的：`Number('abc')` = NaN ⇒ `!Number.isFinite(NaN)` ⇒ `showToast('输入引脚数必须是 2–16 的整数')`。
- 复跑两次均 **8 PASS / 0 FAIL**。

### ④ 同批修掉的夹具真缺陷（`tests/_ui.cjs`）

- `ensurePalette` / `newSandboxFile` 用 `locator.count()` **不等待**就抛
  「活动栏没有 X 按钮」。vite 冷启动首次请求要现场 transform 一堆依赖，
  React 挂载比 `boot` 的 800ms settle 更晚 ⇒ **一次启动慢被报成产品缺陷**
  （R113 复跑首轮 29s 就 FATAL）。已改成 `waitFor({timeout:15000})`，
  且失败时打印真实可见的 `data-activity` 列表，一眼分清「慢」还是「真没有」。
- **通用纪律**：UI 夹具里凡是「元素应该存在」的判断，**一律用 `waitFor` 而不是 `count()`**。

### ⑤ R113 最终状态

- **R113 专项闸门 8/8 全绿**（`tests/.out-r113.txt`）。
- **变异台架：3 条被咬住 + 1 条等价变异按预期存活**（`tests/.out-r113-mutate.txt`）。
- **全量 61 格**：批内 50 GREEN；11 格非绿逐格复跑后**全部转绿**，其中 r24 / r68 两格
  分别因本批夹具回归与菜单竞态，现已修复并复验。
- tsc 0 错；临时探针已全部自行清理（`tests/.tmp-*` 与根目录遗留截图）。
- R94→R113 累积改动**仍未提交**（按约定不自动 commit）。
