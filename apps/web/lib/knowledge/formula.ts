/**
 * Tiny safe arithmetic evaluator for smart-table FORMULA columns. Supports
 * numbers, unary +/-, binary + - * / and parentheses, plus `{Column Name}`
 * references resolved via getNum. No eval/Function — a hand-written tokenizer +
 * shunting-yard. Returns null on any parse error, missing reference, or
 * non-finite result.
 */
type Tok =
  | { t: 'num'; v: number }
  | { t: 'ref'; name: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' }
  | { t: 'unary'; v: '-' | '+' }
  | { t: 'lp' }
  | { t: 'rp' };

// Strict numeric literal: digits with at most one dot ("5", "5.", ".5", "5.5").
// Rejects "1.2.3", "3..5", ".", ".." so a typo'd constant fails loudly (null)
// rather than silently truncating via parseFloat.
const NUMBER_RE = /^(\d+\.?\d*|\.\d+)$/;

function tokenize(expr: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  // A '+'/'-' is BINARY only after a value or a closing paren; otherwise unary.
  const afterValue = () => {
    const p = out[out.length - 1];
    return !!p && (p.t === 'num' || p.t === 'ref' || p.t === 'rp');
  };
  while (i < expr.length) {
    const c = expr[i]!;
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (c === '{') {
      const end = expr.indexOf('}', i + 1);
      if (end === -1) throw new Error('unterminated ref');
      out.push({ t: 'ref', name: expr.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === '(') { out.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp' }); i++; continue; }
    if (c === '+' || c === '-') {
      out.push(afterValue() ? { t: 'op', v: c } : { t: 'unary', v: c });
      i++;
      continue;
    }
    if (c === '*' || c === '/') { out.push({ t: 'op', v: c }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < expr.length && /[0-9.]/.test(expr[j]!)) j++;
      const slice = expr.slice(i, j);
      if (!NUMBER_RE.test(slice)) throw new Error('bad number');
      const v = parseFloat(slice);
      if (!Number.isFinite(v)) throw new Error('bad number');
      out.push({ t: 'num', v });
      i = j;
      continue;
    }
    throw new Error(`unexpected char: ${c}`);
  }
  return out;
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
const UNARY_PREC = 3; // binds tighter than * and / so `{a} * -1` = a * (-1)

function precOf(tok: Tok): number {
  if (tok.t === 'op') return PREC[tok.v]!;
  if (tok.t === 'unary') return UNARY_PREC;
  return -1;
}

function toRpn(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  const ops: Tok[] = [];
  for (const tok of tokens) {
    if (tok.t === 'num' || tok.t === 'ref') out.push(tok);
    else if (tok.t === 'op') {
      // left-associative binary: pop ops of >= precedence
      while (ops.length) {
        const top = ops[ops.length - 1]!;
        if ((top.t === 'op' || top.t === 'unary') && precOf(top) >= PREC[tok.v]!) out.push(ops.pop()!);
        else break;
      }
      ops.push(tok);
    } else if (tok.t === 'unary') {
      // right-associative: nothing has higher precedence, so just stack it
      ops.push(tok);
    } else if (tok.t === 'lp') ops.push(tok);
    else if (tok.t === 'rp') {
      while (ops.length && ops[ops.length - 1]!.t !== 'lp') out.push(ops.pop()!);
      if (!ops.length) throw new Error('mismatched paren');
      ops.pop(); // drop lp
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op.t === 'lp') throw new Error('mismatched paren');
    out.push(op);
  }
  return out;
}

export function evaluateFormula(expr: string, getNum: (name: string) => number | null): number | null {
  if (!expr || !expr.trim()) return null;
  try {
    const rpn = toRpn(tokenize(expr));
    const st: number[] = [];
    for (const tok of rpn) {
      if (tok.t === 'num') st.push(tok.v);
      else if (tok.t === 'ref') {
        const v = getNum(tok.name);
        if (v === null || !Number.isFinite(v)) return null;
        st.push(v);
      } else if (tok.t === 'unary') {
        const a = st.pop();
        if (a === undefined) return null;
        const r = tok.v === '-' ? -a : a;
        if (!Number.isFinite(r)) return null;
        st.push(r);
      } else if (tok.t === 'op') {
        const b = st.pop();
        const a = st.pop();
        if (a === undefined || b === undefined) return null;
        let r: number;
        switch (tok.v) {
          case '+': r = a + b; break;
          case '-': r = a - b; break;
          case '*': r = a * b; break;
          case '/': r = b === 0 ? NaN : a / b; break;
          default: return null;
        }
        if (!Number.isFinite(r)) return null;
        st.push(r);
      } else {
        return null; // lp/rp never survive toRpn
      }
    }
    return st.length === 1 && Number.isFinite(st[0]!) ? st[0]! : null;
  } catch {
    return null;
  }
}
