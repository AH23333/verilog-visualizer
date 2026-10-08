// Keyboard shortcuts help modal — rendered from the shortcut registry, not a
import { X } from 'lucide-react';
// hand-maintained copy (see src/lib/shortcuts.ts).

import { useEffect, useRef } from 'react';
import { SHORTCUTS, SHORTCUT_GROUPS, type ShortcutDef } from '../lib/shortcuts';

interface ShortcutsHelpDialogProps {
  onClose: () => void;
}

export default function ShortcutsHelpDialog({ onClose }: ShortcutsHelpDialogProps) {
  // Esc 关窗的回调要经 ref：父组件每次渲染都新建箭头函数，把它写进依赖表＝每渲染一次就
  // "摘掉旧的、挂上新的"一轮，按下那一刻挂没挂上是运气（本仓 r84 实测：事件到了 document 而弹窗没关）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const groups: Record<string, ShortcutDef[]> = {};
  for (const group of SHORTCUT_GROUPS) {
    groups[group] = SHORTCUTS.filter((s) => s.group === group);
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-[640px] max-w-[92vw] max-h-[80vh] overflow-y-auto rounded-xl border shadow-2xl"
        style={{ background: 'var(--menu-bg)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b sticky top-0"
          style={{ borderColor: 'var(--border)', background: 'var(--menu-bg)' }}
        >
          <span className="text-[var(--fs-xl)] font-semibold" style={{ color: 'var(--text)' }}>
            键盘快捷键
          </span>
          <button
            onClick={onClose}
            title="关闭 (Esc)"
            className="px-2 py-0.5 border-0 rounded cursor-pointer text-[var(--fs-xxl)] leading-none"
            style={{ background: 'transparent', color: 'var(--text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-5">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group}>
              <h3
                className="text-[var(--fs-sm)] font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                {({ File: '文件', View: '视图', Sim: '仿真', Editor: '编辑器', Canvas: '画布' } as Record<string, string>)[group] ?? group}
              </h3>
              <table className="w-full border-collapse table-fixed">
                <tbody>
                  {groups[group].map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="py-1.5 pr-3 text-[var(--fs-md)]" style={{ color: 'var(--text-secondary)' }}>
                        {s.label}
                      </td>
                      <td className="py-1.5 text-right" style={{ width: 120 }}>
                        <kbd
                          className="inline-block px-2 py-0.5 rounded text-[var(--fs-xs)] font-mono border whitespace-nowrap"
                          style={{
                            background: 'var(--surface)',
                            borderColor: 'var(--border)',
                            color: 'var(--text)',
                          }}
                        >
                          {s.combo}
                        </kbd>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          <p className="text-[var(--fs-sm)]" style={{ color: 'var(--text-muted)' }}>
            说明：标注「编辑器」的快捷键仅在代码编辑器获得焦点时生效。画布鼠标操作：
            滚轮 = 缩放，右键拖拽 = 平移。本列表由快捷键注册表生成，与实际绑定保持同步。
          </p>
        </div>
      </div>
    </div>
  );
}
