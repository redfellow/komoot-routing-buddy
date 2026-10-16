# Map keyboard shortcuts

Shortcuts work on supported Komoot planner/edit/zoom pages once the map is ready. They do not consume keys while typing, using editable controls or dialogs, or when a modifier key is held. Number and sport-map keys work while ordinary buttons are focused; Space retains native button/link activation. Repeated keydown events are ignored. Settings contains a **Keyboard shortcuts** disclosure.

| Keys | Action |
| --- | --- |
| Space | Toggle satellite inspection; press again to restore the previous view |
| 1 / 2 / 3 / 4 / 5 | Default / NLS Map / Satellite / OpenStreetMap / OpenCycleMap |
| Q / W / E / R / T | First through fifth sport-specific map choices in Komoot's displayed order |

Komoot currently exposes four sport choices: None, Hiking, Cycling and MTB. T reports an unavailable fifth choice until Komoot supplies one. Country/account restrictions still apply to maps. Switching uses Komoot's existing controls and does not bypass access checks.

Space snapshots the actual selected map, sport overlay and heatmap, rather than relying on saved preferences. It selects Satellite with sport map None and heatmap None, suspends extension trail highlighting, renders route strokes as solid 1 CSS pixel lines in the default blue read from Komoot’s routed layer, and hides borders, surface dashes, direction arrows, the original-track reference, Squadrats and heatmap layers. The Squadrats extension's own enabled setting is not changed. Layer properties and visibility are saved by layer identity and restored exactly, including already-hidden layers. Layers that appear during inspection receive the override too; replacement styles retain their own original widths. Route geometry, waypoints and saved routes are unaffected.

Commands are queued. Two quick Space presses enter and restore in order. Other map shortcuts restore the snapshot first, then select the requested map. Failed entry attempts roll back; if restoration fails, its snapshot remains available for another Space press. Temporary selections are excluded from KRB's remembered-layer writes; ordinary shortcut selections are remembered when that preference is enabled. Komoot can maintain its own map preferences as its controls are used.

Implementation: `content.js` contains key filtering and the state controller and operates the existing map chooser and displays brief status feedback. `map-bridge.js` applies reversible line/visibility overrides. No new permissions or data requests are introduced.

Validation: automated tests cover keyboard filtering, native map controls, queued cancellation, inspection restoration, and the master toggle. The installed Brave manifest was found to omit the former keyboard script, so the controller now lives directly in `content.js`. A button-focus regression was reproduced after closing Settings: the old filter rejected number and sport-map keys from ordinary buttons. Tests now cover those keys and immediate progress feedback. The user confirmed the keyboard shortcuts work in Brave. The solid-line revision was checked separately with a temporary preview of the updated source on the live route; that preview was removed after verification. Its screenshot is `artifacts/road-number-design/solid-route-inspection-preview.png`. The latest source requires reloading the extension and Komoot tab.

ASD is reserved for Komoot. The master toggle disables shortcuts and restores an active inspection. It also stops hazard updates and analysis, clears map highlights and road shields, restores Squadrats ordering and opacity and suspends remembered map/sidebar behaviour. The opacity slider controls collected squares, grid lines and new-route highlights. The separate below-roads option only lowers overlays above the roads; it never raises low native masks.
