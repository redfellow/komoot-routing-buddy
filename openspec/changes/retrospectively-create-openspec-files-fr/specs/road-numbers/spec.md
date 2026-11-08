## ADDED Requirements

### Requirement: Road-number emphasis
**Emphasize road numbers** SHALL be on by default, retain an explicitly saved off preference, and draw bold road-number shields from Komoot's existing road label refs while preserving road-name labels: 1–39 red, 40–99 yellow, 100–999 white, 1000–9999 blue. It SHALL add no OSM queries and SHALL NOT affect route analysis.

#### Scenario: Category colour
- **WHEN** a road label has ref 2505
- **THEN** its shield is blue regardless of highway class

#### Scenario: Saved off
- **WHEN** the user has turned the setting off
- **THEN** it stays off after an update
