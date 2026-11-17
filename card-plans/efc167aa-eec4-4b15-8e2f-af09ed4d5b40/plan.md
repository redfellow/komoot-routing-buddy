# README and spec: route POI names stay at most 12 characters

## Why
16 characters is the Garmin maximum, not the target: shorter names read better on small device screens. README.md:26 says names "stay under 16 characters" and openspec/specs/ride-analysis/spec.md:30 says "at most 16 characters". Both present the device limit as the naming goal. The generated names are fixed words (ride-dialog.js:347, ride-overview.js:305); the longest, `Steep climb`, has 11 characters.

## What Changes
- README: say that names stay at most 12 characters, well under Garmin's 16-character limit.
- Spec: generated POI names SHALL have at most 12 characters.
- No code change: the checks in komoot-poi-data.js:64 and komoot-poi-insert.js:148 keep rejecting names longer than 16, the hard device limit (user's choice: docs only).

## Outcome
- README POI paragraph
  - Now: `Names stay under 16 characters; distance and climbing details appear in the preview.`
  - After: `Names stay at most 12 characters, short enough for small device screens and well under Garmin's 16-character limit; distance and climbing details appear in the preview.`

## Acceptance
- README and spec say 12 characters at most, and the README names 16 as the Garmin limit.
- The code and tests are unchanged.

## Citations
- README.md:26
- openspec/specs/ride-analysis/spec.md:30
- komoot-poi-insert.js:148, komoot-poi-data.js:64
- ride-dialog.js:347

## Assumptions
- The spec sentence keeps its other clauses and changes only "at most 16" to "at most 12". Ruled out: adding a separate Garmin requirement.
