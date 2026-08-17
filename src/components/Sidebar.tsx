import { useState } from 'react';
import type { FileEntry } from '../store/fileStore';

interface SidebarProps {
  files: FileEntry[];
  activeFileId: string | null;
  onSelectFile: (id: string) => void;
  onRenameFile: (id: string, name: string) => void;
  onImportFile: () => void;
  onContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({
  files,
  activeFileId,
  onSelectFile,
  onRenameFile,
  onImportFile,
  onContextMenu,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleConfirmRename = () => {
    if (renamingId && renameValue.trim()) {
      onRenameFile(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (collapsed) {
    return (
      <div
        style={{
          width: 36,
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 8,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onToggleCollapse}
          title="Expand sidebar"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: '1rem',
            padding: 4,
          }}
        >
          ▸
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        width: 240,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          fontSize: '0.85rem',
          fontWeight: 600,
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        <span>Files</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={onImportFile}
            title="Import file"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: '1.08rem',
              padding: '2px 6px',
              borderRadius: 3,
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--menu-hover)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
          >
            +
          </button>
          <button
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: '1.08rem',
              padding: '2px 6px',
              borderRadius: 3,
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--menu-hover)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
          >
            ◂
          </button>
        </div>
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {files.length === 0 ? (
          <div style={{ padding: '16px 12px', color: 'var(--text-dim)', fontSize: '0.92rem', textAlign: 'center' }}>
            No files imported yet.
            <br />
            <button
              onClick={onImportFile}
              style={{
                marginTop: 8,
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 12px',
                cursor: 'pointer',
                fontSize: '0.92rem',
              }}
            >
              Import .v File
            </button>
          </div>
        ) : (
          files.map((file) => (
            <div
              key={file.id}
              onClick={() => onSelectFile(file.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(e, file);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 12px',
                cursor: 'pointer',
                background: file.id === activeFileId ? 'var(--menu-hover)' : 'transparent',
                borderLeft: file.id === activeFileId ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => {
                if (file.id !== activeFileId) {
                  (e.currentTarget as HTMLElement).style.background = 'var(--menu-hover)';
                }
              }}
              onMouseLeave={(e) => {
                if (file.id !== activeFileId) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                }
              }}
            >
              <div style={{ overflow: 'hidden', flex: 1 }}>
                {renamingId === file.id ? (
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={handleConfirmRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirmRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      background: 'var(--input-bg)',
                      color: 'var(--text)',
                      border: '1px solid var(--accent)',
                      borderRadius: 3,
                      padding: '2px 6px',
                      fontSize: '0.92rem',
                      outline: 'none',
                    }}
                  />
                ) : (
                  <>
                    <div
                      style={{
                        fontSize: '1rem',
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {file.name}
                    </div>
                    <div style={{ fontSize: '0.77rem', color: 'var(--text-dim)', marginTop: 1 }}>
                      {file.status === 'compiled' ? 'Compiled' : file.status === 'error' ? 'Error' : 'Pending'}
                      {' · '}
                      {formatDate(file.importedAt)}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}