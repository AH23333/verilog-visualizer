#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""回写脚本（片 C5 波次一）：把"只判沙盒侧 UI"的浏览器闸门入口从 `/`（今天的编译残体 CanvasApp）
换到 `/gates.html`（tests/_ui.cjs 认的那颗夹具活动栏）。

为什么⛔ 一把 sed 全替：
 · `qc-paused`/`qc-preview`/`qc-realuser` 跑的是 `vite preview`＝**dist 产物**，而 gates.html
   有意⛔ 进构建输入（`src/gates/main.tsx:9` 那句），换过去当场 404；
 · 编译侧那 34 颗（签名尺见 bin/C4/probe_gate_urls.cjs）要的是 CanvasApp + 宿主推送单，
   换进夹具外壳等于把判据改道。
所以本脚本只动「沙盒侧签名命中而编译侧签名⛔ 命中」的那 24 颗，且每颗先断言锚点恰 1 处、
改完立刻 `node --check`，并逐颗把 (档名, 锚点颗数, 改后那颗串) 打成 TSV 交主代理校验。
可重入：正文里带 `vv-c5` 这颗 tag 的行才算补过（守卫串⛔ 进正文＝恒过，名册 341）。
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

# 强签名只认「它要的到底是哪张画布」：沙盒侧＝那颗 paper/那两个入口，编译侧＝那条推送单/那颗 store。
# ⚠ 第一版把裸「编译」也算进编译侧签名——那颗字在坏名里到处都是（`ok('[编译] …')`），
#   36 颗被读成"两边都沾"而 SKIP，射程是假的（名册 347 同族：⛔ 用字面出现代替"谁真在用"）。
SANDBOX_RE = re.compile(r"enterSandbox|newSandboxFile|__sandboxPaper")
COMPILE_RE = re.compile(r"fileStore|__djsDebug|waitCompiled|compileVerilog|pushCompile")
PREVIEW_RE = re.compile(r"'preview'")
URL_OLD = "http://localhost:${PORT}/`"
URL_NEW = "http://localhost:${PORT}/gates.html`"
TAG = "// vv-c5：入口＝夹具外壳（老 App 的活动栏随旧 React 单页一起退役了）"


def roster():
    src = open(os.path.join(TESTS, "run-all.cjs"), encoding="utf-8").read()
    body = re.search(r"const GATES = \[([\s\S]*?)\];", src).group(1)
    return re.findall(r"'([^']+)'", body)


def main():
    dry = "--apply" not in sys.argv
    rows = []
    for g in roster():
        p = os.path.join(TESTS, g + ".cjs")
        if not os.path.exists(p):
            rows.append((g, "SKIP", "清单里没这颗档", ""))
            continue
        s = open(p, encoding="utf-8").read()
        if URL_OLD not in s:
            continue                                   # 已走 gates.html / 走 dist / ⛔ 浏览器
        if PREVIEW_RE.search(s):
            rows.append((g, "SKIP", "vite preview（dist 产物里⛔ gates.html）", ""))
            continue
        sand, comp = bool(SANDBOX_RE.search(s)), bool(COMPILE_RE.search(s))
        if not sand:
            rows.append((g, "SKIP", "⛔ 沙盒侧签名（编译侧要另走推送单）", ""))
            continue
        if comp:
            rows.append((g, "SKIP", "两边都沾：先单独认它判的是哪一侧", ""))
            continue
        n = s.count(URL_OLD)
        if n != 1:
            rows.append((g, "STOP", f"锚点命中 {n} 处（必须恰 1）", ""))
            continue
        if TAG in s:
            rows.append((g, "DONE", "本批已补过（可重入守卫）", ""))
            continue
        new = s.replace(URL_OLD, URL_NEW, 1)
        # 那颗注释挂在 URL 那行末尾——只给"换了入口"这一件事留一句来历，⛔ 改动判据
        lines = new.split("\n")
        for i, ln in enumerate(lines):
            if URL_NEW in ln:
                # 行尾⛔ 被我的补丁顺手改成裸 LF（名册 306/353 那一族：一档之内混两种行尾，
                # 收口尺数不出来、git 却报整档改动）——原样把那颗 CR 还回去。
                cr = "\r" if ln.endswith("\r") else ""
                lines[i] = ln.rstrip("\r\n") + "  " + TAG + cr
                break
        new = "\n".join(lines)
        if dry:
            rows.append((g, "DRY", "锚点 1 处，待写", ""))
            continue
        # 先算好新字节→写临时档→`node --check` 过了才换正本。
        # ⛔ 先落盘再验：那样验不过时正本已经是坏的，下一颗闸门的读数就建在坏档上
        #（名册 303/353「撞红时前两档已落盘」在这里正是要防的）。
        tmp = p + ".c5check.cjs"
        with io.open(tmp, "wb") as f:
            f.write(new.encode("utf-8"))
        chk = subprocess.run('node --check "' + tmp + '"', cwd=REPO,
                             capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
        os.remove(tmp)
        if chk.returncode != 0:
            rows.append((g, "REFUSED", "新字节⛔ 过 node --check：" + (chk.stdout + chk.stderr)[:200], ""))
            continue
        with io.open(p, "wb") as f:
            f.write(new.encode("utf-8"))
        rows.append((g, "WROTE", "锚点 1 处 + 临时档 node --check ok", URL_NEW))
    for r in rows:
        print("\t".join(r))
    counts = {}
    for r in rows:
        counts[r[1]] = counts.get(r[1], 0) + 1
    print("汇总（%s）：%s" % ("DRY-RUN" if dry else "APPLY", counts))


main()
