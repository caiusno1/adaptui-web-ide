import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CodeApi, CodeOperation } from '../preview/adaptation-engine';

/**
 * Holds the user-authored code from the Code tab and compiles it into:
 *  - **code operations** — top-level functions usable by name in ADAPTML, exactly
 *    like the modelled (graph) operations; and
 *  - **event refinements** — code attached to an IFML event, run when it is
 *    triggered in the Preview.
 *
 * Compilation uses `new Function` — this is the user's own code running in their
 * own browser session (a scratchpad/prototyping facility), not a sandbox.
 */
@Injectable({ providedIn: 'root' })
export class CodeModelService {
  private readonly _functionsSource = new BehaviorSubject<string>(DEFAULT_FUNCTIONS);
  private readonly _eventCode = new BehaviorSubject<Record<string, string>>({ ...DEFAULT_EVENT_CODE });

  readonly functionsSource$ = this._functionsSource.asObservable();
  readonly eventCode$ = this._eventCode.asObservable();

  /** Compiled code operations (only functions that compile). */
  readonly operations$: Observable<CodeOperation[]> =
    this._functionsSource.pipe(map((src) => compileFunctions(src).operations));

  /** Names of the defined operation functions (shown in ADAPTML even while editing). */
  readonly operationNames$: Observable<string[]> =
    this._functionsSource.pipe(map((src) => extractFunctionNames(src)));

  /** Compile error for the functions editor ('' = OK). */
  readonly functionsError$: Observable<string> =
    this._functionsSource.pipe(map((src) => compileFunctions(src).error));

  /** Compiled event refinements, keyed by event name. */
  readonly eventHandlers$: Observable<Map<string, (api: CodeApi) => void>> =
    this._eventCode.pipe(map(compileHandlers));

  get functionsSource(): string {
    return this._functionsSource.value;
  }

  getEventCode(eventName: string): string {
    return this._eventCode.value[eventName] || '';
  }

  setFunctionsSource(src: string): void {
    this._functionsSource.next(src);
  }

  setEventCode(eventName: string, code: string): void {
    this._eventCode.next({ ...this._eventCode.value, [eventName]: code });
  }
}

/** Finds the names of top-level `function name(...)` declarations in the source. */
export function extractFunctionNames(src: string): string[] {
  const names: string[] = [];
  const re = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(src)) !== null) {
    if (names.indexOf(m[1]) < 0) {
      names.push(m[1]);
    }
  }
  return names;
}

function compileFunctions(src: string): { operations: CodeOperation[]; error: string } {
  const names = extractFunctionNames(src);
  if (!src.trim() || names.length === 0) {
    return { operations: [], error: '' };
  }
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function(`${src}\n;return {${names.join(',')}};`);
    const obj = factory() as Record<string, unknown>;
    const operations = names
      .filter((n) => typeof obj[n] === 'function')
      .map((n) => ({ name: n, run: obj[n] as (api: CodeApi) => void }));
    return { operations, error: '' };
  } catch (e) {
    return { operations: [], error: String((e as Error).message || e) };
  }
}

function compileHandlers(record: Record<string, string>): Map<string, (api: CodeApi) => void> {
  const handlers = new Map<string, (api: CodeApi) => void>();
  for (const name of Object.keys(record)) {
    const body = record[name];
    if (!body || !body.trim()) {
      continue;
    }
    try {
      // eslint-disable-next-line no-new-func
      handlers.set(name, new Function('api', body) as (api: CodeApi) => void);
    } catch {
      // Skip an event handler that does not compile.
    }
  }
  return handlers;
}

// ---------------------------------------------------------------------------
// Seeded example code
// ---------------------------------------------------------------------------

const DEFAULT_FUNCTIONS = `// Code operations
// ---------------
// Every function you define here becomes an operation you can reference by name
// in the ADAPTML tab — exactly like the modelled (graph) operations. Each one
// receives an \`api\` to read the context and change the live elements:
//   api.byClass('post'), api.byType('ViewContainer'), api.byId('Login')
//   api.setBackground(node, '#fff'), api.setStyle(node, 'color', '#333')
//   api.setFontSize(node, 18), api.hide(node), api.show(node)

function zebra(api) {
  // Alternate the post-card backgrounds. The per-index logic is exactly what
  // makes this a code operation rather than a modelled (graph) one.
  api.byClass('post').forEach(function (post, i) {
    api.setBackground(post, i % 2 === 0 ? '#ffffff' : '#eef2ff');
  });
}
`;

const DEFAULT_EVENT_CODE: Record<string, string> = {
  Feed: `// Refine the 'Feed' event with code.
// Jump the clock to the evening — the ADAPTML rule then flips the app to dark mode.
api.setContext('time', '22');`,
  'Log out': `// Refine the 'Log out' event: reset the clock to the morning (light mode).
api.setContext('time', '9');`,
};
