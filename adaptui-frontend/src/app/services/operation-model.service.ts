import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * Publishes the names of the operations defined in the Operations tab so that
 * ADAPTML rules can reference them. The Operations editor calls
 * {@link setNames} whenever its set of operations changes.
 */
@Injectable({ providedIn: 'root' })
export class OperationModelService {
  private readonly _names = new BehaviorSubject<string[]>([]);

  readonly names$ = this._names.asObservable();

  get names(): string[] {
    return this._names.value;
  }

  setNames(names: string[]): void {
    this._names.next(names);
  }
}
