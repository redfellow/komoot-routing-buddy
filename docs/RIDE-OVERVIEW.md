# Ride overview and approved route POIs

## Behavior

The development version adds an Analyse route button to supported Komoot planner and route-editing pages. Analyse route shows a distance-based character timeline, totals and a first/middle/final-third description. Climbing concentrations and steep climbs are identified separately. Missing native surface, way-type or elevation coverage remains unknown. The overview does not request OSM data.

Preview route POIs creates a selectable preview without changing the route. Add approved POIs inserts only the checked suggestions as native named Komoot custom POIs. Map previews use temporary highlights; approved suggestions become native route POIs. Details stay in the preview rather than POI names. The user saves through Komoot; no automatic save occurs. Device synchronization and supported-device behavior belong to Komoot and device manufacturers.

| Name | Detection | Native icon |
| --- | --- | --- |
| Trails | At least 500 m of singletrack or S0-rated paths; join gaps up to 150 m, excluding gaps from the minimum; mark the first actual trail point | Danger (5) |
| Gravel | At least 1.5 km of gravel/unpaved/dirt riding without an overriding trail grade | Checkpoint (35) |
| Technical | At least 250 m of S1–S5 trails | Danger (5) |
| Hills | At least 150 m ascent within 5 km | Checkpoint (35) |
| Steep climb | At least 8% average gradient over 300 m, allowing short flatter stretches | Steep incline (43) |
| Halfway | Half the travelled route distance | Checkpoint (35) |

Minimum trail distance, maximum gap, ascent, average gradient and minimum climb length are adjustable. Elevation is smoothed over 100 m to reduce noise. Trail clusters produce one marker each; disconnected geometry splits clusters. Overlapping climbing windows merge to reduce repeated markers. All names fit the user's 16-character limit. There are no Trail ends or Summit suggestions, nor café/toilet enrichment. Future optional detours are outside this feature and must have a preview.

## Exact placement and safeguards

The user chose exact placement along the displayed route. Suggestions are not snapped to existing route vertices. On approval, the nearest ordinary route waypoint within 100 m both geographically and along route progress is customized in place; otherwise a new point is inserted at the exact suggestion location. Custom POIs are protected, and each ordinary waypoint can be reused only once per batch. Komoot returns six-decimal coordinates, so geometry verification permits collinear subdivisions and up to 0.1 m of rounding; genuine detours are rejected. A live Halfway insertion retained every original coordinate in order and added one vertex 0.03927 m from its displayed segment.

Existing named waypoint metadata is retained and verified. A suggestion within 100 m of an eligible ordinary point customizes that waypoint instead of inserting a duplicate that Komoot can discard during recalculation; existing custom POIs are not overwritten. The customized reference and unchanged route geometry are verified before accepting the result. Duplicate names are trimmed and compared without case sensitivity. A matching name within 10 m of both route progress and physical position is already present, regardless of its icon; repeated visits to a location on loops stay distinct. The preview and insertion adapter use the same rule. Custom identifiers are allocated from unused IDs. Names, categories, coordinates and request size are validated before mutation.

One insertion request runs at a time. Completed request IDs are replayed without repeating mutation. An unconfirmed timeout stays locked until the outcome arrives. Native Komoot editing is temporarily paused while the extension dialog remains available for cancellation. Closing the dialog or navigating away cancels pending work. Failure or cancellation restores the captured route and verifies geometry and original waypoint metadata. If restoration cannot be verified, the error explicitly tells the user to use Komoot Undo before saving.

Threshold and route changes invalidate previews. Late analysis/insertion results cannot overwrite newer dialog state. Successful insertion invalidates old route keys while retaining the completion message, including when Komoot replaces its map canvas.

## Implementation

- `ride-overview.js`: pure profile analysis, rolling windows, exact distance interpolation, character timeline and prose.
- `komoot-poi-data.js`: coordinate normalization, custom-reference metadata and approved-candidate validation.
- `ride-dialog.js`: analysis, editable thresholds, generation, selection and explicit approval.
- `komoot-pois.js`: isolated-world request/reply transport and cancellation.
- `komoot-poi-insert.js`: page-world native insertion, verification and restoration.
- `map-bridge.js`: rendered-route snapshot, exact profile/model matching and insertion handling.

The planned tour's `link("coordinates").get("items")` supplies `{lat, lng, alt, t}`. Altitude is in metres: the observed 112.4 sample matches the native popup's 112 m. Time `t` is never used as distance. The active editor tour is selected from its live React props. Surface and way-type ranges use their native coordinate indices; rendered map overlays are not used to reconstruct the ride. Reported route distance and total ascent come from Komoot. Preview distances retain a separate geometric distance for exact POI placement. Waypoints come from `link("way_points").models`, with metadata in `link("reference")`.

Native insertion uses `tour.wpAdd` at an explicit list position with `silent: true`, awaits `tour.fetchByWaypoints`, then triggers `change:path`. Metadata uses `cnwId`, `cnwName`, `cnwCategory` and `cnwDescription`, matching Komoot's customization flow. These are internal website interfaces and can change; the adapter validates supported methods and readback instead of assuming success.

## Verification

The installed Brave extension loads unpacked from the repository root. Source reloads required no build. The non-build regression suite passes; build/package/release commands were not requested and were not run. The version remains 1.5.2; this feature is unreleased and changes are uncommitted.

The live unsaved test route verified:

- Native names/icons and existing named POI retention.
- The actual Ride → Analyse → Generate → select → Add approved POIs workflow.
- Exact Halfway placement, unchanged original coordinate order, and native editing restored afterward.
- Repeat approval: zero additions and one already present.
- Cancellation while a real Komoot response was deliberately held: exact coordinate restoration, unchanged waypoint count, no Hills POI and editing restored.
- Final source reload: successful approval keeps its completion message after map replacement.

Screenshots are local ignored artifacts under `artifacts/poi-research/`: `custom-halfway.png`, `native-insertion.png`, `kernel-live-test.png`, `exact-halfway-approval.png` and `final-approval.png`. The compact planner URL can reconstruct locations without their existing custom names, so fresh-tab copies were used for workflow checks, while named-metadata preservation was checked in the original test model. No Save route action was taken and no device verification was performed.

The original unsaved page was preserved after automatic approval review rejected refreshing it. Subsequent source checks used separate tabs. README and both privacy-policy formats describe the new approval and Komoot recalculation behavior. Historical 1.5.2 store artifacts are unchanged.

## Saved-route regression (2026-10-13)

The saved-route test exposed two defects missed by the original short planner test: rendered overlays inflated distance to 95.5 km, and strict rendered/native matching dropped valid elevation. OSM-only character matching left most of the route unknown despite Komoot knowing its surfaces.

The Ride flow now exclusively uses the active Komoot tour for coordinates, indexed surfaces and way types, elevation, reported distance and total ascent. Roads and cycleways with known unpaved surfaces are classified explicitly, rather than unknown or automatically counted as trails. OSM is still used by separate ratings/hazards features. Missing native metadata produces an explicit not-ready error or a genuine unknown range; surface, way-type and elevation values have no OSM fallback. Missing MTB grades can be enriched separately from checker results as described below.

Verification on the reported saved route: 90.0 km, 651 m ascent, 100% elevation coverage, surfaces 57% paved / 42% unpaved / 1% unknown. The preview contains Halfway at 45.0 km and Trails around 48.9 km. Hills and Steep climb do not qualify under the default thresholds. No POIs were added and the saved route was not saved or changed during this inspection. Screenshot: `artifacts/poi-research/native-route-3345311140.png`.

The earlier saved-route inspection used the retired rolling 5 km trail rule. The replacement preview reports actual trail distance separately from total section length; the old Trails position is historical. Regression tests cover gravel roads, native ranges, missing metadata, complete elevation, authoritative totals, overlay duplication, correct Halfway geometry, and zero OSM requests in the overview.


## Ride panel design

The panel starts with a brief explanation and Analyse route. Results lead with a concise ride description and then distance, ascent and combined Trails/Technical distance. The collapsible route-character view contains independent native surface and way-type breakdowns. Preview route POIs opens selectable cards for named moments; the overview folds away to make room for those choices. A persistent footer shows the selected count in the approval action. Detection settings remain collapsed until needed. Changing thresholds or the route resets the preview and requires fresh analysis. The panel uses muted terrain colours, clear keyboard focus and a responsive layout with an independently scrolling body.


## Shared trail checks and riding categories

Analyse route is the floater's only route action. The same panel hosts the Komoot ride overview, OSM trail checks, and explicit POI approval. The inline checker preserves saved preferences, automatic retries, completed-area checkpoints, cancellation, explicit OSM refresh, missing-data reporting, and warning-to-map focus. Closing the panel or starting POI insertion cancels an active check. Warning results never become POIs automatically.

Compacted gravel paths are Gravel, not automatically Trails. Native way-type captions were verified in Komoot’s application: d1=S0, d2=S1, d3/d4=S2, d5=S3, d6=S4, d7=S5; use these first. The ungraded `wt#trail` token means Singletrack. When the native grade is absent, completed checker data can supply only the MTB grade through the checker's existing conservative route matching. Komoot surface, way type and altitude remain authoritative. Unmatched grades remain unknown, with coverage noted in the UI. An OSM grade update that changes the profile clears an existing POI selection and requires a fresh preview. Gravel defaults to 1,500 m, Trails to 500 m and Technical to 250 m; each minimum and the shared 150 m gap tolerance are adjustable.


Each Proposed POIs card includes an independent magnifier. It fits the map to the section's actual route geometry and shows the existing temporary route highlight; Halfway previews a 200 m neighbourhood. Preview geometry retains native bends and interpolates the exact section boundaries. Zooming neither toggles the checkbox nor adds a POI. Stale route keys are rejected. During insertion, check controls, POI selections and magnifiers are paused; closing the panel still cancels insertion.


## Automatic analysis and shared route events

The floater's On/Off toggle and Analyse route button remain available while collapsed. Analyse route opens the panel and immediately starts both the Komoot summary and the OSM check. Neither result waits for the other; separate progress, cancellation and incomplete-data messages remain visible. Check trails is no longer a separate start action. Retry check appears only after an incomplete or cancelled check, and manual OSM refresh remains under settings.

Along the route combines riding sections and amber warning rows, ordered by route distance. OSM warning distances are scaled to Komoot's reported distance for consistent placement in that list. Each riding-section row zooms to and highlights the same exact geometry as its POI preview. Warnings retain their existing map focus. Warnings are never approved or inserted as POIs automatically.

## Analysis improvements (2026-10-14)

Hills markers start at actual smoothed ascent instead of a flat lead-in to a qualifying window. A nearby Steep climb start (within 150 m) owns the POI, while both findings remain in Along the route. Character section details show actual riding distance and short interruptions. Strongest sustained gradient is retained separately from the average of a merged climbing section. With complete elevation and enough ascent, the overview locates 95% ascent completion; it creates no extra end/Summit POI.

Known Komoot total ascent remains visible even when profile elevation is missing. Without a native total, a partial result is labelled Known ascent. Small missing distances use metres and sub-percent coverage uses <1%, rather than rounding missing data to zero. Missing-data detail is expandable; the leading description stays concise.

Proposed POIs retain individual checkboxes, explanations and magnifiers. Bulk/type-selection buttons were removed at the user's request. Existing matching POIs are labelled Already on route, remain zoomable and are excluded from approval. POI selection and magnifiers pause during insertion. Preview generation moves keyboard focus to its heading; route/data changes retire stale controls and keep thresholds.

Hover or keyboard focus uses a separate temporary highlight without camera movement. Click or Enter fits the section. Preview IDs prevent an old leave event clearing a newer highlight. Route changes clear both preview and zoom highlights. Reduced-motion preferences disable animated camera movement. The panel is modeless so the map stays accessible; Escape closes it and restores focus to Analyse route. Touch targets are at least 44 px, with visible keyboard focus throughout.

Real Brave verification on a fresh saved-route editor tab confirmed native summary availability during checking, 90.1 km / 651 m / 57% paved / 42% unpaved / 1% unknown, the corrected cycleway description, independent check completion, keyboard highlight without camera movement, and Enter-to-zoom. No route POIs were added and the route was not saved. Temporary test tabs were closed and original browser tabs preserved. Local rendered UI checks confirmed individual keyboard selection and the responsive 390 × 844 layout. Screenshots: `artifacts/ride-design/simple-proposed-pois.png`, `native-breakdowns.png` and `narrow-poi-selection.png`; earlier `real-route-poi-selection.png` records native integration before removal of bulk controls.

The missing-grades disclosure includes Highlight gaps: it highlights every unrated eligible stretch for eight seconds without moving the map. Separate lines preserve intervening roads and rated stretches. Install-time sync/IP disclosures and the OSM refresh privacy prompt were removed from the analysis UI at the user's request; privacy-policy disclosures remain available.


Generated POIs carry a versioned ownership marker and route-geometry fingerprint in their Komoot custom description. When route geometry changes, the extension clears their custom name, icon and identifier while retaining each routing waypoint. A pre-existing ordinary waypoint regains its original name. This check also runs before analysis, independently of the previous analysis key, and is suspended during insertion and while the extension is off. Manual custom POIs and generated POIs whose name, category or ownership description the user has changed are preserved. Older generated POIs without an ownership marker cannot be safely identified and remain untouched.
