import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { IfmlElementRef } from '../model/adaptation.model';
import { LIFECYCLE_EVENTS, lifecycleEventName } from '../model/transformation.model';
import { CodeModelService } from '../services/code-model.service';
import { IfmlModelService } from '../services/ifml-model.service';

/**
 * The CODE tab. Here the user defines **operations as functions** (usable by name
 * in ADAPTML, like the modelled operations) and **refines IFML events with code**
 * (run when the event is triggered in the Preview).
 */
@Component({
  standalone: false,
  selector: 'app-code',
  templateUrl: './code-ml.component.html',
  styleUrls: ['./code-ml.component.sass'],
})
export class CodeMlComponent implements OnInit, OnDestroy {

  functionsSource = '';
  functionsError = '';
  opNames: string[] = [];

  events: IfmlElementRef[] = [];
  /** Default lifecycle events (onLoad/onChange/onTerminate) per ViewContainer. */
  lifecycleEvents: { name: string; container: string; kind: string }[] = [];
  selectedEventName = '';
  eventCodeText = '';
  private eventCode: Record<string, string> = {};

  private subs = new Subscription();

  constructor(
    private codeService: CodeModelService,
    private ifmlService: IfmlModelService,
  ) { }

  ngOnInit(): void {
    this.functionsSource = this.codeService.functionsSource;
    this.subs.add(this.codeService.operationNames$.subscribe((n) => { this.opNames = n; }));
    this.subs.add(this.codeService.functionsError$.subscribe((e) => { this.functionsError = e; }));
    // Keep the editors in sync when a project is opened / a new one started.
    this.subs.add(this.codeService.functionsSource$.subscribe((src) => {
      if (src !== this.functionsSource) { this.functionsSource = src; }
    }));
    this.subs.add(this.codeService.eventCode$.subscribe((rec) => {
      this.eventCode = rec;
      if (this.selectedEventName) {
        const v = rec[this.selectedEventName] || '';
        if (v !== this.eventCodeText) { this.eventCodeText = v; }
      }
    }));
    this.subs.add(this.ifmlService.elements$.pipe(debounceTime(0)).subscribe((els) => {
      this.events = els.filter((e) => e.type === 'Event');
      // Every ViewContainer gets default lifecycle events, refinable like any event.
      const containers = els.filter((e) => e.type === 'ViewContainer' && !e.parentCellId);
      this.lifecycleEvents = [];
      for (const c of containers) {
        for (const kind of LIFECYCLE_EVENTS) {
          this.lifecycleEvents.push({ name: lifecycleEventName(c.name, kind), container: c.name, kind });
        }
      }
      if (!this.selectedEventName) {
        if (this.events.length) {
          this.selectEvent(this.events[0].name);
        } else if (this.lifecycleEvents.length) {
          this.selectEvent(this.lifecycleEvents[0].name);
        }
      }
    }));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  onFunctionsChange(): void {
    this.codeService.setFunctionsSource(this.functionsSource);
  }

  selectEvent(name: string): void {
    this.selectedEventName = name;
    this.eventCodeText = this.codeService.getEventCode(name);
  }

  onEventCodeChange(): void {
    if (this.selectedEventName) {
      this.codeService.setEventCode(this.selectedEventName, this.eventCodeText);
    }
  }

  hasEventCode(name: string): boolean {
    return !!(this.eventCode[name] && this.eventCode[name].trim());
  }
}
