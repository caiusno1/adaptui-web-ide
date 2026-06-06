import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { StyleRuleData } from '../model/transformation.model';

/**
 * Publishes the Style DSL rules so the Preview can concretize the IFML model.
 * The Style editor calls {@link setRules} whenever its model changes.
 */
@Injectable({ providedIn: 'root' })
export class StyleModelService {
  private readonly _rules = new BehaviorSubject<StyleRuleData[]>([]);

  readonly rules$ = this._rules.asObservable();

  get rules(): StyleRuleData[] {
    return this._rules.value;
  }

  setRules(rules: StyleRuleData[]): void {
    this._rules.next(rules);
  }
}
