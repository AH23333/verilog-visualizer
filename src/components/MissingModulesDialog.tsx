interface MissingModulesDialogProps {
  missingModules: string[];
  onImport: () => void;
  onRecompile: () => void;
  onClose: () => void;
  isCompiling: boolean;
}

export default function MissingModulesDialog({
  missingModules,
  onImport,
  onRecompile,
  onClose,
  isCompiling,
}: MissingModulesDialogProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 3000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          maxWidth: 480,
          width: '90%',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '1.4rem' }}>△</span>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--warning)' }}>
              Missing Module Implementations
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2 }}>
              The following modules are referenced but not defined in any loaded file.
            </div>
          </div>
        </div>

        {/* Missing modules list */}
        <div
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {missingModules.map((mod) => (
            <div
              key={mod}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--danger)',
                    flexShrink: 0,
                  }}
                />
                <code
                  style={{
                    fontSize: '1rem',
                    fontFamily: 'monospace',
                    color: 'var(--text)',
                    background: 'var(--input-bg)',
                    padding: '2px 8px',
                    borderRadius: 3,
                  }}
                >
                  {mod}
                </code>
              </div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                missing implementation
              </span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 18px',
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 500,
            }}
          >
            Dismiss
          </button>
          <button
            onClick={onImport}
            style={{
              padding: '6px 18px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            Import Implementation File...
          </button>
          <button
            onClick={onRecompile}
            disabled={isCompiling}
            style={{
              padding: '6px 18px',
              background: isCompiling ? 'var(--text-muted)' : 'var(--success)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: isCompiling ? 'default' : 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            {isCompiling ? 'Compiling...' : 'Recompile'}
          </button>
        </div>
      </div>
    </div>
  );
}