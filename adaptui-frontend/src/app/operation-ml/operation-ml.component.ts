import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { Subscription } from 'rxjs';

import { AdaptationClass, IfmlElementRef } from '../model/adaptation.model';
import {
  ElementMatch, OperationModel, OpEdge, OpNode, PatternEdgeData, PatternNodeData,
  PatternNodeKind, PatternRole, PatternSelectorKind, RELATION_KINDS, STYLE_PROPERTIES, StylePropDef,
} from '../model/transformation.model';
import { AdaptationClassService } from '../services/adaptation-class.service';
import { IfmlModelService } from '../services/ifml-model.service';
import { OperationModelService } from '../services/operation-model.service';
import { ProjectService } from '../services/project.service';

// Graph primitives via the build-selected backend: maxGraph by default, or the
// legacy global mxGraph via the `mxgraph` build flag. See ../graph/graph-backend.
import {
  mxGraph, mxGraphModel, mxClient, mxEvent, mxRubberband, mxKeyHandler,
  mxConstants, mxUtils,
} from '../graph/graph-backend';

interface OpPaletteItem {
  kind: PatternNodeKind;
  label: string;
  icon: string;
  width: number;
  height: number;
}

const ROLE_COLORS: { [role: string]: { stroke: string; fill: string } } = {
  preserve: { stroke: '#455a64', fill: '#eceff1' },
  create: { stroke: '#2e7d32', fill: '#e8f5e9' },
  delete: { stroke: '#c62828', fill: '#ffebee' },
  forbid: { stroke: '#ef6c00', fill: '#fff3e0' },
};

/**
 * Editor for Operations — graph transformations over IFML and the Style DSL.
 * Each operation is one rewrite rule shown in the unified single-graph notation:
 * nodes/edges are tagged «preserve» (LHS ∩ RHS), «create» (RHS only) or
 * «delete» (LHS only), and preserve/create nodes carry the property assignments
 * applied on the right-hand side. Operations are published by name for ADAPTML.
 */
@Component({
  standalone: false,
  selector: 'app-operation-ml',
  templateUrl: './operation-ml.component.html',
  styleUrls: ['./operation-ml.component.sass'],
})
export class OperationMlComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('graphContainer')
  containerElementRef!: ElementRef;

  @ViewChildren('paletteButton', { read: ElementRef })
  paletteButtons!: QueryList<ElementRef>;

  paletteItems: OpPaletteItem[] = [
    { kind: 'element', label: 'Element pattern', icon: 'category', width: 170, height: 66 },
    { kind: 'style', label: 'Style pattern', icon: 'palette', width: 180, height: 66 },
  ];

  // Option lists for the configuration panel.
  readonly roles: PatternRole[] = ['preserve', 'create', 'delete', 'forbid'];
  readonly matches: ElementMatch[] = ['any', 'ViewContainer', 'ViewComponent', 'Event'];
  readonly selectorKinds: PatternSelectorKind[] = ['none', 'class', 'id'];
  readonly relations = RELATION_KINDS;

  operations: OperationModel[] = [];
  currentOpId: string | null = null;
  currentOpName = '';

  ifmlElements: IfmlElementRef[] = [];
  adaptationClasses: AdaptationClass[] = [];

  selectedCellId: string | null = null;
  selectedNode: PatternNodeData | null = null;
  selectedEdge: PatternEdgeData | null = null;

  private graph: any;
  private nodeData = new Map<string, PatternNodeData>();
  private edgeData = new Map<string, PatternEdgeData>();
  private subscriptions = new Subscription();
  private opCounter = 0;
  private clickInsertCount = 0;
  private loading = false;

  constructor(
    private zone: NgZone,
    private ifmlService: IfmlModelService,
    private classService: AdaptationClassService,
    private operationService: OperationModelService,
    private projectService: ProjectService,
  ) { }

  ngOnInit(): void {
    this.adaptationClasses = this.classService.classes;
    this.subscriptions.add(this.ifmlService.elements$.subscribe((els) => { this.ifmlElements = els; }));
    this.subscriptions.add(this.classService.classes$.subscribe((cs) => { this.adaptationClasses = cs; }));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get container() {
    return this.containerElementRef.nativeElement;
  }

  ngAfterViewInit(): void {
    if (typeof mxClient === 'undefined' || !mxClient.isBrowserSupported()) {
      return;
    }
    const model = new mxGraphModel();
    const graph = new mxGraph(this.container, model);
    this.graph = graph;

    graph.setConnectable(true);
    graph.setAllowDanglingEdges(false);
    graph.setConnectableEdges(false);
    graph.setCellsResizable(true);
    graph.setPanning(true);

    // eslint-disable-next-line no-new
    new mxRubberband(graph);
    const keyHandler = new mxKeyHandler(graph);
    keyHandler.bindKey(46, () => this.deleteSelected());
    keyHandler.bindKey(8, () => this.deleteSelected());

    // Initialise pattern edges as they are drawn.
    graph.connectionHandler.addListener(mxEvent.CONNECT, (_s: any, evt: any) => {
      const edge = evt.getProperty('cell');
      if (edge) {
        this.zone.run(() => {
          const data: PatternEdgeData = { role: 'preserve', relation: 'contains' };
          this.edgeData.set(edge.id, data);
          graph.getModel().setStyle(edge, this.edgeStyleFor(data));
          graph.getModel().setValue(edge, this.edgeLabel(data));
        });
      }
    });

    graph.getSelectionModel().addListener(mxEvent.CHANGE, () => {
      this.zone.run(() => this.onSelectionChanged());
    });
    graph.getModel().addListener(mxEvent.CHANGE, () => {
      if (!this.loading) {
        this.zone.run(() => this.publishModels());
      }
    });

    this.paletteButtons.toArray().forEach((btnRef, index) => {
      const item = this.paletteItems[index];
      if (item) {
        mxUtils.makeDraggable(btnRef.nativeElement, graph, (_g: any, _e: any, _c: any, x: number, y: number) => this.insertNode(item, x, y));
      }
    });

    this.projectService.register('operations', {
      capture: () => this.serialize(),
      restore: (s) => this.deserialize(s),
      reset: () => this.resetOperations(),
    });

    // Seed the dark-mode example operations. Deferred to the next macrotask so it
    // does not mutate bound state during the change detection pass that follows
    // ngAfterViewInit (avoids NG0100).
    setTimeout(() => this.seedOperations());
  }

  // --------------------------------------------------------------------------
  // Project save / load (the full set of operations + visual node layout)
  // --------------------------------------------------------------------------

  private serialize(): { operations: OperationModel[]; currentOpId: string | null } {
    this.saveCurrentOperation();
    return { operations: this.operations.map((o) => JSON.parse(JSON.stringify(o))), currentOpId: this.currentOpId };
  }

  private deserialize(state: unknown): void {
    const s = (state || {}) as { operations?: OperationModel[]; currentOpId?: string | null };
    this.operations = (s.operations || []).map((o) => JSON.parse(JSON.stringify(o)));
    // Keep the id counter ahead of any restored ids so new operations stay unique.
    for (const op of this.operations) {
      const n = parseInt(String(op.id).replace(/[^0-9]/g, ''), 10);
      if (!Number.isNaN(n) && n > this.opCounter) {
        this.opCounter = n;
      }
    }
    const target = s.currentOpId && this.operations.some((o) => o.id === s.currentOpId)
      ? s.currentOpId
      : (this.operations[0] ? this.operations[0].id : null);
    this.currentOpId = null;
    if (target) {
      this.loadOperation(target);
    } else {
      this.addOperation();
    }
    this.publishModels();
  }

  private resetOperations(): void {
    this.operations = [];
    this.currentOpId = null;
    this.addOperation();
  }

  /**
   * Seeds the dark-mode adaptation: two operations that recolour the matched
   * elements when applied — darkening container surfaces and lightening text.
   */
  private seedOperations(): void {
    const node = (data: PatternNodeData): OpNode => ({ id: 'n1', x: 60, y: 60, w: 240, h: 96, data });
    const surfaces: PatternNodeData = {
      kind: 'element', role: 'preserve', match: 'ViewContainer', selectorKind: 'none', selector: '',
      condProps: {}, setVisible: '', setProps: { backgroundColor: '#0f172a', backgroundImage: 'none', borderColor: '#1e293b' },
    };
    const text: PatternNodeData = {
      kind: 'element', role: 'preserve', match: 'ViewComponent', selectorKind: 'none', selector: '',
      condProps: {}, setVisible: '', setProps: { color: '#e2e8f0', backgroundColor: '#0f172a' },
    };
    this.operations.push({ id: `op_${++this.opCounter}`, name: 'Dark surfaces', nodes: [node(surfaces)], edges: [] });
    this.operations.push({ id: `op_${++this.opCounter}`, name: 'Dark text', nodes: [node(text)], edges: [] });
    this.loadOperation(this.operations[0].id);
    this.publishModels();
  }

  // --------------------------------------------------------------------------
  // Operation list management
  // --------------------------------------------------------------------------

  addOperation(): void {
    this.saveCurrentOperation();
    const id = `op_${++this.opCounter}`;
    this.operations.push({ id, name: `operation${this.operations.length + 1}`, nodes: [], edges: [] });
    this.loadOperation(id);
    this.publishModels();
  }

  selectOperation(id: string): void {
    if (id === this.currentOpId) {
      return;
    }
    this.saveCurrentOperation();
    this.loadOperation(id);
    this.publishModels();
  }

  deleteOperation(id: string): void {
    const wasCurrent = id === this.currentOpId;
    this.operations = this.operations.filter((o) => o.id !== id);
    if (wasCurrent) {
      this.currentOpId = null;
      if (this.operations.length) {
        this.loadOperation(this.operations[0].id);
      } else {
        this.addOperation();
        return;
      }
    }
    this.publishModels();
  }

  onOpNameChange(): void {
    const op = this.operations.find((o) => o.id === this.currentOpId);
    if (op) {
      op.name = this.currentOpName;
      this.publishModels();
    }
  }

  /** Saves the current operation and publishes all operations for ADAPTML and the Preview. */
  private publishModels(): void {
    this.saveCurrentOperation();
    this.operationService.setModels(this.operations.map((o) => ({ ...o })));
  }

  // --------------------------------------------------------------------------
  // Loading / saving an operation's graph
  // --------------------------------------------------------------------------

  private saveCurrentOperation(): void {
    if (!this.currentOpId || !this.graph) {
      return;
    }
    const op = this.operations.find((o) => o.id === this.currentOpId);
    if (!op) {
      return;
    }
    const model = this.graph.getModel();
    const root = this.graph.getDefaultParent();
    const children: any[] = model.getChildCells(root, true, true) || [];

    const cellToNode = new Map<string, string>();
    const nodes: OpNode[] = [];
    let n = 0;
    for (const cell of children) {
      if (model.isVertex(cell) && this.nodeData.has(cell.id)) {
        const nid = `n${++n}`;
        cellToNode.set(cell.id, nid);
        const g = cell.geometry;
        nodes.push({ id: nid, x: g.x, y: g.y, w: g.width, h: g.height, data: { ...this.nodeData.get(cell.id)! } });
      }
    }
    const edges: OpEdge[] = [];
    let e = 0;
    for (const cell of children) {
      if (model.isEdge(cell) && this.edgeData.has(cell.id)) {
        const srcCell = model.getTerminal(cell, true);
        const tgtCell = model.getTerminal(cell, false);
        const s = srcCell ? cellToNode.get(srcCell.id) : undefined;
        const t = tgtCell ? cellToNode.get(tgtCell.id) : undefined;
        if (s && t) {
          edges.push({ id: `e${++e}`, source: s, target: t, data: { ...this.edgeData.get(cell.id)! } });
        }
      }
    }
    op.nodes = nodes;
    op.edges = edges;
  }

  private loadOperation(id: string): void {
    this.currentOpId = id;
    const op = this.operations.find((o) => o.id === id);
    this.currentOpName = op ? op.name : '';
    this.nodeData.clear();
    this.edgeData.clear();
    this.selectedCellId = null;
    this.selectedNode = null;
    this.selectedEdge = null;

    const graph = this.graph;
    const model = graph.getModel();
    this.loading = true;  // suppress publish while rebuilding the canvas
    model.beginUpdate();
    try {
      graph.removeCells(graph.getChildCells(graph.getDefaultParent(), true, true));
      if (op) {
        const root = graph.getDefaultParent();
        const nodeIdToCell = new Map<string, any>();
        for (const node of op.nodes) {
          const cell = graph.insertVertex(root, null, '', node.x, node.y, node.w, node.h, this.styleFor(node.data));
          this.nodeData.set(cell.id, { ...node.data });
          model.setValue(cell, this.nodeLabel(node.data));
          nodeIdToCell.set(node.id, cell);
        }
        for (const edge of op.edges) {
          const s = nodeIdToCell.get(edge.source);
          const t = nodeIdToCell.get(edge.target);
          if (s && t) {
            const cell = graph.insertEdge(root, null, this.edgeLabel(edge.data), s, t, this.edgeStyleFor(edge.data));
            this.edgeData.set(cell.id, { ...edge.data });
          }
        }
      }
    } finally {
      model.endUpdate();
      this.loading = false;
    }
  }

  // --------------------------------------------------------------------------
  // Palette / toolbar
  // --------------------------------------------------------------------------

  addNode(item: OpPaletteItem): void {
    if (!this.graph) {
      return;
    }
    const offset = (this.clickInsertCount++ % 6) * 26;
    this.insertNode(item, 40 + offset, 40 + offset);
  }

  private insertNode(item: OpPaletteItem, x: number, y: number): void {
    if (!this.currentOpId) {
      this.addOperation();
    }
    const graph = this.graph;
    const data = this.defaultNodeData(item.kind);
    graph.getModel().beginUpdate();
    try {
      const vertex = graph.insertVertex(graph.getDefaultParent(), null, '', x, y, item.width, item.height, this.styleFor(data));
      this.nodeData.set(vertex.id, data);
      graph.getModel().setValue(vertex, this.nodeLabel(data));
      graph.setSelectionCell(vertex);
    } finally {
      graph.getModel().endUpdate();
    }
  }

  exportOperations(): void {
    if (!this.graph) {
      return;
    }
    this.downloadFile(this.buildOperationsXml(), 'model.operations', 'application/xml');
  }

  zoomIn(): void { this.graph?.zoomIn(); }
  zoomOut(): void { this.graph?.zoomOut(); }
  fit(): void { this.graph?.fit(); }

  deleteSelected(): void {
    if (this.graph && !this.graph.isSelectionEmpty()) {
      this.graph.removeCells();
    }
  }

  /** Clears every pattern node/edge of the current operation. */
  clearGraph(): void {
    if (!this.graph || !confirm('Remove every pattern node from this operation?')) {
      return;
    }
    const graph = this.graph;
    graph.getModel().beginUpdate();
    try {
      graph.removeCells(graph.getChildCells(graph.getDefaultParent(), true, true));
    } finally {
      graph.getModel().endUpdate();
    }
  }

  // --------------------------------------------------------------------------
  // Configuration panel
  // --------------------------------------------------------------------------

  private defaultNodeData(kind: PatternNodeKind): PatternNodeData {
    return {
      kind,
      role: 'preserve',
      match: kind === 'element' ? 'ViewComponent' : 'any',
      selectorKind: 'none',
      selector: '',
      condProps: {},
      setVisible: '',
      setProps: {},
    };
  }

  // --- style-property catalog for the RHS assignment panel ---

  readonly styleProperties: StylePropDef[] = STYLE_PROPERTIES;
  readonly styleGroups: string[] = STYLE_PROPERTIES.reduce<string[]>((groups, def) => {
    if (groups.indexOf(def.group) < 0) {
      groups.push(def.group);
    }
    return groups;
  }, []);

  propsInGroup(group: string): StylePropDef[] {
    return this.styleProperties.filter((p) => p.group === group);
  }

  /** Whether a property is a LHS match condition ('match', in condProps) or an RHS assignment ('set'). */
  nodePropMode(def: StylePropDef): 'set' | 'match' {
    return this.selectedNode && this.selectedNode.condProps && this.selectedNode.condProps[def.key] !== undefined ? 'match' : 'set';
  }

  /** Switches a property between an RHS assignment and a LHS match condition. */
  setNodePropMode(def: StylePropDef, mode: 'set' | 'match'): void {
    const n = this.selectedNode;
    if (!n) {
      return;
    }
    if (!n.condProps) { n.condProps = {}; }
    const current = n.condProps[def.key] !== undefined ? n.condProps[def.key] : (n.setProps[def.key] ?? '');
    delete n.condProps[def.key];
    delete n.setProps[def.key];
    if (mode === 'match') {
      n.condProps[def.key] = current;
    } else if (current !== '') {
      n.setProps[def.key] = current;
    }
    this.onNodeChange();
  }

  /** The raw value of a property on the selected node, from whichever map holds it. */
  rawNodeProp(def: StylePropDef): string {
    const n = this.selectedNode;
    if (!n) {
      return '';
    }
    return ((n.condProps && n.condProps[def.key] !== undefined) ? n.condProps[def.key] : n.setProps[def.key]) ?? '';
  }

  /** Colour-picker value — defaults to white when unset. */
  propNodeValue(def: StylePropDef): string {
    const v = this.rawNodeProp(def);
    return v === '' && def.input === 'color' ? '#ffffff' : v;
  }

  /** Sets (or clears) a property value on the selected node, into its current (set/match) map. */
  setNodeProp(def: StylePropDef, value: string): void {
    const n = this.selectedNode;
    if (!n) {
      return;
    }
    if (!n.condProps) { n.condProps = {}; }
    const map = n.condProps[def.key] !== undefined ? n.condProps : n.setProps;
    if (value === '' || value == null) {
      delete map[def.key];
    } else {
      map[def.key] = value;
    }
    this.onNodeChange();
  }

  get selectorOptions(): string[] {
    if (!this.selectedNode) {
      return [];
    }
    return this.selectedNode.selectorKind === 'id'
      ? this.ifmlElements.map((el) => el.name)
      : this.adaptationClasses.map((c) => c.name);
  }

  get showAssignments(): boolean {
    return !!this.selectedNode && this.selectedNode.role !== 'delete' && this.selectedNode.role !== 'forbid';
  }

  onNodeSelectorKindChange(): void {
    if (this.selectedNode) {
      this.selectedNode.selector = '';
    }
    this.refreshSelectedNode();
  }

  onNodeChange(): void {
    this.refreshSelectedNode();
  }

  onEdgeChange(): void {
    this.refreshSelectedEdge();
  }

  private refreshSelectedNode(): void {
    if (!this.selectedCellId || !this.selectedNode) {
      return;
    }
    const cell = this.graph.getModel().getCell(this.selectedCellId);
    if (cell) {
      this.graph.getModel().setStyle(cell, this.styleFor(this.selectedNode));
      this.graph.getModel().setValue(cell, this.nodeLabel(this.selectedNode));
    }
  }

  private refreshSelectedEdge(): void {
    if (!this.selectedCellId || !this.selectedEdge) {
      return;
    }
    const cell = this.graph.getModel().getCell(this.selectedCellId);
    if (cell) {
      this.graph.getModel().setStyle(cell, this.edgeStyleFor(this.selectedEdge));
      this.graph.getModel().setValue(cell, this.edgeLabel(this.selectedEdge));
    }
  }

  private onSelectionChanged(): void {
    const cell = this.graph.getSelectionCell();
    const model = this.graph.getModel();
    if (cell && model.isVertex(cell) && this.nodeData.has(cell.id)) {
      this.selectedCellId = cell.id;
      this.selectedNode = this.nodeData.get(cell.id)!;
      this.selectedEdge = null;
    } else if (cell && model.isEdge(cell) && this.edgeData.has(cell.id)) {
      this.selectedCellId = cell.id;
      this.selectedEdge = this.edgeData.get(cell.id)!;
      this.selectedNode = null;
    } else {
      this.selectedCellId = null;
      this.selectedNode = null;
      this.selectedEdge = null;
    }
  }

  // --------------------------------------------------------------------------
  // Styling & labels
  // --------------------------------------------------------------------------

  private styleFor(data: PatternNodeData): string {
    const c = ROLE_COLORS[data.role] || ROLE_COLORS['preserve'];
    const rounded = data.kind === 'style' ? 'rounded=1;' : 'rounded=0;';
    const dashed = data.role === 'delete' || data.role === 'forbid' ? 'dashed=1;' : '';
    return `shape=rectangle;${rounded}${dashed}fillColor=${c.fill};strokeColor=${c.stroke};strokeWidth=1.5;fontColor=#263238;fontSize=11;whiteSpace=wrap;`;
  }

  private edgeStyleFor(data: PatternEdgeData): string {
    const c = ROLE_COLORS[data.role] || ROLE_COLORS['preserve'];
    const dashed = data.role === 'delete' || data.role === 'forbid' ? 'dashed=1;' : '';
    return `endArrow=classic;rounded=1;strokeColor=${c.stroke};${dashed}fontColor=#455a64;fontSize=10;labelBackgroundColor=#ffffff;`;
  }

  private nodeLabel(data: PatternNodeData): string {
    const head = data.kind === 'style' ? 'Style' : (data.match === 'any' ? 'Element' : data.match);
    let sel = '';
    if (data.selectorKind === 'class' && data.selector) {
      sel = ` .${data.selector}`;
    } else if (data.selectorKind === 'id' && data.selector) {
      sel = ` #${data.selector}`;
    }
    const condCount = Object.keys(data.condProps || {}).filter((k) => data.condProps[k] !== '').length;
    const condStr = condCount ? `\nif ${condCount} attr${condCount === 1 ? '' : 's'}` : '';
    const sets: string[] = [];
    if (data.role !== 'delete' && data.role !== 'forbid') {
      if (data.setVisible) { sets.push(`visible=${data.setVisible}`); }
      const count = Object.keys(data.setProps || {}).filter((k) => data.setProps[k] !== '').length;
      if (count) { sets.push(`set ${count} prop${count === 1 ? '' : 's'}`); }
    }
    const setStr = sets.length ? `\n${sets.join(', ')}` : '';
    return `«${data.role}» ${head}${sel}${condStr}${setStr}`;
  }

  private edgeLabel(data: PatternEdgeData): string {
    return `«${data.role}» ${data.relation}`;
  }

  // --------------------------------------------------------------------------
  // Export
  // --------------------------------------------------------------------------

  private buildOperationsXml(): string {
    this.saveCurrentOperation();
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<op:OperationModel xmlns:op="http://adaptui.org/operations/1.0" name="AdaptUI Operations">');
    for (const op of this.operations) {
      lines.push(`  <operation name="${this.esc(op.name)}">`);
      // LHS = preserve + delete + create-with-conditions; RHS = preserve + create; NAC = forbid.
      this.appendSide(lines, op, 'lhs', (n) => n.data.role === 'preserve' || n.data.role === 'delete' || (n.data.role === 'create' && this.hasConds(n.data)), (e) => e.data.role === 'preserve' || e.data.role === 'delete');
      this.appendSide(lines, op, 'rhs', (n) => n.data.role === 'preserve' || n.data.role === 'create', (e) => e.data.role === 'preserve' || e.data.role === 'create');
      const forbidIds = new Set(op.nodes.filter((n) => n.data.role === 'forbid').map((n) => n.id));
      const nacEdge = (e: OpEdge) => e.data.role === 'forbid' || forbidIds.has(e.source) || forbidIds.has(e.target);
      if (forbidIds.size > 0 || op.edges.some(nacEdge)) {
        this.appendSide(lines, op, 'nac', (n) => n.data.role === 'forbid', nacEdge);
      }
      lines.push('  </operation>');
    }
    lines.push('</op:OperationModel>');
    return lines.join('\n');
  }

  private appendSide(
    lines: string[], op: OperationModel, side: 'lhs' | 'rhs' | 'nac',
    keepNode: (n: OpNode) => boolean, keepEdge: (e: OpEdge) => boolean,
  ): void {
    lines.push(`    <${side}>`);
    for (const node of op.nodes.filter(keepNode)) {
      const attrs = this.nodeMatchAttrs(node);
      // LHS nodes carry attribute conditions; RHS nodes carry assignments.
      const children = side === 'rhs' ? this.nodeSets(node) : (side === 'lhs' ? this.nodeConds(node) : []);
      if (children.length === 0) {
        lines.push(`      <node ${attrs}/>`);
      } else {
        lines.push(`      <node ${attrs}>`);
        for (const c of children) {
          lines.push(`        ${c}`);
        }
        lines.push('      </node>');
      }
    }
    for (const edge of op.edges.filter(keepEdge)) {
      lines.push(`      <edge id="${edge.id}" source="${edge.source}" target="${edge.target}" relation="${this.esc(edge.data.relation)}"/>`);
    }
    lines.push(`    </${side}>`);
  }

  private nodeMatchAttrs(node: OpNode): string {
    const a = [`id="${node.id}"`, `kind="${node.data.kind}"`];
    if (node.data.kind === 'element' && node.data.match !== 'any') {
      a.push(`match="${node.data.match}"`);
    }
    if (node.data.selectorKind !== 'none' && node.data.selector) {
      a.push(`selector="${node.data.selectorKind}:${this.esc(node.data.selector)}"`);
    }
    return a.join(' ');
  }

  private nodeSets(node: OpNode): string[] {
    const out: string[] = [];
    const d = node.data;
    if (d.setVisible) { out.push(`<set property="visible" value="${d.setVisible}"/>`); }
    for (const def of STYLE_PROPERTIES) {
      const v = d.setProps?.[def.key];
      if (v !== undefined && v !== '') {
        out.push(`<set property="${def.key}" value="${this.esc(v)}"/>`);
      }
    }
    return out;
  }

  /** True if the node carries at least one attribute condition. */
  private hasConds(d: PatternNodeData): boolean {
    return !!d.condProps && Object.keys(d.condProps).some((k) => d.condProps[k] !== '');
  }

  private nodeConds(node: OpNode): string[] {
    const out: string[] = [];
    const d = node.data;
    for (const def of STYLE_PROPERTIES) {
      const v = d.condProps?.[def.key];
      if (v !== undefined && v !== '') {
        out.push(`<cond property="${def.key}" value="${this.esc(v)}"/>`);
      }
    }
    return out;
  }

  private esc(value: string): string {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
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
}
