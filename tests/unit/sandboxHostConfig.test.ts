// 沙盒偏好的"宿主配置"这一条线（X25，2026-10-18 现读的用户可见缺陷）。
//
// 缺陷形状：`settingsStore` 的文件头写着"真源在宿主 contributes.configuration"，
// 但 `applyHostConfig` 过去只有**编译侧** `CanvasApp` 调用过；`.djs` 编辑器（`DocApp`）只取了
// `cfg.bindings.policy`，于是生产包里沙盒的唯一入口（`doc.html`）整块忽略用户改过的沙盒设置——
// 现场证据＝关掉「打开沙盒时自动运行仿真」后画布仍自己跑起来（`tests/qc-paused.cjs` 的 [1b] 抓到）。
//
// 这里守三件事，缺一件就会以另一种形状复发：
//   ① 落店这件事本身（值真的进档 + 落了几次店有读数）；
//   ② 两颗入口都真的落店（⛔ 再出现"一侧有、一侧没有"）；
//   ③ 晚到的配置有补做入口（画布按 seq 分辨，⛔ 把用户手动点「运行」的意图覆盖掉）。
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { settingsStore } from '../../src/store/settingsStore';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('X25①：宿主配置落店', () => {
  beforeEach(() => {
    settingsStore.applyHostConfig({ sandbox: { autoStartSim: true, snapToGrid: true } } as never);
  });

  it('applyHostConfig 把沙盒那一叠落进档，缺的字段回落到默认（⛔ 整份覆盖成 undefined）', () => {
    settingsStore.applyHostConfig({ sandbox: { autoStartSim: false } } as never);
    const s = settingsStore.getSandboxSettings();
    expect(s.autoStartSim).toBe(false);       // 推送单里写了的那颗
    expect(s.gridSize).toBe(16);              // 没写的走 DEFAULT_SANDBOX
    expect(s.wireStyle).toBe('metro');
  });

  it('落店次数有读数，且只有"宿主落店"会加一（闸门/工具条那条 setSandboxSettings ⛔ 算配置到店）', () => {
    const before = settingsStore.getHostConfigSeq();
    settingsStore.applyHostConfig({ sandbox: { snapToGrid: false } } as never);
    expect(settingsStore.getHostConfigSeq()).toBe(before + 1);
    settingsStore.setSandboxSettings({ snapToGrid: true });
    expect(settingsStore.getHostConfigSeq()).toBe(before + 1);
    expect(settingsStore.getSandboxSettings().snapToGrid).toBe(true);   // 值照改，seq 不动
  });

  it('没有 sandbox 那一叠的配置⛔ 动档、但⛔ 让消费方以为"已经落过店"？——落店次数仍加一（画布据此补做决定）', () => {
    const before = settingsStore.getHostConfigSeq();
    const gridBefore = settingsStore.getSandboxSettings().gridSize;
    settingsStore.applyHostConfig({} as never);
    expect(settingsStore.getSandboxSettings().gridSize).toBe(gridBefore);
    expect(settingsStore.getHostConfigSeq()).toBe(before + 1);
    // 「什么输入会让它响」：宿主答一份空配置也算"配置来过了"，画布那次补做会按默认档停/起——
    // 这是刻意的：比"永远按建树那一刻的猜测活着"更接近用户设的东西。
  });
});

describe('X25②：两颗入口都真的落店（⛔ 一侧有一侧没有）', () => {
  // 编译侧残壳与文档编辑器各拉一次宿主配置；这一对必须**同语义**，
  // 否则"改了设置没反应"要按入口分岔复现（正是这颗缺陷当初的长相）。
  for (const rel of ['src/canvas/CanvasApp.tsx', 'src/doc/DocApp.tsx']) {
    it(`${rel}：开局落店 + 接住 configChanged 推送`, () => {
      const src = read(rel);
      expect(src).toContain('settingsStore.applyHostConfig(');
      expect(src).toContain('configChanged');
    });
  }

  it('宿主那侧确实向**所有** webview 广播 configChanged（少了文档编辑器这一半，推送判据就是空的）', () => {
    const src = read('extension/src/dispatch.ts');
    expect(src).toMatch(/for \(const w of sinks\) void w\.postMessage\(\{ vvh: 'push', op: 'configChanged' \}\)/);
  });
});

describe('X25③：晚到的配置有补做入口', () => {
  it('画布建树那一次读的是**现读**的档（⛔ 吃 React 闭包里的旧 settings）', () => {
    const src = read('src/components/SandboxCanvas.tsx');
    expect(src).toContain('settingsStore.getSandboxSettings().autoStartSim');
  });

  it('画布按落店次数分辨"这份配置到得比建树晚"，并把它补做成一次起停决定', () => {
    const src = read('src/components/SandboxCanvas.tsx');
    expect(src).toContain('settingsStore.getHostConfigSeq()');
    expect(src).toContain('simDecisionSeqRef');
    // 补做只到用户自己表过态为止（我第一版漏了这条，注释还写着"seq 不动所以覆盖不到"——改设置就 seq++）：
    //   点过「运行 / 暂停」⇒ 这张画布的运行态归他，晚到的配置⛔ 再把引擎拉回去。
    const play = src.slice(src.indexOf('const handlePlayPause'), src.indexOf('const handlePlayPause') + 500);
    expect(play).toContain('simManualToggleRef.current = true;');
    expect(src).toContain('if (simManualToggleRef.current) return;');
    // 换一张画布＝清零，否则这张画布上的表态会一路跟到下一份文档
    expect(src).toContain('simManualToggleRef.current = false;');
  });
});

// ④ X25 那族缺陷在**字段级**的复发面：用户能改的键、宿主读出去的键、画布能落进档的键，
//   三张名册必须是同一套。少任何一条边都是"改了没反应"，而这一条⛔ 需要真机才看得见。
describe('X25④：沙盒设置三张名册同名（manifest ⇔ 宿主读法 ⇔ store 字段）', () => {
  const manifest = JSON.parse(read('extension/package.json'));
  const manifestKeys = Object.keys(manifest.contributes.configuration.properties)
    .filter((k) => k.startsWith('verilogViz.sandbox.'))
    .map((k) => k.slice('verilogViz.sandbox.'.length))
    .sort();

  const dispatchSrc = read('extension/src/dispatch.ts');
  const block = dispatchSrc.slice(dispatchSrc.indexOf('sandbox: {'));
  const hostKeys = [...block.matchAll(/cfg\.get<[^>]*>\('sandbox\.([A-Za-z]+)'\)/g)]
    .map((m) => m[1]).sort();

  const storeKeys = Object.keys(settingsStore.getSandboxSettings()).sort();

  it('名册本身⛔ 是空的（三张都读数；空集合会让下面两条等式恒成立）', () => {
    expect(manifestKeys.length).toBeGreaterThanOrEqual(8);
    expect(hostKeys.length).toBe(manifestKeys.length);
    expect(storeKeys.length).toBe(manifestKeys.length);
  });

  it('manifest 里用户能改的每一颗，宿主都真的去读（少一颗＝设置写了⛔ 交出去）', () => {
    expect(hostKeys).toEqual(manifestKeys);
  });

  it('宿主交出去的每一颗，store 里都有对应字段（少一颗＝推送单里的字段被静默丢掉）', () => {
    expect(storeKeys).toEqual(manifestKeys);
  });

  it('宿主把文档编辑器那颗 webview 也登记成广播对象（DocApp 那条 configChanged 分支不是空话）', () => {
    expect(read('extension/src/customEditors.ts')).toContain('registerWebviewSink(webview)');
    expect(read('extension/src/extension.ts')).toContain("affectsConfiguration('verilogViz')");
  });
});
