// 自绘标题栏的三个按钮（仅 Tauri 那种 decorations:false 的无边框窗口需要）。
// 非自带标题栏的宿主（VS Code / 浏览器）里这颗组件不渲染——判据来自统一调用层的
// `hasWindowControls`，⛔ 在本文件里再探一次 `__TAURI_INTERNALS__`（那是"换宿主要挨处改"的病根，
// 迁移到 VS Code 壳后本文件整颗删除，见 docs/MIGRATION_VSCODE.md 第 7 步）。
// Windows 风格：46px 槽位，关闭键悬停红。

import { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { getHost, type ProjectHost } from '../lib/host/host';

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const [host, setHost] = useState<ProjectHost | null>(null);

  // 宿主是异步解析的（探测每次现读，允许测试在点击前注入桩），所以第一帧先什么都不画
  useEffect(() => {
    let cancelled = false;
    getHost().then((h) => { if (!cancelled) setHost(h); }).catch(() => { });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!host || !host.hasWindowControls) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        setMaximized(await host.windowIsMaximized());
        const fn = await host.onWindowResize(() => {
          // 尺寸变化只当"该重查一次"的信号：isMaximized() 才是真值
          host.windowIsMaximized().then(setMaximized).catch(() => { /* ignore */ });
        });
        if (cancelled) { fn(); } else { unlisten = fn; }
      } catch { /* 老运行时没有窗口 API */ }
    })();
    return () => { cancelled = true; unlisten?.(); };
  }, [host]);

  if (!host || !host.hasWindowControls) return null;

  const act = (fn: 'minimize' | 'toggleMaximize' | 'close') => {
    const run = fn === 'minimize' ? host.windowMinimize
      : fn === 'toggleMaximize' ? host.windowToggleMaximize : host.windowClose;
    run().catch(() => { /* 权限缺失：控制台留痕即可，按钮本身不改状态 */ });
  };

  const base: React.CSSProperties = {
    width: 46, height: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
    borderRadius: 0, flexShrink: 0,
  };

  // NOTE: deliberately NO data-tauri-drag-region on this wrapper — Tauri checks
  // the attribute's presence, so even ="false" would turn buttons into drag
  // targets and swallow clicks.
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '100%', marginLeft: 'auto', flexShrink: 0 }}>
      <button
        aria-label="最小化" title="最小化"
        style={base}
        onClick={() => act('minimize')}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
      ><Minus size={14} strokeWidth={1.5} /></button>
      <button
        aria-label={maximized ? 'Restore' : 'Maximize'} title={maximized ? 'Restore' : 'Maximize'}
        style={base}
        onClick={() => act('toggleMaximize')}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
      >
        {maximized
          ? <span style={{ position: 'relative', width: 12, height: 12, display: 'inline-block' }}>
              <Square size={10} strokeWidth={1.5} style={{ position: 'absolute', right: 0, top: 0 }} />
              <Square size={10} strokeWidth={1.5} style={{ position: 'absolute', left: 0, bottom: 0, maskImage: 'linear-gradient(135deg, #000 40%, transparent 40%)', WebkitMaskImage: 'linear-gradient(135deg, #000 40%, transparent 40%)' }} />
            </span>
          : <Square size={12} strokeWidth={1.5} />}
      </button>
      <button
        aria-label="关闭" title="关闭"
        style={base}
        onClick={() => act('close')}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#e81123'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
      ><X size={15} strokeWidth={1.5} /></button>
    </div>
  );
}
