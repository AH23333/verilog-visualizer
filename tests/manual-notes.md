# 真机大批量走测记录（2026-10-18 夜，四批制）

> 纪律：只记不修；批4 汇总统一修。基座 D:\vv-studio\vscode，工作区 D:\vv-it-manual，HEAD 2a0aaf2。
> 工具侧变通：computer-use 的 right-click 不触发 VS Code contextmenu（原生 Explorer 同样不出＝非扩展病）；
> 绕行＝PowerShell user32 mouse_event 真右键（截图坐标×1.518/1.506 换算到 1920x1200）。

## 批1 编译域

- [OK] 活动栏双容器（代码编译 >_ / 沙盒编辑 积木）；「代码编译」三子视图（文件/模块 Modules/层次结构 Hierarchy）齐全，首点渲染稍慢（~2s 后出）。
- [OK] 文件树：lib/ + adder.v/broken.v/mux.v/top.v，图标+大小正常；单击树项打开编辑器（命令接线活）。
- [OK] 语法高亮正常（module/关键词着色）。
- [OK] 层次结构树随活动文件出 adder/mux 两节点（sub 未出——待查：sub 定义在 lib/sub.v，实例名 u_sub、模块名 sub）。
- [OK] Explorer 右键 top.v：出「编译并查看电路 Ctrl+F5」「新建 Verilog 文件」「打开部件绑定配置…」。
- [问题A·中] Explorer 右键 .v **缺「部件绑定」弹窗项**：package.json explorer/context 的 verilogViz.bindParts 只 when resourceExtname==.djs（L604-607），.v 无——codeFiles 树有（L379），Explorer 漏。
- [OK] codeFiles 树右键 top.v：部件绑定 / 检查绑定完整性… / 写全绑定配置 / 打开部件绑定配置… / 编译并查看电路 五项全齐。
- [OK] 编译拦下→Problems 两红条（行3/列1、行4/列1 锚点准）＋编辑器红波浪线；树项错误角标「2」（文件树+模块树都显）。
- [OK] 写全绑定配置（命令面板路，活动编辑器兜底）→ 根表落 `top.v::adder→adder.v`、`top.v::mux→mux.v` 前缀键 ✓。
- [问题B·高] **树右键「写全绑定配置」报「先在编译域或沙盒域文件上右键」**：菜单命令 arg 没被 menuUri 接住（三形皆空），且 activeTextEditor 在 webview 激活时＝undefined ⇒ 双保险全哑。命令本体活（面板路 OK）。view/item/context 实参形状疑为 TreeItem 序列化残体（无 uri/resourceUri）。
  - **根因已定位（批3实锤）**：右键 top.v 开「部件绑定」弹窗标题＝**child.djs**（走 getActiveSandboxDocUri 兜底）。真宿主 view/item/context 传的是 **element（Node）**，而 CodeFilesTree/SandboxTree 文件叶 Node 只有 `name`（相对路径字符串）⛔ `uri` 字段 ⇒ menuUri 三形（fsPath/resourceUri/uri.fsPath）全空。修向：childrenOfLayer 文件叶补 uri（或 menuUri 认 name 形）。
- [问题C·低] BINDING_MISSING 文案「右键『写全配置』」与实际菜单项名「写全绑定配置」不一致。
- [问题D·中] bindingPolicy 设置（auto=同名兜底+提示 / strict=报错，默认 auto）**编译侧完全没消费**——closureOf 无条件报 BINDING_MISSING（只有 webview gateSystem 吃这颗）。设置描述与行为分岔。
- [问题E·高] **parseVerilogInstances primitives 黑名单含 'add'/'sub'**（verilogParseLite.ts L19/L46）——两者非 Verilog 原语，用户模块名撞车 ⇒ 实例永不被识别（探针 sub 漏写漏报，Problems 只 2 条不是 3 条）。
- [OK] watcher 活：手编根表补 `top.v::sub→lib/sub.v` 保存即重编译，BINDING_MISSING 消。
- [问题G·高] **ANSI 逗号续行端口不被解析**（src/lib/verilogParse.ts parseModulePorts L164）：`input a, b` 只抓 a、`input d0, d1, s` 只抓 d0 ⇒ 假阳性「端口 'b'/'d1' 在模块中不存在」×4，编译拦下⛔ 出图。最常见 Verilog 风格直接坏。
- [问题H·中] 外部改盘（Write 工具直写 adder.v/mux.v）**不触发重编译诊断**，Problems 挂旧错；须编辑器内 Ctrl+F5 或编辑器保存才刷新。watcher 只刷树不刷诊断。
- [问题I·低] 焦点不在 .v 编辑器时 Ctrl+F5 被基座「运行不带调试」劫持（出选择调试器 picker）；编辑器上下文内键绑定正常。when 缺 editorTextFocus 限定（现靠 resourceExtname 隐式挡，但 Problems 面板聚焦时 resourceExtname 仍残留 ⇒ 让位给调试器）。
- [问题J·中] 命令面板跑「编译并查看电路」报「先打开 Verilog 源文件」：webview 激活时 activeTextEditor=undefined，compileAndShow 无参兜底哑——与问题B同根（webview 激活⇒文本兜底全失）。
- [问题E2·高] **两解析器黑名单分岔**：extension/verilogParseLite 认 `sub u_sub()` 非例化（黑名单含 sub）⇒ 闭包不收 lib/sub.v；主仓 src/lib/verilogParse 认它是例化 ⇒「模块 'sub' 未定义」假阳性。E 的连锁放大。
- [OK] 编辑器内 Ctrl+F5 重编译：诊断 4→1 即时刷新 ✓（端口逐行声明后 b/d1 假阳性消）。
- [OK] Revert File 后 Ctrl+F5 **出图成功**：IO a/b/s/y/z + u_adder/u_mux/u_sub(subcell) 连线齐、仿真工具条（暂停/单步/速度/波形/输入/复制到沙盒/导出）在位。
- [问题K·中] **编译成功不清旧诊断**：useHostCompile.ts L106-108 成功无冲突分支只 `setProblems([])` ⛔ 上送 `publishProblems([])` ⇒ 宿主 diag().clear() 永不执行，Problems 挂上一条已不存在的错（画布已出图，面板仍「模块 'sub' 未定义」）。
- [OK] 层次树随活动文本编辑器更新（top.v→adder/mux/subcell 三节点）；点 mux 节点跳 mux.v ✓；模块树双击展开出模块子节点、点模块跳定义 ✓。
- [OK] broken.v 编译：BINDING_MISSING ghost 行2列1 + 弹窗通知 + 文件树/模块树角标「1」✓。
- [问题L·低] webview 激活时层次树退 welcome（数据源绑 activeTextEditor，无「最后文本编辑器」粘性）——与 B/J 同根族。
- [问题M·待查] 点编辑器 tab 区（UIA click tab-item「预览」）弹原生错误框「无法解析变量 ${file}。请打开一个编辑器。」——触发命令源不明（疑 webview 激活时某 tab 按钮命令带 ${file} 参数）。需复现定位。
- [问题N·中] **编译失败画布不清旧图**：broken.v 编译拦下后画布仍挂 top.v 的电路，观感误导（看不出当前画布是哪份的）。

## 批2 沙盒域

- [OK] 沙盒容器三视图分域正确：文件树只列 .djs（.v 不掺和）、部件树列全部 .djs（缺省 role=part ✓）、层次树 welcome「打开 .djs 电路画布…」。
- [OK] 标题钮悬停显现（新建沙盒电路/新建文件夹/导入/刷新/全部折叠）——与编译树同款。
- [OK] 新建电路 QuickInput：默认「电路.djs」、提示自动补后缀；建 demo.djs/child.djs 均成，树即时刷新、尺寸角标随保存更新（0 KB→0.6 KB）。
- [OK] .djs custom editor 画布全开：部件面板（逻辑门 8 颗+9 分类+部件分类）、工具条（暂停/单步/重置/速度/波形/撤销/重做/保存/自定义门/表达式生成/SVG/综合网表/JSON/部件绑定/输入输出）。
- [OK] 点「与门」放置成功（选中态高亮、tab 脏标●、Ctrl+S 落盘 590B 合法 json）。
- [OK] 画布空白右键菜单：放置部件▶/插入示例▶/粘贴/全选… ✓。
- [OK] 新建文件夹 parts 即时上树。
- [OK] 文件树点 demo.djs 打开其画布（内容回显 ✓）。
- [问题S·高] **画布部件清单空供**：部件（可编辑电路）分类只显「把当前电路保存为部件后可复用」空提示——child/demo 互为兄弟 .djs 都在盘上，gates 清单却为空 ⇒ 无法放置 Subcircuit、无法测「写全配置」提示条（批2 主链断）。疑 partFileSource（customEditors init 推 siblings）断链或新建文件不重推。
- [问题R·中] Ctrl+F 部件搜索浮层卡死：输入框「demo」悬在面板底部，Esc 关不掉、× 点不动（webview 聚焦后仍未关）；盖住部件分类区。
- [问题Q·低] 部件面板滚轮不响应（wheel 事件未达 webview 滚动容器）。
- [问题T·待证] 放置无 IO 端口部件（demo 仅一颗 And 无 Input/Output）的行为未测——被 S 挡住；修 S 后补测。

## 批3 交叉与边缘

- [OK] 绑定弹窗 UI 骨架活：标题「部件绑定：<宿主>」、placeholder「选实例改绑定；Esc＝完成」、$(gear) 打开绑定配置行、Esc 即关。
- [问题B2·高] 弹窗**打开错宿主**（B 的放大）：右键 top.v 弹窗标题＝child.djs（menuUri 三形全空⇒getActiveSandboxDocUri 兜底）。⇒ 批3「弹窗两级导航完整往返」整项被 B 挡死，修 B 后复验。
- [OK] 编译画布仿真控制：暂停钮生效（单步钮转灰禁用）、导出下拉三项（SVG 图片/电路 JSON/综合网表 .v）。
- [OK] 综合网表导出→原生「另存为」对话框（默认名 broken_netlist.v、类型 Verilog (*.v)、目录落工作区）✓ 取消无残留。
- [问题V·低] 导出默认名跟**最后编译文件**（broken_netlist.v）而非画布当前电路（top.v 的图）——名实不符。
- [问题X·高] **Explorer F2 改名绑定不随迁**：adder.v→adder2.v 后根表 `top.v::adder` 仍指已不存在的 adder.v。根因：G1 迁移只挂扩展自家路径（fs.rename/fs.move/fs.delete 工具、树拖移、C9），⛔ 注册 workspace.onDidRenameFiles/onDidDeleteFiles——Explorer 改名/删除走 workbench 原生编辑，扩展全程不知情。台架 277 全绿测的是 fs.rename 工具路＝又一例"假件自证"分岔。
- [OK] watcher 对绑定表手编即效（批1 已证）；.djs 新建/保存/树刷新链路（批2 已证）。

## 批4 统一修复与上屏复验（2026-10-18 深夜）

### 复验读数（真基座 pid=1396，全活 bundle）
- [OK·B/B2] 树文件叶带 uri；右键 top.v 弹窗标题＝top.v；两级导航往返（写表→回一级→已录标注→选中保持）。
- [OK·E/E2/G] adder/mux 续行端口编译 0 问题出图；sub 例化被认出（绑定表 top.v::sub→lib/sub.v 生效）。
- [OK·S] 沙盒画布部件清单出「demo」按钮（画布隐藏时 panel dispose＝openDocs 只含可见画布，设计如此；siblings push 实测 true）。
- [OK·X] Explorer F2 改名 adder.v→adder9.v→adder.v **双向随迁**（根表前缀键值跟改）——此前被假 API 炸点静默阉割，真全活 bundle 上才真正挂上。
- [OK·H] 外部改坏 adder.v（编辑器未开此文件）→ 自动 1 错锚定 top.v 行3＋toast；外部修复 → 自动清账＋画布重出。
- [OK·K/N] 编译成功清旧诊断；编译失败清画布旧图。
- [OK·A/D] Explorer 右键三项齐；bindingPolicy 描述改口与行为一致。
- [结案·R] 沙盒画布 Ctrl+F **弹窗正常**（新基座复验：弹窗出＋「没有匹配的部件」空画布读数对＋**Esc 关✓**；× 钮与 Esc/backdrop 同一 onClose 回调，代码同源）。此前"无反应"读数＝我点击位贴部件面板（SELECT 护栏 return）假读数；批2"卡死"现场实为部件清单 demo 钮＋删除 ×（S 断供期误读）。⚠ 测试期间基座三次在 press_key Ctrl+F 后 ~1s **干净退出**（exit code 0、无 crashpad、无渲染器错误）——归因 computer-use/基座交互（工具侧），非扩展病；× 钮真机一点验可选（非阻塞）。
- [结案·T] 无 IO 部件（demo 仅 And 无 Input/Output）放置**成功渲染**（cell 上画布＋tab 脏标），无假错误、无 DRC 红；放置成功本就无 toast（⛔ 失败路才有提示），设计如此。

### 假 API 事故（本轮最大教训，harness 当场揪出）
- 批4 曾给 extension.ts 补 `workspace.onDidFilesChange` 当"问题H 真根因修复"——**该 API 在 extHost 公开面不存在**
  （fork src 与 out/ 双查无）。台架 282 全绿＝桩是我写的、假件补了颗真宿主没有的 API（假件自证现行犯）。
- 更险的读数是**扩展"半活"假象**：activate 在 L4231 抛错，但抛错点**之前**注册的命令/watcher 照常工作
  ⇒ 上屏 H 闭环"全过"；抛错点**之后**的 onDidRenameFiles/onDidDeleteFiles ⛔ 挂上＝X 修复静默失踪。
  旧诊断"watcher 只对开编辑器文件触发"是误判——真根因只有闭包收缩死锁（bindingRefs 射程集已修，watcher.onDidChange 本就触发）。
- 处置：摘除假 API 块＋桩同步删除＋桩顶纪律注释「⛔ 桩上不得出现 extHost 公开面没有的 API」。
- 终读数：vitest **282/282** · 真宿主 harness **failed=0**（7/7＋哨兵零命中）· 新基座 activate 日志无错。
