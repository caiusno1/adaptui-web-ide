import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ContextProperty, DEFAULT_CONTEXT_PROPERTIES } from '../model/adaptation.model';

/**
 * Holds the CONTEXTML context properties and which of them the user has
 * activated. The ADAPTML editor uses the activated properties to offer
 * conditions.
 */
@Injectable({ providedIn: 'root' })
export class ContextModelService {
  private readonly _properties = new BehaviorSubject<ContextProperty[]>(
    DEFAULT_CONTEXT_PROPERTIES.map((p) => ({ ...p }))
  );

  readonly properties$ = this._properties.asObservable();

  get properties(): ContextProperty[] {
    return this._properties.value;
  }

  /** The subset of properties the user has activated. */
  get activated(): ContextProperty[] {
    return this._properties.value.filter((p) => p.activated);
  }

  getProperty(key: string): ContextProperty | undefined {
    return this._properties.value.find((p) => p.key === key);
  }

  setActivated(key: string, activated: boolean): void {
    this._properties.next(
      this._properties.value.map((p) => (p.key === key ? { ...p, activated } : p))
    );
  }

  /** Removes a context property (CONTEXTML deletion). */
  remove(key: string): void {
    this._properties.next(this._properties.value.filter((p) => p.key !== key));
  }

  // --- project save/load ---

  getState(): ContextProperty[] {
    return this._properties.value.map((p) => ({ ...p }));
  }

  setState(properties: ContextProperty[]): void {
    this._properties.next((properties || []).map((p) => ({ ...p })));
  }

  reset(): void {
    this.setState(DEFAULT_CONTEXT_PROPERTIES);
  }

  /** Updates the current runtime value of a context property (Preview side menu). */
  setValue(key: string, value: string): void {
    this._properties.next(
      this._properties.value.map((p) => (p.key === key ? { ...p, value } : p))
    );
  }
}
