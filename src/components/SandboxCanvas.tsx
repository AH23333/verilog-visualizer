import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { serializeGraphCells } from '../lib/sandboxSerialize';
import { ctorParams, normalizeGroups } from '../lib/deviceParams';
import { applyWireStyle } from '../lib/wireRouting';
import { setSimInterval } from '../lib/simClock';
import { flipCell, applyMirror } from '../lib/cellMirror';
import { RebindDialog } from './RebindDialog';
import { buildInnerGraph } from '../lib/subcircuit';
import { circuitJsonToCells } from '../lib/subcircuitView';
import { loadCells } from '../lib/sandboxLoad';
import SandboxExpandModal from './SandboxExpandModal';
import { sandboxStore, customGateStore, baseName, dirOfName, dirOf, type SandboxFile, type CustomGate } from '../store/sandboxStore';
import {
  saveGateFromCellsToFolder, ensureDefsFromCells, stripBoundInlineJson, migrateLegacy,
  resolveDefCells, savePartFile, renamePartDef, rebindLiveGraph, resolvePartRef,
  setActivePartBindings, findPartCycle,
} from '../lib/gateSystem';
import SandboxFileBindingDialog from './SandboxFileBindingDialog';
import SandboxFileTree, { type RenameTarget, type CreateTarget } from './SandboxFileTree';
import { ChevronRight, PanelLeftClose, Plus, Undo2, Play, Pause, StepForward, AudioWaveform, RotateCcw,
  FileText, FolderPlus, RefreshCw, Redo2, RotateCw, Save, Download, FileCode, Link2, Settings, Cpu,
  SlidersHorizontal, FunctionSquare } from 'lucide-react';
import { settingsStore, type SandboxSettings } from '../store/settingsStore';
import { exportSvg, exportSvgString } from '../utils/sandboxExport';
import { generateVerilog } from '../utils/sandboxVerilog';
import { partSearchRegistry, collectPartHits } from '../lib/partSearch';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import WaveformPanel from './WaveformPanel';
import { MemoryViewModal } from './MemoryViewModal';
import { zoomPaperAtClient } from '../lib/paperZoom';
import { DffPortsModal } from './DffPortsModal';
import { FsmTableModal } from './FsmTableModal';
import { MemPortsModal } from './MemPortsModal';
import IOPanel, { type IOHost } from './IOPanel';
import PromptDialog from './PromptDialog';
import ExprGenDialog from './ExprGenDialog';
import ConfirmDialog from './ConfirmDialog';
import {
  ANNOTATION_TYPE, NOTE_DEFAULT_W, NOTE_DEFAULT_H, noteMetrics,
  registerAnnotation, makeAnnotationCell, isAnnotation, ANNOTATION_CSS, fitAnnotationToText,
} from '../lib/annotationCell';

// 卷三十一：器件目录/引擎辅助域切换为 sandboxCatalog 单一来源（R122 抽出后未接线的双份副本正式合并，
// 34 个共享符号经逐字节对拍零漂移后删除本地拷贝——见 docs/PROJECT_DEEP_REVIEW 卷三十一）。
import {
  V_SB_NAME, SANDBOX_PANEL_TITLE, IO_TYPES, PORT_TYPES,
  ARITH_TYPES, MUX_TYPES, SPARSE_MUX_TYPES, sparseSelBits, COMPARE_TYPES, SHIFT_TYPES,
  EXTEND_TYPES, REDUCE_TYPES, NATIVE_SIZE_TYPES, arithBits, collectPortDots,
  nearestPortDot, memPortRows, CN_NAME, bitsSuffix, PALETTE, SANDBOX_EXAMPLES, type PaletteItem,
  resetIoOutput, restoreMemoryData, flushStaleQueue, seedGateOutputs, serializePaper,
} from '../lib/sandboxCatalog';
import { type DrcIssue, runCanvasDrc, validateConnectionEnds } from '../lib/sandboxDrc';
import { buildCellMenuItems } from '../lib/sandboxCellMenu';
import { getWaveChannels, getWaveSample } from '../lib/sandboxWaveBridge';
// 示例插入的 id 批号计数器（模块级可变，故意留在消费方而非 catalog）
let EXAMPLE_SEQ = 0;

interface Props {
  theme: 'dark' | 'light';
  onOpenSettings?: () => void;
  /** 左栏当前视图（由 App 活动栏的 文件 / 模块 / 层次结构 三个按钮驱动） */
  leftPanel?: 'files' | 'modules' | 'hierarchy';
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** 退出沙盒、回到 IDE（电路 / 代码）视图 */
  onExitSandbox?: () => void;
}

/**
 * Restore a serialized graph into a paper. `id` MUST be passed at construction time:
 * mutating `cell.set('id', …)` afterwards leaves the already-rendered view carrying the
 * OLD `model-id`, which silently breaks findView() and hit-testing.
 */
// loadCells 已抽至 src/lib/sandboxLoad.ts（R35）：文件装载 / 示例插入 /
// 粘贴复制电路三个消费方共用一条实现，并支持 id 重映射与位置偏移。

function SandboxCanvas({ theme, onOpenSettings, leftPanel = 'files', sidebarCollapsed = false, onToggleSidebar, onExitSandbox }: Props) {
  const circuitRef = useRef<any>(null);
  const paperRef = useRef<any>(null);
  const selectionRef = useRef<Set<string>>(new Set());
  const setSelectionRef = useRef<(ids: string[]) => void>(() => {});
  const scheduleDrcRef = useRef<() => void>(() => {});
  const commitRef = useRef<() => void>(() => {});
  const clipboardRef = useRef<{ cells: any[]; links: any[] } | null>(null);
  const historyRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  const wireCountRef = useRef(0);
  const [files, setFiles] = useState<SandboxFile[]>([]);
  const [activeFile, setActiveFile] = useState<SandboxFile | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [running, setRunning] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pendingResetJsonRef = useRef<string | null>(null);
  const runningRef = useRef(true);
  const [, forceUpdate] = useState(0);
  const [gates, setGates] = useState<CustomGate[]>([]);
  // gates 的镜像 ref：菜单回调读它，避免 gates 进 useCallback 依赖。
  // 为什么不能直接依赖 gates：customGateStore.list() 每次返回新数组，refreshGates()
  // （R37 起插入示例 / 粘贴时都会调用）会让依赖 openBlankMenu 的画布重建 effect
  // 重跑 —— 刚插入的器件会被旧档 graphJson 整体冲掉（r27 回归根因）。
  const gatesRef = useRef<CustomGate[]>([]);
  gatesRef.current = gates;
  // activeFile 的镜像 ref：commit 落盘要拿当前文件 id，但不能把它进依赖
  // （否则每次切文件都换 commit 身份 → 画布重建 effect 重跑）。
  const activeFileRef = useRef<SandboxFile | null>(null);
  activeFileRef.current = activeFile;
  // 当前画布文件所在文件夹 = 部件绑定的优先作用域（R39 文件夹组织）
  const scope = useMemo(() => {
    const n = activeFile?.name || '';
    const i = n.indexOf('/');
    return i >= 0 ? n.slice(0, i) : '';
  }, [activeFile?.name]);
  const scopeRef = useRef<string>('');
  scopeRef.current = scope;
  // R100 文件级绑定：活动文件的 partBindings 喂给 gateSystem（解析最高优先），
  // 切换文件即刷新 —— 与编译模式 moduleBindings 随文件走同语义。
  useEffect(() => {
    setActivePartBindings(activeFile?.partBindings);
  }, [activeFile?.id, activeFile?.partBindings]);
  // R100 文件级「绑定...」对话框（侧栏文件右键，与编译模式一致）
  const [fileBindingId, setFileBindingId] = useState<string | null>(null);
  const [savingGate, setSavingGate] = useState(false);
  // R117 布尔表达式→电路图（借鉴 OpenCircuits ExprToCircuitPopup）
  const [exprGenOpen, setExprGenOpen] = useState(false);
  const [gateName, setGateName] = useState('');
  const [gateError, setGateError] = useState<string | null>(null);
  const [deleteGateId, setDeleteGateId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; title: string; items: ContextMenuItem[] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [drc, setDrc] = useState<DrcIssue[]>([]);
  const [settings, setSettings] = useState<SandboxSettings>(() => settingsStore.getSandboxSettings());
  const [innerCell, setInnerCell] = useState<any>(null);
  // 注释编辑态（用户裁决 2026-10-10）：双击空白创建并立即输入；双击已有注释二次编辑。
  // isNew 标记决定「提交时内容为空 → 直接删除便签」，避免留下空壳垃圾。
  const [noteEdit, setNoteEdit] = useState<{ id: string; isNew: boolean } | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  // 部件循环依赖（套娃/互嵌）常驻警告路径（用户报障 2026-10-11：环要看得见）
  const [cycleWarn, setCycleWarn] = useState<string[] | null>(null);
  /** 进入注释编辑态：载入现有文字（正向编辑——cell 的 angle/mirror 不动，提交后原样保持） */
  const startNoteEdit = useCallback((cell: any, isNew: boolean) => {
    try { setNoteDraft(String(cell?.get?.('label') ?? cell?.attr?.('label/text') ?? '')); } catch { setNoteDraft(''); }
    setNoteEdit({ id: String(cell.id), isNew });
  }, []);
  const startNoteEditRef = useRef(startNoteEdit);
  startNoteEditRef.current = startNoteEdit;
  /** 提交：写回文字；新建且留空 → 直接移除（不留空壳） */
  const commitNote = useCallback(() => {
    const paper = paperRef.current;
    if (!paper || !noteEdit) return;
    const cell = paper.model.getCell(noteEdit.id);
    setNoteEdit(null);
    if (!cell) return;
    const text = noteDraft;
    if (!text.trim()) {
      if (noteEdit.isNew) { try { cell.remove(); } catch { /* ignore */ } }
      else { try { cell.set('label', ''); } catch { /* ignore */ } }
      commitRef.current?.();
      return;
    }
    // ⚠ 文字写 **label prop**（主人）；Gate 的 bindAttrToProp 会把它同步到
    //   attrs.label/text。直接写 attr 的话 prop 留旧值 ⇒ 序列化（label prop）
    //   与存盘重开全是旧字（r121 诊断探针3 定案）。
    try { cell.set('label', text); } catch { /* ignore */ }
    // 提交后把盒子贴住文字（用户报"边框比文字宽、上下都有空隙"＝新建的 180×76 停在原地）；
    // 手动拉过的注释不贴（noteUserSized），否则会把用户拉好的尺寸吃掉。
    try { fitAnnotationToText(cell); } catch { /* ignore */ }
    commitRef.current?.();
  }, [noteEdit, noteDraft]);
  // 层次结构面板里展开的自定义门 id
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  // 起线函数缓存：空白处靠近端口按下时也要能起线（见 blank:pointerdown 处理）
  const wireDragStarterRef = useRef<((cell: any, port: string, evt: any) => void) | null>(null);
  // 总线转换器「位宽方案」对话框：{ cellId, type: 'BusGroup' | 'BusUngroup' }
  const [busDlg, setBusDlg] = useState<{ cellId: string; type: string } | null>(null);
  const [busTotal, setBusTotal] = useState(8);
  const [busGroupW, setBusGroupW] = useState(1);
  // 状态机转移表编辑窗：记住正在编辑的器件 id（弹窗按 cellId 现取 cell）
  const [fsmDlg, setFsmDlg] = useState<string | null>(null);
  // 子电路实例的「绑定...」对话框（与编译模式 BindingDialog 同款样式）：存 cellId＋当前 celltype
  const [rebindDlg, setRebindDlg] = useState<{ cellId: string; cur: string } | null>(null);
  // 存储器端口配置窗：存 cellId（弹窗按 id 现取 cell，避免拿着被重建掉的旧引用）
  const [memPortsDlg, setMemPortsDlg] = useState<string | null>(null);
  // 寄存器端口／极性配置窗：同样只存 cellId
  const [dffPortsDlg, setDffPortsDlg] = useState<string | null>(null);

  const refreshList = useCallback(() => setFiles(sandboxStore.list()), []);
  /**
   * 可放置部件清单 = **沙盒文件系统里 role:'part' 的 .djs 文件**，每次现算。
   *
   * 之前读的是遗留的 customGateStore（另一份独立存档）：R39 把部件迁进文件
   * 系统之后，删掉部件文件并不会让那份存档里的条目消失，于是右键「自定义部件」
   * 里还挂着它，点了又放不出来（resolveDefCells 找不到定义）。遗留条目只保留
   * 「没有对应部件文件」的那几个名字，作为旧档兜底。
   */
  const refreshGates = useCallback(() => {
    const strip = (n: string) => n.replace(/\.(djs|gate|json)$/i, '');
    const files = sandboxStore.list().filter((f) => f.role === 'part' && /\.(djs|gate|json)$/i.test(f.name));
    const parts: CustomGate[] = files.map((f) => ({ id: f.id, name: strip(baseName(f.name)), folder: dirOf(f) }));
    const seen = new Set(parts.map((p) => p.name));
    let legacy: CustomGate[] = [];
    try { legacy = customGateStore.list().filter((g) => !seen.has(g.name)); } catch { /* 旧档读不动就算了 */ }
    setGates([...parts, ...legacy]);
  }, []);
  const showToast = useCallback((msg: string) => setToast(msg), []);

  // ---- 文件管理（与 IDE 文件系统对齐）：多选 / 剪贴板 / 重命名 / 新建 / 文件夹 ----
  const [folders, setFolders] = useState<string[]>([]);
  const [fileSelIds, setFileSelIds] = useState<Set<string>>(new Set());
  const [fileClipboard, setFileClipboard] = useState<{ ids: string[]; cut: boolean } | null>(null);
  // R101：文件系统的「重命名 / 新建 / 删除确认」一律走**弹窗**，照抄编译模式
  // （编译侧用 PromptDialog / ConfirmDialog，菜单里不内联输入；早前沙盒是菜单内联
  //   input 或树内行内 input，与编译不一致）。这里把两个弹窗 Promise 化，菜单
  //  action 直接 `await`，写法与 App.tsx 的 askPrompt/askConfirm 一致。
  const [fsPrompt, setFsPrompt] = useState<{
    title: string; label?: string; defaultValue?: string; placeholder?: string;
    confirmLabel?: string; validate?: (v: string) => string | null;
  } | null>(null);
  const [fsConfirm, setFsConfirm] = useState<{
    title: string; message: string; detail?: string; confirmLabel?: string; danger?: boolean;
  } | null>(null);
  const fsPromptRes = useRef<((v: string | null) => void) | null>(null);
  const fsConfirmRes = useRef<((v: boolean) => void) | null>(null);
  const askFs = useCallback((o: {
    title: string; label?: string; defaultValue?: string; placeholder?: string;
    confirmLabel?: string; validate?: (v: string) => string | null;
  }) => new Promise<string | null>((res) => {
    fsPromptRes.current = res;
    setFsPrompt(o);
  }), []);
  const askFsConfirm = useCallback((o: {
    title: string; message: string; detail?: string; confirmLabel?: string; danger?: boolean;
  }) => new Promise<boolean>((res) => {
    fsConfirmRes.current = res;
    setFsConfirm(o);
  }), []);
  const closeFsPrompt = useCallback((v: string | null) => {
    setFsPrompt(null);
    const r = fsPromptRes.current; fsPromptRes.current = null;
    if (r) r(v);
  }, []);
  const closeFsConfirm = useCallback((v: boolean) => {
    setFsConfirm(null);
    const r = fsConfirmRes.current; fsConfirmRes.current = null;
    if (r) r(v);
  }, []);
  const importInputRef = useRef<HTMLInputElement>(null);
  const refreshFolders = useCallback(() => setFolders(sandboxStore.getFolders()), []);

  // R101：输入 / 输出面板（与编译模式**同一颗 IOPanel 组件**——输入可点切换，输出只读）
  const [ioOpen, setIoOpen] = useState(false);
  const SB_IN_TYPES = ['Input', 'Button', 'Clock', 'NumEntry', 'NumInput', 'Constant'];
  const SB_OUT_TYPES = ['Lamp', 'Display7', 'NumDisplay', 'Output', 'Led', 'SevenSegment'];
  /**
   * 读器件当前值。⚠ R102 关键修正：**Lamp / 数码管 / 数值显示是「接收型」器件**——它们的值
   * 来自输入端 `inputSignals.in`（连线驱动），`outputSignals` 是空的。之前一律读
   * outputSignals ⇒ 输出段永远显示 x（用户说的"无法实时显示输出"）。
   * 输入器件（Input/Button/Clock）反过来只有 outputSignals。
   */
  const sbReadVal = (c: any, isOutput = false): string => {
    const clean = (v: any) => (v == null ? null : String(v).replace(/^Vector3vl\s+/, ''));
    if (isOutput) {
      try {
        const inSigs = c.get('inputSignals');
        const iv = inSigs ? (inSigs.in ?? Object.values(inSigs)[0]) : null;
        const s = clean(iv);
        if (s) return s;
      } catch { /* 落到 outputSignals */ }
    }
    try {
      const sigs = c.get('outputSignals');
      const v = sigs ? (sigs.out ?? Object.values(sigs)[0]) : null;
      return clean(v) ?? 'x';
    } catch { return 'x'; }
  };
  /** 面板行名：有 net/label 用它，否则给「类型#序号」——别把 uuid 甩给用户看 */
  const sbRowLabel = (el: any, t: string, seq: number): string =>
    el.get('label') || el.get('net') || `${t}#${seq}`;
  /** 归一化向量值字符串：去掉 "Vector3vl " 前缀、补齐位宽、x→0（面板显示与位编辑用） */
  const sbBitStr = (v: any, bits: number): string =>
    String(v ?? '').replace(/^Vector3vl\s+/, '').replace(/[^01]/g, '0').padStart(bits, '0').slice(-bits);
  /** 新建一个位向量：优先 fromBin（按位字符串最稳），退回 fromNumber/make */
  const sbMakeVec = (V: any, bits: number, bitStr: string): any => {
    if (typeof V?.fromBin === 'function') return V.fromBin(bitStr, bits);
    const n = parseInt(bitStr, 2);
    if (typeof V?.fromNumber === 'function') return V.fromNumber(isNaN(n) ? 0 : n, bits);
    if (typeof V?.make === 'function') return V.make(bits, isNaN(n) ? 0 : n);
    return null;
  };
  const ioHost = useMemo<IOHost>(() => ({
    listInputs: () => {
      const p = paperRef.current;
      if (!p) return [];
      const out: { id: string; label: string; type: string; value: string; bits: number }[] = [];
      try {
        for (const el of p.model.getElements()) {
          const t = String(el.get('type'));
          if (!SB_IN_TYPES.includes(t)) continue;
          out.push({
            id: String(el.get('id')),
            label: el.get('label') || el.get('net') || String(el.get('id')),
            type: t, value: sbReadVal(el),
            bits: Number(el.get('bits') || 1),
          });
        }
      } catch { /* ignore */ }
      return out;
    },
    listOutputs: () => {
      const p = paperRef.current;
      if (!p) return [];
      const out: { id: string; label: string; type: string; value: string; bits: number }[] = [];
      try {
        let seq = 0;
        for (const el of p.model.getElements()) {
          const t = String(el.get('type'));
          if (!SB_OUT_TYPES.includes(t)) continue;
          seq++;
          out.push({
            id: String(el.get('id')),
            label: sbRowLabel(el, t, seq),
            type: t, value: sbReadVal(el, true),
            bits: Number(el.get('bits') || 1),
          });
        }
      } catch { /* ignore */ }
      return out;
    },
    /**
     * 整条切换 0↔全1。⚠ R102 修 bug：老实现用 `String(v) === '1'` 判"当前是不是 1"，
     * 多位向量（如 "1010"）永远不等于 '1' ⇒ 每次点击都写 1 ⇒ **input 引脚只能开不能关**。
     * 现在按"是否已全 1"判断，并且位宽 > 1 时在面板里可逐位翻转（toggleInputBit）。
     */
    toggleInput: (id: string) => {
      // R112 更正 R103 的过度解读：用户要的「非运行状态下禁止组件传输信号」禁的是
      //   **信号在电路里传播**，**不是**禁止用户拨输入引脚。沙盒默认就是未运行态，
      //   R103 那样直接 return 会让用户**永远设不了输入初值**。
      //   现在：任何时候都能改输入值；未运行时**跳过 updateGates** ⇒ 信号不传播、灯不亮。
      const p = paperRef.current;
      if (!p) return;
      const c = p.model.getCell(id);
      if (!c) return;
      try {
        const sigs = c.get('outputSignals') || {};
        const v = sigs.out ?? Object.values(sigs)[0];
        const V = (v as any)?.constructor;
        if (!V) return;
        const bits = Number((v as any)?.bits ?? c.get('bits') ?? 1);
        // 全 1 → 全 0，否则 → 全 1（R102：老实现 `String(v)==='1'` 对多位永远不成立 ⇒ 只能开不能关）
        const cur = sbBitStr(v, bits);
        const nextStr = cur === '1'.repeat(bits) ? '0'.repeat(bits) : '1'.repeat(bits);
        const nv = sbMakeVec(V, bits, nextStr);
        if (!nv) return;
        c.set('outputSignals', { ...sigs, out: nv });
        const eng = circuitRef.current;
        // R112：非运行态只改输入值、不传播。⚠ 判据用**引擎实际状态**而不是 `runningRef`
        //   ——后者只是 UI 意图标志：`settings.autoStartSim` 关闭时会被强制置 false
        //   （SandboxCanvas 约 2281 行），但电路仍需要能算出静态值供用户看
        //   （qc-paused「生产包 + 不自动起仿」场景就依赖这个：拨输入 → 灯亮）。
        if (eng && `_engine` in eng && eng._engine && !eng._engine.running) return;
        if (eng && typeof eng.updateGates === 'function') eng.updateGates();
        else flushStaleQueue(() => circuitRef.current);
        commitRef.current();
      } catch { /* ignore */ }
    },
    /** 翻转第 bit 位（bitIndex 0 = 最低位）——面板里点单个方块用 */
    toggleInputBit: (id: string, bitIndex: number) => {
      // R112 更正 R103 的过度解读：用户要的「非运行状态下禁止组件传输信号」禁的是
      //   **信号在电路里传播**，**不是**禁止用户拨输入引脚。沙盒默认就是未运行态，
      //   R103 那样直接 return 会让用户**永远设不了输入初值**。
      //   现在：任何时候都能改输入值；未运行时**跳过 updateGates** ⇒ 信号不传播、灯不亮。
      const p = paperRef.current;
      if (!p) return;
      const c = p.model.getCell(id);
      if (!c) return;
      try {
        const sigs = c.get('outputSignals') || {};
        const v = sigs.out ?? Object.values(sigs)[0];
        const V = (v as any)?.constructor;
        if (!V) return;
        const bits = Number((v as any)?.bits ?? c.get('bits') ?? 1);
        const pos = bitIndex;                       // R102：位序左＝高位，bitIndex 从左数
        if (pos < 0 || pos >= bits) return;
        const chars = sbBitStr(v, bits).split('');
        chars[pos] = chars[pos] === '1' ? '0' : '1';
        const nv = sbMakeVec(V, bits, chars.join(''));
        if (!nv) return;
        c.set('outputSignals', { ...sigs, out: nv });
        const eng = circuitRef.current;
        // R112：非运行态只改输入值、不传播。⚠ 判据用**引擎实际状态**而不是 `runningRef`
        //   ——后者只是 UI 意图标志：`settings.autoStartSim` 关闭时会被强制置 false
        //   （SandboxCanvas 约 2281 行），但电路仍需要能算出静态值供用户看
        //   （qc-paused「生产包 + 不自动起仿」场景就依赖这个：拨输入 → 灯亮）。
        if (eng && `_engine` in eng && eng._engine && !eng._engine.running) return;
        if (eng && typeof eng.updateGates === 'function') eng.updateGates();
        else flushStaleQueue(() => circuitRef.current);
        commitRef.current();
      } catch { /* ignore */ }
    },
  }), []);

  // ---- 波形监视器：与 Verilog 电路视图共用 WaveformPanel，通道 = 连线 netname ----
  const [waveOpen, setWaveOpen] = useState(false);
  const [memViewCell, setMemViewCell] = useState<any>(null);
  const waveTickRef = useRef(0);
  // 沙盒左栏可调宽度（问题 1）：180–500px、默认 240px——与编译模式侧栏同一套（App.sidebarWidth）
  const [sidebarW, setSidebarW] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem('verilog-viz-sandbox-w') || ''); return isNaN(v) ? 240 : Math.min(500, Math.max(180, v)); } catch { return 200; }
  });
  const onSidebarWDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = (document.querySelector('[data-sandbox-sidebar]') as HTMLElement | null)?.getBoundingClientRect().width ?? 200;
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(500, Math.max(180, startW + (ev.clientX - startX)));
      setSidebarW(w);
      try { localStorage.setItem('verilog-viz-sandbox-w', String(w)); } catch {}
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }, []);
  // palette 分组折叠（问题 4）：默认全部收起，点组头展开——部件太多时不再无限滚动
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(['逻辑门']));
  const toggleGroup = useCallback((name: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);
  // 波形通道/采样桥：实现收口在 lib/sandboxWaveBridge.ts（与编译模式同款通道协议，上限 24）
  const waveGetChannels = useCallback(() => getWaveChannels(paperRef.current), []);
  const waveGetSample = useCallback(() => {
    const values = getWaveSample(paperRef.current);
    if (!values) return null;
    // 采样序号自增：固定 60ms 间隔下即为真实时间轴
    return { tick: waveTickRef.current++, values };
  }, []);

  /**
   * 确保仿真在运行。用户与电路交互（点击输入引脚、完成连线）即意味着想看到它工作；
   * 若此时引擎处于停止状态（autoStartSim 被关掉、或误触过「运行/暂停」），
   * 电路会完全冻结 —— 门全部无输出、输入不传播，看起来就像所有逻辑门坏了。
   * 这里自动恢复运行并给出提示，避免这种「死电路」陷阱。
   */
  /**
   * 用户与电路交互（点输入引脚、完成连线）时的运行态处理。
   *
   * ⚠ R105（用户报「选中输入按钮后会自动开启运行，这是错误的」）：
   *   早前这里是 `ensureSimRunning` —— 不管当前是不是用户主动暂停的，一律把仿真拉回运行，
   *   还会 setRunning(true)。等于**用户的交互擅自改变运行状态**，而且与非运行态禁止信号
   *   传输的新规则互相打脸（这里刚把它打开，下一句 toggle 就又因为没在运行被拒）。
   *   现在：
   *     · 用户本来就在运行、只是引擎被连线告警意外停掉 ⇒ 恢复（保住死电路陷阱的兜底）
   *     · 用户主动暂停/停止 ⇒ **不恢复、不改状态**，只提示一句，让用户自己点「运行」
   */
  const ensureSimRunning = useCallback(() => {
    const circuit = circuitRef.current;
    if (!runningRef.current) {
      showToast('仿真未在运行——点顶栏「运行」后再交互（当前交互不传输信号）');
      return;
    }
    // 用户意图是运行中，但引擎实际已停（digitaljs 在连线 warning 时会 stop 整个引擎）
    if (circuit?._engine && !circuit._engine.running && !(paperRef.current?.model?._warnings > 0)) {
      try { circuit.start(); } catch { /* ignore */ }
      showToast('引擎此前被连线告警停止，已自动恢复运行');
    }
  }, [showToast]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => settingsStore.subscribe(() => setSettings(settingsStore.getSandboxSettings())), []);

  const gridSize = Math.max(1, settings.gridSize || 16);
  // MUST be stable: it is a dependency of the align/distribute/nudge callbacks, which are in
  // turn dependencies of the paper-building effect. Recreating it on every render makes that
  // effect re-run constantly and wipe whatever was just added.
  const snapVal = useCallback((v: number) => {
    const s = settingsStore.getSandboxSettings();
    const g = Math.max(1, s.gridSize || 16);
    return s.snapToGrid ? Math.round(v / g) * g : Math.round(v);
  }, [gridSize]);

  // Create a cell by type at given position. `id` must be supplied at construction when
  // restoring a saved graph (see loadCells).
  const spawnCell = useCallback((type: string, x: number, y: number, id?: string, extra?: Record<string, any>) => {
    const paper = paperRef.current;
    if (!paper) return null;
    const digitaljs = (window as any).digitaljs;
    const CellClass = digitaljs?.cells?.[type];
    if (!CellClass) return null;
    try {
      const bits = settingsStore.getSandboxSettings().defaultBits || 1;
      const args: any = { type, position: { x, y } };
      if (type === 'Dff') {
        // D 触发器：必须带 polarity.clock，否则没有 clk 引脚，做不了时序电路
        args.bits = bits;
        args.polarity = { clock: 1 };
      } else if (type === 'Display7') {
        args.bits = 8; // 七段数码管固定 8 位段码（a–g + dp）
      } else if (ARITH_TYPES.includes(type)) {
        // 加减乘（Arith21）的 bits 必须是 {in1,in2,out} 对象 —— 端口按 t.in1 逐位取宽，
        // 传数字会让端口位宽变成 undefined（0 位），输入成为空向量、输出恒为 0。
        // 输出位宽按运算规则加宽，避免静默溢出（乘法 2N 位、加减含进位/借位 N+1 位）。
        args.bits = type === 'Negation' ? { in: bits, out: bits } : arithBits(type, bits);
      } else if (MUX_TYPES.includes(type)) {
        // 选择器：默认 2 位 sel = 4 路输入（1 位 sel 只有 2 路，做不了像样的多路复用）
        args.bits = type === 'Mux1Hot' ? { in: bits, sel: Math.max(2, bits) } : { in: bits, sel: 2 };
      } else if (COMPARE_TYPES.includes(type)) {
        args.bits = { in1: bits, in2: bits }; // 比较器输出固定 1 位
      } else if (SHIFT_TYPES.includes(type)) {
        // 移位量端口位宽 = ceil(log2(位宽))
        args.bits = { in1: bits, in2: Math.max(1, Math.ceil(Math.log2(Math.max(2, bits)))), out: bits };
      } else if (SPARSE_MUX_TYPES.includes(type)) {
        // 稀疏选择器：行数 = 案件数（＋默认分支那一行），不是 2^sel。
        // r69 现场读数：inputs=['0','1','3'] 且 default_input=true ⇒ 端口 sel,out,in0..in3、高 72。
        const cases: string[] = (Array.isArray(extra?.inputs) ? extra.inputs : ['0', '1']).map((x) => String(x));
        const dflt = extra?.default_input === true;
        args.inputs = cases;
        args.default_input = dflt;
        args.bits = extra?.bits ?? { in: bits, sel: sparseSelBits(cases, cases.length + (dflt ? 1 : 0)) };
        args.size = { width: 40, height: 16 * (cases.length + (dflt ? 1 : 0)) + 8 };
      } else if (EXTEND_TYPES.includes(type)) {
        // 位扩展：单线（1 位）→ 总线的标准转换；零扩展补 0、符号扩展补符号位
        args.extend = extra?.extend ?? { input: 1, output: Math.max(4, bits) };
      } else if (REDUCE_TYPES.includes(type)) {
        // 归约门：总线 → 1 位（与位扩展互逆）
        args.bits = Math.max(2, bits);
      } else if (type === 'NumDisplay' || type === 'NumEntry') {
        // 总线终端：直接显示/输入总线数值，位宽至少 4（1 位没意义）
        args.bits = Math.max(4, bits);
      } else if (type === 'BusGroup' || type === 'BusUngroup') {
        // 总线合/拆：digitaljs 把 groups 当**每组位宽的数组**用（`groups.length`
        // 算高度、`groups.entries()` 生成 in0..inN 端口）。按 Map 传会让它读到
        // undefined.length → 原生高度 NaN（joint 报 `<rect> height: Expected
        // length, "NaN"`），且存档/回读时端口整套错掉。
        const widths: number[] = normalizeGroups(extra?.groups) ?? Array.from({ length: Math.max(4, bits) }, () => 1);
        args.groups = widths;
        args.size = { width: 40, height: 16 * widths.length + 8 };
      } else if (type === 'BusSlice') {
        // 切总线：从 total 位总线里取 [first, first+count) 一段。
        // 默认取 1 位（总线 → 单线），这是分线体系最常用的方向；total 跟随位宽设置。
        args.slice = extra?.slice ?? { first: 0, count: 1, total: Math.max(4, bits) };
        args.size = { width: 40, height: 24 };
      } else if (type === 'Memory') {
        // 存储器（RAM）：端口由 rdports/wrports 数组生成——元素含 clock_polarity 才有 clk
        // 引脚（否则写入永远不发生）。默认 8 位数据 × 3 位地址（8 字），读/写口各一带时钟。
        // （此前 bits 跟随 defaultBits=1，放出来只有 1 位数据宽，基本没法用）
        const nBits = extra?.bits ?? Math.max(8, bits);
        const abits = extra?.abits ?? 3;
        args.bits = nBits;
        args.abits = abits;
        args.rdports = extra?.rdports ?? [{ clock_polarity: 1 }];
        args.wrports = extra?.wrports ?? [{ clock_polarity: 1 }];
        // 行数按端口实际生成数算（无 clk / en / rst 的口只有 addr+data 两行）——
        // 之前一律按 3 行算，无时钟的读口（组合 ROM）会多出一行空白。
        args.size = { width: 88, height: 16 * memPortRows(args) + 8 };
      } else if (type === 'FSM') {
        // digitaljs 的 FSM.initialize 按 bits{in,out} 生成 in/out 端口、按 polarity 生成 clk/arst，
        // 再用 states 画状态图的圆圈、用 trans_table 画弧线（cells/FSM.mjs:9-60）。这些都列在
        // 「不支持运行时修改」名单里，改任何一项都要走 reconfigureCell 重建。
        args.bits = extra?.bits ?? { in: 1, out: 1 };
        args.polarity = extra?.polarity ?? { clock: 1, arst: 1 };
        args.states = extra?.states ?? 2;
        args.init_state = extra?.init_state ?? 0;
        args.trans_table = extra?.trans_table ?? [];
      } else if (type === 'Constant') {
        args.constant = '0'.repeat(Math.max(1, bits)); // 常量的位数 = 常量字符串长度
      } else {
        args.bits = bits;
      }
      // 存档恢复：器件特有配置以存档为准（放在默认值之后合并）
      if (extra) Object.assign(args, extra);
      if (type === 'Memory') {
        // 端口表可能被 extra 整体换掉（存档 / 端口配置窗），高度必须按最终表重算
        args.bits = args.bits ?? Math.max(8, bits);
        args.abits = args.abits ?? 3;
        args.size = { width: 88, height: 16 * memPortRows(args) + 8 };
      }
      if (id) args.id = id;
      if (!NATIVE_SIZE_TYPES.includes(type)) {
        args.size = PORT_TYPES.includes(type) ? { width: 30, height: 30 } : { width: 60, height: 32 };
      }
      const cell = new CellClass(args);
      paper.model.addCell(cell);
      if (type === 'BusGroup' || type === 'BusUngroup') {
        // 总线合/拆的基类不算高度（原生 NaN），渲染出来只有十几像素，
        // 多个端口叠在一起 —— 拖线会落到错误端口被「单驱动」规则拒绝。
        // 按组数钉高度（16×n+8，与 BusRegroup 同式）并重排端口。
        try {
          const gn = normalizeGroups(cell.get('groups'))?.length ?? 4;
          cell.prop('size/height', 16 * gn + 8);
          const ports = cell.get('ports');
          if (ports) cell.set('ports', { ...ports });
        } catch { /* ignore */ }
      }
      // digitaljs "Box" cells (Button/Lamp/Clock) and Subcircuit auto-resize themselves on
      // first render, but the port layout is computed at the ORIGINAL width and never
      // re-laid-out — leaving the port dots floating away from the (now resized) body.
      // Pin the width and force one port re-layout so body and pins finally agree.
      if (IO_TYPES.includes(type)) {
        try {
          cell.set('box_resized', true);
          if (cell.size().width !== 60) cell.prop('size/width', 60);
        } catch { /* non-box cell */ }
      }
      if (IO_TYPES.includes(type) || type === 'Subcircuit') {
        try {
          const ports = cell.get('ports');
          if (ports) cell.set('ports', { ...ports });
        } catch { /* ignore */ }
      }
      return cell;
    } catch { return null; }
  }, []);

  /** 新增部件落在当前视口中心（缩放/平移后也不会跑出视野） */
  const viewportCenter = useCallback(() => {
    const paper = paperRef.current;
    if (!paper?.el) return { x: 120, y: 120 };
    const r = paper.el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // 确定性错开，取代原先的随机抖动（Math.random()*80-40）。
    // 随机抖动最大只错开 80px，而部件模型宽度约 60px，无法保证分离 —— 连续放置的部件
    // 时好时坏地重叠，导致新部件盖住旧部件、端口拖拽落空且结果不可复现。
    // 这里按「屏幕像素」固定步长依次尝试槽位：屏幕步长恒定，所以放大时偏移量不会
    // 被缩放放大而把部件顶出可视区，同时步长(150px)恒大于部件屏幕尺寸从而避免重叠。
    const stepX = 150, stepY = 110, cols = 3;
    const occupied = (p: { x: number, y: number }) => paper.model.getCells().some((cell: any) => {
      if (typeof cell.isLink === 'function' && cell.isLink()) return false;
      const q = cell.position();
      return Math.abs(q.x - p.x) < 70 && Math.abs(q.y - p.y) < 44;
    });
    let last = { x: 120, y: 120 };
    for (let i = 0; i < cols * 2; i++) {
      const mp = paper.clientToLocalPoint(cx + (i % cols) * stepX, cy + Math.floor(i / cols) * stepY);
      const cand = { x: Math.round(mp.x), y: Math.round(mp.y) };
      if (!occupied(cand)) return cand;
      last = cand;
    }
    return last;
  }, []);

  const commit = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    // 每次改动后都尝试播种：用户边搭边连出的反馈环（或非门锁存器 / D 触发器）
    // 同样会锁在 x，只靠重建时播种一次救不了。只播种输出仍为 x 的门，安全无副作用。
    try { seedGateOutputs((window as any).digitaljs, paper); } catch { /* best effort */ }
    // 引擎自愈：digitaljs 在连线 warning 时 stop 整个引擎且永不自启。用户修好坏线
    // （warning 归零）后的任意操作都会走 commit —— 此时若运行开关仍是「开」就把引擎拉起
    try {
      const circuit = circuitRef.current;
      if (runningRef.current && circuit?._engine && !circuit._engine.running && !(paper.model._warnings > 0)) {
        circuit.start();
        showToast('引擎此前被连线告警停止，已自动恢复运行');
      }
    } catch { /* best effort */ }
    const h = historyRef.current;
    try {
      const snap = JSON.stringify(serializePaper(paper));
      if (h.stack[h.idx] !== snap) {
        h.stack = h.stack.slice(0, h.idx + 1);
        h.stack.push(snap);
        if (h.stack.length > 80) h.stack.shift();
        h.idx = h.stack.length - 1;
        forceUpdate(n => n + 1);
        // R37b：每次变更即刻落盘（此前只进撤销栈，画布内容要等切文件/切面板/
        // 卸载才持久化 —— reload 直接丢掉未切换过的内容，r34[8] 回归根因）。
        if (activeFileRef.current && activeFileRef.current.kind !== 'gate') {
          try { sandboxStore.save(activeFileRef.current.id, stripBoundInlineJson(snap, scopeRef.current)); } catch { /* best effort */ }
        }
      }
    } catch { /* ignore */ }
  }, [showToast]);

  const rebuildFromJson = useCallback((json: string) => {
    const paper = paperRef.current;
    if (!paper) return;
    const digitaljs = (window as any).digitaljs;
    setSelectionRef.current([]);
    try {
      [...paper.model.getCells()].forEach((c: any) => { try { c.remove(); } catch {} });
      loadCells(paper, digitaljs, json, spawnCell, wireCountRef, { scope: scopeRef.current });
    } catch { /* corrupted snapshot — ignore */ }
    scheduleDrcRef.current();
  }, [spawnCell]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx <= 0) { showToast('没有更早的操作了'); return; }
    h.idx -= 1;
    rebuildFromJson(h.stack[h.idx]);
    forceUpdate(n => n + 1);
  }, [rebuildFromJson, showToast]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx >= h.stack.length - 1) { showToast('没有可重做的操作'); return; }
    h.idx += 1;
    rebuildFromJson(h.stack[h.idx]);
    forceUpdate(n => n + 1);
  }, [rebuildFromJson, showToast]);

  const doAddCell = useCallback((item: PaletteItem | string) => {
    const type = typeof item === 'string' ? item : item.type;
    const extra = typeof item === 'string' ? undefined : item.extra;
    const c = viewportCenter();
    const cell = spawnCell(type, snapVal(c.x), snapVal(c.y), undefined, extra);
    void 0;
    if (cell && PORT_TYPES.includes(type)) {
      const paper = paperRef.current;
      const same = paper ? paper.model.getCells().filter((x: any) => x.get('type') === type).length : 1;
      const prefix = type === 'Input' ? 'in' : 'out';
      try { cell.set('net', `${prefix}${same}`); } catch {}
    }
    if (cell) {
      setSelectionRef.current([cell.id]);
      commitRef.current();
      // 合线器 / 分线器一放下就问位宽方案：1/2/4/8 位分组互转是它们的主用途，
      // 默认 4×1 位对多数场景都不对，放完再让用户去菜单里翻配置等于没给功能。
      if (type === 'BusGroup' || type === 'BusUngroup') {
        const groups: any = cell.get('groups');
        const widths = normalizeGroups(groups) ?? [1, 1, 1, 1];
        setBusTotal(widths.reduce((a, b) => a + Number(b), 0) || 4);
        setBusGroupW(Number(widths[0]) || 1);
        setBusDlg({ cellId: String(cell.id), type });
      }
    }
  }, [spawnCell, viewportCenter]);

  /** 在指定屏幕坐标处放置部件（右键菜单「放置部件」用），而不是视口中心 */
  const placeAt = useCallback((item: PaletteItem | string, clientX: number, clientY: number) => {
    const paper = paperRef.current;
    if (!paper) return;
    const type = typeof item === 'string' ? item : item.type;
    const extra = typeof item === 'string' ? undefined : item.extra;
    const p = paper.clientToLocalPoint(clientX, clientY);
    // 减去半个器件尺寸，让部件以点击点为中心
    const cell = spawnCell(type, snapVal(p.x - 30), snapVal(p.y - 16), undefined, extra);
    if (!cell) return;
    if (PORT_TYPES.includes(type)) {
      const same = paper.model.getCells().filter((x: any) => x.get('type') === type).length;
      const prefix = type === 'Input' ? 'in' : 'out';
      try { cell.set('net', `${prefix}${same}`); } catch {}
    }
    setSelectionRef.current([cell.id]);
    commitRef.current();
  }, [spawnCell, snapVal]);

  // ---- selection / clipboard / transform helpers ----

  const deleteSelection = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    const ids = [...selectionRef.current];
    if (!ids.length) return;
    for (const id of ids) {
      const c = paper.model.getCell(id);
      if (c) { try { c.remove(); } catch {} }
    }
    setSelectionRef.current([]);
    scheduleDrcRef.current();
    commitRef.current();
  }, []);

  const copySelection = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    const ids = selectionRef.current;
    if (!ids.size) return;
    const all = paper.model.getCells().filter((c: any) => !c.isLink());
    const idxOf = new Map<string, number>();
    all.forEach((c: any, i: number) => idxOf.set(c.id, i));
    const cells = all.filter((c: any) => ids.has(c.id)).map((c: any) => ({
      idx: idxOf.get(c.id),
      type: c.get('type'),
      position: c.get('position'),
      bits: c.get('bits'),
      net: c.get('net'),
      label: c.get('label'),
      celltype: c.get('celltype'),
      propagation: c.get('propagation'),
      size: c.get('size'),
      angle: c.get('angle'),
      // 注释的文字活在 attrs.label.text——不带 attrs，复制粘贴会丢内容
      attrs: c.get('type') === ANNOTATION_TYPE ? c.get('attrs') : undefined,
      subcircuitGraph: c.get('type') === 'Subcircuit' ? c.get('subcircuitGraph') : undefined,
    }));
    const links = paper.model.getLinks()
      .filter((l: any) => ids.has(l.get('source')?.id) && ids.has(l.get('target')?.id))
      .map((l: any) => ({
        from: idxOf.get(l.get('source').id),
        to: idxOf.get(l.get('target').id),
        fromPort: l.get('source').port,
        toPort: l.get('target').port,
      }));
    clipboardRef.current = { cells, links };
  }, []);

  const pasteClipboard = useCallback(() => {
    const paper = paperRef.current;
    const clip = clipboardRef.current;
    const digitaljs = (window as any).digitaljs;
    if (!paper || !clip || !clip.cells.length) return;
    const idMap = new Map<number, string>();
    const newIds: string[] = [];
    for (const c of clip.cells) {
      const pos = c.position || { x: 50, y: 50 };
      let cell: any = null;
      if (c.type === 'Subcircuit') {
        const Graph = (paper.model as any).constructor;
        const inner = buildInnerGraph(digitaljs, Graph, c.subcircuitGraph, paper.model._display3vl);
        cell = new digitaljs.cells.Subcircuit({
          type: 'Subcircuit', graph: inner, subcircuitGraph: serializeGraphCells(inner),
          celltype: c.celltype || '',
          position: { x: snapVal((pos.x || 50) + gridSize), y: snapVal((pos.y || 50) + gridSize) },
        });
        paper.model.addCell(cell);
        try {
          const ports = cell.get('ports');
          if (ports) cell.set('ports', { ...ports });
        } catch {}
      } else {
        cell = spawnCell(c.type, snapVal((pos.x || 50) + gridSize), snapVal((pos.y || 50) + gridSize), undefined,
          c.type === ANNOTATION_TYPE ? { attrs: c.attrs, size: c.size } : undefined);
      }
      if (!cell) continue;
      try { if (c.bits != null) cell.set('bits', c.bits); } catch {}
      try { if (c.net != null) cell.set('net', c.net); } catch {}
      try { if (c.label != null) cell.set('label', c.label); } catch {}
      try { if (c.propagation != null) cell.set('propagation', c.propagation); } catch {}
      try { if (c.angle) cell.set('angle', c.angle); } catch {}
      if (c.idx != null) idMap.set(c.idx, cell.id);
      newIds.push(cell.id);
    }
    for (const l of clip.links) {
      const sid = idMap.get(l.from as number);
      const tid = idMap.get(l.to as number);
      if (!sid || !tid) continue;
      try {
        paper.model.addCell(new digitaljs.cells.Wire({
          source: { id: sid, port: l.fromPort },
          target: { id: tid, port: l.toPort },
          signal: 'x', netname: `N${++wireCountRef.current}`,
        }));
      } catch { /* skip */ }
    }
    setSelectionRef.current(newIds);
    scheduleDrcRef.current();
    commitRef.current();
  }, [spawnCell, gridSize]);

  const duplicateSelection = useCallback(() => { copySelection(); pasteClipboard(); }, [copySelection, pasteClipboard]);

  const selectAll = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    setSelectionRef.current(paper.model.getCells().filter((c: any) => !c.isLink()).map((c: any) => c.id));
  }, []);

  const rotateSelection = useCallback((deg: number) => {
    const paper = paperRef.current;
    if (!paper) return;
    const ids = [...selectionRef.current].filter(id => {
      const c = paper.model.getCell(id);
      return c && !c.isLink();
    });
    if (!ids.length) return;
    if (ids.length === 1) {
      const c = paper.model.getCell(ids[0]);
      try {
        // R113：旋转是**纯角度变更**。mirror 已是器件本地语义、形状与锚点作为整体
        // 随旋转变，所以这里**绝不能**再调 applyMirror —— 那会把镜像轴按新 angle
        // 重新解释一遍（旧实现正是如此，导致「镜像后一旋转就整体错乱」）。
        c.rotate(deg);
      } catch { /* unsupported */ }
      commitRef.current();
      return;
    }
    // 多选：绕**选区包围盒中心**整体旋转。⚠ 不能用 joint 的 rotate(deg,false,origin)：
    // 其轨道量是 `angle - deg`（源码 joint.js:18068），对**已带角度**的器件轨道量
    // 变成 deg-a —— angle=90 的器件轨道为 0（原地自旋）、angle=180 甚至反向
    // （R100 用户实测「每个部件只围绕自身中心旋转」的根因）。手工实现：
    // 中心绕 origin 公转＋自身角度自增，两步都走模型层，与 a 无关。
    //
    // ⚠ R113 实测：joint 的 `getBBox()` **不随 angle 变化**（恒等于 pos + size，
    //   And 在 angle=0/45/90/180/270 下 bbox 全是 [672,432,60,32]），而
    //   `c.rotate(90)` **只改 angle、位置纹丝不动**（实测 start=0/45/90/180/270
    //   分别得到 90/135/180/270/0，posBefore ≡ posAfter）。
    //   ⇒ bbox 中心 == joint 的旋转中心，用它算 origin 与公转落点是正确的。
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const cells = ids.map(id => paper.model.getCell(id));
    for (const c of cells) {
      const b = c.getBBox();
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
    }
    const origin = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    for (const c of cells) {
      try {
        const b = c.getBBox(); // 旋转中心（实测与 angle 无关）
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        const dx = cx - origin.x, dy = cy - origin.y;
        const nx = origin.x + dx * cos - dy * sin;
        const ny = origin.y + dx * sin + dy * cos;
        c.rotate(deg); // 自旋（纯角度变更，不碰 mirror）
        const s = c.get('size') || c.size();
        c.position(nx - s.width / 2, ny - s.height / 2); // 公转到新中心
      } catch { /* unsupported */ }
    }
    commitRef.current();
  }, []);

  /**
   * 镜像翻转（水平/垂直）。状态存 cell 的 mirror 属性（随存档走），落地在 cellMirror 单一主人。
   *
   * R102：**多选＝整个选区一起镜像**（用户原话「没有做到翻转多个选中部件整体」）。
   * R113：**单选与多选走同一个 flipCell**——屏幕镜像 ≡「本地轴取反 + 角度取反」
   *   （推导见 cellMirror.flipCell 注释），角度取反已由 flipCell 内部完成，
   *   多选路径**绝不能**再 `rotate(-2a)`，否则角度被取反两遍 ≡ 什么都没做。
   * 多选相对单选只多一件事：器件中心关于**选区包围盒中心**对称（`2*origin - c`）。
   *   （实测 joint 的 getBBox() 不随 angle 变化，bbox 中心就是旋转中心，用它算 origin 正确。）
   */
  const flipSelection = useCallback((dir: 'h' | 'v') => {
    const paper = paperRef.current;
    if (!paper) return;
    const ids = [...selectionRef.current].filter(id => {
      const c = paper.model.getCell(id);
      return c && !c.isLink();
    });
    if (!ids.length) return;
    if (ids.length === 1) {
      try { flipCell(paper.model.getCell(ids[0]), dir, paper); } catch { /* unsupported */ }
      commitRef.current();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const cells = ids.map(id => paper.model.getCell(id));
    for (const c of cells) {
      const b = c.getBBox();
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
    }
    const origin = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    for (const c of cells) {
      try {
        // 位置必须**先算后落**：flipCell 会改 angle，但实测 getBBox() 不随 angle 变化，
        // 所以先取中心、再翻、最后把器件中心摆到对称位置——两步互不干扰。
        const b = c.getBBox();
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        const nx = dir === 'h' ? 2 * origin.x - cx : cx;
        const ny = dir === 'v' ? 2 * origin.y - cy : cy;
        flipCell(c, dir, paper);              // 形状镜像 + 角度取反（都在 flipCell 内）
        const s = c.get('size') || c.size();
        c.position(nx - s.width / 2, ny - s.height / 2);   // 位置对称
      } catch { /* unsupported */ }
    }
    commitRef.current();
  }, []);

  /** 多选对齐：left/right/hcenter/top/bottom/vcenter */
  const alignSelection = useCallback((mode: string) => {
    const paper = paperRef.current;
    if (!paper) return;
    const cells = [...selectionRef.current].map(id => paper.model.getCell(id)).filter((c: any) => c && !c.isLink());
    if (cells.length < 2) return;
    const bb = cells.map((c: any) => c.getBBox());
    const minX = Math.min(...bb.map(b => b.x));
    const maxX = Math.max(...bb.map(b => b.x + b.width));
    const minY = Math.min(...bb.map(b => b.y));
    const maxY = Math.max(...bb.map(b => b.y + b.height));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    cells.forEach((c: any) => {
      const b = c.getBBox();
      const p = c.position();
      let nx = p.x, ny = p.y;
      if (mode === 'left') nx = p.x + (minX - b.x);
      else if (mode === 'right') nx = p.x + (maxX - (b.x + b.width));
      else if (mode === 'hcenter') nx = p.x + (cx - (b.x + b.width / 2));
      else if (mode === 'top') ny = p.y + (minY - b.y);
      else if (mode === 'bottom') ny = p.y + (maxY - (b.y + b.height));
      else if (mode === 'vcenter') ny = p.y + (cy - (b.y + b.height / 2));
      try { c.set('position', { x: snapVal(nx), y: snapVal(ny) }); } catch {}
    });
    commitRef.current();
  }, [snapVal]);

  /** 多选等距分布：horizontal / vertical */
  const distributeSelection = useCallback((axis: 'h' | 'v') => {
    const paper = paperRef.current;
    if (!paper) return;
    const cells = [...selectionRef.current].map(id => paper.model.getCell(id)).filter((c: any) => c && !c.isLink());
    if (cells.length < 3) return;
    const sorted = [...cells].sort((a: any, b: any) => {
      const ba = a.getBBox(), bb = b.getBBox();
      return axis === 'h' ? (ba.x + ba.width / 2) - (bb.x + bb.width / 2) : (ba.y + ba.height / 2) - (bb.y + bb.height / 2);
    });
    const first = sorted[0].getBBox();
    const last = sorted[sorted.length - 1].getBBox();
    const startC = axis === 'h' ? first.x + first.width / 2 : first.y + first.height / 2;
    const endC = axis === 'h' ? last.x + last.width / 2 : last.y + last.height / 2;
    const step = (endC - startC) / (sorted.length - 1);
    sorted.forEach((c: any, i: number) => {
      if (i === 0 || i === sorted.length - 1) return;
      const b = c.getBBox();
      const p = c.position();
      const target = startC + step * i;
      if (axis === 'h') c.set('position', { x: snapVal(p.x + (target - (b.x + b.width / 2))), y: p.y });
      else c.set('position', { x: p.x, y: snapVal(p.y + (target - (b.y + b.height / 2))) });
    });
    commitRef.current();
  }, [snapVal]);

  const nudgeSelection = useCallback((dx: number, dy: number) => {
    const paper = paperRef.current;
    if (!paper) return;
    const ids = [...selectionRef.current];
    if (!ids.length) return;
    for (const id of ids) {
      const c = paper.model.getCell(id);
      if (!c || c.isLink()) continue;
      const p = c.position();
      try { c.set('position', { x: snapVal(p.x + dx), y: snapVal(p.y + dy) }); } catch {}
    }
  }, [snapVal]);

  const zoomBy = useCallback((factor: number) => {
    const paper = paperRef.current;
    if (!paper) return;
    const cur = paper.scale().sx || 1;
    paper.scale(Math.max(0.3, Math.min(3, cur * factor)));
  }, []);

  const resetView = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    paper.scale(1);
    paper.translate(0, 0);
  }, []);

  const zoomToFit = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    try { paper.scaleContentToFit({ padding: 40, maxScale: 1.5, minScale: 0.3 }); } catch {}
  }, []);

  const bringToFront = useCallback((front: boolean) => {
    const paper = paperRef.current;
    if (!paper) return;
    for (const id of selectionRef.current) {
      const c = paper.model.getCell(id);
      if (!c) continue;
      try { front ? c.toFront() : c.toBack(); } catch {}
    }
  }, []);

  const setProp = useCallback((id: string, prop: string, value: any) => {
    const paper = paperRef.current;
    if (!paper) return;
    const cell = paper.model.getCell(id);
    if (!cell) return;
    try { cell.set(prop, value); } catch {}
    scheduleDrcRef.current();
    commitRef.current();
  }, []);

  /**
   * 重建器件：digitaljs 把 groups / slice / extend / bits(部分器件) / initial 等列为
   * 「暂不支持运行时修改」——直接 set 会被回滚并告警。改这些只能重建器件。
   * 重建会保留 id / 位置 / 标签，并按 port id 逐个接回原连线（端口不存在的连线丢弃）。
   */
  const reconfigureCell = useCallback((id: string, extra: Record<string, any>) => {
    const paper = paperRef.current;
    if (!paper) return null;
    const old = paper.model.getCell(id);
    if (!old) return null;
    const digitaljs = (window as any).digitaljs;
    const type = String(old.get('type') || '');
    // ⚠ 构造参数先按**老器件现有的整套**取一份（`ctorParams` 与存／取档同一位主人），再让 extra 覆盖：
    //   `spawnCell` 每一项都有默认值，**没传的那一项会静默回到默认**。现场形状：只传 `{bits, polarity}`
    //   的「位宽」会把 `initial` 抹回 `x`；只传 `{bits, initial, polarity}` 的「初始值」会把
    //   `arst_value`／`srst_value`／`enable_srst`／`no_data` 抹掉 —— 器件数、连线数、端口名全对，
    //   只有仿真变了（R48 那一族的形状）。反之 extra 里显式给 `undefined`＝**这一项要清掉**
    //   （关掉某一脚时它的复位值要跟着没），所以合并后还要删掉 undefined 的键。
    const merged: Record<string, any> = { ...ctorParams(old), ...extra };
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    // Memory 的数据位宽不在 CTOR_PARAM_KEYS 里（`ctorParams` 只认存档那种形状），单独带一份
    if (type === 'Memory' && merged.bits === undefined && old.get('bits') != null) merged.bits = old.get('bits');
    // 记录两侧连线：本器件作为 source / target 的端点信息
    const linkSpecs: any[] = [];
    for (const link of paper.model.getConnectedLinks(old)) {
      const s = link.get('source'), t = link.get('target');
      const isSrc = s?.id === old.id;
      const other = isSrc ? t : s;
      linkSpecs.push({
        isSrc, otherId: other?.id, otherPort: other?.port,
        port: (isSrc ? s : t)?.port,
        netname: link.get('netname'), vertices: link.get('vertices'),
      });
    }
    const pos = old.get('position') || { x: 0, y: 0 };
    const snapshot = {
      id: old.id, angle: old.get('angle'), label: old.get('label'), net: old.get('net'),
      size: old.get('size'), mirror: old.get('mirror'),
    };
    // 先摘掉连线再删器件：Wire.remove() 会把目标端口清成 x，避免残留电平
    try { paper.model.getConnectedLinks(old).forEach((l: any) => l.remove()); } catch {}
    try { old.remove(); } catch {}
    const cell = spawnCell(type, pos.x, pos.y, String(snapshot.id), merged);
    if (!cell) return null;
    try {
      if (snapshot.angle) cell.set('angle', snapshot.angle);
      if (snapshot.label != null) cell.set('label', snapshot.label);
      if (snapshot.net != null) cell.set('net', snapshot.net);
    } catch { /* ignore */ }
    // 镜像随重建重挂（R100 模型级镜像：锚点/attrs/图形体＋文本回正）
    if (snapshot.mirror) { try { applyMirror(cell, paper); } catch { /* ignore */ } }
    for (const spec of linkSpecs) {
      if (!spec.otherId || !spec.port) continue;
      // 新器件上不存在该端口（例如组数变少）→ 丢弃这条线
      let ok = true;
      try { ok = !!cell.getPort?.(spec.port); } catch { ok = false; }
      if (!ok) continue;
      try {
        const wireArgs: any = {
          source: spec.isSrc ? { id: cell.id, port: spec.port } : { id: spec.otherId, port: spec.otherPort },
          target: spec.isSrc ? { id: spec.otherId, port: spec.otherPort } : { id: cell.id, port: spec.port },
          signal: 'x', netname: spec.netname,
        };
        if (spec.vertices) wireArgs.vertices = spec.vertices;
        const live = new digitaljs.cells.Wire(wireArgs);
        paper.model.addCell(live);
      } catch { /* ignore */ }
    }
    scheduleDrcRef.current();
    commitRef.current();
    setSelectionRef.current([cell.id]);
    return cell;
  }, [spawnCell]);

  /** 应用位宽方案：N 位总线 ↔ 若干组（每组 1/2/4/8 位） */
  const applyBusDialog = useCallback(() => {
    if (!busDlg) return;
    const n = Math.max(1, Math.floor(busTotal / Math.max(1, busGroupW)));
    const groups = Array.from({ length: n }, () => busGroupW);
    reconfigureCell(busDlg.cellId, { groups });
    setBusDlg(null);
    showToast(`${busDlg.type === 'BusGroup' ? '合线器' : '分线器'}：${n} 组 × ${busGroupW} 位 = ${n * busGroupW} 位`);
  }, [busDlg, busTotal, busGroupW, reconfigureCell, showToast]);

  const openMenuAt = useCallback((x: number, y: number, title: string, items: ContextMenuItem[]) => {
    setMenu({ x, y, title, items });
  }, []);

  // 器件右键菜单：菜单项构建整体迁至 lib/sandboxCellMenu.ts（卷三十二 瘦身第二轮，纯搬家
  // ——文案/校验/上游注释逐字保留）。这里只负责取 cell、组 ctx、拼标题、落位。
  const openCellMenu = useCallback((x: number, y: number, cellId: string) => {
    const paper = paperRef.current;
    if (!paper) return;
    const cell = paper.model.getCell(cellId);
    if (!cell) return;
    const type = String(cell.get('type') || '');
    const name = CN_NAME[type] || type;
    const selCount = selectionRef.current.size;
    const multi = selCount > 1 && selectionRef.current.has(cellId);
    const items = buildCellMenuItems({
      cell, cellId, type, multi, selCount, paper,
      scopeToClicked: () => { if (!multi) setSelectionRef.current([cellId]); },
      deleteSelection, copySelection, duplicateSelection, rotateSelection, flipSelection,
      alignSelection, distributeSelection, bringToFront, selectAll,
      setProp, reconfigureCell, resetIoOutput, showToast,
      ensureSimRunning, commit: () => commitRef.current(),
      openDffPorts: (id) => setDffPortsDlg(id),
      openFsm: (id) => setFsmDlg(id),
      openBusDlg: (id, t2, total, firstW) => { setBusTotal(total); setBusGroupW(firstW); setBusDlg({ cellId: id, type: t2 }); },
      openMemView: (c) => setMemViewCell(c),
      openMemPorts: (id) => setMemPortsDlg(id),
      openInner: (c) => setInnerCell(c),
      openRebind: (id, cur) => setRebindDlg({ cellId: id, cur }),
      startNoteEdit: (c) => startNoteEditRef.current?.(c, false),
      saveSubAsPart: (c, nm) => {
        let cells: any;
        try {
          const sg = c.get('subcircuitGraph');
          cells = (sg?.cells?.length) ? sg : serializeGraphCells(c.get('graph'));
        } catch { showToast('保存失败：内部电路无法序列化'); return; }
        if (!cells?.cells?.some((x: any) => !x.isLink)) { showToast('内部电路为空，无法保存'); return; }
        const r = saveGateFromCellsToFolder(nm, cells, scopeRef.current);
        refreshGates();
        showToast(`已保存部件「${nm}」为可编辑电路${r.nested ? `，${r.nested} 个子部件已递归入库绑定` : ''}，可在部件面板与右键菜单中放置`);
      },
    });
    openMenuAt(x, y, multi ? `${name} +${selCount - 1}` : name, items);
  }, [alignSelection, bringToFront, copySelection, deleteSelection, distributeSelection,
      duplicateSelection, openMenuAt, rotateSelection, selectAll, setProp, showToast, refreshGates]);

  const openLinkMenu = useCallback((x: number, y: number, linkId: string) => {
    const paper = paperRef.current;
    if (!paper) return;
    const link = paper.model.getCell(linkId);
    if (!link) return;
    openMenuAt(x, y, '连线', [
      { label: '删除连线', hint: 'Delete', danger: true, action: () => { setSelectionRef.current([linkId]); deleteSelection(); } },
      { label: '网络名', input: { value: String(link.get('netname') || ''), placeholder: 'net name', onCommit: (v) => {
        try { link.set('netname', v); link.label(0, { attrs: { label: { text: v } } }); } catch {}
        commitRef.current();
      } } },
    ]);
  }, [deleteSelection, openMenuAt]);

  /** 把 cells JSON（沙盒白名单格式）以 id 重映射 + 中心平移的方式插入画布。
   *  示例插入与「粘贴复制的电路」共用（多次插入防 id 冲突）。 */
  const insertCellsAt = useCallback((cells: any[], mx: number, my: number, tag: string): boolean => {
    const paper = paperRef.current;
    const digitaljs = (window as any).digitaljs;
    if (!paper || !digitaljs || !cells.length) return false;
    // R39：插入内容里若带内嵌门快照，先递归补齐缺失部件（绑定入库，幂等）
    try { ensureDefsFromCells(cells, scopeRef.current); refreshGates(); } catch { /* ignore */ }
    // 示例 JSON 用固定 id（exA、exD0…）——同一画布插入两次会 id 冲突：
    // 器件被 addCell 静默丢弃、连线却全部建立并挂到旧器件上（单驱动混乱）。
    // 深拷贝 + 重新生成 id，并把示例中心平移到右键点击处。
    const data = JSON.parse(JSON.stringify({ cells })) as { cells: any[] };
    const nodes = data.cells.filter((c) => !c.isLink);
    if (!nodes.length) return false;
    const xs = nodes.map((c) => c.position?.x ?? 0);
    const ys = nodes.map((c) => c.position?.y ?? 0);
    const local = paper.clientToLocalPoint(mx, my);
    const dx = Math.round(local.x - (Math.min(...xs) + Math.max(...xs)) / 2);
    const dy = Math.round(local.y - (Math.min(...ys) + Math.max(...ys)) / 2);
    const idMap = new Map<string, string>();
    let seq = ++EXAMPLE_SEQ; // 每次插入一个批号，id 可预测（exA_1、exA_2…），便于定位
    // 页面重载后计数器归零，但存档里已有 exA_1 等批号 —— 必须跳过画布上已存在的
    const existing = new Set(paper.model.getCells().map((c: any) => String(c.id)));
    const nidOf = (id: string) => {
      let nid = `${id}_${seq}`;
      while (existing.has(nid)) { seq = ++EXAMPLE_SEQ; nid = `${id}_${seq}`; }
      existing.add(nid);
      return nid;
    };
    nodes.forEach((c) => {
      const nid = nidOf(String(c.id));
      idMap.set(c.id, nid);
      c.id = nid;
      c.position.x += dx;
      c.position.y += dy;
    });
    data.cells.forEach((c) => {
      if (c.isLink) { c.source.id = idMap.get(c.source.id); c.target.id = idMap.get(c.target.id); }
    });
    // id 已在上方内联重映射完毕，这里只传绑定作用域
    loadCells(paper, digitaljs, JSON.stringify(data), spawnCell, wireCountRef, { scope: scopeRef.current });
    seedGateOutputs(digitaljs, paper); // 反馈环（T 触发器）自举，避免 x 锁定
    // 内存快照回写（数字钟示例的段码 ROM 走这里）——commit 不触发 rebuild，须显式调用
    try { restoreMemoryData(() => paperRef.current); } catch { /* best effort */ }
    try { flushStaleQueue(() => circuitRef.current); } catch { /* best effort */ }
    ensureSimRunning(); // 示例里有时钟，若引擎冻结则自动恢复，插入即可见计数翻转
    commit();
    showToast(tag);
    return true;
  }, [spawnCell, commit, showToast, ensureSimRunning, refreshGates]);

  const openBlankMenu = useCallback((x: number, y: number) => {
    const hasClip = !!clipboardRef.current?.cells?.length;
    // 主模式「复制到沙盒」暂存的整图（App 写入 localStorage）：在任何沙盒文件里
    // 原样粘贴 —— 用户工作流：点复制按钮 → 进沙盒 → 右键粘贴（或自动打开的新文件）。
    let importClip: { cells?: any[] } | null = null;
    try {
      const raw = localStorage.getItem('verilog-viz-import-clipboard');
      if (raw) importClip = JSON.parse(raw);
    } catch { /* ignore */ }
    openMenuAt(x, y, '画布', [
      {
        label: '放置部件', hint: '▶', action: () => {
          // 延后一帧：ContextMenu 点击项后会立即 onClose()，同步 setMenu 会被它覆盖掉，
          // 所以放到下一个宏任务里再打开二级菜单。
          // 问题 4/5：两级分组导航（分组 → 组内部件），并纳入「自定义门」组。
          setTimeout(() => {
            const goto = (title: string, items: ContextMenuItem[]) =>
              setTimeout(() => openMenuAt(x, y, title, items), 0);
            const backItem: ContextMenuItem = { label: '← 返回分类', action: () => goto('放置部件', catItems) };
            const catItems: ContextMenuItem[] = PALETTE.map((g) => ({
              label: g.group, hint: '▶',
              action: () => goto(g.group, [
                backItem,
                { label: '---' },
                ...g.items.map((it) => ({
                  label: it.label || CN_NAME[it.type] || it.type,
                  hint: it.type,
                  action: () => placeAt(it, x, y),
                })),
              ]),
            }));
            if (gatesRef.current.length) {
              catItems.push({
                label: '自定义门', hint: '▶',
                action: () => goto('自定义门', [
                  backItem,
                  { label: '---' },
                  ...gatesRef.current.map((g) => ({ label: g.name, hint: '自定义', action: () => placeCustomGateAt(g, { x, y }) })),
                ]),
              });
            }
            openMenuAt(x, y, '放置部件', catItems);
          }, 0);
        },
      },
      {
        label: '插入示例', hint: '▶', action: () => {
          setTimeout(() => {
            openMenuAt(x, y, '插入示例', SANDBOX_EXAMPLES.map((e) => ({
              label: e.name,
              action: () => { insertCellsAt(e.cells, x, y, `已插入示例：${e.name}`); setTimeout(() => zoomToFit(), 60); },
            })));
          }, 0);
        },
      },
      ...(importClip && importClip.cells && importClip.cells.length ? [{
        label: '粘贴复制的电路', hint: '复制到沙盒', action: () => {
          const cells = importClip!.cells as any[];
          // R37：粘贴前先按内嵌快照补齐缺失的门定义（递归入库绑定），
          // 之后 loadCells / 持久化剥离都能走绑定路径
          try { ensureDefsFromCells(cells); refreshGates(); } catch { /* ignore */ }
          insertCellsAt(cells, x, y, '已粘贴复制的电路');
          try { localStorage.removeItem('verilog-viz-import-clipboard'); } catch { /* ignore */ }
          setTimeout(() => zoomToFit(), 80);
        },
      }] : []),
      { label: '粘贴', hint: 'Ctrl+V', disabled: !hasClip, action: pasteClipboard },
      { label: '全选', hint: 'Ctrl+A', action: selectAll },
      { label: '---' },
      { label: '撤销', hint: 'Ctrl+Z', action: undo },
      { label: '重做', hint: 'Ctrl+Shift+Z', action: redo },
      { label: '---' },
      { label: '放大', hint: 'Ctrl+滚轮', action: () => zoomBy(1.2) },
      { label: '缩小', action: () => zoomBy(1 / 1.2) },
      { label: '适应窗口', hint: 'Shift+F', action: zoomToFit },
      { label: '重置缩放', hint: 'Ctrl+0', action: resetView },
      { label: '---' },
      // 导出：与编译模式同一组词、同样落在画布右键菜单里（动作仍走左栏那三个
      // 处理函数，不另开一份实现）
      { label: '导出 SVG', action: () => handleExportSvg() },
      { label: '导出综合网表 (.v)', action: () => handleExportNetlist() },
      { label: '导出 JSON', action: () => { if (activeFile) handleExportDjs(activeFile); } },
      { label: '---' },
      { label: '清除选择', action: () => setSelectionRef.current([]) },
    ]);
  }, [openMenuAt, pasteClipboard, placeAt, redo, resetView, selectAll, undo, zoomBy, zoomToFit, spawnCell, commit, showToast, ensureSimRunning,
      // gates 不能进依赖（见 gatesRef 注释）：自定义门列表经 gatesRef.current 读取，
      // 既保证菜单最新（ref 每次渲染同步），又不搅动画布重建 effect 的身份依赖。
      insertCellsAt]);

  useEffect(() => {
    // R37 迁移：旧 GATES_KEY 门存档 + 存量文件内嵌 subcircuitGraph →
    // 门定义文件（kind:'gate'）+ 绑定剥离。一次性、幂等。
    try {
      const moved = migrateLegacy();
      if (moved) { refreshList(); refreshFolders(); }
      refreshGates();
    } catch { /* ignore */ }
    refreshList();
    refreshGates();
    refreshFolders();
    const activeId = sandboxStore.getActiveId();
    if (activeId) {
      const f = sandboxStore.get(activeId);
      if (f) setActiveFile(f);
    }
  }, [refreshList, refreshGates, refreshFolders]);

  // (Grid) Repaint the mesh on theme / settings change WITHOUT rebuilding the paper.
  useEffect(() => {
    const root = wrapperRef.current;
    if (!root) return;
    const gridColor = theme === 'dark' ? '#2b3140' : '#c9d2e0';
    root.style.backgroundColor = theme === 'dark' ? 'var(--surface)' : '#ffffff';
    root.querySelectorAll('[data-sandbox-grid]').forEach((el) => {
      const d = el as HTMLElement;
      d.style.display = settings.showGrid ? 'block' : 'none';
      d.style.backgroundColor = theme === 'dark' ? 'var(--surface)' : '#ffffff';
      d.style.backgroundImage =
        `linear-gradient(to right, ${gridColor} 1px, transparent 1px), ` +
        `linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`;
      d.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    });
  }, [theme, activeFile?.id, resetNonce, gridSize, settings.showGrid]);

  // Apply wire-routing style without rebuilding the circuit.
  useEffect(() => {
    const paper = paperRef.current;
    if (!paper) return;
    try {
      applyWireStyle(paper, settings.wireStyle);
    } catch { /* ignore */ }
  }, [settings.wireStyle, activeFile?.id, resetNonce]);

  // 仿真步进间隔（波形调试速度）：与编译模式 SPEED 滑条同一量纲（5–200ms）。
  // ⚠ 上游的 setInterval 只在 start() 里读一次 _interval_ms ⇒ 运行中改档必须重起表，
  //   否则滑条只是把数字改了（r62 实测：5ms 档与 200ms 档的翻转次数几乎一样）。
  useEffect(() => {
    const c = circuitRef.current;
    if (!c) return;
    setSimInterval(c, settings.simSpeedMs);
  }, [settings.simSpeedMs, activeFile?.id, resetNonce]);

  // (Re)build paper when active file changes
  useEffect(() => {
    if (!activeFile) return;
    const root = wrapperRef.current;
    if (!root) return;
    const digitaljs = (window as any).digitaljs;
    // 注释 cell/View 幂等注册（Gate.define + cells 命名空间注入，见 annotationCell.ts）
    try { registerAnnotation(digitaljs); } catch { /* 注释功能降级，不影响画布 */ }
    // T1（卷四在册）：鼠标会话（拖线/批量拖拽/框选）的 document 级监听由会话内
    // onUp 自摘——若拖到一半 effect 被重建（切档/reset/在途依赖变化），闭包里的
    // onMove/onUp 不在旧 cleanup 清单上，孤儿监听会对已销毁的 paper 继续计算。
    // 注册表让 effect 销毁时能兜底摘除全部在途会话（removeEventListener 幂等，重复调无害）。
    const activeSessions: Array<() => void> = [];

    root.querySelectorAll('[data-sandbox-grid], [data-sandbox-paper-host], [data-sandbox-marquee]')
      .forEach(el => el.remove());

    if (circuitRef.current) {
      try { circuitRef.current.stop(); } catch {}
      paperRef.current?.remove();
    }

    const circuit = new digitaljs.Circuit({ devices: {}, connectors: [], subcircuits: {} }, { layoutEngine: false });
    circuitRef.current = circuit;
    const gridColor = theme === 'dark' ? '#2b3140' : '#c9d2e0';
    const gridLayer = document.createElement('div');
    gridLayer.setAttribute('data-sandbox-grid', '');
    gridLayer.style.position = 'absolute';
    gridLayer.style.inset = '0';
    gridLayer.style.zIndex = '0';
    gridLayer.style.pointerEvents = 'none';
    gridLayer.style.display = settings.showGrid ? 'block' : 'none';
    gridLayer.style.backgroundColor = theme === 'dark' ? 'var(--surface)' : '#ffffff';
    gridLayer.style.backgroundImage =
      `linear-gradient(to right, ${gridColor} 1px, transparent 1px), ` +
      `linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`;
    gridLayer.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    root.appendChild(gridLayer);

    const host = document.createElement('div');
    host.setAttribute('data-sandbox-paper-host', '');
    host.style.position = 'absolute';
    host.style.inset = '0';
    host.style.zIndex = '1';
    root.appendChild(host);
    const paper = circuit.displayOn(host);
    paperRef.current = paper;
    (window as any).__sandboxPaper = paper;
    (window as any).__sandboxCircuit = circuit;
    // R113：选区的 DEV 只读钩子。r113 闸门要断言「框选真的选中 ≥2 颗」——
    // 没有它就只能靠坐标断言碰运气，空选区时 flipSelection 直接 return 会伪装成通过。
    (window as any).__sandboxSelection = () => [...selectionRef.current];
    (window as any).__sandboxExport = {
      svgString: () => exportSvgString(paperRef.current),
      netlistString: (name = 'sandbox_circuit') => {
        const p = paperRef.current;
        if (!p) return '';
        try { return generateVerilog(p, name); } catch { return ''; }
      },
    };
    // 部件搜索源（Ctrl+F 画布聚焦时，App 层的 PartSearchDialog 经 bus 现取）：
    // 随画布建立注册、随画布销毁同源注销，不许留着指向已销毁 paper 的句柄。
    const partSource = {
      list: (q: string) => collectPartHits(paper.model.getCells(), q),
      locate: (id: string): boolean => {
        const cell = paper.model.getCell(id);
        if (!cell || (typeof cell.isLink === 'function' && cell.isLink())) return false;
        setSelectionRef.current([id]);
        const pos = (cell as any).position?.();
        if (pos) paper.scroller?.center?.(pos.x, pos.y);
        return true;
      },
    };
    partSearchRegistry.register(partSource);
    (window as any).__sandboxGates = {
      list: () => customGateStore.list(),
      place: (id: string) => { const g = customGateStore.get(id); if (g) placeCustomGate(g); },
      saveCurrentAs: (name: string) => {
        const p = paperRef.current;
        if (!p) return false;
        const cells = p.model.getCells();
        if (!cells.some((c: any) => c.get('type') === 'Input') || !cells.some((c: any) => c.get('type') === 'Output')) return false;
        savePartFile(name, serializePaper(p), scopeRef.current);
        refreshGates();
        return true;
      },
    };
    paper.options.interactive = false;
    paper.options.async = false;
    try {
      const u = (paper as any)._updates;
      if (u && u.id) { const fid = u.id; u.id = 0; cancelAnimationFrame(fid); }
      paper.updateViews();
    } catch { /* best effort */ }
    applyWireStyle(paper, settings.wireStyle);
    paper.off('render:done');
    paper.scale(1);
    paper.translate(0, 0);

    // Anchor wires on the port magnet CIRCLE, not the port group (whose bbox also covers the
    // stub wire) — otherwise every endpoint lands ~11px away from the dot the user sees.
    paper.options.defaultAnchor = function (view: any, magnet: any) {
      try {
        let el = magnet;
        if (el && String(el.tagName || '').toLowerCase() !== 'circle') {
          const c = el.querySelector && el.querySelector('circle.port, circle');
          if (c) el = c;
        }
        if (el && typeof el.getBoundingClientRect === 'function') {
          const r = el.getBoundingClientRect();
          if (r.width || r.height) {
            return paper.clientToLocalPoint(r.left + r.width / 2, r.top + r.height / 2);
          }
        }
      } catch { /* fall through */ }
      return view.model.getBBox().center();
    };

    if (settings.autoStartSim && runningRef.current) {
      circuit.start();
    } else {
      // 如实反映引擎状态：autoStartSim 关闭（或用户曾暂停）时电路并没有启动。
      // 若不纠正，runningRef 会一直是 true —— 界面显示「暂停」、ensureSimRunning
      // 误判为已在运行，用户面对一个冻结的电路，看起来就像所有逻辑门都坏了。
      runningRef.current = false;
      setRunning(false);
    }
    try { restoreMemoryData(() => paperRef.current); } catch { /* best effort */ }
    try { flushStaleQueue(() => circuitRef.current); } catch { /* best effort */ }

    const viewOf = (id: string) => {
      const c = paper.model.getCell(id);
      return c ? c.findView(paper) : null;
    };
    const mark = (id: string, on: boolean) => {
      const v = viewOf(id);
      v?.el?.classList?.[on ? 'add' : 'remove']('sm-selected');
    };
    const setSelection = (ids: string[]) => {
      const next = new Set(ids.filter(Boolean));
      selectionRef.current.forEach(id => { if (!next.has(id)) mark(id, false); });
      selectionRef.current = next;
      next.forEach(id => mark(id, true));
      forceUpdate(n => n + 1);
    };
    setSelectionRef.current = setSelection;
    commitRef.current = commit;
    (window as any).__sandboxSelection = () => [...selectionRef.current];

    // ---- design-rule check (illegal connections) ----
    // 规则本体在 lib/sandboxDrc.ts（runCanvasDrc：读模型出 issues + 刷 sm-illegal 高亮）；
    // 这里只保留 drcIssues 闭包、__sandboxDrc QC 钩子与 React 状态。
    let drcIssues: DrcIssue[] = [];
    (window as any).__sandboxDrc = () => drcIssues;
    let drcTimer: any = null;
    const runDrc = () => {
      const issues = runCanvasDrc(paper);
      drcIssues = issues;
      setDrc(issues);
      return issues;
    };
    const scheduleDrc = () => {
      if (drcTimer) clearTimeout(drcTimer);
      drcTimer = setTimeout(() => { drcTimer = null; runDrc(); }, 120);
    };
    scheduleDrcRef.current = scheduleDrc;

    // 连线落点即时校验：规则本体在 lib/sandboxDrc.ts（与 runCanvasDrc 同一套判定的单条版）
    const validateConnection = (srcId: string, srcPort: string, tgtId: string, tgtPort: string, ignoreId?: string) =>
      validateConnectionEnds(paper, srcId, srcPort, tgtId, tgtPort, ignoreId);

    const portBitsOf = (cell: any, port: string) => {
      const b = cell?.getPort?.(port)?.bits;
      if (typeof b === 'number') return b;
      const n = Number(b?.in ?? b?.out ?? b);
      return Number.isFinite(n) && n > 0 ? n : 1;
    };

    /**
     * 端口刚被上游"无差别清成 x"时，把**还活着的那根驱动线**的当前值重播回去。
     *
     * 上游 `Wire`（bundle @2285659）有两处这样的动作：
     *   `remove(){ …n._clearInput(t.port) }`                       —— 摘线
     *   `_changeTarget(t){ …播新端口；再 graph.getCell(previous.id)._clearInput(previous.port) }` —— 挪线
     * 两处都**不看那个端口是不是另有驱动线**。而我们的拖线交互恰好反复触发它们：
     *  · 中途磁吸每次重新吸附，上一次吸上的那个口就被抹一次；
     *  · 「按了一下没连成」的临时线丢弃 = remove；
     *  · finalizeWire 收尾把 target 再设一遍时，上一个 == 这一个，等于自己抹自己。
     * r72 的栈读数把这条链拍死了：`gt.in1 0011 → 0010 → xxxx`，最后一步走的是 `_clearInput`，
     * 而被抹的那口此时另有常量在驱动 ⇒ 用户看到的是「线明明在、值却是 x，只能删了重接」。
     * 修法走上游自己的通路：`_changeSignal(signal)` 不比旧值，直接 `_propagateSignal → _setInput`。
     */
    const reseedPortFromDriver = (cellId: any, port: string | undefined) => {
      if (!cellId || !port) return;
      const live = paper.model.getLinks().find((l: any) => {
        const lt = l.get('target');
        return lt && String(lt.id) === String(cellId) && lt.port === port;
      });
      if (!live) return;                              // 本来就没驱动：留 x 是对的，不替用户编值
      try { if (typeof live._changeSignal === 'function') live._changeSignal(live.get('signal')); } catch { /* 推不回去也别抛 */ }
    };

    /** 摘掉一根没接成的临时线，并把上游顺手清掉的端口值推回去（见 reseedPortFromDriver） */
    const dropTempWire = (tempLink: any) => {
      const t = tempLink?.get?.('target');
      try { tempLink?.remove?.(); } catch { /* 已经不在图里 */ }
      if (t && t.id) reseedPortFromDriver(t.id, t.port);   // 悬空端（target 是坐标）不会被清任何端口
    };

    const finalizeWire = (tempLink: any, sId: string, sPort: string, tId: string, tPort: string) => {
      const srcCell = paper.model.getCell(sId);
      const prev = tempLink.get('target');          // 拖线中途磁吸最后吸住的那个口
      tempLink.set('bits', portBitsOf(srcCell, sPort));
      tempLink.set('source', { id: sId, port: sPort });
      tempLink.set('target', { id: tId, port: tPort });
      // 上游 `_changeTarget` 会清掉 prev 那个口 —— prev 与这一口相同就是自己抹自己，
      // 不同则是「扫过别的已驱动端口」，两种都要按各自的驱动线重播（r72 栈读数）。
      if (prev && prev.id && (String(prev.id) !== String(tId) || prev.port !== tPort)) {
        reseedPortFromDriver(prev.id, prev.port);
      }
      reseedPortFromDriver(tId, tPort);
      try { tempLink.findView(paper).el.style.pointerEvents = ''; } catch { /* ignore */ }
      ensureSimRunning();
      scheduleDrc();
      commit();
    };

    const mkWire = (a: string, ap: string, b: string, bp: string) => {
      const srcCell = paper.model.getCell(a);
      const w = new digitaljs.cells.Wire({
        source: { id: a, port: ap }, target: { id: b, port: bp },
        signal: 'x', bits: portBitsOf(srcCell, ap), netname: `N${++wireCountRef.current}`,
      });
      paper.model.addCell(w);
      return w;
    };

    /**
     * 自动插转换器时挑一个**没被别的器件占着**的落点。
     * 原先一律放在「两端中点 +120」：同一颗源往外接几根不等宽的线时，转换器全叠在同一处
     * （r23 的现场读数：数据 Input 的中心像素上收到的是**另一颗器件**的 tspan，
     * 于是夹具点它没反应、灯也读不到写入）。叠在一起对用户同样是"位置极其混乱"。
     */
    const freeSpotNear = (x: number, y: number, w = 60, h = 32) => {
      const offs = [[0, 0], [0, 56], [72, 0], [0, -56], [-72, 0], [72, 56], [-72, 56], [72, -56]];
      for (const [dx, dy] of offs) {
        const cx = x + dx, cy = y + dy;
        const occupied = paper.model.getCells().some((c: any) => {
          try {
            if (typeof c.isLink === 'function' && c.isLink()) return false;
            const p = c.position?.() || { x: 0, y: 0 };
            const s = c.size?.() || { width: 60, height: 32 };
            return Math.abs(p.x - cx) < (s.width + w) / 2 && Math.abs(p.y - cy) < (s.height + h) / 2;
          } catch { return false; }
        });
        if (!occupied) return { x: cx, y: cy };
      }
      return { x, y };   // 实在挤不下就用原位（至少线能连上）
    };

    /**
     * 位宽不匹配时自动插入转换器：
     *   窄 → 宽：ZeroExtend（高位补 0）
     *   宽 → 窄：BusSlice 取低位 [0, tBits)
     * 多组拆分（4 位 → 两条 2 位）不是单线能表达的，走「分线器 / 合线器」的位宽方案对话框。
     */
    const connectWithAutoConvert = (sId: string, sPort: string, tId: string, tPort: string, tempLink: any) => {
      const sc = paper.model.getCell(sId);
      const tc = paper.model.getCell(tId);
      if (!sc || !tc) { dropTempWire(tempLink); return; }
      const sBits = portBitsOf(sc, sPort);
      const tBits = portBitsOf(tc, tPort);
      const sp = sc.position?.() || { x: 0, y: 0 };
      const tp = tc.position?.() || { x: 0, y: 0 };
      const mid = snapVal((sp.x + tp.x) / 2 + 120);
      const midY = snapVal((sp.y + tp.y) / 2);
      const spot = freeSpotNear(mid, midY);
      const conv = sBits < tBits
        ? spawnCell('ZeroExtend', spot.x, spot.y, undefined, { extend: { input: sBits, output: tBits } })
        : spawnCell('BusSlice', spot.x, spot.y, undefined, { slice: { first: 0, count: tBits, total: sBits } });
      if (!conv) {
        dropTempWire(tempLink);
        showToast(`位宽不匹配（${sBits} vs ${tBits}）：自动插入转换器失败`);
        return;
      }
      dropTempWire(tempLink);
      mkWire(sId, sPort, String(conv.id), 'in');
      mkWire(String(conv.id), 'out', tId, tPort);
      showToast(`位宽 ${sBits} → ${tBits}：已自动插入${sBits < tBits ? '零扩展' : '总线切片'}`);
      ensureSimRunning();
      scheduleDrc();
      commit();
    };

    // Load cells + links
    const sourceJson = pendingResetJsonRef.current ?? activeFile.graphJson ?? null;
    pendingResetJsonRef.current = null;
    if (sourceJson && sourceJson !== JSON.stringify({ cells: [] })) {
      try { loadCells(paper, digitaljs, sourceJson, spawnCell, wireCountRef, { scope: scopeRef.current }); } catch { /* corrupted */ }
    }
    // 环检测（用户报障 2026-10-11：套娃/互嵌必须看得见）：从当前画布的部件引用出发
    // 找第一条循环路径；渲染侧已有断环空壳兜底（cellsToCircuitJson __cycle），这里管提示。
    try {
      const refs = new Set<string>();
      paper.model.getCells().forEach((c: any) => {
        if (c.get('type') === 'Subcircuit' && c.get('celltype')) refs.add(String(c.get('celltype')));
      });
      let cyc: string[] | null = null;
      for (const r of refs) { const h = findPartCycle(r, scopeRef.current); if (h) { cyc = h; break; } }
      setCycleWarn(cyc);
    } catch { setCycleWarn(null); }
    // 播种：让交叉耦合的门（锁存器 / 触发器）摆脱 x 锁定，详见 seedGateOutputs
    try { seedGateOutputs(digitaljs, paper); } catch { /* best effort */ }
    // 冲刷过期传播片（loadCells 批量建线的事件可能排到已消费的 tick 上）——
    // 不冲刷则 BusGroup 等多输入器件的 operation 永不执行，输出恒 x
    try { flushStaleQueue(() => circuitRef.current); } catch { /* best effort */ }
    // 内存快照回写：必须在此处（loadCells 之后）——restore 的 effect 早于本 effect 执行时
    // memdataInit 还未恢复到 cell。带重试机制，engine prepare 晚于本点也能写上。
    try { restoreMemoryData(() => paperRef.current); } catch { /* best effort */ }
    try { flushStaleQueue(() => circuitRef.current); } catch { /* best effort */ }
    historyRef.current = { stack: [JSON.stringify(serializePaper(paper))], idx: 0 };
    scheduleDrc();

    // 展开自定义门内部电路
    // digitaljs 自身也监听 open:subcircuit，并往 <body> 直接插一个它自己的裸弹窗
    // （无样式、位置与内容都不对）。这正是「展开图出现两个、其中一个是错的」的原因：
    // 先 off 掉 digitaljs 自带的处理器，再挂我们自己的统一模态框。
    paper.off('open:subcircuit');
    paper.on('open:subcircuit', (model: any) => setInnerCell(model));

    // 放大镜最可靠的入口：直接在 document 上捕获 a.zoom 的原生 click。
    // jointjs 对该点击的路由不稳定（有时是 cell:pointerdown、有时被判成 blank），
    // 而原生 click 一定能到达（Button/Input 的点击切换都是这么生效的）。
    // 放大镜是 foreignObject 里的 <a class="zoom">🔍</a>：浏览器命中测试解析不到它
    // （elementFromPoint 和 click 的 target 都只给到外层 <svg>），所以任何基于
    // target/closest 的方案都不可靠。这里在 document 捕获阶段用「点击坐标 vs a.zoom 矩形」
    // 做几何判定，既不依赖 jointjs 路由，也不依赖命中测试。
    const hitZoom = (clientX: number, clientY: number) => {
      for (const sc of paper.model.getCells()) {
        if (sc.get('type') !== 'Subcircuit') continue;
        const sv = sc.findView(paper);
        const za = sv?.el?.querySelector?.('a.zoom');
        if (!za || typeof za.getBoundingClientRect !== 'function') continue;
        const r = za.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return sc;
      }
      return null;
    };
    const onDocZoomDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const sc = hitZoom(e.clientX, e.clientY);
      if (!sc) return;
      e.stopPropagation();
      e.preventDefault();
      setInnerCell(sc);
    };
    document.addEventListener('mousedown', onDocZoomDown, true);

    // ---- 注释便签（用户裁决 2026-10-10）：双击空白创建并立即进入输入态 ----
    // ⚠ joint 4.1 的事件名是 blank:pointerdblclick（joint.d.ts:2087）——不是 blank:dblclick
    //   （那颗监听器挂上去永远不响，r121 闸门首跑 0/2 抓出来的）。
    paper.on('blank:pointerdblclick', (evt: any, x: number, y: number) => {
      if (evt.button !== 0) return;
      const cell = makeAnnotationCell(digitaljs, snapVal(x - NOTE_DEFAULT_W / 2), snapVal(y - NOTE_DEFAULT_H / 2));
      if (!cell) { showToast('注释功能不可用（digitaljs 命名空间缺失）'); return; }
      paper.model.addCell(cell);
      startNoteEditRef.current?.(cell, true);
    });
    // 手柄缩放结束 → 入历史
    paper.on('annotation:resized', () => { commit(); scheduleDrc(); });

    // Box (rubber-band) selection on blank canvas drag
    paper.on('blank:pointerdown', (evt: any) => {
      if (evt.button === 2) return;
      // 起手磁吸（补充）：端口圆点只有几像素，点在它旁边几像素处常常落在器件之外，
      // 此时 joint 走的是 blank 而不是 cell:pointerdown —— 以前这种情况根本拉不出线。
      // 这里按距离找最近的端口，命中就从该端口起线（半径 16px 屏幕像素）。
      if (evt.clientX != null) {
        const dots = collectPortDots(paper);
        const near = nearestPortDot(paper, dots, evt.clientX, evt.clientY, 16);
        if (near) {
          const cell = paper.model.getCell(near.cellId);
          if (cell && wireDragStarterRef.current) {
            try { evt.stopPropagation?.(); evt.preventDefault?.(); } catch { /* ignore */ }
            wireDragStarterRef.current(cell, near.portId, evt);
            return;
          }
        }
      }
      // 放大镜有时会被命中测试判成「点在 svg 上」，从而走进 blank 而不是 cell:pointerdown。
      // 这里用同样的几何判定兜底，保证点放大镜一定能展开。
      if (evt.clientX != null) {
        for (const sc of paper.model.getCells()) {
          if (sc.get('type') !== 'Subcircuit') continue;
          const sv = sc.findView(paper);
          const za = sv?.el?.querySelector?.('a.zoom');
          if (!za || typeof za.getBoundingClientRect !== 'function') continue;
          const zr = za.getBoundingClientRect();
          if (evt.clientX >= zr.left && evt.clientX <= zr.right
              && evt.clientY >= zr.top && evt.clientY <= zr.bottom) {
            setInnerCell(sc);
            return;
          }
        }
      }
      setSelection([]);
      if (evt.button !== 0) return;
      const start = { x: evt.clientX, y: evt.clientY };
      const hostRect = root.getBoundingClientRect();
      const marquee = document.createElement('div');
      marquee.setAttribute('data-sandbox-marquee', '');
      marquee.style.position = 'absolute';
      marquee.style.zIndex = '3';
      marquee.style.pointerEvents = 'none';
      marquee.style.border = '1px dashed var(--accent)';
      marquee.style.background = 'rgba(99,102,241,0.10)';
      marquee.style.borderRadius = '2px';
      root.appendChild(marquee);
      let moved = false;
      const paint = (a: { x: number, y: number }, b: { x: number, y: number }) => {
        marquee.style.left = `${Math.min(a.x, b.x) - hostRect.left}px`;
        marquee.style.top = `${Math.min(a.y, b.y) - hostRect.top}px`;
        marquee.style.width = `${Math.abs(a.x - b.x)}px`;
        marquee.style.height = `${Math.abs(a.y - b.y)}px`;
      };
      paint(start, start);
      const onMove = (e: MouseEvent) => {
        if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 3) moved = true;
        paint(start, { x: e.clientX, y: e.clientY });
      };
      const onUp = (e: MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        marquee.remove();
        if (!moved) return;
        const p1 = paper.clientToLocalPoint(start.x, start.y);
        const p2 = paper.clientToLocalPoint(e.clientX, e.clientY);
        const box = {
          x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
          width: Math.abs(p1.x - p2.x), height: Math.abs(p1.y - p2.y),
        };
        const hits = paper.model.getCells()
          .filter((c: any) => !c.isLink())
          .filter((c: any) => {
            const b = c.getBBox();
            return !(b.x + b.width < box.x || b.x > box.x + box.width ||
                     b.y + b.height < box.y || b.y > box.y + box.height);
          })
          .map((c: any) => c.id);
        setSelection(hits);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      activeSessions.push(() => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try { marquee.remove(); } catch { /* 已摘 */ }
      });
    });

    paper.on('link:pointerdown', (linkView: any, evt: any) => {
      evt.stopPropagation();
      const id = linkView.model.id;
      const additive = evt.shiftKey || evt.ctrlKey || evt.metaKey;
      let ids: string[];
      if (additive) {
        const cur = new Set(selectionRef.current);
        cur.has(id) ? cur.delete(id) : cur.add(id);
        ids = [...cur];
      } else ids = [id];
      setSelection(ids);
    });

    // Double-click a custom gate to inspect its inner circuit. jointjs' `cell:pointerdblclick`
    // never arrives because our pointerdown handler calls preventDefault(), so detect it here.
    let lastClickId: string | null = null;
    let lastClickAt = 0;

    // 起线逻辑（磁吸 + 位宽自动转换）抽成函数并缓存到 ref：
    // 「空白区靠近端口按下」也要能起线（端口圆点只有几像素，精准对准很难受）
    const startWireDrag = (sourceCell: any, sourcePort: string, evt: any) => {
      evt.stopPropagation?.();
      evt.preventDefault?.();
      if (!sourcePort) return;
      // Dragging may start from an INPUT port too (reverse wiring). A digitaljs Wire
      // always stores (source=out, target=in), so the loose end of the temp wire must be
      // placed on the side matching the port we grabbed — otherwise `_changeSource` reads
      // a non-existent output signal and the wire dies immediately.
      const srcPortObj = sourceCell.getPort?.(sourcePort);
      const startIsInput = srcPortObj?.dir === 'in';
      const startLocal = paper.clientToLocalPoint(evt.clientX, evt.clientY);
      const tempArgs: any = startIsInput
        ? { source: { x: startLocal.x, y: startLocal.y }, target: { id: sourceCell.id, port: sourcePort }, signal: 'x' }
        : { source: { id: sourceCell.id, port: sourcePort }, target: { x: startLocal.x, y: startLocal.y }, signal: 'x' };
      // 线宽必须跟住源端口：Wire 默认 bits=1，多位信号（常量/运算器/数码管）会在线上
      // 被截坏 —— 实测加法器输入变成空向量、输出退化为 1 位 0。
      tempArgs.bits = portBitsOf(sourceCell, sourcePort);
      tempArgs.netname = `N${++wireCountRef.current}`;
      const tempLink = new digitaljs.cells.Wire(tempArgs);
      paper.model.addCell(tempLink);
      tempLink.findView(paper).el.style.pointerEvents = 'none';
      // 磁吸：落点端在 SNAP_PX 内自动吸附到最近的同向端口（起线时缓存端口坐标，
      // 拖拽过程中器件不动，无需每次重算）
      const dots = collectPortDots(paper);
      const SNAP_PX = 26;
      let snapped: any = null;
      let snappedBody: any = null;
      const clearSnapMark = () => {
        try { snappedBody?.classList?.remove('sm-port-snap'); } catch { /* ignore */ }
        snappedBody = null;
      };
      const markSnap = (body: any) => {
        clearSnapMark();
        snappedBody = body;
        try { body?.classList?.add('sm-port-snap'); } catch { /* ignore */ }
      };
      const onMove = (e: MouseEvent) => {
        const snap = nearestPortDot(paper, dots, e.clientX, e.clientY, SNAP_PX,
          (d) => d.cellId !== String(sourceCell.id) && (startIsInput ? d.dir === 'out' : d.dir === 'in'));
        // 每次换 target 之前先记住"现在挂在哪个口上"：上游 `_changeTarget` 会把上一个口
        // `_clearInput` 掉（r73 栈读数：`_changeTarget → _clearInput → _setInput(x)`），
        // 而**不管那个口是不是另有驱动线** —— 吸到别的口、还是退回悬空，都会抹一次。
        const prevTarget = startIsInput ? null : tempLink.get('target');
        if (snap) {
          snapped = snap;
          markSnap(snap.body);
          const end = { id: snap.cellId, port: snap.portId };
          if (startIsInput) tempLink.set('source', end);
          else tempLink.set('target', end);
        } else {
          snapped = null;
          clearSnapMark();
          const p = paper.clientToLocalPoint(e.clientX, e.clientY);
          if (startIsInput) tempLink.set('source', { x: p.x, y: p.y });
          else tempLink.set('target', { x: p.x, y: p.y });
        }
        if (prevTarget && prevTarget.id && prevTarget.port) {
          const nt = tempLink.get('target');
          if (!nt || String(nt.id) !== String(prevTarget.id) || nt.port !== prevTarget.port) {
            reseedPortFromDriver(prevTarget.id, prevTarget.port);
          }
        }
      };
      const onUp = (e: MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        clearSnapMark();
        // 优先用磁吸命中的端口；没吸上再退回 DOM 命中测试（精确落在圆点上的情况）
        let targetId: string | null = snapped?.cellId ?? null;
        let targetPort: string | null = snapped?.portId ?? null;
        if (!targetId) {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const targetMagnet = el?.closest?.('[magnet]');
          const tMagnetVal = targetMagnet?.getAttribute('magnet');
          if (targetMagnet && tMagnetVal && tMagnetVal !== 'false') {
            targetPort = targetMagnet.closest('.joint-port-body')?.getAttribute('port') ?? null;
            targetId = targetMagnet.closest('[model-id]')?.getAttribute('model-id') ?? null;
          }
        }
        if (targetId && targetId !== String(sourceCell.id) && targetPort) {
          // Grabbing from an input means the OTHER end is the driver.
          let sId = String(sourceCell.id), sPort = sourcePort, tId = targetId, tPort = targetPort;
          if (startIsInput) { sId = targetId; sPort = targetPort; tId = String(sourceCell.id); tPort = sourcePort; }
          const err = validateConnection(sId, sPort, tId, tPort, tempLink.id);
          // 位宽不一致不再直接拒绝 —— 自动插入转换器（窄→宽零扩展，宽→窄取低位切片）
          if (err && /位宽不匹配/.test(err)) {
            connectWithAutoConvert(sId, sPort, tId, tPort, tempLink);
            return;
          }
          if (err) {
            dropTempWire(tempLink);
            showToast(`连接被拒绝：${err}`);
            return;
          }
          // 最终源端确定后（反向起线时源在另一端），按真实源端口重设线宽
          finalizeWire(tempLink, sId, sPort, tId, tPort);
          return;
        }
        // 「按一下就取消」是最常见的落点：想点选器件，却落在端口 14 px 起手吸附区里，
        // 于是起了一根没连成的线。上游 remove() 会把它挂过的输入端口清成 x，
        // dropTempWire 负责把幸存驱动线的值推回去（见其注释）。
        dropTempWire(tempLink);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      activeSessions.push(() => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try { dropTempWire(tempLink); } catch { /* 会话已被 onUp 收走 */ }
      });
    };
    wireDragStarterRef.current = startWireDrag;
    paper.on('cell:pointerdown', (cellView: any, evt: any) => {
      if (typeof cellView.model.isLink === 'function' && cellView.model.isLink()) return;
      const magnet = evt.target?.closest?.('[magnet]');
      const magnetVal = magnet?.getAttribute('magnet');
      const isMagnet = magnetVal && magnetVal !== 'false';

      // ---- 起手端磁吸：端口圆点只有几像素，要求精准命中很难拉出线 ----
      // 未命中圆点、但落在本器件某个端口 START_SNAP_PX 以内时，同样从该端口起线。
      let startPort: string | null = isMagnet ? (magnet?.closest('.joint-port-body')?.getAttribute('port') ?? null) : null;
      if (!startPort && evt.clientX != null) {
        const own = collectPortDots(paper, String(cellView.model.id));
        const near = nearestPortDot(paper, own, evt.clientX, evt.clientY, 14);
        if (near) startPort = near.portId;
      }

      if (startPort) { startWireDrag(cellView.model, startPort, evt); return; }

      // 放大镜图标（digitaljs 渲染为 a.zoom，事件 click a.zoom -> zoomInCircuit）：
      // 单击就展开内部电路。原先这里统一 preventDefault，把 a.zoom 的 click 也挡掉了，
      // 只能退化成「400ms 内双击」兜底，于是表现为要点两次。
      // 判定是否点在放大镜上。不能用 evt.target / elementFromPoint：
      // 放大镜是 foreignObject 里的 <a class="zoom">🔍</a>，浏览器命中测试常常只给到外层
      // <svg>，两者都拿不到 a.zoom，于是下面的 preventDefault 会把 digitaljs 的
      // `click a.zoom` 一起掐掉（时好时坏）。改用几何判定：看点击坐标是否落在其矩形内。
      let onZoom = false;
      const zoomEl = cellView.el?.querySelector?.('a.zoom');
      if (zoomEl && evt.clientX != null && typeof zoomEl.getBoundingClientRect === 'function') {
        const zr = zoomEl.getBoundingClientRect();
        onZoom = evt.clientX >= zr.left && evt.clientX <= zr.right
              && evt.clientY >= zr.top && evt.clientY <= zr.bottom;
      }
      if (!onZoom) {
        const hit = document.elementFromPoint(evt.clientX, evt.clientY);
        onZoom = !!(hit?.closest?.('a.zoom'));
      }
      if (onZoom && cellView.model.get('type') === 'Subcircuit') {
        evt.stopPropagation();
        evt.preventDefault();
        setInnerCell(cellView.model);
        return;
      }

      evt.stopPropagation();
      evt.preventDefault();

      const id = cellView.model.id;
      const now = Date.now();
      if (lastClickId === id && now - lastClickAt < 400) {
        lastClickId = null;
        if (cellView.model.get('type') === 'Subcircuit') { setInnerCell(cellView.model); return; }
        // 注释：双击进入二次编辑（正向文字，提交后保持原旋转/镜像状态）
        if (isAnnotation(cellView.model)) {
          setSelection([id]);
          startNoteEditRef.current?.(cellView.model, false);
          return;
        }
      }
      lastClickId = id;
      lastClickAt = now;
      const additive = evt.shiftKey || evt.ctrlKey || evt.metaKey;
      let ids: string[];
      if (additive) {
        const cur = new Set(selectionRef.current);
        cur.has(id) ? cur.delete(id) : cur.add(id);
        ids = [...cur];
      } else {
        ids = selectionRef.current.has(id) ? [...selectionRef.current] : [id];
      }
      setSelection(ids);
      if (additive) return;

      const startLocal = paper.clientToLocalPoint(evt.clientX, evt.clientY);
      const orig = new Map<string, any>();
      selectionRef.current.forEach(sid => {
        const c = paper.model.getCell(sid);
        if (c && !c.isLink()) orig.set(sid, c.position());
      });
      let dragged = false;
      const onMove = (e: MouseEvent) => {
        const p = paper.clientToLocalPoint(e.clientX, e.clientY);
        const dx = p.x - startLocal.x, dy = p.y - startLocal.y;
        if (Math.abs(dx) + Math.abs(dy) > 1) dragged = true;
        orig.forEach((pos, sid) => {
          const c = paper.model.getCell(sid);
          if (c) c.set('position', { x: snapVal(pos.x + dx), y: snapVal(pos.y + dy) });
        });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // 单击（未拖动）输入引脚即切换电平。digitaljs 自带的可点区域只是中心 60% 的
        // btnface，在 30×30 的引脚上仅约 18px，极难点中，用户往往据此认为
        // 「逻辑门接了输入却算不出输出」。这里让整个引脚都可点击。
        if (!dragged && cellView.model.get('type') === 'Input') {
          try {
            ensureSimRunning();
            (cellView.model as any).toggleInput?.();
            scheduleDrc();
            commit();
            return;
          } catch { /* ignore */ }
        }
        if (dragged) commit();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      activeSessions.push(() => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      });
    });

    const onGraphChange = () => scheduleDrc();
    paper.model.on('add', onGraphChange);
    paper.model.on('remove', onGraphChange);
    paper.model.on('change:source', onGraphChange);
    paper.model.on('change:target', onGraphChange);
    paper.model.on('change:bits', onGraphChange);

    // Keyboard
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
      if (mod && k === 'c') { copySelection(); return; }
      if (mod && k === 'x') { copySelection(); deleteSelection(); return; }
      if (mod && k === 'v') { pasteClipboard(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (mod && k === 's') { e.preventDefault(); handleSave(); return; }
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'r') { e.preventDefault(); rotateSelection(e.shiftKey ? -90 : 90); return; }
      if (mod && (k === '0' || e.key === ')')) { e.preventDefault(); resetView(); return; }
      if (e.key === 'Escape') { setSelection([]); setMenu(null); setInnerCell(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectionRef.current.size) return;
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key.startsWith('Arrow')) {
        if (!selectionRef.current.size) return;
        e.preventDefault();
        const step = e.shiftKey ? gridSize * 4 : gridSize;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]!;
        nudgeSelection(d[0], d[1]);
        commit();
      }
    };
    document.addEventListener('keydown', onKey);

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        // 以光标为锚点（与展开图同一份实现）。原来这里只 paper.scale(k) 不补平移，
        // 放大几倍后整块内容滑出视野 —— 就是用户报的「一缩放画面就没了」。
        zoomPaperAtClient(paper, e.clientX, e.clientY, e.deltaY > 0 ? 1 / 1.1 : 1.1, 0.3, 3);
      } else {
        e.preventDefault();
        const t = paper.translate();
        // 与编译模式同一套交互：滚轮＝上下平移、Shift+滚轮＝左右平移（触控板的 deltaX 天然横移）
        if (e.shiftKey) {
          paper.translate(t.tx - e.deltaY, t.ty);
        } else {
          paper.translate(t.tx - e.deltaX, t.ty - e.deltaY);
        }
      }
    };
    root.addEventListener('wheel', onWheel, { passive: false });

    let panning = false, panStartX = 0, panStartY = 0, origTx = 0, origTy = 0, panMoved = false;
    const onPanDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      panning = true; panMoved = false;
      panStartX = e.clientX; panStartY = e.clientY;
      const t = paper.translate();
      origTx = t.tx; origTy = t.ty;
      e.preventDefault();
    };
    const onPanMove = (e: MouseEvent) => {
      if (!panning) return;
      if (Math.abs(e.clientX - panStartX) + Math.abs(e.clientY - panStartY) > 4) panMoved = true;
      paper.translate(origTx + (e.clientX - panStartX), origTy + (e.clientY - panStartY));
    };
    const onPanUp = (e: MouseEvent) => {
      // 必须先确认这次右键按下确实发生在画布上（onPanDown 置位 panning）。
      // 监听器挂在 document mouseup 上：若用户在侧边栏右键，panning=false，
      // 但旧的 panMoved=false 残留会让这里继续执行 —— elementFromPoint 落在
      // 侧栏元素上就弹出画布菜单盖在侧栏上（R34 用户报告「侧栏右键弹的是画布菜单」）。
      const startedOnCanvas = panning;
      panning = false;
      if (!startedOnCanvas || e.button !== 2 || panMoved) return;
      panMoved = false;
      const x = e.clientX, y = e.clientY;
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const modelEl = el?.closest?.('[model-id]');
      const id = modelEl?.getAttribute('model-id') || null;
      const cell = id ? paper.model.getCell(id) : null;
      if (cell && !selectionRef.current.has(id as string)) setSelection([id as string]);
      if (cell && typeof cell.isLink === 'function' && cell.isLink()) openLinkMenu(x, y, id as string);
      else if (cell) openCellMenu(x, y, id as string);
      else openBlankMenu(x, y);
    };
    root.addEventListener('mousedown', onPanDown);
    document.addEventListener('mousemove', onPanMove);
    document.addEventListener('mouseup', onPanUp);

    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
    root.addEventListener('contextmenu', onContextMenu);

    const resize = () => {
      const parent = root.parentElement!;
      paper.setDimensions(parent.clientWidth, parent.clientHeight);
    };
    resize();
    requestAnimationFrame(resize);
    const ro = new ResizeObserver(resize);
    ro.observe(root.parentElement!);

    return () => {
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('mousedown', onPanDown);
      root.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('mousemove', onPanMove);
    document.removeEventListener('mouseup', onPanUp);
    document.removeEventListener('mousedown', onDocZoomDown, true);
    // T1：兜底摘除全部在途会话（正常会话已由 onUp 自摘，removeEventListener 幂等）
    while (activeSessions.length) {
      try { activeSessions.pop()!(); } catch { /* 逐条尽力 */ }
    }
      ro.disconnect();
      if (drcTimer) clearTimeout(drcTimer);
      // Persist the LIVE topology: switching panels unmounts this component.
      try {
        if (activeFile && paper.model.getCells().length) {
          sandboxStore.save(activeFile.id, JSON.stringify(serializePaper(paper)));
        }
      } catch { /* ignore */ }
      try { circuit.stop(); } catch {}
      partSearchRegistry.unregister(partSource);
      paper.remove();
    };
  }, [activeFile?.id, spawnCell, resetNonce, selectAll, copySelection, deleteSelection,
      pasteClipboard, duplicateSelection, rotateSelection, alignSelection, distributeSelection,
      nudgeSelection, undo, redo, resetView, commit, rebuildFromJson, zoomBy, zoomToFit,
      openCellMenu, openLinkMenu, openBlankMenu, showToast, ensureSimRunning]);

  /** 新建沙盒文件。给了 name 用它（弹窗流程）；不给则自动编号（右键菜单之外的兜底）。 */
  const handleNew = (name?: string) => {
    let finalName = (name || '').trim();
    if (!finalName) {
      let n = files.length + 1;
      finalName = `电路_${n}.djs`;
      while (files.some(f => f.name === finalName)) { n++; finalName = `电路_${n}.djs`; }
    }
    const f = sandboxStore.create(finalName);
    sandboxStore.setActiveId(f.id);
    setActiveFile(f);
    refreshList();
  };

  const handleOpen = (f: SandboxFile) => {
    if (activeFile && paperRef.current) {
      sandboxStore.save(activeFile.id, stripBoundInlineJson(JSON.stringify(serializePaper(paperRef.current)), scopeRef.current));
    }
    sandboxStore.setActiveId(f.id);
    // Q1（卷二十八质检）：f 是文件树 state 里的**旧列表快照**——commit 即时落盘只进
    // store 不 refreshList，拿旧 f 重建画布会把「切走后又切回」的编辑显成丢失
    // （数据其实在 store 里，reload 才回来）。重建一律读 store 最新实体
    // （与 handleFileRename 路径「effect 读 activeFile.graphJson 旧快照」同款实测教训）。
    setActiveFile(sandboxStore.get(f.id) ?? f);
  };

  const handleSave = () => {
    if (!activeFile || !paperRef.current) return;
    const snap = JSON.stringify(serializePaper(paperRef.current));
    if (activeFile.kind === 'gate') {
      // 旧 .gate（迁移前遗留）：保存时同步为同文件夹的可编辑部件，实例随之生效
      try { savePartFile(baseName(activeFile.name).replace(/\.gate$/i, ''), JSON.parse(snap), scopeRef.current); } catch { /* ignore */ }
    } else {
      sandboxStore.save(activeFile.id, stripBoundInlineJson(snap, scopeRef.current));
    }
    refreshList();
    forceUpdate(n => n + 1);
  };
  (window as any).__sandboxSave = handleSave;

  const handleStep = () => {
    const circuit = circuitRef.current;
    if (!circuit) return;
    try { circuit.updateGatesNext?.(); } catch {}
  };

  const handleReset = () => {
    const live = paperRef.current ? serializePaper(paperRef.current) : null;
    pendingResetJsonRef.current = live ? JSON.stringify(live) : (activeFile?.graphJson ?? null);
    try { circuitRef.current?.stop(); } catch {}
    setResetNonce(n => n + 1);
  };

  const handlePlayPause = () => {
    const c = circuitRef.current;
    if (!c) return;
    const next = !running;
    runningRef.current = next;
    setRunning(next);
    try { if (next) c.start(); else c.stop(); } catch {}
  };

  const clearSelectionForExport = useCallback(() => setSelectionRef.current([]), []);

  const handleExportSvg = () => {
    if (!paperRef.current) return;
    clearSelectionForExport();
    const name = activeFile ? activeFile.name.replace(/\.djs$/i, '') : '电路';
    exportSvg(paperRef.current, `${name}.svg`).catch((e) => {
      console.error('SVG 导出失败', e);
      showToast('SVG 导出失败：' + String(e?.message || e).slice(0, 60));
    });
  };

  // 综合网表（用户裁决：沙盒的 Verilog 导出改名为「综合网表」——它就是网表：
  // 门/触发器/常量转结构化 Verilog；不再单独提供第二个"Verilog"出口）
  const handleExportNetlist = () => {
    if (!paperRef.current || !activeFile) return;
    try {
      const name = activeFile.name.replace(/\.djs$/i, '').replace(/[^\w]/g, '_') || 'sandbox_circuit';
      const v = generateVerilog(paperRef.current, name);
      const blob = new Blob([v], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${name}.v`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('综合网表已导出：' + name + '.v');
    } catch (e: any) {
      showToast('综合网表导出失败：' + String(e?.message || e).slice(0, 60));
    }
  };

  /**
   * 把一个 Subcircuit 实例**换绑**到另一个部件文件（编译模式「模块绑定」在沙盒侧
   * 的显式入口）。
   *
   * 必须重建而不是就地 set：digitaljs 的 Subcircuit.initialize 只在构造期按内图
   * 的 Input/Output 生成端口表，改 celltype/graph 都不会重算端口 —— 就地改会让
   * 已接的线指到不存在的端口上。这里按端口 id 把原连线接回，接不上的丢弃并计数。
   */
  const rebindSubcircuitCell = useCallback((cellId: string, newName: string) => {
    const paper = paperRef.current;
    const digitaljs = (window as any).digitaljs;
    if (!paper || !digitaljs) { showToast('画布尚未就绪'); return; }
    const old = paper.model.getCell(cellId);
    if (!old || old.get('type') !== 'Subcircuit') return;
    const cellsSnap = resolveDefCells(newName, scopeRef.current);
    if (!cellsSnap?.cells?.length) { showToast(`部件「${newName}」没有可用定义，换绑取消`); return; }
    const linkSpecs: any[] = [];
    for (const link of paper.model.getConnectedLinks(old)) {
      const s = link.get('source'), t = link.get('target');
      const isSrc = s?.id === old.id;
      const other = isSrc ? t : s;
      linkSpecs.push({
        isSrc, otherId: other?.id, otherPort: other?.port,
        port: (isSrc ? s : t)?.port, netname: link.get('netname'), vertices: link.get('vertices'),
      });
    }
    const pos = old.get('position') || { x: 0, y: 0 };
    const oldLabel = old.get('label');
    try { paper.model.getConnectedLinks(old).forEach((l: any) => l.remove()); } catch { /* ignore */ }
    try { old.remove(); } catch { /* ignore */ }
    const Graph = (paper.model as any).constructor;
    const inner = buildInnerGraph(digitaljs, Graph, cellsSnap, paper.model._display3vl);
    const cell = new digitaljs.cells.Subcircuit({
      type: 'Subcircuit', graph: inner, subcircuitGraph: cellsSnap, celltype: newName,
      position: { x: pos.x, y: pos.y }, id: cellId,
    });
    paper.model.addCell(cell);
    try { if (oldLabel) cell.set('label', oldLabel); } catch { /* ignore */ }
    let dropped = 0;
    for (const spec of linkSpecs) {
      if (!spec.otherId || !spec.port) { dropped++; continue; }
      try {
        if (!cell.getPort(spec.port)) { dropped++; continue; }   // 新定义没有这个端口
        const other = paper.model.getCell(spec.otherId);
        if (!other) { dropped++; continue; }
        const args: any = { netname: spec.netname, signal: 'x' };
        // 端点必须用 `id`（沙盒全线一致）：joint 原生的 `cell` 写法能画出来，但
        // serializeGraphCells / loadCells 认的是 `id` —— 用错就是「当场看着对，
        // 存盘重载线全丢」。
        if (spec.isSrc) { args.source = { id: cellId, port: spec.port }; args.target = { id: spec.otherId, port: spec.otherPort }; }
        else { args.source = { id: spec.otherId, port: spec.otherPort }; args.target = { id: cellId, port: spec.port }; }
        if (spec.vertices?.length) args.vertices = spec.vertices;
        paper.model.addCell(new digitaljs.cells.Wire(args));
      } catch { dropped++; }
    }
    scheduleDrcRef.current();
    commitRef.current();
    showToast(`已换绑到「${newName}」${dropped ? `，${dropped} 条连线因新定义没有对应端口被断开` : ''}`);
  }, [showToast]);

  /** 在指定屏幕坐标处放置自定义门（右键菜单二级导航用）；placeCustomGate 走视口中心。
   *  R39 绑定放置：部件文件（可编辑 .djs）→ resolveDefCells（自足 cells）→
   *  buildInnerGraph 合成活图 → 实例按 celltype 名绑定。 */
  const placeCustomGateAt = useCallback((gate: CustomGate, pos: { x: number; y: number }) => {
    const paper = paperRef.current;
    const digitaljs = (window as any).digitaljs;
    if (!paper || !digitaljs) { showToast('画布尚未就绪，无法放置自定义门'); return; }
    // 环检测（用户报障 2026-10-11）：把 X 放进 X 自己的定义文件、或 X 的依赖闭包
    // 回指当前部件文件 ⇒ 必成循环依赖——展开渲染会靠断环空壳兜底，但那是退化态，
    // 放置当场就该拒绝并说清环路径。
    const cur = activeFileRef.current;
    const curPartName = cur && cur.role === 'part'
      ? baseName(cur.name).replace(/\.(djs|gate|json)$/i, '') : '';
    if (curPartName) {
      if (gate.name === curPartName) {
        showToast(`不能把部件「${curPartName}」放进它自己的定义里（自嵌套循环）`);
        return;
      }
      const cyc = findPartCycle(gate.name, scopeRef.current);
      if (cyc && cyc.includes(curPartName)) {
        showToast(`循环依赖：放置后将形成 ${[curPartName, ...cyc].join(' → ')}，已阻止`);
        return;
      }
    }
    const cellsSnap = resolveDefCells(gate.name, scopeRef.current);
    if (!cellsSnap?.cells?.length) {
      showToast(`部件「${gate.name}」内容为空或已损坏，请打开编辑后重新保存`);
      return;
    }
    try {
      const Graph = (paper.model as any).constructor;
      const inner = buildInnerGraph(digitaljs, Graph, cellsSnap, paper.model._display3vl);
      // R40 修复「found id duplicities in ports」：digitaljs 的 Subcircuit.initialize
      // 用 IO cell 的 `net` 属性作为 port id（subcircuit.mjs L50/L53）—— 门定义里两个
      // 引脚同名（默认都未命名）时 ports id 重复，放置直接失败。这里在构建 inner 后
      // 对 IO 引脚做唯一化命名（in1/in2…、out1/out2…）。
      try {
        const ioCells = inner.getCells().filter((c: any) => ['Input', 'Output'].includes(c.get('type')));
        const used = new Set<string>();
        let inN = 0, outN = 0;
        for (const c of ioCells) {
          const isInput = c.get('type') === 'Input';
          let net = String(c.get('net') || '').trim();
          if (!net || used.has(net)) {
            net = (isInput ? `in${++inN}` : `out${++outN}`);
            while (used.has(net)) net += '_';
            c.set('net', net);
            // 同步 ioname（digitaljs IO cell 的显示/端口名来源）
            try { c.attr('ioname/text', net); c.set('ioname', net); } catch { /* older builds */ }
          }
          used.add(net);
        }
      } catch { /* best effort — dedup is defensive */ }
      const sub = new digitaljs.cells.Subcircuit({
        type: 'Subcircuit',
        graph: inner,
        subcircuitGraph: cellsSnap,
        celltype: gate.name,
        position: { x: snapVal(pos.x), y: snapVal(pos.y) },
      });
      paper.model.addCell(sub);
      try {
        const ports = sub.get('ports');
        if (ports) sub.set('ports', { ...ports });
      } catch {}
      setSelectionRef.current([sub.id]);
      commitRef.current();
    } catch (e) {
      console.warn('[自定义门] 放置失败:', e);
      showToast(`自定义门「${gate.name}」放置失败：${String((e as any)?.message || e).slice(0, 80)}`);
    }
  }, [snapVal, showToast]);

  const placeCustomGate = useCallback((gate: CustomGate) => {
    placeCustomGateAt(gate, viewportCenter());
  }, [placeCustomGateAt, viewportCenter]);

  const handleSaveGate = () => {
    const paper = paperRef.current;
    if (!paper || !activeFile) return;
    const cells = paper.model.getCells();
    const hasIn = cells.some((c: any) => c.get('type') === 'Input');
    const hasOut = cells.some((c: any) => c.get('type') === 'Output');
    if (!hasIn || !hasOut) {
      setGateError('至少需要 1 个输入引脚和 1 个输出引脚');
      return;
    }
    const name = gateName.trim();
    if (!name) { setGateError('请输入自定义门名称'); return; }
    // R39 绑定入库：整图存为**可编辑部件文件**（.djs，同文件夹）；画布上已放置的
    // 绑定式子部件递归入库并按名绑定 —— 与「复制到沙盒」递归迁移同语义。
    const r = saveGateFromCellsToFolder(name, serializePaper(paper), scopeRef.current);
    refreshGates();
    // 存为部件后自检环（保存不拦——数据已在画布，拦了伤用户；如实警告 + 渲染断环兜底）
    try {
      const cyc = findPartCycle(name, scopeRef.current);
      setCycleWarn(cyc);
      if (cyc) showToast(`部件「${name}」存在循环依赖：${cyc.join(' → ')}（展开将显示空壳⟲）`);
    } catch { /* ignore */ }
    setSavingGate(false);
    setGateName('');
    setGateError(null);
    showToast(`已保存部件「${name}」为可编辑电路${r.nested ? `（${r.nested} 个子部件已递归入库绑定）` : ''}`);
    forceUpdate(n => 1 + n);
  };

  const handleDeleteGate = (g: CustomGate) => {
    if (deleteGateId !== g.id) { setDeleteGateId(g.id); return; }
    // 部件真身是沙盒文件（role:'part'），删部件 = 删那个文件；遗留存档顺带清掉。
    try { sandboxStore.remove(g.id); } catch { /* 文件可能已被删 */ }
    try { customGateStore.remove(g.id); } catch { /* 无遗留档 */ }
    setDeleteGateId(null);
    refreshGates();
    refreshList();
    refreshFolders();
    showToast(`已删除部件「${g.name}」；画布上已放置的同名实例将无法展开（内嵌快照可兜底显示）`);
  };

  // 删除确认改由右键菜单直接执行（与 IDE 文件系统一致），旧的 × 两步确认已移除

  // ============ 文件管理：右键菜单 / 重命名 / 新建 / 粘贴 / 导入导出（对齐 IDE 文件系统） ============

  // 文件系统动作后统一同步：文件树、文件夹、**部件清单**（部件真身就是文件，
  // 删文件要立刻从「自定义部件」里消失，新建/改名要立刻出现并可绑定放置）
  const syncAfterFsOp = () => { refreshList(); refreshFolders(); refreshGates(); };

  // R39：部件是可编辑 .djs 画布文件，与普通电路文件一样单击即打开编辑。
  // 旧 kind:'gate'（迁移前的只读定义）仍走内部查看器兜底。
  const handleFileOpen = (f: SandboxFile) => {
    if (f.kind === 'gate') {
      const name = baseName(f.name).replace(/\.gate$/i, '');
      setInnerCell({ get: (k: string) => (k === 'celltype' ? name : undefined) });
      return;
    }
    handleOpen(f);
    setFileSelIds(new Set([f.id]));
  };

  const handleFileSelectToggle = (id: string) => {
    setFileSelIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleDeleteFiles = (ids: string[]) => {
    for (const id of ids) sandboxStore.remove(id);
    if (activeFile && ids.includes(activeFile.id)) setActiveFile(null);
    setFileSelIds(new Set());
    syncAfterFsOp();
    showToast(`已删除 ${ids.length} 个文件`);
  };

  /** 扫描电路 JSON 里引用的自定义门（Subcircuit.celltype）名称集合（顶层扫描；
   *  嵌套依赖由门定义闭包 walkGateClosure 递归补齐 —— R37 绑定式存档内嵌
   *  快照已被剥离，嵌套引用住在定义文件里）。 */
  const gateNamesInJson = (text: string): Set<string> => {
    const s = new Set<string>();
    const walk = (j: any, depth = 0) => {
      if (!j || depth > 16) return; // 防御性深度上限（自引用坏档）
      for (const c of j?.cells || []) {
        if (c?.type !== 'Subcircuit') continue;
        if (c.celltype) s.add(String(c.celltype));
        if (c.subcircuitGraph) walk(c.subcircuitGraph, depth + 1);
      }
    };
    try { walk(JSON.parse(text)); } catch { /* ignore */ }
    return s;
  };

  /** 部件依赖闭包：从种子名出发，沿部件文件里 Subcircuit.celltype 引用递归
   *  收集（与编译模式 resolveDependencies 同语义），供 .djs 导出随行。
   *  返回每个部件的 {name, cells}（cells = 该部件文件的可编辑画布内容）。 */
  const walkGateClosure = (seeds: Set<string>, scope: string): { name: string; cells: any }[] => {
    const out: { name: string; cells: any }[] = [];
    const seen = new Set<string>();
    const queue = [...seeds];
    while (queue.length) {
      const name = queue.shift()!;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const cells = resolveDefCells(name, scope);
      if (!cells) continue;
      out.push({ name, cells });
      const collect = (cs: any[], depth = 0) => {
        if (!cs || depth > 16) return;
        for (const c of cs) {
          if (c?.type !== 'Subcircuit' || !c.celltype) continue;
          if (!seen.has(String(c.celltype))) queue.push(String(c.celltype));
        }
      };
      collect(cells.cells);
    }
    return out;
  };

  const handleExportDjs = (f: SandboxFile) => {
    const cur = sandboxStore.get(f.id) ?? f;
    // 部件随文件走（R39）：把电路引用到的部件**依赖闭包**一并发出（cells 画布
    // 格式），外部共享时打开即自动补注册为可编辑部件，不依赖本机定义。
    const dir = dirOf(cur);
    let payload: string;
    let carried = 0;
    if (cur.kind === 'gate' && cur.circuitJson) {
      // 旧 .gate 定义文件本身导出：直接导出定义内容
      payload = cur.circuitJson;
    } else {
      payload = cur.graphJson;
      try {
        const obj = JSON.parse(cur.graphJson);
        const used = gateNamesInJson(cur.graphJson);
        const defs = walkGateClosure(used, dir);
        if (defs.length) {
          obj.customParts = defs;
          payload = JSON.stringify(obj);
          carried = defs.length;
        }
      } catch { /* 解析失败则原样导出 */ }
    }
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = baseName(cur.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast(carried ? `已导出 ${baseName(cur.name)}（含 ${carried} 个部件定义）` : `已导出 ${baseName(cur.name)}`);
  };

  const handlePasteInto = (folder: string) => {
    const cb = fileClipboard;
    if (!cb || !cb.ids.length) return;
    if (cb.cut) {
      sandboxStore.moveFilesToFolder(cb.ids, folder);
      const carried = carryPartDefsAfterMove(cb.ids, folder);
      setFileClipboard(null);
      syncAfterFsOp();
      showToast(`已移动 ${cb.ids.length} 个文件${carried ? `，随行补齐 ${carried} 个部件定义` : ''}`);
    } else {
      for (const id of cb.ids) sandboxStore.copyFile(id, folder);
      showToast(`已粘贴 ${cb.ids.length} 个文件`);
    }
    if (activeFile?.id) setActiveFile(sandboxStore.get(activeFile.id));
    syncAfterFsOp();
  };

  const uniqueDjsName = (list: SandboxFile[], name: string) => {
    let n = name.endsWith('.djs') ? name : name + '.djs';
    let i = 1;
    const stem = n.replace(/\.djs$/, '');
    while (list.some((f) => f.name === n)) { n = `${stem}_${i}.djs`; i++; }
    return n;
  };

  const handleFileRenameCommit = (t: RenameTarget, name: string) => {
    name = name.trim();
    if (!name) return;
    const f = sandboxStore.get(t.key);
    if (!f) return;
    const isPart = f.role === 'part';
    if (isPart || f.kind === 'gate') {
      // 部件改名 = 重绑定：实例按 celltype 名称绑定部件文件（编译模式语义），
      // 改名后全库扫描改写引用，展开/放置继续命中新部件。
      const base = name.replace(/\.(djs|gate|json)$/i, '');
      const oldName = baseName(f.name).replace(/\.(djs|gate|json)$/i, '');
      const n = renamePartDef(t.key, base);
      // 必须在 refreshGates（会触发画布 effect 重建 → cleanup 持久化）之前
      // 同步活画布：否则画布上仍是旧 celltype 的活实例会把存储盖回去。
      let live = 0;
      try { live = rebindLiveGraph(paperRef.current?.model, oldName, base); } catch { /* ignore */ }
      // 活画布引用的文件实体也要刷新：effect 重建时读 activeFile.graphJson，
      // 若是改名前的旧快照，重建会把旧 celltype 带回来（实测踩坑）。
      if (activeFile) {
        const fresh = sandboxStore.get(activeFile.id);
        if (fresh) setActiveFile(fresh);
      }
      refreshGates();
      syncAfterFsOp();
      showToast(`已重命名为「${base}」${n || live ? `，${n} 处存储引用 + ${live} 个画布实例已重绑定` : ''}`);
      return;
    }
    const dir = dirOf(f);
    // R101：同名去重交给 store（照抄编译模式的 ` (1)` 格式），不再用沙盒旧的 `_1` 后缀
    sandboxStore.rename(t.key, dir ? dir + '/' + name : name);
    if (activeFile?.id === t.key) setActiveFile(sandboxStore.get(t.key));
    syncAfterFsOp();
  };

  const handleFolderRenameCommit = (t: RenameTarget, name: string) => {
    name = name.trim();
    if (!name) return;
    sandboxStore.renameFolder(t.key, name);
    if (activeFile?.id) setActiveFile(sandboxStore.get(activeFile.id));
    syncAfterFsOp();
  };

  const handleCreateCommit = (t: CreateTarget, name: string) => {
    name = name.trim();
    if (!name) return;
    if (t.kind === 'folder') {
      const base = t.folder ? t.folder + '/' + name : name;
      sandboxStore.createFolder(base);
      showToast(`已创建文件夹 ${base}`);
    } else {
      const fullName = uniqueDjsName(files, t.folder ? t.folder + '/' + name : name);
      const f = sandboxStore.create(fullName);
      sandboxStore.setActiveId(f.id);
      setActiveFile(f);
      showToast(`已创建 ${fullName}`);
    }
    syncAfterFsOp();
  };

  /**
   * 移动/剪切进了新文件夹，就把**随行的部件定义**补上（用户裁决 R-B：跨文件夹拖入自动 ensure-def）。
   *
   * 为什么单独要这一步：粘贴（`loadCells` 路径）、剪贴板复制、导入 `.djs` 三条路都跑过
   * `ensureDefsFromCells`，唯独"移动文件"只改 folder 再 sync ⇒ 画布里那些**只有内嵌快照、
   * 还没有同名部件文件**的实例（旧存档、部件被删过的存档）进了新文件夹后仍靠「根→全库」
   * 兜底解析：文件夹不自治，且同文件夹里一旦出现同名部件，解析结果会随遮蔽规则翻面。
   * 按**目标文件夹**作用域补一次定义，让搬过去的文件在新位置自足。
   *
   * 返回这次新建了几颗部件文件（给提示条说实话用）。
   */
  const carryPartDefsAfterMove = (ids: string[], folder: string): number => {
    const before = new Set(sandboxStore.list().map((f) => String(f.id)));
    for (const id of ids) {
      const f = sandboxStore.get(id);
      if (!f || f.role === 'part') continue;      // 部件文件自己就是定义，没有"随行"一说
      try {
        const obj = JSON.parse(f.graphJson || '{}');
        if (Array.isArray(obj?.cells)) ensureDefsFromCells(obj.cells, folder);
      } catch { /* 不是画布格式：不替用户编定义，静默跳过这一颗 */ }
    }
    return sandboxStore.list().filter((f) => !before.has(String(f.id))).length;
  };

  const handleMoveFiles = (ids: string[], folder: string) => {
    sandboxStore.moveFilesToFolder(ids, folder);
    const carried = carryPartDefsAfterMove(ids, folder);
    if (activeFile?.id && ids.includes(activeFile.id)) setActiveFile(sandboxStore.get(activeFile.id));
    syncAfterFsOp();
    showToast(`已移动 ${ids.length} 个文件${folder ? ' 到 ' + folder : ' 到根目录'}${carried ? `，随行补齐 ${carried} 个部件定义` : ''}`);
  };

  const handleImportDjsFiles = async (list: FileList | null) => {
    if (!list || !list.length) return;
    let imported = 0;
    let partsCarried = 0;
    for (const file of Array.from(list)) {
      try {
        const text = await file.text();
        const obj = JSON.parse(text);
        // 目标文件：与源文件同名（保留文件夹结构由用户后续移动）
        const name = uniqueDjsName(sandboxStore.list(), file.name.replace(/\.(json|djs)$/i, '') + '.djs');
        const dir = dirOfName(name);
        // R39：.djs 内嵌的 customParts（cells）自动注册为同文件夹的可编辑部件；
        // 兼容旧 customGates（circuitJson / graphJson）。
        if (Array.isArray(obj.customParts)) {
          for (const p of obj.customParts) {
            if (!p?.name) continue;
            const cells = p.cells || (p.graphJson ? tryParse(p.graphJson) : null);
            if (cells) { savePartFile(String(p.name), cells, dir); partsCarried++; }
          }
          delete obj.customParts; // 仅作传输载体，落库不重复存储（绑定式存档）
        }
        if (Array.isArray(obj.customGates)) {
          for (const g of obj.customGates) {
            if (!g?.name) continue;
            if (g.circuitJson) {
              try { savePartFile(String(g.name), circuitJsonToCells(JSON.parse(String(g.circuitJson))), dir); partsCarried++; } catch { /* ignore */ }
            } else if (g.graphJson) {
              const cj = tryParse(String(g.graphJson));
              if (cj) { savePartFile(String(g.name), cj, dir); partsCarried++; }
            }
          }
          delete obj.customGates;
        }
        if (!Array.isArray(obj?.cells)) {
          // 旧 .gate 定义文件（编译格式）也直接导入为可编辑部件
          const gname = file.name.replace(/\.(gate\.json|gate|json)$/i, '');
          if (obj?.devices) {
            savePartFile(gname, circuitJsonToCells(obj), dir);
            partsCarried++;
            continue;
          }
          throw new Error('not a circuit');
        }
        // 内嵌快照里引用的定义先补齐（仅补缺失），再落库（save 走绑定剥离）
        ensureDefsFromCells(obj.cells, dir);
        const f = sandboxStore.create(name);
        sandboxStore.save(f.id, stripBoundInlineJson(JSON.stringify(obj), dir));
        imported++;
      } catch {
        showToast(`导入失败：${file.name} 不是有效的电路文件`);
      }
    }
    if (partsCarried) { refreshGates(); showToast(`已从文件导入 ${partsCarried} 个部件定义`); }
    if (imported) showToast(`已导入 ${imported} 个电路文件`);
    syncAfterFsOp();
  };

  const tryParse = (s: string): any | null => { try { return JSON.parse(s); } catch { return null; } };

  const handleFileCtx = (e: React.MouseEvent, f: SandboxFile) => {
    e.preventDefault();
    const inSel = fileSelIds.has(f.id);
    if (!inSel) setFileSelIds(new Set([f.id]));
    const multi = inSel && fileSelIds.size > 1;
    const ids = multi ? Array.from(fileSelIds) : [f.id];
    // 门定义文件（R37）：不是画布，菜单收敛为重命名（=重绑定）/导出/删除
    if (f.kind === 'gate' && !multi) {
      // R101：与编译模式一样**点完弹窗再填**（原来是菜单里直接内联输入框）
      openMenuAt(e.clientX, e.clientY, '', [
        { label: '重命名（引用将重绑定）', action: async () => {
          const v = await askFs({ title: '重命名门定义', label: '名称', defaultValue: baseName(f.name).replace(/\.gate$/i, ''), confirmLabel: '重命名', validate: V_SB_NAME });
          if (v) handleFileRenameCommit({ kind: 'file', key: f.id }, v);
        } },
        { label: '导出 JSON', action: () => handleExportDjs(f) },
        { label: '---' },
        { label: '删除门定义', danger: true, action: () => handleDeleteFiles([f.id]) },
      ]);
      return;
    }
    const items: ContextMenuItem[] = multi ? [
      { label: '复制', action: () => { setFileClipboard({ ids, cut: false }); showToast(`已复制 ${ids.length} 个文件`); } },
      { label: '剪切', action: () => { setFileClipboard({ ids, cut: true }); showToast(`已剪切 ${ids.length} 个文件`); } },
      { label: '绑定...', action: () => setFileBindingId(f.id) },
      { label: `删除 ${ids.length} 个文件`, danger: true, action: () => handleDeleteFiles(ids) },
    ] : [
      { label: '打开', action: () => { const cur = sandboxStore.get(f.id); if (cur) handleFileOpen(cur); } },
      // R100：与编译模式一致的文件级「绑定...」（子电路实例按 celltype 名绑定部件文件）
      { label: '绑定...', action: () => setFileBindingId(f.id) },
      // R101：编译模式的文案就是「重命名」，点击后弹 PromptDialog
      { label: '重命名', action: async () => {
        const v = await askFs({ title: '重命名文件', label: '文件名', defaultValue: baseName(f.name), confirmLabel: '重命名', validate: V_SB_NAME });
        if (v) handleFileRenameCommit({ kind: 'file', key: f.id }, v);
      } },
      { label: '创建副本', action: () => { const c = sandboxStore.duplicate(f.id); syncAfterFsOp(); if (c) showToast(`已创建副本 ${baseName(c.name)}`); } },
      { label: '复制', action: () => { setFileClipboard({ ids, cut: false }); showToast('已复制到剪贴板'); } },
      { label: '剪切', action: () => { setFileClipboard({ ids, cut: true }); showToast('已剪切到剪贴板'); } },
      { label: '---' },
      { label: '导出 JSON', action: () => handleExportDjs(f) },
      { label: '删除', danger: true, action: () => handleDeleteFiles(ids) },
    ];
    openMenuAt(e.clientX, e.clientY, '', items);
  };

  const handleFolderCtx = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      { label: '新建文件...', action: async () => {
        const v = await askFs({ title: `新建文件 in ${path}`, label: '文件名', defaultValue: 'new_circuit.djs', confirmLabel: '创建', validate: V_SB_NAME });
        if (v) handleCreateCommit({ kind: 'file', folder: path }, v);
      } },
      { label: '新建文件夹...', action: async () => {
        const v = await askFs({ title: `新建子文件夹 in ${path}`, label: '文件夹名称', defaultValue: 'child', confirmLabel: '创建', validate: V_SB_NAME });
        if (v) handleCreateCommit({ kind: 'folder', folder: path }, v);
      } },
      { label: '粘贴', disabled: !fileClipboard, action: () => handlePasteInto(path) },
      { label: '---' },
      { label: '重命名文件夹', action: async () => {
        const v = await askFs({ title: '重命名文件夹', label: '文件夹名称', defaultValue: baseName(path), confirmLabel: '重命名', validate: V_SB_NAME });
        if (v) handleFolderRenameCommit({ kind: 'folder', key: path }, v);
      } },
      // R101：照抄编译模式——**连同内部文件一起删除**，且删除前弹确认把话说清楚
      // （旧实现是"文件移回根目录"，与编译模式的 deleteFolder 语义不一致）
      { label: '删除文件夹', danger: true, action: async () => {
        const n = sandboxStore.countFilesUnder(path);
        const yes = await askFsConfirm({
          title: '删除文件夹', danger: true, confirmLabel: '删除',
          message: `确定删除文件夹「${path}」吗？`,
          detail: n ? `文件夹内的 ${n} 个文件（含子文件夹）会一并删除，此操作无法撤销。` : '文件夹内的文件会一并删除，此操作无法撤销。',
        });
        if (!yes) return;
        sandboxStore.removeFolder(path);
        if (activeFile?.id) setActiveFile(sandboxStore.get(activeFile.id));
        syncAfterFsOp();
        showToast(`已删除文件夹 ${path}${n ? `，同时删除其中 ${n} 个文件` : ''}`);
      } },
      { label: '---' },
      { label: '刷新', action: () => { refreshFolders(); syncAfterFsOp(); showToast('已刷新文件列表'); } },
    ];
    openMenuAt(e.clientX, e.clientY, '', items);
  };

  const handleRootCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    // 面板容器也挂了 root 菜单（R34）：树容器冒泡上来的事件在此拦住，避免双重打开
    e.stopPropagation();
    // 顺序与编译模式空白区菜单一致：新建文件 / 新建文件夹 / 导入文件… / — / 粘贴 / 刷新
    const items: ContextMenuItem[] = [
      { label: '新建文件', action: async () => {
        const v = await askFs({ title: '新建文件', label: '文件名', defaultValue: 'new_circuit.djs', confirmLabel: '创建', validate: V_SB_NAME });
        if (v) handleCreateCommit({ kind: 'file', folder: '' }, v);
      } },
      { label: '新建文件夹', action: async () => {
        const v = await askFs({ title: '新建文件夹', label: '文件夹名称', defaultValue: 'my_folder', confirmLabel: '创建', validate: V_SB_NAME });
        if (v) handleCreateCommit({ kind: 'folder', folder: '' }, v);
      } },
      { label: '导入文件...', action: () => importInputRef.current?.click() },
      { label: '---' },
      { label: '粘贴', disabled: !fileClipboard, action: () => handlePasteInto('') },
      { label: '刷新', action: () => { refreshFolders(); syncAfterFsOp(); showToast('已刷新文件列表'); } },
    ];
    openMenuAt(e.clientX, e.clientY, '', items);
  };

  // —— R35：部件 / 层次结构面板右键菜单（此前只有文件面板有，其余面板右键
  //    被 App 的全局 contextmenu preventDefault 吞掉，什么也不弹）——
  const handleModulesCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.clientX, e.clientY, '部件', [
      { label: '展开全部分组', action: () => setOpenGroups(new Set(PALETTE.map(g => g.group))) },
      { label: '折叠全部分组', action: () => setOpenGroups(new Set()) },
      { label: '---' },
      { label: '新建部件（保存当前电路）', action: () => setSavingGate(true) },
      { label: '放置部件', hint: '▶', action: () => {
        setTimeout(() => openMenuAt(e.clientX, e.clientY, '放置部件', gates.length
          ? gates.map(g => ({ label: g.name, hint: '部件', action: () => placeCustomGate(g) }))
          : [{ label: '（暂无自定义门）', disabled: true }]), 0);
      } },
    ]);
  };

  const handleHierarchyCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const subIds = (() => {
      const paper = paperRef.current;
      if (!paper) return [] as string[];
      return paper.model.getCells()
        .filter((c: any) => !c.isLink() && c.get('type') === 'Subcircuit')
        .map((c: any) => String(c.id));
    })();
    openMenuAt(e.clientX, e.clientY, '层次结构', [
      { label: '展开全部子电路', disabled: !subIds.length, action: () => setExpandedSubs(new Set(subIds)) },
      { label: '收起全部子电路', disabled: !subIds.length, action: () => setExpandedSubs(new Set()) },
      { label: '---' },
      { label: '刷新', action: () => forceUpdate(n => n + 1) },
    ]);
  };

  /** 侧栏容器右键分发：按当前面板弹各自的菜单（行级菜单会 stopPropagation 优先） */
  const handlePanelCtx = (e: React.MouseEvent) => {
    if (leftPanel === 'files') handleRootCtx(e);
    else if (leftPanel === 'modules') handleModulesCtx(e);
    else if (leftPanel === 'hierarchy') handleHierarchyCtx(e);
  };

  const canUndo = historyRef.current.idx > 0;
  const canRedo = historyRef.current.idx < historyRef.current.stack.length - 1;
  const selCount = selectionRef.current.size;

  // ---- 层次结构面板：选中并居中到指定器件（点击层级节点 / DRC 定位都用它） ----
  const focusCell = useCallback((cellId: string) => {
    const paper = paperRef.current;
    if (!paper) return;
    setSelectionRef.current([cellId]);
    try {
      const cell = paper.model.getCell(cellId);
      if (!cell) return;
      const pos = cell.get('position') || { x: 0, y: 0 };
      const sz = cell.size ? cell.size() : { width: 60, height: 32 };
      const sc = paper.scale().sx || 1;
      const r = paper.el.getBoundingClientRect();
      paper.translate(
        r.width / 2 - (pos.x + sz.width / 2) * sc,
        r.height / 2 - (pos.y + sz.height / 2) * sc,
      );
    } catch { /* ignore */ }
  }, []);

  /** 层次结构数据：画布器件按类型分组；自定义门（Subcircuit）可展开其内部电路 */
  const hierarchyTree = (() => {
    const paper = paperRef.current;
    const byType = new Map<string, any[]>();
    let links = 0;
    if (paper) {
      for (const c of paper.model.getCells()) {
        if (typeof c.isLink === 'function' && c.isLink()) { links++; continue; }
        const t = String(c.get('type') || '?');
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t)!.push(c);
      }
    }
    return {
      links,
      groups: Array.from(byType.entries())
        .map(([type, list]) => ({ type, label: CN_NAME[type] || type, list }))
        .sort((a, b) => b.list.length - a.list.length),
    };
  })();

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      <style>{`
        /* 聚焦/选中高亮＝主题紫。⚠ 特异度必须压过 index.css 的主题规则
           [data-theme=…] .joint-paper .cell .body（0,4,0, !important）——否则
           stroke-width 生效而颜色被灰盖掉（深色主题下看不清，R99 他报的那格）。
           这里用 (0,6,0) 的 [data-theme] .joint-paper .sm-selected 前缀＋!important。 */
        [data-theme] .joint-paper .sm-selected .body, [data-theme] .joint-paper .sm-selected .gate,
        [data-theme] .joint-paper .sm-selected .btnface, [data-theme] .joint-paper .sm-selected .led,
        [data-theme] .joint-paper .sm-selected path.decor,
        [data-theme] .joint-paper .sm-selected .joint-port-body {
          stroke: var(--accent-hover) !important;
          stroke-width: 2.5 !important;
        }
        [data-theme] .joint-paper .sm-selected .connection {
          stroke: var(--accent-hover) !important;
          stroke-width: 3 !important;
        }
        /* 端口圆点与位宽/引脚小字也跟随主题紫，整颗器件一眼可辨 */
        [data-theme] .joint-paper .sm-selected circle.port {
          fill: var(--accent-hover) !important;
        }
        .sm-illegal .connection {
          stroke: #ef4444 !important;
          stroke-width: 3 !important;
          stroke-dasharray: 7 4 !important;
        }
        /* 连线磁吸：吸附中的目标端口高亮，让用户看清会连到哪 */
        .sm-port-snap circle.port {
          stroke: var(--accent) !important;
          stroke-width: 3 !important;
          fill: var(--accent) !important;
        }
        .sm-port-snap text.iolabel, .sm-port-snap text.bits {
          fill: var(--accent) !important;
          font-weight: 600;
        }
      `}</style>
      {sidebarCollapsed ? (
        <div style={{
          width: 36, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0,
          background: 'var(--sidebar-bg)', paddingTop: 8,
        }}>
          <button onClick={onToggleSidebar} title={`展开${SANDBOX_PANEL_TITLE[leftPanel] || '侧栏'}`}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: 4, lineHeight: 1, display: 'inline-flex' }}>
            <ChevronRight size={14} />
          </button>
        </div>
      ) : (
      <div data-sandbox-sidebar style={{
        width: sidebarW, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        // zIndex:2 —— 把整个侧栏（含右缘 3px 拖拽手柄）抬到画布 wrapper 之上，
        // 否则外露的手柄条被后渲染的绝对定位画布盖住，拖不动；侧栏内部
        // 局部层级仍由内容容器 zIndex:1 > 手柄 决定，按钮点击不受影响。
        background: 'var(--sidebar-bg)', position: 'relative', zIndex: 2,
      }}>
        {/* 右缘拖拽手柄（问题 1）：悬停变色，拖动调宽 180–500px。
            下方两个内容容器带 position:relative + zIndex:1 —— 盖在手柄之上，
            按钮点击不被拦截；手柄只在未被内容盖住的右缘空隙接收事件。 */}
        <div
          onMouseDown={onSidebarWDragStart}
          title="拖动调整宽度"
          style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%',
            cursor: 'col-resize' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        />
        {/* 面板标题栏：与编译模式 Sidebar 头部同一套（padding/边框/字重/字距/图标） */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'relative', zIndex: 1 }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {SANDBOX_PANEL_TITLE[leftPanel] || '文件'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {onExitSandbox && (
              <button onClick={onExitSandbox} data-sandbox-exit title="退出沙盒，返回电路 / 代码视图"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                  cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
                <Undo2 size={14} />
              </button>
            )}
            {/* R101：标题栏按钮组**照抄编译模式 Sidebar**——导入文件 / 新建文件 /
                新建文件夹 / 刷新 / 收起侧栏（同一套 padding、hover 与 lucide 图标）。
                ⚠ `button[title="新建文件"]` 是 `tests/_ui.cjs#newSandboxFile` 的夹具锚点：
                它点完就期望文件已建好，所以这颗**不走弹窗**（弹窗版在右键菜单里）。 */}
            <button onClick={() => importInputRef.current?.click()} title="导入文件"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
              <Plus size={14} />
            </button>
            {/* R102：新建文件改为**弹窗命名**（与编译模式一致）——早前是点了直接自动命名，
                用户点的是"新建"却没机会起名。⚠ 测试夹具 `_ui.cjs#newSandboxFile` 已同步
                改成"点按钮 → 填弹窗 → 确认"，两边必须一起改。 */}
            <button onClick={async () => {
              const v = await askFs({ title: '新建文件', label: '文件名', defaultValue: 'new_circuit', confirmLabel: '创建', validate: V_SB_NAME });
              if (v) handleNew(v);
            }} title="新建文件"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
              <FileText size={14} />
            </button>
            <button onClick={async () => {
              const v = await askFs({ title: '新建文件夹', label: '文件夹名称', defaultValue: 'my_folder', confirmLabel: '创建', validate: V_SB_NAME });
              if (v) handleCreateCommit({ kind: 'folder', folder: '' }, v);
            }} title="新建文件夹"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
              <FolderPlus size={14} />
            </button>
            <button onClick={() => { refreshFolders(); syncAfterFsOp(); showToast('已刷新文件列表'); }} title="刷新"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
              <RefreshCw size={13} />
            </button>
            <button onClick={onToggleSidebar} title="收起侧栏"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
              <PanelLeftClose size={14} />
            </button>
          </div>
        </div>

        {/* 整个文件面板都响应「右键空白」：标题栏/滚动留白/树容器外的任意位置
            都能新建 / 导入 / 粘贴（行元素会 stopPropagation，优先弹自己的菜单）。
            仅文件面板挂载；部件 / 层次结构面板不弹文件菜单。 */}
        <div
          onContextMenu={handlePanelCtx}
          style={{ overflowY: 'auto', flex: 1, position: 'relative', zIndex: 1 }}>
          {leftPanel === 'files' && (
            <>
              <SandboxFileTree
                files={files}
                folders={folders}
                activeId={activeFile?.id ?? null}
                selectedIds={fileSelIds}
                onOpen={handleFileOpen}
                onSelectToggle={(id) => handleFileSelectToggle(id)}
                onFileContextMenu={handleFileCtx}
                onFolderContextMenu={handleFolderCtx}
                onRootContextMenu={handleRootCtx}
                onMoveFiles={handleMoveFiles}
                onMoveFolder={(path, newPath) => {
                  sandboxStore.moveFolder(path, newPath);
                  if (activeFile?.id) setActiveFile(sandboxStore.get(activeFile.id));
                  syncAfterFsOp();
                  showToast(`已移动文件夹 ${path} → ${newPath}`);
                }}
                onRenameCommit={(t, name) => t.kind === 'file'
                  ? handleFileRenameCommit(t, name)
                  : handleFolderRenameCommit(t, name)}
              />
              <input ref={importInputRef} type="file" accept=".djs,.json" multiple
                style={{ display: 'none' }}
                onChange={(e) => { handleImportDjsFiles(e.target.files); e.target.value = ''; }} />
            </>
          )}

          {leftPanel === 'hierarchy' && (
            <div style={{ padding: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                  当前电路（{hierarchyTree.groups.reduce((n, g) => n + g.list.length, 0)} 器件 / {hierarchyTree.links} 连线）
                </span>
                <button onClick={() => forceUpdate(n => n + 1)} title="刷新层次结构"
                  style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 3,
                    color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--fs-xs)', padding: '0 4px' }}>⟳</button>
              </div>
              {hierarchyTree.groups.length === 0 && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>画布为空</div>
              )}
              {hierarchyTree.groups.map(grp => (
                <div key={grp.type} style={{ marginBottom: 5 }}>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 2 }}>
                    {grp.label} <span style={{ opacity: .7 }}>×{grp.list.length}</span>
                  </div>
                  {grp.list.map((c: any) => {
                    const isSub = c.get('type') === 'Subcircuit';
                    const open = expandedSubs.has(String(c.id));
                    const inner = isSub && open ? (c.get('graph')?.getCells?.() || []).filter((x: any) => !(typeof x.isLink === 'function' && x.isLink())) : [];
                    return (
                      <div key={c.id}>
                        <div onClick={() => focusCell(String(c.id))}
                          title={`定位「${c.get('label') || c.get('celltype') || grp.label}」`}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 3,
                            cursor: 'pointer', fontSize: 'var(--fs-xs)', color: 'var(--text)' }}>
                          {isSub ? (
                            <span onClick={(e) => { e.stopPropagation(); setExpandedSubs(prev => {
                              const n = new Set(prev);
                              n.has(String(c.id)) ? n.delete(String(c.id)) : n.add(String(c.id));
                              return n;
                            }); }} style={{ color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
                          ) : <span style={{ width: 8 }} />}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.get('label') || c.get('celltype') || grp.label}
                          </span>
                          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.5625rem' }}>
                            {bitsSuffix(c)}
                          </span>
                        </div>
                        {isSub && open && (
                          <div style={{ marginLeft: 14, borderLeft: '1px solid var(--border-subtle)', paddingLeft: 6 }}>
                            {inner.length === 0 && (
                              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>（空）</div>
                            )}
                            {inner.map((x: any) => (
                              <div key={x.id} style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {CN_NAME[x.get('type')] || x.get('type')}
                              </div>
                            ))}
                            <div onClick={() => setInnerCell(c)} title="查看内部电路"
                              style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)', cursor: 'pointer' }}>
                              查看内部电路…
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {leftPanel === 'modules' && (<div style={{ padding: 8 }}>
          {PALETTE.map(group => {
            const open = openGroups.has(group.group);
            return (
            <div key={group.group} style={{ marginBottom: 4 }}>
              <div
                onClick={() => toggleGroup(group.group)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 'var(--fs-xs)', color: open ? 'var(--text)' : 'var(--text-muted)',
                  marginBottom: open ? 4 : 2, fontWeight: 600, cursor: 'pointer',
                  padding: '2px 4px', borderRadius: 3, background: open ? 'var(--surface-hover)' : 'transparent' }}
                title={open ? '收起分组' : '展开分组'}
              >
                <span>{group.group}</span>
                <span style={{ fontSize: '0.625rem', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
              </div>
              {open && group.items.map(it => (
                <button key={it.label || it.type} onClick={() => doAddCell(it)} data-gate={it.type}
                  title={`放置${it.label || CN_NAME[it.type] || it.type}（${it.type}）`}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                    gap: 4, padding: '3px 6px', marginBottom: 1, fontSize: 'var(--fs-xs)', background: 'transparent',
                    border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
                  <span>{it.label || CN_NAME[it.type] || it.type}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.5625rem' }}>{it.type}</span>
                </button>
              ))}
            </div>
            );
          })}

          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '8px 0 4px', fontWeight: 600 }}>部件（可编辑电路）</div>
          {gates.map(g => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 1, fontSize: 'var(--fs-xs)' }}>
              <button onClick={() => placeCustomGate(g)} title={`放置部件“${g.name}”（点击也可在文件面板打开编辑）`}
                style={{ flex: 1, textAlign: 'left', padding: '3px 6px', background: 'transparent',
                  border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
                {g.name}
                {g.folder ? <span style={{ color: 'var(--text-muted)', marginLeft: 4, fontSize: '0.5625rem' }}>{g.folder}/</span> : null}
              </button>
              <span onClick={(e) => { e.stopPropagation(); handleDeleteGate(g); }} title="删除部件"
                style={{ cursor: 'pointer', marginLeft: 4,
                  color: deleteGateId === g.id ? 'var(--error, #ef4444)' : 'var(--text-muted)',
                  fontWeight: deleteGateId === g.id ? 700 : 400 }}>
                {deleteGateId === g.id ? '?' : '×'}
              </span>
            </div>
          ))}
          {gates.length === 0 && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>把当前电路保存为部件后可复用；「复制到沙盒」的子部件也在此列出，均可打开编辑</div>
          )}
          </div>)}

          {/* DRC 与操作提示属于「电路」信息，归到层次结构面板 */}
          {leftPanel === 'hierarchy' && (<div style={{ padding: 8 }}>
          {drc.length > 0 && (
            <div style={{ marginTop: 8, border: '1px solid #ef4444', borderRadius: 4, padding: 6 }}>
              <div style={{ fontSize: 'var(--fs-xs)', color: '#ef4444', fontWeight: 700, marginBottom: 3 }}>
                ⚠ {drc.length} 处非法连接
              </div>
              {drc.slice(0, 4).map((iss, i) => (
                <div key={i} onClick={() => { setSelectionRef.current([iss.linkId]); focusCell(iss.linkId); }}
                  title="点击定位该连线"
                  style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', cursor: 'pointer',
                    lineHeight: 1.35, marginBottom: 2 }}>
                  · {iss.msg}
                </div>
              ))}
              {drc.length > 4 && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>…还有 {drc.length - 4} 处</div>
              )}
            </div>
          )}

          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '8px 0 4px', fontWeight: 600 }}>操作提示</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            · 拖端口连线：靠近端口自动吸附，不必精准对准<br/>
            · 位宽不同的两端相连会自动插入转换器<br/>
            · 分线器 / 合线器放下即选位宽方案（1/2/4/8 位互转）<br/>
            · 空白拖拽 = 框选<br/>
            · 右键部件 = 菜单（含位宽 / 旋转）<br/>
            · Shift/Ctrl 点击 = 多选<br/>
            · 双击自定义门 = 查看内部<br/>
            · Ctrl+Z/Y 撤销重做，Ctrl+R 旋转<br/>
            · 方向键微移，Ctrl+0 复位视图
          </div>
          </div>)}
        </div>

      </div>
      )}

      {/* R101：画布区＝『上方一排按钮栏』+『画布』两行。按钮栏**独占一行**而不是浮在
          画布上——浮层会挡住画布左上角的框选起点（r17 实测：框选只选中 1 颗，期望 ≥6；
          pointer-events 穿透也不够，按钮本体仍压住起点）。样式与右侧调试条同一套令牌；
          title 与 data-* 锚点全部保留（gate 靠它们定位）。 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeFile && (
          <div data-sandbox-topbar style={{
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0,
            padding: '6px 8px', background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
          }}>
            {(() => {
              const sm: React.CSSProperties = {
                display: 'inline-flex', alignItems: 'center', gap: 4, pointerEvents: 'auto',
                padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                background: 'var(--surface)', color: 'var(--text)',
                fontSize: 'var(--fs-xs)', cursor: 'pointer', lineHeight: 1,
              };
              const dis: React.CSSProperties = { ...sm, opacity: 0.45, cursor: 'not-allowed' };
              return (<>
          <div data-sandbox-debug-bar style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '4px 10px', background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
          }}>
            <button
              onClick={handlePlayPause}
              title="运行 / 暂停仿真"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
                background: running ? 'var(--surface-hover)' : 'var(--success)',
                color: running ? 'var(--text-secondary)' : '#fff',
              }}
            >{running ? <><Pause size={13} /> 暂停</> : <><Play size={13} /> 运行</>}</button>
            <button
              onClick={handleStep}
              title="单步执行"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: 'var(--accent)', color: '#fff',
                fontSize: 'var(--fs-xs)', fontWeight: 600,
              }}
            ><StepForward size={13} /> 单步</button>
            <button
              onClick={handleReset}
              title="复位仿真"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 9px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: 'transparent', color: 'var(--text)',
              }}
            ><RotateCcw size={13} /></button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>
              速度
              {/* 5–200ms 量纲与编译模式一致（右滑更快）；滑条 min/max 是 r44[14]/r62 的锚点 */}
              <input
                type="range" min={5} max={200} step={5}
                value={205 - settings.simSpeedMs}
                onChange={(e) => settingsStore.setSandboxSettings({ simSpeedMs: 205 - Number(e.target.value) })}
                style={{ width: 90, accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <span style={{ minWidth: 46, color: 'var(--text)' }}>{settings.simSpeedMs} ms</span>
            </label>
            <button
              onClick={() => setWaveOpen(w => !w)}
              title="波形监视器：实时查看连线电平时序"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
                background: waveOpen ? 'var(--accent)' : 'transparent',
                color: waveOpen ? '#fff' : 'var(--text)',
              }}
            ><AudioWaveform size={13} /> 波形</button>
          </div>
                <button onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)" style={canUndo ? sm : dis}><Undo2 size={13} /></button>
                <button onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)" style={canRedo ? sm : dis}><Redo2 size={13} /></button>
                <button onClick={() => rotateSelection(90)} disabled={!selCount} title="旋转 90° (Ctrl+R)" style={selCount ? sm : dis}><RotateCw size={13} /></button>
                <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
                <button onClick={handleSave} disabled={!activeFile} title="保存当前沙盒文件 (Ctrl+S)" style={activeFile ? sm : dis}><Save size={13} />保存</button>
                {savingGate ? (
                  <>
                    <input autoFocus value={gateName} onChange={(e) => setGateName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGate(); if (e.key === 'Escape') { setSavingGate(false); setGateName(''); setGateError(null); } }}
                      placeholder="自定义门名称"
                      style={{ width: 110, padding: '3px 6px', fontSize: 'var(--fs-xs)', background: 'var(--surface)',
                        color: 'var(--text)', border: '1px solid var(--border-subtle)', borderRadius: 3 }} />
                    <button onClick={handleSaveGate} title="确认保存为自定义门" style={sm}>确定</button>
                    <button onClick={() => { setSavingGate(false); setGateName(''); setGateError(null); }} title="取消" style={sm}>×</button>
                  </>
                ) : (
                  <button onClick={() => setSavingGate(true)} disabled={!activeFile} title="将当前电路保存为自定义门" style={activeFile ? sm : dis}><Cpu size={13} />自定义门</button>
                )}
                <button onClick={() => setExprGenOpen(true)} disabled={!activeFile} title="输入布尔表达式自动生成电路图（a & b | !c）" style={activeFile ? sm : dis}><FunctionSquare size={13} />表达式生成</button>
                <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
                <button onClick={handleExportSvg} disabled={!activeFile} title="导出 SVG" style={activeFile ? sm : dis}><Download size={13} />SVG</button>
                <button onClick={handleExportNetlist} disabled={!activeFile} title="导出综合网表（.v）：门/触发器/常量转结构化网表代码" style={activeFile ? sm : dis}><FileCode size={13} />综合网表</button>
                <button onClick={() => activeFile && handleExportDjs(activeFile)} disabled={!activeFile} title="导出 JSON（.djs）：含引用的部件定义" style={activeFile ? sm : dis}><Download size={13} />JSON</button>
                <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
                <button onClick={() => activeFile && setFileBindingId(activeFile.id)} data-sandbox-bindings disabled={!activeFile || activeFile.kind === 'gate'}
                  title="部件绑定：给当前文件里的子电路实例选择部件定义文件" style={activeFile && activeFile.kind !== 'gate' ? sm : dis}><Link2 size={13} />部件绑定</button>
                {onOpenSettings && (
                  <button onClick={onOpenSettings} data-sandbox-settings title="打开设置面板" style={sm}><Settings size={13} />设置</button>
                )}
                <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
                {/* 输入 / 输出统计与交互：与编译模式的「输入」面板同一颗组件（输出段只读） */}
                <button onClick={() => setIoOpen((v) => !v)} data-sandbox-io
                  title="输入 / 输出面板：列出画布上全部输入（可点击切换）与输出（只读）"
                  style={ioOpen ? { ...sm, borderColor: 'var(--accent)', color: 'var(--accent)' } : sm}>
                  <SlidersHorizontal size={13} />输入 / 输出
                </button>
              </>);
            })()}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <div ref={wrapperRef} data-sandbox-wrapper style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
          {/* 注释手柄只在选中态显示（annotationCell 的 View 画了 8 个 .ann-h） */}
          <style>{ANNOTATION_CSS}</style>
          {/* 注释编辑 overlay：正向文字（cell 的旋转/镜像保持不动，提交后原样呈现） */}
          {noteEdit && (() => {
            const paper = paperRef.current;
            const cell = paper ? (paper.model.getCell(noteEdit.id) as any) : null;
            const wrap = wrapperRef.current;
            if (!paper || !cell || !wrap) return null;
            const v = cell.findView(paper);
            // ⛔ 视图 el 的 bbox（选中时含 8 颗手柄，文字长高时还含溢出部分）——
            //   编辑框要贴的是**盒子**，取 noteBg 的矩形（90°/180° 旋转下它就是盒子本身）
            const bgEl = v?.el?.querySelector?.('[joint-selector="noteBg"]') as SVGElement | null;
            const r = (bgEl || v?.el)?.getBoundingClientRect?.();
            const wr = wrap.getBoundingClientRect();
            if (!r || !r.width) return null;
            // 编辑框的字号/行距/内边距走**同一份** noteMetrics（⛔ 别在这重算一遍）
            const nm = noteMetrics(cell);
            return (
              <textarea
                data-note-edit=""
                autoFocus
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') { e.preventDefault(); commitNote(); }
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); commitNote(); }
                }}
                onBlur={commitNote}
                style={{
                  position: 'absolute',
                  left: r.left - wr.left + 2, top: r.top - wr.top + 2,
                  width: Math.max(90, r.width - 4), height: Math.max(44, r.height - 4),
                  zIndex: 26, resize: 'none', boxSizing: 'border-box',
                  background: 'rgba(20,26,34,0.94)', color: '#e4e4ec',
                  border: '1.5px solid var(--accent)', borderRadius: 6, outline: 'none',
                  padding: `${Math.max(2, nm.pad - 2)}px ${nm.pad}px`,
                  fontFamily: "'Consolas', 'JetBrains Mono', monospace",
                  fontSize: nm.font, lineHeight: `${nm.lineH}px`,
                }}
              />
            );
          })()}
        {gateError && (
          <div style={{ position: 'absolute', top: 52, left: 10, zIndex: 24, fontSize: 'var(--fs-xs)',
            color: 'var(--danger)', background: 'var(--surface)', padding: '2px 6px',
            border: '1px solid var(--border)', borderRadius: 3 }}>{gateError}</div>
        )}
        {/* R100 调试工具条：与编译模式 TabBar rightSlot 的仿真控制**同款样式**
            （surface 胶囊容器 + lucide 图标钮 + 速度滑条 + 波形钮）。title 锚点
            （运行 / 暂停仿真、单步执行、复位仿真、波形）与 SPEED 滑条量纲（5–200）
            全部保留 —— r11/r44/r53/r62/r76 等 gate 靠它们定位。 */}
        {!activeFile && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
            点击 + 新建沙盒文件
          </div>
        )}
        {cycleWarn && (
          <div data-sb-cycle-warn style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(217,119,6,0.95)', color: '#fff', padding: '6px 12px', borderRadius: 6,
            fontSize: 'var(--fs-xs)', zIndex: 29, maxWidth: '84%', boxShadow: '0 6px 18px rgba(0,0,0,.28)' }}>
            部件循环依赖：{cycleWarn.join(' → ')} —— 回边层已按空壳⟲渲染，请进部件定义删除嵌套实例
          </div>
        )}
        {toast && (
          <div data-sandbox-toast style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)',
            background: 'rgba(239,68,68,0.95)', color: '#fff', padding: '7px 14px', borderRadius: 6,
            fontSize: 'var(--fs-xs)', zIndex: 30, maxWidth: '80%', boxShadow: '0 6px 18px rgba(0,0,0,.28)' }}>
            {toast}
          </div>
        )}
        {innerCell && (
          <SandboxExpandModal
            cell={innerCell}
            theme={theme}
            scope={scope}
            onClose={() => setInnerCell(null)}
          />
        )}
        {waveOpen && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40 }}>
            <WaveformPanel
              getChannels={waveGetChannels}
              getSample={waveGetSample}
              resetKey={activeFile?.id ?? ''}
              running={runningRef.current}
              onClose={() => setWaveOpen(false)}
            />
          </div>
        )}
        {memViewCell && (
          <MemoryViewModal
            cell={memViewCell}
            circuitRef={circuitRef}
            onClose={() => { setMemViewCell(null); commit(); }}
          />
        )}
        {memPortsDlg && paperRef.current?.model.getCell(memPortsDlg) && (
          <MemPortsModal
            cell={paperRef.current.model.getCell(memPortsDlg)}
            onClose={() => { setMemPortsDlg(null); commit(); }}
            onApply={(patch) => {
              const rebuilt = reconfigureCell(memPortsDlg, patch);
              setMemPortsDlg(null);
              showToast(rebuilt
                ? `存储器已重建：${patch.rdports.length} 个读口、${patch.wrports.length} 个写口、${patch.bits}×${patch.abits}${patch.words ? ` / ${patch.words} 字` : ''}`
                : '存储器重建失败');
            }}
          />
        )}
        {dffPortsDlg && paperRef.current?.model.getCell(dffPortsDlg) && (
          <DffPortsModal
            cell={paperRef.current.model.getCell(dffPortsDlg)}
            onClose={() => { setDffPortsDlg(null); commit(); }}
            onApply={(patch) => {
              const rebuilt = reconfigureCell(dffPortsDlg, patch) as any;
              setDffPortsDlg(null);
              // 端口名从**重建出来的那颗器件**现取（不是弹窗自己算的文案）：这样这句反馈语
              // 说的就是画布上真的长出来的脚，用户能当场核对低有效那一脚有没有多出 ain。
              const ids = rebuilt && rebuilt.getPorts ? rebuilt.getPorts().map((p: any) => p.id).join(' ') : '';
              showToast(rebuilt
                ? `寄存器已重建：${patch.bits} 位、polarity=${JSON.stringify(patch.polarity)}、端口 ${ids}`
                : '寄存器重建失败');
            }}
          />
        )}
        {fsmDlg && paperRef.current?.model.getCell(fsmDlg) && (
          <FsmTableModal
            cell={paperRef.current.model.getCell(fsmDlg)}
            onClose={() => setFsmDlg(null)}
            onApply={(patch) => {
              const rebuilt = reconfigureCell(fsmDlg, patch);
              setFsmDlg(null);
              showToast(rebuilt
                ? `状态机已重建：${patch.states} 个状态、${patch.trans_table.length} 条转移（初始 ${patch.init_state}）`
                : '状态机重建失败（器件类型不认识？）');
            }}
          />
        )}
        {busDlg && (
          <BusWidthDialog
            mode={busDlg.type === 'BusGroup' ? '合线器' : '分线器'}
            total={busTotal} groupWidth={busGroupW}
            onTotal={setBusTotal} onGroupWidth={setBusGroupW}
            onApply={applyBusDialog}
            onClose={() => setBusDlg(null)}
          />
        )}
        {rebindDlg && (
          <RebindDialog
            cur={rebindDlg.cur}
            parts={gatesRef.current.map((g) => ({ name: g.name, folder: g.folder || '' }))}
            onPick={(name) => {
              rebindSubcircuitCell(rebindDlg.cellId, name);
              setRebindDlg(null);
              showToast(`已把实例绑定到「${name}」`);
            }}
            onClose={() => setRebindDlg(null)}
          />
        )}
        {/* R101：输入 / 输出面板（与编译模式同一颗 IOPanel）。沙盒没有右侧栏容器，
            用画布内浮层承载，尺寸与配色与编译模式的侧栏面板一致。 */}
        {ioOpen && (
          <div style={{ position: 'absolute', top: 48, right: 10, bottom: 10, zIndex: 26,
            display: 'flex', pointerEvents: 'auto' }}>
            <IOPanel host={ioHost} open onClose={() => setIoOpen(false)} inputsTitle="Inputs" outputsTitle="Outputs" />
          </div>
        )}
        {/* R101：文件系统的两个弹窗（重命名 / 新建 / 删除确认）——与编译模式
            用的是同一对组件（PromptDialog / ConfirmDialog），样式天然一致 */}
        {exprGenOpen && (
          <ExprGenDialog
            onGenerate={(res, expr, asGate) => {
              setExprGenOpen(false);
              if (asGate) {
                // R118：表达式直接存部件（上游 isIC 概念的本地化）+ 放实例
                try {
                  saveGateFromCellsToFolder(asGate, { cells: res.cells }, scopeRef.current);
                  refreshGates();
                  const g = customGateStore.list().find((x) => x.name === asGate);
                  if (g) placeCustomGate(g);
                  showToast(`已存为部件「${asGate}」并放置实例`);
                  setTimeout(() => zoomToFit(), 60);
                } catch (e) { showToast(`存部件失败：${String((e as Error)?.message || e)}`); }
                return;
              }
              const wrap = document.querySelector('[data-sandbox-wrapper]');
              const r = wrap ? wrap.getBoundingClientRect() : { left: 400, top: 400, width: 600, height: 400 };
              if (insertCellsAt(res.cells, r.left + r.width / 2, r.top + r.height / 2, `已生成表达式：${expr}`)) setTimeout(() => zoomToFit(), 60);
            }}
            onCancel={() => setExprGenOpen(false)}
          />
        )}
        {fsPrompt && (
          <div data-fs-dialog={fsPrompt.title}>
            <PromptDialog
              title={fsPrompt.title}
              label={fsPrompt.label}
              defaultValue={fsPrompt.defaultValue || ''}
              placeholder={fsPrompt.placeholder}
              confirmLabel={fsPrompt.confirmLabel || '确定'}
              validate={fsPrompt.validate}
              onAccept={(v) => closeFsPrompt(v)}
              onCancel={() => closeFsPrompt(null)}
            />
          </div>
        )}
        {fsConfirm && (
          <ConfirmDialog
            title={fsConfirm.title}
            message={fsConfirm.message}
            detail={fsConfirm.detail}
            confirmLabel={fsConfirm.confirmLabel || '确定'}
            danger={fsConfirm.danger}
            onAccept={() => closeFsConfirm(true)}
            onCancel={() => closeFsConfirm(false)}
          />
        )}
        {fileBindingId && (() => {
          const fb = sandboxStore.get(fileBindingId);
          if (!fb || fb.kind === 'gate') return null;
          // 扫文件 graphJson：Subcircuit 实例按 celltype 名聚合（含出现次数）
          const counts = new Map<string, number>();
          try {
            const j = JSON.parse(fb.graphJson || '{}');
            for (const c of (j.cells || [])) {
              if (c?.type === 'Subcircuit' && c.celltype) {
                counts.set(String(c.celltype), (counts.get(String(c.celltype)) || 0) + 1);
              }
            }
          } catch { /* 损坏档当空 */ }
          const celltypes = Array.from(counts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name));
          const partsAll = gatesRef.current;
          const autoMap: Record<string, string> = {};
          for (const ct of celltypes) {
            const ref = resolvePartRef(ct.name, dirOf(fb));
            if (ref) autoMap[ct.name] = ref.file.id;
          }
          return (
            <SandboxFileBindingDialog
              fileName={baseName(fb.name)}
              isPart={fb.role === 'part'}
              celltypes={celltypes}
              parts={partsAll}
              autoMap={autoMap}
              initial={fb.partBindings || {}}
              onConfirm={(bindings) => {
                sandboxStore.setPartBindings(fb.id, bindings);
                if (activeFileRef.current?.id === fb.id) setActivePartBindings(bindings);
                syncAfterFsOp();
                setFileBindingId(null);
                showToast(`已保存「${baseName(fb.name)}」的绑定，重新打开文件后生效。`);
              }}
              onCancel={() => setFileBindingId(null)}
            />
          );
        })()}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} title={menu.title} items={menu.items} onClose={() => setMenu(null)} />
      )}
      </div>
    </div>
  );
}

/**
 * 总线转换器「位宽方案」对话框：一条 N 位总线 ↔ 若干组（每组 1/2/4/8 位）。
 * 分线器 = 总线 → 多组（8 位拆成 8×1、4×2、2×4 都在这里选）；
 * 合线器 = 多组 → 总线。这是 1/2/4/8 位分线之间互转的入口。
 */
function BusWidthDialog({ mode, total, groupWidth, onTotal, onGroupWidth, onApply, onClose }: {
  mode: string; total: number; groupWidth: number;
  onTotal: (n: number) => void; onGroupWidth: (n: number) => void;
  onApply: () => void; onClose: () => void;
}) {
  // 同 BindingDialog：`inset:0` 的遮罩必须给 Esc 一条出路（自动化测试也靠它，不然点不到遮罩外的任何行）
  // 依赖表写 `[]` + ref，理由见 BindingDialog 里那段注释。
  const closeBusRef = useRef(onClose);
  closeBusRef.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeBusRef.current(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);
  const TOTALS = [1, 2, 4, 8, 16, 32];
  const widths = [1, 2, 4, 8].filter(w => total % w === 0);
  const n = Math.floor(total / Math.max(1, groupWidth));
  const btn = (active: boolean): React.CSSProperties => ({
    padding: '5px 10px', fontSize: 'var(--fs-sm)', cursor: 'pointer', borderRadius: 4,
    background: active ? 'var(--accent)' : 'var(--surface)',
    color: active ? '#fff' : 'var(--text)',
    border: '1px solid var(--border-subtle)',
  });
  return (
    <div data-bus-width-dialog onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 2200,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        padding: 18, minWidth: 340, boxShadow: '0 12px 32px rgba(0,0,0,.32)' }}>
        <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
          {mode}位宽方案
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          {mode === '分线器' ? '一条总线拆成若干组（每组可取 1/2/4/8 位）' : '若干组合成一条总线'}
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 6 }}>总线位宽</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {TOTALS.map(t => (
            <button key={t} onClick={() => { onTotal(t); if (t % groupWidth !== 0) onGroupWidth(1); }} style={btn(t === total)}>{t} 位</button>
          ))}
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 6 }}>每组位宽</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {widths.map(w => (
            <button key={w} onClick={() => onGroupWidth(w)} style={btn(w === groupWidth)}>{w} 位 ×{Math.floor(total / w)}</button>
          ))}
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 14,
          background: 'var(--surface-hover)', borderRadius: 6, padding: '6px 10px' }}>
          结果：{n} 组 × {groupWidth} 位 = {n * groupWidth} 位
          <span style={{ opacity: .8 }}>（端口 {mode === '分线器' ? `out0…out${n - 1} / in` : `in0…in${n - 1} / out`}）</span>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 14px', fontSize: 'var(--fs-sm)', cursor: 'pointer',
            background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-subtle)', borderRadius: 4 }}>取消</button>
          <button onClick={onApply} style={{ padding: '6px 14px', fontSize: 'var(--fs-sm)', cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4 }}>应用</button>
        </div>
      </div>
    </div>
  );
}

export default SandboxCanvas;
