# Road-number emphasis

Settings → Emphasize road numbers is enabled by default; an explicitly saved off preference is retained. It is a map presentation preference that uses Komoot's existing vector road labels and ref properties; route analysis is unaffected. No runtime OSM queries or new permissions are added.

On 2026-10-14, Brave inspection of Komoot's thunderforest_outdoors source confirmed road-label features containing ref=339 on Kangasalantie/Messukylänkatu and ref=9 on the motorway. The integrated checkbox also displayed four-digit refs such as 2505 on Nokian valtatie. Smaller refs are available in detailed tiles; they cannot appear if the selected map or zoom does not supply them.

The implementation preserves native road-name labels and adds compact bold road-number shields with rounded corners and a fine inset border. Reference metadata selects a Finnish-style category: 1–39 red, 40–99 yellow, 100–999 white and 1000–9999 blue. Reference categories take precedence over physical highway class: live Komoot data labels Nokian valtatie (2505) as primary, although its requested shield is blue. Non-numeric references fall back to the native highway/class/type metadata or Komoot layer class; unknown categories use grey. This presentation does not claim to implement every country's official sign scheme.

Red type is 1.05 times the native label size; blue type is 0.75 times, so smaller roads read less prominently. Shields repeat at 600 screen-pixel intervals along a feature, with collision padding reducing nearby duplicates across segments. They retain normal collision detection and take priority over native arrows/labels. Stretchable centres preserve rounded corners and borders around longer refs.

Reference-only native labels are suppressed while their shields are visible, avoiding duplicate numbers. Road names keep their native colour and layout; shields sit beside them and remain upright. Native fonts and road-class filters are reused; the visibility slider controls the shield zoom limit. shields participate in normal collision detection. Cycling route refs, ferry labels and route waypoint numbers are excluded. Turning the option off removes shield layers and restores reference labels. Map/style replacement invalidates old backups and applies the preference to the new labels. The master On/Off toggle suspends road-number emphasis too.

Validation: the non-build JavaScript suite covers the shield update and keyboard inspection. Cases cover metadata-driven colours and sizes, unknown classes, missing refs, name preservation, reference-only labels, cycling-reference isolation, idempotent restyling, native restoration, zoom expressions and replacement styles. The Settings checkbox and shield rendering were exercised in Brave. Live inspection confirmed road 12 as motorway and road 2505 as primary, motivating reference-category precedence. The final smaller-blue, rounded, wider-spacing revision was visually checked in Brave after unlocking the Mac; temporary shortcut test handlers were removed. Captures are under artifacts/road-number-design, including shields-final-live.png.

Included in the 1.8.0 release; the previously uploaded 1.7.0 ZIP does not contain this feature.

Road-label frequency was subsequently increased to 600 px spacing, with 12 px text and 3 px icon collision padding, after the 1,400 px revision left some viewports without numbers. Collision handling remains enabled. This density adjustment is covered by the existing shield tests but has not yet been visually checked after an extension reload.


## E-road references and overview visibility

The updated source adds a bundled Finland road-reference overlay. Live inspection at the pictured 4 km scale (zoom 9.994 near Tampere) found no `road-label` references in the loaded Komoot tiles. At zoom 12, national refs were present but `int_ref` was absent. Lowering native label zoom limits alone therefore cannot provide these labels.

The overlay derives each road segment's national `ref` and international `int_ref` from the Finland OpenStreetMap extract, including E-road relation memberships when prepared from PBF. Green E-number shields appear beside national shields; the national number is never used to guess an E-route. Adjacent ways with identical refs, international refs and highway class are joined for continuous label placement. Geometry is simplified to approximately 2 m tolerance; it is used only for labels, never routing or analysis. Native number shields outside Finland retain the existing map-data behavior. Within the bundled extract coverage, the overlay replaces them to avoid duplicates. Street names remain native.

Settings → **Show road numbers up to** controls minimum map zoom from 8 to 14, default 9. The displayed scale is an approximation for Finland: ~16 km through ~250 m. The default includes the reference 4 km view. Actual scale depends on latitude. Both national and E-number shields use the same limit and normal collision handling. The preference and the master Off toggle remove both overlay layers and their source. No external requests are made to calculate or display the bundled labels.

### Data provenance and refresh

Road-reference data is © OpenStreetMap contributors, licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), separate from the extension code's licence. The generated `road-references-fi.js` contains the source timestamp. The source extract is supplied by [Geofabrik](https://download.geofabrik.de/europe/finland.html). Download a Finland PBF, then regenerate without building the extension:

```sh
.venv-local-osm/bin/python scripts/road-numbers/prepare.py --pbf /path/to/finland.osm.pbf --coverage /path/to/snapshot/manifest.json
```

The preparation tool also accepts `--input` with an Overpass JSON response, or downloads public Finland ways from Overpass if neither input is supplied. PBF preparation additionally reads E-road relations. The generated dataset is bundled at release time and does not update through the hazard-data updater.


Current bundled references: `finland-261018.osm.pbf`, OSM timestamp **2026-10-18T20:25:06Z**, 8,900 merged sections and 687 sections with international refs. The generated script is approximately 8 MB before ZIP compression. This source update is not part of the already published 1.8.0 packages.

Live verification in Brave: both national and green E-number shields rendered around Tampere at zoom 9.994 with the visible 0–4 km scale bar. Moving the slider from 9 (~8 km) to 11 (~2 km) hid the shields at that overview while KRB remained On; the preference was restored to 9. Master Off also removed the overlay. No MapLibre style errors were observed during this check. Automated coverage includes preference bounds, immediate layer updates, Off cleanup, bundled geometry and E-ref integrity, relation membership, simplification and source packaging.
