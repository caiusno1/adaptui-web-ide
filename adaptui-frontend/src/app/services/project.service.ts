import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { AdaptuiProject, EditorAdapter } from '../model/project.model';
import { AdaptationClassService } from './adaptation-class.service';
import { CodeModelService } from './code-model.service';
import { ContextModelService } from './context-model.service';

/**
 * Manages AdaptUI **projects** — the complete content of every tab (IFML, CONTEXTML,
 * Operations, Code, ADAPTML and, by derivation, the Preview) plus the visual layout
 * of the graphical editors. Graphical editors register an {@link EditorAdapter} so
 * their canvas (cells, geometry, metadata) can be captured/restored; the Context,
 * Code and adaptation-class state is read straight from their services. Projects are
 * persisted to `localStorage`.
 */
@Injectable({ providedIn: 'root' })
export class ProjectService {
  private static readonly STORAGE_KEY = 'adaptui.projects';
  private static readonly VERSION = 1;

  private readonly adapters = new Map<string, EditorAdapter>();
  private readonly _names = new BehaviorSubject<string[]>(this.listNames());

  /** Names of the projects saved in localStorage (sorted). */
  readonly names$ = this._names.asObservable();

  constructor(
    private context: ContextModelService,
    private code: CodeModelService,
    private classes: AdaptationClassService,
  ) { }

  /** A graphical editor registers itself so its canvas is part of saved projects. */
  register(key: string, adapter: EditorAdapter): void {
    this.adapters.set(key, adapter);
  }

  // --- capture / restore / new ---

  /** Builds a project snapshot from the current state of every tab. */
  capture(name: string): AdaptuiProject {
    const editors: Record<string, unknown> = {};
    this.adapters.forEach((adapter, key) => {
      try {
        editors[key] = adapter.capture();
      } catch {
        // A faulty editor must not block saving the rest.
      }
    });
    return {
      name,
      version: ProjectService.VERSION,
      savedAt: Date.now(),
      editors,
      context: this.context.getState(),
      code: this.code.getState(),
      classes: this.classes.getState(),
    };
  }

  /** Loads a project snapshot into every tab. */
  restore(project: AdaptuiProject): void {
    this.classes.setState(project.classes || []);
    this.context.setState(project.context || []);
    this.code.setState(project.code || { functionsSource: '', eventCode: {} });
    this.adapters.forEach((adapter, key) => {
      const state = project.editors ? project.editors[key] : undefined;
      if (state !== undefined) {
        try {
          adapter.restore(state);
        } catch {
          // Skip an editor whose snapshot fails to restore.
        }
      }
    });
  }

  /** Clears every tab to an empty state. */
  newProject(): void {
    this.classes.reset();
    this.context.reset();
    this.code.reset();
    this.adapters.forEach((adapter) => {
      try {
        adapter.reset();
      } catch {
        // ignore
      }
    });
  }

  // --- localStorage persistence ---

  listNames(): string[] {
    return Object.keys(this.readMap()).sort((a, b) => a.localeCompare(b));
  }

  save(name: string): void {
    const map = this.readMap();
    map[name] = this.capture(name);
    this.writeMap(map);
  }

  /** Loads a saved project by name into the tabs. Returns false if it does not exist. */
  open(name: string): boolean {
    const project = this.readMap()[name];
    if (!project) {
      return false;
    }
    this.restore(project);
    return true;
  }

  delete(name: string): void {
    const map = this.readMap();
    delete map[name];
    this.writeMap(map);
  }

  private readMap(): Record<string, AdaptuiProject> {
    try {
      return JSON.parse(localStorage.getItem(ProjectService.STORAGE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  private writeMap(map: Record<string, AdaptuiProject>): void {
    localStorage.setItem(ProjectService.STORAGE_KEY, JSON.stringify(map));
    this._names.next(Object.keys(map).sort((a, b) => a.localeCompare(b)));
  }
}
