## ADDED Requirements

### Requirement: Version in settings popup
The settings popup SHALL show the installed extension version, read at runtime from the extension manifest, in a muted line at the bottom of the popup.

#### Scenario: Version shown from manifest
- **WHEN** the user opens the settings popup and the manifest version is 1.9.0
- **THEN** the popup shows `Version 1.9.0` at the bottom
