# Local Finland OSM: bucket 1 findings

2026-10-02. **Investigation reviewed and accepted. All three proposed direction decisions approved; investigation committed and pushed as `d2c8952`.**

## Recommendation

Proceed with full-Finland local data preparation. No evidence yet warrants excluding the north. A conservative export retaining current query semantics is about **154.5 MB gzip**. Local indexed lookup appears promising for the five-second target, but browser and real-route acceptance remain unverified.

Prefer bundled, spatially addressable data prepared by the release command. Avoid one giant GeoJSON file or importing a million individual objects before the extension can become useful. Consider immutable compressed chunks plus a compact spatial directory; benchmark the final representation in bucket 3. This is a recommendation, not an approved format.

Weekly automatic updates without project hosting are the major unresolved engineering cost. A public provider supplies raw Finland data, not our prepared 154.5 MB bundle. A full download and browser-side rebuild is a correctness-first candidate, requiring a bounded, resumable importer. Incremental updates could save bandwidth but are not a safe shortcut without additional topology/state machinery.

## Measured results

Measurements are preserved in [LOCAL-OSM-MEASUREMENTS.json](LOCAL-OSM-MEASUREMENTS.json). Decimal MB/GB below.

| Measurement | Result |
|---|---:|
| Full Finland PBF download | 768,993,576 bytes (769.0 MB) |
| Download on this connection | 60.78 seconds |
| Required five-way-type export, including hazard nodes | 714,003,260 bytes raw; 154,526,183 bytes gzip |
| MTB-rated ways alone, diagnostic comparison only | 132,238,997 bytes raw; 28,549,603 bytes gzip |
| Other highway types, separate exploratory export | 647,316,695 bytes raw; 142,485,399 bytes gzip |
| Extraction of all three variants together | 205.56 seconds |
| Peak extraction process memory | 1,750,417,408 bytes |
| Disposable SQLite JSON-record + R-tree database | 901,414,912 bytes; 19.70 seconds to create |
| Synthetic 50.4 km corridor, first measured run | 0.788 seconds total |
| Same corridor, repeat | 0.770 seconds total |
| One daily raw change file, sequence 4927 | 1,323,377 bytes gzip |

The required export contains **1,149,167 ways**, **12,821,236 way vertices** and **28,006 hazard member nodes**:

- 476,664 tracks; 306,189 paths; 217,193 footways; 148,521 cycleways; 600 bridleways.
- 196,223 ways have valid S0–S5 MTB scales, including +/- modifiers.
- 574,092 selected ways lack surface tags. Dropping these would erase unknown-surface reporting.
- Other highway types add 1,071,110 ways. They are not part of current query scope; adding them as matching competitors is a separate accuracy/scope decision, not included silently.

The rated-only comparison omits hazard nodes and is **not a proposed complete bundle**. Even adding its nodes would not restore unrated matching competitors or unknown-data reporting.

### Measurement method and limits

Environment: ARM64 MacBookAir10,1, 16 GiB RAM, Python virtual environment with pyosmium 4.3.1. All scripts, downloads and databases are under `/tmp/krb-local-osm`; no runtime, build or release code was changed for this bucket.

Source URL `finland-latest.osm.pbf` resolved to `finland-260930.osm.pbf`. Embedded replication timestamp: **2026-09-30T20:22:42Z**, sequence **4927**. Download MD5 `d77aaee715dfa708ad5f1b43357dcd87` matches the provider's `.md5`. Freshness must use source metadata, not our download date. A newer dated file was unavailable when checked.

The disposable `measure.py` streams the PBF using pyosmium, native node-location indexing and an empty-tag filter. It writes gzip-level-6 NDJSON in Overpass-compatible shape: original IDs, node membership, full coordinate precision and the same 15 consumed tags. Selected ways are non-area path/track/footway/bridleway/cycleway; hazard nodes are selected by the same tag keys and actual membership as current requests. All three outputs were produced together, so the timing/memory figures are not isolated estimates for a future single-output production command. An earlier unfiltered Python-callback attempt was interrupted and is excluded from the recorded completed-run figures.

`index.py` stores required-export records in SQLite with an R-tree over geometry bounds. `bench.mjs` uses the existing extension's area generation, conversion and analysis against the resulting local query results. The synthetic corridor covers 52 cells and returns 9,209 features. First-run query/read/JSON-export time was 0.388 s, conversion 0.133 s and analysis 0.210 s; the total includes the helper-process and JSON handoff. Operating-system caches were not flushed. These are **not cold-disk, IndexedDB or browser measurements**.

The GPX path shown in the IDE was absent from disk. No other personal GPX was substituted. The synthetic line is not a navigable trail route: only about 0.47 km matched eligible trails, so this probe does not establish worst-case analysis cost or real-route correctness. Real 50–100 km route acceptance remains required.

The raw snapshot fits the one-to-two-minute download preference on this connection only. At 10 Mbit/s it would take roughly ten minutes before processing; the prepared 154.5 MB bundle roughly two minutes before overhead. No universal installation-time promise is justified. The measured SQLite database is a deliberately simple research representation, not the proposed shipped format or an IndexedDB size estimate.

## Data contract to preserve

Retain IDs and geometry, node membership for hazard association, and `highway`, `area`, `mtb:scale`, `width`, `est_width`, `surface`, `obstacle`, `overgrown`, `barrier`, `hazard`, `hazard:forward`, `hazard:backward`, `layer`, `bridge`, `tunnel`.

Keep unrated paths and current competing cycleway geometry even though cycleways are excluded from trail warnings. Preserve actual node membership; coordinate proximity is insufficient for obstacle association. Map overlays and Check trails have different selection rules; run their existing converters over equivalent records rather than narrowing the dataset to the checker’s eligible subset.

Store the extract's actual coverage polygon, snapshot timestamp, sequence, schema version, counts and integrity metadata. Do not treat a rectangular Finland bounding box as complete coverage. Geofabrik preserves crossing ways, but geometry outside the extract polygon does not establish complete surrounding coverage. Border-spanning requests need local/remote coverage accounting.

An empty result within valid coverage is authoritative until updated. Outside coverage, or after integrity failure, use existing API fallback. Keep the immutable regional snapshot separate from the seven-day API cache and its eviction budget. Regional snapshots must not disappear merely because that cache expires or reaches its 512 MiB limit.

## Provider, licensing and browser findings

**Geofabrik is the preferred source.** Its public country PBF downloads are suitable for reproducible local preparation. It documents daily snapshots, extract polygons and change files; replication history lasts 100 days. Public files omit contributor personal metadata. The sampled daily change contains 38,341 nodes, 4,683 ways and 175 relations; one day is not a representative weekly bound. [Provider downloads](https://www.geofabrik.de/data/download.html), [technical details](https://download.geofabrik.de/technical.html).

**BBBike is an alternative for manual extracts**, but its custom flow requires email and a generation queue, making it a poor default for unattended weekly updates. Its documentation describes a 2–7 minute generation period before downloading. No request or email was submitted. [BBBike extract help](https://extract.bbbike.org/extract.html).

Public availability is not an availability guarantee or a verified allowance for unlimited fleet traffic. No provider-specific automated-client quota was established in this investigation. Before broad rollout, confirm acceptable usage; check snapshot identity before downloading, stagger update checks, back off errors and resume interrupted transfers.

Derived OSM data must carry attribution and the applicable ODbL obligations, separately from the code license. Preserve source/provenance and offer the derived database under its data license. [Geofabrik licensing](https://www.geofabrik.de/data/download.html), [OSM copyright](https://www.openstreetmap.org/copyright).

Chrome documents that `unlimitedStorage` covers extension-origin IndexedDB and protects against quota eviction. Firefox documents persistent IndexedDB support under that permission. Neither removes RAM or physical disk constraints; reserve room for old/new generations and staging. Storage must be owned by the extension, not Komoot's content-script origin. [Chrome storage](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies), [Firefox permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions#unlimited_storage).

Background extension requests can use explicit provider host permissions rather than relying on ordinary page CORS. Redirect handling and actual Chrome/Firefox downloading remain implementation tests. Do not add provider access to arbitrary page scripts. [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

Long imports must survive shutdown: Chrome service workers have lifecycle limits and cannot be treated as permanent processes. Use persisted checkpoints and a bounded worker/import design; choose and validate browser-specific execution details in bucket 3/5. [Chrome worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Update design: approved direction, implementation still to validate

Accepted direction and remaining implementation decisions:

1. Bundle the prepared Finland snapshot and spatial directory in releases. No northern exclusion yet.
2. Investigate weekly full-PBF refresh/import in the browser first, keeping the old snapshot active throughout. Expect approximately 769 MB per changed snapshot at today's size, plus processing. Do not promise the native import performance in browsers.
3. Treat raw replication diffs as a later optimisation requiring proof. New relevant ways can refer to unchanged nodes absent from the filtered bundle; moved nodes require reverse membership, and deleted/retagged ways must remove old results. Simply filtering each diff by hazard tags loses correctness. Retaining all required supporting state or fetching dependencies changes the size/network tradeoff.
4. Use the existing Overpass path for **Update current route from OSM**, explicitly bypassing the normal cache. Store successful fresh coverage as an override, including empty results, so removed hazards are not resurrected from the base snapshot. Confirm override expiry/precedence in bucket 5. This deliberate manual request is compatible with eliminating routine queries, and was explicitly approved.
5. Releases must stop on unavailable/invalid required fresh data. Define an acceptable snapshot-age threshold before wiring this gate; daily publication is not guaranteed to arrive on a particular clock schedule.

## Bucket 1 checkpoint

**Conditional go** for local full-Finland data and bucket 2. Size looks manageable and the native lookup probe supports further investigation. Not yet proven: browser import/memory cost, final installation size, real-route five-second performance, robust weekly unattended updates, fleet provider terms, and mobile.

The user confirmed bundled full Finland, roughly 769 MB weekly raw downloads plus local processing as the update direction to prototype, and deliberate Overpass use for route-only manual refresh. This approves investigation of browser processing, not a claim that its performance or reliability has been established.

No extension code, build/package, commit or release was performed for bucket 1. The report review is complete. The user subsequently approved the investigation commit, pushed as `d2c8952`; see the bucket 2 implementation plan in [LOCAL-OSM-PLAN.md](LOCAL-OSM-PLAN.md).
