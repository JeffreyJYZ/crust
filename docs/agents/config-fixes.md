# config lane — fix wave

Lane `config`, owns `src/config/**`. Report: `docs/reviews/defects-wave3/19-config.md`, findings 1–3.

## Finding 1 — fixed

`src/config/validate-shell.ts:34` — `shell.cwdRoot` now must be absolute.
`v.string(...)` result is captured and checked with `isAbsolute`, mirroring `validate-fs.ts`'s
`fs.scope` rule; a relative value raises `shell.cwdRoot — expected an absolute path`.
Reason: the consumer `src/plugins/shell-resolve.ts:75` does `resolve(options.cwdRoot ?? process.cwd())`,
which is the project under `crust dev` but `/` in a built app, so the same relative value drew a
different boundary and `".."` from `/` removed containment entirely.

## Finding 2 — fixed

`src/config/validate-app.ts:10` — `app.id` now refuses `.`, `..`, `/` and `\`.
Mirrors `src/plugins/single-instance.ts:76` (`lockPath`) exactly. Reason: `defaultStateRoot(appId)`
joins the id under `~/Library/Application Support` and `startCrashGuard` mkdirs it at launch, so a
separator escaped that directory, while other consumers folded the id to `_`, splitting app state.
Dotted reverse-domain ids such as `dev.crust.shell` stay valid.

## Finding 3 — not fixed (not this lane)

`src/runtime-plugins.ts:76` — `createStorePlugin()` is called with no adapter, so `defaultStoreRoot`
falls back to the literal `"crust"` and every crust app shares `Application Support/crust/store.json`.
The fix belongs in `runtime-plugins.ts`, which `docs/reviews/fix-wave/LANES.md:26` assigns to the
`runtime` lane. Per the shared BRIEF I did not edit a file another lane owns. Needed change: pass the
app's state root to `createStorePlugin()` the way crash (`root: appRoot`) and downloads
(`app: appId`) already receive it.

## Tests added

- `src/config/validate-shell.test.ts` — "refuses a relative cwdRoot, which would resolve against process cwd"
  (`data`, `./data`, `..`, `../data` all throw `/shell\.cwdRoot/`).
- `src/config/validate-app.test.ts` (new) — accepts `dev.crust.shell`; refuses `../../evil`, `..`, `.`,
  `a/b`, `a\\b`, `/etc`, `C:\\evil` with `/app\.id/`.

Both tests fail against the pre-fix validators: `Validator.string` accepts any non-empty string, so
every newly refused value was previously accepted.

## Checks

`bun test src/config/validate-shell.test.ts src/config/validate-app.test.ts` → 12 pass, 0 fail.
`bun check` → no type errors (591 files). `bun run check:lines` → PASS.
`bun fmt` run with an explicit four-file path list only.

## Durable notes

- When a config key feeds a path that is later `resolve`d or `join`ed into a security boundary, the
  validator must require an absolute path (`fs.scope`, `shell.cwdRoot`); a relative one is resolved
  against process cwd and means different things in dev and in a built app.
- A config id that becomes a file name must refuse the same tokens as the runtime's lock path (`.`,
  `..`, `/`, `\`) or two consumers will disagree about the app's identity.
- Findings can name a file outside the owning lane (here 19-config.md #3 → `runtime-plugins.ts`);
  check `LANES.md` ownership notes before editing and report the cross-lane item instead.
