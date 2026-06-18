/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Graph backend — legacy **mxGraph** implementation.
 *
 * Selected at build time by the `mxgraph` configuration, which swaps this file
 * in for `graph-backend.ts` (see angular.json → fileReplacements) and adds the
 * mxGraph global script + assets. mxGraph is an untyped global browser library,
 * so every symbol here is read off the global scope and typed as `any`.
 *
 * This file MUST export the same surface as `graph-backend.ts` so the editors
 * compile and run unchanged regardless of which backend is built.
 */
const G: any = (typeof window !== 'undefined' ? (window as any) : (globalThis as any));

export const GRAPH_BACKEND = 'mxgraph';

export const mxGraph: any = G.mxGraph;
export const mxGraphModel: any = G.mxGraphModel;
export const mxCell: any = G.mxCell;
export const mxGeometry: any = G.mxGeometry;
export const mxPoint: any = G.mxPoint;
export const mxRubberband: any = G.mxRubberband;
export const mxKeyHandler: any = G.mxKeyHandler;
export const mxEvent: any = G.mxEvent;
export const mxClient: any = G.mxClient;
export const mxConstants: any = G.mxConstants;
export const mxUtils: any = G.mxUtils;
export const mxPerimeter: any = G.mxPerimeter;
export const mxEdgeStyle: any = G.mxEdgeStyle;
export const mxCellRenderer: any = G.mxCellRenderer;
export const mxCylinder: any = G.mxCylinder;
export const mxImage: any = G.mxImage;
export const mxConnectionHandler: any = G.mxConnectionHandler;

/** mxGraph is available only once its global script has loaded. */
export function graphBackendAvailable(): boolean {
  return typeof G.mxClient !== 'undefined';
}

/** Returns the style identifier of a cell (a plain string in mxGraph). */
export function cellStyleName(cell: any): string {
  return cell && typeof cell.style === 'string' ? cell.style : '';
}

/**
 * Registers the custom "box" shape (a rounded body with a title bar) used for
 * IFML view containers, using mxGraph's prototype-inheritance idiom.
 */
export function registerBoxShape(): void {
  if (!mxCellRenderer || (mxCellRenderer.defaultShapes && mxCellRenderer.defaultShapes['box'])) {
    return;
  }
  function BoxShape(this: any) {
    mxCylinder.call(this);
  }
  mxUtils.extend(BoxShape, mxCylinder);
  (BoxShape as any).prototype.extrude = 10;
  (BoxShape as any).prototype.redrawPath = function (path: any, _x: any, _y: any, w: number, h: number) {
    path.moveTo(0, 0);
    path.lineTo(w, 0);
    path.lineTo(w, 0.12 * h);
    path.lineTo(0, 0.12 * h);
    path.moveTo(w, 0);
    path.lineTo(w, h);
    path.lineTo(0, h);
    path.lineTo(0, 0);
    path.close();
  };
  mxCellRenderer.registerShape('box', BoxShape);
}
