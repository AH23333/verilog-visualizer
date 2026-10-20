# MCP 接入指南 — 外部 agent 连活编辑器桥

> 面向要把本工具链接入自家 agent（Claude/Trae/Cursor 等 MCP 客户端）的接入方。
> 名册与 schema **⛔ 在本文抄表**（第二真源＝漂移源）：以 `sys.listTools` 现读为准，
> 逐颗文档＝[API_REFERENCE.md](./API_REFERENCE.md)（由 `pnpm api:doc` 随契约生成）。

## 一、前置（三缺一连不上，报错会告诉你缺哪颗）

1. **Verilog Visualizer 基座正在运行**，且目标工程文件夹已在其打开（桥服务端＝扩展内 `mcpBridge.ts`，
   管道名＝工程根 sha1，工程没开＝探不到活服务）。
2. **契约 mcp 开关开着**（内置契约 `surfacesGlobal.mcp=true`；工程 `.vv/api.json` 只能再关不能开）。
3. Node ≥ 18（`mcp-server.cjs` 零依赖，只用 `net/crypto/os/path`）。

## 二、接入配置（MCP 客户端侧）

```json
{
  "mcpServers": {
    "verilog-visualizer": {
      "command": "node",
      "args": ["<本仓绝对路径>/mcp/mcp-server.cjs", "--project", "<工程文件夹绝对路径>"]
    }
  }
}
```

- `--project` 必须与基座里打开的工程根**同一路径**（大小写/斜杠无所谓，sha1 前折叠归一；不同＝不同管道）。
- 双开同工程：后起的基座窗口自动让位，agent 连谁都是同一份闸与账。
- 桥进程**零判断**：所有闸（登记/面/授权/必填/审批）与审计都在扩展侧 `executeTool`；
  `tools/list` 现读 `sys.listTools` 过滤 `surfaces∋mcp`——契约改了立刻可见，⛔ 客户端侧缓存名册。

## 三、接入前/升版后冒烟（一条命令证明全链在线）

```powershell
node mcp/smoke.cjs <工程文件夹>
```

initialize → tools/list（名册在场校验）→ 四枪只读真调用（`sys.ping`/`res.listProject`/
`sys.describeTool`/`project.doctor`），逐发报时延与形状判定；**退出码＝失败颗数**，全绿打印 `SMOKE PASS`。
外部 agent 接入前、扩展升版后各跑一次即可。

## 四、调用语义（agent 该知道的五件事）

1. **进门第一枪打 `sys.ping`**：回答"扩展活着没、activate 跑到哪一步断的、桥在不在听"。
2. **⛔ 依赖隐式上下文**：一切目标（doc/path/entry/instance）都是**显式实参**；"现在编辑器里是谁"
   用 `sys.ctxSnapshot` 查询，⛔ 猜。
3. **错误会说话**：拒单回包 `{ok:false, code, message, traceId, hint?}`——`hint` 直接给"下一步打哪颗、
   带什么实参形状"；code 枚举与逐颗 schema 见设计稿 §五与 API_REFERENCE。
4. **回包有帽**：列表/文本类带 `truncated`＋`total`；看见的未必是全部，按帽翻页/缩范围。
5. **写面有 HITL**：`fs.delete` 等标了 `requiresApproval` 的颗，agent 线（非交互）会弹审批到用户屏幕，
   用户不批＝`NOT_APPROVED` 上账回错——这是设计，⛔ 重试轰炸。

## 五、审计与排障

- 每枪都上账：工程 `.vv/audit/trace-YYYY-MM-DD.jsonl`（`sys.readAudit` 读；`.vv/` 未开户则丢行且
  需重启窗口才补上——在册语义）。
- 被拒排查顺序：`sys.ping`（活没活）→ `sys.selfCheck`（哪道闸在拦、拦了去哪改）→ 回包 `hint`。
- 协议底层（调试用）：客户端↔桥＝stdio JSON-RPC 2.0；桥↔扩展＝命名管道 NDJSON
  `{id,tool,args}` → `{id,ok,result|code,message,traceId}`；单行帽 1MB，逐枪串行回包。

## 六、边界（接入方须知）

- mcp 面在册颗数以契约为准（读/写皆已开面；写面逐颗经用户拍板放开，见 CHANGELOG R161 批次五/六段）。
- 桥只服务**这一个工程**（`--project` 定死）；多工程＝多客户端实例各连各的。
- 管道 ACL＝Windows 同用户会话（本地他用户/远程不可达）；⛔ 把它当远程 API 用。
