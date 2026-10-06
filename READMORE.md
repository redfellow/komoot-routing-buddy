# Developer notes

See [README.md](README.md) for installation and everyday use.

## Setup

Use Node.js 22+ and npm:

```sh
npm ci
npm test
npm run build
```

Load `dist/chrome` through Chrome/Brave’s extension manager, or `dist/firefox/manifest.json` through Firefox’s temporary add-on page. Code-only builds do not include Finland data; import a prepared folder through **Local Finland data**. See [local data setup](docs/LOCAL-OSM.md).

## Commands

- `npm test`: regression tests, including disposable build checks.
- `npm run build`: shared code with browser-specific manifests in `dist/`.
- `npm run lint:firefox`: build and lint Firefox, treating warnings as errors.
- `npm run dev:firefox`: build and open a temporary Firefox session.
- `npm run data:release`: prepare and validate current Finland data without building the extension.
- `npm run package`: fresh data, tests, both builds, Firefox lint and bundled ZIPs. Requires the pinned Python environment; follow [RELEASING.md](docs/RELEASING.md).

Generated builds, archives and country data are ignored by Git. Source-loaded Chrome/Brave extensions can be reloaded directly; generated builds need rebuilding after source changes.

## Before sharing changes

Check `/plan`, `/tour/<id>/zoom` and `/tour/<id>/edit`: settings, live colour previews, native-style restoration, panel dragging, sidebar persistence and map-layer restoration. Also check local hazards, trail warnings, cancellation/retry and uncovered online fallback. Unrelated pages and route geometry must remain unchanged.

Record the browsers and checks actually tested. Firefox package lint does not substitute for runtime testing; mobile remains unvalidated.

## Data handling

Local matching stays in the browser. Online fallback and deliberate route refresh send area bounds to public Overpass providers. Bulk updates download public Finland extracts from Geofabrik. Firefox’s generated manifest declares `locationInfo` because area bounds can be transmitted. Recheck permissions and privacy text whenever acquisition changes; see [Mozilla’s data-consent guidance](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

For matching behavior, see [ROUTE-CHECKER.md](docs/ROUTE-CHECKER.md).

## Code conventions

Follow [AGENTS.md](AGENTS.md): tabs, double quotes, explicit semicolons, Stroustrup braces (`else`, `catch` and `finally` on the next line), and regular functions for multiline callbacks. CSS uses BEM names. Node scripts and tests use ESM imports with `node:` prefixes.

Keep comments brief and explain decisions or contracts, rather than restating code. Shared browser scripts intentionally expose classic-script namespaces because content scripts, popups and workers load them without a bundler. Generic formatters may put braces or quotes back into a different style; check their output against AGENTS.md before committing.
