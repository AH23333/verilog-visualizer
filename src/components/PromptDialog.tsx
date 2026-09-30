// In-app replacement for window.prompt() — consistent styling, keyboard-first.
import { useEffect, useRef, useState, type CSSProperties } from 'react';

export interface PromptOptions {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return an error message to keep the dialog open, or null to accept. */
  validate?: (value: string) => string | null;
}

interface PromptDialogProps extends PromptOptions {
  onAccept: (value: string) => void;
  onCancel: () => void;
}

export default function PromptDialog({
  title, label, defaultValue = '', placeholder, confirmLabel = 'OK', validate, onAccept, onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      // select the basename (keep extension out of selection, like VS Code rename)
      const v = inputRef.current?.value ?? '';
      const dot = v.lastIndexOf('.');
      inputRef.current?.setSelectionRange(0, dot > 0 ? dot : v.length);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) { setError('Name cannot be empty.'); return; }
    const err = validate?.(trimmed) ?? null;
    if (err) { setError(err); return; }
    onAccept(trimmed);
  };

  const style: CSSProperties = {
    background: 'var(--input-bg)', color: 'var(--text)',
    border: `1px solid ${error ? 'var(--danger)' : 'var(--input-border)'}`,
    borderRadius: 'var(--radius-md)', padding: '7px 10px', fontSize: '0.9rem', outline: 'none', width: '100%',
  };

  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center"
      style={{ background: 'var(--bg-overlay)' }} onClick={onCancel}>
      <div className="animate-fade-in w-[400px] max-w-[92vw] rounded-xl border shadow-2xl"
        style={{ background: 'var(--menu-bg)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={title}>
        <div className="px-5 pt-4 pb-2">
          <span className="text-[var(--fs-lg)] font-semibold" style={{ color: 'var(--text)' }}>{title}</span>
        </div>
        <div className="px-5 pb-4 flex flex-col gap-2">
          {label && (
            <label className="text-[var(--fs-sm)]" style={{ color: 'var(--text-secondary)' }}>{label}</label>
          )}
          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            style={style}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            }}
          />
          {error && <span className="text-[var(--fs-sm)]" style={{ color: 'var(--danger)' }}>{error}</span>}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onCancel}
              className="px-4 h-[28px] rounded-md border cursor-pointer text-[var(--fs-md)]"
              style={{ background: 'transparent', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              Cancel
            </button>
            <button onClick={submit}
              className="px-4 h-[28px] rounded-md border-0 cursor-pointer text-[var(--fs-md)] font-semibold text-white"
              style={{ background: 'var(--accent)' }}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
