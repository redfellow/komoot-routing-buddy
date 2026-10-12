# Chrome Web Store submission

Prepared on 2026-10-13 for the 1.5.2 Store candidate following the 1.5.1 audit and upload rejection. This document supplies dashboard text; it is not evidence of publication or approval.

## Single purpose

Help users inspect mountain bike trails while planning Komoot routes, using difficulty colours, mapped hazards and checks against trail difficulty and width preferences.

## Store description

Komoot Routing Buddy colours MTB trails, displays mapped hazards and checks trails along your planned Komoot route. It does not change your route or Komoot's routing decisions.

Data and privacy: the extension reads route geometry and map state on supported Komoot pages and matches trails locally. Show hazards is on by default. Outside local data coverage, map hazards and trail checks send geographic map or route-area bounds to Private.coffee, VK Maps or overpass-api.de. These providers also receive your IP address and normal request metadata. Explicit route refresh sends route-area bounds even inside local coverage. Preferences may synchronize through Google when Chrome Sync is enabled. The project runs no server receiving route data and includes no analytics or advertising tracking. Read the linked privacy policy before installing.

Choose colours for S0–S5 trails, show mapped mud, vegetation, obstacles and trail widths, and check a route against your maximum difficulty and minimum width. Click a warning to jump to it on the map. Remember map layers, sidebar state and panel position. Squadrats display adjustments require the separate Squadrats extension.

The roughly 150 MB package includes Finland OSM data, which imports automatically in a background tab. Weekly country updates are on by default, download roughly 770 MB from Geofabrik and require several GB of temporary disk space. You can disable automatic updates or pause a download in Local Finland data. Turn off Show hazards to stop map hazard requests; explicit checks and refreshes have separate controls. Route preloading is off by default.

Works on desktop Komoot planner, route-editing and full-screen map pages. Mobile has not been validated. Mapped conditions may be incomplete or outdated and are not a guarantee of trail suitability. Data is © OpenStreetMap contributors, ODbL. This is an independent project, not affiliated with or endorsed by Komoot.

## Privacy policy URL

After publishing `PRIVACY.md` on the repository's main branch, use:

https://github.com/redfellow/komoot-routing-buddy/blob/main/PRIVACY.md

Verify that it opens without signing in before entering it in the dashboard. Keep the public Markdown policy and packaged `privacy.html` consistent.

## Permission justifications

| Permission | Justification |
| --- | --- |
| storage | Save trail colours, rules, map options and check preferences; retain local interface and country update state. Preferences use browser sync storage where enabled. |
| unlimitedStorage | Store the bundled Finland OSM database, larger country updates, resumable download staging and local query caches without normal extension storage limits. |
| alarms | Schedule automatic bundled imports and weekly Finland update checks, respecting the automatic-update setting and retry backoff. |
| declarativeNetRequestWithHostAccess | Set an identifying User-Agent for this extension's own POST requests to the three Overpass interpreter endpoints. Rules are restricted by extension initiator, endpoint, method and resource type. They do not change website traffic. |
| overpass.private.coffee | Obtain public OSM trail and hazard data for geographic areas outside local coverage or explicit route refresh. Requests contain area bounds. |
| maps.mail.ru | Alternative public Overpass provider for the same area-bound trail/hazard queries. |
| overpass-api.de | Alternative public Overpass provider for the same area-bound trail/hazard queries. |
| download.geofabrik.de | Download public Finland OSM extracts, source metadata and country boundaries for local data updates. No route geometry is sent. |

## Host permission justification

Paste this into the dashboard’s combined host permission justification field:

Access to overpass.private.coffee, maps.mail.ru and overpass-api.de is required to request public OpenStreetMap trail difficulty, width and hazard data for map or route areas outside local coverage, and for user-requested route refreshes. Requests send geographic area bounds; route matching remains in the browser. Access to download.geofabrik.de is required to download public Finland OSM extracts and metadata for local country-data updates; no route geometry is sent to Geofabrik. These HTTPS hosts supply data for the extension’s trail-planning features. No remotely hosted executable code is downloaded.

## Remote code

Select “No, I am not using remote code.” All extension logic is packaged. Overpass responses and Geofabrik downloads contain OSM data, not executable extension logic. The map bridge script is packaged.

## Data disclosures and certifications

Declare location data: geographic map and route-area bounds are transmitted for OSM queries even though device geolocation is not requested. Explain local route processing and synchronized settings in the policy and listing. Do not claim that no user data is handled merely because the developer has no server. Review the current dashboard category definitions for network metadata and preference handling, and answer consistently with the policy and actual behavior.

Certify no sale of user data, no use or transfer unrelated to the disclosed single purpose, and no use for creditworthiness or lending only after checking the final package and policy. The policy contains the affirmative Limited Use statement required by the [program policies](https://developer.chrome.com/docs/webstore/program-policies/policies).

## Reviewer instructions

Install the Chrome package and allow the background Local Finland data tab to finish importing. Open a supported Komoot planner, tour edit or full-screen tour map page; use a reviewer-owned account if Komoot requires login. Test trail colours, Show hazards, trail checks and warning navigation. Open settings to read the privacy policy and Local Finland data controls. Outside Finland coverage, online requests can be slow or throttled. Explicit current-route refresh asks for confirmation and can query online even inside coverage.

## Remaining publication work

Publish the policy and corrected README; package and validate a release containing the source changes; upload that reviewed Chrome ZIP; apply the description, policy URL, single-purpose field, permission justifications and data certifications. Review listing images and branding rights, support details and publisher account requirements. Verify the final listing prominently displays the data disclosures before installation. The old published 1.5.1 ZIP does not contain these source fixes.

## Upload files

Use `artifacts/chrome--komoot-routing-buddy-1.5.2.zip` as the extension upload. Its bundled Finland metadata is named `data/finland/snapshot.json`; only the root extension manifest is named `manifest.json`. This avoids the reported Store upload rejection.

The `artifacts/chrome-store-1.5.2/` folder contains the description, short description, single-purpose text, policy copy, submission guide, two 1280×800 screenshots reused from the README, a padded 128×128 listing icon and a 440×280 small promotional tile. Existing screenshots show the earlier settings panel; they demonstrate trail-colouring and hazard features rather than the new privacy text or trail checker.
