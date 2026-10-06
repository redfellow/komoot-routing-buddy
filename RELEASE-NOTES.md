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
