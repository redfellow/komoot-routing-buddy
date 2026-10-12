# Chrome Web Store audit: 1.5.1

Reviewed on 2026-10-12. Result: package checks pass, but full Store compliance is not established. Public privacy documentation needs correction and completion before submission.

## Artifact identity and checks

- Published release: https://github.com/redfellow/komoot-routing-buddy/releases/tag/1.5.1
- Chrome ZIP: `artifacts/chrome--komoot-routing-buddy-1.5.1.zip`, 149,782,250 bytes.
- SHA-256: `b56c616e876ff6271215ac76cf27a2cf4650c5a0596e2591024423348c977a84`. Matches GitHub's published asset digest and size; the remote ZIP was not downloaded independently.
- ZIP CRC validation passed for all entries. 1,216 entries; 152,010,762 uncompressed bytes. Manifest at archive root declares Manifest V3 and version 1.5.1. Package is below the Store's 2 GB upload limit.
- Packaged JS/HTML/CSS matches workspace source except the expected generated `bundled-config.js`, which enables packaged data.
- Runtime review found packaged scripts/workers, data-only Overpass/Geofabrik downloads, HTTPS with credentials omitted, and no remote script execution or analytics implementation.
- Content scripts target Komoot planner/edit/full-screen tour pages. Background route/hazard messages check the extension identity and Komoot sender URL; area bounds are validated. These checks are not a complete security audit.
- OSM attribution and ODbL notice are included. Finland snapshot: 2026-10-11T20:21:06Z.
- 60 targeted tests passed: browser API, page scope, update scheduling, hazards and settings dialog. No builds, packaging, publication or fresh browser runtime acceptance were performed.

## Findings requiring resolution

1. **Incorrect local-only preference disclosure.** README's “Preferences, country data and route matching stay in your browser” is inaccurate when Chrome Sync is enabled. `settings.js`, `popup.js`, `content.js` and `route-dialog.js` use `storage.sync` for colours, rules, options, layer selections and route-check preferences. Disclose browser-managed synchronization and Google as the Chrome sync provider, or change implementation to local storage in a future release. Route geometry matching and country data remain local in the reviewed implementation.
2. **Incomplete public privacy policy evidence.** The repository has a brief README privacy section, but no dedicated policy or affirmative Limited Use compliance statement was found in the reviewed files. Publish an accessible, accurate policy describing local route processing, synchronized preferences, map/route-area bounds sent to Private.coffee, VK Maps and overpass-api.de, and public downloads from Geofabrik. Explain normal network information, purposes, retention/deletion controls and applicable provider handling without claiming control over their logs. Include an affirmative Chrome Web Store User Data Policy / Limited Use statement and supply its URL in the dashboard. An existing external policy/dashboard URL could not be verified.
3. **Pre-install disclosure and consent are unverified.** Hazard display defaults on and can send map-area bounds outside local coverage without an additional prompt. The packaged settings help describes area-bound requests, but this alone does not establish informed pre-install consent. The Store listing must prominently explain this behavior and recipients. Dashboard data disclosures must reflect location-related area bounds and sync behavior; do not make an unconditional “no user data handled” claim.

## Permissions and listing review

All four declared API permissions have implemented uses: `storage` for preferences/job state; `unlimitedStorage` for the large local OSM database and download staging; `alarms` for update scheduling; `declarativeNetRequestWithHostAccess` for endpoint-scoped User-Agent identification of this extension's own Overpass POST requests. Host permissions correspond to the three Overpass providers and Geofabrik. No unused API permission was identified. Host permission paths do not provide meaningful path-level access restriction; explain the required hosts in dashboard justifications.

The features support a coherent single purpose: helping users inspect MTB trails while planning Komoot routes. The listing should explain bundled data size, automatic import, default weekly country downloads of roughly 770 MB, opt-out controls, mapped-condition limitations, and that routes are not changed. Do not imply Komoot endorsement; confirm rights to branding/artwork. These are listing checks, not findings of infringement.

The observed publication is a GitHub release with Developer mode installation instructions. No Chrome Web Store item URL or publisher dashboard was available. Consequently, uploaded Store package identity, policy URL, permission justifications, single-purpose declaration, privacy certifications, listing assets, account requirements and Google review status remain unverified. GitHub publication is not evidence of Store approval.

## Official requirements consulted

- Program policies: https://developer.chrome.com/docs/webstore/program-policies/policies
- Privacy FAQ: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- Manifest V3 requirements: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
- Dashboard privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Package/upload limit: https://developer.chrome.com/docs/webstore/publish
- Chrome storage sync behavior: https://developer.chrome.com/docs/extensions/reference/api/storage

This audit records evidence and outstanding requirements; it does not guarantee Google's approval.

## Source remediation on 2026-10-12

The working source now corrects README sync disclosures, adds `PRIVACY.md` and packaged `privacy.html`, links the policy from settings and the data page, prominently names OSM recipients in settings and trail checks, and improves explicit route-refresh confirmation. The policy includes the affirmative Limited Use statement. `CHROME-STORE-SUBMISSION.md` supplies listing text, permission justifications and publication steps. These changes have not been built into or published as a replacement for the audited 1.5.1 ZIP. Public policy availability, Store dashboard fields and pre-install disclosure/consent remain pending publication and verification.
