// B1（片 5）：旧 React UI 的 localStorage 存档 → 工作区真文件的**一次性迁移源**。
//
// 旧 UI 的真源在 localStorage（fileStore 的 `verilog-viz-files` / sandboxStore 的
// `verilog-viz-sandbox-files`），弃旧 UI 后那些文件在新形态里不可见——用户唯一的
// 迁移入口就是画布 webview（localStorage 只在 webview 里读得到）。挂载时探一次，
// 有旧档就提示条 + 「迁移到工作区」按钮 → host.importLegacyData 批量落盘。
// 墓碑键防止迁完之后每次开画布都提示；失败不落墓碑（下次还能再试）。

export const LEGACY_TOMBSTONE = 'verilog-viz-legacy-migrated';

const LEGACY_FILES_KEY = 'verilog-viz-files';         // 旧 fileStore（.v 源码库）
const LEGACY_SANDBOX_KEY = 'verilog-viz-sandbox-files'; // 旧 sandboxStore（.djs 电路库）

export function collectLegacyItems(): Array<{ name: string; content: string }> {
  if (typeof localStorage === 'undefined' || localStorage.getItem(LEGACY_TOMBSTONE)) return [];
  const out: Array<{ name: string; content: string }> = [];
  try {
    for (const f of JSON.parse(localStorage.getItem(LEGACY_FILES_KEY) || '[]')) {
      if (f?.name && typeof f?.content === 'string') out.push({ name: String(f.name), content: f.content });
    }
  } catch { /* 档坏了就只迁沙盒那份 */ }
  try {
    for (const s of JSON.parse(localStorage.getItem(LEGACY_SANDBOX_KEY) || '[]')) {
      const content = typeof s?.graphJson === 'string' ? s.graphJson : typeof s?.content === 'string' ? s.content : null;
      if (s?.name && content) out.push({ name: String(s.name).replace(/\.djs$/i, '') + '.djs', content });
    }
  } catch { /* ignore */ }
  return out;
}

export function markLegacyMigrated(): void {
  try { localStorage.setItem(LEGACY_TOMBSTONE, String(Date.now())); } catch { /* 无 localStorage 就没法标记 */ }
}
