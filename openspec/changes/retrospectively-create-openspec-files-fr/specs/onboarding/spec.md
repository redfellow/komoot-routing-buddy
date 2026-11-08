## ADDED Requirements

### Requirement: First-use guide
Once per install, after the first supported map and floater are ready, the extension SHALL show three non-blocking cards attached to the floater with progress, Skip, Next, Back after the first card, and Done on the last. Next SHALL NOT run analysis, change preferences or insert POIs.

#### Scenario: Shown once
- **WHEN** the user completes or skips the guide
- **THEN** it is not shown again on later page loads

#### Scenario: Empty route
- **WHEN** no route is planned
- **THEN** all three steps can still be completed
