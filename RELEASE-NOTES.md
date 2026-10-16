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

# 1.7.0

- Add a three-step onboarding guide shown once, with replay in Settings.
- Deliver the Chrome Store update with refreshed ride-analysis listing text and screenshots.

# 1.6.0

- Keep doubletrack layers and features tagged as tracks at Komoot’s native zoom-dependent line widths, without the extra fallback outline. Singletrack highlighting retains its existing widths.

# 1.5.2

- Fix Chrome Web Store upload rejection by packaging Finland metadata as `snapshot.json`, leaving only the extension manifest named `manifest.json`.
- Add an offline privacy policy, correct browser synchronization disclosures, and identify online OSM recipients in settings and trail checks.
- Clarify automatic country downloads and explicit route-refresh data sharing.

# 1.5.1

## Bug fixes

- Fix high idle CPU usage caused by repeated map styling. Classify trail layers using their original filters so IMBA layers cannot trigger a restore/apply loop.
- Avoid unnecessary styling after map idle events.
- Keep widened trail widths stable when Routing Buddy adds its own outline, while preserving native separated strokes.

## Validation

The redraw loop was reproduced in Brave and stopped after the fix: a five-second idle sample recorded no map writes, redraws or style events. Observed tab CPU settled around 16%, down from 70–94% before the fix. Firefox runtime testing remains deferred.

# 1.5.0

## New

- **Check trails along your route.** Choose a maximum difficulty, minimum width and whether to allow hazards. Click a warning to jump to it on the map.
- **Bundled Finland data.** Hazard overlays and trail checks use local OSM data in covered areas, avoiding slow online requests. Packages import the data automatically after installation.
- **Weekly Finland updates**, with pause/resume and the previous data kept available until the update succeeds.
- **Update current route from OSM** to refresh just the areas around your route. Fresh results are retained for seven days.

## Improvements

- Larger persistent OSM cache, smaller online responses, combined nearby requests and two-provider downloads.
- Progress reporting, automatic retries and resume from completed areas instead of starting over.
- Support for larger routes, with a 250,000-sample limit.
- Trail checks exclude roads, streets, cycleways and paved paths. Missing information is reported separately.
- MTB-rated paths without a surface tag are checked, so known S1/S2 sections are no longer skipped.
- Fallen trees and logs use the wood icon; hazard dots follow the chosen trail colour.
- Clearer installation, settings help, privacy information and documentation.
- Paused bundled imports resume packaged data, including when reopened from settings.

## Installation notes

Packages are about 150 MB because they include Finland data. Chrome/Brave users should extract the Chrome ZIP to their existing extension folder and reload it. The Firefox ZIP is unsigned; permanent Firefox installation requires a signed XPI.

Country updates download roughly 770 MB and need several GB of temporary disk space. Outside local coverage, online OSM queries are still used. Mapped conditions may be incomplete or outdated. The extension does not change your route.
