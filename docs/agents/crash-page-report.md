# crash page-report lane memory — Lane V

- **One store, two writers.** `writeRecord` (`src/runtime-crash-write.ts`) owns both files, their `0600` and the rotation, so a page report cannot drift from a guard record. `StoredCrash` adds `type: "signal" | "webview"` plus optional `message`/`stack`; `report` writes `"webview"` with `signal`/`code`/`address`/`exitCode` null because nothing faulted.
- **Cap, not refusal.** Log keeps the newest `MAX_CRASH_RECORDS` (200) — there was no cap before. `truncateField` keeps the whole value inside `MAX_CRASH_CHARS` (8192) *including* its suffix; the first cut appended past the cap and grew the record, caught by test.
- **No `url` on `configure`.** Butter POSTs every crash; uploading is the app's privacy decision, so a `url` key is ignored and a test asserts no report is sent.
- **`configure` fences on the data root**, not the current dir, and `install` keeps arming `crashRecordPath(dataRoot)` — the guard reads `crash-record.bin` from the root, so a repointed log must never move the record. Both asserted.
- **Trap:** `list`/`readLastCrash` fold a `type`-less record to `"signal"`; the page half wrote nothing before this field existed, so an older file cannot be miscredited.
- **200-line cap** split the file: write half to `runtime-crash-write.ts`, shapes to `crash-reporter-types.ts`, both re-exported so no caller changed.
- **Left for its owner:** `src/plugins/barrel-system.ts` (another lane) does not yet list `ReportCrashArgs`/`ConfigureCrashArgs`/`StoredCrash`; they are reachable via `crash-reporter.ts`'s own `export type *`.
- **Gate:** `bun check` clean (745 files), `check:lines` pass, 24 tests green across the three crash test files.
