# Agent 应用架构决策（verilog-visualizer）

> 状态：已决策（待下一阶段 agent 接手落地）
> 定位：本地桌面 agent；编排引擎选 **LangGraph（Python）**
> 本文只谈架构与契约，不含代码。不修改任何现有源文件。

---

## 0. 决策摘要

- **定位**：本地桌面 agent（非 server 化）。理由：单用户、本地文件、本地仿真、要能用本机 Ollama/LM Studio；server 化会使"用本地模型"自相矛盾。
- **编排引擎**：引入 **LangGraph（Python）**。理由：子 agent / checkpointer（=一键回退）/ time-travel / 上下文压缩 reducer / node 中间件（=hook）原生可用，最符合"功能强大"诉求。
- **领域能力**：留在 **TypeScript** 侧，抽成框架无关的 headless RPC 工具层。LangGraph 仅作为该工具层的客户端。
- **LLM 接入**：应用内 OpenAI 兼容代理；provider 列表（云端填 key、本地填 `localhost` 空 key）；key 存 OS 钥匙串，不进渲染器。

---

## 1. 为什么引入 Python 不会"造成大问题"（前提约束）

用户反问"不是都通过统一调用层调用吗"成立。一旦工具层框架无关且经 RPC 暴露，编排引擎语言与领域逻辑解耦。Python 不造成大问题的**三个硬前提**：

1. **工具唯一真源在 TS** —— LangGraph 端禁止重实现 domain 逻辑，只能 RPC 调用 TS 工具。否则双份实现漂移出幽灵 bug。
2. **工具层必须是 headless RPC 服务** —— 从 `SandboxCanvas.tsx`/`App.tsx` 巨组件抽出，跑在 TS 进程（Node sidecar 或 Web Worker + IPC），对 UI 与 LangGraph 同时暴露。此抽取工程量与"用不用 Python"无关，Python 不增加也不免除。
3. **模型传 handle 不全量重序列化** —— 工具服务持有 digitaljs Circuit 实例，对外暴露 `canvasId`/cell 句柄；Python 只发"在 A 处放 B"类指令，避免大 JSON 跨进程往返卡死。

---

## 2. 真实代价（不乐观，必须接受）

- **打包 Python 进 Tauri**：PyInstaller 单文件 sidecar + 一起签名分发；自用无碍，对外分发是实负担。
- **双语言双调试**：LangGraph graph/state/checkpointer/reducer 是 Python API，agent 失控时要读 Python 栈，vibe coding 效率有损耗（被"免写编排"部分抵消）。
- **IPC 延迟**：localhost RPC 单次毫秒级，非瓶颈；瓶颈仍在 digitaljs 操作（TS 侧），Python 帮不上。
- **digitaljs 黑盒天花板不因框架改变**：运行时不能 live 增删 cell，精细逐步编辑仍只能"序列化→改 JSON→重载"，粒度偏粗、大电路有卡顿。LangGraph 的"强大"在编排，不在电路操控。
- **loop 失控风险依旧**：step 预算 + 熔断 + 可恢复状态必须自管，框架不替你管。

---

## 3. 进程 / 调用拓扑

```
┌──────────────┐   UI 直编   ┌─────────────────────────┐
│ Tauri 前端    │ ─────────▶ │ TS headless 工具服务     │
│ (React/store) │            │ (抽取自 SandboxCanvas)   │
│              │ ◀───────── │ 持有 Circuit 实例        │
│ 用户交互      │   模型回写  │ 暴露 RPC: compile/place/ │
└──────┬───────┘            │ probe/analyze/setParam   │
       │ agent 交互         └────────────┬────────────┘
       ▼                                  │ RPC(句柄指令)
┌──────────────┐   tool 调用             │
│ LangGraph     │ ───────────────────────┘
│ (Python side- │
│  car, HTTP/WS)│
└──────┬───────┘
       │ LLM 请求(经应用内代理)
       ▼
┌──────────────┐
│ LLM: 云端/    │
│ 本地 Ollama   │
└──────────────┘
```

- UI 与 LangGraph 都是工具服务的客户端；两者在同一份 Circuit 模型上协作，回退基于模型快照。
- LangGraph sidecar 经应用内 OpenAI 兼容代理调 LLM；key 从钥匙串取，渲染器拿不到明文。

---

## 4. 统一调用层（核心，非可选项）

工具表（契约见 `AGENT_TOOL_CONTRACT.md`，待补）：

| 工具 | 背后能力 | 现状 |
|---|---|---|
| `compileVerilog(src)` | Yosys 编译 + 接口校验 | `lib/verilog.ts` 已有，headless 友好 |
| `placePart(canvas, part, pos)` | 放置/绑定部件 | 嵌在 SandboxCanvas，需抽 |
| `setParam(cell, params)` | 构造期参数 | `lib/deviceParams.ts` 种子 |
| `runSim(canvas, inputs)` | 仿真 + 波形 | `lib/simClock.ts` 种子 |
| `probe(canvas, net)` | 取信号值/调试 IO | 需新建（读模型） |
| `analyze(canvas)` | 多级结构/扇出/未驱动分析 | 需新建（读模型） |

- 工具**操作电路模型、返回新模型**，store 采纳后 UI 重绘。
- 早期以"生成 / 批处理 / 分析"类工具为主；精细 live 编辑暂缓（digitaljs 限制）。

---

## 5. LangGraph 原生覆盖的高级功能映射

| 诉求 | LangGraph 原生 |
|---|---|
| 一键回退 | checkpointer + time-travel |
| 调用子 agent | subgraph / handoff |
| 上下文压缩 | state reducer / 裁剪节点 |
| hook | node 中间件 / 条件边 |
| 自进化(调试闭环) | graph 自循环 + 编译错误喂回 |
| 记忆 | 持久化 checkpointer + 外接向量 |

---

## 6. "自进化"边界（勿承诺）

- **任务自进化**：写 Verilog → Yosys 编译 → 接口报错喂回下一轮重写（现有接口校验即反馈环）。
- **能力自进化**：成功模式沉淀进"规则配置" + "记忆索引"，下次复用；用户可手动调规则。
- 不承诺"agent 改写自身源码"。

---

## 7. 与在跑代理的冲突约束（重要）

- 当前另一代理未提交改动集中在 `SandboxCanvas.tsx`/`annotationCell.ts`/`sandboxLoad.ts`/`sandboxSerialize.ts`（正是工具抽取要动的文件）。
- **R121 提交稳定前，agent 工作只许以"隔离新模块 + 调用现有 store 窄接口"起步，不得重构现有组件。**
- 工具抽取必须等核心组件稳定后再进行，且用窄接口，避免静默覆盖。

---

## 8. 备选

- **LangGraph.js**：单语言、零打包负担，能力约 90%  parity，生态略年轻。若不愿打包 Python 则选此。
- 两者共用同一套框架无关工具层，今天选哪个都不锁死工具层，将来可换。

---

## 9. 给接手代理的落地顺序

1. 先定 `AGENT_TOOL_CONTRACT.md`（工具 JSON Schema + "返回新模型"约定）—— 所有上层地基。
2. 抽 headless 工具服务（先做 compile/runSim/analyze/probe，再抽 place/setParam），跑通 RPC。
3. 建 LLM 代理 + 钥匙串 + provider 列表。
4. 起 LangGraph(Python) sidecar，接工具 RPC，先跑通"写码→编译→修正"单 loop。
5. 上 checkpointer/time-travel 实现一键回退；再上 subgraph/handoff 子 agent。
6. 非确定评测台替代确定性闸门（mock-LLM + 黄金转录 replay）。
7. 仪表盘 / 规则配置 UI（与重画布争布局，需回归闸门覆盖）。

---

## 10. 调用层分层与"穿透"模型（用户新增要求）

用户核心诉求：统一调用层(API)是**安全底线**，但允许 AI 在用户承担风险的前提下**穿透**该层、直接对更细粒度目标操作；穿透开关由用户显式承担"AI 毁掉项目"的风险。

### 10.1 结论：分"读 / 安全写 / 精细写 / 逃生"四层，而非简单两层

| 层 | 能力 | 风险 | 默认 | 回退机制 |
|---|---|---|---|---|
| T0 只读 | 读项目源码 + 电路模型 + 文档 | 几乎无（仅密钥泄露，钥匙串已隔离） | 常开 | 无需 |
| T1 安全工具 | 走统一调用层（编译/放置/仿真/分析/探针） | 低（受 schema + 返回新模型约束） | 常开 | checkpointer/time-travel |
| T2 精细模型编辑 | 直接改 digitaljs JSON（按需增删 cell/连线/改子电路源） | 中 | 用户开关 | **写前快照（模型即 JSON，成本极低）** |
| T3 逃生舱（源码/shell） | 改应用 TS 源码、跑命令 | 高（可砖化 app、越权到主机） | 用户**逐项**开关 | git 检查点 + 沙箱 |

### 10.2 关键澄清（不乐观）

- **"穿透"对电路工作真正有价值的是 T2，不是 T3。** 本项目 digitaljs 是黑盒、安全层只能"按规格重建/批量放置"（粗粒度）。T2 让 AI 直接改电路模型 JSON 做**手术式精编**，恰好补齐安全层的天花板——这是穿透功能的主体收益，应作为一等公民而非附属。
- **T3（改源码/shell）才是用户说的"毁掉项目"风险源**，应单独、显式、最好按会话授权，且默认全关。这其实等价于此前"不承诺 agent 改写自身源码"的**危险模式版**：默认不开放，开放即用户认责。
- **只读(T0)不应被关在危险模式后**。读代码几乎零风险，却能让 agent 更懂领域；把它和"写穿透"分开授权。
- **"调用层无 bug"是必要非充分**：即使 T1 无 bug，穿透层也必须保留**可观测性**（每次原始操作都进审计日志），否则砖化后无法定位是哪一步坏的。

### 10.3 该设计如何与已有功能咬合

- **规则配置** = 穿透开关的天然宿主：`allow.circuitRawEdit`(T2) / `allow.sourceEdit`(T3) / `allow.shell`(T3)。用户承担的"风险"即这些开关的显式开启。
- **一键回退** = 危险模式的可接受性前提：T2 靠写前快照（廉价），T3 靠 git 检查点。没有回退网，危险模式不可接受。
- **仪表盘** = 显示每步动作所属层级（"此操作为 T2 原始模型编辑"），让用户和回退系统都清楚爆炸半径。

### 10.4 必须存在的护栏（即使危险模式）

1. **每步写前快照 / 线性 undo 栈**，不是"只有一个总检查点"。真实风险不是一次毁掉，而是 AI 连续 40 次静默原始编辑累积成**说不清哪步坏的**状态——总检查点无法精准回退。需逐步快照 + agent 对每步原始编辑给出理由。
2. **审计日志不可关**：T2/T3 每次动作记 `{tier, target, diff, reason}`，危险模式更须全量留痕。
3. **爆炸半径分级**：电路文档编辑限于 `.djs`；源码/shell 编辑可能波及运行中的 app 与其他用户数据，信任级不同，T3 须 git-checkpoint + 沙箱（sidecar 跑 shell 即真实主机访问，必须限定到仓库目录）。
4. **显式声明层级**：工具调用须带 `tier` 标记，禁止"AI 看了调用层源码就图方便默默绕过安全层"——安全层须是阻力最小路径（schema 稳、文档好），穿透须显式 `unsafe:true` + 预授权，而非"它能看见代码就能随手改"。
5. **安全层仍要做测试**：既有 Playwright 闸门纪律平移到 T1；不能因有危险模式就放松 T1 质量——危险模式抬高的恰是可观测性与回退网的标准，而非降低安全层标准。

### 10.5 实现顺序提示

先让 T1 经闸门 + checkpointer 跑稳 → 再开 T2（模型写前快照，收益最大且风险可控）→ 最后才把 T3 作为用户逐项开关接入（须配 git 检查点 + 沙箱）。T0 全程常开。

---

## 11. 健壮性增强结构（用户自认缺 agent 系统工程经验，补充）

用户凭直觉提出的"受控 API + 逃生舱"是 agent **工具设计**的经典模式，正确但**不够**——健壮的 agent *系统*还需控制流、状态、可观测性、验证四类结构。以下按类别列出可补结构，并标注与 LangGraph(Python) 的对应点与落地优先级。

### 11.1 控制流结构（防失控）

- **HITL 审批门（human-in-the-loop）**：对高爆炸半径动作（T2/T3 写、外部调用、多步计划）做**逐动作**确认，而非仅"用户 blanket 授权危险模式"。LangGraph `interrupt()` 原生支持；这是比"风险开关"更细的安全网——开关是策略，HITL 是执行点拦截。
- **多维预算 + 熔断**：不止步数，还要 token 预算、$ 预算、墙钟时间、连续失败次数上限（连错 N 次即 halt）。防"agent 跑飞 / 烧钱 / 死循环"。
- **Kill-switch / 紧急暂停**：用户可中途 halt，且 halt 后状态必须**一致可恢复**（靠 checkpointer）。halt ≠ 回退，但 halt 须留下可续状态。
- **失败分类 + 恢复剧本**：把失败分为 瞬时/永久/语义 三类，预设 重试 / 重规划 / 升级人工 / 中止 四剧本。大多数 agent 事故因无分类而无人处理。

### 11.2 状态与记忆结构（防错乱/防中毒）

- **类型化状态 schema（计划 ≠ 执行）**：用 LangGraph `StateGraph` + reducer 把"plan 状态"与"execution 状态"分开，禁止模型把"想做"和"已做"混淆——经典故障是 agent 以为自己做了 X 其实没做，或基于过期计划行动。
- **真值指针在上下文之外**：压缩上下文时，**绝不压缩电路模型真值与当前工具态**，只在上下文里留指针。直击此前"压缩丢电路上下文"的担忧。
- **模式化版本化记忆 + 溯源**：记忆不是"向量库"而已，而是带 provenance、可定期 consolidation 的结构化存储；防"记忆中毒"（agent 写过一条错'事实'持久化后污染后续所有 run）。

### 11.3 工具/动作结构（防坏操作）

- **工具结果校验 + 输出整形**：每个工具输出先过 schema 校验再给模型；校验失败返回结构化错误而非崩溃。大输出（digitaljs JSON）须**截断/摘要**防上下文爆。
- **每工具 timeout / 重试 / 幂等**：每个调用有超时、退避重试、且须幂等或显式声明非幂等——防挂起循环与重复副作用。
- **执行前/后护栏（爆炸半径）**：执行前判"是否超出 allow-list/半径"；执行后判"实际状态变更是否符合预期"（漂移检测），尤其 T2/T3。
- **权限策略引擎**：把规则配置升级为 `{subject, action, resource, blastRadius} → allow/deny/ask` 的**策略对象**逐动作求值，而非散落布尔开关（早期用布尔可，长大须策略化）。

### 11.4 可观测性与验证（防盲飞/防悄悄退化）

- ** tracing 一等公民**：不是"审计日志"而已，而是结构化 trace（LangSmith / LangGraph Platform / OpenTelemetry）：每节点、每工具调用、token、成本全留痕。危险模式可生存的前提就是可观测。
- **黄金转录回归台**：建 (prompt → 期望工具调用序列 → 期望终态电路) 语料，非确定 LLM 也不许悄悄退化。对应此前评测台设想，提升为结构。
- **子 agent 结果校验 / 信任边界**：子 agent 返回工件后父 agent **先校验再采纳**，不盲信（子 agent 可能自信返回错的 Verilog）。

### 11.5 隔离结构（防塌房）

- **运行时分离**：agent 进程（Python sidecar）独立可重启，不拖垮电路编辑器；崩溃隔离。
- **T3 沙箱**：shell 逃生须容器化，限定到仓库目录，不能触达主机其他处。
- **每步快照**：已在 §10.4，属隔离/恢复基础。

### 11.6 落地优先级（给缺系统经验者的基线）

**必做基线（单用户也该有）**：
1. 类型化状态（plan/exec 分离）
2. 工具结果校验 + 输出整形/截断
3. 多维预算 + 熔断（步数 + $）
4. 每步快照（§10.4，T2 已含）
5. T3 默认关 + HITL（或保持关）
6. 黄金转录回归台
7. tracing/审计（§10.4）
8. Kill-switch

**规模相关（按需再加）**：
- 完整策略引擎（早期布尔即可）
- 子 agent 校验（子 agent 上线后）
- 记忆 consolidation（记忆变大后）
- T3 容器沙箱（T3 给他人用后）

> 注意："用户承担风险开关"是**必要非充分**——它只是策略层授权；真正的安全网是 HITL + 每步快照 + tracing。三者缺一则 blanket 授权仍危险。

---

## 12. 第11节结构 × LangGraph(Python) 覆盖度映射

结论：**LangGraph 高效覆盖本结构集中最难、最该避免手搓的若干块**（持久类型化状态、每步快照/回退、HITL、subgraph、tracing）；其余要么契合其 node/edge/guard 模式（你写判定逻辑），要么是框架无关胶水/领域逻辑（任何框架都一样费力）。

| §11 结构 | LangGraph 覆盖 | 说明 |
|---|---|---|
| 类型化状态(plan≠exec) | **原生** `StateGraph`+reducer | 核心能力，极高效 |
| 每步快照 / 回退 | **原生** checkpointer + time-travel | 每步持久化，回退零自研 |
| HITL 逐动作审批 | **原生** `interrupt()` / `Command(resume)` | 一等公民 |
| Kill-switch | **原生**（interrupt + 不 resume） | 暂停即一致可恢复态 |
| 子 agent + 结果校验 | **原生** subgraph / handoff + 自加校验 | 拆分即 subgraph |
| tracing 一等公民 | **原生** LangSmith / OpenTelemetry | 强项 |
| 失败分类 + 恢复剧本 | 模式契合 `add_conditional_edges` | 你写分类逻辑，路由天然 |
| 前后护栏(爆炸半径) | 模式契合 guard node | 你写判定，套节点即可 |
| 工具结果校验 + 整形 | pydantic + `ToolNode` 包装 | 中等，Python 生态顺 |
| 版本化记忆 + 溯源 | `langmem` / 自定义 | 中等，langmem 可减负 |
| 授权/策略引擎 | 框架外 + guard node 调用 | 你建策略对象 |
| 多维预算 + 熔断 | 框架外 guard node + 计数 | 你建（简单） |
| timeout/重试/幂等 | **胶水**（tenacity 包装工具） | 易 |
| 真值指针 / 上下文压缩 | 框架外 state 设计 | 你设计（用 state 存 handle） |
| 黄金转录回归台 | 框架外 pytest 台 | 录 run + 断言 |
| 运行时分离(sidecar) | 部署选型 | 非框架 |
| T3 容器沙箱 | 基础设施 | 非框架 |

### 12.1 诚实代价（不乐观）

- **框架给"机制"不给"判断"**：interrupt/checkpointer 是机制，但"何时 HITL、爆炸半径多大、allow-list 怎么定"仍要你设计。框架不会替你做危险决策。
- **图心智模型有学习曲线**：reducer 语义、checkpointer thread_id、interrupt 恢复流若用错会有**静默bug**（如 thread_id 错配=跨会话状态泄漏；reducer 内可变状态=污染）。你 TS 高效流不直接平移到"图思维"，需内化。
- **持久化把人往 server 模型拽**：要 PostgresSaver / LangGraph Platform 的耐久/cron 才最香；本地桌面用 `MemorySaver` 或本地 SQLite saver 即可，图能力仍全有，但丢了平台级耐久——与"本地桌面 vs server"张力一致（见 §3/§6）。
- **tracing 默认走 LangSmith**（需 key/账号）；要零外部则换 OTel + 本地 collector，稍多配置。
- 预算/策略引擎/压缩策略/测试/沙箱 **框架无关**，任何框架都同费力——LangGraph 不增不减这些，只是不替你做。

### 12.2 一句话

选 LangGraph(Python) 对本健壮性结构集是**高杠杆**：它白送 4–5 块最贵的（耐久类型状态、每步快照回退、HITL、subgraph、tracing），余下套 node/guard 模式或胶水。真正非 LangGraph 的工作是**领域判断**（策略引擎、压缩策略、测试、沙箱）——这些与框架无关，换 Mastra/LangGraph.js 也一样要做。

---

## 13. 统一调用层可行性复核（R129 实测，非乐观）

> 本节基于 2026-10-12 对 `main`(R129) + 未提交工作树的**只读**核查。结论：**可行，但形态与 §3/§5 假设的"headless 工具 sidecar"不符——工具必须常驻渲染进程，且 digitaljs 模型与 DOM 强绑定，是头号天花板。**

### 13.1 当前代码事实（已核实）

- `SandboxCanvas.tsx` 经 R124–R125 瘦身（4631→3776），但**现仍 3798 行**，放置/编排逻辑未抽出。
- 渲染面为独立 `Canvas.tsx`（约 530+ 行），持有 `paperRef`（joint.js paper）。**所有电路读写经 `paper.model.getCell / getElements / serializePaperJson`**——电路模型**内嵌于 DOM paper**，无独立 headless 模型对象。
- `lib/` 头less 种子真实存在且 DOM 干净：`sandboxSerialize.ts`(103,0)、`sandboxLoad.ts`(166,0)、`simClock.ts`(17,0)、`deviceParams.ts`(123,0)、`verilogParse.ts`(478,0)、`verilogCircuit.ts`(263,0)、`verilogConflicts.ts`(188,0)。编译域已成功双域分离（R126）。
- 但 DOM 耦合仍在：`cellMirror.ts`(408,9 DOM)、`annotationCell.ts`(492,20 DOM)、`exportUtils.ts`(135,13 DOM)、`subcircuitView.ts`(580,4 DOM)——正是"镜像/标注/导出/子电路"工具候选，未去 DOM。
- **不存在 agent 运行时 / 工具注册表**。`lib/` 仅一处 `headless` 注释（指 r28 测试场景），非工具层。统一调用层须从零建。
- **工作树未干净**：`M annotationCell.ts / subcircuitView.ts / package.json / tsconfig.json / tests/run-all.cjs` + `?? eslint.config.js`。前两者恰是 DOM 耦合工具候选——重构在关键文件上**未真正收口**（与"重构完成"表述矛盾，需核实）。

### 13.2 可行性评级：中等（带重大星号）

**低风险可直接工具化（≈40–50% 表面）**
- `compileVerilog(src)`：verilog 域已 headless，低险。
- `saveModel / loadModel`：sandboxSerialize/Load 零 DOM，低险。
- `setParam`：deviceParams 零 DOM，低险。
- `analyze`（读模型报告）：可基于 sandboxSerialize 输出做，低险。
- `probe`（读信号值）：需经 `paper.model` 读，但可包成只读函数，中低险。

**高风险 / 受限（≈50–60% 表面）**
- `placePart / modifyCell / 连线`：**做不到精细 live 编辑**。digitaljs 是黑盒，`Canvas.tsx` 走 serialize→reload 模式；工具只能"按规格重建/批量改 JSON→重载 paper"，粒度粗，大电路每调用一次全量重载会卡顿。
- **模型不可"返回新模型、UI 采纳"**：电路模型即 paper，无独立可返回模型对象。§10/§11 设想的干净契约（工具返回新模型、UI 重绘）在此**不成立**，除非引入"序列化 JSON 为模型真值 + reload"的折中——但那正是粗粒度重载。
- `cellMirror/annotationCell/exportUtils`：须先去 DOM 或抽象 DOM 访问层，才成工具——额外重构未做。

### 13.3 对 §3/§5 架构的修正（重要）

- **"headless 工具 sidecar（独立进程）"不可直接达成**：因电路模型绑死 DOM paper，工具无法在独立进程操作电路。现实形态是 **工具常驻渲染进程(TS)，经"应用内工具 RPC 门面"暴露；Python LangGraph 经 Tauri IPC / localhost 调用该门面**。
- 代价：**工具与 UI 同生命周期**（窗口关→工具死），且工具门面与画布强耦合——比独立 sidecar 脆弱，须在 §3/§5 中修正为"in-renderer tool registry + IPC"，而非"headless tool server"。
- 若要真 headless：须把 digitaljs 迁到 **Worker + OffscreenCanvas + 模型句柄 IPC 协议**——大改，非本期。

### 13.4 落地前提（不乐观清单）

1. **先定"in-renderer 工具门面"架构**（非 sidecar），重写 §3/§5。
2. 对 `cellMirror/annotationCell/exportUtils/subcircuitView` 做 **DOM 解耦**（抽 `domAccess` 抽象或纯函数化），否则它们不能成工具。
3. `placePart/modifyCell` 接受**粗粒度**（serialize→reload），并在大电路上做重载性能验证；精细逐步编辑暂缓。
4. 接受"模型即 paper"——工具契约改为 `serialize→mutate→load` 而非"返回新模型对象"。
5. 将未提交 WIP（annotationCell/subcircuitView）先提交/理清，避免工具抽取时静默冲突。
6. 仍须 T0–T3 分层（§10）、HITL+每步快照+tracing（§11）——因工具与 UI 同进程，爆炸半径更大，护栏更要紧。

### 13.5 一句话

统一调用层**能建，但它是"渲染进程内的工具门面"，不是干净的 headless 服务；digitaljs 模型 DOM 绑定是头号硬限**——精细编辑与"返回新模型"契约须降级为粗粒度 serialize→reload。早前 §3/§5 的 sidecar 假设需修正。其余（分层/护栏/框架选型）不变。

---

## 14. 日志系统现状与缺口（2026-10-12 核查）

> 用户问：当前是否有完善日志可供 agent 遇问题时查看调用。结论：**没有。** 仅散落 `console` + 未接线的 Rust `tracing`。

### 14.1 现状（已核实）
- **TS 侧**：全仓仅约 30 处散落 `console.*`（fileStore 14、sandboxStore 6、余各 1–2），属临时调试打印。**无集中 logger、无级别、无组件标签、无 traceId、不落盘。**
- **Rust 侧**：`tracing` 仅为传递依赖（digitaljs 等拉入）；`lib.rs` 仅注册 `dialog/opener/fs/clipboard`，**未注册 `tauri-plugin-log`、未接 tracing subscriber** → Rust 日志无落盘。
- 无日志文件、无结构化存储、无查询接口。
- Tauri 生产构建下浏览器 console 不可访问；dev 下也随窗口销毁丢失。

### 14.2 对 agent 的影响（不乐观）
- "AI 遇问题查看调用日志"**当前不可行**：浏览器 console 易失、不可被 Python sidecar / 工具门面读取、生产不可达。
- §11 的"tracing/审计日志不可关"**完全未满足**——危险模式(T2/T3)若无持久日志，砖化后无法定位哪步坏（与 §10.4 审计要求直接冲突）。
- 缺 **traceId** → 工具调用与日志行无法关联，agent 排错时无法把一条失败工具调用映射到相关日志。

### 14.3 须补的缺口（§11 可观测性硬前提）
1. **结构化持久日志 sink**：二选一
   - `tauri-plugin-log`（Rust，写 app-data 文件，带 level/target/时间戳）——正统但多一个 Rust 插件；
   - 用现有 `tauri_plugin_fs` 自建 TS jsonl logger——轻量、零新 Rust 依赖。**本地桌面单用户推荐后者。**
2. **TS 日志门面**：统一 `log(level, component, msg, {traceId, ...meta})` 替换散落 console；dev 仍可镜像到 console。
3. **traceId 串联**：每次工具调用带 `thread_id/traceId`，贯穿日志与 LangGraph checkpointer。
4. **`readLogs` 工具（T0/T1）**：agent 经工具门面按 时间/级别/组件/traceId 过滤读取——这是"AI 查日志"的落地形态。
5. **危险模式日志不可关**：T2/T3 动作强制落盘（落实 §10.4 审计项）。

### 14.4 工作量与优先级
- **工作量低**：plugin-log 或 fs-jsonl + TS 门面属中小工作量；`readLogs` 随工具门面(§13)一并建。
- **须前置**：§11 tracing 与 §10.4 审计都依赖它，应在工具门面之前或同期启动，而非事后补——否则 agent 上线即"盲飞"。

### 14.5 一句话
当前**没有**可供 agent 调用的日志系统（仅散落 console + 未接线 Rust tracing）。须新建结构化持久日志 + traceId + `readLogs` 工具，这是 §11 可观测性的硬前提；工作量低但必须前置，且与工具门面(§13)同期推进。

---

## 15. 统一调用层接口范式（业界参照 + 本项目接口集）

> 用户问：仅凭直觉想到"功能操作接口 + 调用日志接口"，还应/最好补哪些？
> 结论：**不靠直觉——业界已收敛出范式**：MCP 定义三大原语（Tools / Resources / Prompts），健壮 agent 再在其上自建治理类接口。你已想到 Tools + Logs(Audit)，缺 Resources 及回退/权限/HITL/发现/异步等。

### 15.1 范式来源（不是拍脑袋）

- **MCP（Model Context Protocol）**：当前 agent↔工具间调用层的收敛标准。它显式规定调用层对外暴露**三类原语**：
  - **Tools** —— 模型可控的函数（= 你说的"功能操作接口"）。
  - **Resources** —— 应用可控的**只读上下文**（文件、状态、配置）——**你漏掉的这一类**。
  - **Prompts** —— 用户可控的任务模板（可复用工作流）。
- **Logs / Audit** 不在 MCP 三原语内，但属健壮 agent 的**事实标准必备**（§11/§14）。
- 余下治理类接口（Undo / Permission / HITL / Discovery / Async / Snapshot）**MCP 不管，由你或编排框架补**——LangGraph 用 `interrupt`/`checkpointer` 覆盖其中 HITL 与 Snapshot 的"机制"，但**协议层仍要显式暴露**。

### 15.2 接口全集（分类，附必/优评级）

**A. 执行类（你已有部分）**
1. **`invokeTool(name, args)`** —— 功能操作接口（Tools）。入参经 JSON Schema 校验，返回结构化结果。**（必备）**
2. **`discoverTools()`** —— 返回全部工具名 + schema + 描述。**极易被忽略但必备**：agent 不能靠"经验"猜工具签名，必须信权威 schema，否则幻觉调用。
3. **`preFlight(name, args)`** —— 执行前 dry-run，返回影响范围/爆炸半径估算。T2/T3 高危动作前必走。

**B. 观察类（只读，MCP Resources 主体）**
4. **`readResource(uri)`** —— 只读拉取上下文：当前电路模型、文件内容、设计规则、运行配置。**与你"功能操作"不同——它是 pull 式、零副作用**，让 agent "看懂现状"而不必先改东西。
5. **`readLogs(filter)`** —— 调用日志（§14.4）。T0/T1 级。

**C. 治理类（健壮 agent 的灵魂，MCP 不管）**
6. **`undo(step)` / `rollback(checkpoint)`** —— 显式回退。你"一键回退"诉求的落地。**模型即 JSON，快照极廉价**，应基于模型快照而非文件级。
7. **`checkPermission(action)`** —— 执行前按策略引擎(§11)判 allow/deny/ask。
8. **`requestApproval(action)` / `resolveApproval(id, decision)`** —— HITL 逐动作审批（§11）。高风险动作默认 ask。
9. **`snapshotState()` / `restoreState(id)`** —— 全量状态捕获/恢复，供上下文压缩 truth-pointer（§11）与崩溃可恢复。

**D. 异步/生命周期类**
10. **`getStatus(handle)`** —— 长操作返回句柄后轮询（编译/大电路重载可能慢）。
11. **`subscribe(event)`** —— 订阅环境事件（hook 入口，§11）。

**E. 记忆类**
12. **`readMemory/writeMemory`** —— 规则配置 + 长期记忆读写（§11 记忆）。T0/T1 级。

### 15.3 MCP 覆盖度映射（诚实边界）

| 接口 | MCP 原生 | 谁的责 |
|---|---|---|
| invokeTool / discoverTools | ✅ Tools | 调用层 |
| readResource | ✅ Resources | 调用层 |
| Prompts 模板 | ✅ Prompts | 调用层 |
| readLogs | ❌ | 调用层自建(§14) |
| undo / rollback | ❌ | 调用层自建 |
| checkPermission | ❌ | 策略引擎(§11) |
| requestApproval(HITL) | ❌(机制在框架) | 调用层暴露 + 框架 interrupt |
| snapshot/restore | ❌(机制在 checkpointer) | 调用层暴露 + 框架 |
| getStatus / subscribe | ❌ | 调用层自建 |
| read/writeMemory | ❌ | 调用层 + 持久化(§11) |

→ **MCP 解决"怎么调"，不解决"调之前能不能、调错了怎么回、人要不要批"**。后者是本项目必须自建的治理层，也是你直觉没覆盖到的主体。

### 15.4 本项目映射（具体）

| 接口 | 后端能力 | 当前状态 | T 层 |
|---|---|---|---|
| invokeTool | compileVerilog/placePart/setParam/runSim(§13) | 须抽 | T1 |
| discoverTools | 工具注册表 | **无** | — |
| readResource | 电路模型/文件/规则(只读) | T0 可直读 store | T0 |
| readLogs | §14 jsonl + traceId | **无** | T0/T1 |
| undo | 模型快照栈 | 无（仅 git 级） | T2 前提 |
| checkPermission | allow.*(§10) | 仅规则配置雏形 | 策略层 |
| requestApproval | HITL | 无 | T2/T3 |
| snapshotState | 模型序列化 | 半（serializePaperJson） | T1 |
| getStatus | 编译/重载进度 | 无 | T1 |
| subscribe | hook 埋点 | 无 | F |

### 15.5 设计纪律（不乐观警告）

- **每个接口都要 schema + 超时 + 幂等 + 结果整形**（大 JSON 截断/摘要，防上下文爆）——这是 §11 工具类纪律的落地。
- **Discovery 必须权威**：agent 信 `discoverTools` 返回的 schema，不信训练记忆；签名变更必须同步更新注册表，否则幻觉调用。
- **Resources 与 Tools 严格分离**：只读接口绝不带写副作用，避免 agent 用写接口当读用、污染状态。
- **Undo 基于模型快照**：digitaljs 模型=JSON，每步写前 `structuredClone` 压栈即可，成本极低——这是"一键回退"的最高性价比实现，优先于文件级回退。
- **接口数需克制**：action space 过大→agent 决策质量降；工具按领域聚合成 6–10 个，而非几十个细碎函数。
- **治理接口不能"可选"**：§11 已定 HITL+每步快照+tracing 三件套为必建；其中 undo/snapshot/permission 正是本节的治理类接口，须与 Tools **同期**而非事后补。

### 15.6 落地顺序（修正 §13.4）

1. **先建治理骨架**：结构化日志(§14) + `discoverTools` + `checkPermission` + `undo/snapshot` 栈。
2. 再建 **Tools**（抽 §13 候选，粗粒度 serialize→reload）。
3. 建 **Resources**（`readResource` 拉电路模型/文件，T0）。
4. 接 **HITL / Async / subscribe**（T2/T3 开前必齐）。
5. 最后 **Memory / Prompts**（沉淀与复用）。

### 15.7 一句话
统一调用层接口集 = **MCP 三原语(Tools/Resources/Prompts) + 自建治理四件套(undo/permission/HITL/snapshot) + 可观测(readLogs/traceId) + 异步/记忆**。你已想到 Tools+Logs；最该补的是 **Resources（只读上下文）** 与 **undo/snapshot（回退底座）**——前者让 agent "看懂现状"，后者是你"一键回退"诉求的唯一干净落地。

---

## 16. 缺失维度登记册（成熟 agent 产品系统设计的盲区）

> 用户问：功能完善成熟的 agent 产品设计，当前文档还缺哪些方面。
> 结论：**文档有结构性盲区**——覆盖"构建者+agent"双视角，缺"验证者/对抗者/使用者"三视角。下按成熟度分级登记缺口，标注在文档中的现状与本项目优先级。

### 16.1 文档当前视角覆盖
- ✅ **构建者视角**：架构、分层、框架选型、工具抽取、接口契约（§3–§15）。
- ✅ **agent 视角**：状态/记忆/工具护栏/loop 预算/HITL（§11）、接口集（§15）。
- ❌ **验证者视角**：如何证明 agent 真的能用、没悄悄退化。
- ❌ **对抗者视角**：如何被攻击、被诱导做坏事。
- ❌ **使用者视角**：人如何掌控、理解、信任、纠正 agent。

### 16.2 缺口分级（Tier 1 关键 / Tier 2 重要 / Tier 3 产品完整度）

**Tier 1 —— 当前近乎空白、但决定产品能否上线**

| # | 缺失维度 | 文档现状 | 本项目优先级 | 说明 |
|---|---|---|---|---|
| G1 | **评测与回归方法论** | 仅 §11 一笔"黄金转录回归台" | 极高 | 怎么量化"agent 完成任务"？需：任务成功率基准、offline eval 集、LLM-as-judge、回归门槛。非确定 LLM 下这是"能不能交付"的前提，远不止一句。 |
| G2 | **对抗安全：提示注入 & 工具结果信任** | 有权限/爆炸半径(§11)，无注入防护 | 极高 | agent 读工具输出/文件/网页，**返回内容可含注入指令**——这是 agent 头号漏洞。需：工具输出沙箱化、指令/数据分离、不可信内容标记。本域还含"恶意电路生成"风险。 |
| G3 | **可观测产品层（指标/仪表盘/告警 + 用户透明）** | 有日志(§14)，无指标/告警/UX透明 | 高 | "仪表盘"诉求(早期)未落地为指标定义；用户需看到 agent 当前计划/步骤/进度（信任校准），非仅后端 trace。 |

**Tier 2 —— 成熟产品必备**

| # | 缺失维度 | 文档现状 | 优先级 | 说明 |
|---|---|---|---|---|
| G4 | **成本与 token 经济** | §11 有预算熔断，无成本建模 | 高 | 每任务/session 成本计量、provider 成本对比、超额护栏。本地模型免费用、云端按 token 计——需显式核算。 |
| G5 | **韧性/降级模式** | §11 有 kill-switch，无降级 | 高 | LLM API 宕机/限流/部分失败怎么办？重试退避、熔断外部依赖、降级到本地模型、offline 模式。 |
| G6 | **非确定系统的完整测试金字塔** | §13 提确定性闸门不适用 | 高 | 工具单测(确定) + 编排集成测( mock LLM) + e2e 黄金转录 + 故障注入(chaos)。现有 Playwright 闸门范式要平移并扩展。 |
| G7 | **数据模型与生命周期** | §11 有类型化状态/版本化记忆雏形 | 中 | 持久化 schema、迁移、保留期、跨 session 连续性、备份/灾难恢复（agent 砖化记忆库怎么办）。 |
| G8 | **agent 自身生命周期/版本化** | 无 | 中 | prompt/model/tool 版本化、行为回退、能力注册表演进——改工具不能静默破坏 agent。 |

**Tier 3 —— 产品完整度**

| # | 缺失维度 | 文档现状 | 优先级 | 说明 |
|---|---|---|---|---|
| G9 | **人-AI 协作 UX** | 后端重，交互轻 | 中 | 可中断、可编辑计划、纠正手势、信任校准。文档是纯后端视角。 |
| G10 | **隐私与数据治理** | 无 | 中 | 即使本地桌面，云 LLM 调用会外发电路上下文；日志 PII、留存、用户同意。 |
| G11 | **改进反馈捕获** | "自进化"仅提记忆(§11) | 中 | 点赞/点踩/反馈如何真正回流改进（非仅写记忆），闭环评估。 |
| G12 | **已知局限/失败目录 & 期望管理** | 无 | 中 | 文档化"明确做不到什么"（digitaljs 黑盒等），防过度信任。 |
| G13 | **配置/特性开关 & 灰度** | §10 有 allow.*，无特性flag | 低 | 运行时配置、按特性 kill-switch、T2/T3 渐进启用。 |
| G14 | **并发模型** | subgraph 有，session 并发无 | 低 | 多 agent 会话/交错如何隔离。 |

### 16.3 最高优先补哪三块
1. **G1 评测方法论**——没有它，"agent 能用"永远是一句空话，下一阶段代理无从验证自己。
2. **G2 提示注入防护**——T2/T3 穿透(§10)一开，注入风险指数级上升；不做等于把键盘交出去。
3. **G3 用户透明 + G7 数据生命周期**——前者决定人敢不敢用，后者决定砖化后能不能救。

### 16.4 一句话
文档是"如何造"的优秀蓝图，但缺"如何证(评测)、如何防(对抗)、如何用(人控)"三视角。对"功能完善成熟"标准，最不可省略的是 **G1 评测、G2 注入防护、G3 用户透明** 三块；其余 G4–G14 按成熟度递增补齐。下一阶段代理接手时，应把 G1/G2 与 §13 工具门面**同期**启动，而非事后补救。
