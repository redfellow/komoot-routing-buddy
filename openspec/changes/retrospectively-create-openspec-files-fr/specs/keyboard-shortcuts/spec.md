## ADDED Requirements

### Requirement: Map shortcuts
On supported map pages, **Space** SHALL toggle a satellite inspection view (Satellite, no sport map or heatmap, trail highlighting and Squadrats hidden, 1 px route) and restore the previous view when pressed again. **1–5** SHALL select Default, NLS Map, Satellite, OpenStreetMap and OpenCycleMap; **Q–T** SHALL select sport map choices in Komoot's displayed order.

#### Scenario: Space restores view
- **WHEN** the user presses Space twice
- **THEN** the map, sport overlay and heatmap return to their state before the first press

#### Scenario: Typing is not intercepted
- **WHEN** focus is in an editable control, a dialog is open or a modifier is held
- **THEN** shortcut keys are not consumed

#### Scenario: Unavailable sport choice
- **WHEN** the user presses T and Komoot offers only four sport choices
- **THEN** the extension reports the choice as unavailable
