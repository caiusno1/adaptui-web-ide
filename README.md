# AdaptUI 3.0 Web IDE

A browser-based modeling IDE for **adaptive user interfaces**. It is a web port
of the AdaptUI tooling and lets you describe an application's interface and its
adaptation rules through three complementary visual/▢declarative models:

| Tab | Model | Purpose |
| --- | --- | --- |
| **IFML** | Interaction Flow Modeling Language | The structure and navigation of the UI (containers, components, events, flows). |
| **CONTEXTML** | Context model | The context properties (age, environment, device type, …) the UI should adapt to. |
| **ADAPTML** | Adaptation model | How the interface adapts given the context (planned). |

The headline feature is the **graphical IFML editor**: a diagram canvas (built on
[mxGraph](https://github.com/jgraph/mxgraph)) where you compose an IFML model and
**export it to an IFML XML (XMI) document**.

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
            ├── tiny-ifml/        ← ★ the graphical IFML editor (this is where the modeling happens)
            │   ├── tiny-ifml.component.ts    ← graph setup, palette, navigation flows, IFML XML export
            │   ├── tiny-ifml.component.html  ← palette + canvas + action toolbar
            │   └── tiny-ifml.component.sass  ← editor layout & palette styling
            └── context-ml/       ← the CONTEXTML tab (context-property checklist)
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

## Roadmap

- CONTEXTML and ADAPTML editors on a par with the IFML editor.
- Round-trip **import** of IFML XML back into the canvas.
- Richer IFML constructs (parameter bindings, data flows, actions, modules).
- Persisting models and code generation from the AdaptUI annotations.

---

## License

See [LICENSE](./LICENSE).
