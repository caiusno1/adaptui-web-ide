import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AdaptMlComponent } from './adapt-ml.component';

describe('AdaptMlComponent', () => {
  let component: AdaptMlComponent;
  let fixture: ComponentFixture<AdaptMlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormsModule, NoopAnimationsModule, MatButtonModule, MatIconModule, MatTooltipModule],
      declarations: [AdaptMlComponent]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AdaptMlComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('offers condition and operation palette items', () => {
    const kinds = component.paletteItems.map((i) => i.kind);
    expect(kinds).toContain('condition');
    expect(kinds).toContain('operation');
  });
});
