# AdaptUI 3.0 Web IDE

A browser-based modeling IDE for **adaptive user interfaces**. It is a web port
of the AdaptUI tooling and lets you describe an application's interface and its
adaptation rules through three complementary visual and declarative models:

| Tab | Model | Purpose |
| --- | --- | --- |
| **IFML** | Interaction Flow Modeling Language | The structure and navigation of the UI (containers, components, events, flows). |
| **CONTEXTML** | Context model | The context properties (age, environment, device type, …) the UI should adapt to. |
| **ADAPTML** | Adaptation model | Rules linking context conditions to operations that adapt the IFML elements. |

The two headline features are the **graphical IFML editor** and the **graphical
ADAPTML editor** — diagram canvases (built on
[mxGraph](https://github.com/jgraph/mxgraph)) where you compose models and export
them to XML. The three tabs share live state: the elements you draw in IFML and the
context properties you activate in CONTEXTML feed directly into ADAPTML.

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

## The adaptation model (CONTEXTML + ADAPTML)

The adaptation system connects three pieces of shared state, kept in Angular
services so they stay consistent across tabs:

- **Adaptation classes** (`AdaptationClassService`) — every IFML element links to a
  named class (`Container`, `View`, `Label`, `Event`, `Generic`, …). A class
  declares the **changeable properties** of its elements. The starter set is
  `visible` (boolean) and `fontSize` (number); the model is property-agnostic, so
  new properties and classes can be added without touching the editors. The class
  also doubles as a **selector**: an operation can target every element of a class.
- **Context properties** (`ContextModelService`) — the CONTEXTML tab lets you
  *activate* the properties your UI should adapt to (`Age`, `Environment`,
  `Device Type`, `Gender`). Each has a type (`number` or `enum`) that determines the
  operators and values available in a condition.
- **IFML elements** (`IfmlModelService`) — the IFML editor publishes its elements
  (name/id, type and adaptation class) so ADAPTML can target real elements.

An **adaptation rule** links one or more **conditions** to an **operation**:

- A **condition** is expressed over an *activated* context property, e.g. `age > 50`
  or `Device Type == phone`.
- An **operation** changes a changeable property of its target. The target is either
  a single element (by **id**/name), every element of a **class**, or **global**
  (all elements). Operations include *make visible*, *make invisible* and
  *increase / decrease / set* font size.

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
            ├── app.component.*   ← shell: Material toolbar + the IFML / CONTEXTML / ADAPTML tab group
            ├── model/
            │   └── adaptation.model.ts   ← shared types: adaptation classes, context & IFML refs, rule configs
            ├── services/         ← cross-tab shared state (singletons)
            │   ├── adaptation-class.service.ts ← registry of adaptation classes & their properties
            │   ├── context-model.service.ts    ← context properties + which are activated
            │   └── ifml-model.service.ts        ← IFML elements published by the IFML editor
            ├── tiny-ifml/        ← ★ the graphical IFML editor
            │   ├── tiny-ifml.component.ts    ← graph setup, palette, navigation flows, class panel, IFML XML export
            │   ├── tiny-ifml.component.html  ← palette + element properties panel + canvas + action toolbar
            │   └── tiny-ifml.component.sass  ← editor layout & palette styling
            ├── adapt-ml/         ← ★ the graphical ADAPTML editor
            │   ├── adapt-ml.component.ts     ← condition/operation nodes, config panel, ADAPTML XML export
            │   ├── adapt-ml.component.html   ← palette + rule configuration panel + canvas + action toolbar
            │   └── adapt-ml.component.sass   ← editor layout & styling
            └── context-ml/       ← the CONTEXTML tab (activate context properties)
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

## Using the ADAPTML editor

ADAPTML builds adaptation rules out of two node types, connected by arrows. It works
just like the IFML editor (palette, drag-or-click to add, the same canvas actions).

1. **Activate context properties** in the **CONTEXTML** tab — only activated
   properties can be used in conditions.
2. In **ADAPTML**, add a **Condition** node and select it. The configuration panel
   lets you pick an activated context property, an operator (offered according to the
   property's type) and a value — e.g. `Age > 50`.
3. Add an **Operation** node. Configure its **target** (global, by class, or by
   element id — the class/element lists come live from IFML), the **property**
   (drawn from the target's adaptation class) and the **action**
   (*make visible/invisible*, or *increase/decrease/set* for `fontSize`).
4. **Draw an arrow from the Condition to the Operation.** An operation together with
   all of its incoming conditions (combined with AND) forms one adaptation rule.

## Exporting to ADAPTML XML

Click **Export ADAPTML XML** to download the model (`model.adaptml`). Each operation
and its incoming conditions becomes one `<adaptationRule>`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<adaptml:AdaptationModel xmlns:adaptml="http://adaptui.org/adaptml/1.0" name="AdaptUI Adaptation Model">
  <adaptationRule id="rule_1">
    <when>
      <condition property="age" operator="gt" value="50"/>
    </when>
    <then>
      <operation targetKind="class" target="View" property="visible" action="hide"/>
    </then>
  </adaptationRule>
</adaptml:AdaptationModel>
```

---

## Roadmap

- Round-trip **import** of IFML / ADAPTML XML back into the canvases.
- A live **preview** that applies the adaptation rules to the IFML model for a given context.
- User-defined adaptation classes and more changeable properties (colour, layout, order, …) — the model is already property-agnostic.
- Richer condition logic (OR / grouping) and more IFML constructs (parameter bindings, data flows, actions, modules).
- Persisting models server-side and code generation from the AdaptUI annotations.

---

## License

See [LICENSE](./LICENSE).
