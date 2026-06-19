import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges,
  OnDestroy, Output, SimpleChanges, ViewChild,
} from '@angular/core';
import { EditorState } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching, HighlightStyle, StreamLanguage, syntaxHighlighting,
} from '@codemirror/language';
import {
  autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap,
  CompletionContext, CompletionResult,
} from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';

/**
 * A small, reusable code-editor component (CodeMirror 6) for the adaptation DSL.
 * Provides syntax highlighting and context-aware autocompletion (keywords,
 * context-property keys and operation names supplied by the host). Two-way bound
 * via `value` / `valueChange`.
 */
@Component({
  standalone: false,
  selector: 'app-dsl-editor',
  template: '<div #host class="dsl-host"></div>',
  styleUrls: ['./dsl-editor.component.sass'],
})
export class DslEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() value = '';
  /** Context-property keys offered as completions in the condition part. */
  @Input() propertyKeys: string[] = [];
  /** Operation names offered as completions after `then`. */
  @Input() operationNames: string[] = [];
  @Output() valueChange = new EventEmitter<string>();

  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLElement>;

  private view?: EditorView;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    const updateListener = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        this.value = u.state.doc.toString();
        this.zone.run(() => this.valueChange.emit(this.value));
      }
    });

    // Build the editor outside Angular so keystrokes don't each trigger change detection.
    this.zone.runOutsideAngular(() => {
      this.view = new EditorView({
        parent: this.hostRef.nativeElement,
        state: EditorState.create({
          doc: this.value ?? '',
          extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightActiveLine(),
            drawSelection(),
            history(),
            bracketMatching(),
            closeBrackets(),
            adaptmlLanguage(),
            syntaxHighlighting(DSL_HIGHLIGHT),
            autocompletion({ override: [(ctx) => this.complete(ctx)] }),
            keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
            EDITOR_THEME,
            updateListener,
          ],
        }),
      });
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Push external value changes into the editor without feeding back a change event.
    if (changes['value'] && this.view) {
      const current = this.view.state.doc.toString();
      if ((this.value ?? '') !== current) {
        this.view.dispatch({ changes: { from: 0, to: current.length, insert: this.value ?? '' } });
      }
    }
  }

  ngOnDestroy(): void {
    this.view?.destroy();
  }

  /** Re-measures the editor — call after it becomes visible (e.g. its panel expands). */
  refresh(): void {
    this.view?.requestMeasure();
  }

  /** Context-aware completion: operations after `then`, else keywords + property keys. */
  private complete(ctx: CompletionContext): CompletionResult | null {
    const word = ctx.matchBefore(/[\w-]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) {
      return null;
    }
    const line = ctx.state.doc.lineAt(ctx.pos);
    const head = line.text.slice(0, ctx.pos - line.from);
    const afterThen = /\bthen\b/i.test(head);

    const options = afterThen
      ? this.operationNames.map((n) => ({ label: n, type: 'function' }))
      : [
          ...['when', 'then', 'and', 'or'].map((k) => ({ label: k, type: 'keyword' })),
          ...this.propertyKeys.map((k) => ({ label: k, type: 'variable' })),
        ];
    return { from: word.from, options, validFor: /^[\w-]*$/ };
  }
}

// --- DSL language: a small tokenizer for highlighting -----------------------

function adaptmlLanguage() {
  return StreamLanguage.define<unknown>({
    token(stream) {
      if (stream.eatSpace()) { return null; }
      if (stream.match(/^(#|\/\/).*/)) { return 'comment'; }
      if (stream.match(/^(when|then|and|or)\b/i)) { return 'keyword'; }
      if (stream.match(/^(<=|>=|==|!=|<|>)/)) { return 'operator'; }
      if (stream.match(/^-?\d+(\.\d+)?/)) { return 'number'; }
      if (stream.match(/^[A-Za-z_][\w-]*/)) { return 'variableName'; }
      stream.next();
      return null;
    },
  });
}

const DSL_HIGHLIGHT = HighlightStyle.define([
  { tag: t.keyword, color: '#5e35b1', fontWeight: '600' },
  { tag: t.operator, color: '#c2185b' },
  { tag: t.number, color: '#00796b' },
  { tag: t.variableName, color: '#1565c0' },
  { tag: t.comment, color: '#90a4ae', fontStyle: 'italic' },
]);

const EDITOR_THEME = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: '#ffffff' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-content': { padding: '8px 0' },
});
