/**
 * Model types for the Style DSL (a concretization language for IFML) and for
 * Operations (graph transformations over IFML and Style, expressed as
 * left-hand-side / right-hand-side rewrite rules).
 */

// ---------------------------------------------------------------------------
// Style DSL
// ---------------------------------------------------------------------------

export type StyleSelectorKind = 'id' | 'class';

/**
 * The concrete UI control an element is concretized to. Mainly used to render
 * IFML events as buttons / checkboxes / input fields etc. '' = default rendering.
 */
export type ControlType = '' | 'button' | 'checkbox' | 'inputField' | 'link' | 'label';

export const CONTROL_TYPES: ControlType[] = ['', 'button', 'checkbox', 'inputField', 'link', 'label'];

/** How a style property is edited in the panel. */
export type StyleInputKind = 'color' | 'number' | 'text' | 'select';

export interface StyleOption {
  label: string;
  value: string;
}

/**
 * Describes one concrete style property the Style DSL can assign. The catalog
 * below is the single source of truth that drives the editor panel, the XML
 * export and how the Preview applies the property as CSS.
 */
export interface StylePropDef {
  /** Stable key — used in `StyleRuleData.props` and as the export property name. */
  key: string;
  /** Human label shown in the editor panel. */
  label: string;
  /** CSS property the value maps to when rendered in the Preview. */
  css: string;
  /** Which editor control edits the value. */
  input: StyleInputKind;
  /** Panel section the property is grouped under. */
  group: string;
  /**
   * Where the property applies in the Preview: `self` (default) styles the
   * element's own box; `children` styles the element's children container, so
   * flex/grid layout properties arrange the contained elements.
   */
  target?: 'self' | 'children';
  /** Unit appended to numeric values when applied as CSS (e.g. `px`). */
  unit?: string;
  /** Options for `select` inputs. */
  options?: StyleOption[];
  /** Placeholder/hint for `text` / `number` inputs. */
  placeholder?: string;
}

const GRADIENTS: StyleOption[] = [
  { label: 'Indigo', value: 'linear-gradient(135deg, #6366f1, #8b5cf6)' },
  { label: 'Sky', value: 'linear-gradient(135deg, #0ea5e9, #22d3ee)' },
  { label: 'Sunset', value: 'linear-gradient(135deg, #f59e0b, #ef4444)' },
  { label: 'Mint', value: 'linear-gradient(135deg, #10b981, #34d399)' },
  { label: 'Grape', value: 'linear-gradient(135deg, #a855f7, #ec4899)' },
  { label: 'Slate', value: 'linear-gradient(135deg, #334155, #0f172a)' },
];

const SHADOWS: StyleOption[] = [
  { label: 'None', value: 'none' },
  { label: 'Subtle', value: '0 1px 2px rgba(15, 23, 42, .08)' },
  { label: 'Soft', value: '0 4px 12px rgba(15, 23, 42, .12)' },
  { label: 'Medium', value: '0 8px 24px rgba(15, 23, 42, .16)' },
  { label: 'Large', value: '0 16px 40px rgba(15, 23, 42, .22)' },
];

/** The full catalog of assignable style properties, grouped for the panel. */
export const STYLE_PROPERTIES: StylePropDef[] = [
  // Typography
  { key: 'color', label: 'Text colour', css: 'color', input: 'color', group: 'Typography' },
  { key: 'fontSize', label: 'Font size', css: 'font-size', input: 'number', unit: 'px', placeholder: '14', group: 'Typography' },
  {
    key: 'fontWeight', label: 'Font weight', css: 'font-weight', input: 'select', group: 'Typography',
    options: [{ label: 'Light', value: '300' }, { label: 'Normal', value: '400' }, { label: 'Medium', value: '500' }, { label: 'Semibold', value: '600' }, { label: 'Bold', value: '700' }, { label: 'Black', value: '800' }],
  },
  {
    key: 'fontFamily', label: 'Font family', css: 'font-family', input: 'select', group: 'Typography',
    options: [{ label: 'System', value: 'system-ui, "Segoe UI", Roboto, sans-serif' }, { label: 'Serif', value: 'Georgia, "Times New Roman", serif' }, { label: 'Monospace', value: 'ui-monospace, "SF Mono", Menlo, monospace' }, { label: 'Rounded', value: '"Comic Sans MS", "Segoe UI", sans-serif' }],
  },
  {
    key: 'fontStyle', label: 'Font style', css: 'font-style', input: 'select', group: 'Typography',
    options: [{ label: 'Normal', value: 'normal' }, { label: 'Italic', value: 'italic' }],
  },
  {
    key: 'textAlign', label: 'Text align', css: 'text-align', input: 'select', group: 'Typography',
    options: [{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' }, { label: 'Justify', value: 'justify' }],
  },
  {
    key: 'textTransform', label: 'Text case', css: 'text-transform', input: 'select', group: 'Typography',
    options: [{ label: 'None', value: 'none' }, { label: 'UPPERCASE', value: 'uppercase' }, { label: 'Capitalize', value: 'capitalize' }, { label: 'lowercase', value: 'lowercase' }],
  },
  { key: 'letterSpacing', label: 'Letter spacing', css: 'letter-spacing', input: 'number', unit: 'px', placeholder: '0', group: 'Typography' },
  { key: 'lineHeight', label: 'Line height', css: 'line-height', input: 'text', placeholder: '1.5', group: 'Typography' },

  // Background & colour
  { key: 'backgroundColor', label: 'Background', css: 'background-color', input: 'color', group: 'Background' },
  { key: 'backgroundImage', label: 'Gradient', css: 'background-image', input: 'select', options: GRADIENTS, group: 'Background' },
  { key: 'opacity', label: 'Opacity', css: 'opacity', input: 'number', placeholder: '1', group: 'Background' },

  // Border
  {
    key: 'borderStyle', label: 'Border style', css: 'border-style', input: 'select', group: 'Border',
    options: [{ label: 'None', value: 'none' }, { label: 'Solid', value: 'solid' }, { label: 'Dashed', value: 'dashed' }, { label: 'Dotted', value: 'dotted' }],
  },
  { key: 'borderWidth', label: 'Border width', css: 'border-width', input: 'number', unit: 'px', placeholder: '1', group: 'Border' },
  { key: 'borderColor', label: 'Border colour', css: 'border-color', input: 'color', group: 'Border' },
  { key: 'borderRadius', label: 'Corner radius', css: 'border-radius', input: 'number', unit: 'px', placeholder: '8', group: 'Border' },

  // Spacing & size
  { key: 'padding', label: 'Padding', css: 'padding', input: 'number', unit: 'px', placeholder: '12', group: 'Spacing & size' },
  { key: 'margin', label: 'Margin', css: 'margin', input: 'number', unit: 'px', placeholder: '0', group: 'Spacing & size' },
  { key: 'width', label: 'Width', css: 'width', input: 'text', placeholder: 'e.g. 200px or 100%', group: 'Spacing & size' },
  { key: 'minHeight', label: 'Min height', css: 'min-height', input: 'number', unit: 'px', placeholder: '0', group: 'Spacing & size' },

  // Effects
  { key: 'boxShadow', label: 'Shadow', css: 'box-shadow', input: 'select', options: SHADOWS, group: 'Effects' },

  // Layout — how this element arranges its children (flex / grid)
  {
    key: 'display', label: 'Layout', css: 'display', input: 'select', group: 'Layout (children)', target: 'children',
    options: [{ label: 'Flex', value: 'flex' }, { label: 'Grid', value: 'grid' }, { label: 'Inline flex', value: 'inline-flex' }, { label: 'Block', value: 'block' }],
  },
  {
    key: 'flexDirection', label: 'Direction (flex)', css: 'flex-direction', input: 'select', group: 'Layout (children)', target: 'children',
    options: [{ label: 'Row', value: 'row' }, { label: 'Column', value: 'column' }],
  },
  {
    key: 'flexWrap', label: 'Wrap (flex)', css: 'flex-wrap', input: 'select', group: 'Layout (children)', target: 'children',
    options: [{ label: 'Wrap', value: 'wrap' }, { label: 'No wrap', value: 'nowrap' }],
  },
  { key: 'gridColumns', label: 'Columns (grid)', css: 'grid-template-columns', input: 'text', placeholder: 'e.g. 1fr 1fr or repeat(3, 1fr)', group: 'Layout (children)', target: 'children' },
  {
    key: 'justifyContent', label: 'Justify', css: 'justify-content', input: 'select', group: 'Layout (children)', target: 'children',
    options: [{ label: 'Start', value: 'flex-start' }, { label: 'Center', value: 'center' }, { label: 'Space between', value: 'space-between' }, { label: 'Space around', value: 'space-around' }, { label: 'End', value: 'flex-end' }],
  },
  {
    key: 'alignItems', label: 'Align', css: 'align-items', input: 'select', group: 'Layout (children)', target: 'children',
    options: [{ label: 'Stretch', value: 'stretch' }, { label: 'Start', value: 'flex-start' }, { label: 'Center', value: 'center' }, { label: 'End', value: 'flex-end' }],
  },
  { key: 'gap', label: 'Gap', css: 'gap', input: 'number', unit: 'px', placeholder: '12', group: 'Layout (children)', target: 'children' },
];

/** A single style rule: a selector and the concrete properties it assigns. */
export interface StyleRuleData {
  /** Whether the rule targets one element (`id`) or every element of a class. */
  selectorKind: StyleSelectorKind;
  /** Element name (id) or adaptation-class name. */
  selector: string;
  /** Concrete control to render the element as (e.g. an event → button). '' = unset. */
  control: ControlType;
  /** Concrete style properties, keyed by `StylePropDef.key`. Empty value = unset. */
  props: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Operations: graph transformation rules (LHS -> RHS)
// ---------------------------------------------------------------------------

/**
 * The role of a pattern node/edge inside a rule, in the unified single-graph
 * notation: `preserve` exists in both LHS and RHS, `delete` only in the LHS
 * (removed by the rule), `create` only in the RHS (added by the rule), and
 * `forbid` is a **negative application condition** — the rule applies only if this
 * pattern is *absent* from the host.
 */
export type PatternRole = 'preserve' | 'create' | 'delete' | 'forbid';

/**
 * Default lifecycle events every ViewContainer has. The Preview fires them when the
 * container is shown (`onLoad`), re-adapts while shown (`onChange`) and is left
 * (`onTerminate`); they are refinable with code in the Code tab, keyed by name.
 */
export const LIFECYCLE_EVENTS = ['onLoad', 'onChange', 'onTerminate'];

/** The event-refinement key for a container's lifecycle event (e.g. `News Feed · onLoad`). */
export function lifecycleEventName(container: string, kind: string): string {
  return `${container} · ${kind}`;
}

export type PatternNodeKind = 'element' | 'style' | 'params';
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
  /**
   * Multi-attribute LHS match conditions, keyed by `StylePropDef.key` (plus
   * `visible`). **All** must hold for a host element to match (strict AND), on top
   * of the type/selector. On a create node, having any condition turns it into a
   * match-and-overwrite node (the conditions are the "preserved" attributes).
   */
  condProps: Record<string, string>;
  /** RHS assignment for element visibility ('' = leave unchanged). */
  setVisible: '' | 'true' | 'false';
  /**
   * RHS style-property assignments applied to the matched element, keyed by
   * `StylePropDef.key` (same catalog as the Style DSL). Empty value = unchanged.
   * Lets operations change any element property, e.g. dark-mode colours. A value
   * of the form `$name` binds the assignment to the transformation parameter
   * `name`, whose value is supplied where the operation is invoked.
   */
  setProps: Record<string, string>;
  /**
   * Declared parameter names — only meaningful for a `params` (transformation
   * parameters) box. The operation's signature is the union of these.
   */
  params?: string[];
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
  /** Parameter names declared by the operation's `params` boxes (its signature). */
  params?: string[];
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
  /** Concrete control resolved from the Style model ('' = default rendering). */
  control: string;
  /** Resolved CSS the Preview applies to the element's own box, beyond bg/fontSize. */
  styles: Record<string, string>;
  /** Resolved CSS applied to the element's children container (flex/grid layout). */
  childStyles: Record<string, string>;
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
