#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把卷六十四补记（深度自检）追加到账本末档。用脚本而⛔ 终端重定向：中文经 PowerShell 会 mojibake。"""
import io
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DOC = os.path.join(REPO, "docs", "PROJECT_DEEP_REVIEW_2026-10-05.md")

TEXT = """
## 卷六十四补记 · 深度自检（用户令「深度自检」，同标准：不可信任自己刚写的代码）

以攻击者视角重审 R153 两腿，**五处发现、全数修掉**；台架 12→16 臂并新增**名册尺**。

1. **X17 的修只对根目录文件生效**：同名索引的键仍带目录段（`lib/adder` vs 查 `adder`）。
   读数路径＝新臂的期望值现读，⛔ 靠"看起来对"。
2. **X20（更深的一层，也是本批最重的一颗）**：那颗「自动同名」压根建在闭包 `job.files` 上，
   而 `closureOf` 对未录入实例只记 `[BINDING_MISSING]` 并 `continue`——**定义文件⛔ 进闭包**
   ⇒ 绑定面板那一栏恒 `null`、`bindings.materialize` 的 `.v` 侧恒交回 0 颗＝"点了没反应"
   与"录了没生效"的又一面。两处改问 `scanDefs`（模块名→真定义它的文件，与「写全配置」
   `collectInstanceHits` 同一颗主人）。行为证人各补一颗，修前必红（M13/M14 已证）。
3. **X21**：`Uri → 根相对名`本仓写了**七份**，三份"按根串长度切"（`pathRel`／
   `examples.relOfRoot`／`extension.ts` 的 `rel`）——盘符大小写一漂就交半截或整颗绝对路径；
   而我上一批的 `toolsDomain` 补丁挑的正是坏的那份（**新臂当场把它撞红**：期望
   `lib/adder.v` 收到 `d:/p/lib/adder.v`）。新增 `verilogDomain.rootRel`（`path.relative`
   口径＋根外折回绝对路径；win32 现读：盘符大小写不敏感），六份转交；第七份
   `collectTableDirs` 两侧同源小写、暂判安全并就地注因（⛔ 在自检批里动递归热路）。
   转交后**⛔ 一颗既有臂翻色**（240/240 时已证）＝这几份一直在交坏值而没人看见。
4. **台架自己漂了一格**：旧 M7 锚的那行被第 2 条替换掉 ⇒ 退役留话；并加**名册尺**
   （本批每颗新证人至少被一臂点名，缺一颗即 `bad +=`）——它当场抓到"根内相对名形状"那格
   没有任何臂能打破，遂补 M16：rootRel 是枢纽，⛔ 存在"只打一格"的窄变异，
   射程 26 臂逐颗确认都是它的真消费者后写成**等式**（⛔ 改子集判断＝放宽）。
5. **我自己写的 `it` 标题里嵌了单引号**（`一律交 '/' 分隔`）⇒ JS 字符串提前终止、vitest 把
   那颗测试名读成 `NaN`，红名等式如实报出。教训＝报"测不到"前先读自己的转储（台架新增
   `arm_last.txt` 原始输出留档），⛔ 凭猜改谓词。

### 收口读数
- vitest **242/242**（R153 起 220 基线 → +12 迁移 +6 C2 +2 自检行为 +2 rootRel 形状）；
  root `pnpm build`（tsc+vite）✓、extension tsc ✓、esbuild ✓；
  `bin/C1` 13 臂、`bin/C2` 16 臂各 0 不合格，名册尺 0 缺，与快照逐字节还原。
- 顺带把 tsc 抓到的一颗真形状错收了：`markLegacyMigrated` 收对象而宿主交回名字串
  （vitest 不查型 ⇒ 只有 build 抓得到；"全绿≠型安全"本卷再记一次）。
- 下一刀不变＝卷六十二遗留①（dispatch 9 颗 RPC 走 executeTool）；挂账 X18/X19 待办/待裁。

*（卷六十四补记完 · R153 两腿经攻击性复查：五处发现全数修掉，两颗"按构造命不中"的功能恢复可用）*
"""

cur = open(DOC, encoding="utf-8").read()
if "卷六十四补记" in cur:
    print("已落过这一节，幂等退出")
    raise SystemExit(0)
newline_bytes = (TEXT.strip("\n") + "\n").encode("utf-8")
# 目标档的行尾：现读（⛔ 假设整批同一行尾——名册 306/280）
crlf = b"\r\n" in cur.encode("utf-8")
sep = b"\r\n" if crlf else b"\n"
if crlf:
    newline_bytes = newline_bytes.replace(b"\n", b"\r\n")
tail = cur.encode("utf-8")
assert tail.endswith(b"\n"), "末档⛔ 换行，插块会粘在上一行尾巴上"
before_lf = tail.count(b"\n") - tail.count(b"\r\n")     # 裸 LF 现读
before_cr = tail.count(b"\r")
with io.open(DOC, "wb") as f:
    f.write(tail + sep + newline_bytes)
after = open(DOC, "rb").read()
# 收口尺＝**与它自己行尾相反那族⛔ 增**（名册 306 的第二副脸：第一版这里写"裸 LF⛔ 增"，
# 而这份档本就纯 LF ⇒ 每加一行都多一颗裸 LF，判据必然假红。真该守的是"别把 CRLF 带进来"）。
after_cr = after.count(b"\r")
if crlf:
    after_lf = after.count(b"\n") - after.count(b"\r\n")
    assert after_lf <= before_lf, "插块把裸 LF 带进 CRLF 档了"
    verdict = f"裸 LF {before_lf}→{after_lf}（⛔ 增）"
else:
    assert after_cr <= before_cr, "插块把 CR 带进纯 LF 档了"
    verdict = f"CR {before_cr}→{after_cr}（⛔ 增）"
print("追加完成；CRLF 档 =", crlf, "新增字节 =", len(sep) + len(newline_bytes), "｜收口尺：", verdict)
