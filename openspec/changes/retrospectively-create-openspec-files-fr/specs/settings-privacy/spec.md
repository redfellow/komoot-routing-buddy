## ADDED Requirements

### Requirement: Synced preferences
Preferences (trail colours, rules, map options, trail-check preferences) SHALL be stored in browser sync storage. Route matching and country data SHALL stay in the browser with no analytics or upload to a project server.

#### Scenario: No upload
- **WHEN** the user analyses a route
- **THEN** no route data is sent to a project-operated server

### Requirement: Cross-browser packages
Chrome/Brave and Firefox MV3 packages SHALL offer the same features.

#### Scenario: Firefox parity
- **WHEN** the Firefox package is loaded
- **THEN** the same settings and features are available as in Chrome
