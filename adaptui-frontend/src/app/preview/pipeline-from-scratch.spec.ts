import { AdaptmlRule, ContextProperty, IfmlElementRef } from '../model/adaptation.model';
import { IfmlFlow, OperationModel, StyleRuleData } from '../model/transformation.model';
import { AdaptmlModelService } from '../services/adaptml-model.service';
import { IfmlModelService } from '../services/ifml-model.service';
import { OperationModelService } from '../services/operation-model.service';
import { StyleModelService } from '../services/style-model.service';
import {
  applyOverlay, buildHostGraph, buildRenderTree, OverlayCommand, RenderNode, runAdaptation,
} from './adaptation-engine';

/**
 * End-to-end "from scratch" pipeline test.
 *
 * It rebuilds the whole background model the way the editors publish it — IFML
 * elements + containment + navigation flows, Style DSL rules, an Operation and an
 * ADAPTML rule, and a context property — WITHOUT the seeded example, then runs the
 * exact pipeline the Preview runs (buildHostGraph → applyOverlay → runAdaptation →
 * buildRenderTree) and asserts the resulting visualization. This proves every stage
 * of the workflow can be reconstructed by hand and still yields the expected UI.
 */
describe('AdaptUI pipeline rebuilt from scratch', () => {
  // --- The model, authored by hand (no seed) -------------------------------

  // IFML: a Login view holding a styled card with a heading and a Sign In event,
  // and a News Feed view holding a post. (cellId, name, type, class, parent)
  const elements: IfmlElementRef[] = [
    { cellId: 'login', name: 'Login', type: 'ViewContainer', className: 'authView' },
    { cellId: 'card', name: 'Login Form', type: 'ViewContainer', className: 'card', parentCellId: 'login' },
    { cellId: 'heading', name: 'Welcome back', type: 'ViewComponent', className: 'heading', parentCellId: 'card' },
    { cellId: 'signIn', name: 'Sign In', type: 'Event', className: 'primaryBtn', parentCellId: 'card' },
    { cellId: 'feed', name: 'News Feed', type: 'ViewContainer', className: 'appView' },
    { cellId: 'post', name: 'Post 1', type: 'ViewComponent', className: 'post', parentCellId: 'feed' },
  ];

  // Navigation: Sign In → News Feed.
  const flows: IfmlFlow[] = [{ sourceCellId: 'signIn', targetCellId: 'feed' }];

  // Style DSL: "by class" rules concretize the elements (and render Sign In as a button).
  const styles: StyleRuleData[] = [
    { selectorKind: 'class', selector: 'authView', control: '', props: { backgroundColor: '#eef2ff', minHeight: '400' } },
    { selectorKind: 'class', selector: 'card', control: '', props: { backgroundColor: '#ffffff', padding: '16', borderRadius: '12' } },
    { selectorKind: 'class', selector: 'heading', control: '', props: { fontSize: '20', fontWeight: '700' } },
    { selectorKind: 'class', selector: 'primaryBtn', control: 'button', props: { backgroundColor: '#6366f1', color: '#ffffff' } },
    { selectorKind: 'class', selector: 'appView', control: '', props: { backgroundColor: '#f8fafc', display: 'grid', gridColumns: '1fr 1fr' } },
    { selectorKind: 'class', selector: 'post', control: '', props: { backgroundColor: '#ffffff', borderRadius: '10' } },
  ];

  // Operation: turn the app view's background dark.
  const darkMode: OperationModel = {
    id: 'op_dark',
    name: 'darkMode',
    nodes: [{
      id: 'n1', x: 0, y: 0, w: 0, h: 0,
      data: {
        kind: 'element', role: 'preserve', match: 'any',
        selectorKind: 'class', selector: 'appView',
        condProps: {}, setVisible: '', setProps: { backgroundColor: '#0f172a' },
      },
    }],
    edges: [],
  };

  // ADAPTML: at night (Time ≥ 21) run darkMode.
  const rules: AdaptmlRule[] = [{
    expr: { type: 'condition', condition: { propertyKey: 'time', operator: '>=', value: '21' } },
    operationName: 'darkMode',
  }];

  const ctx = (hour: string): ContextProperty[] =>
    [{ key: 'time', label: 'Time', type: 'number', activated: true, value: hour }];

  const render = (hour: string): RenderNode[] => {
    const base = buildHostGraph(elements, flows, styles);
    applyOverlay(base, [], styles);                                  // no overlay yet
    const host = runAdaptation(base, rules, [darkMode], ctx(hour), [], styles);
    return buildRenderTree(host);
  };

  const find = (views: RenderNode[], name: string): RenderNode | undefined => {
    let hit: RenderNode | undefined;
    const walk = (n: RenderNode) => { if (n.name === name) { hit = n; } n.children.forEach(walk); };
    views.forEach(walk);
    return hit;
  };

  // --- IFML structure ------------------------------------------------------

  it('rebuilds the IFML structure into views nested by containment', () => {
    const views = render('9');
    expect(views.length).toBe(2);                                    // Login + News Feed are the views
    expect(views.map((v) => v.name).sort()).toEqual(['Login', 'News Feed']);

    const login = find(views, 'Login')!;
    const card = find(views, 'Login Form')!;
    expect(card).toBeTruthy();
    expect(login.children.map((c) => c.name)).toContain('Login Form');   // card nested in login
    expect(card.children.map((c) => c.name).sort()).toEqual(['Sign In', 'Welcome back']);
  });

  // --- Style DSL concretization -------------------------------------------

  it('concretizes elements with the Style DSL (background, layout, control)', () => {
    const views = render('9');
    const card = find(views, 'Login Form')!;
    expect(card.backgroundColor).toBe('#ffffff');
    expect(card.styles['border-radius']).toBe('12px');               // numeric props get their unit
    expect(card.styles['padding']).toBe('16px');

    const feed = find(views, 'News Feed')!;
    expect(feed.childStyles['display']).toBe('grid');                // layout props target the children box
    expect(feed.childStyles['grid-template-columns']).toBe('1fr 1fr');

    const signIn = find(views, 'Sign In')!;
    expect(signIn.control).toBe('button');                           // event concretized as a control
  });

  // --- Navigation ----------------------------------------------------------

  it('wires a navigation flow to its target view', () => {
    const views = render('9');
    const signIn = find(views, 'Sign In')!;
    expect(signIn.flows.length).toBe(1);
    expect(signIn.flows[0].targetName).toBe('News Feed');
    expect(signIn.flows[0].targetViewId).toBe('feed');               // reroutes to the News Feed view
  });

  // --- Context-driven adaptation ------------------------------------------

  it('adapts to context: the News Feed turns dark at night (Time ≥ 21)', () => {
    const day = find(render('9'), 'News Feed')!;
    const night = find(render('22'), 'News Feed')!;
    expect(day.backgroundColor).toBe('#f8fafc');                     // rule does not fire by day
    expect(night.backgroundColor).toBe('#0f172a');                   // darkMode operation applied at night
  });

  // --- The service layer publishes exactly what the engine consumes -------

  it('authoring through the model services feeds the same render', () => {
    const ifml = new IfmlModelService();
    const style = new StyleModelService();
    const ops = new OperationModelService();
    const adapt = new AdaptmlModelService();
    ifml.setModel(elements, flows);
    style.setRules(styles);
    ops.setModels([darkMode]);
    adapt.setRules(rules);

    const base = buildHostGraph(ifml.elements, ifml.flows, style.rules);
    const host = runAdaptation(base, adapt.rules, ops.models, ctx('22'), [], style.rules);
    const views = buildRenderTree(host);

    expect(views.length).toBe(2);
    expect(find(views, 'News Feed')!.backgroundColor).toBe('#0f172a');
  });

  // --- Code / event-refinement overlay ------------------------------------

  it('replays an event-refinement overlay command onto the runtime graph', () => {
    const base = buildHostGraph(elements, flows, styles);
    const overlay: OverlayCommand[] = [{ kind: 'setBackground', target: 'card', value: '#123456' }];
    applyOverlay(base, overlay, styles);
    const card = base.nodes.find((n) => n.id === 'card')!;
    expect(card.backgroundColor).toBe('#123456');                    // persistent runtime edit took effect
  });
});
