# Documentation migration index

This index tracks incremental adoption of OpenSpec. It is a documentation inventory, not a behavior specification or proof of implementation, acceptance, merge or release. Follow the [specification policy](../AGENTS.md#specifications-and-documentation).

Initial inventory: 2026-10-28. Refreshed: 2026-11-17, after ten capability specs were accepted into `specs/` through the archived [retrospective change](changes/archive/2026-11-08-retrospectively-create-openspec-files-fr/proposal.md). Those specs were written from existing documentation and are short summaries. No existing document has been compared with them section by section, so all coverage below is **partial** at most. Existing documents remain reference material; verify their claims against source, tests and runtime evidence when changing behavior. Absence from OpenSpec does not authorize removal.

## Accepted specs

| Spec | Domain |
| --- | --- |
| [trail-colouring](specs/trail-colouring/spec.md) | Trail colours, master toggle, remembered map and floater state |
| [hazards](specs/hazards/spec.md) | Mapped hazard display |
| [route-check](specs/route-check/spec.md) | Trail check limits and lifecycle |
| [ride-analysis](specs/ride-analysis/spec.md) | Ride summary, riding categories, route list and approved POIs |
| [squadrats](specs/squadrats/spec.md) | Gain estimates and layer presentation |
| [keyboard-shortcuts](specs/keyboard-shortcuts/spec.md) | Map shortcuts and inspection view |
| [road-numbers](specs/road-numbers/spec.md) | Shields, colours, sources and visibility zoom |
| [local-osm-data](specs/local-osm-data/spec.md) | Bundled Finland data, updates, route refresh and cache |
| [onboarding](specs/onboarding/spec.md) | First-use guide and replay |
| [settings-privacy](specs/settings-privacy/spec.md) | Storage, data leaving the browser, package parity, version line |

## Status and updates

- **Maintained**: supporting guidance or policy that continues to be updated outside OpenSpec. Extract behavior requirements when relevant; retaining a guide is not a migration failure.
- **Reference / mixed**: existing behavior, design or implementation documentation, sometimes mixed with historical evidence. Migrate only the affected requirements; retain useful explanations and historical records.
- **Historical**: dated evidence or past release records. Preserve as history; do not infer current behavior or release status from them.
- **Backlog**: possible future work, not an accepted behavior contract.

For each reviewed migration, replace the coverage gap with links to exact accepted spec requirements, record the affected document sections, and identify remaining gaps. Link the reviewed change and retirement decision. Use **partial** until all relevant requirements are covered or explicitly disposed of. Retire only the reviewed content, repair incoming links and preserve unrelated sections. Archiving an OpenSpec change alone does not justify retirement.

## Existing documentation

Paths are relative to the repository root. “Partial” names the accepted spec for the same domain; it does not mean the document's sections have been checked against that spec. “None” means no accepted spec covers the domain; it does not mean the behavior is absent.

| Document | Role / status | Accepted OpenSpec coverage and remaining work | Disposition |
| --- | --- | --- | --- |
| [AGENTS.md](../AGENTS.md) | Maintained agent conventions and specification policy | No product behavior replacement needed. | Maintain here; policy owner. |
| [README.md](../README.md) | Maintained user-facing guide: purpose, installation, usage and privacy summary, including behavior summaries | Partial: its behavior summaries overlap all ten specs. Installation steps, package sizes and the privacy summary have no spec. | Retain; update with the matching spec when user-visible behavior changes. |
| [READMORE.md](../READMORE.md) | Maintained developer setup, commands, verification and implementation conventions | None for embedded behavior/privacy constraints. Extract affected constraints when changing acquisition or integration. | Retain operational guidance; link future specs. |
| [PRIVACY.md](../PRIVACY.md) | Maintained public privacy policy | Partial: settings-privacy covers storage and no upload to a project server. Recipients, request contents and retention remain uncovered. | Retain public policy and keep consistent with packaged policy and behavior. |
| [privacy.html](../privacy.html) | Maintained packaged privacy policy | Same as the public Markdown policy. | Retain packaged disclosure; keep both policy formats consistent. |
| `TODO.md` | Backlog: Firefox signing and distribution. Git-ignored, so it exists only in local checkouts | None; backlog is not accepted requirements. | Review through a scoped change before implementation; update backlog disposition afterward. |
| [RELEASE-NOTES.md](../RELEASE-NOTES.md) | Historical version records; maintained for new releases | No replacement intended; not a current behavior baseline. | Preserve past entries; add verified release records. |
| [docs/KEYBOARD-SHORTCUTS.md](../docs/KEYBOARD-SHORTCUTS.md) | Reference / mixed: keys, temporary inspection, restoration, master toggle and prior validation | Partial: keyboard-shortcuts. Capture filtering, state restoration and integration constraints remain to be checked when touched. | Retain reference; separate historical evidence from migrated requirements. |
| [docs/ROUTE-CHECKER.md](../docs/ROUTE-CHECKER.md) | Reference / mixed: eligibility, matching, warnings, caches, retries and maintenance | Partial: route-check and hazards. Matching rules, caches and retry detail remain to be verified and selectively captured. | Preserve implementation guidance; replace requirement sections only with reviewed coverage. |
| [docs/RIDE-OVERVIEW.md](../docs/RIDE-OVERVIEW.md) | Reference / mixed: analysis, POI approval/placement, ownership, accessibility and dated validation | Partial: ride-analysis. Includes multiple iterations and historical unreleased/uncommitted claims that require verification; ownership metadata and accessibility are not in the spec. | Migrate by section; preserve safeguards, implementation context and dated evidence. |
| [docs/ANALYSIS-IMPROVEMENTS.md](../docs/ANALYSIS-IMPROVEMENTS.md) | Reference / mixed: completed checklist, design decisions, detection rules and historical completion evidence | Partial: ride-analysis. Overlaps ride overview but contains decisions and validation evidence. | Reconcile affected requirements with ride overview before selective retirement; preserve history. |
| [docs/SQUADRATS-ESTIMATES.md](../docs/SQUADRATS-ESTIMATES.md) | Reference / mixed: six estimates, data sources, calculations, bounds, UI and validation limits | Partial: squadrats. Calculations, bounds and validation limits are not in the spec. | Verify affected requirements and limits; do not infer numeric agreement from a completed validation plan. |
| [docs/ONBOARDING.md](../docs/ONBOARDING.md) | Reference / mixed: guide presentation, once-per-install claim, replay, accessibility and implementation notes | Partial: onboarding. Accessibility requirements remain to be checked. | Capture affected requirements; retain usage and implementation guidance as useful. |
| [docs/ROAD-NUMBERS.md](../docs/ROAD-NUMBERS.md) | Reference / mixed: shields, visibility, Finland references, provenance, regeneration and historical checks | Partial: road-numbers. The bundled data contract and provenance are not in the spec. | Migrate behavior selectively; retain preparation commands, attribution and historical evidence. |
| [docs/LOCAL-OSM.md](../docs/LOCAL-OSM.md) | Maintained setup/support guide with embedded data contract and behavior | Partial: local-osm-data. Snapshot format, storage and acquisition constraints are not in the spec. | Retain operational instructions; migrate affected contracts and link specs. |
| [docs/RELEASING.md](../docs/RELEASING.md) | Maintained release procedure mixed with version-specific preparation notes | No product behavior replacement yet; historical notes do not establish current readiness. | Maintain release instructions under AGENTS.md conventions; preserve dated evidence separately when reorganizing. |
| [docs/CHROME-STORE-SUBMISSION.md](../docs/CHROME-STORE-SUBMISSION.md) | Historical 1.5.2 submission copy and publication checklist | None; dated listing text and pending tasks are not current policy or publication evidence. | Preserve dated record; verify current package/policy before reusing submission material. |
| [docs/CHROME-STORE-AUDIT-1.5.1.md](../docs/CHROME-STORE-AUDIT-1.5.1.md) | Historical store audit and remediation record | No replacement intended. | Preserve evidence; verify findings before treating them as open or resolved today. |
| [docs/CHROME-STORE-VALIDATION-1.5.2.md](../docs/CHROME-STORE-VALIDATION-1.5.2.md) | Historical candidate validation | No replacement intended. | Preserve version-specific evidence; does not validate later releases. |

## OpenSpec artifacts and exclusions

- [compare-squadrats-estimates-with-komoot-ui](changes/archive/2026-10-29-compare-squadrats-estimates-with-komoot-ui/proposal.md) is an archived manual validation change, not accepted capability coverage. Its proposal declares no new or modified capabilities. Task completion does not prove independent numeric agreement or justify retiring the Squadrats reference document.
- `config.yaml` configures OpenSpec; `specs/` holds accepted requirements, and `changes/` holds proposed work and archived history. Neither this inventory nor archived designs replace accepted specs.
- `.agents/skills/openspec-*/SKILL.md` and `.harvaaja/` contain tool workflow instructions. `card-plans/` holds härvääjä card plans. These are tooling guidance and work records, not product requirements or legacy documents to migrate.
- `LICENSE` is legal licensing material and remains maintained separately. Dependency files such as `scripts/local-osm/requirements.txt` and application UI HTML are not documentation migration targets. The packaged `privacy.html` is included above because it is a policy document.

## Retirement decisions

No behavior documentation is approved for deletion or archival by this inventory. No domain has verified complete replacement coverage.
