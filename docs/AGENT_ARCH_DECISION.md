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
