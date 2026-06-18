/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Graph backend — **maxGraph** (`@maxgraph/core`) implementation. This is the
 * DEFAULT backend.
 *
 * The editors (IFML / Style / Operations / ADAPTML) were written against the
 * legacy global **mxGraph** API. This module is the separation layer: it
 * re-exports the same `mx*` symbol surface those editors expect, mapped onto
 * maxGraph's modern TypeScript classes, and smooths over the breaking
 * differences between the two libraries:
 *
 *  - `graph.getModel()` → maxGraph's `getDataModel()`
 *  - model helpers that moved onto `Cell` (`isVertex`, `getParent`, `getTerminal`, …)
 *  - string style *names* (`'viewContainerStyle'`) → maxGraph `{ baseStyleNames }`
 *  - `mxConstants.STYLE_*` → maxGraph `CellStyle` property keys
 *  - custom shape registration via `ShapeRegistry` instead of `mxCellRenderer`
 *
 * The alternative backend (`graph-backend.mxgraph.ts`) exposes the identical
 * surface from the global script and is swapped in at build time by the
 * `mxgraph` configuration (see angular.json → fileReplacements).
 */
import {
  Graph as MaxGraph,
  GraphDataModel,
  Cell,
  Geometry,
  Point,
  RubberBandHandler,
  KeyHandler,
  InternalEvent,
  Client,
  CylinderShape,
  ImageBox,
  ShapeRegistry,
  gestureUtils,
} from '@maxgraph/core';

/** Identifies the compiled-in graph backend (useful for diagnostics). */
export const GRAPH_BACKEND = 'maxgraph';

/** maxGraph is bundled with the app, so it is always available. */
export function graphBackendAvailable(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Style constants — map the legacy `mxConstants.*` names to maxGraph CellStyle
// property keys (for STYLE_*) and to maxGraph's string values (for SHAPE_* /
// ALIGN_* / ARROW_* / FONT_*). Building a style object keyed by these therefore
// yields a valid maxGraph `CellStyle`.
// ---------------------------------------------------------------------------
export const mxConstants: any = {
  STYLE_SHAPE: 'shape',
  STYLE_STROKECOLOR: 'strokeColor',
  STYLE_FILLCOLOR: 'fillColor',
  STYLE_FONTCOLOR: 'fontColor',
  STYLE_FONTSIZE: 'fontSize',
  STYLE_FONTSTYLE: 'fontStyle',
  STYLE_ALIGN: 'align',
  STYLE_VERTICAL_ALIGN: 'verticalAlign',
  STYLE_VERTICAL_LABEL_POSITION: 'verticalLabelPosition',
  STYLE_SPACING_TOP: 'spacingTop',
  STYLE_SPACING_LEFT: 'spacingLeft',
  STYLE_STROKEWIDTH: 'strokeWidth',
  STYLE_ROUNDED: 'rounded',
  STYLE_PERIMETER: 'perimeter',
  STYLE_WHITE_SPACE: 'whiteSpace',
  STYLE_EDGE: 'edgeStyle',
  STYLE_ENDARROW: 'endArrow',
  STYLE_LABEL_BACKGROUNDCOLOR: 'labelBackgroundColor',

  SHAPE_RECTANGLE: 'rectangle',
  SHAPE_ELLIPSE: 'ellipse',
  SHAPE_RHOMBUS: 'rhombus',
  SHAPE_HEXAGON: 'hexagon',

  ALIGN_LEFT: 'left',
  ALIGN_CENTER: 'center',
  ALIGN_RIGHT: 'right',
  ALIGN_TOP: 'top',
  ALIGN_MIDDLE: 'middle',
  ALIGN_BOTTOM: 'bottom',

  ARROW_CLASSIC: 'classic',

  FONT_BOLD: 1,
  FONT_ITALIC: 2,
  FONT_UNDERLINE: 4,
};

/** Perimeter style values (referenced by registered name in maxGraph). */
export const mxPerimeter: any = {
  EllipsePerimeter: 'ellipsePerimeter',
  RectanglePerimeter: 'rectanglePerimeter',
  RhombusPerimeter: 'rhombusPerimeter',
  HexagonPerimeter: 'hexagonPerimeter',
};

/** Edge style values (referenced by registered name in maxGraph). */
export const mxEdgeStyle: any = {
  OrthConnector: 'orthogonalEdgeStyle',
  ElbowConnector: 'elbowEdgeStyle',
  EntityRelation: 'entityRelationEdgeStyle',
  SegmentConnector: 'segmentEdgeStyle',
};

export const mxEvent: any = InternalEvent;
export const mxPoint: any = Point;
export const mxGeometry: any = Geometry;
export const mxCell: any = Cell;
export const mxImage: any = ImageBox;
export const mxRubberband: any = RubberBandHandler;
export const mxKeyHandler: any = KeyHandler;
export const mxCylinder: any = CylinderShape;

/** mxClient surface — only `isBrowserSupported` is used by the editors. */
export const mxClient: any = {
  isBrowserSupported(): boolean {
    const c: any = Client as any;
    return typeof c?.isBrowserSupported === 'function' ? c.isBrowserSupported() : true;
  },
};

/** mxUtils surface — prototype `extend`, `makeDraggable`, `error`. */
export const mxUtils: any = {
  extend(child: any, parent: any): void {
    const tmp = function (this: any) {};
    tmp.prototype = parent.prototype;
    child.prototype = new (tmp as any)();
    child.prototype.constructor = child;
  },
  makeDraggable(element: any, graph: any, funct: any, ...rest: any[]): any {
    return (gestureUtils as any).makeDraggable(element, graph, funct, ...rest);
  },
  error(message: string): void {
    // eslint-disable-next-line no-console
    console.error(message);
  },
};

/** mxCellRenderer surface — shape lookup/registration (now via ShapeRegistry). */
export const mxCellRenderer: any = {
  registerShape(name: string, ctor: any): void {
    try {
      (ShapeRegistry as any).add(name, ctor);
    } catch {
      /* ignore: shape stays unregistered, maxGraph falls back to a rectangle */
    }
  },
  getShape(name: string): any {
    try {
      return (ShapeRegistry as any).get(name);
    } catch {
      return undefined;
    }
  },
  // Editors probe `mxCellRenderer.defaultShapes['box']` to avoid re-registering.
  defaultShapes: new Proxy({}, {
    get: (_t, name: string) => {
      try {
        return (ShapeRegistry as any).get(name);
      } catch {
        return undefined;
      }
    },
  }),
};

/** Connection handling is a default plugin in maxGraph; no global symbol. */
export const mxConnectionHandler: any = null;

// ---------------------------------------------------------------------------
// Model — re-add the mxGraph `mxGraphModel` helpers that maxGraph moved onto
// `Cell` (and the graph). Everything else (beginUpdate/endUpdate/getCell/
// setValue/getChildCount/addListener) is inherited unchanged.
// ---------------------------------------------------------------------------
export class mxGraphModel extends GraphDataModel {
  isVertex(cell: any): boolean {
    return !!cell && cell.isVertex();
  }
  isEdge(cell: any): boolean {
    return !!cell && cell.isEdge();
  }
  getParent(cell: any): any {
    return cell ? cell.getParent() : null;
  }
  getTerminal(cell: any, isSource: boolean): any {
    return cell ? cell.getTerminal(isSource) : null;
  }
  getChildAt(cell: any, index: number): any {
    return cell ? cell.getChildAt(index) : null;
  }
  getChildCells(parent: any, vertices = false, edges = false): any[] {
    const result: any[] = [];
    const count = parent ? parent.getChildCount() : 0;
    for (let i = 0; i < count; i++) {
      const child = parent.getChildAt(i);
      const wantAll = !vertices && !edges;
      if (wantAll || (vertices && child.isVertex()) || (edges && child.isEdge())) {
        result.push(child);
      }
    }
    return result;
  }
  getDescendants(parent: any): any[] {
    const out: any[] = [];
    const visit = (cell: any) => {
      const count = cell.getChildCount();
      for (let i = 0; i < count; i++) {
        const child = cell.getChildAt(i);
        out.push(child);
        visit(child);
      }
    };
    if (parent) {
      visit(parent);
    }
    return out;
  }

  /** Accept legacy inline style strings as well as CellStyle objects. */
  override setStyle(cell: any, style: any): void {
    (super.setStyle as any)(cell, toCellStyle(style));
  }
}

// ---------------------------------------------------------------------------
// Graph — subclass that restores the `getModel()` accessor, accepts legacy
// string style names on insert, and defaults `removeCells()` to the selection.
// ---------------------------------------------------------------------------
const BOOL_STYLE_KEYS = new Set([
  'rounded', 'dashed', 'html', 'horizontal', 'shadow', 'movable', 'resizable', 'editable',
]);

/**
 * Normalises the `style` argument the editors pass into maxGraph's `CellStyle`:
 *  - a registered style *name* (`'viewContainerStyle'`) → `{ baseStyleNames }`
 *  - a legacy inline mxGraph style string (`'shape=rectangle;fillColor=#fff;…'`)
 *    → a parsed `CellStyle` object (numbers / booleans coerced)
 *  - an object → passed through unchanged
 */
function toCellStyle(style: any): any {
  if (style == null || typeof style !== 'string') {
    return style;
  }
  if (style.indexOf('=') < 0) {
    return { baseStyleNames: style.split(';').filter(Boolean) };
  }
  const out: any = {};
  for (const part of style.split(';')) {
    if (!part) {
      continue;
    }
    const eq = part.indexOf('=');
    if (eq < 0) {
      (out.baseStyleNames = out.baseStyleNames || []).push(part);
      continue;
    }
    const key = part.slice(0, eq);
    const raw = part.slice(eq + 1);
    if (BOOL_STYLE_KEYS.has(key)) {
      out[key] = raw === '1' || raw === 'true';
    } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
      out[key] = parseFloat(raw);
    } else {
      out[key] = raw;
    }
  }
  return out;
}

export class mxGraph extends MaxGraph {
  constructor(container?: any, model?: any, plugins?: any, stylesheet?: any) {
    super(container, model, plugins, stylesheet);

    // maxGraph's mixins install insertVertex / insertEdge / removeCells as
    // instance *properties* (not prototype methods), so they cannot be
    // overridden as class methods — they are wrapped on the instance here.
    // Each wrapper accepts the legacy string style names / inline style
    // strings the editors pass and normalises them to maxGraph CellStyle.
    const self: any = this;

    const origInsertVertex = self.insertVertex.bind(self);
    self.insertVertex = (...args: any[]): any => {
      if (args.length === 1 && args[0] && typeof args[0] === 'object') {
        args[0] = { ...args[0], style: toCellStyle(args[0].style) };
      } else if (args.length > 7) {
        args[7] = toCellStyle(args[7]);
      }
      return origInsertVertex(...args);
    };

    const origInsertEdge = self.insertEdge.bind(self);
    self.insertEdge = (...args: any[]): any => {
      if (args.length === 1 && args[0] && typeof args[0] === 'object') {
        args[0] = { ...args[0], style: toCellStyle(args[0].style) };
      } else if (args.length > 5) {
        args[5] = toCellStyle(args[5]);
      }
      return origInsertEdge(...args);
    };

    const origRemoveCells = self.removeCells.bind(self);
    self.removeCells = (cells?: any, includeEdges = true): any => {
      const target = cells == null ? self.getSelectionCells() : cells;
      return origRemoveCells(target, includeEdges);
    };

    // mxGraph exposed fit(); provide a safe fallback if maxGraph lacks it.
    if (typeof self.fit !== 'function') {
      self.fit = (..._a: any[]): any => self.zoomActual();
    }
  }

  /** mxGraph-compatible model accessor (maxGraph renamed it to getDataModel). */
  getModel(): any {
    return this.getDataModel();
  }

  /** mxGraph exposed the connection handler as a field; maxGraph as a plugin. */
  get connectionHandler(): any {
    return (this as any).getPlugin?.('ConnectionHandler') ?? null;
  }
}

/**
 * Returns the style *identifier* of a cell as a string. With maxGraph a cell's
 * style is a `CellStyle` object whose `baseStyleNames` references the named
 * stylesheet entry the editors keyed their logic on.
 */
export function cellStyleName(cell: any): string {
  const style = cell ? cell.style : null;
  if (!style) {
    return '';
  }
  if (typeof style === 'string') {
    return style;
  }
  if (Array.isArray(style.baseStyleNames) && style.baseStyleNames.length) {
    return style.baseStyleNames[0];
  }
  return '';
}

/**
 * Registers the custom "box" shape (a rounded body with a title bar) used for
 * IFML view containers. maxGraph uses ES6 classes, so the shape is a real
 * subclass of {@link CylinderShape} rather than the legacy prototype idiom.
 */
export function registerBoxShape(): void {
  if (mxCellRenderer.getShape('box')) {
    return;
  }
  class BoxShape extends (CylinderShape as any) {
    redrawPath(path: any, _x: number, _y: number, w: number, h: number, isForeground?: boolean): void {
      if (isForeground) {
        // Title-bar separator near the top of the container.
        path.moveTo(0, 0.12 * h);
        path.lineTo(w, 0.12 * h);
        path.end?.();
        return;
      }
      // Outer body.
      path.moveTo(0, 0);
      path.lineTo(w, 0);
      path.lineTo(w, h);
      path.lineTo(0, h);
      path.lineTo(0, 0);
      path.close();
    }
  }
  mxCellRenderer.registerShape('box', BoxShape);
}
