// Examples gallery — curated built-in circuits (concept: OpenCircuits SideNav
import { X } from 'lucide-react';
// "Examples" + CircuitPreview cards). Thumbnails intentionally not generated:
// every example requires a Yosys compile, so previews would either be baked
// assets or expensive live renders. Plain cards + lazy open instead.

import { useEffect } from 'react';
import { VERILOG_EXAMPLES, type VerilogExample } from '../lib/examples';

interface ExamplesDialogProps {
  /** true while an example is loading/compiling — freeze buttons */
  loading?: boolean;
  onClose: () => void;
  onOpen: (example: VerilogExample) => void;
}

export default function ExamplesDialog({ loading, onClose, onOpen }: ExamplesDialogProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-[720px] max-w-[94vw] max-h-[80vh] overflow-y-auto rounded-xl border shadow-2xl"
        style={{ background: 'var(--menu-bg)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3 border-b sticky top-0"
          style={{ borderColor: 'var(--border)', background: 'var(--menu-bg)' }}
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[0.95rem] font-semibold" style={{ color: 'var(--text)' }}>
              Example Circuits
            </span>
            <span className="text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
              Opens as a new project file and compiles automatically
            </span>
          </div>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="px-2 py-0.5 border-0 rounded cursor-pointer text-[1.2rem] leading-none"
            style={{ background: 'transparent', color: 'var(--text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {VERILOG_EXAMPLES.map((ex) => (
            <button
              key={ex.fileName}
              disabled={loading}
              onClick={() => onOpen(ex)}
              className="text-left p-4 rounded-lg border cursor-pointer transition-all hover:border-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'var(--surface)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[0.9rem] font-semibold truncate" style={{ color: 'var(--text)' }}>
                  {ex.title}
                </span>
                <span
                  className="text-[0.65rem] px-1.5 py-0.5 rounded border flex-shrink-0"
                  style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}
                >
                  .v
                </span>
              </div>
              <div className="text-[0.78rem] leading-relaxed mb-2" style={{ color: 'var(--text-secondary)' }}>
                {ex.description}
              </div>
              <div className="text-[0.7rem] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                {ex.fileName}
              </div>
            </button>
          ))}
        </div>

        {loading && (
          <div className="px-5 pb-4 text-[0.85rem]" style={{ color: 'var(--text-secondary)' }}>
            Compiling selected example…
          </div>
        )}
      </div>
    </div>
  );
}
