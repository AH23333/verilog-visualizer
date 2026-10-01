import { useState, useEffect, useRef, useCallback } from 'react';
import { sandboxStore, type SandboxFile } from '../store/sandboxStore';

interface Props {
  theme: 'dark' | 'light';
}

const GATE_TYPES = ['And', 'Or', 'Not', 'Xor', 'Nand', 'Nor', 'Xnor'];
const IO_TYPES = ['Button', 'Clock', 'Lamp'];

function SandboxCanvas({ theme }: Props) {
  const circuitRef = useRef<any>(null);
  const paperRef = useRef<any>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [files, setFiles] = useState<SandboxFile[]>([]);
  const [activeFile, setActiveFile] = useState<SandboxFile | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  const refreshList = useCallback(() => {
    setFiles(sandboxStore.list());
  }, []);

  // Create a cell by type at given position (shared by placement + load)
  const spawnCell = useCallback((type: string, x: number, y: number) => {
    const paper = paperRef.current;
    if (!paper) return null;
    const digitaljs = (window as any).digitaljs;
    const CellClass = digitaljs?.cells?.[type];
    if (!CellClass) return null;
    try {
      const cell = new CellClass({ type, position: { x, y }, bits: 1, size: { width: 60, height: 32 } });
      paper.model.addCell(cell);
      return cell;
    } catch { return null; }
  }, []);

  const doAddCell = useCallback((type: string) => {
    const cx = 100 + Math.round(Math.random() * 200);
    const cy = 100 + Math.round(Math.random() * 200);
    spawnCell(type, cx, cy);
  }, [spawnCell]);

  // Load file list on mount
  useEffect(() => {
    refreshList();
    const activeId = sandboxStore.getActiveId();
    if (activeId) {
      const f = sandboxStore.get(activeId);
      if (f) setActiveFile(f);
    }
  }, [refreshList]);

  // (Re)build paper when active file changes
  useEffect(() => {
    if (!activeFile) return;
    const wrapper = document.querySelector('[data-sandbox-wrapper]') as HTMLElement;
    if (!wrapper) return;
    const digitaljs = (window as any).digitaljs;

    if (circuitRef.current) {
      try { circuitRef.current.stop(); } catch {}
      paperRef.current?.remove();
    }

    const circuit = new digitaljs.Circuit({ devices: {}, connectors: [], subcircuits: {} }, { layoutEngine: false });
    circuitRef.current = circuit;
    const paper = circuit.displayOn(wrapper);
    paperRef.current = paper;
    paper.options.interactive = false;
    paper.off('render:done');
    paper.scale(1);
    paper.translate(0, 0);

    // Load saved cells + links
    if (activeFile.graphJson && activeFile.graphJson !== JSON.stringify({ cells: [] })) {
      try {
        const saved = JSON.parse(activeFile.graphJson);
        const cellMap = new Map<string, any>();
        // First pass: re-instantiate all cells
        for (const c of saved.cells || []) {
          if (c.isLink) continue;
          const pos = c.position || { x: 50, y: 50 };
          const cell = spawnCell(c.type, pos.x || 50, pos.y || 50);
          if (cell && c.id) {
            cell.set('id', c.id);
            cellMap.set(c.id, cell);
          }
        }
        // Second pass: rebuild links
        for (const c of saved.cells || []) {
          if (!c.isLink) continue;
          try {
            const src = c.source, tgt = c.target;
            const srcCell = cellMap.get(src?.id);
            const tgtCell = cellMap.get(tgt?.id);
            if (!srcCell || !tgtCell) continue;
            const link = new digitaljs.cells.Link({
              source: { id: srcCell.id, port: src.port },
              target: { id: tgtCell.id, port: tgt.port },
              signal: 'x',
            });
            paper.model.addCell(link);
          } catch { /* skip broken link */ }
        }
      } catch { /* corrupted save — start fresh */ }
    }

    // Click on empty canvas → deselect
    paper.on('blank:pointerdown', () => {
      if (selectedIdRef.current) {
        const prev = paper.model.getCell(selectedIdRef.current);
        prev?.attr('body/stroke', null);
        selectedIdRef.current = null;
        forceUpdate(n => n + 1);
      }
    });

    // Cell interaction: magnet→wire, else drag+select
    paper.on('cell:pointerdown', (cellView: any, evt: any) => {
      if (typeof cellView.model.isLink === 'function' && cellView.model.isLink()) return;
      const magnet = evt.target?.closest?.('[magnet]');
      const isMagnet = magnet && magnet.getAttribute('magnet') !== 'false';

      if (isMagnet) {
        // Start wiring
        evt.stopPropagation();
        evt.preventDefault();
        const sourceCell = cellView.model;
        const sourcePort = magnet.getAttribute('port');
        // Convert client coords to paper coords
        const rect = wrapper.getBoundingClientRect();
        const sx = evt.clientX - rect.left;
        const sy = evt.clientY - rect.top;
        // Create a temp link from source cell port to cursor
        const tempLink = new digitaljs.cells.Link({
          source: { id: sourceCell.id, port: sourcePort },
          target: { x: sx, y: sy },
          signal: 'x',
        });
        paper.model.addCell(tempLink);
        const onMove = (e: MouseEvent) => {
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          tempLink.set('target', { x: mx, y: my });
        };
        const onUp = (e: MouseEvent) => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          // Check if mouseup landed on another magnet
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const targetMagnet = el?.closest?.('[magnet]');
          if (targetMagnet && targetMagnet.getAttribute('magnet') !== 'false') {
            const targetCellEl = targetMagnet.closest('[model-id]');
            const targetId = targetCellEl?.getAttribute('model-id');
            const targetPort = targetMagnet.getAttribute('port');
            if (targetId && targetId !== sourceCell.id && targetPort) {
              tempLink.set('target', { id: targetId, port: targetPort });
              return; // keep the link
            }
          }
          // Drop: remove temp link
          tempLink.remove();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return;
      }

      // Not a magnet → drag + select
      evt.stopPropagation();
      evt.preventDefault();

      // Select this cell
      if (selectedIdRef.current && selectedIdRef.current !== cellView.model.id) {
        const prev = paper.model.getCell(selectedIdRef.current);
        prev?.attr('body/stroke', null);
      }
      selectedIdRef.current = cellView.model.id;
      cellView.model.attr('body/stroke', 'var(--accent)');
      cellView.model.attr('body/stroke-width', 2);
      forceUpdate(n => n + 1);

      // Drag
      const origPos = cellView.model.position();
      const startX = evt.clientX, startY = evt.clientY;
      const onMove = (e: MouseEvent) => {
        cellView.model.set('position', {
          x: origPos.x + (e.clientX - startX),
          y: origPos.y + (e.clientY - startY),
        });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Delete key
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (!selectedIdRef.current) return;
      const cell = paper.model.getCell(selectedIdRef.current);
      if (cell) cell.remove();
      selectedIdRef.current = null;
      forceUpdate(n => n + 1);
    };
    document.addEventListener('keydown', onKey);

    const resize = () => {
      const parent = wrapper.parentElement!;
      paper.setDimensions(parent.clientWidth, parent.clientHeight);
    };
    resize();
    requestAnimationFrame(resize);
    const ro = new ResizeObserver(resize);
    ro.observe(wrapper.parentElement!);

    wrapper.style.backgroundColor = theme === 'dark' ? 'var(--surface)' : '#ffffff';

    return () => {
      document.removeEventListener('keydown', onKey);
      ro.disconnect();
      try { circuit.stop(); } catch {}
      paper.remove();
    };
  }, [activeFile?.id, theme, spawnCell]);

  const handleNew = () => {
    let n = files.length + 1;
    let name = `circuit_${n}.djs`;
    while (files.some(f => f.name === name)) { n++; name = `circuit_${n}.djs`; }
    const f = sandboxStore.create(name);
    sandboxStore.setActiveId(f.id);
    setActiveFile(f);
    refreshList();
  };

  const handleOpen = (f: SandboxFile) => {
    if (activeFile && paperRef.current) {
      sandboxStore.save(activeFile.id, JSON.stringify(paperRef.current.model.toJSON()));
    }
    sandboxStore.setActiveId(f.id);
    setActiveFile(f);
    setConfirmDeleteId(null);
  };

  const handleSave = () => {
    if (!activeFile || !paperRef.current) return;
    sandboxStore.save(activeFile.id, JSON.stringify(paperRef.current.model.toJSON()));
    refreshList();
    forceUpdate(n => n + 1);
  };

  const handleDelete = (f: SandboxFile) => {
    if (confirmDeleteId !== f.id) {
      setConfirmDeleteId(f.id);
      return;
    }
    sandboxStore.remove(f.id);
    if (activeFile?.id === f.id) setActiveFile(null);
    setConfirmDeleteId(null);
    refreshList();
  };

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      <div style={{
        width: 180, borderRight: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        background: 'var(--surface)',
      }}>
        <div style={{ padding: 8, borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontWeight: 600 }}>FILES</span>
            <button onClick={handleNew} title="New file"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 3,
                width: 20, height: 20, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>+</button>
          </div>
          {files.map(f => (
            <div key={f.id}
              onClick={() => handleOpen(f)}
              style={{
                padding: '3px 6px', cursor: 'pointer', borderRadius: 3,
                background: activeFile?.id === f.id ? 'var(--accent)' : 'transparent',
                color: activeFile?.id === f.id ? '#fff' : 'var(--text)',
                fontSize: 'var(--fs-xs)', marginBottom: 1,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span
                onClick={(e) => { e.stopPropagation(); handleDelete(f); }}
                style={{
                  cursor: 'pointer', marginLeft: 4,
                  color: confirmDeleteId === f.id ? 'var(--error, #ef4444)' : undefined,
                  fontWeight: confirmDeleteId === f.id ? 700 : 400,
                }}>
                {confirmDeleteId === f.id ? '?' : '×'}
              </span>
            </div>
          ))}
          {files.length === 0 && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', padding: '4px 0' }}>No files yet</div>
          )}
        </div>

        <div style={{ padding: 8, overflowY: 'auto', flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>GATES</div>
          {GATE_TYPES.map(t => (
            <button key={t} onClick={() => doAddCell(t)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '3px 6px',
                marginBottom: 1, fontSize: 'var(--fs-xs)', background: 'transparent',
                border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
              {t}</button>
          ))}
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '6px 0 4px', fontWeight: 600 }}>IO</div>
          {IO_TYPES.map(t => (
            <button key={t} onClick={() => doAddCell(t)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '3px 6px',
                marginBottom: 1, fontSize: 'var(--fs-xs)', background: 'transparent',
                border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
              {t}</button>
          ))}
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '8px 0 4px', fontWeight: 600 }}>TIPS</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            · 拖 port 圆点连线<br/>
            · 单击选中，Delete 删除<br/>
            · 拖 body 移动
          </div>
        </div>

        <div style={{ padding: 8, borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={handleSave} disabled={!activeFile}
            style={{ width: '100%', padding: '6px', background: activeFile ? 'var(--accent)' : 'var(--border)',
              color: activeFile ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 4, cursor: activeFile ? 'pointer' : 'not-allowed',
              fontSize: 'var(--fs-xs)', fontWeight: 600 }}>
            {activeFile ? `Save ${activeFile.name}` : 'Open a file first'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div data-sandbox-wrapper style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
        {!activeFile && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 'var(--fs-sm)',
          }}>
            Click + to create a new sandbox file
          </div>
        )}
      </div>
    </div>
  );
}

export default SandboxCanvas;
