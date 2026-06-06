import { Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { ContextProperty } from '../model/adaptation.model';
import { ContextModelService } from '../services/context-model.service';

@Component({
  selector: 'app-context-ml',
  templateUrl: './context-ml.component.html',
  styleUrls: ['./context-ml.component.sass']
})
export class ContextMlComponent implements OnInit {

  properties$!: Observable<ContextProperty[]>;

  constructor(private contextService: ContextModelService) { }

  ngOnInit(): void {
    this.properties$ = this.contextService.properties$;
  }

  toggle(key: string, activated: boolean): void {
    this.contextService.setActivated(key, activated);
  }
}
