## ADDED Requirements

### Requirement: Trail difficulty colouring
The extension SHALL colour S0–S5 MTB trails on supported Komoot planner, route editing and full-screen map pages, with or without Komoot's MTB layer. Each level SHALL have a display rule of **Colour / highlight** (the default for every level), **Dark red — avoid** or **Do not highlight**, and a user-chosen highlight colour. Levels above the **maximum trail level** (default S5) SHALL NOT be highlighted, while Komoot's native paths and labels for those levels remain visible.

#### Scenario: Per-level rules applied
- **WHEN** the user sets S1 and S2 to **Colour / highlight** and the other levels to **Do not highlight**
- **THEN** only S1 and S2 trails are drawn in their configured colours

#### Scenario: Maximum trail level caps highlighting
- **WHEN** the maximum trail level is S2 and S3 is set to **Colour / highlight**
- **THEN** S3 trails are not highlighted and keep Komoot's native appearance

### Requirement: Master On/Off toggle
The floater's On/Off toggle SHALL switch all extension map visuals on or off, and its state SHALL be saved across page loads.

#### Scenario: Toggle off
- **WHEN** the user turns the floater toggle Off
- **THEN** trail highlighting, hazard display and road-number emphasis are removed from the map and **Analyse route** is disabled

### Requirement: Map state persistence
The extension SHALL remember the floater's open state and position across page loads. When **Remember layers** is on (the default), it SHALL also remember and restore the user's map type, sport map and heatmap layers.

#### Scenario: Panel position restored
- **WHEN** the user drags the floater and reloads the page
- **THEN** the floater reappears at the saved position

#### Scenario: Layers restored
- **WHEN** **Remember layers** is on and the user selects a different map type, then reloads the page
- **THEN** the selected map type is restored
