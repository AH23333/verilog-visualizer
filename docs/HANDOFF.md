# 开发交接与边界（HANDOFF）— R160 批次四阶段性收尾快照

> ⚠ **2026-10-19 再更新（API 深度战役两波收口）**：波次一 `3a0af2f`（真管道 400+ 枪，四族缺陷）、
>   波次二 `f42942f`（第五族类型闸＋前账清偿）。第九节欠账（文案收口版 bundle 未同步基座）**已清**：
>   bundle 已装基座并经 **harness 17/17 failed=0 ＋ e2e 修正版 85/86（唯一红点＝判据自纠）** 双复验；
>   台架 **327/327**。读数正本＝账本卷七十第九/十节＋CHANGELOG 深度战役段。
>   下一步不变：写面（L6）批次五逐颗拍板（裁决 §八.4）与 AI 接入试跑（另议）。以下按批次四收口时点存档。
>
> ⚠ **2026-10-19 三更（R161 i18n 英文国际化 S1 已收口）**：设计正本＝`docs/I18N_DESIGN.md`（覆盖分期表在 §四）；
>   manifest 全双语＋i18n 内核两侧＋前端画布面 ~70 串；台架 **339/339** · harness **17/17 failed=0**。
>   S2 已推进：器件右键菜单＋器件目录/连线 DRC/侧栏＋**SandboxCanvas 深串全量**（SHARED_VOCAB 登记制 65 键＋示例名；
>   drc 局部 t 遮蔽事故已追补——迁移前扫遮蔽已入纪律）；余各弹窗/doc 长文/扩展运行时消息；API 契约串另议。

> ⚠ **本快照已成历史（2026-10-19 当日恢复开发）**：四-3（`b619a2c`，片0 前置 `335ba7a`）、
>   四-4（`925027c`）、四-5（文档收口）**均已跑完落袋**——§六 待办 1~3 清账，批次四全收口。
>   施工账与读数＝账本卷七十第八节＋CHANGELOG 批次四段；§三 纪律十条、§四 环境命令、§五 已知坑仍然有效。
>   下一步只剩：写面（L6）批次五逐颗拍板（裁决 §八.4）与 AI 接入试跑（另议）。以下原文按暂停时点存档。
>
> 状态：**2026-10-19 用户令暂停开发**，本文是暂停点 `7caab8b`（分支 `agent`）的交接正本。
> 后续代理（含本代理再次接手）**先读本文再动手**。本文只写"现状、边界、纪律指针、环境命令"，
> ⛔ 复制各正本内容（设计规格、契约表、账本叙事各有唯一真源，见 §一）——第二真源＝漂移源。
> 恢复开发的入口＝§六 待办清单 + 设计稿 §七 分期表。

## 一、开工前阅读顺序（正本清单）

| 序 | 文档 | 管什么 |
|---|---|---|
| 1 | 本文 | 现状快照 / 边界 / 环境命令 / 坑 |
| 2 | [API_GRANULARITY_DESIGN.md](./API_GRANULARITY_DESIGN.md) | **批次四设计与裁决正本**：十病灶 P1~P10、L0~L6 颗粒度阶梯、六颗新工具规格（§四）、错误契约 v2（§五）、分期验收（§七）、四条裁决（§八） |
| 3 | [DEVELOPMENT.md](./DEVELOPMENT.md) | 环境、脚本、质量闸门体系、提交与账本规范 |
| 4 | [PROJECT_DEEP_REVIEW_2026-10-05.md](./PROJECT_DEEP_REVIEW_2026-10-05.md) 卷六十六~七十 | 批次一~四全程账本（API 层收编、MCP 桥、真宿主测试、四-1/四-2 施工记录） |
| 5 | `extension/api/vv-api.defaults.json` ＋ [API_REFERENCE.md](./API_REFERENCE.md) | 工具契约正本＝registry＋契约 json；API_REFERENCE 由 `pnpm api:doc` **生成**，⛔ 手改 |
| 6 | `c:\Users\34697\.trae-cn\memory\projects\...\project_memory.md` | 项目级硬约束（双模式活动栏拆分、绑定持久化 `.verilogviz.json`、QuickPick 单弹窗两级导航、绑定前缀键作用域）与工程惯例、在册教训 |
| 7 | [REAL_HOST_E2E.md](./REAL_HOST_E2E.md) ＋ `tests/manual-notes.md` | 真宿主测试与上屏走测案底 |

## 二、暂停点状态快照（2026-10-19）

- 分支 `agent`，HEAD `7caab8b`，**无上游、未 push**（push 欠账持续累计，⛔ 未经用户令不推）。
- 工作树干净；两个未跟踪项**非交付物、勿动勿提交**：`docs/mem.txt`（旧窗口便签）、`test_files/新文件夹/`（用户真机测试数据）。
- 暂停点复验读数：**vitest 305/305**（11 文件，2026-10-19 收尾时亲跑）· 真宿主 harness **13 步 failed=0**（四-2 提交时验）· e2e 桥直调全绿。
- 基座：`D:\vv-studio\vscode`，已载四-2 终态扩展；探针工程 `D:\vv-it-manual`。

### 批次四进度（分期表正本＝设计稿 §七）

| 期 | 内容 | 状态 |
|---|---|---|
| 四-1 | activationTrail＋sys.ping＋getStatus 扩容＋sys.ctxSnapshot | ✅ `e8b3ae2`（台架 4 钉 298/298×3 · harness 11/11 · e2e 两枪） |
| 四-2 | res.readBindingTables＋bindings.explain（复用 closureOf 内核） | ✅ `7caab8b`（台架 7 钉 305/305×2 · harness 13/13 · e2e resolved 轨迹实读） |
| 四-3 | res.parseFile＋compile.hierarchy | ⏸ **未动刀**（上一窗口只读了 `verilogParseLite.ts`，无任何半成品代码进仓） |
| 四-4 | project.doctor＋错误契约 v2 hint（含存量收编） | ⏸ 未开始 |
| 四-5 | 文档再生成＋账本＋CHANGELOG 收口提交 | ⏸ 未开始（四-1/四-2 条目已先行记入 CHANGELOG 批次四段） |

## 三、开发纪律（违反＝返工，条条有血泪案底）

1. **一颗一验三件套**：每颗新工具＝台架行为钉＋真宿主 harness 一步（`tests/integration/suite.cjs` 加步骤）＋脚本化 e2e（桥直调）；**⛔ 以 LLM/AI 试跑为验收手段**——AI 接入是批次四之后的独立步骤，前提＝基本功能没问题（用户 2026-10-19 令）。
2. **契约上账**：新工具必进 `vv-api.defaults.json`（access=read / risk=none / surfaces 含 mcp），随后 `pnpm api:doc` 再生成 `API_REFERENCE.md`——漂移当场红。
3. **一把主人一把尺**：⛔ 第二套判据。explain 吃 closureOf 同一内核；四-3 的 hierarchy **必须与 `HierarchyTree.getChildren` 同一把主人**（trees.ts），parseFile 的 lite 栏直接用扩展侧 `verilogParseLite`、main 栏用主仓 `src/lib/verilogParse`——**并呈是设计裁决（§八.1），⛔ 为"好看"擅自收敛成单栏**。
4. **错误契约 v2**：`{ok:false, code, message, traceId, hint?}`；code 枚举在册（设计稿 §五）⛔ 自由发挥；四-4 起每道闸抛出点必给 hint。
5. **回包有帽**：列表/文本类一律 maxBytes＋`truncated`＋`total`（各颗帽值见设计稿 §四）。
6. **⛔ 桩上出现 extHost 公开面没有的 API**（假 API 自证事故，卷六十九）：桩补了真宿主没有的东西＝台架全绿真机必炸；拿不准就先真宿主 harness 验。
7. **⛔ 逐字序断言赌 setTimeout 时序**（四-1 桥补点 flake 亲证）：异步补账的读数用**轮询到落账或超时、两态都如实**，不赌"再等一拍"。
8. **mcp 面锁⑤**（vscodeShell）：mcp 面 ⛔ 有副作用工具——写面（L6：bindings.set/fs.*/compile.run）放开＝批次五逐颗显式拍板，⛔ 抢跑。
9. **小步提交**：commit message＝批次号＋病灶编号＋验证读数；`git add` 点名文件，⛔ `git add -A`（会卷进 mem.txt/用户测试数据）。
10. **UI 既有硬约束**（project_memory）：树右键菜单单条件匹配；视图顶部按钮必须有图标；QuickPick 单弹窗两级导航；Webview `acquireVsCodeApi` 全局单例。

## 四、环境与命令速查（全部命令驱动，⛔ 长期占屏——用户偏好）

```powershell
# 构建扩展
pnpm -C "d:\Visual Studio Code\Something\verilog-visualizer" ext:build
# 台架（vitest，tests/unit/**）
pnpm -C "d:\Visual Studio Code\Something\verilog-visualizer" test
# API 文档再生成（契约漂移锁）
pnpm -C "d:\Visual Studio Code\Something\verilog-visualizer" api:doc
# 真宿主 harness（⚠ 会 taskkill 基座；跑完基座即死，e2e 前须重启）
node tests/integration/run.cjs          # 退出码＝失败颗数；结果账 %TEMP%\vv-it-result.json
# 装基座（⛔ pnpm 包装会抽风，直跑 node）
node studio/apply-brand.mjs --fork=D:/vv-studio/vscode
# 重启基座（harness 之后必做，等 ~18s）
Start-Process cmd '/c','scripts\code.bat --user-data-dir=D:\vv-studio\profile D:\vv-it-manual' -WorkingDirectory 'D:\vv-studio\vscode'
```

- **e2e 桥直调**：`node mcp/mcp-server.cjs --project <工程>`（该工程须正开在基座里）；NDJSON 协议
  请求 `{"id":…,"tool":"<id>","args":{…}}` → 回包 `{"id":…, "ok":true,"result":…}` 或 `{"id":…, "ok":false, "code", "message", "traceId"}`。
  扩展侧服务端＝`extension/src/mcpBridge.ts`（管道名＝工程根 sha1；双开让位；`bridgeSnapshot()` 含 skipped 原因）。
- **e2e 驱动脚本写 `$env:TEMP`，用完即删，⛔ 进仓。**
- 台架 seam：`VV_MCP=off`（vitest 里 activate ⛔ 碰真管道）。

## 五、已知坑（接手前扫一遍）

- **harness 杀基座**：`run.cjs` 收尾 taskkill——任何 e2e 前先看基座活着没（`sys.ping` 一枪问）。
- **`.vv/` 未开户 ⇒ 审计丢行**且 vvReady 进程内缓存：开户后须重启窗口（在册语义，⛔ 当 bug 修）。
- **扩展打包必含 `grammars/` 与 `schemas/`**（真机静默缺失案底）——改 `vsce` 打包清单时盯住。
- **QuickPick 不支持多实例叠放**（会话闪退案底）；**`acquireVsCodeApi` 重复调用抛异常**（通道哑火案底）。
- **树项 contextValue 写错 ⇒ 右键菜单完全不显**；无图标命令进不了视图顶部按钮。
- **webview/custom editor 激活 ⇒ `activeTextEditor=undefined`**——一切目标走显式实参，隐式态只许 `sys.ctxSnapshot` 查询（P3）。
- 台架全绿≠真机能用：宿主原生 API 行为差异必须真宿主集成测试覆盖（卷六十九教训）。

## 六、恢复开发待办（接手即从这里开工）

1. **四-3**（规格＝设计稿 §4.6/§4.7，验收＝§七行 3）：
   - `res.parseFile{path}`：`parsers:{main,lite}` **双解析器并呈**；台架对账钉——同文件 main/lite 差集必须为空**或如实报差**（⛔ 掩盖分岔，收敛是独立战役 P5）；帽 256KB。
   - `compile.hierarchy{entry, depth≤4}`：与 HierarchyTree 同一把主人，回包 `{root, nodes:[{chain,instance,module,defFile,line}]}`。
   - 三件套：台架钉＋harness 加一步＋e2e 一枪；契约上账；`pnpm api:doc`。
2. **四-4**（§4.8＋§五）：`project.doctor`——⛔ 新逻辑，全复用 parse/collectInstanceHits/closureOf 内核聚合；info 级默认关（`deep:true` 显式开，裁决 §八.3）；错误契约 v2 hint 进存量：每道闸抛出点给"下一步打哪颗"，每 code ≥1 颗样本钉（hint 字段向后兼容，⛔ 破坏形状）。
3. **四-5**：文档再生成＋账本卷七十第八节＋CHANGELOG 批次四收口＋提交。
4. **然后才**谈 AI 接入试跑（用户前提已达＝基本功能全绿；接入方式届时另行拍板）。

## 七、边界（后续代理 ⛔ 清单）

- ⛔ push（无用户令）；⛔ 在用户仓库造没人要求的文件（管道/临时物一律 %TEMP 或 .vv/ 在册路径）。
- ⛔ 以 AI 试跑当验收；⛔ 写面/副作用工具进 mcp 面（批次五逐颗拍板前）。
- ⛔ 新建第二真源：工具表以 registry＋契约为准，颗粒度/裁决以设计稿为准，账本叙事以 PROJECT_DEEP_REVIEW 为准——本文只放指针与快照。
- ⛔ 擅自"收敛"双解析器、擅自改绑定语义/UI 硬约束——超出批次四范围（只读工具＋错误契约＋激活插桩）的改动，先停下问用户。
- ⛔ 长时间占用屏幕测试：命令＋台架＋harness＋e2e 脚本优先，剩余真机点验交用户（用户偏好）。
