# Local OSM integration — bucket 4 checkpoint

Bucket 4 connects the reviewed local store to hazard overlays and trail checking. Weekly updates, manual current-route refresh and release bundling remain later buckets. No extension build/package or version bump was performed.

## Behaviour

- Background code loads `local-osm.js` before `hazards.js` in Chrome/Brave and in the Firefox build definition.
- Overlay and preload requests try exact local coverage first. A covered empty result is authoritative, even when the API cache has older hazards.
- Trail checks first attempt one local lookup for all route areas. A complete local answer feeds the existing route analyser directly and displays **Local Finland snapshot: YYYY-MM-DD**.
- Partial routes continue through the existing area collector. Locally covered batches/cells use the snapshot; uncovered or unusable data falls back to the existing API cache and provider/retry flow. The existing two-request API concurrency remains unchanged.
- Local query failure, including oversized result budgets or corrupt files, does not become an empty successful response. The existing fallback handles it. Missing local storage also leaves the existing online flow usable.
- The existing feature converters are reused, preserving full geometry, node membership, icon rules, trail eligibility, warning wording and unknown-data semantics. Local features count as cached in progress, never downloaded.
- Clearing the API cache does not remove regional snapshots. No weekly updater or route-refresh override policy was introduced here.

The whole-route shortcut is restricted to messages from this extension's Komoot tabs. Cancelling prevents late results from entering the dialog. The already-running background query may finish; message-level interruption of its bounded work is not implemented.

## Importing for development/testing

Settings now links to **Local Finland data**, an extension-owned page. Select the prepared folder containing `manifest.json` and the `.ndjson.gz` files. It processes the folder in a dedicated worker and shows progress, cancellation, retry/resume and active snapshot date.

This uses the browser's file selector, which labels access as “Upload”; the code reads the selected files locally into the extension's IndexedDB and does not upload them to a server. Keep the tab open while importing. Browser restart/cancellation preserves completed file checkpoints, and the previous active snapshot remains usable until activation.

The measured folder `/tmp/krb-local-osm/bucket2-snapshot` was successfully imported into the user's existing unpacked Brave extension. That profile now has the 2026-09-30 Finland snapshot. Refresh an existing Komoot tab after reloading the source extension. Prepared files are not yet automatically included by release scripts.

## Validation

**160 non-build tests pass.** New integration coverage includes:

- Identical local/API converter output for map features and route warnings.
- Hazard node membership and log icons.
- Authoritative covered-empty results overriding stale API cache data.
- Uncovered/corrupt local data falling back to the API cache.
- Whole-route collection without per-area API requests.
- Partial coverage not being advertised as complete.
- Optional local fast-path errors falling back to ordinary checking.
- Sender restrictions and background entry-point loading order.

The existing build test was deliberately not run, because it creates build outputs. Build definitions were updated for the new runtime files; actual Firefox extension packaging is still unverified.

### Real Brave/Komoot verification

Using the existing source-loaded extension, after importing the full snapshot:

- The [77.3 km test route](https://www.komoot.com/tour/3315077538/zoom) completed by the first UI observation after clicking, with a ~1.7 second tool round trip on the repeat check. This is an observational upper bound, not a precise internal performance measurement.
- Result explicitly displayed **Local Finland snapshot: 2026-09-30**, confirming the whole-route local path. It reported no issues on matched trails, with 0.25 km unknown surface, 0.05 km unrated unpaved paths and 0.17 km eligible trails without width data. Existing saved preferences were preserved (S1, 0.5 m, hazards disallowed).
- On the [singletrack test map](https://www.komoot.com/tour/3287158188/zoom), the floater reported 360 hazards / 494 features. A screenshot confirmed hazard icons and width labels rendered on the satellite map.
- That 3.67 km route's checker reported no eligible MTB-rated unpaved sections and 0.59 km unknown surface under the existing strict eligibility/matching rules. Komoot's “Singletrack” summary alone does not establish OSM eligibility. The integration does not reinterpret those rules.

### Isolated desktop integration measurements

A dedicated worker runs the production hazard acquisition and route collection functions, with API fetches replaced by a counted failure after import:

```sh
node scripts/local-osm/benchmark.mjs chrome /path/to/snapshot integration
node scripts/local-osm/benchmark.mjs firefox /path/to/snapshot integration
```

| Browser | 50.4 km first/repeat total | 100.8 km first/repeat total | API calls |
| --- | ---: | ---: | ---: |
| Chrome | 0.383 / 0.353 s | 0.417 / 0.401 s | 0 |
| Firefox | 0.400 / 0.383 s | 0.499 / 0.485 s | 0 |

These are synthetic straight corridors; only ~0.47–0.49 km matches eligible trails. They measure local acquisition plus conversion/analysis, not worst-case routed geometry, message serialization or installed Firefox lifecycle. The map probe also verified a legitimate empty local area with zero API calls. Exact measurements and live observations are in [LOCAL-OSM-INTEGRATION-MEASUREMENTS.json](LOCAL-OSM-INTEGRATION-MEASUREMENTS.json).

## Review checkpoint

Bucket 4 is ready for review, with live Brave verification and isolated Chrome/Firefox checks. Full installed Firefox/mobile acceptance and automatic installation belong to the remaining workflow. Changes are uncommitted. Preserve the older trail-classification/UI edits separately when preparing commits.

## Follow-up: known difficulty suppressed by missing surface (2026-10-02)

The user updated the singletrack fixture to 3.94 km and selected maximum S0. A local diagnostic of its current geometry reproduced the live result. Matching finds approximately 255 m of S1 paths (ways 444061049, 889034528, 881436471) and 592 m of S2 paths (861029964, 442602842, 863469526, 442072520). These ways have MTB ratings but no `surface` tag. The existing surface eligibility gate skips them before difficulty/width/hazard checks. This is not lost data in the snapshot or failed route matching.

The rest is largely explicitly excluded cycleways (including fine-gravel cycleways with S0- ratings). Do not change that exclusion while addressing this issue.

Proposed correction pending explicit confirmation: retain unknown-surface reporting, but check known difficulty, width and hazards on MTB-rated path/track classes when surface is absent. Do not infer an unpaved surface. Keep roads/cycleways and explicitly paved paths excluded. This changes the earlier unknown-surface eligibility decision and needs user review before implementation. Bucket 4's classification acceptance is reopened until resolved.

### Approved correction

The user confirmed maximum S0 and explicitly requested assuming MTB-rated paths without a surface tag are unpaved. The shared classifier now does so for both line and member-node checks. Explicitly paved paths, roads and cycleways remain excluded; unrated missing surfaces and explicit unknown/mixed surfaces retain unknown reporting. The dialog help and checker documentation explain the assumption.

Replaying the captured 3.94 km route against the snapshot now assesses 892 m and reports the S1/S2 difficulty warnings; 270 m lacks width data. The route geometry is a private local diagnostic, not a committed fixture. Synthetic regressions cover the same missing-surface case, threshold equality, width/hazard checks and exclusions. No live page reload was forced because the editor may have unsaved changes. No build or package was run.
