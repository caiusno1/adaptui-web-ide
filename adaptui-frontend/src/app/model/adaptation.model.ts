/**
 * Shared data model for the AdaptUI adaptation system.
 *
 * The adaptation tab (ADAPTML) links *conditions* — expressed over the context
 * properties activated in CONTEXTML — to *operations* that change properties of
 * IFML elements. Each IFML element links to an {@link AdaptationClass} that
 * declares which properties may be changed; operations target an element by id
 * or every element of a class (or globally).
 */

export type PropertyType = 'boolean' | 'number';

/** A property of an IFML element that an adaptation operation may change. */
export interface ChangeableProperty {
  /** Machine name, e.g. `visible`, `fontSize`. */
  name: string;
  /** Human-readable label. */
  label: string;
  type: PropertyType;
}

/**
 * A named class that an IFML element links to. It declares the set of
 * changeable properties available on elements of that class and doubles as a
 * selector (operations can target every element of a class).
 */
export interface AdaptationClass {
  name: string;
  label: string;
  properties: ChangeableProperty[];
}

export const VISIBLE_PROPERTY: ChangeableProperty = { name: 'visible', label: 'Visibility', type: 'boolean' };
export const FONT_SIZE_PROPERTY: ChangeableProperty = { name: 'fontSize', label: 'Font size', type: 'number' };

/**
 * The starter set of changeable properties. Extend this (and the classes below,
 * or add new classes via {@link AdaptationClassService}) to support more
 * adaptable properties later — the rest of the system is property-agnostic.
 */
export const DEFAULT_PROPERTIES: ChangeableProperty[] = [VISIBLE_PROPERTY, FONT_SIZE_PROPERTY];

/** Built-in adaptation classes. Every IFML element links to one of these. */
export const DEFAULT_ADAPTATION_CLASSES: AdaptationClass[] = [
  { name: 'Container', label: 'Container', properties: DEFAULT_PROPERTIES },
  { name: 'View', label: 'View', properties: DEFAULT_PROPERTIES },
  { name: 'Label', label: 'Label', properties: DEFAULT_PROPERTIES },
  { name: 'Event', label: 'Event', properties: DEFAULT_PROPERTIES },
  { name: 'Generic', label: 'Generic', properties: DEFAULT_PROPERTIES },
];

export type ContextPropertyType = 'number' | 'enum';

/** A context property that can be activated in CONTEXTML and used in conditions. */
export interface ContextProperty {
  key: string;
  label: string;
  type: ContextPropertyType;
  /** Allowed values for an `enum` property. */
  values?: string[];
  /** Whether the user has activated (enabled) this property in CONTEXTML. */
  activated: boolean;
  /** Current runtime value (edited in the Preview side menu). */
  value: string;
}

export const DEFAULT_CONTEXT_PROPERTIES: ContextProperty[] = [
  { key: 'time', label: 'Time (hour 0–23)', type: 'number', activated: true, value: '14' },
  { key: 'age', label: 'Age', type: 'number', activated: false, value: '30' },
  { key: 'environment', label: 'Environment', type: 'enum', values: ['home', 'work', 'outdoor', 'transit'], activated: false, value: 'home' },
  { key: 'deviceType', label: 'Device Type', type: 'enum', values: ['phone', 'tablet', 'desktop'], activated: false, value: 'phone' },
  { key: 'gender', label: 'Gender', type: 'enum', values: ['female', 'male', 'diverse'], activated: false, value: 'female' },
];

/** A live reference to an IFML element, published by the IFML editor. */
export interface IfmlElementRef {
  /** Internal mxGraph cell id (stable while the cell exists). */
  cellId: string;
  /** Display name, also used as the element's id for `#id` targeting. */
  name: string;
  /** ViewContainer | ViewComponent | Event */
  type: string;
  /** Name of the adaptation class this element links to. */
  className: string;
  /** Cell id of the containing IFML element (undefined if top-level). */
  parentCellId?: string;
}

export const NUMBER_OPERATORS = ['<', '<=', '>', '>=', '==', '!='];
export const ENUM_OPERATORS = ['==', '!='];

/** XML-friendly names for comparison operators (used on export). */
export const OPERATOR_XML: { [op: string]: string } = {
  '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', '==': 'eq', '!=': 'ne',
};

export type TargetKind = 'global' | 'class' | 'id';

/** A condition over a single context property, e.g. `age > 50`. */
export interface ConditionConfig {
  propertyKey: string;
  operator: string;
  value: string;
}

/** An operation reference: the name of an operation defined in the Operations tab. */
export interface OperationConfig {
  operationName: string;
}

export type AdaptNodeKind = 'condition' | 'operation' | 'gate';
export type GateOp = 'and' | 'or';

export interface GateConfig {
  op: GateOp;
}

/** Per-node configuration stored alongside an ADAPTML graph cell. */
export interface AdaptNodeData {
  kind: AdaptNodeKind;
  condition?: ConditionConfig;
  operation?: OperationConfig;
  gate?: GateConfig;
}

/**
 * A boolean expression over conditions, combined by AND/OR gates. Built from the
 * ADAPTML graph and evaluated by the Preview to decide whether an operation fires.
 */
export type BoolExpr =
  | { type: 'condition'; condition: ConditionConfig }
  | { type: 'gate'; op: GateOp; children: BoolExpr[] };

/**
 * An adaptation rule published for the Preview: the boolean condition expression
 * guarding the operation. `expr` is null when the operation has no conditions, in
 * which case it never fires.
 */
export interface AdaptmlRule {
  expr: BoolExpr | null;
  operationName: string;
}
