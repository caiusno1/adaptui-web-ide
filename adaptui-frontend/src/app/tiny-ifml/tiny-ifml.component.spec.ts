import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { TinyIfmlComponent } from './tiny-ifml.component';

describe('TinyIfmlComponent', () => {
  let component: TinyIfmlComponent;
  let fixture: ComponentFixture<TinyIfmlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, MatButtonModule, MatIconModule, MatTooltipModule],
      declarations: [TinyIfmlComponent]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(TinyIfmlComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('exposes the IFML palette items', () => {
    expect(component.paletteItems.length).toBeGreaterThan(0);
    const types = component.paletteItems.map((i) => i.type);
    expect(types).toContain('viewContainer');
    expect(types).toContain('viewComponent');
  });
});
