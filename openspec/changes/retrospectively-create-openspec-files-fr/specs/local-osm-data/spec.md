## ADDED Requirements

### Requirement: Bundled Finland data
The extension SHALL bundle and automatically import Finland OSM data so covered areas need no online OSM queries, and SHALL use the Overpass API outside coverage.

#### Scenario: Covered area
- **WHEN** the map shows an area in Finland after import
- **THEN** hazard and trail data come from local data without Overpass requests

### Requirement: Country updates
The extension SHALL offer weekly country updates (on by default) that can be paused and resumed, keep previous data usable until the update succeeds, and show the data date in **Local Finland data**.

#### Scenario: Failed update keeps data
- **WHEN** a country update fails
- **THEN** the previous data remains in use

### Requirement: Route refresh and cache
**Update current route from OSM** SHALL fetch fresh data around the route and keep it for seven days. **Clear OSM cache** SHALL clear online data and route refreshes but keep the Finland snapshot.

#### Scenario: Clearing cache
- **WHEN** the user clicks **Clear OSM cache**
- **THEN** the Finland snapshot remains available
