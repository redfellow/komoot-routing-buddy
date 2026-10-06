# Trail checker

The checker compares trails along the current Komoot route with your chosen difficulty, width and hazard limits. It does not change the route. For everyday use, see [README.md](../README.md#check-trails).

## What is checked

Only unpaved `path`, `track`, `footway` and `bridleway` features with an MTB scale are assessed. MTB-rated paths without a surface tag are assumed unpaved. Roads, streets, cycleways and explicitly paved paths are excluded, but available paths remain matching candidates to avoid snapping to a nearby trail.

Unpaved paths without a rating, unknown surfaces and missing widths are reported separately. Unmatched route distance is not presented as unknown trail distance. If no eligible trails are identified, the result says so instead of declaring the route suitable.

**Allow hazards** skips mud, vegetation and obstacles; difficulty and width still apply. Width equal to the chosen minimum passes. Estimated widths are labelled. S1+ exceeds S1; S1− does not.

## Matching and warnings

Komoot supplies route geometry, not shared OSM way IDs. Samples are at most 10m apart. Matching requires nearby, similarly directed OSM geometry and at least 20m of continuous overlap. Close competing ways and ambiguous crossings remain unmatched. Obstacle nodes must belong to the matched way and lie near the traversed section.

Warnings are ordered by distance. Identical warnings merge when adjoining affected sections have less than a 50m gap along the route. Different warnings and disconnected route parts remain separate. Clicking a warning centres the map and briefly highlights the section.

A completed check with assessed trails and no warnings says: “No issues found on matched trails according to Komoot & OSM data.” Missing-data information stays visible. This describes the available data, not a safety guarantee.

## Collection, cache and retries

Covered Finland routes use one local lookup; see [LOCAL-OSM.md](LOCAL-OSM.md). Otherwise the checker reuses cached areas and downloads missing ones. Online results last seven days, with a 512 MiB / 4,096-area cache limit. Failed responses are not cached. Startup reads the area index; hits do not rewrite geometry.

Online collection uses two workers, with at most two requests overall and one per provider. Private.coffee and VK Maps are preferred; overpass-api.de is the fallback. Up to four adjoining missing areas can share a download. Provider cooldowns apply independently. Progress counts areas, not HTTP requests.

Temporary failures retry automatically for up to ten minutes without progress; each completed area resets that window. Retry retains completed areas, including out-of-order responses. Cancel stops new work; dispatched requests may still populate the cache. Editing route geometry invalidates results; changing selection alone does not.

Checks are bounded to 250,000 route samples and 2,000 areas. Exceeding a bound reports an incomplete check rather than truncating silently. Manual **Update current route from OSM** bypasses local and ordinary cached data and saves seven-day route overrides.

## Maintenance

- `route-check.js`: collection, matching, eligibility and warning grouping.
- `route-dialog.js`: preferences, progress, cancellation and results.
- `map-bridge.js`: route snapshots, invalidation and map navigation.
- `hazards.js`, `osm-cache.js` and `background.js`: local/online acquisition and persistent caching.

Regression fixtures cover crossings, parallel ways, bridges, reversed travel, cropped geometry, obstacle membership, missing data, eligibility, cache recovery, batching, concurrency and retry checkpoints. Live testing should include known warnings, map navigation, local-only coverage and online fallback.
