import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { IfmlElementRef } from '../model/adaptation.model';

/**
 * Publishes the IFML elements (id, type and adaptation class) of the current
 * IFML diagram so other tabs — notably ADAPTML — can target them. The IFML
 * editor calls {@link setElements} whenever its model changes.
 */
@Injectable({ providedIn: 'root' })
export class IfmlModelService {
  private readonly _elements = new BehaviorSubject<IfmlElementRef[]>([]);

  readonly elements$ = this._elements.asObservable();

  get elements(): IfmlElementRef[] {
    return this._elements.value;
  }

  setElements(elements: IfmlElementRef[]): void {
    this._elements.next(elements);
  }

  /** Distinct adaptation-class names currently used by IFML elements. */
  get classesInUse(): string[] {
    return Array.from(new Set(this._elements.value.map((e) => e.className))).sort();
  }
}
