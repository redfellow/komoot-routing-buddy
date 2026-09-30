# Route checker

## Live investigation

Inspected `komoot_tour` in the signed-in Brave test route `/tour/3287158188/edit`. Its three LineString features contain only `segment_type`, `selected`, `dimmed` and `__react_key` properties. They expose neither OSM way identifiers nor difficulty ratings. The checker therefore uses Komoot route geometry and OSM attributes; it does not claim a shared-ID match or infer MTB grades from hiking grades.

## Implementation

- `route-check.js`: pure normalization, complete route-area enumeration, sequential collection, matching, grouping and warnings.
- `route-dialog.js`: independent saved preferences, progress, cancellation, retry and clickable results in a floater-anchored dialog.
- `map-bridge.js`: sanitized route snapshots, geometry-change invalidation, warning navigation and an eight-second highlight. Selection-only changes do not invalidate results.
- `hazards.js` / `background.js`: explicit route-area queries independent of display/preload toggles, successful-result caching, provider fallback and cooldowns.

An explicit check covers all cells along the route, without the eight-cell background-preload cap. Stable roughly 1km latitude-band cells have a 150m margin, with the usual acquisition margin applied additionally. Work is bounded to 100,000 route samples and 2,000 areas; exceeding a bound gives an incomplete error rather than silently truncating the route. Existing requests are serialized by the background loader. Cancelling discards late results and stops future cells; an already dispatched request can complete into cache.

The cache keeps seven-day freshness, at most 4,096 areas and 512 MiB of serialized payloads in IndexedDB, with persisted last-access eviction. Metadata and geometry occupy separate object stores: startup reads metadata only, writes replace one area atomically, and hits update only small metadata records. The hot geometry cache is bounded to 16 MiB of serialized data; actual JS heap use also includes object overhead. Touching an entry does not reset its original freshness timestamp. Legacy display entries remain valid for display. New entries marked `routeComplete` use a separate internal key and are required for route checks. Their richer conversion preserves rating-only/unrated ways, width provenance, grade-separation tags and node-to-way membership. Route data can also supply the existing display without drawing unrated ways. Failed requests never enter the cache.

## Matching and interpretation

Route samples are at most 10m apart. A spatial index finds OSM segments within 8m, requiring absolute direction cosine >= 0.9. Competing ways with scores within 3m-equivalent remain unmatched. At least 20m of continuous same-way overlap is required. Reversed travel is supported; distinct route parts are not bridged. Where grade-separation properties are available they must agree, but live Komoot geometry currently has none: coincident competing bridge ways remain unknown.

Obstacle nodes must belong to a matched way and be within 8m of the traversed section. Overlapping cells are deduplicated while retaining node parent-way memberships. Findings are grouped over adjacent route samples and ordered by distance. Identical warning text and kind merge across adjoining paths when the gap from the previous affected section’s end to the next section’s start is less than 50m along the route. Gaps of 50m or more, different warning text and disconnected route parts stay separate.

S-level +/- modifiers use quarter-level ordering: S1+ exceeds S1, S1− does not. Width equal to the minimum passes. Estimated widths participate but are explicitly labelled. Missing rating or width is unknown. Allow hazards suppresses obstacle/mud/vegetation findings, never numeric width or difficulty findings. Geometry-only matching remains approximate; it deliberately leaves uncertain sections unmatched.

## Result contract

A fixed route snapshot is checked with separate saved preferences. Failed coverage says Check incomplete and offers Retry, with partial findings retained. A geometry edit clears obsolete findings. A completed check with no findings uses exactly: “The route doesn't contain issues according to Komoot & OSM data.” Missing-data distances are displayed separately, even for that result.

## Validation

Automated fixtures cover difficulty-only ways, unrated paths, width equality/estimates, +/- grades, crossings, parallel ways, bridges, reversed travel, off-grid segments, obstacles, complete collection beyond eight cells, failed requests, cancellation/late replies, route changes, cache upgrade, LRU retention across restart and seven-day expiry. Existing display tests are also run; build tests are deliberately excluded unless packaging is requested.

Live Brave validation on the test route: default settings loaded, three cells completed, three S2 warnings appeared against an S1 maximum, clicking a warning moved/zoomed the map, and a repeat check completed from cached coverage. Missing/unmatched data was reported separately. No build or package was generated.


## Cache performance validation

The cache module is `osm-cache.js`, loaded before `hazards.js` in both browser background entry points. Legacy `osmHazardsCacheV4` data is removed only after migration commits; freshness timestamps are preserved. LRU eviction uses UTF-8 payload bytes, computed once per inserted area. Quota errors evict the oldest quarter once and retry the write; failed transactions cannot leave metadata without geometry. Clearing serializes behind pending operations. If IndexedDB is unavailable the fallback is bounded memory caching with a console warning.

Tests cover 90 areas over 90 MiB surviving a new cache instance, metadata-only startup, zero payload writes on hits, memory bounds, TTL, LRU across restart, migration failure, atomic failure, quota recovery, clearing and route/display data separation.

Native Brave benchmark (2026-09-29): 90 copies of one actual cached OSM payload, 50,450,220 serialized bytes total, were written to an isolated temporary database in 487ms. After closing/reopening it with the hot memory cache disabled, all 90 areas were read in 378ms with zero payload rewrites. The temporary database was deleted afterwards. A live migrated route-cache hit took 0.6ms. These are cache-path measurements, not full route analysis or extension-message timings; uncached areas still depend on Overpass latency.


## Bounded, compact Overpass responses

Queries crop `out skel geom(bbox)` to the expanded cache area and apply the same bbox to obstacle member nodes. Overpass preserves adjacent coordinates at the boundary and uses null placeholders for omitted geometry. Conversion splits at these gaps, retaining separate LineStrings with fragment IDs and a shared `osmId`. Cache unions and route collection retain the fragments; route matching groups candidates by original OSM identity so overlapping fragments do not become competing trails. Counts remain per OSM object.

The response pairs skeletal ways/nodes with `krb_way` / `krb_node` tag records, joined by type and ID. Numeric/base-36 tag keys project only the 15 fields read by conversion: highway, area, MTB scale, width/estimated width, surface, obstacle/overgrown/barrier, hazards (including directional), layer, bridge and tunnel. Names, source attribution tags and other unused element details are not transferred. JSON encoding preserves arbitrary tag text. Node references remain in the wire skeleton for exact obstacle membership, but are discarded from the normalized cache after parent-way relationships are resolved. Missing detail records fail the request and are not cached.

Existing full-geometry cache entries remain valid; no forced cache flush or expiry reset is needed. Unrated paths remain available to route matching and hazard detection. Requests use the bounded two-provider queue described below. Adjacent uncached route cells can now be combined as described below.

Live query validation on 2026-09-30 against overpass-api.de, bbox `61,23,61.01,23.02`: both queries returned the same eight ways. The former response was 10,388 bytes / 2,112 gzip bytes; the bounded projected response was 10,181 bytes / 1,738 gzip bytes (about 18% less transferred). This is a small sample, not a general speed claim: projection adds a short tag record per object and can increase small, already-sparse responses. Cropping benefits depend on how far the selected ways extend outside the area. Public-server queuing can still dominate elapsed time.

Protocol references: [cropped geometry](https://dev.overpass-api.de/overpass-doc/en/full_data/bbox.html), [Overpass convert and output](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL#The_statement_convert).


## Combining route downloads

The collector sends the current cell plus up to three following cells to the background. The background checks cached coverage first and combines only consecutive adjoining misses. It stops at a cached cell, a disconnected cell, four cells, or an enclosing rectangle over 8 km² before padding. The successful enclosing rectangle is stored as one ordinary route-complete cache entry; later individual-cell checks reuse it. Existing smaller entries continue to work without flushing the cache.

Progress and the cached/downloaded counters count original route cells, not HTTP requests. A successful batch advances up to four cells at once. Checkpoints advance only after successful responses, and cancellation still prevents accepting late results. Failed combined queries are retried as individual cells after the existing provider cooldown; response-size failures on batches are recoverable, whereas invalid-query/authentication failures remain permanent. The bounded fallback history is in background memory, so extension restarts can try batching again.

Tests cover fewer network calls across a long synthetic route, a second pass with no network calls, mixed cached/uncached cells, adjacency and size limits, provider failure followed by smaller retries, and checkpoint resumption after a completed batch. Actual latency and success rate still require live-route comparison.


## Two-provider concurrency

Explicit checks run two workers, each reserving up to four consecutive uncompleted cells before sending its batch. Completed cell indices and accumulated features are checkpointed after every successful response, including out-of-order responses. A faster worker can take more work while the other is pending. On failure, already-running work settles and successful results remain checkpointed before retry; cancellation ignores late results and schedules no further work.

All background OSM callers share a two-request limit and reuse in-flight requests that fully cover their area. Each provider has one active request maximum. Private Coffee and Mail.ru are preferred; overpass-api.de remains the fallback. Existing per-provider cooldowns and Retry-After handling apply independently. Clearing the cache waits for both active downloads before clearing stored results. Cancellation leaves already-dispatched background work free to finish into the cache.

The progress detail reports active area checks (which may be cache reads or downloads), rather than claiming to count live HTTP requests. Tests cover global/provider caps, concurrent identical-area deduplication, independent fallback, cache clearing, fast-worker scheduling, out-of-order retry checkpoints and cancellation.
