# Tasks

- [x] 1.1 Confirm this branch carries all of hv/main and adds no content beyond the card's plan files
  - proof: `git merge-base --is-ancestor origin/hv/main HEAD`
  - proof: `git diff --stat origin/main HEAD -- . ':(exclude)card-plans'`

## Manual checks after merge (The user)

- The release chip under KRB no longer says main is behind. If it still does, the chip compares something else; capture it in Triage.
