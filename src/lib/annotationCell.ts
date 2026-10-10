/**
 * 画布注释（note）—— 沙盒模式的自由文本便签。
 *
 * 用户裁决（2026-10-10）：
 *  - 双击画布空白 → 创建注释并立即进入输入态；Esc 退出编辑；
 *  - 有内容的注释可再次双击进入二次编辑；
 *  - 框内自动换行；拖 4 条边自由改比例，拖 4 个角等比缩放；
 *  - 支持像部件一样的旋转（Ctrl+R）与镜像（flipCell）；
 *    已旋转/镜像的注释在编辑时以**正向文字**呈现，编辑完成后保持原变换；
 *  - 注释内容在「内部电路」展开图里也要可见，且与部件的相对位置不可有差错。
 *
 * ── 实现要点（探针实测定案，.tmpbuild/joint_probe3.cjs）─────────────────
 * digitaljs 的 bundle 不暴露 joint，但 cells 命名空间里 `Gate`/`GateView`
 * 是 public 导出（base.mjs:39/305），且 joint 4.1 的 ES5 `define/extend`
 * 完好：`Gate.define('Annotation', …)` + `GateView.extend(…)` 可用；把成品
 * 写回 `djs.cells.Annotation / AnnotationView`，**所有** paper 都会命中——
 * 因为 digitaljs 的 `paperOptions.cellViewNamespace` 与 `djs.cells` 是同一个
 * 对象引用（index.mjs:44），运行时注入即全局生效。
 *
 * 三个刻意的形状：
 *  1. **纯 SVG text + 手动 tspan 换行**，不用 foreignObject：
 *     - 沙盒 PNG/SVG 导出会剥离 foreignObject（tainted canvas 防线，见
 *       sandboxExport.ts），SVG text 天然存活；
 *     - 深色主题 `[data-theme=dark] svg text` 全局浅色规则自动覆盖；
 *     - 旋转/镜像是视图 transform，text 跟随，无 HTML 混合层问题。
 *     joint 的 text 属性**不**把 \n 拆成多行（探针实测 tspan=1），所以换行
 *     由本文件的 wrapNoteText 计算后重建 tspan。
 *  2. **文字内容存在 attrs.label.text**：sandboxSerialize 的 attrs 是整包
 *     透传字段，走它 = 零序列化改动（angle/mirror/size 也各有既有通道）。
 *  3. **body 是一个 <g>**（含底色 rect + text）：cellMirror 的镜像变换落在
 *     body 上 ⇒ 注释镜像＝整块板翻转、**文字随翻**（cellMirror 对
 *     Annotation 跳过字形回正——文本框镜像就该看到反字，这是与器件不同的
 *     刻意语义，见 cellMirror.syncBodyTextCounterFlip）。
 *
 * 引擎安全：Annotation 是 Gate 子类但**不进 circuit.devices**（直接 addCell
 * 到 graph），digitaljs 引擎只迭代 devices；它也没有端口，DRC/拖线/播种等
 * 按端口迭代的逻辑天然跳过（探针：circuit.start() 带注释运行无恙）。
 */
import { applyMirror } from './cellMirror';

export const ANNOTATION_TYPE = 'Annotation';
export const NOTE_DEFAULT_W = 180;
export const NOTE_DEFAULT_H = 76;
export const NOTE_MIN_W = 60;
export const NOTE_MIN_H = 26;
export const NOTE_FONT = 13;
export const NOTE_LINE_H = 17;
export const NOTE_PAD = 8;

/** 深浅主题都可读的注释底色/描边（跟随 --accent 家族，SVG attrs 不吃 CSS var，写死同值） */
const NOTE_STYLE = {
  noteBg: { fill: 'rgba(91,141,239,0.10)', stroke: '#5b8def', 'stroke-width': 1.2, rx: 6, ry: 6 },
  label: { fill: '#e4e4ec', 'font-size': NOTE_FONT, 'font-family': "'Consolas', 'JetBrains Mono', monospace" },
};

let measureCtx: CanvasRenderingContext2D | null = null;
function measureText(s: string): number {
  try {
    if (!measureCtx) {
      const cv = document.createElement('canvas');
      measureCtx = cv.getContext('2d');
    }
    if (!measureCtx) return s.length * NOTE_FONT * 0.62;
    measureCtx.font = `${NOTE_FONT}px 'Consolas', 'JetBrains Mono', monospace`;
    return measureCtx.measureText(s).width;
  } catch { return s.length * NOTE_FONT * 0.62; }
}

/**
 * 自动换行：先按用户手打的 \n 分段，再按可用宽度贪心折行。
 * 断行策略：优先在空格后断（英文单词不断裂）；CJK 无空格时逐字断。
 */
export function wrapNoteText(text: string, widthPx: number): string[] {
  const maxW = Math.max(20, widthPx);
  const out: string[] = [];
  for (const para of String(text || '').split(/\r?\n/)) {
    if (!para) { out.push(''); continue; }
    let line = '';
    let lastSpace = -1;
    let pending = '';       // 当前英文单词缓冲（未落行）
    for (let i = 0; i < para.length; i++) {
      const ch = para[i];
      const trial = line + pending + ch;
      if (measureText(trial) > maxW && (line || pending)) {
        if (lastSpace >= 0 && lastSpace > 0) {
          // 断在最后一个空格后：空格前落行，空格后（含当前词）续行
          out.push(line.slice(0, lastSpace));
          pending = line.slice(lastSpace + 1) + pending + ch;
          line = '';
          lastSpace = -1;
        } else {
          out.push((line + pending).slice(0, Math.max(1, (line + pending).length - 1)));
          pending = (line + pending).slice(-1) + ch;
          line = '';
        }
      } else {
        line += pending; pending = '';
        line += ch;
        if (ch === ' ') lastSpace = line.length - 1;
      }
    }
    out.push(line + pending);
  }
  return out;
}

const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type HandleDir = typeof HANDLE_DIRS[number];
const CORNER = new Set<string>(['nw', 'ne', 'se', 'sw']);

// ⚠ 手柄的全部属性在 renderNote 里显式 setAttribute：joint **不应用** markup 条目
//   自带的 attrs（diag4 实测 rect 渲染出来了但 width/height/fill/data-h 全没落上，
//   只有 define 类级 attrs 才走更新管线）——8×8 的方块写在这等于 0×0。
const HANDLE_STYLE = { w: 8, fill: '#5b8def', stroke: '#0f141a', sw: 1, rx: 1.5 } as const;

function handleMarkup() {
  return HANDLE_DIRS.map((d) => ({
    tagName: 'rect',
    selector: `h-${d}`,
    group: 'handles',
  }));
}

/** 幂等注册：把 Annotation cell/View 挂进 digitaljs.cells（所有 paper 共享该命名空间） */
export function registerAnnotation(djs: any): boolean {
  if (!djs?.cells?.Gate || !djs?.cells?.GateView) return false;
  if (djs.cells[ANNOTATION_TYPE]) return true;
  try {
    const Ann = djs.cells.Gate.define(ANNOTATION_TYPE, {
      markup: [
        {
          tagName: 'g', selector: 'body',
          children: [
            { tagName: 'rect', selector: 'noteBg' },
            { tagName: 'text', selector: 'label' },
          ],
        },
        ...handleMarkup(),
      ],
      attrs: {
        noteBg: { ...NOTE_STYLE.noteBg, width: NOTE_DEFAULT_W, height: NOTE_DEFAULT_H },
        label: { ...NOTE_STYLE.label, x: NOTE_PAD, y: 18, 'text-anchor': 'start' },
      },
      size: { width: NOTE_DEFAULT_W, height: NOTE_DEFAULT_H },
    }, {
      // 注释不参与任何电气语义；给出无害默认，防 Gate.initialize 读缺省炸
    });
    const GateViewBase = djs.cells.GateView;
    const AnnView = GateViewBase.extend({
      events() {
        const base = typeof GateViewBase.prototype.events === 'function'
          ? GateViewBase.prototype.events.call(this) : (GateViewBase.prototype.events || {});
        // ⚠ joint 4.1 的元素拖拽起点绑在 **mousedown**（bundle：`'mousedown': 'pointerdown'`），
        //   只拦 pointer 事件拦不住（r121 闸门实测：拖手柄把便签整个拖走）；两个都绑＋手势
        //   守卫（noteHandleDown 会被 pointer/mouse 各调一次，幂等）。
        return { ...base, '[data-h] pointerdown': 'noteHandleDown', '[data-h] mousedown': 'noteHandleDown' };
      },
      render() {
        GateViewBase.prototype.render.apply(this, arguments as any);
        this.renderNote();
      },
      update() {
        GateViewBase.prototype.update.apply(this, arguments as any);
        this.renderNote();
      },
      /** 手动换行：text 内容 → 多 tspan；同时重排 8 个缩放手柄 */
      renderNote() {
        try {
          const m = this.model;
          const size = m.size();
          const w = Math.max(NOTE_MIN_W, Number(size.width) || NOTE_DEFAULT_W);
          const h = Math.max(NOTE_MIN_H, Number(size.height) || NOTE_DEFAULT_H);
          const sel = (s: string): SVGElement | null =>
            (this.el.querySelector(`[joint-selector="${s}"]`) as SVGElement) || (this.el.querySelector(`[data-selector="${s}"]`) as SVGElement) || null;
          const bg = sel('noteBg');
          if (bg) { bg.setAttribute('width', String(w)); bg.setAttribute('height', String(h)); }
          const label = sel('label');
          if (label) {
            const text = String(m.attr('label/text') || '');
            while (label.firstChild) label.removeChild(label.firstChild);
            const lines = text ? wrapNoteText(text, w - NOTE_PAD * 2) : [];
            lines.forEach((ln, i) => {
              const ts = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
              ts.setAttribute('x', String(NOTE_PAD));
              ts.setAttribute('y', String(18 + i * NOTE_LINE_H));
              ts.textContent = ln;
              label.appendChild(ts);
            });
          }
          const hs: Record<string, [number, number]> = {
            nw: [0, 0], n: [w / 2 - 4, 0], ne: [w - 8, 0],
            e: [w - 8, h / 2 - 4], se: [w - 8, h - 8], s: [w / 2 - 4, h - 8],
            sw: [0, h - 8], w: [0, h / 2 - 4],
          };
          for (const d of HANDLE_DIRS) {
            const el: any = sel(`h-${d}`);
            if (!el) continue;
            el.setAttribute('data-h', d);
            el.setAttribute('x', String(hs[d][0]));
            el.setAttribute('y', String(hs[d][1]));
            el.setAttribute('width', String(HANDLE_STYLE.w));
            el.setAttribute('height', String(HANDLE_STYLE.w));
            el.setAttribute('fill', HANDLE_STYLE.fill);
            el.setAttribute('stroke', HANDLE_STYLE.stroke);
            el.setAttribute('stroke-width', String(HANDLE_STYLE.sw));
            el.setAttribute('rx', String(HANDLE_STYLE.rx));
            el.setAttribute('class', 'ann-h' + (CORNER.has(d) ? ' ann-h-corner' : ' ann-h-edge'));
            (el as SVGElement).style.cursor = CORNER.has(d) ? (d === 'nw' || d === 'se' ? 'nwse-resize' : 'nesw-resize') : (d === 'n' || d === 's' ? 'ns-resize' : 'ew-resize');
            // 直接挂 DOM 监听：joint 的 events 哈希委托在这套 Gate.define 子类上
            // 实测不生效（r121 闸门连跑三个变体都拖不动手柄）——不猜它的委托
            // 语义了，renderNote 幂等绑定（同一 rect 只绑一次）。
            // ⚠ 必须挂 **mousedown**：joint 的拖拽起点＝ElementView 的
            //   `'mousedown': 'pointerdown'`，pointer 上的拦截管不到另一个事件。
            const view = this as any;
            if (!el.__annBound) {
              el.__annBound = true;
              el.addEventListener('mousedown', (ev: any) => view.noteHandleDown(ev));
            }
          }
        } catch { /* 视图尽力而为 */ }
      },
      /** 缩放手柄拖拽：本地坐标系计算（角度≠0 时把屏幕位移反旋回本地轴） */
      noteHandleDown(evt: any) {
        const self = this as any;
        try {
          const target = evt.target as SVGElement;
          const dir = String(target.getAttribute?.('data-h') || '') as HandleDir;
          if (!HANDLE_DIRS.includes(dir)) return;
          if (self.__annDragging) return;
          self.__annDragging = true;
          // ⚠ joint 的拖拽起点监听绑在**视图 el 自己**（ElementView `'mousedown': 'pointerdown'`）
          //   —— 同一元素上 stopPropagation 拦不住同元素的其他监听，必须 stopImmediatePropagation
          //   （r121 闸门三次实测：只 stopPropagation 时拖手柄＝拖便签）。
          evt.stopImmediatePropagation?.();
          evt.stopPropagation?.(); evt.preventDefault?.();
          const paper = this.paper; const m = this.model;
          const orig = { pos: { ...m.position() }, size: { ...m.size() }, angle: Number(m.get('angle') || 0) };
          const start = paper.clientToLocalPoint(evt.clientX, evt.clientY);
          const a = (orig.angle * Math.PI) / 180;
          const ca = Math.cos(a), sa = Math.sin(a);
          const aspect = orig.size.width / orig.size.height;
          // joint 的 angle 绕**本地 bbox 中心**旋转：世界 = c0 + R·(本地 − c0)
          const toWorld = (p: { x: number, y: number }) => ({
            x: orig.pos.x + orig.size.width / 2 + (p.x - orig.pos.x - orig.size.width / 2) * ca - (p.y - orig.pos.y - orig.size.height / 2) * sa,
            y: orig.pos.y + orig.size.height / 2 + (p.x - orig.pos.x - orig.size.width / 2) * sa + (p.y - orig.pos.y - orig.size.height / 2) * ca,
          });
          const mv = (e: MouseEvent) => {
            const p = paper.clientToLocalPoint(e.clientX, e.clientY);
            const dx = p.x - start.x, dy = p.y - start.y;
            // 屏幕 delta → 本地 delta（反旋 angle）：position/size 活在未旋转本地系
            const ldx = dx * ca + dy * sa;
            const ldy = -dx * sa + dy * ca;
            const growW = dir.includes('e') ? ldx : dir.includes('w') ? -ldx : 0;
            const growH = dir.includes('s') ? ldy : dir.includes('n') ? -ldy : 0;
            let nw = orig.size.width, nh = orig.size.height;
            if (CORNER.has(dir)) {
              // 等比：取两轴中更强的拉伸意图，另一轴按比例跟
              const k = Math.max((orig.size.width + growW) / orig.size.width, (orig.size.height + growH) / orig.size.height, NOTE_MIN_W / orig.size.width);
              nw = Math.max(NOTE_MIN_W, orig.size.width * k);
              nh = Math.max(NOTE_MIN_H, nw / aspect);
            } else {
              if (growW) nw = Math.max(NOTE_MIN_W, orig.size.width + growW);
              if (growH) nh = Math.max(NOTE_MIN_H, orig.size.height + growH);
            }
            // 刚体约束：拖拽中的**不动点** = 对角（角拖）/对边中点（边拖）的世界坐标。
            const anchorLocal = {
              x: dir.includes('w') ? orig.pos.x + orig.size.width : dir.includes('e') ? orig.pos.x : orig.pos.x + orig.size.width / 2,
              y: dir.includes('n') ? orig.pos.y + orig.size.height : dir.includes('s') ? orig.pos.y : orig.pos.y + orig.size.height / 2,
            };
            const W0 = toWorld(anchorLocal);
            // 新尺寸下，同一"把手语义"的本地锚点（相对新左上角）：
            const anchorRel = {
              x: dir.includes('w') ? nw : dir.includes('e') ? 0 : nw / 2,
              y: dir.includes('n') ? nh : dir.includes('s') ? 0 : nh / 2,
            };
            // 解新 pos：toWorld_new(anchorRel_new) ≡ W0
            //   W0 = c1 + R·(anchorRel − (w1/2,h1/2))，c1 = pos1 + (w1/2,h1/2)
            const rlx = anchorRel.x - nw / 2, rly = anchorRel.y - nh / 2;
            const c1x = W0.x - (rlx * ca - rly * sa);
            const c1y = W0.y - (rlx * sa + rly * ca);
            const nx = c1x - nw / 2, ny = c1y - nh / 2;
            m.prop('size', { width: Math.round(nw), height: Math.round(nh) });
            m.prop('position', { x: Math.round(nx), y: Math.round(ny) });
          };
          const up = () => {
            self.__annDragging = false;
            document.removeEventListener('mousemove', mv);
            document.removeEventListener('mouseup', up);
            try { paper.trigger('annotation:resized', m); } catch { /* ignore */ }
          };
          document.addEventListener('mousemove', mv);
          document.addEventListener('mouseup', up);
        } catch { /* ignore */ }
      },
    });
    djs.cells[ANNOTATION_TYPE] = Ann;
    djs.cells[ANNOTATION_TYPE + 'View'] = AnnView;
    return true;
  } catch (e) {
    console.warn('[annotation] 注册失败:', e);
    return false;
  }
}

export function isAnnotation(c: any): boolean {
  try { return c?.get?.('type') === ANNOTATION_TYPE; } catch { return false; }
}

/** 新建一颗注释 cell（调用方负责 addCell）。
 *  ⚠ 文字必须走 **label prop**（不是 attrs.label.text）：Gate.initialize 里
 *  `bindAttrToProp('label/text','label')` 会拿 `this.get('label')`（构造期是
 *  undefined）覆写 attrs —— 构造 attrs 里带的文字当场被冲掉（r121 诊断探针3
 *  实测序列化侧就丢字）。prop 变更经 change:label 自动同步回 attrs。 */
export function makeAnnotationCell(djs: any, x: number, y: number, text = '') {
  const Ann = djs?.cells?.[ANNOTATION_TYPE];
  if (!Ann) return null;
  return new Ann({
    position: { x, y },
    label: String(text ?? ''),
    size: { width: NOTE_DEFAULT_W, height: NOTE_DEFAULT_H },
    attrs: {
      noteBg: { ...NOTE_STYLE.noteBg, width: NOTE_DEFAULT_W, height: NOTE_DEFAULT_H },
      label: { ...NOTE_STYLE.label },
    },
  });
}

/**
 * 存档 cells（白名单 JSON）里的注释 → 重放到 paper 上。
 * 展开图（内部电路弹窗）用：器件走编译格式渲染完成后，把同坐标系的注释
 * cell 直接 addCell——position/angle/mirror 与部件**同一份本地坐标**，
 * 只要不发生重布局就零误差；因此 **autoLayout 开启时不叠加**（elk 会挪
 * 器件，注释跟不住 ⇒ 宁可暂隐，也不给「相对位置有差错」的机会）。
 */
export function overlayAnnotations(paper: any, djs: any, savedCells: any[] | undefined, dx = 0, dy = 0) {
  if (!paper || !djs?.cells?.[ANNOTATION_TYPE] || !savedCells?.length) return 0;
  let n = 0;
  for (const c of savedCells) {
    if (c?.type !== ANNOTATION_TYPE) continue;
    try {
      const cell = makeAnnotationCell(djs, (c.position?.x ?? 50) + dx, (c.position?.y ?? 50) + dy,
        String(c.label ?? c.attrs?.label?.text ?? ''));
      if (!cell) continue;
      if (c.id) cell.set('id', c.id);
      if (c.size) cell.prop('size', c.size);
      if (c.angle) cell.prop('angle', c.angle);
      if (c.mirror) cell.prop('mirror', c.mirror);
      paper.model.addCell(cell);
      if (c.mirror && (c.mirror.h || c.mirror.v)) applyMirror(cell, paper);
      n++;
    } catch { /* skip broken note */ }
  }
  return n;
}

/** 供 CSS 注入：手柄只在选中态显示（sm-selected 打在注释 view 根 <g> 上，手柄是其后代） */
export const ANNOTATION_CSS = `
.joint-paper .ann-h { display: none; pointer-events: all; }
.joint-paper .sm-selected .ann-h { display: block; }
`;
