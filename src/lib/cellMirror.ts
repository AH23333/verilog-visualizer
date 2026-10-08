/**
 * 器件镜像（水平/垂直翻转）的唯一主人。
 *
 * ── 设计（R110 重写）────────────────────────────────────────────────────
 * 之前这个文件被连续多轮补丁叠坏（锚点镜像 / attrs 取反 / body DOM / body attrs /
 * 命名布局交换 / 固定坐标 / 幂等还原……），互相干扰，出现用户报的那些症状：
 *   · 翻转后引脚端点与部件本体完全分离（bbox 106px→166px / 88→60px）
 *   · 多次反复翻转后渲染彻底断开、甚至器件删不掉
 *   · 只有部分器件生效（门不翻、灯翻）
 *
 * 现在改成**单一真源**：把器件的**原始几何**（端口 position、会被取反的端口 attrs、
 * body 的 transform）在一处快照成 `c.prop('mirrorBase')`，此后每一次
 * 还原/施加都**只从这份原件重算**，绝不基于当前状态再叠一层。
 * 由此天然得到：
 *   · 幂等：翻 N 次的结果与第 1 次完全一致，翻两次必然复原；
 *   · 对所有器件一致：不再按器件类型分支（门 / 灯 / 数码管走同一条路）。
 *
 * ── 三层各管各的，互不重复（R110 实测得出）────────────────────────────
 *   ① 端口锚点：命名布局**左右/上下互换**（left⇄right、top⇄bottom），并把
 *      per-group 的 `args.dx/dy` 随边反号。
 *      ⚠ 必须换 name 而不是包一层 `x' = w - x`：joint 拿到 position 的返回值后
 *      **还会自己再加一次命名布局的 args.dx/dy**，坐标层镜像会被叠加出 2×dx 的偏移
 *      （实测 And：锚点 30→90、bbox 106→166px）。换 name 后锚点完全由 joint 原生算。
 *      ⇒ 引脚换边，且**连线端点由 joint 自动跟随**（这是连线跟随的唯一可行路径：
 *        CSS/DOM 变换对 joint 的连线端点计算完全不可见）。
 *   ② 端口视觉 attrs（引线 wire.x1/x2、圆点 port.refX…）随轴取反。
 *      锚点换边后引线方向必须配套，否则引线从本体边缘往里画（bbox 106→60px）。
 *   ③ body 图形变换。**按器件类型分流**（探针实测的唯一分叉点）：
 *      · 标准门（And/Or…）body 是 `<g>`，`attrs.body.transform` 本来就有值
 *        （如 `translate(-4,0) scale(1)`），joint 每次重渲染都重写它 ⇒ 只能写 attrs；
 *      · 灯/数码管 body 是 `<rect>`，没有这个 attrs ⇒ 写 attrs 无效，只能写 DOM 属性。
 *      现象正是「Lamp 翻了、And 没翻」，所以这个分流是必需的，不是补丁。
 *   ④ body 内 <text>/<foreignObject> 反向再翻一次，字形回正（位置仍随镜像走）。
 *
 * 状态：`cell.get('mirror')`（{h?,v?}）随存档序列化；函数不序列化 ⇒
 * 载入/重建后必须调 applyMirror(c, paper) 重挂（sandboxLoad / reconfigureCell）。
 *
 * ── 语义：mirror 记的是**器件本地轴**（R113 重写）───────────────────────
 * 用户在工具栏/右键菜单点的是**屏幕**上的「水平/垂直镜像」，而锚点与 body 变换都活在
 * **器件本地坐标**里。这两套坐标系会随 angle 错开，曾经的写法是把屏幕语义存进 `mirror`、
 * 再在 `applyMirror` 里按 `swap = (angle === 90 || angle === 270)` 换算成本地轴 ——
 * 于是**每转一次，镜像轴就被重新解释一次**，旋转不再是纯角度变更：
 *
 *   探针实测（R113，And 门，走真实右键菜单 + Ctrl+R）：
 *     水平镜像后       angle=0   bodyTf = scale(-1,1)   ✓
 *     再 Ctrl+R 一次   angle=90  bodyTf = scale(1,-1)   ✗ 镜像轴被换掉了
 *
 * 用户看到的就是「镜像本身没问题，一和旋转组合就整体错乱」。
 *
 * 现在 `mirror` 直接存**本地轴**，applyMirror **完全不读 angle** ⇒
 *   · 旋转是纯角度变更，永不碰 mirror 与端口几何；
 *   · 形状/锚点/引线作为整体随旋转变，天然自洽；
 *   · 群作用律 M²=I、R⁴=I、M∘R(θ)=R(−θ)∘M 全部成立。
 * 屏幕语义 → 本地语义的换算只在**用户操作的瞬间**做一次，落在 flipCell 里。
 */

export type CellMirror = { h?: boolean; v?: boolean } | undefined;

/**
 * 存档里的 mirror 语义版本（R113）。
 *   2 = 器件**本地轴**（现行）。不带此标记的旧存档 = 屏幕语义，
 *       由 sandboxLoad 的 migrateMirror 按 angle 换算迁移（详见那里的推导）。
 * 序列化侧（sandboxSerialize）与载入侧（sandboxLoad）共用这一个常量，
 * 两处各写一个数字早晚会对不上。
 */
export const MIRROR_VER_LOCAL = 2;

/** 端口 attrs 里「随镜像取反」的数值路径（x 系 / y 系）。 */
const ATTR_X_PATHS = [
  'wire/x1', 'wire/x2', 'port/refX', 'port/cx', 'port/x',
  'bits/refX', 'bits/x', 'iolabel/refX', 'iolabel/x',
];
const ATTR_Y_PATHS = [
  'wire/y1', 'wire/y2', 'port/refY', 'port/cy', 'port/y',
  'bits/refY', 'bits/y', 'iolabel/refY', 'iolabel/y',
];

/** 一个 group 的原始几何快照。 */
type GroupBase = {
  /** 原始 position（命名布局对象 / 字符串 / 函数 / null）。 */
  position: any;
  /** position 是否为 joint 原生支持的命名布局对象 `{name,args}`。 */
  named: boolean;
  /**
   * 原始锚点（joint 算好的最终位置）。**只在 position 不是命名布局时用得上**——
   * 那类器件 joint 不认我们注入的 position，只能把锚点写死（见 writeBack）。
   */
  anchors: { x: number; y: number; angle?: number; id?: string }[] | null;
  /** 会被取反的 attrs 原值：path → 数值。 */
  attrs: Record<string, number>;
};

/** 一颗器件的完整原始几何快照。 */
type MirrorBase = {
  groups: Record<string, GroupBase>;
  /** attrs.body.transform 原值（null = 本来就没有）。 */
  bodyAttrs: string | null;
  /** body DOM transform 原值（null = 本来就没有）。 */
  bodyDom: string | null;
  /** body 是 <g>（走 attrs）还是 <rect>（走 DOM）—— 由构造时实测决定，不猜。 */
  bodyViaAttrs: boolean;
};

const BASE_KEY = 'mirrorBase';

/** 读 joint prop：缺失键一律返回 null（不是 undefined），所以统一用 `== null` 判空。 */
function pget(c: any, path: string): any {
  try { return c.prop(path); } catch { return null; }
}
function pset(c: any, path: string, val: any): void {
  try { c.prop(path, val); } catch { /* ignore */ }
}

/** body 子树内的文本/foreignObject 反翻（视图层，字形回正）。重复调用安全。 */
function syncBodyTextCounterFlip(c: any, paper: any, sx: number, sy: number): void {
  try {
    const v = paper && typeof paper.findViewByModel === 'function' ? paper.findViewByModel(c) : null;
    if (!v?.el) return;
    const bodies = v.el.querySelectorAll('[joint-selector="body"], [data-selector="body"]');
    const fx = sx < 0, fy = sy < 0;
    const flip = fx && fy ? 'scale(-1,-1)' : fx ? 'scaleX(-1)' : fy ? 'scaleY(-1)' : '';
    for (const body of Array.from(bodies) as Element[]) {
      for (const t of Array.from(body.querySelectorAll('text, foreignObject')) as Element[]) {
        const el = t as unknown as HTMLElement & { style: CSSStyleDeclaration };
        if (flip) {
          el.style.transformBox = 'fill-box';
          el.style.transformOrigin = 'center';
          el.style.transform = flip;
        } else {
          el.style.transform = '';
        }
      }
    }
  } catch { /* 视图层尽力而为 */ }
}

/** 取 body 元素（joint 用 `joint-selector` 属性标记，不是 data-selector）。 */
function bodyElOf(c: any, paper: any): SVGElement | null {
  try {
    const v = paper && typeof paper.findViewByModel === 'function' ? paper.findViewByModel(c) : null;
    return (v?.el?.querySelector?.('[joint-selector="body"], [data-selector="body"]') as SVGElement) || null;
  } catch { return null; }
}

/**
 * 采集端口组的真实锚点（joint 算好的最终位置），用来给 position **不是命名布局**
 * 的器件（Lamp / Clock / Input / Output / 数码管 / Dff / Memory）推断出本来在哪一侧。
 *
 * ⚠ 为什么需要：这些器件的 position 要么是**字符串**（实测 Lamp/Input/Clock/NumDisplay
 *   全是 `'absolute'` 这类字符串）、要么是**函数**（Dff/Memory），都不是
 *   `{name:'left',args:{…}}` 形态 ⇒ 早前按「非命名布局」处理时**锚点换边整段跳过**，
 *   只有引线 attrs 被取反 ⇒ 引线缩进本体（实测 Lamp 88px→60px、引脚 ±41→±5）。
 *
 * ⚠ 两个实测细节：
 *   ① `getPortsPositions(g)` 返回的是**对象** `{in:{x,y}}` 而不是数组；
 *   ② 某些组的该对象是**空的**（实测 Input.in / Clock.in / Lamp.out 都是 `{}`），
 *      因为该组没有真实端口。所以推断侧别时要**对整颗器件的所有组取并集**，
 *      否则会误判成"推不出来"。
 */
function anchorPoints(c: any, group: string): { x: number; y: number; id?: string }[] {
  const out: { x: number; y: number; id?: string }[] = [];
  const push = (v: any, id?: string) => {
    if (v && typeof v.x === 'number' && typeof v.y === 'number') out.push({ x: v.x, y: v.y, id });
  };
  // ⚠ R112 实测：`c.prop('ports/groups/{g}/ports')` **返回空数组**（探针打印为 {}），
  //   `c.getPortPosition(pid)` 也**不存在**（调用即抛）。唯一可靠的取法是
  //   `getPortsPositions(group)` —— 它返回对象的**键就是端口 id、值就是锚点**。
  //   ⚠ 必须保留 id：joint 的 getGroupPortsMetrics 会在 reduce 里读锚点上的 `id`，
  //   丢了会抛 "Cannot read properties of undefined (reading 'id')"（端口塌陷）。
  try {
    if (typeof c.getPortsPositions === 'function') {
      const raw = c.getPortsPositions(group);
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const k of Object.keys(raw)) push(raw[k], k);
      } else if (Array.isArray(raw)) {
        raw.forEach((v) => push(v));
      }
    }
  } catch { /* ignore */ }
  return out;
}

/**
 * 采集原始几何快照（只采一次，之后一直复用）。
 * ⚠ 必须**在任何改动之前**采集，所以调用点在 restoreMirror 之前。
 */
function ensureBase(c: any, paper: any): MirrorBase | null {
  const existing = pget(c, BASE_KEY);
  if (existing && typeof existing === 'object' && existing.groups) return existing as MirrorBase;

  let groups: Record<string, GroupBase> = {};
  try {
    const raw = c.prop('ports/groups') || {};
    for (const g of Object.keys(raw)) {
      const gb = raw[g] || {};
      const attrs: Record<string, number> = {};
      for (const p of [...ATTR_X_PATHS, ...ATTR_Y_PATHS]) {
        const [sel, key] = p.split('/');
        const v = gb.attrs?.[sel]?.[key];
        if (typeof v === 'number') attrs[p] = v;
      }
      // position 原样存，另存一份 joint 算好的原始锚点（供"写死坐标"那一支用）。
      // ⚠ position 实测有三种形态（探针 .tmp-r111-anchors）：
      //     {name:'left',args:{dx:30}}  标准门   → joint 原生支持换边，走换 name
      //     'absolute'（字符串）        灯/数码管 → joint 不认注入坐标，走写死锚点
      //     function                    Dff/Memory → 同上
      const pos = gb.position ?? null;
      const named = !!pos && typeof pos === 'object' && typeof pos.name === 'string';
      const anchors = named ? null : (anchorPoints(c, g).length ? anchorPoints(c, g) : null);
      groups[g] = { position: pos, named, anchors, attrs };
    }
  } catch { return null; }

  // body 走 attrs 还是 DOM：**实测** attrs.body.transform 是否本来就有值。
  // 有值 ⇒ joint 会重写它 ⇒ 必须走 attrs；没值 ⇒ 写 attrs 不渲染 ⇒ 只能走 DOM。
  let attrsTf: any = null;
  try { attrsTf = c.attr('body/transform'); } catch { /* ignore */ }
  const bodyViaAttrs = typeof attrsTf === 'string' && attrsTf.length > 0;
  let bodyDom: string | null = null;
  if (!bodyViaAttrs) {
    try { bodyDom = bodyElOf(c, paper)?.getAttribute('transform') ?? null; } catch { /* ignore */ }
  }

  const base: MirrorBase = { groups, bodyAttrs: attrsTf ?? null, bodyDom, bodyViaAttrs };
  pset(c, BASE_KEY, base);
  return base;
}

/** 把快照写回器件（= 完整还原到"无镜像"状态）。 */
function writeBack(c: any, paper: any, base: MirrorBase, sx: number, sy: number): void {
  const mirror = sx < 0 || sy < 0;
  const size = c.get('size') || { width: 60, height: 32 };
  const w = size.width || 60, h = size.height || 32;

  // ① 端口锚点 + ② 端口 attrs
  for (const g of Object.keys(base.groups)) {
    const gb = base.groups[g];

    // ① 锚点：**按 joint 是否原生支持换边，分成两条互不干扰的路径**。
    //   （实测三种 position 形态，探针 .tmp-r111-anchors）
    //
    //   A) 命名布局 `{name,args}`（标准门 And/Or/…）⇒ **换 name + dx 反号**。
    //      ⚠ 必须换 name，**不能**包一层 `x' = w - x`：joint 拿到返回值后**还会自己
    //      再加一次命名布局的 args.dx** ⇒ 坐标镜像被叠加出 2×dx 的偏移
    //      （实测 And 引脚 ±50 → ±80、包围盒 106px → 166px）。
    //      换 name 后锚点完全由 joint 原生算，连线端点自动跟随。
    //
    //   B) 字符串 `'absolute'`（灯/输入/时钟/数码管）与函数（Dff/Memory）⇒ joint
    //      **不认**我们注入的 position（实测喂固定坐标函数，引脚圆点 transform 停在原处、
    //      包围盒 88→60），所以改成把**采集期取到的真实锚点**写死成一个函数，
    //      再整体镜像 x' = w - x。这一支不动 joint 的多引脚分布
    //      （实测 Memory 引脚 y -17,-1,15,31,47 保持不变）。
    if (mirror) {
      if (gb.named) {
        const nm = String(gb.position.name);
        const swapX = sx < 0 && (nm === 'left' || nm === 'right');
        const swapY = sy < 0 && (nm === 'top' || nm === 'bottom');
        if (swapX || swapY) {
          const args = { ...(gb.position.args || {}) };
          // ⚠ 换了边，per-group 偏移必须反号，否则被 joint 再加一次 dx 而偏移 2×dx。
          if (swapX && typeof args.dx === 'number') args.dx = -args.dx;
          if (swapY && typeof args.dy === 'number') args.dy = -args.dy;
          pset(c, `ports/groups/${g}/position`, { ...gb.position, name: swapX ? (nm === 'left' ? 'right' : 'left') : (nm === 'top' ? 'bottom' : 'top'), args });
        }
      } else if (gb.anchors && gb.anchors.length) {
        const snap = gb.anchors;
        // ⚠ R112：joint 会把 position 的返回值按**组声明的端口数** zip，数量不符就
        //   退回原布局或错位。实测 Mux 注入后整组 y 漂 +20px（29,47,65,83 → 49,67,85,103）。
        //   ⇒ 与镜像后的实际锚点数比对，不符就**不注入**（引脚保持原位，仍不分离）。
        //   基准取自镜像后的 joint 视图（此时可能已被上一次施加改过）。
        try {
          const now = typeof c.getPortsPositions === 'function' ? c.getPortsPositions(g) : null;
          const nowN = now && typeof now === 'object' ? Object.keys(now).length : 0;
          if (nowN && nowN !== snap.length) continue;
        } catch { /* 取不到就放行 */ }
        // ⚠ 另一道守卫：joint 自己算出的锚点必须**落在器件尺寸范围内**。
        //   Mux（w=40,h=72）的 in 组锚点 y 是 29,47,65,83 —— 83 已经**超出高度 72**，
        //   说明它的 position 是自定义函数、内部带偏移，joint 只在渲染时做了钳制。
        //   我们把这种锚点原样写回去 ⇒ joint 再钳制一次 ⇒ 整体位移。
        //   这种组一律不注入（引脚保持原位、依旧不分离），只让 ③ 翻本体。
        const fits = snap.every((p) => (p.x || 0) >= -2 && (p.x || 0) <= w + 2
          && (p.y || 0) >= -2 && (p.y || 0) <= h + 2);
        if (!fits) continue;
        pset(c, `ports/groups/${g}/position`, () => snap.map((p) => ({
          ...p,
          x: sx < 0 ? w - (p.x || 0) : (p.x || 0),
          y: sy < 0 ? h - (p.y || 0) : (p.y || 0),
        })));
      }
    } else {
      // 还原：写回原值（null = 本来没定义过 position，交给 joint 默认布局）
      pset(c, `ports/groups/${g}/position`, gb.position ?? undefined);
    }

    // ② 引线/圆点偏移随轴取反（永远从原件算，不基于当前值）
    for (const p of [...ATTR_X_PATHS, ...ATTR_Y_PATHS]) {
      const orig = gb.attrs[p];
      if (typeof orig !== 'number') continue;
      const isX = ATTR_X_PATHS.includes(p);
      const negate = mirror && (isX ? sx < 0 : sy < 0);
      pset(c, `ports/groups/${g}/attrs/${p.split('/')[0]}/${p.split('/')[1]}`, negate ? -orig : orig);
    }
  }

  // ③ body 图形变换
  if (mirror) {
    const flip = `translate(${w / 2},${h / 2}) scale(${sx},${sy}) translate(${-w / 2},${-h / 2})`;
    if (base.bodyViaAttrs) c.attr('body/transform', flip);
    else bodyElOf(c, paper)?.setAttribute('transform', flip);
  } else {
    if (base.bodyViaAttrs) c.attr('body/transform', base.bodyAttrs ?? null);
    else {
      const el = bodyElOf(c, paper);
      if (el) {
        if (base.bodyDom == null) el.removeAttribute('transform');
        else el.setAttribute('transform', base.bodyDom);
      }
    }
  }

  // ④ body 内文本字形回正/反翻
  syncBodyTextCounterFlip(c, paper, sx, sy);
}

/** 强制重渲染这个 cell + 它的连线（模型层改了 prop，joint 不会自动重画）。 */
function rerender(c: any, paper: any): void {
  try {
    const v = paper && typeof paper.findViewByModel === 'function' ? paper.findViewByModel(c) : null;
    if (!v) return;
    if (typeof (v as any).update === 'function') (v as any).update();
    // 连线跟随：joint 只在源/目标 change:position|size|angle 时更新连线端点，
    // 我们改的是 ports ⇒ 必须显式让相连的 link 重算端点，否则线留在原地。
    const links = (v as any).connectedLinks || [];
    for (const lk of links) {
      try {
        const lv = typeof lk.getView === 'function' ? lk.getView(paper) : lk;
        if (lv && typeof (lv as any).update === 'function') (lv as any).update();
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/**
 * 把 mirror 状态落到一颗器件上。幂等：每次都**从原始快照重算**，
 * 因此翻 N 次与第 1 次一致、翻两次必然复原。
 *
 * ⚠ R113：**这里绝不读 angle**。mirror 已经是器件本地语义（见文件头），
 * 若在这里按 angle 换轴，旋转就会隐式改写镜像状态 —— 那正是「镜像 + 旋转组合后
 * 整体错乱」的根因（实测：水平镜像后 bodyTf=scale(-1,1)，转 90° 后变成 scale(1,-1)）。
 */
export function applyMirror(c: any, paper?: any): void {
  if (!c || !c.get || !c.isElement || !c.isElement()) return;
  const base = ensureBase(c, paper);
  if (!base) return;

  const m: CellMirror = c.get('mirror');
  const mirroring = !!(m && (m.h || m.v));
  const sx = m?.h ? -1 : 1;
  const sy = m?.v ? -1 : 1;

  // 先还原、再施加 —— 全部基于 base，不基于当前状态
  writeBack(c, paper, base, mirroring ? sx : 1, mirroring ? sy : 1);
  rerender(c, paper);
}

/**
 * 翻转一颗器件（dir = 用户点的**屏幕**轴：'h' 屏幕水平 / 'v' 屏幕垂直）。
 *
 * ── 屏幕语义 → 本地语义的换算（R113 推导，探针实测吻合）───────────────
 * 设器件当前视觉变换为 `R(θ)·L`（L = 本地镜像）。用户要求「在屏幕上水平翻转」，
 * 即整体左↔右 对调：
 *   `M_h · R(θ) · L = R(−θ) · M_h · L`（因为 `M·R(θ) = R(−θ)·M`）
 * 而 `M_h · L` 就是**把 L 的 x 分量取反**（−1·mx）。
 * ⇒ 屏幕水平镜像 ≡ **本地 x 轴取反 + 角度取反**，对任意 θ 都成立，
 *   不需要对 90°/270° 特判（特判正是旧实现错位的来源）。
 * 同理屏幕垂直镜像 ≡ **本地 y 轴取反 + 角度取反**。
 *
 * ⚠ 单选/多选必须走**同一个** flipCell：多选再额外 `rotate(-2a)` 会把角度取反做两遍。
 */
export function flipCell(c: any, dir: 'h' | 'v', paper?: any): void {
  if (!c || !c.isElement || !c.isElement()) return;

  // ① 角度取反（R(θ) → R(−θ)）：用 rotate 的增量语义，绕自身中心、不动位置。
  //    ⚠ joint 的 rotate(deg) 实际轨道量是 `angle + deg`，所以 `rotate(-2a)` 才得到 −a；
  //    实测 R113：start=0/45/90/180/270 时 rotate(90) 分别得到 90/135/180/270/0，位置不变。
  const a = Number(c.get('angle') || 0) || 0;
  if (a) { try { c.rotate(-2 * a); } catch { /* 器件不支持旋转就只翻形状 */ } }

  // ② 本地轴取反（幂等：再翻一次即复原）
  const m: any = { ...(c.get('mirror') || {}) };
  if (dir === 'h') m.h = !m.h; else m.v = !m.v;
  if (!m.h && !m.v) { delete m.h; delete m.v; }
  c.prop('mirror', (m.h || m.v) ? m : null);
  applyMirror(c, paper);
}

/**
 * 旋转后重挂：**保留给外部显式调用**。
 * ⚠ R113：正常的 rotateSelection 不再需要它 —— 旋转是纯角度变更，mirror 与端口几何
 * 本来就不该被重算（重算才是 bug 的来源）。这里等价于 applyMirror，仅作兼容别名。
 */
export function remirror(c: any, paper?: any): void {
  applyMirror(c, paper);
}
