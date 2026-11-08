## ADDED Requirements

### Requirement: Trail check against user limits
The extension SHALL check MTB-rated, unpaved trails along the planned route against the maximum difficulty (default S1), minimum width (default 0.4 m) and hazard rule (default disallowed). Roads, streets, cycleways and paved paths SHALL be excluded, and uncertain matches SHALL NOT be checked.

#### Scenario: Too difficult section reported
- **WHEN** the route uses an S3 trail and the limit is S1
- **THEN** a difficulty warning is listed for that section

#### Scenario: Allow hazards
- **WHEN** **Allow hazards** is on
- **THEN** mud, vegetation and obstacles are skipped while difficulty and width are still checked

#### Scenario: Missing data reported
- **WHEN** a checked trail lacks rating, width or surface data relevant to a limit
- **THEN** the missing data is reported as unknown rather than passed

### Requirement: Check lifecycle
Trail checks SHALL start with **Analyse route**, show progress of cached and downloaded areas, retry temporary failures automatically, support **Cancel** and **Retry** keeping completed areas, and clear results when the route is edited or the panel is closed.

#### Scenario: Route edit invalidates results
- **WHEN** the user edits the route after a check
- **THEN** the previous warnings are cleared

#### Scenario: Warning click
- **WHEN** the user clicks a warning
- **THEN** the map centres on that section
