#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向台架（阶段三·agent 深度四档）：D1 预演／D2 自检／闸②两半／换工程重算／traceId 五颗证人。

为什么这批要单独开一台：新增的四档读数全是"预演与自述"，它们的失败形状是**说得像真的假话**——
把 `surfaceOpen` 写死 true，预演照样报一堆漂亮 blockers，只是永远说"能过"；把 `traceId` 留在落账侧现算，
调用方手里那串照样是 8 位十六进制，只是在账上查无此行。这种缺陷⛔ 会被"断言还在、名字还在"掩盖，
只有一条**把它改坏并看着特定那格红**的臂能证它不是装饰。

臂型沿用 C4：每臂 (档, 原文, 新文) + 期望红名（按助记串在现读标题里取，命中数⛔ 恰一颗）
+ 必须在原始转储里见到的 needle。跑完即还原，末了逐字节核对。
"""
import io
import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TEST = os.path.join("tests", "unit", "extensionHost.test.ts")
DOMAIN = os.path.join("extension", "src", "toolsDomain.ts")
SURFACE = os.path.join("extension", "src", "apiSurface.ts")
REGISTRY = os.path.join("extension", "src", "toolRegistry.ts")

D1 = "D1 sys.describeTool"
D2 = "D2 sys.selfCheck"
RESURF = "换工程＝生效契约从默认账重算"
TRACE = "一颗调用一个号"

ANSI = re.compile(chr(27) + r"\[[0-9;]*m")
RED = re.compile(r"^\s*" + chr(0xD7) + r"\s+(.+)$", re.M)
IT = re.compile(r"^  it\('([^']+)'", re.M)

# 语法自检：源串里嵌正文用的双引号＝运行期 NameError（名册 345 同族），先把本文件 parse 一遍
import ast
ast.parse(open(__file__, encoding="utf-8").read())

TEST_ABS = os.path.join(REPO, TEST)
TITLES = IT.findall(open(TEST_ABS, encoding="utf-8").read())


def names(keys):
    out = set()
    for k in keys:
        hit = [x for x in TITLES if k in x]
        if len(hit) != 1:
            raise SystemExit(f"助记串「{k}」命中 {len(hit)} 颗标题（必须恰一颗）：{hit}")
        out.add(hit[0])
    return out


# ---- 五颗变异（每颗只打一格）----
# B1 闸②"两半"塌成一格：surfaceOpen 写死 true ⇒ 预演永远说"能过"（被裁光那颗也照说能过）
OPEN_TRUE = "  const surfaceOpen = canSurface(id, caller.surface);"
# B2 词表外实参被静默采纳：surfaceFallback 恒 false ⇒ "我写错了"读成"那条线不通"
FALLBACK = "    askedSurface, surfaceFallback: !known,"
# B3 换工程不重算：摘掉 merged = DEFAULTS 那一行 ⇒ 上一扇的收窄跟着搬家（文件不存在＝静默这句话变谎）
#    锚点⛔ 带上行尾那串空格与注释（对齐是排版，手打一颗数差一格就命中 0——本台架第一次跑就撞在这）
RESET = "  merged = DEFAULTS;"
RESET_BAD = "  // MUTANT: merged = DEFAULTS;"
# B4 号留在落账侧：executeTool 不再把 traceId 交给账 ⇒ 调用方那串在账上查无此行
TRACE_ARG = "verdict, ms: Date.now() - t0, args, note, traceId });"
# B5 收口判据按记账写：把"挂账"（状态）也算进故障 ⇒ 自检永远响，永远没人看
#    ⛔ 把 `// MUTANT` 挂在这行行尾：那颗注释会吞掉同一行剩下的 `? 'attention' : 'ready'`，
#    一颗语法错把整档 142 格一起染红（第一次跑就读到了——台架自己造的红不算证据）。
VERDICT = "(drift.registeredOffContract.length || override.rejects.length || grants.notes.length || !ch.ready)"
VERDICT_BAD = "(drift.registeredOffContract.length || drift.pendingHandlers.length || override.rejects.length || grants.notes.length || !ch.ready)"

ARMS = [
    ("M0 对照件（⛔ 变异）", [], [], None),
    ("B1 闸②两半塌成一句（surfaceOpen 写死 true）",
     [(DOMAIN, OPEN_TRUE, "  const surfaceOpen = true;  // MUTANT")], [D1], "端点未开放"),
    ("B2 词表外的 surface 实参被静默采纳",
     [(DOMAIN, FALLBACK, "    askedSurface, surfaceFallback: false,  // MUTANT")], [D1], "surfaceFallback"),
    ("B3 换工程⛔ 重算默认账（收窄跟着搬家）",
     [(SURFACE, RESET, RESET_BAD)], [RESURF], "API_SURFACE_DENIED"),
    ("B4 traceId 留在落账侧现算（调用方那串查无此行）",
     [(REGISTRY, TRACE_ARG, "verdict, ms: Date.now() - t0, args, note });  // MUTANT")], [TRACE], "not-granted"),
    ("B5 自检把挂账当故障（verdict 恒响）",
     [(DOMAIN, VERDICT, VERDICT_BAD)], [D2], "pendingHandlers"),
]

COVER = [D1, D2, RESURF, TRACE]


def run_vitest():
    p = subprocess.run('npx vitest run "' + TEST + '" --reporter=verbose',
                       cwd=REPO, capture_output=True, text=True,
                       shell=True, encoding="utf-8", errors="replace")
    return ANSI.sub("", (p.stdout or "") + (p.stderr or "")), p.returncode


def red_names(out):
    got = set()
    for m in RED.finditer(out):
        tail = m.group(1).split(" > ")[-1]
        got.add(re.sub(r"\s*\d+(\.\d+)?ms\s*$", "", tail).strip())
    return got


def main():
    paths = {e[0] for (nm, edits, keys, nd) in ARMS for e in edits}
    snap = {p: open(os.path.join(REPO, p), "rb").read() for p in paths}
    bad, log = 0, []
    holes = [c for c in COVER if not any(c in k for (_, _, ks, _) in ARMS for k in ks)]
    try:
        for nm, edits, keys, needle in ARMS:
            if len(sys.argv) > 1 and sys.argv[1] not in nm:
                continue
            exp = names(keys)
            for rel, old, new in edits:
                abs_p = os.path.join(REPO, rel)
                cur = open(abs_p, encoding="utf-8").read()
                hit = cur.count(old)
                if hit != 1:
                    raise SystemExit(f"[{nm}] {rel} 的锚点命中 {hit} 处（必须恰一颗）——⛔ 猜，停手")
                with io.open(abs_p, "wb") as f:
                    f.write(cur.replace(old, new, 1).encode("utf-8"))
            out, rc = run_vitest()
            for rel, blob in snap.items():          # 每臂跑完立刻还原（下一臂的锚点是原文）
                with io.open(os.path.join(REPO, rel), "wb") as f:
                    f.write(blob)
            got = red_names(out)
            nd_ok = needle is None or (needle in out)
            # needle 只朝一个方向判⛔ 判"没出现"：红名相等而开火的格不是我要的那格＝不合格，
            # 但 needle 恰好在别的输出行里出现过时，红名集合才是主判据。
            ok = (got == exp) and nd_ok
            if not ok:
                with io.open(os.path.join(HERE, "arm_bad_c5.txt"), "wb") as f:
                    f.write(out.encode("utf-8"))
            bad += 0 if ok else 1
            passed = re.search(r"Tests.*?(\d+) passed", out)
            log.append(f"== {'OK ' if ok else 'BAD'} {nm}\n"
                       f"   rc={rc} 通过格数={passed.group(1) if passed else '读不到汇总数'}\n"
                       f"   期望红({len(exp)})={sorted(exp)}\n"
                       f"   实际红({len(got)})={sorted(got)}\n"
                       f"   needle「{needle or '（不判）'}」{'见到' if nd_ok else '⛔ 没见到＝开火的不是那一格'}\n")
        same = all(open(os.path.join(REPO, p), "rb").read() == snap[p] for p in snap)
        log.append(f"== 还原核对：{len(snap)} 颗档与快照{'逐字节相同' if same else '⚠ 不同'}\n")
        bad += 0 if same else 1
        log.append(f"== 名册尺：本批新证人 {len(COVER)} 颗，从没被任何臂点名的 = {holes}\n")
        bad += len(holes)
    finally:
        for p, blob in snap.items():
            with io.open(os.path.join(REPO, p), "wb") as f:
                f.write(blob)
    txt = "\n".join(log) + f"\n汇总：不合格 {bad} / 共 {len(ARMS)} 臂 + 1 还原核对 + 名册尺 {len(holes)} 缺\n"
    with io.open(os.path.join(HERE, "bench_c5_agent_tiers.txt"), "wb") as f:
        f.write(txt.encode("utf-8"))
    print(txt)
    sys.exit(1 if bad else 0)


main()
