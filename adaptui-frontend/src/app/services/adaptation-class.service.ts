import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AdaptationClass, DEFAULT_ADAPTATION_CLASSES } from '../model/adaptation.model';

/**
 * Registry of adaptation classes. Each IFML element links to one of these; the
 * class declares the element's changeable properties. New classes can be added
 * at runtime to support richer adaptations.
 */
@Injectable({ providedIn: 'root' })
export class AdaptationClassService {
  private readonly _classes = new BehaviorSubject<AdaptationClass[]>(
    DEFAULT_ADAPTATION_CLASSES.map((c) => ({ ...c, properties: [...c.properties] }))
  );

  readonly classes$ = this._classes.asObservable();

  get classes(): AdaptationClass[] {
    return this._classes.value;
  }

  getClass(name: string): AdaptationClass | undefined {
    return this._classes.value.find((c) => c.name === name);
  }

  addClass(cls: AdaptationClass): void {
    if (!this.getClass(cls.name)) {
      this._classes.next([...this._classes.value, cls]);
    }
  }
}
