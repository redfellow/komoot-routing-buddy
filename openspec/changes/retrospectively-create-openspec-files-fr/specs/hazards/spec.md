## ADDED Requirements

### Requirement: Mapped hazard display
When **Show hazards** is on (the default), the extension SHALL show mapped mud, overgrown sections, fallen trees, obstacles and trail widths from OpenStreetMap on the map.

#### Scenario: Hazards shown by default
- **WHEN** a fresh install opens a Komoot map with mapped hazards in view
- **THEN** hazard icons are displayed

#### Scenario: Hazards disabled
- **WHEN** the user turns off **Show hazards**
- **THEN** no hazard icons are displayed and no Overpass queries are made for map viewing
