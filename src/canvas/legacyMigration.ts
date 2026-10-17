// B1（片 5）：旧 React UI 的 localStorage 存档 → 工作区真文件的**一次性迁移源**。
//
// 旧 UI 的真源在 localStorage（fileStore 的 `verilog-viz-files` / sandboxStore 的
// `verilog-viz-sandbox-files`），弃旧 UI 后那些文件在新形态里不可见——用户唯一的
// 迁移入口就是画布 webview（localStorage 只在 webview 里读得到）。挂载时探一次，
// 有旧档就提示条 + 「迁移到工作区」按钮 → host.importLegacyData 批量落盘。
//
// ⚠ **两半颗各用自己的墓碑**（这颗文件栽过的地方，2026-10-17 修）：
//   旧形状是"两半颗共用一颗墓碑 + 沙盒那颗按数组迭代"。而 sandboxStore 落盘的是
//   `JSON.stringify(Record<id, SandboxFile>)`（见 src/store/sandboxStore.ts 的 saveAll），
//   `for...of` 一颗 JSON 对象当场 TypeError，被那记 `catch { ignore }` 吞成静默 ⇒
//   **沙盒那半颗从没迁走过一颗**，而那唯一颗墓碑又在 `.v` 迁移成功后把两半一起封死
//   ＝数据永久留在 localStorage 里认不得。所以：
//    · `verilog-viz-legacy-migrated`（老键）现在**只**代表 `.v` 那半颗——老用户已迁成的
//      源码⛔ 被重复 Offer（⛔ 重复落盘＝盘上多一堆 `x (2).v`）；
//    · `verilog-viz-legacy-migrated-djs`（新键）由修好的这一版写 ⇒ 被上面那个 bug 坑过的
//      用户下次开画布会**重新看到自己那些 `.djs`**（程序自己补 Offer，⛔ 要用户找设置项）。
//   失败仍不落墓碑（下次还能再试）。

/** `.v` 那半颗的墓碑（沿用老键名，语义收窄到只管源码档） */
export const LEGACY_TOMBSTONE_V = 'verilog-viz-legacy-migrated';
/** `.djs` 那半颗的墓碑（独立一颗＝老键被 bug 连坐写过，⛔ 再拿它当沙盒档已迁的依据） */
export const LEGACY_TOMBSTONE_DJS = 'verilog-viz-legacy-migrated-djs';

/**
 * 一条搬运项。`name`/`content` 是宿主唯一**必须**看的两颗；其余三颗是 X18 补的**身份**，
 * 宿主（`extension/src/dispatch.ts` 的 importLegacyData）拿它们去落所在目录的绑定表：
 *  · `key`＝旧档里的文件 id，只在**这一批内**当连接键用（⛔ 路径语义，消毒/重名都伤不到它）；
 *  · `role:'part'`＝旧沙盒档里的"这颗是可编辑部件"；
 *  · `bindings`＝celltype → **被绑定部件的旧 id**（旧 sandboxStore 的 `partBindings`，
 *    值存的就是 id；⛔ 在这里就换成名字——重名与消毒会让名字连错档）。
 * 修前三颗都交不出去 ⇒ 部件身份与显式绑定整批丢掉，迁完退化成"看同名谁像就绑谁"。
 */
export interface LegacyItem {
  name: string;
  content: string;
  key?: string;
  role?: 'part';
  bindings?: Record<string, string>;
}

const LEGACY_FILES_KEY = 'verilog-viz-files';           // 旧 fileStore（.v 源码库，存的是**数组**）
const LEGACY_SANDBOX_KEY = 'verilog-viz-sandbox-files'; // 旧 sandboxStore（.djs 电路库，存的是 **Record<id,文件>**）

/**
 * 把一档 localStorage 存档读成条目数组。两种形状都得收：旧 fileStore 落数组、
 * 旧 sandboxStore 落 `Record<id, SandboxFile>`。⛔ 只认数组——那就是那颗静默丢数据的形状。
 */
function entriesOf(raw: string | null): any[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return Object.values(parsed as Record<string, unknown>);
  return [];
}

/** 旧 `partBindings` 的值是文件 id；只收字符串值（非对象/混进脏数据就当没有，⛔ 抛） */
function legacyBindingsOf(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [celltype, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[celltype] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function collectLegacyItems(): LegacyItem[] {
  if (typeof localStorage === 'undefined') return [];
  const out: LegacyItem[] = [];
  if (!localStorage.getItem(LEGACY_TOMBSTONE_V)) {
    for (const f of entriesOf(localStorage.getItem(LEGACY_FILES_KEY))) {
      if (f?.name && typeof f?.content === 'string') out.push({ name: String(f.name), content: f.content });
    }
  }
  if (!localStorage.getItem(LEGACY_TOMBSTONE_DJS)) {
    for (const s of entriesOf(localStorage.getItem(LEGACY_SANDBOX_KEY))) {
      // 只迁画布档（graphJson）。kind:'gate' 那种存的是**编译格式** circuitJson，落成 `.djs`
      // 画布打不开（loadCells 要的是 {cells:[]}）⇒ 宁可留在旧档里也⛔ 往工作区丢一颗开不了的档。
      const content = typeof s?.graphJson === 'string' ? s.graphJson : typeof s?.content === 'string' ? s.content : null;
      if (!s?.name || !content) continue;
      const item: LegacyItem = { name: String(s.name).replace(/\.djs$/i, '') + '.djs', content };
      if (s.id != null && s.id !== '') item.key = String(s.id);
      if (s.role === 'part') item.role = 'part';
      const bindings = legacyBindingsOf(s.partBindings);
      if (bindings) item.bindings = bindings;
      out.push(item);
    }
  }
  return out;
}

/** 迁移成功后落墓碑：按**落盘名**分半颗封（⛔ 拿请求当结果；那颗连坐两半就是修前的 bug）。
 *  实参形状＝宿主 `importLegacyData` 的返回值（落盘名字符串数组，重名的已带 (n)）。 */
export function markLegacyMigrated(writtenNames: string[]): void {
  try {
    const stamp = String(Date.now());
    if (writtenNames.some((n) => /\.djs$/i.test(n))) localStorage.setItem(LEGACY_TOMBSTONE_DJS, stamp);
    if (writtenNames.some((n) => !/\.djs$/i.test(n))) localStorage.setItem(LEGACY_TOMBSTONE_V, stamp);
  } catch { /* 无 localStorage 就没法标记 */ }
}

/** 「不再提示」：两半一起封（用户明确拒了，与"只迁了 .v"是两回事）。 */
export function dismissLegacyMigration(): void {
  try {
    const stamp = String(Date.now());
    localStorage.setItem(LEGACY_TOMBSTONE_V, stamp);
    localStorage.setItem(LEGACY_TOMBSTONE_DJS, stamp);
  } catch { /* ignore */ }
}
