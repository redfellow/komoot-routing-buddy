# Privacy policy

Last updated: 2026-10-16.

## Purpose and scope

Komoot Routing Buddy is an independent extension maintained by the redfellow GitHub project to help users inspect MTB trails while planning Komoot routes. It is not affiliated with or endorsed by Komoot. This policy describes the extension, not the separate Komoot website or Squadrats extension.

## Route and map data

The extension reads route geometry and map state on supported Komoot planner, route-editing and full-screen map pages to display trail colours, hazards and trail-check results. Route matching takes place in your browser. The extension does not upload full route geometry, account credentials or browsing history to a project-operated server. It has no analytics or advertising tracking.

The ride overview also reads the current route's elevation and waypoint metadata in your browser. Generating suggestions does not modify your route. Adding approved POIs uses Komoot's planner and routing service, which receives the route and waypoint information needed to recalculate it. Names, icons and coordinates are written to the current Komoot route only after approval. The extension does not automatically save the route; saving and device synchronization are handled by Komoot. The ride summary uses Komoot surface, way-type and elevation data in your browser. Analyse route also starts trail checks automatically. Trail checks and map hazard features can make the online OSM requests described below. Where Komoot has no MTB grade, the summary can reuse conservatively matched grades from completed trail checks.

Generated POIs store a versioned ownership marker, generated name and icon category, route-coordinate fingerprint and any original waypoint name in Komoot’s custom POI description. This description can be visible in Komoot or exported to a navigation device. After route geometry changes, the extension removes stale generated customizations while retaining the ordinary waypoints and restoring original names. User-renamed or restyled points and unrelated custom POIs are preserved. This metadata is part of the Komoot route and is not sent to a project-operated server.

With Estimate gained Squadrats enabled, route analysis reads the visited-tile collection already loaded by the separate Squadrats extension and calculates planned tile, Yard and largest-square gains locally at both grid sizes. Komoot Routing Buddy does not request Squadrats account credentials, fetch account data itself or upload the collection. Estimates are discarded when the route, loaded collection or setting changes.

## Preferences and browser synchronization

Trail colours, rules, map options, remembered layer selections, Squadrats opacity and trail-check preferences use browser sync storage. When Chrome Sync is enabled, Google synchronizes these preferences across your signed-in Chrome browsers. Firefox may synchronize preferences through Mozilla when browser extension synchronization is enabled. Browser-account settings control synchronization. Country databases, online OSM caches, sidebar state, panel position, quick-guide display status and update job state are stored locally.

## Online OSM requests and recipients

Show hazards is on by default. When a viewed map area lacks local data, hazard overlays send geographic area bounds to Overpass providers: Private.coffee (overpass.private.coffee), VK Maps (maps.mail.ru), or overpass-api.de. Explicit trail checks and enabled route preloading can also send route-area bounds outside local coverage. Update current route from OSM sends route-area bounds even within local coverage. Bounds can reveal areas you view or intend to visit; they are location-related data, not a measurement of your device location. Providers also receive your IP address, request time, extension version in the User-Agent and normal network metadata. The extension uses HTTPS and omits credentials on these requests. Turn off Show hazards to stop map hazard requests; route checks and refreshes are separate actions. Route preloading is off by default.

## Country downloads

Finland data is bundled and imported automatically from the extension package. Weekly country updates are on by default. Updates request public Finland extracts, metadata and boundaries from Geofabrik (download.geofabrik.de), downloading roughly 770 MB and requiring several GB of temporary space. Geofabrik receives your IP address and normal request metadata, but no route geometry or route-area bounds. Disable automatic updates in Local Finland data, or pause an active download there. Manual updates remain available.

## Retention and deletion

Preferences remain until changed or cleared. Online OSM results and route refreshes have a seven-day validity period; expiry is not a guarantee of immediate physical deletion. Clear OSM cache removes online results and route refreshes but retains the Finland database. Country data remains until replaced or local extension data is removed; interrupted jobs may retain data needed to resume. Removing the extension clears its local extension storage. Use your browser account controls to manage synchronized extension data and synchronization; local removal does not promise deletion of every browser-account copy. Provider logs are governed by the respective providers and cannot be erased by the extension. The project does not control or promise a retention period for those logs.

## Limited Use

Komoot Routing Buddy’s use of user data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. User data is used only to provide the disclosed trail-planning features and their operation. It is not sold, used for personalized advertising, or used to determine creditworthiness. The project has no server receiving route or preference data for human review. External service providers process the requests described above to supply OSM data or browser synchronization.

## Questions and changes

For privacy questions, contact the maintainer through https://github.com/redfellow/komoot-routing-buddy/issues. Issues are public: do not include private route coordinates or personal information. If you choose to submit an issue, GitHub handles that submission under its own privacy policy. This policy will be updated when data practices change; material changes will also be disclosed in the extension and release documentation.

Road-number emphasis uses a bundled public OpenStreetMap extract for Finland national and E-road references. Displaying these labels makes no additional network requests and does not send viewed map bounds anywhere.
