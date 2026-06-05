# AdaptUI 3.0 Web IDE

A browser-based modeling IDE for **adaptive user interfaces**. It is a web port
of the AdaptUI tooling and lets you describe an application's interface and its
adaptation behaviour through several complementary models — and then **run them**
in a live preview:

| Tab | Model | Purpose |
| --- | --- | --- |
| **IFML** | Interaction Flow Modeling Language | The abstract structure and navigation of the UI (containers, components, events, flows). |
| **STYLE** | Style DSL | A concretization of IFML: assigns concrete properties (background colour, and a control such as button / checkbox / input for events) to elements by id or class. |
| **CONTEXTML** | Context model | The context properties (age, environment, device type, …) the UI should adapt to. |
| **OPERATIONS** | Operation model | Reusable graph transformations (LHS → RHS) over IFML and Style — the adaptation actions. |
| **ADAPTML** | Adaptation model | Rules linking context conditions (combined by AND/OR gates) to the operations that should run. |
| **PREVIEW** | Runtime | Renders the IFML+Style model as a live UI and adapts it by applying the ADAPTML rules for the current context. |

The first five tabs are **graphical editors** — diagram canvases (built on
[mxGraph](https://github.com/jgraph/mxgraph)) — and each exports its model to XML.
The tabs share live state, forming a model pipeline: IFML elements (with their
adaptation classes) and the context properties flow into the Style, Operations and
ADAPTML editors; the operations you define are referenced by ADAPTML rules; and the
**Preview** ties it all together at runtime.

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
  properties to adapt to (`Age`, `Environment`, `Device Type`, `Gender`), each typed
  `number` or `enum`.
- **Operations** (`OperationModelService`) — the Operations editor publishes the
  operations it defines (names for ADAPTML; full LHS/RHS models for the Preview).
- **Style rules** (`StyleModelService`) and **ADAPTML rules** (`AdaptmlModelService`)
  are likewise published for the Preview.

The pieces compose like this:

- **STYLE** *concretizes* IFML — a style rule selects elements by **id** or **class**
  and assigns concrete properties: a **background colour** and a **control** (events
  become buttons, checkboxes, input fields, links, …).
- **OPERATIONS** are **graph transformations** over IFML and Style, written as
  **LHS → RHS** rewrite rules in the unified single-graph notation: each pattern
  node/edge is tagged **«preserve»** (in both sides), **«create»** (RHS only) or
  **«delete»** (LHS only), and preserve/create nodes carry the property assignments
  applied on the right-hand side (e.g. `visible = false`, `backgroundColor = #222`).
- **ADAPTML** rules link **conditions** (over *activated* context properties, e.g.
  `age > 50`) to a **defined operation**. Conditions are combined by **«AND» / «OR»
  gate** nodes into a boolean expression; an operation fires **only** when its
  expression is satisfied (an operation with no conditions never fires).
- **PREVIEW** runs the whole stack: it builds a runtime *host graph* from IFML
  (concretized by Style), and for every ADAPTML rule whose condition expression holds
  under the current context it matches the referenced operation's LHS in the host and
  rewrites it (RHS). The rewritten graph is rendered as a navigable, page-style UI —
  triggering an event's control reroutes between views. See the
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
            ├── app.component.*   ← shell: Material toolbar + the IFML / STYLE / CONTEXTML / OPERATIONS / ADAPTML / PREVIEW tabs
            ├── model/
            │   ├── adaptation.model.ts      ← adaptation classes, context, IFML refs, ADAPTML rule/configs
            │   └── transformation.model.ts  ← Style DSL, Operation (LHS→RHS) patterns, runtime host graph
            ├── services/         ← cross-tab shared state (singletons, BehaviorSubject-backed)
            │   ├── adaptation-class.service.ts ← registry of adaptation classes & their properties
            │   ├── context-model.service.ts    ← context properties: activation + current value
            │   ├── ifml-model.service.ts        ← IFML elements (with containment) + navigation flows
            │   ├── operation-model.service.ts   ← operations defined in the Operations editor (names + full models)
            │   ├── style-model.service.ts       ← Style rules published for the Preview
            │   └── adaptml-model.service.ts     ← ADAPTML rules published for the Preview
            ├── tiny-ifml/        ← ★ graphical IFML editor (structure, navigation flows, adaptation class per element)
            ├── style-ml/         ← ★ graphical Style DSL editor (concretization: selector → background colour)
            ├── operation-ml/     ← ★ graphical Operations editor (LHS→RHS graph-transformation rules)
            ├── adapt-ml/         ← ★ graphical ADAPTML editor (conditions → referenced operation)
            ├── context-ml/       ← CONTEXTML tab (activate context properties)
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

Example output for a `Home` container whose list has an `onSelect` event flowing to a
`Product Details` container:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ifml:IFMLModel xmi:version="2.0"
    xmlns:xmi="http://www.omg.org/XMI"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:ifml="http://www.omg.org/spec/IFML/20140301"
    name="AdaptUI IFML Model">
  <interactionFlowModel xmi:id="ifml_model" name="AdaptUI IFML Model">
    <interactionFlowElements xsi:type="ifml:ViewContainer" xmi:id="id_1" name="Home" isLandmark="false" isDefault="false" isXOR="false">
      <viewElements xsi:type="ifml:ViewComponent" xmi:id="id_2" name="Product List">
        <viewElementEvents xsi:type="ifml:ViewComponentEvent" xmi:id="id_4" name="onSelect"/>
      </viewElements>
    </interactionFlowElements>
    <interactionFlowElements xsi:type="ifml:ViewContainer" xmi:id="id_5" name="Product Details" isLandmark="false" isDefault="false" isXOR="false">
      <viewElements xsi:type="ifml:ViewComponent" xmi:id="id_6" name="Details"/>
    </interactionFlowElements>
    <interactionFlowConnections xsi:type="ifml:NavigationFlow" xmi:id="id_7" name="view details" sourceInteractionFlowElement="id_4" targetInteractionFlowElement="id_5"/>
  </interactionFlowModel>
  <comments xmi:id="id_3" body="ADAPTUI-ANNOTATION-STYLE=EDIT ADAPTUI-ANNOTATION-SCROLL=ON" annotatedElements="id_2"/>
</ifml:IFMLModel>
```

> The output is a pragmatic, readable IFML serialization aimed at interoperability
> with IFML-aware tooling rather than a byte-for-byte match of a specific editor's
> XMI dialect.

---

## Using the Style editor

The **STYLE** tab concretizes IFML. Add a **Style Rule**, then in its panel pick a
**selector** (by class or by element id — the lists come live from IFML), a
**background colour** (the node is filled with it as a live preview) and a **control**
— how the element is rendered in the Preview (e.g. an event → *button*, *checkbox*,
*inputField* or *link*). **Export Style XML** (`model.style`) produces:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<style:StyleModel xmlns:style="http://adaptui.org/style/1.0" name="AdaptUI Style Model">
  <style targetClass="View">
    <property name="backgroundColor" value="#223344"/>
  </style>
  <style targetClass="Event">
    <property name="control" value="button"/>
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
3. On preserve/create nodes, set the properties to apply on the RHS — *Visibility* /
   *Font size* for element nodes, *Background colour* for style nodes.

**Export Operations XML** (`model.operations`) derives an explicit `<lhs>`/`<rhs>`
from the roles:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<op:OperationModel xmlns:op="http://adaptui.org/operations/1.0" name="AdaptUI Operations">
  <operation name="hideViews">
    <lhs>
      <node id="n1" kind="element" match="ViewComponent" selector="class:View"/>
    </lhs>
    <rhs>
      <node id="n1" kind="element" match="ViewComponent" selector="class:View">
        <set property="visible" value="false"/>
      </node>
    </rhs>
  </operation>
</op:OperationModel>
```

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
   switch between them. Inside a view, components render as boxes and **events render
   as their concretized control** (button / checkbox / input / link, from the Style
   model; events default to a button), all concretized by the Style background colours.
2. **Navigation:** triggering an event's control (clicking a button/link, typing in an
   input, ticking a checkbox) follows its navigation flow and **reroutes to the target
   container's view**. A flow targeting the event's own view re-renders it in place.
3. The **Context** side menu lists the *enabled* context factors. Edit a value (a
   number field or an enum dropdown) and the preview **re-adapts instantly**.
4. For every ADAPTML rule whose boolean condition expression holds, the referenced
   operation's graph transformation is applied to a runtime copy of the IFML graph
   (modifying `visible` / `fontSize` / `backgroundColor`, creating/deleting
   nodes/edges). The status line shows how many rules are currently applied.

For example, with a rule *"age > 50 OR device == phone → hideViews"*, switching the
device to *phone* (or raising the age above 50) in the side menu makes the View
components disappear from the preview; setting it back brings them back.

The matching-and-rewriting logic lives in a small, dependency-free module,
[`adaptation-engine.ts`](adaptui-frontend/src/app/preview/adaptation-engine.ts).

---

## Roadmap

- Round-trip **import** of the exported XML back into the canvases.
- Richer Style properties (font, layout, ordering, more control types) and user-defined adaptation classes — both models are already property-agnostic.
- Make a self-targeting event carry real state (form input, toggles) so it visibly changes its own view.
- Fuller graph-transformation support (negative application conditions, attribute conditions in the LHS).
- More IFML constructs (parameter bindings, data flows, actions, modules); persisting models server-side and code generation.

---

## License

See [LICENSE](./LICENSE).
