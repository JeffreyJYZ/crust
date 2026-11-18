# C3 — error messages (fix wave 2, BRIEF-9)

Owned: error messages and their tests in `src/packaging/`. No error code changed.

## Audit of the eight paths the brief names

| Path | Message site | Verdict |
| --- | --- | --- |
| config fails validation | `src/config/issues.ts:22-29`, `src/config/load.ts:43-100` | Already correct: names the file (source) and every key with `expected … got …`. `docs/agents/api-design.md:31` says do not re-raise. No change. |
| bridge cannot bind | `src/runtime.ts:123` — `crust: the bridge could not bind a port` | Weak: names no port and no next step. File belongs to lane F4 (`BRIEF.md` F4). Reported, not edited. |
| build with no entry | `src/cli/build.ts:53` names dir + both candidates (good). `src/packaging/build.ts:58` — `entry X does not exist` names no fix | CLI half good; packaging half weak and owned by F4. Reported, not edited. |
| missing asset directory | `src/cli/build/resolve-assets.ts:17,57-78` and `src/cli/doctor/build-assets.ts:30-75` name the dir, the key and the build command | Already correct. `src/cli/assets.ts:69` rethrows a raw ENOENT but is inside lane B4's `src/cli/**` ownership. Reported, not edited. |
| plugin that throws | `src/bridge/errors.ts:81` keeps the thrown message; `src/bridge/server/invoke.ts:73` does not name the plugin/command | Weak: no key. Both files belong to lane F1 (`BRIEF.md` F1). Reported, not edited. |
| bad capability grant | `src/bridge/server/capabilities.ts:54-66` names the action, the window, and the capability that would allow it | Already correct. No change. |
| missing frontend dependency | `src/cli/util.ts:190` names `node_modules is missing in <dir> — run bun install first` | Already correct, and the file is B4's. No change. |
| `crust dev` with no `main.ts` | `src/cli/dev.ts:76-77` and `src/runtime.ts:169` name both candidate paths | Already correct. No change. |

## Fixed (this lane)

Five messages in `src/packaging/` named the file but not the fix. Each now also names the config key or the next action:

- `src/packaging/icon.ts:48,52` — short/bad-signature PNG now says `supply a real PNG for app.icon`.
- `src/packaging/app.ts:59` — a binary path with no filename now says `pass a path ending in a file name, e.g. dist/crust-app`.
- `src/packaging/app.ts:89` and `src/packaging/appimage.ts:89` — a missing icon now says `create the PNG or fix app.icon in crust.config.ts`.

Error codes (`bad-request`, plain `Error`) are unchanged; only message text changed.

## Proof

- `bun test src/packaging/error-messages.test.ts` → 5 pass, 0 fail, 12 expect calls.
- `bun check` and `bun run check:lines` — see final report for results.

## Rule learned

The user-reachable error paths in this tree are mostly already fixed by earlier waves; the remaining weak ones sit at layer boundaries (runtime bind, library build, invoke) that other lanes own. Audit those, report them, and change only the layer your lane owns — a second writer on a live lane's file loses one of the two edits.
