# Komoot Routing Buddy

Komoot Routing Buddy helps you read trail difficulty more clearly while planning routes in Komoot.

It adds visual cues directly to the map so difficult sections stand out at a glance without changing the route itself.

## Features

- Highlights trail difficulty directly on the map
- Lets you choose which difficulty levels are shown
- Supports custom colors for each trail difficulty
- Adds a clear warning style for the hardest sections
- Keeps your preferred map and panel settings between sessions
- Lets you switch back to the original Komoot styling whenever you want
- Works with the main planning and editing views in Komoot

## Preview

### Enabled

![Enabled view](enabled.png)

### Disabled

![Disabled view](disabled.png)

## Install

### Chrome / Brave

1. Download the latest version from the [Releases page](https://github.com/redfellow/komoot-routing-helper/releases) (or build from source)
2. Open `chrome://extensions` or `brave://extensions`.
3. Enable Developer mode.
4. Click Load unpacked and select the generated extension directory.
5. Open Komoot and use the extension from the route planner.

### Firefox

1. Download the latest version from the [Releases page](https://github.com/redfellow/komoot-routing-helper/releases) (or build from source
2. Open `about:debugging#/runtime/this-firefox`.
3. Click Load Temporary Add-on.
4. Select the generated `manifest.json` for the Firefox build.
5. Open Komoot and use the extension from the route planner.

## Notes

- This is a visual helper only.
- It does not modify your route or create a route for you.
- It is designed to make map reading easier, especially for MTB planning.

## Privacy and data handling

The extension stores your local preferences in the browser and reads the page state needed to apply the visual styling. It does not upload routes or personal ride data to a remote service. Show hazards is enabled by default: at close zoom levels it sends the viewed map bounding box sequentially to Private.coffee, VK Maps (`maps.mail.ru`), or `overpass-api.de` to retrieve OpenStreetMap obstacles, vegetation, mud, warnings and width data. The provider also receives normal network metadata such as your IP address. Turn off Show hazards in settings to stop these lookups. Missing tags mean unknown conditions; this is not live trail-condition reporting.

## For developers and maintainers

Technical build, test, and release information has been moved to [READMORE.md](READMORE.md). The release checklist and distribution notes are also documented in [docs/RELEASING.md](docs/RELEASING.md).

New OSM queries include up to a 20% margin on each side within the 25 km² limit. Cached areas serve any fully contained viewport, including nearby pans and zooms. Counts refer to the returned cached area. Successful OSM results are cached locally for 7 days (bounded to 12 areas and a size limit). Failed responses are not cached. Use Clear OSM cache in settings to discard stored results and reload the current view. The floater header shows loading, completed, and throttled request states and the number of distinct mapped hazard features. The detailed count uses under 1 metre for narrow trails; categories can overlap.
