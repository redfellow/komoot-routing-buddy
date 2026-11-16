# README: route POI names are at most 16 characters

## Why
README.md says generated POI names "stay under 16 characters", but `komoot-poi-insert.js` (line 148) accepts names up to and including 16 characters, and the spec (`openspec/specs/ride-analysis/spec.md`, line 30) says "at most 16 characters". Code and spec agree; the README is off by one.

## What Changes
- Reword the README sentence to match the code and spec. No code or spec change.

## Outcome
- README POI paragraph
  - Now: `Names stay under 16 characters; distance and climbing details appear in the preview.`
  - After: `Names have at most 16 characters; distance and climbing details appear in the preview.`

## Acceptance
- README no longer says "under 16 characters" and says "at most 16 characters".

## Citations
- komoot-poi-insert.js:148
- openspec/specs/ride-analysis/spec.md:30
- README.md:26

## Assumptions
- Fix the docs, not the code: the spec already says "at most 16", so the code is the intended behaviour. Ruled out: lowering the code limit to 15.
