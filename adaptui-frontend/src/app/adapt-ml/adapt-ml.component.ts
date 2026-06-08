import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { NgZone } from '@angular/core';
import { combineLatest, Subscription } from 'rxjs';

import {
  AdaptmlRule, AdaptNodeData, BoolExpr, ConditionConfig, ContextProperty, ENUM_OPERATORS, GateOp,
  NUMBER_OPERATORS, OPERATOR_XML, OperationConfig,
} from '../model/adaptation.model';
import { GraphSnapshot, GraphVertex } from '../model/project.model';
import { AdaptmlModelService } from '../services/adaptml-model.service';
import { CodeModelService } from '../services/code-model.service';
import { ContextModelService } from '../services/context-model.service';
import { OperationModelService } from '../services/operation-model.service';
import { ProjectService } from '../services/project.service';

// mxGraph is loaded as a global browser script (see angular.json -> scripts).
declare var mxGraph: any;
declare var mxUtils: any;
declare var mxRubberband: any;
declare var mxConstants: any;
declare var mxClient: any;
declare var mxGraphModel: any;
declare var mxEvent: any;
declare var mxKeyHandler: any;
declare var mxEdgeStyle: any;

interface AdaptPaletteItem {
  kind: 'condition' | 'operation' | 'gate';
  /** For gate items: the boolean operator. */
  op?: GateOp;
  label: string;
  icon: string;
  width: number;
  height: number;
  style: string;
}

/**
 * Graphical editor for the ADAPTML adaptation model. The user places
 * **Condition** nodes (expressed over context properties activated in
 * CONTEXTML) and **Operation** nodes (which reference an operation defined in
 * the Operations tab), and connects conditions to operations. Each operation
 * plus its incoming conditions forms an adaptation rule, exportable as XML.
 */
@Component({
  selector: 'app-adapt-ml',
  templateUrl: './adapt-ml.component.html',
  styleUrls: ['./adapt-ml.component.sass'],
})
export class AdaptMlComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('graphContainer')
  containerElementRef!: ElementRef;

  @ViewChildren('paletteButton', { read: ElementRef })
  paletteButtons!: QueryList<ElementRef>;

  paletteItems: AdaptPaletteItem[] = [
    { kind: 'condition', label: 'Condition', icon: 'rule', width: 180, height: 90, style: 'conditionStyle' },
    { kind: 'gate', op: 'and', label: 'AND gate', icon: 'join_inner', width: 90, height: 50, style: 'gateStyle' },
    { kind: 'gate', op: 'or', label: 'OR gate', icon: 'join_full', width: 90, height: 50, style: 'gateStyle' },
    { kind: 'operation', label: 'Operation', icon: 'bolt', width: 210, height: 72, style: 'operationStyle' },
  ];

  /** Per-cell node configuration, keyed by mxGraph cell id. */
  private nodeData = new Map<string, AdaptNodeData>();

  private graph: any;
  private clickInsertCount = 0;
  private subscriptions = new Subscription();

  // Live, cross-tab data driving the configuration panel.
  activatedContext: ContextProperty[] = [];
  operationNames: string[] = [];

  // Current selection for the configuration panel.
  selectedCellId: string | null = null;
  selectedData: AdaptNodeData | null = null;

  private loading = false;

  constructor(
    private zone: NgZone,
    private contextService: ContextModelService,
    private operationService: OperationModelService,
    private adaptmlService: AdaptmlModelService,
    private codeService: CodeModelService,
    private projectService: ProjectService,
  ) { }

  ngOnInit(): void {
    this.subscriptions.add(
      this.contextService.properties$.subscribe((props) => {
        this.activatedContext = props.filter((p) => p.activated);
      })
    );
    // Operations come from both the modelled (Operations tab) and code (Code tab) sources.
    this.subscriptions.add(
      combineLatest([this.operationService.names$, this.codeService.operationNames$]).subscribe(
        ([modelled, code]) => { this.operationNames = [...modelled, ...code]; }
      )
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get container() {
    return this.containerElementRef.nativeElement;
  }

  ngAfterViewInit(): void {
    if (typeof mxClient === 'undefined') {
      return; // not available in the unit-test harness
    }
    if (!mxClient.isBrowserSupported()) {
      mxUtils.error('Browser is not supported!', 200, false);
      return;
    }

    const model = new mxGraphModel();
    const graph = new mxGraph(this.container, model);
    this.graph = graph;

    this.configureGraph(graph);
    this.registerStyles(graph);
    this.registerDragSources(graph);

    this.projectService.register('adaptml', {
      capture: () => this.serialize(),
      restore: (s) => this.deserialize(s as GraphSnapshot),
      reset: () => this.resetGraph(),
    });

    // Seed the dark-mode adaptation rule (deferred to avoid NG0100).
    setTimeout(() => this.seedExample());
  }

  // --------------------------------------------------------------------------
  // Project save / load (condition/gate/operation cells + edges)
  // --------------------------------------------------------------------------

  private serialize(): GraphSnapshot {
    const model = this.graph.getModel();
    const all: any[] = model.getDescendants(this.graph.getDefaultParent());
    const vertices: GraphVertex[] = [];
    const edges = [];
    for (const cell of all) {
      if (model.isVertex(cell) && this.nodeData.has(cell.id)) {
        const g = cell.geometry || {};
        vertices.push({
          id: cell.id, x: g.x || 0, y: g.y || 0, w: g.width || 0, h: g.height || 0,
          style: cell.style || '', value: cell.value || '', data: this.nodeData.get(cell.id),
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
      this.nodeData.clear();
      const created = new Map<string, any>();
      for (const v of snapshot.vertices || []) {
        const data = v.data as AdaptNodeData;
        const cell = graph.insertVertex(root, null, '', v.x, v.y, v.w, v.h, v.style);
        this.nodeData.set(cell.id, data);
        model.setValue(cell, this.labelFor(data));
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
    this.selectedCellId = null;
    this.selectedData = null;
    this.publishRules();
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
      this.nodeData.clear();
    } finally {
      graph.getModel().endUpdate();
      this.loading = false;
    }
    this.selectedCellId = null;
    this.selectedData = null;
    this.publishRules();
  }

  /** Seeds an adaptation rule: when the hour is >= 20, apply the dark-mode operations. */
  private seedExample(): void {
    const graph = this.graph;
    if (!graph) {
      return;
    }
    const model = graph.getModel();
    const parent = graph.getDefaultParent();
    const add = (data: AdaptNodeData, style: string, x: number, y: number, w: number, h: number) => {
      const vertex = graph.insertVertex(parent, null, '', x, y, w, h, style);
      this.nodeData.set(vertex.id, data);
      model.setValue(vertex, this.labelFor(data));
      return vertex;
    };
    model.beginUpdate();
    try {
      // Daytime: a CODE operation (defined in the Code tab) stripes the post cards.
      const condDay = add({ kind: 'condition', condition: { propertyKey: 'time', operator: '<', value: '20' } }, 'conditionStyle', 40, 40, 190, 90);
      const zebra = add({ kind: 'operation', operation: { operationName: 'zebra' } }, 'operationStyle', 330, 50, 210, 72);
      graph.insertEdge(parent, null, '', condDay, zebra);

      // Evening: modelled (graph) operations switch the app to a dark theme.
      const condNight = add({ kind: 'condition', condition: { propertyKey: 'time', operator: '>=', value: '20' } }, 'conditionStyle', 40, 200, 190, 90);
      const op1 = add({ kind: 'operation', operation: { operationName: 'Dark surfaces' } }, 'operationStyle', 330, 170, 210, 72);
      const op2 = add({ kind: 'operation', operation: { operationName: 'Dark text' } }, 'operationStyle', 330, 270, 210, 72);
      graph.insertEdge(parent, null, '', condNight, op1);
      graph.insertEdge(parent, null, '', condNight, op2);
    } finally {
      model.endUpdate();
    }
    this.publishRules();
  }

  // --------------------------------------------------------------------------
  // Graph setup
  // --------------------------------------------------------------------------

  private configureGraph(graph: any): void {
    graph.setConnectable(true);
    graph.setMultigraph(false);
    graph.setAllowDanglingEdges(false);
    graph.setCellsResizable(true);
    graph.setPanning(true);
    graph.setConnectableEdges(false);

    // eslint-disable-next-line no-new
    new mxRubberband(graph);
    const keyHandler = new mxKeyHandler(graph);
    keyHandler.bindKey(46, () => this.deleteSelected());
    keyHandler.bindKey(8, () => this.deleteSelected());

    // Flows go condition/gate -> gate/operation (logic flows into the operation).
    const self = this;
    graph.isValidSource = (cell: any) => {
      const k = self.kindOf(cell);
      return cell != null && (k === 'condition' || k === 'gate');
    };
    graph.isValidTarget = (cell: any) => {
      const k = self.kindOf(cell);
      return cell != null && (k === 'gate' || k === 'operation');
    };

    // Keep the config panel in sync with the canvas selection.
    graph.getSelectionModel().addListener(mxEvent.CHANGE, () => {
      this.zone.run(() => this.onSelectionChanged());
    });
    // Publish the rules to the Preview whenever the model changes.
    graph.getModel().addListener(mxEvent.CHANGE, () => {
      if (!this.loading) {
        this.zone.run(() => this.publishRules());
      }
    });
  }

  private registerStyles(graph: any): void {
    const stylesheet = graph.getStylesheet();

    const conditionStyle: any = {};
    conditionStyle[mxConstants.STYLE_SHAPE] = mxConstants.SHAPE_RHOMBUS;
    conditionStyle[mxConstants.STYLE_FILLCOLOR] = '#e3f2fd';
    conditionStyle[mxConstants.STYLE_STROKECOLOR] = '#1976d2';
    conditionStyle[mxConstants.STYLE_FONTCOLOR] = '#0d47a1';
    conditionStyle[mxConstants.STYLE_STROKEWIDTH] = 1.5;
    conditionStyle[mxConstants.STYLE_FONTSIZE] = 12;
    conditionStyle[mxConstants.STYLE_WHITE_SPACE] = 'wrap';

    const operationStyle: any = {};
    operationStyle[mxConstants.STYLE_SHAPE] = mxConstants.SHAPE_RECTANGLE;
    operationStyle[mxConstants.STYLE_ROUNDED] = true;
    operationStyle[mxConstants.STYLE_FILLCOLOR] = '#e8f5e9';
    operationStyle[mxConstants.STYLE_STROKECOLOR] = '#388e3c';
    operationStyle[mxConstants.STYLE_FONTCOLOR] = '#1b5e20';
    operationStyle[mxConstants.STYLE_STROKEWIDTH] = 1.5;
    operationStyle[mxConstants.STYLE_FONTSIZE] = 12;
    operationStyle[mxConstants.STYLE_WHITE_SPACE] = 'wrap';

    const gateStyle: any = {};
    gateStyle[mxConstants.STYLE_SHAPE] = mxConstants.SHAPE_HEXAGON;
    gateStyle[mxConstants.STYLE_FILLCOLOR] = '#fff3e0';
    gateStyle[mxConstants.STYLE_STROKECOLOR] = '#ef6c00';
    gateStyle[mxConstants.STYLE_FONTCOLOR] = '#e65100';
    gateStyle[mxConstants.STYLE_STROKEWIDTH] = 1.5;
    gateStyle[mxConstants.STYLE_FONTSIZE] = 12;
    gateStyle[mxConstants.STYLE_FONTSTYLE] = mxConstants.FONT_BOLD;

    stylesheet.putCellStyle('conditionStyle', conditionStyle);
    stylesheet.putCellStyle('operationStyle', operationStyle);
    stylesheet.putCellStyle('gateStyle', gateStyle);

    const edge = stylesheet.getDefaultEdgeStyle();
    edge[mxConstants.STYLE_EDGE] = mxEdgeStyle.OrthConnector;
    edge[mxConstants.STYLE_ROUNDED] = true;
    edge[mxConstants.STYLE_ENDARROW] = mxConstants.ARROW_CLASSIC;
    edge[mxConstants.STYLE_STROKECOLOR] = '#777777';
    edge[mxConstants.STYLE_STROKEWIDTH] = 2;
    edge[mxConstants.STYLE_FONTCOLOR] = '#555555';
    edge[mxConstants.STYLE_LABEL_BACKGROUNDCOLOR] = '#ffffff';
  }

  private registerDragSources(graph: any): void {
    this.paletteButtons.toArray().forEach((btnRef, index) => {
      const item = this.paletteItems[index];
      if (!item) {
        return;
      }
      mxUtils.makeDraggable(btnRef.nativeElement, graph, (_g: any, _evt: any, _cell: any, x: number, y: number) => {
        this.insertNode(item, x, y);
      });
    });
  }

  // --------------------------------------------------------------------------
  // Palette / toolbar actions
  // --------------------------------------------------------------------------

  addNode(item: AdaptPaletteItem): void {
    if (!this.graph) {
      return;
    }
    const offset = (this.clickInsertCount++ % 6) * 26;
    this.insertNode(item, 40 + offset, 40 + offset);
  }

  private insertNode(item: AdaptPaletteItem, x: number, y: number): void {
    const graph = this.graph;
    const model = graph.getModel();
    let data: AdaptNodeData;
    if (item.kind === 'condition') {
      data = { kind: 'condition', condition: this.defaultCondition() };
    } else if (item.kind === 'gate') {
      data = { kind: 'gate', gate: { op: item.op ?? 'and' } };
    } else {
      data = { kind: 'operation', operation: this.defaultOperation() };
    }

    model.beginUpdate();
    try {
      const vertex = graph.insertVertex(graph.getDefaultParent(), null, '', x, y, item.width, item.height, item.style);
      this.nodeData.set(vertex.id, data);
      model.setValue(vertex, this.labelFor(data));
      graph.setSelectionCell(vertex);
    } finally {
      model.endUpdate();
    }
  }

  exportAdaptml(): void {
    if (!this.graph) {
      return;
    }
    const xml = this.buildAdaptmlXml();
    this.downloadFile(xml, 'model.adaptml', 'application/xml');
  }

  zoomIn(): void { this.graph?.zoomIn(); }
  zoomOut(): void { this.graph?.zoomOut(); }
  fit(): void { this.graph?.fit(); }
  resetView(): void {
    if (this.graph) {
      this.graph.zoomActual();
      this.graph.view.setTranslate(0, 0);
    }
  }

  deleteSelected(): void {
    if (this.graph && !this.graph.isSelectionEmpty()) {
      this.graph.removeCells();
    }
  }

  clearAll(): void {
    if (!this.graph || !confirm('Remove every node from the adaptation model?')) {
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
  // Defaults
  // --------------------------------------------------------------------------

  private defaultCondition(): ConditionConfig {
    const prop = this.activatedContext[0];
    return {
      propertyKey: prop ? prop.key : '',
      operator: prop ? this.operatorsForProp(prop)[0] : '>',
      value: prop && prop.type === 'enum' ? (prop.values?.[0] ?? '') : '',
    };
  }

  private defaultOperation(): OperationConfig {
    return { operationName: this.operationNames[0] ?? '' };
  }

  // --------------------------------------------------------------------------
  // Configuration panel — option providers (bound from the template)
  // --------------------------------------------------------------------------

  operatorsForProp(prop: ContextProperty | undefined): string[] {
    return prop && prop.type === 'enum' ? ENUM_OPERATORS : NUMBER_OPERATORS;
  }

  contextProp(key: string): ContextProperty | undefined {
    return this.activatedContext.find((p) => p.key === key);
  }

  get conditionOperators(): string[] {
    const c = this.selectedData?.condition;
    return this.operatorsForProp(c ? this.contextProp(c.propertyKey) : undefined);
  }

  get conditionIsEnum(): boolean {
    const c = this.selectedData?.condition;
    return !!c && this.contextProp(c.propertyKey)?.type === 'enum';
  }

  get conditionEnumValues(): string[] {
    const c = this.selectedData?.condition;
    return (c && this.contextProp(c.propertyKey)?.values) || [];
  }

  // --------------------------------------------------------------------------
  // Configuration panel — change handlers
  // --------------------------------------------------------------------------

  onConditionPropertyChange(): void {
    const c = this.selectedData?.condition;
    if (!c) {
      return;
    }
    const prop = this.contextProp(c.propertyKey);
    const ops = this.operatorsForProp(prop);
    if (!ops.includes(c.operator)) {
      c.operator = ops[0];
    }
    c.value = prop && prop.type === 'enum' ? (prop.values?.[0] ?? '') : '';
    this.refreshSelectedLabel();
  }

  /** Generic "config changed, just update the label" handler. */
  onConfigChange(): void {
    this.refreshSelectedLabel();
  }

  private refreshSelectedLabel(): void {
    if (!this.selectedCellId || !this.selectedData) {
      return;
    }
    const cell = this.graph.getModel().getCell(this.selectedCellId);
    if (cell) {
      this.graph.getModel().setValue(cell, this.labelFor(this.selectedData));
    }
  }

  private onSelectionChanged(): void {
    const cell = this.graph.getSelectionCell();
    const data = cell ? this.nodeData.get(cell.id) : null;
    if (cell && data) {
      this.selectedCellId = cell.id;
      this.selectedData = data;
    } else {
      this.selectedCellId = null;
      this.selectedData = null;
    }
  }

  // --------------------------------------------------------------------------
  // Labels
  // --------------------------------------------------------------------------

  private kindOf(cell: any): string | undefined {
    return cell ? this.nodeData.get(cell.id)?.kind : undefined;
  }

  private contextLabel(key: string): string {
    return this.contextService.getProperty(key)?.label ?? key;
  }

  private labelFor(data: AdaptNodeData): string {
    if (data.kind === 'condition' && data.condition) {
      const c = data.condition;
      if (!c.propertyKey) {
        return 'unconfigured condition';
      }
      return `${this.contextLabel(c.propertyKey)} ${c.operator} ${c.value === '' ? '?' : c.value}`;
    }
    if (data.kind === 'operation' && data.operation) {
      return `apply: ${data.operation.operationName || '?'}`;
    }
    if (data.kind === 'gate' && data.gate) {
      return `«${data.gate.op.toUpperCase()}»`;
    }
    return data.kind;
  }

  /** Switches the selected gate between AND and OR (panel). */
  onGateChange(): void {
    this.refreshSelectedLabel();
  }

  // --------------------------------------------------------------------------
  // ADAPTML XML export
  // --------------------------------------------------------------------------

  /** Collects the adaptation rules (condition expression + operation) from the canvas. */
  private gatherRules(): AdaptmlRule[] {
    if (!this.graph) {
      return [];
    }
    const model = this.graph.getModel();
    const all: any[] = model.getDescendants(this.graph.getDefaultParent());
    const rules: AdaptmlRule[] = [];
    for (const cell of all) {
      if (!model.isVertex(cell) || this.kindOf(cell) !== 'operation') {
        continue;
      }
      const opData = this.nodeData.get(cell.id);
      if (!opData?.operation) {
        continue;
      }
      const expr = this.buildExpr(cell, 'and', new Set<string>());
      rules.push({ expr, operationName: opData.operation.operationName });
    }
    return rules;
  }

  /**
   * Builds the boolean expression feeding a target node (operation or gate) from
   * its incoming condition/gate nodes. Multiple inputs to an operation are AND-ed.
   */
  private buildExpr(cell: any, op: GateOp, visited: Set<string>): BoolExpr | null {
    if (visited.has(cell.id)) {
      return null; // guard against cycles
    }
    visited.add(cell.id);
    const model = this.graph.getModel();
    const incoming: any[] = this.graph.getIncomingEdges(cell) || [];
    const children: BoolExpr[] = [];
    for (const edge of incoming) {
      const src = model.getTerminal(edge, true);
      const sd = src ? this.nodeData.get(src.id) : null;
      if (!sd) {
        continue;
      }
      if (sd.kind === 'condition' && sd.condition && sd.condition.propertyKey) {
        children.push({ type: 'condition', condition: sd.condition });
      } else if (sd.kind === 'gate' && sd.gate) {
        const sub = this.buildExpr(src, sd.gate.op, visited);
        if (sub) {
          children.push(sub);
        }
      }
    }
    visited.delete(cell.id);
    if (children.length === 0) {
      return null;
    }
    if (children.length === 1) {
      return children[0];
    }
    return { type: 'gate', op, children };
  }

  /** Publishes the rules so the Preview can evaluate and apply them. */
  private publishRules(): void {
    this.adaptmlService.setRules(this.gatherRules());
  }

  private exprToXml(expr: BoolExpr, indent: string): string[] {
    if (expr.type === 'condition') {
      const c = expr.condition;
      return [`${indent}<condition property="${this.esc(c.propertyKey)}" operator="${OPERATOR_XML[c.operator] || this.esc(c.operator)}" value="${this.esc(c.value)}"/>`];
    }
    const lines = [`${indent}<${expr.op}>`];
    for (const ch of expr.children) {
      lines.push(...this.exprToXml(ch, indent + '  '));
    }
    lines.push(`${indent}</${expr.op}>`);
    return lines;
  }

  private buildAdaptmlXml(): string {
    const rules = this.gatherRules();
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<adaptml:AdaptationModel xmlns:adaptml="http://adaptui.org/adaptml/1.0" name="AdaptUI Adaptation Model">');
    rules.forEach((rule, idx) => {
      lines.push(`  <adaptationRule id="rule_${idx + 1}">`);
      lines.push('    <when>');
      if (rule.expr) {
        lines.push(...this.exprToXml(rule.expr, '      '));
      }
      lines.push('    </when>');
      lines.push('    <then>');
      lines.push(`      <operation ref="${this.esc(rule.operationName)}"/>`);
      lines.push('    </then>');
      lines.push('  </adaptationRule>');
    });
    lines.push('</adaptml:AdaptationModel>');
    return lines.join('\n');
  }

  private esc(value: string): string {
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
}
