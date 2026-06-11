import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { Subscription } from 'rxjs';

import { AdaptationClass, IfmlElementRef } from '../model/adaptation.model';
import { GraphSnapshot, GraphVertex } from '../model/project.model';
import {
  CONTROL_TYPES, ControlType, STYLE_PROPERTIES, StylePropDef, StyleRuleData, StyleSelectorKind,
} from '../model/transformation.model';
import { AdaptationClassService } from '../services/adaptation-class.service';
import { IfmlModelService } from '../services/ifml-model.service';
import { ProjectService } from '../services/project.service';
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
  standalone: false,
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

  private loading = false;

  constructor(
    private zone: NgZone,
    private ifmlService: IfmlModelService,
    private classService: AdaptationClassService,
    private styleService: StyleModelService,
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
      if (!this.loading) {
        this.zone.run(() => this.publishRules());
      }
    });

    this.paletteButtons.toArray().forEach((btnRef) => {
      mxUtils.makeDraggable(btnRef.nativeElement, graph, (_g: any, _e: any, _c: any, x: number, y: number) => this.insertRule(x, y));
    });

    this.seedRules(graph);
    this.publishRules();

    this.projectService.register('style', {
      capture: () => this.serialize(),
      restore: (s) => this.deserialize(s as GraphSnapshot),
      reset: () => this.resetGraph(),
    });
  }

  // --------------------------------------------------------------------------
  // Project save / load (rule cells + their StyleRuleData)
  // --------------------------------------------------------------------------

  private serialize(): GraphSnapshot {
    const model = this.graph.getModel();
    const all: any[] = model.getDescendants(this.graph.getDefaultParent());
    const vertices: GraphVertex[] = [];
    for (const cell of all) {
      const data = model.isVertex(cell) ? this.nodeData.get(cell.id) : null;
      if (data) {
        const g = cell.geometry || {};
        vertices.push({
          id: cell.id, x: g.x || 0, y: g.y || 0, w: g.width || 0, h: g.height || 0,
          style: cell.style || 'styleRuleStyle', value: '', data: { ...data, props: { ...data.props } },
        });
      }
    }
    return { vertices, edges: [] };
  }

  private deserialize(snapshot: GraphSnapshot): void {
    const graph = this.graph;
    if (!graph || !snapshot) {
      return;
    }
    const model = graph.getModel();
    this.loading = true;
    model.beginUpdate();
    try {
      graph.removeCells(graph.getChildCells(graph.getDefaultParent(), true, true));
      this.nodeData.clear();
      for (const v of snapshot.vertices || []) {
        const data = v.data as StyleRuleData;
        const cell = graph.insertVertex(graph.getDefaultParent(), null, '', v.x, v.y, v.w, v.h, v.style || 'styleRuleStyle');
        this.nodeData.set(cell.id, { ...data, props: { ...(data.props || {}) } });
        model.setValue(cell, this.labelFor(this.nodeData.get(cell.id) as StyleRuleData));
        this.applyColor(cell, this.nodeData.get(cell.id) as StyleRuleData);
      }
    } finally {
      model.endUpdate();
      this.loading = false;
    }
    this.selectedRule = null;
    this.selectedCellId = null;
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
    this.selectedRule = null;
    this.selectedCellId = null;
    this.publishRules();
  }

  /** Seeds the Style rules concretizing the Social Media example (Login + News Feed). */
  private seedRules(graph: any): void {
    const INDIGO = 'linear-gradient(135deg, #6366f1, #8b5cf6)';
    const SKY = 'linear-gradient(135deg, #0ea5e9, #22d3ee)';
    const SOFT = '0 4px 12px rgba(15, 23, 42, .12)';
    const LARGE = '0 16px 40px rgba(15, 23, 42, .22)';
    const defs: Array<{ sel: string; control: ControlType; props: Record<string, string> }> = [
      { sel: 'authView', control: '', props: { backgroundImage: INDIGO, padding: '40', minHeight: '440', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16' } },
      { sel: 'card', control: '', props: { backgroundColor: '#ffffff', borderRadius: '16', padding: '24', boxShadow: LARGE, width: '320', display: 'flex', flexDirection: 'column', gap: '14' } },
      { sel: 'heading', control: '', props: { fontSize: '20', fontWeight: '700', color: '#0f172a', textAlign: 'center' } },
      { sel: 'field', control: 'inputField', props: {} },
      { sel: 'primaryBtn', control: 'button', props: { backgroundImage: SKY, color: '#ffffff', borderRadius: '10', padding: '12', fontWeight: '600' } },
      { sel: 'appView', control: '', props: { backgroundColor: '#f1f5f9', padding: '20', minHeight: '480', display: 'flex', flexDirection: 'column', gap: '16' } },
      { sel: 'menubar', control: '', props: { backgroundColor: '#ffffff', borderRadius: '12', padding: '12', boxShadow: SOFT, display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: '12' } },
      { sel: 'brand', control: '', props: { fontSize: '18', fontWeight: '800', color: '#6366f1' } },
      { sel: 'navlink', control: 'button', props: { backgroundColor: '#eef2ff', color: '#4338ca', borderRadius: '8', padding: '8', fontWeight: '600' } },
      { sel: 'feedgrid', control: '', props: { display: 'grid', gridColumns: '1fr 1fr', gap: '16' } },
      { sel: 'post', control: '', props: { backgroundColor: '#ffffff', borderRadius: '14', padding: '16', boxShadow: SOFT, borderStyle: 'solid', borderWidth: '1', borderColor: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: '8' } },
      { sel: 'author', control: '', props: { fontWeight: '700', color: '#0f172a' } },
      { sel: 'postbody', control: '', props: { color: '#475569', fontSize: '14', lineHeight: '1.5' } },
    ];
    const parent = graph.getDefaultParent();
    const model = graph.getModel();
    model.beginUpdate();
    try {
      let y = 20;
      for (const d of defs) {
        const data: StyleRuleData = { selectorKind: 'class', selector: d.sel, control: d.control, props: d.props };
        const vertex = graph.insertVertex(parent, null, '', 20, y, 220, 70, 'styleRuleStyle');
        this.nodeData.set(vertex.id, data);
        model.setValue(vertex, this.labelFor(data));
        this.applyColor(vertex, data);
        y += 86;
      }
    } finally {
      model.endUpdate();
    }
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
        rules.push({ ...rule, props: { ...rule.props } });
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
    // Seed a clean "card" so a new rule immediately shows a modern look.
    const data: StyleRuleData = {
      selectorKind: 'class', selector: '', control: '',
      props: { backgroundColor: '#ffffff', borderRadius: '12', padding: '14', boxShadow: '0 4px 12px rgba(15, 23, 42, .12)' },
    };
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

  // --- selector / control / style-property options for the panel ---

  readonly controlTypes: ControlType[] = CONTROL_TYPES;
  readonly styleProperties: StylePropDef[] = STYLE_PROPERTIES;
  /** Distinct property groups, in catalog order, for the panel sections. */
  readonly styleGroups: string[] = STYLE_PROPERTIES.reduce<string[]>((groups, def) => {
    if (groups.indexOf(def.group) < 0) {
      groups.push(def.group);
    }
    return groups;
  }, []);

  controlLabel(c: ControlType): string {
    return c === '' ? 'default' : c;
  }

  propsInGroup(group: string): StylePropDef[] {
    return this.styleProperties.filter((p) => p.group === group);
  }

  /** The raw stored value of a property ('' = unset). */
  rawValue(def: StylePropDef): string {
    return this.selectedRule?.props[def.key] ?? '';
  }

  /** Colour-picker value — defaults to white when unset so the swatch shows something. */
  propValue(def: StylePropDef): string {
    const v = this.rawValue(def);
    return v === '' && def.input === 'color' ? '#ffffff' : v;
  }

  /** Writes a property value (empty clears it) and refreshes the node + preview. */
  setProp(def: StylePropDef, value: string): void {
    if (!this.selectedRule) {
      return;
    }
    if (value === '' || value == null) {
      delete this.selectedRule.props[def.key];
    } else {
      this.selectedRule.props[def.key] = value;
    }
    this.refreshSelected();
  }

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
    const count = Object.keys(rule.props).filter((k) => rule.props[k] !== '').length;
    const parts = [`${count} ${count === 1 ? 'property' : 'properties'}`];
    if (rule.control) {
      parts.push(`control: ${rule.control}`);
    }
    return `${sel} {\n${parts.join('\n')}\n}`;
  }

  /** Reflects the chosen background colour on the node for a live preview. */
  private applyColor(cell: any, rule: StyleRuleData): void {
    const color = rule.props['backgroundColor'] || '#ffffff';
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
      for (const def of this.styleProperties) {
        const v = rule.props[def.key];
        if (v !== undefined && v !== '') {
          lines.push(`    <property name="${def.key}" value="${this.esc(v)}"/>`);
        }
      }
      if (rule.control) {
        lines.push(`    <property name="control" value="${this.esc(rule.control)}"/>`);
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
