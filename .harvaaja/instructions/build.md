# Building this project

Rules for implementers and fixers, on top of härvääjä's own.

## Proofs

- Run one test file: `node --test test/<name>.test.mjs`. Run all: `npm test`.
- A new test gets a first-line comment `@harvaaja-test-tier: fast`, `integration` or `host`.
- No linter or type checker exists; follow AGENTS.md style (tabs, double quotes, semicolons, Stroustrup braces, BEM CSS, no `any`).
- Do not run build/package scripts unless asked. Never edit version in manifest.json except for a release.
- Tests must not touch the network or real Komoot; use fixtures in `test/fixtures`.
