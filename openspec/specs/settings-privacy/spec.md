# settings-privacy Specification

## Purpose
Define where preferences and data are stored, what leaves the browser, and feature parity across browser packages.

## Requirements

### Requirement: Synced preferences
Preferences (trail colours, rules, map options, trail-check preferences) SHALL be stored in browser sync storage; device-local state such as the floater position, the quick-guide marker and the automatic country-update preference SHALL be stored in local storage. Route matching and country data SHALL stay in the browser with no analytics or upload to a project server.

#### Scenario: No upload
- **WHEN** the user analyses a route
- **THEN** no route data is sent to a project-operated server

### Requirement: Cross-browser packages
Chrome/Brave and Firefox MV3 packages SHALL offer the same features.

#### Scenario: Firefox parity
- **WHEN** the Firefox package is loaded
- **THEN** the same settings and features are available as in Chrome

### Requirement: Version in settings popup
The settings popup SHALL show the installed extension version, read at runtime from the extension manifest, in a muted line at the bottom of the popup.

#### Scenario: Version shown from manifest
- **WHEN** the user opens the settings popup and the manifest version is 1.9.0
- **THEN** the popup shows `Version 1.9.0` at the bottom
