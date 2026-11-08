# road-numbers Specification

## Purpose
Make road numbers easier to read on Komoot's map with coloured road-number shields.

## Requirements

### Requirement: Road-number emphasis
**Emphasize road numbers** SHALL be on by default and retain an explicitly saved off preference. It SHALL draw bold road-number shields beside native road-name labels, which are preserved. It SHALL make no runtime OSM queries and SHALL NOT affect route analysis. The master Off toggle SHALL remove all shields.

#### Scenario: Saved off
- **WHEN** the user has turned the setting off
- **THEN** it stays off after an update

### Requirement: Road-number shield colours
Shield colour SHALL follow the numeric reference before the highway class: 1–39 red, 40–99 yellow, 100–999 white, 1000–9999 blue. Non-numeric references SHALL fall back to the road class, and unknown categories SHALL be grey.

#### Scenario: Category colour
- **WHEN** a road label has ref 2505
- **THEN** its shield is blue regardless of highway class

### Requirement: Road-number sources
Outside the bundled Finland coverage, shields SHALL use the refs of Komoot's existing road labels. Within it, a bundled OpenStreetMap overlay SHALL supply national refs and green E-road shields in place of native shields.

#### Scenario: E-road in Finland
- **WHEN** a road in the bundled Finland data has an international ref
- **THEN** a green E-number shield is shown beside its national shield

### Requirement: Road-number visibility zoom
**Show road numbers up to** SHALL set the minimum map zoom for road-number shields, from 8 to 14 with a default of 9; out-of-range saved values are clamped. National and E-road shields SHALL use the same limit.

#### Scenario: Zoom limit
- **WHEN** the limit is 11 and the map is at zoom 10
- **THEN** no road-number shields are shown
