import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';

import { ProjectService } from './services/project.service';

@Component({
  standalone: false,
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.sass']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'adaptui-frontend';

  /** Name of the project currently open in the tabs. */
  projectName = 'Social Media Example';
  /** Names of projects saved in localStorage. */
  savedNames: string[] = [];
  /** Bound to the "Open" dropdown (reset after each open so it acts as a menu). */
  selectedOpen = '';

  private sub = new Subscription();

  constructor(private projectService: ProjectService) { }

  ngOnInit(): void {
    this.sub.add(this.projectService.names$.subscribe((names) => { this.savedNames = names; }));
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  newProject(): void {
    if (confirm('Start a new, empty project? Unsaved changes will be lost.')) {
      this.projectService.newProject();
      this.projectName = 'Untitled';
      this.selectedOpen = '';
    }
  }

  saveProject(): void {
    const name = (this.projectName || '').trim();
    if (!name) {
      alert('Please enter a project name first.');
      return;
    }
    this.projectService.save(name);
  }

  openProject(name: string): void {
    if (name && this.projectService.open(name)) {
      this.projectName = name;
    }
    this.selectedOpen = '';
  }

  deleteProject(name: string): void {
    if (name && confirm(`Delete the saved project "${name}"?`)) {
      this.projectService.delete(name);
    }
  }
}
