# Planning this project

Rules for planners, on top of härvääjä's own. Browser extension (Chrome/Firefox MV3). Root browser scripts are classic scripts that share globals; `scripts/` and `test/` are ESM. Node >=22.

## Proofs

- Tests use `node:test`, files are `test/<module>.test.mjs`, one per root module where one exists. Name a proof as `node --test test/<file>.test.mjs`. The whole suite is `npm test`.
- There is no linter or type checker; do not name lint proofs. `npm run lint:firefox` (builds `dist/`, then web-ext lint) is a final-stage check only.
- Tiers: a first-line comment `@harvaaja-test-tier: fast`, `integration` or `host`. Only `test/popup-version.test.mjs` has one today. When a plan changes an untagged test file, add its tier. `local-osm-integration` and `build` are integration.
- Python tests (`scripts/local-osm` and `scripts/road-numbers`, both `unittest`) need `.venv-local-osm`, which is built by hand and gitignored. They are host-only: name them only when the venv exists on the host, and mark them as host proofs.
- Do not plan runs of `npm run build`, `package` or `data:*` as proofs.
- Browser behaviour on Komoot pages and Firefox runtime checks cannot be proved here. List them as manual checks for a person (see READMORE.md, "Before sharing changes"), not as proofs.
- Plans that change user-visible behavior should update README.md and the relevant `openspec/specs` or `docs/` files. Plans that change what leaves the browser also update PRIVACY.md.
