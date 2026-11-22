# Fix failing checks: install, unit & firefox-lint

## Why
The install check (`npm ci`) fails because npm writes its cache to `~/.npm/_cacache`, which the check sandbox refuses ("refused write /Users/red/.npm/_cacache/tmp/…"). Without `node_modules`, `unit` (needs `fake-indexeddb`) and `firefox-lint` (needs `web-ext`, ERR_MODULE_NOT_FOUND) fail too. The blamed commit ca84a51b2a11 only edits `.agents/skills/*` docs; it is just the first run under the stricter sandbox.

## What Changes
- The `install` check in `.harvaaja/checks.yaml` runs `npm ci --cache "${TMPDIR:-/tmp}/npm-cache"`, so the npm cache lives in the sandbox's temp folder. Human-only path, so it is a triage task.
- No code, test or spec changes.

## Acceptance
- install, unit and firefox-lint pass on the card's checks.

## Citations
- `.harvaaja/checks.yaml` (install check: `npm ci`)
- `git show --stat ca84a51b2a11` (only `.agents/skills/` files)

## Assumptions
- Cache goes to `$TMPDIR` via `--cache` rather than a committed `.npmrc` (which would also affect developers' local npm).
- The cache is not kept between runs; a cold download each install is accepted rather than asking for a writable `~/.npm`.
