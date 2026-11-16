# Building this project

Rules for implementers and fixers, on top of härvääjä's own.

## Proofs

- Run one test file: `node --test test/<name>.test.mjs`. Run all: `npm test`.
- A new test gets a first-line comment `@harvaaja-test-tier: fast`, `integration` or `host` (see `test/popup-version.test.mjs`).
- Tests must not touch the network, real Komoot or OSM servers. Use fixtures in `test/fixtures` (currently only `local-osm.osm.pbf`) and a fake `fetch` that throws, as `test/local-osm-integration.test.mjs` does.
- Python tests run with `.venv-local-osm/bin/python -m unittest discover -s scripts/local-osm -p 'test_*.py'`, or the same for `scripts/road-numbers`. They need the venv, which a fresh worktree does not have.

## Conventions

- No linter or type checker exists. Follow AGENTS.md style: tabs, double quotes, semicolons, Stroustrup braces, BEM CSS, no `any`. READMORE.md adds: regular `function` for multiline callbacks.
- Root browser scripts (`content.js`, `popup.js`, `background.js`, `local-osm.js` and the like) are classic scripts with shared globals, loaded without a bundler. Do not add `import` or `export` to them.
- Do not run build/package scripts unless asked. Never edit version in manifest.json except for a release.
- `dist/`, `artifacts/` and `local-osm-data/` are generated and gitignored. Do not commit them.
