// 布尔表达式 → 电路图生成（借鉴 OpenCircuits ExprToCircuitPopup / ExpressionParser，
// 算法移植自上游 GenerateTokens + GenerateInputTree + TreeToCircuit + ComponentOrganizer，
// 生成目标适配本仓沙盒 cells 管线：产物是 loadCells/insertCellsAt 可直灌的 {cells:[...]}，
// 天然支持撤销/存盘/导出 Verilog/仿真——与上游"生成即入画布"同构）。
//
// R118：多输出语句 + CSE 公共子表达式共享 + 直接存部件（上游 isIC 概念本地化）。
// R119：多位总线与切片——a[3:1]、a[0]；位宽自动推断；BusSlice 落器件；位宽校验不猜扩展。
// R120：**拼接 {A, B}**（Verilog 语义：左高右低 → BusGroup，in0=最低位）+ **常量 0/1**。
//
// 语法：
//   与 & && * AND   或 | || + OR   异或 ^ ^^ XOR   非 ! ~ NOT
//   括号 ( )；拼接 { , }（逗号分隔，左高右低）；常量 0 / 1（多位常量用拼接 {1,1,0,1}）
//   赋值 =；语句分隔 ; / 换行；切片 var[msb:lsb] / var[i]
//   优先级：或 < 异或 < 与 < 非 < 拼接 < 括号
// 结构语义（照抄上游，逐条有判据）：
//   - 同型结合；括号定型（final）；反相融合（isNot→Nand）；扇入上限 8 嵌套分桶
//   - CSE：结构键严格同构（子序敏感）共享一颗门；拼接同样入共享池

export type ExprNode =
  | { kind: 'leaf'; ident: string; slice?: { msb: number; lsb: number } }
  | { kind: 'const'; v: 0 | 1 }
  | { kind: 'unop'; child: ExprNode }
  | { kind: 'binop'; type: '&' | '|' | '^'; isNot: boolean; children: ExprNode[] }
  | { kind: 'concat'; parts: ExprNode[] };

export interface ExprGenOptions {
  /** 无赋值语句时的输出端口名（默认 'Y'）；Input/Output 器件的 net 即端口名，导出 Verilog 同名 */
  outputName?: string;
}

export interface ExprGenResult {
  cells: any[];
  /** 变量名（按首次出现序） */
  vars: string[];
  /** 变量位宽（R119：切片最大下标 +1 推断，无切片=1） */
  varBits: Record<string, number>;
  /** 输出端口名（按语句序） */
  outputs: string[];
  /** 拓扑摘要（供 UI 预览与闸门断言）：{type} → 颗数（CSE 后） */
  gateCounts: Record<string, number>;
  /** CSE 共享统计：被 2+ 处消费的门数（教学反馈用） */
  shared: number;
  error?: undefined;
}
export interface ExprGenError {
  cells?: undefined; vars?: undefined; varBits?: undefined; outputs?: undefined; gateCounts?: undefined; shared?: undefined;
  error: string;
}

// ---------- 词法 ----------
type Tok =
  | { t: '(' | ')' | '&' | '|' | '^' | '!' | '=' | ';' | '[' | ']' | ':' | '{' | '}' | ',' }
  | { t: 'var'; name: string }
  | { t: 'num'; v: number };

/** 关键字格式下的词（按长度降序匹配，避免 & 吃掉 &&） */
const KEYWORDS: Array<[string, Tok['t']]> = [
  ['&&', '&'], ['||', '|'], ['^^', '^'],
  ['AND', '&'], ['OR', '|'], ['XOR', '^'], ['NOT', '!'],
];

function lex(src: string): { tokens?: Tok[]; error?: string } {
  const tokens: Tok[] = [];
  let i = 0;
  const s = src.trim();
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { tokens.push({ t: '(' }); i++; continue; }
    if (c === ')') { tokens.push({ t: ')' }); i++; continue; }
    if (c === '{') { tokens.push({ t: '{' }); i++; continue; }
    if (c === '}') { tokens.push({ t: '}' }); i++; continue; }
    if (c === ',') { tokens.push({ t: ',' }); i++; continue; }
    if (c === '[') { tokens.push({ t: '[' }); i++; continue; }
    if (c === ']') { tokens.push({ t: ']' }); i++; continue; }
    if (c === ':') { tokens.push({ t: ':' }); i++; continue; }
    if (c === ';') { tokens.push({ t: ';' }); i++; continue; }
    if (c === '=') {
      if (s[i + 1] === '=') return { error: '暂不支持 == 比较——直接写表达式即可（a&b 就是相等与）' };
      tokens.push({ t: '=' }); i++; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      tokens.push({ t: 'num', v: Number(s.slice(i, j)) });
      i = j;
      continue;
    }
    // 关键字/双字符算符（大小写不敏感）
    let matched = false;
    for (const [kw, ty] of KEYWORDS) {
      if (s.slice(i, i + kw.length).toUpperCase() === kw) {
        // 关键字后不能紧跟变量字符（ANDX 不是 AND*X）
        if (/^[A-Za-z]$/.test(kw[0]) && /[A-Za-z0-9_]/.test(s[i + kw.length] || '')) continue;
        tokens.push({ t: ty } as Tok); i += kw.length; matched = true; break;
      }
    }
    if (matched) continue;
    if (c === '&' || c === '*') { tokens.push({ t: '&' }); i++; continue; }
    if (c === '|' || c === '+') { tokens.push({ t: '|' }); i++; continue; }
    if (c === '^') { tokens.push({ t: '^' }); i++; continue; }
    if (c === '!' || c === '~') { tokens.push({ t: '!' }); i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const name = s.slice(i, j);
      i = j;
      // 撇号后缀（a'）：语法层不支持——给明确的改写指引（上游同样不支持，错误文案本地化）
      if (i < s.length && s[i] === "'") return { error: `暂不支持撇号取反（${name}'）——请写成 !${name}` };
      tokens.push({ t: 'var', name } as Tok);
      continue;
    }
    return { error: `无法识别的字符 "${c}"（位置 ${i + 1}）` };
  }
  if (!tokens.length) return { error: '表达式为空' };
  return { tokens };
}

// ---------- 语法（优先级递归下降，移植上游 generateInputTreeCore） ----------
const PREC = ['|', '^', '&', '!', '{', '('] as const;
const MAX_FAN = 8; // 上游同值：digitaljs 门扇入习惯上限
const MAX_BIT = 32; // 本仓位宽习惯上限（与器件参数编辑 1–32 对齐）

class ParseError extends Error {}

/** 变量（可带切片）：var / var[msb:lsb] / var[i]；返回新 pos */
function parseLeaf(toks: Tok[], pos: number): { node: ExprNode; pos: number } {
  const tk = toks[pos] as { t: 'var'; name: string };
  pos++;
  if (pos < toks.length && toks[pos].t === '[') {
    pos++; // 吃 '['
    const a = toks[pos];
    if (!a || a.t !== 'num') throw new ParseError('切片需要数字下标（如 a[3] 或 a[3:0]）');
    let hi = a.v;
    pos++;
    let lo = hi;
    const b = toks[pos];
    if (b && b.t === ':') {
      pos++;
      const c = toks[pos];
      if (!c || c.t !== 'num') throw new ParseError('切片冒号后需要数字（如 a[3:0]）');
      lo = c.v;
      pos++;
    }
    if (!toks[pos] || toks[pos].t !== ']') throw new ParseError('切片缺 "]"');
    pos++;
    if (lo > hi) { const tmp = lo; lo = hi; hi = tmp; } // a[0:3] 容忍，按 [3:0] 理解
    if (hi >= MAX_BIT) throw new ParseError(`切片下标 ${hi} 超过位宽上限 ${MAX_BIT}`);
    return { node: { kind: 'leaf', ident: tk.name, slice: { msb: hi, lsb: lo } }, pos };
  }
  return { node: { kind: 'leaf', ident: tk.name }, pos };
}

function parseCore(toks: Tok[], pos: number, precIdx: number): { node: ExprNode; pos: number; final?: boolean } {
  const op = PREC[precIdx];
  const next = (precIdx + 1) % PREC.length;
  const tk = toks[pos];
  if (!tk) throw new ParseError('表达式意外结束（缺右操作数？）');
  if (tk.t === ')' || tk.t === ';' || tk.t === '=' || tk.t === '}' || tk.t === ',') {
    if (tk.t === ')') {
      const prev = toks[pos - 1];
      if (prev && prev.t === '(') throw new ParseError('空括号 ()');
      throw new ParseError('括号不匹配：多余的 ")"');
    }
    throw new ParseError(`缺少左操作数（"${tk.t}"）`);
  }
  if (op === '(') {
    // primary 层：只有真括号才吃 '('；var/num 直接消费（R120：'{' 层内容解析也转调到这里，
    // 无守卫的话 var 会被当成括号误吃——用例 y={a[1:0],b[1:0]} 报「缺少左操作数（[）」实证）
    if (tk.t === 'var') return parseLeaf(toks, pos);
    if (tk.t === 'num') {
      if (tk.v !== 0 && tk.v !== 1) throw new ParseError('常量只能是 0 或 1（多位常量用拼接，如 {1,1,0,1}）');
      return { node: { kind: 'const', v: tk.v as 0 | 1 }, pos: pos + 1 };
    }
    if (tk.t !== '(') throw new ParseError(`缺少左操作数（"${tk.t}"）`);
    pos++; // 吃掉 '('
    const r = parseCore(toks, pos, next);
    if (!toks[r.pos] || (toks[r.pos] as Tok).t !== ')') throw new ParseError('括号不匹配：缺 ")"');
    return { node: r.node, pos: r.pos + 1, final: true }; // 上游 final：括号内容不并入更大的同型门
  }
  if (op === '{') {
    pos++; // 吃 '{'
    const parts: ExprNode[] = [];
    // 内容是完整表达式（含 & |）——回最低层解析（与上游括号层 next 回绕同理）
    const first = parseCore(toks, pos, 0);
    parts.push(first.node);
    let p = first.pos;
    while (toks[p] && (toks[p] as Tok).t === ',') {
      const r = parseCore(toks, p + 1, 0);
      parts.push(r.node);
      p = r.pos;
    }
    if (!toks[p] || (toks[p] as Tok).t !== '}') throw new ParseError('拼接缺 "}"');
    if (parts.length < 2) throw new ParseError('拼接至少要两项（{a, b}）——单项直接写表达式即可');
    return { node: { kind: 'concat', parts }, pos: p + 1, final: true };
  }
  if (op === '!') {
    if (tk.t === '!') {
      const r = parseCore(toks, pos + 1, precIdx);
      const rt = r.node;
      if (rt.kind === 'binop' && !rt.isNot) { rt.isNot = true; return { node: rt, pos: r.pos }; } // !(a&b)→Nand 融合
      return { node: { kind: 'unop', child: rt }, pos: r.pos };
    }
    if (tk.t === '(') return parseCore(toks, pos, PREC.length - 1); // 括号层（勿走 '{' 层——R120 路由拆分）
    if (tk.t === '{') return parseCore(toks, pos, next); // '{' 层
    if (tk.t === 'var') return parseLeaf(toks, pos);
    if (tk.t === 'num') {
      if (tk.v !== 0 && tk.v !== 1) throw new ParseError(`常量只能是 0 或 1（多位常量用拼接，如 {1,1,0,1}）`);
      return { node: { kind: 'const', v: tk.v as 0 | 1 }, pos: pos + 1 };
    }
    throw new ParseError(`缺少左操作数（"${tk.t}"）`);
  }
  // 二元优先级层
  let left = parseCore(toks, pos, next);
  while (toks[left.pos] && (toks[left.pos] as Tok).t === op) {
    const rp = left.pos + 1;
    if (rp >= toks.length) throw new ParseError(`"${opSymbol(op)}" 缺少右操作数`);
    const right = parseCore(toks, rp, precIdx);
    let children: ExprNode[] = !left.final && left.node.kind === 'binop' && left.node.type === op
      ? [...left.node.children] : [left.node];
    if (!right.final && right.node.kind === 'binop' && right.node.type === op) children.push(...right.node.children);
    else children.push(right.node);
    children = nestOverflow(children, op);
    left = { node: { kind: 'binop', type: op as '&' | '|' | '^', isNot: false, children }, pos: right.pos };
  }
  return left;
}

/** 上游 generateNestedTrees：>8 子节点时把尾部换成嵌套子门（每层留 7 + 1 桶） */
function nestOverflow(children: ExprNode[], op: '&' | '|' | '^'): ExprNode[] {
  if (children.length <= MAX_FAN) return children;
  const head = children.slice(0, MAX_FAN - 1);
  const tail = children.slice(MAX_FAN - 1);
  return [...head, { kind: 'binop', type: op, isNot: false, children: nestOverflow(tail, op) }];
}

function opSymbol(op: string): string { return op === '&' ? '&' : op === '|' ? '|' : op === '^' ? '^' : op; }

/** 语句切分：顶层 ';' */
function splitStatements(tokens: Tok[]): Tok[][] | string {
  const stmts: Tok[][] = [];
  let cur: Tok[] = [];
  for (const t of tokens) {
    if (t.t === ';') { if (cur.length) stmts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length) stmts.push(cur);
  if (!stmts.length) return '表达式为空';
  return stmts;
}

/** 按行预处理：行尾补 ';'（让 `y=a` 换行 `z=b` 天然成语句边界） */
function normalizeNewlines(src: string): string {
  return src.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('; ');
}

// ---------- 电路化（本仓 cells 格式 + CSE 共享池 + 位宽） ----------
const GATE_NAME: Record<string, string> = { '&': 'And', '|': 'Or', '^': 'Xor' };
const NEG_GATE_NAME: Record<string, string> = { '&': 'Nand', '|': 'Nor', '^': 'Xnor' };

/** 结构键（CSE 用）：严格同构（子序敏感——a&b 与 b&a 视为不同，保守不猜） */
function structKey(n: ExprNode): string {
  if (n.kind === 'leaf') return n.slice ? `v:${n.ident}[${n.slice.msb}:${n.slice.lsb}]` : `v:${n.ident}`;
  if (n.kind === 'const') return `c:${n.v}`;
  if (n.kind === 'unop') return `!(${structKey(n.child)})`;
  if (n.kind === 'concat') return `{}(${n.parts.map(structKey).join(',')})`;
  return `${n.isNot ? 'N' : ''}${n.type}(${n.children.map(structKey).join(',')})`;
}

let cellSeq = 0;
const nid = (p: string) => `${p}${++cellSeq}`;

interface PlacedRef { cellId: string; outPort: string; bits: number; consumers: number }

export function expressionToCircuit(src: string, opts: ExprGenOptions = {}): ExprGenResult | ExprGenError {
  cellSeq = 0;
  const lx = lex(normalizeNewlines(src));
  if (!lx.tokens) return { error: lx.error || '词法错误' };
  const stmts = splitStatements(lx.tokens);
  if (typeof stmts === 'string') return { error: stmts };
  const parsed: Array<{ out: string; tree: ExprNode }> = [];
  let anonIdx = 0;
  for (const st of stmts) {
    const eqAt = st.findIndex((t) => t.t === '=');
    let outName = '';
    let exprToks = st;
    if (eqAt >= 0) {
      if (eqAt !== 1 || st[0].t !== 'var') return { error: '赋值左侧必须是单个变量名（如 y = a&b）' };
      outName = (st[0] as any).name;
      exprToks = st.slice(2);
      if (!exprToks.length) return { error: `"${outName} =" 缺少表达式` };
    } else {
      outName = (parsed.length === 0 && stmts.length === 1) ? (opts.outputName || 'Y') : `Y${++anonIdx}`;
    }
    try {
      const r = parseCore(exprToks, 0, 0);
      if (r.pos < exprToks.length) {
        const bad = exprToks[r.pos];
        return { error: bad.t === ')' ? '括号不匹配：多余的 ")"' : bad.t === '}' ? '拼接缺 "}"' : `缺少运算符（"${bad.t === 'var' ? (bad as any).name : bad.t}" 附近）` };
      }
      parsed.push({ out: outName, tree: r.node });
    } catch (e) {
      if (e instanceof ParseError) return { error: e.message };
      throw e;
    }
  }
  // 变量收集 + 位宽推断（R119：切片最大下标 +1；无切片=1）
  const vars: string[] = [];
  const varBits: Record<string, number> = {};
  const walkVar = (n: ExprNode) => {
    if (n.kind === 'leaf') {
      if (!vars.includes(n.ident)) vars.push(n.ident);
      const need = n.slice ? n.slice.msb + 1 : 1;
      varBits[n.ident] = Math.max(varBits[n.ident] || 1, need);
      return;
    }
    if (n.kind === 'const') return;
    if (n.kind === 'unop') return walkVar(n.child);
    if (n.kind === 'concat') return n.parts.forEach(walkVar);
    n.children.forEach(walkVar);
  };
  parsed.forEach((p) => walkVar(p.tree));

  // 位宽计算 + 校验（R119/R120）：binop 各子树等宽；concat = 部件之和
  const widthOf = (n: ExprNode): number => {
    if (n.kind === 'leaf') return n.slice ? n.slice.msb - n.slice.lsb + 1 : varBits[n.ident];
    if (n.kind === 'const') return 1;
    if (n.kind === 'unop') return widthOf(n.child);
    if (n.kind === 'concat') return n.parts.reduce((a, p) => a + widthOf(p), 0);
    const ws = n.children.map(widthOf);
    if (ws.some((w) => w !== ws[0])) throw new ParseError(
      `位宽不一致（${opSymbol(n.type)} 的运算数需要等宽）——多位请用切片：a[${ws[0] - 1}:0]`);
    return ws[0];
  };
  try { parsed.forEach((p) => widthOf(p.tree)); }
  catch (e) { if (e instanceof ParseError) return { error: e.message }; throw e; }

  const depth = (n: ExprNode): number =>
    n.kind === 'leaf' ? 0 : n.kind === 'const' ? 0
      : n.kind === 'unop' ? depth(n.child) + 1
        : n.kind === 'concat' ? Math.max(...n.parts.map(depth)) + 1
          : Math.max(...n.children.map(depth)) + 1;
  const maxD = Math.max(1, ...parsed.map((p) => depth(p.tree)));
  const COL_X = (d: number) => 120 + d * 170;

  const cells: any[] = [];
  const gateCounts: Record<string, number> = {};
  const placed = new Map<string, PlacedRef>(); // 变量全宽 → Input cell
  const constRef = new Map<string, PlacedRef>(); // 0/1 → Constant cell（CSE）
  const sliceRef = new Map<string, PlacedRef>(); // var[msb:lsb] → BusSlice cell（CSE）
  const cse = new Map<string, PlacedRef>();     // 门/拼接结构键 → cell（CSE）
  const wire = (from: string, fp: string, to: string, tp: string) =>
    ({ isLink: true, source: { id: from, port: fp }, target: { id: to, port: tp }, netname: `N${cells.length}` });
  let leafRow = 0;
  let gateRow = 0;

  const place = (n: ExprNode): PlacedRef => {
    if (n.kind === 'leaf') {
      const bits = n.slice ? n.slice.msb - n.slice.lsb + 1 : varBits[n.ident];
      if (!n.slice || (n.slice.msb === varBits[n.ident] - 1 && n.slice.lsb === 0 && varBits[n.ident] === bits)) {
        // 全宽（无切片或切片恰覆盖全宽）：直接用 Input
        // R120 级联：后续语句可引用前面的输出名（w = {cout, s}）——找到该输出的
      // 驱动 cell 直接扇出，不再新建 Input；未定义名仍按输入变量处理
      const outRef = outputsRef.get(n.ident);
      if (outRef) { outRef.consumers++; return outRef; }
      let p = placed.get(n.ident);
        if (!p) {
          const id = nid('e');
          cells.push({ id, type: 'Input', position: { x: COL_X(0), y: 90 + leafRow * 70 }, net: n.ident, bits: varBits[n.ident] });
          leafRow++;
          p = { cellId: id, outPort: 'out', bits: varBits[n.ident], consumers: 0 };
          placed.set(n.ident, p);
        }
        p.consumers++;
        return { ...p, consumers: 1 };
      }
      // 切片：Input（全宽）+ BusSlice 提取
      const key = `${n.ident}[${n.slice!.msb}:${n.slice!.lsb}]`;
      const hit = sliceRef.get(key);
      if (hit) { hit.consumers++; return hit; }
      const src = place({ kind: 'leaf', ident: n.ident });
      const id = nid('s');
      cells.push({
        id, type: 'BusSlice', position: { x: COL_X(0) + 90, y: 90 + gateRow * 70 },
        slice: { first: n.slice!.lsb, count: bits, total: varBits[n.ident] },
      });
      gateRow++;
      gateCounts.BusSlice = (gateCounts.BusSlice || 0) + 1;
      cells.push(wire(src.cellId, 'out', id, 'in'));
      const p: PlacedRef = { cellId: id, outPort: 'out', bits, consumers: 1 };
      sliceRef.set(key, p);
      return p;
    }
    if (n.kind === 'const') {
      const key = `c:${n.v}`;
      const hit = constRef.get(key);
      if (hit) { hit.consumers++; return hit; }
      const id = nid('k');
      cells.push({ id, type: 'Constant', position: { x: COL_X(0), y: 90 + leafRow * 70 }, constant: String(n.v) });
      leafRow++;
      const p: PlacedRef = { cellId: id, outPort: 'out', bits: 1, consumers: 1 };
      constRef.set(key, p);
      return p;
    }
    const key = structKey(n);
    const hit = cse.get(key);
    if (hit) { hit.consumers++; return hit; }
    if (n.kind === 'unop') {
      const c = place(n.child);
      const id = nid('g');
      cells.push({ id, type: 'Not', position: { x: COL_X(depth(n)), y: 90 + gateRow * 70 }, bits: c.bits });
      gateRow++;
      gateCounts.Not = (gateCounts.Not || 0) + 1;
      cells.push(wire(c.cellId, c.outPort, id, 'in'));
      const p: PlacedRef = { cellId: id, outPort: 'out', bits: c.bits, consumers: 1 };
      cse.set(key, p);
      return p;
    }
    if (n.kind === 'concat') {
      // Verilog 语义：{A, B} 左高右低 → BusGroup in0=最低位（digitaljs Vector3vl.concat 低位在前）
      const parts = n.parts.map(place); // parts[0]=A（高位）
      const groups = parts.map((p) => p.bits).reverse(); // in0..inN 位宽（低位在前）
      const id = nid('u');
      const total = parts.reduce((a, p) => a + p.bits, 0);
      cells.push({ id, type: 'BusGroup', position: { x: COL_X(depth(n)), y: 90 + gateRow * 70 }, groups, bits: total });
      gateRow++;
      gateCounts.BusGroup = (gateCounts.BusGroup || 0) + 1;
      // parts[0]（Verilog 最高位）→ in{N-1}；parts[last]（最低位）→ in0
      parts.forEach((p, idx) => {
        const portIdx = parts.length - 1 - idx;
        cells.push(wire(p.cellId, p.outPort, id, `in${portIdx}`));
      });
      const p: PlacedRef = { cellId: id, outPort: 'out', bits: total, consumers: 1 };
      cse.set(key, p);
      return p;
    }
    const children = n.children.map(place);
    const type = n.isNot ? NEG_GATE_NAME[n.type] : GATE_NAME[n.type];
    const id = nid('g');
    const bits = children[0].bits;
    cells.push({ id, type, position: { x: COL_X(depth(n)), y: 90 + gateRow * 70 }, bits, inputs: children.length });
    gateRow++;
    gateCounts[type] = (gateCounts[type] || 0) + 1;
    children.forEach((c, idx) => cells.push(wire(c.cellId, c.outPort, id, `in${idx + 1}`)));
    const p: PlacedRef = { cellId: id, outPort: 'out', bits, consumers: 1 };
    cse.set(key, p);
    return p;
  };

  const outputs: string[] = [];
  const outputsRef = new Map<string, PlacedRef>(); // R120 级联：输出名 → 驱动 cell
  parsed.forEach((st) => {
    const root = place(st.tree);
    outputsRef.set(st.out, root);
    const outId = nid('o');
    cells.push({ id: outId, type: 'Output', position: { x: COL_X(maxD + 1), y: 90 + outputs.length * 70 }, net: st.out, bits: root.bits });
    cells.push(wire(root.cellId, root.outPort, outId, 'in'));
    outputs.push(st.out);
  });
  const shared = [...cse.values(), ...sliceRef.values(), ...constRef.values()].filter((p) => p.consumers > 1).length;
  return { cells, vars, varBits, outputs, gateCounts, shared };
}

/** 兼容入口：单表达式（R117 对话框旧调用零改动；多语句文本也能直接进——outputs 会多于 1） */
export function expressionToCells(src: string, opts: ExprGenOptions = {}): ExprGenResult | ExprGenError {
  return expressionToCircuit(src, opts);
}

/** 表达式求真值（闸门判据用：与电路仿真对拍，两条独立实现路径；env 值为无符号整数） */
export function evalExpr(src: string, env: Record<string, number>): Record<string, number> | ExprGenError {
  const lx = lex(normalizeNewlines(src));
  if (!lx.tokens) return { error: lx.error || 'lex' };
  const stmts = splitStatements(lx.tokens);
  if (typeof stmts === 'string') return { error: stmts };
  const out: Record<string, number> = {};
  let anon = 0;
  for (const st of stmts) {
    const eqAt = st.findIndex((t) => t.t === '=');
    let name = '';
    let exprToks = st;
    if (eqAt >= 0) { name = (st[0] as any).name; exprToks = st.slice(2); } else name = `Y${++anon}`;
    const t = parseCore(exprToks, 0, 0);
    const mask = (b: number) => b >= 32 ? -1 >>> 0 : ((1 << b) - 1);
    const widthOf = (n: ExprNode): number => {
      if (n.kind === 'leaf') return n.slice ? n.slice.msb - n.slice.lsb + 1 : 1;
      if (n.kind === 'const') return 1;
      if (n.kind === 'unop') return widthOf(n.child);
      if (n.kind === 'concat') return n.parts.reduce((a, p) => a + widthOf(p), 0);
      return widthOf(n.children[0]);
    };
    const ev = (n: ExprNode): number => {
      if (n.kind === 'leaf') {
        const v = (env[n.ident] ?? 0) >>> 0;
        return n.slice ? (v >> n.slice.lsb) & mask(n.slice.msb - n.slice.lsb + 1) : v;
      }
      if (n.kind === 'const') return n.v;
      if (n.kind === 'unop') { const w = Math.max(1, widthOf(n.child)); return (~ev(n.child)) & mask(w); }
      if (n.kind === 'concat') {
        // 左高右低：acc = (acc << w(part)) | part
        let acc = 0;
        for (const p of n.parts) { const w = widthOf(p); acc = ((acc << w) | (ev(p) & mask(w))) >>> 0; }
        return acc;
      }
      const vs = n.children.map(ev);
      const w = Math.max(1, widthOf(n.children[0]));
      let acc = vs[0];
      for (let k = 1; k < vs.length; k++) {
        acc = n.type === '&' ? (acc & vs[k]) : n.type === '|' ? (acc | vs[k]) : (acc ^ vs[k]);
      }
      if (n.isNot) acc = ~acc;
      return acc & mask(w);
    };
    out[name] = ev(t.node) >>> 0;
    env[name] = out[name]; // R120 级联：后续语句可引用前面的输出名
  }
  return out;
}
