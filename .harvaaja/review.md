# Review criteria

Besides tracing every behavior to the change's spec, hold the change to these. Each one broken is a change to make.

## Safety

- Nothing weakens handling of user data; no new manifest permissions or host access without the spec saying so (see PRIVACY.md).
- No automated test reaches Komoot, OSM servers or any outside service.

## Compatibility

- Stored settings (extension storage, IndexedDB caches) stay readable by the previous version, or the change says how they migrate.
- Works in both Chrome and Firefox packages; no browser-specific API outside browser-api.js.

## Style

- Follows AGENTS.md: tabs, double quotes, semicolons, Stroustrup braces, BEM, no `any`.
- New behavior has a `node:test` test with a tier comment.

## Words

- Text a person reads is plain and specific: what happened and what can be done.
