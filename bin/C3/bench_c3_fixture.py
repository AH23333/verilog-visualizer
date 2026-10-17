#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向台架（C3）：把 tests/fixtures.cjs 逐处改坏，判该红的格红；外加一颗成对判据。

M4 不是变异，而是**对照件**：拿旧形状（认死 test_files/adder.v）真读一次——它⛔ 必须失败，
否则"搬动会打断闸门"这个前提就是我自己编的（用户此刻确实把 18 颗 .v 搬进了 examples/）。
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
SRC = os.path.join(REPO, "tests", "fixtures.cjs")
TEST = os.path.join("tests", "unit", "fixtures.test.mjs")
LOG = os.path.join(HERE, "bench_c3_fixture.txt")

ast.parse(open(__file__, encoding="utf-8").read())
ANSI = re.compile(chr(27) + r"\[[0-9;]*m")
RED = re.compile(r"^\s*" + chr(0xD7) + r"\s+(.+)$", re.M)
IT = re.compile(r"^  it\('([^']+)'", re.M)
TITLES = IT.findall(open(os.path.join(REPO, TEST), encoding="utf-8").read())


def names(keys):
    out = set()
    for k in keys:
        hit = [x for x in TITLES if k in x]
        if len(hit) != 1:
            raise SystemExit(f"助记串「{k}」命中 {len(hit)} 颗标题（必须恰一颗）：{hit}")
        out.add(hit[0])
    return out


ARMS = [
    ("M0 对照件（⛔ 变异）", None, None, []),
    # M1 射程现读＝三颗全红（⛔ 我第一版的"只红正件"是猜的）：不递归之后
    #  ①正件拿不到夹具；②同名那颗臂的探针要先 fixture('adder.v') 才能复制 ⇒ 一起抛；
    #  ③查无那颗臂断言"现场清单里看得见 adder.v"，而不递归的清单根本没有它。
    ("M1 扫描不递归（只认顶层＝回到认死路径）",
     "      list(abs, depth - 1, acc);", "      // 不递归",
     ["叫得出名字", "同名多颗＝报清单停手", "查无＝抛并报出现场"]),
    ("M2 同名时挑第一颗（⛔ 停手＝悄悄测到别的东西）",
     r"  throw new Error(`夹具同名多颗（${name}）⇒ ${hits.join(' , ')}｜先起个不撞名的名字再跑闸门`);",
     "  return hits[0];",
     ["同名多颗＝报清单停手"]),
    ("M3 查无时交回空串（⛔ 抛＝上层报一颗看不懂的 ENOENT）",
     r"    throw new Error(`夹具查无：${name}｜test_files/ 现有 ${corpus.length} 颗：\n  ${corpus.join('\n  ')}`);",
     "    return '';",
     ["查无＝抛并报出现场"]),
]


def run_vitest():
    p = subprocess.run(f'npx vitest run "{TEST}" --reporter=verbose', cwd=REPO,
                       capture_output=True, text=True, shell=True,
                       encoding="utf-8", errors="replace")
    return ANSI.sub("", (p.stdout or "") + (p.stderr or "")), p.returncode


def red_names(out):
    got = set()
    for m in RED.finditer(out):
        tail = m.group(1).split(" > ")[-1]
        got.add(re.sub(r"\s*\d+(\.\d+)?ms\s*$", "", tail).strip())
    return got


def main():
    snap = open(SRC, "rb").read()
    bad, log = 0, []
    try:
        for nm, old, new, keys in ARMS:
            if old is not None:
                cur = open(SRC, encoding="utf-8").read()
                hit = cur.count(old)
                if hit != 1:
                    raise SystemExit(f"[{nm}] 锚点命中 {hit} 处（必须恰一颗）——停手")
                with io.open(SRC, "wb") as f:
                    f.write(cur.replace(old, new, 1).encode("utf-8"))
            out, rc = run_vitest()
            with io.open(SRC, "wb") as f:
                f.write(snap)
            got, exp = red_names(out), names(keys)
            ok = got == exp
            bad += 0 if ok else 1
            log.append(f"== {'OK ' if ok else 'BAD'} {nm}\n   rc={rc}\n"
                       f"   期望红={sorted(exp)}\n   实际红={sorted(got)}\n")
        # M4 成对判据（走独立探针档；上一版把 node -e 塞进 shell 字符串，引号一层层吃掉＝exit 1）
        probe = subprocess.run('node bin/C3/probe_old_shape.cjs', cwd=REPO,
                               capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
        code = probe.returncode
        pair_ok = code in (0, 3)          # 3＝今天无从对照（夹具在顶层），照实报⛔ 判红
        log.append(f"== {'OK ' if pair_ok else 'BAD'} M4 成对判据（exit={code}）：{probe.stdout.strip() or probe.stderr.strip()}"
                   f"｜7＝旧路径还读得到而解析器指去别处；1＝意外\n")
        bad += 0 if pair_ok else 1
        same = open(SRC, "rb").read() == snap
        log.append(f"== 还原核对：与快照{'逐字节相同' if same else '⚠ 不同'}\n")
        bad += 0 if same else 1
    finally:
        with io.open(SRC, "wb") as f:
            f.write(snap)
    txt = "\n".join(log) + f"\n汇总：不合格 {bad} / 共 {len(ARMS)} 臂 + 成对判据 + 还原核对\n"
    with io.open(LOG, "wb") as f:
        f.write(txt.encode("utf-8"))
    print(txt)
    sys.exit(1 if bad else 0)


main()
