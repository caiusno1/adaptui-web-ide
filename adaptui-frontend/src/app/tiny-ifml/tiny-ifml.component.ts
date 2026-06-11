import { AfterViewInit, Component, ElementRef, NgZone, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { AdaptationClass, IfmlElementRef } from '../model/adaptation.model';
import { GraphSnapshot, GraphVertex } from '../model/project.model';
import { IfmlFlow } from '../model/transformation.model';
import { AdaptationClassService } from '../services/adaptation-class.service';
import { IfmlModelService } from '../services/ifml-model.service';
import { ProjectService } from '../services/project.service';

// mxGraph is loaded as a global script (see angular.json -> scripts). These
// declarations expose the parts of the library we use to the TypeScript
// compiler. The library itself is untyped here, hence `any`.
declare var mxGraph: any;
declare var mxPoint: any;
declare var mxUtils: any;
declare var mxRubberband: any;
declare var mxConstants: any;
declare var mxCylinder: any;
declare var mxCellRenderer: any;
declare var mxClient: any;
declare var mxGraphModel: any;
declare var mxEvent: any;
declare var mxConnectionHandler: any;
declare var mxImage: any;
declare var mxKeyHandler: any;
declare var mxCell: any;
declare var mxGeometry: any;
declare var mxPerimeter: any;
declare var mxEdgeStyle: any;

/**
 * Describes a draggable/clickable element in the IFML palette and links it to
 * the mxGraph cell style and the IFML metaclass it represents on export.
 */
export interface IfmlPaletteItem {
  /** Internal identifier of the palette entry. */
  type: 'viewContainer' | 'viewComponent' | 'event' | 'annotation';
  /** Label shown on the palette button. */
  label: string;
  /** Material icon used on the palette button. */
  icon: string;
  /** Default label given to a freshly created cell. */
  defaultLabel: string;
  /** Default width of a freshly created cell. */
  width: number;
  /** Default height of a freshly created cell. */
  height: number;
  /** Name of the registered mxGraph cell style. */
  style: string;
}

@Component({
  standalone: false,
  selector: 'app-tiny-ifml',
  templateUrl: './tiny-ifml.component.html',
  styleUrls: ['./tiny-ifml.component.sass']
})
export class TinyIfmlComponent implements OnInit, AfterViewInit {

  @ViewChild('graphContainer')
  containerElementRef!: ElementRef;

  @ViewChildren('paletteButton', { read: ElementRef })
  paletteButtons!: QueryList<ElementRef>;

  /** The mxGraph instance, created in ngAfterViewInit. */
  private graph: any;

  /** Used to cascade the position of cells added through a button click. */
  private clickInsertCount = 0;

  /** Adaptation class assigned to each element, keyed by mxGraph cell id. */
  private meta = new Map<string, string>();

  /** Adaptation classes available in the element properties panel. */
  adaptationClasses: AdaptationClass[] = [];

  /** The element currently selected on the canvas (drives the properties panel). */
  selected: { cellId: string; name: string; className: string; type: string } | null = null;

  /**
   * The IFML elements offered by the palette. The order here also drives the
   * order of the rendered buttons and their drag sources.
   */
  paletteItems: IfmlPaletteItem[] = [
    { type: 'viewContainer', label: 'View Container', icon: 'web_asset', defaultLabel: 'View Container', width: 320, height: 220, style: 'viewContainerStyle' },
    { type: 'viewComponent', label: 'View Component', icon: 'view_module', defaultLabel: 'View', width: 200, height: 110, style: 'viewComponentStyle' },
    { type: 'event', label: 'Event', icon: 'radio_button_checked', defaultLabel: 'event', width: 34, height: 34, style: 'eventStyle' },
    { type: 'annotation', label: 'Annotation', icon: 'sticky_note_2', defaultLabel: 'ADAPTUI-ANNOTATION-STYLE=EDIT', width: 220, height: 70, style: 'generatorAnnotation' },
  ];

  /** Suppresses cross-tab publishing while the canvas is rebuilt (load/reset). */
  private loading = false;

  constructor(
    private zone: NgZone,
    private ifmlService: IfmlModelService,
    private classService: AdaptationClassService,
    private projectService: ProjectService,
  ) { }

  ngOnInit(): void {
    this.adaptationClasses = this.classService.classes;
  }

  get container() {
    return this.containerElementRef.nativeElement;
  }

  /** Changeable properties of the selected element's adaptation class. */
  get selectedChangeable(): string {
    if (!this.selected) {
      return '';
    }
    const cls = this.classService.getClass(this.selected.className);
    return cls ? cls.properties.map((p) => p.label).join(', ') : '';
  }

  ngAfterViewInit(): void {
    // The component is also instantiated by the unit test harness where the
    // mxGraph global is not present. Guard against that so the component stays
    // creatable without the library on the page.
    if (typeof mxClient === 'undefined') {
      return;
    }

    if (!mxClient.isBrowserSupported()) {
      mxUtils.error('Browser is not supported!', 200, false);
      return;
    }

    const model = new mxGraphModel();
    const graph = new mxGraph(this.container, model);
    this.graph = graph;

    this.configureGraph(graph);
    this.registerShapes();
    this.registerStyles(graph);
    this.registerDragSources(graph);
    this.seedExample(graph);

    // Keep the properties panel in sync with the canvas selection, and publish
    // the element list (id, type, adaptation class) to other tabs on any change.
    graph.getSelectionModel().addListener(mxEvent.CHANGE, () => {
      this.zone.run(() => this.onSelectionChanged());
    });
    graph.getModel().addListener(mxEvent.CHANGE, () => {
      if (!this.loading) {
        this.zone.run(() => this.publishElements());
      }
    });
    this.publishElements();

    this.projectService.register('ifml', {
      capture: () => this.serialize(),
      restore: (s) => this.deserialize(s as GraphSnapshot),
      reset: () => this.resetGraph(),
    });
  }

  // --------------------------------------------------------------------------
  // Project save / load (canvas + adaptation classes per cell)
  // --------------------------------------------------------------------------

  private serialize(): GraphSnapshot {
    const model = this.graph.getModel();
    const all: any[] = model.getDescendants(this.graph.getDefaultParent());
    const root = this.graph.getDefaultParent();
    const vertices: GraphVertex[] = [];
    const edges = [];
    for (const cell of all) {
      if (model.isVertex(cell)) {
        const g = cell.geometry || {};
        const parent = model.getParent(cell);
        const parentId = parent && parent !== root && model.isVertex(parent) ? parent.id : null;
        vertices.push({
          id: cell.id, parent: parentId,
          x: g.x || 0, y: g.y || 0, w: g.width || 0, h: g.height || 0,
          style: cell.style || '', value: cell.value || '', data: this.meta.get(cell.id) || '',
        });
      } else if (model.isEdge(cell)) {
        const s = model.getTerminal(cell, true);
        const t = model.getTerminal(cell, false);
        if (s && t) {
          edges.push({ source: s.id, target: t.id, style: cell.style || '', value: cell.value || '' });
        }
      }
    }
    return { vertices, edges };
  }

  private deserialize(snapshot: GraphSnapshot): void {
    const graph = this.graph;
    if (!graph || !snapshot) {
      return;
    }
    const model = graph.getModel();
    const root = graph.getDefaultParent();
    this.loading = true;
    model.beginUpdate();
    try {
      graph.removeCells(graph.getChildCells(root, true, true));
      this.meta.clear();
      const created = new Map<string, any>();
      // Create vertices parents-first (a child waits until its parent exists).
      const pending = [...(snapshot.vertices || [])];
      let guard = pending.length * pending.length + 10;
      while (pending.length && guard-- > 0) {
        const v = pending.shift() as GraphVertex;
        const parentCell = v.parent ? created.get(v.parent) : root;
        if (v.parent && !parentCell) {
          pending.push(v);
          continue;
        }
        const cell = graph.insertVertex(parentCell, null, v.value, v.x, v.y, v.w, v.h, v.style);
        const cls = typeof v.data === 'string' ? v.data : '';
        if (cls) {
          this.meta.set(cell.id, cls);
        }
        created.set(v.id, cell);
      }
      for (const e of snapshot.edges || []) {
        const s = created.get(e.source);
        const t = created.get(e.target);
        if (s && t) {
          graph.insertEdge(root, null, e.value, s, t, e.style);
        }
      }
    } finally {
      model.endUpdate();
      this.loading = false;
    }
    this.selected = null;
    this.publishElements();
  }

  private resetGraph(): void {
    const graph = this.graph;
    if (!graph) {
      return;
    }
    this.loading = true;
    graph.getModel().beginUpdate();
    try {
      graph.removeCells(graph.getChildCells(graph.getDefaultParent(), true, true));
      this.meta.clear();
    } finally {
      graph.getModel().endUpdate();
      this.loading = false;
    }
    this.selected = null;
    this.publishElements();
  }

  // --------------------------------------------------------------------------
  // Adaptation: element class, properties panel and cross-tab publishing
  // --------------------------------------------------------------------------

  /** Default adaptation class for a freshly created element of the given style. */
  private defaultClassForStyle(style: string): string {
    if (style.indexOf('viewContainerStyle') >= 0) { return 'Container'; }
    if (style.indexOf('viewComponentStyle') >= 0) { return 'View'; }
    if (style.indexOf('eventStyle') >= 0) { return 'Event'; }
    return 'Generic';
  }

  private typeOf(cell: any): string {
    if (this.isViewContainer(cell)) { return 'ViewContainer'; }
    if (this.isViewComponent(cell)) { return 'ViewComponent'; }
    if (this.isEvent(cell)) { return 'Event'; }
    return '';
  }

  private classOf(cell: any): string {
    return this.meta.get(cell.id) || this.defaultClassForStyle(this.styleOf(cell));
  }

  /** Recomputes and publishes the IFML elements (with containment) and flows. */
  private publishElements(): void {
    if (!this.graph) {
      return;
    }
    const model = this.graph.getModel();
    const all: any[] = model.getDescendants(this.graph.getDefaultParent());
    const refs: IfmlElementRef[] = [];
    const flows: IfmlFlow[] = [];
    for (const cell of all) {
      const type = this.typeOf(cell);
      if (type) {
        const parent = model.getParent(cell);
        const parentCellId = parent && this.typeOf(parent) ? parent.id : undefined;
        refs.push({
          cellId: cell.id,
          name: this.cleanName(cell.value) || type,
          type,
          className: this.classOf(cell),
          parentCellId,
        });
      } else if (model.isEdge(cell)) {
        const src = model.getTerminal(cell, true);
        const tgt = model.getTerminal(cell, false);
        if (src && tgt && this.typeOf(src) && this.typeOf(tgt)) {
          flows.push({ sourceCellId: src.id, targetCellId: tgt.id });
        }
      }
    }
    this.ifmlService.setModel(refs, flows);
  }

  private onSelectionChanged(): void {
    const cell = this.graph.getSelectionCell();
    const type = cell ? this.typeOf(cell) : '';
    if (cell && type) {
      this.selected = {
        cellId: cell.id,
        name: this.cleanName(cell.value) || type,
        className: this.classOf(cell),
        type,
      };
    } else {
      this.selected = null;
    }
  }

  /** Renames the selected element (panel input). */
  onNameChange(name: string): void {
    if (!this.selected) {
      return;
    }
    const cell = this.graph.getModel().getCell(this.selected.cellId);
    if (cell) {
      this.graph.getModel().setValue(cell, name);
      this.selected.name = name;
      this.publishElements();
    }
  }

  /** Reassigns the selected element's adaptation class (panel select). */
  onClassChange(className: string): void {
    if (!this.selected) {
      return;
    }
    this.meta.set(this.selected.cellId, className);
    this.selected.className = className;
    this.publishElements();
  }

  // --------------------------------------------------------------------------
  // Graph configuration
  // --------------------------------------------------------------------------

  /** Applies the general interaction behaviour of the editor. */
  private configureGraph(graph: any): void {
    graph.setConnectable(true);          // arrows / navigation flows
    graph.setMultigraph(false);
    graph.setAllowDanglingEdges(false);  // every flow must connect two elements
    graph.setDropEnabled(true);          // allow dropping elements into containers
    graph.setPanning(true);
    graph.setCellsResizable(true);
    graph.setHtmlLabels(false);
    graph.vertexLabelsMovable = false;
    graph.constrainChildren = true;
    graph.extendParents = true;
    graph.extendParentsOnAdd = true;

    // Edges (navigation flows) are not themselves connectable.
    graph.setConnectableEdges(false);

    // Selection / rubber-band selection and keyboard shortcuts.
    // eslint-disable-next-line no-new
    new mxRubberband(graph);
    const keyHandler = new mxKeyHandler(graph);
    keyHandler.bindKey(46, () => this.deleteSelected()); // Delete
    keyHandler.bindKey(8, () => this.deleteSelected());  // Backspace

    // New connections are created as navigation flows.
    const self = this;
    const baseCreateEdge = graph.createEdge.bind(graph);
    graph.createEdge = function (parent: any, id: any, value: any, source: any, target: any, style: any) {
      return baseCreateEdge(parent, id, value != null ? value : '', source, target, style || 'navigationFlowStyle');
    };

    // Only let users start a flow from a view element or an event, and never
    // from / to an annotation. Keeps the produced IFML model meaningful.
    graph.isValidSource = function (cell: any) {
      return cell != null && !self.isAnnotation(cell) && mxGraph.prototype.isValidSource.apply(this, [cell]);
    };
    graph.isValidTarget = function (cell: any) {
      return cell != null && !self.isAnnotation(cell);
    };
  }

  /** Registers the custom "box" shape used for view containers (title bar). */
  private registerShapes(): void {
    if (mxCellRenderer.defaultShapes && mxCellRenderer.defaultShapes['box']) {
      return; // already registered (e.g. when the view is re-created)
    }

    function BoxShape(this: any) {
      mxCylinder.call(this);
    }
    mxUtils.extend(BoxShape, mxCylinder);
    BoxShape.prototype.extrude = 10;
    BoxShape.prototype.redrawPath = function (path: any, x: any, y: any, w: number, h: number) {
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

  /** Registers the named cell styles for every IFML element type. */
  private registerStyles(graph: any): void {
    const stylesheet = graph.getStylesheet();

    const viewContainerStyle: any = {};
    viewContainerStyle[mxConstants.STYLE_SHAPE] = 'box';
    viewContainerStyle[mxConstants.STYLE_STROKECOLOR] = '#2c3e50';
    viewContainerStyle[mxConstants.STYLE_FILLCOLOR] = '#ffffff';
    viewContainerStyle[mxConstants.STYLE_FONTCOLOR] = '#2c3e50';
    viewContainerStyle[mxConstants.STYLE_FONTSIZE] = 14;
    viewContainerStyle[mxConstants.STYLE_FONTSTYLE] = mxConstants.FONT_BOLD;
    viewContainerStyle[mxConstants.STYLE_VERTICAL_ALIGN] = mxConstants.ALIGN_TOP;
    viewContainerStyle[mxConstants.STYLE_ALIGN] = mxConstants.ALIGN_CENTER;
    viewContainerStyle[mxConstants.STYLE_SPACING_TOP] = 2;
    viewContainerStyle[mxConstants.STYLE_STROKEWIDTH] = 1.5;

    const viewComponentStyle: any = {};
    viewComponentStyle[mxConstants.STYLE_SHAPE] = mxConstants.SHAPE_RECTANGLE;
    viewComponentStyle[mxConstants.STYLE_ROUNDED] = true;
    viewComponentStyle[mxConstants.STYLE_STROKECOLOR] = '#34495e';
    viewComponentStyle[mxConstants.STYLE_FILLCOLOR] = '#eef6fc';
    viewComponentStyle[mxConstants.STYLE_FONTCOLOR] = '#2c3e50';
    viewComponentStyle[mxConstants.STYLE_FONTSIZE] = 13;
    viewComponentStyle[mxConstants.STYLE_VERTICAL_ALIGN] = mxConstants.ALIGN_TOP;
    viewComponentStyle[mxConstants.STYLE_SPACING_TOP] = 4;

    const eventStyle: any = {};
    eventStyle[mxConstants.STYLE_SHAPE] = mxConstants.SHAPE_ELLIPSE;
    eventStyle[mxConstants.STYLE_PERIMETER] = mxPerimeter.EllipsePerimeter;
    eventStyle[mxConstants.STYLE_STROKECOLOR] = '#e67e22';
    eventStyle[mxConstants.STYLE_FILLCOLOR] = '#ffffff';
    eventStyle[mxConstants.STYLE_STROKEWIDTH] = 2;
    eventStyle[mxConstants.STYLE_FONTCOLOR] = '#a85b10';
    eventStyle[mxConstants.STYLE_FONTSIZE] = 11;
    eventStyle[mxConstants.STYLE_VERTICAL_LABEL_POSITION] = mxConstants.ALIGN_BOTTOM;
    eventStyle[mxConstants.STYLE_VERTICAL_ALIGN] = mxConstants.ALIGN_TOP;

    const generatorAnnotation: any = {};
    generatorAnnotation[mxConstants.STYLE_STROKECOLOR] = '#e0c000';
    generatorAnnotation[mxConstants.STYLE_FILLCOLOR] = '#fff7c0';
    generatorAnnotation[mxConstants.STYLE_FONTCOLOR] = '#6b5900';
    generatorAnnotation[mxConstants.STYLE_FONTSIZE] = 11;
    generatorAnnotation[mxConstants.STYLE_ALIGN] = mxConstants.ALIGN_LEFT;
    generatorAnnotation[mxConstants.STYLE_VERTICAL_ALIGN] = mxConstants.ALIGN_TOP;
    generatorAnnotation[mxConstants.STYLE_SPACING_LEFT] = 6;
    generatorAnnotation[mxConstants.STYLE_SPACING_TOP] = 4;
    generatorAnnotation[mxConstants.STYLE_WHITE_SPACE] = 'wrap';

    const navigationFlowStyle: any = {};
    navigationFlowStyle[mxConstants.STYLE_EDGE] = mxEdgeStyle.OrthConnector;
    navigationFlowStyle[mxConstants.STYLE_ROUNDED] = true;
    navigationFlowStyle[mxConstants.STYLE_ENDARROW] = mxConstants.ARROW_CLASSIC;
    navigationFlowStyle[mxConstants.STYLE_STROKECOLOR] = '#555555';
    navigationFlowStyle[mxConstants.STYLE_STROKEWIDTH] = 2;
    navigationFlowStyle[mxConstants.STYLE_FONTCOLOR] = '#333333';
    navigationFlowStyle[mxConstants.STYLE_FONTSIZE] = 11;
    navigationFlowStyle[mxConstants.STYLE_LABEL_BACKGROUNDCOLOR] = '#ffffff';

    stylesheet.putCellStyle('viewContainerStyle', viewContainerStyle);
    stylesheet.putCellStyle('viewComponentStyle', viewComponentStyle);
    stylesheet.putCellStyle('eventStyle', eventStyle);
    stylesheet.putCellStyle('generatorAnnotation', generatorAnnotation);
    stylesheet.putCellStyle('navigationFlowStyle', navigationFlowStyle);

    // Make freshly drawn connections look like navigation flows by default.
    const defaultEdge = stylesheet.getDefaultEdgeStyle();
    for (const key of Object.keys(navigationFlowStyle)) {
      defaultEdge[key] = navigationFlowStyle[key];
    }
  }

  /** Wires every palette button up as a drag source for the graph. */
  private registerDragSources(graph: any): void {
    const buttons = this.paletteButtons.toArray();
    buttons.forEach((btnRef, index) => {
      const item = this.paletteItems[index];
      if (!item) {
        return;
      }
      const onDrop = (g: any, evt: any, dropCell: any, x: number, y: number) => {
        this.insertElement(item, x, y, dropCell, true);
      };
      mxUtils.makeDraggable(btnRef.nativeElement, graph, onDrop);
    });
  }

  // --------------------------------------------------------------------------
  // Palette / toolbar actions (bound from the template)
  // --------------------------------------------------------------------------

  /** Adds an element by clicking its palette button (no drag required). */
  addElement(item: IfmlPaletteItem): void {
    if (!this.graph) {
      return;
    }
    const offset = (this.clickInsertCount++ % 6) * 24;
    this.insertElement(item, 40 + offset, 40 + offset, null, false);
  }

  exportIfml(): void {
    if (!this.graph) {
      return;
    }
    const xml = this.buildIfmlXml();
    this.downloadFile(xml, 'model.ifml', 'application/xml');
  }

  zoomIn(): void { this.graph?.zoomIn(); }

  zoomOut(): void { this.graph?.zoomOut(); }

  resetView(): void {
    if (!this.graph) {
      return;
    }
    this.graph.zoomActual();
    this.graph.view.setTranslate(0, 0);
  }

  fit(): void { this.graph?.fit(); }

  deleteSelected(): void {
    if (!this.graph || this.graph.isSelectionEmpty()) {
      return;
    }
    this.graph.removeCells();
  }

  clearAll(): void {
    if (!this.graph) {
      return;
    }
    if (!confirm('Remove every element from the diagram?')) {
      return;
    }
    const graph = this.graph;
    const parent = graph.getDefaultParent();
    graph.getModel().beginUpdate();
    try {
      graph.removeCells(graph.getChildCells(parent, true, true));
    } finally {
      graph.getModel().endUpdate();
    }
  }

  // --------------------------------------------------------------------------
  // Cell creation helpers
  // --------------------------------------------------------------------------

  /**
   * Inserts a new IFML element. View components, events and annotations are
   * nested into the view container under the drop point (or the selected one)
   * so the produced model keeps a sensible containment hierarchy.
   *
   * @param absolute when true, (x, y) are absolute graph coordinates (a drop)
   *   and are converted into the parent's local coordinate system; when false
   *   they are already parent-local offsets (a click-to-add).
   */
  private insertElement(item: IfmlPaletteItem, x: number, y: number, dropCell: any, absolute: boolean): void {
    const graph = this.graph;
    const model = graph.getModel();
    const parent = this.resolveParent(item, dropCell);
    const nested = parent !== graph.getDefaultParent();

    model.beginUpdate();
    try {
      let px = x;
      let py = y;
      // Convert an absolute drop point into the parent's local coordinates.
      if (absolute && nested) {
        const state = graph.view.getState(parent);
        if (state) {
          const scale = graph.view.scale;
          const tr = graph.view.translate;
          px = x - (state.x / scale - tr.x);
          py = y - (state.y / scale - tr.y);
        }
      }
      if (nested) {
        // Keep the element inside the container (below its title bar).
        px = Math.max(8, px);
        py = Math.max(24, py);
      }
      const vertex = graph.insertVertex(parent, null, item.defaultLabel, px, py, item.width, item.height, item.style);
      if (this.typeOf(vertex)) {
        this.meta.set(vertex.id, this.defaultClassForStyle(item.style));
      }
      graph.setSelectionCell(vertex);
    } finally {
      model.endUpdate();
    }
  }

  /** Picks the parent cell for a new element based on the drop/selection target. */
  private resolveParent(item: IfmlPaletteItem, dropCell: any): any {
    const graph = this.graph;
    // Top-level containers always live on the root layer.
    if (item.type === 'viewContainer') {
      let candidate = dropCell;
      while (candidate != null && !this.isViewContainer(candidate)) {
        candidate = this.graph.getModel().getParent(candidate);
      }
      return candidate || graph.getDefaultParent();
    }

    let target = dropCell;
    if (!target) {
      const selected = graph.getSelectionCell();
      target = selected || null;
    }
    while (target != null && !this.isViewContainer(target)) {
      target = graph.getModel().getParent(target);
    }
    return target || graph.getDefaultParent();
  }

  // --------------------------------------------------------------------------
  // Cell type predicates
  // --------------------------------------------------------------------------

  private styleOf(cell: any): string {
    return (cell && typeof cell.style === 'string') ? cell.style : '';
  }

  private isViewContainer(cell: any): boolean {
    return this.styleOf(cell).indexOf('viewContainerStyle') >= 0;
  }

  private isViewComponent(cell: any): boolean {
    return this.styleOf(cell).indexOf('viewComponentStyle') >= 0;
  }

  private isEvent(cell: any): boolean {
    return this.styleOf(cell).indexOf('eventStyle') >= 0;
  }

  private isAnnotation(cell: any): boolean {
    return this.styleOf(cell).indexOf('generatorAnnotation') >= 0;
  }

  // --------------------------------------------------------------------------
  // IFML XML export
  // --------------------------------------------------------------------------

  /**
   * Serialises the current graph into a simplified IFML (XMI) document with
   * ViewContainers, ViewComponents, Events, NavigationFlows and Comments.
   */
  private buildIfmlXml(): string {
    const model = this.graph.getModel();
    const root = this.graph.getDefaultParent();

    // Assign a stable XMI id to every relevant cell.
    const idMap = new Map<any, string>();
    let counter = 0;
    const nextId = () => `id_${++counter}`;
    const allCells: any[] = model.getDescendants ? model.getDescendants(root) : this.collectDescendants(root);
    for (const cell of allCells) {
      if (this.isViewContainer(cell) || this.isViewComponent(cell) || this.isEvent(cell) || this.isAnnotation(cell)) {
        idMap.set(cell, nextId());
      }
    }

    // Events that must be synthesised on a source element because the user drew
    // a flow directly from a container/component instead of from an event.
    const synthesizedEvents = new Map<any, { id: string; name: string; metaclass: string }[]>();
    const navigationFlows: { id: string; name: string; source: string; target: string }[] = [];

    const edges: any[] = allCells.filter((c) => model.isEdge(c));
    for (const edge of edges) {
      const source = model.getTerminal(edge, true);
      const target = model.getTerminal(edge, false);
      if (!source || !target || this.isAnnotation(source) || this.isAnnotation(target)) {
        continue;
      }
      const targetId = idMap.get(target);
      if (!targetId) {
        continue;
      }

      let sourceEventId: string | undefined;
      if (this.isEvent(source)) {
        sourceEventId = idMap.get(source);
      } else {
        // Synthesize a ViewElementEvent on the source view element.
        sourceEventId = nextId();
        const metaclass = this.isViewContainer(source) ? 'ViewContainerEvent' : 'ViewComponentEvent';
        const name = this.cleanName(edge.value) || ('on' + this.pascalCase(this.cleanName(target.value) || 'Navigate'));
        const list = synthesizedEvents.get(source) || [];
        list.push({ id: sourceEventId, name, metaclass });
        synthesizedEvents.set(source, list);
      }
      if (!sourceEventId) {
        continue;
      }
      navigationFlows.push({
        id: nextId(),
        name: this.cleanName(edge.value),
        source: sourceEventId,
        target: targetId,
      });
    }

    // Recursively serialise the view-element containment hierarchy.
    const serializeElement = (cell: any, containmentRef: string, indent: string): string => {
      const id = idMap.get(cell);
      const name = this.escapeXml(this.cleanName(cell.value) || (this.isViewContainer(cell) ? 'ViewContainer' : 'ViewComponent'));
      const metaclass = this.isViewContainer(cell) ? 'ViewContainer' : 'ViewComponent';
      const childCells: any[] = model.getChildCells(cell, true, false) || [];

      const inner: string[] = [];

      // Explicit event circles placed on this element.
      for (const child of childCells) {
        if (this.isEvent(child)) {
          const evMeta = this.isViewContainer(cell) ? 'ViewContainerEvent' : 'ViewComponentEvent';
          inner.push(`${indent}  <viewElementEvents xsi:type="ifml:${evMeta}" xmi:id="${idMap.get(child)}" name="${this.escapeXml(this.cleanName(child.value) || 'event')}" adaptationClass="${this.escapeXml(this.classOf(child))}"/>`);
        }
      }
      // Events synthesised from flows that start at this element.
      for (const ev of synthesizedEvents.get(cell) || []) {
        inner.push(`${indent}  <viewElementEvents xsi:type="ifml:${ev.metaclass}" xmi:id="${ev.id}" name="${this.escapeXml(ev.name)}"/>`);
      }
      // Nested view containers / components.
      for (const child of childCells) {
        if (this.isViewContainer(child) || this.isViewComponent(child)) {
          inner.push(serializeElement(child, 'viewElements', indent + '  '));
        }
      }

      const adaptAttr = ` adaptationClass="${this.escapeXml(this.classOf(cell))}"`;
      const attrs = adaptAttr + (metaclass === 'ViewContainer' ? ' isLandmark="false" isDefault="false" isXOR="false"' : '');
      if (inner.length === 0) {
        return `${indent}<${containmentRef} xsi:type="ifml:${metaclass}" xmi:id="${id}" name="${name}"${attrs}/>`;
      }
      return `${indent}<${containmentRef} xsi:type="ifml:${metaclass}" xmi:id="${id}" name="${name}"${attrs}>\n${inner.join('\n')}\n${indent}</${containmentRef}>`;
    };

    const topLevel: any[] = (model.getChildCells(root, true, false) || []);
    const elementXml: string[] = [];
    for (const cell of topLevel) {
      if (this.isViewContainer(cell) || this.isViewComponent(cell)) {
        elementXml.push(serializeElement(cell, 'interactionFlowElements', '    '));
      }
    }

    const flowXml = navigationFlows.map((f) =>
      `    <interactionFlowConnections xsi:type="ifml:NavigationFlow" xmi:id="${f.id}" name="${this.escapeXml(f.name)}" sourceInteractionFlowElement="${f.source}" targetInteractionFlowElement="${f.target}"/>`
    );

    // Annotations become UML-style comments referencing the element they sit on.
    const commentXml: string[] = [];
    for (const cell of allCells) {
      if (this.isAnnotation(cell)) {
        const annotated = this.nearestAnnotatedId(cell, idMap);
        const ref = annotated ? ` annotatedElements="${annotated}"` : '';
        commentXml.push(`  <comments xmi:id="${idMap.get(cell)}" body="${this.escapeXml(this.cleanName(cell.value))}"${ref}/>`);
      }
    }

    const modelChildren = [...elementXml, ...flowXml].join('\n');
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<ifml:IFMLModel xmi:version="2.0"');
    lines.push('    xmlns:xmi="http://www.omg.org/XMI"');
    lines.push('    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    lines.push('    xmlns:ifml="http://www.omg.org/spec/IFML/20140301"');
    lines.push('    name="AdaptUI IFML Model">');
    lines.push('  <interactionFlowModel xmi:id="ifml_model" name="AdaptUI IFML Model">');
    if (modelChildren) {
      lines.push(modelChildren);
    }
    lines.push('  </interactionFlowModel>');
    if (commentXml.length) {
      lines.push(commentXml.join('\n'));
    }
    lines.push('</ifml:IFMLModel>');
    return lines.join('\n');
  }

  /** Finds the id of the closest view element a comment is attached to. */
  private nearestAnnotatedId(cell: any, idMap: Map<any, string>): string | undefined {
    const model = this.graph.getModel();
    let parent = model.getParent(cell);
    while (parent != null) {
      if (idMap.has(parent)) {
        return idMap.get(parent);
      }
      parent = model.getParent(parent);
    }
    return undefined;
  }

  private collectDescendants(parent: any): any[] {
    const model = this.graph.getModel();
    const result: any[] = [];
    const visit = (cell: any) => {
      const count = model.getChildCount(cell);
      for (let i = 0; i < count; i++) {
        const child = model.getChildAt(cell, i);
        result.push(child);
        visit(child);
      }
    };
    visit(parent);
    return result;
  }

  // --------------------------------------------------------------------------
  // Small utilities
  // --------------------------------------------------------------------------

  private cleanName(value: any): string {
    if (value == null) {
      return '';
    }
    return String(value).replace(/\s+/g, ' ').trim();
  }

  private pascalCase(value: string): string {
    return value
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .split(' ')
      .filter((w) => w.length > 0)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
  }

  private escapeXml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private downloadFile(content: string, filename: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  // --------------------------------------------------------------------------
  // Seed diagram
  // --------------------------------------------------------------------------

  /** Inserts a small starter model so the editor is not empty on first load. */
  /**
   * Seeds a Social Media example modelled with standard IFML constructs only —
   * ViewContainers (the Login and News Feed views, plus cards/menu/feed), nested
   * ViewComponents (headings, fields, posts) and ViewElementEvents wired by
   * NavigationFlows. The Style tab concretizes the adaptation classes used here
   * (flex/grid layout, cards, gradients) so the Preview renders a real UI.
   */
  private seedExample(graph: any): void {
    const parent = graph.getDefaultParent();
    const model = graph.getModel();
    const cont = (p: any, label: string, cls: string, x: number, y: number, w: number, h: number) => {
      const v = graph.insertVertex(p, null, label, x, y, w, h, 'viewContainerStyle');
      this.meta.set(v.id, cls);
      return v;
    };
    const comp = (p: any, label: string, cls: string, x: number, y: number, w: number, h: number) => {
      const v = graph.insertVertex(p, null, label, x, y, w, h, 'viewComponentStyle');
      this.meta.set(v.id, cls);
      return v;
    };
    const evt = (p: any, label: string, cls: string, x: number, y: number) => {
      const v = graph.insertVertex(p, null, label, x, y, 34, 34, 'eventStyle');
      this.meta.set(v.id, cls);
      return v;
    };
    const flow = (s: any, t: any, label: string) => graph.insertEdge(parent, null, label, s, t, 'navigationFlowStyle');

    model.beginUpdate();
    try {
      // ---- Login view (top-level ViewContainer) ----
      const login = cont(parent, 'Login', 'authView', 40, 40, 360, 320);
      const card = cont(login, 'Login Form', 'card', 30, 50, 300, 250);
      comp(card, 'Welcome back', 'heading', 16, 30, 268, 28);
      comp(card, 'Email', 'field', 16, 66, 268, 38);
      comp(card, 'Password', 'field', 16, 110, 268, 38);
      const signIn = evt(card, 'Sign In', 'primaryBtn', 133, 168);

      // ---- News Feed view (top-level ViewContainer) ----
      const feedView = cont(parent, 'News Feed', 'appView', 460, 40, 560, 660);
      const menu = cont(feedView, 'Menu', 'menubar', 24, 46, 510, 70);
      comp(menu, 'SocialApp', 'brand', 16, 22, 150, 34);
      const navFeed = evt(menu, 'Feed', 'navlink', 300, 26);
      evt(menu, 'New Post', 'navlink', 370, 26);
      const navLogout = evt(menu, 'Log out', 'navlink', 440, 26);
      const feed = cont(feedView, 'Feed', 'feedgrid', 24, 134, 510, 500);
      const post = (label: string, author: string, body: string, x: number, y: number) => {
        const p = cont(feed, label, 'post', x, y, 230, 200);
        comp(p, author, 'author', 12, 24, 200, 26);
        comp(p, body, 'postbody', 12, 56, 206, 120);
      };
      post('Post 1', 'Ada Lovelace', 'Just shipped the first algorithm! 🚀', 18, 30);
      post('Post 2', 'Alan Turing', 'Pondering whether machines can think.', 262, 30);
      post('Post 3', 'Grace Hopper', 'Found a real bug in the system today 🐛', 18, 250);
      post('Post 4', 'Linus T.', 'Just for fun: tagging a new release.', 262, 250);

      // ---- Navigation flows between events and target views ----
      flow(signIn, feedView, 'sign in');
      flow(navFeed, feedView, 'feed');
      flow(navLogout, login, 'log out');
    } finally {
      model.endUpdate();
    }

    // Register the example's adaptation classes so both editors list them.
    const classes: Array<[string, string]> = [
      ['authView', 'Auth view'], ['card', 'Card'], ['heading', 'Heading'], ['field', 'Field'],
      ['primaryBtn', 'Primary button'], ['appView', 'App view'], ['menubar', 'Menu bar'],
      ['brand', 'Brand'], ['navlink', 'Nav link'], ['feedgrid', 'Feed grid'], ['post', 'Post'],
      ['author', 'Author'], ['postbody', 'Post body'],
    ];
    for (const [name, label] of classes) {
      this.classService.addClass({ name, label, properties: [] });
    }
  }
}
