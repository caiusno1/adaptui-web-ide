import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AdaptmlRule } from '../model/adaptation.model';

/**
 * Publishes the ADAPTML adaptation rules (conditions + referenced operation) so
 * the Preview's adaptation engine can evaluate and apply them. The ADAPTML
 * editor calls {@link setRules} whenever its model changes.
 */
@Injectable({ providedIn: 'root' })
export class AdaptmlModelService {
  private readonly _rules = new BehaviorSubject<AdaptmlRule[]>([]);

  readonly rules$ = this._rules.asObservable();

  get rules(): AdaptmlRule[] {
    return this._rules.value;
  }

  setRules(rules: AdaptmlRule[]): void {
    this._rules.next(rules);
  }
}
