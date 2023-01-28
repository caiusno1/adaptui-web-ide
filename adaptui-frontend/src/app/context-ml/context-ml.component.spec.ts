import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ContextMlComponent } from './context-ml.component';

describe('ContextMlComponent', () => {
  let component: ContextMlComponent;
  let fixture: ComponentFixture<ContextMlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ContextMlComponent ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(ContextMlComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
