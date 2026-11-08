## Approach
One ADDED-only delta per feature area, drafted from README.md and docs/. The build verifies each requirement and scenario against the code (defaults, thresholds, names) and corrects the spec text, never the code. Then the change is archived (`openspec archive` if available, otherwise moving the deltas to `openspec/specs/<capability>/spec.md` with a Purpose section and the change folder to `openspec/changes/archive/<date>-retrospectively-create-openspec-files-fr/`).

## Why
ADDED deltas plus archive is the standard OpenSpec path and leaves main specs as the baseline for later changes.
