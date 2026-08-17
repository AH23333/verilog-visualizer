import { useState, useMemo } from 'react';
import type { FileEntry } from '../store/fileStore';
import { parseVerilogInstances } from '../lib/verilog';

interface BindingDialogProps {
  file: FileEntry;
  allFiles: FileEntry[];
  onConfirm: (bindings: Record<string, string>) => void;
  onCancel: () => void;
}

export default function BindingDialog({
  file,
  allFiles,
  onConfirm,
  onCancel,
}: BindingDialogProps) {
  // Parse the file's Verilog source to find all instantiated modules
  const instantiatedModules = useMemo(
    () => parseVerilogInstances(file.content),
    [file.content]
  );

  // Build module-to-file map for auto-resolution
  const moduleToFile = useMemo(() => {
    const map = new Map<string, FileEntry>();
    for (const f of allFiles) {
      if (f.definedModules) {
        for (const m of f.definedModules) {
          map.set(m, f);
        }
      }
    }
    return map;
  }, [allFiles]);

  // Initialize bindings from existing moduleBindings + auto-resolve new ones
  const [bindings, setBindings] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = { ...(file.moduleBindings || {}) };
    // Auto-resolve any instantiated modules that aren't yet bound
    for (const mod of instantiatedModules) {
      if (!initial[mod]) {
        const autoFile = moduleToFile.get(mod);
        if (autoFile && autoFile.id !== file.id) {
          initial[mod] = autoFile.id;
        }
      }
    }
    return initial;
  });

  // Defined modules in this file
  const definedModules = file.definedModules || [];

  const handleSelect = (moduleName: string, fileId: string) => {
    setBindings((prev) => {
      if (fileId === '') {
        const next = { ...prev };
        delete next[moduleName];
        return next;
      }
      return { ...prev, [moduleName]: fileId };
    });
  };

  const handleConfirm = () => {
    onConfirm(bindings);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: 'var(--panel-bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '20px 24px',
          minWidth: 520,
          maxWidth: 680,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 16, flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text)' }}>
            Module Binding: {file.name}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            {instantiatedModules.length > 0
              ? `Found ${instantiatedModules.length} instantiated module(s). Select the file that defines each module.`
              : 'This file does not instantiate any custom modules.'}
          </p>
        </div>

        {/* Module list */}
        <div style={{ flex: 1, overflow: 'auto', marginBottom: 16, minHeight: 100 }}>
          {/* Defined modules (info only) */}
          {definedModules.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-dim)',
                marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                Defined Modules ({definedModules.length})
              </div>
              {definedModules.map((mod) => (
                <div
                  key={mod}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '6px 8px',
                    marginBottom: 4,
                    borderRadius: 4,
                    background: 'var(--input-bg)',
                  }}
                >
                  <code style={{
                    fontFamily: 'monospace', fontSize: '0.92rem',
                    color: 'var(--success)', fontWeight: 600, minWidth: 100,
                  }}>
                    {mod}
                  </code>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>defined in</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{file.name}</span>
                  {file.filePath && file.filePath !== file.name && (
                    <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)', opacity: 0.6 }}>
                      ({file.filePath})
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Instantiated modules (needs binding) */}
          {instantiatedModules.length > 0 && (
            <div>
              <div style={{
                fontSize: '0.85rem', fontWeight: 600, color: 'var(--warning)',
                marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                Instantiated Modules ({instantiatedModules.length})
              </div>
              {instantiatedModules.map((mod) => {
                const boundFileId = bindings[mod];
                const boundFile = boundFileId ? allFiles.find((f) => f.id === boundFileId) : undefined;
                const autoMatch = moduleToFile.get(mod);

                return (
                  <div
                    key={mod}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '6px 8px',
                      marginBottom: 4,
                      borderRadius: 4,
                      background: boundFile ? 'rgba(0, 200, 0, 0.05)' : 'rgba(255, 150, 0, 0.08)',
                      border: boundFile ? '1px solid rgba(0, 200, 0, 0.15)' : '1px solid rgba(255, 150, 0, 0.2)',
                    }}
                  >
                    <code style={{
                      fontFamily: 'monospace', fontSize: '0.92rem',
                      color: boundFile ? 'var(--success)' : 'var(--warning)',
                      fontWeight: 600, minWidth: 100,
                    }}>
                      {mod}
                    </code>
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>→</span>
                    <select
                      value={boundFileId || ''}
                      onChange={(e) => handleSelect(mod, e.target.value)}
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        fontSize: '0.85rem',
                        background: 'var(--input-bg)',
                        color: 'var(--text)',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                      }}
                    >
                      <option value="">
                        {autoMatch ? `Auto: ${autoMatch.name}` : '-- Select file --'}
                      </option>
                      {allFiles
                        .filter((f) => f.id !== file.id)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                    {boundFile && (
                      <span style={{ fontSize: '0.77rem', color: 'var(--success)', whiteSpace: 'nowrap' }}>
                        ✓ bound
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {definedModules.length === 0 && instantiatedModules.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.92rem' }}>
              No custom modules found in this file.
            </div>
          )}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 16px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--input-bg)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: '0.92rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: '6px 16px',
              border: 'none',
              borderRadius: 4,
              background: 'var(--accent)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.92rem',
              fontWeight: 500,
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}