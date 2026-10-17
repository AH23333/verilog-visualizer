#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""回写（片 C5 收口腿）：摘掉五颗闸门里那颗"已删主人的死预热"。

形状：`await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));`
——当年为 vite 依赖预热写的，`.catch` 把 404 吞了 ⇒ 闸门照旧跑，但这行会骗下一个读代码的人
（"原来 fileStore 还在"）。它现在是纯 no-op：一次注定失败的请求。

守卫（名册 341）：可重入查的那颗串**必须活在落盘正文里**——这里以"那行整颗消失"为已完成态，
所以守卫查的是**原文还在不在**（不在就停手，⛔ 二次改写邻行）。
每档改完立刻 `node --check` 临时档，过了才换正本（名册 303/353）。
"""
import io
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TESTS = os.path.join(REPO, "tests")
DEAD = "    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));\n"
FILES = ["r60-part-binding-gate.cjs", "r65-numbase-gate.cjs", "r68-fanin-gate.cjs",
         "r71-abort-port-gate.cjs", "r76-sparse-mux-gate.cjs"]

rows, bad = [], 0
for f in FILES:
    p = os.path.join(TESTS, f)
    s = open(p, encoding="utf-8").read()
    if DEAD not in s:
        rows.append((f, "ALREADY", "那颗串已不在正文（可重入守卫停手）"))
        continue
    n = s.count(DEAD)
    if n != 1:
        rows.append((f, "STOP", f"锚点命中 {n} 处（必须恰 1）"))
        bad += 1
        continue
    new = s.replace(DEAD, "", 1)
    tmp = p + ".c5check.cjs"
    with io.open(tmp, "wb") as fh:
        fh.write(new.encode("utf-8"))
    chk = subprocess.run('node --check "' + tmp + '"', cwd=REPO, capture_output=True,
                         text=True, shell=True, encoding="utf-8", errors="replace")
    os.remove(tmp)
    if chk.returncode != 0:
        rows.append((f, "REFUSED", (chk.stdout + chk.stderr)[:160]))
        bad += 1
        continue
    with io.open(p, "wb") as fh:
        fh.write(new.encode("utf-8"))
    left = open(p, encoding="utf-8").read().count("fileStore")
    rows.append((f, "WROTE", f"摘掉 1 行；档内 fileStore 现读残留 {left} 处"))
    if left:
        bad += 1

for r in rows:
    print("\t".join(r))
print(f"汇总：不合格 {bad} / 共 {len(FILES)} 颗")
sys.exit(1 if bad else 0)
