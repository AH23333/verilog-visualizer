# 变异台架：给 tests/unit/startupPolicy.test.ts 那 12 格找臂。
# 每臂只改一处实现，跑该文件，要求"至少一颗红"。
# ⚠ 还原一律走 finally：上一版把 print 放在还原之前，print 因 gbk 编不了 ⛔ 当场崩，
#   于是那颗变异留在源码里——下一轮"基线就红"才发现。崩在中间＝源码被改坏，这比臂不合格更贵。
import subprocess, io, sys, os, re

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = r"D:/Visual Studio Code/Something/verilog-visualizer"
T = os.path.join(ROOT, "extension/src/startupPolicy.ts")
orig = io.open(T, encoding="utf-8").read()
NORM = "  return !!root && (ext === root || ext.startsWith(root + '/'));"
assert NORM in orig, "锚点行不在源码里——先确认上一轮的变异还原了没"

ARMS = [
    ("M1 归一去掉（裸 startsWith）", NORM,
     "  return !!root && String(extensionFsPath).startsWith(appRoot);"),
    ("M2 内置那一档不看（只认开发态）",
     "  return input.builtIntoThisApp;", "  return false;"),
    ("M3 环境变量改成非空即开",
     "  if (input.envFlag === '1') return true;", "  if (input.envFlag) return true;"),
    ("M4 空前缀放行", NORM, "  return ext === root || ext.startsWith(root + '/');"),
]


def run():
    p = subprocess.run(["npx", "vitest", "run", "tests/unit/startupPolicy.test.ts"],
                       cwd=ROOT, capture_output=True, text=True, shell=True,
                       encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    m = re.search(r"Tests\s+.*?(\d+) failed", out)
    fails = int(m.group(1)) if m else (0 if p.returncode == 0 else -1)  # -1＝跑都没跑起来
    return p.returncode, fails, out


def restore():
    io.open(T, "w", encoding="utf-8", newline="\n").write(orig)


try:
    rc, f, out = run()
    print(f"=== baseline（未变异）rc={rc} failed={f} ===")
    if f != 0:
        print(out[-1200:])
        print("基线就红，台架停（先修基线再谈臂）。")
        sys.exit(1)

    bad = 0
    for name, old, new in ARMS:
        assert old in orig, f"锚点没找到：{name}"
        try:
            io.open(T, "w", encoding="utf-8", newline="\n").write(orig.replace(old, new, 1))
            rc, f, out = run()
            verdict = "合格(有红)" if (rc != 0 and f != 0) else "不合格(仍全绿)"
            print(f"--- {name}: rc={rc} failed={f} ⇒ {verdict}")
            if rc == 0 or f == 0:
                bad += 1
                print(out[-1200:])
        finally:
            restore()
finally:
    rc, f, _ = run()
    print(f"=== 收口自检：还原后 rc={rc} failed={f}（期望 0/0）===")

print(f"=== 结果：{len(ARMS)} 臂，不合格 {bad} 臂 ===")
