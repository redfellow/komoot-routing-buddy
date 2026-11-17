# AGENTS.md

## Specifications and documentation

OpenSpec adoption is incremental. `openspec/specs/` is the canonical source for accepted requirements and intended behavior explicitly covered there. Missing coverage means unspecified; it does not imply that existing behavior is unsupported or may be removed. Do not attempt to specify the whole codebase before making a scoped change.

`openspec/changes/` contains proposals and ongoing work. These artifacts do not override the accepted baseline until reviewed and incorporated through the project's integration workflow. Archived changes preserve history; archive status alone does not establish implementation acceptance, a merged PR or a release.

Source, tests and runtime evidence establish observed behavior. If they conflict with specs or documentation, identify the discrepancy and resolve the intended contract through review. Do not silently rewrite requirements to match implementation or change implementation merely because documentation is incomplete.

### Migration on change

1. Before changing a domain, consult [the migration index](openspec/MIGRATION.md), relevant accepted specs, existing docs, source and tests. Treat existing requirement documents as reference material until explicitly superseded; verify claims when they affect the change.
2. Capture new or changed behavior requirements and necessary compatibility constraints through an OpenSpec change. Include the affected existing behavior needed to make that change understandable and testable. Record uncertainties and conflicts rather than inventing a complete baseline. For Codex, use `$openspec-propose`, `$openspec-apply-change` and `$openspec-archive-change`; other tools use their installed invocation forms.
3. In the change artifacts, identify exact legacy files or sections affected, their proposed disposition and the replacement spec references. Touching a domain does not authorize retiring all of its documentation.
4. Retire content only after review confirms that it is superseded, intentionally obsolete or preserved elsewhere. Verify implementation acceptance and integration status separately from OpenSpec archival. Make approved retirement a reviewed task, preserving content outside the scope and repairing links. If replacement coverage is incomplete, retain the content and record the remaining work in the index.
5. Update the migration index with verified coverage, remaining gaps and retirement decisions. Never mark a domain migrated based only on completed tasks, a proposal or an archive operation.

### Maintained and historical documentation

- Maintain installation guides, troubleshooting, developer and release instructions, privacy/security policies, API references and useful implementation comments outside OpenSpec as appropriate. File location alone does not make a document historical. Keep public privacy disclosures consistent with the packaged policy.
- Define each accepted behavior requirement in one canonical place. Once migrated, link supporting guides to the spec instead of maintaining competing requirement definitions. Usage explanations and examples may remain in guides.
- Preserve historical reports and validation evidence as history. Do not present old verification, publication or acceptance claims as proof of current behavior. Mark mixed documents and migrate their requirement sections selectively.
- The root README is the maintained user-facing guide: project purpose, installation, usage and a privacy summary. Update it together with the matching spec when user-visible behavior changes; where the two overlap, the accepted spec is canonical. Put architecture and implementation detail in supporting documentation.
- Correct only your own mistaken documentation edits; preserve unrelated user changes. Documentation cleanup must be explicitly scoped and reviewed, never an automatic consequence of touching a subsystem.

### Before task completion or PR creation

- [ ] Affected behavior requirements and compatibility constraints are captured in the relevant OpenSpec change or accepted specs; pending proposals are not described as accepted behavior.
- [ ] Conflicts between intended and observed behavior are resolved or explicitly recorded for review, with verification limits stated.
- [ ] Each proposed documentation retirement has exact scope and verified replacement coverage, or an explicit obsolete/preserved disposition; remaining gaps are tracked in the migration index.
- [ ] Maintained guides and links are accurate, historical evidence remains identifiable, and unrelated user edits are preserved.

## Formatting & Style

- **Brace Style**: Stroustrup style strictly (`else`, `catch`, `finally` on a new line after the closing brace).
- **Indentation**: Tabs. Exception: YAML files must use spaces because YAML forbids tabs for indentation.
- **Semicolons**: Always explicit.
- **Quotes**: Double quotes (`"`) for strings, backticks (`` ` ``) for templates.
- **Arrow functions**: Avoid, unless used as oneliners.
- **CSS**: Use BEM naming for CSS classes (`block`, `block__element`, `block--modifier`, `block__element--modifier`).

---

## TypeScript Guidelines

- **Strict Types**: No `any`. Use `unknown` for dynamic data and narrow with runtime guards/schemas.
- **Explicit Returns**: Always specify return types on exported and public functions.
- **Immutability**: Use `readonly` and `as const` for fixed configurations.

---

## Node.js Guidelines

- **Imports**: ESM syntax. Prefix Node built-in modules with `node:` (e.g., `node:fs/promises`).
- **Async**: Use `async`/`await` over standard Promise chains.
- **Errors**: Throw custom `Error` classes. Never swallow errors in empty `catch` blocks.

---

## Version control Guidelines

- **Commits**: Use ´[$TERM] ´ prefix for commits. For the $TERM, use "Conventional Commits" specification, in uppercase.
- **Commit messages**: Be concise.

## Per prompt considerations

- Only run build commands if the user asks you to
- If asked for commits, ask to approve after suggestion, and push commits if approved

## Releasing new versions
- When the user asks to tag a new release, this (git) tag is always made in the main branch, never in development
- Rebase the main branch so that it contains new code from development branch
- Increment the version number in manifest.json by 0.1 and
- Finally then do a git tag, and only then run the build scripts

<!-- hv:begin -->
## Härvääjä

This repository is run by härvääjä, which plans, builds and reviews its work as cards on a board. Code freely; hv is
here if you want it:

- `hv board` shows the board.
- `hv capture` puts an idea, bug or chore on the board as a card.
- `hv fast-lane` sends work made outside the board to the base branch through härvääjä's checks.
- `hv brand` prints the workspace's brand book (its look and voice rules); run it before UI work when the workspace has one.

Never edit a card's worktree under `harvaaja-worktrees/`: use Build again on the card, or answer its question.
<!-- hv:end -->
