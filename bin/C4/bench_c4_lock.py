#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向台架（片 C4）：契约对账锁里那五处「字符串拼布尔」的恒真断言。

修前的形状（`expect('文案' + 布尔).toBeTruthy()`）恒为非空串 ⇒ ①③④ 三格从未判过任何东西，
整段"锁"只剩 ② 在真跑。本台架要同时证两件事，缺一件都算我没检：
 A. **新形状抓得住**：往契约里塞五种野值，每种都要红，且原始转储里必须出现那颗野值本身
    ——只判"红名相等"不够：一颗 it 里有四格，红名相同而开火的那格可能不是我要的那格；
 B. **旧形状确实是瞎的**：把那一格换回旧写法（数据照常坏），必须读回**零红**＝恒绿的尺子。

红名从 vitest `--reporter=verbose` 的实测行形状取（C2 台架探针量过，带 ANSI 先抹色）。
期望⛔ 手打整颗 it 标题（名册 310）：按助记短串在现读标题里找，命中数⛔ 恰一颗就停手。

阶段三收编（R154）加了两臂：M9 只改实现体的 case 标签 ⇒ 要求**只有**新证人「名册 ↔ 实现体双向」红；
M10 只摘名册上一颗 ⇒ 四把尺一起红（新证人若只判"switch 多的那一半"，M10 就抓不到它）。
名册尺（COVER）随之加这颗新证人：没有臂点名的新证人＝不合格。
"""
import ast
import io
import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TEST = os.path.join("tests", "unit", "vscodeShell.test.ts")
API = os.path.join("extension", "api", "vv-api.defaults.json")
DISPATCH = os.path.join("extension", "src", "dispatch.ts")
LOCK = "契约对账锁"
ROSTER = "名册 ↔ 实现体双向"          # 阶段三收编后新增那颗证人（本台架 M9/M10 就是给它配的）

ANSI = re.compile(chr(27) + r"\[[0-9;]*m")
RED = re.compile(r"^\s*" + chr(0xD7) + r"\s+(.+)$", re.M)
IT = re.compile(r"^  it\('([^']+)'", re.M)

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


# ---- 数据侧的五种野值（每颗只喂给一格）----
TOOLS_HEAD = '  "tools": {\n    "host.appendOutput":'
TOOLS_HEAD_WILD = ('  "tools": {\n    "zzz.bad": { "perm": "read", "sideEffects": "none",'
                   ' "surfaces": ["ui"], "ref": "verilogViz.renameFile", "since": "0.1.0" },\n'
                   '    "host.appendOutput":')
GET_REF = '"ref": "bindings.get", "idempotent": true'
GET_REF_BAD = '"ref": "bindings.got", "idempotent": true'
AUDIT_KEY = '    "sys.readAudit":       { "perm": "read",'
AUDIT_KEY_RENAMED = '    "sys.auditLog": { "perm": "read",'
APPEND_PERM = '"host.appendOutput":        { "perm": "read",'
APPEND_PERM_BAD = '"host.appendOutput":        { "perm": "network",'
ALL_GET_SURF = '"surfaces": ["rpc"], "ref": "getAllBindings"'
ALL_GET_SURF_BAD = '"surfaces": ["rpc", "rpc"], "ref": "getAllBindings"'

# ---- 名册↔实现体那一颗证人的两颗变异（阶段三收编新增）----
# M9：只动**实现体**（case 标签改名）⇒ 名册/前端照旧齐，唯独新证人该红（红名相等不够：needle 见底）
CASE_JUMP = "    case 'jumpToSource': {"
CASE_JUMP_BAD = "    case 'jumpToSourceX': {"
# M10：只动**名册**（摘掉一颗）⇒ 三把尺一起红（名册↔实现体、前端↔名册、契约 rpc 投影↔名册）。
# 这一臂的用途是**正件**：证明新证人真能指出"名册少一颗"的方向（单向尺会漏的那一半）。
ROSTER_JUMP = "  'importLegacyData', 'getAllBindings', 'setDocBindings', 'jumpToSource',"
ROSTER_JUMP_BAD = "  'importLegacyData', 'getAllBindings', 'setDocBindings',"

# ---- 断言侧的"旧写法"还原颗（证 B 用：那一格换回修前形状）----
LIVE_1 = ("    expect(tools.map(({ id }) => id).filter((id) => !idRe.test(id))).toEqual([]);\n"
          "    expect([...new Set(tools.map(({ id }) => id.split('.')[0]))].sort()).toEqual(NS);\n")
DEAD_1 = "    for (const { id } of tools) expect(`[${id}] ` + idRe.test(id)).toBeTruthy();\n"
LIVE_3 = ("    expect(tools.filter(({ t }) => t.surfaces.includes('ui'))\n"
          "      .filter(({ t }) => !cmdIds.has(t.ref) && !handlerIds.has(t.ref))\n"
          "      .map(({ id, t }) => `${id}→${t.ref}`)).toEqual([]);\n")
DEAD_3 = ("    for (const { id, t } of tools.filter(({ t }) => t.surfaces.includes('ui')))\n"
          "      expect(`${id}→${t.ref} 在 commands: ` + cmdIds.has(t.ref)).toBeTruthy();\n")
LIVE_4 = ("    expect({\n"
          "      perm: tools.filter(({ t }) => !permEnum.includes(t.perm)).map(({ id, t }) => `${id}.perm=${t.perm}`),\n"
          "      sideEffects: tools.filter(({ t }) => !seEnum.includes(t.sideEffects)).map(({ id, t }) => `${id}.sideEffects=${t.sideEffects}`),\n"
          "      空surfaces: tools.filter(({ t }) => !t.surfaces.length).map(({ id }) => id),          // 全空＝没人可达的死登记\n"
          "      重复surfaces: tools.filter(({ t }) => new Set(t.surfaces).size !== t.surfaces.length).map(({ id }) => id),\n"
          "    }).toEqual({ perm: [], sideEffects: [], 空surfaces: [], 重复surfaces: [] });\n")
DEAD_4 = ("    for (const { id, t } of tools) {\n"
          "      expect(`${id}.perm:${t.perm} 在词表 ` + permEnum.includes(t.perm)).toBeTruthy();\n"
          "      expect(`${id}.sideEffects:${t.sideEffects} 在词表 ` + seEnum.includes(t.sideEffects)).toBeTruthy();\n"
          "      expect(t.surfaces.length).toBeGreaterThan(0);\n"
          "      expect(`[${id}] surfaces 不许有重复项 ` + (new Set(t.surfaces).size === t.surfaces.length)).toBeTruthy();\n"
          "    }\n")

# 每臂＝一串 (档, 原文, 新文) + 期望红名助记串 + 必须在原始转储里出现的野值串（needle）
ARMS = [
    ("M0 对照件（⛔ 变异）", [], [], None),
    ("M1 契约多一颗野命名空间 zzz.bad", [(API, TOOLS_HEAD, TOOLS_HEAD_WILD)], [LOCK], "zzz.bad"),
    ("M2 一颗 ui 工具的 ref 漂成没人认得的名字", [(API, GET_REF, GET_REF_BAD)], [LOCK], "bindings.get→bindings.got"),
    ("M3 handler 有、契约改指到别名（反向那格）", [(API, AUDIT_KEY, AUDIT_KEY_RENAMED)], [LOCK], "sys.readAudit"),
    ("M4 perm 漂出 schema 词表", [(API, APPEND_PERM, APPEND_PERM_BAD)], [LOCK], "host.appendOutput.perm=network"),
    ("M5 surfaces 里同一端写两遍", [(API, ALL_GET_SURF, ALL_GET_SURF_BAD)], [LOCK], "重复surfaces"),
    # ── 证 B：把那一格换回修前的恒真写法，数据照常坏 ⇒ 必须读回零红 ──
    ("M6 旧形状 ①＋野命名空间＝读不到红（那格修前是瞎的）",
     [(API, TOOLS_HEAD, TOOLS_HEAD_WILD), (TEST, LIVE_1, DEAD_1)], [], None),
    ("M7 旧形状 ③＋ref 漂＝读不到红",
     [(API, GET_REF, GET_REF_BAD), (TEST, LIVE_3, DEAD_3)], [], None),
    ("M8 旧形状 ④＋perm 漂出词表＝读不到红",
     [(API, APPEND_PERM, APPEND_PERM_BAD), (TEST, LIVE_4, DEAD_4)], [], None),
    # ── 阶段三收编：名册↔实现体那颗新证人的两向（⛔ 只配单向＝"名册少一颗"那一半永远不响）──
    ("M9 实现体改名、名册照旧＝只有新证人红",
     [(DISPATCH, CASE_JUMP, CASE_JUMP_BAD)], [ROSTER], "jumpToSourceX"),
    ("M10 名册少一颗＝四把尺一起红（新证人的正件方向）",
     [(DISPATCH, ROSTER_JUMP, ROSTER_JUMP_BAD)],
     [ROSTER, "两张表逐字相同", "两边都真抽到了名字", LOCK], "jumpToSource"),
]

COVER = [LOCK, ROSTER]


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
            # argv[1]＝只跑名字含这颗串的臂（名册尺照常按全表算，⛔ 借过滤藏掉缺格）
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
            # needle：红名相同而开火的格不同也算不合格——必须在原始转储里见到那颗野值本身
            nd_ok = needle is None or (needle in out)
            ok = (got == exp) and nd_ok
            if not ok:
                with io.open(os.path.join(HERE, "arm_bad.txt"), "wb") as f:
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
    txt = "\n".join(log) + f"\n名册尺：本批新证人 {len(COVER)} 颗，从没被任何臂点名的 = {holes}\n" \
        + f"汇总：不合格 {bad} / 共 {len(ARMS)} 臂 + 1 还原核对 + 名册尺 {len(holes)} 缺\n"
    with io.open(os.path.join(HERE, "bench_c4_lock.txt"), "wb") as f:
        f.write(txt.encode("utf-8"))
    print(txt)
    sys.exit(1 if bad else 0)


main()
