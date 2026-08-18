import { useState, useMemo, useCallback, useRef } from 'react';
import type { FileEntry } from '../store/fileStore';

interface SidebarProps {
  files: FileEntry[];
  folders: string[];
  activeFileId: string | null;
  selectedIds: Set<string>;
  onSelectFile: (id: string) => void;
  onMultiSelect: (id: string, ctrl: boolean, shift: boolean) => void;
  onRenameFile: (id: string, name: string) => void;
  onImportFile: () => void;
  onContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
  onEmptyContextMenu: (e: React.MouseEvent) => void;
  onFolderContextMenu: (e: React.MouseEvent, folderPath: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onMoveFiles: (fileIds: string[], targetFolder: string) => void;
  onMoveFolder: (folderPath: string, targetFolder: string) => void;
}

interface FolderNode {
  name: string;
  path: string;
  children: Map<string, FolderNode>;
  files: FileEntry[];
}

function buildFolderTree(files: FileEntry[], folders: string[]): { root: FolderNode; flatFiles: FileEntry[] } {
  const root: FolderNode = { name: '', path: '', children: new Map(), files: [] };
  const flatFiles: FileEntry[] = [];

  // Add all tracked folders first
  for (const folderPath of folders) {
    const parts = folderPath.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.children.has(part)) {
        const subPath = parts.slice(0, i + 1).join('/');
        current.children.set(part, {
          name: part,
          path: subPath,
          children: new Map(),
          files: [],
        });
      }
      current = current.children.get(part)!;
    }
  }

  // Add files
  for (const file of files) {
    const parts = file.name.split('/');
    if (parts.length === 1) {
      root.files.push(file);
      flatFiles.push(file);
      continue;
    }

    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current.children.has(part)) {
        const folderPath = parts.slice(0, i + 1).join('/');
        current.children.set(part, {
          name: part,
          path: folderPath,
          children: new Map(),
          files: [],
        });
      }
      current = current.children.get(part)!;
    }
    current.files.push(file);
    flatFiles.push(file);
  }

  return { root, flatFiles };
}

/** Get all descendant file IDs of a folder */
function getFolderFileIds(node: FolderNode): string[] {
  const ids: string[] = [];
  for (const file of node.files) {
    ids.push(file.id);
  }
  for (const child of node.children.values()) {
    ids.push(...getFolderFileIds(child));
  }
  return ids;
}

export default function Sidebar({
  files,
  folders,
  activeFileId,
  selectedIds,
  onSelectFile,
  onMultiSelect,
  onRenameFile,
  onImportFile,
  onContextMenu,
  onEmptyContextMenu,
  onFolderContextMenu,
  collapsed,
  onToggleCollapse,
  onCreateFile,
  onCreateFolder,
  onMoveFiles,
  onMoveFolder,
}: SidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const dragCounter = useRef(0);

  const { root } = useMemo(
    () => buildFolderTree(files, folders),
    [files, folders]
  );

  const handleConfirmRename = () => {
    if (renamingId && renameValue.trim()) {
      onRenameFile(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const toggleFolder = (path: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // ============ Drag & Drop ============

  // Use ref to keep selectedIds stable across renders, avoiding drag handler churn
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const handleDragStart = useCallback(
    (e: React.DragEvent, fileId: string) => {
      const ids = selectedIdsRef.current;
      const dragIds = ids.has(fileId) ? Array.from(ids) : [fileId];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'files', ids: dragIds }));
      e.dataTransfer.setData('text/html', '');
    },
    [] // Stable — uses ref, no dependency on selectedIds
  );

  const handleFileDragStart = useCallback(
    (fileId: string) => (e: React.DragEvent) => handleDragStart(e, fileId),
    [handleDragStart]
  );

  const handleFolderDragStart = useCallback(
    (folderPath: string) => (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'folder', path: folderPath }));
      e.dataTransfer.setData('text/html', '');
    },
    []
  );

  const handleFolderDragOver = useCallback(
    (folderPath: string) => (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDragOverFolder(folderPath);
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setDragOverFolder(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragOverFolder(null);
    setDragOverRoot(false);
    dragCounter.current = 0;
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetFolder: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverFolder(null);
      setDragOverRoot(false);

      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.type === 'files') {
          onMoveFiles(data.ids, targetFolder);
        } else if (data.type === 'folder') {
          if (data.path === targetFolder) return;
          const folderName = data.path.split('/').pop() || data.path;
          const newPath = targetFolder ? targetFolder + '/' + folderName : folderName;
          onMoveFolder(data.path, newPath);
        }
      } catch {}
    },
    [onMoveFiles, onMoveFolder]
  );

  const handleRootDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragCounter.current++;
    setDragOverRoot(true);
  }, []);

  const handleRootDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOverRoot(false);
    }
  }, []);

  const handleRootDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverRoot(false);
      dragCounter.current = 0;

      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.type === 'files') {
          onMoveFiles(data.ids, '');
        } else if (data.type === 'folder') {
          const folderName = data.path.split('/').pop() || data.path;
          onMoveFolder(data.path, folderName);
        }
      } catch {}
    },
    [onMoveFiles, onMoveFolder]
  );

  // ============ Render ============

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => {
    const isCollapsed = collapsedFolders.has(node.path);
    const folderEntries = Array.from(node.children.values());
    const folderFileIds = getFolderFileIds(node);
    const allChildrenSelected = folderFileIds.length > 0 && folderFileIds.every((id) => selectedIds.has(id));
    const dragOverThis = dragOverFolder === node.path;

    return (
      <div key={node.path}>
        {/* Folder header */}
        {node.path && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: `3px 8px 3px ${8 + depth * 12}px`,
              cursor: 'pointer',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
              userSelect: 'none',
              transition: 'color var(--transition-fast)',
              background: dragOverThis ? 'var(--accent-muted)' : 'transparent',
              outline: dragOverThis ? '1px dashed var(--accent)' : 'none',
            }}
            onClick={() => toggleFolder(node.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onFolderContextMenu(e, node.path);
            }}
            onDragOver={handleFolderDragOver(node.path)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node.path)}
            draggable
            onDragStart={handleFolderDragStart(node.path)}
            onDragEnd={handleDragEnd}
            onMouseEnter={(e) => {
              if (!dragOverThis) {
                (e.currentTarget as HTMLElement).style.color = 'var(--text)';
              }
            }}
            onMouseLeave={(e) => {
              if (!dragOverThis) {
                (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
              }
            }}
          >
            <span style={{ marginRight: 4, fontSize: '0.62rem', width: 10, display: 'inline-block' }}>
              {isCollapsed ? '▸' : '▾'}
            </span>
            <span style={{ marginRight: 4 }}>{isCollapsed ? '📁' : '📂'}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.name}
            </span>
            {allChildrenSelected && (
              <span style={{ fontSize: '0.65rem', color: 'var(--accent)', marginLeft: 4 }}>✓</span>
            )}
          </div>
        )}

        {/* Folder children (if not collapsed) */}
        {(!node.path || !isCollapsed) && (
          <>
            {folderEntries.map((child) => renderFolder(child, depth + 1))}
            {node.files.map((file) => renderFileEntry(file, depth + (node.path ? 1 : 0)))}
          </>
        )}
      </div>
    );
  };

  const renderFileEntry = (file: FileEntry, depth: number): React.ReactNode => {
    const isActive = file.id === activeFileId;
    const isSelected = selectedIds.has(file.id);
    const displayName = file.name.split('/').pop() || file.name;
    const isRenaming = renamingId === file.id;

    const statusColor =
      file.status === 'compiled' ? 'var(--success)' :
      file.status === 'missing_deps' ? 'var(--warning)' :
      file.status === 'error' ? 'var(--danger)' : 'var(--text-dim)';

    return (
      <div
        key={file.id}
        onClick={(e) => {
          onMultiSelect(file.id, e.ctrlKey || e.metaKey, e.shiftKey);
        }}
        onContextMenu={(e) => {
          // If not already selected, select this file before showing context menu
          if (!selectedIds.has(file.id)) {
            onSelectFile(file.id);
          }
          onContextMenu(e, file);
        }}
        draggable
        onDragStart={handleFileDragStart(file.id)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          e.preventDefault();
          try {
            const raw = e.dataTransfer.getData('text/plain');
            if (!raw) return;
            const data = JSON.parse(raw);
            const parentFolder = file.name.includes('/')
              ? file.name.split('/').slice(0, -1).join('/')
              : '';
            if (data.type === 'files') {
              onMoveFiles(data.ids, parentFolder);
            } else if (data.type === 'folder') {
              const folderName = data.path.split('/').pop() || data.path;
              const newPath = parentFolder ? parentFolder + '/' + folderName : folderName;
              onMoveFolder(data.path, newPath);
            }
          } catch {}
        }}
        style={{
          padding: `3px 8px 3px ${8 + depth * 12}px`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: isActive
            ? 'var(--accent-muted)'
            : isSelected
            ? 'var(--surface-hover)'
            : 'transparent',
          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
          fontSize: '0.82rem',
          color: isActive ? 'var(--text)' : 'var(--text-secondary)',
          userSelect: 'none',
          transition: 'background var(--transition-fast), color var(--transition-fast)',
        }}
        onMouseEnter={(e) => {
          if (!isActive && !isSelected) {
            (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
            (e.currentTarget as HTMLElement).style.color = 'var(--text)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive && !isSelected) {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
          }
        }}
      >
        {/* Status dot */}
        <div
          style={{
            width: 5, height: 5, borderRadius: '50%',
            background: statusColor, flexShrink: 0,
          }}
        />
        {/* File icon */}
        <span style={{ flexShrink: 0 }}>📄</span>
        {/* File name */}
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleConfirmRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirmRename();
              if (e.key === 'Escape') setRenamingId(null);
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              background: 'var(--input-bg)',
              color: 'var(--text)',
              border: '1px solid var(--accent)',
              borderRadius: 2,
              padding: '1px 4px',
              fontSize: '0.85rem',
            }}
          />
        ) : (
          <span
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={file.name}
          >
            {displayName}
          </span>
        )}
        {/* Rename button on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setRenamingId(file.id);
            setRenameValue(file.name);
          }}
          title="Rename"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: '0.69rem',
            padding: '0 2px',
            opacity: 0.5,
            flexShrink: 0,
          }}
        >
          ✎
        </button>
      </div>
    );
  };

  if (collapsed) {
    return (
      <div
        style={{
          width: 36,
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--border-subtle)',
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
        width: '100%',
        height: '100%',
        background: 'var(--sidebar-bg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          flexShrink: 0,
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
            onClick={onCreateFile}
            title="New file"
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
            📄
          </button>
          <button
            onClick={onCreateFolder}
            title="New folder"
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
            📁
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
            −
          </button>
        </div>
      </div>

      {/* File tree */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '4px 0',
          background: dragOverRoot ? 'var(--accent-muted)' : 'transparent',
          outline: dragOverRoot ? '2px dashed var(--accent)' : 'none',
          outlineOffset: -2,
        }}
        onContextMenu={(e) => {
          // Only trigger empty-area menu if clicking on the container itself
          const target = e.target as HTMLElement;
          if (target === e.currentTarget || target.closest('[data-sidebar-empty]')) {
            e.preventDefault();
            onEmptyContextMenu(e);
          }
        }}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {files.length === 0 && folders.length === 0 ? (
          <div
            data-sidebar-empty
            style={{
              padding: 16,
              fontSize: '0.82rem',
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            No files imported
          </div>
        ) : (
          <>
            {Array.from(root.children.values()).map((child) => renderFolder(child, 0))}
            {root.files.map((file) => renderFileEntry(file, 0))}
          </>
        )}
      </div>
    </div>
  );
}