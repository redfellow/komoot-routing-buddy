# Chrome Store update — 1.8.0

Status: preparing; no package validation or publication claimed yet.

1. Upload `artifacts/chrome--komoot-routing-buddy-1.8.0.zip` only. It must contain exactly one `manifest.json` at the ZIP root, version 1.8.0; Finland metadata remains `data/finland/snapshot.json`.
2. Use listing-description.txt, short-description.txt, single-purpose.txt and reviewer-instructions.txt. Existing Store screenshots can remain. No new permissions or host permissions are added.
3. Retain the permission justifications and data disclosures from 1.7.0. The policy now also describes generated POI ownership metadata in Komoot descriptions and cleanup after route edits. Public policy: https://github.com/redfellow/komoot-routing-buddy/blob/main/PRIVACY.md . Packaged privacy.html matches.
4. Verify the validated package, latest bundled Finland extract, hashes, archive integrity and Firefox lint before submission. See package-validation.json after the release build.
5. Submit the update for Chrome Web Store review. GitHub publication and Store upload are separate from approval and public Store availability. Do not announce it as live before approval.
6. GitHub also receives the Firefox ZIP for temporary/manual use while Firefox Store availability is pending. It is unsigned; do not describe it as a signed permanent installation.
