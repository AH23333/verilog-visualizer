import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

export interface SandboxHandle {
  addCell: (type: string) => void;
  deleteSelected: () => void;
  clearAll: () => void;
  save: () => string;
  load: (json: string) => void;
}

interface Props {
  theme: 'dark' | 'light';
}

const GATE_TYPES = ['And', 'Or', 'Not', 'Xor', 'Nand', 'Nor', 'Xnor'];
const IO_TYPES = ['Button', 'Clock', 'Input', 'Output', 'Lamp'];

const SandboxCanvas = forwardRef<SandboxHandle, Props>(function SandboxCanvas({ theme }, ref) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const circuitRef = useRef<any>(null);
  const paperRef = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    addCell: (type: string) => {
      const paper = paperRef.current;
      if (!paper) return;
      const cells = (window as any).digitaljs.cells;
      const CellClass = (cells as any)[type];
      if (!CellClass) return;
      // Position: center of viewport + jitter
      const rect = wrapperRef.current!.getBoundingClientRect();
      const sx = paper.scale();
      const tx = paper.translate();
      const cx = (rect.width / 2 - tx.tx) / sx + (Math.random() - 0.5) * 100;
      const cy = (rect.height / 2 - tx.ty) / sx + (Math.random() - 0.5) * 100;
      const cell = new CellClass({
        position: { x: cx, y: cy },
        bits: 1,
      });
      paper.model.addCell(cell);
    },
    deleteSelected: () => {
      const paper = paperRef.current;
      if (!paper) return;
      // Remove all currently-highlighted (selected) cells
      const selected = paper.model.getCells().filter((c: any) => c.get('selected'));
      selected.forEach((c: any) => c.remove());
    },
    clearAll: () => {
      const paper = paperRef.current;
      if (!paper) return;
      paper.model.getCells().forEach((c: any) => c.remove());
    },
    save: () => {
      const paper = paperRef.current;
      if (!paper) return '{}';
      return JSON.stringify(paper.model.toJSON());
    },
    load: (json: string) => {
      const paper = paperRef.current;
      if (!paper) return;
      try {
        paper.model.fromJSON(JSON.parse(json));
      } catch {}
    },
  }), []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const digitaljs = (window as any).digitaljs;
    // Empty circuit, no auto-layout
    const circuit = new digitaljs.Circuit({ cells: [] }, { layoutEngine: false });
    circuitRef.current = circuit;
    const paper = circuit.displayOn(wrapper);
    paperRef.current = paper;

    // Enable interaction — sandbox is editable
    paper.fixed(false);

    // Dark theme on paper
    wrapper.style.backgroundColor = theme === 'dark' ? '#1e1e2e' : '#ffffff';

    // Delete key removes selected
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selected = paper.model.getCells().filter((c: any) => c.get('selected'));
        if (selected.length) {
          e.preventDefault();
          selected.forEach((c: any) => c.remove());
        }
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      try { circuit.stop(); } catch {}
      paper.remove();
      circuitRef.current = null;
      paperRef.current = null;
    };
  }, [theme]);

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      {/* Component palette */}
      <div style={{
        width: 140, borderRight: '1px solid var(--border-subtle)',
        padding: 8, overflowY: 'auto', flexShrink: 0,
        background: 'var(--surface)',
      }}>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>GATES</div>
        {GATE_TYPES.map(t => (
          <button key={t}
            onClick={() => (ref as any)?.current?.addCell?.(t)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '4px 8px', marginBottom: 2, fontSize: 'var(--fs-xs)',
              background: 'transparent', border: '1px solid var(--border-subtle)',
              borderRadius: 4, cursor: 'pointer', color: 'var(--text)',
            }}
          >{t}</button>
        ))}
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '8px 0 6px', fontWeight: 600 }}>IO</div>
        {IO_TYPES.map(t => (
          <button key={t}
            onClick={() => (ref as any)?.current?.addCell?.(t)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '4px 8px', marginBottom: 2, fontSize: 'var(--fs-xs)',
              background: 'transparent', border: '1px solid var(--border-subtle)',
              borderRadius: 4, cursor: 'pointer', color: 'var(--text)',
            }}
          >{t}</button>
        ))}
      </div>
      {/* Canvas */}
      <div ref={wrapperRef} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  );
});

export default SandboxCanvas;
