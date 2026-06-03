import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { IfmlElementRef } from '../model/adaptation.model';
import { IfmlFlow } from '../model/transformation.model';

/**
 * Publishes the IFML elements (id, type, adaptation class, containing element)
 * and navigation flows of the current IFML diagram so other tabs — Style,
 * Operations, ADAPTML and the Preview — can target/render them. The IFML editor
 * calls {@link setModel} whenever its model changes.
 */
@Injectable({ providedIn: 'root' })
export class IfmlModelService {
  private readonly _elements = new BehaviorSubject<IfmlElementRef[]>([]);
  private readonly _flows = new BehaviorSubject<IfmlFlow[]>([]);

  readonly elements$ = this._elements.asObservable();
  readonly flows$ = this._flows.asObservable();

  get elements(): IfmlElementRef[] {
    return this._elements.value;
  }

  get flows(): IfmlFlow[] {
    return this._flows.value;
  }

  setModel(elements: IfmlElementRef[], flows: IfmlFlow[]): void {
    this._elements.next(elements);
    this._flows.next(flows);
  }

  /** Distinct adaptation-class names currently used by IFML elements. */
  get classesInUse(): string[] {
    return Array.from(new Set(this._elements.value.map((e) => e.className))).sort();
  }
}
