# Local Finland OSM data

Full Finland data supports both map hazard overlays and trail checks. Release packages bundle a prepared snapshot; developer code-only builds require a prepared-folder import. For packaging and distribution, see [RELEASING.md](RELEASING.md).

## Setup and command

Python 3.9+ and a native platform supported by the pinned PyOsmium wheel are required. The measured environment is macOS ARM64. Create the local environment from the repository root:

```sh
python3 -m venv .venv-local-osm
.venv-local-osm/bin/python -m pip install -r scripts/local-osm/requirements.txt
npm run test:local-osm
npm run data:prepare -- --output local-osm-data/finland-snapshot
```

The command downloads Geofabrik's current Finland PBF, obtains the checksum for its resolved URL and downloads the Finland coverage polygon. It validates the checksum before processing. Network failures stop preparation; rerunning currently restarts the download. Browser updates use a separate resumable download and preparation pipeline described below.

For a saved source, the preparation command also accepts `--source`, `--coverage`, `--md5` and `--source-url`. Use the matching dated provider URL and checksum, and preserve its coverage polygon for reproducibility.

Choose a new output directory for each snapshot. Existing destinations are refused. A sibling staging directory is renamed only after successful extraction and read-back validation. Ordinary failures remove staging; a killed process can leave `.preparing-*` directories, which may be removed after confirming no preparation process is running. These are never completed snapshots.

Allow several GB of temporary disk space: raw PBF, node-location state, uncompressed shards and compressed output coexist during preparation. Bulk data and the local Python environment are ignored by Git. This standalone command neither builds nor packages the extension. The separate `data:release` command invokes it through the guarded release-data flow.

## Version 1 data contract

`manifest.json` contains:

- Schema version, region, OSM snapshot timestamp and replication sequence.
- Source URL, size, provider MD5 and SHA-256; polygon checksum.
- Exact provider polygon rings, including exclusion rings (`hole: true`). Coverage is independent of whether records exist in an area. A bounding box alone does not establish complete coverage.
- Retained tag and highway lists, counts, parser version and ODbL attribution.
- Sorted spatial directory: filename, complete geometry bounds `[west, south, east, north]`, record count, raw/compressed sizes and SHA-256 for every file.

Each `.ndjson.gz` contains complete OSM-style way or node records. Ways retain original ID, tags, ordered node IDs and full coordinates. Hazard nodes retain original ID, coordinates and tags. Records occur once, assigned by their first coordinate to a 0.25-degree grid. Directory bounds cover the **whole** geometry, including portions beyond that grid cell. A reader must select overlapping directory bounds, not infer file contents from its name. Node membership can cross files: readers needing associated hazards must join by ID after spatial lookup.

Retained ways are non-area `path`, `track`, `footway`, `bridleway` and `cycleway`; unrated and paved competitors remain available for matching. Hazard-tagged nodes are retained only when members of these ways. These matching candidates are broader than the trails eligible for checking. Relations and unrelated metadata are omitted.

Compression uses deterministic gzip headers and stable JSON serialization. Identical source bytes, polygon and source URL with the pinned toolchain produce identical files. Cross-platform/zlib byte identity is not guaranteed. Runtime/memory measurements are printed separately, not included in the reproducible manifest.

Directory bounds can be broad for long ways, increasing candidate reads. The reader filters candidate records by geometry after selecting files.

Data is © OpenStreetMap contributors, under [ODbL](https://www.openstreetmap.org/copyright). Preserve the manifest attribution and source provenance when distributing the derived database.

## Storage and lookup

`local-osm.js` stores compressed shards and snapshot metadata in the extension-owned `krb-local-osm-v1` IndexedDB database, separate from the Overpass cache. Import validates schema, coverage, checksums, geometry, sizes and counts one file at a time. Completed files persist as resume checkpoints. Activation is atomic: queries pin one generation and the previous snapshot remains available until validation succeeds.

Spatial lookup selects shards by complete geometry bounds and deduplicates records across requested areas. Coverage follows the provider polygon, including holes; a fully covered empty area is a valid answer. Uncovered areas and unusable local data use the existing online fallback. The route matcher still decides whether returned trails are actually traversed; see [ROUTE-CHECKER.md](ROUTE-CHECKER.md).

The compressed hot cache is bounded to 32 MiB; query results have a 64 MiB estimated budget. These are data limits, not total browser heap limits. Snapshot imports and raw preparation use workers rather than relying on an indefinitely running service worker. Reader leases protect active generations during cleanup.

## Installation and updates

Bundled installation automatically opens an inactive import tab, validates the packaged files, activates the snapshot and closes the tab on success. It does not download the raw country file. A newer installed snapshot is retained. Interrupted bundled imports resume packaged files; interrupted folder imports require selecting the same folder again.

The **Local Finland data** settings page provides folder import, **Update Finland data**, weekly automatic updates (on by default), progress and pause/resume. Weekly updates download the public Geofabrik extract and prepare it in the browser. A temporary inactive tab closes on success or an unchanged-source check; errors leave it available for inspection. The scheduler checks eligibility every two hours, downloads at most weekly after successful checks and backs off six hours after errors.

Download chunks and completed preparation blocks are checkpointed in IndexedDB. HTTP Range resumes transfers; changed source identity restarts staging. Provider checksum, format, geometry and import validation must pass before activation. Successful activation reloads open map hazards and invalidates old trail-check results. Old data stays available throughout an update.

Completed download/preparation staging databases are removed. Inactive generations become eligible for cleanup after 24 hours; abandoned partial imports after 14 days. Live reader leases defer cleanup. Cleanup warnings are reported even if activation succeeded.

## Current-route refresh

**Update current route from OSM** deliberately bypasses the Finland snapshot and normal API cache, after confirmation. It queries only areas along the captured route, using the existing batching, two-provider concurrency and resumable retries. Successful areas, including empty results, override the snapshot for seven days unless a newer snapshot has a later source date. Failed requests create no overrides; the freshest override wins where areas overlap.

**Clear OSM cache** clears online entries and route overrides, but keeps the installed Finland snapshot. Cancelling stops new work; already dispatched requests may finish and persist.

## Resources, privacy and support

The October 2026 full-Finland bundle is approximately 150 MB compressed. Prepared-data import measured about eight seconds on the investigation Mac. Browser raw-country preparation measured about seven minutes plus download time, with about 2.1 GB sampled whole-browser RAM and several GB of temporary disk use. These observations are not guarantees for other devices. Allow several GB of free disk space for updates and old/new generations.

Local matching stays in the browser. Geofabrik receives public-country download requests, without route geometry. Overpass receives area bounds for fallback or deliberate route refresh. Preserve OpenStreetMap attribution, source provenance and the ODbL notice in distributed data.

Desktop Chrome/Brave local installation, overlays, trail checks and update recovery were verified. Firefox package lint passes; final Firefox runtime acceptance was deferred. Mobile is not validated: raw-country preparation, memory use and background-tab suspension require device testing before support is claimed.
