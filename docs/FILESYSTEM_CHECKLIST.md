# 文件系统功能验收表（v1 · 2026-10-17）

> **使用规则**：本表为两模式文件系统全量功能契约。现状列反映 2026-10-17 深度核对后的事实（含 file:line 证据）。
> **⛔ 勾选纪律**：任何条目只有用户真机验收通过后才可在「完成」列打勾；实现完成但未验收 = 只许填 `编码完✓轮`，坚决不落 ✅。
> 修订须先在本表追加补记（日期+改因），⛔ 静默改语义。

## 裁决点（闭锁清单，未决前对应条目封锁)
- [ ] **Q1** B5：单击=打开（现行为）**或** 单击选中+双击打开？
- [ ] **Q2** F5：把 `.djs` 拖进画布生成部件——做否？
- [ ] **Q3** 目录级迁移（D4/D5）与多选拖拽（F6）并入第一轮否？
- [ ] **Q4** H1 circuits 角标图标做否？
- [ ] **Q5** 多根工作区（A11）承诺支持否？

---

## A. 容器与数据源（总纲）
| # | 功能 | 现状 (证据) | 目标行为 | 完成 |
|---|---|---|---|---|
| A1 | 容器归属 | ✅ | 编译容器：文件/模块/层次结构；沙盒：文件/部件/层次结构 | [x] |
| A2 | 项目根 | ✅ dispatch.ts:40 | 根=工作区第一文件夹，树路径=根相对 posix | [x] |
| A3 | 文件域分野 | ✅ projectStore.ts（VERILOG_EXT/SANDBOX_EXT；R153 起由 verilogDomain.ts 一颗主人分发） | 编译树=`.v/.sv/.vh`；沙盒树=`.djs`；文件分域、目录全量上报（空目录也亮） | [x] |
| A4 | 数据来源/watcher | ✅ 编码完（X2 批次A） | 五域 watcher：v/sv/vh/djs/.verilogviz.json（extension.ts:301） | 编码完✓轮 |
| A5 | 排序 | ✅ trees.ts childrenOfLayer | 目录前/文件后，localeCompare（文件 numeric） | [x] |
| A6 | 图标 | ✅ 资源 uri 派生 | 文件符主题 icon；目录主题文件夹 icon | [x] |
| A7 | 空态引导 | ✅ viewsWelcome×2 | 无文件→welcome 链（新建/导入/示例）；无工作区→hint 节点 | [x] |
| A8 | 折叠钮 | ✅ showCollapseAll | 基座自带折叠全部 | [x] |
| A9 | 展开态记忆 | ✅ 原生按 resourceUri | 刷新后折叠态不丢 | [x] |
| A10 | 尺寸角标 | ✅ projectStore collect stat | 文件行 desc=KB（两树统一） | [x] |
| A11 | 多根工作区 | ⛔ 不承诺 | **（待 Q5 裁决）** | [ ] |
| A12 | 符号链接护栏 | ✅ 编码完（X4 批次A） | collect depth=16 护栏+目录软链整支跳过（projectStore.ts:144 / vscodeFsLike.readDir） | 编码完✓轮 |

## B. 左键
| # | 功能 | 现状 (证据) | 目标行为 | 完成 |
|---|---|---|---|---|
| B1 | 文件·编译域 | ✅ trees.ts codeFile 项 | 单击 `.v/.sv/.vh` → 原生文本编辑器 | [x] |
| B2 | 文件·沙盒域 | ✅ trees.ts sandboxFile 项 | 单击 `.djs` → 画布 editor（openWith）⛔ 文本态 | [x] |
| B3 | 目录 | ✅ | 展开/收起，-- 不触发命令 | [x] |
| B4 | 右键误触发 | ✅ | 右键只弹菜单，不使能 item.command | [x] |
| B5 | 双击语义 | ✅（Q1 默认裁决：**维持单击=打开**，VS Code 平台惯例；见补记④） | 维持现行为 | 编码完✓轮 |
| B6 | 键盘 Enter | ✅ 原生 item.command | Enter=同单击命令 | [x] |

## C. 右键·文件菜单（两树各自）
| # | 功能 | 现状 (证据) | 目标行为 | 完成 |
|---|---|---|---|---|
| C1 | 打开·编译域 | ✅ | compileAndShow 进画布（**X8 结案 R153**：`.vh` 入口此前被入口门与 Ctrl+F5 的 `(v|sv)` 挡回；编码+臂绿，真机点验欠） | [ ] |
| C2 | 打开·沙盒域 | ✅ | openDoc → 画布 | [ ] |
| C3 | 重命名·文件 | ✅ sandboxFiles.ts:268-314 | 改名+逐层迁移绑定值、`宿主::实例` 键、根表 circuits | [ ] |
| C4 | 创建副本 | ✅ uniqueName (n) | 同目录 `(n)` 序号；.djs 副本=部件（角色不随）；**复制后要刷树（X5）** | [ ] |
| C5 | 删除·文件 | ✅ sandboxFiles.ts:316-343 | 模态确认→回收站→各层绑定值/前缀键/circuits 清 | [ ] |
| C6 | 部件角色 | ✅ togglePartRole | 切 circuits⇄部件（根表）+「部件」树联动 | [ ] |
| C7 | 部件绑定… | ✅ | .djs 与 .v 均开绑定弹窗（R157⑥：QuickInput 会话，⛔ 标签页面板） | [ ] |
| C8 | 绑定四件套 | ✅ | audit/complete/openBindingConfig（编译域无 materialize——差异留） | [ ] |
| C9 | 移动到… | ✅ 编码完 | QuickPick 选目标目录（含根），走 G1 迁移引擎 | 编码完✓轮 |
| C10 | 复制路径 | ✅ 编码完 | 剪贴板=绝对路径（平台惯例），告示亮根相对（裁决见补记⑤） | 编码完✓轮 |
| C11 | 在磁盘显示 | ✅ 编码完 | revealFileInOS 定位 | 编码完✓轮 |
| C12 | 跨域检查 | ✅ view 圈死 | 编译域文件⛔ 沙盒菜单（反之），by view+viewItem | [ ] |

## D. 右键·目录菜单
| # | 功能 | 现状 (证据) | 目标行为 | 完成 |
|---|---|---|---|---|
| D1 | 在此新建·编译域 | ✅ pkg 27 entries | codeDir：新建 Verilog 文件/新建文件夹/导入文件（落该目录） | [ ] |
| D2 | 在此新建·沙盒域 | ✅ | sandboxDir：新建沙盒电路/新建文件夹/导入文件 | [ ] |
| D3 | 复制文件夹 | ✅ sandboxFiles.ts:354-366 | `x`→`x 副本 (n)` 递归；目录内有 .djs 自动起表；**复制后要刷树（X5）** | [ ] |
| D4 | 删除·目录 | ✅ 编码完 | recursive:true（X1 批次A）+确认=子文件数+**前缀族群清绑定/circuits（G1 引擎批次B）** | 编码完✓轮 |
| D5 | 重命名·目录 | ✅ 编码完 | G1 引擎（migratePrefix）：值/前缀键/circuits 全族随迁；随盘搬走的表跳过 | 编码完✓轮 |
| D6 | 新建文件夹复用 | ✅ | 编译域目录也用 newSandboxFolder（通用 maker） | [ ] |
| D7 | 复制路径/磁盘显示 | ✅ 编码完 | 同 C10/C11 对目录（12 条菜单第 4 组） | 编码完✓轮 |
| D8 | 目录左键展开 | ✅ | 同 B3 | [ ] |

## E. 空白区/标题栏/资源管理器联动
| # | 功能 | 现状 (证据) | 目标行为 | 完成 |
|---|---|---|---|---|
| E1 | 视图空白右键 | ✅（平台顶限） | 原生 TreeView 无扩展空白菜单（官方在册）；以标题钮/welcome/资源管理器空白族覆盖 | [ ] |
| E2 | 标题钮·编译 | ✅ | 新建 Verilog 文件/新建文件夹/导入/刷新 | [ ] |
| E3 | 标题钮·沙盒 | ✅ | 新建沙盒电路/新建文件夹/导入/刷新 | [ ] |
| E4 | 新建落点 | ✅ | 标题钮=根；目录右键=该目录（`../` 消毒） | [ ] |
| E5 | 新建即张榜 | ✅ watcher onDidCreate | 新建 .djs 自动 ensureDirMeta | [ ] |
| E6 | 导入文件 | ✅ 编码完（X6 批次A） | **按入口域过滤**（编译 v/sv/vh、沙盒 djs、通用三档）+skipped 当面告示 | 编码完✓轮 |
| E7 | 资源管理器右键 | ✅ pkg explorer/context | 空白族/.v/.sv/.djs 族 | [ ] |

## F. 拖拽
| # | 功能 | 现状 (证据) | 目标行为 | 完成 |
|---|---|---|---|---|
| F1 | 树内拖移 | ✅ 编码完 | FileTreeDragAndDrop（trees.ts）：文件⇒目录/目录⇒目录=moveToFile 共源移动+G1 迁移+刷新+bindingsChanged；自套自环拒、原地 no-op | 编码完✓轮 |
| F2 | 同级重排 | —（不承诺） | 只做"移动进目录"，不做重排 | — |
| F3 | 域限制 | ✅ 编码完 | 两树各自 MIME 圈死（跨树拖动平台层即拒）+落点域过滤 | 编码完✓轮 |
| F4 | OS 拖入 | ✅ 编码完 | DataTransferFile → 松手目录，(n) 去重，按 E6 域过滤（引擎 ^1.100 满足 ≥1.83） | 编码完✓轮 |
| F5 | 拖入画布 | ⛔ 暂缓（Q2 默认裁决：挂账，见补记④） | .djs→画布变部件 | — |
| F6 | 多选拖拽 | ✅ 编码完（Q3 默认裁决：并入，见补记④） | handleDrag 收多选 uri 数组，逐颗走 moveToFile | 编码完✓轮 |

## G. 数据一致性横切
| # | 功能 | 现状 (证据) | 目标行为 | 完成 |
|---|---|---|---|---|
| G1 | 绑定表迁移引擎 | ✅ 编码完 | **三路共源达成**：migratePrefix（目录前缀族群）+ migrateFileRef（文件精确身份）同一把 tableDirsOf 全表层扫——审查补账 #12 的跨目录 `../` 引用漏迁就此闭账 | 编码完✓轮 |
| G2 | circuits 根表 | ✅ 编码完 | 文件/目录/删除三路都在根表随迁/清（migrateFileRef/migratePrefix 各自尾段） | 编码完✓轮 |
| G3 | 广播链 | ✅ 编码完 | rename/delete/moveTo/拖拽完成 → broadcastBindingsChanged（extension.ts 命令层统一） | 编码完✓轮 |
| G4 | 树刷新 | ✅ watcher+主动 | 操作后主动 refreshAllTrees（拖拽 moveDropped/writeDropped 同样接线） | 编码完✓轮 |
| G5 | 删除回收站 | ✅ useTrash | ⛔ 硬删 | [x] |
| G6 | 删除确认 | ✅ 编码完 | 目录删=「N 个文件；部件记录与绑定将一并清除」（X1 批次A 落） | 编码完✓轮 |
| G7 | 名字消毒 | ✅ | `..`/非法字符统一消毒 | [x] |
| G8 | 重名拒绝/(n) | ✅ | rename 目标占用拒；新建/副本/导入 (n)；**duplicateFolder 算法与 examples.uniqueName 双轨合一（X9）** | [x] |

## H. 沙盒域专属语义
| # | 功能 | 现状 (证据) | 目标行为 | 完成 |
|---|---|---|---|---|
| H1 | circuits 入主 | ✅ 编码完 | 根表 circuits 之外 .djs 全部入沙盒树；**circuits 角标=circuit-board 图标（Q4 默认裁决：做，见补记④）** | 编码完✓轮 |
| H2 | 「部件」树联动 | ✅ | 角色切换→两树同刷 | [ ] |
| H3 | 目录表语义 | ✅ | 目录有部件才配表；复制/新建同口径 | [ ] |

---

# “假✅”补账（X 类 + 审查补账，闭账状态 2026-10-17 批次B 后）
| # | 功能 | 现状 | 目标 | 状态 |
|---|---|---|---|---|
| X1 | 目录删除 | sandboxFiles.ts deleteFile recursive:true+子账确认 | D4 同源 | ✅ 闭（批次A） |
| X2 | watcher 域 | extension.ts:301 五域 watcher | A4 同源 | ✅ 闭（批次A） |
| X3 | 目录改名迁移 | migratePrefix 前缀族群批扫 | G1 目录级 | ✅ 闭（批次B） |
| X4 | symlink 环 | collect depth16+软链跳过 | A12 | ✅ 闭（批次A） |
| X5 | duplicate 刷树 | 命令体后主动 refreshAllTrees | — | ✅ 闭（批次A） |
| X6 | import 域设防 | 三分域+skipped 告示 | E6 | ✅ 闭（批次A） |
| X8 | .vh 编译入口 | 待测 | 车载测试后定 | ⏳ 挂账 |
| X9 | (n) 算法双轨 | naming.ts 唯一口径（uniqueName/uniqueFolderName） | G8 收编 | ✅ 闭（批次A） |
| #10 | renameFile 输入逃逸 | 裸收 `../` 可改名出工作区 | sanitizeNameInput(single) 消毒 | ✅ 闭（审查批次B） |
| #11 | newVerilogFile/newSandboxFile 逃逸 | 裸收 `..` 段可新建出工作区 | sanitizeNameInput 段消毒 | ✅ 闭（审查批次B） |
| #12 | 文件级迁移跨表漏 | 只扫祖先链，跨目录 `../` 引用悬空 | migrateFileRef 全表层精确身份扫（G1 文件路） | ✅ 闭（审查批次B） |
| #13 | CodeFilesTree 空态崩 | hint 节点走 uriOfRel(undefined) TypeError | getTreeItem 无 name 早退 | ✅ 闭（审查批次B） |
| #14 | moveToFile 原地白跑 | 同目录"移动"会 (n) 顺延改名 | destRel===srcDir 短路 no-op | ✅ 闭（审查批次B） |
| #15 | 表扫深度不一 | collectTableDirs=8 vs A12 口径 16 | 默认深度统一 16 | ✅ 闭（审查批次B） |
| X16 | 旧档迁移丢 `.djs` | collectLegacyItems 把 Record 当数组迭代 ⇒ TypeError 被 catch 吞；单一墓碑连坐两半 | 两形状都收 + 两半颗各自墓碑（老键只管 .v ⇒ 被坑用户自动重 Offer） | ✅ 闭（R153 片C1） |
| X17 | `.sv`/`.vh` 半数入口隐身 | 域判定六处写死且不一致（模块树/层次树/scanDefs/门槛/编译入口/剥扩展名读反 + manifest when/键位） | verilogDomain.ts 一颗主人；十处消费点改问它；静态禁项尺在岗 | ✅ 闭（R153 片C2＝X8 同根） |
| X18 | 迁移不带 role/partBindings | 迁出的 `.djs` 全按缺省部件语义，文件级显式绑定丢失＝"看同名谁像就绑谁" | 批内 id→落盘名映射再写各目录 `.verilogviz.json`（走 `setBindingInDir` 单层合并，⛔ `setDocBindings` 整表替换会抹用户手编条目） | ✅ 闭（R154）：前端 `collectLegacyItems` 交 key/role/bindings，宿主按 key 连落盘名；证人三颗＝`legacyMigration.test.ts`「X18 正件」+ `extensionHost.test.ts`「X18：旧档迁移把部件身份一起带走」+「X18 两半接得上」（接缝臂，由台架 M4 撞出来才补的）；台架 `bin/C5/bench_c5_x18.py` 五臂 0 不合格 |
| X19 | hasDjsUnder 名实不符 | 判据收 `.v\|djs` ⇒ 纯源码目录也配出一张空绑定表 | 「目录有部件才配表」的语义裁决点（.v 算不算"有部件"） | ⏳ 挂账待裁 |
| X20 | 「自动同名」按构造命不中 | 面板与 bindings.materialize 的 .v 侧拿**闭包 job.files** 建同名索引，而闭包只含"已录入绑定"的文件 ⇒ 未录入实例恒 null／一键落表恒 0 颗（＝"点了没反应"） | 两处改问 `scanDefs`（模块名→真定义它的文件，与「写全配置」同一颗主人） | ✅ 闭（R153 深度自检） |
| X21 | 根相对名七份实现 | 六份各自写＋一份在 `collectTableDirs`（那条两侧同源小写，暂判安全并已注因）；其中三份"按根串长度切" ⇒ 盘符大小写一漂就交半截或整颗绝对路径 | `verilogDomain.rootRel` 一颗主人（path.relative 口径＋根外折回绝对路径），六份转交；形状臂＋禁项尺在岗 | ✅ 闭（R153 深度自检） |

---

## 补记（v2，2026-10-17 批次B 落地时）

1. **批次A（e6f1281，上一代理提交）**：X1/X2/X4/X5/X6/X9，189/189。
2. **批次B（本次，接手中断点续完）**：G1 引擎三路共源（migratePrefix+migrateFileRef）、C9/C10/C11/D7、F 族拖拽（F1/F3/F4/F6）、H1 角标；审查修 #10-#15 六缺陷；台架 200/200（+11 新钉），build/双 tsc 全绿。
3. **验收纪律不变**：`编码完✓轮` = 实现完+台架钉绿、**真机点验前⛔ 升 ✅**。上一批 [x] 勾按同义读。
4. **Q1–Q5 默认裁决**（用户指令「完成整个文件系统」下由代理按保守 defaults 代定，**可推翻**）：
   - Q1(B5)：**维持单击=打开**（VS Code 平台惯例，双击语义务必有平台先例再议）；
   - Q2(F5)：**暂缓**——拖入画布要跨画布协议，超出文件系统战役射程，挂账；
   - Q3：**是**——D4/D5（已随 G1 引擎）与 F6 多选拖拽并入本轮；
   - Q4(H1)：**做**——circuits 项挂 circuit-board ThemeIcon（廉价可逆）；
   - Q5(A11)：**维持不承诺多根**（A11 未动）。
5. **C10 口径微调**：剪贴板放**绝对路径**（终端/资源管理器粘贴的通用语义），根相对在告示里同亮——原表「两者进剪贴板」双行粘贴反而不实用；有异议改回即可（一行）。
6. **遗留**：X8 .vh 编译入口待车载测试；F5 挂账；真机点验单待用户执行。

**补记 v3（2026-10-17，R153 片C1/C2）**
1. **X8 与 X17 同根同闭**：X8 不是"入口行为待测"一颗孤格——「哪些文件算编译域」在扩展里写了六遍
   且三处答案不一致（.v/.sv/.vh 的表 vs 六处 `*.v`/`(v|sv)` 手写，含剥扩展名那颗**读反的**
   `/\.sv?$/`）。R153 起域判定只有一颗主人（`extension/src/verilogDomain.ts`，域界住
   `projectStore` 的 VERILOG_EXT/SANDBOX_EXT），十处消费点全部改问它；静态禁项尺
   （vscodeShell「域界一颗主人」组）钉「除主人外⛔ 再出现调用形状的域判定」。
2. **X16 迁移两半颗各用自己的墓碑**：老键 `verilog-viz-legacy-migrated` 语义收窄到只管 `.v`
   （⇒ 被 bug 坑过的用户沙盒档自动重新被 Offer，⛔ 重复落盘 .v）；新键管 `.djs`。
3. 新挂账 X18（迁移不带 role/partBindings）、X19（hasDjsUnder 名实不符＝语义裁决点）。
4. 台架：`bin/C1/bench_c1_migration.py`（13 臂）与 `bin/C2/bench_c2_domain.py`（12 臂），
   判据＝红名集合等式；vitest 238/238、root tsc+vite build、extension tsc/esbuild 全绿。

**补记 v4（2026-10-17，R153 深度自检批）**
1. **X20/X21 落账并闭**（见上表）：上一批那句"同名查表键带着 `.v`"只对了一半——真根因是索引
   建在闭包上（未录入实例的定义文件⛔ 在闭包里），两颗入口按构造恒空；且我挑的 `pathRel`
   正是七份根相对名实现里会交坏值的那份。
2. 台架形状升级：C2 台架 12→**16 臂**，并加**名册尺**（本批每颗新证人至少被一臂点名，
   缺一颗就停手）——它当场抓到"根内相对名形状"那格没有臂能打破，遂补 M16（枢纽函数⛔ 存在
   窄变异，射程 26 臂逐颗核过消费者后写成等式）。旧 M7 随被替换的代码退役（留话⛔ 静默摘格）。
3. 收口读数：vitest **242/242**；root tsc+vite build、extension tsc+esbuild 全绿；
   C1 13 臂／C2 16 臂各 0 不合格＋与快照逐字节还原。六份根相对名转交后⛔ 一颗既有臂翻色。

**验收规程**：每条目标行动=完成后留言 `条目 ✅ + 日期 + 真机点验过程一句`；⛔ 一次性混勾。

## 真机点验单（R154：⛔ 我这侧跑不了、只能上屏判的那几格）

每格写清「做什么 → 应当看到什么」，并把我这侧**已有的无头证据**与**⛔ 没有证据**分开写。
⛔ 打勾（✅）归用户：那些格需要真壳（`pnpm app`）+ 真工作区 + 真编辑器焦点，我这边一律只登记成"未跑"。

| # | 操作 | 应当看到 | 我这侧的证据 | 状态 |
|---|---|---|---|---|
| P1 | 打开一颗 `.vh`，按 Ctrl+F5 / 编辑器标题栏「编译并查看电路」/ 右键同名菜单 | 三处入口都在（X8 修的正是"其中两处只认 `.v/.sv`"），且 `.vh` 的编译单 `topModule` 兜底＝文件名去扩展 | X 层：`extensionHost.test.ts` 的「X8 `.vh` 编译」臂 + 「topModule 兜底」臂；U 层：manifest 四处的 `.v/.sv/.vh` 三串 | 未跑（真机看菜单项渲染与焦点态） |
| P2 | 往工作区丢 `probe.sv` / `probe.vh`，看「模块」板与「层次」板 | 两块板都列得出来（⛔ 只有一块——那是 X8 的原形） | X 层：「两块板上都亮」那一族臂（合成夹具，`examples/` 里**没有**真 `.sv/.vh` 样例） | 未跑（正件样例欠着，见挂账） |
| P3 | 画布 webview 首开（旧档在 localStorage 里含 `.djs`） | 横幅 Offer 的是**那些 `.djs`**（X16 前只 Offer `.v`，`.djs` 永久认不得）；「迁移到工作区」后逐颗落盘、「不再提示」两半一起封 | U 层：`tests/unit/legacyMigration.test.ts` 12 臂（含 Record 形状正件与两颗墓碑各管半颗） | 未跑（真机要看 webview 里的 localStorage 是否真有旧档） |
| P4 | 打开「绑定」面板，看一颗未录入的同名实例行 | 「自动同名 → `lib/adder.v`」亮得出来（X20 前那一栏按构造恒 null＝点了没反应） | X 层：「未录入实例那一行亮得出」臂 + `bindings.materialize` 的 `.v` 侧真落表臂 | 未跑（面板实际排布、列宽、中文串上屏） |
| P5 | 资源管理器里复制一颗**纯 `.v`** 的目录 | ⛔ 凭空出现 `.verilogviz.json` 空表（X19）；复制含 `.djs` 的目录才建表 | X 层：「只有 Verilog 源码的目录」臂 + 负件臂 | 未跑（真机看原生复制的时序） |
| P6 | 编译出电路 → 点「复制到沙盒」 | 工作区出现 `入口名/` 目录：主电路 `x_sandbox.djs` + 每颗子部件一颗 `.djs`，**双击即在自定义编辑器里可编辑**；该目录的 `.verilogviz.json` 里逐条显式绑定 | H 层：`r42-verify` 的 [P]（真点击＝一次 `copyToSandbox` RPC，载荷含主电路 + ≥2 颗子部件，告示文字对上）；L3：那批字节在沙盒画布上真渲染（[3b][4b][4c][2b][7]） | 未跑（⚠ 我这侧截的是**交给宿主之前**的载荷；"宿主写盘 + watcher 刷树 + 双击开档"只有 extensionHost 桩与真机两把尺） |
| P7 | 配置项 `verilogViz.bindings.policy` 切到 `strict` 后重编译 | 未录入的实例⛔ 走同名兜底，当场点名（与 `auto` 的两面对得上） | X 层：R152「录入即权威」那一族臂 | 未跑（配置界面改动后的即时生效需真壳） |
| P8 | 手编 `.verilogviz.json` 保存 | 编译面板即重算（⛔ 要重按 F5）；而画布那侧即时生效 | X 层：「手编 `.verilogviz.json` 保存 ⇒ 编译面板即重算」臂 | 未跑（保存事件在真壳里的时序） |

---

## 真机读数（R155 夜，2026-10-18 05:24–05:28 UTC+8·探针工作区 `D:\vv-studio\probe-ws`）

**跑法**（⛔ 动他那份 `D:\vv-studio\profile`）：`pnpm build` → 直接拉我们自己的二进制
`D:\vv-studio\vscode\.build\electron\Verilog Visualizer.exe . D:\vv-studio\probe-ws
--extensionDevelopmentPath=…\extension --user-data-dir=D:\vv-studio\probe-profile --disable-gpu --no-sandbox`，
GUI 用 Computer Use 点，读数取屏幕 + 盘上审计账（两路成对）。
⚠ 起进程前数过别人的实例＝**0 颗**（这台机器当时只有 Qoder 在跑）。
⚠ 从代理 shell 起真机**必须 `env -u ELECTRON_RUN_AS_NODE`**（设成空串⛔ 等于取消——Electron 只看它在不在）：
第一发就栽在 `The requested module 'electron' does not provide an export named 'Menu'`，
症状与 `docs/REAL_HOST_E2E.md` 记的那次一模一样。

| 屏 | 看见的（原样） | 判 |
|---|---|---|
| 活动栏 | 我们的两块板都在：**代码编译**、**沙盒编辑**（与 资源管理器/搜索/源控/运行/扩展 并列） | 通 |
| 资源管理器 | `probe-ws` 下 `.vv/`、`.verilogviz.json`、7 颗 `.djs`、4 颗 `.v`、`probe.sv`、`probe.vh` 全列出，图标按域分（`.djs` 与 `.v` 不同符） | 通（A3/B1/B2 上屏） |
| 编译面板空态 | 「还没有电路」+「在 .v 编辑器标题栏点『编译并查看电路』（Ctrl+F5），电路会显示在这里。」——**整句中文** | 通（V2 那族已修的形状） |
| 点 `adder.v` → Ctrl+F5 | 文件在原生文本编辑器打开（标题 `adder.v`），资源管理器那一行右侧亮 **1** 的错误角标，状态栏 `✕ 1` | 通 |
| Problems 面板 | 一行：`[BINDING_MISSING] 模块「full_adder」（在 adder.v）未录入绑定配置：右键「写全配置」或用「部件绑定」弹窗录制。` 源＝`Verilog Viz`，位置＝行 15 列 1 | 通（R152 绑定权威上屏＋**补救话**＋**行列精确**） |
| 点 `adder.djs` | 自定义编辑器（⛔ 文本态）：画布真渲染出门/线/IO/子电路实例，左palette 九组、工具条 暂停/单步/速度/波形/保存/自定义门/表达式生成/SVG/综合网表/JSON | 通（B2/C2 上屏） |
| 画布上的绑定提示条 | 「4 个子部件实例靠同名兜底解析，未录入绑定配置：full_adder、full_adder、full_adder、full_adder」旁边**就有一颗「写全配置」按钮** | 通（补救动作⛔ 要用户手改表——他那条"⛔ 额外步骤"规矩的形状） |
| 沙盒编辑三板块 | 文件＝7 颗 `.djs`（带 KB）；部件 Parts＝同 7 颗；层次结构 Hierarchy＝`full_adder  adder.djs` | 通（H 域上屏） |
| 盘上审计 | `probe-ws/.vv/audit/trace-2026-10-17.jsonl` 两行：`host.getConfig auto`、`host.publishProblems auto items:array[1]|143B`（⛔ 正文，只记形状） | 通（§9.5 真壳落盘） |

**这一轮⛔ 判到的（要说清，⛔ 让下一批以为 P 表被覆盖了）**：P1（`.vh` 三处入口）/P2（`.sv/.vh` 在模块与层次两块板）
/P3（旧 localStorage 档的迁移横幅）/P5（复制纯 `.v` 目录⛔ 建空表）/P6（复制到沙盒的落盘+双击）
/P7（policy=strict）/P8（手编表保存即重算）＝**仍未跑**。
本轮点的是"两模式可见＋编译报错链＋`.djs` 编辑器＋沙盒三板块"这一组，与 P 表**部分重叠⛔ 相等**。

**新挂账（这一轮顺手抓到的两颗）**：
- **X22 首启向导挡在画布前面**：全新 `--user-data-dir` 第一次起我们的二进制，Workbench 会弹
  「欢迎使用 VS Code／登录以使用 GitHub Copilot」（下一步还是主题选择「自定义」），
  要人**手动点掉**才看得见我们的面板。按"任何'请重启/请确认'都算缺陷"这条＝**缺陷**：
  修法在基座侧（默认 `workbench.startupEditor: "none"` + 我们这份 product 里关掉登录/Copilot 提示），
  ⛔ 让用户第一次打开就先学一遍微软的向导。**未修**（属基座分叉，另批做）。
- **X23 探针夹具的绑定表只覆盖 `.djs::` 前缀键**：`probe-ws` 那份 `.verilogviz.json` 是从 `test_files/alu_top/`
  整颗拷来的，里面只有 `adder.djs::full_adder` 这类键，⛔ `adder.v::full_adder` ⇒ 编译 `adder.v` 必报
  BINDING_MISSING。**这是夹具的账，⛔ 记在产品头上**（也正因如此，这一发意外把"报错链＋补救按钮＋Problems 行列"
  三条一起验了）。下一轮要跑 P1/P6 之前，先把探针工作区的 `.v` 侧键补上。


| 修订记录 | 日期 | 内容 |
|---|---|---|
| v1 | 2026-10-17 | 依深度核对起表（X 类并入，验收纪律定） |
| v2 | 2026-10-17 | 批次B 落地：G1 三路共源/C9-C11/D4-D5/D7/F1-F4-F6/H1；审查补账 #10-#15；Q1-Q5 默认裁决在册；X8/F5 挂账 |
| v3 | 2026-10-17 | R153：X8+X17 同根闭（域界一颗主人）；X16 迁移丢 .djs 闭；新挂账 X18/X19；A3/C1 证据改名引用（行号会漂） |
| v4 | 2026-10-17 | R153 深度自检：X20（自动同名按构造命不中）／X21（根相对名七份）落账并闭；台架 12→16 臂＋名册尺；vitest 242/242 |
| v5 | 2026-10-18 | R154：X18 闭（两半 + 接缝臂 + `bin/C5/bench_c5_x18.py` 五臂 0 不合格）；新增「真机点验单 P1-P8」；全量跑批读数 73 格＝GREEN 12 / RED 61（族谱四支＋逐颗四颗）写进 `docs/GATE_LAYERS.md` 第⑤节；vitest 250/250、`pnpm build` ✓ |
| v6 | 2026-10-18 | R155：真机一轮（探针工作区＋Computer Use＋盘上账对屏）读数入档＝上面那节；新挂账 **X22**（首启 VS Code 欢迎/Copilot 登录向导挡画布，基座侧修）与 **X23**（探针夹具的 `.v::` 键缺失，是夹具的账⛔ 产品的）；同批 `pnpm test:real` 真宿主 12 步全绿、第二次全量跑批 74 格＝GREEN 30 / RED 44 |
