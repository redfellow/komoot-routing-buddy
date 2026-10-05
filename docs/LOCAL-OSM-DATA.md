# Preparing local Finland data

The native command prepares the same snapshots now consumed by the extension. For guarded release selection and bundling, see [LOCAL-OSM-RELEASES.md](LOCAL-OSM-RELEASES.md); the original command remains useful for standalone preparation.

## Setup and command

Python 3.9+ and a native platform supported by the pinned PyOsmium wheel are required. The measured environment is macOS ARM64. Create the local environment from the repository root:

```sh
python3 -m venv .venv-local-osm
.venv-local-osm/bin/python -m pip install -r scripts/local-osm/requirements.txt
npm run test:local-osm
npm run data:prepare -- --output local-osm-data/finland-snapshot
```

The command downloads Geofabrik's current Finland PBF, obtains the checksum for its resolved URL and downloads the Finland coverage polygon. It validates the checksum before processing. Network failures stop preparation; rerunning currently restarts the download. Interrupted-download resume and weekly browser acquisition are not implemented in this bucket.

For reproducible preparation from an already downloaded dated source:

```sh
npm run data:prepare -- \
  --source /path/to/finland-260930.osm.pbf \
  --coverage /path/to/finland.poly \
  --md5 d77aaee715dfa708ad5f1b43357dcd87 \
  --source-url https://download.geofabrik.de/europe/finland-260930.osm.pbf \
  --output local-osm-data/finland-260930
```

Use the matching provider checksum, not the example checksum for a different snapshot. Archive the polygon with the source for reproducibility: the provider's current polygon can change independently of a dated PBF. MD5 detects mismatch against the HTTPS provider's checksum; it is not a digital signature. The manifest also records SHA-256.

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

Retained ways are non-area `path`, `track`, `footway`, `bridleway` and `cycleway`; unrated and paved competitors remain available for matching. Hazard-tagged nodes are retained only when members of these ways. This reproduces current acquisition scope, not a new trail-eligibility policy. Relations and unrelated metadata are omitted.

Compression uses deterministic gzip headers and stable JSON serialization. Identical source bytes, polygon and source URL with the pinned toolchain produce identical files. Cross-platform/zlib byte identity is not guaranteed. Runtime/memory measurements are printed separately, not included in the reproducible manifest.

Bucket 3 must validate browser lookup/import costs before accepting this as the final installed representation. Directory bounds may be broad for long ways, increasing candidate reads. No browser memory or route-check performance claim follows from the native preparation benchmark.

Data is © OpenStreetMap contributors, under [ODbL](https://www.openstreetmap.org/copyright). Preserve the manifest attribution and source provenance when distributing the derived database.

## Bucket 2 full-Finland measurement

The dated 2026-09-30 source produced **1,149,167 ways and 28,006 hazard nodes** in 1,178 spatial files. Compressed payload: **151.12 MB**, plus **0.37 MB** manifest (decimal units). Preparation from the existing verified PBF, including output read-back, took **207.3 seconds** with **2.01 GB peak RSS** on the investigation Mac. Download, browser import and extension packaging are excluded.

Exact values and shard sizes are in [LOCAL-OSM-PREPARATION-MEASUREMENTS.json](LOCAL-OSM-PREPARATION-MEASUREMENTS.json). The measured output is local at `/tmp/krb-local-osm/bucket2-snapshot`; it is not checked into Git and temporary files are not durable distribution assets. Six native fixture tests and 65 existing hazard/route tests pass. Browser performance remains a bucket 3 acceptance question.

A full record-by-record canonical-JSON comparison against the bucket 1 export matched all **1,177,173 records**, including every retained tag, coordinate and node ID, with no missing or extra records. The largest uncompressed shard is 22.60 MB; browser import must stream or otherwise bound processing, rather than assume all shards are small.
