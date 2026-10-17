#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 tests/ 下所有"认死 test_files 路径"的读点改问一颗解析器。

一条一现场：每处替换都打印改后整行，逐颗人看；每个改过的档跑 `node --check`。
可重入：已改过的档（含 require）跳过，重跑必停手在"0 处可改"。
"""
import io
import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TESTS = os.path.join(REPO, "tests")

PAT = re.compile(r"path\.(?:join)\(\s*(?:ROOT|PROJECT_ROOT)\s*,\s*'test_files'\s*,\s*([^)]+?)\s*\)")

changed, skipped, bad = [], [], []
for fn in sorted(os.listdir(TESTS)):
    if not fn.endswith(".cjs"):
        continue
    p = os.path.join(TESTS, fn)
    src = open(p, encoding="utf-8").read()
    hits = list(PAT.finditer(src))
    if not hits:
        continue
    if "fixtures.cjs" in src:
        skipped.append(fn)          # 已改过（可重入守卫）
        continue
    rel = os.path.relpath(os.path.join(TESTS, "fixtures.cjs"), os.path.dirname(p)).replace("\\", "/")
    if not rel.startswith("."):
        rel = "./" + rel
    new = PAT.sub(lambda m: "fixture(%s)" % m.group(1), src)
    lines = new.split("\n")
    # require 插在最后一颗 require 之后（⛔ 插在最前面打乱原有顺序）
    last = max(i for i, l in enumerate(lines) if l.startswith("const ") and "require(" in l)
    lines.insert(last + 1, "// 夹具按末段名解析（test_files/ 会被用户在产品里整理）：见 tests/fixtures.cjs")
    lines.insert(last + 2, "const { fixture } = require('%s');" % rel)
    blob = "\n".join(lines).encode("utf-8")
    with io.open(p, "wb") as f:
        f.write(blob)
    chk = subprocess.run(["node", "--check", p], capture_output=True, text=True, shell=True,
                         encoding="utf-8", errors="replace")
    (bad if chk.returncode else changed).append((fn, len(hits), chk.stderr.strip()[:200]))
    for line in blob.decode("utf-8").split("\n"):
        if "fixture(" in line:
            print("   %s | %s" % (fn, line.strip()[:150]))

print("\n改好 %d 颗档；语法不过 %d 颗：%s" % (len(changed), len(bad), [b[0] for b in bad]))
print("跳过（已改过）%d 颗：%s" % (len(skipped), skipped))
left = subprocess.run('grep -rn "test_files\'" tests --include=*.cjs | head', cwd=REPO,
                      capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
print("残留认死路径：\n" + (left.stdout.strip() or "（无）"))
