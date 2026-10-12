// 沙盒波形采样桥 —— 从 SandboxCanvas 抽出（卷三十一 重构第一轮）。
//
// 波形面板（WaveformPanel）以 getChannels/getSample 两个回调取数；这里把
// 「从 paper 的连线收集 netname→位宽 / 读数」的通道协议收口成一份实现。
// 通道上限 24 与编译模式 Canvas.getWaveChannels 对齐（面板滚动历史 600 tick）。

const WAVE_CHANNEL_LIMIT = 24;

/** 当前画布的可选通道（按连线去重，上限 24） */
export function getWaveChannels(paper: any): { name: string; bits: number }[] {
  if (!paper) return [];
  const seen = new Map<string, number>();
  try {
    for (const lk of paper.model.getLinks()) {
      const net = lk.get('netname');
      if (!net || seen.has(String(net))) continue;
      seen.set(String(net), Number(lk.get('bits')) || 1);
      if (seen.size >= WAVE_CHANNEL_LIMIT) break;
    }
  } catch { /* ignore */ }
  return Array.from(seen.entries()).map(([name, bits]) => ({ name, bits }));
}

/** 一次全通道采样：net → 三值串（Vector3vl 前缀剥掉，与编译模式同款读数）。
 *  逐根兜底（R128 对齐编译模式 Canvas 的更强语义）：某条线里的向量坏了
 *  （String() 会抛）不该让整批采样停掉——坏的那根记 x，其余照常。 */
export function getWaveSample(paper: any): Record<string, string> | null {
  if (!paper) return null;
  const values: Record<string, string> = {};
  const seen = new Set<string>();
  try {
    for (const lk of paper.model.getLinks()) {
      const net = lk.get('netname');
      if (!net || seen.has(String(net))) continue;
      seen.add(String(net));
      try {
        const sig = lk.get('signal');
        values[String(net)] = sig != null ? String(sig).replace(/^Vector3vl\s+/, '') : 'x';
      } catch { values[String(net)] = 'x'; }
      if (seen.size >= WAVE_CHANNEL_LIMIT) break;
    }
  } catch { /* ignore */ }
  return values;
}
