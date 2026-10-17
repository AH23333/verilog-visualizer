# verilog-visualizer → Agent 产品系统架构（整理版）

> 本文件为**整理版**：以「完整 agent 产品架构」为主线，整合原决策日志 `AGENT_ARCH_DECISION.md`（1–16 节）的全部结论，并对每个子系统做**代码级可行性分析**。
> 原文档保留不动，作为决策时间线。本文件定位不变、结论不变，只重排结构并补「难度」维度。
> 基调：**不乐观**。凡标「高/很高」难度的，均含实测代码依据。
> **决策变更（2026-10-12）**：宿主由 Tauri 升为 **VS Code 扩展壳**（主方案），见 §1.1 / §9。全文口径已同步更新。

---

## 0. 代码实测事实（可行性分析的锚点，2026-10-12 核查）

| 事实 | 实测 | 对架构的含义 |
|---|---|---|
| 宿主（**2026-10-14 R141 现势**） | 目标形态＝**自带 Code - OSS 分支出独立二进制**；跑起来只用基座**官方**命令（`scripts/code.bat` + `--user-data-dir` / 位置参数；调试用官方 `--extensionDevelopmentPath`），⛔ 自写启动脚本（R140 的 `pnpm studio:run` 与 `app:check` 那两颗 .mjs 包装已删；R138 的 `pnpm app` 后来以 package.json 里的 **npm script** 形状回来＝官方命令的组合，9214fc7）。"扩展壳＝唯一宿主"那句已作废：整套 SPA 塞进一颗 `WebviewPanel` ⛔ 是产品，绑定／模块／层次／沙盒要搬到宿主原生位置（工单＝`studio/README.md` §0b）。Tauri 那条线仍**整条删除**。画布侧不变：`Canvas.tsx`(1140) 持 `paperRef` | 电路模型内嵌 `paper.model`，**无独立 headless 模型对象**（换宿主⛔ 改这一条） |
| 电路读写唯一出口 | `serializePaperJson(paper)` + `paper.model.getCell/getElements` | 工具无法脱离 UI 直接操作模型 → 工具必须 in-renderer |
| 巨组件 | `SandboxCanvas.tsx` **3798 行**、`App.tsx` 1927 | 放置/编排逻辑未抽出，抽取=大重构 |
| headless 种子（低 DOM） | `verilogCircuit.ts` 263 / `deviceParams.ts` 123 / `sandboxSerialize.ts` 103 / `sandboxDrc.ts` 75 / `canvasProbe.ts` 33 / `gateSystem.ts` 263 | 编译/参数/序列化/分析/探针已有干净雏形 |
| DOM 耦合（须解耦才成工具） | `annotationCell.ts` 492(20 DOM) / `cellMirror.ts` 408(9) / `exportUtils.ts` 135(13) / `subcircuitView.ts` 580(4) | 镜像/标注/导出/子电路工具前须 DOM 解耦 |
| 重构未收口 | `annotationCell.ts` / `subcircuitView.ts` **仍处未提交 WIP** | 工具抽取前须先理清这两文件 |
| agent 运行时 / 工具注册表 | **无** | 须从零建 |
| 持久化 / 日志 | **无**（仅散落 console + 未接线 Rust tracing） | 须新建（§14） |

> **宿主决策（2026-10-12 升为主方案）**：采用 **VS Code 扩展壳** 替代 Tauri 自研桌面（详见 §9，原「未采纳备选」现升为决策）。理由：目标用户为开发者、可接受装 VS Code；VS Code 原生提供文件树/编辑器/终端/设置/输出/ Chat Participant / SecretStorage / LanguageModel API，砍掉用户喊"辛苦"的周围 UI；Tauri 现有后端（`lib.rs` ≈385 行纯文件 CRUD）整段删除，仅 5 个前端文件 + 20 处直连调用需改（R136 实测：1+14+2+3，⛔ 沿用本行早先写的 16 处；`listen` 事件实测 **0** 处）。**该 5 颗文件已于 R136 收成一份中立调用层 `src/lib/host/`，`src` 内除该目录外 `@tauri-apps` 引用为 0**，执行台账见 `docs/MIGRATION_VSCODE.md`。**digitaljs 画布与全部 React 渲染代码原样搬迁**（两种宿主都跑 Webview，与宿主无关）。本表其余"代码基础"行指当前 Tauri 实测态，迁移时对应能力改走 VS Code API。

---

## 1. 定位与边界

- **定位：本地桌面 agent**（非 server 化）。理由：单用户、本地文件、本地仿真；server 化会让「用本地大模型」自相矛盾（server 得住本机才够得到 Ollama）。
- **能力闭环**：AI 写 Verilog → Yosys 编译 → 接口校验 → 失败喂回重写（调试自进化）；沙盒模式下电路分析与部件修改；规则/记忆沉淀（能力自进化）。**不承诺 agent 改写自身源码**。
- **已知硬限（必须接受）**：`digitaljs` 是黑盒，运行时**不能 live 增删 cell**；精细逐步编辑只能「序列化→改 JSON→重载 paper」，粒度粗、大电路有卡顿。读/分析类工具则完全 headless、无此限。

### 1.1 宿主决策（2026-10-12 升为主方案）
- **采用 VS Code 扩展壳，弃 Tauri 自研桌面 UI**。原 §9「未采纳备选宿主」现升为**主方案决策**；Tauri 路径降为历史/可回退实现（见 §9.7）。
- **前提已确认**：目标用户为开发者、可接受安装 VS Code。若未来要面向非开发者独立 App，则回退 Tauri 路径。
- **收益**：文件树/编辑器/终端/设置/输出通道/Chat Participant/`SecretStorage`(密钥)/`LanguageModel API`(LLM 接入) 全用 VS Code 原生——砍掉用户喊"辛苦"的**周围 UI**（仪表盘/规则/聊天/日志/文件树/设置），且 L1 接入被大幅减负。
- **不减的苦**：`digitaljs` 画布 + `SandboxCanvas`(3798 行) 仍须自研（黑盒约束不变），且须执行后端胶水迁移（§9.2.1/§9.4）。该画布两种宿主零变化。
- **迁移成本上限（实测）**：仅 5 个前端文件 + 20 处直连调用（R136 已收口到 `src/lib/host/`）+ Rust `lib.rs` **402 行 / 14 颗命令**纯文件 CRUD 须改写；`listen` 事件 0 处（本文件早先按 16 处 invoke + 若干 listen 估算，R136 现场改数）；绑定系统等纯前端能力零 Tauri 直连、随 `fileStore` 抽象自动迁移（§9.2.2）。

---

## 2. 总体架构分层（主线）

```
L7  用户交互 / 仪表盘 / 规则配置 UI        [React 面板，与重画布争布局]
L6  治理 · 可观测 · 安全                    [HITL / 预算熔断 / 日志 / 注入防护]
L5  状态 · 记忆 · 持久化                    [SQLite + 版本化记忆 + 快照栈]
L4  领域工具                               [编译/放置/仿真/分析/调试/记忆目录]
L3  统一调用层（工具门面, in-renderer）     [MCP 三原语 + 治理四件套]
L2  编排运行时（LangGraph Python sidecar） [graph / checkpointer / subgraph / interrupt]
L1  LLM 接入层                             [keyring + OpenAI 兼容代理 + provider 路由]
L0  宿主（VS Code 扩展：Extension Host + Webview + React + digitaljs 渲染）  [主方案，模型=paper]
─────────────────────────────────────────────────────────────────
跨切面：评测(G1) · 韧性(G5) · 成本(G4) · 并发(G14)
```

**关键约束**：因 `digitaljs` 模型绑死 DOM（§0），L3 工具门面拆为 **Webview（持 `paper`） + Extension Host（持 agent 运行时 + 多数 headless 工具）**；Python LangGraph 经 VS Code webview↔Extension Host 消息调它。代价：电路 mutate 跨 webview 边界 + 每步 tool call 多一层序列化开销，但多数工具（编译/分析/探针）跑在 Node 侧更接近 headless、爆炸半径比 Tauri「全挤 renderer」更小 → L6 护栏仍要紧。真 headless 需把 digitaljs 迁 Worker+OffscreenCanvas（大改，非本期）。

---

## 3. 各子系统详述 + 可行性

### 3.1 LLM 接入层（L1）
- **方案**：OS 钥匙串存 key（VS Code **`SecretStorage`**）；应用内 **OpenAI 兼容代理**统一走 `/v1`；可优先复用 VS Code **`LanguageModel API`** 注册自定义 OpenAI 兼容 provider（指向用户 key / Ollama 本地）。provider 列表 `{baseUrl, apiKey, model}`——云端填 key、本地填 `http://localhost:11434/v1`（Ollama）空 key。
- **代码基础**：Rust `lib.rs` 仅注册 dialog/opener/fs/clipboard，**无 LLM 代理、无 keyring**；VS Code 壳下这部分改由 Extension Host + `SecretStorage` 承担。
- **难度：中（较 Tauri 更低）**。VS Code 原生 `SecretStorage` + `LanguageModel API` 直接提供密钥保管与 LLM 接入骨架，省去自研 Rust keyring 命令；难点仅在密钥不出 webview + 本地/云端统一路由。
- **主要风险**：密钥提取面；本地模型走 localhost 须放行 CORS/代理；小模型（7B/14B）工具调用/严格 JSON 不稳。

### 3.2 编排运行时（L2）
- **方案**：**LangGraph(Python) sidecar**——白送类型化状态、checkpointer/time-travel 回退、HITL(`interrupt`)、subgraph/handoff、tracing。工具层与框架解耦（§12）。
- **代码基础**：无 agent 运行时；须新建 Python 进程，经 VS Code webview↔Extension Host 消息与前端通信（替代原 Tauri IPC）。
- **难度：中（开发）/ 高（分发）**。开发期 LangGraph 编排直接可用；若打包给他人，PyInstaller 打单文件 sidecar + 签名公证是实打实负担（自用可忽略）。
- **主要风险**：双语言调试栈；`thread_id` 错配=跨会话状态泄漏（静默 bug）；持久化往 PostgresSaver/Platform 拽（本地用 MemorySaver/本地 SQLite 即可，图能力全有）。

### 3.3 统一调用层 / 工具门面（L3）
> **落地进度（R155，2026-10-18 夜）**：本节"代码基础：无注册表"已过期。现在注册表＋单执行器＋三闸＋审计都在
> `extension/src/{toolRegistry,apiSurface,apiGrants,apiAudit}.ts`（35 颗在册，RPC 那 9 颗也走同一执行器），
> 工具清单/schema 由 `pnpm api:doc` 从代码生成到 [docs/API_REFERENCE.md](./API_REFERENCE.md)，
> 闸与账的协议见 [CONFIG_PROTOCOL.md](./CONFIG_PROTOCOL.md) §9，agent 侧取数深度见其 **§9.7 深度四档（D0–D3）**。
> 仍未落地的：Resources/Prompts 两面、undo/snapshot、MCP 接线（`surfacesGlobal.mcp` 仍=false）。
- **方案**：工具门面拆为 **Webview（持 `paper`）+ Extension Host（持 agent 运行时 + 多数 headless 工具）**，经 VS Code webview 消息暴露 MCP 三原语（Tools/Resources/Prompts）+ 治理四件套（undo/permission/HITL/snapshot）+ 可观测（readLogs/traceId）+ 异步/记忆（§15）。
- **代码基础**：无注册表；模型=paper（§0）→ 契约降级为 `serialize→mutate→load`。
- **难度：中高（VS Code 下较 Tauri 更优）**。约束变为「Webview 持 paper + Extension Host 持运行时」拆分 + 跨 webview 序列化往返 + 护栏；但编译/分析/探针等多数工具在 Node 侧更接近 headless，比 Tauri「全挤 renderer」干净。每个接口须 schema+超时+幂等+结果整形；`discoverTools` 必须权威。
- **主要风险**：大电路每次调用全量重载卡顿；跨 webview 序列化的少量开销；Resources 与 Tools 须严格分离（只读零副作用）；接口数克制（6–10 聚合）。

### 3.4 领域工具（L4）—— 难度分化最大

| 工具 | 代码基础（实测） | 难度 | 依据 |
|---|---|---|---|
| `compileVerilog` | `verilog.ts` 386 / `verilogCircuit.ts` 263，域已 headless 分离 | **低** | 编译域无 DOM，干净 |
| `setParam` | `deviceParams.ts` 123，headless | **低** | 构造期参数纯函数 |
| `save/loadModel` | `sandboxSerialize.ts` 103，headless | **低** | 序列化即 JSON |
| `analyze` / DRC | `sandboxDrc.ts` 75（1 DOM）/ `gateSystem.ts` 263 headless | **低–中** | 读模型分析，可去 1 处 DOM |
| `probe`（读信号） | `canvasProbe.ts` 33（2 DOM） | **低–中** | 小文件，读模型可 headless |
| `placePart` / `modifyCell` / 连线 | `SandboxCanvas.tsx` 3798 + `Canvas.tsx` 1140，逻辑未抽 | **高** | 模型=paper + digitaljs 黑盒 → 只能 serialize→reload 粗粒度 |
| `cellMirror` | `cellMirror.ts` 408（9 DOM） | **中高** | 须 DOM 解耦 + 用 digitaljs addCell |
| `annotationCell` | `annotationCell.ts` 492（20 DOM），**未提交 WIP** | **中高** | DOM 最多 + 重构未收口 |
| `exportUtils` | `exportUtils.ts` 135（13 DOM） | **中** | 导出逻辑，须去 DOM |
| `subcircuitView` | `subcircuitView.ts` 580（4 DOM），**未提交 WIP** | **中高** | 子电路，重构未收口 |

- **结论**：约 40–50% 工具（编译/参数/序列化/分析/探针）**低险可直接工具化**；约 50–60%（放置/修改/连线/镜像/标注/子电路）**高/中高**，须先 DOM 解耦 + 接受粗粒度。

### 3.5 状态 · 记忆 · 持久化（L5）
- **方案**：引入 SQLite 做会话/工具日志/记忆索引/规则/快照（VS Code 壳下由 Extension Host Node 侧持有，如 `better-sqlite3` 或 VS Code `workspace` 存储；评估后定）；类型化状态（plan≠exec）、版本化记忆+溯源、真值指针在上下文外（§11）。
- **代码基础**：全仓 in-memory React store；**零持久化层**。
- **难度：中**。SQLite 接入 + 与现有 store 双向同步 + 快照栈（`structuredClone` 模型 JSON 极廉价）。
- **主要风险**：store 双向同步一致性；记忆中毒（错事实持久化污染后续 run）。

### 3.6 分层调用与穿透（T0–T3）（L3/L6 交叉）
- **方案**（§10）：T0 只读（常开）/ T1 安全工具（常开，checkpointer 回退）/ T2 精细模型编辑（用户开关，写前快照）/ T3 逃生舱（改源码+shell，逐项开关，git+沙箱）。
- **代码基础**：无分层、无开关、无快照。
- **难度：中**（机制）/ **高**（T3 安全）。T2 廉价（模型=JSON）；T3 须 git 检查点+容器沙箱才可控。
- **主要风险**：最阴险的是「AI 连做 40 次静默原始编辑累积成说不清哪步坏的烂状态」→ 每步写前快照+线性 undo+理由不可省。

### 3.7 治理 · 可观测 · 安全（L6）
- **日志（§14）**：结构化 jsonl + traceId + `readLogs` 工具。**难度：低–中**。须前置（否则 agent 盲飞）。
- **HITL / 预算 / 熔断（§11）**：LangGraph 给机制（interrupt/checkpointer），但「何时 HITL、爆炸半径多大、allow-list 怎么定」须设计。**难度：中**。
- **提示注入防护（G2）**：工具输出/文件/网页可夹带伪造指令，穿透开启后风险指数升。**当前零防护。难度：高**。须输出沙箱化、指令/数据分离、不可信内容标记。

### 3.8 用户交互 · 仪表盘（L7）
- **方案**：新 React 面板（仪表盘/规则配置/agent 状态透明），被回归闸门覆盖（§16 G3/G9）。
- **代码基础**：现有 UI 全为电路编辑；无 agent 面板。
- **难度：中**。与重画布争布局 + 须扩展测试面；用户透明（看计划/步骤/进度）是信任校准关键。

### 3.9 评测与回归（G1，跨切面）
- **方案**：任务成功率基准 + offline eval 集 + LLM-as-judge + 黄金转录回归台；测试金字塔（工具单测 + mock-LLM 编排测 + e2e + 故障注入）。
- **代码基础**：仅有确定性 Playwright 闸门 + 变异台架（对 LLM 非确定不适用）。
- **难度：高**。非确定 LLM 下「怎么证明能用、没退化」是交付前提，须从零建评测体系。**须与工具门面同期启动**。

### 3.10 韧性 / 成本（G5/G4，跨切面）
- **韧性**：LLM 宕机/限流/部分失败 → 重试退避 + 熔断 + 降级本地模型 + offline 模式。**难度：中**。
- **成本**：每任务 token/费用计量、云/本地对比、超额护栏。**难度：低–中**。

---

## 4. 可行性总览矩阵

| 子系统 | 难度 | 前置依赖 | 建议期 |
|---|---|---|---|
| L1 LLM 接入 | 中 | keyring 插件 | 期1 |
| L3 工具注册表+接口集 | 中高 | DOM 解耦候选 | 期1 |
| L4 编译/参数/序列化/分析/探针 | 低–中 | 无 | 期1 |
| L4 放置/修改/连线/镜像/标注/子电路 | 高/中高 | DOM 解耦 + 接受粗粒度 | 期2 |
| L5 持久化+记忆 | 中 | SQLite 插件 | 期1–2 |
| L2 LangGraph sidecar | 中(开发)/高(分发) | IPC + L3 | 期1 |
| L6 日志 | 低–中 | 无 | 期1（前置） |
| L6 HITL/预算/熔断 | 中 | L2 + 策略引擎 | 期2 |
| L6 注入防护(G2) | 高 | L3/L4 | 期2（开穿透前必齐） |
| L7 仪表盘/UX | 中 | 回归闸门扩展 | 期2–3 |
| G1 评测 | 高 | L3 + 黄金转录 | 期1（同期） |
| G5 韧性 / G4 成本 | 中 / 低–中 | L1/L2 | 期2–3 |

---

## 5. 落地路线图（分阶段，不乐观）

- **期1（骨架，必须先齐）**：L6 日志 + L3 `discoverTools`/治理骨架(undo/snapshot/permission) + L4 低险工具 + L1 + L2(IPC) + **G1 评测台**。→ 让 agent 能跑、能查、能证、能回。
- **期2（治理+高难工具）**：L4 高/中高工具（DOM 解耦 + serialize→reload）+ L6 HITL/预算/熔断 + **G2 注入防护** + L5 持久化深化 + T2 穿透（写前快照）。
- **期3（产品化）**：L7 仪表盘/UX + T3 逃生舱(git+沙箱) + G4/G5/G9/G10/G11 + 已知局限目录。

> **铁律**：日志(§14)、评测(G1)、注入防护(G2) 三项与工具门面**同期**，不可事后补——否则上线即盲飞/裸奔。

---

## 6. 关键风险清单（ consolidated，不乐观）

1. **digitaljs 黑盒**：精细 live 编辑不可达，工具只能粗粒度 → 降低"逐步精编"预期。
2. **模型=paper（DOM 绑定）**：工具必须 in-renderer，同进程爆炸半径大，护栏更要紧。
3. **巨组件未抽（3798+1927 行）**：工具抽取=大重构，且与未提交 WIP(`annotationCell`/`subcircuitView`)冲突 → 抽取前先理清 WIP。
4. **提示注入（G2）**：穿透开启后头号漏洞，当前零防护。
5. **评测缺失（G1）**：非确定 LLM 下无评测=无法验证交付。
6. **loop 失控**：步数/连续失败预算 + 熔断 + 可恢复态必须有（团队记忆已有 loop 失控先例）。
7. **双语言维护（L2）**：LangGraph 报错栈在 Python 侧，遇卡须切语言读。
8. **本地小模型弱**：重设计走云端，本地只做轻量 triage/分析。
9. **累积静默砖化（§10.4）**：每步快照+审计日志不可省。

---

## 7. 原文档章节映射

| 本文件章节 | 原 AGENT_ARCH_DECISION.md |
|---|---|
| §1 定位 | §6 / §10 定位 + 本地桌面决策 |
| §2 分层 | §3/§5 架构 + §12 LangGraph 映射 |
| §3.1 LLM 接入 | LLM 路由（keyring+代理+provider） |
| §3.2 编排 | §12 LangGraph 覆盖度 |
| §3.3 调用层 | §13 可行性 + §15 接口范式 |
| §3.4 领域工具 | §13.2/§13.4 工具候选 |
| §3.5 状态记忆 | §11 状态/记忆 |
| §3.6 穿透 | §10 T0–T3 |
| §3.7 治理安全 | §11 健壮性 + §14 日志 + §16 G2 |
| §3.8 交互 | §16 G3/G9 |
| §3.9 评测 | §16 G1 |
| §3.10 韧性成本 | §16 G4/G5 |
| §4–6 | 由原 §13.4/§15.6/§16.3 重组 |

---

## 8. 一句话

架构以「本地桌面 agent + LangGraph(Python) 编排 + in-renderer 工具门面(MCP 三原语+治理四件套)」为主线可行；**真正难的是三层**：digitaljs 黑盒导致的粗粒度工具（§3.4 高/中高）、提示注入防护（G2 高）、非确定评测体系（G1 高）。低险工具（编译/参数/序列化/分析/探针）可立即动手，但日志/评测/注入防护须与工具门面同期启动，否则上线即盲飞或裸奔。

---

## 9. 宿主决策：VS Code 扩展壳（**主方案**，2026-10-12 由备选升为决策）

> **决策状态：已采纳为主方案**（见 §1.1）。用户因「UI 弄得很辛苦」提出弃 Tauri 自研 UI、改用 VS Code 作桌面壳、agent 工具做成 VS Code 扩展。经 §9.2.1 实测耦合面核查，确认迁移成本封顶（5 文件 / 16 `invoke` / 385 行 Rust），绑定系统零 Tauri 直连；前提「目标用户=开发者、可接受装 VS Code」已默认成立。**Tauri 路径降为历史/可回退实现（§9.7）**。

### 9.1 为什么对开发者工具很自然
- Cline / Roo Code / Continue 等主流 agent 工具**均为 VS Code 扩展形态**。
- VS Code 原生提供：文件浏览器、编辑器（Verilog 编辑本就有）、终端（跑 yosys）、设置（API key/规则）、输出通道（日志）、**Chat Participant + LanguageModel API**（agent 交互 + LLM 接入）、SecretStorage（密钥保管）。

### 9.2 对当前架构的影响（不乐观逐项）
- **L0 宿主**：变「Extension Host(TS) + Webview + VS Code 原生 UI」。Rust `lib.rs` 整个消失——文件 CRUD→`workspace.fs`、keyring→`SecretStorage`、设置→`settings`。须重写 Tauri IPC 为 VS Code API（实打实迁移）。
- **L1 LLM 接入**：可部分复用 VS Code `LanguageModel API`——注册自定义 OpenAI 兼容 provider 指向用户 key / Ollama，**显著降低 L1 工作量**（keyring + 代理可借 SecretStorage + LM API）。
- **L3 工具门面**：变为「Webview（持 paper）+ Extension Host（持 agent 运行时 + 多数工具）」拆分。**比 Tauri「全在 renderer」更干净**——编译/分析/探针等工具跑在 Extension Host(Node)，更接近 headless；仅电路 mutate 跨 webview 边界。每步 tool call 多一层消息序列化开销。
- **digitaljs 黑盒约束不变**：canvas 仍须放 Webview，放置/修改仍 `serialize→reload` 粗粒度（§0/§3.4）。

### 9.3 真正的收益 vs 不减的苦
- **收益（砍掉的「周围 UI」）**：仪表盘 / 规则配置 / agent 聊天 / 日志面板 / 文件树 / 设置 —— 全用 VS Code 原生，正是用户喊"UI 辛苦"的主体。
- **不减的苦**：`digitaljs` 画布 + `SandboxCanvas` 3798 行仍是自研硬骨头；VS Code **不替你画电路**。若辛苦源是画布本身，套壳无济于事。

### 9.4 代价 / 风险
- **后端胶水重写（中，但封顶）**：Tauri IPC→VS Code `acquireVsCodeApi().postMessage(...)` + Extension Host 消息处理；`listen` 事件→webview 消息事件。20 处直连调用机械替换，但异步契约需逐点核对；`WindowControls.tsx` 整文件删除（VS Code 自带标题栏）——R136 已先把它改成认 `host.hasWindowControls`，所以删除那天起不会有第二处探测留在仓里。
- **路径语义变更（低–中）**：Tauri `get_project_dir`（真实 OS 路径）→ VS Code `vscode.Uri`/workspace folder。通用 `fileStore` 隐藏了差异，但**绑定系统等一切经 fileStore 持久化的数据**需确认无绝对路径硬编码（§9.2.2）。
- **webview↔extension host 每步 tool call 多一层序列化**：agent 工具门面（§3.3）若改为「Webview 持 paper + Extension Host 持运行时」，跨边界调用有少量开销——但比 Tauri「全挤 renderer」更干净（多数工具可在 Node 侧 headless 跑）。
- **失去独立二进制**：须装 VS Code；Electron 壳体积更重；构建/测试回路改为 `vsce package` + 扩展开发宿主。
- **digitaljs 画布零变化**：3798 行 `SandboxCanvas` + `Canvas.tsx` + 黑盒约束（§3.4）原样保留——这是最贵的部分，两种宿主都不省钱。
- **绑定系统（用户关切）迁移成本低**：零 Tauri 直连、持久化走通用 fileStore、UI 为纯 React，详见 §9.2.2；**不是迁移难点**。
- 适用边界：适合**开发者工具**（本项目是）；若要面向非开发者独立 App，VS Code 壳不合适（回退 Tauri，§9.7）。

### 9.5 结论（已采纳）
构想**成立且对本项目契合度高**，尤其缓解"UI 辛苦"；**不改变核心 agent 架构**（LangGraph / 工具门面 / digitaljs 约束），只是换 L0 宿主并顺手减 L1。决策已定（§1.1）：§2 分层图 L0/L1 已重写、§3.1/§3.3 方案已替换；§3.2/§3.4 及 §4–§6 不变。迁移执行见 §9.6。

### 9.6 迁移路线图（执行口径，供接手代理）
> 顺序原则：**先不动核心（digitaljs/SandboxCanvas），只换宿主胶水 + 解耦工具**；每步可独立验证、可回退。

1. **脚手架**：建 `extension/` 包（`package.json` + `extension.ts` 入口 + `vscode` 依赖），`yarn/npm` 工作区接现有 React 前端；`vsce` 打包配置。✅ **R137 已落**（pnpm workspace + esbuild + `.vscode/{launch,tasks}.json` 入库 ⇒ F5 即可；⚠ `vsce` 本机未装，`.vsix` 那条路**还没实测**）。
2. **L0 后端胶水**：删 `src-tauri/`（Rust）；新建 Extension Host 模块承接文件 CRUD → `workspace.fs`、配置 → `settings`、导出 → `window.showSaveDialog`、剪贴板 → `env.clipboard`。✅ **R137 已落**（`extension/src/projectStore.ts` 逐条对齐 Rust 14 颗命令语义；项目根当年定 `globalStorageUri/project_files`，**片 3a 已改成"打开的那个文件夹"**，那颗⛔ workspace 的理由见下一行，已在册反转）；✅ **`src-tauri/` 已于 R138 删除**（用户令"清理 tauri"，回退口径改为走 git，§9.7）。
3. **消息总线**：前端加 `acquireVsCodeApi()` 封装，把 5 个文件的 20 处直连调用改为 postMessage + Extension Host handler；事件 `listen`→webview 消息（实测 **0 处**，该条本期空）。✅ **两半段齐了**：前端半段 R136（`src/lib/host/`：探测每次现读、浏览器档 reject 而非返回空表、VS Code 档带 id 配对与超时的 JSON-RPC + base64 传字节），宿主半段 R137（`extension.ts` 的 15 方法 `dispatch()`）。新能力面：**webview CSP 已过真浏览器判据**（`tests/r137-webview-csp-gate.cjs`，见 `MIGRATION_VSCODE.md` §3.5）。（§9.4）
3b. **⚠ 迁移途中新发现的一层（本文⛔ 未预见）**：webview 里的 `localStorage` 持久性。沙盒电路文件正文（`verilog-viz-sandbox-files`）**完全不经宿主**（`sandboxStore.ts` 内 `getHost|hostFire|saveProjectFile` 计数 0），而 VS Code 官方建议 webview 用 `getState`/`setState`。⇒ 这是**数据丢失**风险而非观感缺陷；修法两岔，先取真机读数（`MIGRATION_VSCODE.md` §5A 第 5 格），⛔ 在读数之前把 45 处调用点改异步。
4. **L1 接入**：接 `SecretStorage` +（可选）`LanguageModel API` 自定义 provider；provider 列表 `{baseUrl, apiKey, model}` 持久化到 `settings`。（§3.1）
5. **路径迁移**：`get_project_dir`→`vscode.Uri`；**实测确认 `partBindings`/绑定值无绝对路径**，必要时首开做 Uri 重映射。✅ **片 3a（2026-10-13）**：根＝**打开的工作区文件夹**（⚠ 这一条**反转了** R137 那句"⛔ workspace 文件夹"——形态决定文件树的主人交给原生 Explorer，而 Explorer 只看得到工作区里的真文件；没开文件夹时退回旧家 `globalStorageUri/project_files`，多根取第一颗＝在册取舍）；⬜ `partBindings` 里存的到底是文件名还是绝对路径**仍⛔ 现场量过**。（§9.2.2）
6. **agent 子系统（与迁移并行，非阻塞）**：按 §3 / §4–§6 推进日志/评测/工具门面；工具门面落成「Webview 持 paper + Extension Host 持运行时」。（§3.3）
7. **删除 WindowControls.tsx**、移除所有 `isTauri` 守卫分支（§9.2.1 清单）。✅ **R138 已执行**（连同 `ProjectHost` 上那五颗窗口控制方法与 `hasWindowControls` 一起离开接口；`App.tsx` 两处 `data-tauri-drag-region` 也拔掉，顶栏那颗 div 只剩弹性占位）。
8. **回归**：用现有 Playwright 闸门 + 变异台架（§3.9）验证电路编辑/编译/绑定功能在 VS Code 壳下等价；补扩展端到端测试。⬜ **仍欠**：跑批已把"调用层改造 + `base:'./'`"在 Tauri/浏览器两档验完（`MIGRATION_VSCODE.md` §2 与卷四十二§五），新落的 `tests/r137-webview-csp-gate.cjs` 是把**壳那份 CSP 与装载面**搬到 headless 浏览器里判（11 PASS / 0 FAIL / 1 UNVERIFIED），⛔ 等于"真起过 Extension Development Host"。那颗端到端台架（自动开 F5 窗口驱动 webview）是下一期该建的。

### 9.7 Tauri 路径降级说明（**R138 已执行：整条删除**）
- 原计划"迁移完成前仍可运行、作回退方案"**已作废**：用户 2026-10-13 令「当前项目要完全转向 vscode 类的 electron，要清理 tauri」。
  删除清单见 `docs/MIGRATION_VSCODE.md` §8（`src-tauri/` 24 颗 tracked 文件、`tauriHost.ts`、`WindowControls.tsx`、
  接口上五颗窗口控制方法与 `hasWindowControls`、`isTauri`、两处 `data-tauri-drag-region`、三个 `@tauri-apps` 包、
  `public/tauri.svg`、vite 里的 `TAURI_DEV_HOST` 分支）。
- **新的回退口径＝git**：要那一版就 `git revert`/`git checkout` 到删除前那笔（账本卷四十四记了提交号）。
  digitaljs 画布与全部 React 渲染代码从头到尾没动过，所以回退代价同样封顶——只是⛔ 再"两条宿主并排维护"
  （并排维护的代价正是这批文档反复漂、启动方式反复要重写的根源）。
- 原触发回退条件里那条仍然成立且⛔ 被本次改动验证过：**webview↔Extension Host 每步 tool call 多一层 JSON 序列化**
  （字节走 base64），大型电路上若成为瓶颈仍是开放风险；届时不再回到 Tauri，而是把那颗工具挪进 webview 侧。
