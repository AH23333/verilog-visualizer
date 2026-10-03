// 沙盒文件树：与 IDE Sidebar 语义对齐的紧凑版（文件夹 + 多选 + 拖拽移动 + 右键菜单）。
// 纯展示组件：数据与动作全部由 SandboxCanvas 注入。
import { useState } from 'react';
import type { SandboxFile } from '../store/sandboxStore';
import { baseName } from '../store/sandboxStore';

export type TreeNode =
  | { type: 'file'; id: string }
  | { type: 'folder'; path: string }
  | { type: 'root' };

export interface RenameTarget { kind: 'file' | 'folder'; key: string }
export interface CreateTarget { kind: 'file' | 'folder'; folder: string }

interface Props {
  files: SandboxFile[];
  folders: string[];
  activeId: string | null;
  selectedIds: Set<string>;
  renaming: RenameTarget | null;
  creating: CreateTarget | null;
  onOpen: (f: SandboxFile) => void;
  onSelectToggle: (id: string, e: React.MouseEvent) => void;
  onFileContextMenu: (e: React.MouseEvent, file: SandboxFile) => void;
  onFolderContextMenu: (e: React.MouseEvent, path: string) => void;
  onRootContextMenu: (e: React.MouseEvent) => void;
  onMoveFiles: (ids: string[], folder: string) => void;
  onRenameCommit: (t: RenameTarget, name: string) => void;
  onRenameCancel: () => void;
  onCreateCommit: (t: CreateTarget, name: string) => void;
  onCreateCancel: () => void;
}

const DRAG_MIME = 'application/x-sandbox-files';

interface FolderNode { path: string; name: string; children: FolderNode[] }

/** 由文件夹路径列表构建嵌套结构 */
function buildFolderTree(folders: string[]): FolderNode[] {
  const roots: FolderNode[] = [];
  const map = new Map<string, FolderNode>();
  const sorted = [...folders].sort();
  for (const path of sorted) {
    const node: FolderNode = { path, name: baseName(path), children: [] };
    map.set(path, node);
    const parent = path.includes('/') ? map.get(path.slice(0, path.lastIndexOf('/'))) : null;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

export default function SandboxFileTree({
  files, folders, activeId, selectedIds, renaming, creating,
  onOpen, onSelectToggle, onFileContextMenu, onFolderContextMenu, onRootContextMenu,
  onMoveFiles, onRenameCommit, onRenameCancel, onCreateCommit, onCreateCancel,
}: Props) {
  // 折叠状态是纯视图状态，放组件内部
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<string | null>(null);
  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const rowStyle: React.CSSProperties = {
    padding: '3px 6px', cursor: 'pointer', borderRadius: 3,
    fontSize: 'var(--fs-xs)', marginBottom: 1,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  };

  const dragProps = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setDragOver(folder); }
    },
    onDragLeave: () => setDragOver((cur) => (cur === folder ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation();
      setDragOver(null);
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      try {
        const ids = JSON.parse(raw) as string[];
        if (Array.isArray(ids) && ids.length) onMoveFiles(ids, folder);
      } catch { /* ignore */ }
    },
  });

  const fileRow = (f: SandboxFile, depth: number) => {
    const selected = selectedIds.has(f.id);
    const isActive = activeId === f.id;
    const isRenaming = renaming?.kind === 'file' && renaming.key === f.id;
    return (
      <div key={f.id} draggable={!isRenaming} data-sbfile={f.name}
        onDragStart={(e) => {
          const ids = selectedIds.has(f.id) ? Array.from(selectedIds) : [f.id];
          e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={(e) => { if (e.ctrlKey || e.metaKey) onSelectToggle(f.id, e); else onOpen(f); }}
        onContextMenu={(e) => { e.stopPropagation(); onFileContextMenu(e, f); }}
        style={{
          ...rowStyle, marginLeft: depth * 12,
          background: isActive ? 'var(--accent)' : selected ? 'var(--surface-hover)' : 'transparent',
          color: isActive ? '#fff' : 'var(--text)',
          outline: dragOver === f.id ? '1px dashed var(--accent)' : undefined,
        }}>
        {isRenaming ? (
          <input autoFocus defaultValue={f.name}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameCommit({ kind: 'file', key: f.id }, (e.target as HTMLInputElement).value);
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={(e) => onRenameCommit({ kind: 'file', key: f.id }, e.currentTarget.value)}
            style={{ flex: 1, minWidth: 0, padding: '1px 4px', fontSize: 'var(--fs-xs)',
              background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--accent)', borderRadius: 3 }} />
        ) : (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{baseName(f.name)}</span>
        )}
      </div>
    );
  };

  const folderRows = (nodes: FolderNode[], depth: number): React.ReactNode[] =>
    nodes.map((node) => {
      const isOpen = !collapsed.has(node.path);
      const isRenaming = renaming?.kind === 'folder' && renaming.key === node.path;
      const isCreating = creating && creating.folder === node.path;
      const childFiles = files.filter((f) => f.name.startsWith(node.path + '/'));
      return (
        <div key={node.path}>
          <div
            {...dragProps(node.path)}
            data-sbfolder={node.path}
            onClick={() => toggleFolder(node.path)}
            onContextMenu={(e) => { e.stopPropagation(); onFolderContextMenu(e, node.path); }}
            style={{
              ...rowStyle, marginLeft: depth * 12,
              fontWeight: 600,
              color: 'var(--text-muted)',
              background: dragOver === node.path ? 'var(--surface-hover)' : 'transparent',
              outline: dragOver === node.path ? '1px dashed var(--accent)' : undefined,
            }}
            title={node.path}>
            {isRenaming ? (
              <input autoFocus defaultValue={baseName(node.path)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRenameCommit({ kind: 'folder', key: node.path }, (e.target as HTMLInputElement).value);
                  if (e.key === 'Escape') onRenameCancel();
                }}
                onBlur={(e) => onRenameCommit({ kind: 'folder', key: node.path }, e.currentTarget.value)}
                style={{ flex: 1, minWidth: 0, padding: '1px 4px', fontSize: 'var(--fs-xs)',
                  background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--accent)', borderRadius: 3 }} />
            ) : (
              <>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-block', width: 10, fontSize: '0.5625rem',
                    transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
                  {' '}{node.name}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.5625rem' }}>{childFiles.length || ''}</span>
              </>
            )}
          </div>
          {isOpen && (
            <>
              {isCreating && creating && (
                <div style={{ marginLeft: (depth + 1) * 12, padding: '2px 6px' }}>
                  <input autoFocus
                    placeholder={creating.kind === 'file' ? '新文件名.djs' : '新文件夹名'}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onCreateCommit(creating, (e.target as HTMLInputElement).value);
                      if (e.key === 'Escape') onCreateCancel();
                    }}
                    onBlur={onCreateCancel}
                    style={{ width: '100%', padding: '1px 4px', fontSize: 'var(--fs-xs)',
                      background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--accent)', borderRadius: 3 }} />
                </div>
              )}
              {folderRows(node.children, depth + 1)}
              {files
                .filter((f) => {
                  const parent = f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/')) : '';
                  return parent === node.path;
                })
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((f) => fileRow(f, depth + 1))}
            </>
          )}
        </div>
      );
    });

  const rootFiles = files
    .filter((f) => !f.name.includes('/'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rootTree = buildFolderTree(folders.filter((p) => !p.includes('/')));

  return (
    <div
      {...dragProps('')}
      data-sandbox-filetree
      onContextMenu={(e) => onRootContextMenu(e)}>
      {creating && creating.folder === '' && (
        <div style={{ padding: '2px 6px', marginBottom: 2 }}>
          <input autoFocus
            placeholder={creating.kind === 'file' ? '新文件名.djs' : '新文件夹名'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCreateCommit(creating, (e.target as HTMLInputElement).value);
              if (e.key === 'Escape') onCreateCancel();
            }}
            onBlur={onCreateCancel}
            style={{ width: '100%', padding: '1px 4px', fontSize: 'var(--fs-xs)',
              background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--accent)', borderRadius: 3 }} />
        </div>
      )}
      {folderRows(rootTree, 0)}
      {rootFiles.map((f) => fileRow(f, 0))}
      {folders.length === 0 && rootFiles.length === 0 && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', padding: '4px 0' }}>暂无文件</div>
      )}
      {/* 底部留白：给「右键空白处新建 / 粘贴」一个足够大的落点区域 */}
      <div style={{ minHeight: 56 }} />
    </div>
  );
}
