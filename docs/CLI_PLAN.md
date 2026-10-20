# CLI 端点规划（阶段四立项书）

> 状态：**待拍板**（本文档只立项，未开工）。
> 前置账：统一调用层批次一～五全收口（§一）；MCP 活编辑器桥已真宿主＋Trae 双客户端实证（2026-10-20）。
> 用户意向：CLI「可以在 opencode 的基础上修改」——本规划按此展开，⛔ 自建编排（分支 B LangGraph 继续挂起）。

## 〇、三问三答

| 问 | 答 |
|---|---|
| 统一 API 层阶段完成了吗？ | **主体收口**。注册表/闸/账/契约/漂移闸/四端点里的三端（ui·rpc·mcp）全落地；治理四件套里 HITL＋permission 三闸在场，undo/snapshot 挂账（不阻塞 CLI，见 §六.4）。 |
| 可以规划下一步吗？ | 可以。`ToolSurface` 第四值 `'cli'` 是阶段二就预留的槽（toolRegistry.ts:24；CONFIG_PROTOCOL §9 四端点同注册表），CLI 就是这张既定图纸上最后一颗端点。 |
| 可以开始实现 CLI 吗？ | **可以立项，按 M0→M1→M2 收束推进**；先零代码接入拿实测读数，⛔ 一上来就 fork opencode。 |

## 一、统一调用层收口账（证据）

| 批次 | 交付 | 状态 |
|---|---|---|
| 一 | 文件系统十工具上账（toolsFs） | ✅ |
| 二 | bindings/circuits/res/compile/sys 四族十四工具（toolsDomain，§15 范式） | ✅ |
| 三 | RPC 九颗收编同一执行器＋深度四档（D0–D3）＋MCP 活编辑器桥（命名管道） | ✅ |
| 四 | 颗粒度扩容 L0/L2/L4/L5 六颗（ping/doctor/explain/hierarchy 等） | ✅ |
| 五 | 写面 L6 全部放开（用户拍板 2026-10-19） | ✅ |
| 漂移闸 | `api:doc` 再生成即红＋i18n 完备性闸 | ✅ |
| 缺陷清账 | argUri 根相对病／读侧分岔／桥 30s 硬超时——三案修复，真宿主 verify1(V1–V10)＋verify2(HITL 219s 回包不丢)＋Trae 六枪全绿 | ✅ 2026-10-20 |

**挂账（⛔ 装样子，toolsDomain 头注在案）**：undo/redo、snapshotState/restoreState、checkPermission 策略引擎、subscribe hook、readMemory/writeMemory。其中 undo/snapshot 与 agent 写面安全直接相关，列入 §六.4 拍板。

## 二、CLI 的两种形态（分轨，⛔ 混谈）

| | 形态 A · agent 客户端（主线） | 形态 B · headless 工具 CLI（另轨，后置） |
|---|---|---|
| 是什么 | 终端 AI agent（opencode 为基础）**经现有 MCP 桥**打工具面——与 Trae 同构，只是客户端换终端 | `vv-cli` 直跑 Node、⛔ 基座在场，吃注册表 `cli` 面子集（编译/审计/闭包等盘上可算项） |
| 依赖 | 基座活着＋工程开着＋mcp 开关（桥不代办，当面报错） | 需先把工具内核从 `vscode` import 里剥出来（真工程量，闸/账/审计都得重接） |
| 建议 | **先做**（M0 今天就能跑） | 排在 A 收口后，单独立项 |

用户说的「在 opencode 基础上修改」＝形态 A。B 是 CONFIG_PROTOCOL §9 那句「headless CLI」的还账，两者别互相等。

## 三、形态 A 设计要点

### 3.1 接入三档（逐级收束，能停在上档就 ⛔ 下档）

1. **档 1 · 配置接入（零代码）**：opencode 的 `opencode.json` `mcp` 字段注册现有桥（local/stdio 型）：

   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "mcp": {
       "verilog-visualizer": {
         "type": "local",
         "command": ["node", "d:/Visual Studio Code/Something/verilog-visualizer/mcp/mcp-server.cjs",
                     "--project", "D:/vv-it-manual"],
         "enabled": true
       }
     }
   }
   ```

   （键名形状以 M0 实测为准——opencode 文档存在两代格式（`mcp` 与 v2 `servers`），⛔ 照抄文档。）

2. **档 2 · 轻整合（⛔ fork）**：工程级 `opencode.json` 模板进仓（`examples/`）、自定义 slash commands（`.opencode/command/`）封装高频流（如 `/vv-doctor`＝project.doctor deep、`/vv-explain <doc> <inst>`）、MCP_CONNECT.md 补 opencode 段。

3. **档 3 · 修改 opencode（fork，红线见 §六.3）**：只有档 1/2 实测收不住（超时、HITL 反馈、管道发现）才进，且最小 diff＋上游 rebase 纪律。

### 3.2 必须实测的行为点（M0 读数）

| 点 | 已知 | 待测 |
|---|---|---|
| HITL 长等待 | 桥侧已给审批工具 600s 窗口（mcp-server.cjs 分档超时） | **opencode 自身 MCP 客户端超时**——若 <600s，弹窗没点完 agent 侧先丢回包（与 Trae 案同型风险，这是 fork 判定的第一证据） |
| 审批体验 | 弹窗在 VS Code 原生侧，终端用户要切窗点「允许」 | opencode 对 tool error/超时的呈现；能否在终端给「去基座窗口批准」的提示（档 2 可用 command 文案兜） |
| 连接前提 | 管道名＝工程根哈希，一工程一管道 | 基座没开/opencode 先起时桥的报错是否被 opencode 呈现得可读；重连行为 |
| 平台 | 桥＝Windows 命名管道，node 直跑 | opencode Windows 支持现状（终端体验、安装通道） |

### 3.3 治理对齐（端点无特权，§9 宪法延续）

- **闸/账 ⛔ 第二套**：opencode 走桥＝同一 executeTool、同一三闸、同一 jsonl 审计（现落 `channel=mcp, subject=agent`）。
- **subject 区分**（待拍板 §六.2）：若要账本分得清「Trae 打的」vs「opencode 打的」，桥请求带一记 `caller` 字段＋扩展侧透传落账（小改，契约侧一行面）。
- **grants**：`.vv/api.grants.json` 的 profile 按连接端点绑定（reviewer/builder）——CLI 进程绑 profile 的规则与 MCP 连接同闸，⛔ CLI 特权。

## 四、开工前侦查清单（半天内可清）

1. opencode 本机装通（Windows）＋档 1 配置实跑 sys.ping；
2. 读 opencode 的 MCP 客户端超时实现（配置项？硬编码？）——§3.2 第一行的答案；
3. opencode plugin API 覆盖面（能否注入工具钩子/事件，决定档 3 要不要 fork）；
4. 许可证与 fork 维护基线（上游迭代节奏）。

## 五、里程碑与验收

| | 内容 | 验收读数 |
|---|---|---|
| **M0 零代码** | 档 1 接入＋§3.2 四点位实测＋§四侦查 | ping/hierarchy/doctor/audit/explain/toggle 六枪全绿（与 Trae 案同判据）；HITL 删除一枪：记录 opencode 侧超时行为与回包去向 |
| **M1 轻整合** | 档 2：工程模板＋slash commands＋MCP_CONNECT.md opencode 段 | 三幕流（编译模式/沙盒/需求变更分析）在终端各一键跑通；真宿主回归照旧 |
| **M2 收束拍板** | 按 M0/M1 证据三选一：plugin 收束 / 最小 fork / 维持现状 | 决议落 AGENT_ARCH_DECISION 追加节 |
| **M3（另轨）** | 形态 B headless vv-cli 立项书 | 先交「内核可 headless 化」评估（vscode import 剥离面＋闸账重接方案），⛔ 直接开工 |

## 六、开放拍板（等用户点头才动）

1. **主线确认**：A 先 B 后、B 单独立项——按本文执行？
2. **审计 subject 区分**：桥带 `caller` 落账（小改）要不要？
3. **fork 红线**：默认 ⛔ fork；只有 M0 超时实测收不住才进档 3，且最小 diff——同意？
4. **治理挂账时机**：undo/snapshot（agent 写面回退底座）排在 CLI M1 后单批，还是 CLI 期间并行？
5. **HITL 终端体验**：若 opencode 超时 <600s 且不可配置——选项：a) 桥侧加「非交互自动拒绝＋提示」；b) 审批类工具对 cli 面默认关（契约一行）；c) fork。倾向 b→a→c。

---
*本文档为立项书；执行从 M0 起，每档收口回 CHANGELOG 落账。Sources: [opencode Config](https://opencode.ai/docs/config)、[opencode MCP 服务器](https://opencode.ai/docs/zh-cn/mcp-servers/)*
