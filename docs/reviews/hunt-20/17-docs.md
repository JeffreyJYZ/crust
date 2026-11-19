# Hunt 20 — docs and generated skill file

Scope read: `site/app/docs/**`, `site/public/SKILL.md`, `scripts/skill/**`, plus the code each claim names. Labels: `measured` = I ran it (registry count, `skill:check`, git tags, `ls-remote`); `read` = I read the source. No e2e, no GUI, no cursor, no file edited but this one.

## Medium — Four guides say typed failures are HTTP 200; the bridge sends 4xx/5xx
- where: `site/app/docs/guides/shell/page.mdx:100`, `site/app/docs/guides/window/page.mdx:55`, `site/app/docs/guides/clipboard/page.mdx:56`, `site/app/docs/guides/window-state/page.mdx:69-70`
- mechanism: All four state the typed `{ ok: false, code, message }` answer arrives with HTTP 200. `resultStatus()` (`src/bridge/server/failure-status.ts:35-40`, read) maps that shape to 4xx/5xx — mapped codes (`invalid-args`→400, `unknown-window`→404, `unknown-adapter`→501) and unmapped codes default to 400. `site/app/docs/reference/api/page.mdx:21` (read) and `site/public/SKILL.md:166-167` (read) already describe the new transport, so the docs contradict each other.
- reachable by: Any page call that produces a typed plugin failure, e.g. `invoke("window","setTitle",{label:"nope",title:"x"})` answers `unknown-window` with a 404; an agent that generates fetch-level code checking `response.ok` from these guides gets the wrong result. Branching on `result.ok` still works — the stale part is the status claim.
- smallest fix: Replace the "200" wording in those four lines with "a code-derived 4xx/5xx, body unchanged", and link `/docs/reference/api#failure-status`.

## Medium — Shell guide documents an older shell plugin: no `write`, no `close`, "No stdin"
- where: `site/app/docs/guides/shell/page.mdx:33-40`, `:86`, `:90-98`
- mechanism: The Commands table lists only `spawn`, `output`, `kill`, `list`. The registry (`measured`: `scripts/skill/registry.ts:22`) already registers six shell commands: `spawn output write close kill list`; `write` and `close` are implemented at `src/plugins/shell.ts:132-148` and after (read). Line 86 says "No stdin, no pty. A program that prompts gets nothing" — but `stdin: "pipe"` is a real `spawn` arg (`src/plugins/shell-args.ts:16-17`, read) and `write` feeds it (`src/plugins/shell-stdin.ts:9-12`, read); `SKILL.md:230` documents both. Line 40 calls `env` "deliberately absent" though it is accepted and refused by default with `env-not-allowed` (`src/plugins/shell-env.ts:39-60`, read), and the table omits `env?`/`stdin?` from `spawn`. The failure-code table omits `no-stdin` entirely.
- reachable by: A developer reads this guide to pipe input into an allowlisted program, concludes stdin feeding is impossible, and ships no `write` call; or calls `invoke("shell","write",...)` believing no such command exists.
- smallest fix: Regenerate the Commands table from the registry, add `write {id,data}` and `close {id}` rows, add `env?`/`stdin?` to `spawn`, replace line 86 with the `stdin:"pipe"` + `write` flow, and add `no-stdin` to the failure table.

## Medium — API reference index omits four registered namespaces and reports the wrong count
- where: `site/app/docs/reference/api/page.mdx:7-19`
- mechanism: It says "The 31 namespaces" and lists 31. The generated registry has 32 (`measured`), and the running app registers 34: the 32 plus `single-instance` (`src/runtime.ts:79`, read) and `app` (`src/runtime.ts:96`, read). The list omits four real invokable namespaces — `database`, `keychain`, `screen`, `sidecar` — each present in the 32 and each with its own guide page, while including `updater`, which is registered only with config. 32 − 4 + 3 = 31, so the hand-maintained count and list drift together.
- reachable by: A developer treats the index as the map of crust's callable surface, needs a database or keychain or screen or sidecar call, and finds no reference page link for it.
- smallest fix: Generate the namespace list and count from `scripts/skill/registry.ts` (plus the two runtime-only namespaces), or add the four missing entries and correct the number.

## Low — SKILL.md gives `shell.write` the wrong argument shape
- where: `site/public/SKILL.md:230`
- mechanism: The hand-written arg table groups `output`/`write`/`close`/`kill` under `{id}`. `readWrite()` (`src/plugins/shell-stdin.ts:15-20`, read) requires `{ id, data }` with a string `data`; a bare `{id}` answers `invalid-args` naming the missing field (`src/plugins/shell.ts:132-138`, read). This line sits outside the `skill:commands` markers, so `skill:check` (`measured`: PASS) cannot catch it.
- reachable by: An agent following the "eight commands" table calls `invoke("shell","write",{id})` to feed a spawned process and gets `invalid-args` instead.
- smallest fix: Split `write {id,data}` out of the `{id}` group.

## Low — SKILL.md quickstart pins v0.1.29 while the tree and install guide are at v0.1.32
- where: `site/public/SKILL.md:15-16`
- mechanism: `bunx github:JeffreyJYZ/crust#v0.1.29 init my-app` is three releases behind `package.json` version `0.1.32` (`read`) and behind `site/app/docs/start/install/page.mdx:82,99` (`#v0.1.32`, `measured` against remote tags). SKILL.md:5-6 advertises Linux (GTK3/WebKitGTK), Windows (WebView2) and six platform binaries; those surfaces landed in v0.1.31/v0.1.32 (`git log v0.1.30..HEAD`, read), after the pinned tag. The pin predates the claims beside it. The frontend guide pins `#v0.1.16` at `:27,41`, sixteen releases back.
- reachable by: An agent or user follows the SKILL.md quickstart verbatim, installs v0.1.29, and does not get the cross-platform surface the same file promises.
- smallest fix: Generate the pin from `package.json`'s version (as the install guide does), bump to `#v0.1.32`, and re-check the frontend guide pins.

## Low — SKILL.md names `updater.install` as a built-in example, but updater is conditional
- where: `site/public/SKILL.md:217`
- mechanism: The examples of "Each has commands with documented args" list `fs.readBinary`, `tray.setTooltip`, `power.onSleep`, `updater.install`. `updater` is not among the 32 in the table (`measured`) and is registered only when `crust.config.ts` has an `updater` section (`src/runtime-plugins.ts:73`, read); without it a call answers `unknown-plugin`. The updater guide and `api-updater` page state the condition, SKILL.md does not.
- reachable by: An agent reads SKILL.md's working surface, calls `invoke("updater","install",...)` in an app with no updater config, and gets `unknown-plugin`.
- smallest fix: Qualify the example — "(only when `crust.config.ts` has an `updater` section)" — or replace it with a command from the 32-namespace table.

## Checked and clean
- `scripts/skill/**` generation: `render()` wraps command lists at 100 chars, `registry()` sorts namespaces only, `skill.ts` replaces strictly between markers; `bun run scripts/skill.ts --check` (`measured`) passes and the table has 32 rows matching the live registry.
- CLI docs vs code: `site/app/docs/reference/cli/page.mdx` names the same eight commands as `src/cli/commands.ts` (`init dev build sign dmg package notarize doctor`); flags, `--dir`/`--config`/`--entry`/`--format` and single-file mode match `src/cli/index.ts` (read).
- Security prose: "absent or empty capabilities allows every command", "present means deny by default", and "grant follows the token's window label, not the body's `window`" match `src/bridge/server/capabilities.ts` and `invoke.ts` (read). `security.csp` is a real config key (`validate-security.ts:11`).
- Failure-code set in SKILL.md:247-251 matches all twelve `CrustErrorCode` members and their statuses in `src/bridge/errors.ts` (read).
- a11y page side: `pageTree`/`focusElement` answer shape and codes match `src/bridge/client/a11y-page.ts` (read).
- `app.on` event list, `app.command`/`use`-after-run, `window.crust.ready`/`invoke` two-form dispatch, store `name` files, dialog cancel `{paths:[]}`, `activate` default `"always"` and `CRUST_DEV_FILE` all match code (read).
- Standalone template counts: `scripts/build-standalone.ts` `--react 6`/`--next 8` exclude `.gitignore`, consistent with the seven React files described in the frontend guide (measured by `fd`).
