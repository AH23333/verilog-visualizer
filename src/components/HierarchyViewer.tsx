// Hierarchy viewer - shows module dependency tree with proper tree lines
import { ChevronDown, Circle } from 'lucide-react';

import { useMemo } from 'react';
import type { FileEntry } from '../store/fileStore';
import { parseVerilogInstances } from '../lib/verilog';

interface HierarchyViewerProps {
  files: FileEntry[];
  targetFileId: string | null;
  onSelectFile: (fileId: string) => void;
  theme: 'dark' | 'light';
}

interface ModuleNode {
  name: string;
  fileId: string;
  fileName: string;
  instances: ModuleNode[];
}

export default function HierarchyViewer({ files, targetFileId, onSelectFile, theme }: HierarchyViewerProps) {
  const hierarchy = useMemo(() => {
    if (!targetFileId) return null;

    const targetFile = files.find((f) => f.id === targetFileId);
    if (!targetFile) return null;

    const moduleToFile = new Map<string, FileEntry>();
    for (const f of files) {
      if (f.definedModules) {
        for (const mod of f.definedModules) {
          moduleToFile.set(mod, f);
        }
      }
    }

    const visited = new Set<string>();

    function buildNode(fileId: string): ModuleNode | null {
      const file = files.find((f) => f.id === fileId);
      if (!file) return null;

      const moduleName = file.definedModules?.[0] || file.name;
      if (visited.has(fileId)) return null;
      visited.add(fileId);

      const instances = parseVerilogInstances(file.content);
      const children: ModuleNode[] = [];

      for (const instName of instances) {
        const boundFileId = file.moduleBindings?.[instName];
        if (boundFileId) {
          const child = buildNode(boundFileId);
          if (child) children.push(child);
          continue;
        }

        const definingFile = moduleToFile.get(instName);
        if (definingFile) {
          const child = buildNode(definingFile.id);
          if (child) children.push(child);
        }
      }

      return {
        name: moduleName,
        fileId: file.id,
        fileName: file.name,
        instances: children,
      };
    }

    return buildNode(targetFileId);
  }, [files, targetFileId]);

  const allModules = useMemo(() => {
    const moduleToFile = new Map<string, FileEntry>();
    const moduleInstances = new Map<string, string[]>();

    for (const f of files) {
      if (f.definedModules) {
        for (const mod of f.definedModules) {
          moduleToFile.set(mod, f);
        }
      }
    }

    for (const f of files) {
      const instances = parseVerilogInstances(f.content);
      if (f.definedModules) {
        for (const mod of f.definedModules) {
          moduleInstances.set(mod, instances);
        }
      }
    }

    return { moduleToFile, moduleInstances };
  }, [files]);

  const isDark = theme === 'dark';

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--sidebar-bg)', color: 'var(--text)',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-secondary)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>
        层次结构
      </div>

      {/* Tree view */}
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
        {hierarchy ? (
          <div style={{ paddingLeft: 8 }}>
            <TreeNode
              node={hierarchy}
              onSelectFile={onSelectFile}
              activeFileId={targetFileId}
              isDark={isDark}
              isLast
            />
          </div>
        ) : (
          <div style={{ padding: '16px 14px', fontSize: 'var(--fs-md)', color: 'var(--text-muted)' }}>
            {targetFileId
              ? 'No module hierarchy found for this file.'
              : 'Select a file to view its module hierarchy.'}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid var(--border-subtle)',
        padding: '8px 14px',
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-muted)',
      }}>
        {allModules.moduleToFile.size} module{allModules.moduleToFile.size !== 1 ? 's' : ''} across {files.length} file{files.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

// ---- Tree line colors ----
const lineColor = 'var(--border)';

function TreeNode({
  node,
  onSelectFile,
  activeFileId,
  isDark,
  isLast = false,
  prevLines = [],
}: {
  node: ModuleNode;
  onSelectFile: (fileId: string) => void;
  activeFileId: string | null;
  isDark: boolean;
  isLast?: boolean;
  prevLines?: boolean[]; // which ancestor levels should continue vertical line
}) {
  const isActive = node.fileId === activeFileId;
  const hasChildren = node.instances.length > 0;
  const indent = prevLines.length;

  return (
    <div>
      {/* Current node row */}
      <div
        onClick={() => onSelectFile(node.fileId)}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 28,
          cursor: 'pointer',
          fontSize: 'var(--fs-md)',
          background: isActive ? 'var(--accent-muted)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
          borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          transition: 'background 0.1s',
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
        }}
        onMouseLeave={(e) => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
        title={`${node.name} — ${node.fileName}`}
      >
        {/* Tree line guides */}
        {indent > 0 && (
          <div style={{ position: 'relative', width: indent * 16, height: 28, flexShrink: 0 }}>
            {prevLines.map((showLine, i) =>
              showLine ? (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: i * 16 + 7,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: lineColor,
                  }}
                />
              ) : null
            )}
            {/* Horizontal connector */}
            <div
              style={{
                position: 'absolute',
                left: (indent - 1) * 16 + 7,
                top: '50%',
                width: 10,
                height: 1,
                background: lineColor,
              }}
            />
            {/* Vertical connector (half) */}
            <div
              style={{
                position: 'absolute',
                left: (indent - 1) * 16 + 7,
                top: 0,
                bottom: isLast ? '50%' : 0,
                width: 1,
                background: lineColor,
              }}
            />
          </div>
        )}

        {/* Expand/collapse icon */}
        <span style={{
          width: 16, textAlign: 'center', flexShrink: 0,
          color: hasChildren ? 'var(--text-secondary)' : 'var(--text-muted)',
          display: 'inline-flex', alignItems: 'center',
        }}>
          {hasChildren ? <ChevronDown size={12} /> : <Circle size={12} />}
        </span>

        {/* Module icon */}
        <span style={{
          color: isDark ? '#d2a8ff' : '#8250df',
          fontWeight: 500,
          marginRight: 6,
          flexShrink: 0,
        }}>
          M
        </span>

        {/* Module name */}
        <span style={{
          fontWeight: isActive ? 600 : 400,
          color: isActive ? 'var(--accent)' : 'var(--text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {node.name}
        </span>

        {/* File name hint */}
        <span style={{
          marginLeft: 8,
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {node.fileName}
        </span>
      </div>

      {/* Children */}
      {node.instances.length > 0 && (
        <div>
          {node.instances.map((child, i) => (
            <TreeNode
              key={child.fileId}
              node={child}
              onSelectFile={onSelectFile}
              activeFileId={activeFileId}
              isDark={isDark}
              isLast={i === node.instances.length - 1}
              prevLines={[...prevLines, !isLast]}
            />
          ))}
        </div>
      )}
    </div>
  );
}