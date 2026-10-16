# 1.8.0

## Maps and controls

- Press Space to inspect the route in satellite view with a solid 1 px route line, hiding trail highlighting, sport overlays, heatmaps and Squadrats. Press Space again to restore the previous view.
- Use 1–5 for base maps and Q–T for sport maps. Typing fields are protected; Komoot keeps its own A/S/D bindings. Find the shortcut reference in Settings.
- Emphasize available road numbers with compact, rounded shields sized and coloured by road class, with improved label spacing. Enabled by default.
- The floater starts collapsed and expands directly into settings. Trail colours and Analyse route remain accessible while collapsed; Squadrats controls appear only when its layers are detected.

## Fixes

- Turning the extension off now stops its map changes, requests and shortcuts, clears the OSM spinner, and restores native styling.
- Correct Squadrats ordering without raising native masks, and restore opacity control for collected squares and route highlights.
- Keep native higher-grade paths and labels visible outside the selected highlighting range, including MTB mode. Hazard crumbs respect that range.
- Show actual Technical grade ranges, such as S1 or S1–S3. Default section minimums are 250 m for Technical, 500 m for Trails and 1.5 km for Gravel.
- Use Checkpoint icons for Halfway, Gravel and Hills, and Danger icons for Trails and Technical.
- Fix approved POIs flashing and disappearing when a suggestion coincides with the start waypoint. Reuse the nearest ordinary waypoint within 100 m on the map and along route progress, keeping its position and protecting existing custom POIs.
- After route geometry changes, return generated POIs to ordinary waypoints so stale Halfway and riding-section labels do not accumulate. Original names are restored, manually changed custom POIs are protected, and new ownership metadata survives reloads. Older points without that metadata need manual cleanup.

## Distribution

This GitHub release includes Chrome and Firefox ZIPs so Firefox users can obtain the fixes while Firefox Store availability is pending. Chrome users should normally install and update through the [Chrome Web Store](https://chromewebstore.google.com/detail/ddndlhfekbkhjbalkjojocghcmkndakh). The Firefox ZIP is unsigned and is a temporary/development installation on standard Firefox; it is not a signed permanent add-on. Publishing the GitHub release does not mean the Chrome Store update is approved or live.

No additional extension permissions or hosts are requested. Generated POI descriptions contain an ownership marker and route fingerprint; Komoot may display or export this description. Save route edits explicitly in Komoot.

