import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatTabsModule } from '@angular/material/tabs';
import {MatToolbarModule} from '@angular/material/toolbar';
import {MatIconModule} from '@angular/material/icon';
import { TinyIfmlComponent } from './tiny-ifml/tiny-ifml.component';
import { ContextMlComponent } from './context-ml/context-ml.component';
import { AdaptMlComponent } from './adapt-ml/adapt-ml.component';
import { StyleMlComponent } from './style-ml/style-ml.component';
import { OperationMlComponent } from './operation-ml/operation-ml.component';
import { PreviewComponent } from './preview/preview.component';
import { CodeMlComponent } from './code-ml/code-ml.component';
import { DslEditorComponent } from './dsl-editor/dsl-editor.component';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatButtonModule} from '@angular/material/button';
import {MatTooltipModule} from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';

@NgModule({
  declarations: [
    AppComponent,
    TinyIfmlComponent,
    ContextMlComponent,
    AdaptMlComponent,
    StyleMlComponent,
    OperationMlComponent,
    PreviewComponent,
    CodeMlComponent,
    DslEditorComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    BrowserAnimationsModule,
    FormsModule,
    MatTabsModule,
    MatToolbarModule,
    MatIconModule,
    MatCheckboxModule,
    MatButtonModule,
    MatTooltipModule,
    MatExpansionModule,
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
