# Local OSM data for Komoot Routing Buddy

Agreed with the user on 2026-10-02. All six buckets are completed and accepted. Retained as project history; Firefox runtime and mobile acceptance remain deferred.

## Goal and priorities

Provide local Finland OSM data for both hazard overlays and trail checking, avoiding routine Overpass requests within covered areas. Keep the existing API implementation as fallback outside local coverage or when local data is unusable.

Priority order: **checking speed > installation size > coverage > freshness**.

Target: check a previously unvisited 50–100 km route within covered Finland in **under five seconds once local data is ready**. Measure cold and warm lookup/analysis separately from installation and updates.

## Confirmed decisions

- Finland first. Prefer full Finland; consider excluding the northernmost parts only if measured size requires it and the user approves.
- Prefer bundled data. A separate initial download is acceptable if it can reasonably complete in one or two minutes; installation must not depend on dozens of unreliable Overpass requests.
- Both map hazard overlays and trail checking must work with the local dataset. Preserve the geometry, topology and attributes needed for reliable matching, classification and warnings; do not silently narrow the feature set to save space.
- Regional downloads and data updates independent of extension releases are acceptable.
- Prefer existing public OSM extract providers over Overpass for bulk data. No project-operated hosting or server infrastructure at this stage. Paid infrastructure may be revisited later.
- Aim for weekly automatic updates. Browser-side acquisition/processing from a public provider is a feasibility question, not an established solution.
- Manual refresh applies to the **current route**, not all Finland or just the viewport. Label the button **Update current route from OSM**. Confirm before starting and explain expected duration without inventing an estimate.
- Keep using the previous valid snapshot while updating. Switch only after successful validation; failure must leave the old snapshot usable.
- Trust valid local coverage until updated. An absence of hazard tags is not a reason to query the API automatically. Missing tags do not establish safe conditions.
- Provide a local data preparation command and integrate it into the release workflow. If required fresh data cannot be obtained/prepared, stop the release rather than silently shipping an older snapshot.
- Desktop Chrome/Brave and Firefox first. Assess mobile after desktop implementation is complete.
- Defer an installation-size budget until measurements exist. Browser packaging, storage permissions, quota and memory constraints still require verification; do not assume unlimited practical capacity.
- Frequent snapshots only reflect changes recorded in OSM; they cannot make mud or fallen-tree reports live.

## Existing behaviour to preserve

The checker uses Komoot route geometry and OSM matching; inspected geometry does not expose Komoot summary way types or shared OSM IDs. Current eligibility is unpaved path/track classes with an MTB scale, excluding cycleways, roads/streets and paved paths. MTB-rated path/track classes without a surface tag are assumed unpaved and assessed (user-approved correction on 2026-10-02). Unpaved paths without an MTB scale and remaining paths with unknown surfaces are reported separately. Keep needed competing geometry and obstacle membership when designing the extract. Any change to matching, eligibility, warnings or unknown-data semantics requires explicit user review.

Current worktree contains earlier trail-classification, wording, icon and compact-layout changes. These are separate from this project; do not discard or silently fold them into an investigation commit.

## Working agreement and checkpoints

Work on **one bucket at a time**:

1. Present its concrete plan and acceptance criteria before implementation.
2. Investigate or implement that bucket only.
3. Present reviewable outputs, validation and limitations.
4. Wait for the user's review and explicit approval before committing and moving to the next bucket. Follow repository push instructions for approved commits.
5. Record the checkpoint outcome, decisions and next action here so a new session can resume accurately.

Explicitly reconfirm decisions that change coverage, accuracy, distribution, freshness, maintenance or performance goals. Do not drift from the agreed intent or treat an unresolved feasibility assumption as approved architecture.

No build, packaging, version bump or release unless explicitly requested. Inclusion of the future preparation command in release scripts does not authorize running releases during development.

## Buckets

### 1. Measure feasibility — accepted, committed and pushed

Plan:
- Inspect current acquisition, normalization, cache, matching and rendering requirements.
- Verify public Finland extract options, freshness, browser access, attribution/licensing and provider usage terms.
- Download a current extract if appropriate and measure its size and the subset required by both features.
- Use disposable measurement scripts to assess processing, spatial indexing, storage and download costs. No extension or release implementation changes in this bucket.
- Assess whether weekly browser updates without our own hosting are practical, and whether route-only manual refresh still needs Overpass.

Checkpoint: measured raw/filtered/compressed sizes; provider recommendation; preservation of required fields/topology; desktop resource constraints; proposed distribution/update design; unresolved questions; go/no-go recommendation. Do not promise the five-second target or one-to-two-minute download without evidence.

### 2. Build the local data command — reviewed and accepted

Approved implementation plan:
1. Add a documented local preparation command using a pinned parser dependency. Download or reuse a dated Geofabrik Finland PBF, verify its checksum, and record the source timestamp and coverage polygon.
2. Stream extraction of the current required way classes and hazard nodes. Preserve the consumed tags, original IDs, full geometry and node membership, including unrated paths and cycleways needed as matching competitors. Do not change trail eligibility.
3. Produce a versioned compressed dataset with a spatial directory and manifest containing provenance, coverage, counts and checksums. Keep generated bulk data outside Git. Browser storage/import implementation belongs to bucket 3.
4. Validate geometry, membership, schema and output integrity before publishing a completed dataset. Fail clearly on missing or invalid source data; preserve any previous valid output.
5. Add small deterministic fixtures covering extraction, empty covered areas and invalid inputs. Run a full Finland preparation measurement and report payload size, processing time and peak memory separately from extension packaging.

Acceptance: a reproducible command, documented prerequisites, validated sample/full outputs, and evidence that both overlay and route-matching inputs survive extraction. No extension packaging, runtime integration, weekly updater or release-script changes in this bucket.

Checkpoint: runnable local command, reproducible sample/full output, actual packaged-size measurement, and tests showing required features and matching data survive extraction.

### 3. Add local storage and lookup — reviewed and accepted

Concrete plan: keep compressed spatial files in a separate IndexedDB database; validate and checkpoint each file during resumable import; publish a snapshot with one atomic metadata switch. Query overlapping spatial directory entries, stream-decompress records, bound compressed hot-cache and result budgets, and check exact coverage polygons. Test interruption/corruption and snapshot isolation. Benchmark actual desktop browser imports and cold/warm corridor lookups before connecting extension features in bucket 4.

Checkpoint: cold/warm query measurements, storage and memory use, failed-update recovery and evidence toward the route-check speed target.

### 4. Connect extension features — reviewed and accepted

Concrete plan presented before implementation: load the snapshot store in both background entry points; read local coverage before API cache/network for overlays and area checks; add a whole-route local lookup to avoid repeated file decoding; retain existing converters and eligibility rules; expose an extension-owned worker import page for prepared folders. Validate authoritative empty coverage, fallback and equivalent warning results; test actual desktop paths without building or packaging.

Checkpoint: fixture comparisons and live desktop verification of matching, warnings, unknowns, coverage boundaries and route performance.

### 5. Add update controls — reviewed and accepted

Concrete plan: prototype a streaming browser PBF decoder with disk-backed node coordinates and shard staging; compare its full-Finland output against the native preparation command before enabling weekly acquisition. Add resumable downloads from a pinned public-provider snapshot, validation and atomic activation, old-snapshot cleanup, date/status and automatic weekly scheduling. Run updates in a temporary background extension tab (user accepted on 2026-10-05), closing it after success; interruption must preserve the current snapshot. Add current-route-only manual Overpass refresh with duration confirmation and authoritative fresh-area overrides. User confirmed seven-day overrides, including authoritative empty results, superseded when a regional snapshot source date is later than the refresh. Test successful/failed/interrupted updates and both desktop browser workers without building or packaging.

Checkpoint: successful/failed/interrupted updates, old-snapshot continuity, manual refresh scope and interaction between fresh route data and the regional snapshot.

### 6. Integrate releases and validate — completed and accepted

Concrete plan: validate snapshot schema, geometry, membership, checksums, provenance and source age; add a release-data command that prepares the latest dated public extract and publishes an atomic local pointer only after validation; require that snapshot in packaging and copy its prepared files plus ODbL attribution into both browser outputs. Add resumable automatic import from the bundled snapshot on install/update using the existing background-tab worker. Test integrity/freshness/initial-import gates with small fixtures without running build/package commands; document desktop acceptance status and assess mobile resources/API/distribution constraints. User confirmed the latest provider extract with a maximum source age of seven days (168 hours). Firefox runtime validation remains deferred as requested; the final authorized package and static lint checks passed.

Checkpoint completed: release-gate tests, packaged Chrome acceptance and mobile assessment. Future build/release commands still require explicit user instruction.

Final cleanup after the user accepts the feature as finished:
- Mark this plan completed and record the final outcome and any approved deferred work.
- **Remove the active-project section/link for this plan from AGENTS.md.**
- Retain this document as project history unless the user asks to remove it.

## Decision questions to resolve through investigation

- Which public provider and extract format best satisfy coverage, freshness and usage requirements?
- Is full-Finland browser-side updating practical without hosted preprocessed files?
- How much matching geometry must be retained, including non-trail competitors?
- What installed format/index balances lookup speed, compression and import time?
- How are coverage completeness, snapshot age and release freshness validated?
- How are route refresh overrides stored, expired and reconciled with weekly snapshots?
- What evidence supports the manual refresh duration estimate?

## Checkpoint log

- 2026-10-02: User approved the scope and bucket 1 investigation plan. Requested this persistent plan and an AGENTS.md reference, with removal of the reference as the final completion step. No investigation findings or implementation approvals yet.

- 2026-10-02: Bucket 1 measurements completed. See [LOCAL-OSM-FEASIBILITY.md](LOCAL-OSM-FEASIBILITY.md) and [LOCAL-OSM-MEASUREMENTS.json](LOCAL-OSM-MEASUREMENTS.json). Full Finland required export is 154.5 MB gzip; a native synthetic-corridor probe is under one second, not browser/real-route acceptance. Weekly raw-data import and manual Overpass refresh require decision confirmation. No commit or next-bucket approval yet.

- 2026-10-02: User accepted the bucket 1 feasibility report and confirmed all three direction decisions: bundle full Finland; prototype weekly public raw-PBF downloads plus browser processing; retain deliberate Overpass refresh for the current route. Browser feasibility remains unproven. Bucket 2's concrete implementation plan is recorded above. Investigation-document commit approval remains pending; earlier runtime/UI changes remain separate.

- 2026-10-02: User explicitly approved the investigation-document commit and push and proceeding with the presented bucket 2 plan. Bucket 2 is now in progress.

- 2026-10-02: Investigation committed and pushed as `d2c8952`. Bucket 2 command, versioned spatial output, tests and usage documentation implemented. Full Finland: 151.12 MB payload + 0.37 MB manifest, 207.3 s preparation, 2.01 GB peak native RSS. See [LOCAL-OSM-DATA.md](LOCAL-OSM-DATA.md) and [LOCAL-OSM-PREPARATION-MEASUREMENTS.json](LOCAL-OSM-PREPARATION-MEASUREMENTS.json). No extension build or packaging performed. Bucket 2 changes await user review and commit approval; bucket 3 has not started.

- 2026-10-02: User reviewed bucket 2 and approved carrying onward through the agreed commit/push checkpoint to bucket 3.

- 2026-10-02: Bucket 2 committed and pushed as `7bd9c49`. Bucket 3 implementation started under the concrete plan above.

- 2026-10-02: Bucket 3 implemented in standalone `local-osm.js`, without loading it in the extension yet. Compressed IndexedDB storage, resumable per-file import, atomic activation, exact conservative coverage and bounded lookups are covered by 11 new tests (82 relevant tests pass). Full-Finland imports and corridor lookups passed in installed Chrome, Firefox and Brave with disposable profiles. See [LOCAL-OSM-STORAGE.md](LOCAL-OSM-STORAGE.md) and its measurements. No extension build/package or bucket 3 commit performed. Await user review before committing and starting bucket 4. Real routed/live extension performance remains to validate; snapshot garbage collection belongs with the update lifecycle before unattended updates are enabled.

- 2026-10-02: User explicitly approved bucket 3. Commit/push checkpoint accepted. Next: present the concrete bucket 4 integration plan, then connect local data to both overlays and trail checking while preserving uncovered/unusable-data fallback and current matching semantics.

- 2026-10-02: Bucket 4 implemented and validated. Local snapshot import completed in the user's existing Brave extension (source checkout). The real 77.3 km test route finished by the first UI observation (~1.7 s tool round trip) and explicitly displayed the local snapshot date. Satellite-map hazard icons/width labels were visually verified on the singletrack fixture. 160 non-build tests pass. Isolated Chrome/Firefox production acquisition/collection tests returned zero API calls for synthetic 50/100 km corridors. See [LOCAL-OSM-INTEGRATION.md](LOCAL-OSM-INTEGRATION.md). No build/package or commit performed; await bucket 4 review before committing or beginning bucket 5. Earlier unrelated edits remain in the worktree and must be staged separately.

- 2026-10-02: Bucket 4 follow-up: user found S1 sections not warned at maximum S0. Captured the edited test route locally and reproduced the result against the same snapshot. Matching succeeds for ~255 m S1 and ~592 m S2, but missing surface tags suppress checks under the earlier eligibility rule. Proposed checking known attributes of rated paths while retaining unknown-surface reporting; explicit confirmation requested because this changes the agreed eligibility semantics. No classification change applied yet. See integration report follow-up.

- 2026-10-02: User explicitly confirmed maximum S0 and approved treating MTB-rated paths with absent surface as unpaved. Implemented the shared eligibility correction for difficulty, width and parent-way obstacle checks. Explicitly paved paths and road/cycleway classes remain excluded; unrated missing surfaces and explicit unknown/mixed surfaces remain unknown. Replaying the captured 3.94 km route now assesses 892 m and reports S1/S2 difficulty warnings. No build or commit.

- 2026-10-02: User approved bucket 4, requested its commit plus the missing-surface fix, and authorized starting bucket 5. Earlier trail classification/UI edits are preserved in a separate commit. Bucket 5 starts with a bounded browser PBF feasibility prototype, update lifecycle/cleanup and route-only refresh controls; it must not silently replace the approved public-provider update direction.

- 2026-10-05: Bucket 4 and earlier classification work committed/pushed: `1f43685`, `428c809`; missing-surface fix `0f6a37a`. User accepted a temporary background tab for weekly updates. Bucket 5 browser processing prototype is starting. Preserve the separately modified route sample limit in route-check.js.

- 2026-10-05: User confirmed seven-day route overrides and asked to skip Firefox validation. The incomplete disposable Firefox preparation run was stopped. Full Chrome browser preparation matched all 1,177,173 native records, taking 422.8 s plus 7.2 s validated import; peak process-tree RSS 2.11 GB and temporary IDB 2.97 GB. Implementation now includes streaming provider-checksummed/resumable downloads, block-checkpointed disk-backed preparation, update tab controls/scheduling, snapshot cleanup with reader leases, and route-refresh overrides. Live source-extension verification is in progress; no build/package or bucket 5 commit.

- 2026-10-05: Bucket 5 ready for review. Live Brave public-provider update activated the October 4 snapshot (1,150,527 ways) after successful checksum/preparation/import. Pausing at 44% resumed the saved block checkpoint without downloading again. An unchanged-source automatic tab closed on success. Temporary preparation/download databases were deleted; remaining regional + API storage was 309.6 MB, including the prior generation retained for 24 hours. 183 non-build tests pass; full record equivalence and local speed measurements are recorded in [LOCAL-OSM-UPDATES.md](LOCAL-OSM-UPDATES.md). Firefox check skipped as requested. No build/package or bucket 5 commit. Wait for review before committing/pushing or starting bucket 6.

- 2026-10-05: User approved the bucket 5 commit/push checkpoint and requested starting bucket 6. Preserve the independent 250,000-sample limit edit. Bucket 6 must add bundled installation and release freshness/integrity gates without running builds/packages. Firefox validation remains deferred under the user's instruction.

- 2026-10-05: Bucket 5 committed and pushed as `d8f5203`. Bucket 6 concrete plan presented. Asked to confirm latest-provider data with a maximum 72-hour source age (or seven days). Initial-import/release integrity work can proceed independently of that policy choice.

- 2026-10-05: User confirmed the release freshness policy: latest public Finland extract, maximum seven-day source age. The gate is configured at 168 hours; no older cached-data fallback when current provider metadata/preparation fails.

- 2026-10-05: Bucket 6 implementation ready for review. Added latest-provider/seven-day integrity gates, pinned-source preparation and atomic release-data selection; package flow includes validated Finland files/ODbL notice in both browser outputs, initial background-tab import, and source/build bundle markers. Full existing Finland data passed the new validator; the actual bundle loader imported it in a disposable Chrome worker in 8.01 s with zero provider requests. 191 non-build Node tests and seven native preparation tests pass. See [LOCAL-OSM-RELEASES.md](LOCAL-OSM-RELEASES.md). No build/package/lint/signing/tag/version change or bucket 6 commit. Actual ZIP sizes and packaged initial install remain unverified, Firefox deferred, mobile assessed but not supported. Await review/build instructions; final feature acceptance and AGENTS.md cleanup remain outstanding.

- 2026-10-05: User reviewed and approved bucket 6 implementation and requested continuation. Commit/push checkpoint authorized. Actual package/build and packaged-browser acceptance still require an explicit build instruction under AGENTS.md; Firefox remains deferred. Retain the active-project reference until final feature acceptance.

- 2026-10-05: User approved remaining bucket 6 acceptance. Guarded packaging passed against the latest October 4 extract. Both browser ZIPs contain full Finland; Chrome unpacked-package installation automatically imported 1,150,527 ways and closed its import tab. The public 3.94 km fixture returned two S2 warnings and Fallen tree from the local October 4 snapshot; clicking the warning centered the map, with width labels, log and narrow icons visible. Firefox static lint passed with zero findings; Firefox runtime remains skipped as requested. Final resume/lint fixes tested and packaged. No version bump, tag, signing or publication. Active-project reference removed from AGENTS.md; all buckets completed.
