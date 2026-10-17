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
| C7 | 部件绑定… | ✅ | .djs 与 .v 均开绑定面板 | [ ] |
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
| X18 | 迁移不带 role/partBindings | 迁出的 `.djs` 全按缺省部件语义，文件级显式绑定丢失 | 批内 id→落盘名映射再写各目录 `.verilogviz.json` | ⏳ 挂账 |
| X19 | hasDjsUnder 名实不符 | 判据收 `.v\|djs` ⇒ 纯源码目录也配出一张空绑定表 | 「目录有部件才配表」的语义裁决点（.v 算不算"有部件"） | ⏳ 挂账待裁 |

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

**验收规程**：每条目标行动=完成后留言 `条目 ✅ + 日期 + 真机点验过程一句`；⛔ 一次性混勾。

| 修订记录 | 日期 | 内容 |
|---|---|---|
| v1 | 2026-10-17 | 依深度核对起表（X 类并入，验收纪律定） |
| v2 | 2026-10-17 | 批次B 落地：G1 三路共源/C9-C11/D4-D5/D7/F1-F4-F6/H1；审查补账 #10-#15；Q1-Q5 默认裁决在册；X8/F5 挂账 |
| v3 | 2026-10-17 | R153：X8+X17 同根闭（域界一颗主人）；X16 迁移丢 .djs 闭；新挂账 X18/X19；A3/C1 证据改名引用（行号会漂） |
