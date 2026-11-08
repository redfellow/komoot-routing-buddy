# squadrats Specification

## Purpose
Estimate Squadrats gains for a planned route and adjust how the separate Squadrats extension's layers are drawn.

## Requirements

### Requirement: Squadrats gain estimates
When **Estimate gained Squadrats** is on (the default) and the separate Squadrats extension has loaded the collection, Analyse route SHALL estimate new Squadrats, Yard, Übersquadrat and the three Squadratinho variants for the route, making no extra account requests. Unavailable or incomplete collection data SHALL NOT be shown as zero gain, and the master Off toggle SHALL suspend estimation.

#### Scenario: Estimates disabled
- **WHEN** the user disables **Estimate gained Squadrats**
- **THEN** no estimates are shown

#### Scenario: Collection not loaded
- **WHEN** the Squadrats collection is unavailable
- **THEN** no estimate is presented as known

### Requirement: Squadrats layer presentation
When the separate Squadrats extension's layers are on the active map, the extension SHALL let the user adjust Squadrats opacity (default 50%) and place its squares below roads and trails (on by default). The master Off toggle SHALL restore Squadrats' own ordering and opacity.

#### Scenario: Opacity change
- **WHEN** the user lowers Squadrats opacity
- **THEN** the Squadrats layer is drawn more transparently
