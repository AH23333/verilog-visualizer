import { useState, useCallback, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface TabBarProps {
  openFiles: string[];
  activeFileId: string | null;
  fileNameMap: Record<string, string>; // fileId -> display name
  dirtyMap: Record<string, boolean>;     // fileId -> has unsaved changes
  onSelectTab: (fileId: string) => void;
  onCloseTab: (fileId: string) => void;
  onReorderTabs: (fileIds: string[]) => void;
  /** Right-aligned actions area (VS Code-style editor toolbar living in the tab row) */
  rightSlot?: ReactNode;
}

export default function TabBar({
  openFiles,
  activeFileId,
  fileNameMap,
  dirtyMap,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  rightSlot,
}: TabBarProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragRef.current = index;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const fromIndex = dragRef.current;
    setDragIndex(null);
    setDragOverIndex(null);
    dragRef.current = null;

    if (fromIndex === null || fromIndex === dropIndex) return;

    const newOrder = [...openFiles];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(dropIndex, 0, moved);
    onReorderTabs(newOrder);
  }, [openFiles, onReorderTabs]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
    dragRef.current = null;
  }, []);

  if (openFiles.length === 0 && !rightSlot) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 40,
        background: 'var(--toolbar-bg)',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        userSelect: 'none',
      }}
    >
      {openFiles.map((fileId, index) => {
        const isActive = fileId === activeFileId;
        const name = fileNameMap[fileId] || fileId;
        const shortName = name.split('/').pop() || name;
        const isDirty = dirtyMap[fileId] || false;
        const isDragging = dragIndex === index;
        const isDragOver = dragOverIndex === index;

        return (
          <div
            key={fileId}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => onSelectTab(fileId)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onCloseTab(fileId);
              }
            }}
            title={name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 14px',
              height: '100%',
              cursor: 'pointer',
              background: isActive
                ? 'var(--bg)'
                : isDragOver
                ? 'var(--accent-muted)'
                : 'var(--surface)',
              borderRight: '1px solid var(--border-subtle)',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              opacity: isDragging ? 0.5 : 1,
              fontSize: 'var(--fs-lg)',
              color: isActive ? 'var(--text)' : 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              transition: 'background var(--transition-fast)',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLElement).style.background = 'var(--surface)';
              }
            }}
          >
            <span style={{ fontWeight: isActive ? 600 : 400 }}>
              {isDirty ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }} /> : ''}{shortName}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(fileId);
              }}
              title="Close"
              className="icon-btn"
              style={{ width: 18, height: 18, borderRadius: '50%', color: 'var(--text-muted)' }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      {rightSlot && (
        <div style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 10px', flexShrink: 0,
          position: 'sticky', right: 0, background: 'var(--toolbar-bg)',
        }}>{rightSlot}</div>
      )}
    </div>
  );
}