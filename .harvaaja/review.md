# Review criteria

Besides tracing every behavior to the change's spec, hold the change to these. Each one broken is a change to make.

## Safety

- Nothing weakens handling of user data; no new manifest permissions or host access without the spec saying so (see PRIVACY.md).
- A change that adds or changes what leaves the browser (Overpass, Geofabrik, any new host) updates PRIVACY.md, `privacy.html` and the Firefox `locationInfo` declaration in `scripts/build.mjs` (READMORE.md, "Data handling").
- No automated test reaches Komoot, OSM servers or any outside service.
- Derived OSM data keeps its ODbL attribution and source provenance (docs/LOCAL-OSM.md).

## Compatibility

- Stored settings (extension storage, IndexedDB caches such as `krb-local-osm-v1`) stay readable by the previous version, or the change says how they migrate.
- A change to the local snapshot format (docs/LOCAL-OSM.md, version 1 contract) says how existing snapshots are read or re-imported.
- Works in both Chrome and Firefox packages; no browser-specific API outside browser-api.js.
- `manifest.json` version changes only in a release (docs/RELEASING.md).

## Style

- Follows AGENTS.md: tabs, double quotes, semicolons, Stroustrup braces, BEM, no `any`.
- New behavior has a `node:test` test with a tier comment.
- User-visible behavior changes update README.md and the matching `openspec/specs` file.

## Words

- Text a person reads is plain and specific: what happened and what can be done.
