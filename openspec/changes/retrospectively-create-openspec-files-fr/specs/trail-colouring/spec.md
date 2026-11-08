## ADDED Requirements

### Requirement: Trail difficulty colouring
The extension SHALL colour S0–S5 MTB trails on supported Komoot planner, route editing and full-screen map pages using the user's chosen colours and selected difficulty levels, with or without Komoot's MTB layer.

#### Scenario: Selected levels are coloured
- **WHEN** the user enables trail colours and selects S1 and S2
- **THEN** only S1 and S2 trails are drawn in their configured colours

#### Scenario: Colour toggle on the floater
- **WHEN** the user turns trail colours off from the floater toggle
- **THEN** the extension trail highlighting is removed from the map

### Requirement: Map state persistence
The extension SHALL remember the user's map layers, sidebar state and floating panel position across page loads.

#### Scenario: Panel position restored
- **WHEN** the user moves the floater and reloads the page
- **THEN** the floater reappears at the saved position
