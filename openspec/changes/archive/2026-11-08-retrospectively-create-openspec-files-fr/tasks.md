## 1. Verify specs against code

- [x] 1.1 Verify trail-colouring, hazards and road-numbers specs against content.js, hazards.js, settings.js and docs/ROAD-NUMBERS.md; correct spec text where it differs
  - proof: `grep -cE "^#### Scenario:" openspec/specs/trail-colouring/spec.md openspec/specs/hazards/spec.md openspec/specs/road-numbers/spec.md`
- [x] 1.2 Verify route-check and ride-analysis specs against route-check.js, ride-overview.js, komoot-poi-insert.js, docs/ROUTE-CHECKER.md and docs/RIDE-OVERVIEW.md
  - proof: `grep -cE "^#### Scenario:" openspec/specs/route-check/spec.md openspec/specs/ride-analysis/spec.md`
- [x] 1.3 Verify squadrats, local-osm-data, keyboard-shortcuts, onboarding and settings-privacy specs against squadrats-estimate.js, local-osm.js, osm-updates.js, map-bridge.js, onboarding.js, PRIVACY.md and the matching docs
  - proof: `grep -cE "^#### Scenario:" openspec/specs/squadrats/spec.md openspec/specs/local-osm-data/spec.md openspec/specs/keyboard-shortcuts/spec.md openspec/specs/onboarding/spec.md openspec/specs/settings-privacy/spec.md`

## 2. Archive

- [x] 2.1 Archive the change so all ten specs exist under openspec/specs/ with a Purpose section
  - proof: `ls openspec/specs/trail-colouring/spec.md openspec/specs/hazards/spec.md openspec/specs/route-check/spec.md openspec/specs/ride-analysis/spec.md openspec/specs/squadrats/spec.md openspec/specs/local-osm-data/spec.md openspec/specs/keyboard-shortcuts/spec.md openspec/specs/onboarding/spec.md openspec/specs/road-numbers/spec.md openspec/specs/settings-privacy/spec.md`
  - proof: `grep -lE "^## Purpose" openspec/specs/route-check/spec.md`
