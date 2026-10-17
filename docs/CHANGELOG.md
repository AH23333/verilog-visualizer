# Changelog / 变更日志

本项目所有值得注意的变更都记录于此。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
版本以开发批次 `R<n>` 为主键（首个正式 release 前）。

本项目变更以开发批次 `R<n>` 为主键；条目按批次倒序。

---
## [未发布 Unreleased] — R155：统一调用层阶段三（RPC 收编 + 给 agent 的深度四档）（2026-10-18 夜·同一夜）

> 顺序仍按用户令：完善系统 → 深度检验 → **构建统一 API 层**（与文档同批）。
> 这一批把「闸与账」收成一套主人，再把 agent 最坏情况下的调试面（"我被谁拦了、为什么"）做成能查的读数。

### Changed
- **RPC 那 9 颗收编进 `executeTool`**（`extension/src/dispatch.ts`）：修前 `dispatch` 自带一份四闸＋一层审计壳，
  与 `executeTool` 是**两套并行实现**——同一句"谁能调用什么"两个主人，RPC 侧因此⛔ 实参必填检查、
  审计把通道名写进 `subject`、`approved` 由契约反推而⛔ 真审批。现在本文件只余名册 `RPC_METHODS`
  （＝`registerRpcTools` 的登记清单）与实现体 `dispatchCore`。
  名册⛔ 再在 `dispatch()` 里挡一次幽灵 method：**前置抛错会绕过账本**（见下面 Fixed 第一条）。
- **回包形状一份主人**：新增 `dispatchAndReply()`，Panel 与 custom editor 两条装载线各写一份 `reply()` 的时期结束；
  被闸拦下时回包带 `trace`（＝`ToolError.traceId`）。
- **文档生成器不再说谎**：`apiDoc.ts` 那句「待迁 N 颗」以前无论 0 颗还是 9 颗都印同一句
  "闸已在跑（dispatch 入口那份内联四闸）"，收编完就成了描述一份不存在实现的说明书；现按颗数换说法。

### Added
- **给 agent 的深度四档**（只读，契约 `surfaces: ui/mcp/cli`；协议见 CONFIG_PROTOCOL §9.7）：
  D0 `sys.listTools`（全表浅档）／D1 `sys.describeTool`（单颗全档＋**闸前预演**，⛔ 执行 handler）／
  D2 `sys.selfCheck`（整套调用层现在能不能用：契约规模、registry∧契约双向漂移、工程覆盖载入结果、
  授权档案在不在跑及其告警、审计三张脸＋当日 verdict 统计与最近拒单，可选 `probe`）／D3 `sys.readAudit`（账本原文）。
- **`traceId` 由执行器发号并回给调用方**：一次调用一个号，账上那行与抛回的 `ToolError.traceId` 同串
  （⛔ 在落账侧现算——异步落账与同步抛错两路各取随机数＝调用方那串在账上查无此行）。
- `sys.readAudit`/预演共用的**日档读数一份主人**（`readAuditDay`），与 `apiAudit` 的连字符日名口径不再两处各写。

### Fixed
- **幽灵 RPC 调用⛔ 进账**（§9.5 不变量破洞）：修前 `dispatch` 在册外 method 上先抛，executeTool 从未被调用 ⇒
  账上一片干净＝"那件事没发生过"，而它自己那句注释还写着"审计那行由 executeTool 记"。证人＝审计臂②
  （`ref=host.noSuchTool` 那行必须存在、`tool` 必须是 `null`、`note` 必须带 `[API_NOT_REGISTERED]`）。
- **拒单那行 `note` 可为空/无码**：`verdict` 与 `code` 不是一一对应（`BAD_ARGS` 与 handler 抛错同落 `error`），
  只盯 verdict 会把"调用方实参写错"读成"工具自己有 bug"——归责方向正好相反。现在 `[API_*]` 必进 note。
- **同一颗工具因"这次成没成"有两个 `ref`**（放行＝契约那颗名、拒单＝带前缀 id）：按 `ref` 聚合调用记录必然漏。
- **换工程⛔ 重算生效契约**（`apiSurface.loadProjectApiOverride`）：修前只在读到覆盖档时重算 `merged`，
  没有覆盖档的那一扇沿用**上一扇的收窄**，而句头注写着"文件不存在＝静默"。这颗是 `sys.selfCheck`
  把 `override.narrowed` 暴露成读数之后才看得见的（正件：前一扇被裁的那颗 rpc 工具，后一扇照旧放行）。
- **`registerRpcTools` 幂等按 id 判**：⛔ 用 `toolsFs`/`toolsDomain` 那种模块级布尔——那颗标志一为真，
  `activate` 第二次调用会整批跳过登记，而 M7 幂等测试恰恰靠"再启一遍"活着（现场：`工具 host.getConfig 重复注册`）。
- 测试台架两处自己的漏：`boot()` 不清审计缓冲/`dirState`（A 工作区的行会被写进 B 的日档、
  无 `.vv/` 的用例被说成"已开户"）；`__resetAuditForTest` 导出后从未被调用（现已接上）。

### Readings（本批权威读数）
- `pnpm test` **255 passed / 0 failed**（含四档新增 4 颗、审计臂② 改写、名册↔实现体新增 1 颗）。
- `pnpm ext:check`（tsc + esbuild）**rc=0**；`pnpm api:doc` 两跑：第一跑红＝写出、第二跑绿＝零漂移；
  生成工具数 **24 → 35**（registry 收编 9 颗 RPC + 新增 2 颗诊断）。
- `bin/C4/bench_c4_lock.py` **11 臂 0 不合格**（M9 只响新证人／M10 四把尺一起响＝新证人的正件方向）＋还原逐字节相同；
  `bin/C5/bench_c5_agent_tiers.py`（新台架）**6 臂 0 不合格**，名册尺 4 颗新证人 0 缺。
- **真宿主（我们自己的二进制 `Verilog Visualizer.exe`）E2E 12 步全绿**（`pnpm test:real`，退出码 0）：
  新加的那一步验的是真机里 `host.getAllBindings` 也走 `executeTool`、幽灵 method 真进账、
  且调用方手里那颗 `traceId` 能在**盘上**账本里查到（409ms）；`registeredTools` 下界从 24 提到 **35**
  ＝真宿主那条线也登记了 RPC 九颗（`realSuite` 过去⛔ 调 `registerRpcTools`——两处登记清单不一致）。
- 第二次全量跑批（74 格）＝**GREEN 30 / RED 44 / ENVRED 0**（波次一前＝12/61）；净进 18 颗＝19 红转绿 − **2 绿转红**
  （`r42-verify` 单跑已复元＝22/0 ⇒ 跑批时序；`r48-verify` 的"导航打断 evaluate"至今⛔ 单跑定案）。
  红的 44 颗按**档自己的源码**归族、以及"单跑对照"推翻"跑批超载"假设那格，全写在 [GATE_LAYERS.md](./GATE_LAYERS.md) ⑤-补3。
- 跑批波次一之后的第二批（74 颗）仍在跑；已知红族＝17 颗编译侧档往浏览器 `import('/src/store/fileStore.ts')` 塞文件
  （该模块已随旧 React UI 退役＝404 早退），波次二逐颗换 `tests/_ui.cjs` 的 `pushCompile/waitCompiled`。
  > **补记（同夜 R155，⛔ 静默改上面那句）**：那一批已跑完＝GREEN 30 / RED 44，
  > 上面"17 颗"与现读集合差一致；两颗绿转红（r42/r48）与归族更正见 R155 那节的 Readings。

---
## [未发布 Unreleased] — R154：验证系统自己的诚信（2026-10-18 夜·用户令代管）



> 起点＝用户令「先完善系统→深度检验→统一 API 层，构建与文档同步，一切为后续 agent 系统考虑」。
> 这一批的产品功能改动很少，做的是**把"看起来在检、其实恒过"的三处拆出来**——
> 因为它们决定后面每一条读数能不能信。

### Fixed
- **API 契约对账锁里五处恒真断言**（`tests/unit/vscodeShell.test.ts:282/290/296/297/299`）：
  那五行都是 `expect('文案' + 布尔).toBeTruthy()`——字符串拼布尔恒为非空串 ⇒ ①工具 id 词表、
  ③ui 投影、④perm/sideEffects 词表、④surfaces 去重**从未判过任何东西**，整段"锁"只剩 ② 在真跑。
  现读两条"如果它活着会说什么"都不成立：① 的命名空间表还停在上一代域名（契约里 20 颗属于
  `fs./res./sys./circuits.`），③「ui 投影全在命令面板」27 颗里 13 颗的 ref 是 registry 侧 handler 名。
  改：不合格名单收进数组判 `toEqual([])`（红名直接报是哪几颗）＋补两颗反向钉
  （命名空间集合等式、registry 有 handler 而契约未上账）。
  证人：`bin/C4/bench_c4_lock.py` 九臂 0 不合格——M1~M5 五种野值各开一火（⚠ 一颗 it 里有四格，
  光比红名证不了哪格响 ⇒ 每臂另钉 needle：转储里必须见到注入的那颗野值本身），
  M6~M8 把那一格换回旧写法、数据照常坏 ⇒ 读回 21 passed / 零红＝旧尺子确实是瞎的。
- **`sys.readAudit` 的 `date` 实参会把调用方的笔误伪装成事实**：schema 写着 `YYYYMMDD（缺省今天）`，
  照它交进来就拼成 `trace-20261017.jsonl` ⇒ `exists:false`，而那句读数长得**完全像**"今天没人调用过"
  （落盘正本用的是带连字符的 `toISOString().slice(0,10)`）。改：schema 说清口径 + handler 把
  8 位纯数字归一（对外实参＝系统边界）；三处漂字的文件名一起改对（源码注释 / 文档头 / 工具描述）。
  证人：`extensionHost` 一颗成对判据（两种写法必须交回同一份读数）+ `bin/C4/bench_c4_audit_date.py`
  两臂 0 不合格（摘掉归一 ⇒ 只红那一颗）。
- **API 文档的"挂账清单"颗数改现算**：`docs/API_REFERENCE.md` 上一版手写「dispatch 的 6 颗 webview RPC」
  而契约 rpc 面现读 **9** 颗 ⇒ 生成器不再手打数字，一律从契约×registry 现算
  （rpc 无 handler 9 颗 / 命令直调 3 颗 / 反向 0 颗，名单一起出）。verdict 也收成一颗主人
  （`apiAudit.AUDIT_VERDICTS`，类型由它派生）。

### Tests
- **r42 分层重锚**：片 5 后「复制到沙盒」归 `host.copyToSandbox`（`browserHost` 按契约直接 reject）、
  旧浏览器 `fileStore` 已整颗删除 ⇒ 老夹具两把锚点（那颗按钮的 title 与 localStorage 沙盒库）双双失效。
  按层拆开重锚：W 编译画布（宿主推送单仿真）/ H 真按钮→宿主 RPC 载荷（点击前注入
  `acquireVsCodeApi` 桩——`getHost()` 每次现读，`r12-export` [F] 同族用法）/ S 沙盒真渲染
  （`gates.html`）/ 同页纯 lib。读数 **22 PASS / 0 FAIL**，且在 `tests/run-all.cjs` 里读到
  `GREEN pass=22 fail=0 exit=0`（两条路对上）。新增三颗证人：[P] 点一次＝一次 copyToSandbox、
  [3a0]/[4c0] 把"沙盒里打不开这颗部件"从"画错了"里分出来。
- 新档 **`docs/GATE_LAYERS.md`**＝闸门分层账：五层各自的主人/驱动配方/判定读什么，
  加 73 颗名册现读（提到已删 fileStore 23 颗、真会炸 17 颗、只剩死预热或注释 6 颗）与入口分工。
  ⚠ 更正上一轮的「24 of 73」＝把 `tests/**` 全树 47 处引用与 GATES 清单混了。

- **X18 旧档迁移丢部件身份**（本批闭）：`collectLegacyItems` 只交 `{name, content}`，旧 `.djs` 档的
  `role:'part'` 与 `partBindings`（值＝批内文件 id）整批丢掉 ⇒ 迁完部件退化成普通画布档，
  显式录入的实现关系无声变成"看同名兜底"——正是 R152「配置里录了才算」的反面。
  修：前端逐颗带 `key`（旧 id）/`role`/`bindings`，宿主按「同批 key→落盘名」连表，
  落表走 `setBindingInDir`（单层**合并一条**）⛔ `setDocBindings`（整表替换＝抹掉用户手编过的其它绑定），
  解不到的只记 Output。
  ⚠ 一度打算走的另一条已**否决**并写进代码注释：webview 侧 `getAllBindings(doc)` 读回来再写回——
  那颗读的是**链合并**结果，写进单层目录＝把父层条目复制进子层＝语义腐败。
  证人：三颗（U 层「X18 正件」／X 层「role:part 落本层目录表…」／**接缝臂**「X18 两半接得上」）
  ＋台架 `bin/C5/bench_c5_x18.py` 五臂 0 不合格。
  ⚠ 那颗**接缝臂是台架撞出来的**：M4 把前端退回只交 `{name,content}`，只有 U 层臂红、宿主臂照旧绿——
  因为宿主臂的 items 是我手搓的，两半从没一起测过（两颗各自绿＝⛔ 证明接得上）。
- **`r137` 那格红要当回事**（本轮跑批读数，⚠ 未定案）：`[0] CSP 之下应用挂载 — 没挂载 ⇒ 整页判据作废`，
  它判的是**今天真发的那颗产物**在 CSP 下挂不挂。两种归责（旧探针找退役单页的标记 ／ 挂载真坏）
  还没分开，归责前⛔ 写"产品没问题"也⛔ 写"产品坏了"。

### Readings（本批收口）
- 全量跑批 `node tests/run-all.cjs`：**73 格＝GREEN 12 / RED 61 / ENVRED 0 / NOVERDICT 0**；
  红因四族（等锚点 25／点不到锚点 13／fileStore 404 10／活动栏不在这一页 9）＋逐颗 4 颗，
  族谱与下一步配方在 `docs/GATE_LAYERS.md` 第⑤节。⚠ 这 61 颗红里**目前没有一颗被证实是产品缺陷**，
  同样也⛔ 有 61 颗算"安全"——每换一次入口都要重跑那颗闸门拿新读数。
- `pnpm test` **250 passed / 250**（9 颗测试档全过）。颗数按 git 现读对账：上一笔提交里 `it()` 共 248 颗，
  本批 +2 ＝ `legacyMigration`「X18 正件」与 `extensionHost`「X18 两半接得上」
  （另在本批更早的提交里已进 X18 宿主臂与 sys.readAudit 臂）。
  ⚠ 而 R153 收口时登记的 **242** 与今天 248 之间那 6 颗，逐颗来历我这轮⛔ 对上——
  留作未核对项，⛔ 拿"总数变了"当故事讲。
- `pnpm build`（tsc + vite）✓——而且正是 tsc 抓到我新写那行里的 TS6133（`id` 解构而⛔ 读），
  vitest 250 颗全绿照旧放行＝"全绿≠型安全"这条第三次应验。
- `pnpm -C extension check` ✓；`pnpm api:doc` 第一跑按契约当场红并回写、第二跑 1 passed（漂移闸在位）；
  台架三支各 0 不合格：`bin/C4/bench_c4_lock.py` 九臂、`bin/C5/bench_c5_x18.py` 五臂、
  `bin/C4/bench_c4_audit_date.py` 两臂，全部与快照逐字节还原。

### In progress（⛔ 算已修，状态写在这里）
- **假宿主一层**（`tests/_dochost.cjs`：9 颗 RPC + `{vvh:'doc'}` init/revert⇄ready/edit，
  文件表跨 reload 存活 ⇒「编辑→保存→刷新→重开」第一次能在浏览器里真判）：通路**还没打过现场**，
  探针 `bin/C5/probe_dochost.cjs` 的三问读数出来前⛔ 写进任何闸门。
- 闸门波次回写脚本（`bin/C5/patch_gate_entry_wave1.py`，DRY 读数 31 颗候选）待跑批收尾后应用。

---
## [未发布 Unreleased] — R153：两模式文件系统的两颗主人缺陷（2026-10-17）

> 起点＝用户令「从文件系统开始修复」。深度核对两模式 FS 的读写缝时抓到两颗**数据/功能丢失级**
> 缺陷：一颗吞用户旧档（迁移），一颗让 `.sv`/`.vh` 在半数入口隐身（域界）。修法都是"一颗主人"。

### Fixed
- **旧档迁移丢 `.djs`（X16）**：`src/canvas/legacyMigration.ts` 把 sandboxStore 落盘的
  `Record<id, SandboxFile>` 当**数组**迭代 ⇒ TypeError 被 `catch { ignore }` 吞成静默，
  沙盒那半颗**一颗都没迁过**；而那颗唯一墓碑在 `.v` 迁移成功后把两半一起封死 ⇒ 数据永久留在
  localStorage。修：两种形状都收 + **两半颗各用自己的墓碑**（老键只管 `.v`，新键管 `.djs` ⇒
  被 bug 坑过的用户下次开画布自动重新被 Offer，⛔ 要用户找设置）。证人 12 格 + 13 臂台架
  `bin/C1/bench_c1_migration.py`（红名集合等式）。
- **`.sv`/`.vh` 半数入口隐身（X17，X8 同根）**：「哪些文件算 Verilog」在扩展里写了六遍、
  三处答案不一致——模块树/层次树定义索引/编译 `scanDefs` 各自 `**/*.v`、层次树门槛
  `extname !== '.v'`、编译入口与 Ctrl+F5/资源管理器右键菜单 `(v|sv)`、绑定目标 `(v|sv)`、
  剥扩展名两处 `/\.sv?$/`（**读反**：只剥 `.sv`，对 `.v` 原样返回 ⇒ topModule 兜底交回
  `x.v`、`bindings.complete` 对 `.v` 工程**零补全**）。修：新档 `extension/src/verilogDomain.ts`
  做**唯一主人**（VERILOG_EXT/SANDBOX_EXT 住 `projectStore`），十处消费点全部改问它；
  manifest 的 3 条菜单 when + Ctrl+F5 键位也吃同一颗名单。证人 +6 格（`.sv`/`.vh` 上两块板、
  `.vh` 编译入口、静态禁项尺、manifest 名单尺、域判定口径尺）+ 12 臂台架
  `bin/C2/bench_c2_domain.py`。

### Changed
- 契约颗数注释对账：dispatch/host/toolRegistry/trees/extension 五处头注的「6 颗/16 颗 RPC」
  全部改为现读事实（RPC 面＝9 颗，由 vscodeShell 对账锁双向钉死）；`projectStore.ts` 头注里
  已删除的 `src/store/fileStore.ts` 幽灵与「沙盒仍以 localStorage 为运行时主人」的过期口径清除。
- `docs/PROJECT_DEEP_REVIEW_2026-10-05.md` 卷六十四、`docs/FILESYSTEM_CHECKLIST.md` v3
  （X16–X19 落账）。

### 挂账
- **X18**：旧档迁移不带 `role`/`partBindings`（迁出的 `.djs` 全按缺省部件语义，文件级显式绑定
  丢失）——需要迁移批内 id→落盘名映射再写 `.verilogviz.json`，单独立批。
- **X19**：`sandboxFiles.hasDjsUnder` 名实不符（判据收 `.v|djs`，纯源码目录也会配出一张空绑定
  表）——是"目录有部件才配表"的语义裁决点，等用户裁。

### 补记 · 深度自检（用户令「深度自检」，同标准：不可信任自己刚写的代码）
以上 R153 两腿经攻击性复查，**五处发现、全数修掉**（台架 12→16 臂，新增名册尺）：
1. **X17 的修只对根目录文件生效**：同名索引的键仍带目录段（`lib/adder` ↔ 查 `adder`）。
2. **X20 更深一层**：那颗「自动同名」压根建在闭包 `job.files` 上，而闭包⛔ 含未录入实例的定义
   文件 ⇒ 绑定面板那一栏恒 null、`bindings.materialize` 的 `.v` 侧恒交回 0 颗（"点了没反应"）。
   两处改问 `scanDefs`（与「写全配置」同一颗主人）。行为证人各补一颗（修前必红）。
3. **X21**：`Uri → 根相对名`本仓写了**七份**，其中三份按根串长度切前缀——盘符大小写一漂
   （`D:/p` ↔ `d:/p/...`）就交半截或整颗绝对路径，而我上一批挑的正是坏的那份。新增
   `verilogDomain.rootRel`（`path.relative` 口径＋根外折回绝对路径，win32 现读：盘符不敏感），
   六份转交；形状臂 2 颗 + 禁项尺 + 台架 M15/M16。第七份 `collectTableDirs` 两侧同源小写、
   暂判安全并已就地注因（⛔ 自检批动热路）。
4. **台架自己漂了一格**：M7 锚的那行被上面第 2 条替换掉 ⇒ 退役留话，并加**名册尺**
   （本批每颗新证人至少被一臂点名）——它当场抓到"根内形状"那格没有任何臂能打破，补 M16
   （rootRel 是枢纽，⛔ 存在"只打一格"的窄变异，射程 26 臂逐颗核过消费者后写成等式）。
5. **我自己写的 `it` 标题里嵌了单引号** ⇒ JS 字符串提前终止、vitest 把测试名读成 `NaN`；
   红名等式忠实报出，读数把我喊回来（⛔ 靠猜改谓词，先转储再判）。
   转交六份后⛔ 一颗既有臂翻色（240 时已证）＝这几份此前一直在交坏值而没人看见。

---
## [未发布 Unreleased] — R141：⛔ 自写启动脚本——跑起来只用官方框架的命令（2026-10-14）

> 触发逐字：**「不要使用你自己编写的命令脚本，尽可能使用官方框架的运行命令」**。
> 这句话判掉的是我连做三批的东西：R138 的 `scripts/run-in-vscode.mjs`（`pnpm app`）与 R140 的
> `scripts/run-studio.mjs`（`pnpm studio:run`）——它们把"起一颗编辑器"包装成我们自己的 CLI，
> 而基座本身就是 Code - OSS：`scripts/code.bat` 加官方参数 `--user-data-dir` / `--extensionDevelopmentPath`
> 才是那个框架给的正解。

### Removed
- **两颗自写启动脚本整颗删**（`scripts/run-in-vscode.mjs`、`scripts/run-studio.mjs`）＋它们的 npm 别名
  （`app` / `app:check` / `studio:run` / `studio:run:check`）＋两份专用判据
  （`tests/unit/launcher.test.mjs` 9 格、`tests/unit/studioLauncher.test.mjs` 18 格）。
  走 git 历史可回退。**删的是包装，⛔ 是那段历史里的真跑读数**（"Windows 上 `.cmd` 必须 shell、
  参数要各自带引号"、"一条命令起产品真跑通过全链路"这些结论仍然有效，写在 §1d/卷四十五里）。
- `apply-brand.mjs` 里 webview 的来源**优先改成 Vite 的 `dist/`**：
  ⇒ 内置装载这条路⛔ 再要我自己发明的 `pnpm -C extension webview:sync`（那一步真正服务的只有 `vsce` 打包，
  因为 vsce 只收 `extension/` 目录；内置装载走基座官方那条 `extensions/<id>/package.json` 扫描）。

### 追加（同日）：他说"太多了"⇒ 收成**一条** `pnpm app`（npm script，⛔ 自写 `.mjs`）

逐字：**「改成我只需要敲一条的」**。上一条回答里我把"一次性 4 条 / 日常 2 条 / 交付 0 条"三种计数混着写，
看着像官方路线要敲一串——那是我表述错，也是形状错。收成一条 npm script（npm 自己的组合机制，
⛔ 我们又写一颗 `.mjs` 去包装），内容全是官方命令：

```
pnpm build && pnpm -C extension build && <基座>\scripts\code.bat "--extensionDevelopmentPath=%CD%\extension" "--user-data-dir=<与基座同级的 profile>"
```

⚠ 两处实测细节：① 每个含空格的参数**各自**带引号（我们仓库路径本身就有空格，`%CD%\extension` 不加引号会在第一个空格处断）；
② **基座那次性的一大堆不用人敲**——官方 `code.bat` 进门先跑 `build/lib/preLaunch.ts`：
缺 `node_modules` 就 `npm ci`、缺 Electron 就 `npm run electron`、缺 `out/` 就 `npm run compile`，还会拉基座要的内置扩展。
所以从" clone 完基座"到"窗口开出来"，人要敲的就是 `pnpm install`（本仓一次）+ `pnpm app`。

真跑读数（`pnpm app` 整条）：`tsc && vite build` → esbuild → 基座 preLaunch（下载 js-debug 等三颗内置扩展）→ 起窗口，
标题 `[Extension Development Host] Verilog Visualizer - demo - Verilog Visualizer Dev`，
exthost `_doActivateExtension local.verilog-visualizer-vscode` 1 行、`[error]` **0 行**；
`--extensionDevelopmentPath` 直载仓库里那份扩展 ⇒ 日常⛔ 再跑 `pnpm studio:brand`（那颗只服务"内置装载"那条验证路）。
文档同批改：README 快速开始、`GETTING_STARTED` 中英两处、`DEVELOPMENT` 脚本表、`studio/README.md` §5。

### 现在的口径（README 与三份开发文档同步改完）
| 要做的事 | 官方命令 |
|---|---|
| 一次性编基座 | `npm install` → `npm run compile-client` → `npm run electron`（在 fork 里） |
| 起我们自己的二进制 | `scripts/code.bat --user-data-dir=<与基座同级的 profile> [<工程文件夹>]` |
| 调本扩展 | 同一个脚本加官方 flag `--extensionDevelopmentPath="<本仓库根>\extension"` |
| 改基座源码 | 官方 `npm run watch-client` |
| 编我们的产物 | `pnpm build`（tsc + vite，官方工具）+ `pnpm -C extension build`（esbuild） |
| 放进基座的官方位置 | `pnpm studio:brand` ——**本仓唯一剩下的自写脚本**，它只做文件摆放 + 合并 `product.json` |
| 打包安装物 | 官方 `npm run gulp vscode-win32-x64-min`（任务名按平台/架构在 `build/gulpfile.vscode.ts:610` 生成）；⚠ **本轮⛔ 跑过** ⇒ 记 UNVERIFIED，归片 5 |

### 读数（改完真跑过）
- 官方那条起窗口命令**真跑**：`scripts\code.bat --user-data-dir=D:\vv-studio\profile D:\vv-studio\demo`
  ⇒ 窗口标题 `Verilog Visualizer - demo - Verilog Visualizer Dev`；exthost 里
  `_doActivateExtension local.verilog-visualizer-vscode` 1 行、`[error]` **0 行**；
  `pnpm studio:brand` 输出改成"webview 取自 <仓库>\dist"，装进去 9 颗文件。
- 判据：vitest **91/91**（117−27＝删掉的两份启动器判据）；根 tsc / extension typecheck / eslint / `pnpm build` 各 0 错。
- ⚠ 本轮自己造的两处（都当场修掉并记下）：① 代码块注释里写 `extensions/*/package.json` 会**把块注释提前关掉**
  （`*/` 就在那里），`apply-brand.mjs` 当场语法错——"注释里的星号斜杠"是新的一类自伤；
  ② 用 heredoc 的 python 往文档写盘符路径，反斜杠**第四次**被吃成垂直制表符（README 一处、迁移台账一处，
  按字节扫 `0x0B` 全抓出并改回；结论：**这类块改用不解释转义的写法**）。

## [未发布 Unreleased] — R140：版本分线（main＝无 agent 版）+ 方向第二次纠正（2026-10-13）

> 他这次说了两件事，逐字。分线：**「当前项目我要另起一个版本，建议推送819563d5ecb7deff50f9da26176d3561348986b3，
> 往后的提交使用新的分支"agent版"提交（可先只推几个提交，但不要全部推送），我要根据是否含有agent功能分为两个版本」**；
> 纠正：**「当前套壳vscode不是让你在vscode的壳内打开一个网页作为我的项目，
> 而是应该将绑定系统移植到当前vscode壳已有的文件系统上，以及移植模块、层次结构两个板块，以及沙盒系统」**。

### 版本线（本轮真跑过的推送）
- `origin/main` **快进到 `819563d`**（`54ce537..819563d`＝**5 笔**，R135 那批：自包含 SVG 导出 + 证人 + 账本）。
  推送前查过三件事：**是 fast-forward**（⛔ force）、`git diff --name-only` 只有 **15** 颗源码/文档/测试、
  凭证形状 grep **0** 命中（唯一 `token` 那句是 `getComputedStyle` 的 CSS 变量名）。
  ⚠ 用的是 `git push origin <sha>:refs/heads/main` 这种**指名 refspec**，⛔ `git push origin main`——后者会把全部 23 笔一起推上去，
  正是他那句"不要全部推送"要挡掉的。
- 新建本地分支指向 `f050d56`（R139 片 3a 收口那颗）并切过去，**往后的提交都落这条线**；
  ⚠ 同批按他的令把分支名改成英文（**「分支名称不要带有中文，改成英文，然后继续逐步推进」**）⇒ `agent版` → **`agent`**
  （`git branch -m agent版 agent`：纯本地改名，`origin` 那侧还⛔ 有这条引用，故⛔ 需要删远端旧名）。
  这条分支本轮**⛔ 推**（等他逐次点头）。⚠ 分线⛔ 等于"agent 功能已存在"：到 `f050d56` 为止 agent 面仍是 **0 行代码**，
  分的是**发布口径**（无 agent 那份停在成熟骨架，迁移与新功能都在 `agent` 上走）。

### 方向第二次纠正：⛔"在壳里打开一个网页"，而是要**移植**
我这轮交的是"一整块 `WebviewPanel` 装下整个 React SPA"＋"画布以后变成 custom editor"——按他这句话，
前者⛔ 是产品，后者还不够：要把**三块东西搬到宿主已有的原语上**。工单落进 `studio/README.md` §0b/§3（各带"判定搬完了的样子"一列）：

| 板 | 现在的住法（行数现读） | 搬到哪 |
|---|---|---|
| **A 绑定系统** | `src/lib/gateSystem.ts` 578 行：`activePartBindings`（名→文件）存在 **localStorage**，解析靠 `sandboxStore` 那份内存文件表 | **壳已有的文件系统**：部件＝工作区里的真文件，绑定＝相对路径解析；改名/删除由 workbench 发事件，我们只跟着重绑 |
| **B 模块 + 层次结构** | `ModulePanel.tsx` 456 行、`HierarchyViewer.tsx` 301 行（自绘 React 侧栏） | 模块 ⇒ `DocumentSymbolProvider`（进原生 **Outline**/面包屑）；层次结构 ⇒ `contributes.views` 的 **`TreeView`**；顺带结掉在册 **T-3** |
| **C 沙盒系统** | `SandboxCanvas.tsx` 3798 行 + `sandboxStore.ts` 449 行（`.djs` 正文**只在 webview localStorage**）+ `App.tsx` 1786 行的模式编排 | `.djs` ⇒ **`customEditors` + `TextDocument`**（脏标记/保存/关闭归 workbench）；器件库与配置 ⇒ 命令 + QuickPick/原生视图；**只有 joint 画布与仿真留在 webview** |

⇒ 顺序被依赖钉死：**C 的文件那半（片 4-C1）→ A → B → C 的 UI 那半（片 4-C2）**，最后那颗装 SPA 的面板删掉。
⚠ A⛔ 先动：绑定解析的 substrate 就是"部件＝文件"，而这件事要 C1 落地才成立。

### Changed
- `README.md`「宿主」一节改成二次定形（含版本线与"⛔ 是网页壳"这句），`studio/README.md` 顶部决策块追记第二次纠正、
  §0 重写成 §0b 三块板 + §0c chrome 表、新增 **§3b 版本线**（两条线的落点与推送读数都写进去）。

### 一条命令起我们自己的二进制：`pnpm studio:run`（他要先能测）

产品入口从"两条手工命令 + 一串路径"收成一条（`scripts/run-studio.mjs`）：
① `dist/` 缺或 `src/`/`package.json` 更新 ⇒ `pnpm build`；② 扩展 bundle 缺 ⇒ `pnpm -C extension build`；
③ `apply-brand` 装进基座；④ 起基座的 `scripts/code.bat`，**`--user-data-dir` 显式给到与基座同级的 `profile`**
（⛔ 动他日常 VS Code 的配置）。可带一个文件夹参数＝让它打开那个工程。
⚠ **一次性的那步⛔ 代跑**：基座还⛔ 装依赖／⛔ 编过时，脚本把整条命令打印出来（那是几分钟到几十分钟、几 GB——
替用户默默发起这种量级的动作⛔ 是"尽力而为"，是鲁莽）；`--check` 只报现场、⛔ 构建、⛔ 起窗口。
指路退路 `VERILOG_STUDIO_FORK=<路径>` / `VERILOG_STUDIO_PROFILE=<路径>`。

- **这条命令是被"真跑一遍"修好的**：第一版把构建与起窗口共用一个 `cwd`（＝基座目录），
  于是 `pnpm build` 落进 Code - OSS 那份 checkout 里执行，报
  `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "build" not found`——症状看着像"本仓的 build 脚本坏了"。
  18 格判据当时**全绿**，因为它只记 `file/args`、⛔ 记 `cwd` ⇒ 补了一条"构建步骤的 cwd 必须是仓库根、
  起窗口那颗才在基座"的断言，这一族才第一次有臂。
- 另两颗无头判到的形状：基座⛔ 就绪时 `main` **一颗进程都⛔ spawn** 并返回 3（否则起的是上一份产物＝"我改的没生效"）；
  步骤顺序＝构建 → 装基座 → 起窗口，任何一步非 0 当场停。
- ⚠ 测试自己污染过一次全局：`process.env.X = saved` 在 `saved` 是 `undefined` 时写成字符串 `"undefined"`
  ⇒ 后面每一格都读到那颗 undefined，症状是"main 全部报基座还⛔ 就绪"。改成分路还原（没有就 `delete`）+ 一格自证。
- 文档同批改口径：`README.md` 快速开始（产品入口一条 + 一次性前置那条命令写全 + 空格与 node 24.18.0 的警告）、
  `docs/GETTING_STARTED.md`（中英两处都改成 `studio:run` 打头，`pnpm app` 降级为"开发回路"）、
  `docs/DEVELOPMENT.md`（脚本表加 `studio:run`/`:check`，"基座那一条回路"从四行手工命令收成一行 + 一次性那步的说明）、
  `studio/README.md` §2 加这颗脚本的条目。
- 读数：`pnpm studio:run --check` ⇒ `状态 ready`、`本轮要先编: pnpm build`、spawn 串带 `--user-data-dir`；
  **`pnpm studio:run` 全链路真跑过**：`› pnpm build`（2073 modules）→ `› 装进基座`（17 颗键 + 内置扩展）→
  `› 起我们自己的二进制` ⇒ 窗口标题 `Verilog Visualizer - demo - Verilog Visualizer Dev`（10 颗自有进程）。
  vitest **117/117**（99→117：`studioLauncher` 18 格）。

### 片 4-C1 的宿主半颗：`.djs` 开始有了磁盘这一份（新增第 16 颗 RPC）
- `ProjectStore.listSandboxTree()`＋`collect(exts)`：Verilog 与沙盒**两颗表共用一次 walk**（跳过规则、
  "相对根、`/` 分隔"、空文件夹上报三件事必须同源；复制两份 walk＝将来只改一边就分岔）。
  另起一颗而⛔ 合并进 `listProjectTree` 的理由是现读的：`fileStore.refresh()`（`src/store/fileStore.ts:473-544`）
  把回的每一颗都 `parseVerilogModules` 当 Verilog 导入（:507），还有一条"磁盘上没了就从状态删"（:482-485）
  ⇒ `.djs` 混进去＝电路 JSON 被当模块解析＋沙盒那侧被牵动。
- 方法表 **15 → 16**：`host.ts` 接口 + `vscodeHost.ts` + `browserHost`（**reject**，⛔ 返回空表——空表会让调用方把用户的电路当"已删除"）
  + 宿主 `dispatch` 四处同一批；对账判据的计数下限从 15 提到 **16**（⛔ 改小）。
- 抓出一颗**测试双自己的毛病**：`memFs.readDirectory` 把根 `@root` 当一颗子目录上报，旧断言用 `toContain` 所以从没露头；
  新增的 `expect(folders).toEqual([])` 当场逼出 ⇒ 修假 fs 并把那格升成 `toEqual`。**列表类判据⛔ 停在 `toContain`。**
- 读数：vitest **99/99**（97→99）、台架 `bench_139_hostnet.py` **9 臂全部有红**（新 M9＝"沙盒那颗表把 `.v` 也收了"，红 2 格）、
  根 tsc / extension typecheck / eslint / `pnpm build` 各 0 错；重新 brand 后真机起自有二进制开 demo ⇒
  标题 `Verilog Visualizer - demo - ...`、exthost `[error]` 0 行、demo 目录仍只有那 2 颗 `.v`（前端还⛔ 调这颗新方法，符合预期）。
- ⬜ 下一批＝剩下的半颗：`sandboxStore`（449 行、全同步、宿主调用 0）开机一次性 hydrate + 改动 write-through，然后再上 `customEditors`。

---
## [未发布 Unreleased] — R139：方向纠正——自带 VS Code 源码分支出独立二进制（2026-10-13）

> **我连续两轮把方向理解错了**，先记这句。他要的是「**UI 风格直接套壳 vscode**」：workbench 本身就是产品界面，
> 我们做"把我们的界面装进 VS Code 的一个标签页"，还写了一颗脚本帮他打开——他那句
> 「更没叫你自己写运行脚本」就是对这两轮的判决。**目标形态＝Cursor / Windsurf 同族：自带 Code - OSS 分支，出我们自己的二进制。**

### Added
- **`studio/`：基座脚手架**（片 1）。`product.overrides.json` 只放"我们改哪几颗品牌键"，
  合并与内置扩展安装在 `studio/apply-brand.mjs`，分期与实测前置写在 `studio/README.md`。
- `pnpm studio:brand`（本轮真跑通）：① 把覆盖层合进基座 `product.json`，合并后**自检关心键真落到位置**；
  ② 把 `extension/` 的产物装成基座的内置扩展 `extensions/verilog-visualizer/`。
- `tests/unit/studioBrand.test.mjs` 14 格（vitest **72/72**）：基座其余键一颗都⛔ 丢、嵌套对象深合、
  数组整体替换、`_comment` ⛔ 进产物、**覆盖层⛔ 出现基座读不到的键**、漏合要能红、
  "写回时保住基座自己的缩进与行尾"、**默认基座位置自己就得通过空格检查**。

### Fixed
- **覆盖层里三颗我脑补的键**（`win32x64UpdateId` / `quality` / `win32Arm64AppId`）：
  现读结果——`win32x64UpdateId` 在整个 checkout 里被读 **0** 次且 Code - OSS 的 `resources/win32` **一颗 `.iss` 都⛔**；
  `quality` 基座⛔ 有这颗键而我们⛔ 更新服务。加了没人读的键＝假装那是个决定，删。
- **`product.json` 被整档重排**：第一版按 2 空格写回，"只改 17 颗键"在 `git diff` 里是 **253 增 / 248 删**
  的缩进噪声；改成从原文认缩进后是 **21 增 / 16 删**，且再跑一次数字不变（幂等）。

### Changed
- README 的「宿主」一节改成**诚实版进度**：上一批写的是"唯一宿主＝VS Code 扩展壳"，方向错；
  `pnpm app`（R138）降级为**开发用入口**，⛔ 再当交付物——片 2 之后由基座产物取代，这件事现在**成立**。

### 片 2：基座在这台机器上真的编出来、也真的起来了（他点头后跑的）

授权逐字：**「跑，你直接帮我装node，node use允许修改到更新的版本，可跑基座，顺便把缓存清空」**。

| 步骤 | 读数 |
|---|---|
| `npm install` | `added 1590 packages in 6m`，日志 `npm error` **0 行** |
| `npm run compile-client` | `out/` **12,160 文件**；`Finished compilation with 0 errors after 37397 ms` |
| `npm run electron` | `.build/electron/`**`Verilog Visualizer.exe` = 239,129,088 字节**（名字来自我们合进去的 `product.json` ⇒ branding 当场可见） |
| 起窗口（`--user-data-dir=D:\vv-studio\profile`，⛔ 碰他日常 VS Code 配置） | 6 颗自有进程；标题 `Verilog Visualizer - Verilog Visualizer Dev` |
| 内置扩展 | exthost：`_doActivateExtension local.verilog-visualizer-vscode`（`onStartupFinished`）；exthost/main/renderer 三份日志 `[error]` **0 行** |
| 画布像素 | **UNVERIFIED**——取这一格要把窗口从最小化激活，而他此刻在用这台电脑（抢焦点＝要用户多做一步，按本仓判据⛔ 做）。点验一行写在 `studio/README.md` §4b |

清缓存那一刀：删的是 `src-tauri/target`（**9.0 GB**，R138 拆完 Tauri 后它就是纯产物）。⛔ 动任何源码。

### 实测前置（每条都对应一次真失败，⛔ 是抄来的说明书）
1. **node 24.18.0**：`.nvmrc` 硬门槛 + `preinstall` 硬拒；本机 nvm 只有 18/20/22 ⇒ 按许可装了 24.18.0 并 `nvm use`（nvm-windows 根在 `D:\NVM\nvm`，满足"D 盘"）。
2. **MSB8040（Spectre 缓解库）**：`node-pty` 一类原生模块编不过。组件 id 现读 catalog 才对——
   先按社区流传的 `…VC.Lts.Spectre` 试，报 `Cannot find package in product graph`；真 id
   `Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64.Spectre`。
   ⚠ 另一条：**非管理员跑 Installer 的 `--passive/--quiet` 直接 exit 5007** ⇒ 必须一开始就提权（`Start-Process -Verb RunAs`）。
3. **`@vscode/ripgrep` 打 api.github.com 得 403**（本机未认证）⇒ 先把那份 zip 塞进它的下载缓存，命中就⛔ 打网络。
4. **checkout 路径⛔ 含空格**：上游 `build/npm/preinstall.ts:143` spawn 时**⛔ 加引号**，
   实测 `'D:\Visual' is not recognized as …`（跑满四分钟才炸）。我们仓库自己就住在 `D:\Visual Studio Code\` 下面 ⇒
   `DEFAULT_FORK` 改成从仓库相对位置推**会掉回同一个坑**，现在钉成 `D:/vv-studio/vscode` 并在 `apply-brand.mjs` 里**早退**（含空格就三秒内说清＋给替代命令，⛔ 让人等一次长安装再失败）。
5. `node-gyp` 的 Electron headers 落 `C:\Users\…\AppData\Local\node-gyp\Cache\43.7.7\`（日志现读）、
   共享存储落 `c:\Users\34697\.verilog-visualizer-shared\`——两处都⛔ 由我们的脚本决定，按"D 盘"这条口径**在册待处理**（片 5）。

### 片 2 露出来的一颗真缺陷：我们自己的二进制启动后只剩一颗 Welcome 页
旧规则是 `extensionMode === Development` 才自动弹面板。源码现读 `src/vs/platform/environment/common/environmentService.ts:105`
⇒ `isExtensionDevelopment` **只在传了 `--extensionDevelopmentPath` 时为真**，所以我们编进自家产品的内置扩展是 **Production**，
旧规则永不触发。修法：判据搬进 `extension/src/startupPolicy.ts`（⛔ import vscode，纯函数、可无头判）——
环境变量 `=1` / 开发宿主 / **扩展编在 `appRoot` 里（＝这就是我们的产品）** 三种来路各开一次，其余⛔ 开。
按**位置**判内置⛔ 按 `env.appName` 字符串判（后者把行为押在品牌文案上，改一次名字就静默失效）。
新增判据 `tests/unit/startupPolicy.test.ts` **12 格**（含"归一那一步是必要的"那颗变异证人、
"两边都空⛔ 算内置"、三档输入穷举）；台架 `bin/R139/bench_139_startup.py` **4 臂全部有红**。
vitest **72/72**（60→72）。

### 片 3a：项目根换成"打开的那个文件夹" + Extension Host 的一面无头网

| 项 | 读数 |
|---|---|
| `projectRoot()` | 开了文件夹就用它；⛔ 文件夹时退回旧家 `globalStorageUri/project_files`（⛔ 一升级就"我的文件全没了"）；多根取第一颗（在册取舍） |
| `configRoot()` | 单独一颗、**始终**应用级：⛔ 往用户仓库里扔 `verilog-viz.config.json`（那会让他的 `git status` 当场脏） |
| `ProjectStore` | 扫描跳过 `node_modules` 与任何点开头目录——⚠ 这条⛔ 是 Rust 版老规矩照抄，是"根＝整仓代码"这个新形态带来的 |
| 真机（自有二进制 + `--user-data-dir=D:\vv-studio\profile`） | 打开 `D:\vv-studio\demo`（8 位总线计数器 + 一层实例化）⇒ `code --status`：`Folder (demo): 2 files / File types: v(2)`；跑完那目录里仍只有我放的 2 颗 `.v` |
| 无头网 | `tests/unit/vscodeApiStub.ts`（**回 `Thenable`、⛔ Promise** 的假宿主）＋ `vitest.config.ts` alias ＋ `tsconfig.json` 的 `paths`（只配一处＝"tsc 过、跑起来找不到模块"那种红）；`tests/unit/extensionHost.test.ts` **25 格**走真 req/res 通道；台架 `bin/R139/bench_139_hostnet.py` **8 臂全部有红** |
| 判据合计 | vitest **97/97**（72→97）；根 tsc / extension typecheck / eslint / `pnpm build` 各 0 错 |

**抓到的那颗只有真机能发现的问题**（记法：症状 → 对照实验 → 归责）：打开一个**从没信任过**的文件夹后，
exthost 日志里连 `_doActivateExtension local.verilog-visualizer-vscode` 都⛔ 出现、`[error]` 0 行、
窗口只剩一颗 Welcome（受限模式）页——⛔ 报错、⛔ 有日志，正是"点了没反应"那一族最坏的形状。
同一份产物加 `--disable-workspace-trust` 再跑 ⇒ 激活行当场回来 ⇒ 归责钉死在清单缺 `capabilities.untrustedWorkspaces`。
补上（并带 `description`：受限模式里那句话是给**用户**读的，⛔ 让用户在⛔ 知道为什么放行的地方点放行），
再跑**不带**那颗旗标：激活 + 标题 `Verilog Visualizer - demo - Verilog Visualizer Dev`、`[error]` 0 行。
取舍＝**声明支持未信任工作区**而⛔"整产品关掉 Workspace Trust"（安全 > 稳定；这份 fork 自带 js-debug 与 agent host，
那颗边界要留着）：我们的东西⛔ 起进程、⛔ 执行工作区带来的可执行文件（WASM 打进包、工作区内容只当文本读；
前端两处 `innerHTML` 都只赋空串）。⚠ 残留：新开文件夹仍会看到宿主的信任提示，那是宿主自己的安全 UI，⛔ 我在这一层替它消。

顺带：`apply-brand.mjs` 那句"下一步见 §3 片 2（要先装 node 24.18.0）"讲的是**已经历过的事**，改成真的下一步（起窗口那条命令）。

### 那颗挂了三轮的开放项（webview `localStorage` 持不持久）拿到半份读数——用**读盘**，⛔ 抢屏幕

R136 起它一直挂着，因为取读数那一格在他的屏幕上。这一轮翻 profile 的 Chromium 存储层：

| 读的东西 | 读数 |
|---|---|
| `src/` 的 `localStorage` 射程（重新数） | 59 行（含注释）／真调用点 **47** 处（⚠ 旧口径 45 已过时）／**12** 个文件／**20** 颗键名 |
| `<profile>/Local Storage/leveldb/000003.log`（2,040 字节，自 21:06 未压实） | **有**我们的键：`verilog-viz-files`、`verilog-viz-folders`、`verilog-viz-onboarded` |
| 同一份存储里的 webview origin | **只有 1 颗**（`vscode-webview://1jljhded…48ut`），而这份 profile 起过 **5 次** ⇒ origin 跨启动不漂（若漂就该有 5 颗） |

⇒ 能判的那半：在"我们自己的二进制 + 固定 `--user-data-dir`"这一档，webview 的 localStorage 确实落进用户数据目录且 origin 稳定
⇒ "给 `ProjectHost` 加 `storageRead/storageWrite` + 注入 bootstrap、把 47 处同步读改异步"这条最贵的重构**⛔ 是为了持久而必须付**。
⇒ 判不了的那半（在册，一格点验）：**用户画的电路正文**跨重启还在吗（那个 profile 里没人画过电路，读盘只能看到空结构）。
⚠ 取这一格**⛔ 用 F5 的开发宿主**——那是临时 profile，读数⛔ 代表产品；这条前提已写进 `MIGRATION_VSCODE.md` §5A 第 5 格。
⇒ 片 3b 的动机因此改写：`.djs` 搬成工作区里的真文件⛔ 是为了防丢，而是**数据该是文件**（进 git、进 Explorer、能被另存为带走）。

### 台架自己红过的两处（⛔ 写进注释就当它对了）

1. `resetMachine()` 会连内存盘一起清，上一版把它留在 seed **之后** ⇒ 每个"先 seed 再 boot"的用例都在断言一颗
   被自己抹掉的文件，症状长得像产品缺陷（"找不到前端构建产物"）。现在"清场→铺盘→activate"的顺序由 `boot()` 独占。
2. 桩里 `registerWebviewPanelSerializer(_, _serializer: any)` 让被测文件的参数掉成隐式 any（根 tsc TS7006）——
   **桩⛔ 让被测代码变红，且那红⛔ 是它自己想问的事**；补了 `WebviewPanelSerializer` 接口把上下文类型还回去。

## [未发布 Unreleased] — R138：一条命令起壳 + Tauri 整条拆除（2026-10-13）

> 触发是他这两句：「我想要的效果是直接改成 vscode 套壳，但是当前启动方式还是原来的 tauri，
> 你给的 `pnpm -C extension build` 非常麻烦，应该是直接一行代码运行的，而不是你文档里那么麻烦还要 F5」
> ＋「当前项目要完全转向 vscode 类的 electron，要清理 tauri」。
> 上一批我把"能跑"写成"按 F5 → 再按 Ctrl+Shift+P → 再找那条命令"＝把三步手工动作留给用户，按本项目判据是缺陷。

### Added
- **`pnpm app`**（`scripts/run-in-vscode.mjs`）：缺产物就编（`dist/` 不存在、或 `src`/`public`/`index.html`/
  `vite.config.ts`/`package.json` 里有比它新的）→ 编 Extension Host → 找到 VS Code CLI →
  起一个挂了本扩展的窗口。`VSCODE_BIN=<路径> pnpm app` 是指路退路；`pnpm app:check` 只报现场、⛔ 真开窗口。
- `pnpm app:check` 这一颗存在的理由：**"找得到 CLI / 参数拼得对 / 该不该重编"本来可以无头判**，
  没它就只能真开一个 GUI 窗口才知道（既打扰用户，也把纯逻辑判据错登记成真机项）。
- `@vscode/vsce` 装成 `extension/` 的 devDependency ⇒ **`.vsix` 那条路由"⛔ 实测"变成跑过**：
  `pnpm ext:package` 产出 21 个文件 / 7.03 MB 的 `.vsix`（含 15.66 MB `yosys.wasm`）。
- `tests/unit/launcher.test.mjs` 9 格（新）：Windows 那条命令**每个含空格的参数各自带引号**、
  非 Windows 保持参数数组原样、CLI 查找三级优先（`VSCODE_BIN` → PATH（要 `--version` 真跑得通）→ 常见安装位置）、
  候选表按平台给、`needsBuild` 三臂（缺产物／src 更新／⛔ 白编）。

### Changed
- **宿主从三档收成两档**：`ProjectHost` 现在只有 `vscodeHost` / `browserHost`；
  `hostId()` 的 `'tauri'`、`isTauri`、五颗窗口控制方法与 `hasWindowControls` 一并离开接口。
- **开发宿主模式下扩展自己弹面板**（`extensionMode === Development` ⇒ `activate` 里直接 `openPanel()`），
  所以 F5 那条路也一起变短了；配套 `activationEvents: ["onStartupFinished"]`（⛔ 它，没人调命令就不会激活）。
- `r12-export` 的 [F] 三格改注 `acquireVsCodeApi` 桩（原来注 `__TAURI_INTERNALS__` 验 Rust 的 `save_export_file`）：
  验的还是**同一件事**——"点击前注入桩 ⇒ 探测每次现读"这条不变量，只是宿主换成了当前主宿主；
  [F2] 载荷判据因此从 `content[]` 数组改成 `args.base64`。

### Removed（Tauri 整条）
- `src-tauri/`（24 颗 tracked 文件：Rust 14 颗命令 / 402 行、`tauri.conf.json`、capabilities、icons）、
  `src/lib/host/tauriHost.ts`、`src/components/WindowControls.tsx`、`public/tauri.svg`；
  `App.tsx` 两处 `data-tauri-drag-region`；`@tauri-apps/api` + `plugin-opener` + `cli`（`pnpm install` 读数 **−4 个包**）；
  `pnpm tauri` 脚本、`vite.config.ts` 里 `TAURI_DEV_HOST`/hmr/`watch.ignored`、eslint 的 `src-tauri/**` 忽略项。
- ⚠ 回退方案改了口径：**⛔ 再"两条宿主并排维护"**，要找回那一版走 git（架构文档 §9.7 已改口）。
- 盘上留着⛔ 我删的：`src-tauri/target/`（9.0 GB Rust 缓存，gitignore 内）。删之前查过
  `src-tauri/project_files/` 是**空目录**（0 个文件 ⇒ 没人的电路住在那儿）。

### Fixed
- **启动器在 Windows 上会把命令拼断**（这颗是我自己写的，被单测当场抓住）：`code` 其实是 `code.cmd`
  ⇒ 必须走 shell；而 Node 的 shell 模式是**把参数用空格拼成一条串**交给 `cmd.exe` 的，⛔ 替含空格那段加引号
  ⇒ `--extensionDevelopmentPath=` 会断在 `D:\Visual Studio Code` 的第一个空格处指到 `D:\Visual`。
  这是 StarMark #261（`Start-Process -ArgumentList` 不引含空格元素）那一族的翻版，判据里还专门
  **先断"裸拼那种写法不等于我们的输出"**（⛔ 让两种写法都能通过 ⇒ 那颗闸门永远绿）。
- `pnpm-workspace.yaml` 里第二颗 `allowBuilds` **占位文本**（`@vscode/vsce-sign: set this to true or false`）：
  留着它 pnpm 会每条命令都报错。已明确写 `false` 并记理由（只本地打包⛔ 上架市场，签名用不上）——
  同一族坑 R137 已在 esbuild 上踩过一次。

### Known
- `.vsix` 装到用户机器上那一步（`code --install-extension`）**我没执行**——那是改他的编辑器状态，等他点头。
- 上一批的两条仍欠：扩展端到端台架（真开 EPH 驱动 webview）、webview `localStorage` 持久性读数。

---
## [未发布 Unreleased] — R136 → R137：VS Code 壳落地（2026-10-13）

### Added
- **`extension/`：VS Code 壳（Extension Host 半段）**，基座照微软官方 `webview-sample` + `esbuild-sample`，
  ⛔ 自己发明轮子（候选件维护读数记在 `docs/MIGRATION_VSCODE.md` §3；`webview-ui-toolkit-samples` 已归档、
  `githubnext/vscode-react-webviews` 停在 2021）。四颗新文件：
  `html.ts`（**纯函数**：改写 Vite 产出的 `dist/index.html` —— 资产→`asWebviewUri`、注入 CSP + `<base>`、
  给每颗 `<script>` 挂 nonce）、`projectStore.ts`（`sanitizeRel` + 文件/文件夹 CRUD + 树 + 配置，
  语义逐条对齐 Rust `lib.rs`）、`extension.ts`（面板装载 + **15 方法**消息路由 + `showSaveDialog` 另存为，
  取消＝`false` 不是 error）、`esbuild.js` / `sync-webview.js`（打包，external 只留 `vscode`）。
- **命令「打开项目文件所在文件夹」**：`revealFileInOS` + 路径抄进剪贴板。⛔ 让人去猜 globalStorage 的拼法
  才能核对落盘＝那是缺陷，不是"使用文档问题"。
- `tests/r137-webview-csp-gate.cjs`（11 PASS / 0 FAIL / 1 UNVERIFIED）：**在真浏览器里按壳那份 CSP 跑这张画布**。
  三份页面分开（固定份 / 带"无 nonce 靶子"那份 / 摘掉 `script-src` origin 的变异份），
  CSP 与改写器**从 `extension/src/html.ts` 现读**（esbuild 就地编 CJS），⛔ 在闸门里抄第二份。
- `.vscode/{launch,tasks}.json` 入库（F5＝「运行 扩展开发宿主」），根 `package.json` 加 `ext:build|watch|check|package`，
  `pnpm-workspace.yaml` 接 `extension` 包（并把 `allowBuilds.esbuild` 那颗占位串改成 `true`——占位文本会让 pnpm 静默跳过 esbuild 的 postinstall）。
- `tests/unit/vscodeShell.test.ts` 由 8 格加到 **11 格**（vitest **39/39**）：
  **RPC 两张表对账**（前端 `vscodeHost` 调的 15 颗 ⇔ 宿主 `dispatch()` 认的 15 个分支，双向差集都要空，
  并先断"两边都抽到了 ≥15 颗"——⛔ 让"两边都空 ⇒ 相等 ⇒ 绿"那种假绿灯存在）；
  **面板释放登记只一处且住在两条装载路共用的 `wirePanel` 里**。
- 跑批收口读数：**`RED=0 ENVRED=0 GREEN=73 NOVERDICT=0 共 73 格`**（本轮零红，无需归因）。

### Fixed
- **面板释放登记只挂在"按命令新开"那一条路上**：`extension.ts` 里 `onDidDispose` 原先写在 `openPanel` 内，
  而面板还有第二个来路——窗口重启时 `registerWebviewPanelSerializer` 恢复出来的那颗。
  恢复 → 关掉 → `currentPanel` 仍指着已释放的面板 ⇒ 再按命令走 `reveal()`＝**点了没反应**。
  现在登记收进两条路共用的 `wirePanel`（一处主人），并加 `currentPanel === panel` 守卫
  （⛔ 旧面板的 dispose 抹掉新面板的登记）。证人：`tests/unit/vscodeShell.test.ts` 钉"全文件只有一颗 `onDidDispose`，且住在 `wirePanel` 里"。
- **CSP 少了 Prism 那张 CDN 样式表的放行**：`style-src` 原先只收 `cspSource` + `'unsafe-inline'`，
  而 `index.html` 里 Prism 主题走 `https://cdnjs…/prism-tomorrow.min.css` ⇒ R137 首跑实测报
  `…prism-tomorrow.min.css|style-src-elem`。症状是**代码编辑器没了配色，且只在壳里发生**（dev 不带 CSP）。
- `vite.config.ts`：`base` 改成"构建走 `./`、dev 走 `/`"。webview 与 `file://` 拿不到绝对根路径，
  这是壳能装载资产的前提；四处跑 dist 的闸门（`qc-preview`/`qc-paused`/`qc-realuser`/`r23-verify`）
  单跑复核 **2 / 6 / 4 / 12 全绿**（＝改产物基址没碰坏生产包那一档）。

### Known（⛔ 已修，⛔ 已测出）
- `script-src` 里加的 `cspSource` **⛔ 不是"已测缺陷的修法"**：我原先的判断是"`import()` 出来的分块带不上 nonce
  ⇒ 宿主层那三颗分块会被 CSP 拒"，但变异臂把 origin 摘掉后**内联探针与外联 chunk 两条 `import()` 路都仍放行**
  ⇒ 本机 Chromium 把调用方 script 的 nonce 传给了 `import()`。那一格如实记 **UNVERIFIED**；
  保留 origin 只是⛔ 对"nonce 到底传不传递"这件事不做赌注（放行面收在 `localResourceRoots` 内我们自己的 dist）。
- **唯一的大开放项＝webview 的 `localStorage` 持不持久**：`src/` 里 45 处真调用点，其中**沙盒电路文件正文**
  （`verilog-viz-sandbox-files`）**完全不经过宿主**（`sandboxStore.ts` 里 `getHost|hostFire|saveProjectFile` 计数 **0**）。
  VS Code 官方对 webview 的建议是 `getState`/`setState`，⛔ 认可 `localStorage`。这一轮**⛔ 先动代码**：
  两种下落要两种修法，先按 `docs/MIGRATION_VSCODE.md` §5A 第 5 格取真机读数（关面板→关窗口→重开→电路还在吗）。

## [未发布 Unreleased] — R136（2026-10-13）

### Changed
- **前端调用层中立化（VS Code 套壳迁移第一步）**：新增 `src/lib/host/`——一份 `ProjectHost` 接口 +
  三档实现（`tauriHost` 等价搬运 / `vscodeHost` Webview 侧带 id 配对与超时的 JSON-RPC / `browserHost`
  给 dev 与无头闸门）。原先散在 5 颗文件里的 **20 处** Tauri 直连（`exportUtils` 1、`fileStore` 14、
  `projectConfigStore` 2、`CodeEditor` 3 处剪贴板）与 `WindowControls` 自带的运行时探测全部收口；
  现在 `src/` 里除 host 目录外 `@tauri-apps` 引用为 **0**。UI 行为与文案**逐点保持原样**
  （fire-and-forget 的 `Failed to …` 前缀一字未改）。
- 三条不变量：宿主探测**每次调用现读**（否则 `r12-export` 验原生保存路径的三格会变假绿灯）；
  `browserHost` 的文件类方法**必须 reject**，不许返回空表（`fileStore.refresh()` 会把空表当
  "磁盘上文件已删"，从而抹掉 localStorage 里用户的全部文件）；VS Code 那档消息按 JSON 序列化，
  导出字节走 **base64**、一问一答按 id 配对（⛔ 拿"最后一条回复"当结果）。

### Added
- `tests/unit/host.test.ts` 13 格（node 环境，无需浏览器）：探测换档、reject 形状、base64 分块、
  并发 id 不串号、超时、`hostFire` 留痕。首跑即抓到一颗真形状错——"不支持"那几颗原本 `throw`
  （同步炸）却声明成 `Promise`，`h.x().catch()` 会在调用点炸开 ⇒ 全改 reject。
- `docs/MIGRATION_VSCODE.md`：迁移执行台账（实测耦合面 / 已落地层 / 套壳基座选型 / 步骤射程 / **点验单**）。

### Fixed
- 两颗被 R132 hooks 化搬空的生产侧证人（产品没坏、锚点漂了）：`r81-line-gate` [6] 与
  `r83-errorcopy-gate` [7]/[7b] 原先只读 `src/App.tsx`，而 `line: err.line` 与「正在编译…」
  已搬进 `hooks/useCompilePipeline.ts` ⇒ [7] 变成**看不见 hook 的假绿灯**、[7b] 误红。
  现在扫"生产侧文件集合"（App + 组件 + `src/hooks/*`）并在读数里报告扫过哪几颗文件。

## [未发布 Unreleased] — R134 → R135（2026-10-13）

### Fixed
- **编译模式「导出 SVG」打开是纯黑矩形、文字看不见**（用户 2026-10-13 报）：深色主题的器件填充本就是
  近黑的 `rgb(35,40,48)`，构建器却写死 `#ffffff` 白底 ⇒ 黑块压白底、浅色字压白底。现在导出底色
  ＝**屏幕上那张画布的颜色**（容器链向上取第一颗不透明背景，退回主题令牌 `--canvas-bg`）。
- **导出的图整块被挪出画面**：克隆里摘掉「视口层」平移/缩放后，viewBox 仍按**带平移**的
  `svg.getBBox()` 开 ⇒ 内容与框错开（实测 18px，滚过/缩放过更离谱）。现在取景与内容用同一坐标系。
- **导出可能导出成图标**：`querySelector('svg')` 在钻进子模块（面包屑箭头图标）或开着输入面板浮层时
  取到的是 24×19 的 lucide 图标。现在走 `pickPaperSvg()`（先认 `.joint-paper svg`，退化取面积最大的一颗）。
- 内联样式补齐 `marker-*`/`visibility`/`display`/`color`/`dominant-baseline`（连线箭头是 marker 画的，
  漏一项就"少画一样东西"），并去掉导出里的 joint 工具/手柄层。

### Changed
- **自包含 SVG 收成一份主人**：`exportUtils.buildStandaloneSvg()` 供编译模式与沙盒共用，
  `utils/sandboxExport.ts` 不再各自克隆/铺底/取景（两模式从此不会再各自漂）。
- 证人同步：`r12-export` 里"文件含 `#ffffff`"换成**成对判据**（文件底色 == 屏幕画布底色）。

### Added
- `tests/r135-svg-export-gate.cjs`（7 格，已进 `run-all.cjs`）：判据读**下载下来的字节**并与 live paper 配对
  ——选对 svg／网络名在文件里／文字与底色亮度差≥60／取景同一坐标系／电路 JSON devices 与 paper 器件成对／
  综合网表三层 module 全在册＋带名连接实例／底色跟随主题。首跑 **7 pass / 0 fail**。
- `pnpm test`（vitest，`tests/unit/lib.test.ts` 15 格）：锁定 lib 层纯函数当前实测行为，
  为「UI 改 VS Code 套壳、lib 不变」的迁移准备安全网；`tests/unit` 已纳入 `tsconfig.include`。

---


## [未发布 Unreleased] — R121 → R123（2026-10-10/11）

### Added
- **R121 沙盒画布注释（便签）**：双击空白建签即输入、`Esc` 提交、二次编辑、自动换行贴字、
  边拖改比例 / 角拖等比缩放（文字随缩放）、旋转/镜像与部件同通道、编辑时正向文字、
  展开图同坐标原位叠加。闸门 17 格 + 全量回归。
- **R123 部件循环依赖检测与断环**：放置自嵌套/互嵌当场拒绝并展示环路径；存量环档案
  展开图渲染 ⟲ 空壳不崩；画布顶部常驻警告条点名环。闸门 6 格。
- **R122 沙盒自动保存**（设置面板三态：关/开+间隔/防抖落盘）与 **Tauri 原生导出对话框**统一路径。
- **Ctrl+F 焦点分流**：编辑器内=查找替换；画布上=部件搜索（两模式）。
- 部件绑定入口统一为文件级「部件绑定」弹窗；综合网表 / 电路 JSON 导出。

### Changed
- 导出收口：两模式统一走 `saveExport` 单一真源（Tauri 原生对话框 / 浏览器回退）；
  SVG 改深度重绘（计算样式内联，无 foreignObject）。**PNG 导出下线**（用户侧确认中）。
- BusSlice 切片配置记法定案：`起始位:结束位` **含两端**（`0:3` 取 4 位、`1:1` 取 1 位，
  兼容 Verilog 降幂 `3:0`）；总线总位宽收缩钳制修复。
- 编译模式点击连线改为**高亮连线本身**（原误映射为两端器件）。
- SandboxCanvas 前言区抽出 `sandboxCatalog.ts`（拆分第一步）。

### Fixed
- 切档重建读 store 最新实体（修「切回文件编辑显丢失」回归，r122 闸门 9/9）。
- 注释三处视觉缺陷（文字与框分离 / 继承描边 / 拉伸缩放文字）。
- 嵌套模块展开图「内部电路渲染失败」（上游 cloneDeep 拷死内嵌 graph，卷十九全案）。

## [R113-R120] — 2026-10-08/09

- **Added**：表达式生成器（R117 布尔式→电路；R118 多语句+CSE+直接存部件；
  R119 多位总线与切片 `a[msb:lsb]`；R120 `{A,B}` 拼接/常量/级联）；
  两模式左栏视觉统一（R115）；常量折叠显示（R114）；综合脚本双流化（R116）。
- **Fixed**：镜像/旋转组合操作根因修复（R113 模型级镜像重写）。

## [R99-R112] — 2026-10-07

- **Added**：模型级镜像随存档往返、文件级部件绑定（对齐编译模式 moduleBindings）、
  FSM/存储器端口配置器、走线全局化、深色主题标注全链路、仿真速度双模式统一。

## [R37-R40] — 2026-10-05（仓库重建基线）

- **Changed**：`.git` 元数据损坏 → 工作树重建（R33-R36 提交对象丢失，`8b75165` 全量检查点起步）。
- **Added**：部件 = 可编辑 `.djs` 文件 + 作用域感知绑定（R39）；展开图完整交互
  （光标锚定缩放/平移/递归钻取，R38/R40）；复制到沙盒递归迁移子模块。
- **Fixed**：`paper.model.toJSON()` 挂死 → 白名单序列化体系；`found id duplicities in ports`
  → IO net 唯一化；net 高亮/点击语义修复。

---

> 更早历史（R1-R36）因仓库重建丢失提交对象；过程与决策全链见
> [审查账本](./PROJECT_DEEP_REVIEW_2026-10-05.md)（卷一起）与 [archive/](./archive/)。
