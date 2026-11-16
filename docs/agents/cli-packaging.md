# cli-packaging lane

Wiring `crust package`, `crust notarize` and the doctor `extensions` block. Lane memory, not a contract: read the code before trusting a line here.

## Layout decided

- **`src/cli/index.ts` is dispatch only** (parse, help, version, unknown command, one try/catch); the argv work is `parse.ts`, the help text `usage.ts`, the name-to-handler map `commands.ts`.
- **One file per command group** — `src/cli/package.ts` plus `src/cli/package/{format,options}.ts`, `src/cli/notarize.ts`, `src/cli/doctor/extensions.ts`; never grow `index.ts` past the cap again.
- **`commands.ts` is the single list**; `commands.test.ts` asserts every key appears in `usage.ts` as `crust <name> `, so a command missing from `--help` fails a test.
- **`isCommand` uses `Object.hasOwn`**, so inherited members (`toString`) never read as commands; a plain `in` check would accept them.

## Traps measured

- **`Parsed.options` must be `InitOptions`, not `CliOptions`** — `--react`/`--next` live on `InitOptions`; typing it as `CliOptions` is two TS2339 errors and `bun check` names both.
- **`windows: []` is an invalid config** — `windows — expected a non-empty array of window objects`; every test fixture needs `windows: [{ label: "main" }]`.
- **`bun check <files>` still checks the whole graph** (211–473 files); it proves nothing by scoping, so read the `file=` lines and confirm none are yours.
- **`crust package` on `examples/hello` really ran `diskutil` and wrote a 38.79 MiB dmg** — a live probe is not free; the artifact was removed, and a demo run should point at a temp project instead.
- **nsis writes the `.nsi` beside the app directory's parent, which is the project root** (`out ?? <appPath>/../<id>.nsi`), so a package run leaves `land.jyz.hello.nsi` outside `dist/`.
- **appimage with no `app.icon` refuses before `buildAppImage` runs** — the icon line prints, no AppDir is staged, and `install appimagetool` never appears; only a project with an icon reaches the tool check.
- **`crust notarize` preflights before looking for the bundle**, so an ad-hoc machine gets the certificate refusal even with nothing built — that ordering is the point, not an accident.

## Decisions

- **`BINARY_NAME = "crust-app"` lives in `src/cli/package/options.ts`**, not imported from `build.ts` (another lane owns that file); if `build.ts` ever renames the binary, this constant is the second place to change.
- **`--format` is validated in `parse.ts`** (`parseFormats`), deduped, and a bare `crust package` leaves `options.formats` undefined so the command owns the `["dmg"]` default.
- **A format that refuses never aborts the loop** — each builder runs inside a try/catch, `describe*` is printed verbatim, and any refusal sets exit 1 while the other formats still build.
- **The doctor block reuses `describeExtensions` verbatim**, indented by two spaces, and its failures are `files.filter((file) => !file.ok).length`; a missing toolchain for a file is a `fail`, a missing `native/` is one line and zero.
- **`extensionsSection(dir, seams)` takes `ExtensionSeams`**, so a test injects `exec`/`findTool`; the real doctor passes none and spawns `<tool> --version`.

## What the refusals print

- **package, no bundle**: `crust package: no .app in <dir>/dist — run crust build first`.
- **package, missing packer**: `appimage  unavailable  appimagetool is not on PATH; install appimagetool (AppDir …)` and `nsis  script only  <script>  (makensis is not on PATH; install makensis)`.
- **package, no icon**: `appimage  unavailable  app.icon is not set — it needs a 512×512 PNG`.
- **notarize, ad-hoc**: `notarize refused   ad-hoc identity cannot be notarized — requires a Developer ID Application certificate`.
- **notarize, no credential**: `notarize refused   no notarytool credential — requires notarytool store-credentials <profile> or appleId + password`.

## Docs touched in the same turn

- `site/app/docs/reference/cli/page.mdx` — eight commands, `--format` row, the four notary env vars, the `extensions` block in the doctor order.
- `site/app/docs/guides/package-formats/page.mdx` and `guides/notarize/page.mdx` — the "library only / not wired" status lines are gone.
- `site/app/docs/guides/native-extensions/page.mdx` — the doctor section now says `crust doctor` prints it; `crust extensions build` still does not exist.
- `bun run site:build` and `bun run check:links` (offline, a file lookup) both pass.

## Tree state at hand-off

- **Every gate is green at hand-off**: `bun check` (473 files), `bun test src/cli` (80 pass), `bun run test src/cli` (782 pass), `bun run check:lines`, `bun run site:build`, `bun run check:links`.
- **The linux lane's missing `./scheme-page.ts` landed while this lane was working** — mid-run `bun check` and `bun run test` were red on `src/platform/linux/**` only; rerun before believing a red, and read the `file=` lines to see whose it is.
