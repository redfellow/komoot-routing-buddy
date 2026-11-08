# onboarding Specification

## Purpose
Introduce new users to the main features with a short, dismissible first-use guide that can be replayed.

## Requirements

### Requirement: First-use guide
Once per install, after the first supported map and floater are ready, the extension SHALL show three non-blocking cards attached to the floater with progress, Skip, Next, Back after the first card, and Done on the last. Next SHALL NOT run analysis, change preferences or insert POIs. Skip, Done and Escape dismiss the guide. The seen marker SHALL be kept in local (not synced) storage and survive updates.

#### Scenario: Shown once
- **WHEN** the user completes or skips the guide
- **THEN** it is not shown again on later page loads

#### Scenario: Empty route
- **WHEN** no route is planned
- **THEN** all three steps can still be completed

### Requirement: Guide replay
Settings → **Show quick guide** SHALL replay the guide without resetting the automatic-display marker.

#### Scenario: Replay
- **WHEN** the user chooses **Show quick guide** after dismissing the guide
- **THEN** the guide is shown again and is still not shown automatically on later page loads
