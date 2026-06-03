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
 * Style model, then applies the ADAPTML rules (their operations rewrite a
 * runtime copy of the IFML graph) for the current context. Editing a context
 * factor in the side menu re-runs the adaptation and updates the preview.
 */
@Component({
  selector: 'app-preview',
  templateUrl: './preview.component.html',
  styleUrls: ['./preview.component.sass'],
})
export class PreviewComponent implements OnInit, OnDestroy {

  renderRoots: RenderNode[] = [];
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
        // Coalesce synchronous bursts and run the recompute in a fresh change
        // detection turn (avoids ExpressionChangedAfterChecked at load time).
      ]).pipe(debounceTime(0)).subscribe(([elements, flows, styles, ops, rules, ctx]) => {
        this.recompute(elements, flows, styles, ops, rules, ctx);
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  onContextValue(key: string, value: string): void {
    this.contextService.setValue(key, value);
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
    this.renderRoots = buildRenderTree(host);
  }
}
