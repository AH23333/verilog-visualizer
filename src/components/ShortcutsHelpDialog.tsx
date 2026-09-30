// Keyboard shortcuts help modal — rendered from the shortcut registry, not a
import { X } from 'lucide-react';
// hand-maintained copy (see src/lib/shortcuts.ts).

import { useEffect } from 'react';
import { SHORTCUTS, SHORTCUT_GROUPS, type ShortcutDef } from '../lib/shortcuts';

interface ShortcutsHelpDialogProps {
  onClose: () => void;
}

export default function ShortcutsHelpDialog({ onClose }: ShortcutsHelpDialogProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

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
          <span className="text-[1.05rem] font-semibold" style={{ color: 'var(--text)' }}>
            Keyboard Shortcuts
          </span>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="px-2 py-0.5 border-0 rounded cursor-pointer text-[1.2rem] leading-none"
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
                {group}
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
            Note: editor-only shortcuts apply while the code editor has focus. Canvas mouse:
            scroll wheel = zoom, right-drag = pan. This list is generated from the shortcut
            registry — it stays in sync with actual bindings.
          </p>
        </div>
      </div>
    </div>
  );
}
