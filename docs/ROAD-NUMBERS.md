# Road-number emphasis

Settings → Emphasize road numbers is an opt-in map presentation preference. It uses Komoot's existing vector road labels and ref properties; route analysis is unaffected. No OSM queries, new data sources or permissions are added.

On 2026-10-14, Brave inspection of Komoot's thunderforest_outdoors source confirmed road-label features containing ref=339 on Kangasalantie/Messukylänkatu and ref=9 on the motorway. The integrated checkbox also displayed four-digit refs such as 2505 on Nokian valtatie. Smaller refs are available in detailed tiles; they cannot appear if the selected map or zoom does not supply them.

The implementation preserves road names and enlarges the reference by 35%, with dark green text and a white halo. Reference-only motorway labels are not duplicated. Native fonts, zoom limits, filters and collision rules remain intact. Cycling route refs, ferry labels and route waypoint numbers are excluded. Turning the option off restores original text and paint. Map/style replacement invalidates old backups and applies the preference to the new labels. Trail-colour On/Off is independent of this preference.

Validation: 295 non-build JavaScript tests passed. New cases cover opt-in behavior, missing refs, name preservation, reference-only labels, cycling-reference isolation, idempotent restyling, native restoration, zoom expressions and replacement styles. The actual Settings checkbox was exercised in Brave, with live numbered-road labels inspected. Preview captures are under artifacts/road-number-design.

This is an unbuilt source change after the already-uploaded 1.7.0 package. It is not included in that ZIP and must be packaged in a subsequent Store update.
