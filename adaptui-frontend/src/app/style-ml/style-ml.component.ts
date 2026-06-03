import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { Subscription } from 'rxjs';

import { AdaptationClass, IfmlElementRef } from '../model/adaptation.model';
import { StyleRuleData, StyleSelectorKind } from '../model/transformation.model';
import { AdaptationClassService } from '../services/adaptation-class.service';
import { IfmlModelService } from '../services/ifml-model.service';
import { StyleModelService } from '../services/style-model.service';

declare var mxGraph: any;
declare var mxUtils: any;
declare var mxRubberband: any;
declare var mxConstants: any;
declare var mxClient: any;
declare var mxGraphModel: any;
declare var mxEvent: any;
declare var mxKeyHandler: any;

/**
 * Editor for the Style DSL — a minimalist concretization language for IFML.
 * Each node is a style rule that assigns concrete properties (currently a
 * background colour) to IFML elements selected by id or adaptation class.
 */
@Component({
  selector: 'app-style-ml',
  templateUrl: './style-ml.component.html',
  styleUrls: ['./style-ml.component.sass'],
})
export class StyleMlComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('graphContainer')
  containerElementRef!: ElementRef;

  @ViewChildren('paletteButton', { read: ElementRef })
  paletteButtons!: QueryList<ElementRef>;

  private graph: any;
  private clickInsertCount = 0;
  private nodeData = new Map<string, StyleRuleData>();
  private subscriptions = new Subscription();

  ifmlElements: IfmlElementRef[] = [];
  adaptationClasses: AdaptationClass[] = [];

  selectedCellId: string | null = null;
  selectedRule: StyleRuleData | null = null;

  constructor(
    private zone: NgZone,
    private ifmlService: IfmlModelService,
    private classService: AdaptationClassService,
    private styleService: StyleModelService,
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

    graph.setConnectable(false);
    graph.setCellsResizable(true);
    graph.setPanning(true);
    // eslint-disable-next-line no-new
    new mxRubberband(graph);
    const keyHandler = new mxKeyHandler(graph);
    keyHandler.bindKey(46, () => this.deleteSelected());
    keyHandler.bindKey(8, () => this.deleteSelected());

    const stylesheet = graph.getStylesheet();
    const styleRuleStyle: any = {};
    styleRuleStyle[mxConstants.STYLE_SHAPE] = mxConstants.SHAPE_RECTANGLE;
    styleRuleStyle[mxConstants.STYLE_ROUNDED] = true;
    styleRuleStyle[mxConstants.STYLE_FILLCOLOR] = '#ffffff';
    styleRuleStyle[mxConstants.STYLE_STROKECOLOR] = '#6a1b9a';
    styleRuleStyle[mxConstants.STYLE_STROKEWIDTH] = 1.5;
    styleRuleStyle[mxConstants.STYLE_FONTCOLOR] = '#4a148c';
    styleRuleStyle[mxConstants.STYLE_FONTSIZE] = 12;
    styleRuleStyle[mxConstants.STYLE_WHITE_SPACE] = 'wrap';
    stylesheet.putCellStyle('styleRuleStyle', styleRuleStyle);

    graph.getSelectionModel().addListener(mxEvent.CHANGE, () => {
      this.zone.run(() => this.onSelectionChanged());
    });
    graph.getModel().addListener(mxEvent.CHANGE, () => {
      this.zone.run(() => this.publishRules());
    });

    this.paletteButtons.toArray().forEach((btnRef) => {
      mxUtils.makeDraggable(btnRef.nativeElement, graph, (_g: any, _e: any, _c: any, x: number, y: number) => this.insertRule(x, y));
    });

    this.publishRules();
  }

  /** Publishes the current style rules for the Preview to concretize IFML. */
  private publishRules(): void {
    if (!this.graph) {
      return;
    }
    const model = this.graph.getModel();
    const all: any[] = model.getDescendants(this.graph.getDefaultParent());
    const rules: StyleRuleData[] = [];
    for (const cell of all) {
      const rule = model.isVertex(cell) ? this.nodeData.get(cell.id) : null;
      if (rule && rule.selector) {
        rules.push({ ...rule });
      }
    }
    this.styleService.setRules(rules);
  }

  // --- palette / toolbar ---

  addRule(): void {
    if (!this.graph) {
      return;
    }
    const offset = (this.clickInsertCount++ % 6) * 26;
    this.insertRule(40 + offset, 40 + offset);
  }

  private insertRule(x: number, y: number): void {
    const graph = this.graph;
    const data: StyleRuleData = { selectorKind: 'class', selector: '', backgroundColor: '#ffeb3b' };
    graph.getModel().beginUpdate();
    try {
      const vertex = graph.insertVertex(graph.getDefaultParent(), null, '', x, y, 220, 80, 'styleRuleStyle');
      this.nodeData.set(vertex.id, data);
      graph.getModel().setValue(vertex, this.labelFor(data));
      this.applyColor(vertex, data);
      graph.setSelectionCell(vertex);
    } finally {
      graph.getModel().endUpdate();
    }
  }

  exportStyle(): void {
    if (!this.graph) {
      return;
    }
    this.downloadFile(this.buildStyleXml(), 'model.style', 'application/xml');
  }

  zoomIn(): void { this.graph?.zoomIn(); }
  zoomOut(): void { this.graph?.zoomOut(); }
  fit(): void { this.graph?.fit(); }

  deleteSelected(): void {
    if (this.graph && !this.graph.isSelectionEmpty()) {
      this.graph.removeCells();
    }
  }

  clearAll(): void {
    if (!this.graph || !confirm('Remove every style rule?')) {
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

  // --- selector options for the panel ---

  get selectorOptions(): string[] {
    if (!this.selectedRule) {
      return [];
    }
    return this.selectedRule.selectorKind === 'id'
      ? this.ifmlElements.map((e) => e.name)
      : this.adaptationClasses.map((c) => c.name);
  }

  // --- panel change handlers ---

  onSelectorKindChange(): void {
    if (this.selectedRule) {
      this.selectedRule.selector = '';
    }
    this.refreshSelected();
  }

  onRuleChange(): void {
    this.refreshSelected();
  }

  private refreshSelected(): void {
    if (!this.selectedCellId || !this.selectedRule) {
      return;
    }
    const cell = this.graph.getModel().getCell(this.selectedCellId);
    if (cell) {
      this.graph.getModel().setValue(cell, this.labelFor(this.selectedRule));
      this.applyColor(cell, this.selectedRule);
    }
  }

  private onSelectionChanged(): void {
    const cell = this.graph.getSelectionCell();
    const data = cell ? this.nodeData.get(cell.id) : null;
    if (cell && data) {
      this.selectedCellId = cell.id;
      this.selectedRule = data;
    } else {
      this.selectedCellId = null;
      this.selectedRule = null;
    }
  }

  // --- labels & styling ---

  private labelFor(rule: StyleRuleData): string {
    const sel = (rule.selectorKind === 'id' ? '#' : '.') + (rule.selector || '?');
    return `${sel} {\nbackground: ${rule.backgroundColor || '—'}\n}`;
  }

  /** Reflects the chosen background colour on the node for a live preview. */
  private applyColor(cell: any, rule: StyleRuleData): void {
    const color = rule.backgroundColor || '#ffffff';
    this.graph.setCellStyles(mxConstants.STYLE_FILLCOLOR, color, [cell]);
  }

  // --- export ---

  private buildStyleXml(): string {
    const model = this.graph.getModel();
    const all: any[] = model.getDescendants(this.graph.getDefaultParent());
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<style:StyleModel xmlns:style="http://adaptui.org/style/1.0" name="AdaptUI Style Model">');
    for (const cell of all) {
      const rule = model.isVertex(cell) ? this.nodeData.get(cell.id) : null;
      if (!rule || !rule.selector) {
        continue;
      }
      const sel = rule.selectorKind === 'id'
        ? `targetId="${this.esc(rule.selector)}"`
        : `targetClass="${this.esc(rule.selector)}"`;
      lines.push(`  <style ${sel}>`);
      if (rule.backgroundColor) {
        lines.push(`    <property name="backgroundColor" value="${this.esc(rule.backgroundColor)}"/>`);
      }
      lines.push('  </style>');
    }
    lines.push('</style:StyleModel>');
    return lines.join('\n');
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
