# Local OSM storage and lookup — bucket 3 checkpoint

Bucket 2 was reviewed, committed and pushed as `7bd9c49`. Bucket 3 adds `local-osm.js` as a standalone classic-script module. It is **not loaded by the extension yet**. Map/checker integration belongs to bucket 4; raw-PBF weekly browser processing remains bucket 5 work.

## Storage and update behaviour

`KrbLocalOsm.create()` opens a separate `krb-local-osm-v1` IndexedDB database. It has no seven-day eviction and does not consume the Overpass cache budget. Compressed spatial files are stored individually, keyed by snapshot-manifest digest and filename. Metadata contains the active manifest, including exact coverage rings and spatial file bounds.

`importSnapshot(manifest, loadShard, options)`:

1. Validates the manifest schema, coverage, directory, sizes and counts.
2. Processes one file at a time. Verifies SHA-256, stream-decompresses NDJSON, checks coordinates, geometry/membership, directory bounds, raw size and record counts.
3. Commits each validated file to IndexedDB. Retrying the same manifest reuses completed files, including after closing and reopening the store.
4. After all files pass validation, atomically switches the active manifest. Compare-and-swap prevents an import in another context from overwriting a snapshot activated while it was working.

Until step 4, queries continue using the old snapshot. Queries pin one manifest ID and cannot mix old and new files. Corruption, cancellation, network failure and quota failure do not clear active data. There is no memory-only fallback pretending to be persistent storage.

Old and incomplete snapshot files are intentionally retained at this stage so concurrent readers and interrupted imports remain valid. Cleanup/retention must be connected to the update lifecycle before weekly updates are enabled; do not repeatedly import production snapshots indefinitely without that lifecycle. Disk use during replacement can approach two full snapshots, plus incomplete attempts. This bucket does not introduce a weekly updater.

## Lookup contract

```js
const store = KrbLocalOsm.create();
await store.importSnapshot(manifest, loadShard, { signal, onProgress });
const result = await store.query([
	[23.9, 60.9, 24.2, 61.2] // west, south, east, north
], { signal });
await store.close();
```

`loadShard(entry, signal)` returns a `Uint8Array` containing that file's compressed bytes. Acquisition is supplied by the caller, so the same importer can consume bundled or separately acquired files. Progress reports completed/total files and whether the latest file was reused.

The result contains `available`, per-box `covered`, snapshot identity/date, `elements`, and selected-file count. Elements use the same full OSM-style way/node representation as bucket 2. A missing snapshot returns unavailable; missing/corrupt active files throw instead of reporting an empty successful result.

The directory is sorted by western extent, filters complete file bounds against all requested boxes, and reads each selected file once per query. Files are streamed and records filtered by exact geometry bounds. Repeated/overlapping query areas deduplicate records. Full geometry and node IDs are retained. Bounds matching deliberately returns candidates, not a claim that a trail was traversed; the existing route matcher remains responsible for that decision.

Coverage uses the provider's polygon rings, not feature density or a Finland bounding box. A fully covered empty query is a valid empty answer. Holes, concave crossings and boundary contact conservatively report incomplete coverage. Bucket 4 must honor these flags when deciding whether API fallback is needed. Returned geometry outside coverage does not establish complete data there.

## Memory controls

- One compressed file is validated/decompressed at a time; no million-feature in-memory country object.
- Compressed hot-cache limit: 32 MiB, with LRU eviction.
- Maximum accepted file: 32 MiB compressed / 128 MiB raw.
- Maximum record line: 4 MiB; decompression cannot exceed declared raw size.
- Query result budget: 64 MiB estimated as twice the NDJSON character count. Requests exceeding it fail explicitly; callers can use smaller batches.

These bound retained data/encoded inputs, **not exact JavaScript heap usage**. Object overhead, stream buffers, garbage collection and browser processes consume additional memory. A failed oversized query does not return a truncated result.

The module can run in a worker. The benchmark uses a dedicated worker; choosing the extension's worker lifetime/entry point belongs to integration. [DecompressionStream supports workers](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream); [IndexedDB transaction completion](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction) provides the publication checkpoint. Do not assume a long-lived MV3 service worker for full-data imports.

## Validation and measured results

Run the relevant tests without building the extension:

```sh
node --test test/local-osm.test.mjs test/osm-cache.test.mjs test/hazards.test.mjs test/route-check.test.mjs
```

**82 tests pass**, including 11 new storage tests: persistence, empty coverage, geometry/membership, checksum/raw-size rejection, interrupted import resume, old-snapshot continuity, concurrent activation protection, quota failure, coverage holes/concavity, deduplication and memory budgets.

The reproducible macOS browser harness launches an installed browser with a disposable profile, serves only benchmark code/data on loopback, imports the full snapshot, runs cold/warm queries and removes its profile afterward:

```sh
node scripts/local-osm/benchmark.mjs chrome /path/to/snapshot
node scripts/local-osm/benchmark.mjs firefox /path/to/snapshot
node scripts/local-osm/benchmark.mjs brave /path/to/snapshot
```

Measured on the investigation Mac with the 2026-09-30 full-Finland snapshot:

| Browser | Full import + validation | Cold-store lookup + conversion + analysis | Warm-store total | Reported origin storage |
| --- | ---: | ---: | ---: | ---: |
| Chrome | 7.67 s | 0.353 s | 0.345 s | 151.69 MB |
| Firefox | 7.72 s | 0.418 s | 0.360 s | 153.79 MB |
| Brave | 7.81 s | 0.380 s | 0.353 s | 151.69 MB |

All three returned 9,201 records from ten spatial files for 52 requested areas, with the same four warnings. Resident compressed query data was 6.35 MB. An independent exact-bounds filter of the earlier native reference also returns 9,201 records; its original SQLite R-tree query returned eight extra candidates due to outward-rounded bounds.

Important limits:

- This is a **50.4 km synthetic straight corridor**, not a real routed ride. Only 0.47 km matched eligible trails. It does not establish worst-case route-matching performance or the real-route five-second acceptance target.
- Cold-store means a fresh module instance and empty compressed cache after closing/reopening IndexedDB. The OS/browser disk cache was not flushed.
- Source transfer was localhost. This measures prepared-data import, not a network download or raw-PBF processing.
- Profiles ran headlessly on an ordinary local web origin, not within installed extension origins or mobile browsers.
- Peak summed process-tree RSS samples were 1.78 GB Chrome, 2.20 GB Firefox and 1.04 GB Brave. These include browser overhead and shared-page accounting, not isolated module heap; they must not be reported as the cache's memory usage.
- Browser versions, timing breakdowns and exact storage/RSS values are in [LOCAL-OSM-STORAGE-MEASUREMENTS.json](LOCAL-OSM-STORAGE-MEASUREMENTS.json).

Bucket 3 was reviewed and approved by the user. No extension build/package was run. Bucket 4 must integrate both features and check actual routed/live behaviour before asserting the original performance goal is met.
