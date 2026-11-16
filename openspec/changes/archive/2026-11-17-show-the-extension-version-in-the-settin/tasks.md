## 1. Version line

- [x] 1.1 Add `<p id="version" class="settings__version">` after the "Local Finland data" link in popup.html, a muted small `.settings__version` rule in popup.css, and in popup.js set its text to `Version ${KrbBrowser.runtime.getManifest().version}` on load
  - Tests to update: test/popup-colours.test.mjs (its vm harness stubs `KrbBrowser` and `querySelector`; add `runtime.getManifest` and a `#version` node so it keeps passing)
  - proof: `node --test test/popup-colours.test.mjs`
- [x] 1.2 Add test/popup-version.test.mjs (first line `// @harvaaja-test-tier: fast`) that runs popup.js in a vm with a stubbed manifest version and asserts the `#version` text is `Version <stub version>`
  - proof: `node --test test/popup-version.test.mjs`
- [x] 1.3 Mention the version line in README.md's settings popup section
  - proof: `grep -n "Version" README.md`

## Manual checks after merge (The user)

- Open the popup in Chrome and Firefox and see `Version 1.9.0` muted at the bottom.
