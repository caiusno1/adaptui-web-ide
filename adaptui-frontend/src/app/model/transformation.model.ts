/**
 * Model types for the Style DSL (a concretization language for IFML) and for
 * Operations (graph transformations over IFML and Style, expressed as
 * left-hand-side / right-hand-side rewrite rules).
 */

// ---------------------------------------------------------------------------
// Style DSL
// ---------------------------------------------------------------------------

export type StyleSelectorKind = 'id' | 'class';

/** A single style rule: a selector and the concrete properties it assigns. */
export interface StyleRuleData {
  /** Whether the rule targets one element (`id`) or every element of a class. */
  selectorKind: StyleSelectorKind;
  /** Element name (id) or adaptation-class name. */
  selector: string;
  /** Currently the only supported concrete property. Empty = unset. */
  backgroundColor: string;
}

// ---------------------------------------------------------------------------
// Operations: graph transformation rules (LHS -> RHS)
// ---------------------------------------------------------------------------

/**
 * The role of a pattern node/edge inside a rule, in the unified single-graph
 * notation: `preserve` exists in both LHS and RHS, `delete` only in the LHS
 * (removed by the rule), `create` only in the RHS (added by the rule).
 */
export type PatternRole = 'preserve' | 'create' | 'delete';

export type PatternNodeKind = 'element' | 'style';
export type ElementMatch = 'any' | 'ViewContainer' | 'ViewComponent' | 'Event';
export type PatternSelectorKind = 'none' | 'class' | 'id';

/** A pattern node — a matched/created/deleted IFML element or Style entry. */
export interface PatternNodeData {
  kind: PatternNodeKind;
  role: PatternRole;
  /** For element nodes: the IFML metaclass to match. */
  match: ElementMatch;
  selectorKind: PatternSelectorKind;
  selector: string;
  /** RHS assignment for element visibility ('' = leave unchanged). */
  setVisible: '' | 'true' | 'false';
  /** RHS assignment for element font size ('' = leave unchanged). */
  setFontSize: string;
  /** RHS assignment for style background colour ('' = leave unchanged). */
  setBackgroundColor: string;
}

/** A pattern edge between two pattern nodes. */
export interface PatternEdgeData {
  role: PatternRole;
  /** Relation kind, e.g. contains | navigatesTo | styles. */
  relation: string;
}

export interface OpNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  data: PatternNodeData;
}

export interface OpEdge {
  id: string;
  source: string;
  target: string;
  data: PatternEdgeData;
}

/** A named operation: one graph-transformation rule. */
export interface OperationModel {
  id: string;
  name: string;
  nodes: OpNode[];
  edges: OpEdge[];
}

export const RELATION_KINDS = ['contains', 'navigatesTo', 'styles'];

// ---------------------------------------------------------------------------
// Runtime model (the host graph rewritten by the Preview's adaptation engine)
// ---------------------------------------------------------------------------

/** A navigation flow published by the IFML editor (source may be an event). */
export interface IfmlFlow {
  sourceCellId: string;
  targetCellId: string;
}

/** A node in the runtime host graph that the Preview renders and rewrites. */
export interface RuntimeNode {
  id: string;
  /** Originating IFML cell id (undefined for nodes created by an operation). */
  sourceId?: string;
  name: string;
  /** ViewContainer | ViewComponent | Event */
  type: string;
  className: string;
  visible: boolean;
  fontSize: number;
  /** '' = no explicit background. */
  backgroundColor: string;
  created?: boolean;
}

export interface RuntimeEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
}

export interface HostGraph {
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
}
