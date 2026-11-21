# Lane memories

Index of `docs/agents/`. Each file is one lane's memory — what it measured, the traps it hit, the decisions it made. A memory is not a contract: read the code before trusting a line in it.

| File                   | Area it owns in `src/`                                                                                                                                     | The one trap a newcomer most needs                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cli-packaging.md`     | `src/cli/` — `package.ts`, `notarize.ts`, `doctor/extensions.ts`, `commands.ts`                                                                            | `Parsed.options` is `InitOptions`, not `CliOptions` — `--react`/`--next` live on the former, and the other typing is two TS2339s.                            |
| `crash-reporter.md`    | `src/platform/darwin/{shim/111_crash,shim/112_crash_install,crash,crash-record}.ts`, `src/runtime-crash-{store,guard}.ts`, `src/plugins/crash-reporter.ts` | `process.kill(process.pid, "SIGSEGV")` never reaches a `sigaction` handler installed through `bun:ffi`; only an externally-sent signal or a real fault does. |
| `docs-site.md`         | `site/` — `app/docs/**`, `lib/nav.ts`                                                                                                                      | Any `\| … \|` table in `parity/page.mdx` is parsed as feature rows, so counts go in a bullet list or `check:parity` lists them as unlisted.                  |
| `downloads-network.md` | `src/platform/darwin/shim/downloads/*.c`, `shim/110_network.c`, `src/plugins/downloads*.ts`, `network*.ts`                                                 | The four downloads C files are ONE translation unit — compiled separately each gets its own statics and the delegate reports into a table nobody reads.      |
| `linux-platform.md`    | `src/platform/linux/` — shim, `backend.ts`, `platform.ts`, `preflight.ts`                                                                                  | `bun:ffi` pointer arguments take `bigint \| Pointer \| null`, never `number`.                                                                                |
| `plugin-barrel.md`     | `src/plugins/index.ts` and `barrel-{core,platform,data,system}.ts`                                                                                         | An ambiguous `export *` does not error — ESM silently drops that name from the namespace, which is why `barrel.test.ts` lists all 81 exports.                |
| `preview-darwin.md`    | `src/platform/darwin/{preview,preview-unit,pump}.ts`, `shim/12{5..9}_preview*.c`                                                                           | `-orderOut:` stops hiding a `QLPreviewPanel` once its owner window has closed, so the teardown is a `NSWindowWillCloseNotification` observer, not a poll.    |
| `ts-extensions.md`     | `src/extensions/`, `src/cli/build/`, `src/config/schema.ts`                                                                                                | `renderExtensionImports` hardcodes the identifier `registry`, so the generated wrapper must name its variable exactly that.                                  |
| `windows-platform.md`  | `src/platform/windows/` — 7 C units, `ffi.ts`, `platform.ts`, `preflight.ts`                                                                               | A COM method is unreachable through a bare function pointer, so every slot crust needs has a named C helper with an index from `WebView2.h`.                 |

Two cross-cutting traps that more than one lane paid for:

- `bun run test <path>` does not scope — the `test` script already names `src/bridge src/plugins src/platform src/cli src/packaging` and bun appends the extra args, so the whole suite runs; use `bun test <path>`.
- `bun check <files>` typechecks that file's module graph, not the repo — a red run from a sibling lane's files is not yours; read the `file=` lines before believing it.

## How lanes work here

- A lane owns a directory, not a file list — give it a folder and it may add as many files as the work needs.
- A lane never trims a file to fit the 200-line cap; it splits by responsibility, and `bun run check:lines` is the measurement.
- A lane keeps its memory in `docs/agents/<lane>.md` — measured facts, traps and decisions written before it reports, so a resumed lane and the next one start informed.
- A lane posts to the board with `group: "crust/waveN"` and passes `to` for a single lane; a post with no `to` wakes every session ever started in this repo.
- A lane never writes the global `AGENTS.md` or this repo's `AGENTS.md` — memory is the coordinator's to keep, and a lane that learns a rule reports it in one line instead.
- One writer per file; two lanes on one path means a merge silently keeps one of them.

## Contradictions between memories

Each pair below is a real disagreement about the same file or contract. The right-hand column says which side the source currently supports, checked at this commit.

### 1. Does `loadPlatform` have a win32 arm?

- `windows-platform.md` — "`src/app-loop.ts` `loadPlatform` still refuses win32 — it throws `no platform for ${process.platform} — macOS only for v1`; that file belongs to the coordinator, so the windows branch is a report, not an edit."
- `linux-platform.md` — "`loadPlatform` is a `switch (process.platform)` with `darwin`, `linux`, `win32` arms, each importing its own barrel, and a `default` that throws a named error."
- **The code supports `linux-platform.md`**: `src/app-loop.ts:63` is `case "win32":` and returns `windows.createPlatform(...)`. `windows-platform.md` was written before that arm landed and is stale.
- Residue worth knowing: the linux arm's own comment (`src/app-loop.ts:58-59`) still says "names the scheme page after the app", which outlived the `crust://` removal.

### 2. Are `navigation`, `findinpage`, `downloads`, `network`, `crash-reporter` and `i18n` registered and exported?

- `docs-site.md` — "Module only — not registered and not re-exported by `crust/plugin`: `navigation`, `findinpage`, `downloads`, `network`, `crash-reporter`, `i18n`", and later "`navigation` and `findinpage` are registered in `runtime-plugins.ts`, while `downloads`, `network`, `crash-reporter` and `i18n` are not yet".
- `plugin-barrel.md` — "darwin adapter exists but the plugin is neither exported nor registered: `downloads`, `network`, `navigation`, `findinpage`, `crash-reporter`", plus "Gap, exported but never registered: `i18n`".
- `downloads-network.md` — "`src/runtime-plugins.ts` does not mount `createDownloadsPlugin` / `createNetworkPlugin`, and `src/plugins/index.ts` exports neither".
- `crash-reporter.md` — "nothing in the barrels names the plugin yet".
- **The code supports none of them**: all six are exported (`barrel-platform.ts` has `navigation`, `findinpage`, `network`; `barrel-data.ts` has `downloads`; `barrel-system.ts` has `i18n`, `crash-reporter`) and all six are mounted in `src/runtime-plugins.ts` (`createNavigationPlugin` 182, `createFindInPagePlugin` 183, `createDownloadsPlugin` 185, `createNetworkPlugin` 188, `createCrashReporterPlugin` 189, `createI18nPlugin` 190).
- Read this as one wave landing incrementally: four lanes recorded the tree mid-write and each is stale on the same point. Re-read `runtime-plugins.ts` before quoting any registration status.

### 3. `docs-site.md` against itself on packaging

- Line 22 — "Packaging and native-extension builders are CLI-reachable: `crust package --format dmg|appimage|nsis` and `crust notarize` both exist".
- Line 44 — "Packaging and extensions pages say 'library only' rather than documenting a CLI command that does not exist at this revision."
- **The code supports line 22**: `src/cli/package.ts` and `src/cli/notarize.ts` exist and `commands.ts` lists them, which `cli-packaging.md` also records. Line 44 is the superseded decision.

### 4. Is a `webview(label)` accessor still missing?

- `downloads-network.md` — "`WindowRegistry` keeps `{win, web}` at creation but exposes only `native(label)`; `darwinDownloadsAdapter({ webview })` needs a `webview(label)` accessor before `downloads.start` can answer anything but `handler-error`."
- **Partly resolved, and not the way the memory asked**: `WindowRegistry` still exposes only `native(label)` (`src/platform/darwin/windows.ts:83`), but `src/runtime-plugins.ts:134` builds its own `webview()` resolver from `windowLabels()[0]` plus `darwinNavigationWebview`, and passes it to `downloads`, `findinpage` and `navigation`. The remaining gap is a second window, not the first.

### 5. Not a contradiction, checked and agreeing

- `windows: []` is an invalid config — `cli-packaging.md` and `ts-extensions.md` both record it, and `validateWindows` agrees.
- `crash-reporter` needs `startCrashGuard()` first and answers `not-implemented` without it — `crash-reporter.md` and `docs-site.md` agree, and `src/runtime-plugins.ts:147-149` catches the guard's refusal for exactly that reason.
- A page loads from the bridge URL with no framework `crust://` scheme — `linux-platform.md` and `windows-platform.md` agree, and this repo's `AGENTS.md` states it as the platform contract.
- A `| … |` table in the parity page becoming feature rows — `docs-site.md` records it and the repo `AGENTS.md` gained the same rule.
