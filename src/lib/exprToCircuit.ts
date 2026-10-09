// 布尔表达式 → 电路图生成（借鉴 OpenCircuits ExprToCircuitPopup / ExpressionParser，
// 算法移植自上游 GenerateTokens + GenerateInputTree + TreeToCircuit + ComponentOrganizer，
// 生成目标适配本仓沙盒 cells 管线：产物是 loadCells/insertCellsAt 可直灌的 {cells:[...]}，
// 天然支持撤销/存盘/导出 Verilog/仿真——与上游"生成即入画布"同构）。
//
// R118 升级（上游 isIC 概念的本地化 + 上游没有的 CSE）：
//   - **多输出语句**：`s = a^b^cin; cout = (a&b)|(cin&(a^b))`（分号/换行分隔；裸表达式=单输出）
//   - **公共子表达式共享（CSE）**：结构相同的子树只画一颗门（全加器的 a^b 两个输出共用）
//   - 上游 API 体系不同（shared/api/circuit vs 本仓 joint cells）：吸收算法，生成逻辑自研
//
// 语法（对齐上游 + 本仓习惯的超集）：
//   与 & && * AND   或 | || + OR   异或 ^ ^^ XOR   非 ! ~ NOT
//   括号 ( )；赋值 =；语句分隔 ; / 换行；变量 [A-Za-z_][A-Za-z0-9_]*
//   优先级：或 < 异或 < 与 < 非 < 括号
// 结构语义（照抄上游，逐条有判据）：
//   - 同型结合：a&b&c&d → 一颗 4 输入 And（上游 children 扩展；顺序敏感，CSE 只认严格同构）
//   - 括号定型：(a|b)|(c|d) → 三颗二输入 Or，不并成 4 输入（上游 final 标记）
//   - 反相融合：!(a&b) → 一颗 Nand（上游 isNot → NegatedTypeToGate）
//   - 扇入上限 8：超出的同型链嵌套分桶（上游 generateNestedTrees）

export type ExprNode =
  | { kind: 'leaf'; ident: string }
  | { kind: 'unop'; child: ExprNode }
  | { kind: 'binop'; type: '&' | '|' | '^'; isNot: boolean; children: ExprNode[] };

export interface ExprGenOptions {
  /** 无赋值语句时的输出端口名（默认 'Y'）；Input/Output 器件的 net 即端口名，导出 Verilog 同名 */
  outputName?: string;
}

export interface ExprGenResult {
  cells: any[];
  /** 变量名（按首次出现序） */
  vars: string[];
  /** 输出端口名（按语句序） */
  outputs: string[];
  /** 拓扑摘要（供 UI 预览与闸门断言）：{type} → 颗数（CSE 后） */
  gateCounts: Record<string, number>;
  /** CSE 共享统计：被 2+ 处消费的门数（教学反馈用） */
  shared: number;
  error?: undefined;
}
export interface ExprGenError {
  cells?: undefined; vars?: undefined; outputs?: undefined; gateCounts?: undefined; shared?: undefined;
  error: string;
}

// ---------- 词法 ----------
type Tok = { t: '(' | ')' | '&' | '|' | '^' | '!' | '=' | ';' } | { t: 'var'; name: string };

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
    if (c === ';') { tokens.push({ t: ';' }); i++; continue; }
    if (c === '=') {
      if (s[i + 1] === '=') return { error: '暂不支持 == 比较——直接写表达式即可（a&b 就是相等与）' };
      tokens.push({ t: '=' }); i++; continue;
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
const PREC = ['|', '^', '&', '!', '('] as const;
const MAX_FAN = 8; // 上游同值：digitaljs 门扇入习惯上限

class ParseError extends Error {}

function parseCore(toks: Tok[], pos: number, precIdx: number): { node: ExprNode; pos: number; final?: boolean } {
  const op = PREC[precIdx];
  const next = (precIdx + 1) % PREC.length;
  const tk = toks[pos];
  if (!tk) throw new ParseError('表达式意外结束（缺右操作数？）');
  if (tk.t === ')' || tk.t === ';' || tk.t === '=') {
    if (tk.t === ')') {
      const prev = toks[pos - 1];
      if (prev && prev.t === '(') throw new ParseError('空括号 ()');
      throw new ParseError('括号不匹配：多余的 ")"');
    }
    throw new ParseError(`缺少左操作数（"${tk.t}"）`);
  }
  if (op === '(') {
    pos++; // 吃掉 '('
    const r = parseCore(toks, pos, next);
    if (!toks[r.pos] || (toks[r.pos] as Tok).t !== ')') throw new ParseError('括号不匹配：缺 ")"');
    return { node: r.node, pos: r.pos + 1, final: true }; // 上游 final：括号内容不并入更大的同型门
  }
  if (op === '!') {
    if (tk.t === '!') {
      const r = parseCore(toks, pos + 1, precIdx);
      const rt = r.node;
      if (rt.kind === 'binop' && !rt.isNot) { rt.isNot = true; return { node: rt, pos: r.pos }; } // !(a&b)→Nand 融合
      return { node: { kind: 'unop', child: rt }, pos: r.pos };
    }
    if (tk.t === '(') return parseCore(toks, pos, next);
    if (tk.t === 'var') return { node: { kind: 'leaf', ident: tk.name }, pos: pos + 1 };
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

/** 语句切分：顶层 ';'（换行在词法已吞——多语句必须用 ; 或换行前缀等价的 ';'） */
function splitStatements(tokens: Tok[]): Tok[][] | string {
  const stmts: Tok[][] = [];
  let cur: Tok[] = [];
  for (const t of tokens) {
    if (t.t === ';') { if (cur.length) stmts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length) stmts.push(cur);
  if (!stmts.length) return '表达式为空';
  // 换行分隔的语句：词法吞了换行会把两行粘连——预扫描按行切
  return stmts;
}

/** 按行预处理：行尾无运算符时补 ';'（让 `y=a` 换行 `z=b` 天然成语句边界） */
function normalizeNewlines(src: string): string {
  return src.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('; ')
    // 行内赋值安全：join 的 ';' 即语句分隔；末尾 ';' 容忍空语句
    ;
}

// ---------- 电路化（本仓 cells 格式 + CSE 共享池） ----------
const GATE_NAME: Record<string, string> = { '&': 'And', '|': 'Or', '^': 'Xor' };
const NEG_GATE_NAME: Record<string, string> = { '&': 'Nand', '|': 'Nor', '^': 'Xnor' };

/** 结构键（CSE 用）：严格同构（子序敏感——a&b 与 b&a 视为不同，保守不猜） */
function structKey(n: ExprNode): string {
  if (n.kind === 'leaf') return `v:${n.ident}`;
  if (n.kind === 'unop') return `!(${structKey(n.child)})`;
  return `${n.isNot ? 'N' : ''}${n.type}(${n.children.map(structKey).join(',')})`;
}

let cellSeq = 0;
const nid = (p: string) => `${p}${++cellSeq}`;

interface PlacedRef { cellId: string; outPort: string; consumers: number }

export function expressionToCircuit(src: string, opts: ExprGenOptions = {}): ExprGenResult | ExprGenError {
  cellSeq = 0;
  const lx = lex(normalizeNewlines(src));
  if (!lx.tokens) return { error: lx.error || '词法错误' };
  const stmts = splitStatements(lx.tokens);
  if (typeof stmts === 'string') return { error: stmts };
  // 语句解析：`name = expr` 或裸 expr
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
        return { error: bad.t === ')' ? '括号不匹配：多余的 ")"' : `缺少运算符（"${bad.t === 'var' ? (bad as any).name : bad.t}" 附近）` };
      }
      parsed.push({ out: outName, tree: r.node });
    } catch (e) {
      if (e instanceof ParseError) return { error: e.message };
      throw e;
    }
  }
  // 变量收集（首次出现序）
  const vars: string[] = [];
  const walkVar = (n: ExprNode) => {
    if (n.kind === 'leaf') { if (!vars.includes(n.ident)) vars.push(n.ident); return; }
    if (n.kind === 'unop') return walkVar(n.child);
    n.children.forEach(walkVar);
  };
  parsed.forEach((p) => walkVar(p.tree));

  // 深度（leaf=0，门=max(children)+1）
  const depth = (n: ExprNode): number =>
    n.kind === 'leaf' ? 0 : n.kind === 'unop' ? depth(n.child) + 1 : Math.max(...n.children.map(depth)) + 1;
  const maxD = Math.max(1, ...parsed.map((p) => depth(p.tree)));
  const COL_X = (d: number) => 120 + d * 170;

  const cells: any[] = [];
  const gateCounts: Record<string, number> = {};
  const placed = new Map<string, PlacedRef>(); // 变量 → cell（Input 列共享）
  const cse = new Map<string, PlacedRef>();    // 结构键 → cell（CSE 共享）
  const wire = (from: string, fp: string, to: string, tp: string) =>
    ({ isLink: true, source: { id: from, port: fp }, target: { id: to, port: tp }, netname: `N${cells.length}` });
  let leafRow = 0;
  let gateRow = 0;

  const place = (n: ExprNode): PlacedRef => {
    if (n.kind === 'leaf') {
      let p = placed.get(n.ident);
      if (!p) {
        const id = nid('e');
        cells.push({ id, type: 'Input', position: { x: COL_X(0), y: 90 + leafRow * 70 }, net: n.ident, bits: 1 });
        leafRow++;
        p = { cellId: id, outPort: 'out', consumers: 0 };
        placed.set(n.ident, p);
      }
      p.consumers++;
      return p;
    }
    const key = structKey(n);
    const hit = cse.get(key);
    if (hit) { hit.consumers++; return hit; } // CSE：同构子树共用一颗门
    if (n.kind === 'unop') {
      const c = place(n.child);
      const id = nid('g');
      cells.push({ id, type: 'Not', position: { x: COL_X(depth(n)), y: 90 + gateRow * 70 }, bits: 1 });
      gateRow++;
      gateCounts.Not = (gateCounts.Not || 0) + 1;
      cells.push(wire(c.cellId, c.outPort, id, 'in'));
      const p = { cellId: id, outPort: 'out', consumers: 1 };
      cse.set(key, p);
      return p;
    }
    const children = n.children.map(place);
    const type = n.isNot ? NEG_GATE_NAME[n.type] : GATE_NAME[n.type];
    const id = nid('g');
    cells.push({ id, type, position: { x: COL_X(depth(n)), y: 90 + gateRow * 70 }, bits: 1, inputs: children.length });
    gateRow++;
    gateCounts[type] = (gateCounts[type] || 0) + 1;
    children.forEach((c, idx) => cells.push(wire(c.cellId, c.outPort, id, `in${idx + 1}`)));
    const p = { cellId: id, outPort: 'out', consumers: 1 };
    cse.set(key, p);
    return p;
  };

  const outputs: string[] = [];
  parsed.forEach((st) => {
    const root = place(st.tree);
    const outId = nid('o');
    cells.push({ id: outId, type: 'Output', position: { x: COL_X(maxD + 1), y: 90 + outputs.length * 70 }, net: st.out, bits: 1 });
    cells.push(wire(root.cellId, root.outPort, outId, 'in'));
    outputs.push(st.out);
  });
  const shared = [...cse.values()].filter((p) => p.consumers > 1).length;
  return { cells, vars, outputs, gateCounts, shared };
}

/** 兼容入口：单表达式（R117 对话框旧调用零改动；多语句文本也能直接进——outputs 会多于 1） */
export function expressionToCells(src: string, opts: ExprGenOptions = {}): ExprGenResult | ExprGenError {
  return expressionToCircuit(src, opts);
}

/** 表达式求真值（闸门判据用：与电路仿真对拍，两条独立实现路径） */
export function evalExpr(src: string, env: Record<string, 0 | 1>): Record<string, 0 | 1> | ExprGenError {
  const lx = lex(normalizeNewlines(src));
  if (!lx.tokens) return { error: lx.error || 'lex' };
  const stmts = splitStatements(lx.tokens);
  if (typeof stmts === 'string') return { error: stmts };
  const out: Record<string, 0 | 1> = {};
  let anon = 0;
  for (const st of stmts) {
    const eqAt = st.findIndex((t) => t.t === '=');
    let name = '';
    let exprToks = st;
    if (eqAt >= 0) { name = (st[0] as any).name; exprToks = st.slice(2); } else name = `Y${++anon}`;
    const t = parseCore(exprToks, 0, 0);
    const ev = (n: ExprNode): 0 | 1 => {
      if (n.kind === 'leaf') return env[n.ident] ?? 0;
      if (n.kind === 'unop') return (ev(n.child) ? 0 : 1) as 0 | 1;
      const vs = n.children.map(ev);
      const base = n.type === '&' ? vs.every((v) => v === 1) : n.type === '|' ? vs.some((v) => v === 1) : (vs.reduce<number>((a, b) => a ^ b, 0) === 1);
      return ((base !== n.isNot) ? 1 : 0) as 0 | 1;
    };
    out[name] = ev(t.node);
  }
  return out;
}
