# R99 交接文档（沙盒可见样式统一批 → 下一代理）

> **〔已被取代〕** 最新交接见 `docs/HANDOVER_R113.md`（2026-10-08，R100→R113 全部入库并 push）。
> 本文档 §4 待办：第 1/2/3/6/7/8 项已于 R100→R113 完成；第 4 项（侧栏视觉对齐）、
> 第 5 项（调试功能样式统一）仍开放，转记于 HANDOVER_R113 §5。

> **〔已接手〕** 本文档的待办已于 2026-10-06 由下一代理执行完毕（§4 第 1–4、7 项：
> gate 注册、r99-mutate 台架 4/4 咬住、全量 60/60 有着落、侧栏视觉对齐、文档收尾）；
> 续记见 `docs/PROJECT_DEEP_REVIEW_2026-10-05.md` **卷十一**。§4 第 5 项（调试功能样式统一）、
> 第 6 项（翻转持久化探针）、第 8 项（杂物清理，待报备）仍开放。

- 交接日期：2026-10-06
- 交接原因：用户指令「停止任务，交由其他代理完成，你需要编写交接文档」
- 仓库：`verilog-visualizer`（独立 git 仓，**非**外层 Something 目录）
- **HEAD：`36136f8`（fix: tsc 类型注解）**
- ⚠ **全部 R94→R99 的产品改动只存在于工作区，未提交**（`git status` 约 40+ 个 M 文件，含 src/tests/docs）。接手后先 `git status` 自查，⛔ 未经用户逐次授权不得 commit/push。

---

## 1. R99 批次范围（用户原话要旨，技术射程）

1. 沙盒侧边栏所有可见样式与编译模式完全一致
2. 沙盒绑定功能加入右键菜单（与编译模式一致），绑定系统可见样式一致
3. 滚轮/Shift+滚轮＝平移，**只有 Ctrl+滚轮＝以鼠标为中心缩放**（两种模式都要对）
4. 沙盒多选旋转：绕多部件形成的**矩形区域中心**旋转，不是各绕自身
5. 沙盒新增水平/垂直镜像翻转（支持多选）
6. 聚焦部件/线路高亮改**主题紫色**（深色主题下黑灰看不清）
7. 总则：一切可见样式尽可能与编译模式统一，调试功能样式也统一

## 2. 已落地改动（已核对源码在位）

| 文件 | 改动 | 锚点 |
|---|---|---|
| `src/components/SandboxCanvas.tsx` | Shift+滚轮纵向平移（onWheel 分支） | :2656 附近 |
| 同上 | `rotateSelection`：多选先算 bbox 再 `c.rotate(deg, false, origin)`，origin=矩形中心 | :1071 |
| 同上 | `flipSelection('h'\|'v')` 走 `flipCell`，多选逐颗原地翻 | :1104；右键项 :1368-1369 |
| 同上 | 右键 Subcircuit「绑定...」→ `setRebindDlg({cellId, cur})` | :1673 |
| 同上 | 高亮 CSS：`.sm-selected` 特异度抬到 `[data-theme] .joint-paper .sm-selected …`，`stroke: var(--accent-hover) !important` | 样式块内 |
| 同上 | `reconfigureCell` 快照带 `mirror: old.get('mirror')`，spawn 后 `applyMirror` 重挂 | :1263 |
| 同上 | `RebindDialog` / `DffPortsModal` JSX 挂载 | :3957-3960 附近 |
| `src/lib/cellMirror.ts`（新） | 镜像唯一主人：`cell.prop('mirror')` 状态＋body/decor 内联 scaleX(±1)＋端口组位置函数包装 | 全文件 |
| `src/components/RebindDialog.tsx`（新） | 绑定对话框（`data-rebind-dialog`／`data-rebind-row`／`data-rebind-close` 锚点，与编译模式 BindingDialog 同形状） | 全文件 |
| `src/lib/deviceParams.ts` | `CTOR_PARAM_KEYS` 尾部含 `'bits', 'mirror'` | :46 |
| `src/lib/sandboxLoad.ts` | 载入后 `if (c.mirror) applyMirror(cell)` | :99-100 |
| `README.md` / `docs/SANDBOX_DEV.md` | 右键重配置编辑器、signed AND 规则、fillx 等已记 | — |

关键机制（改之前必读）：
- joint `Element.rotate(angle, absolute, origin)` 的 origin 分支自带位置补偿（Element.mjs:449-466），多选旋转**不要**再手写位置平移。
- 镜像不能走 root 级 CSS（会覆盖 joint 的 translate/rotate，门会跳到画布原点）；也不能用 portProp 压过 group 堆叠位置函数——用 per-cell group position 函数包装（已探针实证）。
- digitaljs `_unsupportedPropChanges`（polarity/bits/initial/signed/fillx 等）构造期才有 ⇒ 只许经 `reconfigureCell` 重建，直接 `set` 会被回滚＝假修。
- 有符号 AND 规则：`sgn.in1 && sgn.in2`，两个操作数都必须有符号。

## 3. 验证状态

- `tests/r99-ui-unify-gate.cjs`（PORT 1608）**最后一次运行 5 pass / 0 fail**：
  [1] 多选旋转绕选区中心（cell0→782,384; cell1→782,544）；[2] 高亮 rgb(129,140,248)；[3] 镜像 mirror.h=true＋body scaleX(-1)＋ports 跟随；[4] Shift+滚轮 tx 0→-240、ty 不变；[5]+[5c] 绑定对话框行 ['sub']＋真换绑 celltype→PART_B。
  ⚠ 该次输出只进了控制台，**没有落 `.out-r99-*.txt` 证据文件**；注册进 run-all 后跑一次即补上。
- `tests/run-all.cjs` 的 `GATES`（:32-38）**尚未注册** `r99-ui-unify-gate`（当前尾部 `'r94-dff-polarity-gate', 'r95-signed-toggle-gate', 'selfaudit2-sandbox'`）。
- 历史：全量最好成绩 59/59；r94/r95 变异台架均已绿＋咬住（`.out-r94-bench-final.txt` / `.out-r95-bench-final.txt`）。

## 4. 待办（按依赖序）

1. **注册**：`run-all.cjs` GATES 加入 `'r99-ui-unify-gate'`（一行改动）。
2. **写 `tests/r99-mutate.cjs` 变异台架**（参考 `r95-mutate.cjs` 的 harness 形状）：
   - MA `rotateSelection` 改回各绕自身中心 → 只红 [1]
   - MB `flipCell` 调用摘除 → 只红 [3]
   - MC 「绑定...」菜单项删除 → 只红 [5]
   - MD 高亮规则退回旧特异度（`.sm-selected` 不带 `[data-theme]` 前缀）→ 只红 [2]
   - 纪律：每格只许红该红臂；改完测试文件自查「引用了却没定义的 helper」；`process.exit` 放 `finally`。
3. **统一验证一轮**：r99 gate＋全量 run-all，目标 60/60（gate 逐字对比快照：跑台架前后 `git status` 必须回到同一份改动集）。
4. **[1] 侧边栏视觉对齐**（用户总则项，未开工）：面板共享令牌（--fs-xs/--text/--surface-hover/--border-subtle），需两模式左栏截图 diff（容器宽度/padding/分组头字重）后对齐具体差异。参考探针截图 `tests/.tmp-r99-sandbox-panel.png`。
5. **调试功能样式与编译模式统一**（总则覆盖项，未开工）。
6. **翻转持久化专项探针**：机制与 signed/bits 同通道（CTOR_PARAM_KEYS＋sandboxLoad）但屏幕级验证本轮撞视图恢复复杂度已缓验——存盘→重开→镜像仍在 的专项归下批。
7. **文档/账本收尾**：`docs/PROJECT_DEEP_REVIEW_2026-10-05.md` 卷十一（R99）、`README`/`SANDBOX_DEV` 补镜像＋绑定对话框条目。
8. **清理杂物**（先向用户报备再删）：仓库根 `bash.exe.stackdump`、`polarity[k]`、`但可以双向走动…`/`入口：左侧`/`定位：独立于「Verilog`/`文件存在浏览器` 四个碎片文件（疑似早年 shell heredoc 事故产物）；`tests/.tmp-r99*-probe.cjs`、`.tmp-r99-*.png`、`.tmp-r99-verify.cjs`（已升格为闸门，探针可删）。

## 5. 长期开放项

- **#5** 换 yosys 构建（结构性，未动）
- **#8** 可选：transform.transformCircuit 显示归一化（编译模式）
- **O1** push 一事一授权：先答风险，用户点头才推

## 6. 行为约束（长期有效，接手即视为已知）

- 未经用户明示不 commit、不 push；push 单独一事一授权。
- 外部工具落盘位置＝D 盘。
- 产品不得要求用户变通方法（请重启/降权限/手动备份都算缺陷）。
- 台架纪律：批量改完统一测（用户要求减少跑批频率）；跑批期不改 src；夹具用真实规模；每格开头先还原；判定只认汇总行三态；环境红与产品红分开归责（`ENV_RE` 已含 `page\.goto: Timeout`，locator/waitFor 超时保持 RED）。
- Vite `shell:true` spawn 的孙进程清理统一走 `_ui.cjs` 的 `reapViteByPort(port)`。
- 用户说「你搞坏了」先做归责核对，不急着改。

## 7. 环境备忘

- 跑台架：`node tests/<gate>.cjs`（各自自带 PORT）；全量 `node tests/run-all.cjs`，日志落 `tests/logs/`。
- 编译入口：Vite dev server 由台架自起自清；手工调试 `pnpm dev`。
- 浏览器自动化：playwright-core（项目内依赖，勿全局装）。
- 沙盒画布 hook：`window.__sandboxPaper`；读数前 `waitPaper()`。

— 本文档由交接时的主代理写于 R99 gate 首绿（5/0）之后、run-all 注册之前。
