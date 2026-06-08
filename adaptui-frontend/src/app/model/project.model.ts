import { ContextProperty, AdaptationClass } from './adaptation.model';

/**
 * A serialized AdaptUI project: the full content of every tab plus the visual
 * structure (node positions/sizes/styles) of the graphical editors. Stored in
 * localStorage so projects can be saved, listed and reopened.
 */
export interface AdaptuiProject {
  name: string;
  /** Schema version, for future migrations. */
  version: number;
  /** Epoch millis of the last save. */
  savedAt: number;
  /** Per-editor serialized state, keyed by editor id (ifml, style, operations, adaptml). */
  editors: Record<string, unknown>;
  /** CONTEXTML state. */
  context: ContextProperty[];
  /** CODE tab state. */
  code: { functionsSource: string; eventCode: Record<string, string> };
  /** Registered adaptation classes. */
  classes: AdaptationClass[];
}

/**
 * Implemented by each graphical editor so the ProjectService can capture, restore
 * and reset its content (including the visual layout of its canvas).
 */
export interface EditorAdapter {
  /** Returns a JSON-serializable snapshot of the editor (cells, geometry, metadata). */
  capture(): unknown;
  /** Rebuilds the editor from a snapshot produced by {@link capture}. */
  restore(state: unknown): void;
  /** Clears the editor to an empty state (for a new project). */
  reset(): void;
}

// --- Per-editor snapshot shapes (graph cells + metadata) ---

export interface GraphVertex {
  /** Reference id used only within the snapshot to wire edges/parents. */
  id: string;
  /** Parent vertex reference id (for nested IFML containers); null = top level. */
  parent?: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** mxGraph style name (e.g. 'viewContainerStyle'). */
  style: string;
  /** Cell label/value. */
  value: string;
  /** Per-cell metadata (adaptation class for IFML; rule/node data for Style/ADAPTML). */
  data?: unknown;
}

export interface GraphEdge {
  source: string;
  target: string;
  style: string;
  value: string;
}

export interface GraphSnapshot {
  vertices: GraphVertex[];
  edges: GraphEdge[];
}
