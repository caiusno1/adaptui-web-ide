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
  HostGraph, IfmlFlow, OperationModel, PatternNodeData, PatternRole, RuntimeEdge, RuntimeNode,
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

/** Reads a host node's attribute by catalog key (so it can be matched in the LHS). */
function attrOf(node: RuntimeNode, key: string): string {
  switch (key) {
    case 'visible': return node.visible ? 'true' : 'false';
    case 'backgroundColor': return node.backgroundColor || '';
    case 'fontSize': return String(node.fontSize);
    case 'control': return node.control || '';
    case 'className': return node.className || '';
    case 'name': return node.name || '';
    default: {
      const def = STYLE_PROPERTIES.find((d) => d.key === key);
      if (!def) { return ''; }
      const map = def.target === 'children' ? node.childStyles : node.styles;
      return map[def.css] != null ? String(map[def.css]) : '';
    }
  }
}

/** Normalises a condition value to the host's stored form (applies the catalog unit). */
function condExpected(key: string, raw: string): string {
  if (key === 'visible' || key === 'backgroundColor' || key === 'fontSize' || key === 'control' || key === 'className' || key === 'name') {
    return raw;
  }
  const def = STYLE_PROPERTIES.find((d) => d.key === key);
  return def && def.unit ? raw + def.unit : raw;
}

/** True if the pattern node carries at least one attribute condition. */
function hasConditions(d: PatternNodeData): boolean {
  return !!d.condProps && Object.keys(d.condProps).some((k) => d.condProps[k] !== '' && d.condProps[k] != null);
}

/** Nodes that participate in matching: preserve, delete, or a create node with conditions. */
function isMatchNode(d: PatternNodeData): boolean {
  return d.kind !== 'params' && (d.role === 'preserve' || d.role === 'delete' || (d.role === 'create' && hasConditions(d)));
}

/** Nodes that match and then overwrite their non-condition attributes (preserve + create-with-conditions). */
function isModifyNode(d: PatternNodeData): boolean {
  return d.kind !== 'params' && (d.role === 'preserve' || (d.role === 'create' && hasConditions(d)));
}

/** A pure add node: a create node with no conditions creates a brand-new element. */
function isCreateNode(d: PatternNodeData): boolean {
  return d.kind !== 'params' && d.role === 'create' && !hasConditions(d);
}

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
  // Multi-attribute conditions: every one must hold (strict AND).
  if (p.condProps) {
    for (const key of Object.keys(p.condProps)) {
      const v = p.condProps[key];
      if (v !== '' && v != null && attrOf(h, key) !== condExpected(key, v)) {
        return false;
      }
    }
  }
  return true;
}

/** A positive LHS node is matched and (preserve) kept or (delete) removed — not create/forbid. */
function isPositive(role: PatternRole): boolean {
  return role !== 'create' && role !== 'forbid';
}

/**
 * A negative application condition is satisfied (violated) for a positive match when
 * the operation's `forbid` pattern (forbidden nodes, and edges marked forbid or
 * touching a forbidden node) can be found in the host extending that match.
 */
function nacViolated(op: OperationModel, posAssign: Map<string, string>, host: HostGraph): boolean {
  const forbidNodes = op.nodes.filter((n) => n.data.role === 'forbid');
  const forbidIds = new Set(forbidNodes.map((n) => n.id));
  const scoped = (id: string) => posAssign.has(id) || forbidIds.has(id);
  const nacEdges = op.edges.filter((e) =>
    e.data.role !== 'create'
    && (e.data.role === 'forbid' || forbidIds.has(e.source) || forbidIds.has(e.target))
    && scoped(e.source) && scoped(e.target));
  if (forbidNodes.length === 0 && nacEdges.length === 0) {
    return false;
  }
  const hasEdge = (s: string, t: string, rel: string) =>
    host.edges.some((e) => e.source === s && e.target === t && e.relation === rel);
  const candidates = new Map<string, RuntimeNode[]>();
  for (const fn of forbidNodes) {
    candidates.set(fn.id, host.nodes.filter((hn) => nodeMatches(fn.data, hn)));
  }
  const used = new Set<string>(posAssign.values());
  const fAssign = new Map<string, string>();
  const edgesHold = () => nacEdges.every((e) => {
    const s = posAssign.get(e.source) ?? fAssign.get(e.source);
    const t = posAssign.get(e.target) ?? fAssign.get(e.target);
    return !!s && !!t && hasEdge(s, t, e.data.relation);
  });
  let found = false;
  const bt = (i: number): void => {
    if (found) {
      return;
    }
    if (i === forbidNodes.length) {
      if (edgesHold()) { found = true; }
      return;
    }
    for (const hn of candidates.get(forbidNodes[i].id) || []) {
      if (used.has(hn.id)) {
        continue;
      }
      fAssign.set(forbidNodes[i].id, hn.id);
      used.add(hn.id);
      bt(i + 1);
      used.delete(hn.id);
      fAssign.delete(forbidNodes[i].id);
      if (found) {
        return;
      }
    }
  };
  bt(0);
  return found;
}

/** Finds all injective matches of an operation's LHS pattern (respecting NACs) in the host. */
export function findMatches(op: OperationModel, host: HostGraph, limit = 100): Map<string, string>[] {
  const lhsNodes = op.nodes.filter((n) => isMatchNode(n.data));
  const lhsIds = new Set(lhsNodes.map((n) => n.id));
  const lhsEdges = op.edges.filter((e) => isPositive(e.data.role) && lhsIds.has(e.source) && lhsIds.has(e.target));

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
      // Reject the match if a negative application condition is present in the host.
      if (nacViolated(op, assign, host)) {
        return;
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
  } else if (!nacViolated(op, new Map(), host)) {
    // An operation with no positive LHS (e.g. a pure add-node) applies once, unless a NAC forbids it.
    results.push(new Map());
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

  // 1. Match-and-overwrite: apply assignments to the matched node. This covers
  //    «preserve» nodes and «create» nodes that carry conditions (the conditions are
  //    the preserved attributes; all other set attributes overwrite the match).
  for (const pn of op.nodes) {
    if (isModifyNode(pn.data)) {
      const hid = match.get(pn.id);
      const hn = hid ? nodeById.get(hid) : undefined;
      if (hn) {
        applyAssignments(hn, pn.data);
      }
    }
  }

  // 2. Create new elements for add-nodes with no conditions.
  for (const pn of op.nodes) {
    if (isCreateNode(pn.data)) {
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

/** Spec for a runtime element created by code. */
export interface CreateElementSpec {
  /** Optional stable id (used when replaying a persisted runtime overlay). */
  id?: string;
  name?: string;
  /** 'ViewContainer' | 'ViewComponent' | 'Event'. Defaults to ViewComponent. */
  type?: string;
  className?: string;
  control?: string;
  /** Parent element (node, id or name) — adds a containment edge. */
  parent?: RuntimeNode | string;
  /** Explicit style props (catalog keys), applied on top of class/id styling. */
  props?: Record<string, string>;
  visible?: boolean;
}

/** A runtime-only style rule applied by code (does not touch the Style editor). */
export interface RuntimeStyleRule {
  selectorKind?: 'id' | 'class';
  selector: string;
  props?: Record<string, string>;
  control?: string;
}

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
  /** Change an existing element. */
  setStyle(node: RuntimeNode, cssProperty: string, value: string): void;
  setBackground(node: RuntimeNode, color: string): void;
  setFontSize(node: RuntimeNode, px: number): void;
  setName(node: RuntimeNode, name: string): void;
  setClass(node: RuntimeNode, className: string): void;
  hide(node: RuntimeNode): void;
  show(node: RuntimeNode): void;
  /** Create a new runtime IFML element (optionally nested in a parent). */
  createElement(spec?: CreateElementSpec): RuntimeNode | undefined;
  /** Delete a runtime element (and everything it contains). */
  deleteElement(node: RuntimeNode | string): void;
  /** Add a relation edge (default `navigatesTo`) between two elements. */
  connect(source: RuntimeNode | string, target: RuntimeNode | string, relation?: string): void;
  /** Remove relation edge(s) between two elements. */
  disconnect(source: RuntimeNode | string, target: RuntimeNode | string, relation?: string): void;
  /** Create a runtime-only style rule, applied to the matching runtime elements. */
  createStyleRule(rule: RuntimeStyleRule): void;
  /** Writes a context value (event refinements; persists and re-adapts). */
  setContext(key: string, value: string): void;
  /** Navigate the Preview to a container/view by name or id (event refinements). */
  navigate(target: string): void;
  /** Cancel the event's normal navigation flow to another ViewContainer (event refinements). */
  blockNavigation(): void;
  /** The ViewContainer this event/refinement belongs to (its "self"), when known. */
  self?: RuntimeNode;
}

/** A code-defined operation: a name and the compiled function to run. */
export interface CodeOperation {
  name: string;
  run: (api: CodeApi) => void;
}

/**
 * A recorded runtime-graph mutation. Event refinements record these into a persistent
 * overlay that the Preview re-applies on every recompute (so their changes survive
 * adaptation), until the browser reloads or the user resets the runtime.
 */
export type OverlayCommand =
  | { kind: 'create'; ref: string; elType: string; className: string; name: string; control: string; parent: string | null; props?: Record<string, string> }
  | { kind: 'delete'; target: string }
  | { kind: 'setBackground'; target: string; value: string }
  | { kind: 'setFontSize'; target: string; value: number }
  | { kind: 'setStyle'; target: string; prop: string; value: string }
  | { kind: 'setName'; target: string; value: string }
  | { kind: 'setClass'; target: string; value: string }
  | { kind: 'visible'; target: string; value: boolean }
  | { kind: 'connect'; source: string; target: string; relation: string }
  | { kind: 'disconnect'; source: string; target: string; relation?: string }
  | { kind: 'styleRule'; rule: RuntimeStyleRule };

/** Sink that captures the runtime-graph mutations performed by an event refinement. */
export interface OverlayRecorder {
  /** Returns a fresh stable id for a created element. */
  nextRef(): string;
  record(command: OverlayCommand): void;
}

/** Hooks injected into the API depending on the context (operation vs event refinement). */
export interface CodeApiOptions {
  setContext?: (key: string, value: string) => void;
  navigate?: (target: string) => void;
  blockNavigation?: () => void;
  /** Base Style rules, used to style created elements by class/id. */
  styles?: StyleRuleData[];
  /**
   * When set, graph mutations are *recorded* (not applied live) so they can be
   * persisted and replayed — used for event refinements.
   */
  recorder?: OverlayRecorder;
  /** The ViewContainer the event/refinement belongs to (exposed as `api.self`). */
  self?: RuntimeNode;
}

/**
 * Builds the {@link CodeApi} over a host graph for the given context. The whole
 * runtime graph (nodes + edges) is mutable: create / change / delete elements and
 * relations, plus runtime-only style rules. In a code operation these changes feed
 * the rendered tree; in an event refinement they are transient (use setContext /
 * navigate / blockNavigation for persistent effects).
 */
export function buildCodeApi(
  host: HostGraph,
  ctxProps: ContextProperty[],
  opts: CodeApiOptions = {},
): CodeApi {
  const context: Record<string, string> = {};
  for (const p of ctxProps) {
    context[p.key] = p.value;
  }
  const resolve = (ref: RuntimeNode | string | undefined): RuntimeNode | undefined => {
    if (ref && typeof ref === 'object') {
      return ref;
    }
    if (typeof ref === 'string') {
      return host.nodes.find((n) => n.id === ref) || host.nodes.find((n) => n.name === ref);
    }
    return undefined;
  };
  const applyBaseStyle = (node: RuntimeNode): void => {
    if (!opts.styles) {
      return;
    }
    const resolved = resolveStyle({ cellId: node.id, name: node.name, type: node.type, className: node.className } as IfmlElementRef, opts.styles);
    applyStyleProps(node, resolved.props);
    if (resolved.control && !node.control) {
      node.control = resolved.control;
    }
  };
  const rec = opts.recorder;
  const idOf = (ref: RuntimeNode | string | undefined): string => {
    const n = resolve(ref);
    return n ? n.id : (typeof ref === 'string' ? ref : '');
  };
  return {
    nodes: host.nodes,
    context,
    byId: (name) => host.nodes.find((n) => n.name === name),
    byName: (name) => host.nodes.find((n) => n.name === name),
    byClass: (className) => host.nodes.filter((n) => n.className === className),
    byType: (type) => host.nodes.filter((n) => n.type === type),
    setStyle: (node, cssProperty, value) => {
      if (rec) { rec.record({ kind: 'setStyle', target: idOf(node), prop: cssProperty, value }); }
      else if (node) { node.styles[cssProperty] = value; }
    },
    setBackground: (node, color) => {
      if (rec) { rec.record({ kind: 'setBackground', target: idOf(node), value: color }); }
      else if (node) { node.backgroundColor = color; }
    },
    setFontSize: (node, px) => {
      if (rec) { rec.record({ kind: 'setFontSize', target: idOf(node), value: px }); }
      else if (node) { node.fontSize = px; }
    },
    setName: (node, name) => {
      if (rec) { rec.record({ kind: 'setName', target: idOf(node), value: name }); }
      else if (node) { node.name = name; }
    },
    setClass: (node, className) => {
      if (rec) { rec.record({ kind: 'setClass', target: idOf(node), value: className }); }
      else if (node) { node.className = className; }
    },
    hide: (node) => {
      if (rec) { rec.record({ kind: 'visible', target: idOf(node), value: false }); }
      else if (node) { node.visible = false; }
    },
    show: (node) => {
      if (rec) { rec.record({ kind: 'visible', target: idOf(node), value: true }); }
      else if (node) { node.visible = true; }
    },
    createElement: (spec = {}) => {
      if (rec) {
        const ref = spec.id || rec.nextRef();
        rec.record({
          kind: 'create', ref, elType: spec.type || 'ViewComponent', className: spec.className || '',
          name: spec.name || 'element', control: spec.control || '',
          parent: spec.parent != null ? idOf(spec.parent) : null, props: spec.props,
        });
        // Return a stub so the handler can chain (e.g. use it as a parent).
        return {
          id: ref, name: spec.name || 'element', type: spec.type || 'ViewComponent', className: spec.className || '',
          visible: spec.visible !== false, fontSize: DEFAULT_FONT_SIZE, backgroundColor: '',
          control: spec.control || '', styles: {}, childStyles: {}, created: true,
        };
      }
      const node: RuntimeNode = {
        id: spec.id || genId('rt'),
        name: spec.name || 'element',
        type: spec.type || 'ViewComponent',
        className: spec.className || '',
        visible: spec.visible !== false,
        fontSize: DEFAULT_FONT_SIZE,
        backgroundColor: '',
        control: spec.control || '',
        styles: {},
        childStyles: {},
        created: true,
      };
      host.nodes.push(node);
      const parent = spec.parent != null ? resolve(spec.parent) : undefined;
      if (parent) {
        host.edges.push({ id: genId('ce'), source: parent.id, target: node.id, relation: 'contains' });
      }
      applyBaseStyle(node);
      if (spec.props) {
        applyStyleProps(node, spec.props);
      }
      return node;
    },
    deleteElement: (ref) => {
      if (rec) { rec.record({ kind: 'delete', target: idOf(ref) }); return; }
      const node = resolve(ref);
      if (!node) {
        return;
      }
      const remove = new Set<string>([node.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const e of host.edges) {
          if (e.relation === 'contains' && remove.has(e.source) && !remove.has(e.target)) {
            remove.add(e.target);
            grew = true;
          }
        }
      }
      for (let i = host.nodes.length - 1; i >= 0; i--) {
        if (remove.has(host.nodes[i].id)) { host.nodes.splice(i, 1); }
      }
      for (let i = host.edges.length - 1; i >= 0; i--) {
        const e = host.edges[i];
        if (remove.has(e.source) || remove.has(e.target)) { host.edges.splice(i, 1); }
      }
    },
    connect: (source, target, relation = 'navigatesTo') => {
      if (rec) { rec.record({ kind: 'connect', source: idOf(source), target: idOf(target), relation }); return; }
      const s = resolve(source);
      const t = resolve(target);
      if (s && t) {
        host.edges.push({ id: genId('xe'), source: s.id, target: t.id, relation });
      }
    },
    disconnect: (source, target, relation) => {
      if (rec) { rec.record({ kind: 'disconnect', source: idOf(source), target: idOf(target), relation }); return; }
      const s = resolve(source);
      const t = resolve(target);
      if (!s || !t) {
        return;
      }
      for (let i = host.edges.length - 1; i >= 0; i--) {
        const e = host.edges[i];
        if (e.source === s.id && e.target === t.id && (!relation || e.relation === relation)) {
          host.edges.splice(i, 1);
        }
      }
    },
    createStyleRule: (rule) => {
      if (rec) { rec.record({ kind: 'styleRule', rule }); return; }
      if (!rule || !rule.selector) {
        return;
      }
      const kind = rule.selectorKind || 'class';
      const matches = host.nodes.filter((n) => (kind === 'id' ? n.name === rule.selector : n.className === rule.selector));
      for (const n of matches) {
        if (rule.props) { applyStyleProps(n, rule.props); }
        if (rule.control) { n.control = rule.control; }
      }
    },
    setContext: (key, value) => { if (opts.setContext) { opts.setContext(key, value); } },
    navigate: (target) => { if (opts.navigate) { opts.navigate(target); } },
    blockNavigation: () => { if (opts.blockNavigation) { opts.blockNavigation(); } },
    self: opts.self,
  };
}

/**
 * Replays a recorded runtime overlay (event-refinement mutations) onto a host,
 * resolving element references by id. Lets event-driven graph changes persist
 * across recomputes until the runtime is reset or the page reloads.
 */
export function applyOverlay(host: HostGraph, commands: OverlayCommand[], styles: StyleRuleData[] = []): void {
  if (!commands || !commands.length) {
    return;
  }
  const api = buildCodeApi(host, [], { styles });
  const find = (ref: string): RuntimeNode | undefined => host.nodes.find((n) => n.id === ref);
  for (const cmd of commands) {
    try {
      switch (cmd.kind) {
        case 'create': {
          const parent = cmd.parent ? find(cmd.parent) : undefined;
          api.createElement({ id: cmd.ref, type: cmd.elType, className: cmd.className, name: cmd.name, control: cmd.control, parent, props: cmd.props });
          break;
        }
        case 'delete': { const n = find(cmd.target); if (n) { api.deleteElement(n); } break; }
        case 'setBackground': { const n = find(cmd.target); if (n) { api.setBackground(n, cmd.value); } break; }
        case 'setFontSize': { const n = find(cmd.target); if (n) { api.setFontSize(n, cmd.value); } break; }
        case 'setStyle': { const n = find(cmd.target); if (n) { api.setStyle(n, cmd.prop, cmd.value); } break; }
        case 'setName': { const n = find(cmd.target); if (n) { api.setName(n, cmd.value); } break; }
        case 'setClass': { const n = find(cmd.target); if (n) { api.setClass(n, cmd.value); } break; }
        case 'visible': { const n = find(cmd.target); if (n) { if (cmd.value) { api.show(n); } else { api.hide(n); } } break; }
        case 'connect': api.connect(cmd.source, cmd.target, cmd.relation); break;
        case 'disconnect': api.disconnect(cmd.source, cmd.target, cmd.relation); break;
        case 'styleRule': api.createStyleRule(cmd.rule); break;
      }
    } catch {
      // A bad overlay command must not break rendering.
    }
  }
}

// ---------------------------------------------------------------------------
// Full run
// ---------------------------------------------------------------------------

function clone(host: HostGraph): HostGraph {
  return { nodes: host.nodes.map((n) => ({ ...n })), edges: host.edges.map((e) => ({ ...e })) };
}

/** A stable signature of the host's relevant state, used to detect a fixpoint. */
function hostSignature(host: HostGraph): string {
  const nodes = host.nodes.map((n) =>
    [n.id, n.name, n.type, n.className, n.visible, n.fontSize, n.backgroundColor, n.control,
      JSON.stringify(n.styles), JSON.stringify(n.childStyles)].join('|'));
  const edges = host.edges.map((e) => `${e.source}>${e.relation}>${e.target}`);
  return `${nodes.join(';')}#${edges.join(';')}`;
}

/** Maximum adaptation passes before giving up (guards against non-terminating rules). */
const MAX_ADAPTATION_PASSES = 50;

/**
 * Applies the firing rules' operations to a copy of the base host graph, **repeatedly
 * until no operation changes the graph any more** (a fixpoint) — so operations that
 * enable one another all take effect regardless of rule order. Each operation is a
 * modelled (graph-transformation) operation or a code operation; both are transient
 * (re-derived every recompute) and referenced by name.
 */
/**
 * Resolves a parameterized operation's argument values into a concrete operation.
 * RHS assignments of the form `$name` are replaced by `args[name]`; an absent or
 * empty argument drops the assignment (the attribute is left unset). The clone's
 * id encodes the args so distinct invocations are applied independently.
 */
function substituteParams(op: OperationModel, args?: Record<string, string>): OperationModel {
  if (!op.params || op.params.length === 0) {
    return op;
  }
  const a = args || {};
  const nodes = op.nodes.map((n) => {
    const setProps: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.data.setProps || {})) {
      const m = /^\$(.+)$/.exec(v);
      if (!m) {
        setProps[k] = v; // literal value
      } else {
        const val = a[m[1]];
        if (val !== undefined && val !== '') {
          setProps[k] = val; // bound parameter value (else: unset → dropped)
        }
      }
    }
    return { ...n, data: { ...n.data, setProps } };
  });
  return { ...op, id: `${op.id}#${JSON.stringify(a)}`, nodes };
}

export function runAdaptation(
  base: HostGraph, rules: AdaptmlRule[], ops: OperationModel[], ctxProps: ContextProperty[],
  codeOps: CodeOperation[] = [], styles: StyleRuleData[] = [],
): HostGraph {
  const host = clone(base);
  const ctx = new Map(ctxProps.map((p) => [p.key, p]));
  const opByName = new Map(ops.map((o) => [o.name, o]));
  const codeByName = new Map(codeOps.map((o) => [o.name, o]));
  // Each concrete (operation, match) is applied at most once per recompute — so the
  // fixpoint re-applies rules to *newly created* matches without re-creating elements.
  const applied = new Set<string>();
  const sig = (opId: string, m: Map<string, string>) =>
    `${opId}#${[...m.entries()].map(([k, v]) => `${k}=${v}`).sort().join(',')}`;

  for (let pass = 0; pass < MAX_ADAPTATION_PASSES; pass++) {
    const before = hostSignature(host);
    for (const rule of rules) {
      if (!ruleFires(rule, ctx)) {
        continue;
      }
      const baseOp = opByName.get(rule.operationName);
      if (!baseOp) {
        // Not a modelled operation — try a code operation of the same name. Code
        // operations may freely create / change / delete the runtime graph.
        const codeOp = codeByName.get(rule.operationName);
        if (codeOp) {
          try {
            codeOp.run(buildCodeApi(host, ctxProps, { styles }));
          } catch {
            // A faulty code operation must not break the rest of the adaptation.
          }
        }
        continue;
      }
      // Resolve parameter bindings ($name) using the rule's supplied arguments.
      const op = substituteParams(baseOp, rule.args);
      const matches = findMatches(op, host);
      const deleted = new Set<string>();
      for (const m of matches) {
        const key = sig(op.id, m);
        if (applied.has(key)) {
          continue;
        }
        let stale = false;
        for (const hid of m.values()) {
          if (deleted.has(hid)) { stale = true; break; }
        }
        if (stale) {
          continue;
        }
        applied.add(key);
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
    // Stop once a full pass leaves the graph unchanged (no rule was applicable).
    if (hostSignature(host) === before) {
      break;
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
