# Lane X — `logging.configure`
Decision: add the command. The sink path is fixed at construction (`logDirs`), the runtime singleton has no config-named log path, and `setLevel` only moves the level — Butter's file-repointing half was genuinely absent; option 2 (call it covered) was not true.
- `configure({ file?, level? })` in `src/plugins/logging.ts` — level validated as `setLevel`; file repointed after containment; archive becomes its sibling so rotation follows. Returns `{ ok, file, level }` or `{ ok: false, error }`.
- `src/plugins/logging-configure.ts` — `resolveLogFile` enforces inside-app-data-root, symlink-safe (relative, `..`, sibling-prefix and symlink escapes refused). Split out; `logging.ts` stays at 194 lines.
- `docs/agents/butter-coverage.md` — F2 row `partial (F2)` → `same`, finding closed.
Tests: `src/plugins/logging-configure.test.ts`, 5 cases (level move/refuse, repoint + archive, both together, four escapes, resolver accept). Existing logging/os/barrel files: 31 pass.
Checks: `bun check` clean when run, `bun run check:lines` pass, `bun fmt` on my three files only.
Lane Y owns `site/app/docs/reference/parity/page.mdx` — flip its F2 row to `same`.
