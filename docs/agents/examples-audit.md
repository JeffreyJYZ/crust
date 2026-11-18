# Examples audit (lane C2, fix wave 2)

One tree, no worktree. Every command below ran from `/Users/jyz/dev/crust`. Builds and the suite ran
in the foreground. GUI launches were wrapped in `probe-run -c '…'`, which restored the frontmost app
afterwards (Shadowrocket each time); no survivors were left.

## The extension example

`examples/extensions/` matches the API it claims to use:

- `crust/extension` resolves to `src/extensions/define.ts` in `package.json`'s `exports` map;
  `defineExtension` brands the plugin and refuses core-name collisions.
- `crust/plugin` supplies `PluginContext`; `crust/extensions` supplies `loadExtensions`.
- `site/app/docs/guides/extensions/page.mdx` describes the same config, loader and generated entry
  blocks as the code. `src/packaging/extension-*.ts` is the separate *native* (`.zig`/`.rs`/`.c`)
  extension pipeline; the JS/TS example does not use it.

Commands and results:

- `bun check examples/extensions/main.ts examples/extensions/extensions/clock.ts examples/extensions/crust.config.ts`
  — `✓ No type errors in 230 files`.
- `bun run src/cli/index.ts build --dir examples/extensions` — built; `extensions 1 file embedded`;
  86.23 MiB app. `examples/extensions/dist/crust-entry.ts` carries both documented blocks
  (`extensionPlugins()` with a guarded dynamic import, `registry.register(...)` before `startApp`).
- `probe-run -c 'timeout 12s …/dist/Extensions.app/Contents/MacOS/crust-app'` — window opened;
  `clock.now`, `clock.startTimer`, three `clock:tick` events and `clock.stopTimer` all printed.
- `probe-run -c 'timeout 8s bun run src/cli/index.ts dev --dir examples/extensions'` — the documented
  dev command works: `extensions 1 of 1 file loaded`, same clock output; `pgrep` found no survivors.

## Other examples

All builds used `bun run src/cli/index.ts build --dir examples/<name>`; all runs used
`probe-run -c 'timeout 7s …/dist/<App>.app/Contents/MacOS/crust-app'`.

| example | build | run |
| --- | --- | --- |
| `hello` | ok | window + `greet hello jyz (page call answered)` |
| `multi-window` | ok | two windows, frames set, both closed cleanly |
| `notes` | ok | window + `listed 0 (page call answered)` |
| `native` | ok | **fails at runtime** — `dlopen("/$bunfs/root/clock.dylib")`; documented dev-only limit (see below) |
| `parity-probe` | ok | initially `FAIL 29/30` (updater unproved); after the fix `PASS 30/30` |
| `vite` | ok | window opened, no crash |
| `dogear` | needs `--entry desktop/main.ts` (its `package.json` supplies this); with it, Vite build + app ok | window + `page boot ok` |

A bare `build --dir examples/dogear` fails `no backend entry — expected src/main.ts or main.ts`.
That is expected: the example's own `bun run build` passes `--entry desktop/main.ts`. No example
failed to build with its documented command.

## Defects fixed (all in `examples/parity-probe/`)

1. Type drift against the committed API — six `bun check` errors in five files:
   - `proofs-connect.ts`: `webview: () => undefined` → `() => null` (`WebviewFor` returns `number | null`).
   - `proofs-data.ts`, `proofs-io.ts`, `proofs-system.ts`: `createOsPlugin({ appId })` →
     `createOsPlugin({ ...darwinOsAdapter(), appId })` (`OsAdapter` now needs the four native reads;
     `paths()` reads `appId`, so the configured id stays in the proof's data root).
   - `proofs-state.ts`: `isEnabled()` / `disable()` now take `{ bundleId }`.
   Before: `bun check` reported those six errors. After: only the gitignored generated native
   bindings remain (finding below).
2. `proofs-updater.ts`: the manifest came from a loopback `http:` server, but `updater.check` now
   applies the download URL policy and refuses `http:`. Replaced `Bun.serve` with a `file:` manifest
   read through `pathToFileURL`, under the `allowFileUrl: true` the proof already set. Before:
   `parity: FAIL 29/30`, `unproved updater`. After: `parity: PASS 30/30`, `updater signed=true
   swapped=true unverified=refused`.
3. `proofs-updater.test.ts` (new): runs `proveUpdater()` headlessly and asserts `true`. It is red on
   the old http manifest and green now. `bun test ./examples` — 18 pass, 0 fail.

`bun fmt` on the seven changed files; `bun fmt --check` clean; `bun run check:lines` PASS.

## Findings outside this lane's ownership (not fixed)

- `examples/native/README.md:38-41` already documents that `crust build` cannot carry native
  dylibs, so a built app dies at `dlopen("/$bunfs/root/clock.dylib")`. The supported path is
  `bun run build:native` + `crust dev` (proved by `bun run e2e:native`). This is a known limitation,
  not an example regression.
- The gitignored `examples/native/extensions/generated/{rustclock,zigclock}.ts` carry 18 `bun check`
  errors (`ffi.symbols.<name>()` on an untyped `ReturnType<typeof dlopen>`). They are emitted by
  `src/packaging/extension-bindings.ts`, which is not in this lane's file set. A fresh clone has no
  generated files; the defect is in the generator, not an example source file.
- `examples/*/dist/` contains build output created by this audit. It is gitignored; left in place
  rather than deleted without permission.

## Unproven

- No `crust dev` run for examples other than `extensions`; those were verified as built binaries.
  `vite` and `dogear` dev modes need a Vite dev server and were not exercised here.
- The native built-app failure is proven, but fixing it (embedding dylibs in `crust build`) is a
  `src/packaging/` change and out of scope.
