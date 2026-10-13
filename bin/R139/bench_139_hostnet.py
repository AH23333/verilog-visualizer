# 变异台架：给片 3a 那面新网（tests/unit/extensionHost.test.ts，22 格）找臂。
# 规矩（R139 卷四十五 §5 那条教训）：**还原一律走 finally**，收尾再自检一次"还原后 0 红"——
# 上一批台架 print 崩在还原之前，那颗变异就在源码里活到了下一轮。
import subprocess, io, sys, os, re

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = r"D:/Visual Studio Code/Something/verilog-visualizer"
EXT = os.path.join(ROOT, "extension/src/extension.ts")
PST = os.path.join(ROOT, "extension/src/projectStore.ts")
PKG = os.path.join(ROOT, "extension/package.json")
ORIG = {p: io.open(p, encoding="utf-8").read() for p in (EXT, PST, PKG)}

ARMS = [
    ("M1 项目根退回旧家（换轨没生效）", EXT,
     "  return folder ? folder.uri : configRoot(context);",
     "  return configRoot(context);"),
    ("M2 跳过规则整条关掉（node_modules/.git 照样上报）", PST,
     "const shouldSkipDir = (name: string) => name === 'node_modules' || name.startsWith('.');",
     "const shouldSkipDir = (_name: string) => false;"),
    ("M3 跳过规则写宽了（长的目录名都吞）", PST,
     "const shouldSkipDir = (name: string) => name === 'node_modules' || name.startsWith('.');",
     "const shouldSkipDir = (name: string) => name.startsWith('.') || name.length > 4;"),
    ("M4 工程配置跟着工作区走（往用户仓库里扔文件）", EXT,
     "  const cfg = new ProjectStore(vscodeFs(configRoot(context)), '@root');",
     "  const cfg = store;"),
    ("M5 webview 资源根少了开发态那一处", EXT,
     "  return [vscode.Uri.joinPath(context.extensionUri, 'webview'), vscode.Uri.joinPath(context.extensionUri, '..', 'dist')];",
     "  return [vscode.Uri.joinPath(context.extensionUri, 'webview')];"),
    ("M6 webview 资源根给到仓根（安全边界）", EXT,
     "  return [vscode.Uri.joinPath(context.extensionUri, 'webview'), vscode.Uri.joinPath(context.extensionUri, '..', 'dist')];",
     "  return [vscode.Uri.joinPath(context.extensionUri, '..', '..')];"),
    ("M7 开局判定被旁路（非内置那一档也自动弹＝抢别人的编辑器）", EXT,
     "  if (shouldAutoOpen({", "  if (true || shouldAutoOpen({"),
    # 这一臂是**真机那一坑**的影子：清单撤回未信任工作区支持后，宿主在受限模式里⛔ 激活我们，
    # 症状（只剩 Welcome 页、日志一行都没有）只有开窗口才看得见 ⇒ 把它拉回无头判的那一半。
    ("M8 清单撤回 untrustedWorkspaces（受限模式里宿主根本⛔ 激活我们）", PKG,
     '      "supported": true,', '      "supported": false,'),
]
TARGETS = ["tests/unit/extensionHost.test.ts", "tests/unit/startupPolicy.test.ts"]


def run(target):
    p = subprocess.run(["npx", "vitest", "run", target], cwd=ROOT, capture_output=True,
                       text=True, shell=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    m = re.search(r"Tests\s+.*?(\d+) failed", out)
    fails = int(m.group(1)) if m else (0 if p.returncode == 0 else -1)
    return p.returncode, fails, out


def restore():
    for path, text in ORIG.items():
        io.open(path, "w", encoding="utf-8", newline="\n").write(text)


try:
    red_any = False
    for t in TARGETS:
        rc, f, out = run(t)
        print(f"=== baseline {t}: rc={rc} failed={f} ===")
        if f != 0:
            red_any = True
            print(out[-1500:])
    if red_any:
        print("基线就红，台架停（先修基线再谈臂）。")
        sys.exit(1)

    bad = 0
    for name, path, old, new in ARMS:
        assert old in ORIG[path], f"锚点没找到：{name}"
        try:
            io.open(path, "w", encoding="utf-8", newline="\n").write(ORIG[path].replace(old, new, 1))
            hits = []
            for t in TARGETS:
                rc, f, out = run(t)
                if f != 0:
                    hits.append(f"{t}:{f}")
            verdict = "合格(有红) " + ",".join(hits) if hits else "不合格(仍全绿)"
            print(f"--- {name}: {verdict}")
            if not hits:
                bad += 1
        finally:
            restore()
finally:
    restore()
    for t in TARGETS:
        rc, f, _ = run(t)
        print(f"=== 收口自检 {t}：rc={rc} failed={f}（期望 0/0）===")

print(f"=== 结果：{len(ARMS)} 臂，不合格 {bad} 臂 ===")
