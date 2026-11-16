## Why
Users and bug reports need to know which extension version is installed; today the popup does not show it.

## What Changes
- Add a small muted line at the bottom of the settings popup (below the "Local Finland data" link) reading `Version <manifest version>`.
- `popup.js` fills it at runtime from `KrbBrowser.runtime.getManifest().version`, so it never needs manual updates.
- New BEM class in `popup.css`; README mentions the version line.

## Outcome
- Popup footer
  - After: `Version 1.9.0`

## Assumptions
- Element is a `<p class="settings__version" id="version">` placed right after the data link; alternative was inline next to the link.
- If the runtime API is unavailable the line stays empty rather than showing a placeholder.
