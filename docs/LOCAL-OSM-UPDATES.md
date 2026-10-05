# Local Finland updates — bucket 5

Bucket 4 was accepted and pushed as `428c809`, with the missing-surface correction in `0f6a37a`. Bucket 5 adds browser preparation and update controls. The user reviewed bucket 5 and approved its commit/push checkpoint on 2026-10-05. No build/package or release was run. Firefox validation was stopped at the user's request.

## User controls

The **Local Finland data** link in extension settings opens an extension-owned page with:

- Prepared-folder import, retaining resumable import from bucket 4.
- **Automatically update Finland data weekly**, enabled by default.
- **Update Finland data**, with a download/time confirmation.
- Progress by phase: download, source checksum, trail preparation, compression and validated import.
- **Pause update**, keeping the active snapshot and saved progress.
- Active snapshot source date, way count, payload size and last update/error status.

Automatic updates use a temporary inactive browser tab, as approved. The tab closes after successful activation or an unchanged-source check. Errors and cleanup warnings leave it available for review. Closing it pauses work; disk checkpoints survive. The updater restores its alarm on installation/startup/source reload, checks eligibility at two-hour intervals after a staggered initial check, and downloads at most weekly after successful checks. Errors back off for six hours. It waits for an initial local snapshot; bundled installation belongs to bucket 6.

On successful activation, open Komoot pages are notified to reload hazards and invalidate old trail-check results. Unchanged snapshots do not cause this notification. The public provider can be unavailable or slow; a weekly schedule does not promise a successful update every week.

## Download and preparation

`osm-download.js` discovers the dated Geofabrik Finland PBF through the provider's latest-file redirect. It validates the dated URL and size, reads its published MD5 and the actual `.poly` coverage, then saves sequential 8 MiB chunks in a separate staging IndexedDB database. Interrupted transfers resume from the last committed byte offset using HTTP Range. A changed source identity restarts staging. Size/range/checksum failures never activate a snapshot. Source checksum is rechecked on resumed runs.

`osm-pbf.js` reads one bounded zlib/raw PBF block at a time according to the [upstream file and primitive schemas](https://github.com/openstreetmap/OSM-binary/tree/master/osmpbf). It supports the current sorted Geofabrik extract, required OsmSchema-V0.6/DenseNodes features and exact supported integer/coordinate precision. Unsupported formats, missing nodes, duplicate/out-of-order IDs and oversized blocks fail clearly. It is not a general historical/replication-diff parser.

`osm-prepare.js` stores sorted node-coordinate pages on disk rather than retaining a country-wide node map in RAM. A bounded 64 MiB coordinate-page cache resolves relevant way geometry. It retains the same five way classes, 15 consumed tags and hazard-node membership as the native command. Each completed PBF block and its output are committed together. On restart, processing continues at that block boundary; compression and validated import also resume. Compressed shards use the existing snapshot schema and integrity checks.

The old snapshot remains available until `local-osm.js` atomically switches generations. Web Locks prevent competing import/update tabs. Completed preparation/download staging databases are deleted after activation or unchanged detection. Inactive snapshots are eligible for cleanup after 24 hours, abandoned partial imports after 14 days. Reader leases protect live queries during cleanup. A cleanup failure is reported without hiding an already activated valid snapshot. Previously installed generation metadata is registered on replacement so the bucket 3/4 snapshot can be collected too.

The manifest adds `alarms` and host access to `download.geofabrik.de` for extension-owned bulk acquisition. No location or route data is sent to Geofabrik. The existing Overpass providers still receive area bounds only for manual refresh or fallback. The provider's [download documentation](https://www.geofabrik.de/data/download.html) and [technical notes](https://download.geofabrik.de/technical.html) describe the public extracts. No hosted preprocessing infrastructure was introduced.

## Current-route refresh

The trail checker has **Update current route from OSM**. Confirmation explains that requests may take several minutes or longer and can pause on timeouts; there is no invented precise duration. It requests only the areas along the captured current route, using existing batching, two-provider concurrency, cooldowns and resumable retry checkpoints. It explicitly bypasses the local snapshot and ordinary API cache. Cancel stops scheduling further areas; dispatched requests may finish and persist.

Successful complete route areas are saved in a separate seven-day override cache, including empty results. Errors do not create overrides. A regional snapshot with a later source date supersedes the override. Normal map and checker reads apply the override before base features: old geometry inside refreshed coverage is removed, fresh geometry is clipped to its authoritative coverage, and unaffected geometry remains. The freshest override wins in overlaps. Full local route lookup still works in one operation with these overrides.

**Clear OSM cache** also clears route overrides, while leaving the regional snapshot installed. Refreshing a route updates the current map overlay and immediately displays the new trail-check results. The result shows the regional source date and/or route refresh date where applicable.

## Validation and limits

Measurements: [LOCAL-OSM-UPDATE-MEASUREMENTS.json](LOCAL-OSM-UPDATE-MEASUREMENTS.json).

- Full Finland browser preparation: **422.8 seconds**, plus **7.2 seconds** validated import in disposable Chrome.
- **All 1,177,173 records** matched the native command's canonical output, including every retained tag, coordinate and node reference. Counts: 1,149,167 ways / 28,006 hazard nodes.
- Prepared gzip payload: **150.15 MB**. Compression/order differs from Python; records are equivalent.
- Peak sampled entire browser process-tree RSS: **2.11 GB**. Coordinate cache stays under 64 MiB; this is not a claim that total worker/browser memory is 64 MiB.
- Temporary IndexedDB use in that preparation test: **2.97 GB**, excluding the separately served raw source. A real download adds about 770 MB and space for the active snapshot. Allow several GB free disk space.
- After lifecycle changes, synthetic 50/100 km local collection + analysis remained **0.34–0.44 seconds**, with zero API calls. These are corridors with little matched trail distance, not worst-case navigable route acceptance.

**183 non-build tests pass.** Small fixtures cover native-format preservation, block resume, truncated data, transfer checksum/range resume, failed-update old-data continuity, atomic worker activation/cleanup, weekly scheduling and opt-out, seven-day/newer-snapshot precedence, authoritative empty overrides, partial-coverage clipping, and cleanup during an old-generation reader. Build tests are intentionally excluded.

Live Brave/source-extension verification downloaded and checksummed the public Finland extract, paused preparation at 44%, and resumed from the persisted checkpoint without another bulk download. The September 30 snapshot stayed active during preparation. Successful activation displayed **2026-10-04 · 1,150,527 ways · 150 MB**. A subsequent unchanged-source automatic tab skipped bulk acquisition and closed itself. DevTools confirmed both staging databases were absent; only the regional store and ordinary API cache remained, using **309.6 MB** including the previous snapshot retained for 24 hours. The final update page was visually inspected. Desktop Firefox, mobile and packaged-install/release acceptance are not claimed here. No north-Finland exclusion or data-scope reduction was made.

## Review checkpoint

Review bucket 5's update behaviour, timing/disk requirements, controls and seven-day route refresh semantics. After acceptance, commit/push this bucket and then start bucket 6 release integration. Preserve the user's independent route sample-limit edit separately when staging.
