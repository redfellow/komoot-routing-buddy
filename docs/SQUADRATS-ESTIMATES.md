# Planned Squadrats gains

Implemented in the working tree on 2026-10-16; not built, committed or released. The 1.8.0 release artifacts remain unchanged.

## Verified sources

Official rules: https://squadrats.com/rules . Read in Brave because the ordinary web fetch returned HTTP 403.

The rules define Squadrats, Yard, Übersquadrat, Squadratinhos, Yardinho and Übersquadratinho. The smaller grid has 64 cells per large cell. Yard is the largest connected component of collected cells whose four cardinal neighbours are also collected. Übersquadrat is the largest fully collected square, measured by side length. The same rules apply to the smaller grid.

Read-only inspection of the installed Squadrats page script confirmed that, when its collection request succeeds, it populates `squadrats.raw[14]` and `squadrats.raw[17]` with Sets from the full raw collection. Existing KRB map integration already recognizes `squadrats-new-squadrats` and `squadrats-new-squadratinhos`. This makes all six estimates feasible when the complete collection and current route data are ready. Brave inspection subsequently confirmed `x-y` string keys, with `squadratStruct` splitting the two coordinates. Squadrats' native tiler returned `9238-4665` and `9239-4665` for a synthetic segment from (23, 61) to (23.01, 61). The implementation calls that native tiler with the complete Komoot coordinate array, so it inherits Squadrats' segment/corner-crossing rules. The inspected Komoot tab had not loaded its Squadrats collection; actual account-total agreement has not been verified.

## Calculations

Read the existing collection without mutating it. Pass the full Komoot route to the already loaded `MAP.POLYLINE.encodePolyline` and `polylib.getSquadrats` functions. Do not approximate the boundary rules or count only tiles currently rendered in the viewport. Missing native functions or unloaded collections produce an unavailable state, never a synthetic zero.

For each scale, compare the collected set with its union with the planned tiles:

- New cells: distinct planned cells not already collected. Repeated visits count once.
- Yard growth: difference between the largest connected components of four-neighbour-complete cells before and after the ride. A connecting cell can cause a large gain; the result is not the number of new cells adjacent to today's Yard.
- Largest-square growth: compare the largest fully filled squares before and after. Show the side-length change and the resulting dimensions, not an area difference disguised as a side-length gain.

Calculate both scales independently. Do not derive new Squadratinhos by multiplying new Squadrats by 64. The engine uses sparse numeric cell sets, filled-square dynamic programming and connected-component traversal. It yields to the event loop every 2,048 checkpoints and supports aborts. Each grid is bounded to 500,000 cells and the input route to 250,000 coordinates. There is no world-sized bounding-box allocation.

## Settings and placement

Add `Estimate gained Squadrats` to the Squadrats settings group, off by default. This is separate from its opacity and layer-order controls. Require an available, loaded Squadrats collection; do not introduce new host permissions, account access or background account-data downloads. The master KRB Off switch suspends estimation too.

Place a compact `Estimated Squadrats gains` banner immediately after Distance / Ascent / Trails & Technical and before The shape of your ride. Use purple rounded chips, green regular-grid figures and cyan smaller-grid figures, with distinct geometric icons. Keep visible text labels or accessible names rather than relying on icons alone. Use locally authored SVG/CSS icons rather than extracting third-party artwork.

Default to positive gains only, in Squadrats' order: Squadrats, Yard, Übersquadrat, Squadratinhos, Yardinho, Übersquadratinho. If nothing grows, show `No new Squadrats on this route`. A largest-square chip can show `18×18 → 20×20` in its expanded detail, with `+2` as the compact side-length gain. The banner must wrap cleanly in the analysis panel.

Unavailable or incomplete data is not zero gain. Show a short waiting/unavailable state, with precise scope if only some metrics are known. Never imply that an on-screen subset of visited tiles is a complete collection. An empty collection is valid only when Squadrats explicitly confirms that loading succeeded.

## Freshness and validation before implementation acceptance

Tie results to route geometry and the current loaded collection. Retire stale results on route changes, account/collection changes or extension disablement; reject late results from older generations. Predicted results remain estimates until the recorded activity is processed by Squadrats.

Automated tests cover unique counts, independent grid sizes, diagonal contacts, a bridge joining two Yards, disjoint components, filled-square growth, Yardinho/Übersquadratinho, zero gains, partial data, invalid/oversized input, world-spanning sparse cells, cancellation, native tiler delegation, setting/master Off, generation changes and late results. The actual banner renderer and stylesheet were visually checked in a local preview using explicitly synthetic metrics; all six chips fit and wrap into two rows in the analysis panel. No fresh live account-total comparison or post-ride award comparison is claimed. No build, package, permission expansion or 1.8.0 release modification was made.


## Implementation

- `squadrats-estimate.js`: bounded native-data adapter and cancellable sparse award calculations; shared by the page bridge and isolated analysis UI.
- `map-bridge.js`: read-only access to already loaded Squadrats globals, route-bound requests and collection-generation notifications. An O(1) identity/size check runs with existing map polling and Squadrats source events. It does no tile copying or route processing while the setting or master toggle is off.
- `ride-dialog.js`: six labelled chips between stats and ride shape, positive gains only, dimension tooltips, partial/unavailable states, cancellation and request-generation checks. Collection changes refresh estimates without rerunning OSM trail checks.
- `settings.js`, `popup.html`, `popup.js`: normalized opt-in preference, saved through the existing browser sync settings.
- Manifest and runtime-file list: load the shared module in the isolated world and make it available to the page bridge. No permissions or hosts were added.

Local preview: `artifacts/squadrats-design/preview.html` (synthetic data, not a real account prediction). New source requires reloading the unpacked extension and the Komoot tab.

Final source verification: 359 non-build JavaScript tests passed, including the existing styling/source-event regressions. Syntax and whitespace checks passed. The new opt-in functionality is not included in the already published 1.8.0 packages. Live account totals and post-ride award agreement remain to be compared after loading the updated source with a ready Squadrats collection.
