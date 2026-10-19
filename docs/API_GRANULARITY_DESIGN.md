# API 颗粒度设计（批次四提案）— 面向 agent/MCP 与本项目调试难度

> 状态：**批次四全收口（四-1 `e8b3ae2` · 四-2 `7caab8b` · 片0 `335ba7a` · 四-3 `b619a2c` · 四-4 `925027c` · 四-5 文档收口，2026-10-19）**——
> 中途曾按用户令暂停于四-2 后（HANDOFF 快照 `d39f73a`），同日恢复开发跑完四-3/四-4/四-5。
> 施工账＝账本卷七十第七/八节；交付读数＝CHANGELOG 批次四段；写面（L6）按裁决 §八.4 挂批次五逐颗拍板。
> 前提纪律（用户 2026-10-19）：先确保基本功能没问题——每颗新 API 的验收＝台架钉＋真宿主 harness＋脚本化 e2e（桥直调），
> **⛔ 依赖 LLM agent 试出来才算数**；AI 接入是最后一步，不是验收手段。
> 正本关系：本文定"该有哪些颗、颗粒度怎么分层、错误怎么说话"；工具账逐颗 schema 仍以
> registry＋契约为正本，`docs/API_REFERENCE.md` 照旧生成（⛔ 本文抄表当第二真源）。

## 一、设计输入＝本项目的病灶清单（全有案底，卷六十~七十/manual-notes）

| # | 病灶（真实咬过） | 对 API 的要求 |
|---|---|---|
| P1 | 扩展"半活"假象：activate 中段抛错，前段命令照常可用 | **激活进度可观测**（检查点账），一枪问出"跑到哪一步断的" |
| P2 | 假 API 自证：桩补了真宿主没有的 API | 运行时**能力探针**：API 层报"我现在真活着几颗"，与契约对账 |
| P3 | webview/custom editor 激活⇒activeTextEditor=undefined，粘滞档劫持（B/J/L/审计错报案） | agent 线**⛔ 隐式上下文**：一切目标必须显式实参；"当前是什么"要单独问得出来 |
| P4 | 绑定链（目录链合并＋前缀键＋circuits 名单＋同名兜底）解释不动，弹窗开错宿主 | **bindings.explain**：一颗实例一枪出完整解析轨迹 |
| P5 | 两解析器分岔（E2）、续行端口（G）、黑名单撞车（E） | **parse 检视**：把解析器的真实输出直接摊开对账 |
| P6 | 闭包收缩死锁（H）、bindingRefs 射程不透明 | compile.closure 回包补**诊断字段**（refs/为什么没收进来） |
| P7 | 静默失踪：菜单不显（contextValue 写错）、toast 没弹、打包缺目录 | **capability dump**：此刻真注册了什么（菜单/命令/语言/语法）可枚举 |
| P8 | 拒单只有"被拒"两个字 | 错误契约 v2：`code+message+traceId+hint`（下一步该打哪颗） |
| P9 | 大回包撑爆 agent 上下文（文件内容、电路 json） | 一切列表/读档**帽＋truncated 旗标**逐颗在册 |
| P10 | 双窗口/画布隐藏 panel dispose，openDocs 读数意外 | 宿主状态回包带**活体清单**（openDocs/panel/桥监听态） |

## 二、设计原则（颗粒度判据）

1. **一层一颗粒，一枪一问题**：agent 的每个调试问题应能用**一颗**工具回答；两颗拼出第三颗语义＝缺中间层。
2. **读粗写细**：只读面允许粗颗粒聚合枪（doctor 一枪全包）；写面保持细颗粒（逐颗可闸可账可回滚），⛔ 聚合写。
3. **显式目标**：mcp 面所有工具的目标＝必填实参（路径/文档/实例名）；"活动编辑器/粘滞档"这类宿主隐式态只许被**查询**（ctx.snapshot），⛔ 被**依赖**。
4. **错误会说话**：统一错误契约（§5），拒单必带 hint（下一步建议）；同一病灶⛔ 两种报法。
5. **回包有帽**：列表/文本类回包一律 maxBytes 帽＋`truncated`＋`total`，agent 永远知道"看见的是不是全部"。
6. **幂等优先**：读面全幂等（idempotent:true 在册）；写面幂等语义逐颗在契约 description 里说死。
7. **一颗一验**：新 API 的验收三件套＝台架行为钉＋harness 真宿主一步＋脚本 e2e 一枪；缺一不上账。

## 三、颗粒度阶梯（L0–L5）

```
L0 活着吗      sys.ping            ← 新增：亚毫秒健康探针（含激活检查点）
L1 有什么      sys.listTools / describeTool / getStatus（扩）
L2 现场是什么  sys.ctxSnapshot     ← 新增：宿主隐式态快照（编辑器/粘滞/画布/树）
L3 数据原文    bindings.get / circuits.list / res.readProjectFile /（新）res.readBindingTables
L4 派生分析    compile.closure / bindings.audit /（新）bindings.explain / res.parseFile / compile.hierarchy
L5 体检聚合    sys.selfCheck（调用层）/（新）project.doctor（工程语义层）
L6 变更（后续档）bindings.set → fs.* → compile.run   ← 逐颗拍板放开，全走 HITL/账
```

> L5 与 sys.selfCheck 的分工：selfCheck 答"**调用层**能不能用、哪道闸在拦"；doctor 答"**这份工程**哪里坏了"——两者颗粒度、失败域、受众都不同，⛔ 合并。

## 四、新工具规格（批次四主体＝L0/L2/L4/L5 只读六颗）

### 4.1 `sys.ping`（L0·半毫秒级活体探针）
- 目的：P1/P2/P10。桥/agent 进门第一枪，回答"扩展活着没、活到哪一步"。
- schema：`{}`（零实参）。
- 回包：`{ alive:true, activation:{ last:'watchers', done:true, checkpoints:[…], failedAt:null }, bridge:{ listening:true, pipe:'…', conns:1 }, uptimeMs }`
- 机制：**激活检查点登记簿**（新 `activationTrail.ts`）：activate() 每过一个里程碑 `mark('trees'|'commands'|'watchers'|'editors'|'bridge')`；
  抛错被外层 catch 时 `fail(stage, err.message)`——半活假象从此一枪可诊（检查点表同时进 getStatus 与 selfCheck）。
- 错误：无（这颗挂了＝真死了，桥侧超时即证据）。

### 4.2 `sys.getStatus`（L1·扩容，⛔ 新颗）
- 现回包基础上新增：`activation`（同上）、`bridge`、`openDocs`（活文档数——S 案教训）、`surfacesGlobal` 已有。

### 4.3 `sys.ctxSnapshot`（L2·宿主隐式态快照）
- 目的：P3。agent ⛔ 猜"现在编辑器里是谁"，一枪问出。
- schema：`{}`。
- 回包：`{ activeEditor: {path,languageId}|null, lastTextUri:path|null, activeSandboxDoc:{name,role}|null,
  compilePanel:{ open:boolean, entry:path|null, lastJob:{topModule,files:number} },
  visibleTabs:[…], treeFocus:null|'…' }`
- 语义：全部**如实转述**（含 null 与粘滞值），⛔ 判断"该用哪个"——判断留给调用方/显式实参。

### 4.4 `res.readBindingTables`（L3·逐层表原文）
- 目的：P4 的下半段——链合并**之前**的每一层原文（bindings.get 只给合并后）。
- schema：`{ dir?:string }`（缺省＝从根到该目录整链）。
- 回包：`{ chain:[{ dir, file:'…/.verilogviz.json', exists:boolean, circuits:[…], bindings:{…原文} }], truncated }`
- 帽：单层表 >64KB＝截＋旗标。

### 4.5 `bindings.explain`（L4·单实例解析轨迹）
- 目的：P4 主枪。一颗实例为什么解析成这个文件（或为什么没解析成），一枪说透。
- schema：`{ doc:string, instance:string }`（doc=根相对宿主文档；instance=实例名/celltype）。
- 回包：`{ doc, instance, askedKey:'top.v::adder',
  trace:[ { layer:'', table:'exists|missing', triedKey:'top.v::adder', hit:false },
          { layer:'lib', triedKey:'sub', hit:true, value:'lib/sub.v' } ],
  resolution:{ via:'recorded|missing-record|same-name-forbidden', file:'adder.v'|null,
    fileExists, definesModule:boolean, circuitsListSays:'part|circuit|n/a' },
  verdict:'resolved|BINDING_MISSING|BINDING_UNRESOLVED_RECORD|SCHEMA_INVALID',
  hint:'下一步该打哪颗'（如：verdict=MISSING ⇒ 'bindings.set {dir:".", celltype:"top.v::adder", part:"…"}'） }`
- 实现纪律：**吃 closureOf 的同一把解析函数**（一颗主人，⛔ 第二套判据——E2 双解析器教训）。

### 4.6 `res.parseFile`（L4·解析器输出摊开）
> **实现形状（四-3 落地注）**：divergence 增 mainSelfDiff（主仓自身两函数分岔=dff 族案底）；
> primitivesIgnored 落地为**三张跳表差集**（"本文件命中扫描"需第三把尺＝⛔ 发明，表差集才是 P5 的如实）；
> `.v` 非 ANSI 声明 ports 空数组＝parseModulePorts 现状如实。
- 目的：P5。把"解析器眼里的这份文件"原样吐出。
- schema：`{ path:string }`（工程根相对；.v/.sv/.vh/.djs）。
- 回包：`.v → { modules:[{name, ports:[{name,direction,width,isSigned}], instances:[{name,line,connections?}] }], primitivesIgnored:[…] }`；
  `.djs → { cells:number, subcircuits:[…], inputs:[…], outputs:[…] }`；帽 256KB。
- 口径：**主仓解析器（src/lib/verilogParse）与扩展侧 lite 各出一栏**（`parsers:{main,lite}`）——两解析器分岔从此肉眼可比，长期目标收敛成一颗（在册）。

### 4.7 `compile.hierarchy`（L4·实例树数据源）
> **实现形状（四-3 落地注）**：主人抽出为 buildHierDefIndex/hierInstancesOf（类改委托，⛔ 第二把尺）；
> 预算 500 颗＋64KB 帽（truncated+total+note）；line=parseVerilogInstancesWithLines 首现行（同判据两形）。
- 目的：P3/层次树调试——层次树显示什么，agent 直接问同一份数据。
- schema：`{ entry:string, depth?:number(帽4) }`。
- 回包：`{ root, nodes:[{ chain, instance, module, defFile|null, line }] }`——与 HierarchyTree.getChildren 同一把主人。

### 4.8 `project.doctor`（L5·工程语义体检聚合）
- 目的：一枪回答"这份工程现在几处坏、各坏在哪、分别打哪颗修"。
- schema：`{ dir?:string（缺省全工程）, probe?:string（顺带预演一颗写工具的闸，⛔ 执行） }`。
- 回包（全幂等只读，帽 128KB）：
  `{ files:{ scanned, parseErrors:[{path,msg,line}] },
     bindings:{ hosts:[{doc, missing:[…], unresolved:[…]}] },      // 逐宿主文档跑 audit 内核
     tables:{ malformed:[{path, why}] },                            // json 坏/形状歪的表
     closure:{ entry|null, ok, bindingErrors:[…] },                 // 若给了 probe/有活动入口
     verdicts:[ { id:'B1', sev:'error|warn|info', what, where, nextTool, nextArgs } ],
     truncated }`
- 纪律：doctor ⛔ 新逻辑——全部**复用既有内核**（parse/collectInstanceHits/closureOf），聚合层只搬运排序。

## 五、错误契约 v2（跨所有颗，含存量）

```
{ ok:false, code, message, traceId, hint?, cause? }
```
- code 枚举（在册，⛔ 自由发挥）：`NOT_REGISTERED / SURFACE_DENIED / NOT_GRANTED / NOT_APPROVED / BAD_ARGS /
  NOT_FOUND（路径/文档/实例查无）/ TOO_LARGE / HANDLER_ERROR / BAD_REQUEST`（后三颗桥/执行器已有语义收编）。
- **hint 是硬要求**：每道闸、每种 NOT_FOUND 的抛出点必须给"下一步打哪颗、带什么实参形状"（一句模板即可，进台架钉）。
- 存量 ToolError 加 `hint?` 字段＝向后兼容（回包多一颗键，⛔ 破坏形状）。

## 六、健壮性机制（非工具，但同批落地）

1. **激活检查点登记簿**（activationTrail.ts，P1）：`mark(stage)` / `fail(stage,err)` / `snapshot()`；activate 全链插桩；
   读数进 ping/getStatus/selfCheck 三张脸。台架钉：故意让某段抛错 ⇒ snapshot.failedAt 指对段。
2. **回包帽纪律**（P9）：新颗一律带 maxBytes＋truncated；台架各钉一颗超限形状。
3. **一颗一验**（§2.7）：harness 每加一颗只读新工具＝加一步真管道枪（现在 9 步 → 15 步）。
4. **mcp 面准入**：六颗新工具**全 read/无副作用** ⇒ 直接进 mcp 面（锁⑤自动放行）；写面（L6）本批⛔ 动。

## 七、分期与验收（拍板后开工序）

| 期 | 内容 | 验收 |
|---|---|---|
| 四-1 | activationTrail＋ping/getStatus 扩容＋ctxSnapshot（P1/P3/P10 三针见血） | 台架：检查点抛错钉、ctx 如实钉；harness：ping/ctx 两枪；e2e 脚本 |
| 四-2 | readBindingTables＋bindings.explain（P4 双枪，复用 closureOf 内核） | 台架：链轨迹钉（前缀/裸键/缺账/坏值四形）；harness：explain 一枪 |
| 四-3 | parseFile＋hierarchy（P5/P3） | 台架：两解析器对账钉（同文件 main/lite 差集必须空或如实报）；harness 一枪 |
| 四-4 | project.doctor＋错误契约 v2 hint（聚合＋存量收编） | 台架：doctor 对四份坏工程样本的 verdicts 钉；hint 全覆盖锁（每 code 至少一颗样本钉） |
| 四-5 | 文档再生成＋账本＋小步提交；**然后**才谈 AI 接入试跑 | 全量台架＋harness failed=0＋脚本 e2e 录屏级读数 |

## 八、裁决（用户令「听你意见：功能野心、谨慎开发、先落文档、稳步收束」，2026-10-19 代拍）

1. **六颗新工具照单全收**，含 `res.parseFile` 双解析器并呈——旧债摊开给 agent 看正是 API 的价值；
   两解析器收敛成一颗是独立战役（在册 P5 后续），收敛前并呈＝如实。
2. **hint 顺带进存量**（四-4 一屏改完）：同一份错误契约⛔ 两种口径——新颗老颗都得会说话。
3. **doctor 的 info 级默认关**（`deep:true` 显式开）：能力在场＝野心，噪声出场＝要代价；缺省读数只留 error/warn。
4. **写面（L6）挂批次五**，doctor 跑顺＋e2e 读数攒够再逐颗拍——HITL 路已在场，放开只是契约一行，⛔ 抢跑。

> 施工纪律再钉一遍：每期＝台架钉＋harness 真管道枪＋脚本 e2e 三件套齐才落刀提交；
> 六颗新工具全 read/无副作用 ⇒ mcp 面准入由锁⑤自动放行；`surfacesGlobal` 不动。
