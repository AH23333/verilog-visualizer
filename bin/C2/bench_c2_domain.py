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
PANEL = os.path.join(EXT, "bindingPanel.ts")
SANDBOX = os.path.join(EXT, "sandboxFiles.ts")
PKG = os.path.join(REPO, "extension", "package.json")

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
    # （旧 M7「bindings.complete 查表键退回读反的 .sv?」退役：它锚的那行在深度自检里被 scanDefs
    #   顶掉了。同一颗点的覆盖由 M13 接手——退役要留话，⛔ 让那一格从名册里静默消失；见文末 COVER）
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

    # ── 深度自检批（R153 补）：新落的四颗证人各自要能红 ──
    # M12 只动**键位**那一条（四条同文，锚点带上下文取恰一颗）：行为面⛔ 变，靠 manifest 尺判
    ("M12 Ctrl+F5 的 when 退回两颗扩展（声明式域界漂回）", PKG,
     '        "when": "resourceExtname =~ /\\\\.(v|sv|vh)$/"\n      },\n      {\n        "command": "verilogViz.sim.stepOnce",',
     '        "when": "resourceExtname =~ /\\\\.(v|sv)$/"\n      },\n      {\n        "command": "verilogViz.sim.stepOnce",',
     ["manifest 里那第五"]),
    # M13/M14 退回"拿闭包 job.files 当同名索引"那颗死形状，顺带把读反的 .sv? 抄回来 ⇒ 禁项尺同响
    ("M13 bindings.materialize 的 .v 侧退回闭包索引（那颗按构造恒 0 颗）", TOOLS,
     "        const defs = await scanDefs();\n"
     "        done.push(...await materializeBindings(ctx, docRel, [...inst], async (n) => {\n"
     "          const def = defs.get(n);\n"
     "          if (!def) return null;\n"
     "          const hit = pathRel(projectRoot(ctx), def);\n"
     "          return hit === docRel ? null : hit;                              // ⛔ 把自己录成部件",
     "        const inJob = new Map(job.files.map((f) => [f.name.replace(/\\.sv?$/i, ''), f.name]));\n"
     "        done.push(...await materializeBindings(ctx, docRel, [...inst], async (n) => {\n"
     "          const hit = inJob.get(n);\n"
     "          return hit && hit !== docRel ? hit : null;",
     ["bindings.materialize 的 **.v 侧**", "第二处写死的域判定"]),
    ("M14 绑定面板的自动同名退回闭包索引（那一栏恒 null）", PANEL,
     "    const defRel = new Map<string, string>();\n    for (const [mod, defUri] of await scanDefs()) defRel.set(mod, rel(root, defUri));",
     "    const defRel = new Map<string, string>();\n    for (const f of job.files) defRel.set(f.name.replace(/\\.sv?$/i, ''), f.name);",
     ["未录入实例那一行亮得出", "第二处写死的域判定"]),
    # M15 主人退回"按根串长度切"：形状臂里那两颗切不动的（根外／漂大小写）要响
    ("M15 rootRel 退回按根串长度切（七份里那三份的死法）", DOMAIN,
     "  const rel = path.relative(root.fsPath, uri.fsPath).replace(/\\\\/g, '/');\n"
     "  return rel.startsWith('..') || path.isAbsolute(rel) ? uri.fsPath.replace(/\\\\/g, '/') : rel;",
     "  const rootFs = root.fsPath.replace(/[\\\\/]+$/, '');\n"
     "  return uri.fsPath.slice(rootFs.length + 1).replace(/\\\\/g, '/');",
     ["根外的 Uri 交回"]),
    # M16 去掉 '/' 归一：win32 上 path.relative 交的是反斜杠。rootRel 是**枢纽**，没有"只打一格"的窄变异
    # ⇒ 射程 26 臂（读数逐颗确认都是 rootRel 的真消费者：绑定值/树路径/闭包名/键位）。
    # 期望写成 26 颗全名的等式⛔ 子集判断：将来任何一臂漂色都要逼一次重读（名册 288/312 的口径）。
    ("M16 rootRel 不归一分隔符（交回反斜杠）", DOMAIN,
     "  const rel = path.relative(root.fsPath, uri.fsPath).replace(/\\\\/g, '/');\n"
     "  return rel.startsWith('..') || path.isAbsolute(rel) ? uri.fsPath.replace(/\\\\/g, '/') : rel;",
     "  const rel = path.relative(root.fsPath, uri.fsPath);\n"
     "  return rel.startsWith('..') || path.isAbsolute(rel) ? uri.fsPath.replace(/\\\\/g, '/') : rel;",
     ['根内／子目录／盘符大小写漂／中文段／根自己：一律交斜杠分隔的相对名',
      '.v 绑定全链（桩收紧成员的证物）：面板里选到＝录上 ⇒ 编译闭包照记录走',
      'F1/F3/G3：树内拖入目录——多选移动、域外拦下、绑定随迁、bindingsChanged 广播',
      'G1 文件路（审查缺陷 #4）：跨目录表层的 `../` 引用随「移动到」随迁（旧实现只扫祖先链必漏）',
      'R152 默认绑定权威：录入后同名旧档让位、绑定文件入闭包（⛔ 红字）',
      'X6：importFromUris 域设防——跨界文件不落盘、skipped 计数（fs.import 工具机械体）',
      'audit 命令：未录入的同名兜底当场点名，「写全配置」动作直接落表',
      'bindParts 写「文档所在目录」的表（缺表即建；⛔ 污染根表）',
      'headless 全链：agent 形状的字符串实参走 fs.move——绑定随迁 + bindingsChanged 广播',
      'moveToFile 防自环与原地 no-op：目录⛔ 进自己子树；同目录"移动"⛔ 白跑 (n) 顺延',
      'openBindingConfig：有表直开⛔ 覆盖（用户手编内容珍贵）、无表先建再开',
      'sandboxParts：circuits 名单外的全部 .djs（缺省部件，与画布 refreshGates 同口径）',
      'setDocBindings 落文档目录层：整表替换、值相对化，读回 round-trip 一致',
      '依赖闭包：从入口出发拉到 adder 为止，⛔ 把全工作区文件都塞进编译单',
      '保存闭包内的文件 ⇒ 自动重编译（autoRecompile 默认开）；闭包外⛔ 扰民',
      '全层 BFS：孙层实例也进账（main→ctrl→adder 两层都点名）',
      '删除清绑：删掉被绑定的部件文件 ⇒ 各层指向它的绑定同删（⛔ 留下解不开的悬空项）',
      '协议落地②字段回环保留：手编 $schema/meta/私货在固化·改名·M7 任一写回后⛔ 被吞',
      '固化自动绑定：自动命中的未录入实例写进目录表；已录入⛔ 覆写',
      '宿主文档改名 ⇒ 前缀键同步迁移（⛔ 精控悬空在旧名上）；删除宿主 ⇒ 其前缀键同删',
      '手编 `.verilogviz.json` 保存 ⇒ 编译面板即重算（⛔ 画布即时生效、编译要重按 F5 的两面）',
      '深度自检新增（R153）：bindings.materialize 的 **.v 侧**真落表（修前按构造恒 0 颗＝点了没反应）',
      '深度自检新增（R153）：未录入实例那一行亮得出「自动同名 → lib/adder.v」（修前恒 null）',
      '编译侧录入即权威：绑定把 adder 指向 custom 文件 ⇒ 闭包用之，⛔ 另一颗同名旧文件',
      '编译：前缀键只管那一层的例化（ctrl.v 层的 adder 换实现，顶层同名链路不动）',
      '重命名迁移：部件改名各层绑定与 circuits 同步改指（⛔ 悬空旧路径）']),
    # M17：X19 那颗判据退回收 `.v|.djs` ⇒ 复制纯源码目录又会凭空配出一张空表（禁项尺同响）
    ("M17 hasDjsUnder 退回收 .v（X19 漂回）", SANDBOX,
     "      if (isSandboxPath(name)) return true;",
     "      if (/\\.(v|djs)$/i.test(name)) return true;",
     ["只有 Verilog 源码的目录", "第二处写死的域判定"]),
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


COVER = ["两块板上都亮", "X8 结案", "兜底 topModule", "第二处写死的域判定", "主人口径逐颗现读",
         "manifest 里那第五", "未录入实例那一行亮得出", "bindings.materialize 的 **.v 侧**",
         "根外的 Uri 交回", "根内／子目录", "只有 Verilog 源码的目录"]


def main():
    paths = {a[1] for a in ARMS if a[1]}
    snap = {p: open(p, "rb").read() for p in paths}
    bad, log = 0, []
    # 名册尺（⛔ 让某颗新格从没红过）：本批每颗新证人至少要点名在一臂的期望里
    covered = [k for (_, _, _, _, ks) in ARMS for k in ks]
    holes = [c for c in COVER if not any(c in k for k in covered)]
    try:
        for nm, path, old, new, keys in ARMS:
            # argv[1]＝只跑名字含这颗串的臂（名册尺照常按全表算，⛔ 借过滤藏掉缺格）
            if len(sys.argv) > 1 and sys.argv[1] not in nm:
                continue
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
            if not ok:
                # 只有不合格臂才留原始转储（红名对不上时先读自己的输出，⛔ 凭猜改谓词）；
                # ⛔ 每臂都写＝655 行仪器噪声进版本库（上一笔我刚误提交过一颗）
                with io.open(os.path.join(HERE, "arm_bad.txt"), "wb") as f:
                    f.write(out.encode("utf-8"))
            bad += 0 if ok else 1
            passed = re.search(r"Tests.*?(\d+) passed", out)
            log.append(f"== {'OK ' if ok else 'BAD'} {nm}\n"
                       f"   rc={rc} 通过格数={passed.group(1) if passed else '读不到汇总数'}\n"
                       f"   期望红({len(exp)})={sorted(exp)}\n"
                       f"   实际红({len(got)})={sorted(got)}\n")
        same = all(open(p, "rb").read() == snap[p] for p in snap)
        log.append(f"== 还原核对：{len(snap)} 颗档与快照{'逐字节相同' if same else '⚠ 不同'}\n")
        bad += 0 if same else 1
        log.append(f"== 名册尺：本批新证人 {len(COVER)} 颗，从没被任何臂点名的 = {holes}\n")
        bad += len(holes)
    finally:
        for p, blob in snap.items():
            with io.open(p, "wb") as f:
                f.write(blob)
    txt = "\n".join(log) + f"\n名册尺：本批新证人 {len(COVER)} 颗，从没被任何臂点名的 = {holes}\n" \
        + f"汇总：不合格 {bad} / 共 {len(ARMS)} 臂 + 1 还原核对 + 名册尺 {len(holes)} 缺\n"
    with io.open(LOG, "wb") as f:
        f.write(txt.encode("utf-8"))
    print(txt)
    sys.exit(1 if bad else 0)


main()
