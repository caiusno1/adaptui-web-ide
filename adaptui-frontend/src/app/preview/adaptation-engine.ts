/**
 * Adaptation engine for the Preview tab — a small, dependency-free in-memory
 * graph-transformation runtime.
 *
 * It builds a *host graph* from the IFML model (concretized by the Style model),
 * then, for every ADAPTML rule whose conditions hold under the current context,
 * matches the referenced operation's LHS pattern against the host (subgraph
 * matching over node constraints and edge relations) and rewrites the host
 * according to the RHS (preserve + assign, create, delete). The rewritten host
 * is what the Preview renders.
 */

import { AdaptmlRule, BoolExpr, ConditionConfig, ContextProperty, IfmlElementRef } from '../model/adaptation.model';
import {
  HostGraph, IfmlFlow, OperationModel, PatternNodeData, RuntimeEdge, RuntimeNode,
  STYLE_PROPERTIES, StyleRuleData,
} from '../model/transformation.model';

export const DEFAULT_FONT_SIZE = 14;

let createCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${++createCounter}`;
}

// ---------------------------------------------------------------------------
// Building the host graph from IFML + Style
// ---------------------------------------------------------------------------

export function buildHostGraph(elements: IfmlElementRef[], flows: IfmlFlow[], styles: StyleRuleData[]): HostGraph {
  const nodes: RuntimeNode[] = elements.map((el) => {
    const { props, control } = resolveStyle(el, styles);
    const node: RuntimeNode = {
      id: el.cellId,
      sourceId: el.cellId,
      name: el.name,
      type: el.type,
      className: el.className,
      visible: true,
      fontSize: DEFAULT_FONT_SIZE,
      backgroundColor: '',
      control,
      styles: {},
      childStyles: {},
    };
    applyStyleProps(node, props);
    return node;
  });

  const ids = new Set(nodes.map((n) => n.id));
  const edges: RuntimeEdge[] = [];
  for (const el of elements) {
    if (el.parentCellId && ids.has(el.parentCellId)) {
      edges.push({ id: genId('ce'), source: el.parentCellId, target: el.cellId, relation: 'contains' });
    }
  }
  for (const f of flows) {
    if (ids.has(f.sourceCellId) && ids.has(f.targetCellId)) {
      edges.push({ id: genId('fe'), source: f.sourceCellId, target: f.targetCellId, relation: 'navigatesTo' });
    }
  }
  return { nodes, edges };
}

/**
 * Resolves the style props and control for an element. Class rules apply first,
 * then id rules — so an id selector overrides a class selector per property.
 */
function resolveStyle(el: IfmlElementRef, styles: StyleRuleData[]): { props: Record<string, string>; control: string } {
  const props: Record<string, string> = {};
  let control = '';
  const matching = [
    ...styles.filter((s) => s.selectorKind === 'class' && s.selector === el.className),
    ...styles.filter((s) => s.selectorKind === 'id' && s.selector === el.name),
  ];
  for (const s of matching) {
    if (s.control) {
      control = s.control;
    }
    for (const [k, v] of Object.entries(s.props || {})) {
      if (v !== undefined && v !== '') {
        props[k] = v;
      }
    }
  }
  return { props, control };
}

/**
 * Merges catalog-keyed style props onto a runtime node: `backgroundColor` and
 * `fontSize` are dedicated (operation-mutable) fields, flex/grid layout props go
 * to the children container (`childStyles`), everything else to the own-box
 * `styles` map (units applied). Used for both base styling and operation RHS.
 */
function applyStyleProps(node: RuntimeNode, props: Record<string, string>): void {
  for (const def of STYLE_PROPERTIES) {
    const v = props[def.key];
    if (v === undefined || v === '') {
      continue;
    }
    if (def.key === 'backgroundColor') {
      node.backgroundColor = v;
    } else if (def.key === 'fontSize') {
      const n = Number(v);
      if (Number.isFinite(n)) {
        node.fontSize = n;
      }
    } else {
      (def.target === 'children' ? node.childStyles : node.styles)[def.css] = v + (def.unit || '');
    }
  }
  // A border only shows if a style is set — default to solid when width/colour are given.
  if ((node.styles['border-width'] || node.styles['border-color']) && !node.styles['border-style']) {
    node.styles['border-style'] = 'solid';
  }
}

// ---------------------------------------------------------------------------
// Condition / rule evaluation
// ---------------------------------------------------------------------------

export function evaluateCondition(c: ConditionConfig, ctx: Map<string, ContextProperty>): boolean {
  const prop = ctx.get(c.propertyKey);
  if (!prop) {
    return false;
  }
  if (prop.type === 'number') {
    const a = Number(prop.value);
    const b = Number(c.value);
    if (Number.isNaN(a) || Number.isNaN(b)) {
      return false;
    }
    switch (c.operator) {
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      case '==': return a === b;
      case '!=': return a !== b;
      default: return false;
    }
  }
  switch (c.operator) {
    case '==': return prop.value === c.value;
    case '!=': return prop.value !== c.value;
    default: return false;
  }
}

/** Evaluates a boolean expression of conditions combined by AND/OR gates. */
export function evalExpr(expr: BoolExpr, ctx: Map<string, ContextProperty>): boolean {
  if (expr.type === 'condition') {
    return evaluateCondition(expr.condition, ctx);
  }
  return expr.op === 'and'
    ? expr.children.every((c) => evalExpr(c, ctx))
    : expr.children.some((c) => evalExpr(c, ctx));
}

/** An operation fires only when it has a condition expression and it evaluates true. */
export function ruleFires(rule: AdaptmlRule, ctx: Map<string, ContextProperty>): boolean {
  return !!rule.operationName && rule.expr != null && evalExpr(rule.expr, ctx);
}

// ---------------------------------------------------------------------------
// Subgraph matching (LHS)
// ---------------------------------------------------------------------------

function nodeMatches(p: PatternNodeData, h: RuntimeNode): boolean {
  if (p.kind === 'element' && p.match !== 'any' && h.type !== p.match) {
    return false;
  }
  if (p.selectorKind === 'class' && h.className !== p.selector) {
    return false;
  }
  if (p.selectorKind === 'id' && h.name !== p.selector) {
    return false;
  }
  return true;
}

/** Finds all injective matches of an operation's LHS pattern in the host. */
export function findMatches(op: OperationModel, host: HostGraph, limit = 100): Map<string, string>[] {
  const lhsNodes = op.nodes.filter((n) => n.data.role !== 'create');
  const lhsIds = new Set(lhsNodes.map((n) => n.id));
  const lhsEdges = op.edges.filter((e) => e.data.role !== 'create' && lhsIds.has(e.source) && lhsIds.has(e.target));

  const candidates = new Map<string, RuntimeNode[]>();
  for (const ln of lhsNodes) {
    candidates.set(ln.id, host.nodes.filter((hn) => nodeMatches(ln.data, hn)));
  }

  const hasEdge = (s: string, t: string, rel: string) =>
    host.edges.some((e) => e.source === s && e.target === t && e.relation === rel);

  const results: Map<string, string>[] = [];
  const assign = new Map<string, string>();
  const usedHost = new Set<string>();

  const backtrack = (i: number): void => {
    if (results.length >= limit) {
      return;
    }
    if (i === lhsNodes.length) {
      for (const le of lhsEdges) {
        const s = assign.get(le.source);
        const t = assign.get(le.target);
        if (!s || !t || !hasEdge(s, t, le.data.relation)) {
          return;
        }
      }
      results.push(new Map(assign));
      return;
    }
    const ln = lhsNodes[i];
    for (const hn of candidates.get(ln.id) || []) {
      if (usedHost.has(hn.id)) {
        continue;
      }
      assign.set(ln.id, hn.id);
      usedHost.add(hn.id);
      backtrack(i + 1);
      usedHost.delete(hn.id);
      assign.delete(ln.id);
    }
  };

  if (lhsNodes.length > 0) {
    backtrack(0);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rewriting (RHS)
// ---------------------------------------------------------------------------

function applyAssignments(node: RuntimeNode, d: PatternNodeData): void {
  if (d.setVisible === 'true') {
    node.visible = true;
  } else if (d.setVisible === 'false') {
    node.visible = false;
  }
  if (d.setProps) {
    applyStyleProps(node, d.setProps);
  }
}

function createdType(d: PatternNodeData): string {
  if (d.kind === 'style') {
    return 'ViewComponent';
  }
  return d.match === 'any' ? 'ViewComponent' : d.match;
}

/** Applies one matched rule to the host graph (mutates it in place). */
export function applyMatch(op: OperationModel, match: Map<string, string>, host: HostGraph): void {
  const nodeById = new Map(host.nodes.map((n) => [n.id, n] as const));

  // 1. Preserve: apply RHS assignments to the matched node.
  for (const pn of op.nodes) {
    if (pn.data.role === 'preserve') {
      const hid = match.get(pn.id);
      const hn = hid ? nodeById.get(hid) : undefined;
      if (hn) {
        applyAssignments(hn, pn.data);
      }
    }
  }

  // 2. Create new nodes (mapped so create edges can reference them).
  for (const pn of op.nodes) {
    if (pn.data.role === 'create') {
      const node: RuntimeNode = {
        id: genId('rt'),
        name: pn.data.selector || 'created',
        type: createdType(pn.data),
        className: pn.data.selectorKind === 'class' ? pn.data.selector : '',
        visible: true,
        fontSize: DEFAULT_FONT_SIZE,
        backgroundColor: '',
        control: '',
        styles: {},
        childStyles: {},
        created: true,
      };
      applyAssignments(node, pn.data);
      host.nodes.push(node);
      match.set(pn.id, node.id);
    }
  }

  // 3. Delete matched edges.
  for (const pe of op.edges) {
    if (pe.data.role === 'delete') {
      const s = match.get(pe.source);
      const t = match.get(pe.target);
      if (s && t) {
        host.edges = host.edges.filter((e) => !(e.source === s && e.target === t && e.relation === pe.data.relation));
      }
    }
  }

  // 4. Create new edges.
  for (const pe of op.edges) {
    if (pe.data.role === 'create') {
      const s = match.get(pe.source);
      const t = match.get(pe.target);
      if (s && t) {
        host.edges.push({ id: genId('re'), source: s, target: t, relation: pe.data.relation });
      }
    }
  }

  // 5. Delete matched nodes and their incident edges.
  for (const pn of op.nodes) {
    if (pn.data.role === 'delete') {
      const hid = match.get(pn.id);
      if (hid) {
        host.nodes = host.nodes.filter((n) => n.id !== hid);
        host.edges = host.edges.filter((e) => e.source !== hid && e.target !== hid);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Code operations (functions defined in the Code tab)
// ---------------------------------------------------------------------------

/** The sandbox-ish API handed to user code (operations and event refinements). */
export interface CodeApi {
  /** Every runtime element (mutate fields directly, or use the helpers). */
  nodes: RuntimeNode[];
  /** Current context values, keyed by property key. */
  context: Record<string, string>;
  /** Lookups. */
  byId(name: string): RuntimeNode | undefined;
  byName(name: string): RuntimeNode | undefined;
  byClass(className: string): RuntimeNode[];
  byType(type: string): RuntimeNode[];
  /** Mutators. */
  setStyle(node: RuntimeNode, cssProperty: string, value: string): void;
  setBackground(node: RuntimeNode, color: string): void;
  setFontSize(node: RuntimeNode, px: number): void;
  hide(node: RuntimeNode): void;
  show(node: RuntimeNode): void;
  /** Writes a context value (event refinements only; persists and re-adapts). */
  setContext(key: string, value: string): void;
}

/** A code-defined operation: a name and the compiled function to run. */
export interface CodeOperation {
  name: string;
  run: (api: CodeApi) => void;
}

/** Builds the {@link CodeApi} over a set of runtime nodes for the given context. */
export function buildCodeApi(
  nodes: RuntimeNode[],
  ctxProps: ContextProperty[],
  setContext?: (key: string, value: string) => void,
): CodeApi {
  const context: Record<string, string> = {};
  for (const p of ctxProps) {
    context[p.key] = p.value;
  }
  return {
    nodes,
    context,
    byId: (name) => nodes.find((n) => n.name === name),
    byName: (name) => nodes.find((n) => n.name === name),
    byClass: (className) => nodes.filter((n) => n.className === className),
    byType: (type) => nodes.filter((n) => n.type === type),
    setStyle: (node, cssProperty, value) => { if (node) { node.styles[cssProperty] = value; } },
    setBackground: (node, color) => { if (node) { node.backgroundColor = color; } },
    setFontSize: (node, px) => { if (node) { node.fontSize = px; } },
    hide: (node) => { if (node) { node.visible = false; } },
    show: (node) => { if (node) { node.visible = true; } },
    setContext: (key, value) => { if (setContext) { setContext(key, value); } },
  };
}

// ---------------------------------------------------------------------------
// Full run
// ---------------------------------------------------------------------------

function clone(host: HostGraph): HostGraph {
  return { nodes: host.nodes.map((n) => ({ ...n })), edges: host.edges.map((e) => ({ ...e })) };
}

/**
 * Applies every firing rule's operation to a copy of the base host graph. A rule's
 * operation is either a modelled (graph-transformation) operation or a code operation
 * defined in the Code tab — both are referenced by name.
 */
export function runAdaptation(
  base: HostGraph, rules: AdaptmlRule[], ops: OperationModel[], ctxProps: ContextProperty[],
  codeOps: CodeOperation[] = [],
): HostGraph {
  const host = clone(base);
  const ctx = new Map(ctxProps.map((p) => [p.key, p]));
  const opByName = new Map(ops.map((o) => [o.name, o]));
  const codeByName = new Map(codeOps.map((o) => [o.name, o]));

  for (const rule of rules) {
    if (!ruleFires(rule, ctx)) {
      continue;
    }
    const op = opByName.get(rule.operationName);
    if (!op) {
      // Not a modelled operation — try a code operation of the same name.
      const codeOp = codeByName.get(rule.operationName);
      if (codeOp) {
        try {
          codeOp.run(buildCodeApi(host.nodes, ctxProps));
        } catch {
          // A faulty code operation must not break the rest of the adaptation.
        }
      }
      continue;
    }
    const matches = findMatches(op, host);
    const deleted = new Set<string>();
    for (const m of matches) {
      let stale = false;
      for (const hid of m.values()) {
        if (deleted.has(hid)) { stale = true; break; }
      }
      if (stale) {
        continue;
      }
      applyMatch(op, m, host);
      for (const pn of op.nodes) {
        if (pn.data.role === 'delete') {
          const hid = m.get(pn.id);
          if (hid) {
            deleted.add(hid);
          }
        }
      }
    }
  }
  return host;
}

// ---------------------------------------------------------------------------
// Render tree (visible nodes, nested by containment)
// ---------------------------------------------------------------------------

/** A navigation target of an event: the target element and the view it lives in. */
export interface NavTarget {
  targetId: string;
  targetName: string;
  /** Top-level container (view) the target belongs to — where navigation reroutes. */
  targetViewId: string;
}

export interface RenderNode extends RuntimeNode {
  children: RenderNode[];
  flows: NavTarget[];
}

/**
 * Turns the (rewritten) host graph into a forest of visible nodes nested by
 * containment. Each root is a "view"; each node carries its navigation flows
 * (with the target's view) so the Preview can reroute when an event fires.
 */
export function buildRenderTree(host: HostGraph): RenderNode[] {
  const map = new Map<string, RenderNode>();
  for (const n of host.nodes) {
    map.set(n.id, { ...n, children: [], flows: [] });
  }
  const parentOf = new Map<string, string>();
  for (const e of host.edges) {
    if (e.relation === 'contains') {
      const p = map.get(e.source);
      const c = map.get(e.target);
      if (p && c) {
        p.children.push(c);
        parentOf.set(c.id, p.id);
      }
    }
  }
  const viewOf = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur) as string;
    }
    return cur;
  };
  for (const e of host.edges) {
    if (e.relation === 'navigatesTo') {
      const s = map.get(e.source);
      const t = map.get(e.target);
      if (s && t) {
        s.flows.push({ targetId: t.id, targetName: t.name, targetViewId: viewOf(t.id) });
      }
    }
  }
  const prune = (n: RenderNode): boolean => {
    n.children = n.children.filter(prune);
    return n.visible;
  };
  const roots: RenderNode[] = [];
  for (const n of map.values()) {
    if (!parentOf.has(n.id)) {
      roots.push(n);
    }
  }
  return roots.filter(prune);
}
