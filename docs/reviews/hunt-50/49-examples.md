# Hunt 50 — examples and scaffold templates

Read-only review. Scope: `examples/**` and `templates/**`, with the first command a user runs as the
primary lens. Only `rg`/`fd` and file reads were used. No builds, no GUI launches, no tree edits.

## Count

**4 new defects** (1 worst, 2 medium, 1 low). Five findings already recorded in earlier hunts are
still present; they are listed at the end so they are not counted twice.

## Worst finding

### W1 — `examples/vite` ships no frontend to a built app, and its dev tool is undeclared

`examples/vite/crust.config.ts:7-10` sets `dev.url` and `beforeDevCommand: "bun x vite"` but no
`build.assets`. The project has no `package.json` and no `public/` directory (`rg --files
examples/vite` lists exactly five files: `crust.config.ts`, `index.html`, `src/main.js`,
`src/main.ts`, `vite.config.ts`). Its page lives at the project root, outside any directory crust
embeds.

Mechanism:

- `src/cli/build/resolve-assets.ts:42-44,83` — with no `build.assets`, the embed directory defaults
  to `public/`; `collectAssets` returns `[]` when that directory is absent
  (`src/cli/build/assets.ts:41-42`). `crust build --dir examples/vite` therefore packages a binary
  with zero page assets.
- `src/bridge/server/assets.ts:63-65` — `hasDocument()` is false with no embedded `index.html`, so
  the SPA fallback at `src/bridge/server/handler.ts:134-138` never fires either. A launched bundle
  has no document to render.
- `src/cli/util.ts:175-177` — `missingInstall()` returns early when `package.json` is absent, so the
  guard that would say "run bun install" never fires. `src/cli/dev.ts:122-127` then runs
  `sh -c "bun x vite"` in a directory with no `node_modules`; Vite is resolved from a parent cache
  or downloaded at run time, not from a declared dependency. Every scaffold template does the
  opposite: it declares its frontend deps and names `build.assets`.

How it is reached: the command printed in `examples/vite/src/main.ts:4`,
`bun run src/cli/index.ts dev --dir examples/vite`, and the matching `build --dir examples/vite`.
On a machine with no ancestor Vite and no network, dev stops with "did not accept a connection
within 30 s" (`src/cli/dev.ts:148-157`); build succeeds but opens a blank window. The existing audit
(`docs/agents/examples-audit.md:42`) records only "vite | ok | window opened, no crash" — it never
asserted page content.

Smallest fix: give `examples/vite` a `package.json` declaring `vite` plus a `build` script, add
`build.assets: "dist"` to `crust.config.ts`, and reference `./node_modules/.bin/vite` in
`beforeDevCommand` as the templates do.

## Other new findings

### M1 — Three dev examples never quit when their window closes

`examples/extensions/main.ts:24`, `examples/vite/src/main.ts:17`, `examples/native/main.ts:23` each
end at `await app.run()` with no `app.on("window-all-closed", …)` listener.

`src/app.ts:163-174` installs the watcher that eventually calls `platform.quit()` *only* when a
`window-all-closed` listener is registered. Without one, `platform.pump()` keeps the process alive
after the last window is destroyed. `examples/hello/main.ts:42-44` and
`examples/notes/main.ts:153-155` show the intended two-line listener.

Reached by: run any of the three with its documented dev command (e.g.
`bun run src/cli/index.ts dev --dir examples/extensions`, `examples/extensions/README.md:33`), then
close the window. The window disappears but the terminal keeps the process; the user must Ctrl-C.
`examples/parity-probe/main.ts:64` and dogear's `quit` command are the two examples that do exit,
so the gap is specific to these three.

### M2 — The only from-nothing check cannot exercise the Svelte or Vue scaffolds

`scripts/first-run.ts:12` picks the template with a three-way ternary: `--next` → next, `--plain` →
plain, anything else → react. `crust init` supports five templates (`src/cli/init.ts:8-13`); the
`--svelte` and `--vue` scaffolds are never scaffolded, installed, built or run by this check.

Reached by: `bun run verify:first-run` (the script's own description,
`scripts/first-run.ts:2-4`, calls it "the only check that would notice a scaffold that installs but
does not build"). A broken install/build chain in the two newest scaffolds ships green because no
first-run lane ever touches them. `docs/agents/templates-svelte-vue.md:27` already names the same
coverage hole for `scripts/verify-package/phases/install.ts` and `scripts/e2e-dev-react.ts`; none of
the three covers those scaffolds.

### L1 — Extension README documents a different run spelling for build

`examples/extensions/README.md:33` uses `bun run src/cli/index.ts dev --dir examples/extensions`,
while line 34 uses `bun src/cli/index.ts build --dir examples/extensions` (no `run`). Both execute
under Bun today, so this is a doc-consistency defect, not a broken command. Reached by copying the
two-line "Commands" block: the second line differs from the form every other example README uses.

## Still open from earlier hunts (not new, not counted)

- `templates/default/gitignore:1-4` omits `.crust/`, which plain-HTML `crust dev` writes —
  `docs/reviews/hunt-20/23-templates.md:31-36`.
- The five templates' `app:invoke` grant comments claim least privilege while the wire alias covers
  every app command — `docs/reviews/hunt-20/23-templates.md:10-15`.
- React/Svelte/Vue scaffolds call `window.crust` with no ambient `Window` declaration; only the
  Next scaffold declares it — `docs/reviews/hunt-20/23-templates.md:17-22`.
- Notes/dogear prose claims `crust:fs` lacks `list`/`remove`/`mkdir` —
  `docs/reviews/hunt-20/23-templates.md:24-29`.
- `scripts/line-cap.ts:10` does not walk `templates/` —
  `docs/reviews/defects-wave3/15-templates.md:45-53`.

## Checked and clean

- `rg --files examples templates` plus reads of every `main.ts`, `crust.config.ts` and entry page:
  the greet command name, `dev.url` port, `strictPort`, `build.assets`/`outDir` pairing and Vite
  plugin wiring agree across all five scaffolds and all runnable examples.
- All five templates register a `window-all-closed` listener, so the hunt-20 "next never quits"
  finding is fixed. `templates/next/main.ts:9-12` has the block.
- `crust init` token substitution (`src/cli/init.ts:106-133`) leaves no `{{…}}` in written configs;
  `gitignore` is renamed to `.gitignore` on copy (`:128-130`).
- `examples/dogear/desktop/main.ts` is reachable only via the `--entry` in its own `package.json`;
  the bare build failure documented at `docs/agents/examples-audit.md:45-47` is expected.
- No file under `examples/` or `templates/` exceeds 200 lines (line counts via `wc -l` over
  `rg --files`).
