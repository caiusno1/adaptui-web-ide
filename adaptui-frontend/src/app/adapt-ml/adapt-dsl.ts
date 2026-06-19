/**
 * Textual DSL for the ADAPTML adaptation model.
 *
 * One rule per line:  `when <condition-expression> then <operation>`
 *   - conditions are `<contextKey> <operator> <value>` (e.g. `time >= 20`,
 *     `deviceType == phone`)
 *   - combine with `and` / `or`, group with parentheses (`and` binds tighter)
 *   - `# …` or `// …` are comments; blank lines are ignored
 *
 * This is a pure (framework-free) round-trippable bridge to the same
 * {@link AdaptmlRule}[] the graphical editor publishes, so the two editors are
 * two views of one model.
 */
import { AdaptmlRule, BoolExpr, ConditionConfig, GateOp } from './../model/adaptation.model';

const PREC: Record<GateOp, number> = { or: 1, and: 2 };

// ---------------------------------------------------------------------------
// Serialize: rules -> text
// ---------------------------------------------------------------------------

/** Renders adaptation rules to DSL text (condition-less rules never fire, so are omitted). */
export function serializeAdaptmlRules(rules: AdaptmlRule[]): string {
  return rules
    .filter((r) => r.expr && r.operationName)
    .map((r) => `when ${exprToText(r.expr as BoolExpr)} then ${r.operationName}`)
    .join('\n');
}

function exprToText(e: BoolExpr): string {
  if (e.type === 'condition') {
    const c = e.condition;
    return `${c.propertyKey} ${c.operator} ${c.value}`;
  }
  const sep = e.op === 'and' ? ' and ' : ' or ';
  return e.children
    .map((ch) => {
      const s = exprToText(ch);
      // Parenthesise a lower-precedence child (an `or` inside an `and`).
      return ch.type === 'gate' && PREC[ch.op] < PREC[e.op] ? `(${s})` : s;
    })
    .join(sep);
}

// ---------------------------------------------------------------------------
// Parse: text -> rules (+ diagnostics)
// ---------------------------------------------------------------------------

export interface DslParseError {
  line: number;
  message: string;
}

export interface DslParseResult {
  rules: AdaptmlRule[];
  errors: DslParseError[];
}

/** Parses DSL text into rules, collecting a diagnostic per malformed line. */
export function parseAdaptmlDsl(text: string): DslParseResult {
  const rules: AdaptmlRule[] = [];
  const errors: DslParseError[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = stripComment(raw).trim();
    if (!line) {
      return;
    }
    try {
      rules.push(parseRuleLine(line));
    } catch (e) {
      errors.push({ line: i + 1, message: (e as Error).message });
    }
  });
  return { rules, errors };
}

function stripComment(s: string): string {
  let cut = -1;
  const hash = s.indexOf('#');
  const slashes = s.indexOf('//');
  if (hash >= 0) { cut = hash; }
  if (slashes >= 0 && (cut < 0 || slashes < cut)) { cut = slashes; }
  return cut >= 0 ? s.slice(0, cut) : s;
}

function parseRuleLine(line: string): AdaptmlRule {
  const m = /^when\b([\s\S]*?)\bthen\b([\s\S]*)$/i.exec(line);
  if (!m) {
    if (!/^when\b/i.test(line)) {
      throw new Error('a rule must start with "when"');
    }
    throw new Error('missing "then <operation>"');
  }
  const exprStr = m[1].trim();
  const operationName = m[2].trim();
  if (!exprStr) {
    throw new Error('missing a condition after "when"');
  }
  if (!operationName) {
    throw new Error('missing an operation name after "then"');
  }
  return { expr: parseExpr(exprStr), operationName };
}

type TokType = 'lparen' | 'rparen' | 'and' | 'or' | 'op' | 'ident' | 'num';
interface Tok { t: TokType; v: string; }

function tokenize(s: string): Tok[] {
  const re = /\(|\)|<=|>=|==|!=|<|>|[A-Za-z_][\w-]*|-?\d+(?:\.\d+)?|\S/g;
  const toks: Tok[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const v = m[0];
    if (v === '(') { toks.push({ t: 'lparen', v }); }
    else if (v === ')') { toks.push({ t: 'rparen', v }); }
    else if (/^(<=|>=|==|!=|<|>)$/.test(v)) { toks.push({ t: 'op', v }); }
    else if (/^-?\d/.test(v)) { toks.push({ t: 'num', v }); }
    else if (/^[A-Za-z_]/.test(v)) {
      const lower = v.toLowerCase();
      if (lower === 'and') { toks.push({ t: 'and', v: 'and' }); }
      else if (lower === 'or') { toks.push({ t: 'or', v: 'or' }); }
      else { toks.push({ t: 'ident', v }); }
    } else {
      throw new Error(`unexpected character "${v}"`);
    }
  }
  return toks;
}

/** Recursive-descent parse of a condition expression (`and` binds tighter than `or`). */
function parseExpr(s: string): BoolExpr {
  const toks = tokenize(s);
  let i = 0;
  const peek = (): Tok | undefined => toks[i];
  const next = (): Tok => toks[i++];

  const parseOr = (): BoolExpr => {
    const children = [parseAnd()];
    while (peek()?.t === 'or') { next(); children.push(parseAnd()); }
    return children.length === 1 ? children[0] : { type: 'gate', op: 'or', children };
  };
  const parseAnd = (): BoolExpr => {
    const children = [parseAtom()];
    while (peek()?.t === 'and') { next(); children.push(parseAtom()); }
    return children.length === 1 ? children[0] : { type: 'gate', op: 'and', children };
  };
  const parseAtom = (): BoolExpr => {
    const tk = peek();
    if (!tk) { throw new Error('unexpected end of condition'); }
    if (tk.t === 'lparen') {
      next();
      const e = parseOr();
      if (peek()?.t !== 'rparen') { throw new Error('missing ")"'); }
      next();
      return e;
    }
    if (tk.t !== 'ident') { throw new Error(`expected a context property (got "${tk.v}")`); }
    const propertyKey = next().v;
    if (peek()?.t !== 'op') { throw new Error(`expected an operator after "${propertyKey}"`); }
    const operator = next().v;
    const valTk = peek();
    if (!valTk || (valTk.t !== 'num' && valTk.t !== 'ident')) {
      throw new Error(`expected a value after "${propertyKey} ${operator}"`);
    }
    const value = next().v;
    const condition: ConditionConfig = { propertyKey, operator, value };
    return { type: 'condition', condition };
  };

  const expr = parseOr();
  if (i < toks.length) {
    throw new Error(`unexpected "${toks[i].v}"`);
  }
  return expr;
}
