import { Component, OnDestroy, OnInit } from '@angular/core';
import { combineLatest, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { AdaptmlRule, ContextProperty, IfmlElementRef } from '../model/adaptation.model';
import { IfmlFlow, OperationModel, StyleRuleData } from '../model/transformation.model';
import { AdaptmlModelService } from '../services/adaptml-model.service';
import { ContextModelService } from '../services/context-model.service';
import { IfmlModelService } from '../services/ifml-model.service';
import { OperationModelService } from '../services/operation-model.service';
import { StyleModelService } from '../services/style-model.service';
import { buildHostGraph, buildRenderTree, RenderNode, ruleFires, runAdaptation } from './adaptation-engine';

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

  private subscriptions = new Subscription();

  constructor(
    private ifmlService: IfmlModelService,
    private styleService: StyleModelService,
    private operationService: OperationModelService,
    private adaptmlService: AdaptmlModelService,
    private contextService: ContextModelService,
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
        // Coalesce synchronous bursts and recompute in a fresh change-detection
        // turn (avoids ExpressionChangedAfterChecked at load time).
      ]).pipe(debounceTime(0)).subscribe(([elements, flows, styles, ops, rules, ctx]) => {
        this.recompute(elements, flows, styles, ops, rules, ctx);
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get activeView(): RenderNode | null {
    return this.views.find((v) => v.id === this.activeViewId) ?? null;
  }

  setActiveView(id: string): void {
    this.activeViewId = id;
  }

  onContextValue(key: string, value: string): void {
    this.contextService.setValue(key, value);
  }

  /** The concrete control to render a node as (events default to a button). */
  controlFor(node: RenderNode): string {
    return node.control || (node.type === 'Event' ? 'button' : '');
  }

  /** True when the node renders as an interactive control rather than a box. */
  isControl(node: RenderNode): boolean {
    return ['button', 'checkbox', 'inputField', 'link'].indexOf(this.controlFor(node)) >= 0;
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

  flowLabel(node: RenderNode): string {
    return node.flows.map((f) => f.targetName).join(', ');
  }

  /** Triggering an event reroutes to the flow's target view (or re-renders in place when self-targeting). */
  onTrigger(node: RenderNode): void {
    const flow = node.flows[0];
    if (!flow || !flow.targetViewId) {
      return;
    }
    if (this.views.some((v) => v.id === flow.targetViewId)) {
      this.activeViewId = flow.targetViewId;
    }
  }

  private recompute(
    elements: IfmlElementRef[], flows: IfmlFlow[], styles: StyleRuleData[],
    ops: OperationModel[], rules: AdaptmlRule[], ctx: ContextProperty[],
  ): void {
    this.hasModel = elements.length > 0;
    this.activatedContext = ctx.filter((p) => p.activated);
    this.ruleCount = rules.length;

    const ctxMap = new Map(ctx.map((p) => [p.key, p]));
    this.firedCount = rules.filter((r) => ruleFires(r, ctxMap)).length;

    const base = buildHostGraph(elements, flows, styles);
    const host = runAdaptation(base, rules, ops, ctx);
    this.views = buildRenderTree(host);

    if (!this.views.some((v) => v.id === this.activeViewId)) {
      this.activeViewId = this.views.length ? this.views[0].id : null;
    }
  }
}
