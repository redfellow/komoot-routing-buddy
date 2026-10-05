# Local Finland release integration — bucket 6

Bucket 5 was accepted and pushed as `d8f5203`. The user reviewed and accepted bucket 6 implementation on 2026-10-05 and authorized its commit/push checkpoint. Packaged acceptance remains pending. **No extension build, package, version bump, tag, signing submission or release was performed.** Firefox validation remains deferred at the user's request.

## Release-data contract

The user confirmed **the latest Geofabrik Finland extract, with a maximum source age of seven days (168 hours)**. The provider identity is checked through its dated latest-file redirect, source size, checksum and actual coverage polygon. Source time is the PBF replication timestamp, not the download or validation date.

`npm run data:release` prepares or reuses a snapshot only when it matches current provider metadata and passes all checks. Preparation uses the pinned native command against the dated source URL, retaining full Finland and existing extraction scope. The provider is checked again before publishing the selection so a newly published extract during preparation cannot silently become an old release candidate.

Checks in `scripts/local-osm/validate.mjs` include:

- Supported schema, finite/closed coverage geometry and permitted shard filenames.
- Provenance, source timestamp, extraction scope and ODbL attribution.
- Every compressed checksum, declared compressed/raw size and record count.
- Unique feature IDs, valid coordinates, complete way membership and geometry within directory bounds.
- Hazard nodes belonging to retained ways, with matching coordinates. A second streaming pass avoids retaining every Finland node ID in memory.
- Latest-source identity and the approved age cutoff for release use.

A new prepared directory is selected by atomically replacing `local-osm-data/release.json` after validation. The pointer pins its manifest SHA-256. Failed download/preparation/validation leaves the previous selection intact but stops the release; it does not authorize shipping that selection instead. Generated country files remain ignored by Git. Old prepared directories are retained for deliberate maintenance rather than silently deleting potential archives.

## Commands and packaging

Set up the pinned Python environment as described in [LOCAL-OSM-DATA.md](LOCAL-OSM-DATA.md), then:

```sh
# Produces data only, without an extension build:
npm run data:release

# Checks a prepared directory, optionally with an age limit in hours:
npm run data:validate -- local-osm-data/finland-YYMMDD-CHECKSUM-ID 168

# Only when a release/package has been explicitly authorized:
npm run package
```

Packaging runs native preparation tests, fresh data preparation, regression tests, the release gate, both browser builds, validation of the copied snapshots, Firefox linting and ZIP generation. Both outputs contain `data/finland/manifest.json`, compressed spatial files and `LICENSE.txt`. Country data is readable only from the extension origin; it is not added to web-accessible resources.

ZIPs are staged, checked and published directly to `artifacts/` with `chrome--` / `firefox--` prefixes. No artifact browser subfolders are introduced. Firefox candidates exceeding 200 MB stop before publication: Mozilla's signing submission limit applies to its self-distribution workflow too. Current measured data payload is about 151 MB, leaving headroom; actual ZIP size is still unverified. See [Mozilla submission/self-distribution documentation](https://www.extensionworkshop.com/documentation/publish/submitting-an-add-on/).

`npm run build` remains a code-only developer build. It is not a release/package path and does not bypass the data gate in `npm run package`. Runtime-copy definitions and build-test expectations were updated; build tests were not executed in this bucket.

## Initial installation

On extension installation/update/startup, the background coordinator checks for a bundled snapshot. If no snapshot is installed, or the bundle is newer, it opens an inactive `Local Finland data` import tab. Initial bundle import is independent of the weekly public-download opt-out because it reads packaged files only.

The existing worker and Web Lock perform resumable per-file validation and atomic activation. A newer locally updated snapshot is retained. Interrupted import resumes validated files. Existing active data remains available on corrupt/failed imports. A packaged-data marker distinguishes releases from code-only checkouts without requesting nonexistent extension resources. Source checkouts without packaged data continue to expose prepared-folder import; they do not pretend to contain a release bundle.

Successful import notifies open maps and invalidates stale checker results. The automatic import tab closes on success. Same-generation/older bundles are not repeatedly imported. Failed imports retain a retry status/backoff.

## Verification

- Full prepared Finland snapshot passed the new record, checksum, bounds and membership validator: **1,149,167 ways + 28,006 hazard nodes**, 151,123,317 compressed bytes. This was the existing September 30 fixture; it is not represented as the current latest release candidate.
- The actual bundle loader imported that full snapshot in a disposable Chrome worker in **8.01 seconds**, returned covered query data, made **zero provider requests**, and skipped reimport with one metadata read. This serves existing prepared files locally; it does not validate a generated ZIP or unpacked packaged install.
- Peak sampled entire disposable browser RSS was **1.64 GB**, and installed IndexedDB use **152.0 MB**.
- Deterministic tests cover stale/nonlatest/corrupt data, pinned-manifest changes, cutoff boundaries, missing/mismatched hazard membership, unchanged selection on failure, bundled import without provider access, failed and resumed initial imports, and installation despite weekly-download opt-out.
- **191 non-build Node tests pass.** Seven pinned-native preparation tests pass, including the new dated-source CLI test.
- Actual build tests, lint/signing, ZIP sizes and packaged desktop acceptance remain pending explicit authorization. Firefox checks were skipped as requested.

## Mobile feasibility assessment

No mobile support claim or automatic-update policy change is made in this bucket.

Firefox for Android is a plausible extension target, but requires platform/API compatibility review and device testing; Mozilla documents platform-specific differences and testing in its [Android extension guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/). Brave's documented extension installation flow establishes desktop Chromium support, not a verified mobile deployment for this project. See [Brave's extension guide](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave).

The prepared ~151 MB bundle/local lookups are the promising part. Weekly raw-country preparation downloaded ~770 MB and consumed several GB of temporary disk plus ~2.1 GB sampled whole-browser RAM in desktop tests. **Inference:** the full background rebuild is likely the limiting mobile feature, especially under OS tab suspension, memory pressure and battery/thermal constraints. Desktop speed measurements do not establish mobile speed or update reliability.

Before marking a mobile platform supported: choose actual target browser/device; verify sideload/signing, IndexedDB/permissions, worker/Web Locks/CompressionStream support, background-tab lifecycle, offline overlays/checks, installation/update time, disk/RAM and touch UI. Any switch to regional downloads, a separate data-download distribution or disabling weekly rebuilds on mobile needs explicit user agreement. Full-Finland coverage/defaults remain unchanged.

## Remaining acceptance

Bucket 6 code can be reviewed before any build. When separately authorized, run the guarded package workflow, inspect actual ZIP sizes and initial installation, then complete the desired desktop browser checks. After the user accepts the feature as finished, mark the plan completed and remove its active-project section from AGENTS.md. That final cleanup has not happened yet.
