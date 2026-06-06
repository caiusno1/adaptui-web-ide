import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { OperationModel } from '../model/transformation.model';

/**
 * Publishes the operations defined in the Operations tab. ADAPTML uses the
 * names to reference them; the Preview uses the full models (LHS/RHS) to apply
 * the graph transformations. The Operations editor calls {@link setModels}
 * whenever its set of operations changes.
 */
@Injectable({ providedIn: 'root' })
export class OperationModelService {
  private readonly _models = new BehaviorSubject<OperationModel[]>([]);

  readonly models$ = this._models.asObservable();
  readonly names$: Observable<string[]> = this._models.pipe(map((ms) => ms.map((m) => m.name)));

  get models(): OperationModel[] {
    return this._models.value;
  }

  get names(): string[] {
    return this._models.value.map((m) => m.name);
  }

  setModels(models: OperationModel[]): void {
    this._models.next(models);
  }
}
