# Komoot Routing Buddy

Komoot Routing Buddy makes mountain bike trail difficulty easier to read on Komoot maps using colours. You can choose which difficulty levels to show and their colours. It also displays hazards mapped in OpenStreetMap, such as mud, fallen trees, vegetation, and narrow sections. You can also reduce the opacity of the Squadrats plugin. It does not modify your route.

## Features

- Highlights trail difficulty directly on the map
- OSM integration: Shows hazard overlays for muddy, narrow, and other mapped trail issues
- Lets you choose which difficulty levels are shown
- Supports custom colors for each trail difficulty (brighter in Sat view)
- Adds a clear warning style for the hardest sections
- Keeps your preferred map and panel settings between sessions
- Lets you switch back to the original Komoot styling whenever you want
- Works with the main planning and editing views in Komoot

## Known Issues

- OpenStreetMap Overseer API is often overloaded, which can make trail hazard data take a long time to load, sometimes several minutes. Because of this, the loading status is shown in the floating window so you can see whether hazard data is still being fetched or is delayed. Succesfully loaded OSM data is cached for 7 days.

## Preview

### Default map

![Default map view](map-default.png)

### Satellite map with Squadrats opacity @ 15%

![Sat map view](map-satellite.png)

### Default Komoot map without this extension (for comparison)

![No KRB](krb-disabled.png)

## Install

### Chrome / Brave

1. Download the latest version from the [Releases page](https://github.com/redfellow/komoot-routing-helper/releases) (or download source)
2. Open `chrome://extensions` or `brave://extensions`.
3. Enable Developer mode.
4. Click Load unpacked and select the generated extension directory.
5. Open Komoot and use the extension from the route planner.

### Firefox

1. Download the latest version from the [Releases page](https://github.com/redfellow/komoot-routing-helper/releases) (or download source)
2. Open `about:debugging#/runtime/this-firefox`.
3. Click Load Temporary Add-on.
4. Select the generated `manifest.json` for the Firefox build.
5. Open Komoot and use the extension from the route planner.

## Notes

- This is a visual helper only.
- It does not modify your route or create a route for you.
- It is designed to make map reading easier, especially for MTB planning.

## Privacy and data handling

The extension stores your local preferences in the browser and reads the page state needed to apply the visual styling. It does not upload routes or personal ride data to a remote service. Show hazards is enabled by default: at close zoom levels it sends the viewed map bounding box sequentially to Private.coffee, VK Maps, or overpass-api.de to retrieve OpenStreetMap obstacles, vegetation, mud, warnings and width data. The provider also receives normal network metadata such as your IP address. Turn off Show hazards in settings to stop these lookups. Missing tags mean unknown conditions; this is not live trail-condition reporting.

## For developers and maintainers

Technical build, test, and release information has been moved to [READMORE.md](READMORE.md). The release checklist and distribution notes are also documented in [docs/RELEASING.md](docs/RELEASING.md).

New OSM queries include up to a 20% margin on each side within the 25 km² limit. Cached areas serve any fully contained viewport, including nearby pans and zooms. Counts refer to the returned cached area. Successful OSM results are cached locally for 7 days (stored per area in IndexedDB, with a 512 MiB serialized-data budget and a 4,096-area limit, evicting least recently used areas first). Failed responses are not cached. Use Clear OSM cache in settings to discard stored results and reload the current view. The floater header shows loading, completed, and throttled request states and the number of distinct mapped hazard features. The detailed count uses under 1 metre for narrow trails; categories can overlap.

Optional **Preload hazards along route** caches up to eight roughly 1km route cells
with a 300m margin, starting near the current map view. Queries run sequentially
after route edits settle; viewport requests take priority between preloads.
Queued areas are replaced after route edits or panning, and preloading stops on
API errors. Adjacent cached areas can jointly satisfy a viewport request.
Only area bounds are sent to the existing OSM providers; enabling this option
can send bounds outside the visible map. It is off by default.


OSM cache reads load only the required area, never rewrite its geometry, and keep a small 16 MiB hot-data cache (serialized size) in memory. Startup loads just the area index. The surviving entries from the old cache migrate automatically; areas it previously evicted must be downloaded once again. **Clear OSM cache** removes both disk and memory data.

The extension requests `unlimitedStorage` for its larger local OSM cache while imposing the above application limits. See the [Chrome storage documentation](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies) and [Firefox permissions documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions#unlimited_storage).
