#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向台架（片 C5）：X18「部件身份随迁移」那两颗新证人各自要能红。

两颗证人的分工⛔ 重叠，所以变异也分两侧：
 · 宿主侧（dispatch 的 importLegacyData）—— 三臂：摘部件身份 / 摘绑定循环 / 解不到时把旧 id 当值落表；
 · 前端侧（src/canvas/legacyMigration 的 collectLegacyItems）—— 一臂：回到只交 {name,content}。
判据是**行为级**的（真落 `.verilogviz.json` 的内容 + Output 那句话），⛔ 读源码形状，
所以这里不需要 needle；红名集合等式＋M0 对照件就是尺。
跑法：两颗档一起，用 `-t X18` 只点这两格（其余 146 格⛔ 进射程，免得邻居替它答）。
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
DISPATCH = os.path.join("extension", "src", "dispatch.ts")
MIGRATE = os.path.join("src", "canvas", "legacyMigration.ts")
TESTS = [os.path.join("tests", "unit", "extensionHost.test.ts"),
         os.path.join("tests", "unit", "legacyMigration.test.ts")]
FILTER = "X18"
LOG = os.path.join(HERE, "bench_c5_x18.txt")

ANSI = re.compile(chr(27) + r"\[[0-9;]*m")
RED = re.compile(r"^\s*" + chr(0xD7) + r"\s+(.+)$", re.M)

HOST_X = "X18：旧档迁移把部件身份一起带走——role:part 落本层目录表、partBindings 按批内 key 连到落盘名（解不到＝只记 Output，⛔ 落一条悬空绑定）"
WEB_X = "X18 正件：旧档里的部件身份与文件级绑定**跟着搬**（修前这两样整批丢掉＝迁完没人知道谁是部件）"
SEAM_X = "X18 两半接得上：collectLegacyItems 交出去的身份，宿主按**同一颗 key** 连到落盘名（⛔ 只判两半各自绿）"


def titles():
    out = []
    for t in TESTS:
        out += re.findall(r"^  it\('([^']+)'", open(os.path.join(REPO, t), encoding="utf-8").read(), re.M)
    return out


TITLES = titles()
for want in (HOST_X, WEB_X, SEAM_X):
    if sum(1 for t in TITLES if FILTER in t and t == want) != 1:
        raise SystemExit(f"标题现读对不上（必须恰一颗）：{want}")


def run():
    cmd = "npx vitest run " + " ".join('"' + t + '"' for t in TESTS) + ' -t "' + FILTER + '" --reporter=verbose'
    p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, shell=True,
                       encoding="utf-8", errors="replace")
    return ANSI.sub("", (p.stdout or "") + (p.stderr or "")), p.returncode


def red_names(out):
    got = set()
    for m in RED.finditer(out):
        tail = m.group(1).split(" > ")[-1]
        got.add(re.sub(r"\s*\d+(\.\d+)?ms\s*$", "", tail).strip())
    return got


ROLE_OLD = "        if (it.role === 'part') {"
ROLE_NEW = "        if (false && it.role === 'part') {"
BIND_OLD = "        for (const [celltype, boundKey] of Object.entries(it.bindings || {})) {"
BIND_NEW = "        for (const [celltype, boundKey] of Object.entries({} as Record<string, string>)) {"
DANG_OLD = "          if (!target) { dangling.push(`${mine} 的「${celltype}」`); continue; }   // ⛔ 落一条永远解不开的悬空绑定"
DANG_NEW = "          if (!target) { await setBindingInDir(context, dirRel, celltype, String(boundKey)); continue; }"
ITEMS_OLD = ("      const item: LegacyItem = { name: String(s.name).replace(/\\.djs$/i, '') + '.djs', content };\n"
             "      if (s.id != null && s.id !== '') item.key = String(s.id);\n"
             "      if (s.role === 'part') item.role = 'part';\n"
             "      const bindings = legacyBindingsOf(s.partBindings);\n"
             "      if (bindings) item.bindings = bindings;")
ITEMS_NEW = "      const item: LegacyItem = { name: String(s.name).replace(/\\.djs$/i, '') + '.djs', content };"

ARMS = [
    ("M0 对照件（⛔ 变异）", [], []),
    ("M1 宿主侧摘掉部件身份那一条（role 白拿）", [(DISPATCH, ROLE_OLD, ROLE_NEW)], [HOST_X, SEAM_X]),
    ("M2 宿主侧摘掉绑定循环（partBindings 整批不落表）", [(DISPATCH, BIND_OLD, BIND_NEW)], [HOST_X, SEAM_X]),
    ("M3 宿主侧把解不到的旧 id 直接当值落表（悬空绑定 + Output 那句也没了）",
     [(DISPATCH, DANG_OLD, DANG_NEW)], [HOST_X]),
    ("M4 前端侧回到只交 {name,content}（身份压根没出门）", [(MIGRATE, ITEMS_OLD, ITEMS_NEW)], [WEB_X, SEAM_X]),
]
# ⚠ 期望红名是**新增那颗接缝臂之后重列的**（名册 408：多一颗读者就要重问"哪几格该红"）：
#  接缝臂自己也走宿主那半颗 ⇒ M1/M2 现在红两格；M3 那格它⛔ 沾（夹具里没悬空绑定）；
#  M4 反过来不再替宿主那格背书（第一跑就是它报了"X 臂照旧绿"，才暴露出接缝没人测）。

COVER = ["X18"]


def main():
    paths = sorted({e[0] for (_, edits, _) in ARMS for e in edits})
    snap = {p: open(os.path.join(REPO, p), "rb").read() for p in paths}
    bad, log = 0, []
    holes = [c for c in COVER if not any(c in k for (_, _, ks) in ARMS for k in ks)]
    try:
        for nm, edits, want in ARMS:
            if len(sys.argv) > 1 and sys.argv[1] not in nm:
                continue
            exp = set(want)
            for rel, old, new in edits:
                abs_p = os.path.join(REPO, rel)
                cur = open(abs_p, encoding="utf-8").read()
                hit = cur.count(old)
                if hit != 1:
                    raise SystemExit(f"[{nm}] {rel} 的锚点命中 {hit} 处（必须恰一颗）——⛔ 猜，停手")
                with io.open(abs_p, "wb") as f:
                    f.write(cur.replace(old, new, 1).encode("utf-8"))
            out, rc = run()
            for rel, blob in snap.items():
                with io.open(os.path.join(REPO, rel), "wb") as f:
                    f.write(blob)
            got = red_names(out)
            ok = got == exp
            if not ok:
                with io.open(os.path.join(HERE, "arm_bad.txt"), "wb") as f:
                    f.write(out.encode("utf-8"))
            bad += 0 if ok else 1
            passed = re.search(r"(\d+) passed", out)
            log.append(f"== {'OK ' if ok else 'BAD'} {nm}\n"
                       f"   rc={rc} 通过格数={passed.group(1) if passed else '读不到汇总数'}\n"
                       f"   期望红({len(exp)})={sorted(exp)}\n   实际红({len(got)})={sorted(got)}\n")
        same = all(open(os.path.join(REPO, p), "rb").read() == snap[p] for p in snap)
        log.append(f"== 还原核对：{len(snap)} 颗档与快照{'逐字节相同' if same else '⚠ 不同'}\n")
        bad += 0 if same else 1
        log.append(f"== 名册尺：本批新证人点名 = {COVER}，从没被任何臂点名的 = {holes}\n")
        bad += len(holes)
    finally:
        for p, blob in snap.items():
            with io.open(os.path.join(REPO, p), "wb") as f:
                f.write(blob)
    txt = "\n".join(log) + f"\n汇总：不合格 {bad} / 共 {len(ARMS)} 臂 + 1 还原核对 + 名册尺 {len(holes)} 缺\n"
    with io.open(LOG, "wb") as f:
        f.write(txt.encode("utf-8"))
    print(txt)
    sys.exit(1 if bad else 0)


main()
