import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { NgZone } from '@angular/core';
import { Subscription } from 'rxjs';

import {
  AdaptmlRule, AdaptNodeData, ConditionConfig, ContextProperty, ENUM_OPERATORS, NUMBER_OPERATORS,
  OPERATOR_XML, OperationConfig,
} from '../model/adaptation.model';
import { AdaptmlModelService } from '../services/adaptml-model.service';
import { ContextModelService } from '../services/context-model.service';
import { OperationModelService } from '../services/operation-model.service';

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
  kind: 'condition' | 'operation';
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

  constructor(
    private zone: NgZone,
    private contextService: ContextModelService,
    private operationService: OperationModelService,
    private adaptmlService: AdaptmlModelService,
  ) { }

  ngOnInit(): void {
    this.subscriptions.add(
      this.contextService.properties$.subscribe((props) => {
        this.activatedContext = props.filter((p) => p.activated);
      })
    );
    this.subscriptions.add(
      this.operationService.names$.subscribe((names) => { this.operationNames = names; })
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

    // A flow goes from a condition to an operation; nothing else is valid.
    const self = this;
    graph.isValidSource = (cell: any) => cell != null && self.kindOf(cell) === 'condition';
    graph.isValidTarget = (cell: any) => cell != null && self.kindOf(cell) === 'operation';

    // Keep the config panel in sync with the canvas selection.
    graph.getSelectionModel().addListener(mxEvent.CHANGE, () => {
      this.zone.run(() => this.onSelectionChanged());
    });
    // Publish the rules to the Preview whenever the model changes.
    graph.getModel().addListener(mxEvent.CHANGE, () => {
      this.zone.run(() => this.publishRules());
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

    stylesheet.putCellStyle('conditionStyle', conditionStyle);
    stylesheet.putCellStyle('operationStyle', operationStyle);

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
    const data: AdaptNodeData = item.kind === 'condition'
      ? { kind: 'condition', condition: this.defaultCondition() }
      : { kind: 'operation', operation: this.defaultOperation() };

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
    return data.kind;
  }

  // --------------------------------------------------------------------------
  // ADAPTML XML export
  // --------------------------------------------------------------------------

  /** Collects the adaptation rules (conditions + referenced operation) from the canvas. */
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
      const incoming: any[] = this.graph.getIncomingEdges(cell) || [];
      const conditions: ConditionConfig[] = [];
      for (const edge of incoming) {
        const src = model.getTerminal(edge, true);
        const sd = src ? this.nodeData.get(src.id) : null;
        if (sd?.kind === 'condition' && sd.condition && sd.condition.propertyKey) {
          conditions.push(sd.condition);
        }
      }
      rules.push({ conditions, operationName: opData.operation.operationName });
    }
    return rules;
  }

  /** Publishes the rules so the Preview can evaluate and apply them. */
  private publishRules(): void {
    this.adaptmlService.setRules(this.gatherRules());
  }

  private buildAdaptmlXml(): string {
    const rules = this.gatherRules();
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<adaptml:AdaptationModel xmlns:adaptml="http://adaptui.org/adaptml/1.0" name="AdaptUI Adaptation Model">');
    rules.forEach((rule, idx) => {
      lines.push(`  <adaptationRule id="rule_${idx + 1}">`);
      lines.push('    <when>');
      for (const c of rule.conditions) {
        lines.push(`      <condition property="${this.esc(c.propertyKey)}" operator="${OPERATOR_XML[c.operator] || this.esc(c.operator)}" value="${this.esc(c.value)}"/>`);
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
