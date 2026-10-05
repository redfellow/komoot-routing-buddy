# AGENTS.md

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
