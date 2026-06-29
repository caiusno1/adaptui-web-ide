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

/** A map of operation name → ordered parameter names, used to read/write positional args. */
export type OperationSignatures = Record<string, string[]>;

/** Renders adaptation rules to DSL text, grouping rules that share a condition so one
 *  line can activate several actions, each optionally carrying arguments, e.g.
 *  `when time >= 20 then changeBackgroundColor(#0f172a), Dark text`.
 *  Condition-less rules never fire, so are omitted. */
export function serializeAdaptmlRules(rules: AdaptmlRule[], signatures?: OperationSignatures): string {
  const groups: { condition: string; actions: string[] }[] = [];
  for (const r of rules) {
    if (!r.expr || !r.operationName) {
      continue;
    }
    const condition = exprToText(r.expr);
    const action = actionToText(r.operationName, r.args, signatures);
    let group = groups.find((g) => g.condition === condition);
    if (!group) {
      group = { condition, actions: [] };
      groups.push(group);
    }
    if (!group.actions.includes(action)) {
      group.actions.push(action);
    }
  }
  return groups.map((g) => `when ${g.condition} then ${g.actions.join(', ')}`).join('\n');
}

/** Renders an action: `op`, `op(v1, v2)` (positional, via signature) or `op(k=v)` (named). */
function actionToText(op: string, args: Record<string, string> | undefined, sig?: OperationSignatures): string {
  const a = args || {};
  const keys = Object.keys(a).filter((k) => a[k] !== '' && a[k] != null);
  if (keys.length === 0) {
    return op;
  }
  const params = sig?.[op];
  if (params && params.length && params.every((p) => a[p] !== undefined && a[p] !== '')) {
    return `${op}(${params.map((p) => a[p]).join(', ')})`;
  }
  return `${op}(${keys.map((k) => `${k}=${a[k]}`).join(', ')})`;
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
export function parseAdaptmlDsl(text: string, signatures?: OperationSignatures): DslParseResult {
  const rules: AdaptmlRule[] = [];
  const errors: DslParseError[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = stripComment(raw).trim();
    if (!line) {
      return;
    }
    try {
      rules.push(...parseRuleLine(line, signatures));
    } catch (e) {
      errors.push({ line: i + 1, message: (e as Error).message });
    }
  });
  return { rules, errors };
}

function stripComment(s: string): string {
  // A line starting with '#' is a full-line comment, and '//' starts a comment
  // anywhere. '#' is NOT a comment mid-line, so hex colours (e.g. #abcdef in an
  // argument) survive.
  if (/^\s*#/.test(s)) {
    return '';
  }
  const i = s.indexOf('//');
  return i >= 0 ? s.slice(0, i) : s;
}

/** Parses one `when … then …` line into one rule per (comma-separated) action. */
function parseRuleLine(line: string, sig?: OperationSignatures): AdaptmlRule[] {
  const m = /^when\b([\s\S]*?)\bthen\b([\s\S]*)$/i.exec(line);
  if (!m) {
    if (!/^when\b/i.test(line)) {
      throw new Error('a rule must start with "when"');
    }
    throw new Error('missing "then <operation>"');
  }
  const exprStr = m[1].trim();
  if (!exprStr) {
    throw new Error('missing a condition after "when"');
  }
  const actions = splitActions(m[2]);
  if (actions.length === 0) {
    throw new Error('missing an operation name after "then"');
  }
  const expr = parseExpr(exprStr);
  return actions.map((action) => parseAction(action, expr, sig));
}

/** Splits the `then` part into actions on top-level commas (commas inside `(...)` are kept). */
function splitActions(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth = Math.max(0, depth - 1); cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else { cur += ch; }
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Parses a single action: `op`, `op(v1, v2)` (positional) or `op(k=v, …)` (named). */
function parseAction(action: string, expr: BoolExpr, sig?: OperationSignatures): AdaptmlRule {
  const m = /^([^(]+?)\s*(?:\(([\s\S]*)\))?\s*$/.exec(action);
  if (!m || !m[1].trim()) {
    throw new Error(`invalid action "${action}"`);
  }
  const operationName = m[1].trim();
  const argsStr = m[2];
  if (argsStr === undefined || argsStr.trim() === '') {
    return { expr, operationName };
  }
  const args: Record<string, string> = {};
  const params = sig?.[operationName] || [];
  argsStr.split(',').map((x) => x.trim()).filter((x) => x.length > 0).forEach((ap, i) => {
    const eq = ap.indexOf('=');
    if (eq >= 0) {
      args[ap.slice(0, eq).trim()] = ap.slice(eq + 1).trim();   // named
    } else if (params[i] !== undefined) {
      args[params[i]] = ap;                                     // positional via signature
    }
  });
  return { expr, operationName, args };
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
