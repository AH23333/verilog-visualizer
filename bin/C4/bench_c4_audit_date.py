#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向台架（片 C4 补）：sys.readAudit 的 date 归一那一格要能红。

这颗证人（`extensionHost.test.ts` 的「date 实参归一」）是**成对判据**：
带连字符与 8 位纯数字两种写法必须交回同一份读数。⛔ 只判"归一后读得到"——
那样即使归一被摘掉，只要默认日期恰好还是今天，另一半年份也可能顺带绿。
本台架两臂：M0 对照（⛔ 变异，该全绿）＋M1 摘掉归一（该只红这一颗）。
红名按 vitest verbose 的实测行形状取（先抹 ANSI——同一批我刚在 grep 判汇总数时
栽过：那颗计数被 ANSI 包住，`grep "Tests +1 failed"` 读到 0 次，差点把漂移当成没发生）。
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
TOOLS = os.path.join(REPO, "extension", "src", "toolsDomain.ts")
TEST = os.path.join("tests", "unit", "extensionHost.test.ts")
FILTER = "date 实参归一"
LOG = os.path.join(HERE, "bench_c4_audit_date.txt")

ANSI = re.compile(chr(27) + r"\[[0-9;]*m")
RED = re.compile(r"^\s*" + chr(0xD7) + r"\s+(.+)$", re.M)
IT = re.compile(r"^  it\('([^']+)'", re.M)

LIVE = ("      const rawDate = String(a.date ?? new Date().toISOString().slice(0, 10));\n"
        "      const date = /^\\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : rawDate;")
DEAD = "      const date = String(a.date ?? new Date().toISOString().slice(0, 10));"

TITLES = IT.findall(open(TEST, encoding="utf-8").read())
hits = [t for t in TITLES if FILTER in t]
if len(hits) != 1:
    raise SystemExit(f"过滤器「{FILTER}」命中 {len(hits)} 颗标题（必须恰一颗）：{hits}")
EXPECT = hits[0]


def run():
    p = subprocess.run('npx vitest run "' + TEST + '" -t "' + FILTER + '" --reporter=verbose',
                       cwd=REPO, capture_output=True, text=True, shell=True,
                       encoding="utf-8", errors="replace")
    return ANSI.sub("", (p.stdout or "") + (p.stderr or "")), p.returncode


def red_names(out):
    got = set()
    for m in RED.finditer(out):
        tail = m.group(1).split(" > ")[-1]
        got.add(re.sub(r"\s*\d+(\.\d+)?ms\s*$", "", tail).strip())
    return got


def main():
    snap = open(TOOLS, "rb").read()
    arms = [("M0 对照件（⛔ 变异）", None, set()),
            ("M1 摘掉 date 归一（8 位写法该读成查无此档）", (LIVE, DEAD), {EXPECT})]
    bad, log = 0, []
    try:
        for nm, edit, exp in arms:
            if edit:
                cur = open(TOOLS, encoding="utf-8").read()
                n = cur.count(edit[0])
                if n != 1:
                    raise SystemExit(f"[{nm}] 锚点命中 {n} 处（必须恰一颗）——⛔ 猜，停手")
                with io.open(TOOLS, "wb") as f:
                    f.write(cur.replace(edit[0], edit[1], 1).encode("utf-8"))
            out, rc = run()
            with io.open(TOOLS, "wb") as f:
                f.write(snap)
            got = red_names(out)
            ok = got == exp
            if not ok:
                with io.open(os.path.join(HERE, "arm_bad_audit_date.txt"), "wb") as f:
                    f.write(out.encode("utf-8"))
            bad += 0 if ok else 1
            summary = re.search(r"Tests.*?(\d+) passed.*?(\d+) failed", out)
            log.append(f"== {'OK ' if ok else 'BAD'} {nm}\n"
                       f"   rc={rc} 汇总读数={summary.group(0).strip() if summary else '读不到汇总数（⛔ 当通过）'}\n"
                       f"   期望红({len(exp)})={sorted(exp)}\n   实际红({len(got)})={sorted(got)}\n")
        same = open(TOOLS, "rb").read() == snap
        log.append(f"== 还原核对：toolsDomain.ts 与快照{'逐字节相同' if same else '⚠ 不同'}\n")
        bad += 0 if same else 1
    finally:
        with io.open(TOOLS, "wb") as f:
            f.write(snap)
    txt = "\n".join(log) + f"\n汇总：不合格 {bad} / 共 {len(arms) if 'arms' in dir() else 2} 臂 + 1 还原核对\n"
    with io.open(LOG, "wb") as f:
        f.write(txt.encode("utf-8"))
    print(txt)
    sys.exit(1 if bad else 0)


main()
