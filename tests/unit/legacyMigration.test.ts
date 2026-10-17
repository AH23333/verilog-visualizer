// 旧档迁移的读数面（片 C1，2026-10-17）。
//
// 为什么这一档单测值得单独起一颗文件：`legacyMigration.ts` 在被修好之前**零覆盖**——
// 那记 `for...of` 迭代一颗 JSON 对象的 TypeError 被 `catch { ignore }` 吞掉，而宿主侧
// `importLegacyData` 的格子（extensionHost.test）喂的是自己手写的 items，够不到读档那一层。
// 于是"沙盒那半颗从没迁走过一颗"这件事在 220 格里没有一格看得见。
//
// 形状正本（⛔ 凭印象，都是从写入侧现读的）：
//  · 旧 fileStore：`localStorage['verilog-viz-files'] = JSON.stringify(FileEntry[])`，条目带 `content`；
//  · 旧 sandboxStore：`localStorage['verilog-viz-sandbox-files'] = JSON.stringify(Record<id, SandboxFile>)`，
//    正文在 `graphJson`（见 src/store/sandboxStore.ts 的 saveAll）。
import { describe, it, expect, afterEach } from 'vitest';
import {
  collectLegacyItems, markLegacyMigrated, dismissLegacyMigration,
  LEGACY_TOMBSTONE_V, LEGACY_TOMBSTONE_DJS,
} from '../../src/canvas/legacyMigration';

const FILES_KEY = 'verilog-viz-files';
const SANDBOX_KEY = 'verilog-viz-sandbox-files';

function fakeStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    /** 测试自己的账：看过落进了哪些键 */
    dump: () => Object.fromEntries(m),
  };
}

let store: ReturnType<typeof fakeStore> | null = null;
const prevLocalStorage = (globalThis as any).localStorage;

/** 装一台带 localStorage 的机器（模块里读的是全局那颗，⛔ 模块加载期求值所以装得动） */
function withStore(init: Record<string, string> = {}) {
  store = fakeStore(init);
  (globalThis as any).localStorage = store;
  return store;
}

afterEach(() => {
  store = null;
  // ⛔ `= undefined`：那会把字符串 "undefined" 写进全局，`typeof localStorage` 就再也不等于
  // 'undefined' 了，后面"无 localStorage"那一格会读成"有"（本轮踩过一次的形状）。
  delete (globalThis as any).localStorage;
  if (prevLocalStorage !== undefined) (globalThis as any).localStorage = prevLocalStorage;
});

describe('旧档收集：两半颗的形状都得收', () => {
  it('正件（这颗文件修好前必红的一格）：sandboxStore 那份 **Record<id,文件>** 收得出 .djs', () => {
    // 写入侧形状逐字照抄 saveAll：JSON.stringify(Record<id, SandboxFile>)——不是数组
    withStore({
      [SANDBOX_KEY]: JSON.stringify({
        'm3a1x': { id: 'm3a1x', name: '画布甲.djs', graphJson: '{"cells":[1]}', updatedAt: 1 },
        'm3b2y': { id: 'm3b2y', name: 'parts/画布乙', graphJson: '{"cells":[2]}', updatedAt: 2 },
      }),
    });
    // ⚠ 期望里带 `key` 是 X18 的形状：旧档的 `id` 现在是这批的连接键（宿主用它把 partBindings 的
    // 值连到落盘名），所以必须原样交出去。⛔ 为了这条好看而⛔ 交身份——那正是修前的样子。
    expect(collectLegacyItems()).toEqual([
      { name: '画布甲.djs', content: '{"cells":[1]}', key: 'm3a1x' },
      { name: 'parts/画布乙.djs', content: '{"cells":[2]}', key: 'm3b2y' },   // 无扩展名补 .djs；目录段原样留（宿主按名建目录）
    ]);
  });

  it('旧档兜底：同一颗键存成**数组**也收（⛔ 只认一种形状＝另一种静默为零）', () => {
    withStore({ [SANDBOX_KEY]: JSON.stringify([{ name: 'a.djs', graphJson: '{"cells":[]}' }]) });
    expect(collectLegacyItems()).toEqual([{ name: 'a.djs', content: '{"cells":[]}' }]);
  });

  it('源码那半颗按 FileEntry 数组收：正文取 content，名字原样', () => {
    withStore({ [FILES_KEY]: JSON.stringify([{ id: '1', name: 'adder.v', content: 'module a;endmodule' }]) });
    expect(collectLegacyItems()).toEqual([{ name: 'adder.v', content: 'module a;endmodule' }]);
  });

  it('kind:gate 那种（只有编译格式 circuitJson、无画布 graphJson）⛔ 落成开不了的 .djs', () => {
    withStore({
      [SANDBOX_KEY]: JSON.stringify({
        g1: { id: 'g1', name: '旧门.djs', kind: 'gate', circuitJson: '{"type":"gate"}', updatedAt: 1 },
        g2: { id: 'g2', name: '画布.djs', graphJson: '{"cells":[]}', updatedAt: 2 },
      }),
    });
    expect(collectLegacyItems()).toEqual([{ name: '画布.djs', content: '{"cells":[]}', key: 'g2' }]);
  });

  it('X18 正件：旧档里的部件身份与文件级绑定**跟着搬**（修前这两样整批丢掉＝迁完没人知道谁是部件）', () => {
    withStore({
      [SANDBOX_KEY]: JSON.stringify({
        pA: { id: 'pA', name: 'parts/adder', graphJson: '{"cells":[1]}', role: 'part', updatedAt: 1 },
        pB: { id: 'pB', name: 'parts/full_adder', graphJson: '{"cells":[2]}', role: 'part', updatedAt: 2 },
        top: {
          id: 'top', name: 'ctrl', graphJson: '{"cells":[3]}', updatedAt: 3,
          // 旧 sandboxStore 的 partBindings：值＝**批内文件 id**（⛔ 名字——重名/消毒会连错档）
          partBindings: { adder: 'pA', full_adder: 'pB' },
        },
      }),
    });
    const items = collectLegacyItems();
    expect(items.find((i) => i.name === 'parts/adder.djs')?.role).toBe('part');
    expect(items.find((i) => i.name === 'parts/full_adder.djs')?.role).toBe('part');
    expect(items.find((i) => i.name === 'ctrl.djs')?.bindings).toEqual({ adder: 'pA', full_adder: 'pB' });
    // 负件一：普通画布档⛔ 被顺手标成部件（role 只搬旧档真写了 'part' 的那些）
    expect(items.find((i) => i.name === 'ctrl.djs')?.role).toBeUndefined();
    // 负件二：partBindings 里的脏值（非字符串/null）⛔ 进载荷——宿主拿它连不到档＝落一条悬空绑定
    withStore({
      [SANDBOX_KEY]: JSON.stringify({
        x1: { id: 'x1', name: 'a', graphJson: '{}', role: 'part', updatedAt: 1 },
        y1: { id: 'y1', name: 'b', graphJson: '{}', updatedAt: 2, partBindings: { good: 'x1', bad: null, nested: { z: 1 } } },
      }),
    });
    expect(collectLegacyItems().find((i) => i.name === 'b.djs')?.bindings).toEqual({ good: 'x1' });
  });

  it('档坏了／缺键／装了非对象＝回空数组，⛔ 抛（提示条⛔ 因为一颗坏档就整条消失）', () => {
    withStore({ [FILES_KEY]: '{not json', [SANDBOX_KEY]: '"just a string"' });
    expect(collectLegacyItems()).toEqual([]);
    withStore({});
    expect(collectLegacyItems()).toEqual([]);
  });

  it('没有 localStorage 的宿主＝回空数组（⛔ ReferenceError 炸掉画布挂载）', () => {
    delete (globalThis as any).localStorage;
    expect((globalThis as any).localStorage).toBeUndefined();
    expect(collectLegacyItems()).toEqual([]);
    expect(() => markLegacyMigrated(['a.v'])).not.toThrow();
    expect(() => dismissLegacyMigration()).not.toThrow();
  });
});

describe('墓碑：两半颗各封各的（那颗连坐 bug 的反面）', () => {
  it('老键（= .v 半颗）在 ⇒ 只封源码，**.djs 照旧重新 Offer**＝被连坐坑过的那批自愈', () => {
    // 这正是修好前那批用户的现场：他迁成了 .v，墓碑写了，但沙盒档一颗都没迁走
    withStore({
      [LEGACY_TOMBSTONE_V]: '1700000000000',
      [FILES_KEY]: JSON.stringify([{ name: 'adder.v', content: 'x' }]),
      [SANDBOX_KEY]: JSON.stringify({ a: { name: '画布甲.djs', graphJson: '{"cells":[]}' } }),
    });
    expect(collectLegacyItems()).toEqual([{ name: '画布甲.djs', content: '{"cells":[]}' }]);
  });

  it('新键（= .djs 半颗）在 ⇒ 沙盒不再 Offer，而源码那半颗仍认（⛔ 一颗封两半）', () => {
    withStore({
      [LEGACY_TOMBSTONE_DJS]: '1700000000000',
      [FILES_KEY]: JSON.stringify([{ name: 'adder.v', content: 'x' }]),
      [SANDBOX_KEY]: JSON.stringify({ a: { name: '画布甲.djs', graphJson: '{"cells":[]}' } }),
    });
    expect(collectLegacyItems()).toEqual([{ name: 'adder.v', content: 'x' }]);
  });

  it('两键齐 ⇒ 一颗都不 Offer', () => {
    withStore({
      [LEGACY_TOMBSTONE_V]: '1', [LEGACY_TOMBSTONE_DJS]: '1',
      [FILES_KEY]: JSON.stringify([{ name: 'adder.v', content: 'x' }]),
      [SANDBOX_KEY]: JSON.stringify({ a: { name: '画布甲.djs', graphJson: '{}' } }),
    });
    expect(collectLegacyItems()).toEqual([]);
  });

  it('markLegacyMigrated 按**落盘名**（宿主交回的字符串数组）分半颗：只迁了 .v 的批次⛔ 封沙盒键', () => {
    const s = withStore({});
    markLegacyMigrated(['adder.v', 'alu_top.v']);
    expect(s!.dump()[LEGACY_TOMBSTONE_V]).toBeTruthy();
    expect(s!.dump()[LEGACY_TOMBSTONE_DJS]).toBeUndefined();   // ← 那颗连坐就是这里的 bug
  });

  it('混合批次（.v + .djs）⇒ 两颗都封；纯 .djs 批次只封沙盒那颗', () => {
    const s1 = withStore({});
    markLegacyMigrated(['adder.v', '画布甲.djs']);
    expect(s1!.dump()[LEGACY_TOMBSTONE_V]).toBeTruthy();
    expect(s1!.dump()[LEGACY_TOMBSTONE_DJS]).toBeTruthy();

    const s2 = withStore({});
    markLegacyMigrated(['parts/画布乙.djs']);
    expect(s2!.dump()[LEGACY_TOMBSTONE_DJS]).toBeTruthy();
    expect(s2!.dump()[LEGACY_TOMBSTONE_V]).toBeUndefined();
  });

  it('「不再提示」＝两半一起封（用户明确拒了，与"只迁了半颗"是两回事）', () => {
    const s = withStore({});
    dismissLegacyMigration();
    expect(s!.dump()[LEGACY_TOMBSTONE_V]).toBeTruthy();
    expect(s!.dump()[LEGACY_TOMBSTONE_DJS]).toBeTruthy();
  });
});
