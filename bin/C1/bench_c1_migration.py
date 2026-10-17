#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向台架（片 C1）：把 src/canvas/legacyMigration.ts 逐处改坏，判"该红的格红、邻居⛔ 替它答"。

判据 = **红名集合等式**（⛔ 只判 failed>0：邻居替它答＝这一臂白跑；也⛔ 只看红数）。
M0 = 不动源码的对照臂（必须 0 红）——它同时把"红名谓词"自己过一遍。

红名从 vitest `--reporter=verbose` 的实测行形状取（探针量出来的形状）：
  ` × tests/unit/x.test.ts > <describe> > <it>  5ms`（带 ANSI，先抹色再切）
期望⛔ 手打中文（名册 310：变异文本手打＝该红的格照绿）——本脚本把 it 标题从测试档里
**现读成数组**，臂只报下标。
"""
import ast
import io
import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")   # ⛔ 只改 stdout：SystemExit 那句走 stderr，gbk 控制台上就是一屏乱码

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(REPO, "src", "canvas", "legacyMigration.ts")
TEST = os.path.join("tests", "unit", "legacyMigration.test.ts")
LOG = os.path.join(HERE, "bench_c1_migration.txt")

# 自己不可解析就别往下跑（名册 274：台架⛔ 可解析被我读成"某臂不合格"）
ast.parse(open(__file__, encoding="utf-8").read())

ANSI = re.compile(chr(27) + r"\[[0-9;]*m")
RED = re.compile(r"^\s*" + chr(0xD7) + r"\s+(.+)$", re.M)
IT = re.compile(r"^  it\('([^']+)'", re.M)

test_src = open(os.path.join(REPO, TEST), encoding="utf-8").read()
TITLES = IT.findall(test_src)
if len(TITLES) != 12:
    raise SystemExit(f"it 标题现读 {len(TITLES)} 颗（期望 12）——测试档形状变了，先读档⛔ 猜")


def names(idx):
    return {TITLES[i] for i in idx}


ARR = "  if (Array.isArray(parsed)) return parsed;\n  if (parsed && typeof parsed === 'object') return Object.values(parsed as Record<string, unknown>);"
GATE = "      const content = typeof s?.graphJson === 'string' ? s.graphJson : typeof s?.content === 'string' ? s.content : null;"
PUSH = r"      if (s?.name && content) out.push({ name: String(s.name).replace(/\.djs$/i, '') + '.djs', content });"
MARK = ("    if (writtenNames.some((n) => /\\.djs$/i.test(n))) localStorage.setItem(LEGACY_TOMBSTONE_DJS, stamp);\n"
        "    if (writtenNames.some((n) => !/\\.djs$/i.test(n))) localStorage.setItem(LEGACY_TOMBSTONE_V, stamp);")

# 下标（按测试档里 it 的出现顺序现读）：
#  0 Record 正件 / 1 数组兜底 / 2 源码半颗 / 3 kind:gate / 4 坏档 / 5 无 localStorage
#  6 老键只封 .v / 7 新键只封 .djs / 8 两键齐 / 9 mark 分半颗 / 10 混合批次 / 11 不再提示
ARMS = [
    ("M0 对照件（⛔ 变异）", SRC, None, None, []),
    ("M1 只认数组形状（那颗丢数据的原 bug）", SRC, ARR,
     "  if (Array.isArray(parsed)) return parsed;", [0, 3, 6]),
    # ⚠ M2 第一版写的是"把 Array 那支挪到对象那支后面"——**恒等变异**（数组本身就是 object，
    #   Object.values([a,b]) 照给出 [a,b]），12 格全绿被我读成"这行没测头"。名册 350 那一笔的
    #   反面：期望⛔ 按"那行为什么存在"写，要按"哪一行产读数"写。真变异＝让数组那支**失效**。
    ("M2 只认对象形状（数组旧档变零）", SRC, ARR,
     "  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Object.values(parsed as Record<string, unknown>);", [1, 2, 7]),
    # M3/M4 的红名集合相同（各改半颗的门，撞的是同样两格）：区别只在**哪一行**变了，
    # 两臂都留着＝两条行都⛔ 能瞎，⛔ 因为"读数一样"就摘一颗。
    ("M3 沙盒半颗连坐到 .v 那颗墓碑（= 修前那颗封档 bug）", SRC,
     "  if (!localStorage.getItem(LEGACY_TOMBSTONE_DJS)) {",
     "  if (!localStorage.getItem(LEGACY_TOMBSTONE_V)) {", [6, 7]),
    ("M4 源码半颗跟着沙盒墓碑走（反向连坐）", SRC,
     "  if (!localStorage.getItem(LEGACY_TOMBSTONE_V)) {",
     "  if (!localStorage.getItem(LEGACY_TOMBSTONE_DJS)) {", [6, 7]),
    ("M5 忽略 .v 那颗墓碑（迁完还一直催源码）", SRC,
     "  if (!localStorage.getItem(LEGACY_TOMBSTONE_V)) {", "  if (true) {", [6, 8]),
    ("M6 忽略 .djs 那颗墓碑", SRC,
     "  if (!localStorage.getItem(LEGACY_TOMBSTONE_DJS)) {", "  if (true) {", [7, 8]),
    ("M7 markLegacyMigrated 一颗封两半（修前形状）", SRC, MARK,
     "    localStorage.setItem(LEGACY_TOMBSTONE_DJS, stamp);\n    localStorage.setItem(LEGACY_TOMBSTONE_V, stamp);", [9, 10]),
    ("M8 kind:gate 的编译格式也照迁（落成开不了的 .djs）", SRC, GATE,
     "      const content = typeof s?.graphJson === 'string' ? s.graphJson : typeof s?.content === 'string' ? s.content\n        : typeof s?.circuitJson === 'string' ? JSON.stringify(s.circuitJson) : null;", [3]),
    ("M9 名字丢掉目录段（层级在迁移里塌掉）", SRC, PUSH,
     r"      if (s?.name && content) out.push({ name: String(s.name).split('/').pop().replace(/\.djs$/i, '') + '.djs', content });", [0]),
    ("M10 JSON.parse 不再包异常（坏档抛穿挂载）", SRC,
     "  try { parsed = JSON.parse(raw); } catch { return []; }", "  parsed = JSON.parse(raw);", [4]),
    ("M11 ⛔ 无 localStorage 守卫（宿主外形状抛穿）", SRC,
     "  if (typeof localStorage === 'undefined') return [];", "  // 守卫摘掉", [5]),
    ("M12 源码半颗的正文改取 graphJson（.v 全变零）", SRC,
     "      if (f?.name && typeof f?.content === 'string') out.push({ name: String(f.name), content: f.content });",
     "      if (f?.name && typeof f?.graphJson === 'string') out.push({ name: String(f.name), content: f.graphJson });", [2, 7]),
]


def run_vitest():
    # shell=True：`npx` 在 Windows 上是颗 .cmd，裸 CreateProcess 找不到（WinError 2，实测）
    p = subprocess.run(f'npx vitest run "{TEST}" --reporter=verbose',
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
    snap = {SRC: open(SRC, "rb").read()}
    bad, log = 0, []
    try:
        for i, (nm, path, old, new, idx) in enumerate(ARMS):
            exp = names(idx)
            if old is not None:
                cur = open(path, encoding="utf-8").read()
                hit = cur.count(old)
                if hit != 1:
                    raise SystemExit(f"[{nm}] 锚点命中 {hit} 处（必须恰一颗）——⛔ 猜，停手")
                # 先算好新字节再开档写（名册 316：open(...,'wb') 先把档截零）
                blob = cur.replace(old, new, 1).encode("utf-8")
                with io.open(path, "wb") as f:
                    f.write(blob)
            out, rc = run_vitest()
            # 每臂跑完立刻还原：⛔ 靠 finally——下一臂的锚点是**原文**，带着上一臂的变异找＝必然 0 命中
            with io.open(path, "wb") as f:
                f.write(snap[path])
            got = red_names(out)
            ok = got == exp
            bad += 0 if ok else 1
            passed = re.search(r"Tests.*?(\d+) passed", out)
            log.append(f"== {'OK ' if ok else 'BAD'} {nm}\n"
                       f"   rc={rc} 通过格数={passed.group(1) if passed else '读不到汇总数'}\n"
                       f"   期望红({len(exp)})={sorted(exp)}\n"
                       f"   实际红({len(got)})={sorted(got)}\n")
        # 收口另起一把尺：还原核对⛔ 拿 git（本批还没提交），与**快照**逐字节比
        same = open(SRC, "rb").read() == snap[SRC]
        log.append(f"== 还原核对：与快照{'逐字节相同' if same else '⚠ 不同'}\n")
        bad += 0 if same else 1
    finally:
        for path, blob in snap.items():
            with io.open(path, "wb") as f:
                f.write(blob)
    txt = "\n".join(log) + f"\n汇总：不合格 {bad} / 共 {len(ARMS)} 臂 + 1 还原核对\n"
    with io.open(LOG, "wb") as f:
        f.write(txt.encode("utf-8"))
    print(txt)
    sys.exit(1 if bad else 0)


main()
