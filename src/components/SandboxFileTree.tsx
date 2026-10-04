// 沙盒文件树 —— **视觉与交互对齐编译模式 Sidebar.tsx**（R40）。
//
// R40 之前的差异（用户报告「侧边栏文件系统与编译模式不同」）：
//  - 图标：文本 ▸ / 纯文字 → 换 lucide（ChevronRight/Down、Folder/FolderOpen、FileText、Pencil）
//  - 选中样式：整行 accent 实心底 → 对齐 Sidebar 的 accent-muted 底 + 2px 左侧高亮条
//  - 悬停：没有 hover 反馈 → 补 surface-hover 背景 + 文字提亮
//  - 重命名：只能右键菜单 → 补 hover 出现的铅笔按钮（与 Sidebar 一致）
//  - 拖拽：只能拖文件、不能拖文件夹，且落点无视觉强调 → 补文件夹拖拽 +
//    accent-muted 落点高亮 + 根目录 2px 虚线投放区
//  - 缩进/行高/字号：与 Sidebar 统一（5px 10px、depth*14、--fs-md）
//
// 纯展示组件：数据与动作全部由 SandboxCanvas 注入。
import { useState, useRef } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Pencil, Check } from 'lucide-react';
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
  onFileContextMenu: (e: React.MouseEvent, f: SandboxFile) => void;
  onFolderContextMenu: (e: React.MouseEvent, path: string) => void;
  onRootContextMenu: (e: React.MouseEvent) => void;
  onMoveFiles: (ids: string[], folder: string) => void;
  onMoveFolder: (path: string, newPath: string) => void;
  onRenameCommit: (t: RenameTarget, name: string) => void;
  onRenameCancel: () => void;
  onCreateCommit: (t: CreateTarget, name: string) => void;
  onCreateCancel: () => void;
}

const DRAG_MIME = 'application/x-sandbox-fs';

interface FolderNode { name: string; path: string; children: Map<string, FolderNode>; files: SandboxFile[] }

/** 由文件 + 文件夹路径构建嵌套结构（与 Sidebar.buildFolderTree 同语义） */
function buildFolderTree(files: SandboxFile[], folders: string[]): FolderNode {
  const root: FolderNode = { name: '', path: '', children: new Map(), files: [] };
  for (const folderPath of folders) {
    const parts = folderPath.split('/');
    let cur = root;
    parts.forEach((part, i) => {
      if (!cur.children.has(part)) {
        cur.children.set(part, { name: part, path: parts.slice(0, i + 1).join('/'), children: new Map(), files: [] });
      }
      cur = cur.children.get(part)!;
    });
  }
  for (const file of files) {
    const parts = file.name.split('/');
    if (parts.length === 1) { root.files.push(file); continue; }
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!cur.children.has(part)) {
        cur.children.set(part, { name: part, path: parts.slice(0, i + 1).join('/'), children: new Map(), files: [] });
      }
      cur = cur.children.get(part)!;
    }
    cur.files.push(file);
  }
  return root;
}

/** 文件夹下所有后代文件 id（用于「全选打勾」） */
function folderFileIds(node: FolderNode, out: string[] = []): string[] {
  for (const f of node.files) out.push(f.id);
  for (const c of node.children.values()) folderFileIds(c, out);
  return out;
}

const rowBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '5px 10px', margin: '0 4px', borderRadius: 6,
  cursor: 'pointer', userSelect: 'none',
  transition: 'background 0.12s, color 0.12s',
  fontSize: 'var(--fs-md)',
};

export default function SandboxFileTree({
  files, folders, activeId, selectedIds, renaming, creating,
  onOpen, onSelectToggle, onFileContextMenu, onFolderContextMenu, onRootContextMenu,
  onMoveFiles, onMoveFolder, onRenameCommit, onRenameCancel, onCreateCommit, onCreateCancel,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const dragDepth = useRef(0);
  // 本地重命名输入（hover 铅笔按钮进入）
  const [localRename, setLocalRename] = useState<{ key: string; value: string } | null>(null);

  const root = buildFolderTree(files, folders);

  const toggleFolder = (path: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  const onDragStart = (e: React.DragEvent, ids: string[], type: 'files' | 'folder', path?: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type, ids, path }));
    e.dataTransfer.setData('text/plain', '');
  };

  const readDrop = (e: React.DragEvent) => {
    try {
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (d?.type === 'files' && Array.isArray(d.ids) && d.ids.length) return d;
      if (d?.type === 'folder' && d.path) return d;
      return null;
    } catch { return null; }
  };

  const applyDrop = (d: any, targetFolder: string) => {
    if (!d) return;
    if (d.type === 'files') onMoveFiles(d.ids, targetFolder);
    else if (d.type === 'folder' && d.path !== targetFolder) {
      const name = d.path.split('/').pop() || d.path;
      onMoveFolder(d.path, targetFolder ? `${targetFolder}/${name}` : name);
    }
  };

  const folderDragProps = (path: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDragOverFolder(path);
    },
    onDragLeave: () => setDragOverFolder((c) => (c === path ? null : c)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation();
      setDragOverFolder(null);
      applyDrop(readDrop(e), path);
    },
  });

  const onDragEnd = () => { setDragOverFolder(null); setDragOverRoot(false); dragDepth.current = 0; };

  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, background: 'var(--input-bg)', color: 'var(--text)',
    border: '1px solid var(--accent)', borderRadius: 2, padding: '1px 4px', fontSize: 'var(--fs-md)',
  };

  const fileRow = (f: SandboxFile, depth: number) => {
    const selected = selectedIds.has(f.id);
    const isActive = activeId === f.id;
    const isRenaming = (renaming?.kind === 'file' && renaming.key === f.id) || localRename?.key === f.id;
    return (
      <div key={f.id} data-sbfile={f.name} draggable={!isRenaming}
        onDragStart={(e) => onDragStart(e, selectedIds.has(f.id) ? Array.from(selectedIds) : [f.id], 'files')}
        onDragEnd={onDragEnd}
        onClick={(e) => { if (e.ctrlKey || e.metaKey) onSelectToggle(f.id, e); else onOpen(f); }}
        onContextMenu={(e) => { e.stopPropagation(); onFileContextMenu(e, f); }}
        className="sb-file-row"
        style={{
          ...rowBase,
          paddingLeft: 6 + depth * 14,
          background: isActive ? 'var(--accent-muted)' : selected ? 'var(--surface-hover)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
          color: isActive ? 'var(--text)' : 'var(--text-secondary)',
        }}>
        <span style={{ flexShrink: 0, display: 'inline-flex', color: 'var(--text-muted)' }}><FileText size={14} /></span>
        {isRenaming ? (
          <input
            autoFocus
            defaultValue={localRename?.key === f.id ? localRename.value : baseName(f.name)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { onRenameCommit({ kind: 'file', key: f.id }, (e.target as HTMLInputElement).value); setLocalRename(null); }
              if (e.key === 'Escape') { setLocalRename(null); onRenameCancel(); }
            }}
            onBlur={(e) => { onRenameCommit({ kind: 'file', key: f.id }, e.currentTarget.value); setLocalRename(null); }}
            style={inputStyle} />
        ) : (
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>
            {baseName(f.name)}
          </span>
        )}
        {!isRenaming && (
          <button
            onClick={(e) => { e.stopPropagation(); setLocalRename({ key: f.id, value: f.name }); }}
            title="重命名"
            className="sb-rename-btn"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', opacity: 0.5, flexShrink: 0, display: 'inline-flex' }}>
            <Pencil size={12} />
          </button>
        )}
      </div>
    );
  };

  const createInput = (depth: number) => (
    <div style={{ paddingLeft: 6 + depth * 14, paddingRight: 10 }}>
      <input
        autoFocus
        placeholder={creating!.kind === 'file' ? '新文件名.djs' : '新文件夹名'}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCreateCommit(creating!, (e.target as HTMLInputElement).value);
          if (e.key === 'Escape') onCreateCancel();
        }}
        onBlur={onCreateCancel}
        style={inputStyle} />
    </div>
  );

  const folderRows = (node: FolderNode, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    for (const child of node.children.values()) {
      const isCollapsed = collapsed.has(child.path);
      const isRenaming = (renaming?.kind === 'folder' && renaming.key === child.path) || localRename?.key === child.path;
      const dragOverThis = dragOverFolder === child.path;
      const allSelected = (() => { const ids = folderFileIds(child); return ids.length > 0 && ids.every((id) => selectedIds.has(id)); })();
      out.push(
        <div key={child.path}>
          <div
            data-sbfolder={child.path}
            draggable={!isRenaming}
            onDragStart={(e) => onDragStart(e, [], 'folder', child.path)}
            onDragEnd={onDragEnd}
            onClick={() => !isRenaming && toggleFolder(child.path)}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onFolderContextMenu(e, child.path); }}
            {...folderDragProps(child.path)}
            title={child.path}
            style={{
              ...rowBase,
              paddingLeft: 6 + depth * 14,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              background: dragOverThis ? 'var(--accent-muted)' : 'transparent',
              outline: dragOverThis ? '1px dashed var(--accent)' : 'none',
              outlineOffset: -1,
            }}>
            <span style={{ width: 14, display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)', flexShrink: 0 }}>
              {isCollapsed ? <Folder size={14} /> : <FolderOpen size={14} />}
            </span>
            {isRenaming ? (
              <input
                autoFocus
                defaultValue={localRename?.key === child.path ? localRename.value : child.name}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onRenameCommit({ kind: 'folder', key: child.path }, (e.target as HTMLInputElement).value); setLocalRename(null); }
                  if (e.key === 'Escape') { setLocalRename(null); onRenameCancel(); }
                }}
                onBlur={(e) => { onRenameCommit({ kind: 'folder', key: child.path }, e.currentTarget.value); setLocalRename(null); }}
                style={inputStyle} />
            ) : (
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.name}</span>
            )}
            {allSelected && <span style={{ color: 'var(--accent)', display: 'inline-flex', flexShrink: 0 }}><Check size={12} /></span>}
          </div>
          {!isCollapsed && (
            <>
              {creating?.folder === child.path && createInput(depth + 1)}
              {folderRows(child, depth + 1)}
              {child.files.slice().sort((a, b) => a.name.localeCompare(b.name)).map((f) => fileRow(f, depth + 1))}
            </>
          )}
        </div>
      );
    }
    return out;
  };

  const rootFiles = root.files.slice().sort((a, b) => a.name.localeCompare(b.name));
  const isEmpty = files.length === 0 && folders.length === 0;

  return (
    <div data-sandbox-filetree
      onContextMenu={(e) => { e.preventDefault(); onRootContextMenu(e); }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        dragDepth.current++; setDragOverRoot(true);
      }}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragOverRoot(false); }
      }}
      onDrop={(e) => {
        e.preventDefault(); setDragOverRoot(false); dragDepth.current = 0;
        applyDrop(readDrop(e), '');
      }}
      style={{
        flex: 1, overflow: 'auto', padding: '4px 0',
        background: dragOverRoot ? 'var(--accent-muted)' : 'transparent',
        outline: dragOverRoot ? '2px dashed var(--accent)' : 'none',
        outlineOffset: -2,
        transition: 'background 0.12s',
      }}>
      {creating?.folder === '' && createInput(0)}
      {folderRows(root, 0)}
      {rootFiles.map((f) => fileRow(f, 0))}
      {isEmpty && (
        <div data-sidebar-empty style={{ padding: 16, fontSize: 'var(--fs-md)', color: 'var(--text-muted)', textAlign: 'center' }}>
          暂无文件（右键空白处新建）
        </div>
      )}
      <div style={{ minHeight: 48 }} />
    </div>
  );
}
