// 布尔表达式 → 电路图生成（借鉴 OpenCircuits ExprToCircuitPopup / ExpressionParser，
// 算法移植自上游 GenerateTokens + GenerateInputTree + TreeToCircuit + ComponentOrganizer，
// 生成目标适配本仓沙盒 cells 管线：产物是 loadCells 可直灌的 {cells:[...]}，
// 天然支持撤销/存盘/导出 Verilog/仿真——与上游"生成即入画布"同构）。
//
// 语法（对齐上游 + 本仓习惯的超集）：
//   与 & && * AND   或 | || + OR   异或 ^ ^^ XOR   非 ! ~ ' NOT
//   括号 ( )；变量 [A-Za-z_][A-Za-z0-9_]*（AND/OR/XOR/NOT 关键字形式时不区分大小写）
//   优先级：或 < 异或 < 与 < 非 < 括号
// 结构语义（照抄上游，逐条有判据）：
//   - 同型结合：a&b&c&d → 一颗 4 输入 And（上游 children 扩展）
//   - 括号定型：(a|b)|(c|d) → 三颗二输入 Or，不并成 4 输入（上游 final 标记）
//   - 反相融合：!(a&b) → 一颗 Nand（上游 isNot → NegatedTypeToGate）
//   - 扇入上限 8：超出的同型链嵌套分桶（上游 generateNestedTrees）

export type ExprNode =
  | { kind: 'leaf'; ident: string }
  | { kind: 'unop'; child: ExprNode }
  | { kind: 'binop'; type: '&' | '|' | '^'; isNot: boolean; children: ExprNode[] };

export interface ExprGenOptions {
  /** 输出端口变量名（默认 'Y'）；Input/Output 器件的 net 即端口名，导出 Verilog 同名 */
  outputName?: string;
}

export interface ExprGenResult {
  cells: any[];
  /** 变量名（按首次出现序） */
  vars: string[];
  /** 拓扑摘要（供 UI 预览与闸门断言）：{type, inputs?} 计数 */
  gateCounts: Record<string, number>;
  error?: undefined;
}
export interface ExprGenError {
  cells?: undefined; vars?: undefined; gateCounts?: undefined;
  error: string;
}

// ---------- 词法 ----------
type Tok = { t: '(' | ')' | '&' | '|' | '^' | '!' } | { t: 'var'; name: string };

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
    // 撇号取反：只在"值之后"出现才是同或语境歧义，上游无 ' 后缀；本仓把尾随 ' 视作 NOT 后缀（a' = !a）
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      let name = s.slice(i, j);
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
  if (!tk) throw new ParseError(`表达式意外结束（缺右操作数？）`);
  if (tk.t === ')') {
    const prev = toks[pos - 1];
    if (prev && prev.t === '(') throw new ParseError('空括号 ()');
    throw new ParseError('括号不匹配：多余的 ")"');
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

/** 上游 generateNestedTrees：>8 子节点时把尾部 1 颗换成嵌套子门（每层留 7 + 1 桶） */
function nestOverflow(children: ExprNode[], op: '&' | '|' | '^'): ExprNode[] {
  if (children.length <= MAX_FAN) return children;
  const head = children.slice(0, MAX_FAN - 1);
  const tail = children.slice(MAX_FAN - 1);
  return [...head, { kind: 'binop', type: op, isNot: false, children: nestOverflow(tail, op) }];
}

function opSymbol(op: string): string { return op === '&' ? '&' : op === '|' ? '|' : op === '^' ? '^' : op; }

// ---------- 电路化（本仓 cells 格式） ----------
const GATE_NAME: Record<string, string> = { '&': 'And', '|': 'Or', '^': 'Xor' };
const NEG_GATE_NAME: Record<string, string> = { '&': 'Nand', '|': 'Nor', '^': 'Xnor' };

let cellSeq = 0;
const nid = (p: string) => `${p}${++cellSeq}`;

interface Placed { cellId: string; outPort: string }

export function expressionToCells(src: string, opts: ExprGenOptions = {}): ExprGenResult | ExprGenError {
  cellSeq = 0;
  const lx = lex(src);
  if (!lx.tokens) return { error: lx.error || '词法错误' };
  let tree: ExprNode;
  try {
    const r = parseCore(lx.tokens, 0, 0);
    if (r.pos < lx.tokens.length) {
      const bad = lx.tokens[r.pos];
      return { error: bad.t === ')' ? '括号不匹配：多余的 ")"' : `缺少运算符（"${'t' in bad ? bad.t : ''}${bad.t === 'var' ? (bad as any).name : ''}" 附近）` };
    }
    tree = r.node;
  } catch (e) {
    if (e instanceof ParseError) return { error: e.message };
    throw e;
  }
  // 变量收集（首次出现序）
  const vars: string[] = [];
  (function walk(n: ExprNode) {
    if (n.kind === 'leaf') { if (!vars.includes(n.ident)) vars.push(n.ident); return; }
    if (n.kind === 'unop') return walk(n.child);
    n.children.forEach(walk);
  })(tree);

  const cells: any[] = [];
  const gateCounts: Record<string, number> = {};
  // 深度（OrganizeMinDepth 语义：leaf=0，门=max(children)+1）
  const depth = (n: ExprNode): number =>
    n.kind === 'leaf' ? 0 : n.kind === 'unop' ? depth(n.child) + 1 : Math.max(...n.children.map(depth)) + 1;
  const maxD = Math.max(1, depth(tree));
  const COL_X = (d: number) => 120 + d * 170;
  let leafRow = 0;
  const placed = new Map<string, Placed>();

  const place = (n: ExprNode, rowBudget: { next: number }): Placed => {
    if (n.kind === 'leaf') {
      let p = placed.get(n.ident);
      if (p) return p;
      const id = nid('e');
      const y = 90 + leafRow * 70; leafRow++;
      cells.push({ id, type: 'Input', position: { x: COL_X(0), y }, net: n.ident, bits: 1 });
      p = { cellId: id, outPort: 'out' };
      placed.set(n.ident, p);
      return p;
    }
    if (n.kind === 'unop') {
      const c = place(n.child, rowBudget);
      const id = nid('g');
      const y = 90 + rowBudget.next * 70; rowBudget.next++;
      cells.push({ id, type: 'Not', position: { x: COL_X(depth(n)), y }, bits: 1 });
      gateCounts.Not = (gateCounts.Not || 0) + 1;
      cells.push(wire(c.cellId, c.outPort, id, 'in'));
      return { cellId: id, outPort: 'out' };
    }
    const children = n.children.map((ch) => place(ch, rowBudget));
    const type = n.isNot ? NEG_GATE_NAME[n.type] : GATE_NAME[n.type];
    const id = nid('g');
    const y = 90 + rowBudget.next * 70; rowBudget.next++;
    cells.push({ id, type, position: { x: COL_X(depth(n)), y }, bits: 1, inputs: children.length });
    gateCounts[type] = (gateCounts[type] || 0) + 1;
    children.forEach((c, idx) => cells.push(wire(c.cellId, c.outPort, id, `in${idx + 1}`)));
    return { cellId: id, outPort: 'out' };
  };
  const wire = (from: string, fp: string, to: string, tp: string) =>
    ({ isLink: true, source: { id: from, port: fp }, target: { id: to, port: tp }, netname: `N${cells.length}` });

  const out = place(tree, { next: leafRow + 1 });
  const outId = nid('o');
  cells.push({ id: outId, type: 'Output', position: { x: COL_X(maxD + 1), y: 120 }, net: opts.outputName || 'Y', bits: 1 });
  cells.push(wire(out.cellId, out.outPort, outId, 'in'));
  return { cells, vars, gateCounts };
}

/** 表达式求真值（闸门判据用：与电路仿真对拍） */
export function evalExpr(src: string, env: Record<string, 0 | 1>): 0 | 1 | ExprGenError {
  const r = expressionToCells(src);
  if (!r.cells || !r.vars) return { error: (r as ExprGenError).error || '表达式无法解析' };
  // 直接从词法+语法重算一遍（不求生成电路——判据独立实现路径）
  const lx = lex(src); if (!lx.tokens) return { error: 'lex' };
  const ev = (n: ExprNode): 0 | 1 => {
    if (n.kind === 'leaf') return env[n.ident] ?? 0;
    if (n.kind === 'unop') return (ev(n.child) ? 0 : 1) as 0 | 1;
    const vs = n.children.map(ev);
    const base = n.type === '&' ? vs.every((v) => v === 1) : n.type === '|' ? vs.some((v) => v === 1) : (vs.reduce<number>((a, b) => a ^ b, 0) === 1);
    return ((base !== n.isNot) ? 1 : 0) as 0 | 1;
  };
  const t = parseCore(lx.tokens, 0, 0);
  return ev(t.node);
}
