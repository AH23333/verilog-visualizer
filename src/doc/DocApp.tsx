// .djs 电路文档编辑器（doc.html 入口，custom editor 宿主）。
//
// 线协议（extension/src/customEditors.ts）：
//  · 宿主 → webview：`{vvh:'doc', op:'init', docName, content, siblings}` 开局一次，
//    `{vvh:'doc', op:'revert', content, siblings?}` 磁盘内容被外部改写时重推；
//  · webview → 宿主：`{vvh:'doc', op:'edit', content}`——content 是**全量序列化串**，
//    SandboxCanvas commit（300ms debounce，这里负责）。
// siblings = 工作区里同目录（全仓）其它 .djs 文档，是部件解析的唯一真源
// （gateSystem.setPartFileSource 顶替 localStorage 里的 sandboxStore 旧档）。
import { useCallback, useEffect, useRef, useState } from 'react';
import SandboxCanvas from '../components/SandboxCanvas';
import { useVscodeTheme } from '../hooks/useVscodeTheme';
import { setPartFileSource, clearAutoHits, setBindingPolicy } from '../lib/gateSystem';
import { getHost, hostFire } from '../lib/host/host';
import { getVsCodeApiOrNull } from '../lib/host/vscodeHost';
import { sandboxStore, type SandboxFile } from '../store/sandboxStore';
import { settingsStore } from '../store/settingsStore';

interface DocPayload { name: string; content: string; initialBindings?: Record<string, string> }
type Sibling = { name: string; content: string; role?: 'part' | 'circuit' };

/** siblings → 伪 SandboxFile。role 来自宿主（.verilogviz.json 的 parts 名单，
 *  缺省 part——与 doc 模式历史行为一致：兄弟 .djs 优先当部件解析）。
 *  同时并入本会话内新存的自定义部件（sandboxStore part），「保存为部件 → 放置」在
 *  文档模式里也自洽：同名列 siblings 优先（数组序在前，resolvePartRef 稳定取先）。
 *  会话内显式绑定（binds：celltype → 部件文件名，SandboxCanvas 经 doc.onBind 交来）
 *  命中的文件排在整个源列表**最前**——resolvePartRef 对同分候选按数组序稳定排序，
 *  排头即最高优先。绑定关系的落盘持久化留给宿主侧后续（需要宿主把绑定写进文档
 *  附属状态/工作区），这里先保证本会话内解析自洽。 */
function makePartSource(siblings: Sibling[], binds: Map<string, string>) {
  const pseudo = (s: Sibling): SandboxFile =>
    ({ id: s.name, name: s.name, graphJson: s.content, updatedAt: 0, role: s.role === 'circuit' ? 'circuit' as const : 'part' as const });
  return () => {
    const bound: SandboxFile[] = [];
    for (const [, partName] of binds) {
      const sib = siblings.find((s) => s.name === partName);
      if (sib) { bound.push(pseudo(sib)); continue; }
      const sp = sandboxStore.list().find((f) => f.role === 'part' && f.name === partName);
      if (sp) bound.push(sp);
    }
    const rest = [
      ...siblings.map(pseudo),
      ...sandboxStore.list().filter((f) => f.role === 'part'),
    ].filter((f) => !bound.some((b) => b.id === f.id));
    return [...bound, ...rest];
  };
}

export default function DocApp() {
  const theme = useVscodeTheme();
  const [doc, setDoc] = useState<DocPayload | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 会话内「celltype → 部件文件名」绑定（SandboxCanvas doc 模式「部件绑定」对话框
  // 确认后经 doc.onBind 逐条交来；init 时从宿主 .verilogviz.json bindings 段载入）。
  // Map 实例全会话稳定，makePartSource 闭包直读。B3：落盘持久化经 setDocBindings。
  const bindMapRef = useRef<Map<string, string>>(new Map());
  // R137：bindingsChanged 重灌时需要部件源的另一半——siblings 也留一份镜像
  const siblingsRef = useRef<Sibling[]>([]);
  const handleBind = useCallback((celltype: string, partName: string) => {
    bindMapRef.current.set(celltype, partName);
    // 落盘持久化：fire-and-forget；宿主按文档目录写 .verilogviz.json（watcher 会广播回来）
    // R158（协议 §5 v0.4）：只交**这一条**改动（⛔ 整张折叠 map——那会把祖先表的全局裸键
    //   原样拍进本档目录层，v0.4 的 setDocBindings 虽会折成本档前缀键，但一次放置抄全表＝噪音）。
    const name = docNameRef.current;
    if (name) hostFire('Failed to save doc bindings', (h) => h.setDocBindings(name, { [celltype]: partName }));
  }, []);
  // doc 名字的镜像（handleBind 落盘要用；⛔ 进 useCallback 依赖）
  const docNameRef = useRef<string>('');

  // acquireVsCodeApi 一个会话只准调一次：全画布**唯一出口**在 vscodeHost（真宿主实锤：第二次 acquire
  //   抛 "already been acquired"，修前这里与 host 层各拿各的＝doc 协议消息全哑火）——⛔ 再 window.acquireVsCodeApi()。
  const bridge = useCallback((): any => getVsCodeApiOrNull(), []);
  // R146 绑定完整性：提示条「写全配置」＝把画布实解的 autoHits 真相交宿主落表；
  // 宿主回推 bindingsWritten 后清账（auto hits 归零＝条自动消失，⛔ remount 吞编辑）。
  const handleFixBindings = useCallback((hits: Array<{ ctx: string; name: string; file: string }>) => {
    try { bridge()?.postMessage({ vvh: 'doc', op: 'completeBindings', docName: docNameRef.current, hits }); }
    catch (e) { console.warn('doc completeBindings 推送失败', e); }
  }, [bridge]);

  // SandboxCanvas commit → 300ms debounce → edit 推送（content = 全量序列化串）
  const handleCommit = useCallback((json: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try { bridge()?.postMessage({ vvh: 'doc', op: 'edit', content: json }); }
      catch (e) { console.warn('doc edit 推送失败', e); }
    }, 300);
  }, [bridge]);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  useEffect(() => {
    // X25（2026-10-18 现读，用户可见缺陷）：`doc.html` 是生产包里沙盒画布的**唯一入口**
    //   （`gates.html` ⛔ 在 `vite build` 的 inputs 里，正本 `vite.config.ts:19-25`），
    //   而这一侧过去只取 `cfg.bindings.policy`，从没把整份配置落进 `settingsStore`
    //   ⇒ 用户在 VS Code 设置里改的 `verilogViz.sandbox.*`（网格吸附／走线样式／默认位宽／
    //     自动起仿／仿真速度／常量折叠）在 `.djs` 编辑器里**整块失效**，编译侧那半却照用（R150 路标③ 只落了一半）。
    //   现场证据＝把 autoStartSim 关掉后画布仍自己跑起来（`tests/qc-paused.cjs` 的 [1b]/[2] 抓到）。
    //   现在与编译侧同一形状：拉一次落一次店（`CanvasApp.tsx:95-104` 那份）。
    const pullConfig = () => getHost().then((h) => h.getConfig()).then((cfg) => {
      settingsStore.applyHostConfig(cfg);
      setBindingPolicy(cfg.bindings?.policy);          // R146 strict：与编译侧同语义
    }).catch(() => { /* 无宿主环境（浏览器闸门）＝按默认档 */ });
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as {
        vvh?: string; op?: string; docName?: string; content?: string; siblings?: Sibling[];
      } | undefined;
      if (!d) return;
      if (d.vvh === 'doc') {
        if (d.op === 'init' || d.op === 'revert') {
          // 部件解析源必须在画布装载前挂好（loadCells 解析实例时就要能查到定义）
          const siblings = Array.isArray(d.siblings) ? d.siblings : [];
          siblingsRef.current = siblings;
          setPartFileSource(makePartSource(siblings, bindMapRef.current));
          const docName = d.docName || 'circuit.djs';
          docNameRef.current = docName;
          setDoc({ name: docName, content: d.content ?? '' });
          // R137：落盘的绑定关系**按本文档的目录链**载入会话表（⛔ await——init 的其余状态先走）
          if (d.op === 'init') {
            getHost().then((h) => h.getAllBindings(docName)).then((saved) => {
              bindMapRef.current.clear();
              for (const [k, v] of Object.entries(saved || {})) bindMapRef.current.set(k, v);
              setPartFileSource(makePartSource(siblings, bindMapRef.current));   // 表变了，重挂部件源
              setDoc((cur) => (cur && cur.name === docName ? { ...cur, initialBindings: { ...saved } } : cur));
            }).catch((e) => console.warn('Failed to load doc bindings', e));
          }
        }
        return;
      }
      // R137：`.verilogviz.json` 被手改/被别的画布写 ⇒ 宿主 push bindingsChanged ⇒ 重读链并刷新部件源
      if (d.vvh === 'push' && d.op === 'bindingsChanged') {
        const docName = docNameRef.current;
        if (!docName) return;
        getHost().then((h) => h.getAllBindings(docName)).then((saved) => {
          bindMapRef.current.clear();
          for (const [k, v] of Object.entries(saved || {})) bindMapRef.current.set(k, v);
          setPartFileSource(makePartSource(siblingsRef.current, bindMapRef.current));
          // M6 收敛：伪 activeFile.partBindings（＝gateSystem.activePartBindings 供给源，
          // SandboxCanvas effect 消费）必须与链同步——此前只刷 map/源，手编后
          // resolvePartRef 的 -1 显式优先与审计 covered 判定吃的还是 init 旧表（过期单例）。
          setDoc((cur) => (cur && cur.name === docName ? { ...cur, initialBindings: { ...saved } } : cur));
        }).catch((e) => console.warn('Failed to reload doc bindings', e));
      }
      // X25：宿主那侧 `verilogViz.sandbox.*` 一改就向**所有** webview 广播 configChanged
      //   （正本 `extension/src/dispatch.ts:93` 那条 sinks 循环，编译面板与文档编辑器同一把）。
      if (d.vvh === 'push' && d.op === 'configChanged') { pullConfig(); }
      // R146：「写全配置」落表面板回执＝宿主写完并已广播。⛔ remount 重载画布（会吞未保存的
      // 在编辑）——只清 auto 命中账：写进去的记录与画布现用解析同源（写前实解＝写后记录），
      // ⛔ 需要重画；提示条数据源即 autoHits，清账即隐，下次装载自然重新审计。
      if (d.vvh === 'doc' && d.op === 'bindingsWritten') { clearAutoHits(); }
    };
    window.addEventListener('message', onMessage);
    // 就绪握手：宿主⛔ 在 html 赋值后立刻 postMessage（webview 没装载完时消息会被丢弃，
    // 真机实测＝黑屏画布）——挂载完先发 ready，宿主这才回 init（customEditors.resolveCustomEditor）。
    try { bridge()?.postMessage({ vvh: 'doc', op: 'ready' }); }
    catch { /* 非壳环境（浏览器闸门）：没有 init 可等 */ }
    // R146：strict 绑定策略注入（未录入实例⛔ 同名兜底——与编译侧 closureOf 同语义）；
    // X25：同一次拉取顺手把沙盒设置落店（⛔ 再各拉一份——两份 getConfig 就是两个主人的配置）。
    pullConfig();
    return () => window.removeEventListener('message', onMessage);
  }, [bridge]);

  if (!doc) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', background: 'var(--canvas-bg)',
      }}>
        正在载入电路文档…
      </div>
    );
  }

  return (
    <SandboxCanvas
      theme={theme}
      doc={{
        name: doc.name, initialJson: doc.content,
        initialBindings: doc.initialBindings, onCommit: handleCommit, onBind: handleBind,
        onFixBindings: handleFixBindings,
      }}
    />
  );
}
