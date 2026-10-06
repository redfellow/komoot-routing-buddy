# Release guide

Distribute the Chrome ZIP and a signed Firefox XPI through GitHub Releases. The package command produces unsigned Chrome and Firefox ZIPs. Local Finland data is part of the guarded release workflow; see [LOCAL-OSM.md](LOCAL-OSM.md).

## Prepare and test

1. Run `npm ci` with a supported Node.js version. Set up `.venv-local-osm` with the pinned requirements in [LOCAL-OSM.md](LOCAL-OSM.md).
2. Set the agreed version in `manifest.json` and update [release notes](../RELEASE-NOTES.md). Follow AGENTS.md for requested commit/tag work.
3. When packaging is explicitly requested, run `npm run package`. It obtains the latest public Finland extract, requires a source age of at most seven days, validates the prepared/copy data, runs regression/native tests and Firefox lint, then generates both ZIPs in `artifacts/` with `chrome--` / `firefox--` prefixes.
4. Provider failure, stale/nonlatest data, invalid geometry/checksums or failed checks stop packaging. Existing data does not silently become a release fallback.
5. Test the actual outputs before sharing them, including initial country-data import and update recovery. Record browser versions, ZIP sizes, snapshot source date and validation limitations.

`npm run data:release` prepares/selects data without building the extension. `npm run build` is a code-only developer build; release packaging uses the mandatory data gate.

## Installation and acceptance

Chrome/Chromium: unpack the Chrome ZIP and load its folder through Developer mode. Firefox: temporary debugging installation is for development; stable self-distribution uses Mozilla's unlisted signing flow. Signing uploads/agreements are separate authorized actions. Mozilla accepts submissions up to 200 MB, including self-distribution; the packaging flow stops an oversized Firefox candidate. [Mozilla submission guidance](https://www.extensionworkshop.com/documentation/publish/submitting-an-add-on/).

Check:

- New profile: automatic background-tab import, country count/date and no bulk public-provider download for installation.
- Interrupted import: resume and retention of the previous usable generation.
- Local overlays and route checks, including covered empty areas, uncovered fallback and known S1 warnings at maximum S0.
- Weekly/manual country updates, pause/resume, old-data continuity, cleanup and automatic tab closing.
- Current-route-only refresh, seven-day authoritative empty overrides and replacement by a newer snapshot.
- Existing Komoot settings, sidebar/layer persistence and unchanged route geometry; unrelated pages stay unaffected.

Firefox runtime acceptance remains deferred at the user's request; package lint has passed. Mobile is unvalidated. Record these limits in release validation instead of claiming unperformed checks passed.

## Data, privacy and distribution

Keep OSM attribution and the derived database's ODbL notice in both outputs. Geofabrik receives public country-download requests; it does not receive route geometry. Overpass may receive area bounds for uncovered fallback or deliberate current-route refresh. Route geometry and local matching remain in the browser. No analytics were added.

Review the final code, permissions and data/license files. Attach the reviewed ZIPs to the intended release destination only when publishing is authorized. If Firefox signing is needed, obtain and distribute the signed copy through the chosen self-distribution channel; do not imply an unsigned ZIP is a permanent stable-Firefox install.

## 1.5.0 preparation

Verified on 2026-10-06: 196 Node tests, seven native-data tests, JavaScript convention checks and Firefox lint pass. Both ZIPs are about 150 MB, include the October 4 Finland extract and pass checksum/content validation. The provider's latest-source identity was rechecked before handover.

The final package was tested in Chrome 154.0.8037.98 for local trail warnings, warning navigation and the revised settings/data pages. Firefox runtime testing remains deferred. ZIPs, SHA-256 checksums and release notes are prepared. Firefox signing and release publication remain separate steps.
