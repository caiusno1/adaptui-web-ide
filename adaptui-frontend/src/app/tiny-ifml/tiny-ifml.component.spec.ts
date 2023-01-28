import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TinyIfmlComponent } from './tiny-ifml.component';

describe('TinyIfmlComponent', () => {
  let component: TinyIfmlComponent;
  let fixture: ComponentFixture<TinyIfmlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ TinyIfmlComponent ]
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
});
