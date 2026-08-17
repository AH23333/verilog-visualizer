import { useState, useMemo } from 'react';
import { type FileEntry } from '../store/fileStore';
import { parseVerilogInstances } from '../lib/verilog';

interface ModulePanelProps {
  files: FileEntry[];
  onSelectFile: (id: string) => void;
  onBindModule: (fileId: string, missingModule: string, sourceFileId: string) => void;
  onRecompile: () => void;
  isCompiling: boolean;
}

export default function ModulePanel({
  files,
  onSelectFile,
  onBindModule,
  onRecompile,
  isCompiling,
}: ModulePanelProps) {
  // Track which file is expanded
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Build module-to-file mapping for auto-resolution and dropdown filtering
  const moduleToFile = new Map<string, FileEntry>();
  for (const f of files) {
    if (f.definedModules) {
      for (const m of f.definedModules) {
        moduleToFile.set(m, f);
      }
    }
  }

  // Parse instantiated modules for each file
  const instantiatedModules = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const f of files) {
      map.set(f.id, parseVerilogInstances(f.content));
    }
    return map;
  }, [files]);

  const toggleExpand = (fileId: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--sidebar-bg)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          fontSize: '0.85rem',
          fontWeight: 600,
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        Modules
      </div>

      {/* File list with modules */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {files.length === 0 && (
          <div
            style={{
              padding: 16,
              fontSize: '0.92rem',
              color: 'var(--text-dim)',
              textAlign: 'center',
            }}
          >
            No files imported
          </div>
        )}

        {files.map((file) => {
          const isExpanded = expandedFiles.has(file.id);
          const hasDefinedModules = file.definedModules && file.definedModules.length > 0;
          const hasMissingModules = file.missingModules && file.missingModules.length > 0;

          return (
            <div
              key={file.id}
              style={{
                borderBottom: '1px solid var(--border)',
              }}
            >
              {/* File header */}
              <div
                onClick={() => toggleExpand(file.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  gap: 4,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--menu-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={{ fontSize: '0.69rem', color: 'var(--text-dim)', width: 12 }}>
                  {isExpanded ? '▾' : '▸'}
                </span>
                <span
                  onClick={(e) => { e.stopPropagation(); onSelectFile(file.id); }}
                  style={{
                    fontSize: '0.92rem',
                    fontWeight: 500,
                    color: 'var(--text)',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                  title={file.name}
                >
                  📄 {file.name}
                </span>
                {/* Status badge */}
                <span
                  style={{
                    fontSize: '0.62rem',
                    padding: '1px 5px',
                    borderRadius: 3,
                    background:
                      file.status === 'compiled' ? 'var(--success)' :
                      file.status === 'missing_deps' ? 'var(--warning)' :
                      file.status === 'error' ? 'var(--danger)' : 'var(--text-dim)',
                    color: '#fff',
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {file.status === 'compiled' ? 'OK' :
                   file.status === 'missing_deps' ? 'DEPS' :
                   file.status === 'error' ? 'ERR' : 'NEW'}
                </span>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ padding: '4px 12px 8px 24px' }}>
                  {/* File path */}
                  {file.filePath && (
                    <div
                      style={{
                        fontSize: '0.69rem',
                        color: 'var(--text-dim)',
                        fontFamily: 'monospace',
                        marginBottom: 6,
                        wordBreak: 'break-all',
                        opacity: 0.7,
                      }}
                      title={file.filePath}
                    >
                      📂 {file.filePath}
                    </div>
                  )}

                  {/* Defined modules section */}
                  <div style={{ marginBottom: hasMissingModules ? 8 : 0 }}>
                    <div style={{ fontSize: '0.69rem', color: 'var(--text-dim)', marginBottom: 3, fontWeight: 600 }}>
                      Defined Modules
                    </div>
                    {hasDefinedModules ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {file.definedModules!.map((mod) => (
                          <div
                            key={mod}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: '0.77rem',
                              padding: '2px 6px',
                              borderRadius: 3,
                              background: 'var(--input-bg)',
                            }}
                          >
                            <code
                              style={{
                                fontFamily: 'monospace',
                                color: 'var(--success)',
                                fontWeight: 600,
                              }}
                            >
                              {mod}
                            </code>
                            <span style={{ color: 'var(--text-dim)', fontSize: '0.69rem' }}>
                              → {file.name}
                            </span>
                            {file.filePath && file.filePath !== file.name && (
                              <span
                                style={{
                                  color: 'var(--text-dim)',
                                  fontSize: '0.62rem',
                                  opacity: 0.6,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  maxWidth: 120,
                                }}
                                title={file.filePath}
                              >
                                ({file.filePath})
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: '0.77rem',
                          color: 'var(--text-dim)',
                          fontStyle: 'italic',
                          padding: '2px 6px',
                        }}
                      >
                        无
                      </div>
                    )}
                  </div>

                  {/* Missing modules section */}
                  {hasMissingModules && (
                    <div>
                      <div style={{ fontSize: '0.69rem', color: 'var(--danger)', marginBottom: 3, fontWeight: 600 }}>
                        Missing Modules
                      </div>
                      {file.missingModules!.map((mod) => {
                        const boundFileId = file.moduleBindings?.[mod];
                        const boundFile = boundFileId ? files.find((f) => f.id === boundFileId) : undefined;
                        const autoMatch = moduleToFile.get(mod);

                        // Filter dropdown: only show files that define this module
                        const candidateFiles = files.filter(
                          (f) => f.id !== file.id && f.definedModules?.includes(mod)
                        );

                        return (
                          <div
                            key={mod}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: '0.77rem',
                              marginBottom: 3,
                              padding: '2px 6px',
                              borderRadius: 3,
                              background: 'rgba(255, 0, 0, 0.05)',
                              flexWrap: 'wrap',
                            }}
                          >
                            <code
                              style={{
                                fontFamily: 'monospace',
                                color: 'var(--danger)',
                                fontWeight: 600,
                              }}
                            >
                              {mod}
                            </code>

                            {/* Always show a dropdown for re-binding */}
                            <select
                              value={boundFileId || ''}
                              onChange={(e) => {
                                if (e.target.value) {
                                  onBindModule(file.id, mod, e.target.value);
                                }
                              }}
                              style={{
                                fontSize: '0.69rem',
                                background: 'var(--input-bg)',
                                color: 'var(--text)',
                                border: '1px solid var(--border)',
                                borderRadius: 2,
                                padding: '1px 4px',
                                maxWidth: 140,
                                flex: 1,
                                minWidth: 80,
                              }}
                              title={boundFile ? `Current: ${boundFile.name}` : (autoMatch ? `Auto: ${autoMatch.name}` : 'Select a file to bind')}
                            >
                              <option value="">
                                {boundFile
                                  ? `✓ ${boundFile.name}`
                                  : autoMatch
                                  ? `auto: ${autoMatch.name}`
                                  : '-- Select file --'}
                              </option>
                              {candidateFiles.length === 0 ? (
                                <option value="" disabled>
                                  (no imported file defines this module)
                                </option>
                              ) : (
                                candidateFiles.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.name}
                                  </option>
                                ))
                              )}
                            </select>

                            {/* Show bound file path */}
                            {boundFile && (
                              <span
                                style={{
                                  fontSize: '0.62rem',
                                  color: 'var(--text-dim)',
                                  opacity: 0.6,
                                  width: '100%',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={boundFile.filePath || boundFile.name}
                              >
                                📂 {boundFile.filePath || boundFile.name}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Instantiated Modules section */}
                  {(() => {
                    const instMods = instantiatedModules.get(file.id) || [];
                    const instModsFiltered = instMods.filter(
                      (mod) => !file.definedModules?.includes(mod)
                    );
                    if (instModsFiltered.length === 0) return null;

                    return (
                      <div style={{ marginTop: (hasDefinedModules || hasMissingModules) ? 8 : 0 }}>
                        <div style={{ fontSize: '0.69rem', color: 'var(--warning)', marginBottom: 3, fontWeight: 600 }}>
                          Instantiated Modules
                        </div>
                        {instModsFiltered.map((mod) => {
                          const boundFileId = file.moduleBindings?.[mod];
                          const boundFile = boundFileId ? files.find((f) => f.id === boundFileId) : undefined;
                          const autoMatch = moduleToFile.get(mod);

                          // Filter dropdown: only show files that define this module
                          const candidateFiles = files.filter(
                            (f) => f.id !== file.id && f.definedModules?.includes(mod)
                          );

                          return (
                            <div
                              key={mod}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: '0.77rem',
                                marginBottom: 3,
                                padding: '2px 6px',
                                borderRadius: 3,
                                background: boundFile ? 'rgba(0, 200, 0, 0.05)' : 'rgba(255, 150, 0, 0.08)',
                                flexWrap: 'wrap',
                              }}
                            >
                              <code
                                style={{
                                  fontFamily: 'monospace',
                                  color: boundFile ? 'var(--success)' : 'var(--warning)',
                                  fontWeight: 600,
                                }}
                              >
                                {mod}
                              </code>
                              <span style={{ color: 'var(--text-dim)', fontSize: '0.69rem' }}>
                                {boundFile
                                  ? `→ ${boundFile.name}`
                                  : autoMatch
                                  ? `→ auto: ${autoMatch.name}`
                                  : '(unbound)'}
                              </span>
                              {boundFile?.filePath && boundFile.filePath !== boundFile.name && (
                                <span
                                  style={{
                                    color: 'var(--text-dim)',
                                    fontSize: '0.62rem',
                                    opacity: 0.6,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    maxWidth: 120,
                                  }}
                                  title={boundFile.filePath}
                                >
                                  ({boundFile.filePath})
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recompile button */}
      {files.some((f) => f.status === 'missing_deps') && (
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onRecompile}
            disabled={isCompiling}
            style={{
              width: '100%',
              padding: '6px 0',
              background: isCompiling ? 'var(--text-dim)' : 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: isCompiling ? 'default' : 'pointer',
              fontSize: '0.85rem',
              fontWeight: 500,
            }}
          >
            {isCompiling ? 'Compiling...' : 'Compile All'}
          </button>
        </div>
      )}
    </div>
  );
}