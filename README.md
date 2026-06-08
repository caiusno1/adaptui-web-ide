# AdaptUI 3.0 Web IDE

A browser-based modeling IDE for **adaptive user interfaces**. It is a web port
of the AdaptUI tooling and lets you describe an application's interface and its
adaptation behaviour through several complementary models — and then **run them**
in a live preview:

| Tab | Model | Purpose |
| --- | --- | --- |
| **IFML** | Interaction Flow Modeling Language | The abstract structure and navigation of the UI (containers, components, events, flows). |
| **STYLE** | Style DSL | A concretization of IFML: assigns a rich set of concrete properties (typography, colours, gradients, borders, spacing, shadows) and a control (button / checkbox / input for events) to elements by id or class. |
| **CONTEXTML** | Context model | The context properties (age, environment, device type, …) the UI should adapt to. |
| **OPERATIONS** | Operation model | Reusable graph transformations (LHS → RHS) over IFML and Style — the adaptation actions. |
| **CODE** | Code model | Operations written as JavaScript functions (usable like modelled operations), plus code that refines IFML events. |
| **ADAPTML** | Adaptation model | Rules linking context conditions (combined by AND/OR gates) to the operations that should run. |
| **PREVIEW** | Runtime | Renders the IFML+Style model as a live UI and adapts it by applying the ADAPTML rules for the current context. |

Most tabs are **graphical editors** — diagram canvases (built on
[mxGraph](https://github.com/jgraph/mxgraph)) — and each exports its model to XML.
The tabs share live state, forming a model pipeline: IFML elements (with their
adaptation classes) and the context properties flow into the Style, Operations and
ADAPTML editors; the operations you define are referenced by ADAPTML rules; and the
**Preview** ties it all together at runtime.

Everything across the tabs is a **project** that can be saved to and reopened from the
browser — see [Projects](#projects).

---

## What is IFML?

[IFML](https://www.ifml.org/) (the *Interaction Flow Modeling Language*) is an OMG
standard for describing the content, user interaction and control behaviour of an
application's front-end, independent of the target platform. The core concepts used
by this editor are:

- **View Container** — a container of view elements (think *window*, *page* or *panel*). Containers can be nested.
- **View Component** — an element that displays content or accepts input (a list, a form, a details view, …). Components live inside containers.
- **Event** — a point on a view element from which interaction originates (e.g. *onSelect*, *onSubmit*).
- **Navigation Flow** — a directed connection (an **arrow**) from an event to a target view element, expressing "when this happens, go there".
- **Annotation** — a free-text note. In this editor annotations also carry AdaptUI generator hints (e.g. `ADAPTUI-ANNOTATION-STYLE=EDIT`).

Each IFML element additionally links to an **adaptation class** (see below), which
declares the properties an adaptation may change on it.

---

## The model pipeline

The tabs are connected through shared Angular services so they stay consistent:

- **Adaptation classes** (`AdaptationClassService`) — every IFML element links to a
  named class (`Container`, `View`, `Label`, `Event`, `Generic`, …). A class
  declares the **changeable properties** of its elements (starter set: `visible`,
  `fontSize`). The model is property-agnostic — new properties/classes can be added
  without touching the editors. A class also doubles as a **selector**.
- **IFML elements** (`IfmlModelService`) — the IFML editor publishes its elements
  (name/id, type, adaptation class) so the other editors can target real elements.
- **Context properties** (`ContextModelService`) — CONTEXTML *activates* the
  properties to adapt to (`Time`, `Age`, `Environment`, `Device Type`, `Gender`), each
  typed `number` or `enum`; properties can be deleted in the tab.
- **Operations** (`OperationModelService`) — the Operations editor publishes the
  operations it defines (names for ADAPTML; full LHS/RHS models for the Preview).
- **Code** (`CodeModelService`) — the Code editor compiles its functions into
  **code operations** (also usable by name in ADAPTML) and **event refinements**.
- **Style rules** (`StyleModelService`) and **ADAPTML rules** (`AdaptmlModelService`)
  are likewise published for the Preview.

The pieces compose like this:

- **STYLE** *concretizes* IFML — a style rule selects elements by **id** or **class**
  and assigns a rich catalog of concrete properties (typography, **gradients**,
  borders, corner radius, spacing, **shadows**, opacity, …) plus a **control** (events
  become buttons, checkboxes, input fields, links, …). Class rules cascade under id rules.
- **OPERATIONS** are **graph transformations** over IFML and Style, written as
  **LHS → RHS** rewrite rules in the unified single-graph notation: each pattern
  node/edge is tagged **«preserve»** (in both sides), **«create»** (RHS only) or
  **«delete»** (LHS only), and preserve/create nodes carry the property assignments
  applied on the right-hand side (e.g. `visible = false`, `backgroundColor = #222`).
- **CODE** defines operations as JavaScript **functions** — each one becomes an
  operation usable by name in ADAPTML, exactly like a modelled operation, receiving an
  `api` to read context and mutate the live elements. The Code tab also **refines IFML
  events** with code that runs when the event is triggered in the Preview.
- **ADAPTML** rules link **conditions** (over *activated* context properties, e.g.
  `age > 50`) to a **defined operation** (modelled *or* code). Conditions are combined
  by **«AND» / «OR» gate** nodes into a boolean expression; an operation fires **only**
  when its expression is satisfied (an operation with no conditions never fires).
- **PREVIEW** runs the whole stack: it builds a runtime *host graph* from IFML
  (concretized by Style), and for every ADAPTML rule whose condition expression holds
  it applies the referenced operation — a modelled rewrite (match LHS, apply RHS) or a
  **code operation** (run the function over the host). The result is rendered as a
  navigable, page-style UI; triggering an event reroutes between views and runs the
  event's **code refinement**. See the
  [adaptation engine](adaptui-frontend/src/app/preview/adaptation-engine.ts).

---

## Tech stack

- **Angular 12** (`@angular/*` 12.2) + **TypeScript 4.3**
- **Angular Material 12** for the shell (toolbar, tabs, buttons, tooltips, checkboxes)
- **[mxGraph](https://github.com/jgraph/mxgraph) 4.2** for the diagramming canvas, loaded as a global browser script
- **SASS** (indented syntax) for component styles
- **Karma + Jasmine** for unit tests

---

## Project structure

```
adaptui-web-ide/
├── LICENSE
├── README.md                     ← you are here
└── adaptui-frontend/             ← the Angular application
    ├── angular.json              ← build/serve/test config; bundles mxGraph as a global script
    ├── package.json
    └── src/
        ├── index.html
        ├── main.ts               ← Angular bootstrap
        ├── styles.sass           ← global styles
        ├── config/
        │   └── mxgraph-config.js ← sets mxBasePath = "assets/mxgraph"
        ├── assets/               ← static assets (mxGraph images are copied here at build time)
        └── app/
            ├── app.module.ts     ← root module; registers components & Material modules
            ├── app.component.*   ← shell: Material toolbar + project bar + the IFML / STYLE / CONTEXTML / OPERATIONS / CODE / ADAPTML / PREVIEW tabs
            ├── model/
            │   ├── adaptation.model.ts      ← adaptation classes, context, IFML refs, ADAPTML rule/configs
            │   ├── transformation.model.ts  ← Style DSL, Operation (LHS→RHS) patterns, runtime host graph
            │   └── project.model.ts         ← saved-project shape + editor-adapter / graph-snapshot interfaces
            ├── services/         ← cross-tab shared state (singletons, BehaviorSubject-backed)
            │   ├── adaptation-class.service.ts ← registry of adaptation classes & their properties
            │   ├── project.service.ts          ← save/open/new projects (localStorage); coordinates editor adapters
            │   ├── context-model.service.ts    ← context properties: activation + current value
            │   ├── ifml-model.service.ts        ← IFML elements (with containment) + navigation flows
            │   ├── operation-model.service.ts   ← operations defined in the Operations editor (names + full models)
            │   ├── code-model.service.ts        ← Code tab: compiles functions to code operations + event refinements
            │   ├── style-model.service.ts       ← Style rules published for the Preview
            │   └── adaptml-model.service.ts     ← ADAPTML rules published for the Preview
            ├── tiny-ifml/        ← ★ graphical IFML editor (structure, navigation flows, adaptation class per element)
            ├── style-ml/         ← ★ graphical Style DSL editor (concretization: selector → background colour)
            ├── operation-ml/     ← ★ graphical Operations editor (LHS→RHS graph-transformation rules)
            ├── code-ml/          ← ★ Code editor (functions as operations + event refinements)
            ├── adapt-ml/         ← ★ graphical ADAPTML editor (conditions → referenced operation)
            ├── context-ml/       ← CONTEXTML tab (activate context properties / delete)
            └── preview/          ← ★ live adaptive Preview
                ├── adaptation-engine.ts  ← pure graph-rewrite engine (build host, match, rewrite, render tree)
                └── preview.component.*   ← context side menu + rendered, self-adapting UI
```

### How mxGraph is wired in

mxGraph ships as plain browser JavaScript, not an ES module, so it is loaded as a
**global script** rather than imported:

- `angular.json` lists `src/config/mxgraph-config.js` and
  `node_modules/mxgraph/javascript/mxClient.js` under `scripts`, and copies the
  mxGraph `src` folder to `assets/mxgraph` so the library can find its images.
- `src/config/mxgraph-config.js` sets `mxBasePath = "assets/mxgraph"`.
- Components declare the globals they use (`declare var mxGraph: any;`, etc.) at the
  top of the TypeScript file.

---

## Getting started

### Prerequisites

- **Node.js** (the project targets the Angular 12 toolchain)
- **npm**

### Install

```bash
cd adaptui-frontend
npm install
```

> If `npm install` reports peer-dependency conflicts on a newer npm, use
> `npm install --legacy-peer-deps`.

### Run the dev server

```bash
cd adaptui-frontend
npm start          # = ng serve
```

Then open <http://localhost:4200/>. The app reloads on source changes.

> **Node 17+ note:** the Angular 12 build uses an older webpack that trips on
> modern OpenSSL. If you see an `ERR_OSSL_EVP_UNSUPPORTED` error, run with the
> legacy provider:
> ```bash
> NODE_OPTIONS=--openssl-legacy-provider npm start
> ```

### Build

```bash
cd adaptui-frontend
npm run build      # outputs to dist/adaptui-frontend
```

### Test

```bash
cd adaptui-frontend
npm test           # runs the Karma/Jasmine unit tests
```

---

## Projects

A **project** is the complete contents of every tab — the IFML model, CONTEXTML
context properties, Operations, Code, ADAPTML rules and the adaptation classes — plus
the **visual structure** of the graphical editors (each node's position, size and
style). The project bar above the tabs manages them:

- **Save** — stores the current project under the name in the box, into the browser's
  `localStorage`.
- **New** — clears every tab to an empty project (default context + adaptation classes,
  empty canvases and code).
- **Open** — pick a saved project from the dropdown to load it into all tabs at once.
- **Delete** — removes the saved project that matches the current name.

Saving captures a JSON snapshot per editor (cells with geometry + metadata) so a
reopened project comes back exactly as it looked, down to node positions. Because the
Preview is fully derived from the other tabs, restoring them restores the running UI
too. The whole thing is client-side — projects live in your browser, nothing is
uploaded. Persistence is coordinated by
[`ProjectService`](adaptui-frontend/src/app/services/project.service.ts); each
graphical editor registers a small adapter (`capture` / `restore` / `reset`).

---

## Using the IFML editor

Open the **IFML** tab. The screen is split into a **palette** (left) and a
**diagram canvas** (right) with its own action toolbar.

### Creating elements

The palette offers the IFML element types. There are two ways to add one:

1. **Click** a palette button — the element is dropped onto the canvas (and nested
   into the currently selected container, if any).
2. **Drag** a palette button onto the canvas — the element is created where you drop
   it (and nested into the container you drop it over).

| Palette item | IFML type | Notes |
| --- | --- | --- |
| View Container | `ViewContainer` | Top-level window/page; can contain components and other containers. |
| View Component | `ViewComponent` | Content/input element; lives inside a container. |
| Event | `Event` | Small circle placed on an element; the origin of navigation flows. |
| Annotation | `Comment` | Yellow note carrying free text / AdaptUI generator hints. |

### Drawing Navigation Flows (arrows)

Navigation flows are the arrows that connect the model together:

1. Hover over the **border** of a source element until the connection crosshair
   appears.
2. **Drag** from the border onto the target element and release.

The arrow is created as a styled, orthogonal **Navigation Flow**. Double-click an
arrow to give it a label (e.g. the triggering event's name).

### Element properties (id & adaptation class)

Select any container, component or event to open the **properties panel** in the
palette sidebar. There you can rename the element (its name is also its `#id` for
ADAPTML targeting) and pick its **adaptation class**, which determines the
properties an adaptation may change on it. These are published live to the ADAPTML
tab.

### Canvas actions

The toolbar above the canvas provides: **Export IFML XML**, zoom in/out, fit to
screen, reset zoom, delete selection (also `Delete`/`Backspace`) and clear diagram.

---

## Exporting to IFML XML

Click **Export IFML XML** to download the current diagram as an IFML/XMI document
(`model.ifml`). The exporter walks the diagram and produces:

- `ViewContainer` / `ViewComponent` elements, preserving the **containment hierarchy**;
- `ViewElementEvent`s — either the explicit **Event** circles you placed, or events
  **synthesized** on the source element when you draw a flow directly from it;
- `NavigationFlow` connections referencing their source event and target element by id;
- `Comment`s for annotations, linked to the element they sit on.

Example output (a slice of the bundled Social Media example) for a `Login` container
whose form has a `Sign In` event flowing to the `News Feed` container:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ifml:IFMLModel xmi:version="2.0"
    xmlns:xmi="http://www.omg.org/XMI"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:ifml="http://www.omg.org/spec/IFML/20140301"
    name="AdaptUI IFML Model">
  <interactionFlowModel xmi:id="ifml_model" name="AdaptUI IFML Model">
    <interactionFlowElements xsi:type="ifml:ViewContainer" xmi:id="id_1" name="Login" isLandmark="false" isDefault="false" isXOR="false">
      <viewElements xsi:type="ifml:ViewContainer" xmi:id="id_2" name="Login Form">
        <viewElements xsi:type="ifml:ViewComponent" xmi:id="id_3" name="Email"/>
        <viewElements xsi:type="ifml:ViewComponent" xmi:id="id_4" name="Password"/>
        <viewElementEvents xsi:type="ifml:ViewComponentEvent" xmi:id="id_5" name="Sign In"/>
      </viewElements>
    </interactionFlowElements>
    <interactionFlowElements xsi:type="ifml:ViewContainer" xmi:id="id_6" name="News Feed" isLandmark="false" isDefault="false" isXOR="false"/>
    <interactionFlowConnections xsi:type="ifml:NavigationFlow" xmi:id="id_7" name="sign in" sourceInteractionFlowElement="id_5" targetInteractionFlowElement="id_6"/>
  </interactionFlowModel>
</ifml:IFMLModel>
```

> The output is a pragmatic, readable IFML serialization aimed at interoperability
> with IFML-aware tooling rather than a byte-for-byte match of a specific editor's
> XMI dialect.

---

## Using the Style editor

The **STYLE** tab concretizes IFML. Add a **Style Rule**, then in its panel pick a
**selector** (by class or by element id — the lists come live from IFML), a **control**
(how the element renders in the Preview — e.g. an event → *button*, *checkbox*,
*inputField* or *link*) and any of a rich catalog of **concrete style properties**,
grouped for convenience:

- **Typography** — text colour, font size, weight, family, style, alignment, case,
  letter spacing, line height.
- **Background** — background colour, ready-made **gradients**, opacity.
- **Border** — style, width, colour, corner radius.
- **Spacing & size** — padding, margin, width, min height.
- **Effects** — preset **shadows**.
- **Layout (children)** — how the element arranges its children: **flex** (direction,
  wrap, justify, align, gap) or **grid** (template columns, gap). These apply to the
  element's children container, so a container can lay its contents out as a row, a
  centered column, or a responsive grid.

Rules cascade like CSS: **class** rules apply first, then **id** rules override them
per property — so you can set a baseline look on a class and tweak individual elements
by id. Together these are enough to compose a modern, card-based UI in the Preview.
**Export Style XML** (`model.style`) emits one `<property>` per set value:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<style:StyleModel xmlns:style="http://adaptui.org/style/1.0" name="AdaptUI Style Model">
  <style targetClass="feedgrid">
    <property name="display" value="grid"/>
    <property name="gridColumns" value="1fr 1fr"/>
    <property name="gap" value="16"/>
  </style>
  <style targetClass="post">
    <property name="backgroundColor" value="#ffffff"/>
    <property name="borderRadius" value="14"/>
    <property name="padding" value="16"/>
    <property name="boxShadow" value="0 4px 12px rgba(15, 23, 42, .12)"/>
    <property name="display" value="flex"/>
    <property name="flexDirection" value="column"/>
  </style>
  <style targetClass="primaryBtn">
    <property name="control" value="button"/>
    <property name="backgroundImage" value="linear-gradient(135deg, #0ea5e9, #22d3ee)"/>
    <property name="borderRadius" value="10"/>
  </style>
</style:StyleModel>
```

## Using the Operations editor

The **OPERATIONS** tab defines reusable **graph transformations** (referenced by
ADAPTML). The left sidebar manages a list of named operations; the canvas edits the
selected one as a single **LHS → RHS** rule:

1. Add **Element** / **Style** pattern nodes and draw edges between them to match a
   sub-pattern of the IFML/Style model.
2. For each node/edge pick a **role** — **«preserve»** (matched and kept),
   **«create»** (added on the RHS) or **«delete»** (removed). Roles are colour-coded.
3. On preserve/create nodes, set what to apply on the RHS — *Visibility* plus **any
   style property** from the same catalog as the Style DSL (colours, gradients,
   borders, typography, layout, …). So an operation can change *any* element
   property, e.g. recolour surfaces and text for a dark theme.

A single pattern node matching by type/class applies to **every** matching element
(e.g. `match: ViewContainer` recolours all containers), since the engine applies all
matches of the rule.

**Export Operations XML** (`model.operations`) derives an explicit `<lhs>`/`<rhs>`
from the roles, with one `<set>` per assigned property:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<op:OperationModel xmlns:op="http://adaptui.org/operations/1.0" name="AdaptUI Operations">
  <operation name="Dark surfaces">
    <lhs>
      <node id="n1" kind="element" match="ViewContainer"/>
    </lhs>
    <rhs>
      <node id="n1" kind="element" match="ViewContainer">
        <set property="backgroundColor" value="#0f172a"/>
        <set property="backgroundImage" value="none"/>
        <set property="borderColor" value="#1e293b"/>
      </node>
    </rhs>
  </operation>
</op:OperationModel>
```

---

## Using the Code editor

The **CODE** tab is for adaptations that are easier to *write* than to *model*.

**Code operations.** In the *Functions* editor define plain JavaScript functions —
each top-level `function name(api) { … }` becomes an **operation** that you can
reference by name in the **ADAPTML** tab, exactly like a modelled (graph) operation.
The detected names appear in the sidebar and in the ADAPTML operation list. Each
function receives an `api`:

```js
function zebra(api) {
  // Per-index logic like this is why it's a code operation, not a graph one.
  api.byClass('post').forEach((post, i) => {
    api.setBackground(post, i % 2 === 0 ? '#ffffff' : '#eef2ff');
  });
}
```

The `api` can read and **fully reshape the runtime graph** (the IFML and Style editor
models are never touched — only this preview's runtime copy):

- **Read** — `nodes`, `context`, `byId` / `byName` / `byClass` / `byType`.
- **Change** — `setBackground`, `setStyle`, `setFontSize`, `setName`, `setClass`,
  `hide`, `show`.
- **Create** — `createElement({ type, className, name, parent, props })` adds a new
  runtime IFML element (nested in a parent), `connect(a, b, relation?)` adds a relation
  edge (e.g. a navigation flow).
- **Delete** — `deleteElement(node)` (cascades to its contents), `disconnect(a, b)`.
- **Style at runtime** — `createStyleRule({ selectorKind, selector, props })` applies a
  style rule to the matching runtime elements only.

When a firing ADAPTML rule names a code operation, the Preview runs it over the host.
For example, this operation **iterates a list and creates new posts in the feed**:

```js
function extraPosts(api) {
  var feed = api.byClass('feedgrid')[0];
  [{ who: 'AdaptUI Bot', text: 'Created from code 🤖' }].forEach(function (item) {
    var post = api.createElement({ type: 'ViewContainer', className: 'post', name: item.who, parent: feed });
    api.createElement({ type: 'ViewComponent', className: 'author', name: item.who, parent: post });
    api.createElement({ type: 'ViewComponent', className: 'postbody', name: item.text, parent: post });
  });
  api.createStyleRule({ selectorKind: 'class', selector: 'post', props: { borderColor: '#6366f1', borderWidth: '2' } });
}
```

**Event refinements.** Pick an IFML event and attach code that runs when the event is
triggered in the Preview. Here the `api` also offers:

- `setContext(key, value)` — persists and re-adapts, so an event can drive the model.
- `navigate(container)` — switch the Preview to another container/view by name or id.
- `blockNavigation()` — cancel the event's normal navigation flow to another container.

```js
// Refine the 'Sign In' event: navigation handled in code, not the static flow.
api.blockNavigation();                 // cancel the normal flow to another container
if (Number(api.context.time) < 20) {
  api.navigate('News Feed');           // navigate to a container by code (daytime only)
}
```

**Persistence.** The graph mutations an event refinement makes (`createElement`,
`deleteElement`, `setStyle`, `createStyleRule`, …) are recorded into a **runtime
overlay** that the Preview re-applies on every recompute — so they **persist** as you
adapt the context, switch views, etc. The overlay lives only in memory: it is cleared
by a **browser/tab reload** or the **Reset runtime** button in the Preview's view bar.
(Context changes via `setContext` and navigation are not part of the overlay — they act
through the context model and the active view.)

Code runs in the browser via `new Function` — it's your own code in your own session
(a prototyping facility), not a sandbox.

---

## Using the ADAPTML editor

ADAPTML builds adaptation rules out of **Condition**, **AND/OR gate** and
**Operation** nodes, connected by arrows. It works just like the IFML editor.

1. **Activate context properties** in the **CONTEXTML** tab — only activated
   properties can be used in conditions.
2. Add **Condition** nodes (pick a context property, operator and value, e.g.
   `Age > 50`).
3. Add **AND** / **OR** gate nodes and wire conditions (and other gates) into them
   for nested/mixed boolean logic. The gate's panel toggles AND ↔ OR.
4. Add an **Operation** node and select a **defined operation** by name (live from the
   **OPERATIONS** tab — define them there first).
5. **Draw arrows** condition/gate → gate → operation. The operation fires **only**
   when its resulting boolean expression is satisfied. Conditions wired directly to an
   operation are AND-combined; an operation with no conditions never fires.

## Exporting to ADAPTML XML

Click **Export ADAPTML XML** to download the model (`model.adaptml`). The `<when>`
mirrors the boolean expression (`<and>` / `<or>` / `<condition>`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<adaptml:AdaptationModel xmlns:adaptml="http://adaptui.org/adaptml/1.0" name="AdaptUI Adaptation Model">
  <adaptationRule id="rule_1">
    <when>
      <or>
        <condition property="age" operator="gt" value="50"/>
        <condition property="deviceType" operator="eq" value="phone"/>
      </or>
    </when>
    <then>
      <operation ref="hideViews"/>
    </then>
  </adaptationRule>
</adaptml:AdaptationModel>
```

---

## Using the Preview

The **PREVIEW** tab renders the live, self-adapting UI as a **navigable, page-style
runtime**:

1. Top-level View Containers are **views** — one is shown at a time, with a tab bar to
   switch between them. Each element is concretized by the **Style model**: containers
   become flex/grid layouts, components render with their typography/colours/borders/
   shadows, and **events render as their concretized control** (button / checkbox /
   input / link; events default to a button). Styled elements render bare (the Style
   model fully defines their look); unstyled ones fall back to a labelled box.
2. **Navigation:** triggering an event's control (clicking a button/link, typing in an
   input, ticking a checkbox) follows its navigation flow and **reroutes to the target
   container's view**. A flow targeting the event's own view re-renders it in place.
3. The **Context** side menu lists the *enabled* context factors. Edit a value (a
   number field or an enum dropdown) and the preview **re-adapts instantly**.
4. For every ADAPTML rule whose boolean condition expression holds, the referenced
   operation's graph transformation is applied to a runtime copy of the IFML graph
   (changing visibility or any style property, creating/deleting nodes/edges). The
   status line shows how many rules are currently applied.

The matching-and-rewriting logic lives in a small, dependency-free module,
[`adaptation-engine.ts`](adaptui-frontend/src/app/preview/adaptation-engine.ts).

### The bundled example: a Social Media app

The editors open pre-seeded with a small **Social Media** example, modelled with
standard IFML constructs only and concretized by the Style tab:

- **Login** view — a centred card (flex column) with a heading, *Email* / *Password*
  fields (concretized as input controls) and a **Sign In** button whose navigation
  flow routes to the News Feed.
- **News Feed** view — a **Menu** bar (flex row, space-between) with the app brand and
  *Feed* / *Log out* nav buttons (Log out routes back to Login), above a **Feed** that
  arranges four post cards in a **2-column grid**.

It exercises the whole stack end to end: IFML structure + navigation, the Style DSL's
flex/grid layout, gradients, cards and controls, and the Preview's page-style routing.

It also ships time-driven adaptations:

- **Daytime** (`Time` < 20) — two **code operations** (defined in the Code tab):
  `zebra` stripes the post cards by index, and `extraPosts` **creates new runtime
  posts** in the feed and adds a runtime-only accent border via `createStyleRule`.
- **Evening** (`Time` ≥ 20) — two modelled operations (*Dark surfaces*, *Dark text*)
  switch the whole app to a dark theme (and the code-created posts disappear).
- **Event refinements** (Code tab) — *Feed* jumps the clock to 22:00 (dark) and
  *Log out* to 09:00 (light); **Sign In** is handled in code: it `blockNavigation()`s
  the static flow and `navigate('News Feed')`s only during the day, so after 20:00
  sign-in is blocked; **New Post** appends a runtime post to the feed that **persists**
  (click it a few times, then change the time — the posts stay) until you press
  **Reset runtime** or reload.

Set the *Time* value in the Preview's Context side menu — or click the controls — to
see the runtime graph and theme change live.

---

## Roadmap

- Round-trip **import** of the exported XML back into the canvases.
- Per-side spacing (individual margins/padding) and reusable style presets/themes in the Style DSL.
- Make a self-targeting event carry real state (form input, toggles) so it visibly changes its own view.
- Fuller graph-transformation support (negative application conditions, attribute conditions in the LHS).
- More IFML constructs (parameter bindings, data flows, actions, modules); persisting models server-side and code generation.

---

## License

See [LICENSE](./LICENSE).
