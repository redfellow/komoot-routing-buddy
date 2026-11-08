## ADDED Requirements

### Requirement: Ride summary from Komoot data
**Analyse route** SHALL produce a ride summary of route character, climbing concentrations and steep climbs from Komoot surface, way-type and elevation data, without querying OSM for the summary. Missing native metadata SHALL stay unknown; Komoot surfaces and way types SHALL never be replaced by OSM. Native S grades are used first, with conservative OSM matching filling missing MTB grades.

#### Scenario: Analyse while collapsed
- **WHEN** the user clicks **Analyse route** on the collapsed floater
- **THEN** the ride summary and trail checks start together with separate progress indicators

### Requirement: Riding category thresholds
Gravel SHALL qualify after 1.5 km of gravel/dirt, Trails after 500 m of singletrack or S0, and Technical after 250 m of S1–S5, by default. Gaps up to 150 m SHALL join stretches without counting toward the minimum. Thresholds SHALL be adjustable.

#### Scenario: Short gap joins stretches
- **WHEN** two gravel stretches of 800 m are separated by a 100 m paved gap
- **THEN** they count as one 1.6 km Gravel stretch

### Requirement: Along the route list
Warnings SHALL appear beside riding sections in a distance-ordered **Along the route** list with distinct icons for difficulty, width and obstacles. Hover or focus SHALL highlight a section without moving the map; click SHALL zoom to it.

#### Scenario: Hover highlights
- **WHEN** the user hovers a section
- **THEN** it is highlighted and the map does not move

### Requirement: Route POI suggestions with approval
**Preview route POIs** SHALL propose `Gravel`, `Trails`, `Technical`, `Hills`, `Steep climb` and `Halfway` POIs with names under 16 characters, and SHALL insert only those the user selects via **Add approved POIs**. Existing custom POIs SHALL be protected, duplicates avoided, ordinary waypoints within 100 m reused, and the original route restored if insertion fails. The extension SHALL NOT save the route automatically.

#### Scenario: Only approved points inserted
- **WHEN** the user ticks two of five suggestions and clicks **Add approved POIs**
- **THEN** exactly those two POIs are added to the route

#### Scenario: Existing matching point
- **WHEN** a matching point already exists on the route
- **THEN** it stays zoomable and is excluded from approval

#### Scenario: Insertion failure
- **WHEN** insertion fails
- **THEN** the original route is restored
