import { Component, OnDestroy, OnInit } from '@angular/core';
import { combineLatest, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { AdaptmlRule, ContextProperty, IfmlElementRef } from '../model/adaptation.model';
import { IfmlFlow, lifecycleEventName, OperationModel, StyleRuleData } from '../model/transformation.model';
import { AdaptmlModelService } from '../services/adaptml-model.service';
import { CodeModelService } from '../services/code-model.service';
import { ContextModelService } from '../services/context-model.service';
import { IfmlModelService } from '../services/ifml-model.service';
import { OperationModelService } from '../services/operation-model.service';
import { StyleModelService } from '../services/style-model.service';
import { applyOverlay, buildCodeApi, buildHostGraph, buildRenderTree, CodeApi, CodeOperation, OverlayCommand, RenderNode, ruleFires, runAdaptation } from './adaptation-engine';

/**
 * Live preview of the adaptive UI. It renders the IFML model concretized by the
 * Style model as a page-style runtime: top-level containers are *views*, one of
 * which is active. The ADAPTML rules adapt a runtime copy of the IFML graph for
 * the current context (editable in the side menu), and triggering an event's
 * control (button / input / checkbox) reroutes navigation to the flow's target view.
 */
@Component({
  selector: 'app-preview',
  templateUrl: './preview.component.html',
  styleUrls: ['./preview.component.sass'],
})
export class PreviewComponent implements OnInit, OnDestroy {

  /** Top-level containers = views; one is shown at a time. */
  views: RenderNode[] = [];
  activeViewId: string | null = null;

  activatedContext: ContextProperty[] = [];
  ruleCount = 0;
  firedCount = 0;
  hasModel = false;

  /** Full-screen "app" mode (renders just the UI, no AdaptUI chrome). */
  fullscreen = false;
  /** Whether the in-app settings menu is open in full-screen mode. */
  fsMenuOpen = false;

  private subscriptions = new Subscription();
  private contextProps: ContextProperty[] = [];
  private styleRules: StyleRuleData[] = [];
  private eventHandlers = new Map<string, (api: CodeApi) => void>();

  /** Latest published inputs, kept so the view can be re-rendered on demand. */
  private snapshot: {
    elements: IfmlElementRef[]; flows: IfmlFlow[]; styles: StyleRuleData[];
    ops: OperationModel[]; rules: AdaptmlRule[]; ctx: ContextProperty[]; codeOps: CodeOperation[];
  } | null = null;

  /**
   * Persistent runtime overlay — the graph mutations made by event refinements,
   * re-applied on every render so they survive recomputes. Cleared by the Reset
   * button or a page reload (it lives only in memory).
   */
  private overlay: OverlayCommand[] = [];
  private overlayCounter = 0;
  /** Guards against lifecycle events re-firing each other / cascading. */
  private firingLifecycle = false;

  /** True while a runtime overlay is in effect (enables the Reset button). */
  hasRuntimeChanges = false;

  constructor(
    private ifmlService: IfmlModelService,
    private styleService: StyleModelService,
    private operationService: OperationModelService,
    private adaptmlService: AdaptmlModelService,
    private contextService: ContextModelService,
    private codeService: CodeModelService,
  ) { }

  ngOnInit(): void {
    this.subscriptions.add(
      combineLatest([
        this.ifmlService.elements$,
        this.ifmlService.flows$,
        this.styleService.rules$,
        this.operationService.models$,
        this.adaptmlService.rules$,
        this.contextService.properties$,
        this.codeService.operations$,
        // Coalesce synchronous bursts and recompute in a fresh change-detection
        // turn (avoids ExpressionChangedAfterChecked at load time).
      ]).pipe(debounceTime(0)).subscribe((vals) => {
        const [elements, flows, styles, ops, rules, ctx, codeOps] = vals as
          [IfmlElementRef[], IfmlFlow[], StyleRuleData[], OperationModel[], AdaptmlRule[], ContextProperty[], CodeOperation[]];
        this.snapshot = { elements, flows, styles, ops, rules, ctx, codeOps };
        this.render();
      })
    );
    this.subscriptions.add(
      this.codeService.eventHandlers$.subscribe((handlers) => { this.eventHandlers = handlers; })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get activeView(): RenderNode | null {
    return this.views.find((v) => v.id === this.activeViewId) ?? null;
  }

  setActiveView(id: string): void {
    this.setActive(id);
  }

  onContextValue(key: string, value: string): void {
    this.contextService.setValue(key, value);
    // A context change re-adapts the active view: fire its onChange lifecycle event.
    const active = this.views.find((v) => v.id === this.activeViewId);
    if (active) {
      this.fireLifecycle(active, 'onChange');
    }
  }

  /** Switches the active view, firing the leaving view's onTerminate and the new view's onLoad. */
  private setActive(id: string | null): void {
    if (id === this.activeViewId) {
      return;
    }
    const prev = this.views.find((v) => v.id === this.activeViewId);
    this.activeViewId = id;
    const next = this.views.find((v) => v.id === id);
    if (!this.firingLifecycle) {
      if (prev) { this.fireLifecycle(prev, 'onTerminate'); }
      if (next) { this.fireLifecycle(next, 'onLoad'); }
    }
  }

  /** Fires a ViewContainer lifecycle event (onLoad/onChange/onTerminate) if it has a refinement. */
  private fireLifecycle(view: RenderNode, kind: string): void {
    const name = lifecycleEventName(view.name, kind);
    if (this.firingLifecycle || !this.eventHandlers.has(name)) {
      return;
    }
    this.firingLifecycle = true;
    try {
      const { mutated } = this.runRefinement(name, view);
      if (mutated) {
        this.render();
      }
    } finally {
      this.firingLifecycle = false;
    }
  }

  /** The nearest ancestor ViewContainer of a node (its "self"). */
  private ownerContainer(target: RenderNode): RenderNode | undefined {
    let result: RenderNode | undefined;
    const walk = (node: RenderNode, ancestor: RenderNode | undefined): boolean => {
      const here = node.type === 'ViewContainer' ? node : ancestor;
      if (node === target) { result = here; return true; }
      for (const c of node.children) { if (walk(c, here)) { return true; } }
      return false;
    };
    for (const v of this.views) { if (walk(v, undefined)) { break; } }
    return result;
  }

  private flatten(): RenderNode[] {
    const flat: RenderNode[] = [];
    const collect = (n: RenderNode) => { flat.push(n); n.children.forEach(collect); };
    this.views.forEach(collect);
    return flat;
  }

  /** Runs an event/lifecycle refinement, recording its graph mutations into the overlay. */
  private runRefinement(name: string, self?: RenderNode): { blocked: boolean; mutated: boolean } {
    const handler = this.eventHandlers.get(name);
    let blocked = false;
    let mutated = false;
    if (!handler) {
      return { blocked, mutated };
    }
    const recorder = {
      nextRef: () => `ov_${++this.overlayCounter}`,
      record: (cmd: OverlayCommand) => { this.overlay.push(cmd); mutated = true; },
    };
    try {
      handler(buildCodeApi({ nodes: this.flatten(), edges: [] }, this.contextProps, {
        setContext: (k, v) => this.contextService.setValue(k, v),
        navigate: (target) => this.navigateTo(target),
        blockNavigation: () => { blocked = true; },
        styles: this.styleRules,
        recorder,
        self,
      }));
    } catch {
      // A faulty refinement must not break interaction.
    }
    if (mutated) {
      this.hasRuntimeChanges = true;
    }
    return { blocked, mutated };
  }

  /** The concrete control to render a node as (events default to a button). */
  controlFor(node: RenderNode): string {
    return node.control || (node.type === 'Event' ? 'button' : '');
  }

  /** True when the node renders as an interactive control rather than a box. */
  isControl(node: RenderNode): boolean {
    return ['button', 'checkbox', 'inputField', 'link'].indexOf(this.controlFor(node)) >= 0;
  }

  /** True when the Style model gives the node its own look (background or any own-box CSS). */
  isStyled(node: RenderNode): boolean {
    return !!node.backgroundColor || Object.keys(node.styles || {}).length > 0;
  }

  /** A plain node uses the default box chrome; styled nodes and controls render bare. */
  isPlain(node: RenderNode): boolean {
    return !this.isControl(node) && !this.isStyled(node);
  }

  /** Resolved CSS for a node: style-model properties plus operation-mutable bg / font size. */
  nodeStyle(node: RenderNode): Record<string, string> {
    const style: Record<string, string> = { ...(node.styles || {}) };
    if (node.backgroundColor) {
      style['background-color'] = node.backgroundColor;
    }
    style['font-size'] = node.fontSize + 'px';
    return style;
  }

  /** Style for the outer box — empty for controls, whose own element carries the style. */
  boxStyle(node: RenderNode): Record<string, string> {
    return this.isControl(node) ? {} : this.nodeStyle(node);
  }

  /** Layout CSS applied to a node's children container (flex / grid). */
  childStyle(node: RenderNode): Record<string, string> {
    return node.childStyles || {};
  }

  flowLabel(node: RenderNode): string {
    return node.flows.map((f) => f.targetName).join(', ');
  }

  /**
   * Triggering an event runs its code refinement (Code tab), if any, then reroutes
   * to the flow's target view (or re-renders in place when self-targeting).
   */
  onTrigger(node: RenderNode): void {
    const { blocked } = this.runRefinement(node.name, this.ownerContainer(node));
    // Unless the refinement blocked it, follow the event's normal navigation flow.
    if (!blocked) {
      const flow = node.flows[0];
      if (flow && flow.targetViewId && this.views.some((v) => v.id === flow.targetViewId)) {
        this.setActive(flow.targetViewId);
      }
    }
    // Re-run adaptation over the (possibly mutated) runtime model. This also lets a
    // self-reference flow (event -> its own ViewContainer) re-apply the operations.
    this.render();
  }

  /** Switches the active view to the container with the given name or id. */
  private navigateTo(target: string): void {
    const view = this.views.find((v) => v.name === target || v.id === target);
    if (view) {
      this.setActive(view.id);
    }
  }

  /** Discards all runtime changes made by event refinements (manual reset). */
  resetRuntime(): void {
    this.overlay = [];
    this.overlayCounter = 0;
    this.hasRuntimeChanges = false;
    this.render();
  }

  /** Runs the app full-screen (no AdaptUI editor chrome). */
  enterFullscreen(): void {
    this.fullscreen = true;
    this.fsMenuOpen = false;
  }

  /** Leaves full-screen "app" mode. */
  exitFullscreen(): void {
    this.fullscreen = false;
    this.fsMenuOpen = false;
  }

  /** Builds the view tree from the latest inputs: base → runtime overlay → adaptation. */
  private render(): void {
    if (!this.snapshot) {
      return;
    }
    const { elements, flows, styles, ops, rules, ctx, codeOps } = this.snapshot;
    this.hasModel = elements.length > 0;
    this.activatedContext = ctx.filter((p) => p.activated);
    this.contextProps = ctx;
    this.styleRules = styles;
    this.ruleCount = rules.length;

    const ctxMap = new Map(ctx.map((p) => [p.key, p]));
    this.firedCount = rules.filter((r) => ruleFires(r, ctxMap)).length;

    const base = buildHostGraph(elements, flows, styles);
    // Persistent runtime overlay (event-refinement edits) becomes part of the model,
    // then context-driven adaptation runs over the whole graph.
    applyOverlay(base, this.overlay, styles);
    const host = runAdaptation(base, rules, ops, ctx, codeOps, styles);
    this.views = buildRenderTree(host);

    if (!this.views.some((v) => v.id === this.activeViewId)) {
      // First view to appear (or a replacement) loads → fires its onLoad.
      this.setActive(this.views.length ? this.views[0].id : null);
    }
  }
}
