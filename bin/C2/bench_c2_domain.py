#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向台架（片 C2）：把"域界一颗主人"逐处改回旧形状，判该红的格红、并证明静态禁项尺⛔ 瞎。

红名从 vitest `--reporter=verbose` 的实测行形状取（探针量过）：
  ` × tests/unit/x.test.ts > <describe> > <it>  5ms`（带 ANSI，先抹色再切）
期望⛔ 手打整颗 it 标题（名册 310）——本脚本按**助记短串**在两颗测试档现读的标题里找那颗，
预检要求每颗短串**恰命中一颗**，命中 0 或 >1 当场停手（名字漂了⛔ 让臂悄悄变恒绿）。
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
EXT = os.path.join(REPO, "extension", "src")
TESTS = [os.path.join("tests", "unit", "extensionHost.test.ts"),
         os.path.join("tests", "unit", "vscodeShell.test.ts")]
LOG = os.path.join(HERE, "bench_c2_domain.txt")

ast.parse(open(__file__, encoding="utf-8").read())

ANSI = re.compile(chr(27) + r"\[[0-9;]*m")
RED = re.compile(r"^\s*" + chr(0xD7) + r"\s+(.+)$", re.M)
IT = re.compile(r"^  it\('([^']+)'", re.M)

TITLES = []
for t in TESTS:
    TITLES += IT.findall(open(os.path.join(REPO, t), encoding="utf-8").read())


def names(keys):
    """助记短串 → 那颗现读标题；命中数⛔ 等于 1 就停手（⛔ 猜编号、⛔ 让缺臂从表里消失）"""
    out = set()
    for k in keys:
        hit = [x for x in TITLES if k in x]
        if len(hit) != 1:
            raise SystemExit(f"助记串「{k}」命中 {len(hit)} 颗标题（必须恰一颗）：{hit}")
        out.add(hit[0])
    return out


TREES = os.path.join(EXT, "trees.ts")
COMPILE = os.path.join(EXT, "compilePanel.ts")
DOMAIN = os.path.join(EXT, "verilogDomain.ts")
TOOLS = os.path.join(EXT, "toolsDomain.ts")

ARMS = [
    ("M0 对照件（⛔ 变异）", None, None, None, []),
    ("M1 模块树退回只扫 *.v", TREES,
     "    const files = await findVerilogUris();          // 域界由 verilogDomain 给（⛔ 在这里写死 *.v）",
     "    const files = (await vscode.workspace.findFiles('**/*.v', '**/node_modules/**'))\n      .sort((a, b) => a.fsPath.localeCompare(b.fsPath));",
     ["两块板上都亮", "第二处写死的域判定"]),
    ("M2 层次树定义索引退回只扫 *.v", TREES,
     "    for (const uri of await findVerilogUris()) {",
     "    for (const uri of await vscode.workspace.findFiles('**/*.v', '**/node_modules/**')) {",
     ["两块板上都亮", "第二处写死的域判定"]),
    ("M3 层次树门槛退回 extname !== '.v'", TREES,
     "      if (!editor || !isVerilogPath(editor.document.fileName)) {",
     "      if (!editor || path.extname(editor.document.fileName) !== '.v') {",
     ["两块板上都亮", "第二处写死的域判定"]),
    # ⚠ 变异文本里那颗 `!` 是判据本体：第一版漏写它 ⇒ 门槛变成"是源码文件就挡回"，
    #   18 臂齐红被我读成"这行有 18 个消费者"——那是我自己造的假读数（名册 350 同族）。
    ("M4 编译入口门槛退回 (v|sv)", COMPILE,
     "  if (!uri || !isVerilogPath(uri.fsPath)) {",
     "  if (!uri || !/\\.(v|sv)$/i.test(uri.fsPath)) {",
     ["X8 结案", "兜底 topModule", "第二处写死的域判定"]),
    ("M5 绑定目标取值退回 (v|sv)", COMPILE,
     "      if (isVerilogPath(ov)) {",
     "      if (/\\.(v|sv)$/i.test(ov)) {",
     ["X8 结案", "第二处写死的域判定"]),
    ("M6 topModule 兜底退回那颗读反的 .sv?", COMPILE,
     "stripVerilogExt(path.basename(entry.fsPath));",
     "path.basename(entry.fsPath).replace(/\\.sv?$/, '');",
     ["兜底 topModule", "第二处写死的域判定"]),
    ("M7 bindings.complete 查表键退回那颗读反的 .sv?", TOOLS,
     "[stripVerilogExt(f.name), f.name]",
     "[f.name.replace(/\\.sv?$/i, ''), f.name]",
     ["第二处写死的域判定"]),
    ("M8 主人的扫描只收第一颗扩展", DOMAIN,
     "  for (const ext of exts) {",
     "  for (const ext of exts.slice(0, 1)) {",
     ["两块板上都亮"]),
    # M9 的射程现读＝6 颗行为臂 + 1 颗口径臂：沙盒侧那道"能不能开绑定"的门有六个消费者
    # （bindParts 两种形状 / audit / 字段回环 / 写前校验两颗）。窄化这颗门不是"只影响一处"。
    ("M9 isBindablePath 摘掉沙盒域", DOMAIN,
     "export function isBindablePath(fsPath: string): boolean { return isVerilogPath(fsPath) || isSandboxPath(fsPath); }",
     "export function isBindablePath(fsPath: string): boolean { return isVerilogPath(fsPath); }",
     ["主人口径逐颗现读", "audit 命令：未录入", "bindParts 写「文档所在目录」的表",
      "（.djs 形状）", "字段回环保留", ".djs 目标文件缺失同样拒落", "没这个模块 ⇒ saveError"]),
    ("M10 stripVerilogExt 不剥（原样返回）", DOMAIN,
     "  return ext && VERILOG_EXT.includes(ext) ? norm.slice(0, norm.lastIndexOf('.')) : norm;",
     "  return norm;",
     ["主人口径逐颗现读", "兜底 topModule"]),
    ("M11 watcher 名单摘掉沙盒域", DOMAIN,
     "  return [...VERILOG_EXT, ...SANDBOX_EXT].map((e) => `**/*.${e}`).concat(extra);",
     "  return [...VERILOG_EXT].map((e) => `**/*.${e}`).concat(extra);",
     ["三颗 watcher 在册", "主人口径逐颗现读"]),
]


def run_vitest():
    p = subprocess.run("npx vitest run " + " ".join(f'"{t}"' for t in TESTS) + " --reporter=verbose",
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
    paths = {a[1] for a in ARMS if a[1]}
    snap = {p: open(p, "rb").read() for p in paths}
    bad, log = 0, []
    try:
        for nm, path, old, new, keys in ARMS:
            exp = names(keys)
            if old is not None:
                cur = open(path, encoding="utf-8").read()
                hit = cur.count(old)
                if hit != 1:
                    raise SystemExit(f"[{nm}] 锚点命中 {hit} 处（必须恰一颗）——⛔ 猜，停手")
                blob = cur.replace(old, new, 1).encode("utf-8")
                with io.open(path, "wb") as f:
                    f.write(blob)
            out, rc = run_vitest()
            for p, blob in snap.items():          # 每臂跑完立刻还原（下一臂的锚点是原文）
                with io.open(p, "wb") as f:
                    f.write(blob)
            got = red_names(out)
            ok = got == exp
            bad += 0 if ok else 1
            passed = re.search(r"Tests.*?(\d+) passed", out)
            log.append(f"== {'OK ' if ok else 'BAD'} {nm}\n"
                       f"   rc={rc} 通过格数={passed.group(1) if passed else '读不到汇总数'}\n"
                       f"   期望红({len(exp)})={sorted(exp)}\n"
                       f"   实际红({len(got)})={sorted(got)}\n")
        same = all(open(p, "rb").read() == snap[p] for p in snap)
        log.append(f"== 还原核对：{len(snap)} 颗档与快照{'逐字节相同' if same else '⚠ 不同'}\n")
        bad += 0 if same else 1
    finally:
        for p, blob in snap.items():
            with io.open(p, "wb") as f:
                f.write(blob)
    txt = "\n".join(log) + f"\n汇总：不合格 {bad} / 共 {len(ARMS)} 臂 + 1 还原核对\n"
    with io.open(LOG, "wb") as f:
        f.write(txt.encode("utf-8"))
    print(txt)
    sys.exit(1 if bad else 0)


main()
