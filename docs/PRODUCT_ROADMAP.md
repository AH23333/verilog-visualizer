# Verilog Visualizer — 产品演进路线（PRODUCT ROADMAP）

> 文档性质：产品路线决策与落地排期（基于 2026-10-20 实仓核查）
> 适用范围：当前 `verilog-visualizer` 仓库（`D:\Visual Studio Code\Something\verilog-visualizer`）
> 关联文档：`AGENT_ARCH_DECISION.md`、`CLI_PLAN.md`、`MIGRATION_VSCODE.md`、`REAL_HOST_E2E.md`、`API_REFERENCE.md`、`PROJECT_DEEP_REVIEW_2026-10-05.md`

---

## 0. 问题背景

项目已完成"统一调用层（toolRegistry 单执行器 + 37 工具 API）"与"真机测试层"的搭建，并收工于一个重要阶段。当前面临产品形态决策：已有四条候选路线——

- **A. VS Code 套壳完整 IDE**：自带 VS Code 源码分支，出独立二进制
- **B. VS Code 插件**：上架 Marketplace 的标准扩展
- **C. 仅 MCP 项目**：纯 agent 后端，无 GUI
- **D. OpenCode 套壳 CLI**：命令行 + agent 入口

本报告结论：**四条路线不是互斥的四选一，而是"一个核心引擎 + 双轨包装 + agent 叠加面"的树状结构。** 下文所有判断均基于本轮对实仓的直接核查数据，而非凭记忆。

---

## 1. 核心结论（TL;DR）

```
                 ┌─────────────────────────────────────────────┐
                 │  核心引擎：toolRegistry 单执行器 + 37 工具 API │
                 │  （surfaces: ui / rpc / mcp / cli，契约一致）   │
                 └───────────────────┬─────────────────────────┘
                                     │ 同一份 extension/ 代码
                  ┌──────────────────┴──────────────────┐
                  ▼                                     ▼
        A. fork 品牌二进制（旗舰）              B. Marketplace 插件（触达/验证）
        studio/ + 独立 VS Code 源码分支          标准扩展，宿主中立
                  └──────────────┬──────────────┘
                                ▼
              C. MCP 服务 + D. OpenCode CLI（agent 叠加面，零/低成本）
```

- **主产品卖点** = 交互式电路画布（digitaljs custom editor）+ 原生 VS Code 体验（§0b 三块移植）。该卖点**当前只活在 A 路线**；B 路线要等 §0b 做完才名副其实。
- **不要**让 C/D 当主产品——抽掉画布等于自废武功。C/D 只是"让人和 agent 都能调同一套工具"的叠加面。
- A 与 B **共用同一份移植后的 `extension/` 代码**，可并行发货，不互斥。

---

## 2. 四条路线再评估（实仓核查事实）

### A. VS Code 套壳完整 IDE（fork 二进制）
- `studio/` 已存在：`apply-brand.mjs`、`gen-nls-dev.mjs`、`product.overrides.json`；基座为独立的 VS Code 源码 checkout（`D:\vv-studio\vscode`，Code - OSS 1.143.0）。
- 已实跑通：`.build/electron/Verilog Visualizer.exe`（**239,129,088 字节**），内置扩展激活自动弹画布。
- 代价：**持续性维护**——fork rebase 跟上游、Electron 安全补丁、商标约束（`apply-brand` 即为此）。
- 状态：`README` 明确"目标形态＝自带 VS Code 源码分支、出独立二进制"；但 §0b 的"原生 Outline/TreeView、`.djs` 成真文档"移植在 README 中仍为 **⬜ 未完成**。

### B. VS Code 插件（Marketplace）
- `extension/` 是**宿主中立**的标准扩展：`package.json` 有 `vsce package`、贡献点齐全（viewsContainers/views/customEditors/languages/grammars）。
- 边界核查（见 §3）：只用公开 `vscode` API + Node 标准库，**零 fork 依赖**。
- 当前形态弱点：仍走 **webview SPA**（面板里装整套应用），即 §0b 说应退役的形态。B 路线要"名副其实"必须先做 §0b。
- 上架：技术上具备条件，仅需补齐发布卫生（见 §5）。

### C. 仅 MCP 项目
- `mcp/mcp-server.cjs` 已建，真宿主 + Trae 双客户端实证（37 工具在线）。
- **致命缺陷**：无可视化画布 = 抽掉产品存在理由。只能做 agent 增益面，不能做主产品。

### D. OpenCode 套壳 CLI
- `CLI_PLAN.md` form A：借现有 MCP 桥**零代码**接入，今天即可用 `opencode.json` 的 `mcp` 字段接上。
- 同样无画布，定位为 agent 入口叠加面。

> 结论：**A 是旗舰（符合"套壳＝workbench 即 UI"初心），B 是触达与验证通道，C/D 是免费叠加面。最先该投钱的是 §0b 原生移植（让"套壳"名副其实），而不是先纠结打包方式。**

---

## 3. 关键核查数据（回答"体积 / 边界 / 上架"三问）

### 3.1 打包体积：digitalJS / yosys 是否一同打包？会过大吗？
直接拆解 `extension/verilog-visualizer-vscode-0.0.1.vsix`：

| 文件 | 未压缩大小 |
|---|---|
| `webview/yosys/yosys.wasm` | 16.4 MB |
| `webview/yosys/yosys.browser.js` | 6.2 MB |
| `webview/digitaljs.js` | 2.4 MB |
| **vsix 磁盘实际体积** | **7.3 MB**（21 文件，zip 压缩后；未压缩合计 26.2 MB） |

- **结论：不是问题。** vsix 是 zip，16MB wasm 压到约 5–6MB，整包 7.3MB；Marketplace 上限 **256MB**。
- yosys 跑在 **webview（浏览器上下文）**，不在 Extension Host 的 Node 里 → 不算原生二进制，无原生二进制审核门槛；wasm 在 Marketplace 眼里等同 JS。
- 激活体积无忧：wasm 由 webview 在面板打开时才拉取，宿主激活不预载。
- 冗余提示：`public/`、`dist/` 各存了一份同样的 yosys/digitaljs，纯构建产物冗余，发货只走 `extension/`，不影响上架。

### 3.2 插件边界：真的符合插件边界吗？有没有动 VS Code 源码？
- **"动了源码"的直觉对，但要分清动在哪**：改的是 `studio/` 那个 **VS Code fork 分支**（独立源码 checkout），那是**路线 A 的产物**，与插件解耦。
- 插件 `extension/` 核查：源码 import 只有 `vscode` + Node 标准库（`crypto`/`net`/`node:fs`/`node:os`/`node:path`/`os`/`path`），**无任何 `import 'vs/...'`、无任何对 VS Code 源码打补丁**。
- 唯一命中 fork 关键字的 `startupPolicy.ts`：**仅在注释里引用** `src/vs/platform/environment/...` 解释行为来源；代码只用 `vscode.env`、`extensionMode`、`appRoot` 等**公开环境信息**判断"本扩展是否内置进当前产品"，且在"被装进别人编辑器"时返回 false（不开机自弹）——恰好是 Marketplace 插件该有的正确行为。
- **结论：插件边界干净、宿主中立，可脱离 fork 单独上架；选 B 路线时 `studio/` 可完全不管。**

### 3.3 上架顺不顺？
技术 OK：7.3MB、无原生二进制（wasm 合规）、贡献点全标准、宿主中立且已处理"装在别人编辑器"的降级。

真实门槛（均非拒死，需补齐）：

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | **第三方许可缺失**（唯一硬伤） | ❌ | `extension/webview/yosys/` 内**无 LICENSE**；yosys(ISC/emscripten)、digitaljs 许可须随包提供，否则 Marketplace "捆绑代码需附许可"规则会拦 |
| 2 | publisher 为 `"local"` | ❌ | 须去 marketplace.azure.com 建真实发布者 + Azure DevOps PAT（约 10 分钟 + 身份验证） |
| 3 | 缺 `.vscodeignore` | ⚠️ | 当前 vsix 7.3MB 因 `extension/node_modules` 仅 52KB 无关痛痒；正式发应排除 `src/`、`test-real-launch.mjs`、`*.map` |
| 4 | `untrustedWorkspaces: supported:true` 须名副其实 | ⚠️ | README §1c 提未信任工作区有坑，须先验证优雅降级，否则审核会标 |
| 5 | categories 为 `"Other"` | ⚠️ | 改 `"Programming Languages"` 利于被发现 |
| 6 | 图标 / README / 仓库链接 | ✅ | 均齐备 |

**会被拒吗？** 极 unlikely。常见拒因（超 256MB、未申报原生二进制、混淆代码无源码、虚假能力声明、捆绑代码无许可、垃圾发布）中，当前只差"捆绑代码无许可"这一条。补上即可干净过审。

---

## 4. 推荐演进路线（5 阶段）

### P0 根基兜底（全路线，先止血）
- **补唯一上架硬伤**：把 yosys(ISC/emscripten) 与 digitaljs 的 LICENSE 拷进 `extension/webview/yosys/` 与 `extension/webview/`。
- **真机实证**：在真机跑 `pnpm test:real`（11 格真机套件）并把结果贴回——目前仅有 220/220 桩测试绿，**编译→画布的真宿主路径从未验证过**（WorkBuddy 沙箱因 `reg.exe`/`wsl.exe` 黑名单挡住，须真机跑）。
- **发布卫生**：加 `.vscodeignore`、publisher 改真实、`categories` 改 `"Programming Languages"`、核实 `untrustedWorkspaces` 声明。

### P1 §0b 原生移植（A 与 B 共享的核心，决定卖点成色）
- **A 绑定系统**：部件＝工作区真文件；绑定＝相对路径解析（`workspace.fs` + 原生 Explorer）；改名/删除吃原生事件；干掉 `gateSystem.ts` 里那张 `activePartBindings` localStorage 表。
- **B 模块 + 层次**：`DocumentSymbolProvider` → Outline/面包屑；`TreeView` 画层次实例（把 `ModulePanel.tsx`/`HierarchyViewer.tsx` 自绘 React 侧栏换掉）。
- **C 沙盒**：`.djs` 注册成 `customEditors` 真文档（脏点/保存/关闭/撤销归 workbench）；只留 joint 画布 + 仿真时钟在 webview；退役"装整套 SPA 的面板"。
- **验收**：做完这步，"套壳＝workbench 是 UI"才真正成立。在此之前 A 与 B 交付的都是"面板里的 webview 应用"——正是 §0b 说该退役的形态。

### P2 双轨打包（A 旗舰 + B 触达，并行）
- **A**：保留 `studio/` fork（品牌脚本已就位），是"独立二进制"初心的落地；维护成本只在 P1 验证需求后值得投入。
- **B**：用 P1 移植后的扩展发 Marketplace，零分发成本、最快拿真实用户反馈——廉价验证回路。
- 两者发同一份 `extension/` 代码。

### P3 Agent 门面叠加（C + D，几乎免费）
- **C（MCP）**：已实证；最后一步＝绑 `.vv/api.grants.json` 白名单 + 契约 `surfacesGlobal.mcp` 翻 `true`。
- **D（CLI）**：form A 骑现有 MCP 桥，加 `opencode.json` 的 `mcp` 字段即可，今天能做。
- 人用 GUI、agent 用 MCP/CLI，同一套 37 工具。**别让 C/D 喧宾夺主。**

### P4 治理加固（信任边界，agent 写权限前提）
未建挂账（CLI_PLAN §一 明示）：undo/redo、snapshot、subscribe（文件实时变更）、策略引擎、记忆存储。不做完，MCP 写权限不可信。

---

## 5. P0 急救清单（可直接执行，不动核心代码）

| 动作 | 文件/位置 | 工作量 |
|---|---|---|
| 补 yosys + digitaljs LICENSE | `extension/webview/yosys/`、`extension/webview/` | ~15 分钟 |
| 写 `.vscodeignore` | `extension/.vscodeignore`（排除 `src/`、`test-real-launch.mjs`、`*.map`、`dist/*.map`） | ~10 分钟 |
| publisher 改真实 ID | `extension/package.json` `publisher` | 流程 ~10 分钟 + 身份验证 |
| categories 改 `"Programming Languages"` | `extension/package.json` `categories` | 1 行 |
| 验证 `untrustedWorkspaces` 降级 | `REAL_HOST_E2E.md` + 真机 | 真机跑 |
| 真机跑 `pnpm test:real` 取 11 格结果 | 真机 | 真机跑 |

---

## 6. 治理挂账（P4）清单

| 能力 | 现状 | 风险 |
|---|---|---|
| undo / redo | 未建 | agent/用户误改难回退 |
| snapshot | 未建 | 破坏性操作无安全网 |
| subscribe（文件实时变更） | 未建 | 外部改文件后画布不同步 |
| 策略引擎 | 未建 | 审批/HITL 规则硬编码，难扩展 |
| 记忆存储 | 未建 | agent 跨会话无状态 |

> 这些是 agent 写面回退底座；在 P4 完成前，MCP 写权限应保持受限（白名单 + 只读优先）。

---

## 7. 落地排期

### 本周三步（建议）
1. **P0 急救**：补两个 LICENSE + 写 `.vscodeignore` + 改 publisher/categories（约半天，解上架阻塞）。
2. **真机实证**：在真机执行 `pnpm test:real`，把 11 格结果贴回——这是产品"真能编译+渲染"的唯一实证。
3. **启动 P1 最高价值切片**：先动 `.djs` 成 `customEditors` 真文档（C 板的文件那半），它是另两块板的 substrate，也最直观证明"这是真 VS Code 工具"。

### 阶段里程碑
| 阶段 | 出口标准（Done 定义） |
|---|---|
| P0 | LICENSE 入包 + `.vscodeignore` 就位 + 真机 11 格全绿 + untrusted 降级验证 |
| P1 | `.djs` 真文档化 + 绑定走文件系统 + 模块/层次进原生树 + SPA 面板退役 |
| P2 | A 二进制品牌化可分发 + B 插件上架 Marketplace |
| P3 | MCP 白名单绑定完成 + CLI 经 MCP 桥可用 |
| P4 | undo/snapshot/subscribe/策略/记忆 五项底座建成 |

---

## 8. 风险与未决项

1. **真机 E2E 未收回**：11 格真机套件被 WorkBuddy 沙箱挡（`reg.exe`/`wsl.exe` 黑名单），须用户在真机跑 `pnpm test:real` 贴回结果。
2. **§0b 未落实**：当前 A/B 均交付 webview SPA，原生体验卖点尚未成立。
3. **治理挂账未建**：见 §6，agent 写权限短期应受限。
4. **"套壳"战略归属**：`README` 既定方向是 A（fork），但 B 更廉价的触达价值显著；建议 P1 验证需求后再决定 A/B 投入权重，而非事前二选一。
5. **HITL 最终信任边界**：依赖传输层固化调用方身份（`ToolCaller{surface,subject,interactive}` 三条件齐验），须随 P4 一并收口。

---

## 9. 附录

### 9.1 路线图例
- **A** = VS Code fork 品牌二进制（`studio/`）
- **B** = Marketplace 插件（`extension/`）
- **C** = MCP 服务（`mcp/mcp-server.cjs`）
- **D** = OpenCode CLI（骑 MCP 桥）

### 9.2 关键文件地图
| 文件 | 角色 |
|---|---|
| `extension/src/toolRegistry.ts` | 单执行器，闸序 + verdict + 审计 |
| `extension/api/vv-api.defaults.json` | 37 工具契约（surfaces: ui/rpc/mcp/cli） |
| `studio/` | A 路线：fork 品牌脚本 |
| `mcp/mcp-server.cjs` | C 路线：MCP 服务（已实证） |
| `extension/webview/yosys/` | 编译引擎（wasm，跑在 webview） |
| `docs/CLI_PLAN.md` | D 路线与治理挂账定义 |
| `docs/REAL_HOST_E2E.md` | 真机 11 格套件使用说明 |
| `extension/test-real-launch.mjs` + `extension/src/test-real/realSuite.ts` | 真机测试层 |

### 9.3 参考决策文档
- `AGENT_ARCH_DECISION.md`（§15 工具集扩容）、`CLI_PLAN.md`（form A/B + 挂账）、`MIGRATION_VSCODE.md`（宿主真值台账）、`PROJECT_DEEP_REVIEW_2026-10-05.md`（深度审查卷 61–63）。
