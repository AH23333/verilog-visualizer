# Verilog Visualizer 配置文件协议（Config Protocol v0.3.1）

> 本文档是《配置文件协议》修订版。v0.3 的核心思路是匹配项目实际路线：先迁移原有功能 → 统一 API 调用层（为 Agent 提供操作电路/沙盒文件的统一入口） → 最终接入 VS Code 或自建 Agent 系统。

> 配置不采用单一 JSON 集中管理，而是按职责分层（A：VS Code 原生配置；B：.vv/ 工程元配置；C：**/.verilogviz.json 目录级绑定）。各层的所有权、读写时机、提交策略和生效范围不同。

> **① 迁移完成原有功能（进行中）→ ② 统一 API 调用层（对电路/沙盒文件的操作面，供 agent 消费）→ ③ agent 系统（VS Code 宿主 或 自建 LangGraph，二选一，未定）**。

> 路线含义：配置层会**随阶段逐段生成**，⛔ 一份大 JSON 收纳一切；协议只锁定「跨阶段不变量」（能力契约/授权/审计/绑定权威），引擎与宿主敏感的形态一律**标注所属分支、延迟定稿**。

>

> 版本沿革：v0.1.0（初稿，平行绑定结构——已否）→ v0.2.0（三域定界+agent 一等章节——绑定/边界修复成立，agent 章仍按单一引擎写实——见 §13 冗余裁定史）→ v0.3.0（阶段分层、API 层立章、agent 两分支中立化）→ **v0.3.1（本版：外部评审采纳——perm/sideEffects 词表合一、§9.4 审批语义与不可降级性、§9.5 审计落点 `.vv/audit`、§13.3 分支 B 立项必答清单；M1-M7 实现期一致补丁）**。

> 本文件仍是设计提案，⛔ 直接改动代码；落地按 §15 阶段路线，闸门随迁。



## 1. 设计目标



- **按阶段生码，⛔ 提前建表**：每个阶段只启用该阶段的配置文件；`.vv/` 骨架、schema、工具契约都随阶段 ensure（§3 阶段列）。文件不存在＝该阶段未到的正常态，⛔ 报「缺配置」。

- **协议描述现实，⛔ 发明现实**：每字段先答「现在谁消费」；无消费方者进对应阶段的预留档（§7.2/§10），⛔ 混进当前 schema。

- **统一 API 层是第二阶段的宪法**（§9）：UI 命令、webview RPC、未来的 MCP/CLI 端点——**同一能力的同一入口、同一契约、同一授权、同一审计**；agent 是端点之一，⛔ 特权方。

- **绑定权威不动山**：目录级 `.verilogviz.json` 链（分层合并、裸/前缀键、policy auto|strict、手编即权威、ensure 不覆盖）是已验收定案，本协议只做 schema 化与诊断归一（§5）。

- **与宿主各管一段**：标量→VS Code settings；宿主原生扩展机制（MCP 注册、prompt/instructions 文件等）→**照宿主格式，⛔ 收进我们的协议文件**（§2 域 D）；结构化工程共识→`.vv/`；绑定→域 C。同语义两处＝诊断红 ⛔ 静默择一。

- **可验证、可演化**：`schemaVersion`（配置文件轴）+ `apiVersion`（能力契约轴，§9.3）**两线独立演进**；major 变更必须带迁移器，读到更高版本硬红（§12.3）。

- **密钥隔离**：持久文件只存 `secretRef`；宿主路线的模型密钥**归宿主治理**（§10.1），我们连引用都不建。

- **并发写安全**：原子替换 + 校验 + `.bak` + 写矩阵与锁（§12.2）。



## 2. 四个配置域（总边界）



| 域 | 载体 | 归属 | 例 |

|---|---|---|---|

| **A · VS Code 原生设置** | `contributes.configuration` + 用户/工作区 settings | 宿主双层级原生合并 | `verilogViz.compile.*`、`verilogViz.sandbox.*`、`verilogViz.bindings.policy` |

| **B · .vv/ 工程协议文件** | `.vv/*.json`（本协议主体） | 工程共识，结构化 | `project.json`、`api.json`、`env.json`、`runtime.json`、agent 分支文件（§10） |

| **C · 目录级绑定链** | 每目录 `.verilogviz.json` | 绑定唯一真源 | §5（协议化对象） |

| **D · 宿主原生扩展机制** | `mcp*.json`、`.github/*.prompt.md`/instructions、语言模型选择 UI | **宿主格式，协议只对齐不收纳** | 阶段三 VS Code 路线的全部“运行配置” |



> 裁决规则：任何键**有唯一出生域**（表注“域”列）；跨域重复 → `CONFIG_DOMAIN_CONFLICT`（§8）。

> 域 D 的诱惑说明：MCP/prompt 文件天然像“我们的配置”，一旦复制进 .vv 就与宿主真值漂移（宿主改了我们不知道）——协议立场是「读它们做展示/校验对齐，写只走宿主官方通道」。



## 3. 文件布局 × 阶段（时间轴）



| 文件 | 生成阶段 | 提交 | 说明 |

|---|---|---|---|

| `.verilogviz.json`（域 C） | ✅ 现状 | ✅ | 绑定链，§5 协议化 |

| `.vv/project.json` | 一期尾 | ✅ | 工程共识（路径/默认解析/二期 compileProfiles） |

| `.vv/env.json` | 一期尾 | ❌ | `${env.VV_*}` 映射与工具链发现 |

| `.vv/api.json` | **二期** | ✅ | **统一 API 层能力契约**（§9） |

| `.vv/api.grants.json` | **二期尾**（授权面需要时） | ✅ 可选 | 调用方档案与三闸授权（§9.4）；无此文件＝全部端点按最小权限 |

| `.vv/runtime.json` | 按需（会话状态出现时） | ❌ | 最近打开/选中/一次性预算覆盖 |

| `.vv/audit/` | 二期（审计通道上线时） | ❌ | 调用轨迹 JSONL（§9.5 跨阶段不变量，⛔ 与 agent 引擎同生共死） |

| `.vv/agent/`（graphs·checkpoints·providers） | **三期·仅自建分支** | graphs ✅／其余 ❌ | §10.2；VS Code 分支此目录整体不生成 |



扩展 activate ensure `.vv/` 骨架**只含当前阶段文件**；出现超前于阶段的文件＝警告 `CONFIG_STAGE_SKIPPED`（要么真进入该阶段了，要么残留——都该被知道）。`.vv/.gitignore` 自动维护规则表在 §12.5。



## 4. 元数据与校验基建



所有域 B/C 文件顶层：



```json

{

  "schemaVersion": "0.3.0",

  "kind": "project|env|runtime|api|bind|graph 等按 §3",

  "$schema": "./schemas/vv-<kind>.schema.json"

}

```



- `schemaVersion`：semver，管**文件形状**；`apiVersion`（§9.3）管**能力集合**，两轴独立（文件没改形状、工具面可以扩；反之亦然）。

- `$schema` 是可选人类提示；**官方校验通道 = 扩展 `contributes.jsonValidation`** 的 fileMatch 模式（`**/.verilogviz.json` → vv-bind、`**/.vv/*.json` → vv-config、`**/.vv/api.json` → vv-api、`**/.vv/agent/graphs/*.json` → vv-graph），不依赖 $schema 解析。

- 时间戳字段 ⛔ 入受版本管理文件（git 即时间史）；运行期时间写 runtime（§13.2 废除单延续）。



## 5. 域 C · 部件绑定协议化（v0.2 定稿继承，行为零改动）



本节把已验收的目录级绑定链转为可校验协议——**记录即权威 + 自动兜底显形 + 可拦截** 三面定案的 schema 化：



1. **链与值**：`文档目录 → … → 项目根` 远→近合并、近层覆盖；存值按层目录相对（`counter.djs`/`../shared/x.djs`），输出折回根相对。目录有 `.djs` 即 ensure 模板表；已存在内容 ⛔ 覆盖。

2. **键语法**：

   ```jsonc

   { "bindings": {

       "counter": "parts/counter.djs",        // 裸键（UI 绑定/固化只产这种）

       "sub/ctrl.djs::adder": "alt/v2.djs"    // 前缀键 <宿主文档根相对名>::<实例名>：多层同名精控（手编专属）

   }, "circuits": ["main.djs"] }              // 显式取消部件名单（根表语义）

   ```

   schema pattern：值扩展名 ∈ {djs,gate,v,sv}——**djs/gate＝画布部件文件**（沙盒实例化消费），**v/sv＝编译闭包的 Verilog 实现文件**（编译侧消费，`normalizePartName` 保留原扩展名⛔ 套 `.djs`）；禁止双 `.djs` 尾（`normalizePartName` 写入侧纪律）；解析优先 **前缀>裸录>同名兜底>无**，policy（域 A）裁决兜底可用性——单一出处 ⛔ 他处复写。

3. **写方义务**（已实现，协议收录为约束）：重命名迁移（含前缀键宿主随迁）、删除清绑、copyToSandbox 子部件撞名固化（主电路改名 ⛔ 进表）、固化/写全产裸键。

4. **完整性三面**（§5→诊断的映射见 §8）：

   `AUTO_RESOLUTION_USED`（auto 兜底项，画布审计条/检查命令的 warn 数据源）、

   `BINDING_MISSING`（strict 拦截，编译与画布同语义）、

   `BINDING_UNRESOLVED_RECORD`（记录了但文件缺失/不含该定义）——宿主 `collectInstanceHits` 与画布 `getBindingAudit` **同源同口径**（在册纪律，写进 schema 注释级约束）。

5. `resolution.maxDepth`（现值 8，**域 B `project.json` 顶层**）＝默认值唯一出处（⛔ 藏进 `bindings.*` 命名空间，避免与域 C 的 `bindings` 真源混淆）；`allowSelfReference:false` 与环检测（`findPartCycle`→环路径 warn）行为不变。



## 6. 路径（Paths）（瘦身结果不变）



```json

{ "paths": { "outDir": "build", "cacheDir": ".vv/cache", "agentDir": ".vv/agent" } }

```



相对工程根；posix `/`；Windows 盘符大小写**必须**忽略比较（根前缀剥离条款）。`partsDir/sandboxDir` 等废除单延续——文件面就是工作区本身（阶段一迁移定案）。



## 7. 编译（Compile）



### 7.1 今天已有（实现态，⛔ 本协议再分发）



| 能力 | 载体（域 A 现状，已接线） |

|---|---|

| topModule/yosysOptions/noFlatten/noOpt/autoRecompile | `verilogViz.compile.*`，`getConfig` RPC 下发两画布 + `configChanged` 即时 |

| 绑定权威覆盖 + strict | 域 C + `bindings.policy`（§5） |

| 编译诊断 | `bindingErrors` 文案簇 → 归一 §8 码，落 Problems/输出（既有通道） |



### 7.2 二期档案 — **定稿时机＝「API 层稳定之后」**



外部硬件工具链全链（nextpnr/bitstream/pcf/烧录）与 `.vv/project.json` 的 `compileProfiles` 详细形状整体推迟：阶段二把「compile 作为工具」的契约定了（§9），硬件链是它的实现扩展，字段随首个真消费者立项。原则升级：**连“最小档案”也 ⛔ 现在抄进 schema**，仅在本节留意图声明（v0.2 的最小示例即为此保留：



```jsonc

{ "compileProfiles": { "ice40-hx8k": {

    "toolchain": { "yosys": "${env.VV_YOSYS_BIN}", "nextpnr": "${env.VV_NEXTPNR_BIN}" },

    "files": { "top": "top.v", "sources": ["rtl/**/*.v"] },

    "outputs": { "dir": "${paths.outDir}" } } } }

```



——该段文件在阶段二 api.json 定稿前 **⛔ 出现**；出现即 `CONFIG_STAGE_SKIPPED`。）



## 8. 验证与诊断



错误码统一形态 `{code, jsonPointer, message, severity, source: "config:project|bind:<dir>|env|api"}`；落点＝现状通道（Problems `publishProblems`、输出通道）。§5.4 三码、`UNRESOLVED_REF/CIRCULAR_DEPENDENCY/DEPTH_EXCEEDED/SCHEMA_INVALID/UNKNOWN_SCHEMA_VERSION/CONFIG_DOMAIN_CONFLICT/CONFIG_STAGE_SKIPPED/MISSING_TOOL/INVALID_PATH` 清单延续 v0.2；**新增两码**：

- `API_TOOL_UNKNOWN`——graph/prompt/外部端点引用了 `api.json` 不存在的工具（阶段三引用校验的报错形态）；

- `API_SURFACE_DENIED`——端点调了未对其开放/被授权收窄的工具（§9.4 三闸之一）。



## 9. ★ 阶段二 · 统一 API 调用层（本协议的枢纽章节）



第二阶段的全部价值凝成一句：**对电路/沙盒文件的操作面收敛成一份契约，四个端点（UI 命令、webview RPC、MCP 工具、headless CLI）从同一注册表生成。** 现状雏形对位（防三面漂移的根据）：



| 端点现状 | 收敛目标 |

|---|---|

| `extension/src/dispatch.ts`（RPC 方法表） | `api.json` 工具 id 的 `rpc` 面投影 |

| `contributes.commands` + trees/webview/context 菜单 | 同注册表的 `ui` 面投影（`uiCommand` 字段锚定，⛔ 行为分叉） |

| 阶段三 MCP server（若走 §10） | 同注册表 `mcp:true` 子集的 `mcp` 面投影 |

| Headless CLI/脚本（编译、审计等 Node 可跑项） | 同注册表 `headless:true` 子集 |



### 9.1 `.vv/api.json`（kind:"api"，✅ 提交，阶段二生成）



```jsonc

{

  "schemaVersion": "0.3.0", "kind": "api", "$schema": "./schemas/vv-api.schema.json",

  "apiVersion": "0.1.0",

  "tools": {

    "circuit.open":        { "since": "0.1.0", "perm": "read",  "sideEffects": "none",

                             "ioSchema": "schemas/api/circuit-open.json", "uiCommand": "verilogViz.openDoc",

                             "surfaces": ["ui", "rpc", "mcp", "cli"] },

    "circuit.compile":     { "since": "0.1.0", "perm": "process", "sideEffects": "process",

                             "timeoutMs": 300000, "maxConcurrent": 1, "uiCommand": "verilogViz.compileAndShow",

                             "surfaces": ["ui", "rpc", "mcp", "cli"] },

    "bindings.audit":      { "since": "0.1.0", "perm": "read", "sideEffects": "none",

                             "uiCommand": "verilogViz.auditBindings", "surfaces": ["ui", "rpc", "mcp"] },

    "bindings.writeAll":   { "since": "0.1.0", "perm": "config-write", "sideEffects": "config-write",

                             "requiresApproval": true, "uiCommand": "verilogViz.completeBindings", "surfaces": ["ui", "rpc"] },

    "project.copyToSandbox":{ "perm": "file-write", "sideEffects": "file-write", "requiresApproval": true,

                             "surfaces": ["ui", "rpc"] }        // 高影响写：mcp/cli 对外默认关，审批通道验证后才开

  },

  "surfaces": { "ui": true, "rpc": true, "mcp": false, "cli": false },

  "audit": { "enabled": true, "dir": ".vv/audit", "jsonl": true, "traceId": true, "storeArgs": "full" }
  // 审计与 agent 引擎无关（§9.5 跨阶段不变量）：落 .vv/audit/，⛔ 塞进 .vv/agent/（后者为分支 B 专属）

}

```



### 9.2 工具命名与描述纪律



- id 语法 `<domain>.<verb>`；domain 词表封闭 `{circuit, project, bindings, compile}` 增词走协议 minor 评审（防同义漂移：remove/delete/destroy）。

- 每工具必须回答：`perm`（枚举 `read | file-write | config-write | process | net`，**与 sideEffects 同词表**——读面 `read`+`none`/`read`+`process` 等，⛔ 两套粒度并存；v0.3.1 勘误：旧稿混用 `read/write/fs-write`，纪律章自身违例，作废）、`sideEffects`（`none|file-write|config-write|process`）、`requiresApproval`、`timeoutMs/maxConcurrent`（可调）、`ioSchema`（输入输出 JSON Schema 一份，MCP 导出零转换）。

- **读操作必须 `sideEffects:none` 如实**；写操作 `idempotent`（可重放标志）默认 false。



### 9.3 `apiVersion` 演化（能力轴）



- `since:<ver>` 记录工具加入版本；删除/语义变更=**major** bump + `removed:{ id:"x", replacedBy:"y", since:"0.2.0" }`；端点与 consumer 校验 min 版本（`API_INCOMPATIBLE` 码）。

- 与 `schemaVersion` 正交的硬证场景：graph 文件形状不动（schema 不变）但 `bindings.writeAll` 行为扩展（apiVersion minor）→ graph 声明 `"requiresApi": ">=0.1.0"` 即可，⛔ 互绑。



### 9.4 授权三闸（端点收窄）



一次调用要同过三闸，任一不过 → 错误码 + **审计仍记被拒**：

1. `surfaces` 全局开关（文件级，例如未接线前 `mcp:false`）——**硬拒绝**（`API_SURFACE_DENIED`），不发审批请求；

2. 工具自身 `surfaces` 数组 & `requiresApproval`——`surfaces` 不含该端点＝**硬拒绝**；`requiresApproval:true`＝**暂停并发起审批**（宿主原生弹窗通道，§10.3）而非直接拒绝，用户拒绝才落 `verdict:"denied"`；

3. 调用方档案授权——域 B `.vv/api.grants.json`（✅ 可选提交）声明 `profiles`（`reviewer`=只读集，`builder`=+写集），每个连接端点（UI 用户/某 MCP 连接/某 CLI 进程）绑定一 profile。**与 §10.2 agent 侧 grants 同文件同闸**（端点无特权）。

**闸间顺序与不可降级性**：求值序 1→2→3，前者不过不进入后者；审批只发生在闸 2 且仅当 1、3 已通过。**profile 授权只能收窄、⛔ 放宽**工具的固有 `requiresApproval`/`sideEffects`——即「工具自述的固有风险属性是下限，档案只能更严」。



### 9.5 审计通道（跨阶段不变量——与 agent 引擎无关）



UI 手动执行也算一次调用：`{ traceId, ts, tool, subject, args(redact 规则), verdict: auto|approved|denied, result: ok|err(code), ms, configHash }` 行 JSONL。`configHash`=sha256(合并快照剔 secretRef)，trace 首行入记录，回溯「这次运行看到的配置」。审计文件本身 ⛔ 提交（§12.5）。



### 9.6 与域 C 的既有纪律同源



写矩阵（§12.2）约束的「谁能写哪张表」与 API 层的 `perm/sideEffects` 表**同源生成**（同一注册表投影，⛔ 两处各列一份）：`.verilogviz.json` 写方三轨（绑定对话框/固化/写全）= `bindings.*` 工具族的实现体（§9.1 的 `bindings.writeAll` 即写全/固化；单条对话框＝同族 `bindings.writeOne`，按需在注册表补录）——工具 id 域词表封闭 `{circuit, project, bindings, compile}`（§9.2），⛔ 另起 `config.*` 域。



## 10. ★ 阶段三 · agent 系统（两分支中立，细节延迟定稿）



### 10.1 分支 A · VS Code 宿主能力（Chat Participant / Language Model API / MCP 客户端）



- **宿主治理，我们不落盘**：模型选择与密钥、订阅计费、prompt 安全策略均属宿主；`.vv/` 下 **⛔ 出现 `providers/models/任何 key`**（v0.2 §9.3 在本分支整体作废）。

- **工具暴露**＝把阶段二 api.json 的 `mcp:true` 子集实现为 **MCP server（stdio）**；用户侧注册在 `.vscode/mcp.json` = **域 D**，协议文档只做对齐说明与校验提示（如读它、提醒未注册），⛔ 拥有它。

- 自定义 participant 的引导文件（instructions/prompt 模板）归域 D（`.github/` 或官方位置），我们只消费。

- 审计/授权闸**完全沿用阶段二**（§9.4/9.5）——MCP 连接即新 subject。



### 10.2 分支 B · 自建编排（LangGraph 族）——本节是其协议落点



```jsonc

{ "agent": {

    "engine": { "name": "langgraph", "runtime": "python3.x+sidecar | js-in-host", "version": "" },

    "graphsDir": ".vv/agent/graphs",

    "checkpoint": { "backend": "sqlite", "path": "${paths.agentDir}/checkpoints.db", "retentionDays": 30 },

    "models": { "default": "<provider>:<model>" },

    "grants": { "profile": "builder", "budgetPerThread": { "maxSteps": 40, "maxToolCalls": 80, "wallMs": 600000 } }

} }

```



- 仅列**接口面**字段（引擎/图目录/checkpoint 后端/模型别名/预算引用）；表内数值为占位说明 ⛔ 契约，立项时按实测重定（v0.2 的 checkpointer TTL 细节、9.7 并发数字即此理由下放）。

- 模型密钥走 `secretRef: "vv.provider.<name>.apiKey"`（§10.3），sidecar 经宿主 RPC 取 SecretStorage；`providers` 全表在本分支部署（放 `.vv/env.json` 的 provider 端，⛔ project.json），与分支 A 的模型治理彻底两路、互不引用。

- **声明 vs 资产**：`project.json` 的 `agent` 段是**引擎接线声明**（engine/graphsDir/checkpoint 路径/grants 引用）——不复制图内容；`.vv/agent/graphs/*.json` 是**图定义资产**——不声明引擎参数。二者单向引用（声明指向目录，资产不回流），读取序＝先解析 `agent` 段拿 `graphsDir` 再装载图。

- graph 注册表（节点 `task:"tool:<id>"` 引用 §9.1、非法引用 `API_TOOL_UNKNOWN`、审批链=同 §9.4 三闸）概念沿用 v0.2 §9.2，定稿于本分支立项。



### 10.3 分支公共不变量（现在就锁，防未来返工）



不管哪条分支：**工具=api.json、授权三闸、审批流（VS Code 原生弹窗通道）、审计格式、configHash 快照、engine 选择存 `runtime.json`（会话级）** 六件套跨分支同文——它们是阶段二交付物，阶段三只是“接端点”。



## 11. 合并策略（修订：分域、⛔ 一条链混三套）



- 域 A：VS Code 原生合并（用户→工作区），扩展经 `getConfig` RPC 下发；`configChanged` 即时。

- 域 C：目录链（近层胜），§5。

- 域 B（project/env/runtime/api）：project+api **工程基线** → `${env}` 注入（替换期）→ runtime 覆盖（⛔ 回写）。

- 域 D：宿主自决，我们只读不改写（对齐性校验除外）。

- 跨域同键＝冲突诊断 §8；数组：默认替换、显式 `"merge":"append|unique"`；`secretRef` 永不合并成真值。



## 12. 迁移、写入与演化纪律



1. **幂等迁移器**：v0.x→v0.y 每步可重入，检测文件头标记；迁移前 dirty git 状态**拒绝并提示 commit**（扩展侧纪律同源：⛔ 代提交并行改动）。

2. **写矩阵与锁**：project/api=编辑器或迁移 CLI（agent 工具 ⛔ 直接写，必经 `requiresApproval` 端点）；域 C=固化/写全/审计三轨；`.lock` + 原子 rename 前 `expectedSchemaVersion` 比对（阶段三多进程前提，阶段一无竞争也要装）。

3. **schemaVersion 硬规则**：major 无迁移器=红；读到更高 major=硬红引导升级；`apiVersion` 不兼容同报。

4. **`$schema`**：仅作编辑提示，校验通道=jsonValidation fileMatch（§4）。

5. **`.vv/.gitignore` 内容即规则表**：`env.json`/`runtime.json`/`audit/`/`agent/checkpoints*`/`cache/` 忽略；`project.json`/`api.json`/`api.grants.json`/`agent/graphs/` 提交；扩展首次 ensure 生成，⛔ 要求用户手写。



## 13. 与现有系统的映射 & 冗余裁定史



### 13.1 映射表（现状真源）



| 现有 | 协议 |

|---|---|

| `sandboxFiles.ts`/`gateSystem` 绑定链与三工具 | §5（协议=其文档化+schema 化） |

| dispatch RPC ×9 + commands ×25 + 两套右键 | **§9 三面雏形，阶段二收敛对象；⛔ 新发明平行层**（RPC 计数以 `dispatch.ts` case 表 ⇔ `vscodeHost` `rpc()` 对账为准，见 `tests/unit/vscodeShell.test.ts`；`listSandboxTree` 已改原生树⛔ 非 RPC） |

| `contributes.configuration` verilogViz.* | 域 A（v0.2 §7.1 现状表延续） |

| webview `settingsStore`（UI 偏好的 localStorage 旧部） | 阶段一收尾项=迁域 A 或 runtime（一次性迁移器，非本协议新债） |

| `src/lib/host/` 中立层 | §12.2/§10.2 边界的实现先例 |



### 13.2 冗余裁定史（三轮都犯过的病要留档）



- **v0.1 的病**：发明平行绑定结构/全硬件字段/user-workspace 第三轨。

- **v0.2 残留（本版裁定）**：§9 agent 把 langgraph 细节（providers/checkpointer TTL/并发预算数值/graph 节点全格式）写成第一期即入库的样——“提前发明无消费方字段”，与自身废除单自相矛盾 → 本版下放 §10.2“占位说明、立项定稿”；新增 **api/grants 等 `.vv/api.*` 文件不提前 create**（§3）；`meta.createdAt/updatedAt`、`workspace/user.json`、`partsDir` 等 v0.2 判定维持。

- **通例固化**：字段评审必答题——“哪个阶段、哪个消费方、今天跑不跑”；三问有一空缺即挂起，进 §13.3 待办档（新增本节）。



### 13.3 待消费确认清单（挂起字段登记）

`compileProfiles` 形状（阶段二后）、agent.graphs 节点 schema（分支 B 立项）、`checkpointer.retentionDays`/预算数值（分支 B 实测）、`telemetry`（无人提就删）、`scopes:["workspace"]` 细化（MCP 接真后）。**分支 B 立项必答清单（v0.3.1 登记，外部评审 P0/P1/P2 落点——立"必答问题"，⛔ 提前物化成 schema）**：graph `state.channels` 带 `reducer`（append/merge/replace）+类型+默认（checkpoint 恢复正确性前提）；节点级 `interruptBefore/After`（HITL）；`handoffs`+`maxHandoffs/onCycle` 防环；条件边参数化（`cond` 名 → path+expected，随首个复杂分支）；`staleAfterCommits` 定义钉死＝「checkpoint 创建时 graph 定义快照（configHash+graphHash）与恢复时对比」⛔ 按提交数猜；`engine` 拆 `mode(embedded|sidecar)×transport(stdio|http)`；废弃周期 `deprecatedSince/replacement`（§9.3 已有 `removed+replacedBy`，够用以至挂起）。



## 14. 示例（按阶段瘦身；示例文件 ⛔ 诱导超前创建）



### 14.1 阶段二末的样子（真实最小态）

```jsonc

// .vv/project.json —— 无 agent、无 compileProfiles、⛔ 任何 `bindings` 键（绑定真源只在域 C）

{ "schemaVersion": "0.3.0", "kind": "project", "$schema": "./schemas/vv-project.schema.json",

  "paths": { "outDir": "build" },

  "resolution": { "maxDepth": 8, "allowSelfReference": false } }



// .vv/api.json —— §9.1 实例（即阶段二主体）

// 域 C 样例 —— §5.2（根表+一层精控两条）

```



### 14.2 仅分支 B 才出现的（示意）

```jsonc

// .vv/project.json 的 agent 段——仅自建路线，值全为占位（§10.2）

{ "agent": { "engine": { "name": "langgraph" }, "graphsDir": ".vv/agent/graphs",

             "checkpoint": { "backend": "sqlite", "path": "${paths.agentDir}/checkpoints.db" } } }

// 分支 A（VS Code 宿主）路线：此段与整个 .vv/agent/ ⛔ 出现；注册在 .vscode/mcp.json（域 D）。

```



## 15. 实施路线（阶段×面×闸）



| 顺序 | 交付 | 闸门 |

|---|---|---|

| ① 现在可做 | `vv-bind/vv-project` schema + `jsonValidation` 挂载 + `.gitignore` 规则表 | 对现存 `.verilogviz.json` 全量试校验（零行为改动） |

| ② | 诊断归一：bindingErrors→§8 码进 Problems（`api` 源新增两码） | vscodeShell + 新格 |

| ③（阶段一收尾） | webview 旧 UI localStorage `settingsStore` 的退役/映射 | r8/r22 波及回归 |

| ④ 启动 | **api.json 注册表**=现 RPC+commands 的收敛投影：dispatch 与命令清单**同源生成**（三面共用注册表；UI 投影与 RPC 投影各一函数） | RPC 对账格升级（9 颗 ↔ api.json 双向相等，对账面 ⛔ 三处各写） |

| ⑤ | 审计通道 `audit/`（UI 手操也记）+ approval 桥（宿主弹窗） | 新格：审计行 schema/闸拒即记 |

| ⑥ 阶段三分岔 | 立项会议定分支；分支 A → MCP server 投影 + mcp.json 文档；分支 B → §10.2 agent 段 + graphs 落盘 | `API_TOOL_UNKNOWN/CONFIG_STAGE_SKIPPED` 两格 |

| ⑦ 二期档案 | 硬件工具链随首个消费者 | §7.2 条件 | |



## 16. 版本



- 协议版本：**v0.3.1**；修订日期：2026-10-16；状态：**待评审草案**。

- **评审修订（一致性补丁，2026-10-16）**：①审计落点 `.vv/agent/audit/` → **`.vv/audit/`**（与 §9.5「跨阶段不变量、与 agent 引擎无关」对齐，`.vv/agent/` 回归分支 B 专属）——§3/§9.1/§12.5 三处同步；②§9.4 补齐**闸间顺序与不可降级性**（求值序 1→2→3，审批只在闸 2 且 1/3 已过；profile 只能收窄不放松固有风险属性）；③§3 补 `api.grants.json` 行（二期尾·可选提交）；④`resolution` 从 `bindings.defaults` 命名空间**提升为 `project.json` 顶层**（§5.5/§14.1），杜绝与域 C `bindings` 真源的命名混淆；⑤§5.2 标注 djs/gate=画布部件、v/sv=编译闭包实现；⑥§10.2 补「声明 vs 资产」单向引用关系；⑦§9.6 工具 id 归口 `bindings.*` 词表，废除游离的 `config.write`。

- v0.3 变更摘要：①按“迁移→统一 API 层→agent”路线把协议**从空间三分域改为三域+时间轴**（§3 阶段列/§1 反超前铁律/`CONFIG_STAGE_SKIPPED`）；②新增 §9 API 层枢纽章——dispatch RPC 与 contributes 命令**定性为三面收敛对象而非平行发明**，能力契约/`apiVersion` 演化/三闸授权/审计跨端点一次锁定；③§10 agent 重写为 **VS Code 宿主 / 自建两分支中立**，宿主治理面（模型/密钥/prompt）**不落我们 JSON、域 D 化**，自建细节降级占位；v0.2 的 providers 明细、checkpointer 全字段、预算数值下放二期分支 B（登记 §13.3），§7.2 再延一档（“定稿时机＝API 层稳定后”）。

- 不变的东西：绑定权威链语义（§5 全文与 v0.2 同）、域 A/B/C 边界裁决、原子写/锁/演化铁律、密钥 secretRef 原则。