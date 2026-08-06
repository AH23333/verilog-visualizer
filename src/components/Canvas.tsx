import { useEffect, useRef } from 'react';

interface CanvasProps {
  circuitJson: any;
  onError: (msg: string) => void;
}

export default function Canvas({ circuitJson, onError }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const circuitRef = useRef<any | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !circuitJson) return;

    try {
      if (circuitRef.current) {
        circuitRef.current.stop?.();
      }

      el.innerHTML = '';

      const circuit = new window.digitaljs.Circuit(circuitJson, {
        layoutEngine: 'elkjs',
      });
      circuit.displayOn(el);
      circuit.start();

      circuitRef.current = circuit;
    } catch (err: any) {
      onError(err.message || 'Failed to render circuit');
    }

    return () => {
      circuitRef.current?.stop?.();
    };
  }, [circuitJson, onError]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#1e1e1e',
        overflow: 'hidden',
      }}
    />
  );
}