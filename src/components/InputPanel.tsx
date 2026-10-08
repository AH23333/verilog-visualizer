import { useMemo } from 'react';
import IOPanel, { type IOHost } from './IOPanel';
import type { CanvasHandle } from './Canvas';

interface InputPanelProps {
  canvasRef: React.RefObject<CanvasHandle | null>;
  open: boolean;
  onClose: () => void;
}

/**
 * 编译模式的输入面板。R101 起：同一颗面板**同时列出输出**（只读）——用户既能看到
 * 全部输入并切换，也能一眼看到全部输出的当前值。UI 与沙盒共用 `IOPanel`，
 * 保证两边统计口径一致。
 */
export default function InputPanel({ canvasRef, open, onClose }: InputPanelProps) {
  const host = useMemo<IOHost>(() => ({
    listInputs: () => canvasRef.current?.listInputs() ?? [],
    listOutputs: () => (canvasRef.current as any)?.listOutputs?.() ?? [],
    toggleInput: (id: string) => canvasRef.current?.toggleInput(id),
    toggleInputBit: (id: string, bit: number) => (canvasRef.current as any)?.toggleInputBit?.(id, bit),
  }), [canvasRef]);
  return <IOPanel host={host} open={open} onClose={onClose} inputsTitle="Inputs" outputsTitle="Outputs" />;
}
