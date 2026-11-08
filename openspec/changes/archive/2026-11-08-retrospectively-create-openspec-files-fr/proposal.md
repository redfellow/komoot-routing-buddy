## Why
The project has 100+ commits of features but `openspec/specs/` is empty, so future changes have no baseline contracts to modify.

## What Changes
- Add ten capability specs describing current behaviour only: trail-colouring, hazards, route-check, ride-analysis, squadrats, local-osm-data, keyboard-shortcuts, onboarding, road-numbers, settings-privacy.
- No code, UI or test changes.
- Archive the change so the specs land in `openspec/specs/`.

## Assumptions
- Sources are README.md, docs/*.md and the code; where they disagree, the code wins and the doc mismatch is captured as a finding (ruled out: changing code to match docs).
- Specs stay at behaviour level, not implementation detail (ruled out: per-function specs).
- Release-process docs (Chrome Store audits, RELEASING.md) are not specced (ruled out: a release-process capability).
