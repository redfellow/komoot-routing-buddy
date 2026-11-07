# Planning this project

Rules for planners, on top of härvääjä's own. Browser extension (Chrome/Firefox MV3), plain ES modules, Node >=22.

## Proofs

- Tests use `node:test`, files are `test/<module>.test.mjs`. Name a proof as `node --test test/<file>.test.mjs`.
- There is no linter or type checker; do not name lint proofs. `npm run lint:firefox` (web-ext) is a final-stage check.
- Mark fast tests with a first-line comment `@harvaaja-test-tier: fast`, `integration` or `host`. Tests like `local-osm-integration` and `build` are integration.
- Python tests under `scripts/local-osm` need `.venv-local-osm` and are host-only.
- Do not plan runs of `npm run build`, `package` or `data:*` as proofs.
- Plans that change user-visible behavior should update README.md and the relevant openspec/docs files.
