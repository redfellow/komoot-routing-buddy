# Analysis improvements

Implementation order follows dependencies: detection, trustworthy summaries, actions, then presentation and accessibility. No build or release is part of this work.

## Detection

- [x] Retain both Hills and Steep climb in analysis, avoid redundant nearby POI starts.
- [x] Mark sustained character transitions; explain short mixed stretches without generating fragment POIs.
- [x] Describe main climbing completion from verified elevation, without a Summit POI.
- [x] Detect existing matching route POIs before approval and prevent duplicate insertion.

## Understanding the ride

- [x] Concise ride overview with exact metrics underneath.
- [x] Separate native surface and way type breakdowns.
- [x] Section names, distance ranges and useful details.
- [x] Distinct mapped hazard and difficulty warnings.
- [x] Explain why every POI is proposed.
- [x] Compact expandable missing-data notices.

## Actions and state

- [x] Click sections/POIs to zoom; hover highlights without moving the map.
- Removed by user request: bulk and type-selection buttons. Retain individual POI checkboxes and zoom previews.
- [x] Separate ride-data and trail-check progress, overview usable during checks.
- [x] Explicit route-changed state; preserve preferences and prohibit outdated additions.

## Presentation and accessibility

- [x] Compact floater: colours, analysis, expand; clear Settings button when expanded.
- [x] Text and icons accompany colours.
- [x] Keyboard focus and comfortable targets throughout.
- [x] Automated behavior checks and browser verification; iterate on failures.

## Detection evidence

Nearby climb starts (within 150 m) use the more specific Steep climb POI, while both sections remain in the overview. Main climbing completion is the point where 95% of smoothed ascent is behind the rider; it is omitted with incomplete elevation or less than the configured Hills ascent. Character proposals retain actual riding distance and share of their section. Existing POIs match trimmed case-insensitive name, geometry progress and location within 10 m, preventing false matches on loops. The insertion adapter retains its independent duplicate guard.

Detection and approval regression tests cover overlap, mixed section share, missing elevation, existing POIs, and route-progress mismatches. Interaction, accessibility and browser verification are recorded below.

The overview now leads the metrics. Native surfaces and way types have independent expandable distance/percentage lists; S-grade variants aggregate as Singletrack. Section rows describe actual riding distance and short interruptions. Missing grade/elevation notices expand for detail. Browser sample-data verification confirmed the lists and compact notices; live Komoot and interaction/accessibility verification followed, as recorded below.

## Completion evidence

- Detection: `test/ride-overview.test.mjs` covers category minima/gaps, mixed sections, true Hills onset, overlapping climb proposals, complete/partial elevation, 95% ascent completion, and duplicate names at different route progress. `test/komoot-poi-insert.test.mjs` covers read-only existing-point extraction, duplicate guard, exact geometry and restoration.
- Understanding: native range and grade tests prove source precedence and independent breakdowns. `ride-dialog.js` renders reasons, section details, separate breakdowns and expandable coverage notices. Warning tests distinguish difficulty, width, obstacle and general hazard icons.
- Actions/state: `test/ride-dialog.test.mjs` covers click/focus previews, generation/approval, individual choices, 100-point limit, insertion pause, route-change invalidation, retained thresholds, independent progress, and absent bulk controls. `test/route-dialog.test.mjs` covers reading/progress/completion/cancellation/incomplete/stale notifications and checkpoint retries.
- Map behavior: `test/route-focus.test.mjs` proves preview-only requests make no camera call, stale preview clears are ignored, section fits use full geometry, and reduced motion disables animation. Real Brave verification confirmed the keyboard highlight and Enter-to-zoom on the user's specified saved route.
- Presentation/accessibility: the collapsed native floater retained colours and Analyse route; expanded Settings was visibly a button. Local browser verification confirmed focus enters Proposed POIs and Tab/Space changes an individual checkbox and approval count. At 390 × 844, the panel and footer stayed inside the viewport. CSS provides labels, visible focus and at least 44 px targets for coarse pointers. Temporary viewport overrides were reset.
- Final non-build suite: 281 tests pass. `git diff --check` passes. Build/package/release commands remain unrequested and unrun; source is unreleased and uncommitted.

The scope follows the latest user steering: individual checkboxes replace the previously proposed bulk/type-selection system. All other suggested improvements remain included.

Follow-up: missing-grade gaps have a no-camera highlight action; scattered stretches remain separate. The panel no longer repeats install-time sync/IP disclosures or asks for OSM refresh confirmation. Onboarding is planned separately in `docs/ONBOARDING.md`.
