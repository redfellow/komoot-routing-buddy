## ADDED Requirements

### Requirement: Squadrats gain estimates
When **Estimate gained Squadrats** is on (the default) and the separate Squadrats extension has loaded the collection, Analyse route SHALL estimate new Squadrats, Yard, Übersquadrat and the three Squadratinho variants for the route, making no extra account requests.

#### Scenario: Estimates disabled
- **WHEN** the user disables **Estimate gained Squadrats**
- **THEN** no estimates are shown

#### Scenario: Collection not loaded
- **WHEN** the Squadrats collection is unavailable
- **THEN** no estimate is presented as known

### Requirement: Squadrats layer presentation
The extension SHALL let the user adjust Squadrats opacity and place its squares below roads and trails.

#### Scenario: Opacity change
- **WHEN** the user lowers Squadrats opacity
- **THEN** the Squadrats layer is drawn more transparently
