// 编译画布应用 —— App.tsx 瘦身后的电路视图残体（片 5「全面原生」终态）。
//
// 旧 React 全功能 UI（菜单栏/文件面板/TabBar/命令面板/设置面板/PROBLEMS/首页）整体退役：
//  · 文件管理归 VS Code 原生 Explorer，入口只剩画布；
//  · 编译由宿主推送（.v 编辑器标题栏「编译并查看电路」→ `{vvh:'push', op:'compile'}`）；
//  · 问题/日志走 host.publishProblems / host.appendOutput（workbench 接管，useHostCompile 内）；
//  · 仿真控制/导出/复制到沙盒归画布内工具条与扩展命令；
//  · 配置归 contributes.configuration：启动拉一次 getConfig，configChanged 推送后重拉。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, TriangleAlert, ArrowLeft } from 'lucide-react';
import Canvas from '../components/Canvas';
import type { CanvasHandle } from '../components/Canvas';
import ContextMenu from '../components/ContextMenu';
import type { ContextMenuItem } from '../components/ContextMenu';
import SandboxExpandModal from '../components/SandboxExpandModal';
import InputPanel from '../components/InputPanel';
import WaveformPanel from '../components/WaveformPanel';
import CanvasToolbar from './CanvasToolbar';
import { t } from '../i18n';   // i18n：中文原文即键（I18N_DESIGN §二）
import { useHostCompile, type CompileJob } from './useHostCompile';
import { settingsStore } from '../store/settingsStore';
import { buildViewJson } from '../lib/verilog';
import { getHost, hostFire, type HostConfig } from '../lib/host/host';
import { notifyReady } from '../lib/host/vscodeHost';
import { exportSVG, exportCircuitJSON, exportNetlistVerilog } from '../lib/exportUtils';
import { collectToFiles, stripBoundInlineJson, setBindingPolicy } from '../lib/gateSystem';
import { collectLegacyItems, markLegacyMigrated, dismissLegacyMigration } from './legacyMigration';
import { useVscodeTheme } from '../hooks/useVscodeTheme';
import PartSearchDialog from '../components/PartSearchDialog';
import { partSearchRegistry } from '../lib/partSearch';

const DEFAULT_SPEED_MS = 10;

export default function CanvasApp() {
  const theme = useVscodeTheme();
  const canvasRef = useRef<CanvasHandle>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // ---- 宿主配置（编译选项缓存于 App 级；沙盒项经 applyHostConfig 落 settingsStore）----
  const cfgRef = useRef<HostConfig | null>(null);

  // ---- 编译产物（useHostCompile：问题/日志直接落 workbench）----
  const { compiling, circuitJson, srcFileMap, netlistVerilog, compile } = useHostCompile();
  const [entryName, setEntryName] = useState('circuit');

  // ---- 仿真控制（App.tsx L104-137 同名状态的残体）----
  const [simPaused, setSimPaused] = useState(false);
  const [speedMs, setSpeedMs] = useState(DEFAULT_SPEED_MS);
  const [debugTick, setDebugTick] = useState(0);
  const [waveOpen, setWaveOpen] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [waveEpoch, setWaveEpoch] = useState(0);
  const waveGetChannels = useCallback(() => canvasRef.current?.getWaveChannels() ?? [], []);
  const waveGetSample = useCallback(() => canvasRef.current?.getWaveSample() ?? null, []);

  // ---- 层级钻取 + 只读子部件预览（App.tsx L114-125 同构）----
  const [viewPath, setViewPath] = useState<string[]>([]);
  const [previewSub, setPreviewSub] = useState<{ circuit: any; name: string } | null>(null);
  useEffect(() => {
    if (!previewSub) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewSub(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewSub]);

  // ---- Ctrl+F 部件搜索：挂载点随旧 React 壳退役过一次（源仍由 Canvas 注册在 partSearchRegistry，
  // 只是没人再开过这颗弹窗——r135-part-search-gate 的 [c1] 就是钉这一格的）。----
  const [partSearchOpen, setPartSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setPartSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const viewJson = useMemo(() => buildViewJson(circuitJson, viewPath), [circuitJson, viewPath]);  // 新编译（circuitJson 换代）→ 回到顶层模块
  useEffect(() => { setViewPath([]); }, [circuitJson]);
  // 显示中的电路变了（重编译/钻取）→ 清空波形历史
  useEffect(() => { setWaveEpoch((e) => e + 1); }, [viewJson]);

  // ---- 轻量提示条（旧 status bar message 的残体：引擎被坏线停了、复制落盘反馈等）----
  const [notice, setNotice] = useState<{ text: string; sticky?: boolean } | null>(null);
  // 画布右键菜单（openCanvasMenuAt 填充，ContextMenu 点外/Esc 自关）
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
    setNotice({ text });
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  // ---- 启动：拉一次宿主配置（初始 getConfig → applyHostConfig + 缓存编译选项）----
  useEffect(() => {
    let alive = true;
    getHost().then((h) => h.getConfig()).then((cfg) => {
      if (!alive) return;
      cfgRef.current = cfg;
      settingsStore.applyHostConfig(cfg);
      setBindingPolicy(cfg.bindings?.policy);          // R146 strict：嵌套部件解析不吃同名兜底（与宿主编译侧同语义）
      if (typeof cfg?.sandbox?.simSpeedMs === 'number') setSpeedMs(cfg.sandbox.simSpeedMs);
    }).catch((e) => console.warn('Failed to load config', e));
    return () => { alive = false; };
  }, []);

  // ---- 就绪握手：首编译推送会被丢（webview 没装载完，真机实测＝"还没有电路"）——
  //      挂载完发 ready，宿主补推挂起的编译单（compilePanel.flushPendingCompile）----
  useEffect(() => { notifyReady(); }, []);

  // ---- 编译推送（fresh build 起跑：暂停态复位，与旧 tryCompileAll 成功路径同语义）----
  const runCompileJob = useCallback((job: CompileJob) => {
    if (!job || !Array.isArray(job.files)) return;
    setEntryName(job.entryName || 'circuit');
    setPreviewSub(null);
    setSimPaused(false);
    void compile(job, cfgRef.current?.compile?.topModule);
  }, [compile]);

  // ---- 导出（落盘统一走 host.saveExportFile；取消是正常下落，exportUtils 内已兜）----
  const entryBase = entryName.replace(/\.(v|sv|vh)$/i, '') || 'circuit';
  const doExportSvg = useCallback(() => {
    exportSVG(canvasContainerRef.current, entryBase).then((ok) => {
      if (!ok) flash(t('画布上没有电路可导出。'));
    });
  }, [entryBase, flash]);
  const doExportJson = useCallback(() => {
    exportCircuitJSON(circuitJson, entryBase).then((ok) => {
      if (!ok) flash(t('画布上没有电路可导出。'));
    });
  }, [circuitJson, entryBase, flash]);
  const doExportNetlist = useCallback(() => {
    exportNetlistVerilog(netlistVerilog, entryBase).then((ok) => {
      if (!ok) flash(t('这份编译没有产出综合网表，无法导出。'));
    });
  }, [netlistVerilog, entryBase, flash]);

  // ---- 复制到沙盒（B2）：主电路 + 全部子部件递归固化成 `folder/*.djs` 一批落工作区，
  //      子模块实例按 celltype 名绑定（同文件夹解析）——语义照抄旧 handleCopyToSandbox ----
  const handleCopyToSandbox = useCallback(async () => {
    const graphJson = canvasRef.current?.getGraphJson();
    if (!graphJson || !circuitJson) { flash(t('先编译出电路，再复制到沙盒。')); return; }
    try {
      const folder = entryBase;
      const partFiles = await collectToFiles(circuitJson, folder);   // elk 坐标固化（0.4-0.8s/个）
      const storedJson = stripBoundInlineJson(graphJson, folder);    // 内嵌快照剥离（单一真源）
      const written = await (await getHost()).copyToSandbox([
        { name: `${folder}/${entryBase}_sandbox`, content: storedJson },
        ...partFiles,
      ]);
      flash(t('已复制到沙盒文件夹「{folder}/」：主电路 + {count} 个子部件，双击即可编辑。', { folder, count: written.length - 1 }));
    } catch (e) {
      flash(t('复制到沙盒失败：') + String((e as Error)?.message || e).slice(0, 80));
    }
  }, [circuitJson, entryBase, flash]);

  // ---- B1：旧版 localStorage 档（fileStore/sandboxStore）→ 工作区真文件的一次性迁移 ----
  const [legacyItems, setLegacyItems] = useState(() => collectLegacyItems());
  const handleMigrateLegacy = useCallback(async () => {
    try {
      const written = await (await getHost()).importLegacyData(legacyItems);
      // 墓碑按**真落盘的那批**的名字分半颗封（⛔ 拿请求当结果：一颗都没落时⛔ 封档）
      markLegacyMigrated(written);
      setLegacyItems([]);
      flash(t('已把 {count} 个旧档落成工作区文件（重名的自动加了编号）。', { count: written.length }));
    } catch (e) {
      flash(t('迁移失败：') + String((e as Error)?.message || e).slice(0, 80));
    }
  }, [legacyItems, flash]);

  // ---- 宿主单向推送（compile/sim/export/configChanged）----
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as {
        vvh?: string; op?: string; action?: string; format?: string;
      } & Partial<CompileJob> | undefined;
      if (!d || d.vvh !== 'push') return;
      switch (d.op) {
        case 'compile':
          runCompileJob({ files: (d.files as any) || [], topModule: d.topModule || '', entryName: d.entryName || 'circuit', bindingErrors: (d.bindingErrors as any) || undefined, bindingAnchors: (d.bindingAnchors as any) || undefined });
          break;
        case 'sim':
          if (d.action === 'togglePause') setSimPaused((p) => !p);
          else if (d.action === 'stepOnce') canvasRef.current?.stepOnce();
          break;
        case 'export':
          if (d.format === 'svg') doExportSvg();
          break;
        case 'configChanged':
          getHost().then((h) => h.getConfig()).then((cfg) => {
            cfgRef.current = cfg;
            settingsStore.applyHostConfig(cfg);
            setBindingPolicy(cfg.bindings?.policy);
            if (typeof cfg?.sandbox?.simSpeedMs === 'number') setSpeedMs(cfg.sandbox.simSpeedMs);
          }).catch((e) => console.warn('Failed to refresh config', e));
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [runCompileJob, doExportSvg]);

  // ---- Canvas 回调（App.tsx L618/713/761/771 同名残体）----
  const handleCanvasError = useCallback((msg: string) => {
    console.warn('[Canvas]', msg);
    setNotice({ text: msg, sticky: true });
  }, []);

  const handleCanvasRunningChange = useCallback((running: boolean) => {
    if (running) {
      // 引擎报"在跑"就抹掉"没起来"的提示；编译错误不归这里管（在 Problems 里）
      setNotice((n) => (n?.sticky && n.text.includes(t('未启动仿真')) ? null : n));
    } else {
      setNotice({ text: t('电路存在悬空/成环的连线——未启动仿真。'), sticky: true });
    }
  }, []);

  const handleSourceJump = useCallback((srcName: string, line: number) => {
    const fileName = srcFileMap[srcName];
    if (!fileName) return; // 没有源码位置映射，无处可跳
    hostFire('Failed to jump to source', (h) => h.jumpToSource(fileName, line));
  }, [srcFileMap]);

  const handleCanvasReady = useCallback(() => { /* 代码→电路高亮的入口随 CodeEditor 退役 */ }, []);

  const hasCircuit = !!circuitJson;

  // ---- 画布右键菜单（旧 App.tsx openCanvasMenuAt 恢复，2026-10-14）----
  // 旧编译画布菜单项清单（git HEAD:src/App.tsx openCanvasMenuAt）：
  //   ↵ Enter <celltype>（命中可钻取子电路时）／放大／缩小／适应窗口／重置缩放／
  //   导出 SVG／导出电路 JSON／导出综合网表／编译／导入 Verilog 文件...
  // 取舍：
  //   · 编译 → 宿主推送（.v 编辑器标题栏），本地无编译入口，随旧 UI 退役；
  //   · 导入 Verilog 文件 → 文件管理归 VS Code Explorer，退役；
  //   · 「删除选中」→ CanvasHandle 没有 removeSelected/deleteSelected API
  //     （编译画布是 digitaljs 只读渲染，无选中/删除语义），无从挂接，跳过；
  //   · 「复制到沙盒」→ 残体 CanvasApp 已有 handleCopyToSandbox，补进菜单。
  const openCanvasMenuAt = useCallback((x: number, y: number) => {
    if (!hasCircuit) return;
    const cell = canvasRef.current?.probeCellAt(x, y);
    const drillItems: ContextMenuItem[] = (cell?.drillable && cell.celltype)
      ? [
          { label: `↵ Enter ${cell.celltype}`, action: () => setViewPath((p) => [...p, cell.celltype]) },
          { label: '---', disabled: true, action: () => {} },
        ]
      : [];
    setContextMenu({
      x, y,
      items: [
        ...drillItems,
        // 视图那一组与沙盒画布菜单同序同词（放大/缩小/适应窗口/重置缩放）
        { label: t('放大'), hint: 'Ctrl+滚轮', action: () => canvasRef.current?.zoomBy(1.2) },
        { label: t('缩小'), hint: 'Ctrl+滚轮', action: () => canvasRef.current?.zoomBy(1 / 1.2) },
        { label: t('适应窗口'), hint: 'Shift+F', action: () => canvasRef.current?.fitToWindow() },
        { label: t('重置缩放'), action: () => canvasRef.current?.resetZoom() },
        { label: '---', disabled: true, action: () => {} },
        { label: t('复制到沙盒'), action: () => { void handleCopyToSandbox(); } },
        { label: t('导出 SVG'), action: () => doExportSvg() },
        { label: t('导出电路 JSON'), action: () => doExportJson() },
        { label: t('导出综合网表'), action: () => doExportNetlist() },
      ],
    });
  }, [hasCircuit, handleCopyToSandbox, doExportSvg, doExportJson, doExportNetlist]);

  // 右键在画布上是**平移**手势（Canvas 的 handleMouseDown），菜单不能在按下瞬间弹——
  // 按「按下 → 抬起，且中途没移动（>10px 视为拖拽平移）」判定成一次真正的右键点击再弹。
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    let press: { x: number; y: number; moved: boolean } | null = null;
    const onDown = (e: MouseEvent) => { if (e.button === 2) press = { x: e.clientX, y: e.clientY, moved: false }; };
    const onMove = (e: MouseEvent) => {
      if (!press) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) press.moved = true;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 2 || !press) return;
      const moved = press.moved;
      press = null;
      if (!moved) openCanvasMenuAt(e.clientX, e.clientY);
    };
    // 捕获阶段：joint 的 paper 会在自己的处理里吞掉冒泡阶段的鼠标事件
    el.addEventListener('mousedown', onDown, true);
    el.addEventListener('mousemove', onMove, true);
    el.addEventListener('mouseup', onUp, true);
    return () => {
      el.removeEventListener('mousedown', onDown, true);
      el.removeEventListener('mousemove', onMove, true);
      el.removeEventListener('mouseup', onUp, true);
    };
  }, [openCanvasMenuAt]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return (
    <div
      ref={canvasContainerRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 画布本体 / 空态 */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {hasCircuit ? (
          <Canvas
            ref={canvasRef}
            circuitJson={(viewJson ?? circuitJson) as Record<string, unknown>}
            theme={theme}
            onError={handleCanvasError}
            locked={false}
            paused={simPaused}
            speedMs={speedMs}
            onRunningChange={handleCanvasRunningChange}
            onSourceJump={handleSourceJump}
            onReady={handleCanvasReady}
            onTick={(t) => setDebugTick(t)}
            onPreviewSubcircuit={(cj, nm) => setPreviewSub({ circuit: cj, name: nm })}
          />
        ) : (
          <div className="flex flex-col justify-center items-center h-full gap-5 select-none"
            style={{ color: 'var(--text-secondary)', background: 'var(--canvas-bg)' }}>
            <div style={{ opacity: 0.15, display: 'flex' }}>
              {compiling
                ? <Cpu size={48} strokeWidth={1} style={{ color: 'var(--text)' }} />
                : <TriangleAlert size={48} strokeWidth={1} style={{ color: 'var(--text)' }} />}
            </div>
            <div className="text-base font-medium" style={{ color: 'var(--text)' }}>
              {compiling ? t('正在编译…') : t('还没有电路')}
            </div>
            <div className="text-sm max-w-[420px] text-center leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {compiling
                ? t('yosys 综合中，稍候画布会自动出现电路。')
                : t('在 .v 编辑器标题栏点『编译并查看电路』（Ctrl+F5），电路会显示在这里。')}
            </div>
          </div>
        )}
      </div>

      {/* 工具条（浮在画布上方一行；无电路时不渲染） */}
      {hasCircuit && (
        <CanvasToolbar
          simPaused={simPaused}
          speedMs={speedMs}
          debugTick={debugTick}
          onTogglePause={() => setSimPaused((p) => !p)}
          onStepOnce={() => canvasRef.current?.stepOnce()}
          onSpeedChange={setSpeedMs}
          waveOpen={waveOpen}
          inputsOpen={inputsOpen}
          onToggleWave={() => setWaveOpen((v) => !v)}
          onToggleInputs={() => setInputsOpen((v) => !v)}
          onCopyToSandbox={handleCopyToSandbox}
          onExportSvg={doExportSvg}
          onExportJson={doExportJson}
          onExportNetlist={doExportNetlist}
        />
      )}

      {/* 子模块面包屑（App.tsx L1427-1460 形状；工具条占了一行，往下挪）—— 仅钻入时 */}
      {hasCircuit && viewPath.length > 0 && (
        <div
          className="absolute left-2 z-20 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[var(--fs-md)] select-none"
          style={{ top: 56, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <button
            onClick={() => setViewPath([])}
            className="border-0 cursor-pointer p-0.5 rounded hover:opacity-80"
            style={{ background: 'transparent', color: 'var(--accent)', display: 'inline-flex' }}
            title={t('返回顶层模块')}
          ><ArrowLeft size={14} /></button>
          <button
            onClick={() => setViewPath([])}
            className="border-0 cursor-pointer px-1 py-0.5 rounded hover:opacity-80"
            style={{ background: 'transparent', color: 'var(--text)', fontSize: 'var(--fs-md)', fontWeight: 600 }}
          >
            {(circuitJson as any)?.name || entryBase}
          </button>
          {viewPath.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span style={{ color: 'var(--text-muted)' }}>›</span>
              <button
                onClick={() => setViewPath(viewPath.slice(0, i + 1))}
                className="border-0 cursor-pointer px-1 py-0.5 rounded hover:opacity-80"
                style={{
                  background: 'transparent', fontSize: 'var(--fs-md)',
                  fontWeight: i === viewPath.length - 1 ? 600 : 400,
                  color: i === viewPath.length - 1 ? 'var(--text)' : 'var(--accent)',
                }}
              >{seg}</button>
            </span>
          ))}
        </div>
      )}

      {/* 输入面板浮层（App.tsx L1421-1425 形状：画布右侧） */}
      {inputsOpen && hasCircuit && (
        <div className="absolute top-12 right-2 bottom-2 z-30 flex" style={{ pointerEvents: 'auto' }}>
          <InputPanel canvasRef={canvasRef} open={inputsOpen} onClose={() => setInputsOpen(false)} />
        </div>
      )}

      {/* 波形面板（App.tsx L1601-1609：通道/采样从 Canvas handle 现取） */}
      {waveOpen && hasCircuit && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40 }}>
          <WaveformPanel
            getChannels={waveGetChannels}
            getSample={waveGetSample}
            resetKey={String(waveEpoch)}
            running={!simPaused}
            onClose={() => setWaveOpen(false)}
          />
        </div>
      )}

      {/* R40 子部件「快捷查看展开图」：只读预览，可逐层钻取（App.tsx L1613-1620 形状） */}
      {previewSub && (
        <SandboxExpandModal
          cell={null}
          initialCircuit={previewSub.circuit}
          initialName={previewSub.name}
          theme={theme}
          onClose={() => setPreviewSub(null)}
        />
      )}

      {/* 轻量提示条（引擎被坏线停了 / 复制落盘反馈） */}
      {notice && (
        <div data-canvas-notice style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 25,
          maxWidth: '70%', padding: '6px 12px', borderRadius: 6,
          background: 'var(--vscode-editorWarning-background, rgba(217,119,6,0.95))',
          color: 'var(--vscode-editorWarning-foreground, var(--text))', fontSize: 'var(--fs-xs)',
          boxShadow: '0 6px 18px var(--vscode-widget-shadow, rgba(0,0,0,.28))',
        }}>{notice.text}</div>
      )}

      {/* B1：旧版 localStorage 档的一次性迁移条（不迁完一直挂着，⛔ 自动消失） */}
      {legacyItems.length > 0 && (
        <div data-legacy-bar style={{
          position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 8,
          background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
          fontSize: 'var(--fs-sm)', boxShadow: '0 6px 18px var(--vscode-widget-shadow, rgba(0,0,0,.28))',
        }}>
          <span>{t('检测到 {count} 个旧版本地文件（存于浏览器 localStorage）。迁移后它们会成为工作区里的真文件（.v / .djs）。', { count: legacyItems.length })}</span>
          <button onClick={handleMigrateLegacy} style={{
            padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
            background: 'var(--vscode-button-background, var(--accent))',
            color: 'var(--vscode-button-foreground, #fff)', fontWeight: 600, fontSize: 'var(--fs-sm)',
          }}>{t('迁移到工作区')}</button>
          <button onClick={() => { dismissLegacyMigration(); setLegacyItems([]); }} style={{
            padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
            background: 'var(--vscode-button-secondaryBackground, transparent)',
            color: 'var(--vscode-button-secondaryForeground, var(--text-secondary))', fontSize: 'var(--fs-sm)',
          }}>{t('不再提示')}</button>
        </div>
      )}

      {/* 画布右键菜单（旧 App.tsx 同款：点外/Esc 关闭，ContextMenu 组件自带） */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={closeContextMenu} />
      )}

      {partSearchOpen && (
        <PartSearchDialog open onClose={() => setPartSearchOpen(false)} getSource={() => partSearchRegistry.get()} />
      )}
    </div>
  );
}
