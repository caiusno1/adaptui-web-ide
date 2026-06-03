import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { OperationMlComponent } from './operation-ml.component';

describe('OperationMlComponent', () => {
  let component: OperationMlComponent;
  let fixture: ComponentFixture<OperationMlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormsModule, NoopAnimationsModule, MatButtonModule, MatIconModule, MatTooltipModule],
      declarations: [OperationMlComponent]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(OperationMlComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('offers element and style pattern palette items', () => {
    const kinds = component.paletteItems.map((i) => i.kind);
    expect(kinds).toContain('element');
    expect(kinds).toContain('style');
  });
});
